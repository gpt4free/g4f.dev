/**
 * Cloudflare Worker for Ollama - OpenAI Compatible API
 * 
 * This worker provides an OpenAI-compatible API endpoint that proxies
 * requests to ollama.com.
 * 
 * Environment Variables:
 * - OLLAMA_API_KEY: API key for ollama.com (required)
 */

const OLLAMA_COM_API = "https://ollama.com/api/chat";
const OLLAMA_COM_TAGS = "https://ollama.com/api/tags";

const MODEL_ALIASES = {
  "gpt-oss-120b": "gpt-oss:120b",
  "gpt-oss-20b": "gpt-oss:20b"
};

/**
 * Resolve model aliases
 */
function resolveModel(model) {
  return MODEL_ALIASES[model] || model;
}

/**
 * Convert OpenAI messages format to Ollama format
 */
function convertMessages(messages) {
  return messages.map(msg => {
    const converted = {
      role: msg.role,
      content: msg.content
    };
    // Handle tool calls in assistant messages
    if (msg.tool_calls) {
      converted.tool_calls = msg.tool_calls;
    }
    // Handle tool response messages
    if (msg.role === "tool" && msg.tool_call_id) {
      converted.tool_call_id = msg.tool_call_id;
    }
    return converted;
  });
}

/**
 * Convert OpenAI tools format to Ollama format
 */
function convertTools(tools) {
  if (!tools || !Array.isArray(tools)) return undefined;
  return tools.map(tool => {
    if (tool.type === "function") {
      return {
        type: "function",
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters
        }
      };
    }
    return tool;
  });
}

/**
 * Handle GET /v1/models - List available models
 */
async function handleListModels(request, env) {
  const models = [];

  // Extract API key from Authorization header or env
  const authHeader = request.headers.get("Authorization");
  const apiKey = authHeader ? authHeader.replace("Bearer ", "").trim() : env.OLLAMA_API_KEY;

  try {
    const response = await fetch(OLLAMA_COM_TAGS, {
      headers: apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}
    });
    if (response.ok) {
      const data = await response.json();
      if (data.models) {
        for (const model of data.models) {
          models.push({
            id: model.name,
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: "ollama"
          });
        }
      }
    }
  } catch (e) {
    console.log("Ollama.com not available:", e.message);
  }

  return new Response(JSON.stringify({
    object: "list",
    data: models
  }), {
    headers: { "Content-Type": "application/json" }
  });
}

/**
 * Handle POST /v1/chat/completions - Chat completion
 */
async function handleChatCompletion(request, env, ctx) {
  const body = await request.json();
  const model = resolveModel(body.model);
  const messages = convertMessages(body.messages || []);
  const stream = body.stream || false;

  // Validate user for usage tracking
  const userInfo = await validateUserApiKey(request, env);

  // Extract API key from Authorization header or env
  const authHeader = request.headers.get("Authorization");
  // Handle space-separated keys - extract non-g4f key for provider auth
  let apiKey = env.OLLAMA_API_KEY;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const tokens = authHeader.substring(7).split(/\s+/);
    const providerKey = tokens.find(t => t && !t.startsWith('g4f_'));
    if (providerKey) {
      apiKey = providerKey;
    }
  }

  if (!apiKey) {
    return new Response(JSON.stringify({
      error: {
        message: "API key is required",
        type: "auth_error",
        code: 401
      }
    }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  return await handleOllamaComRequest(env, ctx, getClientIP(request), model, messages, stream, apiKey, body, userInfo);
}

/**
 * Handle request to ollama.com
 */
async function handleOllamaComRequest(env, ctx, clientIP, model, messages, stream, apiKey, body, userInfo = null) {
  // Build request body
  const requestBody = {
    model: model,
    messages: messages,
    stream: stream
  };

  // Convert OpenAI response_format to Ollama format
  if (body.response_format?.type === "json_object") {
    requestBody.format = "json";
  }

  // Add tools if provided
  if (body.tools) {
    requestBody.tools = convertTools(body.tools);
  }

  // Add tool_choice if provided
  if (body.tool_choice) {
    requestBody.tool_choice = body.tool_choice;
  }

  const response = await fetch(OLLAMA_COM_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    return new Response(JSON.stringify({
      error: {
        message: `Ollama.com API error: ${response.status}`,
        type: "api_error",
        code: response.status
      }
    }), {
      status: response.status,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (stream) {
    return handleOllamaComStream(env, ctx, clientIP, response, model, userInfo);
  } else {
    return handleOllamaComNonStream(env, ctx, clientIP, response, model, userInfo);
  }
}

/**
 * Handle streaming response from ollama.com
 */
function handleOllamaComStream(env, ctx, clientIP, response, model, userInfo = null) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastData = {};

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const data = JSON.parse(line);
            lastData = data;
            const chunk = createStreamChunk(data, model);
            await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          } catch (e) {
            console.error("Parse error:", e);
          }
        }
      }

      // Send usage chunk before [DONE] if we have usage data
      if (lastData.prompt_eval_count || lastData.eval_count) {
        ctx.waitUntil(persistUsageToDb(env, clientIP, "ollama", model, lastData.prompt_eval_count + lastData.eval_count, lastData.prompt_eval_count, lastData.eval_count, null, null, userInfo));
        const usageChunk = {
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [],
          usage: {
            prompt_tokens: lastData.prompt_eval_count || 0,
            completion_tokens: lastData.eval_count || 0,
            total_tokens: (lastData.prompt_eval_count || 0) + (lastData.eval_count || 0)
          }
        };
        await writer.write(encoder.encode(`data: ${JSON.stringify(usageChunk)}\n\n`));
      }

      // Send final chunk
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } catch (e) {
      console.error("Stream error:", e);
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
}

/**
 * Handle non-streaming response from ollama.com
 */
async function handleOllamaComNonStream(env, ctx, clientIP, response, model, userInfo = null) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  let thinkingContent = "";
  let toolCalls = null;
  let lastData = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const lines = decoder.decode(value).split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        lastData = data;
        if (data.message?.thinking) {
          thinkingContent += data.message.thinking;
        }
        if (data.message?.content) {
          fullContent += data.message.content;
        }
        if (data.message?.tool_calls) {
          toolCalls = data.message.tool_calls;
        }
      } catch (e) {}
    }
  }

  return new Response(JSON.stringify(createCompletionResponse(
    env, ctx, clientIP, model, fullContent, thinkingContent, toolCalls, lastData, userInfo
  )), {
    headers: { "Content-Type": "application/json" }
  });
}

/**
 * Create a streaming chunk in OpenAI format
 */
function createStreamChunk(data, model) {
  const delta = {};
  
  if (data.message?.thinking) {
    // Include reasoning/thinking in the response
    delta.reasoning_content = data.message.thinking;
  }
  if (data.message?.content) {
    delta.content = data.message.content;
  }
  if (data.message?.role) {
    delta.role = data.message.role;
  }
  if (data.message?.tool_calls) {
    delta.tool_calls = data.message.tool_calls;
  }

  // Determine finish_reason
  let finishReason = null;
  if (data.done) {
    finishReason = data.message?.tool_calls ? "tool_calls" : "stop";
  }

  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [{
      index: 0,
      delta: delta,
      finish_reason: finishReason
    }]
  };
}

/**
 * Create a completion response in OpenAI format
 */
function createCompletionResponse(env, ctx, clientIP, model, content, thinkingContent, toolCalls, lastData, userInfo = null) {
  const message = {
    role: "assistant",
    content: content
  };

  // Include reasoning if present
  if (thinkingContent) {
    message.reasoning_content = thinkingContent;
  }

  // Include tool_calls if present
  if (toolCalls && toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((tc, index) => ({
      id: tc.id || `call_${Date.now()}_${index}`,
      type: "function",
      function: {
        name: tc.function?.name || tc.name,
        arguments: typeof tc.function?.arguments === "string" 
          ? tc.function.arguments 
          : JSON.stringify(tc.function?.arguments || tc.arguments || {})
      }
    }));
  }

  // Determine finish_reason
  const finishReason = (toolCalls && toolCalls.length > 0) ? "tool_calls" : "stop";

  ctx.waitUntil(persistUsageToDb(env, clientIP, "ollama", model, lastData.prompt_eval_count + lastData.eval_count, lastData.prompt_eval_count, lastData.eval_count, null, null, userInfo));

  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [{
      index: 0,
      message: message,
      finish_reason: finishReason
    }],
    usage: {
      prompt_tokens: lastData.prompt_eval_count || 0,
      completion_tokens: lastData.eval_count || 0,
      total_tokens: (lastData.prompt_eval_count || 0) + (lastData.eval_count || 0)
    }
  };
}

/**
 * Handle CORS preflight requests
 */
function handleOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

/**
 * Add CORS headers to response
 */
function addCorsHeaders(response) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set("Access-Control-Allow-Origin", "*");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

/**
 * Main request handler
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return handleOptions();
    }

    let response;

    try {
      // Route requests
      if (path.endsWith("/models") && request.method === "GET") {
        response = await handleListModels(request, env);
      } else if (path.endsWith("/chat/completions") && request.method === "POST") {
        response = await handleChatCompletion(request, env, ctx);
      } else if (path === "/" || path === "/health") {
        response = new Response(JSON.stringify({
          status: "ok",
          service: "Ollama OpenAI-Compatible API",
          endpoints: ["/models", "/chat/completions"]
        }), {
          headers: { "Content-Type": "application/json" }
        });
      } else {
        response = new Response(JSON.stringify({
          error: {
            message: "Not found",
            type: "invalid_request_error",
            code: 404
          }
        }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }
    } catch (error) {
      response = new Response(JSON.stringify({
        error: {
          message: error.message,
          type: "internal_error",
          code: 500
        }
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    return addCorsHeaders(response);
  }
};

// Persist usage to D1 database
async function persistUsageToDb(env, clientIP, provider, model, tokensUsed, promptTokens, completionTokens, pathname = null, firstMessage = null, userInfo = null) {
  if (!env.USAGE_DB) return;
  
  try {
    await env.USAGE_DB.prepare(
      `INSERT INTO usage_logs (ip, provider, model, tokens_total, tokens_prompt, tokens_completion, pathname, first_message, user_id, user_tier, timestamp) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      clientIP,
      provider || 'unknown',
      model || 'unknown',
      tokensUsed,
      promptTokens || 0,
      completionTokens || 0,
      pathname || 'unknown',
      firstMessage ? firstMessage.substring(0, 500) : null,
      userInfo?.user_id || null,
      userInfo?.tier || null,
      new Date().toISOString()
    ).run();
  } catch (e) {
    // Log error but don't fail the request
    console.error('Failed to persist usage:', e);
  }
}

function getClientIP(request) {
  return request.headers.get('cf-connecting-ip') || 
         request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
         'unknown';
}

/**
 * Parse cookies from request header
 */
function parseCookies(request) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return {};
  
  const cookies = {};
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) {
      cookies[name] = rest.join('=');
    }
  });
  return cookies;
}

/**
 * Hash an API key for secure lookup
 */
async function hashApiKey(apiKey) {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray, byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate user API key and return user info with tier
 * Supports: Authorization header, X-API-Key header, or g4f_session cookie
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment bindings
 * @returns {Object|null} User info with tier, or null if not authenticated
 */
async function validateUserApiKey(request, env) {
  const authHeader = request.headers.get('Authorization');
  const xApiKey = request.headers.get('X-API-Key');
  
  let apiKey = null;
  let sessionToken = null;
  
  // Check Authorization header for g4f_ API key
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const tokens = authHeader.substring(7).split(/\s+/);
    const g4fKey = tokens.find(t => t.startsWith('g4f_'));
    if (g4fKey) {
      apiKey = g4fKey;
    }
  }
  
  // Check X-API-Key header
  if (!apiKey && xApiKey && xApiKey.startsWith('g4f_')) {
    apiKey = xApiKey;
  }
  
  // Check for session cookie
  if (!apiKey) {
    const cookies = parseCookies(request);
    if (cookies.g4f_session) {
      sessionToken = cookies.g4f_session;
    }
  }
  
  // If we have an API key, validate it
  if (apiKey) {
    const keyHash = await hashApiKey(apiKey);
    
    if (!env.MEMBERS_KV) {
      return null;
    }
    
    const keyDataStr = await env.MEMBERS_KV.get(`api_key:${keyHash}`);
    if (!keyDataStr) {
      return null;
    }
    
    try {
      const keyData = JSON.parse(keyDataStr);
      return {
        user_id: keyData.user_id,
        key_id: keyData.key_id,
        tier: keyData.tier || 'free',
        api_key_hash: keyHash,
        auth_method: 'api_key'
      };
    } catch (e) {
      console.error('Failed to parse API key data:', e);
      return null;
    }
  }
  
  // If we have a session token, validate it
  if (sessionToken) {
    if (!env.MEMBERS_KV) {
      return null;
    }
    
    const sessionDataStr = await env.MEMBERS_KV.get(`session:${sessionToken}`);
    if (!sessionDataStr) {
      return null;
    }
    
    try {
      const sessionData = JSON.parse(sessionDataStr);
      
      if (sessionData.expires_at && new Date(sessionData.expires_at) < new Date()) {
        return null;
      }
      
      return {
        user_id: sessionData.user_id,
        key_id: null,
        tier: sessionData.tier || 'free',
        api_key_hash: null,
        auth_method: 'session'
      };
    } catch (e) {
      console.error('Failed to parse session data:', e);
      return null;
    }
  }
  
  return null;
}