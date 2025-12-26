/**
 * Extract fastapiusersauth from Authorization header or env
 */
function getFastapiUsersAuth(request, env) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    // Support: Bearer fastapiusersauth_xxx or Bearer ... fastapiusersauth_xxx ...
    const fastapiToken = authHeader.substring(7).split(/\s+/).pop();
    if (fastapiToken) return fastapiToken.replace(/^fastapiusersauth[=:_-]?/, "");
  }
  return env.ONYX_SESSION_COOKIE;
}

/**
 * Handle POST /v1/create-session - Create a new chat session and return chat_session_id
 */
async function handleCreateSession(request, env) {
  const fastapiusersauth = getFastapiUsersAuth(request, env);
  const sessionRes = await fetch("https://cloud.onyx.app/api/chat/create-chat-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "origin": "https://cloud.onyx.app",
      "referer": "https://cloud.onyx.app/chat",
      "cookie": `fastapiusersauth=${fastapiusersauth}`
    },
    body: JSON.stringify({})
  });
  let chat_session_id = null;
  if (sessionRes.ok) {
    try {
      const sessionBody = await sessionRes.json();
      chat_session_id = sessionBody?.conversation?.chat_session_id;
    } catch (e) {}
  }
  return new Response(JSON.stringify({ chat_session_id }), {
    headers: { "Content-Type": "application/json" }
  });
}
/**
 * Cloudflare Worker for Onyx - OpenAI Compatible API
 *
 * This worker provides an OpenAI-compatible API endpoint that proxies
 * requests to cloud.onyx.app.
 *
 * Environment Variables:
 * - ONYX_SESSION_COOKIE: fastapiusersauth cookie for cloud.onyx.app (required)
 */


const ONYX_API_URL = "https://cloud.onyx.app/api/chat/send-message";
const ONYX_PROVIDER_URL = "https://cloud.onyx.app/api/llm/provider";
/**
 * Handle GET /v1/models - List available models from Onyx
 */
async function handleListModels(request, env) {
  // Prepare headers (Onyx requires session cookie)
  const headers = {
    "cookie": `fastapiusersauth=${getFastapiUsersAuth(request, env)}`
  };
  let models = [];
  try {
    const response = await fetch(ONYX_PROVIDER_URL, { headers });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        for (const provider of data) {
          if (provider.model_configurations && Array.isArray(provider.model_configurations)) {
            for (const model of provider.model_configurations) {
              models.push({
                id: model.name,
                object: "model",
                created: Math.floor(Date.now() / 1000),
                owned_by: provider.name || "onyx",
                ...model
              });
            }
          }
        }
      }
    }
  } catch (e) {
    // ignore, return empty list
  }
  return new Response(JSON.stringify({
    object: "list",
    data: models
  }), {
    headers: { "Content-Type": "application/json" }
  });
}

/**
 * Convert OpenAI messages format to Onyx format
 * Only send the last user message as content
 */
function convertMessages(messages) {
  // Find the last user message
  let lastUserMsg = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserMsg = messages[i].content;
      break;
    }
  }
  return lastUserMsg ? lastUserMsg.trim() : "";
}


/**
 * Handle POST /v1/chat/completions - Chat completion with session management and user-provided conversation
 */
async function handleChatCompletion(request, env, ctx) {
  const body = await request.json();
  const model = body.model || "gpt-4o";
  const messages = body.messages || [];
  const stream = body.stream || false;

  // Support user-provided conversation
  let chat_session_id = body.conversation?.chat_session_id;
  let parent_message_id = body.conversation?.parent_message_id || null;

  // Extract fastapiusersauth from Authorization or env
  const fastapiusersauth = getFastapiUsersAuth(request, env);

  // If not provided, create a new chat session
  if (!chat_session_id) {
    const sessionRes = await fetch("https://cloud.onyx.app/api/chat/create-chat-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "origin": "https://cloud.onyx.app",
        "referer": "https://cloud.onyx.app/chat",
        "cookie": `fastapiusersauth=${fastapiusersauth}`
      },
      body: JSON.stringify({"persona_id":0,"description":null,"project_id":null})
    });
    if (sessionRes.ok) {
      try {
        const sessionBody = await sessionRes.json();
        chat_session_id = sessionBody?.chat_session_id;
      } catch(e) {}
    }
  }
  // Compose Onyx request body
  const onyxBody = {"alternate_assistant_id":0,"chat_session_id":chat_session_id,"parent_message_id":parent_message_id,"message":convertMessages(messages),"prompt_id":null,"search_doc_ids":null,"current_message_files":[],"regenerate":false,"retrieval_options":{"run_search":"auto","real_time":true,"filters":{"source_type":null,"document_set":null,"time_cutoff":null,"tags":[]}},"prompt_override":null,"llm_override":{"model_provider":model.includes("claude") ? "Anthropic" : "OpenAI","model_version":model},"use_agentic_search":false,"forced_tool_ids":[]};

  // Prepare headers
  const headers = {
    "Content-Type": "application/json",
    "origin": "https://cloud.onyx.app",
    "referer": "https://cloud.onyx.app/chat",
    "cookie": `fastapiusersauth=${fastapiusersauth}`
  };

  // Send request to Onyx
  const response = await fetch(ONYX_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(onyxBody)
  });

  if (!response.ok) {
    return new Response(JSON.stringify({
      error: {
        message: `Onyx API error: ${response.status}: ${chat_session_id}`,
        type: "api_error",
        code: response.status
      }
    }), {
      status: response.status,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Stream or non-stream response handling
  if (stream) {
    return handleOnyxStream(response, model, chat_session_id, parent_message_id);
  } else {
    return handleOnyxNonStream(response, model, chat_session_id, parent_message_id);
  }
}


/**
 * Handle streaming response from Onyx, return session info in last chunk
 */

function handleOnyxStream(response, model, chat_session_id, parent_message_id) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  let lastParentId = parent_message_id;
  let chunkCount = 0;

  (async () => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
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
            const obj = JSON.parse(line);
            if (obj.obj?.type === "message_delta" && obj.obj.content) {
              content += obj.obj.content;
              chunkCount++;
              const chunk = createStreamChunk(obj.obj.content, model);
              await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }
            if (obj.obj?.type === "stop") {
              // Return new session info and usage in last chunk
              let newParentId = (typeof lastParentId === 'number') ? lastParentId + 2 : null;
              const lastChunk = {
                id: `chatcmpl-${Date.now()}`,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{
                  index: 0,
                  delta: {},
                  finish_reason: "stop"
                }],
                conversation: {
                  chat_session_id,
                  parent_message_id: newParentId
                },
                usage: {
                  prompt_tokens: 1, // always 1 user message
                  completion_tokens: chunkCount,
                  total_tokens: 1 + chunkCount
                }
              };
              await writer.write(encoder.encode(`data: ${JSON.stringify(lastChunk)}\n\n`));
              await writer.write(encoder.encode("data: [DONE]\n\n"));
            }
          } catch (e) {}
        }
      }
      await writer.close();
    } catch (e) {
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
 * Handle non-streaming response from Onyx, return session info in response
 */

async function handleOnyxNonStream(response, model, chat_session_id, parent_message_id) {
  const text = await response.text();
  let content = "";
  let chunkCount = 0;
  try {
    // Onyx may return multiple JSON lines
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const obj = JSON.parse(line);
      if (obj.obj?.type === "message_delta" && obj.obj.content) {
        content += obj.obj.content;
        chunkCount++;
      }
    }
  } catch (e) {}
  let newParentId = (typeof parent_message_id === 'number') ? parent_message_id + 2 : null;
  return new Response(JSON.stringify(createCompletionResponse(content, model, chat_session_id, newParentId, chunkCount)), {
    headers: { "Content-Type": "application/json" }
  });
}

/**
 * Create a streaming chunk in OpenAI format
 */
function createStreamChunk(content, model) {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [{
      index: 0,
      delta: { content },
      finish_reason: null
    }]
  };
}


/**
 * Create a completion response in OpenAI format, with conversation info
 */

function createCompletionResponse(content, model, chat_session_id, parent_message_id, chunkCount) {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop"
    }],
    usage: {
      prompt_tokens: 1, // always 1 user message
      completion_tokens: chunkCount || 0,
      total_tokens: 1 + (chunkCount || 0)
    },
    conversation: chat_session_id ? {
      chat_session_id,
      parent_message_id
    } : undefined
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
      // Support /v1/models endpoint
      if (path.endsWith("/models") && request.method === "GET") {
        response = await handleListModels(request, env);
      } else if (path.endsWith("/create-session") && request.method === "POST") {
        response = await handleCreateSession(request, env);
      } else if (path.endsWith("/chat/completions") && request.method === "POST") {
        response = await handleChatCompletion(request, env, ctx);
      } else if (path === "/" || path === "/health") {
        response = new Response(JSON.stringify({
          status: "ok",
          service: "Onyx OpenAI-Compatible API",
          endpoints: ["/models", "/chat/completions", "/create-session"]
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
