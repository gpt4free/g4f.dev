# API Proxy Server Documentation

## Overview
This is a Cloudflare Worker script functioning as a proxy server for various AI models and APIs. It acts as a gateway between clients and different AI providers, offering features like caching, rate limiting, and security.

## Configuration

### Constants
- **API_HOST**: Main API host
- **POLLINATIONS_HOST**: Pollinations.ai service host
- **GITHUB_HOST**: GitHub Pages host for static contents
- **MODEL_ID**: Default model ID for Cloudflare AI
- **MAX_CONTENT_LENGTH**: Max request size (50KB)
- **CUSTOM_MAX_LENGTH**: Extended max size for certain endpoints (100KB)
- **CACHE_CONTROL**: Caching policy (4 hours)
- **CACHE_FOREVER**: Permanent caching (1 year)
- **CORS_HEADERS**: Cross-Origin Resource Sharing headers configuration

## Main Functions

### 1. API Endpoint Handling
The server handles various routes:
- `/api/[provider]/` - API calls for specific providers
- `/ai/[query]` - Simplified AI query interface
- `/media/`, `/files/`, `/search/` - Media and file handling
- `/dist/` - Static content
- `/backend-api/` - Backend API routes

### 2. Supported AI Providers
```javascript
const models = {
  "nvidia", "openrouter", "deepinfra", "groq", "ollama",
  "azure", "grok", "x.ai", "gemini", "typegpt", "pollinations",
  "api.airforce", "gpt4free.pro", "nectar", "audio", "perplexity",
  "huggingface", "puter"
}
```

### 3. Security Features
- **Rate Limiting**: Limits requests (1 per 10 seconds for API paths)
- **Content-Length Validation**: Checks request size limits
- **CORS Handling**: Manages cross-origin requests
- **API Key Rotation**: Randomly selects from multiple API keys
- **Content-Type Validation**: Protects against unwanted content types

## Key Functions

### `handleRequest(request, env, ctx)`
Main function that processes all incoming requests:

1. **OPTIONS requests**: Handles CORS preflight
2. **Model list endpoints**: Returns available models
3. **Caching**: Caches GET/HEAD responses
4. **Rate limiting**: Protects against abuse
5. **Content validation**: Enforces request size limit
6. **Routing**: Forwards requests to appropriate providers

### `forwardApi(request, newUrl, liteRequest, ctx, cache_control)`
Forwards API requests with caching and CORS support.

### `forwardWorker(env, request, liteRequest, pathname, ctx)`
Special handling for Cloudflare AI worker endpoints.

### `shield(url, options)`
Performs safety checks:
- Content-Type validation
- Error handling standardization
- Removing sensitive headers
- Adding CORS headers

### `retrieveCache(request, liteRequest, pathname, ctx, host, cache_control)`
Caching mechanism for repeated requests.

## Caching Strategy
- **Static contents**: Forever cache (1 year)
- **API responses**: Time-limited cache (4 hours)
- **Media/Files**: Cache-based distribution

## Error Handling
- Structured JSON error responses
- Rate limit errors with `Retry-After` header
- Content-Length errors
- Provider-specific error handling

## Special Features
- **Auto-Model Selection**: Random provider selection
- **JSON response formatting**: Automatic JSON formatting
- **Audio support**: Text-to-Speech integration
- **Image Generation**: Pollinations.ai integration
- **Documentation Generation**: Dynamic docs creation

## Deployment
This code is optimized for Cloudflare Workers with:
- Environment variables for API keys
- Cloudflare KV for rate limiting
- Cloudflare AI for local models
- Cloudflare cache for performance

This proxy server provides a robust, scalable API gateway that enhances security, performance, and flexibility for integrating various AI services.