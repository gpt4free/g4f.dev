// Smoke tests for the API worker's /ai/audio/{text} route.
//
// Run with: node workers/ai-audio-route.test.mjs

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

const CLIENT_IP = "203.0.113.7";
const cakeEnv = {
  CAKE_KV: {
    async get(key) {
      if (key === `cakes:credit:${CLIENT_IP}`) return "100";
      return null;
    },
    async put() {},
    async delete() {}
  }
};
const noCreditEnv = {
  CAKE_KV: {
    async get() { return "0"; },
    async put() {},
    async delete() {}
  }
};

const providersDoc = {
  providers: {},
  serverDefaultModels: {},
  hiddenServers: {},
  autoProviders: {}
};

globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (String(url).includes("/dist/js/providers.json")) {
    return new Response(JSON.stringify(providersDoc), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  return new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "Content-Type": "audio/mpeg" }
  });
};

async function getAudio(path, init = {}, env = cakeEnv) {
  calls = [];
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", CLIENT_IP);
  return worker.fetch(new Request("https://g4f.space" + path, { ...init, headers }), env, ctx);
}

// 1. Text is encoded in the path and forwarded to Pollinations with the
// default TTS model. The caller gets permissive CORS and cache headers.
let response = await getAudio("/ai/audio/hello%20world?voice=alloy");
assert.equal(response.status, 200);
assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
assert.equal(response.headers.get("X-Provider"), "pollinations");
assert.match(response.headers.get("Cache-Control"), /max-age=31536000/);
const audioCalls = calls.filter((call) => call.url.includes("gen.pollinations.ai"));
assert.equal(audioCalls.length, 1);
assert.equal(
  audioCalls[0].url,
  "https://gen.pollinations.ai/audio/hello%20world?model=elevenlabs&voice=alloy"
);
assert.equal(audioCalls[0].init.method, "GET");
assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
console.log("PASS: /ai/audio/{text} forwards GET to Pollinations");

// 2. A caller-supplied Pollinations key is forwarded so paid accounts can use
// their own quota; g4f session tokens are not sent upstream.
response = await getAudio(
  "/ai/audio/hello?model=openai-audio&voice=nova",
  { headers: { Authorization: "Bearer pk_caller-key" } }
);
assert.equal(response.status, 200);
assert.equal(
  calls.find((call) => call.url.includes("gen.pollinations.ai")).url,
  "https://gen.pollinations.ai/audio/hello?model=openai-audio&voice=nova&key=pk_caller-key"
);

calls = [];
response = await getAudio(
  "/ai/audio/hello",
  { headers: { Authorization: "Bearer gfs_session-token" } }
);
assert.equal(response.status, 200);
assert.equal(
  calls.find((call) => call.url.includes("gen.pollinations.ai")).url,
  "https://gen.pollinations.ai/audio/hello?model=elevenlabs"
);
console.log("PASS: caller Pollinations keys forwarded, g4f sessions are not");

// 3. The worker's default AUDIO_API_KEY is used when the caller has no key.
calls = [];
response = await getAudio("/ai/audio/default-key", {}, {
  ...cakeEnv,
  AUDIO_API_KEY: "pk_default-audio-key"
});
assert.equal(response.status, 200);
assert.equal(
  calls.find((call) => call.url.includes("gen.pollinations.ai")).url,
  "https://gen.pollinations.ai/audio/default-key?model=elevenlabs&key=pk_default-audio-key"
);
console.log("PASS: default AUDIO_API_KEY is applied");

// 4. Empty/oversized text and unsupported methods are rejected without an
// upstream call.
response = await getAudio("/ai/audio/");
assert.equal(response.status, 400);
assert.equal(calls.filter((call) => call.url.includes("gen.pollinations.ai")).length, 0);

response = await getAudio("/ai/audio/" + "a".repeat(4097));
assert.equal(response.status, 400);
assert.equal(calls.filter((call) => call.url.includes("gen.pollinations.ai")).length, 0);

response = await getAudio("/ai/audio/hello", { method: "POST" });
assert.equal(response.status, 405);
assert.equal(calls.filter((call) => call.url.includes("gen.pollinations.ai")).length, 0);
console.log("PASS: empty/oversized text and non-GET methods are rejected");

// 5. Anonymous callers without cake credit are gated before the upstream call.
calls = [];
response = await getAudio("/ai/audio/hello", {}, noCreditEnv);
assert.equal(response.status, 402);
const gateBody = await response.json();
assert.equal(gateBody.error.type, "insufficient_credits");
assert.equal(calls.filter((call) => call.url.includes("gen.pollinations.ai")).length, 0);
console.log("PASS: anonymous audio requests require cake credit");

// 6. The old generic /ai/{provider}/{prompt} gateway no longer handles text.
calls = [];
response = await getAudio("/ai/auto/hello");
assert.equal(calls.filter((call) => call.url.includes("gen.pollinations.ai/audio/")).length, 0);
assert.equal(
  calls.some((call) => call.url.startsWith("https://pass.g4f.space/ai/auto/hello")),
  true,
  "unmatched /ai/ paths should fall through to the normal proxy, not the removed gateway"
);
console.log("PASS: the generic /ai/ gateway is removed");
