/**
 * G4F Custom Server Router Worker
 * 
 * Cloudflare Worker for managing custom AI servers with model routing.
 * Users can add their own servers (public or private) in the members area.
 * Features:
 * - Token counting per server
 * - Multiple API keys per server (line-separated)
 * - Model allowlist per server
 * - Public/private visibility
 * 
 * Environment Variables Required:
 * - MEMBERS_BUCKET: R2 bucket binding for server data
 * - MEMBERS_KV: KV namespace binding for caching
 * - API_KEY_SALT: Salt for validating API keys
 */

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Id, X-API-Key",
    "Access-Control-Expose-Headers": "Content-Type, X-User-Id, X-Provider, X-Server"
};

// Rate limits for custom servers
const SERVER_RATE_LIMITS = {
    requests: {
        perMinute: 60,
        perHour: 600,
        perDay: 6000
    },
    windows: {
        minute: 60 * 1000,
        hour: 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000
    }
};

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const pathname = url.pathname;

        // Handle CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: CORS_HEADERS });
        }

        try {
            // ============================================
            // Server Management Endpoints (Members Area)
            // ============================================
            
            // List user's servers
            if (pathname === "/custom/api/servers") {
                return handleListServers(request, env);
            }
            
            // Create a new server
            if (pathname === "/custom/api/servers/create") {
                return handleCreateServer(request, env);
            }
            
            // Update a server
            if (pathname === "/custom/api/servers/update") {
                return handleUpdateServer(request, env);
            }
            
            // Delete a server
            if (pathname === "/custom/api/servers/delete") {
                return handleDeleteServer(request, env);
            }
            
            // Get server usage statistics
            if (pathname === "/custom/api/servers/usage") {
                return handleGetServerUsage(request, env);
            }
            
            // List public servers
            if (pathname === "/custom/api/servers/public") {
                return handleListPublicServers(request, env);
            }
            
            // Get available models for a server
            if (pathname.match(/^\/custom\/api\/servers\/[^/]+\/models$/)) {
                const serverId = pathname.split('/')[4];
                return handleGetServerModels(request, env, serverId);
            }

            // ============================================
            // Model Router Endpoints
            // ============================================
            
            // Route: /custom/:server_id/chat/completions
            if (pathname.match(/^\/custom\/[^/]+\/chat\/completions$/)) {
                const serverId = pathname.split('/')[2];
                return handleChatCompletions(request, env, ctx, serverId);
            }
            
            // Route: /custom/:server_id/models
            if (pathname.match(/^\/custom\/[^/]+\/models$/)) {
                const serverId = pathname.split('/')[2];
                return handleModels(request, env, serverId);
            }
            
            // Route: /custom/:server_id/* (generic proxy)
            if (pathname.startsWith("/custom/") && pathname.split('/').length >= 3) {
                const parts = pathname.split('/');
                const serverId = parts[2];
                const subPath = '/' + parts.slice(3).join('/');
                return handleProxyRequest(request, env, ctx, serverId, subPath);
            }

            return jsonResponse({ error: "Not found" }, 404);
        } catch (error) {
            console.error("Custom worker error:", error);
            return jsonResponse({ error: error.message || "Internal server error" }, 500);
        }
    }
};

// ============================================
// Authentication Helpers
// ============================================

async function authenticateRequest(request, env) {
    // Check for session token in Authorization header or cookie
    let sessionToken = request.headers.get("Authorization")?.replace("Bearer ", "");
    
    if (!sessionToken) {
        const cookie = request.headers.get("Cookie");
        if (cookie) {
            const match = cookie.match(/g4f_session=([^;]+)/);
            sessionToken = match ? match[1] : null;
        }
    }

    // Also check for API key
    const xApiKey = request.headers.get("X-API-Key");
    const authHeader = request.headers.get("Authorization");
    
    let apiKey = null;
    if (authHeader && authHeader.startsWith('Bearer ') && authHeader.includes('g4f_')) {
        const tokens = authHeader.substring(7).split(/\s+/);
        apiKey = tokens.find(t => t.startsWith('g4f_'));
    }
    if (!apiKey && xApiKey && xApiKey.startsWith('g4f_')) {
        apiKey = xApiKey;
    }

    // If we have an API key, validate it
    if (apiKey && env.MEMBERS_KV) {
        const keyHash = await hashString(apiKey);
        const keyDataStr = await env.MEMBERS_KV.get(`api_key:${keyHash}`);
        if (keyDataStr) {
            try {
                const keyData = JSON.parse(keyDataStr);
                const user = await getUser(env, keyData.user_id);
                return user;
            } catch (e) {
                console.error('Failed to parse API key data:', e);
            }
        }
    }

    // Check session token
    if (sessionToken && env.MEMBERS_KV) {
        const sessionData = await env.MEMBERS_KV.get(`session:${sessionToken}`);
        if (sessionData) {
            const session = JSON.parse(sessionData);
            if (new Date(session.expires_at) > new Date()) {
                return await getUser(env, session.user_id);
            }
        }
    }

    // Check X-User-Id header (internal use)
    const userId = request.headers.get("X-User-Id");
    if (userId && env.MEMBERS_BUCKET) {
        return await getUser(env, userId);
    }

    return null;
}

async function getUser(env, userId) {
    // Try KV cache first
    if (env.MEMBERS_KV) {
        const cached = await env.MEMBERS_KV.get(`user:${userId}`);
        if (cached) {
            return JSON.parse(cached);
        }
    }

    // Fall back to R2
    if (env.MEMBERS_BUCKET) {
        const object = await env.MEMBERS_BUCKET.get(`users/${userId}.json`);
        if (object) {
            const user = await object.json();
            // Cache for next time
            if (env.MEMBERS_KV) {
                await env.MEMBERS_KV.put(`user:${userId}`, JSON.stringify(user), { expirationTtl: 3600 });
            }
            return user;
        }
    }

    return null;
}

async function saveUser(env, user) {
    if (env.MEMBERS_BUCKET) {
        await env.MEMBERS_BUCKET.put(
            `users/${user.id}.json`,
            JSON.stringify(user, null, 2),
            { httpMetadata: { contentType: "application/json" } }
        );
    }

    // Update cache
    if (env.MEMBERS_KV) {
        await env.MEMBERS_KV.put(`user:${user.id}`, JSON.stringify(user), { expirationTtl: 3600 });
    }
}

// ============================================
// Server Management
// ============================================

async function handleListServers(request, env) {
    const user = await authenticateRequest(request, env);
    if (!user) {
        return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const servers = user.custom_servers || [];
    
    // Return servers without sensitive data (API keys)
    const safeServers = servers.map(s => ({
        id: s.id,
        label: s.label,
        base_url: s.base_url,
        is_public: s.is_public,
        allowed_models: s.allowed_models,
        api_key_count: (s.api_keys || '').split('\n').filter(k => k.trim()).length,
        created_at: s.created_at,
        updated_at: s.updated_at,
        usage: s.usage || { requests: 0, tokens: 0 }
    }));

    return jsonResponse({ servers: safeServers });
}

async function handleCreateServer(request, env) {
    const user = await authenticateRequest(request, env);
    if (!user) {
        return jsonResponse({ error: "Unauthorized" }, 401);
    }

    if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body = await request.json();
    
    // Validate required fields
    if (!body.base_url) {
        return jsonResponse({ error: "base_url is required" }, 400);
    }
    
    // Validate base_url format
    let baseUrl;
    try {
        baseUrl = new URL(body.base_url);
    } catch (e) {
        return jsonResponse({ error: "Invalid base_url format" }, 400);
    }

    // Normalize base URL (remove trailing slash)
    const normalizedBaseUrl = body.base_url.replace(/\/$/, '');

    // Validate server by fetching models
    const validationResult = await validateServer(normalizedBaseUrl, body.api_keys);
    if (!validationResult.valid) {
        return jsonResponse({ 
            error: `Server validation failed: ${validationResult.error}`,
            details: validationResult.details
        }, 400);
    }

    // Check server limits based on tier
    const maxServers = user.tier === 'pro' ? 20 : user.tier === 'sponsor' ? 10 : 3;
    if ((user.custom_servers || []).length >= maxServers) {
        return jsonResponse({ 
            error: `Maximum ${maxServers} servers allowed for ${user.tier || 'free'} tier` 
        }, 400);
    }

    const serverId = generateServerId();
    const now = new Date().toISOString();

    // Use discovered models if allowed_models not specified
    const allowedModels = body.allowed_models && body.allowed_models.length > 0 
        ? body.allowed_models 
        : validationResult.models || [];

    const server = {
        id: serverId,
        label: body.label || `Server ${(user.custom_servers || []).length + 1}`,
        base_url: normalizedBaseUrl,
        api_keys: body.api_keys || '', // Line-separated API keys
        allowed_models: allowedModels,
        is_public: body.is_public || false,
        created_at: now,
        updated_at: now,
        validated_at: now,
        usage: {
            requests: 0,
            tokens: 0,
            last_used: null
        }
    };

    // Add to user's servers
    user.custom_servers = user.custom_servers || [];
    user.custom_servers.push(server);
    user.updated_at = now;
    await saveUser(env, user);

    // If public, add to public server index
    if (server.is_public) {
        await updatePublicServerIndex(env, server, user.id, 'add');
    }

    // Return server without API keys
    const safeServer = { ...server };
    delete safeServer.api_keys;
    safeServer.api_key_count = (server.api_keys || '').split('\n').filter(k => k.trim()).length;

    return jsonResponse({ 
        message: "Server created successfully",
        server: safeServer
    });
}

async function handleUpdateServer(request, env) {
    const user = await authenticateRequest(request, env);
    if (!user) {
        return jsonResponse({ error: "Unauthorized" }, 401);
    }

    if (request.method !== "POST" && request.method !== "PUT") {
        return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body = await request.json();
    
    if (!body.server_id) {
        return jsonResponse({ error: "server_id is required" }, 400);
    }

    const serverIndex = (user.custom_servers || []).findIndex(s => s.id === body.server_id);
    if (serverIndex === -1) {
        return jsonResponse({ error: "Server not found" }, 404);
    }

    const server = user.custom_servers[serverIndex];
    const wasPublic = server.is_public;
    const now = new Date().toISOString();

    // Update allowed fields
    const allowedFields = ['label', 'base_url', 'api_keys', 'allowed_models', 'is_public'];
    for (const field of allowedFields) {
        if (body[field] !== undefined) {
            if (field === 'base_url') {
                try {
                    new URL(body.base_url);
                    server.base_url = body.base_url.replace(/\/$/, '');
                } catch (e) {
                    return jsonResponse({ error: "Invalid base_url format" }, 400);
                }
            } else {
                server[field] = body[field];
            }
        }
    }

    server.updated_at = now;
    user.updated_at = now;
    await saveUser(env, user);

    // Handle public server index updates
    if (wasPublic && !server.is_public) {
        await updatePublicServerIndex(env, server, user.id, 'remove');
    } else if (!wasPublic && server.is_public) {
        await updatePublicServerIndex(env, server, user.id, 'add');
    } else if (server.is_public) {
        await updatePublicServerIndex(env, server, user.id, 'update');
    }

    // Return server without API keys
    const safeServer = { ...server };
    delete safeServer.api_keys;
    safeServer.api_key_count = (server.api_keys || '').split('\n').filter(k => k.trim()).length;

    return jsonResponse({ 
        message: "Server updated successfully",
        server: safeServer
    });
}

async function handleDeleteServer(request, env) {
    const user = await authenticateRequest(request, env);
    if (!user) {
        return jsonResponse({ error: "Unauthorized" }, 401);
    }

    if (request.method !== "POST" && request.method !== "DELETE") {
        return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body = await request.json();
    
    if (!body.server_id) {
        return jsonResponse({ error: "server_id is required" }, 400);
    }

    const serverIndex = (user.custom_servers || []).findIndex(s => s.id === body.server_id);
    if (serverIndex === -1) {
        return jsonResponse({ error: "Server not found" }, 404);
    }

    const server = user.custom_servers[serverIndex];

    // Remove from public index if needed
    if (server.is_public) {
        await updatePublicServerIndex(env, server, user.id, 'remove');
    }

    // Archive server data
    if (env.MEMBERS_BUCKET) {
        await env.MEMBERS_BUCKET.put(
            `custom_servers/${user.id}/${server.id}_deleted.json`,
            JSON.stringify({
                ...server,
                deleted_at: new Date().toISOString()
            }, null, 2),
            { httpMetadata: { contentType: "application/json" } }
        );
    }

    // Remove from user's servers
    user.custom_servers.splice(serverIndex, 1);
    user.updated_at = new Date().toISOString();
    await saveUser(env, user);

    return jsonResponse({ message: "Server deleted successfully" });
}

async function handleGetServerUsage(request, env) {
    const user = await authenticateRequest(request, env);
    if (!user) {
        return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const url = new URL(request.url);
    const serverId = url.searchParams.get("server_id");
    const days = parseInt(url.searchParams.get("days") || "7");

    if (!serverId) {
        return jsonResponse({ error: "server_id is required" }, 400);
    }

    const server = (user.custom_servers || []).find(s => s.id === serverId);
    if (!server) {
        return jsonResponse({ error: "Server not found" }, 404);
    }

    const history = [];
    const now = new Date();

    for (let i = 0; i < days; i++) {
        const date = new Date(now);
        date.setUTCDate(date.getUTCDate() - i);
        const dateKey = date.toISOString().split("T")[0];

        if (env.MEMBERS_BUCKET) {
            const usageData = await env.MEMBERS_BUCKET.get(
                `custom_servers/${user.id}/${serverId}/usage/${dateKey}.json`
            );
            if (usageData) {
                history.push(await usageData.json());
            } else {
                history.push({ date: dateKey, requests: 0, tokens: 0 });
            }
        } else {
            history.push({ date: dateKey, requests: 0, tokens: 0 });
        }
    }

    return jsonResponse({
        server_id: serverId,
        total_usage: server.usage || { requests: 0, tokens: 0 },
        history
    });
}

async function handleListPublicServers(request, env) {
    // Get public server index
    let publicServers = [];

    if (env.MEMBERS_KV) {
        const indexStr = await env.MEMBERS_KV.get('public_servers_index');
        if (indexStr) {
            publicServers = JSON.parse(indexStr);
        }
    }

    // Filter to safe data only
    const safeServers = publicServers.map(s => ({
        id: s.id,
        label: s.label,
        base_url: s.base_url,
        allowed_models: s.allowed_models,
        owner_id: s.owner_id,
        usage: s.usage || { requests: 0, tokens: 0 }
    }));

    return jsonResponse({ servers: safeServers });
}

async function handleGetServerModels(request, env, serverId) {
    const server = await getServerById(env, serverId);
    if (!server) {
        return jsonResponse({ error: "Server not found" }, 404);
    }

    // If server has allowed_models, return those
    if (server.allowed_models && server.allowed_models.length > 0) {
        return jsonResponse({
            data: server.allowed_models.map(m => ({ id: m }))
        });
    }

    // Otherwise, proxy to the server's /models endpoint
    try {
        const apiKey = getRandomApiKey(server.api_keys);
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(`${server.base_url}/models`, { headers });
        if (response.ok) {
            const data = await response.json();
            return jsonResponse(data);
        }
    } catch (e) {
        console.error('Failed to fetch models:', e);
    }

    return jsonResponse({ data: [] });
}

// ============================================
// Model Router / Proxy
// ============================================

async function handleChatCompletions(request, env, ctx, serverId) {
    return handleProxyRequest(request, env, ctx, serverId, '/chat/completions');
}

async function handleModels(request, env, serverId) {
    const server = await getServerById(env, serverId);
    if (!server) {
        return jsonResponse({ error: "Server not found" }, 404);
    }

    // If server has allowed_models configured, return those
    if (server.allowed_models && server.allowed_models.length > 0) {
        return jsonResponse({
            data: server.allowed_models.map(m => ({ id: m }))
        });
    }

    // Proxy to server's models endpoint
    const apiKey = getRandomApiKey(server.api_keys);
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
        const response = await fetch(`${server.base_url}/models`, {
            method: request.method,
            headers
        });
        
        const newResponse = new Response(response.body, response);
        for (const [key, value] of Object.entries(CORS_HEADERS)) {
            newResponse.headers.set(key, value);
        }
        newResponse.headers.set('X-Server', serverId);
        return newResponse;
    } catch (e) {
        return jsonResponse({ error: `Failed to connect to server: ${e.message}` }, 502);
    }
}

async function handleProxyRequest(request, env, ctx, serverId, subPath) {
    const server = await getServerById(env, serverId);
    if (!server) {
        return jsonResponse({ error: "Server not found" }, 404);
    }

    // Check if model is allowed
    let requestBody = null;
    let requestModel = null;
    
    if (request.method === 'POST' && subPath === '/chat/completions') {
        try {
            requestBody = await request.clone().json();
            requestModel = requestBody.model;
            
            // Validate model if allowlist exists
            if (server.allowed_models && server.allowed_models.length > 0) {
                if (!server.allowed_models.includes(requestModel)) {
                    return jsonResponse({
                        error: {
                            message: `Model '${requestModel}' is not allowed on this server. Allowed: ${server.allowed_models.join(', ')}`,
                            type: 'model_not_allowed'
                        }
                    }, 400);
                }
            }

            // Inject stream_options for usage tracking
            if (requestBody.stream) {
                requestBody.stream_options = { include_usage: true };
            }
        } catch (e) {
            // Continue with original request if JSON parsing fails
        }
    }

    // Get API key
    const apiKey = getRandomApiKey(server.api_keys);
    
    // Check for user-provided API key
    const authHeader = request.headers.get('Authorization');
    let userProvidedKey = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const tokens = authHeader.substring(7).split(/\s+/);
        // Find a non-g4f key
        userProvidedKey = tokens.find(t => t && !t.startsWith('g4f_'));
    }
    
    // Build headers
    const proxyHeaders = {
        'Content-Type': request.headers.get('Content-Type') || 'application/json',
    };
    
    if (userProvidedKey) {
        proxyHeaders['Authorization'] = `Bearer ${userProvidedKey}`;
    } else if (apiKey) {
        proxyHeaders['Authorization'] = `Bearer ${apiKey}`;
    }

    // Build target URL
    const targetUrl = `${server.base_url}${subPath}`;

    try {
        const fetchOptions = {
            method: request.method,
            headers: proxyHeaders
        };

        if (request.method === 'POST') {
            fetchOptions.body = requestBody ? JSON.stringify(requestBody) : await request.text();
        }

        const response = await fetch(targetUrl, fetchOptions);

        // Track usage for chat completions
        if (subPath === '/chat/completions' && response.ok) {
            const contentType = response.headers.get('content-type') || '';
            
            if (contentType.includes('text/event-stream')) {
                // Streaming response - track usage from stream
                const trackedStream = createUsageTrackingStream(
                    response, env, ctx, server, requestModel
                );
                const newResponse = new Response(trackedStream, { headers: response.headers });
                for (const [key, value] of Object.entries(CORS_HEADERS)) {
                    newResponse.headers.set(key, value);
                }
                newResponse.headers.set('X-Server', serverId);
                return newResponse;
            } else if (contentType.includes('application/json')) {
                // Non-streaming - extract usage from response
                const clonedResponse = response.clone();
                try {
                    const data = await clonedResponse.json();
                    if (data.usage) {
                        const tokens = data.usage.total_tokens || 
                            (data.usage.prompt_tokens || 0) + (data.usage.completion_tokens || 0);
                        ctx.waitUntil(updateServerUsage(env, server, tokens, requestModel));
                    }
                } catch (e) {
                    // Ignore parse errors
                }
            }
        }

        const newResponse = new Response(response.body, response);
        for (const [key, value] of Object.entries(CORS_HEADERS)) {
            newResponse.headers.set(key, value);
        }
        newResponse.headers.set('X-Server', serverId);
        return newResponse;

    } catch (e) {
        return jsonResponse({
            error: { message: `Failed to connect to server: ${e.message}` }
        }, 502);
    }
}

// ============================================
// Usage Tracking
// ============================================

function createUsageTrackingStream(response, env, ctx, server, model) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const stream = new ReadableStream({
        async pull(controller) {
            const { done, value } = await reader.read();

            if (done) {
                // Process remaining buffer
                if (buffer) {
                    extractUsageFromBuffer(buffer, env, ctx, server, model);
                }
                controller.close();
                return;
            }

            const text = decoder.decode(value, { stream: true });
            buffer += text;

            // Look for usage in SSE data chunks
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                        const jsonStr = line.slice(6);
                        const data = JSON.parse(jsonStr);
                        if (data.usage) {
                            const tokens = data.usage.total_tokens ||
                                (data.usage.prompt_tokens || 0) + (data.usage.completion_tokens || 0);
                            if (tokens > 0) {
                                ctx.waitUntil(updateServerUsage(env, server, tokens, model));
                            }
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
            }

            controller.enqueue(value);
        },
        cancel() {
            reader.cancel();
        }
    });

    return stream;
}

function extractUsageFromBuffer(buffer, env, ctx, server, model) {
    const lines = buffer.split('\n');
    for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
                const jsonStr = line.slice(6);
                const data = JSON.parse(jsonStr);
                if (data.usage) {
                    const tokens = data.usage.total_tokens ||
                        (data.usage.prompt_tokens || 0) + (data.usage.completion_tokens || 0);
                    if (tokens > 0) {
                        ctx.waitUntil(updateServerUsage(env, server, tokens, model));
                    }
                }
            } catch (e) {
                // Ignore parse errors
            }
        }
    }
}

async function updateServerUsage(env, server, tokens, model) {
    if (!env.MEMBERS_BUCKET || !server.owner_id) return;

    try {
        // Get user
        const user = await getUser(env, server.owner_id);
        if (!user) return;

        // Find server in user's list
        const serverIndex = (user.custom_servers || []).findIndex(s => s.id === server.id);
        if (serverIndex === -1) return;

        const userServer = user.custom_servers[serverIndex];
        const now = new Date();

        // Update total usage
        userServer.usage = userServer.usage || { requests: 0, tokens: 0 };
        userServer.usage.requests += 1;
        userServer.usage.tokens += tokens;
        userServer.usage.last_used = now.toISOString();

        user.updated_at = now.toISOString();
        await saveUser(env, user);

        // Store daily usage
        const dateKey = now.toISOString().split("T")[0];
        const usagePath = `custom_servers/${server.owner_id}/${server.id}/usage/${dateKey}.json`;

        let dailyUsage;
        const existing = await env.MEMBERS_BUCKET.get(usagePath);
        if (existing) {
            dailyUsage = await existing.json();
        } else {
            dailyUsage = { date: dateKey, requests: 0, tokens: 0, models: {} };
        }

        dailyUsage.requests += 1;
        dailyUsage.tokens += tokens;
        if (model) {
            dailyUsage.models[model] = (dailyUsage.models[model] || 0) + 1;
        }

        await env.MEMBERS_BUCKET.put(usagePath, JSON.stringify(dailyUsage, null, 2), {
            httpMetadata: { contentType: "application/json" }
        });

        // Update public server index if public
        if (userServer.is_public) {
            await updatePublicServerIndex(env, userServer, server.owner_id, 'update');
        }

    } catch (e) {
        console.error('Failed to update server usage:', e);
    }
}

// ============================================
// Helper Functions
// ============================================

async function getServerById(env, serverId) {
    // Check public server index first
    if (env.MEMBERS_KV) {
        const cached = await env.MEMBERS_KV.get(`server:${serverId}`);
        if (cached) {
            return JSON.parse(cached);
        }
    }

    // Search through public servers
    if (env.MEMBERS_KV) {
        const indexStr = await env.MEMBERS_KV.get('public_servers_index');
        if (indexStr) {
            const servers = JSON.parse(indexStr);
            const server = servers.find(s => s.id === serverId);
            if (server) {
                // Fetch full server data from owner
                const user = await getUser(env, server.owner_id);
                if (user) {
                    const fullServer = (user.custom_servers || []).find(s => s.id === serverId);
                    if (fullServer) {
                        fullServer.owner_id = user.id;
                        // Cache for quick access
                        await env.MEMBERS_KV.put(
                            `server:${serverId}`,
                            JSON.stringify(fullServer),
                            { expirationTtl: 300 }
                        );
                        return fullServer;
                    }
                }
            }
        }
    }

    return null;
}

async function updatePublicServerIndex(env, server, ownerId, action) {
    if (!env.MEMBERS_KV) return;

    const indexStr = await env.MEMBERS_KV.get('public_servers_index');
    let servers = indexStr ? JSON.parse(indexStr) : [];

    if (action === 'remove') {
        servers = servers.filter(s => s.id !== server.id);
    } else {
        // Remove existing entry first
        servers = servers.filter(s => s.id !== server.id);
        
        if (action === 'add' || action === 'update') {
            servers.push({
                id: server.id,
                label: server.label,
                base_url: server.base_url,
                allowed_models: server.allowed_models,
                owner_id: ownerId,
                usage: server.usage,
                updated_at: server.updated_at
            });
        }
    }

    await env.MEMBERS_KV.put('public_servers_index', JSON.stringify(servers));
    
    // Invalidate server cache
    await env.MEMBERS_KV.delete(`server:${server.id}`);
}

function getRandomApiKey(apiKeysStr) {
    if (!apiKeysStr) return null;
    
    const keys = apiKeysStr.split('\n')
        .map(k => k.trim())
        .filter(k => k && !k.startsWith('#')); // Support comments with #
    
    if (keys.length === 0) return null;
    
    return keys[Math.floor(Math.random() * keys.length)];
}

function generateServerId() {
    const timestamp = Date.now().toString(36);
    const randomPart = crypto.getRandomValues(new Uint8Array(6));
    const randomStr = Array.from(randomPart, byte => byte.toString(16).padStart(2, "0")).join("");
    return `srv_${timestamp}${randomStr}`;
}

/**
 * Validate a server by fetching its /models endpoint
 * @param {string} baseUrl - The base URL of the server
 * @param {string} apiKeysStr - Line-separated API keys
 * @returns {Object} Validation result with valid, error, models
 */
async function validateServer(baseUrl, apiKeysStr) {
    const apiKey = getRandomApiKey(apiKeysStr);
    const headers = { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    // Try /models endpoint first (OpenAI compatible)
    const modelsEndpoints = [
        '/models',
        '/v1/models',
        ''
    ];

    for (const endpoint of modelsEndpoints) {
        try {
            const url = baseUrl + endpoint;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

            const response = await fetch(url, { 
                headers,
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (response.ok) {
                const contentType = response.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    const data = await response.json();
                    
                    // Extract models from response
                    let models = [];
                    if (data.data && Array.isArray(data.data)) {
                        // OpenAI format: { data: [{id: "model-name"}, ...] }
                        models = data.data.map(m => m.id).filter(Boolean);
                    } else if (data.models && Array.isArray(data.models)) {
                        // Alternative format: { models: ["model-name", ...] } or { models: [{name: "model"}] }
                        models = data.models.map(m => typeof m === 'string' ? m : (m.id || m.name)).filter(Boolean);
                    } else if (Array.isArray(data)) {
                        // Plain array: ["model-name", ...] or [{id: "model"}]
                        models = data.map(m => typeof m === 'string' ? m : (m.id || m.name)).filter(Boolean);
                    }

                    if (models.length > 0) {
                        return {
                            valid: true,
                            models: models.slice(0, 100), // Limit to 100 models
                            endpoint: endpoint || '/'
                        };
                    }

                    // Response is valid JSON but no models found - still valid server
                    return {
                        valid: true,
                        models: [],
                        endpoint: endpoint || '/',
                        note: 'No models discovered'
                    };
                }
            } else if (response.status === 401 || response.status === 403) {
                return {
                    valid: false,
                    error: 'Authentication failed - check your API keys',
                    details: { status: response.status, endpoint }
                };
            }
            // Continue to next endpoint
        } catch (e) {
            if (e.name === 'AbortError') {
                return {
                    valid: false,
                    error: 'Server timeout - server did not respond within 10 seconds',
                    details: { timeout: true }
                };
            }
            // Continue to next endpoint on network errors
        }
    }

    // Try a simple HEAD/GET request to base URL
    try {
        const response = await fetch(baseUrl, { 
            method: 'HEAD',
            headers
        });
        
        if (response.ok || response.status < 500) {
            // Server is reachable, just no models endpoint
            return {
                valid: true,
                models: [],
                note: 'Server reachable but no models endpoint found'
            };
        }
    } catch (e) {
        // Fall through to error
    }

    return {
        valid: false,
        error: 'Cannot connect to server - check URL and network accessibility',
        details: { baseUrl }
    };
}

async function hashString(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray, byte => byte.toString(16).padStart(2, "0")).join("");
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS
        }
    });
}
