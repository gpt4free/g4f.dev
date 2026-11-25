const OPENROUTER_API = "https://openrouter.ai/api/v1";
const MOUNT_PREFIX = "/api/openrouter";
const RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 15;
const MODEL_CACHE_TTL_MS = 5 * 60_000;
const MAX_AUTO_ATTEMPTS = 4;
const AUTO_MODEL_NAMES = new Set(["", "auto", "default", "openrouter/auto", "openrouter/free"]);
const PLACEHOLDER_KEYS = new Set(["", "g4f", "null", "undefined", "none", "default"]);
const RATE_LIMIT_BUCKETS = new Map();
const MODEL_HEALTH = new Map();

let modelCache = null;
let modelCacheAt = 0;
let rateLimitLastSweep = 0;

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
  return wrapped;
}

function handleOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key, HTTP-Referer, X-Title, X-OpenRouter-Title",
      "Access-Control-Max-Age": "86400"
    }
  });
}

function normalizeKey(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const match = /^Bearer\s+(.*)$/i.exec(trimmed);
  const key = (match ? match[1] : trimmed).trim();
  if (!key || key.startsWith("g4f_") || PLACEHOLDER_KEYS.has(key.toLowerCase())) return null;
  return key;
}

function resolveApiKey(request, url, env) {
  return normalizeKey(request.headers.get("Authorization")) ||
    normalizeKey(request.headers.get("X-Api-Key")) ||
    normalizeKey(url.searchParams.get("api_key")) ||
    normalizeKey(env.OPENROUTER_API_KEY);
}

function hasUserApiKey(request, url) {
  return Boolean(
    normalizeKey(request.headers.get("Authorization")) ||
    normalizeKey(request.headers.get("X-Api-Key")) ||
    normalizeKey(url.searchParams.get("api_key"))
  );
}

function parseRateLimit(env) {
  const value = Number(env.RATE_LIMIT_PER_MINUTE);
  if (value === 0) return 0;
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_RATE_LIMIT_PER_MINUTE;
}

function checkRateLimit(request, env) {
  const limit = parseRateLimit(env);
  if (!limit) return { allowed: true, limit: 0, remaining: 0, resetAt: 0, retryAfter: 0 };
  const ip = request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Real-IP") ||
    (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim() ||
    "unknown";
  const now = Date.now();
  if (now - rateLimitLastSweep >= RATE_LIMIT_WINDOW_MS) {
    rateLimitLastSweep = now;
    for (const [key, bucket] of RATE_LIMIT_BUCKETS) {
      if (bucket.resetAt <= now) RATE_LIMIT_BUCKETS.delete(key);
    }
  }
  let bucket = RATE_LIMIT_BUCKETS.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    RATE_LIMIT_BUCKETS.set(ip, bucket);
  }
  bucket.count += 1;
  const allowed = bucket.count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
    retryAfter: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  };
}

function updateRateLimitHeaders(response, rate) {
  const wrapped = new Response(response.body, response);
  if (!rate.limit) return wrapped;
  wrapped.headers.set("X-RateLimit-Limit", String(rate.limit));
  wrapped.headers.set("X-RateLimit-Remaining", String(rate.remaining));
  wrapped.headers.set("X-RateLimit-Reset", String(Math.ceil(rate.resetAt / 1000)));
  if (rate.retryAfter) wrapped.headers.set("Retry-After", String(rate.retryAfter));
  return wrapped;
}

function isFreeModel(model) {
  if (!model || typeof model.id !== "string") return false;
  const pricing = model.pricing;
  if (!pricing || typeof pricing !== "object") {
    return model.id.endsWith(":free") || model.id === "openrouter/free";
  }
  const prices = Object.values(pricing);
  if (!prices.length) return model.id.endsWith(":free");
  return prices.every((price) => {
    const numeric = Number(price);
    return Number.isFinite(numeric) && numeric === 0;
  });
}

function normalizePath(url) {
  let pathname = url.pathname;
  const rewritePath = url.searchParams.get("path");
  if (rewritePath !== null) {
    url.searchParams.delete("path");
    pathname = rewritePath
      ? (rewritePath.startsWith("/") ? rewritePath : `/${rewritePath}`)
      : "/";
  }
  if (pathname === MOUNT_PREFIX || pathname.startsWith(`${MOUNT_PREFIX}/`)) {
    pathname = pathname.slice(MOUNT_PREFIX.length) || "/";
  }
  if (pathname.startsWith("/api/")) pathname = pathname.slice("/api".length);
  if (pathname === "/v1" || pathname.startsWith("/v1/")) pathname = pathname.slice("/v1".length) || "/";
  return pathname;
}

function buildUpstreamHeaders(request, apiKey) {
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("X-G4F-Server-Key");
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
  else headers.delete("Authorization");
  headers.delete("X-Api-Key");
  if (!headers.has("HTTP-Referer")) headers.set("HTTP-Referer", "https://g4f.dev");
  if (!headers.has("X-Title")) headers.set("X-Title", "GPT4Free (g4f.dev)");
  return headers;
}

async function fetchModels(headers, force = false) {
  const now = Date.now();
  if (!force && modelCache && now - modelCacheAt < MODEL_CACHE_TTL_MS) return modelCache;
  const response = await fetch(`${OPENROUTER_API}/models`, { method: "GET", headers });
  if (!response.ok) {
    if (modelCache) return modelCache;
    throw new Error(`OpenRouter models request failed (${response.status})`);
  }
  const data = await response.json();
  if (!Array.isArray(data?.data)) throw new Error("OpenRouter models response is invalid");
  modelCache = data.data;
  modelCacheAt = now;
  return modelCache;
}

function requestedInputModalities(body) {
  const modalities = new Set(["text"]);
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
    if (type.includes("image")) modalities.add("image");
    if (type.includes("audio")) modalities.add("audio");
    if (type.includes("video")) modalities.add("video");
    if (type.includes("file")) modalities.add("file");
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(body?.messages);
  visit(body?.input);
  return modalities;
}

function requestedOutputModalities(body) {
  if (!Array.isArray(body?.modalities)) return new Set();
  return new Set(body.modalities
    .filter((value) => typeof value === "string")
    .map((value) => value.toLowerCase()));
}

function requestedParameters(body) {
  const required = new Set();
  const parameterNames = [
    "tools", "tool_choice", "response_format", "reasoning", "web_search_options",
    "frequency_penalty", "presence_penalty", "repetition_penalty", "seed",
    "stop", "logprobs", "top_logprobs", "top_k", "min_p"
  ];
  for (const name of parameterNames) {
    if (body && body[name] !== undefined) required.add(name);
  }
  if (body?.reasoning_effort !== undefined) required.add("reasoning");
  if (body?.response_format?.type === "json_schema") required.add("structured_outputs");
  return required;
}

function modelInputModalities(model) {
  const values = model?.architecture?.input_modalities;
  return new Set(Array.isArray(values) ? values.map((value) => String(value).toLowerCase()) : ["text"]);
}

function modelOutputModalities(model) {
  const values = model?.architecture?.output_modalities;
  return new Set(Array.isArray(values) ? values.map((value) => String(value).toLowerCase()) : ["text"]);
}

function estimatedInputTokens(body) {
  try {
    return Math.ceil(JSON.stringify(body?.messages || body?.input || "").length / 4);
  } catch {
    return 1_000;
  }
}

function modelHealth(modelId) {
  const entry = MODEL_HEALTH.get(modelId);
  if (!entry) return 0.5;
  const attempts = entry.successes + entry.failures;
  return attempts ? (entry.successes + 1) / (attempts + 2) : 0.5;
}

function recordHealth(modelId, success) {
  const entry = MODEL_HEALTH.get(modelId) || { successes: 0, failures: 0 };
  if (success) entry.successes += 1;
  else entry.failures += 1;
  MODEL_HEALTH.set(modelId, entry);
}

function scoreFreeModel(model, body) {
  if (!isFreeModel(model) || model.id === "openrouter/free") return null;
  const supported = new Set(
    (Array.isArray(model.supported_parameters) ? model.supported_parameters : [])
      .map((value) => String(value).toLowerCase())
  );
  const inputModalities = modelInputModalities(model);
  const requestedInputs = requestedInputModalities(body);
  const missingInputs = [...requestedInputs].filter((value) => !inputModalities.has(value));
  if (missingInputs.length) return null;
  const outputModalities = modelOutputModalities(model);
  const requestedOutputs = requestedOutputModalities(body);
  const missingOutputs = [...requestedOutputs].filter((value) => !outputModalities.has(value));
  if (missingOutputs.length) return null;

  const requiredParameters = requestedParameters(body);
  const missingParameters = [...requiredParameters]
    .filter((value) => !supported.has(value));
  if (missingParameters.length) return null;

  const requiredTokens = estimatedInputTokens(body) +
    Number(body?.max_completion_tokens ?? body?.max_tokens ?? 0);
  const contextLength = Number(model.context_length || model.top_provider?.context_length || 0);
  if (contextLength > 0 && requiredTokens > contextLength) return null;

  let score = modelHealth(model.id) * 1_000;
  const publishedHealth = Number(model.health?.success_rate);
  if (Number.isFinite(publishedHealth)) {
    score += Math.max(0, Math.min(1, publishedHealth > 1 ? publishedHealth / 100 : publishedHealth)) * 100;
  }
  score += Math.min(Math.log2((contextLength || 1) / 1_024), 20) * 4;
  score += supported.size * 0.5;
  score += requestedInputs.size * 5;
  if (model.top_provider?.is_moderated === false) score += 2;
  return { id: model.id, score };
}

async function selectAutoModels(headers, body, limit = MAX_AUTO_ATTEMPTS) {
  const models = await fetchModels(headers);
  return models
    .map((model) => scoreFreeModel(model, body))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((entry) => entry.id);
}

function isValidChatResponse(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    const text = content
      .filter((part) => part?.type === "text")
      .map((part) => part.text || "")
      .join("");
    if (text.trim() && !/^user\s*safety\s*:\s*safe\s*$/i.test(text.trim())) return true;
  }
  return typeof content === "string" &&
    Boolean(content.trim()) &&
    !/^user\s*safety\s*:\s*safe\s*$/i.test(content.trim());
}

function modelNotAllowed(model) {
  return withCors(jsonError(
    `Model "${model}" is not a free OpenRouter model. Supply your own OpenRouter API key to use priced models.`,
    404,
    "model_not_found"
  ));
}

async function handleAutoCompletion(body, headers) {
  const candidates = await selectAutoModels(headers, body);
  if (!candidates.length) {
    return jsonError("No free OpenRouter model matches this request's capabilities", 503, "model_unavailable");
  }

  if (body.stream) {
    const response = await fetch(`${OPENROUTER_API}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, model: candidates[0] })
    });
    recordHealth(candidates[0], response.ok);
    const wrapped = new Response(response.body, response);
    wrapped.headers.set("X-G4F-Model", candidates[0]);
    wrapped.headers.set("X-G4F-Auto-Candidates", candidates.join(","));
    return wrapped;
  }

  let lastResponse = null;
  let lastData = null;
  for (const candidate of candidates) {
    let response;
    try {
      response = await fetch(`${OPENROUTER_API}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...body, model: candidate })
      });
    } catch {
      recordHealth(candidate, false);
      continue;
    }
    lastResponse = response;
    if ([401, 402, 403].includes(response.status)) {
      recordHealth(candidate, false);
      return response;
    }
    try {
      lastData = await response.json();
    } catch {
      recordHealth(candidate, false);
      continue;
    }
    const success = response.ok && isValidChatResponse(lastData);
    recordHealth(candidate, success);
    if (success) {
      const selected = Response.json(lastData, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
      selected.headers.set("X-G4F-Model", candidate);
      selected.headers.set("X-G4F-Auto-Candidates", candidates.join(","));
      return selected;
    }
  }
  const fallback = lastData || { error: { message: "All free OpenRouter model attempts failed", code: 502 } };
  return Response.json(fallback, {
    status: lastResponse?.status && lastResponse.status >= 400 ? lastResponse.status : 502
  });
}

async function fetchHandler(request, env = {}, ctx) {
  if (request.method === "OPTIONS") return handleOptions();
  const rate = checkRateLimit(request, env);
  if (!rate.allowed) {
    return updateRateLimitHeaders(withCors(jsonError(
      `Rate limit exceeded. Retry in ${rate.retryAfter}s.`,
      429,
      "rate_limit_error"
    )), rate);
  }

  const url = new URL(request.url);
  const apiKey = resolveApiKey(request, url, env);
  const userSuppliedKey = hasUserApiKey(request, url);
  const serverSuppliedKey = request.headers.get("X-G4F-Server-Key") === "1";
  const freeOnly = !userSuppliedKey || serverSuppliedKey;
  const pathname = normalizePath(url);
  url.searchParams.delete("api_key");
  const headers = buildUpstreamHeaders(request, apiKey);

  if (pathname === "/" || pathname === "/health") {
    return updateRateLimitHeaders(withCors(Response.json({
      status: "ok",
      service: "OpenRouter worker",
      free_only: freeOnly,
      endpoints: ["/v1/models", "/v1/chat/completions", "/v1/quota"]
    })), rate);
  }

  const upstreamPath = pathname === "/quota" ? "/key" : pathname;
  const upstreamUrl = `${OPENROUTER_API}${upstreamPath}${url.search}`;

  if (freeOnly && request.method === "GET" && (pathname === "/models" || pathname === "/models/")) {
    try {
      const models = await fetchModels(headers);
      return updateRateLimitHeaders(withCors(Response.json({ data: models.filter(isFreeModel) })), rate);
    } catch (error) {
      return updateRateLimitHeaders(withCors(jsonError(error.message, 502)), rate);
    }
  }

  if (request.method === "POST" && pathname === "/chat/completions") {
    let body;
    try {
      body = await request.json();
    } catch {
      return updateRateLimitHeaders(withCors(jsonError("Invalid JSON request body", 400, "invalid_request_error")), rate);
    }
    const rawModel = typeof body.model === "string" ? body.model.trim() : "";
    if (freeOnly && AUTO_MODEL_NAMES.has(rawModel.toLowerCase())) {
      try {
        const response = await handleAutoCompletion(body, headers);
        return updateRateLimitHeaders(withCors(response), rate);
      } catch (error) {
        return updateRateLimitHeaders(withCors(jsonError(error.message, 502)), rate);
      }
    }
    if (freeOnly && rawModel) {
      try {
        const model = (await fetchModels(headers)).find((entry) => entry.id === rawModel);
        if (!model || !isFreeModel(model)) return updateRateLimitHeaders(modelNotAllowed(rawModel), rate);
      } catch (error) {
        return updateRateLimitHeaders(withCors(jsonError(error.message, 502)), rate);
      }
    }
    body.model = rawModel || "openrouter/free";
    const response = await fetch(`${OPENROUTER_API}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    return updateRateLimitHeaders(withCors(new Response(response.body, response)), rate);
  }

  let response;
  try {
    response = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body
    });
  } catch (error) {
    return updateRateLimitHeaders(withCors(jsonError(error.message, 502)), rate);
  }
  return updateRateLimitHeaders(withCors(new Response(response.body, response)), rate);
}

export {
  isFreeModel,
  scoreFreeModel,
  selectAutoModels
};

export default { fetch: fetchHandler };
