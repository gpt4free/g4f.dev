// g4f.space router Worker.
//
// This is the entry point used by `npx wrangler deploy` from the repository
// root. It keeps the API worker, Puter worker, Pollinations worker and Ollama
// worker in one Cloudflare Worker deployment so that a single command can
// serve all of them:
//
//   https://g4f.space/v1                     -> API worker
//   https://g4f.space/api/puter/*            -> API worker -> Puter
//   https://g4f.space/api/pollinations/*     -> API worker -> Pollinations
//   https://g4f.space/api/community/*        -> API worker -> Pollinations (community tier)
//   https://g4f.space/api/ollama/*           -> API worker -> Ollama
//
//   https://puter.g4f.space/*                -> API worker -> Puter
//   https://pollinations.g4f.space/*         -> API worker -> Pollinations
//   https://community.g4f.space/*            -> API worker -> Pollinations (community tier)
//   https://ollama.g4f.space/*               -> API worker -> Ollama
//
// Every public request goes through the API worker first, so its auth, API-key
// handling, rate limits, credit gate and usage tracking are applied before a
// provider is called. The API worker invokes the provider modules directly via
// the PROVIDER_WORKERS registry below (no network hop, no recursion).
//
// Deploying this Worker does not upload the static site, which is what
// previously triggered the "Asset too large" error from Wrangler's automatic
// static-site detection.

import apiWorker from "./api-worker.js";
import puterWorker from "./puter-worker.js";
import pollinationsWorker from "./pollinations.js";
import ollamaWorker from "./ollama.js";

const PROVIDER_WORKERS = {
  puter: puterWorker,
  pollinations: pollinationsWorker,
  ollama: ollamaWorker
};

const PROVIDERS = [
  { name: "puter", hosts: new Set(["puter.g4f.space"]), prefix: "/api/puter" },
  { name: "pollinations", hosts: new Set(["pollinations.g4f.space"]), prefix: "/api/pollinations" },
  { name: "community", hosts: new Set(["community.g4f.space"]), prefix: "/api/community" },
  { name: "ollama", hosts: new Set(["ollama.g4f.space"]), prefix: "/api/ollama" }
];

const MAIN_HOSTS = new Set(["g4f.space", "www.g4f.space", "api.g4f.space"]);

const LOOP_HEADER = "x-g4f-worker-hop";

// A provider can only be entered once from the router. If the request comes
// back through the router a second time, the API worker is fetching the
// provider's public hostname instead of calling its bundled module; reject it
// with a clear 508 instead of letting Cloudflare time out with 522.
function loopResponse() {
  return Response.json({
    error: {
      message: "Provider routing loop detected. The API worker must call the bundled provider module, not its public subdomain.",
      type: "routing_loop"
    }
  }, {
    status: 508,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    }
  });
}

// Give the API worker direct access to the provider modules. Spreading keeps
// the normal Cloudflare bindings (KV, D1, R2, vars) intact.
function apiEnv(env) {
  return { ...env, PROVIDER_WORKERS };
}

// Map a provider subdomain request onto the shared-host /api/<provider> route
// so the API worker's normal provider handling (and limits) applies.
function rewriteSubdomain(request, provider) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== provider.prefix && !path.startsWith(provider.prefix + "/")) {
    url.pathname = provider.prefix + (path === "/" ? "" : path);
  }
  // Run the request through the API worker's main-host path, not its
  // <provider>.g4f.space subdomain branch, so auth and rate limits apply.
  url.hostname = "g4f.space";
  const hop = Number.parseInt(request.headers.get(LOOP_HEADER) || "0", 10);
  const rewritten = new Request(url, request);
  const headers = new Headers(rewritten.headers);
  headers.set(LOOP_HEADER, String(hop + 1));
  return new Request(rewritten, { headers });
}

export default {
  async fetch(request, env, ctx) {
    const hop = Number.parseInt(request.headers.get(LOOP_HEADER) || "0", 10);
    if (hop >= 1) {
      return loopResponse();
    }
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const provider = PROVIDERS.find((entry) => entry.hosts.has(host));
    if (provider && !MAIN_HOSTS.has(host)) {
      return apiWorker.fetch(rewriteSubdomain(request, provider), apiEnv(env), ctx);
    }
    return apiWorker.fetch(request, apiEnv(env), ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof apiWorker.scheduled === "function") {
      return apiWorker.scheduled(event, apiEnv(env), ctx);
    }
  }
};
