// Smoke tests for the API worker's /proxy CORS route.
//
// Run with: node workers/proxy-route.test.mjs

import assert from "node:assert/strict";

import worker from "./api-worker.js";

globalThis.caches = {
  default: {
    async match() { return undefined; },
    async put() {}
  }
};

const ctx = { waitUntil() {} };
let calls = [];
let nextResponse = () => new Response(JSON.stringify({ ok: true }), {
  status: 200,
  headers: { "Content-Type": "application/json", "Set-Cookie": "secret=1" }
});

globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return nextResponse(url, init);
};

async function getProxyResponse(url, init = {}, env = {}) {
  calls = [];
  return worker.fetch(new Request(url, init), env, ctx);
}

// 1. Path form. The target URL (including the outer query string) is fetched
// server-side and the response gets permissive CORS headers.
let response = await getProxyResponse(
  "https://g4f.space/proxy/https://api.kilo.ai/api/gateway/v1/models?fresh=1"
);
assert.equal(response.status, 200);
assert.equal(calls.length, 1);
assert.equal(calls[0].url, "https://api.kilo.ai/api/gateway/v1/models?fresh=1");
assert.equal(calls[0].init.method, "GET");
assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
assert.equal(response.headers.get("Set-Cookie"), null, "upstream cookies must not leak");
const body = await response.json();
assert.deepEqual(body, { ok: true });
console.log("PASS: /proxy/<url> forwards GET and returns CORS headers");

// 2. Query form and percent-encoded target.
response = await getProxyResponse(
  "https://g4f.space/proxy?url=" + encodeURIComponent("https://example.com/v1/chat?x=1") + "&y=2"
);
assert.equal(response.status, 200);
assert.equal(calls[0].url, "https://example.com/v1/chat?x=1&y=2");
console.log("PASS: /proxy?url= accepts encoded targets and extra query params");

// 3. POST JSON is forwarded, identity headers are dropped, auth is kept.
response = await getProxyResponse(
  "https://g4f.space/proxy/https://api.kilo.ai/api/gateway/v1/chat/completions",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer upstream-key",
      "Cookie": "g4f_session=secret",
      "Origin": "https://evil.example"
    },
    body: JSON.stringify({ model: "kilo-auto/free", messages: [] })
  }
);
assert.equal(response.status, 200);
assert.equal(calls[0].init.method, "POST");
assert.equal(calls[0].init.headers.get("Authorization"), "Bearer upstream-key");
assert.equal(calls[0].init.headers.get("Cookie"), null);
assert.equal(calls[0].init.headers.get("Origin"), null);
assert.equal(new TextDecoder().decode(calls[0].init.body), '{"model":"kilo-auto/free","messages":[]}');
console.log("PASS: POST JSON forwarded with auth and without cookies/origin");

// 4. Private, loopback, metadata and non-http targets are rejected without
// making an upstream request.
for (const target of [
  "http://127.0.0.1/",
  "http://localhost:8080/",
  "http://169.254.169.254/latest/meta-data/",
  "http://10.0.0.1/",
  "http://2130706433/",
  "http://[::1]/",
  "http://[::ffff:7f00:1]/",
  "http://[64:ff9b::7f00:1]/",
  "file:///etc/passwd",
  "https://g4f.space/v1/models"
]) {
  response = await getProxyResponse("https://g4f.space/proxy/" + target);
  assert.equal(response.status, 400, `${target} should be rejected`);
  assert.equal(calls.length, 0, `${target} must not be fetched`);
}
console.log("PASS: private, loopback, self and non-http targets are blocked");

// 5. Only JSON request bodies are proxied.
response = await getProxyResponse(
  "https://g4f.space/proxy/https://example.com/upload",
  { method: "POST", headers: { "Content-Type": "text/plain" }, body: "hello" }
);
assert.equal(response.status, 415);
assert.equal(calls.length, 0);
console.log("PASS: non-JSON POST bodies are rejected");

// 6. User rate limits apply to /proxy, including targets ending in /models.
// The account has used its whole daily request budget (250 for the new tier).
const user = { id: "proxy-rate-user", username: "proxy-rate-user", tier: "new" };
const kv = {
  async get(key) {
    if (key === "session:proxy-test-session") {
      return JSON.stringify({
        user_id: user.id,
        expires_at: new Date(Date.now() + 60_000).toISOString()
      });
    }
    if (key === `user:${user.id}`) return JSON.stringify(user);
    if (key === `rate_limit:${user.id}:day`) {
      return JSON.stringify({ requests: 250, tokens: 0, timestamp: Date.now() });
    }
    return null;
  },
  async put() {},
  async delete() {}
};
response = await getProxyResponse(
  "https://g4f.space/proxy/https://example.com/v1/models",
  { headers: { Cookie: "g4f_session=proxy-test-session" } },
  { MEMBERS_KV: kv }
);
assert.equal(response.status, 429, "exhausted user should be rate limited");
const limitBody = await response.json();
assert.equal(limitBody.error.type, "rate_limit_exceeded");
assert.equal(calls.length, 0, "rate-limited proxy requests must not reach upstream");
console.log("PASS: signed-in user rate limits apply to /proxy (429 before fetch)");

// 7. An upstream key in Authorization must not hide the g4f session cookie,
// otherwise callers could bypass their user quota with their own API key.
response = await getProxyResponse(
  "https://g4f.space/proxy/https://api.kilo.ai/api/gateway/v1/models",
  {
    headers: {
      Authorization: "Bearer upstream-key",
      Cookie: "g4f_session=proxy-test-session"
    }
  },
  { MEMBERS_KV: kv }
);
assert.equal(response.status, 429, "cookie session should still be rate limited");
assert.equal(calls.length, 0, "rate-limited proxy requests must not reach upstream");
console.log("PASS: upstream Authorization does not bypass the session rate limit");
