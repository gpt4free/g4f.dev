// Tests for KV-backed error logging (last 200 entries, no SQL DB writes)
// and /api/errors + /api/stats integration.
//
// Run with: node workers/errors-route.test.mjs

import assert from "node:assert/strict";

import worker from "./api-worker.js";

const cacheStore = new Map();
globalThis.caches = {
  default: {
    async match(request) {
      return cacheStore.get(request.url);
    },
    async put(request, response) {
      cacheStore.set(request.url, response.clone());
    }
  }
};

const SESSION = "gfs_test-session";
const USER = {
  id: "user_1",
  username: "tester",
  tier: "pro",
  custom_servers: []
};

function makeKvEnv() {
  const kv = new Map();
  kv.set(`session:${SESSION}`, JSON.stringify({
    user_id: USER.id,
    expires_at: new Date(Date.now() + 3600e3).toISOString()
  }));
  kv.set(`user:${USER.id}`, JSON.stringify(USER));
  let sqlCalls = 0;
  return {
    kv,
    get sqlCalls() { return sqlCalls; },
    MEMBERS_KV: {
      async get(key) {
        return kv.has(key) ? kv.get(key) : null;
      },
      async put(key, value) {
        kv.set(key, String(value));
      },
      async delete(key) {
        kv.delete(key);
      }
    },
    // Even if ERRORS_DB is present, it must never be queried or written to.
    ERRORS_DB: {
      prepare() {
        sqlCalls++;
        throw new Error("ERRORS_DB must not be used");
      }
    }
  };
}

const pending = [];
const ctx = { waitUntil(promise) { pending.push(Promise.resolve(promise)); } };

async function callWorker(path, env, init = {}) {
  const response = await worker.fetch(
    new Request(`https://g4f.space${path}`, init),
    env,
    ctx
  );
  await Promise.all(pending.splice(0));
  return response;
}

// 1. Trigger 205 errors via /proxy (missing target or invalid method triggers 500/400? Wait: proxy_error is unlogged;
//    let's trigger an upstream error on /api/pollinations/models or a custom server error, or fetch error).
const env = makeKvEnv();
const originalFetch = globalThis.fetch;
let counter = 0;
globalThis.fetch = async (url) => {
  if (String(url).includes("providers.json")) {
    return Response.json({ providers: {} });
  }
  counter++;
  return Response.json(
    { error: { message: `upstream failure #${counter}`, type: "server_error" } },
    { status: 500, headers: { "Content-Type": "application/json" } }
  );
};

try {
  // Set up a public server in public_servers_index so /v1/chat/completions or /custom/<id>/... hits upstream
  // Even simpler: /api/pollinations/models? No, that returns fetch directly.
  // What about hitting a non-existent /v1/chat/completions or /custom/srv_1/chat/completions?
  // Let's seed a public server in MEMBERS_KV and hit /custom/srv_test/chat/completions!
  await env.MEMBERS_KV.put("public_servers_index", JSON.stringify([
    {
      id: "srv_test",
      label: "test-server",
      base_url: "https://upstream.example",
      allowed_models: ["gpt-test"],
      is_public: true
    }
  ]));

  for (let i = 1; i <= 205; i++) {
    const res = await callWorker("/custom/srv_test/chat/completions", env, {
      method: "POST",
      headers: {
        Authorization: "Bearer g4f-local-free",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: "gpt-test", messages: [{ role: "user", content: `msg ${i}` }] })
    });
    assert.equal(res.status, 500);
  }
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal(env.sqlCalls, 0, "ERRORS_DB must never be touched");

const rawIndex = env.kv.get("error_logs_index");
assert.ok(rawIndex, "error_logs_index must be stored in MEMBERS_KV");
const stored = JSON.parse(rawIndex);
assert.equal(stored.length, 200, "KV error index must retain only the last 200 errors");
assert.match(stored[0].message, /upstream failure #205/, "newest error must be first");
assert.match(stored[199].message, /upstream failure #6/, "oldest retained error must be #6");

// 2. GET /api/errors returns from KV index with limit and filters.
let res = await callWorker("/api/errors?limit=10", env);
assert.equal(res.status, 200);
let body = await res.json();
assert.equal(body.total, 200);
assert.equal(body.limit, 10);
assert.equal(body.data.length, 10);
assert.match(body.data[0].message, /upstream failure #205/);

res = await callWorker("/api/errors?source=upstream&status=500&limit=5", env);
assert.equal(res.status, 200);
body = await res.json();
assert.equal(body.total, 200);
assert.equal(body.data.length, 5);

// 3. GET /api/stats aggregates error counts from the KV index.
res = await callWorker("/api/stats?hours=1", env);
assert.equal(res.status, 200);
body = await res.json();
assert.equal(body.totals.errors, 200);
assert.equal(body.totals.error_count, 200);
assert.equal(body.partial, false);
assert.equal(env.sqlCalls, 0, "ERRORS_DB must never be touched by /api/stats");

console.log("PASS: errors are stored only in KV index (last 200) and served by /api/errors & /api/stats");
