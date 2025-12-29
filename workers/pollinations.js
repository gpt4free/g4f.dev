/**
 * Cloudflare Worker for Pollinations AI - OpenAI Compatible API
 * 
 * This worker provides an OpenAI-compatible API endpoint that proxies
 * requests to Pollinations AI services (both text.pollinations.ai and gen.pollinations.ai).
 * 
 * Environment Variables:
 * - POLLINATIONS_API_KEY: Optional API key for Pollinations AI (enables gen.pollinations.ai endpoints for premium features)
 */

const POLLINATIONS_TEXT_API = "https://text.pollinations.ai/openai";
const POLLINATIONS_IMAGE_API = "https://image.pollinations.ai/prompt/{prompt}";
const POLLINATIONS_MODELS_API = "https://text.pollinations.ai/models";
const POLLINATIONS_IMAGE_MODELS_API = "https://image.pollinations.ai/models";

const POLLINATIONS_GEN_TEXT_API = "https://gen.pollinations.ai/v1/chat/completions";
const POLLINATIONS_GEN_IMAGE_API = "https://gen.pollinations.ai/image/{prompt}";
const POLLINATIONS_GEN_MODELS_API = "https://gen.pollinations.ai/text/models";
const POLLINATIONS_GEN_IMAGE_MODELS_API = "https://gen.pollinations.ai/image/models";

const MODEL_ALIASES = {
  "openai": "openai",
  "deepseek": "deepseek",
  "flux": "flux",
  "turbo": "sdxl-turbo",
  "gptimage": "gpt-image",
  "kontext": "flux-kontext"
};

/**
 * Resolve model aliases
 */
function resolveModel(model) {
  return MODEL_ALIASES[model] || model;
}

/**
 * Handle GET /v1/models - List available models
 */
async function handleListModels(request, env) {
  const models = [];

  // Extract API key if provided
  const authHeader = request.headers.get("Authorization");
  let apiKey = env.POLLINATIONS_API_KEY;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const tokens = authHeader.substring(7).split(/\s+/);
    const providerKey = tokens.find(t => t && !t.startsWith('g4f_'));
    if (providerKey) {
      apiKey = providerKey;
    }
  }

  const useGen = !!apiKey;
  try {
    // Fetch text models
    const textModelsUrl = useGen ? POLLINATIONS_GEN_MODELS_API : POLLINATIONS_MODELS_API;
    const textResponse = await fetch(textModelsUrl);
    if (textResponse.ok) {
      const textData = await textResponse.json();
      const textModels = textData.data || textData || [];
      for (const model of textModels) {
        models.push({
          id: model.name || model,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "pollinations"
        });
      }
    }

    // Fetch image models
    const imageModelsUrl = useGen ? POLLINATIONS_GEN_IMAGE_MODELS_API : POLLINATIONS_IMAGE_MODELS_API;
    const imageResponse = await fetch(imageModelsUrl);
    if (imageResponse.ok) {
      const imageData = await imageResponse.json();
      for (const model of imageData) {
        const modelName = model.name || model;
        const isVideo = model.output_modalities && model.output_modalities.includes('video');
        models.push({
          id: modelName,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "pollinations",
          image: !isVideo,
          video: isVideo
        });
      }
    }
  } catch (e) {
    console.log("Pollinations models fetch failed:", e.message);
  }

  return new Response(JSON.stringify({
    object: "list",
    data: models
  }), {
    headers: { "Content-Type": "application/json" }
  });
}

/**
 * Handle GET /image/models - List available image models
 */
async function handleListImageModels(request, env) {
  const models = [];

  // Extract API key if provided
  const authHeader = request.headers.get("Authorization");
  let apiKey = env.POLLINATIONS_API_KEY;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const tokens = authHeader.substring(7).split(/\s+/);
    const providerKey = tokens.find(t => t && !t.startsWith('g4f_'));
    if (providerKey) {
      apiKey = providerKey;
    }
  }

  const useGen = !!apiKey;
  try {
    // Fetch image models
    const imageModelsUrl = useGen ? POLLINATIONS_GEN_IMAGE_MODELS_API : POLLINATIONS_IMAGE_MODELS_API;
    const imageResponse = await fetch(imageModelsUrl);
    if (imageResponse.ok) {
      const imageData = await imageResponse.json();
      for (const model of imageData) {
        const modelName = model.name || model;
        const isVideo = model.output_modalities && model.output_modalities.includes('video');
        models.push({
          id: modelName,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "pollinations",
          image: !isVideo,
          video: isVideo
        });
      }
    }
  } catch (e) {
    console.log("Pollinations image models fetch failed:", e.message);
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
  const stream = body.stream || false;

  // Extract API key if provided
  const authHeader = request.headers.get("Authorization");
  let apiKey = env.POLLINATIONS_API_KEY;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const tokens = authHeader.substring(7).split(/\s+/);
    const providerKey = tokens.find(t => t && !t.startsWith('g4f_'));
    if (providerKey) {
      apiKey = providerKey;
    }
  }

  const useGen = !!apiKey;
  const textApiUrl = useGen ? POLLINATIONS_GEN_TEXT_API : POLLINATIONS_TEXT_API;

  const requestBody = {
    ...body,
    model: model
  };

  const headers = {
    "Content-Type": "application/json"
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(textApiUrl, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    return new Response(JSON.stringify({
      error: {
        message: `Pollinations AI API error: ${response.status}`,
        type: "api_error",
        code: response.status
      }
    }), {
      status: response.status,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (stream) {
    return handlePollinationsStream(env, ctx, getClientIP(request), response, model);
  } else {
    return handlePollinationsNonStream(env, ctx, getClientIP(request), response, model);
  }
}

/**
 * Handle POST /v1/images/generations - Image generation
 */
async function handleImageGeneration(request, env, ctx) {
  const body = await request.json();
  const prompt = body.prompt;
  const model = body.model || "flux";
  const size = body.size || "1024x1024";
  const response_format = body.response_format || "url";

  // Extract API key if provided
  const authHeader = request.headers.get("Authorization");
  let apiKey = env.POLLINATIONS_API_KEY;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const tokens = authHeader.substring(7).split(/\s+/);
    const providerKey = tokens.find(t => t && !t.startsWith('g4f_'));
    if (providerKey) {
      apiKey = providerKey;
    }
  }

  const useGen = !!apiKey;

  if (!prompt) {
    return new Response(JSON.stringify({
      error: {
        message: "Prompt is required",
        type: "invalid_request_error",
        code: 400
      }
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Parse size
  const [width, height] = size.split('x').map(Number);

  // Build image URL
  const imageApiUrl = useGen ? POLLINATIONS_GEN_IMAGE_API : POLLINATIONS_IMAGE_API;
  let imageUrl = imageApiUrl.replace('{prompt}', encodeURIComponent(prompt));
  const params = new URLSearchParams();
  params.append('width', width);
  params.append('height', height);
  params.append('model', model);
  params.append('nologo', 'true');
  params.append('seed', '10352102'); // Fixed seed for consistency

  imageUrl += '?' + params.toString();

  const headers = {};
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(imageUrl, { headers });
    if (!response.ok) {
      throw new Error(`Image generation failed: ${response.status}`);
    }

    const imageBlob = await response.blob();

    if (response_format === "b64_json") {
      const base64 = await blobToBase64(imageBlob);
      return new Response(JSON.stringify({
        created: Math.floor(Date.now() / 1000),
        data: [{
          b64_json: base64.split(',')[1]
        }]
      }), {
        headers: { "Content-Type": "application/json" }
      });
    } else {
      // For URL format, we'd need to upload the image somewhere and return the URL
      // For now, return base64 as fallback
      const base64 = await blobToBase64(imageBlob);
      return new Response(JSON.stringify({
        created: Math.floor(Date.now() / 1000),
        data: [{
          url: `data:image/png;base64,${base64.split(',')[1]}`
        }]
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      error: {
        message: error.message,
        type: "api_error",
        code: 500
      }
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * Handle streaming response from Pollinations
 */
function handlePollinationsStream(env, ctx, clientIP, response, model) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let totalTokens = 0;

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
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));
              if (data.choices && data.choices[0] && data.choices[0].delta) {
                totalTokens += data.choices[0].delta.content ? data.choices[0].delta.content.length : 0;
              }
              await writer.write(encoder.encode(`${line}\n\n`));
            }
          } catch (e) {
            console.error("Parse error:", e);
          }
        }
      }

      // Send final [DONE]
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
 * Handle non-streaming response from Pollinations
 */
async function handlePollinationsNonStream(env, ctx, clientIP, response, model) {
  const data = await response.json();

  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" }
  });
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
      if (path.endsWith("/image/models") && request.method === "GET") {
        response = await handleListImageModels(request, env);
      } else if (path.endsWith("/models") && request.method === "GET") {
        response = await handleListModels(request, env);
      } else if (path.endsWith("/chat/completions") && request.method === "POST") {
        response = await handleChatCompletion(request, env, ctx);
      } else if (path.endsWith("/images/generations") && request.method === "POST") {
        response = await handleImageGeneration(request, env, ctx);
      } else if (path === "/" || path === "/health") {
        response = new Response(JSON.stringify({
          status: "ok",
          service: "Pollinations AI OpenAI-Compatible API (text.pollinations.ai & gen.pollinations.ai)",
          endpoints: ["/models", "/image/models", "/chat/completions", "/images/generations"]
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

function getClientIP(request) {
  return request.headers.get('cf-connecting-ip') || 
         request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
         'unknown';
}

/**
 * Convert blob to base64 data URL
 */
async function blobToBase64(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const binaryString = uint8Array.reduce((data, byte) => data + String.fromCharCode(byte), '');
  const base64 = btoa(binaryString);
  return `data:${blob.type};base64,${base64}`;
}