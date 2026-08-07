/**
 * G4F Cake Baker — Client-side proof-of-work module
 *
 * Auto-runs when the user opens g4f.dev/chat or g4f.dev/members.html.
 * Fetches a batch of UUIDs from the cake worker, computes the salted
 * SHA-256 hash in a background Web Worker until the digest meets the
 * difficulty target, then submits the baked cake back to the worker.
 *
 * Each accepted cake grants 0.05¢ credit to the user's account, bound
 * to the IP that baked it.
 *
 * Usage:
 *   <script type="module" src="dist/js/cake-baker.js?v={{ v }}" defer></script>
 *
 * The module exposes a small API on window.G4FCakeBaker for debugging:
 *   - status(): returns { baked, submitted, accepted, credits, running }
 *   - start(): manually start baking
 *   - stop(): stop baking
 */
(function () {
    "use strict";

    // Configuration -------------------------------------------------------
    const CAKE_ENDPOINT = "https://g4f.space/cake"; // same-origin via route
    const BATCH_SIZE = 20;         // UUIDs fetched per request (server caps at 50)
    const POLL_INTERVAL_MS = 15000; // base re-fetch interval when queue empty
    const STORAGE_KEY = "g4f_cake_baker";
    const HEARTBEAT_KEY = "g4f_cake_heartbeat";

    // Adaptive throttling ------------------------------------------------
    // As the user bakes more cakes today, we slow down to avoid hammering
    // the server and to leave CPU for others. The interval scales linearly
    // with the fraction of the daily limit already consumed, up to a cap.
    const THROTTLE_CAP_MS = 60000;   // never wait longer than this between batches
    const THROTTLE_SOFT_AT = 0.5;     // begin backing off once 50% of daily limit reached
    const THROTTLE_HARD_AT = 0.9;    // near the limit, wait the full cap

    function computePollInterval() {
        const limit = state.limitPerDay || 100;
        const baked = state.dailyBaked || 0;
        if (limit <= 0 || baked <= 0) return POLL_INTERVAL_MS;
        const frac = baked / limit;
        if (frac < THROTTLE_SOFT_AT) return POLL_INTERVAL_MS;
        if (frac >= THROTTLE_HARD_AT) return THROTTLE_CAP_MS;
        // linear interpolation between soft and hard thresholds
        const t = (frac - THROTTLE_SOFT_AT) / (THROTTLE_HARD_AT - THROTTLE_SOFT_AT);
        return Math.round(POLL_INTERVAL_MS + t * (THROTTLE_CAP_MS - POLL_INTERVAL_MS));
    }

    // State ---------------------------------------------------------------
    const state = {
        running: false,
        queue: [],          // pending UUIDs to bake
        inFlight: 0,        // number of UUIDs currently being baked
        baked: 0,           // cakes baked locally this session
        submitted: 0,       // cakes submitted to server
        accepted: 0,        // cakes accepted by server
        credits: 0,         // total cents credited this session
        workers: [],        // pool of Web Workers for hashing
        timer: null,        // poll timer
        difficulty: 4,      // default; updated from server
        salt: null,         // per-session salt; updated from server
        dailyBaked: 0,      // cakes baked by this IP today (from server)
        limitPerDay: 100,   // server-imposed daily limit (from server)
        dailyLimitReached: false,   // server returned 429 daily_limit_reached
        dailyLimitRetryAt: 0,       // epoch ms when Retry-After elapses
        workerRates: {},            // workerId -> last reported h/s
        hashRate: 0,                // aggregated hash rate across all workers (h/s)
        rateTimer: null,           // interval that refreshes the #input-count display
    };

    // Persistence ---------------------------------------------------------
    function loadState() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
            return {
                baked: saved.baked || 0,
                submitted: saved.submitted || 0,
                accepted: saved.accepted || 0,
                credits: saved.credits || 0,
                lastDay: saved.lastDay || new Date().toISOString().slice(0, 10),
            };
        } catch {
            return { baked: 0, submitted: 0, accepted: 0, credits: 0, lastDay: new Date().toISOString().slice(0, 10) };
        }
    }

    function saveState() {
        const today = new Date().toISOString().slice(0, 10);
        const saved = loadState();
        if (saved.lastDay !== today) {
            saved.baked = 0;
            saved.submitted = 0;
            saved.accepted = 0;
            saved.credits = 0;
            saved.lastDay = today;
        }
        saved.baked += state.baked;
        saved.submitted += state.submitted;
        saved.accepted += state.accepted;
        saved.credits += state.credits;
        // reset session counters after persisting
        state.baked = 0;
        state.submitted = 0;
        state.accepted = 0;
        state.credits = 0;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    }

    // Heartbeat: only one tab bakes at a time -----------------------------
    function acquireLock() {
        const now = Date.now();
        const existing = parseInt(localStorage.getItem(HEARTBEAT_KEY) || "0", 10);
        if (existing && now - existing < 30000) {
            // another tab is baking
            return false;
        }
        localStorage.setItem(HEARTBEAT_KEY, String(now));
        return true;
    }

    function refreshLock() {
        if (state.running) {
            localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
        }
    }

    // Web Worker for hashing ----------------------------------------------
    // Uses the browser's native, hardware-accelerated crypto.subtle.digest
    // (10-50x faster than a pure-JS SHA-256) and processes many nonces per
    // async tick to amortize the promise overhead. Each worker runs on its
    // own thread, so we spawn several (one per logical core) for parallelism.
    const WORKER_SOURCE = `
        const encoder = new TextEncoder();
        const hexChars = "0123456789abcdef";

        // Convert an ArrayBuffer to a lowercase hex string without per-byte
        // string concatenation (faster than map+padStart).
        function toHex(buf) {
            const bytes = new Uint8Array(buf);
            let out = "";
            for (let i = 0; i < bytes.length; i++) {
                out += hexChars[bytes[i] >> 4] + hexChars[bytes[i] & 0x0f];
            }
            return out;
        }

        // Count leading zero bits in a hex digest (matches the server's check).
        function leadingZeroBits(hex) {
            let bits = 0;
            for (let i = 0; i < hex.length; i++) {
                const nibble = hex.charCodeAt(i);
                if (nibble === 48) { // '0'
                    bits += 4;
                } else {
                    bits += Math.clz32(nibble - (nibble <= 57 ? 48 : 87)) - 28;
                    break;
                }
            }
            return bits;
        }

        self.onmessage = async function (e) {
            const { uuid, salt, difficulty, workerId } = e.data;
            // Each worker bakes its own UUID starting at nonce 0.
            let nonce = 0;
            const batchSize = 2048; // nonces per async tick
            let scanned = 0;
            const startTime = Date.now();
            const startedAt = performance.now();
            let lastLogAt = startedAt;
            let lastScanned = 0;

            while (true) {
                let found = false;
                // Hash a batch of nonces in parallel using native SubtleCrypto.
                const promises = new Array(batchSize);
                for (let i = 0; i < batchSize; i++) {
                    const input = uuid + ":" + salt + ":" + nonce;
                    promises[i] = crypto.subtle.digest("SHA-256", encoder.encode(input));
                    nonce += 1;
                }
                const digests = await Promise.all(promises);
                for (let i = 0; i < batchSize; i++) {
                    const hex = toHex(digests[i]);
                    if (leadingZeroBits(hex) >= difficulty) {
                        const foundNonce = nonce - batchSize + i;
                        const elapsed = (performance.now() - startedAt) / 1000;
                        const rate = scanned > 0 ? (scanned / elapsed).toFixed(0) : "?";
                        console.log(
                            "%c[G4FCakeBaker] hash found%c " +
                            "worker=" + workerId + " nonce=" + foundNonce +
                            " zeros=" + leadingZeroBits(hex) + "/" + difficulty +
                            " hash=" + hex.slice(0, 16) + "\u2026" +
                            " scanned=" + scanned + " rate=" + rate + " h/s" +
                            " elapsed=" + elapsed.toFixed(2) + "s",
                            "color:#4ade80;font-weight:bold", "color:inherit"
                        );
                        self.postMessage({
                            uuid, salt, nonce: foundNonce, hash: hex,
                            ok: true, workerId,
                        });
                        found = true;
                        break;
                    }
                }
                if (found) break;
                scanned += batchSize;
                // yield to keep the worker thread responsive and report progress
                if (scanned % 16384 === 0) {
                    const now = performance.now();
                    const dt = (now - lastLogAt) / 1000;
                    if (dt >= 2) {
                        const rate = ((scanned - lastScanned) / dt).toFixed(0);
                        console.log(
                            "%c[G4FCakeBaker] hashing%c " +
                            "worker=" + workerId + " scanned=" + scanned +
                            " rate=" + rate + " h/s" +
                            " difficulty=" + difficulty,
                            "color:#60a5fa", "color:inherit"
                        );
                        lastLogAt = now;
                        lastScanned = scanned;
                        self.postMessage({ type: "progress", nonce, workerId, scanned, rate: Number(rate) });
                    } else {
                        self.postMessage({ type: "progress", nonce, workerId, scanned });
                    }
                }
            }
        };
    `;

    // Number of parallel hashing workers — one per logical CPU core, capped
    // to avoid overwhelming low-end devices. Falls back to 4 if unavailable.
    const NUM_WORKERS = Math.ceil(Math.min(Math.max(navigator.hardwareConcurrency || 4, 2), 8) / 2);
    const WORKER_STRIDE = NUM_WORKERS; // each worker steps by this many nonces

    function createWorker(workerId) {
        const blob = new Blob([WORKER_SOURCE], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        const w = new Worker(url);
        w.workerId = workerId;
        w.busy = false;
        w.onmessage = (e) => {
            const data = e.data;
            if (data.type === "progress") {
                // periodically refresh lock so other tabs don't take over
                refreshLock();
                if (typeof data.rate === "number" && data.rate > 0) {
                    state.workerRates[data.workerId] = data.rate;
                }
                console.log(
                    "%c[G4FCakeBaker] hashing%c " +
                    "worker=" + data.workerId + " scanned=" + data.scanned +
                    " rate=" + (data.rate ? (data.rate / 1000).toFixed(1) + "k h/s" : "?") +
                    " nonce=" + data.nonce,
                    "color:#60a5fa;font-weight:bold", "color:inherit"
                );
                return;
            }
            if (data.type === "request") {
                // worker finished its UUID and is asking for more work
                w.busy = false;
                state.inFlight = Math.max(0, state.inFlight - 1);
                bakeNext();
                return;
            }
            if (data.ok) {
                w.busy = false;
                state.inFlight = Math.max(0, state.inFlight - 1);
                state.baked += 1;
                console.log(
                    "%c[G4FCakeBaker] baked%c " +
                    "worker=" + data.workerId + " nonce=" + data.nonce +
                    " hash=" + (data.hash || "").slice(0, 24) + "\u2026" +
                    " baked=" + state.baked + " inFlight=" + state.inFlight,
                    "color:#4ade80;font-weight:bold", "color:inherit"
                );
                submitCake(data);
                // dispatch more work to this (now idle) worker and others
                bakeNext();
            }
        };
        w.onerror = (err) => {
            console.warn("[G4FCakeBaker] worker error", err);
            w.busy = false;
            state.inFlight = Math.max(0, state.inFlight - 1);
            // fallback: retry after delay
            setTimeout(bakeNext, 5000);
        };
        return w;
    }

    // Aggregate per-worker hash rates into a single h/s figure and render
    // it into the chat's #input-count element (the token-count display).
    // When the baker is idle or stopped, the element is cleared so the
    // normal token/word count can take over.
    function formatHashRate(hps) {
        if (!hps || hps <= 0) return null;
        if (hps >= 1e6) return (hps / 1e6).toFixed(2) + "M h/s";
        if (hps >= 1e3) return (hps / 1e3).toFixed(1) + "k h/s";
        return Math.round(hps) + " h/s";
    }

    function updateHashRate() {
        let total = 0;
        for (const id in state.workerRates) {
            total += state.workerRates[id] || 0;
        }
        state.hashRate = total;
        const el = document.getElementById("input-count");
        if (!el) return;
        const text = el.querySelector(".text") || el;
        const formatted = formatHashRate(total);
        if (formatted) {
            text.innerText = formatted;
        } else if (!state.running) {
            text.innerText = "";
        }
    }

    // Lazily create the worker pool (shared across all UUIDs).
    function ensureWorkers() {
        if (!state.workers || state.workers.length === 0) {
            state.workers = [];
            for (let i = 0; i < NUM_WORKERS; i++) {
                state.workers.push(createWorker(i));
            }
        }
        return state.workers;
    }

    // Build auth headers (sends the user's JWT when available so baked
    // cakes are credited to the authenticated account, not just the IP).
    function authHeaders(extra = {}) {
        const headers = { ...extra };
        const token =
            localStorage.getItem("g4f_session") ||
            localStorage.getItem("g4f_token") ||
            localStorage.getItem("jwt");
        if (token) headers["Authorization"] = `Bearer ${token}`;
        return headers;
    }

    // Fetch UUIDs from server --------------------------------------------
    async function fetchBatch() {
        try {
            const res = await fetch(`${CAKE_ENDPOINT}/issue?n=${BATCH_SIZE}`, {
                credentials: "include",
                headers: authHeaders(),
            });
            if (!res.ok) {
                // The server returns 429 with Retry-After once the per-IP
                // daily cake limit is reached. Stop hammering /cake/issue
                // every poll cycle — schedule a single retry after the
                // server's hint (default 1h) and idle the baker meanwhile.
                if (res.status === 429) {
                    const retryAfter = Number(res.headers.get("Retry-After")) || 3600;
                    state.dailyLimitReached = true;
                    state.dailyLimitRetryAt = Date.now() + retryAfter * 1000;
                    console.info(
                        `[G4FCakeBaker] daily limit reached; retrying in ${retryAfter}s`
                    );
                } else {
                    console.warn("[G4FCakeBaker] issue failed", res.status);
                }
                return false;
            }
            // A successful issue clears any prior daily-limit backoff.
            state.dailyLimitReached = false;
            state.dailyLimitRetryAt = 0;
            const data = await res.json();
            if (data.difficulty) state.difficulty = data.difficulty;
            if (data.salt) state.salt = data.salt;
            if (typeof data.baked_today === "number") state.dailyBaked = data.baked_today;
            if (typeof data.limit_per_day === "number") state.limitPerDay = data.limit_per_day;
            if (data.uuids && data.uuids.length) {
                state.queue.push(...data.uuids);
            }
            return true;
        } catch (err) {
            console.warn("[G4FCakeBaker] issue error", err);
            return false;
        }
    }

    // Read fresh status from /cake/status --------------------------------
    // Called after each accepted bake so the UI reflects the authoritative
    // server-side credit + daily-baked counters on every bake cycle.
    async function fetchStatus() {
        try {
            const res = await fetch(`${CAKE_ENDPOINT}/status`, {
                credentials: "include",
                headers: authHeaders(),
            });
            if (!res.ok) return null;
            const data = await res.json();
            if (typeof data.credit_cents === "number") state.credits = data.credit_cents;
            if (typeof data.baked_today === "number") state.dailyBaked = data.baked_today;
            if (typeof data.limit_per_day === "number") state.limitPerDay = data.limit_per_day;
            return data;
        } catch (err) {
            console.warn("[G4FCakeBaker] status error", err);
            return null;
        }
    }

    // Submit a baked cake -------------------------------------------------
    async function submitCake(cake) {
        state.submitted += 1;
        try {
            const res = await fetch(`${CAKE_ENDPOINT}/bake`, {
                method: "POST",
                credentials: "include",
                headers: authHeaders({ "Content-Type": "application/json" }),
                body: JSON.stringify({
                    uuid: cake.uuid,
                    salt: cake.salt,
                    nonce: cake.nonce,
                    hash: cake.hash,
                }),
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                state.accepted += 1;
                state.credits += data.credit || 5; // in cents (0.05¢ = 5 hundredths)
                if (data.difficulty) state.difficulty = data.difficulty;
                if (data.salt) state.salt = data.salt;

                if (typeof data.baked_today === "number") state.dailyBaked = data.baked_today;
                if (typeof data.limit_per_day === "number") state.limitPerDay = data.limit_per_day;

                console.log(
                    "%c[G4FCakeBaker] accepted%c " +
                    "credit=" + (data.credit ?? 5) +
                    " total=" + (data.total_credits ?? "?") +
                    " accepted=" + state.accepted + " credits=" + state.credits,
                    "color:#22c55e;font-weight:bold", "color:inherit"
                );
                // Read authoritative status on each bake so the UI credits
                // counter stays in sync with the server.
                const status = await fetchStatus();
                // notify UI with fresh status (fallback to bake response)
                window.dispatchEvent(new CustomEvent("g4f:cake:accepted", {
                    detail: {
                        credit: data.credit,
                        total: status ? status.credit_cents : data.total_credits,
                        baked_today: status ? status.baked_today : data.baked_today,
                    },
                }));
            } else if (data.rotate) {
                // salt rotated; re-fetch
                if (data.salt) state.salt = data.salt;
                if (data.difficulty) state.difficulty = data.difficulty;
                console.log(
                    "%c[G4FCakeBaker] rotated%c " +
                    "salt changed, re-fetching difficulty=" + state.difficulty,
                    "color:#f59e0b;font-weight:bold", "color:inherit"
                );
            } else {
                console.warn(
                    "%c[G4FCakeBaker] rejected%c " +
                    "status=" + res.status + " reason=" + (data.error || JSON.stringify(data)),
                    "color:#ef4444;font-weight:bold", "color:inherit"
                );
            }
        } catch (err) {
            console.warn("[G4FCakeBaker] submit error", err);
        }
    }

    // Dispatch UUIDs from the queue to idle workers in parallel. Each worker
    // bakes one UUID at a time; when it finishes it asks for more work via a
    // { type: "request" } message, which calls back into this function.
    function bakeNext() {
        if (!state.running) return;
        const pool = ensureWorkers();
        // Refill the queue when it runs low.
        if (state.queue.length === 0) {
            if (state.inFlight === 0 && !state.timer) {
                // When the server has told us the daily limit is reached,
                // don't poll on the short adaptive interval — wait until the
                // server's Retry-After elapses before asking for more work.
                let delay = computePollInterval();
                if (state.dailyLimitReached && state.dailyLimitRetryAt) {
                    delay = Math.max(delay, state.dailyLimitRetryAt - Date.now());
                    if (delay <= 0) {
                        // Retry-After elapsed — clear the flag and let the
                        // next fetchBatch re-arm it if still limited.
                        state.dailyLimitReached = false;
                        state.dailyLimitRetryAt = 0;
                        delay = computePollInterval();
                    }
                }
                state.timer = setTimeout(async () => {
                    state.timer = null;
                    await fetchBatch();
                    bakeNext();
                }, delay);
            }
            return;
        }
        // Hand a UUID to every idle worker.
        for (const w of pool) {
            if (w.busy) continue;
            if (state.queue.length === 0) break;
            const uuid = state.queue.shift();
            w.busy = true;
            state.inFlight += 1;
            w.postMessage({
                uuid,
                salt: state.salt || "g4f-default-salt",
                difficulty: state.difficulty || 4,
                workerId: w.workerId,
            });
        }
    }

    // Public API ----------------------------------------------------------
    function start() {
        if (state.running) return;
        if (!acquireLock()) {
            // another tab is already baking; retry in 30s
            setTimeout(start, 30000);
            return;
        }
        state.running = true;
        const saved = loadState();
        state.baked = 0;
        state.submitted = 0;
        state.accepted = 0;
        state.credits = 0;
        // initial fetch then bake
        fetchBatch().then(() => bakeNext());
        // lock refresh interval
        state.lockInterval = setInterval(refreshLock, 10000);
        // refresh the #input-count hash-rate display every 2s
        if (!state.rateTimer) {
            state.rateTimer = setInterval(updateHashRate, 2000);
            updateHashRate();
        }
        // persist on unload
        window.addEventListener("beforeunload", () => {
            saveState();
            localStorage.removeItem(HEARTBEAT_KEY);
        });
        // persist periodically
        setInterval(saveState, 60000);
        console.info("[G4FCakeBaker] started — baking cakes in background");
    }

    function stop() {
        state.running = false;
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
        if (state.lockInterval) {
            clearInterval(state.lockInterval);
            state.lockInterval = null;
        }
        if (state.rateTimer) {
            clearInterval(state.rateTimer);
            state.rateTimer = null;
        }
        state.workerRates = {};
        state.hashRate = 0;
        updateHashRate();
        if (state.workers && state.workers.length) {
            for (const w of state.workers) w.terminate();
            state.workers = [];
        }
        state.inFlight = 0;
        localStorage.removeItem(HEARTBEAT_KEY);
        saveState();
    }

    function status() {
        const saved = loadState();
        return {
            running: state.running,
            queue: state.queue.length,
            inFlight: state.inFlight || 0,
            workers: (state.workers || []).length,
            session: {
                baked: state.baked,
                submitted: state.submitted,
                accepted: state.accepted,
                credits: state.credits,
            },
            total: saved,
        };
    }

    window.G4FCakeBaker = { start, stop, status };

    // Auto-start on chat and members pages --------------------------------
    // Matches both the production routes (/chat, /members) and the local
    // dev server, which serves the chat GUI at "/" and members at
    // "/members.html". We also fall back to a feature-detection check
    // (presence of the chat app container) so the baker starts even on
    // pages served under unexpected paths.
    const path = window.location.pathname;
    const host = window.location.hostname;
    const isLocalDev = host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
    const pathMatch =
        path === "/chat" ||
        path === "/chat/" ||
        path === "/chat/index.html" ||
        path === "/members" ||
        path === "/members.html" ||
        path === "/members/";
    // On the local dev server the chat GUI lives at "/" — start there too.
    const rootMatch = isLocalDev && (path === "/" || path === "/index.html");
    // Feature detection: the chat page mounts <main class="chat-container">
    // and the members page mounts <main class="main-container">. Only used
    // as a fallback when the path alone doesn't match (e.g. local dev at "/").
    const featureMatch = !!(
        document.querySelector("main.chat-container") ||
        document.querySelector("main.main-container") ||
        document.getElementById("chatBody") ||
        document.getElementById("statCredits")
    );

    // Allow opting out via <body data-cake-baker="off">.
    const optedOut = document.body && document.body.dataset.cakeBaker === "off";

    const shouldAutoStart = !optedOut && (pathMatch || rootMatch || featureMatch);

    if (shouldAutoStart) {
        // wait for page load
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => setTimeout(start, 2000));
        } else {
            setTimeout(start, 2000);
        }
    }
})();