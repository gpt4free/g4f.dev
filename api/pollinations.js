// Vercel Edge Function adapter for workers/pollinations.js (Cloudflare Worker).
//
// The worker is plain Web-API code (fetch/Request/Response), so it runs
// unmodified on Vercel's edge runtime. This adapter only bridges the
// platform-specific parts:
//
//   1. Restores the original request path. vercel.json rewrites the domain
//      traffic (e.g. polli.g4f.dev/*) to this function at /api/pollinations
//      and passes the original path in the `path` query param. Direct hits
//      under /api/pollinations/... are unwrapped too.
//   2. Builds the worker `env` from Vercel environment variables.
//   3. Shims the Cloudflare-only `ctx.waitUntil` (the pollinations worker
//      does not use `request.cf` or `caches.default`).
//
// Environment variables:
//   POLLINATIONS_API_KEY      - optional default Pollinations key
//   RATE_LIMIT_PER_MINUTE     - optional per-IP cap (worker default: 30/min)

import worker from "../workers/pollinations.js";

export const config = { runtime: "edge" };

const MOUNT_PREFIX = "/api/pollinations";

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
    // Shadow the `url` getter with an own property — avoids rebuilding the
    // Request (and touching its body stream) entirely.
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

function makeCtx(event) {
  return {
    waitUntil(promise) {
      if (!promise || typeof promise.then !== "function") return;
      promise.catch(() => {});
      try {
        event?.waitUntil?.(promise);
      } catch (e) { /* fire-and-forget fallback */ }
    }
  };
}

export default async function handler(request, event) {
  const env = {
    POLLINATIONS_API_KEY: process.env.POLLINATIONS_API_KEY,
    RATE_LIMIT_PER_MINUTE: process.env.RATE_LIMIT_PER_MINUTE
  };
  const ctx = makeCtx(event);
  let adapted;
  try {
    adapted = await adaptRequest(request);
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: "Request adaptation failed: " + e.message } }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
  const response = await worker.fetch(adapted, env, ctx);
  // Mirror Cache-Control into Vercel's CDN-scoped headers. Without these the
  // edge network only honors `s-maxage` when it appears in the plain
  // Cache-Control header, which some runtimes strip from function responses;
  // the override headers guarantee edge caching applies.
  const cacheControl = response.headers.get("Cache-Control");
  if (cacheControl) {
    const headers = new Headers(response.headers);
    headers.set("CDN-Cache-Control", cacheControl);
    headers.set("Vercel-CDN-Cache-Control", cacheControl);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
  return response;
}
