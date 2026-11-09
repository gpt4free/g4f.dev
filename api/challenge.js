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
// Vercel's edge runtime has no Cloudflare `caches.default` Cache API, so a
// module-scope cache with TTL + LRU-ish eviction stands in for it. It keeps
// the environment shape identical to api/worker.js and gives the worker a
// real (per-isolate) cache instead of the previous no-op.
//
// Note: this shim is *not* what makes the route cacheable. The worker's own
// per-isolate memory cache plus the `Cache-Control` headers it sets are —
// Vercel's edge network honors those headers (s-maxage/max-age) for public
// GETs, which is where cross-isolate reuse happens.
const CACHE_SHIM_TTL = 3600 * 1000;
const CACHE_SHIM_MAX_ENTRIES = 100;
const cacheShim = new Map();

try {
  if (typeof globalThis.caches === "undefined" || !globalThis.caches.default) {
    globalThis.caches = {
      ...(globalThis.caches || {}),
      default: {
        async match(request) {
          const key = typeof request === "string" ? request : request.url;
          const entry = cacheShim.get(key);
          if (!entry) return undefined;
          if (entry.expires <= Date.now()) {
            cacheShim.delete(key);
            return undefined;
          }
          // A cached Response body can only be read once — hand out a clone.
          return entry.response.clone();
        },
        async put(request, response) {
          const key = typeof request === "string" ? request : request.url;
          while (cacheShim.size >= CACHE_SHIM_MAX_ENTRIES) {
            cacheShim.delete(cacheShim.keys().next().value);
          }
          cacheShim.set(key, { response: response.clone(), expires: Date.now() + CACHE_SHIM_TTL });
        },
        async delete(request) {
          const key = typeof request === "string" ? request : request.url;
          return cacheShim.delete(key);
        }
      }
    };
  }
} catch (e) { /* cache stays disabled */ }

// ---- Upstash Redis KV shim --------------------------------------------------
// Maps the Cloudflare KV API (get/put/delete) used by the worker onto the
// Upstash REST API. Enabled by setting UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN; without them the binding stays undefined and
// the worker degrades gracefully (feature disabled).
//
// Upstash reports Redis errors in the JSON body, sometimes with HTTP 200
// (`{"error": "ERR ..."}`). Treating those as success returned `undefined`
// and made the worker cache an empty translation store. Plan-limit errors
// are also sticky: retrying every request keeps burning the exhausted quota
// and hides the outage. We therefore throw on any `error` field and back off
// for a few minutes after a quota error. The instance is reused per isolate
// so the cooldown survives across requests.
const UPSTASH_COOLDOWN_MS = 5 * 60 * 1000;
const QUOTA_ERROR_RE = /plan limits|upgrade|quota|out of memory|max memory|limit reached|too many requests/i;

export class UpstashKv {
  constructor(url, token) {
    this.url = url.replace(/\/$/, "");
    this.token = token;
    this.lastError = null;
    this.quotaExceeded = false;
    this.cooldownUntil = 0;
  }
  get coolingDown() {
    return this.cooldownUntil > Date.now();
  }
  noteError(error) {
    this.lastError = String(error && error.message ? error.message : error);
    this.quotaExceeded = QUOTA_ERROR_RE.test(this.lastError);
    // Plan limits only clear when the operator upgrades or the billing
    // window resets; a short cooldown stops a request storm in the meantime.
    if (this.quotaExceeded) {
      this.cooldownUntil = Date.now() + UPSTASH_COOLDOWN_MS;
    }
  }
  async command(args) {
    if (this.coolingDown) {
      throw new Error(this.lastError || "Upstash KV is cooling down after a quota error");
    }
    let res;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(args)
      });
    } catch (e) {
      this.noteError(e);
      throw e;
    }
    const text = await res.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!res.ok || (payload && payload.error)) {
      const detail = payload && payload.error ? payload.error : (text || `HTTP ${res.status}`);
      const error = new Error(`Upstash ${res.status}: ${detail}`);
      this.noteError(error);
      throw error;
    }
    this.lastError = null;
    this.quotaExceeded = false;
    return payload ? payload.result : undefined;
  }
  /** Lightweight reachability probe used by /challenge/health and before
   *  issuing challenges. Reports the quota state so clients can show a
   *  useful message instead of a generic outage. */
  async health() {
    if (this.coolingDown) {
      return {
        ok: false,
        error: this.lastError,
        quota_exceeded: this.quotaExceeded,
        retry_after_s: Math.max(1, Math.ceil((this.cooldownUntil - Date.now()) / 1000)),
      };
    }
    try {
      await this.command(["PING"]);
      return { ok: true };
    } catch (e) {
      console.error("KV health check failed:", e);
      return {
        ok: false,
        error: this.lastError || String(e),
        quota_exceeded: this.quotaExceeded,
      };
    }
  }
  /** Strict read that propagates storage errors. The translation store uses
   *  this to distinguish an empty store from an unreachable one. */
  async getStrict(key) {
    return await this.command(["GET", key]);
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
  // Cloudflare-KV-shaped list({prefix, cursor, limit}) via SCAN. Returns
  // {keys: [{name}], list_complete, cursor?} so workers can enumerate keys.
  async list(options = {}) {
    const prefix = options.prefix || "";
    const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 1000);
    const args = ["SCAN", String(options.cursor || "0"), "COUNT", String(limit)];
    if (prefix) args.push("MATCH", `${prefix}*`);
    try {
      const [cursor, keys] = await this.command(args);
      return {
        keys: (keys || []).map((name) => ({ name })),
        list_complete: cursor === "0",
        ...(cursor !== "0" ? { cursor } : {}),
      };
    } catch (e) {
      this.lastError = String(e);
      console.error("KV list failed:", e);
      return { keys: [], list_complete: true };
    }
  }
}

// Vercel Blob KV shim (fallback when no Upstash vars are set).
// Blob is an object store without native TTL, so expiration is emulated:
// values written with a TTL are wrapped as {"v": <value>, "e": <expiresMs>}
// and get() treats expired entries as missing (lazily deleting them).
// Only BLOB_READ_WRITE_TOKEN is required — the token is store-scoped.
class BlobKv {
  constructor(token, options = {}) {
    this.token = token;
    this.base = "https://blob.vercel-storage.com";
    this.api = "https://vercel.com/api/blob";
    // Blob stores are either public or private at creation time. Private
    // stores require the access header and serve reads from the store's
    // authenticated host, so keep the store id and detect the mode lazily.
    this.storeId = String(options.storeId || process.env.BLOB_STORE_ID || "")
      .trim()
      .replace(/^store_/, "");
    this.access = options.access || process.env.BLOB_ACCESS || null;
  }
  headers(extra = {}) {
    const headers = {
      "Authorization": `Bearer ${this.token}`,
      "x-api-version": "12",
      ...extra
    };
    if (this.storeId) headers["x-vercel-blob-store-id"] = this.storeId;
    if (this.access) headers["x-vercel-blob-access"] = this.access;
    return headers;
  }
  url(key, access = this.access) {
    const encoded = encodeURIComponent(key);
    if (this.storeId && access) {
      return `https://${this.storeId}.${access}.blob.vercel-storage.com/${encoded}`;
    }
    return `${this.base}/${encoded}`;
  }
  async get(key) {
    try {
      // Reads live on the store host, one subdomain per access mode. Try the
      // configured mode first; without one, probe private and public so a
      // private store works even before the first write detected its mode.
      const attempts = this.access ? [this.access] : ["private", "public"];
      let response = null;
      for (const access of attempts) {
        const res = await fetch(this.url(key, access), {
          headers: { "Authorization": `Bearer ${this.token}` }
        });
        if (res.status === 404) continue;
        if (!res.ok) throw new Error(`Blob ${res.status}: ${await res.text()}`);
        this.access = access;
        response = res;
        break;
      }
      if (!response) return null;
      const raw = await response.text();
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && "v" in parsed) {
          if (typeof parsed.e === "number" && parsed.e < Date.now()) {
            await this.delete(key); // lazy TTL cleanup
            return null;
          }
          return parsed.v;
        }
        return raw; // legacy/plain value without wrapper
      } catch {
        return raw;
      }
    } catch (e) {
      console.error("Blob KV get failed:", e);
      return null;
    }
  }
  async put(key, value, options = {}) {
    const ttl = options?.expirationTtl;
    const body = ttl
      ? JSON.stringify({ v: String(value), e: Date.now() + Math.max(1, Math.floor(ttl)) * 1000 })
      : String(value);
    const params = new URLSearchParams({ pathname: key });
    const attempt = (access) => fetch(`${this.api}/?${params.toString()}`, {
      method: "PUT",
      headers: this.headers({
        "x-content-type": "text/plain; charset=utf-8",
        // Deterministic paths — a KV key must overwrite, not version.
        "x-add-random-suffix": "0",
        "x-allow-overwrite": "1",
        ...(access ? { "x-vercel-blob-access": access } : {})
      }),
      body
    });
    try {
      let res = await attempt(this.access);
      if (!res.ok && !this.access) {
        const detail = await res.text();
        // An unconfigured access mode defaults to public. Retry a private
        // store once with the matching header, then remember the mode.
        if (/private store/i.test(detail)) {
          this.access = "private";
          res = await attempt("private");
        } else {
          throw new Error(`Blob ${res.status}: ${detail}`);
        }
      }
      if (!res.ok) throw new Error(`Blob ${res.status}: ${await res.text()}`);
    } catch (e) {
      console.error("Blob KV put failed:", e);
    }
  }
  async delete(key) {
    try {
      const params = new URLSearchParams({ pathname: key });
      await fetch(`${this.api}/?${params.toString()}`, {
        method: "DELETE",
        headers: this.headers()
      });
    } catch (e) {
      console.error("Blob KV delete failed:", e);
    }
  }
  /** List blob paths (used by the translation fallback). Vercel Blob pages
   *  with an opaque cursor, mirroring the Cloudflare KV list shape. */
  async list(options = {}) {
    const prefix = options.prefix || "";
    const limit = Math.min(Math.max(Number(options.limit) || 1000, 1), 1000);
    const params = new URLSearchParams({ limit: String(limit) });
    if (prefix) params.set("prefix", prefix);
    if (options.cursor) params.set("cursor", options.cursor);
    try {
      const res = await fetch(`${this.api}?${params.toString()}`, {
        headers: this.headers()
      });
      if (!res.ok) throw new Error(`Blob ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return {
        keys: (data.blobs || []).map((blob) => ({
          name: String(blob.pathname || "").replace(/^\/+/, ""),
        })),
        list_complete: !data.hasMore,
        ...(data.cursor ? { cursor: data.cursor } : {}),
      };
    } catch (e) {
      console.error("Blob KV list failed:", e);
      return { keys: [], list_complete: true };
    }
  }
  async health() {
    try {
      const res = await fetch(`${this.api}?limit=1`, {
        headers: this.headers()
      });
      if (!res.ok) throw new Error(`Blob ${res.status}: ${await res.text()}`);
      return { ok: true };
    } catch (e) {
      console.error("Blob KV health check failed:", e);
      return { ok: false, error: String(e) };
    }
  }
}

// Reuse the shim per isolate so its quota cooldown/error state is preserved
// across requests. Tokens stay in memory only and are never logged.
const upstashInstances = new Map();
function upstashKv(url, token) {
  const key = `${url}\n${token}`;
  let kv = upstashInstances.get(key);
  if (!kv) {
    kv = new UpstashKv(url, token);
    upstashInstances.set(key, kv);
  }
  return kv;
}

function buildEnv() {
  const env = {
    CHALLENGE_SECRET: process.env.CHALLENGE_SECRET,
    CHALLENGE_JWT_SECRET: process.env.CHALLENGE_JWT_SECRET,
    CAKE_CREDIT_CENTS: process.env.CAKE_CREDIT_CENTS,
    CHALLENGE_PER_IP_PER_DAY: process.env.CHALLENGE_PER_IP_PER_DAY,
    CHALLENGE_MAX_PER_DAY: process.env.CHALLENGE_MAX_PER_DAY,
    CHALLENGE_TTL_SEC: process.env.CHALLENGE_TTL_SEC,
    CAKE_WORKER_URL: process.env.CAKE_WORKER_URL,
    ADMIN_API_KEY: process.env.ADMIN_API_KEY
  };
  // KV backend selection. Vercel Marketplace/Integration variables are
  // PREFIXED with the store name — e.g. a store named "cake-kv" exposes
  // CAKE_KV_KV_REST_API_URL / CAKE_KV_KV_REST_API_TOKEN (and a read-only
  // CAKE_KV_KV_REST_API_READ_ONLY_TOKEN). We detect any *_KV_REST_API_URL
  // and use its matching token, preferring read-write over read-only.
  // Plain UPSTASH_REDIS_REST_URL/TOKEN and unprefixed KV_REST_API_* are
  // also accepted. Vercel Blob (BLOB_READ_WRITE_TOKEN) is used for the
  // translation mirror even when Upstash is the primary KV, and becomes the
  // primary only when no Upstash pair is configured. A Blob-only ledger is
  // store-local and NOT shared with the Cloudflare cake worker.
  const upstashCandidates = [];
  for (const [name, value] of Object.entries(process.env)) {
    const match = name.match(/^(.*)_KV_REST_API_URL$/);
    if (match && value) {
      const prefix = match[1]; // e.g. "CAKE_KV" or "UPSTASH_REDIS"
      const rwToken = process.env[`${prefix}_KV_REST_API_TOKEN`];
      const roToken = process.env[`${prefix}_KV_REST_API_READ_ONLY_TOKEN`];
      upstashCandidates.push({
        url: value,
        token: rwToken || roToken,
        source: prefix === "UPSTASH_REDIS" ? "upstash" : `marketplace:${prefix.toLowerCase()}`,
        readWrite: Boolean(rwToken),
      });
    }
  }
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    upstashCandidates.push({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
      source: "upstash",
      readWrite: true,
    });
  }
  // Prefer read-write bindings, then the store literally named for this use.
  upstashCandidates.sort((a, b) => (b.readWrite - a.readWrite) || (b.source < a.source ? -1 : 1));
  const upstash = upstashCandidates[0];
  const blob = process.env.BLOB_READ_WRITE_TOKEN
    ? new BlobKv(process.env.BLOB_READ_WRITE_TOKEN, {
        storeId: process.env.BLOB_STORE_ID,
        access: process.env.BLOB_ACCESS
      })
    : null;
  if (upstash && upstash.token) {
    env.CAKE_KV = upstashKv(upstash.url, upstash.token);
    // Non-secret diagnostic for /challenge/health: which variable pair backed
    // the binding (values are never exposed).
    env.CHALLENGE_KV_SOURCE = upstash.source;
    // Keep a Blob copy of the community translations. Challenge state stays
    // in Upstash only: if it is offline, issue/solve/redeem are paused, but
    // the UI can still read translations from this mirror.
    if (blob) {
      env.CHALLENGE_TRANSLATIONS_KV = blob;
      env.CHALLENGE_TRANSLATIONS_SOURCE = "blob";
    }
  } else if (blob) {
    env.CAKE_KV = blob;
    env.CHALLENGE_KV_SOURCE = "blob";
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
