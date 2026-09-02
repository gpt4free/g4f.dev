/**
 * Cloudflare Workers AI — OpenAI-compatible `/v1/chat/completions` worker
 *
 * Exposes:
 *   POST /v1/chat/completions
 *   GET  /v1/models
 *
 * Backed by the Cloudflare Workers AI binding (`env.AI`).
 *
 * Wrangler config: wrangler-cf-ai.toml
 */

let cachedModels = null;
let cachedModelsTimestamp = 0;
const MODELS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchCloudflareModels(request, env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const isUserProvided = request.headers.has("Authorization");
  const authorization = isUserProvided ? request.headers.get("Authorization") : env.CLOUDFLARE_API_TOKEN ? `Bearer ${env.CLOUDFLARE_API_TOKEN}` : null;
  if (!accountId || !authorization) {
    return [];
  }
  //require_workers_paid

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`;
  const response = await fetch(url, {
    headers: {
      "Authorization": authorization,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(await response.text())
  }

  const result = (await response.json())?.result || [];
  let data = result.map(m=>{
    m.key = m.id;
    m.id = m.name;
    delete m.name;
    m.properties = Object.fromEntries(m.properties.map(p=>[p.property_id, p.value]));
    return m;
  });

  if (!isUserProvided) {
    data = data.filter(m=>!m.properties.require_workers_paid)
  }

  return data;
}

async function getCfAiModels(request, env) {
  const now = Date.now();
  if (cachedModels && now - cachedModelsTimestamp < MODELS_CACHE_TTL) {
    return cachedModels;
  }
  let models = [];
  try {
    models = await fetchCloudflareModels(request, env);
  } catch (error) {
    return {error: error.message}
    console.error("Failed to fetch Workers AI models:", error);
  }
  cachedModels = models;
  cachedModelsTimestamp = now;
  return cachedModels;
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...headers,
    },
  });
}

async function handlePost(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname === "/" ? "/run" : url.pathname;
  if (request.method !== "POST") {
    return jsonResponse({ error: { message: "Method not allowed", type: "invalid_request_error" } }, 405);
  }
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const authorization = request.headers.get("Authorization") ? request.headers.get("Authorization") : env.CLOUDFLARE_API_TOKEN ? `Bearer ${env.CLOUDFLARE_API_TOKEN}` : null;
  if (!accountId || !authorization) {
    return jsonResponse({ error: { message: "Missing Authorization" } }, 401);
  }

  const newUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/${pathname}`;
  const response = await fetch(newUrl, {
    method: "POST",
    body: request.body,
    headers: {
      "Authorization": authorization,
      "Content-Type": "application/json",
    },
  });
  const newResponse = new Response(response.body, response);
  newResponse.headers.set("Access-Control-Allow-Origin", "*");
  return newResponse;
}

async function handleModels(request, env) {
  const data = {
    object: "list",
    data: await getCfAiModels(request, env)
  };
  return jsonResponse(data);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    if (pathname === "/v1/models" && request.method === "GET") {
      return handleModels(request, env);
    }

    if (request.method === "POST") {
      return handlePost(request, env);
    }

    return jsonResponse({ error: { message: "Not found", type: "invalid_request_error" } }, 404);
  },
};
