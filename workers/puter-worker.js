/**
 * OpenAI-compatible Cloudflare Worker for Puter.js API
 * 
 * This worker provides an OpenAI-compatible API endpoint that forwards requests
 * to the Puter.js API with automatic token estimation for usage tracking.
 */

const PUTER_API_ENDPOINT = "https://api.puter.com/drivers/call";
const PUTER_USAGE_ENDPOINT = "https://api.puter.com/metering/usage";

// Model aliases mapping (same as PuterJS.py)
const MODEL_ALIASES = {
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, x-api-key",
  "Access-Control-Expose-Headers": "content-type, x-provider"
};

/**
 * Estimate token count from text using a simple heuristic
 * Average English word is ~4 characters, average token is ~4 characters
 * This provides a rough estimate suitable for usage tracking
 * 
 * @param {string} text - Text to estimate tokens for
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  
  // Simple heuristic: ~4 characters per token for English text
  // Adjust for whitespace and punctuation
  const charCount = text.length;
  
  // Use a combination of character and word count for better accuracy
  // Tokens are roughly words + punctuation overhead
  const tokenEstimate = Math.ceil(charCount / 4);
  
  // Minimum 1 token if there's any content
  return Math.max(1, tokenEstimate);
}

/**
 * Estimate tokens from messages array
 * 
 * @param {Array} messages - Array of message objects
 * @returns {number} Estimated prompt token count
 */
function estimatePromptTokens(messages) {
  if (!messages || !Array.isArray(messages)) return 0;
  
  let totalTokens = 0;
  
  for (const msg of messages) {
    // Add tokens for role (~1-2 tokens)
    totalTokens += 4;
    
    const content = msg.content;
    if (typeof content === 'string') {
      totalTokens += estimateTokens(content);
    } else if (Array.isArray(content)) {
      // Handle multi-modal content
      for (const item of content) {
        if (item.type === 'text') {
          totalTokens += estimateTokens(item.text || '');
        } else if (item.type === 'image_url') {
          // Images typically cost ~85-170 tokens depending on size
          totalTokens += 85;
        }
      }
    }
  }
  
  // Add overhead for message formatting (~3 tokens per message)
  totalTokens += messages.length * 3;
  
  return totalTokens;
}

/**
 * Create OpenAI-compatible usage object with estimated tokens
 * 
 * @param {number} promptTokens - Prompt token count
 * @param {number} completionTokens - Completion token count
 * @returns {Object} Usage object
 */
function createUsage(promptTokens, completionTokens) {
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    prompt_tokens_details: {
      cached_tokens: 0,
      audio_tokens: 0
    },
    completion_tokens_details: {
      reasoning_tokens: 0,
      audio_tokens: 0,
      accepted_prediction_tokens: 0,
      rejected_prediction_tokens: 0
    }
  };
}

/**
 * Create OpenAI-compatible chat completion response
 */
function createChatCompletionResponse(id, model, content, finishReason, usage, reasoning = null) {
  const message = {
    role: "assistant",
    content: content
  };
  
  if (reasoning) {
    message.reasoning_content = reasoning;
  }
  
  return {
    id: id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [{
      index: 0,
      message: message,
      logprobs: null,
      finish_reason: finishReason || "stop"
    }],
    usage: usage,
    system_fingerprint: "puter-worker"
  };
}

/**
 * Handle streaming response from Puter API
 */
async function handleStreamingResponse(env, ctx, response, model, promptTokens) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completionTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const data = JSON.parse(line);
            const chunk = createStreamChunk(data, model);
            await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            completionTokens += 1;
          } catch (e) {
            console.error("Parse error:", e);
          }
        }
      }

      // Send usage chunk before [DONE] if we have usage data
      if (completionTokens) {
        const usageChunk = {
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [],
          usage: {
            prompt_tokens: promptTokens || 0,
            completion_tokens: completionTokens || 0,
            total_tokens: (promptTokens || 0) + (completionTokens || 0)
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
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Create a streaming chunk in OpenAI format
 */
function createStreamChunk(data, model) {
  const delta = {};
  
  if (data.reasoning) {
    delta.reasoning_content = data.reasoning;
  }
  if (data.text) {
    delta.content = Array.isArray(data.text) && data.text ? data.text[0].text : data.text;
  }
  if (data.type === "tool_use") {
    delta.tool_calls = [{
        id: data.id,
        type: 'function',
        function: {
            name: data.name,
            arguments: data.input
        }
    }]
  }

  // Determine finish_reason
  let finishReason = data.tool_calls ? "tool_calls" : "stop";

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
 * Handle non-streaming response from Puter API
 */
async function handleNonStreamingResponse(env, ctx, response, requestId, model, promptTokens) {
  const contentType = response.headers.get('content-type') || '';
  
  if (contentType.includes('application/json')) {
    const result = await response.json();
    
    if (result.error) {
      return Response.json(
        { error: { message: result.error.message || JSON.stringify(result.error), type: "api_error" } },
        { status: 500, headers: CORS_HEADERS }
      );
    }
    
    let choice = result.choices?.[0] || result.result || {};
    let message = choice.message || {};
    
    const content = typeof message.content === 'string' 
      ? message.content 
      : Array.isArray(message.content)
        ? message.content.filter(i => i.type === 'text').map(i => i.text).join('')
        : '';
    
    const reasoningContent = message.reasoning || null;
    const finishReason = choice.finish_reason || 'stop';
    
    // Use API-provided usage or estimate
    let usage;
    if (result.usage) {
      usage = {
        prompt_tokens: result.usage.prompt_tokens || promptTokens,
        completion_tokens: result.usage.completion_tokens || estimateTokens(content + (reasoningContent || '')),
        total_tokens: result.usage.total_tokens || (promptTokens + estimateTokens(content + (reasoningContent || '')))
      };
    } else {
      const completionTokens = estimateTokens(content + (reasoningContent || ''));
      usage = createUsage(promptTokens, completionTokens);
    }
    
    const responseObj = createChatCompletionResponse(requestId, model, content, finishReason, usage, reasoningContent);
    
    // Add tool calls if present
    if (result.tool_use) {
      responseObj.choices[0].message.tool_calls = [{
          id: result.id,
          type: 'function',
          function: {
              name: result.name,
              arguments: result.input
          }
      }];
    }
    
    return Response.json(responseObj, { headers: CORS_HEADERS });
  }
  
  return Response.json(
    { error: { message: `Unexpected content type: ${contentType}`, type: "api_error" } },
    { status: 500, headers: CORS_HEADERS }
  );
}

/**
 * Handle chat completion request
 */
async function handleChatCompletion(env, ctx, request, apiKey) {
  const body = await request.json();
  
  // Estimate prompt tokens
  const promptTokens = estimatePromptTokens(body.messages);
  
  // Generate request ID
  const requestId = `chatcmpl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Build Puter API request
  const puterRequest = {
    "interface": "puter-chat-completion",
    "driver": "ai-chat",
    "test_mode": body.messages[0].content != "test",
    "method": "complete",
    "args": body
  }
  
  let response;
    response = await fetch(PUTER_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json;charset=UTF-8',
        'Accept': body.stream ? 'text/event-stream' : '*/*',
        'Origin': 'http://docs.puter.com',
        'Referer': 'http://docs.puter.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
      },
      body: JSON.stringify(puterRequest),
    });
  
  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error?.message || errorJson.message || errorText;
    } catch {
      errorMessage = errorText;
    }
    
    return Response.json(
      { error: { message: errorMessage, type: "api_error" } },
      { status: response.status, headers: CORS_HEADERS }
    );
  }
  
  const contentType = response.headers.get('content-type') || '';
  
  if (body.stream && contentType.includes('application/x-ndjson')) {
    return handleStreamingResponse(env, ctx, response, body.model, promptTokens);
  } else {
    return handleNonStreamingResponse(env, ctx, response, requestId, body.model, promptTokens);
  }
}

/**
 * Get available models
 */
async function handleModels() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    let response;
    try {
      response = await fetch('https://api.puter.com/puterai/chat/models/', {
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
    
    const data = await response.json();
    
    let models = (data.models || []);
    
    // Add alias keys
    models = [...new Set([...models, ...Object.keys(MODEL_ALIASES)])];
    
    const modelList = models.map(id => ({
      id: id,
      object: "model",
      created: 1700000000,
      owned_by: id.includes('openrouter:') ? id.split(':')[1].split('/')[0] : "puter"
    }));
    
    return Response.json({ object: "list", data: modelList }, { headers: CORS_HEADERS });
  } catch (error) {
    return Response.json(
      { error: { message: "Failed to fetch models: " + error.message, type: "api_error" } },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

async function handleQuota(request) {
  return await fetch(PUTER_USAGE_ENDPOINT, request);
}

/**
 * Handle OPTIONS request
 */
function handleOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

/**
 * Main request handler
 */
async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return handleOptions();
  }
  
  // Get API key from Authorization header
  const authHeader = request.headers.get('Authorization') || '';
  const apiKey = authHeader.replace('Bearer ', '').trim();
  
  // Routes
  if (pathname.endsWith('/models')) {
    return handleModels();
  }

   if (pathname.endsWith('/quota')) {
    return handleQuota(request);
  }
  
  if (pathname.endsWith('/chat/completions')) {
    if (!apiKey) {
      return Response.json(
        { error: { message: "API key required. Get one from https://github.com/HeyPuter/puter-cli", type: "auth_error" } },
        { status: 401, headers: CORS_HEADERS }
      );
    }
    
    if (request.method !== 'POST') {
      return Response.json(
        { error: { message: "Method not allowed", type: "invalid_request_error" } },
        { status: 405, headers: CORS_HEADERS }
      );
    }
    
    return handleChatCompletion(env, ctx, request, apiKey);
  }
  
  // Health check
  if (pathname === '/' || pathname === '/health') {
    return Response.json({
      status: "ok",
      service: "puter-openai-compatible",
      version: "1.0.0",
      endpoints: {
        models: "/models",
        chat_completions: "/chat/completions"
      }
    }, { headers: CORS_HEADERS });
  }
  
  return Response.json(
    { error: { message: "Not found", type: "invalid_request_error" } },
    { status: 404, headers: CORS_HEADERS }
  );
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      console.error('Worker error:', error);
      return Response.json(
        { error: { message: error.message || "Internal server error", type: "server_error" } },
        { status: 500, headers: CORS_HEADERS }
      );
    }
  }
};