// Vercel Edge Function adapter for workers/challenge-worker.js.
//
// The challenge worker is plain Web-API code (fetch/Request/Response/
// crypto), so it runs unmodified on Vercel's edge runtime. This adapter
// only bridges the platform-specific parts, mirroring api/worker.js:
//
//   1. Restores the original request path. Vercel's filesystem routing for
//      non-framework projects cannot serve one function under many paths,
//      so vercel.json rewrites the /challenge prefix to this function at
//      /api/challenge and passes the original path in the `path` query
//      param. Direct hits to /api/challenge/... are unwrapped too.
//   2. Builds a Cloudflare-style `env` from Vercel environment variables,
//      with optional Upstash Redis backing for the KV-shaped CAKE_KV
//      binding (shared ledger with the cake worker).
//   3. Shims the Cloudflare-only `caches.default` Cache API and
//      `request.cf`.

import worker from "../workers/challenge-worker.js";

export const config = { runtime: "edge" };

// ---- Cloudflare Cache API shim --------------------------------------------
// The challenge worker doesn't use the Cache API, but the shim keeps the
// environment shape identical to api/worker.js in case caching is added.
try {
  if (typeof globalThis.caches === "undefined" || !globalThis.caches.default) {
    globalThis.caches = {
      ...(globalThis.caches || {}),
      default: {
        async match() { return undefined; },
        async put() {}
      }
    };
  }
} catch (e) { /* cache stays disabled */ }

// ---- Upstash Redis KV shim --------------------------------------------------
// Maps the Cloudflare KV API (get/put/delete) used by the worker onto the
// Upstash REST API. Enabled by setting UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN; without them the binding stays undefined and
// the worker degrades gracefully (feature disabled).
class UpstashKv {
  constructor(url, token) {
    this.url = url.replace(/\/$/, "");
    this.token = token;
  }
  async command(args) {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(args)
    });
    if (!res.ok) {
      throw new Error(`Upstash ${res.status}: ${await res.text()}`);
    }
    return (await res.json()).result;
  }
  async get(key) {
    try {
      return await this.command(["GET", key]);
    } catch (e) {
      console.error("KV get failed:", e);
      return null;
    }
  }
  async put(key, value, options = {}) {
    const ttl = options?.expirationTtl;
    const args = ttl
      ? ["SET", key, value, "EX", String(Math.max(1, Math.floor(ttl)))]
      : ["SET", key, value];
    try {
      await this.command(args);
    } catch (e) {
      console.error("KV put failed:", e);
    }
  }
  async delete(key) {
    try {
      await this.command(["DEL", key]);
    } catch (e) {
      console.error("KV delete failed:", e);
    }
  }
}

function buildEnv() {
  const env = {
    CHALLENGE_SECRET: process.env.CHALLENGE_SECRET,
    CHALLENGE_JWT_SECRET: process.env.CHALLENGE_JWT_SECRET,
    CAKE_CREDIT_CENTS: process.env.CAKE_CREDIT_CENTS,
    CHALLENGE_PER_IP_PER_DAY: process.env.CHALLENGE_PER_IP_PER_DAY,
    CHALLENGE_MAX_PER_DAY: process.env.CHALLENGE_MAX_PER_DAY,
    CHALLENGE_TTL_SEC: process.env.CHALLENGE_TTL_SEC,
    ADMIN_API_KEY: process.env.ADMIN_API_KEY
  };
  // Upstash REST credentials — also accept the Vercel Marketplace variable
  // names (KV_REST_API_URL/KV_REST_API_TOKEN) used by the Upstash integration.
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (upstashUrl && upstashToken) {
    env.CAKE_KV = new UpstashKv(upstashUrl, upstashToken);
  }
  return env;
}

// ---- request adaptation -----------------------------------------------------
// vercel.json rewrites mount the worker at /api/challenge and pass the
// original request path in the `path` query param (the destination path
// /api/challenge itself must not leak into the worker). Direct hits under
// /api/challenge/... are unwrapped by stripping the mount prefix. The
// result is rebuilt against the forwarded host.
const MOUNT_PREFIX = "/api/challenge";

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

  // Cloudflare-style geo info (the worker reads request.cf?.country).
  try {
    adapted.cf = {
      country: request.headers.get("x-vercel-ip-country") || request.headers.get("cf-ipcountry") || null,
      city: request.headers.get("x-vercel-ip-city") || null,
      asOrganization: null
    };
  } catch (e) { /* non-fatal */ }

  return adapted;
}

export default async function handler(request, event) {
  const env = buildEnv();
  const ctx = {
    waitUntil(promise) {
      if (!promise || typeof promise.then !== "function") return;
      promise.catch(() => {});
      try {
        event?.waitUntil?.(promise);
      } catch (e) { /* fire-and-forget fallback */ }
    }
  };
  let adapted;
  try {
    adapted = await adaptRequest(request);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Request adaptation failed: " + e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
  return worker.fetch(adapted, env, ctx);
}
