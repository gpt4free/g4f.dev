// Smoke test for the g4f.space provider workers.
//
// Every provider worker must answer its health endpoint both on the main host
// (`/api/<provider>`) and on its dedicated subdomain (`<provider>.g4f.space`).
// This exercises the mount-prefix stripping used when the workers share
// `g4f.space` with the API worker, without calling any upstream service.
//
// Run with: node workers/mount-prefix.test.mjs

import assert from "node:assert/strict";

import puter from "./puter-worker.js";
import pollinations from "./pollinations.js";
import ollama from "./ollama.js";
import router from "./g4f-space-router.js";

globalThis.caches = {
  default: {
    async match() { return undefined; },
    async put() {}
  }
};

const ctx = { waitUntil() {} };
const workers = [
  ["puter", puter, /puter/i],
  ["pollinations", pollinations, /pollinations/i],
  ["ollama", ollama, /ollama/i],
];

for (const [name, worker, servicePattern] of workers) {
  const urls = [`https://g4f.space/api/${name}`, `https://${name}.g4f.space/`];
  if (name === "pollinations") {
    urls.push(
      "https://pollinations.g4f.space/free/",
      "https://pollinations.g4f.space/community/",
      "https://g4f.space/api/pollinations/free/"
    );
  }
  for (const url of urls) {
    for (const [label, entry] of [["worker", worker], ["router", router]]) {
      const response = await entry.fetch(new Request(url), {}, ctx);
      assert.equal(response.status, 200, `${label}: ${url} should return 200`);
      const body = await response.json();
      assert.equal(body.status, "ok", `${label}: ${url} should report ok`);
      assert.match(body.service, servicePattern, `${label}: ${url} should identify the ${name} service`);
    }
  }
}

console.log("Worker mount-prefix and router smoke test passed (puter, pollinations, ollama).");

// A second pass through the router is a provider self-fetch loop. It must
// return a clear 508 JSON error instead of timing out as Cloudflare 522.
const loop = await router.fetch(
  new Request("https://g4f.space/", { headers: { "x-g4f-worker-hop": "1" } }),
  {},
  ctx
);
assert.equal(loop.status, 508, "router loop guard should return 508");
const loopBody = await loop.json();
assert.equal(loopBody.error.type, "routing_loop");
console.log("Router loop guard smoke test passed (508 instead of 522).");
