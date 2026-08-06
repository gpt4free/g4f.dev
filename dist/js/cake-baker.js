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
    const BATCH_SIZE = 5;          // UUIDs fetched per request
    const POLL_INTERVAL_MS = 15000; // re-fetch when queue empty
    const STORAGE_KEY = "g4f_cake_baker";
    const HEARTBEAT_KEY = "g4f_cake_heartbeat";

    // State ---------------------------------------------------------------
    const state = {
        running: false,
        queue: [],          // pending UUIDs to bake
        baking: null,       // currently baking UUID
        baked: 0,           // cakes baked locally this session
        submitted: 0,       // cakes submitted to server
        accepted: 0,        // cakes accepted by server
        credits: 0,         // total cents credited this session
        worker: null,       // Web Worker for hashing
        timer: null,        // poll timer
        difficulty: 4,      // default; updated from server
        salt: null,         // per-session salt; updated from server
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
    const WORKER_SOURCE = `
        self.onmessage = function (e) {
            const { uuid, salt, difficulty } = e.data;
            const target = "0".repeat(difficulty);
            let nonce = 0;
            const encoder = new TextEncoder();
            // batch hashing: try 100k nonces, then yield
            while (true) {
                let found = false;
                const limit = nonce + 100000;
                for (; nonce < limit; nonce++) {
                    const data = encoder.encode(uuid + ":" + salt + ":" + nonce);
                    // Use SubtleCrypto for SHA-256 (async) — but that's slow per-call.
                    // Instead use a sync polyfill: a simple SHA-256 in JS.
                    // For performance we use a pure-JS SHA-256 implementation.
                    const hash = sha256hex(uuid + ":" + salt + ":" + nonce);
                    if (hash.startsWith(target)) {
                        self.postMessage({ uuid, salt, nonce, hash, ok: true });
                        found = true;
                        break;
                    }
                }
                if (found) break;
                // yield to keep tab responsive
                self.postMessage({ type: "progress", nonce });
            }
        };

        // --- Pure-JS SHA-256 (public domain) ---
        function sha256hex(ascii) {
            function rightRotate(value, amount) {
                return (value >>> amount) | (value << (32 - amount));
            }
            const mathPow = Math.pow;
            const maxWord = mathPow(2, 32);
            const lengthProperty = "length";
            let i, j;
            let result = "";
            const words = [];
            const asciiBitLength = ascii[lengthProperty] * 8;
            let hash = (sha256hex.h = sha256hex.h || []);
            let k = (sha256hex.k = sha256hex.k || []);
            let primeCounter = k[lengthProperty];
            const isComposite = {};
            for (let candidate = 2; primeCounter < 64; candidate++) {
                if (!isComposite[candidate]) {
                    for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
                    hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
                    k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
                }
            }
            ascii += "\\x80";
            while (ascii[lengthProperty] % 64 - 56) ascii += "\\x00";
            for (i = 0; i < ascii[lengthProperty]; i++) {
                j = ascii.charCodeAt(i);
                if (j >> 8) return; // ASCII check
                words[i >> 2] |= j << ((3 - i) % 4) * 8;
            }
            words[asciiBitLength >> 5] |= 0x80 << (asciiBitLength % 32);
            words[(((asciiBitLength + 64) >>> 9) << 4) + 15] = asciiBitLength;
            for (i = 0; i < words[lengthProperty]; i += 16) {
                const oldHash = hash.slice(0, 16);
                for (j = 0; j < 64; j++) {
                    const w = words[j];
                    const w15 = words[j + 15];
                    const w2 = words[j + 2];
                    const a = hash[(j + 1) % 16];
                    const e = hash[(j + 5) % 16];
                    const f = hash[(j + 7) % 16];
                    const g = hash[(j + 8) % 16];
                    const h = hash[(j + 13) % 16];
                    hash[(j + 5) % 16] = (w + hash[(j + 12) % 16] + rightRotate(e, 6) + rightRotate(e, 11) + rightRotate(e, 25) + ((e & hash[(j + 3) % 16]) ^ (~e & f)) + k[j] + rightRotate(a, 2) + rightRotate(a, 13) + rightRotate(a, 22) + ((a & hash[(j + 9) % 16]) ^ (a & h) ^ (hash[(j + 9) % 16] & h))) | 0;
                    hash[(j + 12) % 16] = (w15 + rightRotate(w2, 7) + rightRotate(w2, 18) + (w2 >>> 3) + rightRotate(w, 17) + rightRotate(w, 19) + (w >>> 10) + hash[(j + 14) % 16] + rightRotate(e, 6) + rightRotate(e, 11) + rightRotate(e, 25) + ((e & hash[(j + 3) % 16]) ^ (~e & f)) + k[j] + rightRotate(a, 2) + rightRotate(a, 13) + rightRotate(a, 22) + ((a & hash[(j + 9) % 16]) ^ (a & h) ^ (hash[(j + 9) % 16] & h))) | 0;
                }
                for (j = 0; j < 16; j++) {
                    hash[j] = (hash[j] + oldHash[j]) | 0;
                }
            }
            for (i = 0; i < hash[lengthProperty]; i++) {
                result += ("00000000" + (hash[i] >>> 0).toString(16)).slice(-8);
            }
            return result;
        }
    `;

    function createWorker() {
        const blob = new Blob([WORKER_SOURCE], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        const w = new Worker(url);
        w.onmessage = (e) => {
            const data = e.data;
            if (data.type === "progress") {
                // periodically refresh lock so other tabs don't take over
                refreshLock();
                return;
            }
            if (data.ok) {
                state.baked += 1;
                state.baking = null;
                submitCake(data);
                // bake next in queue
                bakeNext();
            }
        };
        w.onerror = (err) => {
            console.warn("[G4FCakeBaker] worker error", err);
            // fallback: retry after delay
            setTimeout(bakeNext, 5000);
        };
        return w;
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
                console.warn("[G4FCakeBaker] issue failed", res.status);
                return false;
            }
            const data = await res.json();
            if (data.difficulty) state.difficulty = data.difficulty;
            if (data.salt) state.salt = data.salt;
            if (data.uuids && data.uuids.length) {
                state.queue.push(...data.uuids);
            }
            return true;
        } catch (err) {
            console.warn("[G4FCakeBaker] issue error", err);
            return false;
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
                // notify UI
                window.dispatchEvent(new CustomEvent("g4f:cake:accepted", {
                    detail: { credit: data.credit, total: data.total_credits },
                }));
            } else if (data.rotate) {
                // salt rotated; re-fetch
                if (data.salt) state.salt = data.salt;
                if (data.difficulty) state.difficulty = data.difficulty;
            }
        } catch (err) {
            console.warn("[G4FCakeBaker] submit error", err);
        }
    }

    // Bake next UUID in queue --------------------------------------------
    function bakeNext() {
        if (!state.running) return;
        if (!state.worker) state.worker = createWorker();
        if (state.baking) return; // already baking
        if (state.queue.length === 0) {
            // refill after a delay
            if (!state.timer) {
                state.timer = setTimeout(async () => {
                    state.timer = null;
                    await fetchBatch();
                    bakeNext();
                }, POLL_INTERVAL_MS);
            }
            return;
        }
        const uuid = state.queue.shift();
        state.baking = uuid;
        state.worker.postMessage({
            uuid,
            salt: state.salt || "g4f-default-salt",
            difficulty: state.difficulty || 4,
        });
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
        if (state.worker) {
            state.worker.terminate();
            state.worker = null;
        }
        localStorage.removeItem(HEARTBEAT_KEY);
        saveState();
    }

    function status() {
        const saved = loadState();
        return {
            running: state.running,
            queue: state.queue.length,
            baking: state.baking,
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
    const path = window.location.pathname;
    const shouldAutoStart =
        path === "/chat" ||
        path === "/chat/" ||
        path === "/chat/index.html" ||
        path === "/members" ||
        path === "/members.html" ||
        path === "/members/";

    if (shouldAutoStart) {
        // wait for page load
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => setTimeout(start, 2000));
        } else {
            setTimeout(start, 2000);
        }
    }
})();