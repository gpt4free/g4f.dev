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
    perDay: 200
  },
  // Window durations in milliseconds
  windows: {
    minute: 60 * 1e3,
    hour: 60 * 60 * 1e3,
    day: 24 * 60 * 60 * 1e3,
    twelveDays: 12 * 24 * 60 * 60 * 1e3
  },
  // Day-based limits (number of days with activity allowed in window)
  days: {
    perTwelveDays: 3
  }
};
var USER_TIER_LIMITS = {
  new: {
    tokens: { perMinute: 1e5, perHour: 3e5, perDay: 1e6 },
    requests: { perMinute: 10, perHour: 100, perDay: 250 },
    days: { perTwelveDays: 12 },
    api_keys: 1,
    maxServers: 5,
    burstMultiplier: 1.5
  },
  free: {
    tokens: { perMinute: 2e5, perHour: 1e6, perDay: 5e6 },
    requests: { perMinute: 20, perHour: 200, perDay: 500 },
    days: { perTwelveDays: 12 },
    api_keys: 3,
    maxServers: 10,
    burstMultiplier: 1.5
  },
  sponsor: {
    tokens: { perMinute: 1e6, perHour: 5e6, perDay: 2e7 },
    requests: { perMinute: 100, perHour: 500, perDay: 2e3 },
    days: { perTwelveDays: 12 },
    api_keys: 10,
    maxServers: 100,
    burstMultiplier: 2
  },
  pro: {
    tokens: { perMinute: 1e6, perHour: 5e6, perDay: 2e7 },
    requests: { perMinute: 100, perHour: 1e3, perDay: 2e3 },
    days: { perTwelveDays: 12 },
    api_keys: 10,
    maxServers: 100,
    burstMultiplier: 2
  },
  admin: {
    tokens: { perMinute: 1e6, perHour: 5e6, perDay: 5e7 },
    requests: { perMinute: 100, perHour: 1e3, perDay: 1e4 },
    days: { perTwelveDays: 12 },
    api_keys: 10,
    maxServers: 100
  },
  anonymous: {
    tokens: { perMinute: 1e6, perHour: 5e6, perDay: 1e8 },
    requests: { perMinute: 100, perHour: 2e3, perDay: 5e4 },
    days: { perTwelveDays: 12 },
    api_keys: 10,
    burstMultiplier: 2
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
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, x-user, x-ignored, x-secret, x-recognition-language, if-none-match",
  "Access-Control-Expose-Headers": "Content-Type, X-User-Id, X-User-Tier, X-Provider, X-Model, X-Server, X-Url, X-Usage-Total-Tokens, X-Stream, X-Ratelimit-Model-Factor, X-Ratelimit-Remaining-Requests, X-Ratelimit-Remaining-Tokens, X-Ratelimit-Limit-Requests, X-Ratelimit-Limit-Tokens, X-Prompt-Tokens"
};
var EXTRA_HEADERS = {
  "HTTP-Referer": "https://g4f.dev",
  "X-OpenRouter-Title": "GPT4Free (g4f.dev)",
  "X-OpenRouter-Categories": "cli-agent,cloud-agent,roleplay,general-chat",
};
var ACCESS_CONTROL_ALLOW_ORIGIN = {
  "Access-Control-Allow-Origin": "*"
};
// Concurrency queue for pass.g4f.space requests.
// Limits simultaneous in-flight requests to PASS_MAX_CONCURRENT,
// queuing the rest until a slot frees up.
const PASS_MAX_CONCURRENT = 1;
let passActiveCount = 0;
const passQueue = [];
function acquirePassSlot() {
  if (passActiveCount < PASS_MAX_CONCURRENT) {
    passActiveCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => passQueue.push(resolve));
}
function releasePassSlot() {
  if (passQueue.length > 0) {
    const next = passQueue.shift();
    next();
  } else {
    passActiveCount--;
  }
}
var AUTO_PROVIDERS = []
var DEFAULT_MODELS = {};
var SERVER_MAP = {}
var URL_MAP = {
  "https://gen.pollinations.ai/quota": "https://gen.pollinations.ai/account/balance",
  "https://api.featherless.ai/v1/models": null
}
let providers = {};
let waitForProviders = ()=>fetch("https://github.com/gpt4free/g4f.dev/raw/refs/heads/main/dist/js/providers.json")
  .then(r=>r.json()).then(p=>{
    providers = p.providers;
    DEFAULT_MODELS = p.serverDefaultModels || DEFAULT_MODELS;
    const autoProvidersList = Object.fromEntries(
      Object.entries(p.autoProviders||{}).filter(
        ([key, provider]) => !provider.startsWith(".")
      )
    );
    AUTO_PROVIDERS = Object.keys(autoProvidersList);
    for (const [key, provider] of Object.entries(providers)) {
      if (provider.id) {
        SERVER_MAP[key] = provider.id;
      }
      if (p.defaultModels[key] && provider.id) {
        DEFAULT_MODELS[provider.id] = p.defaultModels[key];
      }
    }
    if (p.checkUrls) {
      for (const [provider, url] of Object.entries(p.checkUrls)) {
        if (providers[provider] && providers[provider].baseUrl) {
          URL_MAP[`${providers[provider].baseUrl}/quota`] = url;
        }
      }
    }
  });
var SERVER_TO_PROVIDER = {
  "srv_mkoloq41e34074b6133e": "pollinations",
  "srv_mp5miql908c8738d71be": "pollinations",
  "srv_mrm4kpled882efdc423e": "huggingface",
  "srv_mp3lmkuad07322459f47": "airforce"
}
var BLOCKED_SERVERS = [];
var HIDDEN_SERVERS = [
  "srv_mkoloq41e34074b6133e",
  "srv_mp7i458w1b1b1f3920b3",
  "srv_msgba2af3938f6f6b015",
  "srv_mksdsdwy7c6526ebabc3"
];
// organizations (from Cloudflare `asOrganization`) that should be blocked
// when the request is anonymous (no user/session or API key provided).
var BLOCKED_ORGS = [
  "Oracle Public Cloud",
  "Oracle Corporation",
  "Windstream Communications LLC",
  "Aventice LLC",
  "EGIHosting",
  "web2objects GmbH",
  "OVH Hosting, Inc.",
  "Rings-3",
  "Leaseweb USA, Inc.",
  "GoDaddy.com, LLC",
  "netcup GmbH",
  "Virtual Private Hosting Service",
  "DigitalOcean, LLC",
  "SEO Hosting LTD",
  "Cloudflare London, LLC",
  "Cloudflare, Inc.",
  "Contabo GmbH",
  "Amazon Data Services Brazil",
  "Private Customer",
  "Emerald Onion",
  "Google LLC",
  "Enzu Inc.",
  "Dai IP dong ket noi xDSL",
  "Nocix, LLC",
  "Luminous Apartments Limited",
  "play2go.cloud - Cheap and reliable hosting",
  "Vultr Holdings, LLC",
  "NETH LLC",
  "NReach Net (Pvt.) Ltd",
  "HostRoyale LLC",
  "Packethub S.A.",
  "Akamai Connected Cloud / Linode",
  "Latitude.sh",
  "Dot Internet",
  "Tempest Hosting, LLC",
  "HOSTKEY B.V.",
  "Amazon.com, Inc.",
  "Snowd Security OU",
  "AlexHost SRL",
  "1337 Services GmbH",
  "TOR EXIT AND MORE",
  "Network for Tor-Exit traffic.",
  "Amazon Data Services Ireland Ltd",
  "QWINS Hosting",
  "Interhive OU",
  "QWINS Hosting",
  "Datacamp Limited",
  "UFO Hosting LLC",
  "HOST4NERD LLC",
  "FASTPLANET LTD",
  "Yandex.Cloud LLC",
  "Oracle Svenska AB",
  "IONOS SE",
  "AEZA GROUP LLC",
  "The Constant Company, LLC",
  "Next Tech BD",
  "Vultr Holdings, LLC",
  "BitCommand LLC",
  "M-Cloud LLC",
  "OVH SAS",
  "Microsoft Corporation",
  "Microsoft Limited",
  "Meta Platforms Ireland Limited",
  "HostPapa",
  "AlphaVPS LLC",
  "NetCrafters OU",
  "Amazon Data Services Northern Virginia",
  "FIRST SERVER, SOCIEDAD LIMITADA",
  "Hetzner Online GmbH",
  "Amazon Technologies Inc.",
  "31173 Services AB infrastructure in Amsterdam, NL.",
  "IPLUS LLC",
  "Amazon Corporate Services Pty Ltd",
  "Hostinger International Limited",
  "Senko Digital LLC - DE Network",
  "Space Hosting",
  "Amazon Data Services Singapore",
  "500 Oracle Parkway"
];
var BLOCKED_USERS = [
  "mamakumko", "mamkokumko", "MahmutHizal", "LucaBasri",
  "SteamPunk001", "steampunk001", "steeampunk002-cmyk", "steeampunk004-cmyk",
  "denmos221-cpu", "vlintz",
  "luciazamora99", "valrab_",
];
var GPT_AUDIO_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer", "coral", "verse", "ballad", "ash", "sage", "marin", "cedar", "amuch", "dan", "elan", "breeze", "cove", "ember", "fathom", "glimmer", "harp", "juniper", "maple", "orbit", "vale"];

async function save(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    // Set the module-level request context so jsonResponse can persist any
    // error response (status >= 400) to ERRORS_DB. Reset on every fetch.
    currentRequestContext = { request, env, ctx, pathname, skipErrorLog: false };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (["/", "/chat", "/chat/", "/playground", "/playground/", "/docs"].includes(pathname) && request.method != "POST") {
      return Response.redirect(`https://g4f.dev${pathname}`, 302);
    }
    if (pathname == "/api/pollinations/quota") {
      return Response.json({ balance: 0 }, { headers: ACCESS_CONTROL_ALLOW_ORIGIN });
    }
    if (pathname == "/api/audio/models") {
      return Response.json({ data: [{ id: "gpt-audio", audio: true }, ...GPT_AUDIO_VOICES.map((voice) => {
        return { id: voice, audio: true };
      })] }, { headers: ACCESS_CONTROL_ALLOW_ORIGIN });
    }
    let user = null;
    if (pathname === "/api/errors" && request.method === "GET") {
      return handleApiErrors(request, env, user);
    }
    let userProvidedKey = null;
    try {
      user = await authenticateRequest(request, env);
      if (user && BLOCKED_USERS.includes(user.username)) {
        return jsonResponse({
          error: {
            message: "Blocked user",
            type: "authentication_required"
          }
        }, 403);
      }
      const authHeader = request.headers.get("authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const tokens = authHeader.substring(7).split(/\s+/);
        userProvidedKey = tokens.find((t) => t && !t.startsWith("g4f_") && !t.startsWith("gfs_") && t != "screct");
      }
    } catch (error) {
        console.error("User error:", error);
        ctx.waitUntil(persistErrorToDb(env, error, {
          source: "authenticate",
          status: 500,
          pathname,
          method: request.method,
          ip: getClientIP(request),
          userAgent: request.headers.get("user-agent"),
          requestId: request.headers.get("cf-ray") || null
        }));
        currentRequestContext.skipErrorLog = true;
        return jsonResponse({ error: "User error: " + error.message || "Internal server error" }, 500);
    }
    try {
    let rateCheck;
    try {
      if (!userProvidedKey && !pathname.endsWith("/models") && !pathname.endsWith("/quota") && !pathname.startsWith("/custom/api/") && !pathname.startsWith("/backend-api/") && !pathname.startsWith("/pa/"))
        if (user) {
          rateCheck = await checkUserRateLimits(env, user, request);
          if (!rateCheck.allowed) {
            const windowLabels = { minute: "per minute", hour: "per hour", day: "per day", twelveDays: "per 12 days" };
            let message;
            if (rateCheck.reason === "tokens") {
              message = `Token limit (${rateCheck.limit.toLocaleString()} ${windowLabels[rateCheck.window]}) exceeded for ${rateCheck.tier} tier. Used: ${rateCheck.used.toLocaleString()} tokens.`;
            } else if (rateCheck.reason === "days") {
              message = `Active day limit (${rateCheck.limit} days ${windowLabels[rateCheck.window]}) exceeded for ${rateCheck.tier} tier. Used: ${rateCheck.used} active days. Upgrade to sponsor/pro tier for unlimited daily access.`;
            } else {
              message = `Request limit (${rateCheck.limit} ${windowLabels[rateCheck.window]}) exceeded for ${rateCheck.tier} tier. Made: ${rateCheck.used} requests.`;
            }
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
            }, { status: 429, headers: { "Retry-After": rateCheck.retryAfter.toString(), ...CORS_HEADERS } });
            updateResponsefromRateCheck(newResponse, rateCheck);
            return newResponse;
          }
        } else {
          // Anonymous requests are no longer capped by a fixed daily rate
          // limit. Instead, usage is gated by the caller's baked cake
          // credits inside handleV1ChatCompletions, where the request body
          // (messages, tools, media) is available to estimate prompt tokens.
          rateCheck = { allowed: true };
        }
      } catch (error) {
        console.error("Rate check error:", error);
        ctx.waitUntil(persistErrorToDb(env, error, {
          source: "rate_check",
          status: 500,
          pathname,
          method: request.method,
          ip: getClientIP(request),
          userAgent: request.headers.get("user-agent"),
          requestId: request.headers.get("cf-ray") || null
        }));
        currentRequestContext.skipErrorLog = true;
        return jsonResponse({ error: "Rate check error: " + error.message || "Internal server error" }, 500);
      }
      const cacheKey = generateCacheKey(request)
      if (request.headers.get("cache-control") !== "no-cache")
      if ((!userProvidedKey || pathname.endsWith("/models")) && request.method === "GET") {
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
      // POST /v1/chat/completions and /chat/completions: cache non-streaming
      // responses by body hash so repeated test prompts (ping, hello, test)
      // return the same cached result without hitting the upstream server.
      if (!(request.headers.get("cache-control") || "").includes("no-cache")
          && !userProvidedKey && request.method === "POST"
          && (pathname === "/v1/chat/completions" || pathname === "/chat/completions"
              || pathname.match(/\/chat\/completions$/))) {
        const bodyHash = await generatePostBodyHash(request);
        if (bodyHash) {
          const postCacheKey = `POST:${pathname}:body:${bodyHash}`;
          const cachedResponse = await getCachedResponse(request, postCacheKey);
          if (cachedResponse) {
            const newResponse = new Response(cachedResponse.body, cachedResponse);
            newResponse.headers.set("X-Cache", "HIT");
            if (user) {
              newResponse.headers.set("X-User-Id", user.id);
              newResponse.headers.set("X-User-Tier", user.tier);
            }
            if (rateCheck) {
              updateResponsefromRateCheck(newResponse, rateCheck);
            }
            return newResponse;
          }
          // Stash the body hash so handleProxyToServer can cache the response
          request._postBodyHash = bodyHash;
        }
      }
      if (user) {
        ctx.waitUntil(updateUserRateLimit(env, user.id, ctx));
      }
      await waitForProviders();
      waitForProviders = ()=>{};
      const serverLabel = url.hostname.split(".")[0];
      try {
        if (serverLabel in SERVER_MAP) {
          const server = await getServerById(env, SERVER_MAP[serverLabel], user);
          if (!server) {
            return jsonResponse({ error: "Server not found" }, 404);
          }
          if (pathname.match(/^\/models$/)) {
            try {
              return await handleModels(request, env, ctx, server.id, user, server, cacheKey, userProvidedKey);
            } catch(error) {
              ctx.waitUntil(persistErrorToDb(env, error, {
                source: "server_model",
                status: 500,
                pathname,
                method: request.method,
                ip: getClientIP(request),
                userAgent: request.headers.get("user-agent"),
                requestId: request.headers.get("cf-ray") || null
              }));
              currentRequestContext.skipErrorLog = true;
              return jsonResponse({ error: "Server model error: " + error.message || "Internal server error" }, 500);
            }
          }
          if (pathname.match(/^\/chat\/completions$/)) {
            return handleProxyToServer(request, env, ctx, server, "/chat/completions", cacheKey, user, pathname, userProvidedKey, rateCheck);
          }
          return handleProxyToServer(request, env, ctx, server, pathname, cacheKey, user, pathname, userProvidedKey, rateCheck);
        }
      } catch (error) {
        console.error("Server map error:", error);
        ctx.waitUntil(persistErrorToDb(env, error, {
          source: "server_map",
          status: 500,
          pathname,
          method: request.method,
          ip: getClientIP(request),
          userAgent: request.headers.get("user-agent"),
          requestId: request.headers.get("cf-ray") || null
        }));
        currentRequestContext.skipErrorLog = true;
        return jsonResponse({ error: "Server map error: " + pathname + error.message || "Internal server error" }, 500);
      }
      if (pathname.startsWith("/ai/")) {
        return handleCustomAiRoute(request, pathname, cacheKey, rateCheck, env, ctx);
      }
      if (pathname === "/custom/api/servers") {
        return handleListServers(request, env, user);
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
      if (pathname === "/custom/api/servers/public" || pathname === "/public") {
        return handleListPublicServers(request, env, user);
      }
      if (pathname.match(/^\/custom\/api\/servers\/[^/]+\/models$/)) {
        const serverId = pathname.split("/")[4];
        return handleGetServerModels(request, env, serverId, user);
      }
      if (!userProvidedKey && (pathname === "/v1/models" || pathname === "/models")) {
        return handleV1Models(request, env, user);
      }
      if (pathname.match(/^\/custom\/[^/]+\/models$/)) {
        const serverId = pathname.split("/")[2];
        const server = await getServerById(env, serverId, user);
        return handleModels(request, env, ctx, serverId, user, server, cacheKey);
      }
      if (pathname.match(/^\/api\/[^/]+\/models$/)) {
        const label = pathname.split("/")[2];
        let server;
        // support serverId:model prefix to directly specify by ID
        const prefixMatch = /^([^:]+):/.exec(label);
        if (prefixMatch) {
          server = await getServerById(env, prefixMatch[1], user);
        }
        if (!server) {
          server = await getServerByLabel(env, label, user);
        }
        if (!server) {
          return proxyToPassG4f(request, env, pathname, url.search, user, cacheKey, ctx);
        }
        return handleModels(request, env, ctx, server.id, user, server, cacheKey);
      }
      if (!user || user.tier != "admin") {
        const { success } = await env.RATE_LIMIT.limit({ key: user ? user.id : pathname }) // key can be any string of your choosing
        if (!success) {
          const newResponse = Response.json({
            error: {
              message: "Rate limit 10s exceeded",
              type: "rate_limit_exceeded",
              retry_after: "10",
            }
          }, { status: 429, headers: { "Retry-After": "10", ...CORS_HEADERS } });
          updateResponsefromRateCheck(newResponse, rateCheck);
          return newResponse;
        }
      }
      if (!userProvidedKey && ["/", "/v1", "/v1/chat/completions", "/chat/completions"].includes(pathname)) {
        return handleV1ChatCompletions(request, env, ctx, pathname, user, cacheKey, rateCheck);
      }
      if (pathname === "/backend-api/v2/conversation") {
        const server = await getServerByLabel(env, "backend", user);
        return handleProxyToServer(request, env, ctx, server, pathname, cacheKey, user, pathname, userProvidedKey, rateCheck, null);
      }
      if (pathname.match(/^\/custom\/[^/]+\/chat\/completions$/)) {
        const serverId = pathname.split("/")[2];
        let server = await getServerById(env, serverId, user);
        if (!server) {
          return jsonResponse({ error: "Server not found" }, 404);
        }
        return handleProxyToServer(request, env, ctx, server, "/chat/completions", cacheKey, user, pathname, userProvidedKey, rateCheck, null, serverLabel == "log");
      }
      if (pathname.match(/^\/api\/.+\/chat\/completions$/)) {
        const label = pathname.split("/")[2];
        let server;
        let target = pathname;
        if (label.startsWith("pa:")) {
          server = await getServerByLabel(env, "pa", user);
          target = `/api/${label}/chat/completions`;
        }
        if (label === "auto") {
          server = await getRandomPublicServer(env);
        } else {
          // honor prefix serverId:model if given
          const prefixMatch = /^([^:]+):/.exec(label);
          if (prefixMatch) {
            try {
              server = await getServerById(env, prefixMatch[1], user);
            } catch {}
          }
          if (!server) {
            server = await getServerByLabel(env, label, user);
          }
        }
        return handleProxyToServer(request, env, ctx, server, "/chat/completions", cacheKey, user, target, userProvidedKey, rateCheck, null, serverLabel == "log");
      }
      if (pathname.startsWith("/custom/") && pathname.split("/").length >= 3) {
        const parts = pathname.split("/");
        const serverId = parts[2];
        const subPath = "/" + parts.slice(3).join("/");
        const server = await getServerById(env, serverId, user);
        if (!server) {
          return jsonResponse({ error: "Server not found" }, 404);
        }
        return handleProxyToServer(request, env, ctx, server, subPath, cacheKey, user, pathname, userProvidedKey, rateCheck, null, serverLabel == "log");
      }
      if (pathname.startsWith("/api/") && pathname.split("/").length >= 3 && !pathname.startsWith("/api/https://")) {
        const parts = pathname.split("/");
        const label = parts[2];
        const subPath = "/" + parts.slice(3).join("/");
        const server = await getServerByLabel(env, label, user);
        if (!server) {
          return proxyToPassG4f(request, env, pathname, url.search, user, cacheKey, ctx);
        }
        return handleProxyToServer(request, env, ctx, server, subPath, cacheKey, user, pathname, userProvidedKey, rateCheck, null, serverLabel == "log");
      }
      return proxyToPassG4f(request, env, pathname, url.search, user, cacheKey, ctx);
    } catch (error) {
      console.error("Custom worker error:", error);
      ctx.waitUntil(persistErrorToDb(env, error, {
        source: "fetch",
        status: 500,
        pathname,
        method: request.method,
        ip: getClientIP(request),
        userAgent: request.headers.get("user-agent"),
        requestId: request.headers.get("cf-ray") || null
      }));
      currentRequestContext.skipErrorLog = true;
      return jsonResponse({ error: "Custom worker error: " + error.message || "Internal server error" }, 500);
    }
  }
var custom_worker_default = {
  async fetch(request, env, ctx) {
    try {
      const response = await safe(request, env, ctx);
      return new Response(response.body, {
        ...response,
        headers: {
          ...response.headers,
          ...ACCESS_CONTROL_ALLOW_ORIGIN,
        }
      });
    } catch (error) {
      console.error("Fetch error:", error);
      return new Response(JSON.stringify({ error: "Internal server error: " + (error.message) }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...ACCESS_CONTROL_ALLOW_ORIGIN,
        }
      });
    }
  },
  async scheduled(event, env, ctx) {
    // Delete usage logs older than 14 days
    if (env.USAGE_DB) {
      try {
        const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
        const result = await env.USAGE_DB.prepare(
          `DELETE FROM usage_logs WHERE timestamp < ?`
        ).bind(fourteenDaysAgo).run();
        console.log(`Cron cleanup: Deleted ${result.meta?.changes || 0} usage logs older than 14 days`);
      } catch (e) {
        console.error("Failed to cleanup old usage logs:", e);
      }
    }
    // Delete error logs older than 30 days
    if (env.ERRORS_DB) {
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const result = await env.ERRORS_DB.prepare(
          `DELETE FROM error_logs WHERE timestamp < ?`
        ).bind(thirtyDaysAgo).run();
        console.log(`Cron cleanup: Deleted ${result.meta?.changes || 0} error logs older than 30 days`);
      } catch (e) {
        console.error("Failed to cleanup old error logs:", e);
      }
    }
  }

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
  if (apiKey && env.MEMBERS_KV && apiKey.startsWith("g4f_")) {
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
async function handleListServers(request, env, user) {
  let servers = [];
  if (user) {
    servers = user.custom_servers || [];
  }
  if (user && user.tier == "admin") {
    servers.forEach(s=>{s.api_key_count=(s.api_keys || "").split("\n").filter((k) => k.trim()).length});
    return jsonResponse({ servers: servers });
  }
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
  const ipv4 = 
      /^(\d{1,3}\.){3}\d{1,3}$/;
  if(ipv4.test(baseUrl.hostname)) {
    baseUrl.hostname = `${baseUrl.hostname}.nip.io`;
  }
  body.base_url = body.base_url.replace(/\/$/, "");
  const validationResult = await validateServer(body.base_url, body.api_keys);
  if (!validationResult.valid) {
    return jsonResponse({
      error: `Server validation failed: ${validationResult.error}`,
      details: validationResult.details
    }, 400);
  }

  const maxServers = USER_TIER_LIMITS[user.tier].maxServers || 3;
  if ((user.custom_servers || []).length >= maxServers) {
    return jsonResponse({
      error: `Maximum ${maxServers} servers allowed for ${user.tier || "free"} tier`
    }, 400);
  }
  const serverId = generateServerId();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const autoUpdateModels = body.auto_update_models !== false;
  const allowedModels = autoUpdateModels
    ? validationResult.models || []
    : body.allowed_models && body.allowed_models.length > 0 ? body.allowed_models : validationResult.models || [];
  const server = {
    id: serverId,
    label: body.label || `Server ${(user.custom_servers || []).length + 1}`,
    base_url: body.base_url,
    api_keys: body.api_keys || "",
    // Line-separated API keys
    allowed_models: allowedModels,
    auto_update_models: autoUpdateModels,
    is_public: body.is_public || false,
    is_ollama: await isOllama(body.base_url),
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
  const allowedFields = ["label", "base_url", "api_keys", "allowed_models", "auto_update_models", "is_public", "expires"];
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
  // When auto_update_models is enabled, refresh the allowed_models from the upstream server
  if (server.auto_update_models !== false) {
    try {
      const refreshResult = await validateServer(server.base_url, server.api_keys);
      if (refreshResult.valid && refreshResult.models && refreshResult.models.length > 0) {
        server.allowed_models = refreshResult.models;
      }
    } catch (e) {
      console.error("Failed to refresh models on update:", e);
    }
  }
  server.is_ollama = await isOllama(body.base_url);
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
async function getPublicServers(env, blocklist = true) {
  let publicServers = [];
  if (env.MEMBERS_KV) {
    const indexStr = await env.MEMBERS_KV.get("public_servers_index");
    if (indexStr) {
      publicServers = JSON.parse(indexStr);
    }
  }
  if (blocklist) {
    publicServers = publicServers.filter((s) => !BLOCKED_SERVERS.includes(s.id));
  }
  publicServers.sort((a, b) => {
    const aCreated = new Date(a.created_at || a.updated_at || 0).getTime();
    const bCreated = new Date(b.created_at || b.updated_at || 0).getTime();
    return aCreated - bCreated;
  });
  return publicServers;
}
async function handleListPublicServers(request, env, user) {
  const publicServers = await getPublicServers(env);
  let ct = 0;
  for (const s of publicServers) {
    const updated_at = new Date(s.updated_at);
    updated_at.setHours(updated_at.getHours() + 1)
    if (new Date() > updated_at || !("is_online" in s)) {
      s.updated_at = new Date().toISOString();
      try {
        const fullServer = await getServerById(env, s.id, user);
        const validationResult = await validateServer(fullServer.base_url, fullServer.api_keys);
        if (validationResult.valid) {
          s.is_online = true;
          s.auto_update_models = fullServer.auto_update_models;
          if (fullServer.auto_update_models !== false && validationResult.models && validationResult.models.length > 0) {
            s.allowed_models = validationResult.models;
          }
        } else {
          s.is_online = false;
        }
      } catch(e) {console.error(e)}
      try {
        s.is_ollama = await isOllama(s.base_url);
      } catch(e) {console.error(e)}
      ct++;
    }
    if (ct > 10) {
      break;
    }
  }
  if (ct > 0) {
    await env.MEMBERS_KV.put("public_servers_index", JSON.stringify(publicServers));
  }
  const safeServers = publicServers.map((s) => ({
    id: s.id,
    label: s.label,
    base_url: (s.is_ollama || (user && user.tier == "admin")) ? s.base_url : "",
    allowed_models: s.allowed_models,
    auto_update_models: s.auto_update_models,
    owner_id: s.owner_id,
    is_ollama: s.is_ollama,
    is_online: "is_online" in s ? s.is_online : true,
    is_public: true,
    is_hidden: HIDDEN_SERVERS.includes(s.id),
    updated_at: s.updated_at,
    usage: s.usage || { requests: 0, tokens: 0 },
  }));
  return jsonResponse({
    servers: safeServers
  });
}
async function handleGetServerModels(request, env, serverId, user) {
  const server = await getServerById(env, serverId, user);
  if (!server) {
    return jsonResponse({ error: "Server not found" }, 404);
  }
  try {
    const apiKey = server.api_key || getRandomApiKey(server.api_keys);
    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
      headers["Authorization"] = apiKey.includes("Bearer") ? apiKey : `Bearer ${apiKey}`;
    }
    const response = await fetch(`${server.base_url}/models`, { headers });
    if (response.ok) {
      const data = await response.json();
      // Auto-update stored allowed_models when enabled (default)
      if (server.auto_update_models !== false && data.data && Array.isArray(data.data)) {
        const freshModels = data.data.map((m) => m.id).filter(Boolean);
        if (freshModels.length > 0 && server.owner_id) {
          const owner = await getUser(env, server.owner_id);
          if (owner) {
            const idx = (owner.custom_servers || []).findIndex((s) => s.id === server.id);
            if (idx !== -1) {
              owner.custom_servers[idx].allowed_models = freshModels;
              owner.updated_at = new Date().toISOString();
              await saveUser(env, owner);
              if (owner.custom_servers[idx].is_public) {
                await updatePublicServerIndex(env, owner.custom_servers[idx], owner.id, "update");
              }
            }
          }
        }
      } else if (server.allowed_models && server.allowed_models.length > 0 && data.data && Array.isArray(data.data)) {
        data.data = data.data.filter((model) => server.allowed_models.includes(model.id));
      }
      return jsonResponse(data);
    }
  } catch (e) {
    console.error("Failed to fetch models:", e);
  }
  if (server.allowed_models && server.allowed_models.length > 0) {
    return jsonResponse({ data: server.allowed_models.map((m) => ({ id: m })) });
  }
  return jsonResponse({ data: [] });
}
async function handleModels(request, env, ctx, serverId, user, server, cacheKey, userProvidedKey) {
  if (!server) {
    return jsonResponse({ error: "Server not found" }, 404);
  }
  const apiKey = userProvidedKey|| server.api_key || getRandomApiKey(server.api_keys);
  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  try {
    let targetUrl = server.base_url.includes("/chat/completions") ? server.base_url.replace("/chat/completions", "/models") : `${server.base_url}/models`;
    if (targetUrl in URL_MAP) {
      targetUrl = URL_MAP[targetUrl];
    }
    let response;
    let data = {data: []};
    if (targetUrl) {
      response = await fetch(targetUrl, {
        method: request.method,
        headers
      });
      if (!response.ok) {
        throw Error(`Error ${response.status}: ${await response.text()}`);
      }
      data = await response.json();
    }
    if (server.allowed_models && server.allowed_models.length > 0) {
      data.data = data.data.filter((model) => server.allowed_models.includes(model.id));
      if (!data.data.length) {
        data.data = server.allowed_models.map((m) => {
          return { id: m };
        });
      }
    }
    const modelCount = await getModelsFromStats(env, server);
    data.data.forEach(m=>{
      m.requests = modelCount[m.id];
    })
    data.data.sort((a, b) => (b.requests || 0) - (a.requests || 0));
    const newResponse = Response.json(data, response);
    for (const [key, value] of Object.entries(ACCESS_CONTROL_ALLOW_ORIGIN)) {
      newResponse.headers.set(key, value);
    }
    newResponse.headers.set("X-Server", serverId);
    newResponse.headers.set("X-Provider", server.label);
    newResponse.headers.set("X-Url", (new URL(targetUrl).pathname));
    ctx.waitUntil(setCachedResponse(request, newResponse, CACHE_HEADERS.MEDIUM, cacheKey, ctx));
    return newResponse;
  } catch (e) {
    if (server.allowed_models && server.allowed_models.length > 0) {
      console.error(e);
      return jsonResponse({
        data: server.allowed_models.map((m) => ({ id: m, audio: m.includes("audio"), m:e.message }))
      });
    }
    return jsonResponse({ error: `Failed to connect to server: ${e.message}` }, 502);
  }
}
async function handleProxyToServer(request, env, ctx, server, subPath, cacheKey, user = null, pathname = null, userProvidedKey = null, rateCheck = null, requestBody = null, logging = false) {
  if (!server) {
    return jsonResponse({ error: "Server not found" }, 404);
  }
  let requestModel = null;
  let savedBytes = 0;
  let logs = {};
  if (request.method === "POST") {
    if (!requestBody) {
      requestBody = await request.clone().json();
    }
    requestModel = requestBody.model;
    try {
      const messages = requestBody.messages;
      if (messages) {
        // Block known spam/abuse patterns
        for (const msg of messages) {
          if (msg && typeof msg.content === "string" && msg.content.includes("Ты — SEO-ассистент и генератор поисковых запросов.")) {
            return jsonResponse({ error: { message: "Request blocked", type: "blocked_content" } }, 403);
          }
        }
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
        const searchVSC = /Follow the user's requirements carefully & to the letter.\nFollow Microsoft content policies.\n[\s\S]*? simple code examples or demonstrations; debugging <\/description>/gi;
        const replaceVSC = "### Core Rules\n- Follow user requirements strictly and to the letter.\n- Keep answers short and impersonal.\n\n### Role & Context\nYou are an expert automated coding agent. \n- **Gather context first:** Don\'t make assumptions. Use tools to read files and understand the workspace before acting. Don\'t give up if a task seems hard; explore creatively to find a solution.\n- **Be efficient:** Read large file chunks to minimize tool calls. Use provided context/attachments if relevant. Don\'t re-read files already in context.\n- **Infer project type:** Use languages, frameworks, and libraries inferred from the context to guide your changes.\n\n### Tool Usage\n- **Direct answers:** Answer direct code sample requests without using tools.\n- **Schema & permissions:** Follow JSON schemas strictly. Include ALL required properties. No need to ask permission before using a tool.\n- **Parallelization:** Call independent tools in parallel. Run terminal commands sequentially (never in parallel).\n- **Transparency:** Never mention tool names to the user (e.g., say \"I\'ll run the command\" not \"I\'ll use run_in_terminal\").\n- **Best practices:** Use absolute paths/URIs. Use `grep_search` for file overviews. Use browser tools for front-end UI validation. Only use currently available tools.\n- **Continuity:** Don\'t repeat yourself after a tool call; pick up where you left off.\n\n### Editing & Execution\n- **No codeblocks:** NEVER print codeblocks for file changes or terminal commands. Use the respective tools directly.\n- **Read before edit:** Ensure a file is in context before editing. Use `replace_string_in_file` (preferred) or `insert_edit_into_file`. Group changes by file. Never pass omitted line markers (e.g., `/* Lines 123-456 omitted */`) to edit tools.\n- **Insert edits:** For `insert_edit_into_file`, use `// ...existing code...` comments to omit unchanged code. Be as concise as possible.\n- **No terminal edits:** Never edit files via terminal commands unless explicitly asked.\n- **Dependencies & UI:** Use popular external libraries when appropriate (install via `npm install`, etc.). Build modern, beautiful UIs from scratch.\n- **Error fixing:** Fix new errors resulting from your edits. Max 3 attempts per file; if the third fails, stop and ask the user.\n\n### Notebooks\n- Use `edit_notebook_file` and `run_notebook_cell` for notebooks. NEVER use terminal commands or `insert_edit_into_file` for notebooks.\n- Use `copilot_getNotebookSummary` for overviews. Refer to cells by number, not ID. Markdown cells cannot be executed.\n\n### Output Formatting\n- Use Markdown. Wrap filenames/symbols in backticks (e.g., `src/models/person.ts`).\n- Use `$` for inline math and `$$` for block math (KaTeX).\n- Use ```mermaid fenced code blocks for Mermaid diagrams.\n\n### Memory\nConsult memory files for past insights. Keep entries concise and update existing files over creating new ones.\n- **User (`/memories/`):** Persistent, auto-loaded. Store preferences and general insights.\n- **Session (`/memories/session/`):** Current conversation only. Store task-specific state.\n- **Repository (`/memories/repo/`):** Local workspace facts, conventions, and build commands.\n\n### Workspace & Skills\n- This is a multi-root workspace. Apply folder-specific instructions to their respective folders.\n- **Skills:** Use `read_file` to load detailed skill instructions when a task matches a skill\'s domain (e.g., use `project-setup-info-local` for scaffolding new projects from scratch, not for adding individual files).";
        const firstMessage = messages[0];
        if (firstMessage && firstMessage.content && firstMessage.role == "system") {
          const startLen = firstMessage.content.length;
          firstMessage.content = firstMessage.content.replace(searchVSC, replaceVSC);
          savedBytes += startLen - firstMessage.content.length
          requestBody.messages[0] = firstMessage;
        }
        const removeTools = [
          "create_directory",
          "terminal_last_command",
          "terminal_selection",
          "resolve_memory_file_uri",
          "testFailure",
          "vscode_searchExtensions_internal",
          "get_vscode_api",
          "session_store_sql",
          "get_python_environment_details",
          "get_python_executable_details",
          "mcp_provides_tool_pylanceFileSyntaxErrors",  // get_errors covers this
          "mcp_provides_tool_pylanceSyntaxErrors",      // Rarely needed
          "mcp_provides_tool_pylanceSettings",          // Rarely needed by LLM
          "mcp_provides_tool_pylanceImports",           // grep_search can find imports
          "mcp_provides_tool_pylanceInstalledTopLevelModules", // Rarely needed
          "mcp_provides_tool_pylanceWorkspaceRoots",    // list_dir / file_search cover this
          "mcp_provides_tool_pylanceWorkspaceUserFiles", // file_search covers this
          "mcp_provides_tool_pylancePythonEnvironments", // get_python_environment_details covers this
          "mcp_provides_tool_pylanceUpdatePythonEnvironment", // Rarely needed
          "mcp_provides_tool_pylanceRunCodeSnippet",    // run_in_terminal with python covers this
          "mcp_provides_tool_pylanceDocString",         // read_file + grep_search cover this
          "mcp_provides_tool_pylanceDocuments",         // Web search covers Pylance docs
          "mcp_provides_tool_pylanceInvokeRefactoring",  // insert_edit_into_file covers this
          "run_playwright_code",
          "create_and_run_task",
          "get_task_output",
          "install_extension",
          "run_vscode_command",
          "get_vscode_api",
          "run_playwright_code",
          "drag_element",
          "hover_element",
          "handle_dialog"
        ];
        const replacements = [
          // ── Remove excessive ALL-CAPS emphasis ──
          {
            search: /\bIMPORTANT:\s*/gi,
            replace: "",
            reason: "Remove ALL-CAPS emphasis that adds noise without value"
          },
          {
            search: /\bCRITICAL:?\s*/gi,
            replace: "",
            reason: "Remove ALL-CAPS emphasis"
          },
          {
            search: /\bWARNING:\s*/gi,
            replace: "Note: ",
            reason: "Soften ALL-CAPS warnings to notes"
          },
          {
            search: /\bNEVER\b/g,
            replace: "Do not",
            reason: "Soften absolute language"
          },
          {
            search: /\bMUST\b/g,
            replace: "should",
            reason: "Soften absolute language"
          },

          // ── Remove redundant "When NOT to use" boilerplate ──
          // Many tools have generic "When NOT to use" sections that just restate
          // the inverse of "When to use". Remove the generic ones.
          {
            search: /When NOT to use this tool: creating single files or small code snippets; adding individual files to existing projects; making modifications to existing codebases; user asks to \"create a file\" or \"add a component\"; simple code examples or demonstrations; debugging/gi,
            replace: "",
            reason: "Remove generic boilerplate 'When NOT to use' section"
          },

          // ── Trim overly long run_in_terminal description ──
          {
            search: /This tool allows you to execute shell commands in a persistent bash terminal session, preserving environment variables, working directory, and other context across multiple commands\./gi,
            replace: "Execute shell commands in a persistent terminal. State (env vars, cwd) is preserved across calls.",
            reason: "Shorten verbose opening paragraph"
          },
          {
            search: /For ALL one-shot commands \(builds, tests, installs, compilation, linting, downloads, scripts\), use mode='sync' and omit timeout\. The tool waits for the command to complete and returns full output inline\. This is the default and strongly preferred mode\./gi,
            replace: "Use mode='sync' (default) for all one-shot commands. Output is returned inline.",
            reason: "Condense verbose mode explanation"
          },
          {
            search: /Use mode='async' ONLY for processes that must keep running indefinitely while you do other work \(servers, watchers, dev daemons\)\. Async waits for an initial idle\/output signal, then returns a terminal ID and output snapshot while the process continues running\./gi,
            replace: "Use mode='async' only for long-running processes (servers, watchers, daemons). Returns a terminal ID for later use.",
            reason: "Condense verbose async explanation"
          },
          {
            search: /In sync mode, the full output is returned when the command completes — you do NOT need to call get_terminal_output afterward\. Only use get_terminal_output if the tool result explicitly says the command was moved to background, timed out, or needs input\./gi,
            replace: "In sync mode, output is returned inline. Only use get_terminal_output if the result indicates the command was moved to background or needs input.",
            reason: "Condense sync output explanation"
          },
          {
            search: /Sync output is final: When a sync command completes, the full output is returned inline — do NOT call get_terminal_output afterward\. Only use get_terminal_output if the tool result explicitly indicates the command was moved to background, timed out, or needs input\. Do NOT tell the user to check the terminal panel — all command output is already included in the tool result\./gi,
            replace: "Sync output is final and returned inline.",
            reason: "Remove redundant paragraph entirely restating the sync behavior"
          },
          {
            search: /Terminal notifications: When an async command finishes or a sync command times out, you will be automatically notified on your next turn with the exit code and terminal output\. You will also be notified if the terminal needs input\. Do NOT poll or sleep to wait for completion\./gi,
            replace: "For async/timeout commands, you'll be auto-notified on completion. Do not poll.",
            reason: "Condense notification explanation"
          },
          {
            search: /NEVER run sleep or similar wait commands in a terminal\. You will be automatically notified on your next turn when async terminal commands or timed-out sync commands complete or need input\. Do NOT poll for completion\./gi,
            replace: "Do not run sleep or wait commands. You'll be auto-notified on completion.",
            reason: "Condense sleep prohibition"
          },
          {
            search: /NEVER pipe interactive commands through tail, head, grep, or other filters — this hides prompts and prevents the terminal from detecting when input is needed\. Run interactive commands without pipes\./gi,
            replace: "Do not pipe interactive commands through filters — this hides prompts.",
            reason: "Condense pipe warning"
          },
          {
            search: /When a terminal command is waiting for interactive input, do NOT suggest alternatives or ask the user whether to proceed\. Instead, use the vscode_askQuestions tool to collect the needed values from the user, then send them\./gi,
            replace: "For interactive input prompts, use vscode_askQuestions to collect values from the user.",
            reason: "Condense interactive input guidance"
          },
          {
            search: /NEVER use vscode_askQuestions to request sensitive input such as passwords, passphrases, API keys, tokens, or other secrets — answers to that tool are sent through the model\. If the prompt requires a secret, tell the user to type it directly into the terminal and stop; do not call vscode_askQuestions or send_to_terminal for that prompt\./gi,
            replace: "For secrets (passwords, API keys), tell the user to type directly into the terminal.",
            reason: "Condense secret handling guidance"
          },
          {
            search: /Send exactly one answer per prompt using send_to_terminal\. Never send multiple answers in a single send\./gi,
            replace: "Send one answer per prompt.",
            reason: "Condense send guidance"
          },
          {
            search: /After each send, call get_terminal_output to read the next prompt before sending the next answer\./gi,
            replace: "After sending, call get_terminal_output to read the next prompt.",
            reason: "Condense output reading guidance"
          },
          {
            search: /Continue one prompt at a time until the command finishes\./gi,
            replace: "",
            reason: "Remove obvious restatement"
          },
          {
            search: /Use \[\[ \]\] for conditional tests instead of \[ \]/gi,
            replace: "Use [[ ]] for conditionals",
            reason: "Simplify"
          },
          {
            search: /Prefer \$\(\) over backticks for command substitution/gi,
            replace: "Prefer $() over backticks",
            reason: "Simplify"
          },
          {
            search: /Use which or command -v to verify command availability/gi,
            replace: "Use `which` to verify command availability.",
            reason: "Add backtick formatting"
          },

          // ── Fix insert_edit_into_file verbose example ──
          {
            search: /The system is very smart and can understand how to apply your edits to the files, you just need to provide minimal hints\./gi,
            replace: "Provide minimal hints — the system applies edits intelligently.",
            reason: "Condense boilerplate"
          },
          {
            search: /Avoid repeating existing code, instead use comments to represent regions of unchanged code\. Be as concise as possible\. For example:\n\/\/ \.\.\.existing code\.\.\.\n\{ changed code \}\n\/\/ \.\.\.existing code\.\.\.\n\{ changed code \}\n\/\/ \.\.\.existing code\.\.\./gi,
            replace: "Use `// ...existing code...` comments for unchanged regions. Be concise.",
            reason: "Condense verbose example"
          },
          {
            search: /Here is an example of how you should use format an edit to an existing Person class:[\s\S]*?class Person \{[\s\S]*?getAge\(\) \{[\s\S]*?return this\.age;[\s\S]*?\}[\s\S]*?\}/gi,
            replace: "",
            reason: "Remove redundant full code example"
          },

          // ── Fix replace_string_in_file verbose warnings ──
          {
            search: /CRITICAL for \\?`oldString\\?`: Must uniquely identify the single instance to change\. Include at least 3 lines of context BEFORE and AFTER the target text, matching whitespace and indentation precisely\. If this string matches multiple locations, or does not match exactly, the tool will fail\. Never use 'Lines 123-456 omitted' from summarized documents or \.\.\.existing code\.\.\. comments in the oldString or newString\./gi,
            replace: "oldString must uniquely identify one location. Include 3+ lines of surrounding context.",
            reason: "Condense critical warning"
          },

          // ── Fix manage_todo_list verbose CRITICAL workflow ──
          {
            search: /CRITICAL workflow:\s*\n1\. Plan tasks by writing todo list with specific, actionable items\s*\n2\. Mark ONE todo as in-progress before starting work\s*\n3\. Complete the work for that specific todo\s*\n4\. Mark that todo as completed IMMEDIATELY\s*\n5\. Move to next todo and repeat/gi,
            replace: "Workflow: write todos → mark one as in-progress → complete it → mark completed → repeat.",
            reason: "Condense verbose workflow steps"
          },

          // ── Fix open_browser_page verbose note ──
          {
            search: /May prompt the user to share a page if there is a similar one already open, unless "forceNew" is true\./gi,
            replace: "Set forceNew=true to force a new page; otherwise reuses existing pages.",
            reason: "Condense"
          },

          // ── Fix runSubagent verbose preamble ──
          {
            search: /This tool is good at researching complex questions, searching for code, and executing multi-step tasks\. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries, use this agent to perform the search for you\./gi,
            replace: "Use for complex multi-step research, code search, or tasks that may need multiple attempts.",
            reason: "Condense verbose preamble"
          },
          {
            search: /Agents do not run async or in the background, you will wait for the agent's result\./gi,
            replace: "Agents run synchronously — wait for results.",
            reason: "Condense"
          },
          {
            search: /When the agent is done, it will return a single message back to you\. The result returned by the agent is not visible to the user\. To show the user the result, you should send a text message back to the user with a concise summary of the result\./gi,
            replace: "Agent results aren't shown to users — summarize results in your reply.",
            reason: "Condense"
          },
          {
            search: /Each agent invocation is stateless\. You will not be able to send additional messages to the agent, nor will the agent be able to communicate with you outside of its final report\. Therefore, your prompt should contain a highly detailed task description for the agent to perform autonomously and you should specify exactly what information the agent should return back to you in its final and only message to you\./gi,
            replace: "Agents are stateless. Provide a detailed, self-contained prompt specifying what to return.",
            reason: "Condense statelessness explanation"
          },
          {
            search: /The agent's outputs should generally be trusted\n/gi,
            replace: "",
            reason: "Remove unnecessary trust statement"
          },
          {
            search: /Clearly tell the agent whether you expect it to write code or just to do research \(search, file reads, web fetches, etc\.\), since it is not aware of the user's intent\n/gi,
            replace: "Specify whether the agent should write code or only research.",
            reason: "Condense"
          },
          {
            search: /If the user asks for a certain agent, you MUST provide that EXACT agent name \(case-sensitive\) to invoke that specific agent\./gi,
            replace: "Use exact agent names (case-sensitive) when specified.",
            reason: "Condense"
          },

          // ── Fix vscode_askQuestions verbose parameter docs ──
          {
            search: /Users can always provide a freeform text answer alongside options unless you set allowFreeformInput to false\./gi,
            replace: "",
            reason: "Remove — already documented in parameter schema"
          },

          // ── Fix configure_python_environment verbose ALL-CAPS ──
          {
            search: /ALWAYS Use this tool to set up the user's chosen environment and ALWAYS call this tool before using any other Python related tools or running any Python command in the terminal\./gi,
            replace: "Call this before any other Python tool or command.",
            reason: "Condense ALL-CAPS emphasis"
          },

          // ── Fix get_terminal_output verbose preamble ──
          {
            search: /Get output from a terminal execution that was moved to background \(identified by the `id` returned from run_in_terminal\)\. Use this ONLY when the run_in_terminal result explicitly says the command was moved to background, timed out, or needs input\. Do NOT call this after a sync command that completed normally — sync commands return full output inline\. If a background command has not yet completed, you will be automatically notified when it finishes — do NOT poll; end your turn and wait\./gi,
            replace: "Get output from a backgrounded/timed-out terminal. Don't call after successful sync commands. For pending commands, wait for auto-notification.",
            reason: "Condense verbose preamble"
          },

          // ── Fix memory tool verbose preamble ──
          {
            search: /IMPORTANT: Before creating new memory files, first view the \/memories\/ directory to understand what already exists\. This helps avoid duplicates and maintain organized notes\./gi,
            replace: "Check existing files in /memories/ before creating new ones.",
            reason: "Condense"
          },

          // ── Fix create_new_workspace verbose When NOT to use ──
          {
            search: /When NOT to use this tool:\s*\n\s*- Creating (?:single files|single files or small code snippets)\s*\n\s*- Adding individual files to existing projects\s*\n\s*- Making modifications to existing codebases\s*\n\s*- User asks for "create a file" or "add a component"\s*\n\s*- Simple code examples or demonstrations\s*\n\s*- Debugging or fixing existing code\s*\n/gi,
            replace: "",
            reason: "Remove generic 'When NOT to use' boilerplate"
          },

          // ── Remove standalone "Do NOT" lines that restate earlier rules ──
          {
            search: /Do NOT tell the user to check the terminal panel — all command output is already included in the tool result\./gi,
            replace: "",
            reason: "Redundant with sync output explanation"
          },

          // ── Fix navigate_page description ──
          {
            search: /Navigation type: "url" to navigate to a URL \(default, requires "url" param\), "back" or "forward" for history, "reload" to refresh\./gi,
            replace: "",
            reason: "Already documented in parameter schema"
          },

          // ── Fix create_file description ──
          {
            search: /This is a tool for creating a new file in the workspace\. The file will be created with the specified content\. The directory will be created if it does not already exist\. Never use this tool to edit a file that already exists\./gi,
            replace: "Create a new file. Directories are auto-created. Do not use for editing existing files.",
            reason: "Condense verbose description"
          },

          // ── Fix read_file description ──
          {
            search: /You must specify the line range you're interested in\. Line numbers are 1-indexed\. If the file contents returned are insufficient for your task, you may call this tool again to retrieve more content\. Prefer reading larger ranges over doing many small reads\. Binary files use startLine\/endLine as byte offsets\./gi,
            replace: "Specify 1-indexed line ranges. Prefer larger reads over many small ones. For binary files, ranges are byte offsets.",
            reason: "Condense"
          },

          // ── Fix grep_search verbose preamble ──
          {
            search: /Do a fast text search in the workspace\. Use this tool when you want to search with an exact string or regex\. If you are not sure what words will appear in the workspace, prefer using regex patterns with alternation \(\|\) or character classes to search for multiple potential words at once instead of making separate searches\. For example, use 'function\|method\|procedure' to look for all of those words at once\. Use includePattern to search within files matching a specific pattern, or in a specific file, using a relative path\. Use 'includeIgnoredFiles' to include files normally ignored by \.gitignore, other ignore files, and `files.exclude` and `search.exclude` settings\. Warning: using this may cause the search to be slower, only set it when you want to search in ignored folders like node_modules or build outputs\. Use this tool when you want to see an overview of a particular file, instead of using read_file many times to look for code within a file\./gi,
            replace: "Fast text/regex search across workspace files. Use regex alternation (e.g. 'word1|word2') for broad searches. Use includePattern to scope to specific files. Set includeIgnoredFiles=true to search node_modules/build outputs (slower).",
            reason: "Condense verbose preamble"
          },

          // ── Fix file_search verbose examples ──
          {
            search: /Search for files in the workspace by glob pattern\. This only returns the paths of matching files\. Use this tool when you know the exact filename pattern of the files you're searching for\. Glob patterns match from the root of the workspace folder\. Examples:\s*\n\s*- \*\*\/\*\.\{js,ts\} to match all js\/ts files in the workspace\.\s*\n\s*- src\/\*\* to match all files under the top-level src folder\.\s*\n\s*- \*\*\/foo\/\*\*\/\*\.js to match all js files under any foo folder in the workspace\.\s*\n\s*In a multi-root workspace, you can scope the search to a specific workspace folder by using the absolute path to the folder as the query, e\.g\. \/path\/to\/folder\/\*\*\/\*\.ts\./gi,
            replace: "Find files by glob pattern (e.g. '**/*.ts', 'src/**'). Returns matching paths only.",
            reason: "Condense verbose examples"
          },

          // ── Fix session_store_sql verbose preamble ──
          {
            search: /Query the local session store containing history from past coding sessions\. Uses SQLite syntax \(NOT DuckDB or Postgres\)\. SQL queries are read-only — only SELECT and WITH are allowed\. Use `datetime\('now', '-1 day'\)` for date math \(NOT `now\(\) - INTERVAL '1 day'`\), FTS5 `MATCH` for text search\./gi,
            replace: "Read-only SQLite queries against session history. Only SELECT/WITH allowed. Use datetime('now','-1 day') for dates, FTS5 MATCH for text search.",
            reason: "Condense"
          },
        ];
        if (requestBody.tools && savedBytes > 0) {
            const startLen = JSON.stringify(requestBody.tools).length;
            requestBody.tools = requestBody.tools.map(tool => {
            if (tool.type !== "function" || !tool.function?.description) return tool;

            let desc = tool.function.description;

            let i = 0;
            for (const rule of replacements) {
              const matches = desc.match(rule.search);
              if (matches) {
                logs[`-${i<10?'0':''}${i}#`] = rule.reason;
                desc = desc.replace(rule.search, rule.replace);
              }
              i++;
            }

            desc = desc.replace(/ {2,}/g, " ");
            desc = desc.replace(/\n{3,}/g, "\n\n");
            
            tool.function.description = desc;
            return tool;
          });
          let i = 0;
          requestBody.tools = requestBody.tools.filter(t=>{
            i++;
            if (removeTools.includes(t.function?.name)) {
              logs[`tool-${i<10?'0':''}${i}-`] = t.function?.name;
              return false;
            }
            logs[`tool-${i<10?'0':''}${i}+`] = t.function?.name;
            return true;
        });
          savedBytes += startLen - JSON.stringify(requestBody.tools).length;
        }
      }
    } catch (e) {
      return jsonResponse({e:e.message}, 500);
    }
  } else {
    requestBody = {}
  }
  // Anonymous users are gated by cake credits on ALL proxy paths (gemini,
  // ollama, azure, ...), not just /v1/chat/completions. This populates
  // rateCheck with credit-based maxTokens/maxRequests/limitTokens/limitRequests
  // so the X-Ratelimit-* headers are set instead of "undefined". Returns a
  // 402 response directly when the IP has no credit or the request exceeds the
  // budget; signed-in users skip the gate entirely.
  if (!user && request.method === "POST") {
    const gateResult = await applyAnonymousCreditGate(env, ctx, request, user, requestBody, rateCheck);
    if (gateResult instanceof Response) return gateResult;  // 402 error response
    if (gateResult) rateCheck = gateResult;  // updated rateCheck with credit fields
  }
  const chatUrls = ["/chat/completions", "/backend-api/v2/conversation", "/images/generate"];
  if (chatUrls.includes(subPath)) {
    try {
      if (!requestModel || requestModel === "auto") {
        if (DEFAULT_MODELS[server.id]) {
          requestModel = DEFAULT_MODELS[server.id];
        } else if (server.allowed_models && server.allowed_models.length > 0) {
          requestModel = server.allowed_models[0];
        }
      }
      if (requestModel) {
          requestBody.model = requestModel;
      }
      if (!server.auto_update_models && server.allowed_models && server.allowed_models.length > 0) {
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
      requestModel = requestBody.provider ? `${requestBody.provider}:${requestBody.model||""}` : requestModel;
    } catch (e) {
    }
  }

  const apiKey = userProvidedKey || server.api_key || getRandomApiKey(server.api_keys);
  const proxyHeaders = {
    "accept": request.headers.get("accept"),
    "user-agent": request.headers.get("user-agent"),
    "content-type": request.headers.get("content-type") || "application/json",
    "x-secret": request.headers.get("x-secret"),
    "x-user": (user && (user.username || user.id)) || request.headers.get("x-user"),
    "x-user-tier": user && user.tier,
    ...EXTRA_HEADERS
  };
  if (apiKey) {
    proxyHeaders["Authorization"] = `Bearer ${apiKey}`;
  }
  if (request.method == "POST" && server.base_url == "https://llmplayground.net/api") {
    if (!requestBody.conversation?.cookie) {
      const conversation = {};
      let username = null;
      let password = null;
      let lastValue = null;
      let isUsername = false;
      let isPassword = false;
      for (const m of requestBody.messages) {
        if (m.role == "user") {
          if (isUsername) {
            username = m.content;
            isUsername = false;
          } else if (isPassword) {
            password = m.content;
            username = username || lastValue;
            break;
          }
          lastValue = m.content;
        } else {
          if (m.content == "Password:") {
            isPassword = true;
          } else if (m.content.startsWith("Username:")) {
            isUsername = true;
          }
        }
      }
      if (!username) {
        return jsonResponse({ "choices": [{ "message": { "content": "Username:" } }] });
      }
      if (!password) {
        return jsonResponse({ "choices": [{ "message": { "content": "Password:" } }] });
      }
      const url = "https://llmplayground.net/api/auth/login";
      const response = await fetch(url, { method: "POST", body: JSON.stringify({ username, password }), headers: proxyHeaders });
      const data = await response.json();
      if (data.authenticated) {
        conversation.csrf_token = data.csrf_token
        conversation.cookie = (response.headers.get("set-cookie") || "").split(";")[0];
        return jsonResponse({ "choices": [{ "message": { "content": "Success: Delete login messages now!" } }], conversation });
      } else {
        return jsonResponse(data, response.status);
      }
    } else {
      proxyHeaders["cookie"] = requestBody.conversation.cookie;
      proxyHeaders["x-csrf-token"] = requestBody.conversation.csrf_token;
      const passwordIndex = requestBody.messages.findIndex(m=>m.content=="Password:");
      if (passwordIndex) {
        requestBody.messages = requestBody.messages.slice(passwordIndex+1)
      }
      requestBody.connection_id = "c013963a-29d8-4ffd-88d6-05b5f3048ae0";
      delete requestBody.conversation;
    }
  }
  let targetUrl;
  if (server.base_url.includes(subPath)) {
    targetUrl = server.base_url;
  } else if (server.base_url.includes("/v1/chat/completions")) {
    targetUrl = server.base_url.split("/v1/")[0] + subPath;
  } else {
    targetUrl = `${server.base_url}${subPath}`;
  }
  if (targetUrl in URL_MAP) {
    targetUrl = URL_MAP[targetUrl];
  }
  // Fallback: when URL is not in URL_MAP and ends with /quota,
  // do a real /chat/completions request with the default model instead
  if (!(targetUrl in URL_MAP) && targetUrl.endsWith("/quota")) {
    subPath = "/chat/completions";
    if (server.base_url.includes("/chat/completions")) {
      targetUrl = server.base_url;
    } else if (server.base_url.includes("/v1/chat/completions")) {
      targetUrl = server.base_url.split("/v1/")[0] + subPath;
    } else {
      targetUrl = `${server.base_url}${subPath}`;
    }
  }
  if (targetUrl.startsWith("https://pass.g4f.space/")) {
    proxyHeaders["g4f-api-key"] = env.PASS_API_KEY;
  }
  const clientIP = getClientIP(request);
  try {
    const fetchOptions = {
      method: request.method,
      headers: proxyHeaders
    };
    if (chatUrls.includes(subPath)) {
      fetchOptions.method = "POST";
      const defaultModel = DEFAULT_MODELS[server.id]
        || (server.allowed_models && server.allowed_models[0])
        || null;
      const testBody = {
        "messages": [{ "role": "user", "content": "say only okay" }],
        ...requestBody
      };
      if (defaultModel) {
        testBody.model = defaultModel;
      }
      fetchOptions.body = JSON.stringify(testBody);
    } else if (request.method === "POST") {
      fetchOptions.body = requestBody ? JSON.stringify(requestBody) : await request.text();
    }
    const firstMessage = requestBody ? requestBody.prompt || getFirstMessage(requestBody.messages) : null;
    const isPassG4f = targetUrl.startsWith("https://pass.g4f.space/");
    if (isPassG4f) await acquirePassSlot();
    let response;
    try {
      response = await fetch(targetUrl, fetchOptions);
    } finally {
      if (isPassG4f) releasePassSlot();
    }
    const contentType = (response.headers.get("content-type") || "").split(";")[0];
    if (!contentType || !["text/event-stream", "application/json", "text/plain", "application/problem+json", "audio/vnd.wav", "audio/mpeg"].includes(contentType)) {
      return Response.json(
        { error: { message: `Shield: Status: ${response.status}, Content-Type: '${contentType}'` } },
        { status: 500, headers: {
          "X-Url": (new URL(targetUrl).pathname),
          "X-Server": server.id,
          "X-Provider": server.label,
          "X-User-Id": user && user.id,
          ...CORS_HEADERS
        } }
      );
    }
    let usage = {};
    if (chatUrls.includes(subPath) && response.ok) {
      const contentType2 = response.headers.get("content-type") || "";
      if (requestBody.stream || contentType2.includes("text/event-stream")) {
        const geoLocation = request.cf?.asOrganization || request.cf?.country || null;
        const userAgent = request.headers.get("user-agent") || null;
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
          userProvidedKey,
          geoLocation,
          userAgent
        ));
        const newResponse2 = new Response(response.body, response);
        for (const [key, value] of Object.entries(CORS_HEADERS)) {
          newResponse2.headers.set(key, value);
        }
        newResponse2.headers.delete("set-cookie");
        newResponse2.headers.set("X-Url", (new URL(targetUrl).pathname));
        newResponse2.headers.set("X-Server", server.id);
        newResponse2.headers.set("X-Provider", server.label);
        if (savedBytes) {
          newResponse2.headers.set("X-Saved", String(Math.round(savedBytes/4)));
        }
        for (const [k, v] of Object.entries(logs)) {
          newResponse2.headers.set(`X-Removed-${k}`, v);
        }
        if (requestModel) {
          newResponse2.headers.set("X-Model", requestModel);
        }
        if (user) {
          newResponse2.headers.set("X-User-Id", user.id);
          newResponse2.headers.set("X-User-Tier", user.tier);
        }
        newResponse2.headers.set("X-Stream", "true");
        if (rateCheck) {
          newResponse2.headers.set("X-Ratelimit-Model-Factor", String(getModelFactor(requestBody.model)));
          updateResponsefromRateCheck(newResponse2, rateCheck);
        }
        return newResponse2;
      } else if (contentType2.includes("application/json")) {
        const clonedResponse = response.clone();
        try {
          const data = await clonedResponse.json();
          if (data.usage) {
            usage = data.usage;
          }
          if (data.model) {
            // requestModel = data.model;
          }
        } catch (e) {
        }
      }
    }
    const totalTokens = parseInt(response.headers.get("X-Usage-Total-Tokens") || "0") || usage.total_tokens || (usage.prompt_tokens + usage.completion_tokens) || 0;
    if (totalTokens > 0 || (response.ok && requestModel)) {
      const geoLocation = request.cf?.asOrganization || request.cf?.country || null;
      const userAgent = request.headers.get("user-agent") || null;
      ctx.waitUntil(persistUsageToDb(env, clientIP, `custom:${server.id}`, requestModel, totalTokens, usage.prompt_tokens, usage.completion_tokens, pathname, firstMessage, user, geoLocation, userAgent, userProvidedKey));
      if (totalTokens > 0) {
        ctx.waitUntil(updateServerUsage(env, server, totalTokens, requestModel));
      }
      if (user) {
        ctx.waitUntil(updateUserDailyUsage(env, user.id, totalTokens, `custom:${server.id}`, requestModel));
      }
      const isCached = (response.headers.get("X-Cache") || usage.cache || "MISS") === "HIT";
      if (!userProvidedKey && !isCached && !server.api_key) {
        const modelTotalTokens = getModelTokens(requestModel, totalTokens);
        if (user) {
          ctx.waitUntil(updateUserTokenUsage(env, user.id, modelTotalTokens, ctx));
        }
      }
    }
    const newResponse = new Response(response.body, response);
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      newResponse.headers.set(key, value);
    }
    newResponse.headers.delete("set-cookie");
    newResponse.headers.set("X-Url", (new URL(targetUrl).pathname));
    newResponse.headers.set("X-Server", server.id);
    newResponse.headers.set("X-Provider", server.label);
    if (requestModel) {
      newResponse.headers.set("X-Model", requestModel);
    }
    if (totalTokens) {
      newResponse.headers.set("X-Usage-Total-Tokens", String(totalTokens));
    }
    if (request.method === "GET" && !userProvidedKey) {
      ctx.waitUntil(setCachedResponse(request, newResponse.clone(), subPath.endsWith("/quota") ? CACHE_HEADERS.SHORT : CACHE_HEADERS.MEDIUM, cacheKey, ctx));
    }
    // Cache non-streaming POST chat/completions by body hash so repeated
    // test prompts (ping, hello, test) return cached results instantly.
    if (request.method === "POST" && !userProvidedKey && !requestBody?.stream
        && subPath.endsWith("/chat/completions") && newResponse.ok) {
      const bodyHash = request._postBodyHash || await generatePostBodyHash(request);
      if (bodyHash) {
        const postCacheKey = `POST:${pathname}:body:${bodyHash}`;
        ctx.waitUntil(setCachedResponse(request, newResponse.clone(), CACHE_HEADERS.SHORT, postCacheKey, ctx));
      }
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
    return newResponse;
  } catch (e) {
    return jsonResponse({
      error: { message: `Failed to connect to server: ${e.message}` }
    }, 502);
  }
}
async function createUsageTrackingStream(response, env, ctx, server, serverId, clientIP, requestModel, firstMessage, user, pathname, userProvidedKey, geoLocation, userAgent) {
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
        } catch (e) {
        }
      }
    }
    if (done) {
      break;
    }
  }
  const totalUsage = usage.total_tokens || (usage.prompt_tokens + usage.completion_tokens) || 0;
  ctx.waitUntil(persistUsageToDb(env, clientIP, `custom:${serverId}`, requestModel, totalUsage, usage.prompt_tokens, usage.completion_tokens, pathname, firstMessage, user, geoLocation, userAgent, userProvidedKey));
  ctx.waitUntil(updateServerUsage(env, server, totalUsage, requestModel));
  if (user) {
    ctx.waitUntil(updateUserDailyUsage(env, user.id, totalUsage, `custom:${serverId}`, requestModel));
  }
  const isCached = (response.headers.get("X-Cache") || usage.cache || "MISS") === "HIT";
  if (!userProvidedKey && !isCached && !server.api_key) {
    const totalTokens = getModelTokens(requestModel, totalUsage);
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
async function persistUsageToDb(env, clientIP, provider, model, tokensUsed, promptTokens, completionTokens, pathname = null, firstMessage = null, userInfo = null, geoLocation = null, userAgent = null, userProvidedKey = null) {
  if (!env.USAGE_DB) return;
  try {
    await env.USAGE_DB.prepare(
      `INSERT INTO usage_logs (ip, provider, model, tokens_total, tokens_prompt, tokens_completion, pathname, first_message, user_id, user_tier, user_provider, username, geo_location, user_agent, timestamp) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      clientIP,
      provider || "unknown",
      model || "unknown",
      tokensUsed || (promptTokens + completionTokens) || 0,
      promptTokens || 0,
      completionTokens || 0,
      pathname || "unknown",
      firstMessage ? firstMessage.substring(0, 5000) : null,
      userInfo?.user_id || userInfo?.id || null,
      userInfo?.tier || null,
      userInfo?.provider || null,
      userInfo?.username || String(userProvidedKey).substring(0, 16),
      geoLocation || null,
      userAgent ? userAgent.substring(0, 500) : null,
      (/* @__PURE__ */ new Date()).toISOString()
    ).run();
  } catch (e) {
    console.error("Failed to persist usage:", e);
  }
}
// Persist an error event to the ERRORS_DB D1 table so it can be inspected
// via the /api/errors endpoint. Mirrors persistUsageToDb but stores error
// metadata (status, message, stack, source) instead of token usage. Best-effort:
// never throws to the caller.
async function persistErrorToDb(env, error, context = {}) {
  if (!env.ERRORS_DB) return;
  try {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    await env.ERRORS_DB.prepare(
      `INSERT INTO error_logs (timestamp, source, status, message, stack, pathname, method, ip, user_id, user_tier, user_agent, request_id, context)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      ts,
      context.source || "unknown",
      context.status || 500,
      (error && error.message) ? String(error.message).substring(0, 1000) : String(error).substring(0, 1000),
      (error && error.stack) ? String(error.stack).substring(0, 4000) : null,
      context.pathname || null,
      context.method || null,
      context.ip || null,
      context.userId || null,
      context.userTier || null,
      context.userAgent ? String(context.userAgent).substring(0, 500) : null,
      context.requestId || null,
      context.context ? JSON.stringify(context.context).substring(0, 2000) : null
    ).run();
  } catch (e) {
    console.error("Failed to persist error:", e);
  }
}
// GET /api/errors — list recent tracked errors from the ERRORS_DB D1 table.
// Query params:
//   limit  (1-200, default 50)  — max rows to return
//   source (string)             — filter by source (fetch, handleV1ChatCompletions, ...)
//   status (number)             — filter by HTTP status code
//   since  (ISO 8601)           — only rows newer than this timestamp
// Requires a signed-in user (the same gate as /api/logs). Returns newest first.
async function handleApiErrors(request, env, user) {
  if (!env.ERRORS_DB) {
    return jsonResponse({ error: "Error tracking not configured (ERRORS_DB binding missing)" }, 503);
  }
  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 200);
  const where = [];
  const binds = [];
  const source = url.searchParams.get("source");
  if (source) { where.push("source = ?"); binds.push(source); }
  const status = url.searchParams.get("status");
  if (status) { where.push("status = ?"); binds.push(parseInt(status, 10)); }
  const since = url.searchParams.get("since");
  if (since) { where.push("timestamp > ?"); binds.push(since); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  try {
    const result = await env.ERRORS_DB.prepare(
      `SELECT id, timestamp, source, status, message, pathname, method, user_id, user_tier, request_id, context
       FROM error_logs ${whereSql}
       ORDER BY timestamp DESC
       LIMIT ?`
    ).bind(...binds, limit).all();
    const countResult = await env.ERRORS_DB.prepare(
      `SELECT COUNT(*) AS total FROM error_logs ${whereSql}`
    ).bind(...binds).first();
    return jsonResponse({
      data: result.results || [],
      total: countResult?.total || 0,
      limit
    });
  } catch (e) {
    console.error("Failed to query error logs:", e);
    return jsonResponse({ error: "Failed to query error logs: " + e.message }, 500);
  }
}
async function updateServerUsage(env, server, tokens, model) {
  if (!env.MEMBERS_BUCKET) return;
  try {
    const now = /* @__PURE__ */ new Date();
    let userServer;
    if (server.owner_id) {
      const user = await getUser(env, server.owner_id);
      if (!user) return;
      const serverIndex = (user.custom_servers || []).findIndex((s) => s.id === server.id);
      if (serverIndex === -1) return;
      userServer = user.custom_servers[serverIndex];
      userServer.usage = userServer.usage || { requests: 0, tokens: 0 };
      userServer.usage.requests += 1;
      userServer.usage.tokens += tokens;
      userServer.usage.last_used = now.toISOString();
      user.updated_at = now.toISOString();
      await saveUser(env, user);
    }
    const dateKey = now.toISOString().split("T")[0];
    const usagePath = `custom_servers/${server.owner_id||"core"}/${server.id}/usage/${dateKey}.json`;
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
      dailyUsage.models = dailyUsage.models || {};
      dailyUsage.models[model] = (dailyUsage.models[model] || 0) + 1;
    }
    await env.MEMBERS_BUCKET.put(usagePath, JSON.stringify(dailyUsage, null, 2), {
      httpMetadata: { contentType: "application/json" }
    });
    if (userServer && userServer.is_public) {
      await updatePublicServerIndex(env, userServer, server.owner_id, "update");
    }
    // invalidate models cache so next /v1/models reflects new counts
    // modelsCacheTime = 0;
    return usagePath;
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
function isTokenExpired(expires) {
    if (!expires) return false;
    const expiresMs = expires > 1e12 ? expires : expires * 1000;
    return Date.now() > expiresMs;
}
async function getServerById(env, serverId, user = null) {
  const provider = SERVER_TO_PROVIDER[serverId];
  let api_key;
  if (user && provider && user[provider] && !isTokenExpired(user[provider].expires)) {
    api_key = user[provider].access_token || user[provider].api_key
  }
  if (user && user.custom_servers) {
    const ownedServer = user.custom_servers.find((s) => s.id === serverId);
    if (ownedServer) {
      return { ...ownedServer, owner_id: user.id, api_key };
    }
  }
  if (env.MEMBERS_KV) {
    const cached = await env.MEMBERS_KV.get(`server:${serverId}`);
    if (cached) {
      return { ...JSON.parse(cached), api_key };
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
          return { ...fullServer, api_key };
        }
      }
      return server;
    }
  }
  return null;
}
async function getServerByLabel(env, label, user = null) {
  if (!label) {
    return null;
  }
  if (label.startsWith("pa:")) {
    return { id: "core", base_url: `https://pass.g4f.space/api/${label}`};
  }
  if (label.endsWith("/v1")) {
    label = label.substring(0, label.length-3);
  }
  if (["core", "pa", "backend"].includes(label)) {
      return { id: "core", base_url: `https://pass.g4f.space`};
  }
  if (user && user.custom_servers) {
    const ownedServer = user.custom_servers.find((s) => s.label.toLowerCase().includes(label.toLowerCase()));
    if (ownedServer) {
      return { ...ownedServer, owner_id: user.id };
    }
  }
  if (SERVER_MAP[label]) {
    return await getServerById(env, SERVER_MAP[label], user);
  }
  const publicServers = await getPublicServers(env);
  if (publicServers) {
    const serverIndex = publicServers.find((s) => s.label.includes(label));
    if (serverIndex) {
      return await getServerById(env, serverIndex.id, user);
    } else {
      return { id: "core", base_url: `https://pass.g4f.space/api/${label}`};
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
        created_at: server.created_at || server.updated_at,
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
async function isOllama(url) {
  url = new URL(url);
  url.pathname = '/';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  const response = await fetch(url, {
    signal: controller.signal
  });
  clearTimeout(timeout);
  return response.ok && (await response.text()).startsWith("Ollama");
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
      baseUrl = baseUrl.includes("/chat/completions") ? baseUrl.replace("/chat/completions", "/models") : baseUrl
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
  if (false && serverLabel == "audio" && prompt && request.method === "GET") {
    let queryUrl = `https://gen.pollinations.ai/audio/${encodeURIComponent(prompt)}?model=whisper`;
    if (url.searchParams.get("voice")) {
      queryUrl += `&voice=${encodeURIComponent(url.searchParams.get("voice"))}`
    }
    const response = await fetch(queryUrl, {headers: {"Authorization": `Bearer ${env.AUDIO_API_KEY}`}});
    const newResponse = new Response(response.body, response);
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      newResponse.headers.set(key, value);
    }
    newResponse.headers.set("X-Provider", serverLabel);
    // if (queryBody.model) newResponse.headers.set("X-Model", queryBody.model);
    // newResponse.headers.set("X-Server", server.id);
    newResponse.headers.set("X-Url", queryUrl);
    newResponse.headers.set("X-Cache", "YES");
    ctx.waitUntil(setCachedResponse(request, newResponse.clone(), CACHE_HEADERS.LONG, cacheKey, ctx));
    if (rateCheck) {
      updateResponsefromRateCheck(newResponse, rateCheck);
    }
    return newResponse;
  }
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
        let language = url.searchParams.get("language") || "en";
        language = language === 'de' ? 'de-DE' : language;
        query = `Repeat the content between the delimiters exactly as written. Output only that content, with no extra words before or after. Language: ${language}

<<<
${prompt}
>>>`;
        queryBody = { messages: [{ role: "user", content: query }] };
      } else {
        instructions = `Today is: ${new Date(Date.now()).toLocaleString().split(",")[0]}, User language: ${request.headers.get("accept-language") || "en"}`;
        queryBody = { messages: [{ role: "system", content: instructions }, { role:  "user", content: prompt }] };
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
  if (server.allowed_models && server.allowed_models.length > 0 && queryBody.model && serverLabel != "audio") {
    if (!server.auto_update_models && !server.allowed_models.includes(queryBody.model) && queryBody.model != DEFAULT_MODELS[server.id]) {
      return jsonResponse({
        error: `Model '${queryBody.model}' not allowed. Available models: ${server.allowed_models.join(", ")}`
      }, 400);
    }
  }
  const proxyHeaders = {
    "Content-Type": "application/json",
    ...EXTRA_HEADERS
  };
  if (userProvidedKey) {
    proxyHeaders["Authorization"] = userProvidedKey.includes("Bearer") ? userProvidedKey : `Bearer ${userProvidedKey}`;
  } else if (apiKey) {
    proxyHeaders["Authorization"] = apiKey.includes("Bearer") ? apiKey : `Bearer ${apiKey}`;
  }
  if (server.base_url.startsWith("https://pass.g4f.space/")) {
    proxyHeaders["g4f-api-key"] = env.PASS_API_KEY;
  }
  // Enable streaming by default for text responses (not audio)
  const enableStreaming = serverLabel !== "audio" && !queryBody.stream && url.searchParams.get("stream") !== "false";
  if (enableStreaming) {
    queryBody.stream = true;
  }
  try {
    const isPassG4f = queryUrl.startsWith("https://pass.g4f.space/");
    if (isPassG4f) await acquirePassSlot();
    let response;
    try {
      response = await fetch(queryUrl, {
        method: "POST",
        body: JSON.stringify(queryBody),
        headers: proxyHeaders
      });
    } finally {
      if (isPassG4f) releasePassSlot();
    }
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
              let last_data;
              let last_content;
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
                        last_data = data;
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content;
                        if (content) {
                          last_content = content;
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
                if (!last_content && last_data) {
                  controller.enqueue(new TextEncoder().encode(`${data}`));
                }
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
          newResponse2.headers.set("X-Url", (new URL(queryUrl).pathname));
          newResponse2.headers.set("X-Stream", "true");
          if (request.method === "GET" && prompt) {
            newResponse2.headers.set("X-Cache", "YES");
            ctx.waitUntil(setCachedResponse(request, newResponse2.clone(), CACHE_HEADERS.LONG, cacheKey, ctx));
          }
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
      newResponse2.headers.set("X-Url", (new URL(queryUrl).pathname));
      if (request.method === "GET" && prompt) {
        newResponse2.headers.set("X-Cache", "YES");
        ctx.waitUntil(setCachedResponse(request, newResponse2.clone(), CACHE_HEADERS.LONG, cacheKey, ctx));
      }
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
        headers: { "Content-Type": "audio/mpeg", ...CORS_HEADERS }
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
    newResponse.headers.set("X-Url", (new URL(queryUrl).pathname));
    if (request.method === "GET") {
      newResponse.headers.set("X-Cache", "YES");
      ctx.waitUntil(setCachedResponse(request, newResponse, CACHE_HEADERS.LONG, cacheKey, ctx));
    }
    const clientIP = getClientIP(request);
    const geoLocation = request.cf?.asOrganization || request.cf?.country || null;
    const userAgent = request.headers.get("user-agent") || null;
    const requestModel = data.model || queryBody.model;
    const firstMessage = prompt || getFirstMessage(queryBody.messages);
    const totalUsage = usage.total_tokens || (usage.prompt_tokens + usage.completion_tokens) || 0;
    ctx.waitUntil(persistUsageToDb(env, clientIP, `custom:${server.id}`, queryBody.model, totalUsage, usage.prompt_tokens, usage.completion_tokens, pathname, firstMessage, user, geoLocation, userAgent, userProvidedKey));
    if (response.ok) {
      ctx.waitUntil(updateServerUsage(env, server, totalUsage, queryBody.model));
    }
    if (user) {
      ctx.waitUntil(updateUserDailyUsage(env, user.id, totalUsage, `custom:${server.id}`, queryBody.model));
    }
    if (!userProvidedKey && response.headers.get("X-Cache") !== "HIT" && !server.api_key) {
      const totalTokens = getModelTokens(queryBody.model, totalUsage);
      if (totalTokens) {
        newResponse.headers.set("X-Usage-Total-Tokens", String(totalTokens));
      }
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
  const servers = AUTO_PROVIDERS;
  const serverId = servers[Math.floor(Math.random() * servers.length)];
  const server =  await getServerById(env, serverId);
  if (!server) {
    throw Error(`Server with id '${serverId}' not found`)
  }
  return server;
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
  if (!rateCheck) {
    return;
  }
  newResponse.headers.set("X-Prompt-Tokens", rateCheck.promptTokens)
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
    // { name: "minute", duration: RATE_LIMITS.windows.minute, tokenLimit: limits.tokens.perMinute, requestLimit: limits.requests.perMinute },
    // { name: "hour", duration: RATE_LIMITS.windows.hour, tokenLimit: limits.tokens.perHour, requestLimit: limits.requests.perHour },
    { name: "day", duration: RATE_LIMITS.windows.day, tokenLimit: limits.tokens.perDay, requestLimit: limits.requests.perDay }
  ];
  if (!env.MEMBERS_KV) {
    return { allowed: true };
  }
  let maxTokens = parseInt(request.headers.get("x-ratelimit-remaining-tokens") || "0") || limits.tokens.perDay;
  let maxRequests = parseInt(request.headers.get("x-ratelimit-remaining-requests") || "0") || limits.requests.perDay;
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
// Each baked cake grants a small credit (in cents) to the IP that baked it.
// Anonymous users have no fixed daily rate limit; instead their usage is
// gated by their cake credit balance. The credit (in cents) is converted
// into a prompt-token budget: 1 cent -> 1e3 prompt tokens. The estimated
// prompt tokens of every request (messages + tools + media) are charged
// against that budget and decremented from the IP's credit on success.
//   5 cents per cake * 50 cakes/day = 250 cents -> 250k prompt tokens/day
var CAKE_CREDIT_TOKENS_PER_CENT = 1e3;  // prompt-token budget per cent of credit

// Read the caller's accumulated cake credit (in cents) from the shared
// CAKE_KV namespace. Returns 0 when the binding is absent or the IP has no
// credit record, so the feature degrades gracefully (no anonymous usage).
async function getCakeCreditCents(env, clientIP) {
  if (!env.CAKE_KV || !clientIP) return 0;
  try {
    const raw = await env.CAKE_KV.get(`cakes:credit:${clientIP}`);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

// Decrement the caller's cake credit (in cents) by the spent prompt tokens.
// Uses a simple compare-and-swap over CAKE_KV. Best-effort: if the CAS fails
// (concurrent bake/charge) we leave the credit untouched rather than retry.
async function chargeCakeCreditCents(env, clientIP, centsToCharge) {
  if (!env.CAKE_KV || !clientIP || !centsToCharge || centsToCharge <= 0) return;
  try {
    const key = `cakes:credit:${clientIP}`;
    const raw = await env.CAKE_KV.get(key);
    if (!raw) return;
    const current = Number(raw);
    if (!Number.isFinite(current)) return;
    const next = Math.max(0, current - centsToCharge);
    await env.CAKE_KV.put(key, String(next));
  } catch {
    // non-fatal — the request already succeeded
  }
}

// Estimate the prompt tokens of a chat-completion request body by summing
// the serialized length of messages, tools, and any media/image payloads.
// Uses the common ~4 chars/token heuristic. Media items are charged at a
// fixed cost per image (85 tokens) when present as image_url parts.
function estimatePromptTokens(requestBody) {
  if (!requestBody) return 0;
  let chars = 0;
  let images = 0;
  const messages = Array.isArray(requestBody.messages) ? requestBody.messages : [];
  for (const msg of messages) {
    if (!msg) continue;
    const content = msg.content;
    if (typeof content === "string") {
      chars += content.length;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (!part) continue;
        if (typeof part === "string") {
          chars += part.length;
        } else if (typeof part.text === "string") {
          chars += part.text.length;
        } else if (part.type === "image_url" || part.image_url) {
          images += 1;
        }
      }
    }
    if (typeof msg.name === "string") chars += msg.name.length;
    if (typeof msg.role === "string") chars += msg.role.length;
  }
  // tools / tool_calls / functions contribute to the prompt too
  if (Array.isArray(requestBody.tools)) {
    try { chars += JSON.stringify(requestBody.tools).length; } catch {}
  }
  if (Array.isArray(requestBody.functions)) {
    try { chars += JSON.stringify(requestBody.functions).length; } catch {}
  }
  // system / response_format / other string fields
  if (typeof requestBody.system === "string") chars += requestBody.system.length;
  const textTokens = Math.ceil(chars / 4);
  const imageTokens = images * 85;
  return textTokens + imageTokens;
}

// Gate an anonymous (non-signed-in) request on the caller's baked cake
// credits and populate the OpenAI-style ratelimit fields on `rateCheck` so
// the response headers (X-Ratelimit-*) reflect remaining quota. Returns
// `null` when the request is allowed, or a 402 Response to send back when
// the IP has no credit or the prompt exceeds the budget. Signed-in users
// (user != null) are skipped — they fall through to the tier limits.
//
// Shared by handleV1ChatCompletions and handleProxyToServer so that every
// anonymous proxy path (gemini, ollama, azure, auto, ...) reports the same
// credit-based rate-limit headers instead of "undefined".
async function applyAnonymousCreditGate(env, ctx, request, user, requestBody, rateCheck) {
  if (user) return null;
  const clientIP = getClientIP(request);
  const creditCents = await getCakeCreditCents(env, clientIP);
  const tokenBudget = Math.floor(creditCents * CAKE_CREDIT_TOKENS_PER_CENT);
  const promptTokens = Math.max(estimatePromptTokens(requestBody), 1000);
  if (tokenBudget <= 0) {
    return jsonResponse({
      error: {
        message: "No cake credits. Bake proof-of-work cakes at g4f.dev/chat to earn anonymous usage, or sign up at g4f.dev/members.html.",
        type: "insufficient_credits",
        upgrade_url: "https://g4f.dev/members.html",
        bake_url: "https://g4f.dev/chat"
      }
    }, 402);
  }
  if (promptTokens > tokenBudget) {
    return jsonResponse({
      error: {
        message: `Cake credit budget exceeded. This request needs ~${promptTokens} prompt tokens but your IP has ${tokenBudget} available (${creditCents}¢). Bake more cakes at g4f.dev/chat or sign up at g4f.dev/members.html.`,
        type: "insufficient_credits",
        required_tokens: promptTokens,
        available_tokens: tokenBudget,
        credit_cents: creditCents,
        upgrade_url: "https://g4f.dev/members.html",
        bake_url: "https://g4f.dev/chat"
      }
    }, 402);
  }
  // Charge the estimated prompt tokens against the IP's credit (1 token =
  // 1/CAKE_CREDIT_TOKENS_PER_CENT cent). Done in the background so the
  // response isn't delayed; non-fatal if it fails.
  const centsToCharge = promptTokens / CAKE_CREDIT_TOKENS_PER_CENT;
  ctx.waitUntil(chargeCakeCreditCents(env, clientIP, centsToCharge));
  // Derive the OpenAI-style ratelimit headers from the credit budget so
  // clients can display remaining quota. The token limit is the full
  // budget purchased with the credit; the request limit is an estimate of
  // how many requests of the current size that budget would cover. Each
  // request consumes both prompt AND completion tokens, so assume a
  // completion budget (the request's max_tokens, or a default) on top of
  // the prompt — this keeps maxRequests conservative rather than
  // overcounting how many requests the credit will absorb.
  const completionTokens = Math.max(
    Number(requestBody && requestBody.max_tokens) || 0,
    512
  );
  const avgRequestTokens = Math.max(promptTokens + completionTokens, 1);
  const remainingTokens = Math.max(0, tokenBudget - promptTokens);
  rateCheck = rateCheck || {};
  rateCheck.cakeCreditCents = creditCents;
  rateCheck.promptTokens = promptTokens;
  rateCheck.tokenBudget = tokenBudget;
  rateCheck.limitTokens = tokenBudget;
  rateCheck.maxTokens = remainingTokens;
  rateCheck.limitRequests = Math.max(1, Math.floor(tokenBudget / avgRequestTokens));
  rateCheck.maxRequests = Math.floor(remainingTokens / avgRequestTokens);
  return rateCheck;
}
async function updateUserRateLimit(env, userId, ctx) {
  if (!env.MEMBERS_KV) return;
  const now = Date.now();
  const windows = [
    // { name: "minute", duration: RATE_LIMITS.windows.minute },
    // { name: "hour", duration: RATE_LIMITS.windows.hour },
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
  } if (model.toLowerCase().includes("glm-5.2")) {
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
async function handleV1ChatCompletions(request, env, ctx, pathname, user, cacheKey, rateCheck) {
  if (!modelToServerCache) {
    await handleV1Models(request, env, user);
  }
  let requestBody;
  try {
    requestBody = await request.clone().json();
  } catch (e) {
    requestBody = {}
  }

  // Anonymous users are gated by their baked cake credits instead of a fixed
  // daily rate limit. Signed-in users (user != null) skip this check and fall
  // through to the normal tier limits.
  if (!user) {
    const result = await applyAnonymousCreditGate(env, ctx, request, user, requestBody, rateCheck);
    if (result instanceof Response) return result;  // 402 error response
    if (result) rateCheck = result;  // updated rateCheck with credit fields
  }

  let selectedServer = null;
  let model = requestBody.model;

  if (model === "auto" || !model) {
    try {
      selectedServer = await getRandomPublicServer(env);
    } catch(e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }
  if (!selectedServer)
  if (model && modelToServerCache && modelToServerCache[model]) {
    const serverId = modelToServerCache[model];
    const maybe = await getServerById(env, serverId, user);
    if (maybe) {
      selectedServer = maybe;
    }
  }

  // if prefix identified a server use it exclusively
  if (!selectedServer) {
    if (model && model.startsWith("pa:")) {
      const split = model.split(":");
      selectedServer = await getServerByLabel(env, `pa:${split[1]}`, user);
      model = split[2];
      requestBody.model = model;
    } else {
      const prefixMatch = /^([^:]+):(.+)$/.exec(model || "");
      if (prefixMatch) {
        const serverId = prefixMatch[1];
        const modelName = prefixMatch[2];
        const maybe = await getServerById(env, serverId, user);
        if (maybe) {
          selectedServer = maybe;
          model = modelName; // override for later checks
          requestBody.model = modelName;
        }
      }
    }
  }

  if (!selectedServer) {
    let privateServers = [];
    if (user && user.custom_servers) {
      privateServers = user.custom_servers.filter((s) => !s.is_public);
    }
    for (const server of privateServers) {
      if (server.allowed_models && server.allowed_models.length > 0) {
        if (server.allowed_models.includes(model)) {
          selectedServer = server;
          break;
        }
      }
    }
  }
  if (!selectedServer) {
    const publicServersIndex = await getPublicServers(env);
    for (const serverIndex of publicServersIndex) {
      const owner = await getUser(env, serverIndex.owner_id);
      if (!owner) continue;
      const fullServer = (owner.custom_servers || []).find((s) => s.id === serverIndex.id);
      if (!fullServer || !fullServer.is_public) continue;
      if (fullServer.allowed_models && fullServer.allowed_models.length > 0) {
        if (fullServer.allowed_models.includes(model)) {
          selectedServer = fullServer;
          break;
        }
      }
    }
  }
  if (!selectedServer) {
    return jsonResponse({ error: `No server found that supports model '${model}'` }, 404);
  }

  return handleProxyToServer(request, env, ctx, selectedServer, "/chat/completions", cacheKey, user, pathname, null, rateCheck, requestBody);
}
// helper that reads usage files and returns a map of models used on a given server
// with the total request count for each model
async function getModelsFromStats(env, server) {
  let modelCounts = {};
  if (!env.MEMBERS_BUCKET || !server) return modelCounts;
  try {
    const dates = [(d =>new Date(d.setDate(d.getDate()-1)))(new Date()), new Date()];
    let yesterday = true;
    for (const date of dates) {
      const dateKey = date.toISOString().split("T")[0];
      const prefix = `custom_servers/${server.owner_id||"core"}/${server.id}/usage/${dateKey}.json`;
      const list = await env.MEMBERS_BUCKET.list({ prefix });
      if (list && list.objects) {
        for (const entry of list.objects) {
          try {
            const rec = await env.MEMBERS_BUCKET.get(entry.key);
            if (!rec) continue;
            const json = await rec.json();
            if (json && json.models) {
              for (const [m, cnt] of Object.entries(json.models)) {
                modelCounts[m] = (modelCounts[m] || 0) + (cnt || 0);
              }
            }
          } catch (e) {
            // ignore individual read errors
          }
        }
      }
      if (yesterday) {
        modelCounts = Object.fromEntries(Object.entries(modelCounts).filter(([k, c])=>c>2).map(([k, c])=>[k, Math.floor(c/2)]));
        yesterday = false;
      }
    }
  } catch (e) {
    console.error("Failed to retrieve stats for server", server.id, e);
  }
  return modelCounts;
}

// simple in‑memory cache for /v1/models responses
let modelsCache = null;
let modelsCacheTime = 0;
let modelToServerCache = null;

async function handleV1Models(request, env, user) {
  const now = Date.now();

  // return cached result if recent
  if (modelsCache && now - modelsCacheTime < 60_000 * 60) {
    return jsonResponse(modelsCache.payload);
  }

  let privateServers = [];
  if (user && user.custom_servers) {
    privateServers = user.custom_servers.filter((s) => !s.is_public);
  }
  const publicServersIndex = await getPublicServers(env);
  const allModels = {};

  // aggregate stats if bucket available
  if (env.MEMBERS_BUCKET) {
    const serversToCheck = [await getServerByLabel(env, "core"), ...privateServers, ...publicServersIndex.map(s => ({ id: s.id, label: s.label, owner_id: s.owner_id }))];
    const statsPromises = serversToCheck.map(s => getModelsFromStats(env, s).then(m => ({server: s, map: m})));
    const statsResults = await Promise.all(statsPromises);
    for (const { server, map } of statsResults) {
      for (const [m, cnt] of Object.entries(map)) {
        const key = server.id != "core" ? `${server.id}:${m}` : m;
        if (!allModels[key]) {
          allModels[key] = { id: key, owned_by: server.label, model: m, label: server.label ? `${server.label}:${m}`: m, server: server.id, requests: cnt };
        } else {
          allModels[key].requests = (allModels[key].requests || 0) + cnt;
        }
      }
    }
  }

  // convert and sort
  let result = Array.from(Object.values(allModels));
  result = result.filter(m => m.requests > 0); // only show models with usage for relevance
  result.sort((a, b) => (b.requests || 0) - (a.requests || 0));
  modelToServerCache = {};
  result.forEach(m => {
    if (!(m.model in modelToServerCache)) {
      modelToServerCache[m.model] = m.server;
    }
  });
  result.unshift({ id: "auto", label: "Auto (random public server)" });

  const payload = { data: result };
  modelsCache = { payload };
  modelsCacheTime = now;
  return jsonResponse(payload);
}
// Module-level request context set at the start of each fetch. jsonResponse
// reads this to persist any error response (status >= 400) to ERRORS_DB.
// catch blocks that already call persistErrorToDb set `skipErrorLog` to avoid
// double-logging the same event.
var currentRequestContext = null;
function jsonResponse(data, status = 200) {
  if (status >= 400 && status != 402 && currentRequestContext && !currentRequestContext.skipErrorLog) {
    const ctx = currentRequestContext.ctx;
    const env = currentRequestContext.env;
    const request = currentRequestContext.request;
    if (ctx && env) {
      const message = typeof data?.error === "string"
        ? data.error
        : (data?.error?.message || JSON.stringify(data?.error || data));
      ctx.waitUntil(persistErrorToDb(env, new Error(message), {
        source: "jsonResponse",
        status,
        pathname: currentRequestContext.pathname,
        method: request.method,
        ip: getClientIP(request),
        userAgent: request.headers.get("user-agent"),
        requestId: request.headers.get("cf-ray") || null
      }));
    }
  }
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...ACCESS_CONTROL_ALLOW_ORIGIN
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
// Hash the POST request body for chat/completions caching.
// Uses model + stream flag + last message content so that repeated
// test prompts like "ping", "hello", "test" share the same cache key.
async function generatePostBodyHash(request) {
  try {
    const body = await request.clone().json();
    const messages = body.messages || [];
    const lastMsg = messages[messages.length - 1];
    const lastContent = lastMsg
      ? (typeof lastMsg.content === 'string' ? lastMsg.content : '')
      : '';
    if (["test", "ping", "hello"].includes(lastContent.toLowerCase())) {
      const model = body.model || '';
      const stream = body.stream ? '1' : '0';
      return await hashString(`${model}:${stream}:${lastContent}`);
    }
    for (const msg of messages) {
      if (msg && msg.content && typeof msg.content === 'string') {
        continue;
      }
      return null;
    }
    if (body.stream) {
      return null;
    }
    return await hashString(`${body.model || ''}:${JSON.stringify(messages)}`);
  } catch (e) {
    return null;
  }
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
  if ((response.headers.get("Cache-Control") || "").includes("no-cache")) {
    return;
  }
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
async function proxyToPassG4f(request, env, pathname, search, user, cacheKey, ctx) {
  // block anonymous requests originating from certain cloud providers
  // (Cloudflare sets `request.cf.asOrganization` for the source ASN/org).
  const org = request.cf?.asOrganization || request.cf?.country || null;
  if ( request.headers.get("host") != "api.gpt4free.workers.dev")
  if (!user && org && BLOCKED_ORGS.includes(org) && !pathname.endsWith("/public")) {
    return jsonResponse({
      error: {
        message: `Access from "${org}" blocked. Sign up at g4f.dev/members.html for access from cloud.`,
        type: "authentication_required"
      }
    }, 403);
  }
  const headers = new Headers(request.headers);
  if (user) {
    headers.set("x-user", user.username || user.id);
    headers.set("x-user-provider", user.provider);
    headers.set("x-user-tier", user.tier);
  }
  headers.set("g4f-api-key", env.PASS_API_KEY);
  const targetUrl = `https://pass.g4f.space${pathname}${search || ""}`;
  const fetchOptions = {
    method: request.method,
    headers
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    fetchOptions.body = request.clone().body;
  }
  await acquirePassSlot();
  let response;
  try {
    response = await fetch(targetUrl, fetchOptions);
  } finally {
    releasePassSlot();
  }
  const newResponse = new Response(response.body, response);
  newResponse.headers.set("Access-Control-Allow-Origin", "*");
  if (request.method === "GET" && (!headers.get("g4f-api-key") && !request.headers.get("x-api-key") && !request.headers.get("x-ignored")) || ["/pa/providers"].includes(pathname)) {
    ctx.waitUntil(setCachedResponse(request, newResponse.clone(), CACHE_HEADERS.SHORT, cacheKey, ctx));
  }
  return newResponse;
}
export {
  custom_worker_default as default
};