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

function makeEnv(usageRows, errorRows) {
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
        return null;
      },
      async put() {},
      async delete() {}
    },
    USAGE_DB: db(usageRows, () => usageCalls++),
    ERRORS_DB: db(errorRows, () => errorCalls++),
    get usageCalls() { return usageCalls; },
    get errorCalls() { return errorCalls; }
  };
}

const pending = [];
const ctx = { waitUntil(promise) { pending.push(Promise.resolve(promise)); } };

async function getStats(path, env, headers = { Authorization: `Bearer ${SESSION}` }) {
  const response = await worker.fetch(
    new Request(`https://g4f.space${path}`, { headers }),
    env,
    ctx
  );
  await Promise.all(pending.splice(0));
  return response;
}

// 1. Usage and error rows are merged into per-server and per-model success
// rates. A server/model pair with no errors keeps a rate of 1.
const env = makeEnv(
  [
    { server: "custom:srv_a", model: "model-a", requests: 90, tokens: 900 },
    { server: "custom:srv_b", model: "model-b", requests: 10, tokens: 100 }
  ],
  [
    { server: "custom:srv_a", model: "model-a", errors: 10 }
  ]
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

// 4. If one database is unavailable the other half is still returned and the
// payload is marked partial.
const partialEnv = makeEnv(
  [{ server: "custom:srv_a", model: "model-a", requests: 4, tokens: 0 }],
  []
);
partialEnv.ERRORS_DB = {
  prepare() {
    return {
      bind() {
        return {
          async all() {
            throw new Error("ERRORS_DB unavailable");
          }
        };
      }
    };
  }
};
response = await getStats("/api/stats?hours=1", partialEnv);
assert.equal(response.status, 200);
body = await response.json();
assert.equal(body.partial, true);
assert.equal(body.totals.requests, 4);
assert.equal(body.totals.errors, 0);
console.log("PASS: partial database failures are reported without dropping data");
