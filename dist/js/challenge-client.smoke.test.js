/**
 * Headless smoke test for the challenge worker + client crypto round-trip.
 * Run: node g4f.dev/dist/js/challenge-client.smoke.test.js
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

// ---- Load the worker --------------------------------------------------------
const workerPath = path.join(__dirname, "..", "..", "workers", "challenge-worker.js");
let workerSource = fs.readFileSync(workerPath, "utf8");
// Strip the ESM export for CommonJS evaluation.
workerSource = workerSource.replace(/export default \{/, "var worker = {");

const sandbox = { ...b64Polyfill, navigator: { language: "de-DE" } };
vm.createContext(sandbox);
vm.runInContext(workerSource, sandbox);
const worker = sandbox.worker;

const env = {
    CAKE_KV: makeKv(),
    CHALLENGE_SECRET: "test-secret-passphrase",
    CHALLENGE_JWT_SECRET: "test-jwt-secret",
    CAKE_CREDIT_CENTS: "5",
    CHALLENGE_TTL_SEC: "300",
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

    // Health
    let res = await worker.fetch(makeRequest("https://g4f.dev/challenge/health"), env, {});
    check("health returns ok", res.status === 200);

    // Issue (encrypted challenge)
    res = await worker.fetch(makeRequest("https://g4f.dev/challenge/issue?lang=de-DE"), env, {});
    check("issue returns 200", res.status === 200);
    const challenge = await res.json();
    check("issue has id", typeof challenge.id === "string" && challenge.id.length > 0);
    check("issue has ciphertext", typeof challenge.ciphertext === "string" && challenge.ciphertext.length > 0);
    check("issue has iv", typeof challenge.iv === "string" && challenge.iv.length > 0);
    check("issue kind is followup or translation", ["followup", "translation"].includes(challenge.kind));

    // The plaintext task must NOT be in the response body.
    const rawBody = JSON.stringify(challenge);
    check("no plaintext prompt leaks", !rawBody.includes("Translate") && !rawBody.includes("follow-up questions about"));

    // Client-side: decrypt the challenge (same code path as challenge-client.js).
    const clientSrc = fs.readFileSync(path.join(__dirname, "challenge-client.js"), "utf8");
    const unsealMatch = clientSrc.match(/async function unsealPayload[\s\S]*?\n    \}/);
    check("client has unsealPayload", !!unsealMatch);
    const sealMatch = clientSrc.match(/async function sealPayload[\s\S]*?\n    \}/);
    check("client has sealPayload", !!sealMatch);
    const clientCrypto = vm.runInContext(
        `(async () => {\n${unsealMatch[0]}\n${sealMatch[0]}\n` +
        `  const secret = ${JSON.stringify(env.CHALLENGE_SECRET)};\n` +
        `  const payload = await unsealPayload(secret, ${JSON.stringify(challenge.ciphertext)}, ${JSON.stringify(challenge.iv)});\n` +
        `  return { payload, seal: (a) => sealPayload(secret, a) };\n` +
        `})()`,
        { ...b64Polyfill }
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

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
