// Package main implements a Go port of the g4f.dev cake baker.
//
// It performs the same proof-of-work protocol as the browser-side
// dist/js/cake-baker.js against the cake-worker Cloudflare Worker:
//
//   1. GET  {endpoint}/issue?n={batch}      -> { uuids: [...], difficulty, ... }
//   2. For each uuid, brute-force a nonce so that
//        sha256(uuid + ":" + salt + ":" + nonce)
//      has at least `difficulty` leading zero bits.
//   3. POST {endpoint}/bake {uuid, salt, nonce, hash}
//      -> { ok, credit_cents, baked_today, ... }
//   4. GET  {endpoint}/status               -> { credit_cents, baked_today, ... }
//
// The baker runs continuously, refetching batches and baking them in
// parallel across multiple goroutines until the daily limit is reached
// or the process is interrupted.
//
// Subcommands:
//
//   cake-baker             Run the continuous baker (default).
//   cake-baker status      Print worker status once and exit.
//   cake-baker once        Bake a single batch and exit.
//   cake-baker version     Print build version and exit.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// ---------------------------------------------------------------------------
// Defaults — mirror the JS client (dist/js/cake-baker.js)
// ---------------------------------------------------------------------------

const (
	defaultEndpoint   = "https://g4f.space/cake"
	defaultBatch       = 20
	defaultWorkers     = 4
	defaultDifficulty  = 16
	defaultPollMS      = 5000
	throttleCapMS      = 60000
	throttleSoftAt     = 0.5
	throttleHardAt     = 0.9
)

// ---------------------------------------------------------------------------
// Wire types — match cake-worker.js exactly
// ---------------------------------------------------------------------------

type issueResponse struct {
	UUIDs       []string  `json:"uuids"`
	Difficulty  int       `json:"difficulty"`
	Algorithm   string    `json:"algorithm"`
	CreditCents flexFloat `json:"credit_cents"`
	BakedToday  int       `json:"baked_today"`
	LimitPerDay int       `json:"limit_per_day"`
	Error       string    `json:"error,omitempty"`
}

type bakeRequest struct {
	UUID  string `json:"uuid"`
	Salt  string `json:"salt"`
	Nonce string `json:"nonce"`
	Hash  string `json:"hash"`
}

type bakeResponse struct {
	OK            bool      `json:"ok"`
	Status        string    `json:"status"`
	UUID          string    `json:"uuid"`
	CreditCents   flexFloat `json:"credit_cents"`
	TotalCents    flexFloat `json:"total_credit_cents"`
	BakedToday    int       `json:"baked_today"`
	LimitPerDay   int       `json:"limit_per_day"`
	BoundToIP     string    `json:"bound_to_ip"`
	UserCredited  bool      `json:"user_credited"`
	Error         string    `json:"error,omitempty"`
}

type statusResponse struct {
	IP          string    `json:"ip"`
	BakedToday  int       `json:"baked_today"`
	LimitPerDay int       `json:"limit_per_day"`
	CreditCents flexFloat `json:"credit_cents"`
	CreditUSD   flexFloat `json:"credit_usd"`
	Difficulty  int       `json:"difficulty"`
}

// flexFloat is a float64 that can be unmarshaled from either a JSON number
// or a JSON string holding a numeric value. Some cake-worker responses
// encode credit fields as strings (e.g. "0.0123") rather than numbers.
type flexFloat float64

// UnmarshalJSON accepts both numeric and string-encoded JSON values.
func (f *flexFloat) UnmarshalJSON(data []byte) error {
	// Try a plain number first.
	var n float64
	if err := json.Unmarshal(data, &n); err == nil {
		*f = flexFloat(n)
		return nil
	}
	// Otherwise, expect a quoted string.
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return fmt.Errorf("flexFloat: cannot unmarshal %s into float64", string(data))
	}
	// An empty string is treated as zero.
	if strings.TrimSpace(s) == "" {
		*f = 0
		return nil
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return fmt.Errorf("flexFloat: cannot parse %q as float64: %w", s, err)
	}
	*f = flexFloat(v)
	return nil
}

// Float64 returns the underlying float64 value.
func (f flexFloat) Float64() float64 { return float64(f) }

// dailyLimitError is returned by getIssue when the server responds 429 with
// daily_limit_reached. It carries the server-advertised Retry-After (seconds)
// so the main loop can back off for that duration instead of polling on the
// short base interval.
type dailyLimitError struct {
	retryAfterSecs int
	bakedToday     int
	limitPerDay    int
}

func (e *dailyLimitError) Error() string {
	return fmt.Sprintf("daily_limit_reached: %d/%d (retry-after %ds)", e.bakedToday, e.limitPerDay, e.retryAfterSecs)
}

// RetryAfter returns the duration the client should wait before retrying.
func (e *dailyLimitError) RetryAfter() time.Duration {
	if e.retryAfterSecs <= 0 {
		return time.Hour
	}
	return time.Duration(e.retryAfterSecs) * time.Second
}

// ---------------------------------------------------------------------------
// Baker
// ---------------------------------------------------------------------------

type Baker struct {
	endpoint   string
	batch      int
	workers    int
	difficulty int
	pollMS     int
	limitPerDay int

	client *http.Client

	// adaptive throttle state
	bakedToday atomic.Int64
	mu         sync.Mutex
}

func NewBaker(endpoint string, batch, workers, difficulty, pollMS int) *Baker {
	return &Baker{
		endpoint:   endpoint,
		batch:      batch,
		workers:    workers,
		difficulty: difficulty,
		pollMS:      pollMS,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// leadingZeroBits counts the number of leading zero bits in a hex digest,
// matching the algorithm in cake-worker.js.
func leadingZeroBits(hexDigest string) int {
	bits := 0
	for i := 0; i < len(hexDigest); i++ {
		c := hexDigest[i]
		var nibble int
		switch {
		case c >= '0' && c <= '9':
			nibble = int(c - '0')
		case c >= 'a' && c <= 'f':
			nibble = int(c-'a') + 10
		case c >= 'A' && c <= 'F':
			nibble = int(c-'A') + 10
		default:
			return bits
		}
		if nibble == 0 {
			bits += 4
			continue
		}
		// count leading zeros in the 4-bit nibble
		switch nibble {
		case 1:
			bits += 3
		case 2, 3:
			bits += 2
		case 4, 5, 6, 7:
			bits += 1
		}
		break
	}
	return bits
}

// randomSalt returns a 16-byte hex-encoded salt, matching the JS client
// which uses crypto.getRandomValues for the salt.
func randomSalt() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// bakeOne brute-forces a nonce so that sha256(uuid:salt:nonce) has at
// least `difficulty` leading zero bits. It returns the winning nonce
// (as a decimal string) and the hex digest.
func bakeOne(uuid, salt string, difficulty int) (nonce, hash string, err error) {
	// Use a 64-bit counter seeded with random bytes for uniqueness across
	// goroutines. The worker accepts any string nonce, so a decimal uint64
	// is fine.
	var counter uint64
	if err := binary.Read(rand.Reader, binary.BigEndian, &counter); err != nil {
		return "", "", err
	}

	prefix := []byte(uuid + ":" + salt + ":")
	h := sha256.New()
	for {
		counter++
		nonceBytes := []byte(fmt.Sprintf("%d", counter))
		h.Reset()
		h.Write(prefix)
		h.Write(nonceBytes)
		digest := hex.EncodeToString(h.Sum(nil))
		if leadingZeroBits(digest) >= difficulty {
			return string(nonceBytes), digest, nil
		}
	}
}

// getIssue fetches a batch of UUIDs from the worker. When the server returns
// 429 (daily limit reached), the returned error wraps a *dailyLimitError so
// the caller can back off for the server-advertised Retry-After duration
// instead of polling on the short base interval.
func (b *Baker) getIssue(ctx context.Context) (*issueResponse, error) {
	url := fmt.Sprintf("%s/issue?n=%d", b.endpoint, b.batch)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := b.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		var ir issueResponse
		_ = json.Unmarshal(body, &ir)
		if ir.Difficulty > 0 {
			b.difficulty = ir.Difficulty
		}
		if ir.LimitPerDay > 0 {
			b.limitPerDay = ir.LimitPerDay
		}
		if ir.BakedToday > 0 {
			b.bakedToday.Store(int64(ir.BakedToday))
		}
		// Surface the daily-limit condition distinctly so the loop can
		// honour the server's Retry-After hint rather than a fixed 10m.
		if resp.StatusCode == http.StatusTooManyRequests || ir.Error == "daily_limit_reached" {
			retryAfter := 3600
			if ra := resp.Header.Get("Retry-After"); ra != "" {
				if n, err := strconv.Atoi(ra); err == nil && n > 0 {
					retryAfter = n
				}
			}
			return nil, &dailyLimitError{retryAfterSecs: retryAfter, bakedToday: ir.BakedToday, limitPerDay: ir.LimitPerDay}
		}
		return nil, fmt.Errorf("issue: HTTP %d: %s (%s)", resp.StatusCode, ir.Error, string(body))
	}
	var ir issueResponse
	if err := json.Unmarshal(body, &ir); err != nil {
		return nil, fmt.Errorf("issue: bad json: %w", err)
	}
	if ir.Difficulty > 0 {
		b.difficulty = ir.Difficulty
	}
	if ir.LimitPerDay > 0 {
		b.limitPerDay = ir.LimitPerDay
	}
	return &ir, nil
}

// postBake submits a baked cake to the worker.
func (b *Baker) postBake(ctx context.Context, reqBody bakeRequest) (*bakeResponse, error) {
	payload, _ := json.Marshal(reqBody)
	req, err := http.NewRequestWithContext(ctx, "POST", b.endpoint+"/bake", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := b.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var br bakeResponse
	if err := json.Unmarshal(body, &br); err != nil {
		return nil, fmt.Errorf("bake: bad json: %w (%s)", err, string(body))
	}
	if resp.StatusCode != 200 || !br.OK {
		return &br, fmt.Errorf("bake: HTTP %d: %s", resp.StatusCode, br.Error)
	}
	return &br, nil
}

// getStatus fetches the current credit + daily count from the worker.
func (b *Baker) getStatus(ctx context.Context) (*statusResponse, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", b.endpoint+"/status", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := b.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("status: HTTP %d: %s", resp.StatusCode, string(body))
	}
	var sr statusResponse
	if err := json.Unmarshal(body, &sr); err != nil {
		return nil, fmt.Errorf("status: bad json: %w", err)
	}
	return &sr, nil
}

// computePollInterval mirrors the adaptive throttle in cake-baker.js:
// linear scale from pollMS (at 0% of daily limit) up to throttleCapMS
// (at hard throttle threshold). Past hard throttle, return the cap.
func (b *Baker) computePollInterval() time.Duration {
	baked := float64(b.bakedToday.Load())
	limit := float64(b.limitPerDay)
	if limit <= 0 {
		return time.Duration(b.pollMS) * time.Millisecond
	}
	ratio := baked / limit
	if ratio >= throttleHardAt {
		return time.Duration(throttleCapMS) * time.Millisecond
	}
	if ratio < throttleSoftAt {
		return time.Duration(b.pollMS) * time.Millisecond
	}
	// linear scale between soft and hard
	scaled := (ratio - throttleSoftAt) / (throttleHardAt - throttleSoftAt)
	ms := float64(b.pollMS) + scaled*float64(throttleCapMS-b.pollMS)
	return time.Duration(math.Min(ms, float64(throttleCapMS))) * time.Millisecond
}

// run is the main loop: fetch a batch, bake all UUIDs in parallel,
// submit them, then sleep computePollInterval() before the next batch.
func (b *Baker) run(ctx context.Context) error {
	// Prime the daily counter from the worker's status.
	if sr, err := b.getStatus(ctx); err == nil {
		b.bakedToday.Store(int64(sr.BakedToday))
		if sr.LimitPerDay > 0 {
			b.limitPerDay = sr.LimitPerDay
		}
		if sr.Difficulty > 0 {
			b.difficulty = sr.Difficulty
		}
		log.Printf("status: ip=%s baked_today=%d/%d credit=$%.4f difficulty=%d",
			sr.IP, sr.BakedToday, sr.LimitPerDay, sr.CreditUSD.Float64(), sr.Difficulty)
	} else {
		log.Printf("warning: could not fetch initial status: %v", err)
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Check daily limit before fetching more work.
		if b.limitPerDay > 0 && int(b.bakedToday.Load()) >= b.limitPerDay {
			log.Printf("daily limit reached (%d/%d) — sleeping 1h",
				b.bakedToday.Load(), b.limitPerDay)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(1 * time.Hour):
			}
			continue
		}

		if err := b.bakeBatch(ctx); err != nil {
			if errors.Is(err, context.Canceled) {
				return err
			}
			// If the server told us the daily limit is reached, honor its
			// Retry-After hint (default 1h) instead of polling every minute.
			var dle *dailyLimitError
			if errors.As(err, &dle) {
				wait := dle.RetryAfter()
				if wait <= 0 {
					wait = time.Hour
				}
				log.Printf("daily limit reached (server) — sleeping %s", wait)
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(wait):
				}
				continue
			}
			// Transient issue errors already logged; back off and retry.
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(b.pollMS) * time.Millisecond):
			}
			continue
		}

		// Adaptive throttle between batches.
		delay := b.computePollInterval()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
	}
}

// runOnce primes state from /status, bakes a single batch, then returns.
func (b *Baker) runOnce(ctx context.Context) error {
	if sr, err := b.getStatus(ctx); err == nil {
		b.bakedToday.Store(int64(sr.BakedToday))
		if sr.LimitPerDay > 0 {
			b.limitPerDay = sr.LimitPerDay
		}
		if sr.Difficulty > 0 {
			b.difficulty = sr.Difficulty
		}
		log.Printf("status: ip=%s baked_today=%d/%d credit=$%.4f difficulty=%d",
			sr.IP, sr.BakedToday, sr.LimitPerDay, sr.CreditUSD.Float64(), sr.Difficulty)
	} else {
		log.Printf("warning: could not fetch initial status: %v", err)
	}

	if b.limitPerDay > 0 && int(b.bakedToday.Load()) >= b.limitPerDay {
		log.Printf("daily limit reached (%d/%d) — nothing to do",
			b.bakedToday.Load(), b.limitPerDay)
		return nil
	}
	return b.bakeBatch(ctx)
}

// bakeBatch fetches one issue and bakes + submits all UUIDs in parallel.
// Returns nil on success, a context error if cancelled, or a non-nil
// error if the issue endpoint failed (already logged).
func (b *Baker) bakeBatch(ctx context.Context) error {
	ir, err := b.getIssue(ctx)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return err
		}
		log.Printf("issue error: %v", err)
		return err
	}
	if ir.Error != "" {
		log.Printf("issue refused: %s (baked_today=%d limit=%d)",
			ir.Error, ir.BakedToday, ir.LimitPerDay)
		return fmt.Errorf("issue refused: %s", ir.Error)
	}
	if len(ir.UUIDs) == 0 {
		log.Printf("issue returned no uuids")
		return fmt.Errorf("issue returned no uuids")
	}

	log.Printf("issued %d uuids (difficulty=%d, baked_today=%d/%d)",
		len(ir.UUIDs), b.difficulty, ir.BakedToday, ir.LimitPerDay)

	// Bake + submit each UUID in parallel.
	var wg sync.WaitGroup
	uuidCh := make(chan string, len(ir.UUIDs))
	for _, id := range ir.UUIDs {
		uuidCh <- id
	}
	close(uuidCh)

	var accepted, rejected atomic.Int64
	for i := 0; i < b.workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for uuid := range uuidCh {
				salt, err := randomSalt()
				if err != nil {
					log.Printf("salt error: %v", err)
					rejected.Add(1)
					continue
				}
				nonce, hash, err := bakeOne(uuid, salt, b.difficulty)
				if err != nil {
					log.Printf("bake error for %s: %v", uuid, err)
					rejected.Add(1)
					continue
				}
				br, err := b.postBake(ctx, bakeRequest{
					UUID:  uuid,
					Salt:  salt,
					Nonce: nonce,
					Hash:  hash,
				})
				if err != nil {
					log.Printf("submit %s: %v", uuid, err)
					rejected.Add(1)
					continue
				}
				b.bakedToday.Store(int64(br.BakedToday))
				if br.LimitPerDay > 0 {
					b.limitPerDay = br.LimitPerDay
				}
				accepted.Add(1)
				log.Printf("✓ baked %s  credit=$%.4f  baked_today=%d/%d  total=$%.4f",
						uuid[:8], br.CreditCents.Float64()/100,
						br.BakedToday, br.LimitPerDay,
						br.TotalCents.Float64()/100)
			}
		}()
	}
	wg.Wait()

	log.Printf("batch done: %d accepted, %d rejected", accepted.Load(), rejected.Load())
	return nil
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

// version is set via -ldflags "-X main.version=..." at build time.
var version = "dev"

func main() {
	endpoint := flag.String("endpoint", defaultEndpoint, "cake worker endpoint (e.g. https://g4f.space/cake)")
	batch := flag.Int("batch", defaultBatch, "number of UUIDs to request per issue")
	workers := flag.Int("workers", defaultWorkers, "parallel hashing goroutines")
	difficulty := flag.Int("difficulty", defaultDifficulty, "fallback leading-zero-bits target (worker overrides)")
	pollMS := flag.Int("interval", defaultPollMS, "base poll interval between batches (ms)")
	once := flag.Bool("once", false, "bake a single batch and exit (no loop)")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("cake-baker %s\n", version)
		return
	}

	log.SetFlags(log.LstdFlags | log.Lmicroseconds)

	// Subcommand: `cake-baker status [endpoint]` — one-shot status check.
	if len(flag.Args()) > 0 && flag.Arg(0) == "status" {
		ep := *endpoint
		if len(flag.Args()) > 1 {
			ep = flag.Arg(1)
		}
		b := NewBaker(ep, *batch, *workers, *difficulty, *pollMS)
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		sr, err := b.getStatus(ctx)
		if err != nil {
			log.Printf("status error: %v", err)
			os.Exit(1)
		}
		printStatus(sr)
		return
	}

	log.Printf("g4f cake baker %s starting: endpoint=%s batch=%d workers=%d difficulty=%d",
		version, *endpoint, *batch, *workers, *difficulty)

	b := NewBaker(*endpoint, *batch, *workers, *difficulty, *pollMS)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		s := <-sigCh
		log.Printf("received signal %v — shutting down", s)
		cancel()
	}()

	if *once {
		if err := b.runOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("baker exited with error: %v", err)
			os.Exit(1)
		}
	} else {
		if err := b.run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("baker exited with error: %v", err)
			os.Exit(1)
		}
	}
	log.Printf("baker stopped")
}

// printStatus writes a human-readable status summary to stdout.
func printStatus(sr *statusResponse) {
	fmt.Printf("ip            %s\n", sr.IP)
	fmt.Printf("baked_today   %d / %d\n", sr.BakedToday, sr.LimitPerDay)
	fmt.Printf("credit        $%.4f (%.0f cents)\n", sr.CreditUSD.Float64(), sr.CreditCents.Float64())
	fmt.Printf("difficulty    %d leading zero bits\n", sr.Difficulty)
}