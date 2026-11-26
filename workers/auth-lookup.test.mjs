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

// Browsers that block third-party cookies can still use the members area on
// auth.g4f.space. The probe sets a cookie and then reports whether it came
// back, so the page can redirect only when cookies are actually blocked.
const probeUrl = "https://auth.g4f.space/members/api/cookie-check";
const probeOrigin = { Origin: "https://g4f.dev" };
const probeSet = await authWorker.fetch(
  new Request(`${probeUrl}?set=probe-nonce-123`, { headers: probeOrigin }),
  {},
  ctx
);
assert.equal(probeSet.status, 200);
assert.match(probeSet.headers.get("Set-Cookie"), /g4f_cookie_probe=probe-nonce-123/);
const probeBlocked = await authWorker.fetch(
  new Request(`${probeUrl}?expect=probe-nonce-123`, { headers: probeOrigin }),
  {},
  ctx
);
assert.deepEqual(await probeBlocked.json(), { cookies: false, reason: "cookie_blocked" });
const probeAllowed = await authWorker.fetch(
  new Request(`${probeUrl}?expect=probe-nonce-123`, {
    headers: { ...probeOrigin, Cookie: "g4f_cookie_probe=probe-nonce-123" }
  }),
  {},
  ctx
);
assert.deepEqual(await probeAllowed.json(), { cookies: true });
console.log("PASS: cookie probe distinguishes blocked and allowed cookies");

// The auth host serves the static members page with a base for its assets so
// it can run first-party there.
const originalFetch = globalThis.fetch;
globalThis.fetch = async () =>
  new Response("<html><head><title>Members</title></head><body><a href=\"/members.html\">Members</a></body></html>", {
    status: 200,
    headers: { "Content-Type": "text/html" }
  });
try {
  const page = await authWorker.fetch(
    new Request("https://auth.g4f.space/members.html", { headers: probeOrigin }),
    {},
    ctx
  );
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<base href="https:\/\/g4f.dev\/">/);
  assert.match(html, /href="https:\/\/auth.g4f.space\/members.html"/);
} finally {
  globalThis.fetch = originalFetch;
}
console.log("PASS: auth host serves the members page first-party");

// Pro tier upgrade path: calculateUserTier preservation, webhook, status, and verify fallback.
{
  const env = { ...makeEnv(), PRO_UPGRADE_SECRET: "test-pro-secret" };
  const created = await __test.createOrUpdateUser(env, {
    provider: "github",
    provider_id: "gh-pro-1",
    username: "pro-applicant",
    name: "Pro Applicant",
    email: "pro@example.com"
  });
  created.tier = "free";
  created.api_keys = [{ key_hash: "hash-key-1" }];
  await env.MEMBERS_KV.put("api_key:hash-key-1", JSON.stringify({ user_id: created.id, tier: "free" }));
  await env.MEMBERS_BUCKET.put(`users/${created.id}.json`, JSON.stringify(created));

  // Unauthenticated / bad secret webhook calls are rejected
  const badWebhook = await authWorker.fetch(
    new Request("https://auth.g4f.space/members/api/pro/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer wrong" },
      body: JSON.stringify({ github_username: "pro-applicant" })
    }),
    env,
    ctx
  );
  assert.equal(badWebhook.status, 403);

  // Valid webhook upgrades user and API key cache, and calculateUserTier preserves it
  const goodWebhook = await authWorker.fetch(
    new Request("https://auth.g4f.space/members/api/pro/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer test-pro-secret" },
      body: JSON.stringify({
        github_username: "pro-applicant",
        github_id: "gh-pro-1",
        issue_number: 42,
        issue_url: "https://github.com/gpt4free/g4f.dev/issues/42",
        reason: "Open-source CLI assistant"
      })
    }),
    env,
    ctx
  );
  assert.equal(goodWebhook.status, 200);
  const webhookJson = await goodWebhook.json();
  assert.equal(webhookJson.tier, "pro");
  assert.equal(webhookJson.upgraded, true);

  const updatedUser = await (await env.MEMBERS_BUCKET.get(`users/${created.id}.json`)).json();
  assert.equal(updatedUser.tier, "pro");
  assert.equal(updatedUser.pro_approved, true);
  assert.equal(await __test.calculateUserTier(updatedUser, [], []), "pro");

  const keyCache = await env.MEMBERS_KV.get("api_key:hash-key-1", { type: "json" });
  assert.equal(keyCache.tier, "pro");
}
console.log("PASS: pro upgrade webhook upgrades user, updates API key cache, and survives cron");

{
  const env = makeEnv();
  const created = await __test.createOrUpdateUser(env, {
    provider: "github",
    provider_id: "gh-pro-2",
    username: "verify-applicant",
    name: "Verify Applicant",
    email: "verify@example.com"
  });
  created.tier = "free";
  await env.MEMBERS_BUCKET.put(`users/${created.id}.json`, JSON.stringify(created));
  await env.MEMBERS_KV.put("session:sess-pro-2", JSON.stringify({
    user_id: created.id,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  }));

  const statusResp = await authWorker.fetch(
    new Request("https://auth.g4f.space/members/api/pro/status", {
      headers: { "Authorization": "Bearer sess-pro-2" }
    }),
    env,
    ctx
  );
  assert.equal(statusResp.status, 200);
  const statusJson = await statusResp.json();
  assert.equal(statusJson.github_connected, true);
  assert.equal(statusJson.can_upgrade, true);
  assert.match(statusJson.issue_url, /gpt4free\/g4f\.dev\/issues\/new\?template=pro-tier-request\.yml/);

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /api\.github\.com\/repos\/gpt4free\/g4f\.dev\/issues/);
    return new Response(JSON.stringify([
      {
        number: 99,
        html_url: "https://github.com/gpt4free/g4f.dev/issues/99",
        user: { login: "verify-applicant" },
        labels: [{ name: "pro-tier-request" }, { name: "pro-approved" }]
      }
    ]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const verifyResp = await authWorker.fetch(
      new Request("https://auth.g4f.space/members/api/pro/verify", {
        method: "POST",
        headers: { "Authorization": "Bearer sess-pro-2", "Content-Type": "application/json" },
        body: "{}"
      }),
      env,
      ctx
    );
    assert.equal(verifyResp.status, 200);
    const verifyJson = await verifyResp.json();
    assert.equal(verifyJson.verified, true);
    assert.equal(verifyJson.upgraded, true);
    assert.equal(verifyJson.tier, "pro");
  } finally {
    globalThis.fetch = prevFetch;
  }
}
console.log("PASS: pro status and verify fallback upgrade user from approved GitHub issue");

// Scheduled tier update paginates across runs via KV cursor and stays within
// Cloudflare Workers' per-invocation API/subrequest limit.
{
  let apiRequests = 0;
  const baseEnv = makeEnv();
  const countingKv = {
    get: async (k, opts) => { apiRequests++; return baseEnv.MEMBERS_KV.get(k, opts); },
    put: async (k, v, opts) => { apiRequests++; return baseEnv.MEMBERS_KV.put(k, v, opts); },
    delete: async (k) => { apiRequests++; return baseEnv.MEMBERS_KV.delete(k); },
    list: async (opts) => { apiRequests++; return baseEnv.MEMBERS_KV.list(opts); }
  };
  const countingBucket = {
    get: async (k) => { apiRequests++; return baseEnv.MEMBERS_BUCKET.get(k); },
    put: async (k, v) => { apiRequests++; return baseEnv.MEMBERS_BUCKET.put(k, v); },
    delete: async (k) => { apiRequests++; return baseEnv.MEMBERS_BUCKET.delete(k); },
    list: async (opts) => { apiRequests++; return baseEnv.MEMBERS_BUCKET.list(opts); }
  };
  const env = {
    MEMBERS_KV: countingKv,
    MEMBERS_BUCKET: countingBucket,
    CRON_USER_BATCH_SIZE: "5"
  };

  // Seed 12 users (> batchSize of 5) that are older than 24h and still "new"
  const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const recentIndex = [];
  for (let i = 0; i < 12; i++) {
    const id = `u_cron_${String(i).padStart(2, "0")}`;
    await baseEnv.MEMBERS_BUCKET.put(`users/${id}.json`, JSON.stringify({
      id,
      username: `user-${i}`,
      provider: "github",
      provider_id: `gh-${i}`,
      tier: "new",
      created_at: oldDate,
      last_login: oldDate,
      api_keys: []
    }));
    recentIndex.push({ id, username: `user-${i}`, provider: "github", tier: "new", created_at: oldDate });
  }
  await baseEnv.MEMBERS_KV.put("recent_users_index", JSON.stringify({ users: recentIndex }));

  let fetchCalls = 0;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetchCalls++;
    apiRequests++;
    if (String(url).includes("contributors")) {
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ sponsors: { current: [], past: [] } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    // Run 1: processes first 5 users, saves cursor, caches contributors/sponsors
    apiRequests = 0;
    await authWorker.scheduled({ scheduledTime: Date.now() }, env, ctx);
    assert.ok(apiRequests <= 30, `Run 1 should stay well under 50 API requests (got ${apiRequests})`);
    assert.equal(fetchCalls, 2, "Run 1 fetches contributors and sponsors once");
    assert.ok(await baseEnv.MEMBERS_KV.get("cron:tier_update_cursor"), "Run 1 persists cursor");

    // Run 2: processes next 5 users using cached contributors/sponsors
    apiRequests = 0;
    await authWorker.scheduled({ scheduledTime: Date.now() }, env, ctx);
    assert.ok(apiRequests <= 30, `Run 2 should stay well under 50 API requests (got ${apiRequests})`);
    assert.equal(fetchCalls, 2, "Run 2 reuses cached contributors and sponsors");
    assert.ok(await baseEnv.MEMBERS_KV.get("cron:tier_update_cursor"), "Run 2 persists cursor");

    // Run 3: processes remaining 2 users and clears cursor
    apiRequests = 0;
    await router.scheduled({ scheduledTime: Date.now() }, env, ctx);
    assert.ok(apiRequests <= 30, `Run 3 should stay well under 50 API requests (got ${apiRequests})`);
    assert.equal(await baseEnv.MEMBERS_KV.get("cron:tier_update_cursor"), null, "Run 3 clears cursor at end of scan");

    for (let i = 0; i < 12; i++) {
      const id = `u_cron_${String(i).padStart(2, "0")}`;
      const saved = await (await baseEnv.MEMBERS_BUCKET.get(`users/${id}.json`)).json();
      assert.equal(saved.tier, "free", `User ${id} should be upgraded to free across paginated runs`);
    }
  } finally {
    globalThis.fetch = prevFetch;
  }
}
console.log("PASS: scheduled tier update paginates across runs within subrequest limits");
