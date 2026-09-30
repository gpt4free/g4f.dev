/**
 * G4F Challenge Client — fast-track cakes via the local model
 *
 * Complements the proof-of-work cake baker: instead of grinding SHA-256
 * nonces, the browser solves small AI tasks (follow-up questions,
 * translations) with a local model — client.js's ChromeAI (built-in
 * Gemini Nano / Prompt API), falling back to the 1-bit Bonsai model on
 * WebGPU — and exchanges the encrypted result for a signed JWT that is
 * redeemed for cake credit — a much faster way to get the first cakes.
 *
 * Flow (all challenge payloads travel encrypted, AES-GCM):
 *   1. GET  /challenge/issue?lang=<navigator.language>&kind=...
 *   2. Decrypt the sealed task locally, run it through the local model
 *      (client.js: ChromeAI / Gemini Nano, fallback Bonsai 1-bit WebGPU)
 *   3. POST /challenge/solve { id, ciphertext, iv }  → { token }
 *   4. POST /challenge/redeem { token }              → cake credit
 *
 * The module exposes window.G4FChallenge:
 *   - start() / stop() / status()
 *   - solveOnce() — single challenge round (debug)
 *
 * Auto-runs on chat/members pages when a local model is available; it
 * never sends plaintext tasks or answers over the wire.
 */
(function () {
    "use strict";

    // Configuration -------------------------------------------------------
    const CHALLENGE_ENDPOINT = "https://beta.g4f.dev/challenge"; // same-origin via route
    const CAKE_ENDPOINT = "https://g4f.space/cake"; // same-origin via route
    const POLL_INTERVAL_MS = 5000;   // wait between challenge rounds
    const MAX_ROUNDS_PER_SESSION = 50;
    const STORAGE_KEY = "g4f_challenge_client";

    // Safe storage wrappers (private-mode safe, mirrors cake-baker.js).
    const memoryStore = new Map();
    function storageGet(key) {
        try { return localStorage.getItem(key); } catch { return memoryStore.has(key) ? memoryStore.get(key) : null; }
    }
    function storageSet(key, value) {
        try { localStorage.setItem(key, value); } catch { memoryStore.set(key, value); }
    }

    const state = {
        running: false,
        rounds: 0,
        solved: 0,
        failed: 0,
        credits: 0,        // cents credited this session
        timer: null,
    };

    // ---- Local inference via client.js ----------------------------------

    // Cached client instance (module-level, survives stop/start).
    let _client = null;
    let _clientPromise = null;

    /** Load the local chat client from client.js: ChromeAI (built-in
     *  Gemini Nano) first; if the Prompt API is unavailable (non-Chrome
     *  browsers), fall back to the 1-bit Bonsai model on WebGPU. */
    async function getClient() {
        if (_client) return _client;
        if (!_clientPromise) {
            _clientPromise = (async () => {
                // challenge-client.js is a classic script — load the ES
                // module dynamically.
                const { ChromeAI, Bonsai } = await import("./client.js");
                if (await ChromeAI.isSupported()) {
                    return new ChromeAI({ logCallback: () => {} });
                }
                if (await Bonsai.isSupported()) {
                    console.info("[G4FChallenge] LanguageModel unavailable — falling back to Bonsai 1-bit (WebGPU)");
                    return new Bonsai({ logCallback: () => {} });
                }
                return null;
            })().catch((e) => {
                console.warn("[G4FChallenge] loading client.js failed:", e);
                _clientPromise = null; // allow retry on the next round
                return null;
            });
        }
        const client = await _clientPromise;
        if (client) _client = client;
        return _client;
    }

    /** Check whether any local model client is available. */
    async function isSupported() {
        try {
            return !!(await getClient());
        } catch {
            return false;
        }
    }

    /** Run a prompt through the local client (OpenAI-style chat API). */
    async function runPrompt(prompt) {
        const client = await getClient();
        if (!client) throw new Error("no local model available");
        const response = await client.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
        });
        return response.choices[0].message.content;
    }

    // ---- Crypto helpers (mirror the worker's AES-GCM sealing) -----------

    function toBase64Url(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    function fromBase64Url(text) {
        const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
        const padding = "=".repeat((4 - (base64.length % 4)) % 4);
        const binary = atob(base64 + padding);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    /** Decrypt the server-sealed challenge payload (AES-GCM). The key is
     *  derived exactly like the worker's: SHA-256 over the shared secret.
     *  The secret is fetched from the issue response's `keySalt` field when
     *  present, otherwise the deployment's public challenge secret is
     *  embedded at build time via window.G4F_CHALLENGE_SECRET. */
    async function unsealPayload(secret, ciphertext, iv) {
        const raw = fromBase64Url(secret);
        const digest = await crypto.subtle.digest("SHA-256", raw.length === 32 ? raw : new TextEncoder().encode(secret));
        const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
        const plaintext = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: fromBase64Url(iv) },
            key,
            fromBase64Url(ciphertext)
        );
        return JSON.parse(new TextDecoder().decode(plaintext));
    }

    /** Encrypt the answer payload back to the server (AES-GCM, fresh IV). */
    async function sealPayload(secret, payload) {
        const raw = fromBase64Url(secret);
        const digest = await crypto.subtle.digest("SHA-256", raw.length === 32 ? raw : new TextEncoder().encode(secret));
        const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            key,
            new TextEncoder().encode(JSON.stringify(payload))
        );
        return { ciphertext: toBase64Url(ciphertext), iv: toBase64Url(iv) };
    }

    // ---- Challenge round -------------------------------------------------

    function authHeaders(extra = {}) {
        const headers = { ...extra };
        const token = storageGet("g4f_session") || storageGet("g4f_token") || storageGet("jwt");
        if (token) headers["Authorization"] = `Bearer ${token}`;
        return headers;
    }

    /** Extract the first JSON object from a model response (handles code fences). */
    function parseJsonLoose(text) {
        if (!text) return null;
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        const candidate = fenced ? fenced[1] : text;
        try {
            return JSON.parse(candidate.trim());
        } catch {
            const start = candidate.indexOf("{");
            const end = candidate.lastIndexOf("}");
            if (start !== -1 && end > start) {
                try { return JSON.parse(candidate.slice(start, end + 1)); } catch { /* fall through */ }
            }
        }
        return null;
    }

    /** Run one challenge: issue → decrypt → local inference → solve → redeem. */
    async function solveOnce() {
        const language = navigator.language || "en";
        // 1. Issue (encrypted challenge).
        const issueRes = await fetch(
            `${CHALLENGE_ENDPOINT}/issue?lang=${encodeURIComponent(language)}&kind=any`,
            { credentials: "include", headers: authHeaders() }
        );
        if (!issueRes.ok) {
            const err = await issueRes.json().catch(() => ({}));
            throw Object.assign(new Error(err.error || `issue failed: ${issueRes.status}`), { status: issueRes.status });
        }
        const challenge = await issueRes.json();

        // 2. Decrypt locally — the plaintext task never touched the client
        //    side of the wire unencrypted.
        const secret = window.G4F_CHALLENGE_SECRET || challenge.keySalt;
        if (!secret) throw new Error("no challenge secret available");
        const payload = await unsealPayload(secret, challenge.ciphertext, challenge.iv);

        // 3. Run the prompt through the local model (client.js). Batch
        //    "translations" challenges carry the items inline — build the
        //    prompt from them so the model sees each snippet with its
        //    section headline as context.
        let prompt = payload.prompt;
        const raw = await runPrompt(prompt);
        const answer = parseJsonLoose(raw);
        if (!answer) throw new Error("local model returned no JSON");

        // 4. Seal the answer and submit.
        const sealed = await sealPayload(secret, answer);
        const solveRes = await fetch(`${CHALLENGE_ENDPOINT}/solve`, {
            method: "POST",
            credentials: "include",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
                id: challenge.id,
                ciphertext: sealed.ciphertext,
                iv: sealed.iv,
                language,
            }),
        });
        const solveData = await solveRes.json().catch(() => ({}));
        if (!solveRes.ok || !solveData.ok) {
            throw Object.assign(new Error(solveData.error || `solve failed: ${solveRes.status}`), { status: solveRes.status });
        }

        // 5. Exchange the JWT for cake credit.
        const redeemRes = await fetch(`${CAKE_ENDPOINT}/redeem`, {
            method: "POST",
            credentials: "include",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ token: solveData.token }),
        });
        const redeemData = await redeemRes.json().catch(() => ({}));
        if (!redeemRes.ok || !redeemData.ok) {
            throw Object.assign(new Error(redeemData.error || `redeem failed: ${redeemRes.status}`), { status: redeemRes.status });
        }

        // 5b. Batch "translations" challenges: donate the translated UI
        //     snippets to the community store (POST /challenge/translations).
        //     The solve-JWT is attached so the submission is credited.
        if (payload.kind === "translations" && answer.translations && typeof answer.translations === "object") {
            try {
                await fetch(`${CHALLENGE_ENDPOINT}/translations`, {
                    method: "POST",
                    credentials: "include",
                    headers: authHeaders({ "Content-Type": "application/json" }),
                    body: JSON.stringify({
                        token: solveData.token,
                        language,
                        translations: answer.translations,
                    }),
                });
            } catch (e) {
                console.warn("[G4FChallenge] translation donation failed:", e);
            }
        }

        state.solved += 1;
        state.credits += redeemData.credit_cents || challenge.credit_cents || 5;
        console.info(
            "%c[G4FChallenge] solved%c kind=" + payload.kind +
            " credit=" + (redeemData.credit_cents || "?") +
            "¢ total=" + (redeemData.total_credits ?? "?") + "¢",
            "color:#22c55e;font-weight:bold", "color:inherit"
        );
        // Notify the credits UI (same event the cake baker dispatches).
        window.dispatchEvent(new CustomEvent("g4f:cake:accepted", {
            detail: {
                credit: redeemData.credit_cents,
                total: redeemData.total_credits,
                baked_today: solveData.solved_today,
            },
        }));
        return redeemData;
    }

    // ---- Loop control -----------------------------------------------------

    function scheduleNext() {
        if (!state.running) return;
        if (state.rounds >= MAX_ROUNDS_PER_SESSION) {
            console.info("[G4FChallenge] session round cap reached; stopping");
            stop();
            return;
        }
        state.timer = setTimeout(runLoop, POLL_INTERVAL_MS);
    }

    async function runLoop() {
        if (!state.running) return;
        state.rounds += 1;
        try {
            await solveOnce();
            state.consecutiveFailures = 0;
        } catch (err) {
            state.failed += 1;
            state.consecutiveFailures = (state.consecutiveFailures || 0) + 1;
            if (err.status === 429) {
                // Daily limit — stop for this session.
                console.info("[G4FChallenge] daily limit reached; stopping");
                stop();
                return;
            }
            console.warn("[G4FChallenge] round failed:", err.message);
            if (state.consecutiveFailures >= 3) {
                console.warn("[G4FChallenge] 3 consecutive failures; stopping — fix the cause and reload to retry");
                stop();
                return;
            }
        }
        scheduleNext();
    }

    function start() {
        if (state.running) return;
        state.running = true;
        console.info("[G4FChallenge] started — solving challenges for fast cakes");
        runLoop();
    }

    function stop() {
        state.running = false;
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
        // Free per-session resources but keep the client cached: ChromeAI
        // destroys its Gemini Nano session, Bonsai only drops the KV cache
        // (the downloaded model stays warm for the next start).
        try { _client?.reset?.(); } catch { /* noop */ }
    }

    function status() {
        return {
            running: state.running,
            rounds: state.rounds,
            solved: state.solved,
            failed: state.failed,
            credits: state.credits,
        };
    }

    window.G4FChallenge = { start, stop, status, solveOnce, isSupported };

    // Auto-start on chat and members pages when the Prompt API exists.
    const path = window.location.pathname;
    const host = window.location.hostname;
    const isLocalDev = host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
    const pathMatch =
        path.startsWith("/chat/") ||
        path.startsWith("/playground/") ||
        path === "/members" ||
        path === "/members.html";
    const rootMatch = isLocalDev && (path === "/" || path === "/index.html");
    const featureMatch = !!(
        document.querySelector("main.chat-container") ||
        document.querySelector("main.main-container") ||
        document.getElementById("chatBody") ||
        document.getElementById("statCredits") ||
        document.getElementById("app-content")
    );
    const optedOut = document.body && document.body.dataset.challengeClient === "off";

    if (!optedOut && (pathMatch || rootMatch || featureMatch)) {
        const boot = async () => {
            if (await isSupported()) {
                start();
            } else {
                console.info("[G4FChallenge] no local model (LanguageModel / Bonsai WebGPU) — cake baker handles credits");
            }
        };
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 3000));
        } else {
            setTimeout(boot, 3000);
        }
    }
})();
