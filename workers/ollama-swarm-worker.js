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
  "http://116.202.111.94.nip.io:11434",
  "http://130.89.48.109.nip.io:11434",
  "http://85.214.43.150.nip.io:11434",
  "http://213.132.219.17.nip.io:11434",
  "http://155.133.208.195.nip.io:11434",
  "http://46.17.99.157.nip.io:11434",
  "http://193.237.205.200.nip.io:11434",
  "http://51.17.50.106.nip.io:2052",
  "http://46.224.147.115.nip.io:11434",
  "http://54.215.114.112.nip.io.nip.io:7547",
  "http://43.210.64.106.nip.io.nip.io:7547",
  "http://87.208.240.33.nip.io:11434",
  "http://64.176.39.95.nip.io:11434",
  "http://46.224.156.158.nip.io:11434",
  "http://185.100.232.224.nip.io:11434",
  "http://38.76.189.45.nip.io:11434",
  "http://38.76.189.41.nip.io:11434",
  "http://116.203.177.162.nip.io:11434",
  "http://204.168.244.123.nip.io:11434",
  "http://195.201.234.76.nip.io:11434",
  "http://194.62.157.184.nip.io:11434",
  "http://185.45.193.80.nip.io:11434",
  "http://199.79.202.22.nip.io:11434",
  "http://78.46.41.183.nip.io:11434",
  "http://1.243.43.248.nip.io:11434",
  "http://38.76.189.74.nip.io:11434",
  "http://213.136.76.182.nip.io:11434",
  "http://89.58.3.79.nip.io:11434",
  "http://116.203.112.201.nip.io:11434",
  "http://100.30.6.43.nip.io:11434",
  "http://146.0.72.136.nip.io:11434",
  "http://44.244.46.70.nip.io:7547",
  "http://193.237.153.60.nip.io:11434",
  "http://79.137.197.6.nip.io:11434",
  "http://220.249.186.40.nip.io:11434",
  "http://103.235.75.117.nip.io:11434",
  "http://202.141.161.50.nip.io:11434",
  "http://66.94.124.143.nip.io:11434",
  "http://94.141.160.99.nip.io:11434",
  "http://38.180.104.127.nip.io:11434",
  "http://147.93.183.134.nip.io:11434",
  "http://82.135.28.45.nip.io:11434",
  "http://152.53.93.215.nip.io:11434",
  "http://45.145.42.104.nip.io:11434",
  "http://203.176.113.216.nip.io:11434",
  "http://133.4.188.2.nip.io:11434",
  "http://116.202.197.155.nip.io:11434",
  "http://57.128.123.135.nip.io:11434",
  "http://63.177.73.22.nip.io:7547",
  "http://211.23.87.144.nip.io:11434",
  "http://204.168.139.0.nip.io:11434",
  "http://16.26.230.113.nip.io:7547",
  "http://46.224.83.114.nip.io:11434",
  "http://20.246.91.177.nip.io:11434",
  "http://168.235.74.31.nip.io:11434",
  "http://84.22.103.64.nip.io:11434",
  "http://223.113.66.126.nip.io:11434",
  "http://38.76.189.19.nip.io:11434",
  "http://81.4.125.240.nip.io:11434",
  "http://209.97.173.219.nip.io:11434",
  "http://163.172.212.132.nip.io:11434",
  "http://18.223.75.148.nip.io:11434",
  "http://139.129.25.182.nip.io:11434",
  "http://62.45.168.106.nip.io:11434",
  "http://46.4.216.118.nip.io:11434",
  "http://117.55.199.23.nip.io:11434",
  "http://31.172.78.56.nip.io:11434",
  "http://62.171.155.8.nip.io:11434",
  "http://49.13.48.26.nip.io:11434",
  "http://82.165.174.61.nip.io:11434",
  "http://116.203.53.120.nip.io:11434",
  "http://108.160.206.30.nip.io:11434",
  "http://116.203.219.128.nip.io:11434",
  "http://161.153.32.111.nip.io:11434",
  "http://217.174.245.24.nip.io:11434",
  "http://77.239.123.2.nip.io:11434",
  "http://5.75.180.13.nip.io:11434",
  "http://34.31.140.94.nip.io:11434",
  "http://204.168.198.89.nip.io:11434",
  "http://45.87.137.100.nip.io:11434",
  "http://107.175.125.166.nip.io:11434",
  "http://178.105.145.53.nip.io:11434",
  "http://64.156.70.180.nip.io:11434",
  "http://165.1.76.13.nip.io:11434",
  "http://158.101.214.195.nip.io:11434",
  "http://5.9.1.80.nip.io:11434",
  "http://51.178.49.219.nip.io:11434",
  "http://116.203.198.188.nip.io:11434",
  "http://38.76.189.18.nip.io:11434",
  "http://216.70.69.75.nip.io:11434",
  "http://88.168.52.207.nip.io:11434",
  "http://62.238.14.177.nip.io:11434",
  "http://142.132.252.21.nip.io:11434",
  "http://38.76.189.9.nip.io:11434",
  "http://167.71.147.184.nip.io:11434",
  "http://35.221.126.180.nip.io:11434",
  "http://63.179.110.87.nip.io:2082",
  "http://3.67.10.231.nip.io:8080",
  "http://178.104.205.2.nip.io:11434",
  "http://165.1.78.194.nip.io:11434",
  "http://5.129.226.192.nip.io:11434",
  "http://198.206.133.250.nip.io:11434",
  "http://178.254.28.95.nip.io:11434",
  "http://16.63.120.43.nip.io:7547",
  "http://204.168.196.150.nip.io:11434",
  "http://46.224.186.78.nip.io:11434",
  "http://136.243.60.49.nip.io:11434",
  "http://116.202.9.89.nip.io:11434",
  "http://38.76.189.31.nip.io:11434",
  "http://75.128.229.121.nip.io:11434",
  "http://52.201.213.145.nip.io:11434",
  "http://5.78.200.46.nip.io:11434",
  "http://2.59.170.202.nip.io:11434",
  "http://185.191.127.178.nip.io:11434",
  "http://81.131.169.17.nip.io:11434",
  "http://116.203.212.217.nip.io:11434",
  "http://54.215.114.112.nip.io:7547",
  "http://178.104.197.254.nip.io:11434",
  "http://18.61.29.191.nip.io:7547",
  "http://54.36.111.107.nip.io:11434",
  "http://103.66.120.232.nip.io:11434",
  "http://27.92.231.18.nip.io:11434",
  "http://178.105.62.143.nip.io:11434",
  "http://101.111.228.63.nip.io:11434",
  "http://150.230.164.69.nip.io:11434",
  "http://85.214.44.11.nip.io:11434",
  "http://178.104.163.52.nip.io:11434",
  "http://34.16.62.196.nip.io:11434",
  "http://49.13.102.77.nip.io:11434",
  "http://38.76.189.21.nip.io:11434",
  "http://145.239.207.5.nip.io:11434",
  "http://38.76.189.97.nip.io:11434",
  "http://45.139.77.246.nip.io:11434",
  "http://45.154.87.43.nip.io:11434",
  "http://64.188.91.237.nip.io:11434",
  "http://178.105.147.204.nip.io:11434",
  "http://77.68.10.64.nip.io:11434",
  "http://125.138.77.111.nip.io:11434",
  "http://223.85.216.230.nip.io:11434",
  "http://57.128.64.100.nip.io:11434",
  "http://178.219.166.81.nip.io:2082",
  "http://37.59.98.74.nip.io:11434",
  "http://71.251.218.102.nip.io:11434",
  "http://210.59.176.82.nip.io:11434",
  "http://223.113.254.84.nip.io:11434",
  "http://113.44.194.208.nip.io:11434",
  "http://3.237.237.228.nip.io:2077",
  "http://13.140.143.210.nip.io:11434",
  "http://204.168.149.141.nip.io:11434",
  "http://51.254.134.96.nip.io:11434",
  "http://109.86.166.86.nip.io:11434",
  "http://178.105.66.185.nip.io:11434",
  "http://104.54.238.64.nip.io:11434",
  "http://116.202.66.86.nip.io:11434",
  "http://129.80.194.194.nip.io:11434",
  "http://45.140.140.26.nip.io:11434",
  "http://199.204.135.71.nip.io:11434",
  "http://135.237.98.245.nip.io:11434",
  "http://23.95.148.22.nip.io:11434",
  "http://78.13.53.95.nip.io:2077",
  "http://31.70.86.211.nip.io:11434",
  "http://83.86.59.188.nip.io:11434",
  "http://69.243.159.16.nip.io:11434",
  "http://51.158.152.190.nip.io:11434",
  "http://167.86.113.188.nip.io:11434",
  "http://51.77.188.225.nip.io:11434",
  "http://90.149.239.71.nip.io:11434",
  "http://51.254.130.116.nip.io:11434",
  "http://180.110.147.114.nip.io:11434",
  "http://47.79.39.175.nip.io:11434",
  "http://20.107.59.198.nip.io:11434",
  "http://114.34.180.200.nip.io:11434",
  "http://84.86.220.240.nip.io:11434",
  "http://204.168.175.197.nip.io:11434",
  "http://129.80.43.33.nip.io:11434",
  "http://207.148.68.227.nip.io:11434",
  "http://117.50.171.144.nip.io:11434",
  "http://46.243.3.122.nip.io:11434",
  "http://220.135.48.55.nip.io:11434",
  "http://18.136.206.156.nip.io:11434",
  "http://58.127.230.165.nip.io:11434",
  "http://188.166.254.32.nip.io:11434",
  "http://201.137.77.153.nip.io:11434",
  "http://103.137.250.43.nip.io:11434",
  "http://204.168.254.120.nip.io:11434",
  "http://150.136.60.84.nip.io:11434",
  "http://220.134.52.221.nip.io:11434",
  "http://217.182.133.168.nip.io:11434",
  "http://35.208.40.227.nip.io:11434",
  "http://54.93.197.63.nip.io.nip.io:7547",
  "http://13.140.25.193.nip.io:11434",
  "http://152.53.251.120.nip.io:11434",
  "http://1.255.85.149.nip.io:11434",
  "http://31.70.78.250.nip.io:11434",
  "http://160.16.60.183.nip.io:11434",
  "http://64.176.229.210.nip.io:11434",
  "http://125.227.28.166.nip.io:11434",
  "http://147.93.139.24.nip.io:11434",
  "http://217.182.67.5.nip.io:11434",
  "http://5.101.168.158.nip.io:11434",
  "http://147.93.183.23.nip.io:11434",
  "http://46.224.203.89.nip.io:11434",
  "http://87.98.145.87.nip.io:11434",
  "http://24.236.158.179.nip.io:11434",
  "http://64.225.38.49.nip.io:11434",
  "http://79.157.228.102.nip.io:11434",
  "http://185.237.206.241.nip.io:11434",
  "http://151.80.21.134.nip.io:11434",
  "http://158.69.27.163.nip.io:11434",
  "http://152.53.251.120.nip.io:11434",
  "http://62.68.75.4.nip.io:11434",
];

// Deduplicate at module load time
const DEFAULT_SEED_SERVERS = [...new Set(_SEED_LIST)];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PROBE_TIMEOUT_MS = 5_000;
const TTFT_TIMEOUT_MS = 10_000;
const CACHE_TTL_SECONDS = 86_400; // 1 day — matches Python's daily cache pattern
const DEFAULT_MODEL = "qwen3:14b";
const PROBE_BATCH_SIZE = 50; // CF Workers: max ~50 simultaneous outbound connections

// ---------------------------------------------------------------------------
// KV cache helpers
// ---------------------------------------------------------------------------

/** Returns the KV key for today's server cache. */
function todayKey() {
  return `ollama-swarm:${new Date().toISOString().slice(0, 10)}`;
}

async function loadCachedServers(env) {
  if (!env.OLLAMA_CACHE) return null;
  try {
    const data = await env.OLLAMA_CACHE.get(todayKey(), "json");
    if (data && typeof data === "object" && Object.keys(data).length > 0) {
      return data;
    }
  } catch {}
  return null;
}

async function saveCachedServers(env, alive) {
  if (!env.OLLAMA_CACHE) return;
  try {
    await env.OLLAMA_CACHE.put(todayKey(), JSON.stringify(alive), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  } catch {}
}

// ---------------------------------------------------------------------------
// Server probing
// ---------------------------------------------------------------------------

/** Probe one Ollama server. Returns { url, models } or null. */
async function probeServer(url) {
  try {
    const resp = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const models = (data.models || [])
      .map((m) => m.name || "")
      .filter(
        (name) =>
          name &&
          !name.includes("/attacker/") &&
          !name.startsWith("model-b") &&
          !name.includes("embed")
      );
    if (models.length > 0) return { url, models };
  } catch {}
  return null;
}

/**
 * Run probe on a list of candidates in PROBE_BATCH_SIZE batches,
 * respecting CF Workers' concurrent-connection limit.
 */
async function probeBatched(candidates) {
  const alive = {};
  for (let i = 0; i < candidates.length; i += PROBE_BATCH_SIZE) {
    const batch = candidates.slice(i, i + PROBE_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(probeServer));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        alive[r.value.url] = r.value.models;
      }
    }
  }
  return alive;
}

/**
 * Return alive servers → models map.
 * Uses KV daily cache when available, falls back to live probing.
 */
let cachedAlive = null; // In-memory cache for the duration of the worker instance
async function discoverServers(env) {
  cachedAlive = cachedAlive || await loadCachedServers(env);
  if (cachedAlive) return cachedAlive;

  const alive = await probeBatched(DEFAULT_SEED_SERVERS);

  if (Object.keys(alive).length > 0) {
    cachedAlive = alive;
    await saveCachedServers(env, alive);
  }

  return alive;
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
async function forwardToServer(serverUrl, model, bodyObj) {
  const controller = new AbortController();

  const upResp = await fetch(`${serverUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...bodyObj, model }),
    signal: controller.signal,
  });

  if (!upResp.ok) {
    const responseText = await upResp.text();
    const err = new Error(`HTTP ${upResp.status}`);
    err.statusCode = upResp.status;
    err.responseText = responseText;
    throw err;
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
  const alive = await discoverServers(env);
  const { modelCount } = buildModelMap(alive);

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

  return Response.json({ object: "list", data });
}

async function handleChatCompletions(request, env) {
  let bodyObj;
  try {
    bodyObj = await request.json();
  } catch {
    return Response.json(
      { error: { message: "Invalid JSON body", type: "invalid_request_error" } },
      { status: 400 }
    );
  }

  const model = bodyObj.model || DEFAULT_MODEL;
  const alive = await discoverServers(env);
  const { modelToServers } = buildModelMap(alive);

  const serverUrls = modelToServers[model];
  if (!serverUrls || serverUrls.length === 0) {
    const available = Object.keys(modelToServers).slice(0, 15).join(", ");
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

  let lastError = null;
  for (const serverUrl of serverUrls) {
    try {
      const resp = await forwardToServer(serverUrl, model, bodyObj);
      return resp;
    } catch (e) {
      // 400 = server alive but model invalid — no point retrying other servers
      if (e.statusCode === 400) {
        return Response.json(
          {
            error: {
              message: e.responseText || "Bad request",
              type: "invalid_request_error",
            },
          },
          { status: 400 }
        );
      }
      lastError = e;
      // Try next server
    }
  }

  return Response.json(
    {
      error: {
        message: lastError?.message || "All servers failed",
        type: "server_error",
      },
    },
    { status: 503 }
  );
}

/** Force-refresh the server cache (useful for cron warm-up or manual trigger). */
async function handleRefresh(env) {
  const alive = await probeBatched(DEFAULT_SEED_SERVERS);
  if (Object.keys(alive).length > 0) {
    await saveCachedServers(env, alive);
  }
  const { modelCount } = buildModelMap(alive);
  return Response.json({
    servers: Object.keys(alive).length,
    models: Object.keys(modelCount).length,
    refreshed: new Date().toISOString(),
  });
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
  async fetch(request, env) {
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
    } else if (
      pathname.endsWith("/chat/completions") &&
      request.method === "POST"
    ) {
      response = await handleChatCompletions(request, env);
    } else if (pathname === "/refresh" && request.method === "POST") {
      response = await handleRefresh(env);
    } else if (pathname === "/" || pathname === "/health") {
      response = Response.json({ status: "ok", service: "ollama-swarm" });
    } else {
      response = new Response("Not Found", { status: 404 });
    }

    return withCors(response);
  },

  /** Cron trigger — warms the KV cache once per day */
  async scheduled(_event, env) {
    await handleRefresh(env);
  },
};
