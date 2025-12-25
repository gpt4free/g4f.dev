/**
 * G4F HuggingFace Worker
 * 
 * Cloudflare Worker providing OpenAI-compatible API endpoints using HuggingFace's inference API.
 * Supports the HuggingFace Router API for text generation and image generation models.
 * 
 * Features:
 * - OpenAI-compatible chat/completions endpoint
 * - Dynamic model routing via HuggingFace Router
 * - Streaming support with usage tracking
 * - Model caching and provider mapping
 * - API key authentication (optional)
 * 
 * Environment Variables Required:
 * - HUGGINGFACE_API_KEY: Default HuggingFace API token (optional, users can provide their own)
 * - MEMBERS_KV: KV namespace for caching (optional)
 */

const HUGGINGFACE_ROUTER_BASE = "https://router.huggingface.co";
const HUGGINGFACE_API_BASE = "https://api-inference.huggingface.co/v1";
const HUGGINGFACE_MODELS_API = "https://huggingface.co/api/models";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    "Access-Control-Expose-Headers": "Content-Type, X-Provider, X-Model, X-HuggingFace-Router"
};

const ACCESS_CONTROL_ALLOW_ORIGIN = {
    "Access-Control-Allow-Origin": "*"
};

// Rate limits for anonymous users
const RATE_LIMITS = {
    requests: {
        perMinute: 20,
        perHour: 200,
        perDay: 2000
    },
    windows: {
        minute: 60 * 1000,
        hour: 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000
    }
};

// Default models
const DEFAULT_MODEL = "meta-llama/Llama-3.3-70B-Instruct";
const DEFAULT_VISION_MODEL = "meta-llama/Llama-3.2-11B-Vision-Instruct";
const DEFAULT_IMAGE_MODEL = "black-forest-labs/FLUX.1-dev";

// Model aliases for convenience
const MODEL_ALIASES = {
    "llama-3": DEFAULT_MODEL,
    "llama-3.3-70b": DEFAULT_MODEL,
    "llama-3.2-11b": DEFAULT_VISION_MODEL,
    "qwq-32b": "Qwen/QwQ-32B",
    "qwen-2.5-coder-32b": "Qwen/Qwen2.5-Coder-32B-Instruct",
    "deepseek-r1": "deepseek-ai/DeepSeek-R1",
    "deepseek-v3": "deepseek-ai/DeepSeek-V3-0324",
    "mistral-nemo": "mistralai/Mistral-Nemo-Instruct-2407",
    "phi-3.5-mini": "microsoft/Phi-3.5-mini-instruct",
    "gemma-3-27b": "google/gemma-3-27b-it",
    "command-r-plus": "CohereForAI/c4ai-command-r-plus-08-2024",
    "flux": DEFAULT_IMAGE_MODEL,
    "flux-dev": DEFAULT_IMAGE_MODEL,
    "flux-schnell": "black-forest-labs/FLUX.1-schnell",
    "stable-diffusion-3.5": "stabilityai/stable-diffusion-3.5-large",
    "sdxl": "stabilityai/stable-diffusion-xl-base-1.0"
};

// Provider path mappings for HuggingFace Router
const PROVIDER_PATHS = {
    "hf-inference": (model) => `hf-inference/models/${model}/v1`,
    "together": "together/v1",
    "fireworks-ai": "fireworks-ai/inference/v1",
    "sambanova": "sambanova/v1",
    "novita": "novita/v3/openai",
    "groq": "groq/openai/v1",
    "cerebras": "cerebras/v1",
    "nebius": "nebius/v1",
    "replicate": "replicate/v1",
    "zai-org": "zai-org/api/paas/v4",
    "hyperbolic": "hyperbolic/v1",
    "cohere": "cohere/compatibility/v1"
};

// Cache for provider mappings
let providerMappingCache = {};
let modelListCache = null;
let modelListCacheTime = 0;
const MODEL_CACHE_TTL = 3600 * 1000; // 1 hour

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const pathname = url.pathname;

        // Handle CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: CORS_HEADERS });
        }

        try {
            // ============================================
            // OpenAI-compatible Endpoints
            // ============================================

            // Models endpoint
            if (pathname.endsWith("/models")) {
                return handleModels(request, env);
            }

            // Chat completions endpoint
            if (pathname.endsWith("/chat/completions")) {
                return handleChatCompletions(request, env, ctx);
            }

            // Image generation endpoint (compatible with OpenAI images/generations)
            if (pathname.endsWith("/images/generations")) {
                return handleImageGeneration(request, env, ctx);
            }

            // Provider mapping endpoint (for debugging/introspection)
            if (pathname === "/huggingface/provider-mapping") {
                return handleProviderMapping(request, env);
            }

            // Health check
            if (pathname === "/huggingface/health" || pathname === "/health") {
                return jsonResponse({ status: "ok", service: "huggingface-worker" });
            }

            // Root info
            if (pathname === "/" || pathname === "/huggingface" || pathname === "/huggingface/") {
                return jsonResponse({
                    service: "G4F HuggingFace Worker",
                    version: "1.0.0",
                    endpoints: {
                        chat: "/v1/chat/completions",
                        models: "/v1/models",
                        images: "/v1/images/generations",
                        health: "/health"
                    },
                    documentation: "https://g4f.dev/docs"
                });
            }

            return jsonResponse({ error: "Not found" }, 404);
        } catch (error) {
            console.error("HuggingFace worker error:", error);
            return jsonResponse({ error: { message: error.message || "Internal server error" } }, 500);
        }
    }
};

// ============================================
// API Key Handling
// ============================================

function getApiKey(request, env) {
    // Check Authorization header
    const authHeader = request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const tokens = authHeader.substring(7).split(/\s+/);
        // Find the HuggingFace token (starts with hf_ or is not a g4f_ key)
        const hfKey = tokens.find(t => t.startsWith("hf_")) || tokens.find(t => t && !t.startsWith("g4f_"));
        if (hfKey) return hfKey;
    }

    // Check X-API-Key header
    const xApiKey = request.headers.get("X-API-Key");
    if (xApiKey && !xApiKey.startsWith("g4f_")) {
        return xApiKey;
    }

    // Fall back to environment variable
    return env.HUGGINGFACE_API_KEY || null;
}

// ============================================
// Model Resolution
// ============================================

function resolveModel(model) {
    if (!model) return DEFAULT_MODEL;
    
    // Check aliases first
    if (MODEL_ALIASES[model]) {
        return MODEL_ALIASES[model];
    }
    
    // Check lowercase aliases
    const lowerModel = model.toLowerCase();
    for (const [alias, resolved] of Object.entries(MODEL_ALIASES)) {
        if (alias.toLowerCase() === lowerModel) {
            return resolved;
        }
    }
    
    return model;
}

async function getProviderMapping(model, apiKey) {
    // Check cache first
    if (providerMappingCache[model]) {
        return providerMappingCache[model];
    }

    const headers = {
        "Content-Type": "application/json"
    };
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }

    try {
        const response = await fetch(
            `${HUGGINGFACE_MODELS_API}/${model}?expand[]=inferenceProviderMapping`,
            { headers }
        );

        if (!response.ok) {
            console.error(`Failed to get provider mapping for ${model}: ${response.status}`);
            return null;
        }

        const data = await response.json();
        const mapping = data.inferenceProviderMapping || {};
        
        // Cache the mapping
        providerMappingCache[model] = mapping;
        
        return mapping;
    } catch (error) {
        console.error(`Error getting provider mapping for ${model}:`, error);
        return null;
    }
}

function buildRouterUrl(providerKey, model) {
    if (providerKey === "hf-inference") {
        return `${HUGGINGFACE_ROUTER_BASE}/hf-inference/models/${model}/v1`;
    }
    
    const pathTemplate = PROVIDER_PATHS[providerKey];
    if (typeof pathTemplate === "function") {
        return `${HUGGINGFACE_ROUTER_BASE}/${pathTemplate(model)}`;
    }
    if (pathTemplate) {
        return `${HUGGINGFACE_ROUTER_BASE}/${pathTemplate}`;
    }
    
    // Default pattern
    return `${HUGGINGFACE_ROUTER_BASE}/${providerKey}/v1`;
}

// ============================================
// Models Endpoint
// ============================================

async function handleModels(request, env) {
    const apiKey = getApiKey(request, env);
    
    // Check cache
    const now = Date.now();
    if (modelListCache && (now - modelListCacheTime) < MODEL_CACHE_TTL) {
        return jsonResponse({ object: "list", data: modelListCache });
    }

    const headers = {
        "Content-Type": "application/json"
    };
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }

    try {
        // Fetch models with inference capability
        const response = await fetch(
            `${HUGGINGFACE_MODELS_API}?inference=warm&expand[]=inferenceProviderMapping`,
            { headers }
        );

        if (!response.ok) {
            // Return fallback models
            return jsonResponse({
                object: "list",
                data: getFallbackModels()
            });
        }

        const models = await response.json();
        
        // Filter for conversational models (text generation)
        const conversationalModels = models.filter(model => {
            const providers = model.inferenceProviderMapping || {};
            return Object.values(providers).some(p => 
                p.status === "live" && p.task === "conversational"
            );
        });

        const modelList = conversationalModels.map(model => ({
            id: model.id,
            object: "model",
            created: new Date(model.createdAt || Date.now()).getTime() / 1000,
            owned_by: model.author || "huggingface",
            permission: [],
            root: model.id,
            parent: null
        }));

        // Add aliases as virtual models
        for (const [alias, realModel] of Object.entries(MODEL_ALIASES)) {
            if (!modelList.find(m => m.id === alias)) {
                modelList.push({
                    id: alias,
                    object: "model",
                    created: Date.now() / 1000,
                    owned_by: "g4f",
                    permission: [],
                    root: realModel,
                    parent: null
                });
            }
        }

        // Cache the results
        modelListCache = modelList;
        modelListCacheTime = now;

        return jsonResponse({ object: "list", data: modelList });
    } catch (error) {
        console.error("Error fetching models:", error);
        return jsonResponse({
            object: "list",
            data: getFallbackModels()
        });
    }
}

function getFallbackModels() {
    const fallbackModelIds = [
        DEFAULT_MODEL,
        "meta-llama/Llama-3.2-11B-Vision-Instruct",
        "Qwen/QwQ-32B",
        "Qwen/Qwen2.5-Coder-32B-Instruct",
        "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
        "mistralai/Mistral-Nemo-Instruct-2407",
        "microsoft/Phi-3.5-mini-instruct",
        "CohereForAI/c4ai-command-r-plus-08-2024"
    ];

    return fallbackModelIds.map(id => ({
        id,
        object: "model",
        created: Date.now() / 1000,
        owned_by: id.split("/")[0] || "huggingface",
        permission: [],
        root: id,
        parent: null
    }));
}

// ============================================
// Chat Completions Endpoint
// ============================================

async function handleChatCompletions(request, env, ctx) {
    if (request.method !== "POST") {
        return jsonResponse({ error: { message: "Method not allowed" } }, 405);
    }

    const apiKey = getApiKey(request, env);
    if (!apiKey) {
        return jsonResponse({
            error: {
                message: "API key required. Provide a HuggingFace API token via Authorization header or X-API-Key.",
                type: "authentication_error"
            }
        }, 401);
    }

    let body;
    try {
        body = await request.json();
    } catch (e) {
        return jsonResponse({ error: { message: "Invalid JSON body" } }, 400);
    }

    const { messages, stream = false, max_tokens = 2048, temperature, top_p, stop, ...extraParams } = body;
    let model = resolveModel(body.model);

    if (!messages || !Array.isArray(messages)) {
        return jsonResponse({ error: { message: "messages array is required" } }, 400);
    }

    // Get provider mapping for the model
    const providerMapping = await getProviderMapping(model, apiKey);
    
    if (!providerMapping || Object.keys(providerMapping).length === 0) {
        // Try direct HuggingFace inference API
        return await callHuggingFaceInference(model, messages, stream, max_tokens, temperature, top_p, stop, apiKey, extraParams, ctx);
    }

    // Find a suitable provider
    let lastError = null;
    for (const [providerKey, providerInfo] of Object.entries(providerMapping)) {
        if (providerInfo.status !== "live") continue;
        if (providerInfo.task !== "conversational") continue;

        const routerUrl = buildRouterUrl(providerKey, model);
        const providerModel = providerInfo.providerId || model;

        try {
            const response = await callProvider(
                routerUrl,
                providerModel,
                messages,
                stream,
                max_tokens,
                temperature,
                top_p,
                stop,
                apiKey,
                extraParams,
                providerKey,
                ctx
            );

            if (response.ok || stream) {
                return response;
            }

            // Try next provider on non-2xx response
            const errorData = await response.json().catch(() => ({}));
            lastError = errorData.error?.message || `Provider ${providerKey} returned ${response.status}`;
            console.error(`Provider ${providerKey} failed:`, lastError);
        } catch (error) {
            lastError = error.message;
            console.error(`Provider ${providerKey} error:`, error);
        }
    }

    return jsonResponse({
        error: {
            message: lastError || `No available provider for model: ${model}`,
            type: "provider_error"
        }
    }, 503);
}

async function callProvider(routerUrl, model, messages, stream, maxTokens, temperature, topP, stop, apiKey, extraParams, providerKey, ctx) {
    const requestBody = {
        model,
        messages,
        stream,
        max_tokens: maxTokens,
        ...extraParams
    };

    if (temperature !== undefined) requestBody.temperature = temperature;
    if (topP !== undefined) requestBody.top_p = topP;
    if (stop !== undefined) requestBody.stop = stop;

    // Request usage in streaming responses
    if (stream) {
        requestBody.stream_options = { include_usage: true };
    }

    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
    };

    const response = await fetch(`${routerUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody)
    });

    if (!response.ok && !stream) {
        return response;
    }

    // Add custom headers
    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
        newHeaders.set(key, value);
    }
    newHeaders.set("X-Provider", providerKey);
    newHeaders.set("X-Model", model);
    newHeaders.set("X-HuggingFace-Router", routerUrl);

    if (stream) {
        // Return streaming response
        return new Response(response.body, {
            status: response.status,
            headers: newHeaders
        });
    }

    return new Response(response.body, {
        status: response.status,
        headers: newHeaders
    });
}

async function callHuggingFaceInference(model, messages, stream, maxTokens, temperature, topP, stop, apiKey, extraParams, ctx) {
    // Direct call to HuggingFace inference API
    const requestBody = {
        model,
        messages,
        stream,
        max_tokens: maxTokens,
        ...extraParams
    };

    if (temperature !== undefined) requestBody.temperature = temperature;
    if (topP !== undefined) requestBody.top_p = topP;
    if (stop !== undefined) requestBody.stop = stop;

    const response = await fetch(`${HUGGINGFACE_API_BASE}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
    });

    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
        newHeaders.set(key, value);
    }
    newHeaders.set("X-Provider", "hf-inference-direct");
    newHeaders.set("X-Model", model);

    return new Response(response.body, {
        status: response.status,
        headers: newHeaders
    });
}

// ============================================
// Image Generation Endpoint
// ============================================

async function handleImageGeneration(request, env, ctx) {
    if (request.method !== "POST") {
        return jsonResponse({ error: { message: "Method not allowed" } }, 405);
    }

    const apiKey = getApiKey(request, env);
    if (!apiKey) {
        return jsonResponse({
            error: {
                message: "API key required. Provide a HuggingFace API token via Authorization header or X-API-Key.",
                type: "authentication_error"
            }
        }, 401);
    }

    let body;
    try {
        body = await request.json();
    } catch (e) {
        return jsonResponse({ error: { message: "Invalid JSON body" } }, 400);
    }

    const { prompt, model: requestModel, n = 1, size, response_format = "url", ...extraParams } = body;
    const model = resolveModel(requestModel || DEFAULT_IMAGE_MODEL);

    if (!prompt) {
        return jsonResponse({ error: { message: "prompt is required" } }, 400);
    }

    // Parse size
    let width = 1024, height = 1024;
    if (size) {
        const [w, h] = size.split("x").map(Number);
        if (w && h) {
            width = w;
            height = h;
        }
    }

    // Check for Together provider (has OpenAI-compatible image endpoint)
    const providerMapping = await getProviderMapping(model, apiKey);
    
    // Try Together first for FLUX models
    if (providerMapping && providerMapping.together) {
        try {
            const response = await fetch(`${HUGGINGFACE_ROUTER_BASE}/together/v1/images/generations`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model,
                    prompt,
                    n,
                    width,
                    height,
                    response_format,
                    ...extraParams
                })
            });

            if (response.ok) {
                const newHeaders = new Headers(response.headers);
                for (const [key, value] of Object.entries(CORS_HEADERS)) {
                    newHeaders.set(key, value);
                }
                newHeaders.set("X-Provider", "together");
                newHeaders.set("X-Model", model);

                return new Response(response.body, {
                    status: response.status,
                    headers: newHeaders
                });
            }
        } catch (error) {
            console.error("Together image generation failed:", error);
        }
    }

    // Fallback to direct HuggingFace inference API
    const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            inputs: prompt,
            parameters: {
                width,
                height,
                num_inference_steps: extraParams.num_inference_steps || 28,
                guidance_scale: extraParams.guidance_scale || 3.5,
                ...extraParams
            }
        })
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Image generation failed" }));
        return jsonResponse({ error }, response.status);
    }

    // HuggingFace inference returns raw image bytes
    const contentType = response.headers.get("content-type");
    
    if (contentType && contentType.includes("image/")) {
        if (response_format === "b64_json") {
            const buffer = await response.arrayBuffer();
            const base64 = arrayBufferToBase64(buffer);
            return jsonResponse({
                created: Math.floor(Date.now() / 1000),
                data: [{ b64_json: base64 }]
            });
        } else {
            // For URL format, we'd need to store the image somewhere
            // For now, return as base64
            const buffer = await response.arrayBuffer();
            const base64 = arrayBufferToBase64(buffer);
            return jsonResponse({
                created: Math.floor(Date.now() / 1000),
                data: [{ 
                    b64_json: base64,
                    revised_prompt: prompt
                }]
            });
        }
    }

    return jsonResponse({
        error: { message: "Unexpected response from image generation API" }
    }, 500);
}

// ============================================
// Provider Mapping Endpoint (for debugging)
// ============================================

async function handleProviderMapping(request, env) {
    const url = new URL(request.url);
    const model = url.searchParams.get("model");

    if (!model) {
        return jsonResponse({ error: { message: "model query parameter required" } }, 400);
    }

    const apiKey = getApiKey(request, env);
    const mapping = await getProviderMapping(model, apiKey);

    if (!mapping) {
        return jsonResponse({ error: { message: `No provider mapping found for model: ${model}` } }, 404);
    }

    // Build router URLs for each provider
    const providers = {};
    for (const [key, info] of Object.entries(mapping)) {
        providers[key] = {
            ...info,
            router_url: buildRouterUrl(key, model)
        };
    }

    return jsonResponse({
        model,
        providers,
        aliases: Object.entries(MODEL_ALIASES)
            .filter(([_, v]) => v === model)
            .map(([k]) => k)
    });
}

// ============================================
// Utility Functions
// ============================================

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS
        }
    });
}

function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
