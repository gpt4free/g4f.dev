/**
 * Cloudflare Worker for Image Generation Prompts
 *
 * This worker handles /prompt/* routes and proxies them to image.pollinations.ai
 * with HTTP caching enabled.
 */

const GEN_IMAGE_API = "https://gen.pollinations.ai/image/{prompt}"
const POLLINATIONS_IMAGE_API = "https://image.pollinations.ai/prompt/{prompt}";
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
  "Access-Control-Allow-Headers": "content-type, cache-control, pragma, authorization"
};

/**
 * Handle OPTIONS requests for CORS
 */
function handleOptions() {
  return new Response(null, {
    status: 200,
    headers: CORS_HEADERS
  });
}

/**
 * Extract prompt from URL path
 */
function extractPrompt(pathname) {
  if (pathname.startsWith('/prompt/')) {
    return pathname.substring('/prompt/'.length);
  }
  if (pathname.startsWith('/logo/')) {
    return `Create a logo for ${pathname.substring('/logo/'.length)}, deep background`;
  }
  return null;
}

/**
 * Main request handler
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return handleOptions();
    }

    // Only handle GET/HEAD requests for /prompt/* paths
    if (!["GET", "HEAD"].includes(request.method) || (!pathname.startsWith('/prompt/') && !pathname.startsWith('/logo/'))) {
      return new Response(JSON.stringify({
        error: {
          message: "Not found. Use /prompt/{your-prompt} to generate images.",
          type: "invalid_request_error",
          code: 404
        }
      }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS
        }
      });
    }

    const prompt = extractPrompt(pathname);
    if (!prompt) {
      return new Response(JSON.stringify({
        error: {
          message: "Invalid prompt path",
          type: "invalid_request_error",
          code: 400
        }
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS
        }
      });
    }

    // Check cache first
    const cacheKey = new Request(url.toString());
    let response = await caches.default.match(cacheKey);

    if (response) {
      // Return cached response with CORS headers
      const newHeaders = new Headers(response.headers);
      Object.entries(CORS_HEADERS).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });
      newHeaders.set('X-Cache', 'HIT')
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    }

    try {
      // Extract API key if provided
      const authHeader = request.headers.get("Authorization");
      let apiKey = null; // env.POLLINATIONS_API_KEY;
      let providerKey;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const tokens = authHeader.substring(7).split(/\s+/);
        providerKey = tokens.find(t => t && !t.startsWith('g4f_'));
      }

      // Add query parameters from the original request
      const params = new URLSearchParams(url.searchParams);

      if (!params.get("model")) {
        params.set("model", "flux")
      }
      if (!providerKey && !["flux", "zimage", "turbo"].includes(params.get("model"))) {
        return new Response(JSON.stringify({
          error: {
            message: "Not allowed model",
            type: "invalid_request_error",
            code: 400
          }
        }), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS
          }
        });
      } else if (providerKey) {
        apiKey = providerKey;
      }
      if (!params.get("nologo")) {
        params.set("nologo", "true")
      }
      const defaultSize = pathname.startsWith("/logo/") ? "256" : "1024";
      if (!params.get("width")) {
        params.set("width", defaultSize)
      }
      if (!params.get("height")) {
        params.set("height", defaultSize)
      }
  
      apiKey = apiKey ? apiKey : params.get("key");
      // Build the Pollinations API URL
      let imageUrl = (apiKey ? GEN_IMAGE_API : POLLINATIONS_IMAGE_API).replace('{prompt}', encodeURIComponent(prompt));

      if (params.toString()) {
        imageUrl += '?' + params.toString();
      }
      
      // Fetch from Pollinations API
      let apiResponse = await fetch(imageUrl, {headers: {"Authorization": apiKey ? `Bearer ${apiKey}`: undefined}});

      if (!apiResponse.ok) {
        imageUrl = POLLINATIONS_IMAGE_API.replace('{prompt}', prompt);
        if (params.toString()) {
          imageUrl += '?' + params.toString();
        }
        apiResponse = await fetch(imageUrl);
        if (!apiResponse.ok || apiResponse.headers.get("x-error-type")) {
          return Response.redirect(imageUrl, 302);
          throw new Error(`Image generation failed: ${apiResponse.status} ${apiResponse.statusText}}`);
        }
      }

      // Clone the response to cache it
      const responseToCache = apiResponse.clone();

      // Cache the response
      if (!apiResponse.headers.get("x-error-type")) {
        ctx.waitUntil(caches.default.put(cacheKey, responseToCache));
      }

      // Return response with CORS headers and cache control
      const newHeaders = new Headers(apiResponse.headers);
      Object.entries(CORS_HEADERS).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });
      if (!apiResponse.headers.get("x-error-type")) {
        newHeaders.set('Cache-Control', CACHE_CONTROL);
      }

      return new Response(apiResponse.body, {
        status: apiResponse.status,
        statusText: apiResponse.statusText,
        headers: newHeaders
      });

    } catch (error) {
      console.error('Error generating image:', error);

      return new Response(JSON.stringify({
        error: {
          message: error.message,
          type: "api_error",
          code: 500
        }
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...CORS_HEADERS
        }
      });
    }
  }
};