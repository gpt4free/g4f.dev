// Smoke tests for routing pollinations base URLs to the bundled provider
// worker instead of fetching them over the network.
//
// Run with: node workers/provider-worker-route.test.mjs

import assert from "node:assert/strict";

import worker from "./api-worker.js";

globalThis.caches = {
  default: {
    async match() { return undefined; },
    async put() {}
  }
};

const ctx = { waitUntil() {} };

const POLLINATIONS_BASE_URLS = [
  "https://pollinations.g4f-dev.workers.dev/v1",
  "https://pollinations.g4f-space.workers.dev",
  "https://polli.g4f.dev/v1",
  "https://gen.pollinations.ai/v1"
];

const PROVIDERS_URL = "https://g4f.dev/dist/js/providers.json";

let fetchCalls = [];
let providerCalls = [];
globalThis.fetch = async (url) => {
  const target = String(url);
  if (target === PROVIDERS_URL) {
    // Startup provider index fetch (not an upstream server request).
    return Response.json({ providers: {}, checkUrls: {} });
  }
  fetchCalls.push(target);
  return Response.json({ data: [{ id: "network" }] });
};

const providerWorker = {
  async fetch(request) {
    providerCalls.push(String(request.url));
    return Response.json({ data: [{ id: "bundled" }] });
  }
};

const servers = [
  ...POLLINATIONS_BASE_URLS.map((baseUrl, index) => ({
    id: `srv_pollinations_fixture_${index}`,
    label: `pollinations-fixture-${index}`,
    base_url: baseUrl,
    allowed_models: [],
    is_public: true,
    is_valid: true
  })),
  {
    id: "srv_other_fixture",
    label: "other-fixture",
    base_url: "https://api.example.com/v1",
    allowed_models: [],
    is_public: true,
    is_valid: true
  }
];

const env = {
  MEMBERS_KV: {
    async get(key) {
      if (key === "public_servers_index") return JSON.stringify(servers);
      return null;
    },
    async put() {},
    async delete() {}
  },
  PROVIDER_WORKERS: { pollinations: providerWorker }
};

async function modelsFor(label) {
  fetchCalls = [];
  providerCalls = [];
  return worker.fetch(new Request(`https://g4f.space/api/${label}/models`), env, ctx);
}

for (const [index, baseUrl] of POLLINATIONS_BASE_URLS.entries()) {
  const response = await modelsFor(`pollinations-fixture-${index}`);
  assert.equal(response.status, 200, `${baseUrl} should answer models`);
  assert.deepEqual(providerCalls, [`${baseUrl}/models`], `${baseUrl} must use the bundled pollinations worker`);
  assert.equal(fetchCalls.length, 0, `${baseUrl} must not be fetched over the network`);
  const body = await response.json();
  assert.deepEqual(body.data, [{ id: "bundled" }]);
  console.log(`PASS: ${baseUrl} routed to pollinations provider worker`);
}

// A non-pollinations server keeps using the network fetch path.
const otherResponse = await modelsFor("other-fixture");
assert.equal(otherResponse.status, 200);
assert.equal(providerCalls.length, 0, "non-pollinations servers must not use the provider worker");
assert.equal(fetchCalls[0], "https://api.example.com/v1/models");
const otherBody = await otherResponse.json();
assert.deepEqual(otherBody.data, [{ id: "network" }]);
console.log("PASS: non-pollinations servers still use the network");

// /quota for the new hosts maps to the Pollinations balance endpoint so a
// health check never turns into a chat completion.
const mapResponse = await worker.fetch(new Request("https://g4f.space/map"), env, ctx);
const urlMap = await mapResponse.json();
for (const baseUrl of POLLINATIONS_BASE_URLS) {
  const key = `${baseUrl}/quota`;
  assert.equal(urlMap[key], "https://gen.pollinations.ai/account/balance", `${key} should map to the balance endpoint`);
}
console.log("PASS: quota endpoints map to the Pollinations balance API");
