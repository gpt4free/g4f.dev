// Vercel Edge Function proxy for the OpenRouter API (openrouter.ai).
//
// Forwards requests to https://openrouter.ai/api/v1/... with basic per-IP
// rate limiting (fixed 60s window, in-memory — per-isolate on serverless,
// best effort).
//
// API key resolution (first match wins):
//   1. Authorization header (Bearer <key>) — user's own OpenRouter key
//   2. x-api-key header
//   3. api_key query parameter (stripped before forwarding upstream)
//   4. Server-side default key via the OPENROUTER_API_KEY env var
// Placeholder bearer values ("Bearer g4f", "Bearer null", ...) count as
// "no key", so the server-side default applies.
//
// Environment variables:
//   OPENROUTER_API_KEY     - optional default key (used when 1-3 are absent)
//   RATE_LIMIT_PER_MINUTE  - optional per-IP cap (default 15/min)

const OPENROUTER_API = "https://openrouter.ai/api/v1";

const RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 15;
const rateLimitBuckets = new Map();
let rateLimitLastSweep = 0;

function sweepRateLimitBuckets(now) {
  if (now - rateLimitLastSweep < RATE_LIMIT_WINDOW_MS) return;
  rateLimitLastSweep = now;
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
}

function checkRateLimit(ip, max) {
  const now = Date.now();
  sweepRateLimitBuckets(now);
  let bucket = rateLimitBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  const allowed = bucket.count <= max;
  return {
    allowed,
    limit: max,
    remaining: Math.max(0, max - bucket.count),
    resetAt: bucket.resetAt,
    retryAfter: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  };
}

function getClientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

function getRateLimitPerMinute() {
  const parsed = Number(process.env.RATE_LIMIT_PER_MINUTE);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RATE_LIMIT_PER_MINUTE;
}

function rateLimitExceededResponse(result) {
  return new Response(JSON.stringify({
    error: {
      message: `Rate limit exceeded. Retry in ${result.retryAfter}s.`,
      type: "rate_limit_error",
      code: 429
    }
  }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(result.retryAfter),
      "X-RateLimit-Limit": String(result.limit),
      "X-RateLimit-Remaining": String(result.remaining),
      "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000))
    }
  });
}

function handleOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, HTTP-Referer, X-Title"
    }
  });
}

function addCorsHeaders(response) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set("Access-Control-Allow-Origin", "*");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

// Placeholder values clients send when they have no key of their own —
// treated as "no key" so the server-side default applies.
const PLACEHOLDER_KEYS = new Set(["", "g4f", "null", "undefined", "none", "default"]);

function normalizeKey(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const match = /^Bearer\s+(.*)$/i.exec(trimmed);
  const key = (match ? match[1] : trimmed).trim();
  return PLACEHOLDER_KEYS.has(key.toLowerCase()) ? null : key;
}

/**
 * Resolve the OpenRouter key for a request. Priority:
 *   1. Authorization header (Bearer <key>)
 *   2. x-api-key header
 *   3. api_key query parameter
 *   4. Server-side default (OPENROUTER_API_KEY env var)
 */
function resolveApiKey(request, url) {
  return (
    normalizeKey(request.headers.get("Authorization")) ||
    normalizeKey(request.headers.get("x-api-key")) ||
    normalizeKey(url.searchParams.get("api_key")) ||
    normalizeKey(process.env.OPENROUTER_API_KEY)
  );
}

export const config = { runtime: "edge" };

const MOUNT_PREFIX = "/api/openrouter";

async function adaptRequest(request) {
  const url = new URL(request.url);
  let pathname = url.pathname;
  const rewritePath = url.searchParams.get("path");
  if (rewritePath !== null) {
    url.searchParams.delete("path");
    pathname = rewritePath
      ? (rewritePath.startsWith("/") ? rewritePath : "/" + rewritePath)
      : "/";
  }
  if (pathname === MOUNT_PREFIX || pathname.startsWith(MOUNT_PREFIX + "/")) {
    pathname = pathname.slice(MOUNT_PREFIX.length) || "/";
  }
  const search = url.searchParams.toString();
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(/:$/, "");
  const finalUrl = `${proto}://${host}${pathname}${search ? "?" + search : ""}`;

  let adapted = request;
  try {
    Object.defineProperty(request, "url", { value: finalUrl, configurable: true });
  } catch (e) {
    const init = { method: request.method, headers: request.headers };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
      init.duplex = "half";
    }
    adapted = new Request(finalUrl, init);
  }
  return adapted;
}

export default async function handler(request, event) {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return handleOptions();
  }

  // Basic per-IP rate limiting
  const rateResult = checkRateLimit(getClientIp(request), getRateLimitPerMinute());
  if (!rateResult.allowed) {
    return addCorsHeaders(rateLimitExceededResponse(rateResult));
  }

  const adapted = await adaptRequest(request);
  const url = new URL(adapted.url);

  // Normalize the incoming path onto the OpenRouter base (…/api/v1):
  //   /v1/chat/completions      -> /chat/completions
  //   /api/v1/chat/completions  -> /chat/completions
  let pathname = url.pathname;
  if (pathname.startsWith("/api/")) pathname = pathname.slice("/api".length);
  if (pathname === "/v1" || pathname.startsWith("/v1/")) pathname = pathname.slice("/v1".length) || "/";
  // Resolve the key before stripping credentials from the query string.
  const apiKey = resolveApiKey(request, url);
  url.searchParams.delete("api_key");
  if (pathname === "/" || pathname === "") {
    return addCorsHeaders(new Response(JSON.stringify({
      status: "ok",
      service: "OpenRouter proxy (openrouter.ai/api/v1)",
      endpoints: ["/v1/chat/completions", "/v1/models", "/v1/models/{author}/{slug}"]
    }), { headers: { "Content-Type": "application/json" } }));
  }

  const upstreamUrl = OPENROUTER_API + pathname + url.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  if (apiKey) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  } else {
    headers.delete("Authorization");
  }

  let response;
  try {
    response = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : adapted.body
    });
  } catch (error) {
    return addCorsHeaders(new Response(JSON.stringify({
      error: { message: error.message, type: "api_error", code: 502 }
    }), { status: 502, headers: { "Content-Type": "application/json" } }));
  }

  const corsResponse = addCorsHeaders(new Response(response.body, response));
  const headers2 = new Headers(corsResponse.headers);
  headers2.set("X-RateLimit-Limit", String(rateResult.limit));
  headers2.set("X-RateLimit-Remaining", String(rateResult.remaining));
  headers2.set("X-RateLimit-Reset", String(Math.ceil(rateResult.resetAt / 1000)));
  return new Response(corsResponse.body, {
    status: corsResponse.status,
    statusText: corsResponse.statusText,
    headers: headers2
  });
}
