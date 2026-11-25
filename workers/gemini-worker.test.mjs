import assert from "node:assert/strict";
import test from "node:test";

import worker from "./gemini.js";
import { isFreeModelId } from "./gemini.js";

test("Gemini worker adds missing thought signatures without replacing existing ones", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamBody;
  let upstreamUrl;
  globalThis.fetch = async (url, init) => {
    upstreamUrl = String(url);
    upstreamBody = JSON.parse(init.body);
    return Response.json({ choices: [{ message: { content: "ok" } }] });
  };

  try {
    const response = await worker.fetch(new Request("https://gemini.g4f.space/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer test-key",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "auto",
        messages: [{
          role: "assistant",
          content: null,
          tool_calls: [
            { type: "function", id: "call-1", function: { name: "shell", arguments: "{}" } },
            {
              type: "function",
              id: "call-2",
              function: { name: "read_file", arguments: "{}" },
              extra_content: { google: { thought_signature: "original-signature" } }
            }
          ]
        }]
      })
    }), {});

    assert.equal(response.status, 200);
    assert.equal(upstreamUrl, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    assert.equal(upstreamBody.model, "models/gemini-flash-latest");
    assert.equal(
      upstreamBody.messages[0].tool_calls[0].extra_content.google.thought_signature,
      "skip_thought_signature_validator"
    );
    assert.equal(
      upstreamBody.messages[0].tool_calls[1].extra_content.google.thought_signature,
      "original-signature"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini worker filters its model list to Gemini chat models", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    object: "list",
    data: [
      { id: "models/gemini-2.5-flash" },
      { id: "models/gemini-2.5-flash-lite" },
      { id: "gemini-2.5-pro" },
      { id: "models/gemini-embedding-001" },
      { id: "models/imagen-4.0-generate-001" },
      { id: "models/text-bison-001" },
      { id: "models/gemini-2.5-flash-native-audio-preview" },
      { id: "models/gemini-2.5-flash-image-preview" }
    ]
  });

  try {
    const response = await worker.fetch(
      new Request("https://gemini.g4f.space/v1/models"),
      {}
    );
    const payload = await response.json();
    assert.deepEqual(
      payload.data.map((model) => model.id),
      ["models/gemini-2.5-flash", "gemini-2.5-flash-lite"]
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini free-model policy excludes priced model families", () => {
  assert.equal(isFreeModelId("models/gemini-2.5-flash"), true);
  assert.equal(isFreeModelId("gemini-2.5-flash-lite-preview"), true);
  assert.equal(isFreeModelId("models/gemini-2.5-pro"), false);
  assert.equal(isFreeModelId("models/gemini-ultra-latest"), false);
  assert.equal(isFreeModelId("models/imagen-4.0-generate-001"), false);
});
