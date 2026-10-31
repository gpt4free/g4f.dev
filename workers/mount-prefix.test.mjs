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
  for (const url of [`https://g4f.space/api/${name}`, `https://${name}.g4f.space/`]) {
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
