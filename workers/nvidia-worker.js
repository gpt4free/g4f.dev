/**
 * G4F NVIDIA Worker
 *
 * OpenAI-compatible proxy for NVIDIA NIM preview text models
 * (https://build.nvidia.com/models?filters=nimType%3Anim_type_preview).
 *
 * Endpoints:
 * - POST /v1/chat/completions   (model: "auto" | "best" | "fast" | exact NIM id)
 * - GET  /v1/models
 * - GET  /health
 *
 * Environment Variables:
 * - NVIDIA_API_KEY: NVIDIA NIM API key (integrate.api.nvidia.com) — required for chat
 *
 * "auto" / "best" / "fast" resolve to a ranked candidate list from the preview
 * text-model catalog; requests fall through the candidates until one succeeds.
 */

const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
  "Access-Control-Expose-Headers": "Content-Type, X-Provider, X-Model"
};

// Text models from the NIM preview catalog (nim_type_preview), curated for
// chat completions. ASR/TTS/image/embedding/guard NIMs are excluded.
// `best` = most capable, `fast` = lowest latency.
const PREVIEW_TEXT_MODELS = [
  { id: "nvidia/nemotron-3-ultra-550b-a55b", label: "Nemotron 3 Ultra 550B", best: true },
  { id: "zai/glm-5-3", label: "GLM 5.3 753B", best: true },
  { id: "moonshotai/kimi-k3", label: "Kimi K3", best: true },
  { id: "nvidia/nemotron-3-super-120b-a12b", label: "Nemotron 3 Super 120B" },
  { id: "deepseek-ai/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", fast: true },
  { id: "google/gemma-4-31b-it", label: "Gemma 4 31B" },
  { id: "nvidia/muse-glimmer-30b", label: "Muse Glimmer 30B" },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", label: "Nemotron 3 Nano Omni 30B" },
  { id: "nvidia/laguna-xs-2.1", label: "Laguna XS 2.1", fast: true },
  { id: "nvidia/diffusiongemma-26b-a4b-it", label: "DiffusionGemma 26B A4B" },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", fast: true },
  { id: "nvidia/nemotron-3.5-lightning-30b-a3b", label: "Nemotron 3.5 Lightning 30B", fast: true },
  { id: "zai/glm-5-3-flash", label: "GLM 5.3 Flash", fast: true }
];

// Ranked candidate order per selection strategy (first successful wins).
const AUTO_RANK = [
  "nvidia/nemotron-3-ultra-550b-a55b",
  "zai/glm-5-3",
  "moonshotai/kimi-k3",
  "nvidia/nemotron-3-super-120b-a12b",
  "deepseek-ai/deepseek-v4.1-flash",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "zai/glm-5-3-flash",
  "google/gemma-4-31b-it",
  "openai/gpt-oss-20b"
];
const BEST_RANK = AUTO_RANK.slice(0, 6);
const FAST_RANK = [
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "zai/glm-5-3-flash",
  "deepseek-ai/deepseek-v4.1-flash",
  "openai/gpt-oss-20b",
  "nvidia/laguna-xs-2.1",
  "nvidia/nemotron-3-ultra-550b-a55b"
];

let cachedCatalog = null;
let cachedCatalogTimestamp = 0;
const CATALOG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      if (pathname.endsWith("/models")) {
        return handleModels(request, env);
      }

      if (pathname.endsWith("/chat/completions")) {
        return handleChatCompletions(request, env);
      }

      if (pathname === "/health" || pathname === "/nvidia/health") {
        return jsonResponse({ status: "ok", service: "nvidia-worker" });
      }

      if (pathname === "/" || pathname === "/nvidia" || pathname === "/nvidia/") {
        return jsonResponse({
          service: "G4F NVIDIA Worker",
          version: "1.0.0",
          endpoints: {
            chat: "/v1/chat/completions",
            models: "/v1/models",
            health: "/health"
          },
          models: "auto | best | fast | <nim model id>"
        });
      }

      return jsonResponse({ error: { message: "Not found" } }, 404);
    } catch (error) {
      console.error("NVIDIA worker error:", error);
      return jsonResponse({ error: { message: error.message || "Internal server error" } }, 500);
    }
  }
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}

function getApiKey(env) {
  return env?.NVIDIA_API_KEY || env?.NVIDIA_NIM_API_KEY || "";
}

function basename(modelId) {
  return String(modelId || "").split("/").pop();
}

/**
 * Resolve the available preview text models. The static list is validated
 * against NVIDIA's live catalog when an API key is present; unknown ids are
 * dropped so fallback chains never hit removed models.
 */
async function getAvailableModels(env) {
  const apiKey = getApiKey(env);
  const now = Date.now();
  if (cachedCatalog && now - cachedCatalogTimestamp < CATALOG_CACHE_TTL) {
    return cachedCatalog;
  }
  let live = null;
  if (apiKey) {
    try {
      const response = await fetch(`${NIM_BASE_URL}/models`, {
        headers: { "Authorization": `Bearer ${apiKey}` }
      });
      if (response.ok) {
        const data = await response.json();
        live = new Set((data?.data || []).map((m) => basename(m.id)));
      }
    } catch (error) {
      console.error("NVIDIA catalog fetch failed:", error);
    }
  }
  const available = PREVIEW_TEXT_MODELS.filter((m) => !live || live.has(basename(m.id)));
  if (available.length) {
    cachedCatalog = available;
    cachedCatalogTimestamp = now;
  }
  return available;
}

function rankModels(available, rank) {
  const byBasename = new Map(available.map((m) => [basename(m.id), m]));
  const ranked = rank.map((id) => byBasename.get(basename(id))).filter(Boolean);
  // Append anything available but not covered by the rank (catalog updates).
  for (const model of available) {
    if (!ranked.includes(model)) ranked.push(model);
  }
  return ranked;
}

async function resolveCandidates(model, env) {
  const available = await getAvailableModels(env);
  const key = String(model || "auto").toLowerCase();
  if (key === "auto") return rankModels(available, AUTO_RANK);
  if (key === "best") return rankModels(available, BEST_RANK);
  if (key === "fast" || key === "fastest") return rankModels(available, FAST_RANK);
  const exact = available.find((m) => m.id === model || basename(m.id) === basename(model));
  return exact ? [exact] : null;
}

async function handleModels(request, env) {
  const available = await getAvailableModels(env);
  return jsonResponse({
    object: "list",
    data: available.map((m) => ({
      id: m.id,
      object: "model",
      owned_by: "nvidia",
      label: m.label,
      best: !!m.best,
      fast: !!m.fast
    }))
  });
}

async function handleChatCompletions(request, env) {
  const apiKey = getApiKey(env);
  if (!apiKey) {
    return jsonResponse({ error: { message: "Missing NVIDIA_API_KEY environment variable", code: 401 } }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return jsonResponse({ error: { message: "Invalid JSON body", code: 400 } }, 400);
  }

  const requestedModel = body.model || "auto";
  const candidates = await resolveCandidates(requestedModel, env);
  if (!candidates || !candidates.length) {
    return jsonResponse({
      error: {
        message: `Unknown model: ${requestedModel}. Available: auto, best, fast or ${PREVIEW_TEXT_MODELS.map((m) => m.id).join(", ")}`,
        code: 404
      }
    }, 404);
  }

  const stream = !!body.stream;
  let lastError = null;

  for (const candidate of candidates) {
    const payload = { ...body, model: candidate.id };
    let response;
    try {
      response = await fetch(`${NIM_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Accept": stream ? "text/event-stream" : "application/json"
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      lastError = error;
      continue;
    }

    if (response.ok) {
      const headers = {
        ...CORS_HEADERS,
        "Content-Type": stream ? "text/event-stream" : "application/json",
        "X-Provider": "nvidia-nim",
        "X-Model": candidate.id
      };
      if (stream) {
        return new Response(response.body, { status: 200, headers });
      }
      const data = await response.text();
      return new Response(data, { status: 200, headers });
    }

    // Fall through to the next candidate on model-specific failures;
    // auth/quota errors are not retryable with another model.
    lastError = new Error(`${response.status}: ${await response.text().catch(() => response.statusText)}`);
    if (response.status === 401 || response.status === 403) {
      break;
    }
  }

  const message = lastError?.message || "All candidate models failed";
  const status = message.startsWith("401") || message.startsWith("403") ? 401 : 502;
  return jsonResponse({ error: { message, code: status } }, status);
}
