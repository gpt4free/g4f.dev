/**
 * OllamaSwarm Cloudflare Worker
 *
 * OpenAI-compatible proxy that routes requests across hundreds of public Ollama
 * servers discovered from a seed list and cached in Workers KV.
 *
 * Endpoints:
 *   GET  /v1/models                – list available models (sorted by availability)
 *   POST /v1/chat/completions      – chat completions with streaming support
 *   POST /refresh                  – force re-discovery (useful for cron warm-up)
 *
 * Environment bindings (wrangler.toml):
 *   OLLAMA_CACHE   – Workers KV namespace (optional but strongly recommended)
 *   API_KEY        – Bearer token to restrict access (optional)
 */

// ---------------------------------------------------------------------------
// Seed servers — public Ollama instances
// ---------------------------------------------------------------------------
const DEFAULT_SEED_SERVERS = [
    "http://38.76.189.31.nip.io:11434",
    "http://38.76.189.74.nip.io:11434",
    "http://62.238.14.177.nip.io:11434",
    "http://13.140.143.210.nip.io:11434",
    "http://38.76.189.45.nip.io:11434",
    "http://167.71.147.184.nip.io:11434",
    "http://136.243.60.49.nip.io:11434",
    "http://213.136.76.182.nip.io:11434",
    "http://38.76.189.19.nip.io:11434",
    "http://90.149.239.71.nip.io:11434",
    "http://155.133.208.195.nip.io:11434",
    "http://38.76.189.21.nip.io:11434",
    "http://38.76.189.9.nip.io:11434",
    "http://46.224.203.89.nip.io:11434",
    "http://38.76.189.41.nip.io:11434",
    "http://38.76.189.97.nip.io:11434",
    "http://27.92.231.18.nip.io:11434",
    "http://75.128.229.121.nip.io:11434",
    "http://193.237.205.200.nip.io:11434",
    "http://38.76.189.18.nip.io:11434",
    "http://158.101.214.195.nip.io:11434",
    "http://51.254.130.116.nip.io:11434",
    "http://42.2.14.131.nip.io:11434",
    "http://116.208.212.11.nip.io:11434",
    "http://61.140.16.147.nip.io:11434",
    "http://114.254.25.58.nip.io:11434",
    "http://203.111.214.218.nip.io:11434",
    "http://1.64.254.40.nip.io:11434",
    "http://120.126.17.106.nip.io:11434",
    "http://220.133.154.29.nip.io:11434",
    "http://47.83.22.245.nip.io:11434",
    "http://49.213.207.138.nip.io:11434",
    "http://116.49.62.25.nip.io:11434",
    "http://180.109.253.192.nip.io:11434",
    "http://140.112.99.178.nip.io:11434",
    "http://223.84.152.142.nip.io:11434",
    "http://182.40.33.227.nip.io:11434",
    "http://106.12.155.130.nip.io:11434",
    "http://212.227.162.96.nip.io:11434",
    "http://46.101.110.71.nip.io:11434",
    "http://142.132.199.240.nip.io:11434",
    "http://78.46.72.53.nip.io:11434",
    "http://92.5.49.200.nip.io:11434",
    "http://87.118.114.254.nip.io:11434",
    "http://51.89.6.222.nip.io:11434",
    "http://45.90.121.7.nip.io:11434",
    "http://2.56.246.156.nip.io:11434",
    "http://92.5.66.2.nip.io:11434",
    "http://84.46.254.215.nip.io:11434",
    "http://155.133.208.198.nip.io:11434",
    "http://51.75.64.79.nip.io:11434",
    "http://92.5.2.87.nip.io:11434",
    "http://87.118.115.254.nip.io:11434",
    "http://37.46.19.85.nip.io:11434",
    "http://85.215.239.154.nip.io:11434",
    "http://167.86.80.58.nip.io:11434",
    "http://159.195.73.99.nip.io:11434",
    "http://5.9.86.204.nip.io:11434",
    "http://49.12.80.87.nip.io:11434",
    "http://46.4.69.107.nip.io:11434",
    "http://164.92.193.44.nip.io:11434",
    "http://212.227.49.17.nip.io:11434",
    "http://178.105.63.139.nip.io:11434",
    "http://162.55.84.42.nip.io:11434",
    "http://94.103.173.64.nip.io:11434",
    "http://89.168.67.184.nip.io:11434",
    "http://46.224.197.52.nip.io:11434",
    "http://178.104.247.221.nip.io:11434",
    "http://158.101.181.50.nip.io:11434",
    "http://178.105.164.192.nip.io:11434",
    "http://92.5.134.191.nip.io:11434",
    "http://138.199.216.235.nip.io:11434",
    "http://136.243.81.62.nip.io:11434",
    "http://46.224.108.17.nip.io:11434",
    "http://217.154.83.136.nip.io:11434",
    "http://130.61.30.59.nip.io:11434",
    "http://188.245.175.189.nip.io:11434",
    "http://87.120.166.139.nip.io:11434",
    "http://148.251.137.44.nip.io:11434",
    "http://148.251.136.233.nip.io:11434",
    "http://46.4.57.97.nip.io:11434",
    "http://195.201.100.12.nip.io:11434",
    "http://78.159.122.2.nip.io:11434",
    "http://217.20.124.139.nip.io:11434",
    "http://91.98.64.45.nip.io:11434",
    "http://5.9.85.18.nip.io:11434",
    "http://91.98.65.172.nip.io:11434",
    "http://85.214.231.56.nip.io:11434",
    "http://188.245.166.90.nip.io:11434",
    "http://167.99.135.175.nip.io:11434",
    "http://162.19.244.62.nip.io:11434",
    "http://178.105.4.216.nip.io:11434",
    "http://2.56.246.214.nip.io:11434",
    "http://155.133.208.196.nip.io:11434",
    "http://155.133.208.194.nip.io:11434",
    "http://178.104.64.166.nip.io:11434",
    "http://91.98.200.119.nip.io:11434",
    "http://217.160.69.10.nip.io:11434",
    "http://45.84.197.109.nip.io:11434",
    "http://178.105.30.2.nip.io:11434",
    "http://5.9.73.92.nip.io:11434",
    "http://57.129.77.185.nip.io:11434",
    "http://83.229.84.234.nip.io:11434",
    "http://213.165.73.127.nip.io:11434",
    "http://188.245.40.20.nip.io:11434",
    "http://148.251.179.45.nip.io:11434",
    "http://87.106.223.47.nip.io:11434",
    "http://188.245.250.200.nip.io:11434",
    "http://45.157.234.103.nip.io:11434",
    "http://88.198.64.194.nip.io:11434",
    "http://162.55.176.246.nip.io:11434",
    "http://167.172.170.114.nip.io:11434",
    "http://5.9.65.28.nip.io:11434",
    "http://80.147.139.148.nip.io:11434",
    "http://85.214.180.6.nip.io:11434",
    "http://91.99.156.133.nip.io:11434",
    "http://88.198.51.59.nip.io:11434",
    "http://27.123.245.129.nip.io:11434",
    "http://135.125.219.74.nip.io:11434",
    "http://178.104.85.109.nip.io:11434",
    "http://46.225.154.68.nip.io:11434",
    "http://87.106.217.148.nip.io:11434",
    "http://148.251.14.46.nip.io:11434",
    "http://88.99.101.247.nip.io:11434",
    "http://91.98.138.15.nip.io:11434",
    "http://168.119.164.92.nip.io:11434",
    "http://88.99.67.122.nip.io:11434",
    "http://79.76.125.155.nip.io:11434",
    "http://178.104.175.204.nip.io:11434",
    "http://167.86.72.234.nip.io:11434",
    "http://167.235.75.8.nip.io:11434",
    "http://49.12.145.53.nip.io:11434",
    "http://88.99.98.12.nip.io:11434",
    "http://212.227.21.255.nip.io:11434",
    "http://116.202.156.222.nip.io:11434",
    "http://88.198.7.117.nip.io:11434",
    "http://5.45.101.216.nip.io:11434",
    "http://167.86.80.235.nip.io:11434",
    "http://78.47.201.172.nip.io:11434",
    "http://46.225.60.15.nip.io:11434",
    "http://46.225.67.36.nip.io:11434",
    "http://130.61.46.60.nip.io:11434",
    "http://212.56.46.225.nip.io:11434"
];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PROBE_TIMEOUT_MS = 5_000;
const TTFT_TIMEOUT_MS = 10_000;
const DEFAULT_MODEL = {
  "/v1/chat/completions": "deepseek-v4-pro:cloud",
  "/v1/images/generations": "x/flux2-klein:latest",
  "/v1/embeddings": "nomic-embed-text:latest"
};
const PROBE_BATCH_SIZE = 15; // CF Workers: max ~50 simultaneous outbound connections
const NO_CACHE_HEADER = {"Cache-Control": "no-cache, no-store, must-revalidate"};
// ---------------------------------------------------------------------------
// Server probing
// ---------------------------------------------------------------------------

/** Probe one Ollama server. Returns { url, models } or null. */
async function probeServer(url) {
  try {
    const resp = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!resp.ok) return { url, error: resp.status};
    const data = await resp.json();
    const models = (data.models || [])
      .map((m) => m.name || "")
      .filter(
        (name) =>
          name &&
          !name.includes("/attacker/") &&
          !name.startsWith("model-b")
      );
    if (models.length > 0) return { url, models };
    else return {url, error: data}
  } catch(e) {
      return { url, error: e.message};
  }
}

/**
 * Run probe on a list of candidates in PROBE_BATCH_SIZE batches,
 * respecting CF Workers' concurrent-connection limit.
 */
async function probeBatched(candidates, step = 0) {
  const alive = {};
  const batch = candidates.slice(step * PROBE_BATCH_SIZE, (step * PROBE_BATCH_SIZE) + PROBE_BATCH_SIZE);
  const results = await Promise.allSettled(batch.map(probeServer));
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.models) {
      alive[r.value.url] = r.value.models;
    }
  }
  return alive;
}

/**
 * Return alive servers → models map.
 * Uses KV daily cache when available, falls back to live probing.
 */
let cachedAlive = {}; // In-memory cache for the duration of the worker instance
let cachedStep = 0;
let workingModels = null;
let publicServers = null;
function shuffleObject(obj) {
    const entries = Object.entries(obj);
    for (let i = entries.length - 1; i > 0; i--) {
        const j = 
            Math.floor(Math.random() * (i + 1));
        [entries[i], entries[j]] = 
            [entries[j], entries[i]];
    }
    return Object.fromEntries(entries);
}
function shuffleArray(array) {
    for (var i = array.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
    return array;
}
async function discoverServers(env) {
  const cacheRequest = new Request(`https://cache.example/servers`, {
    method: "GET"
  });
  if (!cachedStep) {
    const cachedResponse = await caches.default.match(cacheRequest);
    if (cachedResponse) {
      const cachedData = await cachedResponse.json();
      cachedStep = cachedData.cachedStep;
      cachedAlive = shuffleObject(cachedData.cachedAlive);
    }
  }
  
  if (cachedStep * PROBE_BATCH_SIZE >= DEFAULT_SEED_SERVERS.length) return false;

  const alive = await probeBatched(DEFAULT_SEED_SERVERS, cachedStep);

  if (Object.keys(alive).length > 0) {
    cachedAlive = Object.assign(cachedAlive, alive);
  }

  const responseToCache = Response.json({cachedAlive, cachedStep})
  responseToCache.headers.set("Cache-Control", "public, max-age=86400");
  await caches.default.put(cacheRequest, responseToCache);

  if (!publicServers) {
    try {
      const url = "https://g4f.space/custom/api/servers/public";
      const response = await fetch(url);
      const publicList = await response.json();
      publicServers = publicList.servers.filter(s=>s.is_ollama&&s.is_online);
    } catch(e) {
      console.error(e);
    }
  }

  cachedStep += 1;
  return true;
}

// ---------------------------------------------------------------------------
// Model map helpers
// ---------------------------------------------------------------------------

/** Build { modelToServers, modelCount } from the alive map. */
function buildModelMap(alive) {
  const modelToServers = {};
  const modelCount = {};
  for (const [serverUrl, models] of Object.entries(alive)) {
    for (const model of models) {
      if (!modelToServers[model]) modelToServers[model] = [];
      modelToServers[model].push(serverUrl);
      modelCount[model] = (modelCount[model] || 0) + 1;
    }
  }
  for (const server of publicServers) {
    try {
      const url = new URL(server.base_url);
      for (const model of server.allowed_models) {
        if (!modelToServers[model]) modelToServers[model] = [];
        modelToServers[model].push(url.origin);
        modelCount[model] = (modelCount[model] || 0) + 1;
      }
    } catch(e) {
      console.error(e);
    }
  }
  return { modelToServers, modelCount };
}

// ---------------------------------------------------------------------------
// Upstream request helpers
// ---------------------------------------------------------------------------

/**
 * Forward a chat-completions request to one upstream Ollama server.
 *
 * For streaming responses, enforces a TTFT (time-to-first-token) timeout:
 * if the first chunk doesn't arrive within TTFT_TIMEOUT_MS the request is
 * aborted and an error is thrown so the caller can try another server.
 *
 * Throws an object with `{ statusCode, responseText }` for HTTP errors, or a
 * plain Error for timeouts and network failures.
 */
async function forwardToServer(serverUrl, model, bodyObj, pathname) {
  const controller = new AbortController();

  const upResp = await fetch(`${serverUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...bodyObj, model }),
    signal: controller.signal,
  });

  if (!upResp.ok) {
    return upResp;
  }

  // Non-streaming: return the response directly
  if (!bodyObj.stream) {
    return new Response(upResp.body, {
      status: upResp.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Streaming: race the first chunk against a TTFT deadline
  const reader = upResp.body.getReader();
  let firstRead;
  try {
    firstRead = await Promise.race([
      reader.read(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("TTFT timeout: model took >10 s to start")),
          TTFT_TIMEOUT_MS
        )
      ),
    ]);
  } catch (e) {
    reader.cancel();
    controller.abort();
    throw e;
  }

  if (firstRead.done) {
    // Upstream closed the stream immediately (no content)
    return new Response("", { status: 200 });
  }

  const firstChunk = firstRead.value;

  // Pipe the rest of the stream, prepending the first chunk
  const stream = new ReadableStream({
    async start(ctrl) {
      ctrl.enqueue(firstChunk);
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          ctrl.enqueue(value);
        }
      } catch {
        // Ignore read errors (client disconnect, etc.)
      } finally {
        ctrl.close();
      }
    },
    cancel() {
      reader.cancel();
      controller.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Transfer-Encoding": "chunked",
    },
  });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleModels(env) {
  const isLoading = await discoverServers(env);
  const { modelCount } = buildModelMap(cachedAlive);

  const ts = Math.floor(Date.now() / 1000);
  const data = Object.entries(modelCount)
    .sort(([, a], [, b]) => b - a)
    .map(([id, c]) => ({
      id,
      object: "model",
      created: ts,
      owned_by: "ollama-swarm",
      count: c
    }));

  return Response.json({ object: "list", data }, {headers: isLoading ? NO_CACHE_HEADER : {}});
}

async function handleServers(env, all = false) {
  const loading = await discoverServers(env);
  const data = all ? cachedAlive : Object.keys(cachedAlive)
  return Response.json({
    data,
    public_servers: publicServers.map(s=>new URL(s.base_url).origin),
    loading,
    offset: cachedStep * PROBE_BATCH_SIZE,
    total: DEFAULT_SEED_SERVERS.length,
    working: await getWorkingModels()
  }, { headers: NO_CACHE_HEADER});
}
async function getWorkingModels() {
  const cachedResponse = await caches.default.match(new Request(`https://cache.example/working`));
  if (cachedResponse) {
    return await cachedResponse.json();
  }
}
let modelToServersCache = null;
async function handleChatCompletions(request, env, pathname, ctx) {
  let bodyObj;
  try {
    bodyObj = await request.json();
  } catch {
    return Response.json(
      { error: { message: "Invalid JSON body", type: "invalid_request_error" } },
      { status: 400 }
    );
  }

  const model = bodyObj.model || DEFAULT_MODEL[pathname];
  if (!model) {
    return Response.json(
      { error: { message: "Missing model name", type: "invalid_request_error" } },
      { status: 400 }
    );
  }
  const loading = await discoverServers(env);
  const { modelToServers } = buildModelMap(cachedAlive);
  
  const serverUrls = shuffleArray(modelToServers[model]);
  if (!serverUrls || serverUrls.length === 0) {
    const available = Object.keys(modelToServersCache).slice(0, 15).join(", ");
    return Response.json(
      {
        error: {
          message: `Model '${model}' not found. Available: ${available || "(none discovered yet)"}`,
          type: "invalid_request_error",
        },
      },
      { status: 404 }
    );
  }

  let lastError = "";
  let errorCount = 0;
  if (!workingModels) {
      workingModels = await getWorkingModels();
  }
  let workingServers = shuffleArray((workingModels && workingModels[model]) ? workingModels[model] : []);
  for (const serverUrl of serverUrls) {
    try {
      if ((loading || errorCount > 5) && workingServers.length > 0) {
        for (const workingServer of workingServers) {
          const resp = await forwardToServer(workingServer, model, bodyObj, pathname);
          if (!resp.ok) {
            let message;
            try {
              message = (await resp.clone().json()).error?.message;
            } catch {}
            lastError = message || await resp.text();
            errorCount += 1;
            continue;
          }
          return resp;
        }
        workingServers = [];
      }
      const resp = await forwardToServer(serverUrl, model, bodyObj, pathname);
      if (!resp.ok) {
        let message;
        try {
          message = (await resp.clone().json()).error?.message;
        } catch {}
        throw Object.assign(new Error(message || await resp.text()), { status: resp.status})
      }
      if (!workingModels) {
        workingModels = {};
      }
      if (!workingModels[model]) {
        workingModels[model] = [];
      }
      if (!workingModels[model].includes(serverUrl)) {
        workingModels[model].push(serverUrl);
        const responseToCache = Response.json(workingModels);
        responseToCache.headers.set("Cache-Control", "public, max-age=86400");
        ctx.waitUntil(caches.default.put(new Request(`https://cache.example/working`), responseToCache));
      }
      return resp;
    } catch (e) {
      // 400 = server alive but model invalid — no point retrying other servers
      if (e.status === 400) {
        return Response.json(
          {
            error: {
              message: e.message || "Bad request",
              type: "invalid_request_error",
            },
          },
          { status: 400 }
        );
      }
      lastError = e.message;
      errorCount += 1;
      if (errorCount >= (loading ? 5 : 20)) {
        break;
      }
      // Try next server
    }
  }

  return Response.json(
    {
      error: {
        message: `All servers failed (${errorCount}/${serverUrls.length}): ${lastError}`,
        type: "server_error",
      },
    },
    { status: 503 }
  );
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

function isAuthorized(request, env) {
  if (!env.API_KEY) return true; // No key configured → open access
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token === env.API_KEY;
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function withCors(response) {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    r.headers.set(k, v);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default {
  /** HTTP fetch handler */
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (!isAuthorized(request, env)) {
      return withCors(
        Response.json(
          { error: { message: "Unauthorized", type: "auth_error" } },
          { status: 401 }
        )
      );
    }

    const { pathname } = new URL(request.url);
    let response;

    if (pathname.endsWith("/models") && request.method === "GET") {
      response = await handleModels(env);
    } else if ((pathname === "/servers" || pathname === "/quota") && request.method === "GET") {
      response = await handleServers(env);
    } else if (pathname === "/servers/all" && request.method === "GET") {
      response = await handleServers(env, true);
    } else if (
      (pathname.endsWith("/chat/completions") || pathname === "/") &&
      request.method === "POST"
    ) {
      response = await handleChatCompletions(request, env, '/v1/chat/completions', ctx);
    } else if (
      pathname.endsWith("/images/generations") &&
      request.method === "POST"
    ) {
      response = await handleChatCompletions(request, env, '/v1/images/generations', ctx);
      ///v1/embeddings
    }  else if (
      pathname.endsWith("/embeddings") &&
      request.method === "POST"
    ) {
      response = await handleChatCompletions(request, env, '/v1/embeddings', ctx);
    } else if (pathname === "/" || pathname === "/health") {
      response = Response.json({ status: "ok", service: "ollama-swarm" });
    } else {
      response = new Response("Not Found", { status: 404 });
    }

    return withCors(response);
  }
};
