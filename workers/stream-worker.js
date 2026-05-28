// Cloudflare Worker - Video Streaming from URL
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Configuration - You can modify these or use environment variables
    const VIDEO_SOURCE_URL = decodeURIComponent(url.pathname.substring(1)) || 'https://g4f.dev/background/video_1.mp4';
    const CACHE_DURATION = 3600; // Cache for 1 hour
    
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }
    
    // Only allow GET requests for video streaming
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }
    
    // Check if this is a HEAD request
    const isHeadRequest = request.method === 'HEAD';
    
    try {
      // Generate cache key based on the video source URL
      const cacheKey = new Request(VIDEO_SOURCE_URL, request);
      const cache = caches.default;
      
      // Try to get from cache first
      let response = await cache.match(cacheKey);
      
      if (!response) {
        // Fetch the video from the source URL
        const videoResponse = await fetch(VIDEO_SOURCE_URL, {
          headers: getRequestHeaders(request)
        });
        
        if (!videoResponse.ok) {
          return new Response('Video not found', { status: 404 });
        }
        
        // Create streaming response headers
        const headers = new Headers(videoResponse.headers);
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Cache-Control', `public, max-age=${CACHE_DURATION}`);
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
        
        // Preserve content type and length
        if (!headers.has('Content-Type')) {
          headers.set('Content-Type', 'video/mp4');
        }
        
        response = new Response(videoResponse.body, {
          status: videoResponse.status,
          headers: headers
        });
        
        // Cache the response (only for GET requests)
        if (videoResponse.ok && !isHeadRequest) {
          ctx.waitUntil(cache.put(cacheKey, response.clone()));
        }
      }
      
      // For HEAD requests, return only headers
      if (isHeadRequest) {
        return new Response(null, {
          status: 200,
          headers: response.headers
        });
      }
      
      return response;
      
    } catch (error) {
      return new Response(`Error fetching video: ${error.message}`, { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cross-Origin-Resource-Policy': 'cross-origin',
        }
      });
    }
  }
};

// Handle CORS preflight requests
function handleOptions(request) {
  if (
    request.headers.get("Origin") !== null &&
    request.headers.get("Access-Control-Request-Method") !== null &&
    request.headers.get("Access-Control-Request-Headers") !== null
  ) {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range, Content-Type",
        "Access-Control-Max-Age": "86400",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Resource-Policy": "cross-origin",
      }
    });
  } else {
    return new Response(null, {
      headers: {
        "Allow": "GET, HEAD, OPTIONS",
      }
    });
  }
}

// Extract relevant headers for video streaming
function getRequestHeaders(request) {
  const headers = new Headers();
  
  // Forward range headers for video seeking
  const rangeHeader = request.headers.get('Range');
  if (rangeHeader) {
    headers.set('Range', rangeHeader);
  }
  
  // Forward other useful headers
  ['Accept', 'Accept-Encoding', 'Accept-Language'].forEach(header => {
    const value = request.headers.get(header);
    if (value) {
      headers.set(header, value);
    }
  });
  
  return headers;
}
