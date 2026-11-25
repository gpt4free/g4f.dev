const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const MOUNT_PREFIX = "/api/gemini";
const DEFAULT_MODEL = "models/gemini-flash-latest";
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const FALLBACK_THOUGHT_SIGNATURE = "skip_thought_signature_validator";
const NON_CHAT_MODEL_PATTERN = /(?:embedding|imagen|image|veo|audio|speech|tts|live|robotics|computer-use|deep-research)/i;
const PAID_MODEL_PATTERN = /(?:^|[-_.])(?:pro|ultra)(?:$|[-_.])/i;

let modelCache = null;
let modelCacheAt = 0;

function jsonError(message, status = 502, type = "api_error") {
  return Response.json({
    error: { message, type, code: status }
  }, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function withCors(response) {
  const wrapped = new Response(response.body, response);
  wrapped.headers.set("Access-Control-Allow-Origin", "*");
  wrapped.headers.set("Access-Control-Expose-Headers", "Content-Type, X-Provider, X-Model");
  return wrapped;
}

function handleOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key, X-Goog-Api-Key",
      "Access-Control-Max-Age": "86400"
    }
  });
}

function normalizeKey(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const match = /^Bearer\s+(.*)$/i.exec(trimmed);
  const key = (match ? match[1] : trimmed).trim();
  return !key || key.startsWith("g4f_") ? null : key;
}

function resolveApiKey(request, url, env) {
  return normalizeKey(request.headers.get("Authorization")) ||
    normalizeKey(request.headers.get("X-Api-Key")) ||
    normalizeKey(request.headers.get("X-Goog-Api-Key")) ||
    normalizeKey(url.searchParams.get("key")) ||
    normalizeKey(url.searchParams.get("api_key")) ||
    normalizeKey(env.GEMINI_API_KEY) ||
    normalizeKey(env.GOOGLE_API_KEY);
}

function normalizePath(url) {
  let pathname = url.pathname;
  if (pathname === MOUNT_PREFIX || pathname.startsWith(`${MOUNT_PREFIX}/`)) {
    pathname = pathname.slice(MOUNT_PREFIX.length) || "/";
  }
  if (pathname.startsWith("/v1beta/openai")) {
    pathname = pathname.slice("/v1beta/openai".length) || "/";
  }
  if (pathname === "/v1" || pathname.startsWith("/v1/")) {
    pathname = pathname.slice("/v1".length) || "/";
  }
  return pathname;
}

function normalizeModelId(value) {
  return String(value || "").replace(/^models\//, "");
}

function isChatModel(model) {
  const id = normalizeModelId(model?.id || model?.name);
  return id.toLowerCase().startsWith("gemini-") &&
    !NON_CHAT_MODEL_PATTERN.test(id) &&
    !PAID_MODEL_PATTERN.test(id);
}

function isFreeModelId(modelId) {
  return isChatModel({ id: modelId });
}

function patchToolCallSignatures(body) {
  if (!Array.isArray(body?.messages)) return body;
  for (const message of body.messages) {
    if (message?.role !== "assistant" || !Array.isArray(message.tool_calls)) continue;
    for (const toolCall of message.tool_calls) {
      if (toolCall?.type !== "function") continue;
      if (!toolCall.extra_content || typeof toolCall.extra_content !== "object") {
        toolCall.extra_content = {};
      }
      if (!toolCall.extra_content.google || typeof toolCall.extra_content.google !== "object") {
        toolCall.extra_content.google = {};
      }
      toolCall.extra_content.google.thought_signature ??= FALLBACK_THOUGHT_SIGNATURE;
    }
  }
  return body;
}

async function fetchModels(apiKey) {
  const now = Date.now();
  if (modelCache && now - modelCacheAt < MODEL_CACHE_TTL_MS) return modelCache;
  const response = await fetch(`${GEMINI_API_BASE}/models`, {
    headers: apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini models request failed (${response.status}): ${detail}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload?.data)) throw new Error("Gemini models response is invalid");
  modelCache = payload.data.filter(isChatModel);
  modelCacheAt = now;
  return modelCache;
}

async function handleModels(apiKey) {
  const data = await fetchModels(apiKey);
  return withCors(Response.json({
    object: "list",
    data
  }, {
    headers: {
      "X-Provider": "gemini",
      "Cache-Control": "public, max-age=300"
    }
  }));
}

function resolveModel(model) {
  if (!model || ["auto", "default"].includes(String(model).toLowerCase())) {
    return DEFAULT_MODEL;
  }
  return model;
}

async function handleChatCompletions(request, apiKey) {
  let body;
  try {
    body = await request.json();
  } catch {
    return withCors(jsonError("Invalid JSON body", 400, "invalid_request_error"));
  }

  body.model = resolveModel(body.model);
  patchToolCallSignatures(body);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("X-G4F-Server-Key");
  headers.delete("X-Api-Key");
  headers.delete("X-Goog-Api-Key");
  headers.set("Content-Type", "application/json");
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
  else headers.delete("Authorization");

  const response = await fetch(`${GEMINI_API_BASE}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const wrapped = withCors(response);
  wrapped.headers.set("X-Provider", "gemini");
  wrapped.headers.set("X-Model", body.model);
  return wrapped;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return handleOptions();
    const url = new URL(request.url);
    const pathname = normalizePath(url);
    const apiKey = resolveApiKey(request, url, env || {});

    try {
      if (request.method === "GET" && pathname === "/models") {
        return await handleModels(apiKey);
      }
      if (request.method === "POST" && pathname === "/chat/completions") {
        return await handleChatCompletions(request, apiKey);
      }
      if (pathname === "/health") {
        return withCors(Response.json({ status: "ok", service: "gemini-worker" }));
      }
      if (pathname === "/" || pathname === "/gemini" || pathname === "/gemini/") {
        return withCors(Response.json({
          service: "G4F Gemini Worker",
          endpoints: {
            chat: "/v1/chat/completions",
            models: "/v1/models",
            health: "/health"
          }
        }));
      }
      return withCors(jsonError("Not found", 404, "not_found"));
    } catch (error) {
      console.error("Gemini worker error:", error);
      return withCors(jsonError(error.message || "Internal server error"));
    }
  }
};

export { isFreeModelId };
