/**
 * Headless smoke test for the challenge worker + client crypto round-trip.
 * The challenge worker's /challenge/redeem proxies to the cake worker's
 * /cake/redeem, so both workers are loaded here and wired together.
 * Run: node dist/js/challenge-client.smoke.test.cjs
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ---- Web-API shims (Node 18+) --------------------------------------------
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes) {
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return Buffer.from(binary, "binary").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(text) {
    const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
    return new Uint8Array(Buffer.from(base64, "base64"));
}

const b64Polyfill = {
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
    fetch: globalThis.fetch,
    console,
    URL,
    Response: class {
        constructor(body, init = {}) {
            this.body = body;
            this.status = init.status || 200;
            this.headers = new Map(Object.entries(init.headers || {}));
        }
        get ok() { return this.status >= 200 && this.status < 300; }
        async json() { return JSON.parse(this.body); }
    },
    Request: class {
        constructor(url, init = {}) {
            this.url = url;
            this.method = init.method || "GET";
            this.headers = new Map(Object.entries(init.headers || {}));
            this._body = init.body || null;
            this.cf = {};
        }
        async json() { return JSON.parse(this._body); }
    },
};

// ---- In-memory KV ----------------------------------------------------------
function makeKv() {
    const store = new Map();
    return {
        store,
        async get(key) { return store.has(key) ? store.get(key) : null; },
        async put(key, value) { store.set(key, String(value)); },
        async delete(key) { store.delete(key); },
        async list() { return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true }; },
    };
}

// ---- Load the workers ------------------------------------------------------
function loadWorker(relPath, sandbox) {
    let source = fs.readFileSync(path.join(__dirname, relPath), "utf8");
    // Strip the ESM export for CommonJS evaluation.
    source = source.replace(/export default \{/, "var worker = {");
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox.worker;
}

// The cake worker owns the ledger; both workers share one KV instance so the
// replay markers and cakes:credit keys line up exactly like in production.
const sharedKv = makeKv();
const cakeEnv = {
    CAKE_KV: sharedKv,
    CHALLENGE_JWT_SECRET: "test-jwt-secret",
};
const cakeWorker = loadWorker("../../workers/cake-worker.js", {
    ...b64Polyfill,
    caches: { default: { match: async () => undefined, put: async () => {} } },
});

const challengeSandbox = {
    ...b64Polyfill,
    navigator: { language: "de-DE" },
    // Route the challenge worker's CAKE_WORKER_URL fetch to the cake worker
    // and its SNIPPETS_URL fetch to the local snippet catalog.
    fetch: (url, init) => {
        const req = new b64Polyfill.Request(url, init);
        if (String(url).includes("/dist/js/snippets/")) {
            const name = String(url).split("/dist/js/snippets/")[1].split(/[?#]/)[0];
            const catalog = fs.readFileSync(path.join(__dirname, "snippets", name), "utf8");
            return new b64Polyfill.Response(catalog, { status: 200 });
        }
        return cakeWorker.fetch(req, cakeEnv, {});
    },
};
const worker = loadWorker("../../workers/challenge-worker.js", challengeSandbox);

// Separate contextified sandbox for the client crypto round-trip.
const clientSandbox = { ...b64Polyfill };
vm.createContext(clientSandbox);

const env = {
    CAKE_KV: sharedKv,
    CHALLENGE_SECRET: "test-secret-passphrase",
    CHALLENGE_JWT_SECRET: "test-jwt-secret",
    CAKE_CREDIT_CENTS: "5",
    CHALLENGE_TTL_SEC: "300",
    CAKE_WORKER_URL: "https://cake.test/cake",
};

function makeRequest(url, method = "GET", body = null) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    return new b64Polyfill.Request(url, { method, body: body ? JSON.stringify(body) : undefined, headers });
}

// ---- Tests ------------------------------------------------------------------
let passed = 0;
let failed = 0;
function check(name, cond) {
    if (cond) { passed++; console.log(`  ok - ${name}`); }
    else { failed++; console.error(`  FAIL - ${name}`); }
}

(async () => {
    console.log("challenge-worker smoke test");

    // Missing KV binding must degrade to a JSON 503, not crash the function.
    const envNoKv = { ...env, CAKE_KV: undefined };
    let res = await worker.fetch(makeRequest("https://g4f.dev/challenge/issue?lang=de-DE"), envNoKv, {});
    check("missing KV returns 503", res.status === 503);
    const noKvBody = await res.json();
    check("missing KV error is kv_unavailable", noKvBody.error === "kv_unavailable");

    // Health
    res = await worker.fetch(makeRequest("https://g4f.dev/challenge/health"), env, {});
    check("health returns ok", res.status === 200);

    // Issue (encrypted challenge) — pinned to followup so the answer shape
    // below is deterministic regardless of the kind=any rotation.
    res = await worker.fetch(makeRequest("https://g4f.dev/challenge/issue?lang=de-DE&kind=followup"), env, {});
    check("issue returns 200", res.status === 200);
    const challenge = await res.json();
    check("issue has id", typeof challenge.id === "string" && challenge.id.length > 0);
    check("issue has ciphertext", typeof challenge.ciphertext === "string" && challenge.ciphertext.length > 0);
    check("issue has iv", typeof challenge.iv === "string" && challenge.iv.length > 0);
    check("issue kind is followup", challenge.kind === "followup");
    check("issue includes keySalt for client decrypt", typeof challenge.keySalt === "string" && challenge.keySalt.length > 0);

    // The plaintext task must NOT be in the response body.
    const rawBody = JSON.stringify(challenge);
    check("no plaintext prompt leaks", !rawBody.includes("Translate") && !rawBody.includes("follow-up questions about"));

    // Client-side: decrypt the challenge (same code path as challenge-client.js).
    const clientSrc = fs.readFileSync(path.join(__dirname, "challenge-client.js"), "utf8");
    const unsealMatch = clientSrc.match(/async function unsealPayload[\s\S]*?\n    \}/);
    check("client has unsealPayload", !!unsealMatch);
    const sealMatch = clientSrc.match(/async function sealPayload[\s\S]*?\n    \}/);
    check("client has sealPayload", !!sealMatch);
    const fromBase64UrlMatch = clientSrc.match(/function fromBase64Url[\s\S]*?\n    \}/);
    check("client has fromBase64Url", !!fromBase64UrlMatch);
    const toBase64UrlMatch = clientSrc.match(/function toBase64Url[\s\S]*?\n    \}/);
    check("client has toBase64Url", !!toBase64UrlMatch);
    const clientCrypto = vm.runInContext(
        `${fromBase64UrlMatch[0]}\n${toBase64UrlMatch[0]}\n(async () => {\n${unsealMatch[0]}\n${sealMatch[0]}\n` +
        `  const secret = ${JSON.stringify(env.CHALLENGE_SECRET)};\n` +
        `  const payload = await unsealPayload(secret, ${JSON.stringify(challenge.ciphertext)}, ${JSON.stringify(challenge.iv)});\n` +
        `  return { payload, seal: (a) => sealPayload(secret, a) };\n` +
        `})()`,
        clientSandbox
    );
    const { payload } = await clientCrypto;
    check("client decrypted the challenge", payload && typeof payload.prompt === "string");
    check("decrypted kind matches hint", payload.kind === challenge.kind);

    // Solve with a valid answer (encrypted by the client-side seal function).
    const sealFn = await clientCrypto.then((c) => c.seal);
    const answer = payload.kind === "translation"
        ? { text: "Fuchs" + "x".repeat(20) }
        : { q: ["Wie geht das?", "Was kostet das?", "Wann beginnt das?"] };
    const sealedAnswer = await sealFn(answer);
    res = await worker.fetch(
        makeRequest("https://g4f.dev/challenge/solve", "POST", {
            id: challenge.id, ciphertext: sealedAnswer.ciphertext, iv: sealedAnswer.iv, language: "de-DE",
        }),
        env, {}
    );
    check("solve returns 200", res.status === 200);
    const solveData = await res.json();
    check("solve returns token", typeof solveData.token === "string" && solveData.token.split(".").length === 3);
    check("solve returns credit", solveData.credit_cents === 5);

    // Replay: the challenge is burned after solving.
    res = await worker.fetch(
        makeRequest("https://g4f.dev/challenge/solve", "POST", {
            id: challenge.id, ciphertext: sealedAnswer.ciphertext, iv: sealedAnswer.iv, language: "de-DE",
        }),
        env, {}
    );
    check("replayed challenge rejected", res.status === 403);

    // Redeem the JWT for cake credit.
    res = await worker.fetch(makeRequest("https://g4f.dev/challenge/redeem", "POST", { token: solveData.token }), env, {});
    check("redeem returns 200", res.status === 200);
    const redeemData = await res.json();
    check("redeem credits the cake ledger", redeemData.total_credits === 5);
    check("credit lands in CAKE_KV", env.CAKE_KV.store.get("cakes:credit:0.0.0.0") === "5");

    // Double-redeem is rejected.
    res = await worker.fetch(makeRequest("https://g4f.dev/challenge/redeem", "POST", { token: solveData.token }), env, {});
    check("double redeem rejected", res.status === 409);

    // Tampered token is rejected.
    res = await worker.fetch(
        makeRequest("https://g4f.dev/challenge/redeem", "POST", { token: solveData.token.slice(0, -2) + "xx" }),
        env, {}
    );
    check("tampered token rejected", res.status === 401);

    // ---- Community follow-ups pool (fed by the solved followup challenge) ----
    console.log("\nchallenge-worker /challenge/followups smoke test");
    res = await worker.fetch(makeRequest("https://g4f.dev/challenge/followups?lang=de-DE"), env, {});
    check("followups returns 200", res.status === 200);
    const followups = await res.json();
    check("followups has q array", Array.isArray(followups.q) && followups.q.length > 0);
    check("followups come from the solved challenge", followups.q.every(
        (q) => ["Wie geht das?", "Was kostet das?", "Wann beginnt das?"].includes(q)
    ));
    res = await worker.fetch(makeRequest("https://g4f.dev/challenge/followups?lang=de-DE&count=2"), env, {});
    check("followups count param respected", (await res.json()).q.length === 2);
    res = await worker.fetch(makeRequest("https://g4f.dev/challenge/followups?lang=fr"), env, {});
    check("empty followups pool returns 404", res.status === 404);

    // Invalid answer shape is rejected.
    res = await worker.fetch(makeRequest("https://g4f.dev/challenge/issue?lang=de-DE&kind=followup"), env, {});
    const c2 = await res.json();
    const badSealed = await sealFn({ q: "not an array" });
    res = await worker.fetch(
        makeRequest("https://g4f.dev/challenge/solve", "POST", {
            id: c2.id, ciphertext: badSealed.ciphertext, iv: badSealed.iv, language: "de-DE",
        }),
        env, {}
    );
    check("invalid answer rejected", res.status === 400);

    // Status reflects the solved challenge.
    res = await worker.fetch(makeRequest("https://g4f.dev/challenge/status"), env, {});
    const statusData = await res.json();
    check("status shows solved_today", statusData.solved_today === 1);
    check("status shows credit", statusData.credit_cents === 5);

    // ---- Direct redemption on the cake worker (the ledger owner) ----
    console.log("\ncake-worker /cake/redeem smoke test");
    res = await worker.fetch(makeRequest("https://g4f.dev/challenge/issue?lang=de-DE&kind=translation"), env, {});
    const c3 = await res.json();
    const payload3 = await vm.runInContext(
        `${fromBase64UrlMatch[0]}\n${toBase64UrlMatch[0]}\n(async () => {\n${unsealMatch[0]}\n` +
        `  return unsealPayload(${JSON.stringify(env.CHALLENGE_SECRET)}, ${JSON.stringify(c3.ciphertext)}, ${JSON.stringify(c3.iv)});\n})()`,
        clientSandbox
    );
    check("second challenge decrypted", payload3 && typeof payload3.prompt === "string");
    const sealed3 = await sealFn({ text: "Fuchs" + "x".repeat(20) });
    res = await worker.fetch(
        makeRequest("https://g4f.dev/challenge/solve", "POST", {
            id: c3.id, ciphertext: sealed3.ciphertext, iv: sealed3.iv, language: "de-DE",
        }),
        env, {}
    );
    check("second solve returns 200", res.status === 200);
    const token3 = (await res.json()).token;

    res = await cakeWorker.fetch(
        makeRequest("https://g4f.space/cake/redeem", "POST", { token: token3 }),
        cakeEnv, {}
    );
    check("direct /cake/redeem returns 200", res.status === 200);
    const directRedeem = await res.json();
    check("direct redeem credits ledger", directRedeem.total_credits === 10);
    check("direct redeem updates user index", (() => {
        const entry = JSON.parse(env.CAKE_KV.store.get("cakes:user_index:0.0.0.0"));
        // The proxy redeem earlier in the run shares this KV, so both count.
        return entry.total === 2 && entry.today === 2;
    })());

    res = await cakeWorker.fetch(
        makeRequest("https://g4f.space/cake/redeem", "POST", { token: token3 }),
        cakeEnv, {}
    );
    check("direct double redeem rejected", res.status === 409);

    res = await cakeWorker.fetch(
        makeRequest("https://g4f.space/cake/redeem", "POST", { token: token3.slice(0, -2) + "xx" }),
        cakeEnv, {}
    );
    check("direct tampered token rejected", res.status === 401);

    // ---- Batch "translations" challenges (UI snippets + headline context) ----
    console.log("\nchallenge-worker translations batch smoke test");
    res = await worker.fetch(makeRequest("https://g4f.dev/challenge/issue?lang=de-DE&kind=translations"), env, {});
    check("translations issue returns 200", res.status === 200);
    const batchChallenge = await res.json();
    check("translations challenge sealed", typeof batchChallenge.ciphertext === "string" && batchChallenge.ciphertext.length > 0);

    const batchPayload = await vm.runInContext(
        `${fromBase64UrlMatch[0]}\n${toBase64UrlMatch[0]}\n(async () => {\n${unsealMatch[0]}\n` +
        `  return unsealPayload(${JSON.stringify(env.CHALLENGE_SECRET)}, ${JSON.stringify(batchChallenge.ciphertext)}, ${JSON.stringify(batchChallenge.iv)});\n})()`,
        clientSandbox
    );
    check("batch payload has items", Array.isArray(batchPayload.items) && batchPayload.items.length > 1);
    check("batch items are strings led by the headline", batchPayload.items.every((item) => typeof item === "string" && item.trim()));
    check("batch prompt asks for translations map", batchPayload.prompt.includes("translations"));

    const batchAnswer = { translations: {} };
    batchPayload.items.forEach((text) => { batchAnswer.translations[text] = "DE: " + text; });
    const sealedBatch = await sealFn(batchAnswer);
    res = await worker.fetch(
        makeRequest("https://g4f.dev/challenge/solve", "POST", {
            id: batchChallenge.id, ciphertext: sealedBatch.ciphertext, iv: sealedBatch.iv, language: "de-DE",
        }),
        env, {}
    );
    check("batch solve returns 200", res.status === 200);

    // Solving a translations challenge feeds the community store directly —
    // no separate submit endpoint.
    res = await worker.fetch(makeRequest("https://g4f.dev/challenge/translations?lang=de-DE"), env, {});
    check("translations get returns 200", res.status === 200);
    const served = await res.json();
    check("solved batch stored", served.translations[batchPayload.items[0]] === "DE: " + batchPayload.items[0]);
    check("served translations count matches", served.count === batchPayload.items.length);

    // Untranslated source must be skipped on the next batch issue.
    res = await worker.fetch(makeRequest("https://g4f.dev/challenge/issue?lang=de-DE&kind=translations"), env, {});
    const batch2 = await res.json();
    if (batch2.ciphertext) {
        const payload2 = await vm.runInContext(
            `${fromBase64UrlMatch[0]}\n${toBase64UrlMatch[0]}\n(async () => {\n${unsealMatch[0]}\n` +
            `  return unsealPayload(${JSON.stringify(env.CHALLENGE_SECRET)}, ${JSON.stringify(batch2.ciphertext)}, ${JSON.stringify(batch2.iv)});\n})()`,
            clientSandbox
        );
        check("next batch skips translated snippets", payload2.items.every((text) => !batchAnswer.translations[text]));
    } else {
        check("next batch reports all_translated", batch2.error === "all_translated");
    }

    res = await worker.fetch(makeRequest("https://g4f.dev/challenge/translations?lang=en"), env, {});
    check("english store rejected", res.status === 400);

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
