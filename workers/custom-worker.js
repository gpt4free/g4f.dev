// custom-worker.js
var RATE_LIMITS = {
  // Token limits
  tokens: {
    perMinute: 5e4,
    perHour: 3e5,
    perDay: 5e5
  },
  // Request limits
  requests: {
    perMinute: 5,
    perHour: 50,
    perDay: 500
  },
  // Window durations in milliseconds
  windows: {
    minute: 60 * 1e3,
    hour: 60 * 60 * 1e3,
    day: 24 * 60 * 60 * 1e3
  }
};
var USER_TIER_LIMITS = {
  new: {
    tokens: { perMinute: 1e5, perHour: 3e5, perDay: 1e6 },
    requests: { perMinute: 10, perHour: 100, perDay: 1e3 }
  },
  free: {
    tokens: { perMinute: 2e5, perHour: 1e6, perDay: 5e6 },
    requests: { perMinute: 20, perHour: 200, perDay: 2e3 }
  },
  sponsor: {
    tokens: { perMinute: 5e5, perHour: 25e5, perDay: 1e7 },
    requests: { perMinute: 50, perHour: 500, perDay: 5e3 }
  },
  pro: {
    tokens: { perMinute: 1e6, perHour: 5e6, perDay: 2e7 },
    requests: { perMinute: 100, perHour: 1e3, perDay: 1e4 }
  },
  admin: {
    tokens: { perMinute: 1e6, perHour: 5e6, perDay: 2e7 },
    requests: { perMinute: 100, perHour: 1e3, perDay: 1e4 }
  }
};
var CACHE_HEADERS = {
  FOREVER: "public, max-age=31536000, immutable",
  // 1 year
  LONG: "public, max-age=86400",
  // 24 hours
  MEDIUM: "public, max-age=3600",
  // 1 hour
  SHORT: "public, max-age=300",
  // 5 minutes
  NO_CACHE: "no-cache, no-store, must-revalidate"
};
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
  "Access-Control-Expose-Headers": "Content-Type, X-User-Id, X-User-Tier, X-Provider, X-Model, X-Server, X-Url, X-Usage-Total-Tokens, X-Stream, X-Ratelimit-Model-Factor, X-Ratelimit-Remaining-Requests, X-Ratelimit-Remaining-Tokens, X-Ratelimit-Limit-Requests, X-Ratelimit-Limit-Tokens"
};
var ACCESS_CONTROL_ALLOW_ORIGIN = {
  "Access-Control-Allow-Origin": "*"
};
var DEFAULT_MODELS = {
  // 'srv_mjnrrgu4065b7b4329f6': 'model-router3',
  "srv_mkom688d57c76d8a3542": "llama-3.3-70b-versatile",
  // groq
  "srv_mkombumpae45db46dcb8": "deepseek-ai/deepseek-v3.2",
  // nvidia
  "srv_mkolabu46aa55fc6f003": "deepseek-v3.2",
  // ollama
  "srv_mkolylnsaec61b86b9c2": "tngtech/deepseek-r1t2-chimera:free",
  // openrouter
  // 'srv_mjlq1ncq8a3f7fe0aea0': 'turbo',
  "srv_mkol5tgcd33cc358ddbc": "models/gemini-flash-latest",
  // gemini
  "srv_mkoloq41e34074b6133e": "openai",
  // pollinations
  // "srv_mkomfko63371049b6da6": "deepseek-v3.2:free"
  // api.airforce
  "srv_mks0cusg6010f87029ea": "model-router3",
  // azure
};
var BLOCKED_SERVERS = [];
var GPT_AUDIO_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer", "coral", "verse", "ballad", "ash", "sage", "marin", "cedar", "amuch", "dan", "elan", "breeze", "cove", "ember", "fathom", "glimmer", "harp", "juniper", "maple", "orbit", "vale"];
var custom_worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (pathname == "/api/audio/models") {
      return Response.json({ data: [{ id: "gpt-audio", audio: true }, ...GPT_AUDIO_VOICES.map((voice) => {
        return { id: voice, audio: true };
      })] }, { headers: ACCESS_CONTROL_ALLOW_ORIGIN });
    }
    if (pathname == "/api/auto/models") {
      return Response.json({ data: [{id: "auto"}] }, { headers: ACCESS_CONTROL_ALLOW_ORIGIN });
    }
    try {
      const user = await authenticateRequest(request, env);
      const authHeader = request.headers.get("Authorization");
      let userProvidedKey = null;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const tokens = authHeader.substring(7).split(/\s+/);
        userProvidedKey = tokens.find((t) => t && !t.startsWith("g4f_") && !t.startsWith("gfs_"));
      }
      let rateCheck;
      if (!userProvidedKey && !pathname.endsWith("/models") && !pathname.startsWith("/custom/api/"))
        if (user) {
          rateCheck = await checkUserRateLimits(env, user, request);
          if (!rateCheck.allowed) {
            const windowLabels = { minute: "per minute", hour: "per hour", day: "per day" };
            const message = rateCheck.reason === "tokens" ? `Token limit (${rateCheck.limit.toLocaleString()} ${windowLabels[rateCheck.window]}) exceeded for ${rateCheck.tier} tier. Used: ${rateCheck.used.toLocaleString()} tokens.` : `Request limit (${rateCheck.limit} ${windowLabels[rateCheck.window]}) exceeded for ${rateCheck.tier} tier. Made: ${rateCheck.used} requests.`;
            const newResponse = Response.json({
              error: {
                message,
                type: "rate_limit_exceeded",
                tier: rateCheck.tier,
                window: rateCheck.window,
                limit: rateCheck.limit,
                used: rateCheck.used,
                retry_after: rateCheck.retryAfter
              }
            }, { status: 429, headers: { "Retry-After": rateCheck.retryAfter.toString(), ...ACCESS_CONTROL_ALLOW_ORIGIN } });
            updateResponsefromRateCheck(newResponse, rateCheck);
            return newResponse;
          }
        } else {
          rateCheck = await checkAnonymousRateLimits(env, request);
          if (!rateCheck.allowed) {
            const windowLabels = { minute: "per minute", hour: "per hour", day: "per day" };
            const message = rateCheck.reason === "tokens" ? `Token limit (${rateCheck.limit.toLocaleString()} ${windowLabels[rateCheck.window]}) exceeded. Used: ${rateCheck.used.toLocaleString()} tokens. Sign up at g4f.dev/members.html for higher limits.` : `Request limit (${rateCheck.limit} ${windowLabels[rateCheck.window]}) exceeded. Made: ${rateCheck.used} requests. Sign up at g4f.dev/members.html for higher limits.`;
            const newResponse = Response.json({
              error: {
                message,
                type: "rate_limit_exceeded",
                window: rateCheck.window,
                limit: rateCheck.limit,
                used: rateCheck.used,
                retry_after: rateCheck.retryAfter,
                upgrade_url: "https://g4f.dev/members.html"
              }
            }, { status: 429, headers: { "Retry-After": rateCheck.retryAfter.toString(), ...ACCESS_CONTROL_ALLOW_ORIGIN } });
            updateResponsefromRateCheck(newResponse, rateCheck);
            return newResponse;
          }
        }
      const cacheKey = url.toString();
      if (request.method === "GET" && (pathname.startsWith("/ai/") || pathname.endsWith("/models") || pathname.endsWith("/chat/completions"))) {
        const cachedResponse = await getCachedResponse(request, cacheKey);
        if (cachedResponse) {
          const newResponse = new Response(cachedResponse.body, cachedResponse);
          if (user) {
            newResponse.headers.set("X-User-Id", user.id);
            newResponse.headers.set("X-User-Tier", user.tier);
          }
          if (rateCheck) {
            updateResponsefromRateCheck(newResponse, rateCheck);
          }
          return newResponse;
        }
      }
      if (!userProvidedKey && !pathname.startsWith("/custom/api/")) {
        if (user) {
          ctx.waitUntil(updateUserRateLimit(env, user.id, ctx));
        }
        ctx.waitUntil(updateAnonymousRateLimit(env, getClientIP(request), ctx));
      }
      if (pathname.startsWith("/ai/")) {
        return handleCustomAiRoute(request, pathname, cacheKey, rateCheck, env, ctx);
      }
      if (pathname === "/custom/api/servers") {
        return handleListServers(request, env);
      }
      if (pathname === "/custom/api/servers/create") {
        return handleCreateServer(request, env);
      }
      if (pathname === "/custom/api/servers/update") {
        return handleUpdateServer(request, env);
      }
      if (pathname === "/custom/api/servers/delete") {
        return handleDeleteServer(request, env);
      }
      if (pathname === "/custom/api/servers/usage" || pathname === "/usage") {
        return handleGetServerUsage(request, env);
      }
      if (pathname === "/custom/api/servers/public") {
        return handleListPublicServers(request, env);
      }
      if (pathname.match(/^\/custom\/api\/servers\/[^/]+\/models$/)) {
        const serverId = pathname.split("/")[4];
        return handleGetServerModels(request, env, serverId);
      }
      if (pathname === "/v1/models" || pathname === "/custom/srv_mkopytsj9b6425de1db8/models") {
        return handleV1Models(request, env);
      }
      if (pathname.match(/^\/custom\/[^/]+\/models$/)) {
        const serverId = pathname.split("/")[2];
        const server = await getServerById(env, serverId, user);
        return handleModels(request, env, ctx, serverId, user, server, cacheKey);
      }
      if (pathname.match(/^\/api\/[^/]+\/models$/)) {
        const label = pathname.split("/")[2];
        const server = await getServerByLabel(env, label, user);
        if (!server) {
          return jsonResponse({ error: "Server not found" }, 404);
        }
        return handleModels(request, env, ctx, server.id, user, server, cacheKey);
      }
      if (pathname === "/v1/chat/completions" || pathname === "/custom/srv_mkopytsj9b6425de1db8/chat/completions") {
        return handleV1ChatCompletions(request, env, ctx, pathname, cacheKey, rateCheck);
      }
      if (pathname.match(/^\/custom\/[^/]+\/chat\/completions$/)) {
        const serverId = pathname.split("/")[2];
        let server = await getServerById(env, serverId, user);
        if (!server) {
          return jsonResponse({ error: "Server not found" }, 404);
        }
        return handleProxyToServer(request, env, ctx, server, "/chat/completions", cacheKey, user, pathname, userProvidedKey, rateCheck);
      }
      if (pathname.match(/^\/api\/.+\/chat\/completions$/)) {
        const label = pathname.split("/")[2];
        let server;
        if (label === "auto") {
          server = await getRandomPublicServer(env);
        } else {
          server = await getServerByLabel(env, label, user);
        }
        if (!server) {
          return jsonResponse({ error: `Server by label '${label}' not found`, servers: await getPublicServers(env) }, 404);
        }
        return handleProxyToServer(request, env, ctx, server, "/chat/completions", cacheKey, user, pathname, userProvidedKey, rateCheck);
      }
      if (pathname.startsWith("/custom/") && pathname.split("/").length >= 3) {
        const parts = pathname.split("/");
        const serverId = parts[2];
        const subPath = "/" + parts.slice(3).join("/");
        const user2 = await authenticateRequest(request, env);
        const server = await getServerById(env, serverId, user2);
        if (!server) {
          return jsonResponse({ error: "Server not found" }, 404);
        }
        return handleProxyToServer(request, env, ctx, server, subPath, cacheKey, user2, pathname, userProvidedKey, rateCheck);
      }
      if (pathname.startsWith("/api/") && pathname.split("/").length >= 3) {
        const parts = pathname.split("/");
        const label = parts[2];
        const subPath = "/" + parts.slice(3).join("/");
        const user2 = await authenticateRequest(request, env);
        const server = await getServerByLabel(env, label, user2);
        if (!server) {
          return jsonResponse({ error: "Server not found" }, 404);
        }
        return handleProxyToServer(request, env, ctx, server, subPath, cacheKey, user2, pathname, userProvidedKey, rateCheck);
      }
      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      console.error("Custom worker error:", error);
      return jsonResponse({ error: error.message || "Internal server error" }, 500);
    }
  }
};
async function authenticateRequest(request, env) {
  let sessionToken = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!sessionToken) {
    const cookie = request.headers.get("Cookie");
    if (cookie) {
      const match = cookie.match(/g4f_session=([^;]+)/);
      sessionToken = match ? match[1] : null;
    }
  }
  const xApiKey = request.headers.get("X-API-Key");
  const authHeader = request.headers.get("Authorization");
  let apiKey = null;
  if (authHeader && authHeader.startsWith("Bearer ") && authHeader.includes("gfs_")) {
    const tokens = authHeader.substring(7).split(/\s+/);
    sessionToken = tokens.find((t) => t.startsWith("gfs_"));
  }
  if (authHeader && authHeader.startsWith("Bearer ") && authHeader.includes("g4f_")) {
    const tokens = authHeader.substring(7).split(/\s+/);
    apiKey = tokens.find((t) => t.startsWith("g4f_"));
  }
  if (!apiKey && xApiKey && xApiKey.startsWith("g4f_")) {
    apiKey = xApiKey;
  }
  if (apiKey && env.MEMBERS_KV) {
    const keyHash = await hashString(apiKey);
    const keyDataStr = await env.MEMBERS_KV.get(`api_key:${keyHash}`);
    if (keyDataStr) {
      try {
        const keyData = JSON.parse(keyDataStr);
        const user = await getUser(env, keyData.user_id);
        return user;
      } catch (e) {
        console.error("Failed to parse API key data:", e);
      }
    }
  }
  if (sessionToken && env.MEMBERS_KV) {
    const sessionData = await env.MEMBERS_KV.get(`session:${sessionToken}`);
    if (sessionData) {
      const session = JSON.parse(sessionData);
      if (new Date(session.expires_at) > /* @__PURE__ */ new Date()) {
        return await getUser(env, session.user_id);
      }
    }
  }
  const userId = request.headers.get("X-User-Id");
  if (userId && env.MEMBERS_BUCKET) {
  }
  return null;
}
async function getUser(env, userId) {
  if (env.MEMBERS_KV) {
    const cached = await env.MEMBERS_KV.get(`user:${userId}`);
    if (cached) {
      return JSON.parse(cached);
    }
  }
  if (env.MEMBERS_BUCKET) {
    const object = await env.MEMBERS_BUCKET.get(`users/${userId}.json`);
    if (object) {
      const user = await object.json();
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
  if (env.MEMBERS_KV) {
    await env.MEMBERS_KV.put(`user:${user.id}`, JSON.stringify(user), { expirationTtl: 3600 });
  }
}
async function handleListServers(request, env) {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const servers = user.custom_servers || [];
  const safeServers = servers.map((s) => ({
    id: s.id,
    label: s.label,
    base_url: s.base_url,
    is_public: s.is_public,
    allowed_models: s.allowed_models,
    api_key_count: (s.api_keys || "").split("\n").filter((k) => k.trim()).length,
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
  if (!body.base_url) {
    return jsonResponse({ error: "base_url is required" }, 400);
  }
  let baseUrl;
  try {
    baseUrl = new URL(body.base_url);
  } catch (e) {
    return jsonResponse({ error: "Invalid base_url format" }, 400);
  }
  const normalizedBaseUrl = body.base_url.replace(/\/$/, "");
  const validationResult = await validateServer(normalizedBaseUrl, body.api_keys);
  if (!validationResult.valid) {
    return jsonResponse({
      error: `Server validation failed: ${validationResult.error}`,
      details: validationResult.details
    }, 400);
  }
  const maxServers = user.tier === "pro" ? 50 : user.tier === "sponsor" ? 10 : 3;
  if (user.tier !== "admin" && (user.custom_servers || []).length >= maxServers) {
    return jsonResponse({
      error: `Maximum ${maxServers} servers allowed for ${user.tier || "free"} tier`
    }, 400);
  }
  const serverId = generateServerId();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const allowedModels = body.allowed_models && body.allowed_models.length > 0 ? body.allowed_models : validationResult.models || [];
  const server = {
    id: serverId,
    label: body.label || `Server ${(user.custom_servers || []).length + 1}`,
    base_url: normalizedBaseUrl,
    api_keys: body.api_keys || "",
    // Line-separated API keys
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
  user.custom_servers = user.custom_servers || [];
  user.custom_servers.push(server);
  user.updated_at = now;
  await saveUser(env, user);
  if (server.is_public) {
    await updatePublicServerIndex(env, server, user.id, "add");
  }
  const safeServer = { ...server };
  delete safeServer.api_keys;
  safeServer.api_key_count = (server.api_keys || "").split("\n").filter((k) => k.trim()).length;
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
  const serverIndex = (user.custom_servers || []).findIndex((s) => s.id === body.server_id);
  if (serverIndex === -1) {
    return jsonResponse({ error: "Server not found" }, 404);
  }
  const server = user.custom_servers[serverIndex];
  const wasPublic = server.is_public;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const allowedFields = ["label", "base_url", "api_keys", "allowed_models", "is_public"];
  for (const field of allowedFields) {
    if (body[field] !== void 0) {
      if (field === "base_url") {
        try {
          new URL(body.base_url);
          server.base_url = body.base_url.replace(/\/$/, "");
        } catch (e) {
          return jsonResponse({ error: "Invalid base_url format" }, 400);
        }
      } else if (field != "api_keys" || body[field]) {
        server[field] = body[field];
      }
    }
  }
  server.updated_at = now;
  user.updated_at = now;
  await saveUser(env, user);
  if (wasPublic && !server.is_public) {
    await updatePublicServerIndex(env, server, user.id, "remove");
  } else if (!wasPublic && server.is_public) {
    await updatePublicServerIndex(env, server, user.id, "add");
  } else if (server.is_public) {
    await updatePublicServerIndex(env, server, user.id, "update");
  }
  const safeServer = { ...server };
  delete safeServer.api_keys;
  safeServer.api_key_count = (server.api_keys || "").split("\n").filter((k) => k.trim()).length;
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
  const serverIndex = (user.custom_servers || []).findIndex((s) => s.id === body.server_id);
  if (serverIndex === -1) {
    return jsonResponse({ error: "Server not found" }, 404);
  }
  const server = user.custom_servers[serverIndex];
  if (server.is_public) {
    await updatePublicServerIndex(env, server, user.id, "remove");
  }
  if (env.MEMBERS_BUCKET) {
    await env.MEMBERS_BUCKET.put(
      `custom_servers/${user.id}/${server.id}_deleted.json`,
      JSON.stringify({
        ...server,
        deleted_at: (/* @__PURE__ */ new Date()).toISOString()
      }, null, 2),
      { httpMetadata: { contentType: "application/json" } }
    );
  }
  user.custom_servers.splice(serverIndex, 1);
  user.updated_at = (/* @__PURE__ */ new Date()).toISOString();
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
  const server = (user.custom_servers || []).find((s) => s.id === serverId);
  if (!server) {
    return jsonResponse({ error: "Server not found" }, 404);
  }
  const history = [];
  const now = /* @__PURE__ */ new Date();
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
async function getPublicServers(env) {
  let publicServers = [];
  if (env.MEMBERS_KV) {
    const indexStr = await env.MEMBERS_KV.get("public_servers_index");
    if (indexStr) {
      publicServers = JSON.parse(indexStr).filter((s) => !BLOCKED_SERVERS.includes(s.id));
    }
  }
  return publicServers;
}
async function handleListPublicServers(request, env) {
  const publicServers = await getPublicServers(env);
  const safeServers = publicServers.map((s) => ({
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
  const user = await authenticateRequest(request, env);
  const server = await getServerById(env, serverId, user);
  if (!server) {
    return jsonResponse({ error: "Server not found" }, 404);
  }
  if (server.allowed_models && server.allowed_models.length > 0) {
    return jsonResponse({
      data: server.allowed_models.map((m) => ({ id: m }))
    });
  }
  try {
    const apiKey = getRandomApiKey(server.api_keys);
    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
      headers["Authorization"] = apiKey.includes("Bearer") ? apiKey : `Bearer ${apiKey}`;
    }
    const response = await fetch(`${server.base_url}/models`, { headers });
    if (response.ok) {
      const data = await response.json();
      return jsonResponse(data);
    }
  } catch (e) {
    console.error("Failed to fetch models:", e);
  }
  return jsonResponse({ data: [] });
}
async function handleModels(request, env, ctx, serverId, user, server, cacheKey) {
  if (!server) {
    return jsonResponse({ error: "Server not found" }, 404);
  }
  const apiKey = getRandomApiKey(server.api_keys);
  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["Authorization"] = apiKey.includes("Bearer") ? apiKey : `Bearer ${apiKey}`;
  }
  try {
    const targetUrl = server.base_url.includes("/chat/completions") ? server.base_url.replace("/chat/completions", "/models") : `${server.base_url}/models`;
    const response = await fetch(targetUrl, {
      method: request.method,
      headers
    });
    if (!response.ok) {
      throw Error(`Error ${response.status}: ${await response.text()}`);
    }
    const data = await response.json();
    if (server.allowed_models && server.allowed_models.length > 0) {
      data.data = data.data.filter((model) => server.allowed_models.includes(model.id));
      if (!data.data.length) {
        data.data = server.allowed_models.map((m) => {
          return { id: m };
        });
      }
    }
    const newResponse = new Response(JSON.stringify(data), response);
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      newResponse.headers.set(key, value);
    }
    newResponse.headers.set("X-Server", serverId);
    newResponse.headers.set("X-Provider", server.label);
    newResponse.headers.set("X-Url", targetUrl);
    ctx.waitUntil(setCachedResponse(request, newResponse, CACHE_HEADERS.MEDIUM, cacheKey, ctx));
    return newResponse;
  } catch (e) {
    if (server.allowed_models && server.allowed_models.length > 0) {
      console.log(e);
      return jsonResponse({
        data: server.allowed_models.map((m) => ({ id: m, audio: m.includes("audio") }))
      });
    }
    return jsonResponse({ error: `Failed to connect to server: ${e.message}` }, 502);
  }
}
async function handleProxyToServer(request, env, ctx, server, subPath, cacheKey, user = null, pathname = null, userProvidedKey = null, rateCheck = null) {
  if (!server) {
    return jsonResponse({ error: "Server not found" }, 404);
  }
  let requestBody = {};
  let requestModel = null;
  if (request.method === "POST") {
    requestBody = await request.clone().json();
    requestModel = requestBody.model;
    try {
      const messages = requestBody.messages;
      if (messages) {
        const message = messages[messages.length - 1];
        if (message && typeof message.content === "string") {
          if (message.content === "Server?") {
            return jsonResponse({ "choices": [{ "message": { "content": `${server.label} - Server ID: ${server.id}` } }] });
          }
          if (message.content.startsWith("Hello, are you working?") || message.content.startsWith("Are you working?")) {
            return jsonResponse({ "choices": [{ "message": { "content": "Yes" } }] });
          }
          const m = message.content.match(/^(what is |)(\d+)([\+*])(\d+)(\?|$)/);
          if (m) {
            const a = Number(m[2]);
            const b = Number(m[4]);
            const r = String(m[3] === "+" ? a + b : a * b);
            return jsonResponse({ "choices": [{ "message": { "content": r } }] });
          }
        }
      }
    } catch (e) {
    }
  }
  if (subPath === "/chat/completions") {
    try {
      if (!requestModel || requestModel === "auto") {
        if (DEFAULT_MODELS[server.id]) {
          requestModel = DEFAULT_MODELS[server.id];
        } else {
          requestModel = server.allowed_models && server.allowed_models[0];
        }
      }
      requestBody.model = requestModel;
      if (server.allowed_models && server.allowed_models.length > 0) {
        if (!server.allowed_models.includes(requestModel)) {
          return jsonResponse({
            error: {
              message: `Model '${requestModel}' is not allowed on this server. Allowed: ${server.allowed_models.join(", ")}`,
              type: "model_not_allowed"
            }
          }, 400);
        }
      }
      if (requestBody.stream) {
        requestBody.stream_options = { include_usage: true };
      }
    } catch (e) {
    }
  }
  const apiKey = getRandomApiKey(server.api_keys);
  const proxyHeaders = {
    "Content-Type": request.headers.get("Content-Type") || "application/json"
  };
  if (userProvidedKey) {
    proxyHeaders["Authorization"] = userProvidedKey.includes("Bearer") ? userProvidedKey : `Bearer ${userProvidedKey}`;
  } else if (apiKey) {
    proxyHeaders["Authorization"] = apiKey.includes("Bearer") ? apiKey : `Bearer ${apiKey}`;
  }
  let targetUrl;
  if (server.base_url.includes(subPath)) {
    targetUrl = server.base_url;
  } else if (server.base_url.includes("/v1/chat/completions")) {
    targetUrl = server.base_url.split("/v1/")[0] + subPath;
  } else {
    targetUrl = `${server.base_url}${subPath}`;
  }
  const clientIP = getClientIP(request);
  try {
    const fetchOptions = {
      method: request.method,
      headers: proxyHeaders
    };
    if (subPath === "/chat/completions") {
      fetchOptions.method = "POST";
      fetchOptions.body = JSON.stringify({ ...requestBody, "messages": [{ "role": "user", "content": "Hello" }] });
    }
    if (request.method === "POST") {
      fetchOptions.body = requestBody ? JSON.stringify(requestBody) : await request.text();
    }
    const firstMessage = requestBody ? requestBody.prompt || getFirstMessage(requestBody.messages) : null;
    const response = await fetch(targetUrl, fetchOptions);
    const contentType = (response.headers.get("content-type") || "").split(";")[0];
    if (!contentType || !["text/event-stream", "application/json", "text/plain", "application/problem+json", "audio/vnd.wav", "audio/mpeg"].includes(contentType)) {
      return Response.json(
        { error: { message: `Shield: Status: ${response.status}, Content-Type: '${contentType}'` } },
        { status: 500, headers: {
          "X-Url": targetUrl,
          "X-Server": server.id,
          "X-Provider": server.label,
          "X-User-Id": user ? user.id : null,
          ...ACCESS_CONTROL_ALLOW_ORIGIN
        } }
      );
    }
    let usage = {};
    if (subPath === "/chat/completions" && response.ok) {
      const contentType2 = response.headers.get("content-type") || "";
      if (requestBody.stream || contentType2.includes("text/event-stream")) {
        ctx.waitUntil(createUsageTrackingStream(
          response,
          env,
          ctx,
          server,
          server.id,
          clientIP,
          requestModel,
          firstMessage,
          user,
          pathname,
          userProvidedKey
        ));
        const newResponse2 = new Response(response.body, response);
        for (const [key, value] of Object.entries(CORS_HEADERS)) {
          newResponse2.headers.set(key, value);
        }
        newResponse2.headers.set("X-Url", targetUrl);
        newResponse2.headers.set("X-Server", server.id);
        newResponse2.headers.set("X-Provider", server.label);
        if (requestModel) newResponse2.headers.set("X-Model", requestModel);
        if (user) {
          newResponse2.headers.set("X-User-Id", user.id);
          newResponse2.headers.set("X-User-Tier", user.tier);
        }
        newResponse2.headers.set("X-Stream", "true");
        if (rateCheck) {
          newResponse2.headers.set("X-Ratelimit-Model-Factor", String(getModelFactor(requestBody.model)));
          updateResponsefromRateCheck(newResponse2, rateCheck);
        }
        newResponse2.headers.delete("set-cookie");
        return newResponse2;
      } else if (contentType2.includes("application/json")) {
        const clonedResponse = response.clone();
        try {
          const data = await clonedResponse.json();
          if (data.usage) {
            usage = data.usage;
          }
          if (data.model) {
            requestModel = data.model;
          }
        } catch (e) {
        }
      }
    }
    let totalTokens = parseInt(response.headers.get("X-Usage-Total-Tokens") || "0") || usage.total_tokens || 0;
    if (subPath === "/chat/completions" && response.ok || usage) {
      ctx.waitUntil(persistUsageToDb(env, clientIP, `custom:${server.id}`, requestModel, totalTokens, usage.prompt_tokens, usage.completion_tokens, pathname, firstMessage, user));
      ctx.waitUntil(updateServerUsage(env, server, totalTokens, requestModel));
      if (user) {
        ctx.waitUntil(updateUserDailyUsage(env, user.id, totalTokens, `custom:${server.id}`, requestModel));
      }
      const isCached = (response.headers.get("X-Cache") || usage.cache || "MISS") === "HIT";
      if (!userProvidedKey && !isCached) {
        const modelTotalTokens = getModelTokens(requestModel, totalTokens);
        ctx.waitUntil(updateAnonymousTokenUsage(env, clientIP, modelTotalTokens, ctx));
        if (user) {
          ctx.waitUntil(updateUserTokenUsage(env, user.id, modelTotalTokens, ctx));
        }
      }
    }
    const newResponse = new Response(response.body, response);
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      newResponse.headers.set(key, value);
    }
    newResponse.headers.set("X-Url", targetUrl);
    newResponse.headers.set("X-Server", server.id);
    newResponse.headers.set("X-Provider", server.label);
    if (requestModel) newResponse.headers.set("X-Model", requestModel);
    if (totalTokens) {
      newResponse.headers.set("X-Usage-Total-Tokens", String(totalTokens));
    }
    if (request.method === "GET") {
      ctx.waitUntil(setCachedResponse(request, newResponse.clone(), CACHE_HEADERS.MEDIUM, cacheKey, ctx));
    }
    if (user) {
      newResponse.headers.set("X-User-Id", user.id);
      newResponse.headers.set("X-User-Tier", user.tier);
    }
    if (requestModel) {
      newResponse.headers.set("X-Ratelimit-Model-Factor", String(getModelFactor(requestModel)));
    }
    if (rateCheck) {
      updateResponsefromRateCheck(newResponse, rateCheck);
    }
    newResponse.headers.delete("set-cookie");
    return newResponse;
  } catch (e) {
    throw e;
    return jsonResponse({
      error: { message: `Failed to connect to server: ${e.message}` }
    }, 502);
  }
}
async function createUsageTrackingStream(response, env, ctx, server, serverId, clientIP, model, firstMessage, user, pathname, userProvidedKey) {
  const reader = response.clone().body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = {};
  while (true) {
    const { done, value } = await reader.read();
    let lines = [];
    if (!done) {
      const text = decoder.decode(value, { stream: true });
      buffer += text;
      lines = buffer.split("\n");
      buffer = lines.pop() || "";
    } else if (buffer) {
      lines = buffer.split("\n");
    }
    for (const line of lines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const jsonStr = line.slice(6);
          const data = JSON.parse(jsonStr);
          if (data.usage) {
            usage = data.usage;
          }
          if (data.model) {
            model = data.model;
          }
        } catch (e) {
        }
      }
    }
    if (done) {
      break;
    }
  }
  ctx.waitUntil(persistUsageToDb(env, clientIP, `custom:${serverId}`, model, usage.total_tokens, usage.prompt_tokens, usage.completion_tokens, pathname, firstMessage, user));
  ctx.waitUntil(updateServerUsage(env, server, usage.total_tokens, model));
  if (user) {
    ctx.waitUntil(updateUserDailyUsage(env, user.id, usage.total_tokens, `custom:${serverId}`, model));
  }
  const isCached = (response.headers.get("X-Cache") || usage.cache || "MISS") === "HIT";
  if (!userProvidedKey && !isCached) {
    const totalTokens = getModelTokens(model, usage.total_tokens);
    ctx.waitUntil(updateAnonymousTokenUsage(env, clientIP, totalTokens, ctx));
    if (user) {
      ctx.waitUntil(updateUserTokenUsage(env, user.id, totalTokens, ctx));
    }
  }
}
function getFirstMessage(messages, fallback = "") {
  if (!messages || !Array.isArray(messages)) {
    return fallback || "";
  }
  for (const msg of messages) {
    const content = typeof msg.content === "string" ? msg.content.replace(/^[\s.]+|[\s.]+$/g, "") : "";
    if (content && !content.startsWith("Today is:") && !content.startsWith("[SYSTEM]:")) {
      return content;
    }
  }
  return fallback || "";
}
function getClientIP(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
async function persistUsageToDb(env, clientIP, provider, model, tokensUsed, promptTokens, completionTokens, pathname = null, firstMessage = null, userInfo = null) {
  if (!env.USAGE_DB) return;
  try {
    await env.USAGE_DB.prepare(
      `INSERT INTO usage_logs (ip, provider, model, tokens_total, tokens_prompt, tokens_completion, pathname, first_message, user_id, user_tier, username, timestamp) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      clientIP,
      provider || "unknown",
      model || "unknown",
      tokensUsed || 0,
      promptTokens || 0,
      completionTokens || 0,
      pathname || "unknown",
      firstMessage ? firstMessage.substring(0, 500) : null,
      userInfo?.user_id || userInfo?.id || null,
      userInfo?.tier || null,
      userInfo?.username || null,
      (/* @__PURE__ */ new Date()).toISOString()
    ).run();
  } catch (e) {
    console.error("Failed to persist usage:", e);
  }
}
async function updateServerUsage(env, server, tokens, model) {
  if (!env.MEMBERS_BUCKET || !server.owner_id) return;
  try {
    const user = await getUser(env, server.owner_id);
    if (!user) return;
    const serverIndex = (user.custom_servers || []).findIndex((s) => s.id === server.id);
    if (serverIndex === -1) return;
    const userServer = user.custom_servers[serverIndex];
    const now = /* @__PURE__ */ new Date();
    userServer.usage = userServer.usage || { requests: 0, tokens: 0 };
    userServer.usage.requests += 1;
    userServer.usage.tokens += tokens;
    userServer.usage.last_used = now.toISOString();
    user.updated_at = now.toISOString();
    await saveUser(env, user);
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
    if (userServer.is_public) {
      await updatePublicServerIndex(env, userServer, server.owner_id, "update");
    }
  } catch (e) {
    console.error("Failed to update server usage:", e);
  }
}
async function updateUserDailyUsage(env, userId, tokens, provider, model) {
  if (!env.MEMBERS_BUCKET || !userId) return;
  try {
    const dateKey = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const usagePath = `usage/${userId}/${dateKey}.json`;
    let usageData;
    const existing = await env.MEMBERS_BUCKET.get(usagePath);
    if (existing) {
      usageData = await existing.json();
    } else {
      usageData = {
        date: dateKey,
        requests: 0,
        tokens: 0,
        providers: {},
        models: {}
      };
    }
    usageData.requests += 1;
    usageData.tokens += tokens || 0;
    if (provider) {
      usageData.providers[provider] = (usageData.providers[provider] || 0) + 1;
    }
    if (model) {
      usageData.models[model] = (usageData.models[model] || 0) + 1;
    }
    await env.MEMBERS_BUCKET.put(usagePath, JSON.stringify(usageData, null, 2), {
      httpMetadata: { contentType: "application/json" }
    });
  } catch (e) {
    console.error("Failed to update user daily usage:", e);
  }
}
async function getServerById(env, serverId, user = null) {
  if (user && user.custom_servers) {
    const ownedServer = user.custom_servers.find((s) => s.id === serverId);
    if (ownedServer) {
      return { ...ownedServer, owner_id: user.id };
    }
  }
  if (env.MEMBERS_KV) {
    const cached = await env.MEMBERS_KV.get(`server:${serverId}`);
    if (cached) {
      return JSON.parse(cached);
    }
  }
  let publicServers = await getPublicServers(env);
  if (publicServers) {
    const server = publicServers.find((s) => s.id === serverId);
    if (server) {
      const owner = await getUser(env, server.owner_id);
      if (owner) {
        const fullServer = (owner.custom_servers || []).find((s) => s.id === serverId);
        if (fullServer && fullServer.is_public) {
          fullServer.owner_id = owner.id;
          await env.MEMBERS_KV.put(
            `server:${serverId}`,
            JSON.stringify(fullServer),
            { expirationTtl: 300 }
          );
          return fullServer;
        }
      }
      return server;
    }
  }
  return null;
}
async function getServerByLabel(env, label, user = null) {
  if (user && user.custom_servers) {
    const ownedServer = user.custom_servers.find((s) => s.label.toLowerCase().includes(label.toLowerCase()));
    if (ownedServer) {
      return { ...ownedServer, owner_id: user.id };
    }
  }
  const publicServers = await getPublicServers(env);
  if (publicServers) {
    const serverIndex = publicServers.find((s) => s.label.toLowerCase().includes(label.toLowerCase()));
    if (serverIndex) {
      return await getServerById(env, serverIndex.id, user);
    }
  }
  return null;
}
async function updatePublicServerIndex(env, server, ownerId, action) {
  if (!env.MEMBERS_KV) return;
  let servers = await getPublicServers(env);
  if (action === "remove") {
    servers = servers.filter((s) => s.id !== server.id);
  } else {
    servers = servers.filter((s) => s.id !== server.id);
    if (action === "add" || action === "update") {
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
  await env.MEMBERS_KV.put("public_servers_index", JSON.stringify(servers));
  await env.MEMBERS_KV.delete(`server:${server.id}`);
}
function getRandomApiKey(apiKeysStr) {
  if (!apiKeysStr) return null;
  const keys = apiKeysStr.split("\n").map((k) => k.trim()).filter((k) => k && !k.startsWith("#"));
  if (keys.length === 0) return null;
  return keys[Math.floor(Math.random() * keys.length)];
}
function generateServerId() {
  const timestamp = Date.now().toString(36);
  const randomPart = crypto.getRandomValues(new Uint8Array(6));
  const randomStr = Array.from(randomPart, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `srv_${timestamp}${randomStr}`;
}
async function validateServer(baseUrl, apiKeysStr) {
  const apiKey = getRandomApiKey(apiKeysStr);
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json"
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  const modelsEndpoints = [
    "/models",
    "/v1/models",
    ""
  ];
  if (baseUrl.includes("/chat/completions")) {
    try {
      const url = baseUrl;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1e4);
      const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify({ "messages": [{ "role": "user", "content": "Hello" }] }),
        headers,
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (response.ok) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          return {
            valid: true,
            models: [],
            endpoint: "",
            note: "No models discovered"
          };
        }
      } else if (response.status === 401 || response.status === 403) {
        return {
          valid: false,
          error: "Authentication failed - check your API keys",
          details: { status: response.status, endpoint: "" }
        };
      }
    } catch (e) {
      if (e.name === "AbortError") {
        return {
          valid: false,
          error: "Server timeout - server did not respond within 10 seconds",
          details: { timeout: true }
        };
      }
    }
  }
  for (const endpoint of modelsEndpoints) {
    try {
      const url = baseUrl + endpoint;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1e4);
      const response = await fetch(url, {
        headers,
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (response.ok) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const data = await response.json();
          let models = [];
          if (data.data && Array.isArray(data.data)) {
            models = data.data.map((m) => m.id).filter(Boolean);
          } else if (data.models && Array.isArray(data.models)) {
            models = data.models.map((m) => typeof m === "string" ? m : m.id || m.name).filter(Boolean);
          } else if (Array.isArray(data)) {
            models = data.map((m) => typeof m === "string" ? m : m.id || m.name).filter(Boolean);
          }
          if (models.length > 0) {
            return {
              valid: true,
              models,
              //.slice(0, 100), // Limit to 100 models
              endpoint: endpoint || "/"
            };
          }
          return {
            valid: true,
            models: [],
            endpoint: endpoint || "/",
            note: "No models discovered"
          };
        }
      } else if (response.status === 401 || response.status === 403) {
        return {
          valid: false,
          error: "Authentication failed - check your API keys",
          details: { status: response.status, endpoint }
        };
      }
    } catch (e) {
      if (e.name === "AbortError") {
        return {
          valid: false,
          error: "Server timeout - server did not respond within 10 seconds",
          details: { timeout: true }
        };
      }
    }
  }
  try {
    const response = await fetch(baseUrl, {
      method: "HEAD",
      headers
    });
    if (response.ok || response.status < 500) {
      return {
        valid: true,
        models: [],
        note: "Server reachable but no models endpoint found"
      };
    }
  } catch (e) {
  }
  return {
    valid: false,
    error: "Cannot connect to server - check URL and network accessibility",
    details: { baseUrl }
  };
}
async function hashString(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function handleCustomAiRoute(request, pathname, cacheKey, rateCheck, env, ctx) {
  const user = await authenticateRequest(request, env);
  const url = new URL(request.url);
  let query = pathname.substring(4);
  let splited = query.split("/", 2);
  let serverLabel = splited[0];
  let prompt = splited[1] || "";
  let server;
  if (!serverLabel || serverLabel === "auto") {
    server = await getRandomPublicServer(env);
    if (!server) {
      return jsonResponse({ error: "No available servers" }, 503);
    }
  } else {
    server = await getServerByLabel(env, serverLabel, user);
    if (!server) {
      return jsonResponse({ error: `Server '${serverLabel}' not found` }, 404);
    }
  }
  const apiKey = getRandomApiKey(server.api_keys);
  const authHeader = request.headers.get("authorization");
  let userProvidedKey = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const tokens = authHeader.substring(7).split(/\s+/);
    userProvidedKey = tokens.find((t) => t && !t.startsWith("g4f_") && !t.startsWith("gfs_"));
  }
  const queryUrl = server.base_url.includes("/chat/completions") ? server.base_url : server.base_url + "/chat/completions";
  prompt = decodeURIComponent((prompt || "").trim());
  let queryBody;
  if (request.method === "POST") {
    queryBody = await request.json();
  } else {
    if (prompt == "ok") {
      prompt = "Respond with exactly the single word: ok";
    }
    let instructions = url.searchParams.get("instructions");
    if (!instructions) {
      if (serverLabel === "audio") {
        const language = url.searchParams.get("language") || "en";
        query = `Repeat the content between the delimiters exactly as written. Output only that content, with no extra words before or after. Language: ${language}

<<<
${prompt}
>>>`;
        queryBody = { messages: [{ role: "user", content: query }] };
      } else {
        instructions = `Today is: ${new Date(Date.now()).toLocaleString().split(",")[0]}, User language: ${request.headers.get("accept-language") || "en"}`;
        queryBody = { messages: [{ role: "system", content: instructions }, { role: "user", content: prompt }] };
      }
    }
  }
  queryBody.model = queryBody.model || url.searchParams.get("model") || DEFAULT_MODELS[server.id] || server.allowed_models && server.allowed_models[0];
  if (url.searchParams.get("json") === "true") {
    queryBody.response_format = { "type": "json_object" };
  }
  if (serverLabel === "audio") {
    queryBody.audio = {
      "voice": url.searchParams.get("voice") || "alloy",
      "format": "mp3"
    };
    if (!queryBody.modalities) {
      queryBody.modalities = ["text", "audio"];
    }
  }
  if (server.allowed_models && server.allowed_models.length > 0 && queryBody.model) {
    if (!server.allowed_models.includes(queryBody.model)) {
      return jsonResponse({
        error: `Model '${queryBody.model}' not allowed. Available models: ${server.allowed_models.join(", ")}`
      }, 400);
    }
  }
  const proxyHeaders = {
    "Content-Type": "application/json"
  };
  if (userProvidedKey) {
    proxyHeaders["Authorization"] = userProvidedKey.includes("Bearer") ? userProvidedKey : `Bearer ${userProvidedKey}`;
  } else if (apiKey) {
    proxyHeaders["Authorization"] = apiKey.includes("Bearer") ? apiKey : `Bearer ${apiKey}`;
  }
  // Enable streaming by default for text responses (not audio)
  const enableStreaming = serverLabel !== "audio" && !queryBody.stream && url.searchParams.get("stream") !== "false";
  if (enableStreaming) {
    queryBody.stream = true;
  }
  try {
    const response = await fetch(queryUrl, {
      method: "POST",
      body: JSON.stringify(queryBody),
      headers: proxyHeaders
    });
    if (!response.ok || queryBody.stream) {
      const contentType = (response.headers.get("content-type") || "").split(";")[0];
      if (queryBody.stream || contentType.includes("text/event-stream")) {
        const clientIP2 = getClientIP(request);
        const requestModel2 = queryBody.model;
        const firstMessage2 = getFirstMessage(queryBody.messages);
        ctx.waitUntil(createUsageTrackingStream(
          response,
          env,
          ctx,
          server,
          server.id,
          clientIP2,
          requestModel2,
          firstMessage2,
          user,
          pathname,
          userProvidedKey
        ));
        // If streaming was enabled by default, transform SSE to plain text stream
        if (enableStreaming && response.ok && contentType.includes("text/event-stream")) {
          const textStream = new ReadableStream({
            async start(controller) {
              const reader = response.body.getReader();
              const decoder = new TextDecoder();
              let buffer = "";
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  buffer += decoder.decode(value, { stream: true });
                  const lines = buffer.split("\n");
                  buffer = lines.pop() || "";
                  for (const line of lines) {
                    if (line.startsWith("data: ")) {
                      const data = line.slice(6).trim();
                      if (data === "[DONE]") continue;
                      try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content || 
                                        parsed.choices?.[0]?.delta?.reasoning_content ||
                                        parsed.choices?.[0]?.text || "";
                        if (content) {
                          controller.enqueue(new TextEncoder().encode(content));
                        }
                      } catch (e) {
                        // Skip invalid JSON
                      }
                    }
                  }
                }
              } catch (e) {
                controller.error(e);
              } finally {
                controller.close();
              }
            }
          });
          const newResponse2 = new Response(textStream, {
            headers: { "Content-Type": "text/plain; charset=UTF-8", ...CORS_HEADERS }
          });
          newResponse2.headers.set("X-Provider", server.label);
          if (queryBody.model) newResponse2.headers.set("X-Model", queryBody.model);
          newResponse2.headers.set("X-Server", server.id);
          newResponse2.headers.set("X-Url", queryUrl);
          newResponse2.headers.set("X-Stream", "true");
          if (rateCheck) {
            newResponse2.headers.set("X-Ratelimit-Model-Factor", String(getModelFactor(queryBody.model)));
            updateResponsefromRateCheck(newResponse2, rateCheck);
          }
          return newResponse2;
        }
      }
      const newResponse2 = new Response(response.body, response);
      for (const [key, value] of Object.entries(CORS_HEADERS)) {
        newResponse2.headers.set(key, value);
      }
      newResponse2.headers.set("X-Provider", server.label);
      if (queryBody.model) newResponse2.headers.set("X-Model", queryBody.model);
      newResponse2.headers.set("X-Server", server.id);
      newResponse2.headers.set("X-Url", queryUrl);
      if (rateCheck) {
        newResponse2.headers.set("X-Ratelimit-Model-Factor", String(getModelFactor(queryBody.model)));
        updateResponsefromRateCheck(newResponse2, rateCheck);
      }
      return newResponse2;
    }
    let data = await response.json();
    const usage = data.usage || {};
    if (data.choices && data.choices[0].message.audio) {
      data = data.choices[0].message.audio.data;
      const newResponse2 = new Response(base64toBlob(data), {
        headers: { "Content-Type": "audio/mpeg", ...ACCESS_CONTROL_ALLOW_ORIGIN }
      });
      ctx.waitUntil(setCachedResponse(request, newResponse2, CACHE_HEADERS.FOREVER, cacheKey, ctx));
      return newResponse2;
    }
    if (data.choices) {
      data = data.choices[0].message.content;
    } else if (data.message?.content) {
      data = data.message.content;
    } else if (data.output) {
      data = data.output[data.output.length - 1]?.content[0].text;
    } else {
      data = JSON.stringify(data);
    }
    if (data && url.searchParams.get("json") === "true") {
      data = filterMarkdown(data, "json", data);
    }
    if (data === "Model unavailable." || !data) {
      return jsonResponse({ error: { message: data || "Empty response" } }, 500);
    }
    const newResponse = new Response(data, {
      headers: { "Content-Type": "text/plain; charset=UTF-8", ...CORS_HEADERS }
    });
    newResponse.headers.set("X-Provider", server.label);
    if (queryBody.model) newResponse.headers.set("X-Model", queryBody.model);
    newResponse.headers.set("X-Server", server.id);
    newResponse.headers.set("X-Url", queryUrl);
    if (request.method === "GET" && prompt && !data.includes("Model unavailable")) {
      ctx.waitUntil(setCachedResponse(request, newResponse, CACHE_HEADERS.LONG, cacheKey, ctx));
    }
    const clientIP = getClientIP(request);
    const requestModel = data.model || queryBody.model;
    const firstMessage = prompt || getFirstMessage(queryBody.messages);
    ctx.waitUntil(persistUsageToDb(env, clientIP, `custom:${server.id}`, requestModel, usage.total_tokens, usage.prompt_tokens, usage.completion_tokens, pathname, firstMessage, user));
    ctx.waitUntil(updateServerUsage(env, server, usage.total_tokens, requestModel));
    if (user) {
      ctx.waitUntil(updateUserDailyUsage(env, user.id, usage.total_tokens, `custom:${server.id}`, requestModel));
    }
    if (!userProvidedKey && response.headers.get("X-Cache") !== "HIT") {
      const totalTokens = getModelTokens(requestModel, usage.total_tokens);
      if (totalTokens) {
        newResponse.headers.set("X-Usage-Total-Tokens", String(totalTokens));
      }
      ctx.waitUntil(updateAnonymousTokenUsage(env, clientIP, totalTokens, ctx));
      if (user) {
        ctx.waitUntil(updateUserTokenUsage(env, user.id, totalTokens, ctx));
      }
    }
    if (rateCheck) {
      newResponse.headers.set("X-Ratelimit-Model-Factor", String(getModelFactor(requestModel)));
      updateResponsefromRateCheck(newResponse, rateCheck);
    }
    return newResponse;
  } catch (e) {
    return jsonResponse({
      error: `Failed to connect to server: ${e.message}`
    }, 502);
  }
}
async function getRandomPublicServer(env) {
  const servers = Object.keys(DEFAULT_MODELS);
  const serverId = servers[Math.floor(Math.random() * servers.length)];
  return await getServerById(env, serverId);
}
function base64toBlob(base64Data) {
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return byteArray;
}
function filterMarkdown(text, type, fallback) {
  const codeBlockRegex = /```(?:json|javascript|js)?\s*([\s\S]*?)```/gi;
  const matches = [...text.matchAll(codeBlockRegex)];
  if (matches.length > 0) {
    return matches[0][1].trim();
  }
  return fallback;
}
function updateResponsefromRateCheck(newResponse, rateCheck) {
  newResponse.headers.set("X-Ratelimit-Remaining-Requests", String(rateCheck.maxRequests));
  newResponse.headers.set("X-Ratelimit-Remaining-Tokens", String(rateCheck.maxTokens));
  newResponse.headers.set("X-Ratelimit-Limit-Requests", String(rateCheck.limitRequests));
  newResponse.headers.set("X-Ratelimit-Limit-Tokens", String(rateCheck.limitTokens));
}
async function checkUserRateLimits(env, user, request) {
  const tier = user.tier || "new";
  const limits = USER_TIER_LIMITS[tier] || USER_TIER_LIMITS.new;
  const userId = user.id;
  const now = Date.now();
  const windows = [
    { name: "minute", duration: RATE_LIMITS.windows.minute, tokenLimit: limits.tokens.perMinute, requestLimit: limits.requests.perMinute },
    { name: "hour", duration: RATE_LIMITS.windows.hour, tokenLimit: limits.tokens.perHour, requestLimit: limits.requests.perHour },
    { name: "day", duration: RATE_LIMITS.windows.day, tokenLimit: limits.tokens.perDay, requestLimit: limits.requests.perDay }
  ];
  if (!env.MEMBERS_KV) {
    return { allowed: true };
  }
  let maxTokens = parseInt(request.headers.get("x-ratelimit-remaining-tokens") || "0") || USER_TIER_LIMITS.pro.tokens.perDay;
  let maxRequests = parseInt(request.headers.get("x-ratelimit-remaining-requests") || "0") || USER_TIER_LIMITS.pro.requests.perDay;
  let limitTokens = parseInt(request.headers.get("x-ratelimit-limit-tokens") || "0");
  let limitRequests = parseInt(request.headers.get("x-ratelimit-limit-tokens") || "0");
  for (const window of windows) {
    const key = `rate_limit:${userId}:${window.name}`;
    const stored = await env.MEMBERS_KV.get(key);
    const usage = stored ? JSON.parse(stored) : { tokens: 0, requests: 0, timestamp: now };
    if (now - usage.timestamp > window.duration) {
      usage.tokens = 0;
      usage.requests = 0;
      usage.timestamp = now;
    }
    const tokenLimit = window.tokenLimit - usage.tokens;
    const requestLimit = window.requestLimit - usage.requests;
    if (maxTokens > tokenLimit) {
      maxTokens = tokenLimit;
      limitTokens = window.tokenLimit;
    }
    if (maxRequests > requestLimit) {
      maxRequests = requestLimit;
      limitRequests = window.requestLimit;
    }
    if (requestLimit <= 0) {
      return {
        allowed: false,
        reason: "requests",
        tier,
        window: window.name,
        limit: window.requestLimit,
        used: usage.requests,
        retryAfter: Math.ceil((window.duration - (now - usage.timestamp)) / 1e3),
        maxTokens,
        maxRequests,
        limitTokens,
        limitRequests
      };
    }
    if (usage.tokens >= window.tokenLimit) {
      return {
        allowed: false,
        reason: "tokens",
        tier,
        window: window.name,
        limit: window.tokenLimit,
        used: usage.tokens,
        retryAfter: Math.ceil((window.duration - (now - usage.timestamp)) / 1e3),
        maxTokens,
        maxRequests,
        limitTokens,
        limitRequests
      };
    }
  }
  return { allowed: true, maxTokens, maxRequests, limitTokens, limitRequests };
}
async function checkAnonymousRateLimits(env, request) {
  const clientIP = getClientIP(request);
  const now = Date.now();
  const windows = [
    { name: "minute", duration: RATE_LIMITS.windows.minute, tokenLimit: RATE_LIMITS.tokens.perMinute, requestLimit: RATE_LIMITS.requests.perMinute },
    { name: "hour", duration: RATE_LIMITS.windows.hour, tokenLimit: RATE_LIMITS.tokens.perHour, requestLimit: RATE_LIMITS.requests.perHour },
    { name: "day", duration: RATE_LIMITS.windows.day, tokenLimit: RATE_LIMITS.tokens.perDay, requestLimit: RATE_LIMITS.requests.perDay }
  ];
  if (!env.MEMBERS_KV) {
    return { allowed: true };
  }
  let maxTokens = parseInt(request.headers.get("x-ratelimit-remaining-tokens") || "0") || RATE_LIMITS.tokens.perDay;
  let maxRequests = parseInt(request.headers.get("x-ratelimit-remaining-requests") || "0") || RATE_LIMITS.requests.perDay;
  let limitTokens = parseInt(request.headers.get("x-ratelimit-limit-tokens") || "0");
  let limitRequests = parseInt(request.headers.get("x-ratelimit-limit-tokens") || "0");
  for (const window of windows) {
    const key = `rate_limit_ip:${clientIP}:${window.name}`;
    const stored = await env.MEMBERS_KV.get(key);
    const usage = stored ? JSON.parse(stored) : { tokens: 0, requests: 0, timestamp: now };
    if (now - usage.timestamp > window.duration) {
      usage.tokens = 0;
      usage.requests = 0;
      usage.timestamp = now;
    }
    const tokenLimit = window.tokenLimit - usage.tokens;
    const requestLimit = window.requestLimit - usage.requests;
    if (maxTokens > tokenLimit) {
      maxTokens = tokenLimit;
      limitTokens = window.tokenLimit;
    }
    if (maxRequests > requestLimit) {
      maxRequests = requestLimit;
      limitRequests = window.requestLimit;
    }
    if (usage.requests >= window.requestLimit) {
      return {
        allowed: false,
        reason: "requests",
        window: window.name,
        limit: window.requestLimit,
        used: usage.requests,
        retryAfter: Math.ceil((window.duration - (now - usage.timestamp)) / 1e3),
        maxTokens,
        maxRequests,
        limitTokens,
        limitRequests
      };
    }
    if (usage.tokens >= window.tokenLimit) {
      return {
        allowed: false,
        reason: "tokens",
        window: window.name,
        limit: window.tokenLimit,
        used: usage.tokens,
        retryAfter: Math.ceil((window.duration - (now - usage.timestamp)) / 1e3),
        maxTokens,
        maxRequests,
        limitTokens,
        limitRequests
      };
    }
  }
  return { allowed: true, maxTokens, maxRequests, limitTokens, limitRequests };
}
async function updateUserRateLimit(env, userId, ctx) {
  if (!env.MEMBERS_KV) return;
  const now = Date.now();
  const windows = [
    { name: "minute", duration: RATE_LIMITS.windows.minute },
    { name: "hour", duration: RATE_LIMITS.windows.hour },
    { name: "day", duration: RATE_LIMITS.windows.day }
  ];
  for (const window of windows) {
    const key = `rate_limit:${userId}:${window.name}`;
    const dataStr = await env.MEMBERS_KV.get(key);
    let data;
    if (dataStr) {
      data = JSON.parse(dataStr);
      if (now - data.timestamp >= window.duration) {
        data = { requests: 1, tokens: 0, timestamp: now };
      } else {
        data.requests += 1;
      }
    } else {
      data = { requests: 1, tokens: 0, timestamp: now };
    }
    const elapsed = now - data.timestamp;
    const ttl = Math.max(60, Math.ceil((window.duration - elapsed) / 1e3) + 60);
    await env.MEMBERS_KV.put(key, JSON.stringify(data), { expirationTtl: ttl });
  }
}
async function updateAnonymousRateLimit(env, clientIP, ctx) {
  if (!env.MEMBERS_KV) return;
  const now = Date.now();
  const windows = [
    { name: "minute", duration: RATE_LIMITS.windows.minute },
    { name: "hour", duration: RATE_LIMITS.windows.hour },
    { name: "day", duration: RATE_LIMITS.windows.day }
  ];
  for (const window of windows) {
    const key = `rate_limit_ip:${clientIP}:${window.name}`;
    const dataStr = await env.MEMBERS_KV.get(key);
    let data;
    if (dataStr) {
      data = JSON.parse(dataStr);
      if (now - data.timestamp >= window.duration) {
        data = { requests: 1, tokens: 0, timestamp: now };
      } else {
        data.requests += 1;
      }
    } else {
      data = { requests: 1, tokens: 0, timestamp: now };
    }
    const elapsed = now - data.timestamp;
    const ttl = Math.max(60, Math.ceil((window.duration - elapsed) / 1e3) + 60);
    await env.MEMBERS_KV.put(key, JSON.stringify(data), { expirationTtl: ttl });
  }
}
function getModelFactor(model) {
  if (!model) {
    return 1;
  }
  if (model.includes("opus")) {
    return 5;
  } else if (model.includes("sonnet")) {
    return 3;
  } else if (model.includes("gemini-3-pro") || model.includes("model-router")) {
    return 2;
  }
  return 1;
}
function getModelTokens(model, tokens) {
  return getModelFactor(model) * tokens;
}
async function updateUserTokenUsage(env, userId, tokens, ctx) {
  if (!env.MEMBERS_KV || !tokens) return;
  const now = Date.now();
  const windows = [
    { name: "minute", duration: RATE_LIMITS.windows.minute },
    { name: "hour", duration: RATE_LIMITS.windows.hour },
    { name: "day", duration: RATE_LIMITS.windows.day }
  ];
  for (const window of windows) {
    const key = `rate_limit:${userId}:${window.name}`;
    const dataStr = await env.MEMBERS_KV.get(key);
    let data;
    if (dataStr) {
      data = JSON.parse(dataStr);
      if (now - data.timestamp >= window.duration) {
        data = { requests: data.requests || 0, tokens, timestamp: now };
      } else {
        data.tokens = (data.tokens || 0) + tokens;
      }
    } else {
      data = { requests: 0, tokens, timestamp: now };
    }
    const elapsed = now - data.timestamp;
    const ttl = Math.max(60, Math.ceil((window.duration - elapsed) / 1e3) + 60);
    await env.MEMBERS_KV.put(key, JSON.stringify(data), { expirationTtl: ttl });
  }
}
async function updateAnonymousTokenUsage(env, clientIP, tokens, ctx) {
  if (!env.MEMBERS_KV || !tokens) return;
  const now = Date.now();
  const windows = [
    { name: "minute", duration: RATE_LIMITS.windows.minute },
    { name: "hour", duration: RATE_LIMITS.windows.hour },
    { name: "day", duration: RATE_LIMITS.windows.day }
  ];
  for (const window of windows) {
    const key = `rate_limit_ip:${clientIP}:${window.name}`;
    const dataStr = await env.MEMBERS_KV.get(key);
    let data;
    if (dataStr) {
      data = JSON.parse(dataStr);
      if (now - data.timestamp >= window.duration) {
        data = { requests: data.requests || 0, tokens, timestamp: now };
      } else {
        data.tokens = (data.tokens || 0) + tokens;
      }
    } else {
      data = { requests: 0, tokens, timestamp: now };
    }
    const elapsed = now - data.timestamp;
    const ttl = Math.max(60, Math.ceil((window.duration - elapsed) / 1e3) + 60);
    await env.MEMBERS_KV.put(key, JSON.stringify(data), { expirationTtl: ttl });
  }
}
async function handleV1ChatCompletions(request, env, ctx, pathname, cacheKey, rateCheck) {
  const user = await authenticateRequest(request, env);
  let requestBody;
  try {
    requestBody = await request.clone().json();
  } catch (e) {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const model = requestBody.model;
  if (!model) {
    return jsonResponse({ error: "Model is required" }, 400);
  }
  let privateServers = [];
  if (user && user.custom_servers) {
    privateServers = user.custom_servers.filter((s) => !s.is_public);
  }
  const publicServersIndex = await getPublicServers(env);
  let selectedServer = null;
  for (const server of privateServers) {
    if (server.allowed_models && server.allowed_models.length > 0) {
      if (server.allowed_models.includes(model)) {
        selectedServer = server;
        break;
      }
    }
  }
  if (!selectedServer) {
    for (const serverIndex of publicServersIndex) {
      const owner = await getUser(env, serverIndex.owner_id);
      if (!owner) continue;
      const fullServer = (owner.custom_servers || []).find((s) => s.id === serverIndex.id);
      if (!fullServer || !fullServer.is_public) continue;
      if (fullServer.allowed_models && fullServer.allowed_models.length > 0) {
        if (fullServer.allowed_models.includes(model)) {
          selectedServer = fullServer;
        }
      }
    }
  }
  if (!selectedServer) {
    return jsonResponse({ error: `No server found that supports model '${model}'` }, 404);
  }
  return handleProxyToServer(request, env, ctx, selectedServer, "/chat/completions", cacheKey, user, pathname, null, rateCheck);
}
async function handleV1Models(request, env) {
  const user = await authenticateRequest(request, env);
  let privateServers = [];
  if (user && user.custom_servers) {
    privateServers = user.custom_servers.filter((s) => !s.is_public);
  }
  const publicServersIndex = await getPublicServers(env);
  const allModels = new Object();
  for (const server of privateServers) {
    if (server.allowed_models && server.allowed_models.length > 0) {
      server.allowed_models.forEach((model) => !allModels[model] ? allModels[model] = { id: model, owned_by: server.label, base_url: `/custom/${server.id}` } : null);
    }
  }
  for (const serverIndex of publicServersIndex) {
    if (serverIndex.allowed_models && serverIndex.allowed_models.length > 0) {
      serverIndex.allowed_models.forEach((model) => !allModels[model] ? allModels[model] = { id: model, owned_by: serverIndex.label, base_url: `/custom/${serverIndex.id}` } : null);
    }
  }
  return jsonResponse({
    data: Array.from(Object.values(allModels))
  });
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
function generateCacheKey(request, extra = "") {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const searchParams = url.searchParams.toString();
  const method = request.method;
  return `${method}:${pathname}${searchParams ? "?" + searchParams : ""}${extra ? ":" + extra : ""}`;
}
async function getCachedResponse(request, cacheKey = null) {
  try {
    const key = cacheKey || generateCacheKey(request);
    const cacheRequest = new Request(`https://cache.example/${key}`, {
      method: "GET"
    });
    return await caches.default.match(cacheRequest);
  } catch (e) {
    console.error("Cache read error:", e);
    return null;
  }
}
async function setCachedResponse(request, response, cacheControl, cacheKey = null, ctx = null) {
  if (!response.ok) return;
  try {
    const key = cacheKey || generateCacheKey(request);
    const cacheRequest = new Request(`https://cache.example/${key}`, {
      method: "GET"
    });
    const responseToCache = response.clone();
    responseToCache.headers.set("Cache-Control", cacheControl);
    responseToCache.headers.set("X-Cache", "HIT");
    const cacheOperation = caches.default.put(cacheRequest, responseToCache);
    if (ctx) {
      ctx.waitUntil(cacheOperation);
    } else {
      await cacheOperation;
    }
  } catch (e) {
    console.error("Cache write error:", e);
  }
}
export {
  custom_worker_default as default
};
//# sourceMappingURL=custom-worker.js.map
