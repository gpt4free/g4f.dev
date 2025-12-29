/**
 * Cloudflare Worker for Image Generation Prompts
 *
 * This worker handles /prompt/* routes and proxies them to image.pollinations.ai
 * with HTTP caching enabled.
 */

const POLLINATIONS_IMAGE_API = "https://image.pollinations.ai/prompt/{prompt}";
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
  "Access-Control-Allow-Headers": "content-type, cache-control, pragma"
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
    if (!["GET", "HEAD"].includes(request.method) || !pathname.startsWith('/prompt/')) {
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
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    }

    try {
      // Build the Pollinations API URL
      const imageUrl = POLLINATIONS_IMAGE_API.replace('{prompt}', encodeURIComponent(prompt));

      // Add query parameters from the original request
      const params = new URLSearchParams(url.searchParams);
      if (params.toString()) {
        imageUrl += '?' + params.toString();
      }

      // Fetch from Pollinations API
      const apiResponse = await fetch(imageUrl);

      if (!apiResponse.ok) {
        throw new Error(`Image generation failed: ${apiResponse.status} ${apiResponse.statusText}`);
      }

      // Clone the response to cache it
      const responseToCache = apiResponse.clone();

      // Cache the response
      ctx.waitUntil(caches.default.put(cacheKey, responseToCache));

      // Return response with CORS headers and cache control
      const newHeaders = new Headers(apiResponse.headers);
      Object.entries(CORS_HEADERS).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });
      newHeaders.set('Cache-Control', CACHE_CONTROL);

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