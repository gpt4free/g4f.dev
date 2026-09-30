# Challenge Cakes — earn cake credit with the browser LanguageModel

An alternative to proof-of-work hashing (`/cake/bake`): instead of burning CPU on
hash loops, the client solves small AI tasks locally with Chrome's built-in
`LanguageModel` (Gemini Nano / Prompt API). It is typically **faster** to the
first cakes, since one solved challenge credits more than one PoW bake.

```
Client                          Worker (/challenge)                    KV (CAKE_KV)
  │  GET /challenge/issue?lang=de-DE  │                                   │
  │──────────────────────────────────▶│ create payload, AES-GCM seal      │
  │  ◀── {id, ciphertext, iv, kind} ──│ store challenge:<id> (TTL 300s)   │
  │                                   │──────────────────────────────────▶│
  │  decrypt with CHALLENGE_SECRET    │                                   │
  │  session.prompt(payload.prompt)   │   (local Gemini Nano, offline)    │
  │  seal(answer)                     │                                   │
  │  POST /challenge/solve            │                                   │
  │──────────────────────────────────▶│ unseal, validate, burn challenge  │
  │  ◀──────── {token (JWT), credit_cents} ───▶│ mark solved, dedup hash  │
  │  POST /challenge/redeem {token}   │                                   │
  │──────────────────────────────────▶│ verify HS256, IP-bound, replay    │
  │  ◀──────── {credited, total_credits} ────│ cakes:credit:<ip> += cents │
```

## Endpoints

| Method | Path                  | Description |
|--------|-----------------------|-------------|
| GET    | `/challenge/issue?lang=<lang>&kind=followup\|translation\|any` | Returns an encrypted challenge. The plaintext prompt is **never** sent in cleartext. |
| POST   | `/challenge/solve`    | Body: `{id, ciphertext, iv, language}` (answer sealed with AES-GCM). Returns `{token, credit_cents}`. |
| POST   | `/challenge/redeem`   | Body: `{token}` (or `Authorization: Bearer <token>`). Credits the cake ledger. |
| GET    | `/challenge/status`   | Current IP's `solved_today`, `credit_cents`, limits. |
| GET    | `/challenge/health`   | Liveness probe. |

Challenge kinds:

- **followup** — "Ask 3 first-person follow-up questions about `<random topic>`",
  answer `{"q": ["...", "...", "..."]}` (2–8 questions, 3–500 chars each).
- **translation** — translate a random English snippet, answer `{"text": "..."}`
  (5–2000 chars, must differ from the source).

## Security model

- **Sealing**: AES-256-GCM, key = `SHA-256(CHALLENGE_SECRET)`, random 12-byte IV,
  base64url ciphertext. The client needs the secret to decrypt — it is shipped
  in the page (`window.G4F_CHALLENGE_SECRET`), so this is obfuscation against
  casual scrapers, not secrecy from a determined attacker. Server-side answer
  validation is the real gate.
- **JWT**: HS256 signed with `CHALLENGE_JWT_SECRET`, TTL 600s, payload
  `{sub: "challenge:<ip>", kind, language, credit_cents, challenge_id}`.
  Bound to the solver's IP; redeeming from another IP returns 403.
- **Replay protection**: challenges burn on solve (`challenge:<id>` deleted,
  answer-hash dedup with daily TTL); tokens get a `challenge:redeemed:<hash>`
  KV marker (TTL 900s > token TTL) checked before crediting.
- **Rate limits**: `CHALLENGE_PER_IP_PER_DAY` issues per IP (default 100),
  `CHALLENGE_MAX_PER_DAY` global (default 150).

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CAKE_KV` | — | KV namespace (shared with the cake worker). On Vercel: Upstash REST credentials. |
| `CHALLENGE_SECRET` | — | AES sealing key material (required). |
| `CHALLENGE_JWT_SECRET` | — | HS256 signing secret (required). |
| `CAKE_CREDIT_CENTS` | `5` | Credit per solved challenge (0.05¢). |
| `CHALLENGE_PER_IP_PER_DAY` | `100` | Per-IP issue limit. |
| `CHALLENGE_MAX_PER_DAY` | `150` | Global issue limit. |
| `CHALLENGE_TTL_SEC` | `300` | Challenge validity after issue. |
| `ADMIN_API_KEY` | — | Optional, for admin endpoints. |

## KV keys (all in `CAKE_KV`)

| Key | TTL | Purpose |
|-----|-----|---------|
| `challenge:<id>` | 300s | Sealed challenge record (kind, language, issued_at). |
| `challenge:seen:<hash>` | 24h | Answer dedup — same answer never double-credits. |
| `challenge:rate:<ip>` | 24h | Per-IP issue counter. |
| `challenge:solved:<ip>` | 24h | Per-IP solve counter (shown in `/status`). |
| `challenge:redeemed:<hash>` | 900s | Token replay marker. |
| `cakes:credit:<ip>` | — | **Shared cake ledger** — same key `cake-worker.js` writes on PoW bakes and `api-worker.js` reads for anonymous usage gating. |

## Deployment

**Vercel** (this repo): `api/challenge.js` adapts the Cloudflare-style worker
(`workers/challenge-worker.js`) to the edge runtime — same pattern as
`api/worker.js`. Routing is in `vercel.json`:

```json
{"source": "/challenge", "destination": "/api/challenge?path=/challenge"},
{"source": "/challenge/:path*", "destination": "/api/challenge?path=/challenge/:path*"}
```

Set `CHALLENGE_SECRET` and `CHALLENGE_JWT_SECRET` in the Vercel project env
vars, plus the Upstash REST vars used for `CAKE_KV` (same as the other workers).

**Cloudflare** (optional): deploy `workers/challenge-worker.js` with a wrangler
config binding `CAKE_KV`, mirroring `wrangler-cake.toml`.

## Client integration

`dist/js/challenge-client.js` exposes `window.G4FChallenge`:

```js
G4FChallenge.isSupported();          // LanguageModel available?
G4FChallenge.solveOnce();            // one full issue→solve→redeem round
G4FChallenge.start();                // polling loop (5s interval, max 50 rounds)
G4FChallenge.stop();
G4FChallenge.status();
```

- Auto-starts on chat/members pages (same detection as `cake-baker.js`);
  opt out with `<body data-challenge-client="off">`.
- On successful redeem it dispatches
  `window.dispatchEvent(new CustomEvent("g4f:cake:accepted", {detail: {...}}))`,
  which `addon-baked-credits.js` already listens for — no extra wiring needed.
- Stops polling on 429 (rate limit) or when `LanguageModel` is unavailable
  (non-Chrome browsers simply fall back to PoW baking).

## Smoke test

```bash
cd g4f.dev
node dist/js/challenge-client.smoke.test.cjs
```

25 checks covering: issue (encrypted, no plaintext leak), client-side decrypt
via the real client code path, solve, token issuance, replay rejection,
redeem + ledger credit, double-redeem rejection, tampered-token rejection,
invalid-answer rejection, and status reporting.
