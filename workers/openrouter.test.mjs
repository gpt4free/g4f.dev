import assert from "node:assert/strict";
import test from "node:test";

import openrouterWorker, { isFreeModel, scoreFreeModel } from "./openrouter.js";

const models = {
  data: [
    {
      id: "alpha/text:free",
      context_length: 8_000,
      pricing: { prompt: "0", completion: "0", request: "0" },
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: ["tools", "response_format"]
    },
    {
      id: "beta/vision:free",
      context_length: 32_000,
      pricing: { prompt: "0", completion: "0", image: "0" },
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      supported_parameters: ["tools", "response_format", "structured_outputs"]
    },
    {
      id: "gamma/tool:free",
      context_length: 128_000,
      pricing: { prompt: "0", completion: "0" },
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: ["tools", "response_format", "structured_outputs"]
    },
    {
      id: "paid/model",
      context_length: 256_000,
      pricing: { prompt: "0.001", completion: "0.002" },
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: ["tools"]
    },
    {
      id: "hidden/request-fee:free",
      pricing: { prompt: "0", completion: "0", request: "0.01" }
    }
  ]
};

test("free model detection rejects any non-zero pricing component", () => {
  assert.equal(isFreeModel(models.data[0]), true);
  assert.equal(isFreeModel(models.data[3]), false);
  assert.equal(isFreeModel(models.data[4]), false);
});

test("auto scoring matches required capabilities and context", () => {
  const visionToolsRequest = {
    tools: [{ type: "function", function: { name: "lookup" } }],
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "describe this" },
        { type: "image_url", image_url: { url: "data:image/png;base64,x" } }
      ]
    }]
  };
  assert.equal(scoreFreeModel(models.data[0], visionToolsRequest), null);
  assert.ok(scoreFreeModel(models.data[1], visionToolsRequest));

  const impossibleContext = {
    max_completion_tokens: 20_000,
    messages: [{ role: "user", content: "x".repeat(10_000 * 4) }]
  };
  assert.equal(scoreFreeModel(models.data[0], impossibleContext), null);
});

test("worker filters paid models and auto-selects a compatible free model", async (t) => {
  const attempts = [];
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith("/models")) return Response.json(models);
    if (target.endsWith("/chat/completions")) {
      const body = JSON.parse(init.body);
      attempts.push(body.model);
      return Response.json({
        choices: [{ message: { role: "assistant", content: `selected ${body.model}` } }]
      });
    }
    return new Response("not found", { status: 404 });
  };

  const env = { OPENROUTER_API_KEY: "sk-server", RATE_LIMIT_PER_MINUTE: "0" };
  const list = await openrouterWorker.fetch(
    new Request("https://openrouter.g4f.space/v1/models"),
    env,
    {}
  );
  const listedIds = (await list.json()).data.map((model) => model.id);
  assert.deepEqual(listedIds, ["alpha/text:free", "beta/vision:free", "gamma/tool:free"]);

  const completion = await openrouterWorker.fetch(new Request(
    "https://openrouter.g4f.space/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "auto",
        tools: [{ type: "function", function: { name: "describe_image" } }],
        messages: [{
          role: "user",
          content: [{ type: "image_url", image_url: { url: "https://example.test/image.png" } }]
        }]
      })
    }
  ), env, {});
  assert.equal(completion.status, 200);
  assert.equal(completion.headers.get("X-G4F-Model"), "beta/vision:free");
  assert.deepEqual(attempts, ["beta/vision:free"]);
});

test("default-key requests cannot select priced models", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/models")) return Response.json(models);
    throw new Error("priced model reached upstream");
  };
  const response = await openrouterWorker.fetch(new Request(
    "https://openrouter.g4f.space/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "paid/model",
        messages: [{ role: "user", content: "hello" }]
      })
    }
  ), { OPENROUTER_API_KEY: "sk-server", RATE_LIMIT_PER_MINUTE: "0" }, {});
  assert.equal(response.status, 404);
});

test("API server entries using a stored key are still restricted to free models", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url) => {
    assert.equal(String(url).startsWith("https://openrouter.ai/api/v1/"), true);
    return Response.json(models);
  };
  const response = await openrouterWorker.fetch(new Request(
    "https://openrouter.g4f.space/v1/models",
    {
      headers: {
        Authorization: "Bearer sk-stored",
        "X-G4F-Server-Key": "1"
      }
    }
  ), { OPENROUTER_API_KEY: "sk-server", RATE_LIMIT_PER_MINUTE: "0" }, {});
  const listedIds = (await response.json()).data.map((model) => model.id);
  assert.deepEqual(listedIds, ["alpha/text:free", "beta/vision:free", "gamma/tool:free"]);
});

test("a caller key sees the full model list and bypasses auto ranking", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body });
    return String(url).endsWith("/models") ? Response.json(models) : Response.json({
      choices: [{ message: { role: "assistant", content: "paid response" } }]
    });
  };
  const response = await openrouterWorker.fetch(new Request(
    "https://openrouter.g4f.space/v1/chat/completions?api_key=sk-user",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "paid/model",
        messages: [{ role: "user", content: "hello" }]
      })
    }
  ), { OPENROUTER_API_KEY: "sk-server", RATE_LIMIT_PER_MINUTE: "0" }, {});
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(calls[0].body).model, "paid/model");
});
