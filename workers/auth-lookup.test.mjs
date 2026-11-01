// Smoke tests for account lookup indexes in the auth/members worker.
//
// Run with: node workers/auth-lookup.test.mjs

import assert from "node:assert/strict";

import authWorker, { __test } from "./auth-worker.js";
import router from "./g4f-space-router.js";

class MemoryKV {
  constructor() {
    this.values = new Map();
  }
  async get(key, options = {}) {
    if (!this.values.has(key)) return null;
    const value = this.values.get(key);
    if (options.type === "json") return JSON.parse(value);
    return value;
  }
  async put(key, value) {
    this.values.set(key, String(value));
  }
  async delete(key) {
    this.values.delete(key);
  }
  async list() {
    return { keys: [...this.values.keys()].map((name) => ({ name })), list_complete: true };
  }
}

class MemoryBucket {
  constructor() {
    this.values = new Map();
  }
  async put(key, value) {
    this.values.set(key, typeof value === "string" ? value : String(value));
  }
  async get(key) {
    if (!this.values.has(key)) return null;
    const value = this.values.get(key);
    return { json: async () => JSON.parse(value) };
  }
  async delete(key) {
    this.values.delete(key);
  }
  async list(options = {}) {
    const prefix = options.prefix || "";
    const limit = options.limit || 100;
    const keys = [...this.values.keys()].filter((key) => key.startsWith(prefix)).sort();
    const start = Number(options.cursor || 0);
    const end = start + limit;
    return {
      objects: keys.slice(start, end).map((key) => ({ key })),
      truncated: end < keys.length,
      cursor: end < keys.length ? String(end) : undefined
    };
  }
}

function makeEnv() {
  return { MEMBERS_KV: new MemoryKV(), MEMBERS_BUCKET: new MemoryBucket() };
}

// A provider profile without a username must still resolve to one account.
// Previously the lookup key was skipped and stored as "undefined", creating a
// new user on every login.
const env = makeEnv();
const first = await __test.createOrUpdateUser(env, {
  provider: "airforce",
  provider_id: "af-1",
  name: "Airforce User",
  email: "person@example.com"
});
const second = await __test.createOrUpdateUser(env, {
  provider: "airforce",
  provider_id: "af-1",
  name: "Airforce User",
  email: "person@example.com"
});
assert.equal(second.id, first.id, "missing username must not create a second account");
assert.ok(first.username, "new users should get a fallback username");
assert.equal(env.MEMBERS_BUCKET.values.size, 1, "only one user record should be stored");
assert.equal(
  await env.MEMBERS_KV.get("user_lookup_id:airforce:af-1"),
  first.id,
  "stable provider-id index should be written"
);
assert.equal(
  await env.MEMBERS_KV.get(`user_lookup:airforce:${first.username}`),
  first.id,
  "username index should be written"
);
console.log("PASS: provider profiles without a username keep one account");

// A legacy record with no lookup index is recovered by provider id instead of
// being duplicated. The recovery also repairs the missing index.
const legacyEnv = makeEnv();
const legacy = {
  id: "u_legacy",
  provider: "airforce",
  airforce: { id: "legacy-1" },
  name: "Legacy User",
  created_at: new Date().toISOString(),
  api_keys: []
};
await legacyEnv.MEMBERS_BUCKET.put("users/u_legacy.json", JSON.stringify(legacy));
const recovered = await __test.createOrUpdateUser(legacyEnv, {
  provider: "airforce",
  airforce: { id: "legacy-1" },
  name: "Legacy User"
});
assert.equal(recovered.id, "u_legacy", "legacy user should be recovered, not duplicated");
assert.equal(legacyEnv.MEMBERS_BUCKET.values.size, 1, "no duplicate legacy record should be created");
assert.equal(
  await legacyEnv.MEMBERS_KV.get("user_lookup_id:airforce:legacy-1"),
  "u_legacy",
  "recovered user should get an id index"
);
console.log("PASS: legacy users without an index are recovered by provider id");

// The router must send member and secret-store paths to the auth worker, not
// the API worker. An unauthenticated session check returns the auth worker's
// 401 instead of the API's 404.
globalThis.caches = {
  default: {
    async match() { return undefined; },
    async put() {}
  }
};
const ctx = { waitUntil() {} };
for (const url of [
  "https://auth.g4f.space/members/api/session",
  "https://g4f.space/members/api/session",
  "https://g4f.space/v1/secret/conversations"
]) {
  const response = await router.fetch(new Request(url), {}, ctx);
  assert.equal(response.status, 401, `${url} should be handled by the auth worker`);
  assert.ok(response.headers.get("X-G4F-Worker"));
}
console.log("PASS: router dispatches member and secret routes to the auth worker");

// The auth worker is still usable on its own (split deployment).
const session = await authWorker.fetch(
  new Request("https://auth.g4f.space/members/api/session"),
  {},
  ctx
);
assert.equal(session.status, 401);
console.log("PASS: auth worker split deployment still answers directly");
