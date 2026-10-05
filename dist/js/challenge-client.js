/**
 * G4F Challenge Client — fast-track cakes via the local model
 *
 * Complements the proof-of-work cake baker: instead of grinding SHA-256
 * nonces, the browser solves small AI tasks (follow-up questions,
 * translations) with a local model — client.js's ChromeAI (built-in
 * Gemini Nano / Prompt API), falling back to the 1-bit Bonsai model on
 * WebGPU, then to a random network provider (LLM7, plus Kilo/OpenCode
 * on localhost) — and exchanges the encrypted result for a signed JWT
 * that is redeemed for cake credit — a much faster way to get the
 * first cakes.
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
 * When the user's own language is fully translated (/challenge/issue
 * answers "all_translated"), the loop moves on to the next language with
 * untranslated snippets — a donated round. Donated rounds deliberately
 * skip the local WebGPU model (Bonsai) and run on a network provider
 * (LLM7, plus Kilo/OpenCode on localhost) instead, so the visitor's GPU
 * is never spent on community work.
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
        language: null,    // donated language currently being translated
        donating: false,   // translating a language other than the user's own
    };

    // ---- AI request logging ---------------------------------------------

    // Ring buffer of local-model request/response events. client.js calls
    // logCallback({request}) before inference and logCallback({response})
    // after; Bonsai additionally emits {status, data} progress events.
    const AI_LOG_MAX = 20;
    const aiLog = [];
    function logAiEvent(event) {
        const entry = { at: new Date().toISOString(), ...event };
        aiLog.push(entry);
        if (aiLog.length > AI_LOG_MAX) aiLog.shift();
        try {
            if (event.request) {
                console.debug("%c[G4FChallenge] AI request →", "color:#6366f1;font-weight:bold", event.request);
            } else if (event.response) {
                console.debug("%c[G4FChallenge] AI response ←", "color:#22c55e;font-weight:bold", event.response);
            } else if (event.status) {
                console.debug(`[G4FChallenge] model ${event.status}:`, event.data || "");
            }
        } catch { /* logging must never break a round */ }
    }

    // ---- Local inference via client.js ----------------------------------

    // Cached client instances (module-level, survive stop/start): the
    // local-first client for the user's own language and a network-only
    // client for donated rounds (other languages, no WebGPU).
    let _client = null;
    let _clientPromise = null;
    let _networkClient = null;
    let _networkClientPromise = null;

    /** Network fallback providers. Kilo and OpenCode need a CORS proxy
     *  that is only guaranteed to work (free) on localhost — elsewhere
     *  (e.g. g4f.dev production) LLM7 is the only network option. */
    function isLocalhost() {
        return ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location?.hostname);
    }

    /** Load the client.js ES module: dynamic import first; when that fails
     *  (CSP, blocked module fetch, offline), fall back to the classes
     *  published on window — window.G4FClient (set by client.js itself) or
     *  the globals copied from providers.js's default export by the page. */
    async function loadClientModule() {
        const mod = window.G4FClient
            || (window.Client && window.ChromeAI && window);
        if (mod && mod.ChromeAI) return mod;
        try {
            return await import("./client.js");
        } catch (e) {
            console.warn("[G4FChallenge] dynamic import of client.js failed:", e);
            throw new Error("client.js unavailable (no window fallback)");
        }
    }

    /** Load the local chat client from client.js: ChromeAI (built-in
     *  Gemini Nano) first; if the Prompt API is unavailable (non-Chrome
     *  browsers), fall back to the 1-bit Bonsai model on WebGPU, then
     *  to a random network provider (LLM7, Kilo, OpenCode). */
    async function getClient() {
        if (_client) return _client;
        if (!_clientPromise) {
            _clientPromise = (async () => {
                // challenge-client.js is a classic script — load the ES
                // module dynamically (or grab the classes from window).
                const { ChromeAI, Bonsai, LLM7, Kilo, OpenCode } = await loadClientModule();
                if (window.self === window.top) {
                    if (await ChromeAI.isSupported()) {
                        return new ChromeAI({ logCallback: logAiEvent });
                    }
                    if (await Bonsai.isSupported()) {
                        console.info("[G4FChallenge] LanguageModel unavailable — falling back to Bonsai 1-bit (WebGPU)");
                        return new Bonsai({ logCallback: logAiEvent });
                    }
                }
                const network = [LLM7];
                if (isLocalhost()) network.push(Kilo, OpenCode);
                const ClientClass = network[Math.floor(Math.random() * network.length)];
                console.info(`[G4FChallenge] no local model — using network provider: ${ClientClass.name}`);
                return new ClientClass({ logCallback: logAiEvent });
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

    /** Network-only client for donated rounds (languages other than the
     *  user's own): deliberately skips the local models (ChromeAI and the
     *  1-bit Bonsai WebGPU engine) so the visitor's device never grinds
     *  community work — a network provider does the inference instead. */
    async function getNetworkClient() {
        if (_networkClient) return _networkClient;
        if (!_networkClientPromise) {
            _networkClientPromise = (async () => {
                const { LLM7, Kilo, OpenCode } = await loadClientModule();
                const network = [LLM7];
                if (isLocalhost()) network.push(Kilo, OpenCode);
                const ClientClass = network[Math.floor(Math.random() * network.length)];
                console.info(`[G4FChallenge] donated language — network provider instead of WebGPU: ${ClientClass.name}`);
                return new ClientClass({ logCallback: logAiEvent });
            })().catch((e) => {
                console.warn("[G4FChallenge] loading client.js failed:", e);
                _networkClientPromise = null; // allow retry on the next round
                return null;
            });
        }
        const client = await _networkClientPromise;
        if (client) _networkClient = client;
        return _networkClient;
    }

    /** Check whether any local model client is available. */
    async function isSupported() {
        try {
            return !!(await getClient());
        } catch {
            return false;
        }
    }

    /** Run a prompt through a client (OpenAI-style chat API). Donated
     *  rounds (languages other than the user's own) pass networkOnly to
     *  keep the local WebGPU model out of community work. */
    async function runPrompt(prompt, networkOnly = false) {
        const client = networkOnly ? await getNetworkClient() : await getClient();
        if (!client) throw new Error(networkOnly ? "no network provider available" : "no local model available");
        try {
            const response = await client.chat.completions.create({
                messages: [{ role: "user", content: prompt }],
            });
            return response.choices[0].message.content;
        } catch (e) {
            // Drop the cached client so the next round re-selects —
            // possibly a different random network provider.
            if (networkOnly) {
                _networkClient = null;
                _networkClientPromise = null;
            } else {
                _client = null;
                _clientPromise = null;
            }
            throw e;
        }
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

    /** Pick the next language to translate when the current one is done:
     *  the community store entry with the most untranslated texts,
     *  excluding the user's own language and everything already finished.
     *  Returns a base language code or null when nothing is left. */
    async function pickNextLanguage(userBase, exclude = []) {
        try {
            const res = await fetch(`${CHALLENGE_ENDPOINT}/translations/languages`);
            if (!res.ok) return null;
            const data = await res.json();
            const candidates = (data.languages || [])
                .filter((l) => l.language && l.language !== userBase && !exclude.includes(l.language))
                .filter((l) => l.remaining === undefined || l.remaining > 0);
            return candidates[0]?.language || null;
        } catch {
            return null;
        }
    }

    /** Run one challenge: issue → decrypt → inference → solve → redeem. */
    async function solveOnce() {
        const userLanguage = window.framework?.getLanguage?.() || navigator.language || "en";
        const userBase = userLanguage.split(/[-_]/)[0].toLowerCase();
        let language = state.language || userLanguage;
        let challenge = null;

        // 1. Issue (encrypted challenge). When a language comes back fully
        //    translated, move on to the next one with untranslated snippets —
        //    donated rounds run on a network provider, not the local WebGPU
        //    model (see runPrompt below).
        const exclude = [];
        for (let pick = 0; pick < 4; pick++) {
            const issueRes = await fetch(
                `${CHALLENGE_ENDPOINT}/issue?lang=${encodeURIComponent(language)}&kind=any`,
                { credentials: "include", headers: authHeaders() }
            );
            if (!issueRes.ok) {
                const err = await issueRes.json().catch(() => ({}));
                throw Object.assign(new Error(err.error || `issue failed: ${issueRes.status}`), { status: issueRes.status });
            }
            challenge = await issueRes.json();
            if (challenge.error !== "all_translated") break;
            const finished = language.split(/[-_]/)[0].toLowerCase();
            exclude.push(finished);
            console.info(`[G4FChallenge] "${finished}" is fully translated`);
            const next = await pickNextLanguage(userBase, exclude);
            if (!next) {
                state.language = null;
                state.donating = false;
                throw Object.assign(new Error("all_translated"), { allTranslated: true });
            }
            state.language = next;
            state.donating = true;
            language = next;
            console.info(`[G4FChallenge] continuing with "${next}" — donated rounds use a network provider, not the local WebGPU model`);
        }
        if (!challenge || challenge.error === "all_translated") {
            throw Object.assign(new Error("all_translated"), { allTranslated: true });
        }
        const challengeBase = (challenge.language || language || "en").split(/[-_]/)[0].toLowerCase();
        const donating = challengeBase !== userBase;

        // 2. Decrypt locally — the plaintext task never touched the client
        //    side of the wire unencrypted.
        const secret = window.G4F_CHALLENGE_SECRET || challenge.keySalt;
        if (!secret) throw new Error("no challenge secret available");
        const payload = await unsealPayload(secret, challenge.ciphertext, challenge.iv);

        // 3. Run the prompt through the model (client.js) — the local model
        //    for the user's own language, a network provider for donated
        //    rounds. Batch "translations" challenges carry the items inline
        //    — the prompt lists each snippet with its section headline as
        //    context.
        let prompt = payload.prompt;
        console.debug("[G4FChallenge] challenge payload:", payload);
        const raw = await runPrompt(prompt, donating);
        console.debug("[G4FChallenge] raw model output:", raw);
        const answer = parseJsonLoose(raw);
        if (!answer) throw new Error("local model returned no JSON");

        // 4. Seal the answer and submit. Only transient failures (network
        //    errors, 5xx) are retried with the same sealed submission — the
        //    model's translations should not be lost to a blip. Definitive
        //    rejections (4xx) are never retried: the worker burns the
        //    challenge on the first solve attempt, so resubmitting the same
        //    id can only return challenge_not_found_or_expired.
        const sealed = await sealPayload(secret, answer);
        const SOLVE_ATTEMPTS = 5;
        let solveRes, solveData;
        for (let attempt = 1; attempt <= SOLVE_ATTEMPTS; attempt++) {
            try {
                solveRes = await fetch(`${CHALLENGE_ENDPOINT}/solve`, {
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
            } catch (err) {
                if (attempt < SOLVE_ATTEMPTS) {
                    console.warn(`[G4FChallenge] solve attempt ${attempt}/${SOLVE_ATTEMPTS} network error; retrying the same translations`);
                    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
                    continue;
                }
                throw err;
            }
            solveData = await solveRes.json().catch(() => ({}));
            if (solveRes.ok && solveData.ok) break;
            if (solveRes.status >= 500 && attempt < SOLVE_ATTEMPTS) {
                console.warn(`[G4FChallenge] solve attempt ${attempt}/${SOLVE_ATTEMPTS} failed (${solveData.error || solveRes.status}); retrying the same translations`);
                await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
                continue;
            }
            break; // 4xx or retries exhausted — definitive
        }
        if (!solveRes.ok || !solveData.ok) {
            // duplicate_answer: this exact answer was already credited today
            // and its translations were persisted on that first submission —
            // the work is done, so treat the round as complete instead of
            // failing it (a retry could never succeed anyway).
            if (solveData.error === "duplicate_answer") {
                console.info("[G4FChallenge] answer already credited today; translations were kept");
                return null;
            }
            throw Object.assign(new Error(solveData.error || `solve failed: ${solveRes.status}`), { status: solveRes.status });
        }

        if (!solveData.token) {
            console.error("[G4FChallenge] solve succeeded but no token was returned");
            return null;
        }

        // 5. Exchange the JWT for cake credit — only transient failures
        //    (network errors, 5xx) are retried; 4xx is definitive.
        const REDEEM_ATTEMPTS = 5;
        let redeemRes, redeemData;
        for (let attempt = 1; attempt <= REDEEM_ATTEMPTS; attempt++) {
            try {
                redeemRes = await fetch(`${CAKE_ENDPOINT}/redeem`, {
                    method: "POST",
                    credentials: "include",
                    headers: authHeaders({ "Content-Type": "application/json" }),
                    body: JSON.stringify({ token: solveData.token }),
                });
            } catch (err) {
                if (attempt < REDEEM_ATTEMPTS) {
                    console.warn(`[G4FChallenge] redeem attempt ${attempt}/${REDEEM_ATTEMPTS} network error; retrying`);
                    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
                    continue;
                }
                throw err;
            }
            redeemData = await redeemRes.json().catch(() => ({}));
            if (redeemRes.ok && redeemData.ok) break;
            if (redeemRes.status >= 500 && attempt < REDEEM_ATTEMPTS) {
                console.warn(`[G4FChallenge] redeem attempt ${attempt}/${REDEEM_ATTEMPTS} failed (${redeemData.error || redeemRes.status}); retrying`);
                await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
                continue;
            }
            break; // 4xx or retries exhausted — definitive
        }
        if (!redeemRes.ok || !redeemData.ok) {
            throw Object.assign(new Error(redeemData.error || `redeem failed: ${redeemRes.status}`), { status: redeemRes.status });
        }

        state.solved += 1;
        state.credits += redeemData.credit_cents || challenge.credit_cents || 5;
        console.info(
            "%c[G4FChallenge] solved%c kind=" + payload.kind +
            (donating ? ` lang=${challengeBase} (donated)` : "") +
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
            if (err.allTranslated) {
                // Every language (own + donated) is fully translated.
                console.info("[G4FChallenge] every language fully translated; stopping");
                stop();
                return;
            }
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
        // Free per-session resources but keep the clients cached: ChromeAI
        // destroys its Gemini Nano session, Bonsai only drops the KV cache
        // (the downloaded model stays warm for the next start).
        try { _client?.reset?.(); } catch { /* noop */ }
        try { _networkClient?.reset?.(); } catch { /* noop */ }
    }

    function status() {
        return {
            running: state.running,
            rounds: state.rounds,
            solved: state.solved,
            failed: state.failed,
            credits: state.credits,
            language: state.language,
            donating: state.donating,
        };
    }

    /** Last AI request/response events (debugging, e.g. in the console). */
    function getLog() {
        return aiLog.map((entry) => ({ ...entry }));
    }

    window.G4FChallenge = { start, stop, status, solveOnce, isSupported, getLog };

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
