/**
 * G4F Cohere Worker
 * 
 * Cloudflare Worker providing OpenAI-compatible API endpoints using Cohere's API.
 * Converts OpenAI format requests to Cohere v2 API format and vice versa.
 * 
 * Features:
 * - OpenAI-compatible chat/completions endpoint
 * - Streaming support with SSE
 * - Dynamic model listing from Cohere API
 * - API key authentication
 * - Usage tracking (prompt/completion tokens)
 * 
 * Environment Variables:
 * - COHERE_API_KEY: Default Cohere API key (optional, users can provide their own)
 */

const COHERE_API_BASE = "https://api.cohere.ai/v2";
const COHERE_MODELS_API = "https://api.cohere.com/v1/models";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    "Access-Control-Expose-Headers": "Content-Type, X-Provider, X-Model"
};

const ACCESS_CONTROL_ALLOW_ORIGIN = {
    "Access-Control-Allow-Origin": "*"
};

// Default model
const DEFAULT_MODEL = "command-r-plus";

// Model aliases for convenience
const MODEL_ALIASES = {
    "command": "command-r-plus",
    "command-r": "command-r",
    "command-r-plus": "command-r-plus",
    "command-r-plus-08-2024": "command-r-plus-08-2024",
    "command-r-08-2024": "command-r-08-2024",
    "command-light": "command-r7b-12-2024",
    "command-nightly": "command-r-plus",
    "c4ai-aya-expanse-8b": "c4ai-aya-expanse-8b",
    "c4ai-aya-expanse-32b": "c4ai-aya-expanse-32b"
};

// Cache for models
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

            // Health check
            if (pathname === "/cohere/health" || pathname === "/health") {
                return jsonResponse({ status: "ok", service: "cohere-worker" });
            }

            // Root info
            if (pathname === "/" || pathname === "/cohere" || pathname === "/cohere/") {
                return jsonResponse({
                    service: "G4F Cohere Worker",
                    version: "1.0.0",
                    endpoints: {
                        chat: "/v1/chat/completions",
                        models: "/v1/models",
                        health: "/health"
                    },
                    documentation: "https://g4f.dev/docs"
                });
            }

            return jsonResponse({ error: "Not found" }, 404);
        } catch (error) {
            console.error("Cohere worker error:", error);
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
        // Find non-g4f key
        const cohereKey = tokens.find(t => t && !t.startsWith("g4f_"));
        if (cohereKey) return cohereKey;
    }

    // Check X-API-Key header
    const xApiKey = request.headers.get("X-API-Key");
    if (xApiKey && !xApiKey.startsWith("g4f_")) {
        return xApiKey;
    }

    // Fall back to environment variable
    return env.COHERE_API_KEY || null;
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

    try {
        const response = await fetch(`${COHERE_MODELS_API}?page_size=500&endpoint=chat`, {
            headers: {
                "Authorization": apiKey ? `Bearer ${apiKey}` : null,
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) {
            return jsonResponse({
                error: {message: `Status ${response.status}`}
            });
        }

        const data = await response.json();
        const models = data.models || [];

        // Filter for chat-capable models
        const chatModels = models.filter(model => 
            model.endpoints && model.endpoints.includes("chat")
        );

        const modelList = chatModels.map(model => ({
            id: model.name,
            object: "model",
            created: Date.now() / 1000,
            owned_by: "cohere",
            permission: [],
            root: model.name,
            parent: null,
            supports_vision: model.supports_vision || false
        }));

        // Add aliases
        for (const [alias, realModel] of Object.entries(MODEL_ALIASES)) {
            if (!modelList.find(m => m.id === alias) && alias !== realModel) {
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
        return jsonResponse({
            error: error.message
        }, 500);
    }
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
                message: "API key required. Get your Cohere API key at https://dashboard.cohere.com/api-keys",
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

    const { 
        messages, 
        stream = false, 
        max_tokens,
        temperature,
        top_p,
        top_k,
        stop,
        ...extraParams 
    } = body;
    
    const model = resolveModel(body.model);

    if (!messages || !Array.isArray(messages)) {
        return jsonResponse({ error: { message: "messages array is required" } }, 400);
    }

    // Build Cohere request
    const cohereRequest = buildCohereRequest(model, messages, {
        stream,
        max_tokens,
        temperature,
        top_p,
        top_k,
        stop
    });

    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Accept": stream ? "text/event-stream" : "application/json"
    };

    try {
        const response = await fetch(`${COHERE_API_BASE}/chat`, {
            method: "POST",
            headers,
            body: JSON.stringify(cohereRequest)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return jsonResponse({
                error: {
                    message: errorData.message || `Cohere API error: ${response.status}`,
                    type: "api_error",
                    code: response.status
                }
            }, response.status);
        }

        // Add custom headers
        const newHeaders = new Headers();
        for (const [key, value] of Object.entries(CORS_HEADERS)) {
            newHeaders.set(key, value);
        }
        newHeaders.set("X-Provider", "cohere");
        newHeaders.set("X-Model", model);

        if (stream) {
            // Transform Cohere SSE to OpenAI SSE format
            const transformedStream = transformCohereStream(response.body, model);
            newHeaders.set("Content-Type", "text/event-stream");
            newHeaders.set("Cache-Control", "no-cache");
            newHeaders.set("Connection", "keep-alive");
            
            return new Response(transformedStream, {
                status: 200,
                headers: newHeaders
            });
        } else {
            // Transform Cohere response to OpenAI format
            const cohereData = await response.json();
            const openaiResponse = transformCohereResponse(cohereData, model);
            newHeaders.set("Content-Type", "application/json");
            
            return new Response(JSON.stringify(openaiResponse), {
                status: 200,
                headers: newHeaders
            });
        }
    } catch (error) {
        console.error("Cohere API error:", error);
        return jsonResponse({
            error: {
                message: error.message || "Failed to call Cohere API",
                type: "api_error"
            }
        }, 500);
    }
}

// ============================================
// Request/Response Transformation
// ============================================

function buildCohereRequest(model, messages, options) {
    const request = {
        model,
        messages: messages,
        stream: options.stream || false
    };

    // Add optional parameters (using Cohere parameter names)
    if (options.max_tokens !== undefined) {
        request.max_tokens = options.max_tokens;
    }
    if (options.temperature !== undefined) {
        request.temperature = options.temperature;
    }
    if (options.top_p !== undefined) {
        request.p = options.top_p;
    }
    if (options.top_k !== undefined) {
        request.k = options.top_k;
    }
    if (options.stop !== undefined) {
        request.stop_sequences = Array.isArray(options.stop) ? options.stop : [options.stop];
    }
    if (options.tools !== undefined) {
        request.tools = options.tools;
    }
    if (options.response_format !== undefined) {
        request.response_format = options.response_format;
    }

    return request;
}

function transformCohereResponse(cohereData, model) {
    // Handle error in response
    if (cohereData.error) {
        throw new Error(cohereData.error);
    }

    const text = cohereData.text || "";
    const finishReason = mapFinishReason(cohereData.finish_reason);
    
    // Extract usage info
    const tokens = cohereData.usage?.tokens || {};
    const usage = {
        prompt_tokens: tokens.input_tokens || 0,
        completion_tokens: tokens.output_tokens || 0,
        total_tokens: (tokens.input_tokens || 0) + (tokens.output_tokens || 0)
    };

    return {
        id: `chatcmpl-${generateId()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
            index: 0,
            message: {
                role: "assistant",
                content: text
            },
            finish_reason: finishReason
        }],
        usage
    };
}

function transformCohereStream(readableStream, model) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    
    let buffer = "";
    const completionId = `chatcmpl-${generateId()}`;
    const created = Math.floor(Date.now() / 1000);

    const transform = new TransformStream({
        transform(chunk, controller) {
            buffer += decoder.decode(chunk, { stream: true });
            
            // Process complete SSE events
            const lines = buffer.split("\n");
            buffer = lines.pop() || ""; // Keep incomplete line in buffer

            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const data = line.slice(6).trim();
                    if (!data || data === "[DONE]") continue;

                    try {
                        const cohereEvent = JSON.parse(data);
                        const openaiChunk = transformCohereChunk(cohereEvent, model, completionId, created);
                        if (openaiChunk) {
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
                        }
                    } catch (e) {
                        console.error("Error parsing Cohere stream event:", e);
                    }
                }
            }
        },
        flush(controller) {
            // Send [DONE] marker
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        }
    });

    return readableStream.pipeThrough(transform);
}

function transformCohereChunk(cohereEvent, model, completionId, created) {
    // Handle different Cohere stream event types
    if (cohereEvent.type === "content-delta" || cohereEvent.type === "tool-plan-delta") {
        const text = cohereEvent.delta?.message?.content?.text || cohereEvent.delta?.message?.tool_plan || "";
        return {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{
                index: 0,
                delta: {
                    content: text
                },
                finish_reason: null
            }]
        };
    }
    
    if (cohereEvent.type === "message-end") {
        const delta = cohereEvent.delta || {};
        const finishReason = mapFinishReason(delta.finish_reason);
        
        // Include usage in final chunk if available
        const tokens = delta.usage?.tokens || {};
        const usage = tokens.input_tokens ? {
            prompt_tokens: tokens.input_tokens || 0,
            completion_tokens: tokens.output_tokens || 0,
            total_tokens: (tokens.input_tokens || 0) + (tokens.output_tokens || 0)
        } : undefined;

        return {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{
                index: 0,
                delta: {},
                finish_reason: finishReason
            }],
            ...(usage && { usage })
        };
    }

    if (cohereEvent.type === "message-start") {
        // Initial message chunk with role
        return {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{
                index: 0,
                delta: {
                    role: "assistant",
                    content: ""
                },
                finish_reason: null
            }]
        };
    }


    if (cohereEvent.type === "tool-call-start" || cohereEvent.type === "tool-call-delta") {
        // Initial message chunk with role
        return {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{
                index: 0,
                delta: {
                    tool_calls: cohereEvent.delta?.message?.tool_calls || []
                },
                finish_reason: null
            }]
        };
    }

    // Ignore other event types (stream-start, stream-end, etc.)
    return null;
}

function mapFinishReason(cohereReason) {
    switch (cohereReason) {
        case "COMPLETE":
            return "stop";
        case "MAX_TOKENS":
            return "length";
        case "STOP_SEQUENCE":
            return "stop";
        case "ERROR":
            return "error";
        default:
            return cohereReason ? cohereReason.toLowerCase() : "stop";
    }
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

function generateId() {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < 24; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
