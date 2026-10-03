// Smoke test for workers/pollinations.js: rate limiting + model-id validation.
// Mocks upstream Pollinations endpoints so no real network calls are made.
const worker = (await import("../../workers/pollinations.js")).default;

const realFetch = globalThis.fetch;
const upstreamModels = JSON.stringify({
  data: [
    { name: "openai", pricing: { promptTextTokens: 0.000001, completionTextTokens: 0.000002 } },
    { name: "openai-large", pricing: { promptTextTokens: 0.000001, completionTextTokens: 0.000002 } }
  ]
});
const imageModels = JSON.stringify([
  { name: "flux", pricing: { completionImageTokens: 0.001 } }
]);

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("gen.pollinations.ai/text/models")) return new Response(upstreamModels, { status: 200 });
  if (u.includes("gen.pollinations.ai/image/models")) return new Response(imageModels, { status: 200 });
  if (u.includes("image.pollinations.ai/models")) return new Response(JSON.stringify(["flux", "openai"]), { status: 200 });
  if (u.includes("text.pollinations.ai/models")) return new Response(JSON.stringify([{ name: "openai" }, { name: "openai-large" }]), { status: 200 });
  if (u.includes("text.pollinations.ai/openai")) return new Response(JSON.stringify({ ok: true, model: "reached-upstream" }), { status: 200 });
  return new Response("{}", { status: 200 });
};

const env = { RATE_LIMIT_PER_MINUTE: "3" };
// Paid models are blocked without a user key (free-only with the default
// key), so generation requests carry a user key to exercise the proxy path.
const mkReq = (model) => new Request("https://polli.g4f.dev/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-real-ip": "1.2.3.4", "Authorization": "Bearer sk-user" },
  body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] })
});

// 1) Unknown model -> 404 model_not_found (does not count against upstream)
let r = await worker.fetch(mkReq("definitely-not-a-real-model"), env, {});
console.log("unknown model:", r.status, JSON.stringify(await r.json()));
if (r.status !== 404) throw new Error("expected 404 for unknown model");

// 2) Known model -> passes validation, reaches upstream
r = await worker.fetch(mkReq("openai-large"), env, {});
console.log("known model:", r.status, JSON.stringify(await r.json()));
if (r.status !== 200) throw new Error("expected 200 for known model");

// 3) Rate limit: env cap is 3/min; three requests used above -> 4th should 429
r = await worker.fetch(mkReq("openai"), env, {});
console.log("last allowed:", r.status);
if (r.status !== 200) throw new Error("expected 200 for third request within cap");
r = await worker.fetch(mkReq("openai"), env, {});
console.log("rate limited:", r.status, r.headers.get("X-RateLimit-Remaining"), JSON.stringify(await r.json()));
if (r.status !== 429) throw new Error("expected 429 after exceeding cap");

// 4) Different IP is unaffected
r = await worker.fetch(new Request("https://polli.g4f.dev/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-real-ip": "5.6.7.8", "Authorization": "Bearer sk-user" },
  body: JSON.stringify({ model: "openai", messages: [{ role: "user", content: "hi" }] })
}), env, {});
console.log("other ip:", r.status);
if (r.status !== 200) throw new Error("expected 200 for other IP");

// 5) Image generation with unknown model -> 404
r = await worker.fetch(new Request("https://polli.g4f.dev/v1/images/generations", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-real-ip": "5.6.7.8" },
  body: JSON.stringify({ model: "no-such-image-model", prompt: "cat" })
}), env, {});
console.log("unknown image model:", r.status, JSON.stringify(await r.json()));
if (r.status !== 404) throw new Error("expected 404 for unknown image model");

globalThis.fetch = realFetch;
console.log("ALL SMOKE TESTS PASSED");
