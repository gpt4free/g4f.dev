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
// Duplicates are deduplicated at runtime via Set.
// ---------------------------------------------------------------------------
const _SEED_LIST = [
  "http://172.168.53.235.nip.io",
  "http://143.223.252.208.nip.io",
  "https://81.151.201.23.nip.io",
  "http://20.118.15.50.nip.io",
  "https://81.151.201.23.nip.io",
  "http://111.206.235.125.nip.io:8080",
  "http://111.206.235.125.nip.io:8080",
  "http://93.87.60.133.nip.io:30005",
  "http://42.2.170.244.nip.io",
  "http://110.86.160.115.nip.io:6001",
  "http://8.141.151.0.nip.io:8080",
  "http://83.24.140.56.nip.io:8080",
  "http://178.18.242.28.nip.io:8080",
  "http://149.118.157.59.nip.io:8080",
  "http://129.150.44.79.nip.io:8080",
  "http://220.72.100.236.nip.io:8080",
  "http://101.200.3.110.nip.io:8080", 
  "http://161.153.3.209.nip.io:8080",
  "http://144.24.219.208.nip.io:8080",
  "http://46.37.122.40.nip.io:8080",
  "http://212.36.87.58.nip.io:8080",
  "http://156.146.235.114.nip.io:5001",
  "http://218.147.76.163.nip.io:5001",
  "http://156.146.235.114.nip.io:5001",
  "http://99.6.167.132.nip.io:5001",
  "http://108.181.152.142.nip.io:5001",
  "http://35.138.176.97.nip.io:5001",
  "https://lcpp.demetrisamantium.com",
  "https://118.167.9.98.nip.io:2053",
  "https://kobold.asozial.org",
  "http://108.210.175.159.nip.io:5001",
  "http://173.248.19.236.nip.io:5001",
  "http://82.66.194.162.nip.io:5001",
  "http://73.185.144.207.nip.io:5001",
  "http://50.53.208.218.nip.io:5001",
  "http://185.155.18.66.nip.io"
];

// Deduplicate at module load time
const DEFAULT_SEED_SERVERS = [...new Set(_SEED_LIST)];

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

// ---------------------------------------------------------------------------
// Server probing
// ---------------------------------------------------------------------------

/** Probe one Ollama server. Returns { url, models } or null. */
async function probeServer(url) {
  try {
    const resp = await fetch(`${url}/v1/models`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    if (!resp.ok) return { url, error: resp.status};
    const data = await resp.json();
    const models = (data.data || [])
      .map((m) => m.id || "")
      .filter(Boolean);
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
  const cacheRequest = new Request(`https://swarm.new.dev/servers`, {
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
      owned_by: "swarm",
      count: c
    }));

  return Response.json({ object: "list", data }, {headers: isLoading ? {"Cache-Control": "no-cache, no-store, must-revalidate"} : {}});
}

async function handleServers(env, all = false) {
  const loading = await discoverServers(env);
  const data = all ? cachedAlive : Object.keys(cachedAlive)
  return Response.json({
    data,
    loading,
    offset: cachedStep * PROBE_BATCH_SIZE,
    total: DEFAULT_SEED_SERVERS.length,
    working: await getWorkingModels()
  });
}
async function getWorkingModels() {
  const cachedResponse = await caches.default.match(new Request(`https://swarm.new.dev/working`));
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
        ctx.waitUntil(caches.default.put(new Request(`https://swarm.new.dev/working`), responseToCache));
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
      response = Response.json({ status: "ok", service: "swarm" });
    } else {
      response = new Response("Not Found", { status: 404 });
    }

    return withCors(response);
  }
};
