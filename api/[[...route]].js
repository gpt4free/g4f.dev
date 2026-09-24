// Vercel Edge Function adapter for workers/api-worker.js (Cloudflare Worker).
//
// The worker is plain Web-API code (fetch/Request/Response/streams/crypto),
// so it runs unmodified on Vercel's edge runtime. This adapter only bridges
// the platform-specific parts:
//
//   1. Restores the original request path. This optional catch-all route
//      natively matches every /api/... request (no rewrites needed — a
//      same-application rewrite would deliver the destination path, not the
//      original one). The worker is mounted under /api/g4f-worker/... (a
//      prefix the worker itself never uses, so native /api/... calls stay
//      unambiguous); the prefix is stripped below.
//   2. Builds a Cloudflare-style `env` from Vercel environment variables,
//      with optional Upstash Redis backing for the KV / R2-shaped bindings.
//   3. Shims the Cloudflare-only `caches.default` Cache API, `ctx.waitUntil`
//      and `request.cf`.
//
// Bindings mapping (Cloudflare -> Vercel):
//   MEMBERS_KV, CAKE_KV   -> Upstash Redis (UPSTASH_REDIS_REST_URL/TOKEN)
//   MEMBERS_BUCKET        -> Upstash Redis (JSON-string values only)
//   USAGE_DB, ERRORS_DB   -> not available (worker degrades gracefully)
//   RATE_LIMIT            -> no-op stub (call site is disabled anyway)
//   PASS_API_KEY, YDC_API_KEY, AUDIO_API_KEY -> Vercel env vars

import worker from "../workers/api-worker.js";

export const config = { runtime: "edge" };

// ---- Cloudflare Cache API shim --------------------------------------------
// Vercel's edge runtime has no `caches.default`. The worker wraps every cache
// access in try/catch, so a no-op implementation simply disables the
// worker-level cache (Vercel CDN caching via Cache-Control still applies).
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
} catch (e) { /* cache stays disabled via the worker's own try/catch */ }

// ---- Upstash Redis KV / Bucket shims ---------------------------------------
// Maps the Cloudflare KV API (get/put/delete) used by the worker onto the
// Upstash REST API. Enabled by setting UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN; without them the bindings stay undefined and the
// worker degrades gracefully (no members/auth/cake-credit features).
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

// R2-shaped shim over the same Redis backend. The worker only ever stores and
// reads JSON strings on MEMBERS_BUCKET, so get() returns a minimal object
// with a json() method, mirroring the R2 object body API.
class UpstashBucket {
  constructor(kv) {
    this.kv = kv;
  }
  async get(path) {
    const value = await this.kv.get(path);
    if (value === null || value === undefined) return null;
    return {
      json: async () => JSON.parse(value)
    };
  }
  async put(path, value) {
    await this.kv.put(path, value);
  }
}

function buildEnv() {
  const env = {
    PASS_API_KEY: process.env.PASS_API_KEY,
    YDC_API_KEY: process.env.YDC_API_KEY,
    AUDIO_API_KEY: process.env.AUDIO_API_KEY,
    // Cloudflare rate-limiting binding — the only call site is behind an
    // `if (false)` in the worker, but provide a permissive stub regardless.
    RATE_LIMIT: {
      async limit() { return { success: true }; }
    }
  };
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (upstashUrl && upstashToken) {
    const kv = new UpstashKv(upstashUrl, upstashToken);
    env.MEMBERS_KV = kv;
    env.CAKE_KV = kv;
    env.MEMBERS_BUCKET = new UpstashBucket(kv);
  }
  return env;
}

// ---- request adaptation -----------------------------------------------------
// The worker is mounted at /api/g4f-worker/<original-path> (the optional
// catch-all route matches natively, so request.url still carries the true
// path). Strip that marker prefix and rebuild the URL against the forwarded
// host so cache keys, redirects and server-label routing see the original URL.
const MOUNT_PREFIX = "/g4f-worker";

async function adaptRequest(request) {
  const url = new URL(request.url);
  let pathname = url.pathname;
  if (pathname === `/api${MOUNT_PREFIX}` || pathname.startsWith(`/api${MOUNT_PREFIX}/`)) {
    pathname = pathname.slice(`/api${MOUNT_PREFIX}`.length) || "/";
  }
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(/:$/, "");
  const finalUrl = `${proto}://${host}${pathname}${url.search}`;

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

  // Cloudflare-style geo info. Vercel exposes country/city via
  // x-vercel-ip-* headers; there is no network-organization equivalent, so
  // asOrganization stays null (the BLOCKED_ORGS check simply never fires).
  try {
    adapted.cf = {
      country: request.headers.get("x-vercel-ip-country") || request.headers.get("cf-ipcountry") || null,
      city: request.headers.get("x-vercel-ip-city") || null,
      asOrganization: null
    };
  } catch (e) { /* non-fatal */ }

  return adapted;
}

// ---- execution context shim --------------------------------------------------
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
  const env = buildEnv();
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
  const url = new URL(adapted.url);
  // Vercel cron entry point (see "crons" in vercel.json) — runs the same
  // log-cleanup routine as the Cloudflare `scheduled` handler.
  if (url.pathname === "/cron/cleanup" || url.pathname === "/api/cron/cleanup") {
    await worker.scheduled({}, env, ctx);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
  return worker.fetch(adapted, env, ctx);
}
