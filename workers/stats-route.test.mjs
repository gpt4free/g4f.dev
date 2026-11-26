// Smoke tests for the API worker's /api/stats route.
//
// Run with: node workers/stats-route.test.mjs

import assert from "node:assert/strict";

import worker from "./api-worker.js";

const cacheStore = new Map();
globalThis.caches = {
  default: {
    async match(request) {
      return cacheStore.get(request.url);
    },
    async put(request, response) {
      cacheStore.set(request.url, response);
    }
  }
};

globalThis.fetch = async () => {
  throw new Error("unexpected network fetch");
};

const SESSION = "gfs_test-session";
const USER = {
  id: "user_1",
  username: "tester",
  tier: "pro",
  custom_servers: []
};

function makeEnv(usageRows, errorEntries) {
  let usageCalls = 0;
  let errorCalls = 0;
  const db = (rows, onCall) => ({
    prepare() {
      onCall();
      return {
        bind() {
          return {
            async all() {
              return { results: rows };
            }
          };
        }
      };
    }
  });
  return {
    MEMBERS_KV: {
      async get(key) {
        if (key === `session:${SESSION}`) {
          return JSON.stringify({
            user_id: USER.id,
            expires_at: new Date(Date.now() + 3600e3).toISOString()
          });
        }
        if (key === `user:${USER.id}`) return JSON.stringify(USER);
        if (key === "error_logs_index") {
          errorCalls++;
          return JSON.stringify(errorEntries);
        }
        return null;
      },
      async put() {},
      async delete() {}
    },
    USAGE_DB: db(usageRows, () => usageCalls++),
    get usageCalls() { return usageCalls; },
    get errorCalls() { return errorCalls; }
  };
}

const pending = [];
const ctx = { waitUntil(promise) { pending.push(Promise.resolve(promise)); } };

async function getStats(path, env, headers = { Authorization: `Bearer ${SESSION}` }, targetWorker = worker) {
  const response = await targetWorker.fetch(
    new Request(`https://g4f.space${path}`, { headers }),
    env,
    ctx
  );
  await Promise.all(pending.splice(0));
  return response;
}

// 1. Usage and error rows are merged into per-server and per-model success
// rates. A server/model pair with no errors keeps a rate of 1.
const recentTs = new Date().toISOString();
const env = makeEnv(
  [
    { server: "custom:srv_a", model: "model-a", requests: 90, tokens: 900 },
    { server: "custom:srv_b", model: "model-b", requests: 10, tokens: 100 }
  ],
  Array.from({ length: 10 }, (_, i) => ({
    id: `err_${i}`,
    timestamp: recentTs,
    source: "upstream",
    status: 500,
    message: "fail",
    context: { server: "custom:srv_a", model: "model-a" }
  }))
);

let response = await getStats("/api/stats", env);
assert.equal(response.status, 200);
let body = await response.json();
assert.equal(body.totals.requests, 100);
assert.equal(body.totals.errors, 10);
assert.equal(body.totals.error_count, 10);
assert.equal(body.totals.success_rate, 0.9091);
assert.equal(body.partial, false);

const serverA = body.servers.find((row) => row.server === "custom:srv_a");
assert.deepEqual(
  { requests: serverA.requests, errors: serverA.errors, success_rate: serverA.success_rate },
  { requests: 90, errors: 10, success_rate: 0.9 }
);
const serverB = body.servers.find((row) => row.server === "custom:srv_b");
assert.deepEqual(
  { requests: serverB.requests, errors: serverB.errors, success_rate: serverB.success_rate },
  { requests: 10, errors: 0, success_rate: 1 }
);
const modelA = body.models.find((row) => row.model === "model-a");
assert.deepEqual(
  { requests: modelA.requests, errors: modelA.errors, success_rate: modelA.success_rate },
  { requests: 90, errors: 10, success_rate: 0.9 }
);
assert.equal(body.since.length, 24);
console.log("PASS: /api/stats aggregates success rates per server and model");

// 2. The second request is served from the edge cache, so D1 is not queried
// again for the same window.
const usageCallsBefore = env.usageCalls;
const errorCallsBefore = env.errorCalls;
response = await getStats("/api/stats", env);
body = await response.json();
assert.equal(response.status, 200);
assert.equal(body.totals.requests, 100);
assert.equal(env.usageCalls, usageCallsBefore, "cached window must not re-read usage_logs");
assert.equal(env.errorCalls, errorCallsBefore, "cached window must not re-read error_logs");
console.log("PASS: repeated stats requests reuse the cached aggregation");

// 3. Unauthenticated callers get 401 and the D1 tables are never touched.
const anonymousEnv = makeEnv([], []);
response = await getStats("/api/stats", anonymousEnv, {});
assert.equal(response.status, 401);
assert.equal(anonymousEnv.usageCalls, 0);
assert.equal(anonymousEnv.errorCalls, 0);
console.log("PASS: /api/stats requires authentication");

// 4. If error index lookup fails the usage half is still returned and the
// payload is marked partial.
const partialEnv = makeEnv(
  [{ server: "custom:srv_a", model: "model-a", requests: 4, tokens: 0 }],
  []
);
const origGet = partialEnv.MEMBERS_KV.get;
partialEnv.MEMBERS_KV.get = async (key) => {
  if (key === "error_logs_index") {
    throw new Error("MEMBERS_KV unavailable");
  }
  return origGet(key);
};
response = await getStats("/api/stats?hours=1", partialEnv);
assert.equal(response.status, 200);
body = await response.json();
assert.equal(body.partial, true);
assert.equal(body.totals.requests, 4);
assert.equal(body.totals.errors, 0);
console.log("PASS: partial database failures are reported without dropping data");

// 5. All MEMBERS_KV operation types are reported by prefix, without key values.
const kvEnv = makeEnv([], []);
const { default: kvWorker } = await import("./api-worker.js?kv-metrics-test");
const kvSession = "gfs_kv-metrics-secret";
const kvUser = {
  id: "user_kv_metrics_secret",
  username: "kv-metrics",
  tier: "pro",
  custom_servers: [{ id: "server_kv_secret", is_public: true, auto_update_models: false }]
};
const calls = [];
kvEnv.MEMBERS_KV = {
  async get(key) {
    calls.push(["get", key]);
    if (key === `session:${kvSession}`) {
      return JSON.stringify({ user_id: kvUser.id, expires_at: new Date(Date.now() + 3600e3).toISOString() });
    }
    if (key === "public_servers_index") return "[]";
    return null;
  },
  async put(key, value, options) { calls.push(["put", key, value, options]); },
  async delete(key) { calls.push(["delete", key]); }
};
kvEnv.MEMBERS_BUCKET = {
  async get(key) {
    assert.equal(key, `users/${kvUser.id}.json`);
    return { async json() { return structuredClone(kvUser); } };
  },
  async put() {}
};

response = await getStats("/api/stats?hours=2", kvEnv, { Authorization: "Bearer gfs_missing-secret" }, kvWorker);
assert.equal(response.status, 401);
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  assert.equal(String(url), "https://g4f.dev/dist/js/providers.json");
  return Response.json({ providers: {} });
};
try {
  response = await kvWorker.fetch(new Request("https://g4f.space/custom/api/servers/update", {
    method: "PUT",
    headers: { Authorization: `Bearer ${kvSession}`, "Content-Type": "application/json" },
    body: JSON.stringify({ server_id: "server_kv_secret" })
  }), kvEnv, ctx);
} finally {
  globalThis.fetch = originalFetch;
}
await Promise.all(pending.splice(0));
assert.equal(response.status, 200);
response = await getStats("/api/stats?hours=2", kvEnv, { Authorization: `Bearer ${kvSession}` }, kvWorker);
assert.equal(response.status, 200);
body = await response.json();
const kvRows = Object.fromEntries(body.kv.map(({ key_type, ...counts }) => [key_type, counts]));
for (const [, key] of calls) {
  assert.ok(kvRows[key.split(":")[0]], `missing stats for ${key.split(":")[0]}`);
}
for (const [prefix, counts] of Object.entries(kvRows)) {
  for (const [method, field] of [["get", "kv_reads"], ["put", "kv_writes"], ["delete", "kv_deletes"]]) {
    assert.equal(
      counts[field],
      calls.filter(([operation, key]) => operation === method && key.split(":")[0] === prefix).length,
      `${prefix} ${field} must match MEMBERS_KV operations`
    );
  }
}
assert.equal(kvRows.session.missing, 1);
assert.ok(kvRows.session.cache_hits >= 2);
assert.equal(kvRows.session.lookups, kvRows.session.kv_reads + kvRows.session.cache_hits);
assert.equal(kvRows.user.missing, 1);
assert.equal(kvRows.user.kv_writes, 2);
assert.equal(kvRows.public_servers_index.kv_reads, 1);
assert.equal(kvRows.public_servers_index.kv_writes, 1);
assert.equal(kvRows.server.kv_deletes, 1);
assert.equal(calls.find(([operation, key]) => operation === "put" && key.startsWith("user:"))[3].expirationTtl, 3600);
assert.doesNotMatch(JSON.stringify(body.kv), /gfs_|user_kv_metrics_secret|server_kv_secret/);
console.log("PASS: /api/stats reports MEMBERS_KV operations by key prefix");
