const API_HOST = "pass.g4f.dev"
const POLLINATIONS_HOST = "pollinations.ai";
const GITHUB_HOST = 'gpt4free.github.io';
const MODEL_ID = "@cf/openai/gpt-oss-120b";
const MAX_CONTENT_LENGHT = 50 * 1024;
const CUSTOM_MAX_LENGHT = 100 * 1024;
const CACHE_CONTROL = 'public, max-age=14400, s-maxage=7200'
const CACHE_FOREVER = 'public, max-age=31536000, immutable';

// Rate limiting configuration for anonymous users
const RATE_LIMITS = {
  // Token limits
  tokens: {
    perMinute: 100000,
    perHour: 300000,
    perDay: 500000
  },
  // Request limits
  requests: {
    perMinute: 10,
    perHour: 100,
    perDay: 1000
  },
  // Burst allowance (multiplier for short-term limits)
  burstMultiplier: 2,
  // Window durations in milliseconds
  windows: {
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000
  }
};

// Rate limits for authenticated user tiers
const USER_TIER_LIMITS = {
  new: {
    tokens: { perMinute: 100000, perHour: 300000, perDay: 500000 },
    requests: { perMinute: 10, perHour: 100, perDay: 1000 }
  },
  free: {
    tokens: { perMinute: 150000, perHour: 500000, perDay: 1000000 },
    requests: { perMinute: 20, perHour: 200, perDay: 2000 }
  },
  sponsor: {
    tokens: { perMinute: 500000, perHour: 2500000, perDay: 10000000 },
    requests: { perMinute: 50, perHour: 500, perDay: 5000 }
  },
  pro: {
    tokens: { perMinute: 1000000, perHour: 5000000, perDay: 20000000 },
    requests: { perMinute: 100, perHour: 1000, perDay: 10000 }
  }
};

const ACCESS_CONTROL_ALLOW_ORIGIN = {
  "Access-Control-Allow-Origin": "*",
}
const CORS_HEADERS = {
  ...ACCESS_CONTROL_ALLOW_ORIGIN,
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods":  "GET,HEAD,PUT,PATCH,POST,DELETE",
  "Access-Control-Allow-Headers": "content-type, authorization, cache-control, pragma, priority, x_secret, x-user, x-ignored",
  "Access-Control-Expose-Headers": "content-type, x-provider, retry-after"
}

export const GPT_AUDIO_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'coral', 'verse', 'ballad', 'ash', 'sage', 'marin', 'cedar', 'amuch', 'dan', 'elan', 'breeze', 'cove', 'ember', 'fathom', 'glimmer', 'harp', 'juniper', 'maple', 'orbit', 'vale'];

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const search = url.search;
  const pathWithParams = pathname + search;
  const models = {
    "nvidia": {url: "https://integrate.api.nvidia.com/v1", api_key: env.NVIDIA_API_KEY, model: "deepseek-ai/deepseek-v3.1"},
    "openrouter": {url: "https://openrouter.ai/api/v1", api_key: env.OPENROUTER_API_KEY, model: "openai/gpt-oss-120b:free"},
    "deepinfra": {url: "https://api.deepinfra.com/v1/openai", model: "deepseek-ai/DeepSeek-V3.1-Terminus"},
    "groq": {url: "https://api.groq.com/openai/v1", api_key: env.GROQ_API_KEY, model: "moonshotai/kimi-k2-instruct-0905"},
    "ollama": {url: "https://ollama.g4f-dev.workers.dev", api_key: env.OLLAMA_API_KEY, model: "deepseek-v3.1:671b"},
    "azure": {endpoint: "https://g4f-dev-resource.cognitiveservices.azure.com/openai/deployments/model-router/chat/completions?api-version=2025-01-01-preview", api_key: env.AZURE_API_KEY, model: "model-router"},
    "auto": {endpoint: "https://g4f-dev-resource.cognitiveservices.azure.com/openai/deployments/model-router/chat/completions?api-version=2025-01-01-preview", api_key: env.AZURE_API_KEY, model: "model-router"},
    "pollinations": {endpoint: "https://text.pollinations.ai/openai", model: "openai"},
    "nectar": {url: "https://gen.pollinations.ai", endpoint: "https://gen.pollinations.ai/v1/chat/completions", api_key: env.POLLINATIONS_API_KEY, model: "openai"},
  }
  const ALLOW_LIST = ["openrouter", "nvidia", "groq", "ollama", "azure", "nectar", "pollinations"];

  const defaultModels = [
    {id: 'auto'},
    {id: 'azure'},
    {id: 'groq'},
    {id: 'nectar'},
    {id: 'nvidia'},
    {id: 'ollama'},
    {id: 'openrouter'},
    {id: 'perplexity'},
    {id: 'pollinations'}
  ];

  if (request.method === "OPTIONS") {
    return handleOptions(request);
  }

  // Rate limit status endpoint
  if (pathname === "/api/rate-limit" || pathname === "/api/usage") {
    const clientIP = getClientIP(request);
    const usage = await getRateLimitUsage(env, clientIP);
    const now = Date.now();
    
    return Response.json({
      ip: clientIP.substring(0, clientIP.lastIndexOf('.')) + '.xxx', // Partially anonymized
      limits: {
        tokens: RATE_LIMITS.tokens,
        requests: RATE_LIMITS.requests
      },
      usage: {
        minute: {
          tokens: usage.minute.tokens,
          requests: usage.minute.requests,
          remaining_tokens: Math.max(0, RATE_LIMITS.tokens.perMinute * RATE_LIMITS.burstMultiplier - usage.minute.tokens),
          remaining_requests: Math.max(0, RATE_LIMITS.requests.perMinute * RATE_LIMITS.burstMultiplier - usage.minute.requests),
          resets_in: Math.max(0, Math.ceil((RATE_LIMITS.windows.minute - (now - usage.minute.timestamp)) / 1000))
        },
        hour: {
          tokens: usage.hour.tokens,
          requests: usage.hour.requests,
          remaining_tokens: Math.max(0, RATE_LIMITS.tokens.perHour - usage.hour.tokens),
          remaining_requests: Math.max(0, RATE_LIMITS.requests.perHour - usage.hour.requests),
          resets_in: Math.max(0, Math.ceil((RATE_LIMITS.windows.hour - (now - usage.hour.timestamp)) / 1000))
        },
        day: {
          tokens: usage.day.tokens,
          requests: usage.day.requests,
          remaining_tokens: Math.max(0, RATE_LIMITS.tokens.perDay - usage.day.tokens),
          remaining_requests: Math.max(0, RATE_LIMITS.requests.perDay - usage.day.requests),
          resets_in: Math.max(0, Math.ceil((RATE_LIMITS.windows.day - (now - usage.day.timestamp)) / 1000))
        }
      }
    }, {headers: ACCESS_CONTROL_ALLOW_ORIGIN});
  }

  if (pathname == "/api/grok/models") {
    return Response.json({data: [{id: 'grok-4-fast-non-reasoning'}, {id: 'grok-4-fast-reasoning'}, {id: 'grok-code-fast-1'}]}, {headers: ACCESS_CONTROL_ALLOW_ORIGIN});
  } else if (pathname == "/api/auto/models") {
    return Response.json({data: defaultModels}, {headers: ACCESS_CONTROL_ALLOW_ORIGIN});
  } else if (pathname == "/api/audio/models") {
    return Response.json({data: [{id: 'gpt-audio', audio: true}, ...GPT_AUDIO_VOICES.map((voice)=>{return {id: voice, audio: true}})]}, {headers: ACCESS_CONTROL_ALLOW_ORIGIN});
  } else if (pathname == "/api/openrouter/models") {
    const modelsResponse = await forwardApi(request, "https://openrouter.ai/api/v1/models");
    return Response.json({data: (await modelsResponse.json()).data.filter((model)=>model.id.endsWith(":free"))}, {headers: ACCESS_CONTROL_ALLOW_ORIGIN});
  } else if (pathname == "/api/api.airforce/models") {
    const modelsResponse = await forwardApi(request, "https://api.airforce/v1/models");
    return Response.json({data: (await modelsResponse.json()).data.filter((model)=>2>model.multiplier)}, {headers: ACCESS_CONTROL_ALLOW_ORIGIN});
  }
  const liteParams = ["seed", "voice", "json"].filter(key=>url.searchParams.get(key)).map(key=>`${key}=${encodeURIComponent(url.searchParams.get(key))}`);
  const liteQuery = liteParams ? '?' + liteParams.join('&') : ''
  let liteRequest = new Request(url.origin + pathname + liteQuery);
  if (["HEAD", "GET"].includes(request.method) && !pathname.startsWith("/dist/")) {
    let response = await caches.default.match(liteRequest);
    if (response) {
      return response;
    }
  }
  if (pathname !== "/" && !pathname.startsWith("/dist/") && !pathname.startsWith('/chat/') && !pathname.startsWith('/docs/') && !pathname.startsWith('/backend-api/v2/chat/') && !pathname.startsWith('/backend-api/v2/files/') && !pathname.endsWith('/models') && !pathname.endsWith("/ok")) {
    const subpath = pathname.startsWith("/api/") ? "/api/" : pathname.startsWith("/ai/") ? "/ai/" : pathname;
    const { success } = await env.RATE_LIMIT.limit({ key: subpath })
    if (!success) {
      return Response.json({error: {message: `Rate limit (1x10secs) exceeded for ${subpath}`}}, {status: 429, headers: {"Retry-After": "10", ...ACCESS_CONTROL_ALLOW_ORIGIN}});
    }
  }

  //if (!pathname.startsWith("/dist/") && !pathname.startsWith('/chat/') && !pathname.startsWith('/docs/') && !pathname.startsWith('/backend-api/v2/chat/') && !pathname.startsWith('/backend-api/v2/files/')) {
  //  const { success } = await env.RATE_LIMIT2.limit({ key: pathname })
  //  if (!success) {
  //    return Response.json({error: {message: `Rate limit (3x60secs) exceeded for ${pathname}`}}, {status: 429});
  //  }
  //}

  if (!pathname.startsWith("/backend-api/")) {
    const contentLength = parseInt(request.headers.get('content-length'));
    if (pathname.startsWith("/api/azure/") || pathname.startsWith("/api/grok/"))  {
      if (contentLength > CUSTOM_MAX_LENGHT) {
        return Response.json({error: {message: 'Request body too large. Max 100KB allowed.'}}, {status: 413, headers: ACCESS_CONTROL_ALLOW_ORIGIN});
      }
    } else {
      if (contentLength > MAX_CONTENT_LENGHT) {
        return Response.json({error: {message: 'Request body too large. Max 50KB allowed.'}}, {status: 413, headers: ACCESS_CONTROL_ALLOW_ORIGIN});
      }
    }
  }

  // Authenticated user info - set during rate limit check, used for usage tracking
  let authenticatedUser = null;
  if (pathname.startsWith("/v1/")|| pathname.startsWith("/backend-api/")) {
    authenticatedUser = await validateUserApiKey(request, env);
  }
  // Check token usage limit for AI endpoints
  if (pathname.startsWith("/ai/") || pathname.startsWith("/api/") && pathname.endsWith("/chat/completions")) {
    // First, check if user has a valid API key for higher limits
    authenticatedUser = await validateUserApiKey(request, env);
    
    if (authenticatedUser) {
      // Authenticated user - use tier-based limits
      const rateCheck = await checkUserRateLimits(env, authenticatedUser);
      if (!rateCheck.allowed) {
        const windowLabels = { minute: 'per minute', hour: 'per hour', day: 'per day' };
        const message = rateCheck.reason === 'tokens'
          ? `Token limit (${rateCheck.limit.toLocaleString()} ${windowLabels[rateCheck.window]}) exceeded for ${rateCheck.tier} tier. Used: ${rateCheck.used.toLocaleString()} tokens.`
          : `Request limit (${rateCheck.limit} ${windowLabels[rateCheck.window]}) exceeded for ${rateCheck.tier} tier. Made: ${rateCheck.used} requests.`;
        return Response.json({
          error: {
            message,
            type: 'rate_limit_exceeded',
            tier: rateCheck.tier,
            window: rateCheck.window,
            limit: rateCheck.limit,
            used: rateCheck.used,
            retry_after: rateCheck.retryAfter
          }
        }, {status: 429, headers: {"Retry-After": rateCheck.retryAfter.toString(), "X-User-Tier": rateCheck.tier, ...ACCESS_CONTROL_ALLOW_ORIGIN}});
      }
      // authenticatedUser is already set from validateUserApiKey
    } else {
      // Anonymous user - use default IP-based limits
      const rateCheck = await checkRateLimits(env, request);
      if (!rateCheck.allowed) {
        const windowLabels = { minute: 'per minute', hour: 'per hour', day: 'per day' };
        const message = rateCheck.reason === 'tokens'
          ? `Token limit (${rateCheck.limit.toLocaleString()} ${windowLabels[rateCheck.window]}) exceeded. Used: ${rateCheck.used.toLocaleString()} tokens. Sign up at g4f.dev/members.html for higher limits.`
          : `Request limit (${rateCheck.limit} ${windowLabels[rateCheck.window]}) exceeded. Made: ${rateCheck.used} requests. Sign up at g4f.dev/members.html for higher limits.`;
        return Response.json({
          error: {
            message,
            type: 'rate_limit_exceeded',
            window: rateCheck.window,
            limit: rateCheck.limit,
            used: rateCheck.used,
            retry_after: rateCheck.retryAfter,
            upgrade_url: 'https://g4f.dev/members.html'
          }
        }, {status: 429, headers: {"Retry-After": rateCheck.retryAfter.toString(), ...ACCESS_CONTROL_ALLOW_ORIGIN}});
      }
    }
  }

  if (pathname.startsWith("/ai/") || pathname === '/api/auto/chat/completions') {
    let query = pathname.substring(4);
    let splited = query.split("/", 2);
    let provider;
    if (splited[0] == "worker" || Object.hasOwn(models, splited[0])) {
      query = splited[1];
      provider = splited[0];
    } else if (url.searchParams.get("voice")) {
      return Response.redirect(`https://text.pollinations.ai/${query}${search}${url.searchParams.get("voice") && !url.searchParams.get("model") ? '&model=openai-audio' : ''}&referrer=https://g4f.dev/`, 301);
    } else {
      while (!provider) {
        provider = randomProperty(models);
        if (!ALLOW_LIST.includes(provider)) {
          provider = null
        }
      }
    }
    const modelConfig = models[provider];
    const apiKeys = modelConfig && modelConfig.api_key ? modelConfig.api_key.split("\n") : null;
    const selectedApiKey = apiKeys ? apiKeys[apiKeys?.length * Math.random() << 0] : null;
    const authHeader = request.headers.get('authorization');
    let authorizationHeader = null;
    if (authHeader && authHeader !== 'Bearer secret') {
      // Handle space-separated keys (e.g., "Bearer g4f_xxx provider_key") - extract non-g4f key
      const tokens = authHeader.replace(/^Bearer\s+/i, '').split(/\s+/);
      const providerKey = tokens.find(t => t && !t.startsWith('g4f_') && !t.startsWith('gfs_'));
      if (providerKey) {
        authorizationHeader = `Bearer ${providerKey}`;
      }
    }
    const queryUrl = modelConfig ? modelConfig.endpoint || (modelConfig.url + "/chat/completions") : "";
    query = decodeURIComponent((query || '').trim());
    let queryBody;
    if (request.method === "POST") {
      queryBody = await request.json();
    } else {
      if (query == "ok") {
        query = "Respond with exactly the single word: ok";
      }
      let instructions = url.searchParams.get("instructions");
      if (!instructions) {
        if (provider === "audio") {
          query = "say only this text, no intro or confirmation: " + query;
        }
        instructions = `Today is: ${new Date(Date.now()).toLocaleString().split(',')[0]}, User language: ${request.headers.get('accept-language') || 'en'}`;
      }
      queryBody = {messages: [{role: "system", content: instructions}, {role: "user", content: query}]};
    }
    if (provider === "openrouter") {
      queryBody.max_tokens = 4096;
    }
    if (!Object.hasOwn(queryBody, "stream")) {
      queryBody.stream = false;
    }
    // Request usage data in streaming responses
    if (queryBody.stream) {
      queryBody.stream_options = { include_usage: true };
    }
    queryBody.model = queryBody.model || url.searchParams.get("model") || modelConfig?.model;
    if (queryBody.model === "auto") {
      queryBody.model = url.searchParams.get("model") || modelConfig?.model;
    }
    if (url.searchParams.get("json") === "true") {
      queryBody.response_format = {"type": "json_object"};
    }
    if (provider === "audio") {
      queryBody.audio = {
          "voice": url.searchParams.get("voice") || "alloy",
          "format": "mp3"
      }
      if (!queryBody.modalities) {
        queryBody.modalities = ["text", "audio"]
      }
    }
    let response;
    if (provider == "worker") {
        let messages = queryBody.messages.map(message=>{
          return {role: (message.role == "system" ? "developer" : message.role), content: message.content}
        });
        messages = messages.filter(message=>['user', 'developer'].includes(message.role))
      response = await env.AI.run(
        MODEL_ID,
        {input: messages},
        {
          returnRawResponse: true,
        },
      );
      if (!response.ok || queryBody.stream) {
        // Track usage for streaming responses
        if (queryBody.stream) {
          const clientIP = getClientIP(request);
          const firstMessage = getFirstMessage(queryBody.messages, query);
          const trackedStream = createUsageTrackingStream(response, env, clientIP, ctx, provider, queryBody.model, pathname, firstMessage, authenticatedUser);
          return new Response(trackedStream, {
            headers: response.headers
          });
        }
        return response;
      }
    } else {
      response = await shield(queryUrl, {method: 'POST', body: JSON.stringify(queryBody), headers: {
        "authorization": authorizationHeader || (selectedApiKey ? `Bearer ${selectedApiKey}` : null),
        "content-type": "application/json",
        ...(modelConfig.extraHeaders ? modelConfig.extraHeaders : {})
      }});
      if (!response.ok || queryBody.stream) {
        response.headers.set("x-tier", authenticatedUser ? authenticatedUser.tier : "anonymous");
        response.headers.set("x-provider", provider);
        response.headers.set("x-url", queryUrl);
        // Track usage for streaming responses
        if (queryBody.stream) {
          const clientIP = getClientIP(request);
          const firstMessage = getFirstMessage(queryBody.messages, query);
          const trackedStream = createUsageTrackingStream(response, env, clientIP, ctx, provider, queryBody.model, pathname, firstMessage, authenticatedUser);
          const newResponse = new Response(trackedStream, {
            headers: response.headers
          });
          newResponse.headers.set("x-tier", authenticatedUser ? authenticatedUser.tier : "anonymous");
          newResponse.headers.set("x-provider", provider);
          newResponse.headers.set("x-url", queryUrl);
          return newResponse;
        }
        return response;
      }
    }
    let data = await response.json();
    // Track token usage from response
    const usage = extractDetailedUsage(data);
    if (usage.total > 0) {
        const clientIP = getClientIP(request);
        const firstMessage = getFirstMessage(queryBody.messages, query);
        await updateTokenUsage(env, clientIP, usage.total, ctx, provider || data.provider, data.model || queryBody.model, usage.prompt, usage.completion, pathname, firstMessage, authenticatedUser);
    }
    if (data.choices && data.choices[0].message.audio) {
        data = data.choices[0].message.audio.data;
        const newResponse = new Response(base64toBlob(data), {
          headers: { 'Content-Type': 'audio/mpeg', ...ACCESS_CONTROL_ALLOW_ORIGIN },
        });
        newResponse.headers.set('cache-control', CACHE_FOREVER);
        ctx.waitUntil(caches.default.put(liteRequest, newResponse.clone()));
        return newResponse;
    }
    if (data.choices) {
      data = data.choices[0].message.content
    } else if (data.message) {
      data = data.message.content;
    } else if (data.output) {
      data = data.output[data.output.length-1]?.content[0].text;
    } else {
      data = JSON.stringify(data);
    }
    if (url.searchParams.get("json") === "true") {
      data = filterMarkdown(data, "json", data)
    }
    if (data === "Model unavailable." || !data) {
      return Response.json({error: {message: data || "Empty response"}}, {status: 500, headers: ACCESS_CONTROL_ALLOW_ORIGIN})
    }
    const headers = {
      ...ACCESS_CONTROL_ALLOW_ORIGIN,
      "content-type": "text/plain; charset=UTF-8",
      "x-provider": provider,
      "x-url": queryUrl,
      "x-tier": authenticatedUser ? authenticatedUser.tier : "anonymous"
    };
    const newResponse = new Response(data, {headers});
    if (["HEAD", "GET"].includes(request.method)) {
      newResponse.headers.set('cache-control', CACHE_FOREVER);
      ctx.waitUntil(caches.default.put(liteRequest, newResponse.clone()));
    }
    return newResponse;
  }

  if (pathname.startsWith("/media/") || pathname.startsWith("/thumbnail/")) {
      return retrieveCache(request, liteRequest, pathname, ctx, null, CACHE_FOREVER);
  } else if ((pathname.startsWith("/files/") || pathname.startsWith("/search/"))) {
      return retrieveCache(request, liteRequest, pathWithParams, ctx);
  } else if (pathname.startsWith("/api/worker")) {
      return forwardWorker(env, request, liteRequest, pathname.replace("/api/worker", ""), ctx);
  } else if (pathname.startsWith("/api/pollinations")) {
    let subpath = pathname.replace("/api/pollinations.ai", "").replace("/api/pollinations", "");
    subpath = subpath === "/chat/completions" ? "/openai" : subpath
    if (subpath === '/image/models') {
      return retrieveCache(request, liteRequest, '/models', ctx, `image.${POLLINATIONS_HOST}`);
    }
    return retrieveCache(request, liteRequest, subpath + search, ctx, `text.${POLLINATIONS_HOST}`);
  } else if (pathname.startsWith("/prompt/")) {
    return retrieveCache(request, liteRequest, pathname + search, ctx, `image.${POLLINATIONS_HOST}`, CACHE_FOREVER);
  } else {
    const authHeader = request.headers.get('authorization');
    let authorizationHeader = null;
    if (authHeader && authHeader !== 'Bearer secret') {
      // Handle space-separated keys (e.g., "Bearer g4f_xxx provider_key") - extract non-g4f key
      const tokens = authHeader.replace(/^Bearer\s+/i, '').split(/\s+/);
      const providerKey = tokens.find(t => t && !t.startsWith('g4f_') && !t.startsWith('gfs_'));
      if (providerKey) {
        authorizationHeader = `Bearer ${providerKey}`;
      }
    }
    for (const provider in models){
        let subpath = `/api/${provider}`;
        if (pathname.startsWith(subpath)) {
          if (!models[provider].url && pathname.endsWith("/models")) {
            return Response.json({data: [{id: 'model-router'}]}, {headers: ACCESS_CONTROL_ALLOW_ORIGIN});
          }
          const apiKeys = models[provider].api_key ? models[provider].api_key.split("\n") : null;
          const selectedApiKey = apiKeys ? apiKeys[apiKeys.length * Math.random() << 0] : null;
          const newRequest = new Request(request, {
            headers: {
              'authorization': authorizationHeader || (selectedApiKey ? `Bearer ${selectedApiKey}` : null),
              'content-type': request.headers.get("content-type"),
              'user-agent': request.headers.get("user-agent"),
              'referer': request.headers.get("referer")
            }
          });
          let newUrl = pathWithParams.replace(subpath, '');
          if (!models[provider].url || (models[provider].endpoint && newUrl === "/chat/completions")) {
            newUrl = models[provider].endpoint;
          } else {
            newUrl = models[provider].url + newUrl;
          }
          let response;
          if (provider === "gemini" && pathname.endsWith("/models") && ["HEAD", "GET"].includes(request.method)) {
            response = await shield(newUrl, newRequest);
            if (!response.ok) {
              return response;
            }
            const modelsList = await response.json();
            modelsList.data = modelsList.data.filter((m)=>["models/gemini-2.5-flash", "models/gemini-2.5-flash-lite"].includes(m.id) || m.id.includes("gemma"));
            response = Response.json(modelsList, {headers: {...ACCESS_CONTROL_ALLOW_ORIGIN, "cache-control": CACHE_CONTROL}});
            if (ctx && liteRequest) {
              ctx.waitUntil(caches.default.put(liteRequest, response.clone()))
            }
          } else {
            const trackUsage = pathname.endsWith('/chat/completions') ? { env, ctx, clientIP: getClientIP(request), provider, model: null, pathname } : null;
            response = await forwardApi(newRequest, newUrl, null, null, CACHE_CONTROL, trackUsage, {}, authenticatedUser);
          }
          return response;
        }
    }
    if (pathname.startsWith("/api/") || pathname.startsWith("/v1/")|| pathname.startsWith("/backend-api/") || pathname == "/openapi.json") {
      const provider = pathname.startsWith("/api/") ? pathname.split("/")[2] : "";
      const trackUsage = { env, ctx, clientIP: getClientIP(request), provider: provider, pathname };
      return forwardApi(request, `https://${API_HOST}${pathWithParams}`, liteRequest, ctx, CACHE_CONTROL, trackUsage, {'authorization': authorizationHeader, "g4f-api-key": "_g4f"}, authenticatedUser);
    } else {
      return fetch(`https://${GITHUB_HOST}${pathname}`, request);
      if (["HEAD", "GET"].includes(request.method) && response.status == 404 && pathname.startsWith("/docs/")) {
        const filepath = pathname.substring(6).replace(".html", ".md");
        const readme = await (await fetch("https://raw.githubusercontent.com/gpt4free/g4f.dev/refs/heads/main/docs/README.md")).text();
        const document = await (await fetch("https://raw.githubusercontent.com/gpt4free/g4f.dev/refs/heads/main/docs/client_js.md")).text();
        const template = await (await fetch("https://raw.githubusercontent.com/xtekky/gpt4free/refs/heads/main/etc/tool/template.html")).text();
        const prompt = `Create a documenation named "${filepath.replaceAll('_', ' ').replace('.html', '')}.md".`;
        const aiResponse = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {method: "POST", body: JSON.stringify({model: "deepseek-ai/deepseek-v3.1", messages: [{role: "user", content: prompt}]}), headers: {"content-type": "application/json", "authorization": `Bearer ${env.NVIDIA_API_KEY}`}});
        if (!aiResponse.ok) {
          return aiResponse;
        }
        const splited = (await aiResponse.json()).choices[0].message.content.split("\n\n", 2);
        const html = template.replace("{{ title }}", htmlEscape(splited[0] || "")).replace("{{ article }}", htmlEscape(splited[1] || ""));
        const newResponse = new Response(html, {headers: {"content-type": "text/html", "cache-control": "max-age=86400"}});
        ctx.waitUntil(caches.default.put(liteRequest, newResponse.clone()));
        return newResponse;
      }
      return response;
    }
  }
}

async function retrieveCache(request, liteRequest, pathname, ctx, host, cache_control = CACHE_CONTROL) {
    let response = await fetch(`https://${host || API_HOST}${pathname}`, request);
    const newResponse = new Response(response.body, response);
    for (const [key, value] of Object.entries(ACCESS_CONTROL_ALLOW_ORIGIN)) {
      newResponse.headers.set(key, value);
    }
    if (response.ok && ["HEAD", "GET"].includes(request.method)) {
      newResponse.headers.set('cache-control', cache_control);
      ctx.waitUntil(caches.default.put(liteRequest, newResponse.clone()))
    }
    return newResponse;
}

async function forwardApi(request, newUrl, liteRequest=null, ctx=null, cache_control = CACHE_CONTROL, trackUsage = null, extraHeaders = {}, userInfo) {
  let modifiedRequest = request;
  
  // For chat completions, inject stream_options to get usage in streaming responses
  let requestModel = null;
  let firstMessage = '';
  if (trackUsage && request.method === 'POST') {
    try {
      const body = await request.clone().json();
      requestModel = body.model || null;
      firstMessage = getFirstMessage(body.messages);
      if (body.stream) {
        body.stream_options = { include_usage: true };
        modifiedRequest = new Request(modifiedRequest, {
          body: JSON.stringify(body)
        });
      }
    } catch (e) {
      // Ignore JSON parse errors, proceed with original request
    }
  }
  const newRequest = new Request(modifiedRequest, {
    headers: {
      'authorization': request.headers.get("authorization"),
      'content-type': request.headers.get("content-type"),
      'user-agent': request.headers.get("user-agent"),
      'referer': request.headers.get("referer"),
      'x_secret': request.headers.get('x_secret'),
      'x-ignnored': request.headers.get('x-ignnored'),
      ...extraHeaders
    }
  });
  const response = await shield(newUrl, newRequest);
  // Track token usage for chat completions
  if (trackUsage && response.ok) {
    const contentType = response.headers.get('content-type') || '';
    // Handle streaming responses (text/event-stream)
    if (contentType.includes('text/event-stream')) {
      const trackedStream = createUsageTrackingStream(response, trackUsage.env, trackUsage.clientIP, trackUsage.ctx, trackUsage.provider, requestModel, trackUsage.pathname, firstMessage, userInfo);
      const newResponse = new Response(trackedStream, {
        headers: response.headers
      });
      for (const [key, value] of Object.entries(ACCESS_CONTROL_ALLOW_ORIGIN)) {
        newResponse.headers.set(key, value);
      }
      newResponse.headers.set("x-tier", userInfo ? userInfo.tier : "anonymous");
      return newResponse;
    }
    
    // Handle non-streaming JSON responses
    if (contentType.includes('application/json')) {
      const clonedResponse = response.clone();
      try {
        const data = await clonedResponse.json();
        const usage = extractDetailedUsage(data);
        if (usage.total > 0) {
          await updateTokenUsage(trackUsage.env, trackUsage.clientIP, usage.total, trackUsage.ctx, trackUsage.provider || data.provider, data.model || requestModel, usage.prompt, usage.completion, trackUsage.pathname, firstMessage, userInfo);
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
    }
  }
  
  const newResponse = new Response(response.body, {status: response.status, headers: response.headers});
  for (const [key, value] of Object.entries(ACCESS_CONTROL_ALLOW_ORIGIN)) {
    newResponse.headers.set(key, value);
  }
  if (ctx && liteRequest)
  if (response.ok && ["HEAD", "GET"].includes(request.method)) {
    newResponse.headers.set('cache-control', cache_control);
    ctx.waitUntil(caches.default.put(liteRequest, newResponse.clone()))
  }
  return newResponse;
}

async function forwardWorker(env, request, liteRequest, pathname, ctx) {
  const originRequest = new Request(request);
  originRequest.headers.set("authorization", `Bearer ${env.CLOUDFLARE_API_KEY}`)
  let response;
  if (pathname.endsWith("/models")) {
    response = await shield(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/models/search`, originRequest);
    ctx.waitUntil(caches.default.put(liteRequest, response.clone()));
    return response;
  }
  if (request.method !== "POST") {
    return Response.json({error: {message: "Not found"}}, {status: 404});
  }
  const data = await originRequest.clone().json();
  let { messages, model } = data;
  model = model || MODEL_ID;
  delete data.model;
  if (model.includes("gpt-oss") && data.messages) {
    delete data.messages;
    delete data.stream;
    messages = messages.map(message=>{
      return {role: (message.role == "system" ? "developer" : message.role), content: message.content}
    });
    messages = messages.filter(message=>['user', 'developer'].includes(message.role))
    const body = JSON.stringify({...data, model: model, input: messages})
    response = await shield(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/responses`, {
      method: originRequest.method,
      headers: originRequest.headers,
      body
    });
  } else {
    response = await env.AI.run(
      model,
      data,
      {
        returnRawResponse: true,
      },
    );
  }
  response = new Response(response.body, response);
  for (const [key, value] of Object.entries(ACCESS_CONTROL_ALLOW_ORIGIN)) {
    response.headers.set(key, value);
  }
  return response;
}

function handleOptions(request) {
  if (request.headers.get("Origin")) {
    return new Response(null, {
      headers: CORS_HEADERS
    })
  } else {
    return new Response(null, {
      headers: {
        "Allow": "GET,HEAD,POST,OPTIONS",
      }
    })
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      return handleRequest(request, env, ctx);
    } catch(e) {
      return Response.json({error: {message: e.toString()}}, {status: 500, headers: ACCESS_CONTROL_ALLOW_ORIGIN});
    }
  }
};

async function shield(url, options) {
  const response = await fetch(url, options);
  const contentType = (response.headers.get("content-type") || "").split(";")[0];
  if (!contentType || !["text/event-stream", "application/json", "text/plain", "application/problem+json", "audio/vnd.wav", "audio/mpeg"].includes(contentType)) {
    return Response.json({error: {message: `Shield: Status: ${response.status}, Content-Type: '${contentType}'`}}, {status: 500, headers: {"x-provider": response.headers.get("x-provider"), "x-url": url, ...ACCESS_CONTROL_ALLOW_ORIGIN}});
  }
  if (!response.ok && contentType.startsWith("application/json")) {
    const responseData = await response.json();
    return Response.json((responseData?.error?.messaage ? {error: {message: responseData?.error?.messaage}} : responseData) || {error: {message: responseData?.error?.messaage || `Shield: Status: ${response.status}`}}, {status: 500, headers: {"x-provider": response.headers.get("x-provider"), "x-url": url, ...ACCESS_CONTROL_ALLOW_ORIGIN}});
  }
  const newResponse = new Response(response.clone().body, response);
  newResponse.headers.delete('set-cookie');
  for (const [key, value] of Object.entries(ACCESS_CONTROL_ALLOW_ORIGIN)) {
    newResponse.headers.set(key, value);
  }
  return newResponse;
}

function filterMarkdown(text, allowedTypes = null, defaultValue = null) {
  const match = text.match(/```(.+)\n(?<code>[\s\S]+?)(\n```|$)/);
  if (match) {
      const [, type, code] = match;
      if (!allowedTypes || allowedTypes.includes(type)) {
          return code;
      }
  }
  return defaultValue;
}

var randomProperty = function (obj) {
  var keys = Object.keys(obj);
  return keys[ keys.length * Math.random() << 0];
};

function htmlEscape(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function base64toBlob(b64Data, contentType = '', sliceSize = 512) {
  const byteChars = atob(b64Data);
  const bytes = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  return new Blob([new Uint8Array(bytes)], { type: contentType });
}

function getClientIP(request) {
  return request.headers.get('cf-connecting-ip') || 
         request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
         'unknown';
}

/**
 * Extract the first non-empty user message from messages array or fallback to query
 * @param {Array} messages - Array of message objects with role and content
 * @param {string} fallback - Fallback string (usually the query)
 * @returns {string} First non-empty message content
 */
function getFirstMessage(messages, fallback = '') {
  if (!messages || !Array.isArray(messages)) {
    return fallback || '';
  }
  
  // Find first non-empty content, preferring user messages
  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content.replace(/^[\s.]+|[\s.]+$/g, '') : '';
    if (content && !content.startsWith('Today is:') && !content.startsWith('[SYSTEM]:') && content.length > 2) {
      return content;
    }
  }
  
  return fallback || '';
}

/**
 * Get rate limit usage for a client across all windows
 */
async function getRateLimitUsage(env, clientIP) {
  if (!env.TOKEN_USAGE) {
    return {
      minute: { tokens: 0, requests: 0, timestamp: Date.now() },
      hour: { tokens: 0, requests: 0, timestamp: Date.now() },
      day: { tokens: 0, requests: 0, timestamp: Date.now() }
    };
  }
  
  const now = Date.now();
  const keys = ['minute', 'hour', 'day'];
  const results = {};
  
  // Fetch all windows in parallel
  const promises = keys.map(async (window) => {
    const key = `rate:${clientIP}:${window}`;
    const data = await env.TOKEN_USAGE.get(key, { type: 'json' });
    
    if (!data || (now - data.timestamp > RATE_LIMITS.windows[window])) {
      return { window, data: { tokens: 0, requests: 0, timestamp: now } };
    }
    return { window, data };
  });
  
  const resolved = await Promise.all(promises);
  for (const { window, data } of resolved) {
    results[window] = data;
  }
  
  return results;
}

/**
 * Check if request is within rate limits
 */
async function checkRateLimits(env, request) {
  const clientIP = getClientIP(request);
  const usage = await getRateLimitUsage(env, clientIP);
  const now = Date.now();
  
  // Check each window
  const checks = [
    {
      window: 'minute',
      tokenLimit: RATE_LIMITS.tokens.perMinute * RATE_LIMITS.burstMultiplier,
      requestLimit: RATE_LIMITS.requests.perMinute * RATE_LIMITS.burstMultiplier,
      usage: usage.minute
    },
    {
      window: 'hour',
      tokenLimit: RATE_LIMITS.tokens.perHour,
      requestLimit: RATE_LIMITS.requests.perHour,
      usage: usage.hour
    },
    {
      window: 'day',
      tokenLimit: RATE_LIMITS.tokens.perDay,
      requestLimit: RATE_LIMITS.requests.perDay,
      usage: usage.day
    }
  ];
  
  for (const check of checks) {
    // Check token limit
    if (check.usage.tokens >= check.tokenLimit) {
      const retryAfter = Math.ceil((RATE_LIMITS.windows[check.window] - (now - check.usage.timestamp)) / 1000);
      return {
        allowed: false,
        reason: 'tokens',
        window: check.window,
        limit: check.tokenLimit,
        used: check.usage.tokens,
        retryAfter: Math.max(1, retryAfter)
      };
    }
    
    // Check request limit
    if (check.usage.requests >= check.requestLimit) {
      const retryAfter = Math.ceil((RATE_LIMITS.windows[check.window] - (now - check.usage.timestamp)) / 1000);
      return {
        allowed: false,
        reason: 'requests',
        window: check.window,
        limit: check.requestLimit,
        used: check.usage.requests,
        retryAfter: Math.max(1, retryAfter)
      };
    }
  }
  
  return { allowed: true, usage };
}

/**
 * Update rate limit usage across all windows
 */
async function updateRateLimitUsage(env, clientIP, tokensUsed, ctx) {
  if (!env.TOKEN_USAGE || tokensUsed <= 0) return;
  
  const now = Date.now();
  const windows = ['minute', 'hour', 'day'];
  
  for (const window of windows) {
    const key = `rate:${clientIP}:${window}`;
    const windowMs = RATE_LIMITS.windows[window];
    
    // Get current data
    const data = await env.TOKEN_USAGE.get(key, { type: 'json' });
    
    let newData;
    if (!data || (now - data.timestamp > windowMs)) {
      // Start new window
      newData = {
        tokens: tokensUsed,
        requests: 1,
        timestamp: now
      };
    } else {
      // Accumulate in existing window
      newData = {
        tokens: data.tokens + tokensUsed,
        requests: data.requests + 1,
        timestamp: data.timestamp
      };
    }
    
    // Calculate TTL based on remaining window time plus buffer
    const elapsed = now - newData.timestamp;
    const remaining = Math.max(60, Math.ceil((windowMs - elapsed) / 1000) + 60);
    
    ctx.waitUntil(env.TOKEN_USAGE.put(key, JSON.stringify(newData), { expirationTtl: remaining }));
  }
}

async function updateTokenUsage(env, clientIP, tokensUsed, ctx, provider = null, model = null, promptTokens = 0, completionTokens = 0, pathname = null, firstMessage = null, userInfo = null) {
  if (tokensUsed <= 0) return;
  
  // Persist to database (now includes userInfo)
  ctx.waitUntil(persistUsageToDb(env, clientIP, provider, (model || "").replace("models/", ""), tokensUsed, promptTokens, completionTokens, pathname, firstMessage, userInfo));
  
  // Update rate limits across all windows (IP-based)
  await updateRateLimitUsage(env, clientIP, tokensUsed, ctx);
  
  // Also update user-based rate limits and usage if authenticated
  if (userInfo) {
    ctx.waitUntil(trackUserUsage(env, userInfo, tokensUsed, provider, model, ctx));
  }
}

function createUsageTrackingStream(response, env, clientIP, ctx, provider = null, model = null, pathname = null, firstMessage = null, userInfo = null) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      let lines;
      if (!done) {
        const text = decoder.decode(value, { stream: true });
        buffer += text;
        
        // Look for usage in SSE data chunks
        lines = buffer.split('\n');
        // Keep the last incomplete line in buffer
        buffer = lines.pop() || '';
      } else {
        lines = buffer.split('\n');
      }

      let lastData = null;
      
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const jsonStr = line.slice(6);
            const data = JSON.parse(jsonStr);
            if (data.usage) {
              lastData = data;
            }
          } catch (e) {
            // Ignore parse errors for incomplete chunks
          }
        }
      }
      if (done) {
        controller.close();
        const usage = extractDetailedUsage(lastData);
        if (usage.total > 0) {
          ctx.waitUntil(updateTokenUsage(env, clientIP, usage.total, ctx, provider || lastData.provider, lastData.model || model, usage.prompt, usage.completion, pathname, firstMessage, userInfo));
        }
        return;
      } else {
        controller.enqueue(value);
      }
    },
    cancel() {
      reader.cancel();
    }
  });
  
  return stream;
}

// Persist usage to D1 database
async function persistUsageToDb(env, clientIP, provider, model, tokensUsed, promptTokens, completionTokens, pathname = null, firstMessage = null, userInfo = null) {
  if (!env.USAGE_DB) return;
  
  try {
    await env.USAGE_DB.prepare(
      `INSERT INTO usage_logs (ip, provider, model, tokens_total, tokens_prompt, tokens_completion, pathname, first_message, user_id, user_tier, timestamp) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      clientIP,
      provider || 'unknown',
      model || 'unknown',
      tokensUsed,
      promptTokens || 0,
      completionTokens || 0,
      pathname || 'unknown',
      firstMessage ? firstMessage.substring(0, 500) : null,
      userInfo?.user_id || null,
      userInfo?.tier || null,
      new Date().toISOString()
    ).run();
  } catch (e) {
    // Log error but don't fail the request
    console.error('Failed to persist usage:', e);
  }
}

// Extract detailed usage from response
function extractDetailedUsage(responseData) {
  if (responseData?.usage) {
    return {
      total: responseData.usage.total_tokens || 
             (responseData.usage.prompt_tokens || 0) + (responseData.usage.completion_tokens || 0),
      prompt: responseData.usage.prompt_tokens || 0,
      completion: responseData.usage.completion_tokens || 0
    };
  }
  return { total: 0, prompt: 0, completion: 0 };
}

// ============================================
// User API Key Authentication & Tier-based Rate Limiting
// ============================================

/**
 * Parse cookies from request header
 */
function parseCookies(request) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return {};
  
  const cookies = {};
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) {
      cookies[name] = rest.join('=');
    }
  });
  return cookies;
}

/**
 * Validate user API key and return user info with tier
 * Supports: Authorization header, X-API-Key header, or g4f_session cookie (same-site)
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment bindings
 * @returns {Object|null} User info with tier, or null if not authenticated
 */
async function validateUserApiKey(request, env) {
  // Get API key from Authorization header or X-API-Key header
  const authHeader = request.headers.get('Authorization');
  const xApiKey = request.headers.get('X-API-Key');

  let apiKey = null;
  let sessionToken = null;
  
  // Check Authorization header for g4f_ API key
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const tokens = authHeader.substring(7).split(/\s+/);
    const g4fKey = tokens.find(t => t.startsWith('g4f_'));
    if (g4fKey) {
      apiKey = g4fKey;
    }
  }
  
  // Check X-API-Key header
  if (!apiKey && xApiKey && xApiKey.startsWith('g4f_')) {
    apiKey = xApiKey;
  }
  
  // Check for session cookie (same-site authentication)
  if (!apiKey) {
    const cookies = parseCookies(request);
    if (cookies.g4f_session) {
      sessionToken = cookies.g4f_session;
    }
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const tokens = authHeader.substring(7).split(/\s+/);
      const findToken = tokens.find(t => t.startsWith('gfs_'));
      if (findToken) {
        sessionToken = findToken;
      }
    }
  }
  
  // If we have an API key, validate it
  if (apiKey) {
    // Hash the API key for lookup
    const keyHash = await hashApiKey(apiKey);
    
    // Look up in KV (populated by members-worker)
    if (!env.MEMBERS_KV) {
      return null;
    }
    
    const keyDataStr = await env.MEMBERS_KV.get(`api_key:${keyHash}`);
    if (!keyDataStr) {
      return null;
    }
    
    try {
      const keyData = JSON.parse(keyDataStr);
      return {
        user_id: keyData.user_id,
        key_id: keyData.key_id,
        tier: keyData.tier || 'new',
        username: keyData.username || null,
        api_key_hash: keyHash,
        auth_method: 'api_key'
      };
    } catch (e) {
      console.error('Failed to parse API key data:', e);
      return null;
    }
  }
  
  // If we have a session token, validate it
  if (sessionToken) {
    if (!env.MEMBERS_KV) {
      return null;
    }
    
    // Look up session in KV
    const sessionDataStr = await env.MEMBERS_KV.get(`session:${sessionToken}`);
    if (!sessionDataStr) {
      return null;
    }
    
    try {
      const sessionData = JSON.parse(sessionDataStr);
      
      // Check if session is expired
      if (sessionData.expires_at && new Date(sessionData.expires_at) < new Date()) {
        return null;
      }

      const userData = await getUser(env, sessionData.user_id);
      if (!userData) {
        return null;
      }
      
      return {
        user_id: sessionData.user_id,
        key_id: null,
        tier: userData.tier || 'new',
        username: userData.username || null,
        api_key_hash: null,
        auth_method: 'session'
      };
    } catch (e) {
      console.error('Failed to parse session data:', e);
      return null;
    }
  }
  
  return null;
}

/**
 * Hash an API key for secure lookup
 */
async function hashApiKey(apiKey) {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray, byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Get rate limits based on user tier
 */
function getRateLimitsForTier(tier) {
  if (tier && USER_TIER_LIMITS[tier]) {
    return {
      tokens: USER_TIER_LIMITS[tier].tokens,
      requests: USER_TIER_LIMITS[tier].requests,
      burstMultiplier: 1.5, // Less burst needed for authenticated users
      windows: RATE_LIMITS.windows
    };
  }
  return RATE_LIMITS;
}

async function getUser(env, userId) {
  // Try KV cache first
  const cached = await env.MEMBERS_KV.get(`user:${userId}`);
  if (cached) {
      return JSON.parse(cached);
  }

  // Fall back to R2
  const object = await env.MEMBERS_BUCKET.get(`users/${userId}.json`);
  if (!object) {
      return null;
  }

  const user = await object.json();
  
  // Cache for next time
  await env.MEMBERS_KV.put(`user:${userId}`, JSON.stringify(user), { expirationTtl: 3600 });
  
  return user;
}

/**
 * Get rate limit usage for an authenticated user
 */
async function getUserRateLimitUsage(env, userId) {
  if (!env.MEMBERS_KV) {
    return {
      minute: { tokens: 0, requests: 0, timestamp: Date.now() },
      hour: { tokens: 0, requests: 0, timestamp: Date.now() },
      day: { tokens: 0, requests: 0, timestamp: Date.now() }
    };
  }
  
  const now = Date.now();
  const keys = ['minute', 'hour', 'day'];
  const results = {};
  
  const promises = keys.map(async (window) => {
    const key = `user_rate:${userId}:${window}`;
    const data = await env.MEMBERS_KV.get(key, { type: 'json' });
    
    if (!data || (now - data.timestamp > RATE_LIMITS.windows[window])) {
      return { window, data: { tokens: 0, requests: 0, timestamp: now } };
    }
    return { window, data };
  });
  
  const resolved = await Promise.all(promises);
  for (const { window, data } of resolved) {
    results[window] = data;
  }
  
  return results;
}

/**
 * Check rate limits for authenticated user
 */
async function checkUserRateLimits(env, userInfo) {
  const limits = getRateLimitsForTier(userInfo.tier);
  const usage = await getUserRateLimitUsage(env, userInfo.user_id);
  const now = Date.now();
  
  const checks = [
    {
      window: 'minute',
      tokenLimit: limits.tokens.perMinute * limits.burstMultiplier,
      requestLimit: limits.requests.perMinute * limits.burstMultiplier,
      usage: usage.minute
    },
    {
      window: 'hour',
      tokenLimit: limits.tokens.perHour,
      requestLimit: limits.requests.perHour,
      usage: usage.hour
    },
    {
      window: 'day',
      tokenLimit: limits.tokens.perDay,
      requestLimit: limits.requests.perDay,
      usage: usage.day
    }
  ];
  
  for (const check of checks) {
    if (check.usage.tokens >= check.tokenLimit) {
      const retryAfter = Math.ceil((limits.windows[check.window] - (now - check.usage.timestamp)) / 1000);
      return {
        allowed: false,
        reason: 'tokens',
        window: check.window,
        limit: check.tokenLimit,
        used: check.usage.tokens,
        retryAfter: Math.max(1, retryAfter),
        tier: userInfo.tier
      };
    }
    
    if (check.usage.requests >= check.requestLimit) {
      const retryAfter = Math.ceil((limits.windows[check.window] - (now - check.usage.timestamp)) / 1000);
      return {
        allowed: false,
        reason: 'requests',
        window: check.window,
        limit: check.requestLimit,
        used: check.usage.requests,
        retryAfter: Math.max(1, retryAfter),
        tier: userInfo.tier
      };
    }
  }
  
  return { allowed: true, usage, tier: userInfo.tier };
}

/**
 * Update rate limit usage for authenticated user
 */
async function updateUserRateLimitUsage(env, userId, tokensUsed, ctx) {
  if (!env.MEMBERS_KV || tokensUsed <= 0) return;
  
  const now = Date.now();
  const windows = ['minute', 'hour', 'day'];
  
  for (const window of windows) {
    const key = `user_rate:${userId}:${window}`;
    const windowMs = RATE_LIMITS.windows[window];
    
    const data = await env.MEMBERS_KV.get(key, { type: 'json' });
    
    let newData;
    if (!data || (now - data.timestamp > windowMs)) {
      newData = { tokens: tokensUsed, requests: 1, timestamp: now };
    } else {
      newData = {
        tokens: data.tokens + tokensUsed,
        requests: data.requests + 1,
        timestamp: data.timestamp
      };
    }
    
    const elapsed = now - newData.timestamp;
    const remaining = Math.max(60, Math.ceil((windowMs - elapsed) / 1000) + 60);
    
    ctx.waitUntil(env.MEMBERS_KV.put(key, JSON.stringify(newData), { expirationTtl: remaining }));
  }
}

/**
 * Track usage for authenticated user in members system
 */
async function trackUserUsage(env, userInfo, tokensUsed, provider, model, ctx) {
  if (!env.MEMBERS_KV || !userInfo || tokensUsed <= 0) return;
  
  // Update rate limit counters
  await updateUserRateLimitUsage(env, userInfo.user_id, tokensUsed, ctx);
  
  // Update user's total usage in R2 via KV queue (async)
  ctx.waitUntil(updateUserTotalUsage(env, userInfo, tokensUsed, provider, model));
}

/**
 * Update user's total usage stats
 */
async function updateUserTotalUsage(env, userInfo, tokensUsed, provider, model) {
  if (!env.MEMBERS_BUCKET) return;
  
  try {
    // Get current user data
    const userPath = `users/${userInfo.user_id}.json`;
    const userObj = await env.MEMBERS_BUCKET.get(userPath);
    
    if (!userObj) return;
    
    const user = await userObj.json();
    const now = new Date();
    const lastReset = new Date(user.usage?.last_reset || 0);
    
    // Reset daily counters if new day
    if (now.getUTCDate() !== lastReset.getUTCDate() ||
        now.getUTCMonth() !== lastReset.getUTCMonth() ||
        now.getUTCFullYear() !== lastReset.getUTCFullYear()) {
      user.usage = {
        ...user.usage,
        requests_today: 0,
        tokens_today: 0,
        last_reset: now.toISOString()
      };
    }
    
    // Update usage counters
    user.usage = user.usage || { requests_today: 0, tokens_today: 0, total_requests: 0, total_tokens: 0 };
    user.usage.requests_today = (user.usage.requests_today || 0) + 1;
    user.usage.tokens_today = (user.usage.tokens_today || 0) + tokensUsed;
    user.usage.total_requests = (user.usage.total_requests || 0) + 1;
    user.usage.total_tokens = (user.usage.total_tokens || 0) + tokensUsed;
    
    // Update API key usage
    if (userInfo.key_id && user.api_keys) {
      const keyIndex = user.api_keys.findIndex(k => k.id === userInfo.key_id);
      if (keyIndex !== -1) {
        user.api_keys[keyIndex].usage = user.api_keys[keyIndex].usage || { requests: 0, tokens: 0 };
        user.api_keys[keyIndex].usage.requests += 1;
        user.api_keys[keyIndex].usage.tokens += tokensUsed;
        user.api_keys[keyIndex].last_used = now.toISOString();
      }
    }
    
    // Save updated user
    await env.MEMBERS_BUCKET.put(userPath, JSON.stringify(user, null, 2), {
      httpMetadata: { contentType: "application/json" }
    });
    
    // Update KV cache
    await env.MEMBERS_KV.put(`user:${userInfo.user_id}`, JSON.stringify(user), { expirationTtl: 3600 });
    
    // Store daily usage log
    const dateKey = now.toISOString().split("T")[0];
    const usagePath = `usage/${userInfo.user_id}/${dateKey}.json`;
    const existingUsage = await env.MEMBERS_BUCKET.get(usagePath);
    
    let dailyUsage;
    if (existingUsage) {
      dailyUsage = await existingUsage.json();
    } else {
      dailyUsage = { date: dateKey, requests: 0, tokens: 0, providers: {}, models: {} };
    }
    
    dailyUsage.requests += 1;
    dailyUsage.tokens += tokensUsed;
    if (provider) {
      dailyUsage.providers[provider] = (dailyUsage.providers[provider] || 0) + 1;
    }
    if (model) {
      dailyUsage.models[model] = (dailyUsage.models[model] || 0) + 1;
    }
    
    await env.MEMBERS_BUCKET.put(usagePath, JSON.stringify(dailyUsage, null, 2), {
      httpMetadata: { contentType: "application/json" }
    });
    
  } catch (e) {
    console.error('Failed to update user usage:', e);
  }
}