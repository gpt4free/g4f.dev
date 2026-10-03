// Vercel Edge Function adapter for workers/nvidia-worker.js (Cloudflare Worker).
//
// The worker is plain Web-API code (fetch/Request/Response/streams), so it runs
// unmodified on Vercel's edge runtime. This adapter only bridges the
// platform-specific parts:
//
//   1. Restores the original request path. vercel.json rewrites the domain
//      traffic (nvidea.g4f.dev/*) to this function at /api/nvidia and passes
//      the original path in the `path` query param. Direct hits under
//      /api/nvidia/... are unwrapped too.
//   2. Builds the worker `env` from Vercel environment variables.
//   3. Shims the Cloudflare-only `ctx.waitUntil` (the nvidia worker does not
//      use `request.cf` or `caches.default`).
//
// Environment variables:
//   NVIDIA_API_KEY            - NVIDIA NIM API key (integrate.api.nvidia.com)

import worker from "../workers/nvidia-worker.js";

export const config = { runtime: "edge" };

const MOUNT_PREFIX = "/api/nvidia";

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
    NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
    NVIDIA_NIM_API_KEY: process.env.NVIDIA_NIM_API_KEY
  };
  const ctx = makeCtx(event);
  let adapted;
  try {
    adapted = await adaptRequest(request);
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: "Failed to adapt request" } }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
  try {
    return await worker.fetch(adapted, env, ctx);
  } catch (error) {
    console.error("nvidia adapter error:", error);
    return new Response(JSON.stringify({ error: { message: error.message || "Internal server error" } }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
