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
  "flux": "flux"
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
          created: 0,
          owned_by: "pollinations",
          ...(model.name ? model : {})
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
          created: 0,
          owned_by: "pollinations",
          image: !isVideo,
          video: isVideo,
          ...(model.name ? model : {})
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
 * Handle GET /image/models - List available image models
 */
async function handlePath(dir, path, request, env) {

  return await fetch(`https://gen.pollinations.ai/${dir}/${path}`, request)
}

/**
 * Handle POST /v1/chat/completions - Chat completion
 */
async function handleChatCompletion(request, env, ctx) {
  const body = await request.json();
  const model = resolveModel(body.model);

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
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": "application/json" }
    });
  }

  return response;
}

/**
 * Handle POST /v1/images/generations - Image generation
 */
async function handleImageGeneration(request, env, ctx) {
  const body = await request.json();
  const prompt = body.prompt;
  delete body.prompt;
  const size = body.size;
  delete body.size
  const response_format = body.response_format || "url";
  delete body.response_format;

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

  // Build image URL
  const imageApiUrl = useGen ? POLLINATIONS_GEN_IMAGE_API : POLLINATIONS_IMAGE_API;
  let imageUrl = imageApiUrl.replace('{prompt}', encodeURIComponent(prompt));
  const params = new URLSearchParams();
  if (size) {
    const [width, height] = size.split('x').map(Number);
    params.append('width', width);
    params.append('height', height);
  }
  params.append('nologo', 'true');
  params.append('seed', '10352102');
  for (const [key, value] of Object.entries(body)) {
    params.append(key, String(value));
  }

  imageUrl += '?' + params.toString();

  const headers = {};
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(imageUrl, { headers });
    if (!response.ok || response.headers.get("x-error-type")) {
      throw new Error(`Image generation failed: ${response.headers.get("x-error-type") || response.status}`);
    }

    const imageBlob = await response.blob();
    let newResponse;
    if (response_format === "b64_json") {
      const base64 = await blobToBase64(imageBlob);
      newResponse = new Response(JSON.stringify({
        created: Math.floor(Date.now() / 1000),
        data: [{
          b64_json: base64.split(',')[1]
        }]
      }), response);
    } else {
      // For URL format, we'd need to upload the image somewhere and return the URL
      // For now, return base64 as fallback
      const base64 = await blobToBase64(imageBlob);
      const contentType = response.headers.get('Content-Type')
      newResponse = new Response(JSON.stringify({
        created: Math.floor(Date.now() / 1000),
        data: [{
          url: `data:${contentType};base64,${base64.split(',')[1]}`
        }]
      }), response);
    }
    newResponse.headers.set("Content-Type", "application/json");
    return newResponse;
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
      if (path.includes("/image/") && request.method === "GET") {
        response = await handlePath("image", path.split("/image/", 2)[1], request, env);
      } else if (path.includes("/text/") && request.method === "GET") {
        response = await handlePath("text", path.split("/text/", 2)[1], request, env);
      } else if (path == "/api/usage" && request.method === "GET") {
        response = await handlePath("api", "usage", request, env);
      } else if (path.startsWith("/account/") && request.method === "GET") {
        response = await handlePath("account", path.substring("/account/".length), request, env);
      } else if (path.endsWith("/models") && request.method === "GET") {
        response = await handleListModels(request, env);
      } else if (path.endsWith("/quota") && request.method === "GET") {
        response = await handlePath("account", "balance", request, env);
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