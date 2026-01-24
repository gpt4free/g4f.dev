/**
 * OpenAI-compatible Cloudflare Worker for Puter.js API
 * 
 * This worker provides an OpenAI-compatible API endpoint that forwards requests
 * to the Puter.js API with automatic token estimation for usage tracking.
 */

const PUTER_API_ENDPOINT = "https://api.puter.com/drivers/call";
const DEFAULT_MODEL = "google:google/gemini-3-flash-preview";

// Model aliases mapping (same as PuterJS.py)
const MODEL_ALIASES = {};

// OpenAI models that use openai-completion driver
const OPENAI_MODELS = [
  "gpt-4o", "gpt-4o-mini", "o1", "o1-mini", "o1-pro", "o3", "o3-mini", "o4-mini",
  "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4.5-preview"
];

// Mistral models that use mistral driver
const MISTRAL_MODELS = [
  "ministral-3b-2410", "ministral-3b-latest", "ministral-8b-2410", "ministral-8b-latest",
  "open-mistral-7b", "mistral-tiny", "mistral-tiny-2312", "open-mixtral-8x7b",
  "mistral-small", "mistral-small-2312", "open-mixtral-8x22b", "open-mixtral-8x22b-2404",
  "mistral-large-2411", "mistral-large-latest", "pixtral-large-2411", "pixtral-large-latest",
  "mistral-large-pixtral-2411", "codestral-2501", "codestral-latest", "codestral-2412",
  "codestral-2411-rc5", "pixtral-12b-2409", "pixtral-12b", "pixtral-12b-latest",
  "mistral-small-2503", "mistral-small-latest"
];

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
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  
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
 * Determine the appropriate Puter driver based on model name
 * 
 * @param {string} model - Model name
 * @returns {string} Driver name
 */
function getDriverForModel(model) {
  if (model.includes("openrouter:")) {
    return "openrouter";
  } else if (OPENAI_MODELS.includes(model) || model.startsWith("gpt-")) {
    return "openai-completion";
  } else if (MISTRAL_MODELS.includes(model)) {
    return "mistral";
  } else if (model.includes("grok")) {
    return "xai";
  } else if (model.includes("claude")) {
    return "claude";
  } else if (model.includes("deepseek")) {
    return "deepseek";
  } else if (model.includes("gemini")) {
    return "gemini";
  } else {
    return "openai-completion";
  }
}

/**
 * Resolve model alias to actual model name
 * 
 * @param {string} model - User-provided model name
 * @returns {string} Resolved model name
 */
function resolveModel(model) {
  if (!model) return DEFAULT_MODEL;
  
  if (MODEL_ALIASES[model]) {
    const alias = MODEL_ALIASES[model];
    // If alias is array, pick first option
    return Array.isArray(alias) ? alias[0] : alias;
  }
  
  return model;
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
 * Parse SSE data from Puter API response
 */
function parseSSEData(line) {
  if (!line.startsWith('data: ')) return null;
  const data = line.slice(6);
  if (data === '[DONE]') return { done: true };
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Handle streaming response from Puter API
 */
async function handleStreamingResponse(env, ctx, clientIP, response, model, promptTokens) {
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
        if (done) break;

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
  if (data.text) {
    delta.content = data.text;
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
 * Handle non-streaming response from Puter API
 */
async function handleNonStreamingResponse(env, ctx, clientIP, response, requestId, model, promptTokens) {
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
    
    const reasoningContent = message.reasoning_content || null;
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


    if (usage) {
        ctx.waitUntil(persistUsageToDb(env, clientIP, "puter", model, usage.total_tokens, usage.prompt_tokens, usage.completion_tokens));
    }
    
    const responseObj = createChatCompletionResponse(requestId, model, content, finishReason, usage, reasoningContent);
    
    // Add tool calls if present
    if (message.tool_calls) {
      responseObj.choices[0].message.tool_calls = message.tool_calls;
    }
    
    return Response.json(responseObj, { headers: CORS_HEADERS });
  }
  
  // Handle SSE response for non-streaming request (accumulate all chunks)
  if (contentType.includes('text/event-stream')) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completionText = '';
    let reasoningText = '';
    let finishReason = 'stop';
    let apiUsage = null;
    let toolCalls = null;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        const data = parseSSEData(line);
        if (!data || data.done) continue;
        
        const choices = data.choices || [];
        const choice = choices[0] || {};
        const delta = choice.delta || {};
        
        if (delta.content) completionText += delta.content;
        if (delta.reasoning_content) reasoningText += delta.reasoning_content;
        if (delta.tool_calls) toolCalls = delta.tool_calls;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        if (data.usage) apiUsage = data.usage;
      }
    }
    
    const completionTokens = apiUsage?.completion_tokens || estimateTokens(completionText + reasoningText);
    const finalPromptTokens = apiUsage?.prompt_tokens || promptTokens;
    const usage = createUsage(finalPromptTokens, completionTokens);
    
    const responseObj = createChatCompletionResponse(
      requestId, model, completionText, finishReason, usage,
      reasoningText || null
    );
    
    if (toolCalls) {
      responseObj.choices[0].message.tool_calls = toolCalls;
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
  const {
    model: requestedModel,
    messages,
    stream = false,
    temperature,
    top_p,
    presence_penalty,
    frequency_penalty,
    response_format,
    tools,
    tool_choice,
    parallel_tool_calls,
    reasoning_effort,
    logit_bias,
    voice,
    modalities,
    audio
  } = body;
  
  // Resolve model and determine driver
  const model = resolveModel(requestedModel);
  const driver = getDriverForModel(model);
  
  // Estimate prompt tokens
  const promptTokens = estimatePromptTokens(messages);
  
  // Generate request ID
  const requestId = `chatcmpl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Build Puter API request
  const puterRequest = {
    interface: "puter-chat-completion",
    driver: "ai-chat",
    test_mode: messages[0]?.content === "test",
    auth_token: apiKey,
    method: "complete",
    args: {
      messages: messages,
      model: model,
      stream: stream
    }
  };
  
  // Add optional parameters
  if (temperature !== undefined) puterRequest.args.temperature = temperature;
  if (top_p !== undefined) puterRequest.args.top_p = top_p;
  if (presence_penalty !== undefined) puterRequest.args.presence_penalty = presence_penalty;
  if (frequency_penalty !== undefined) puterRequest.args.frequency_penalty = frequency_penalty;
  if (response_format) puterRequest.args.response_format = response_format;
  if (tools) puterRequest.args.tools = tools;
  if (tool_choice) puterRequest.args.tool_choice = tool_choice;
  if (parallel_tool_calls !== undefined) puterRequest.args.parallel_tool_calls = parallel_tool_calls;
  if (reasoning_effort) puterRequest.args.reasoning_effort = reasoning_effort;
  if (logit_bias) puterRequest.args.logit_bias = logit_bias;
  if (voice) puterRequest.args.voice = voice;
  if (modalities) puterRequest.args.modalities = modalities;
  if (audio) puterRequest.args.audio = audio;
  
  let response;
    response = await fetch(PUTER_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json;charset=UTF-8',
        'Accept': stream ? 'text/event-stream' : '*/*',
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
  
  if (stream && contentType.includes('application/x-ndjson')) {
    return handleStreamingResponse(env, ctx, getClientIP(request), response, model, promptTokens);
  } else {
    return handleNonStreamingResponse(env, ctx, getClientIP(request), response, requestId, model, promptTokens);
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
    
    const modelList = data.models.map(id => ({
      id: id,
      object: "model",
      created: 0,
      owned_by: id.includes(':') ? id.split(':')[1].split('/')[0] : "puter"
    }));
    
    return Response.json({ object: "list", data: modelList }, { headers: CORS_HEADERS });
  } catch (error) {
    return Response.json(
      { error: { message: "Failed to fetch models: " + error.message, type: "api_error" } },
      { status: 500, headers: CORS_HEADERS }
    );
  }
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

function getClientIP(request) {
  return request.headers.get('cf-connecting-ip') || 
         request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
         'unknown';
}
