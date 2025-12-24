const API_HOST = "pass.g4f.dev"
const POLLINATIONS_HOST = "pollinations.ai";
const GITHUB_HOST = 'gpt4free.github.io';
const MODEL_ID = "@cf/openai/gpt-oss-120b";
const MAX_CONTENT_LENGHT = 50 * 1024;
const CUSTOM_MAX_LENGHT = 100 * 1024;
const CACHE_CONTROL = 'public, max-age=14400, s-maxage=7200'
const CACHE_FOREVER = 'public, max-age=31536000, immutable';
const TOKEN_LIMIT_PER_MINUTE = 100000;
const TOKEN_WINDOW_MS = 60 * 1000;

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
    "ollama": {endpoint: "https://ollama.com/api/chat", api_key: env.OLLAMA_API_KEY, model: "deepseek-v3.1:671b"},
    "azure": {endpoint: "https://g4f-dev-resource.cognitiveservices.azure.com/openai/deployments/model-router/chat/completions?api-version=2025-01-01-preview", api_key: env.AZURE_API_KEY, model: "model-router"},
    "auto": {endpoint: "https://g4f-dev-resource.cognitiveservices.azure.com/openai/deployments/model-router/chat/completions?api-version=2025-01-01-preview", api_key: env.AZURE_API_KEY, model: "model-router"},
    "grok": {url: "https://api.x.ai/v1", api_key: env.GROK_API_KEY, model: "grok-4-fast-non-reasoning"},
    "x.ai": {url: "https://api.x.ai/v1", api_key: env.GROK_API_KEY, model: "grok-4-fast-non-reasoning"},
    "gemini": {url: "https://generativelanguage.googleapis.com/v1beta/openai", api_key: env.GEMINI_API_KEY, model: "gemini-2.5-flash-lite"},
    "typegpt": {url: "https://typegpt.net/api/v1", api_key: env.TYPEGPT_API_KEY, model: "deepseek-ai/DeepSeek-V3.2-Exp"},
    "pollinations": {endpoint: "https://text.pollinations.ai/openai?referrer=https://g4f.dev/", model: "openai"},
    "pollinations.ai": {endpoint: "https://text.pollinations.ai/openai?referrer=https://g4f.dev/", model: "openai"},
    //"stringable-inf": {url: "https://stringableinf.com/api", endpoint: "https://stringableinf.com/api/v1/chat/completions", extraHeaders: {"HTTP-Referer": "https://g4f.dev/", "X-Title": "G4F API"}, model: "gpt-oss-120b"},
    "api.airforce": {url: "https://api.airforce/v1", model: "deepseek-v3.2", api_key: env.API_AIRFORCE_API_KEY},
    "gpt4free.pro": {url: "https://gpt4free.pro/v1", model: "deepseek-v3.2"},
    "nectar": {url: "https://gen.pollinations.ai", endpoint: "https://gen.pollinations.ai/v1/chat/completions", api_key: env.POLLINATIONS_API_KEY, model: "openai"},
    "audio": {endpoint: "https://g4f-dev-resource.cognitiveservices.azure.com/openai/deployments/gpt-audio/chat/completions?api-version=2025-01-01-preview", api_key: env.AZURE_API_KEY, model: "gpt-audio"},
    "perplexity": {url: "https://perplexity.g4f.workers.dev"},
    "huggingface": {url: "https://pass.g4f.dev/api/HuggingFace", extraHeaders: {"g4f-api-key": "_g4f"}},
    "puter": {url: "https://pass.g4f.dev/api/PuterJS", extraHeaders: {"g4f-api-key": "_g4f"}}
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

  if (pathname == "/api/grok/models") {
    return Response.json({data: [{id: 'grok-4-fast-non-reasoning'}, {id: 'grok-4-fast-reasoning'}, {id: 'grok-code-fast-1'}]}, {headers: ACCESS_CONTROL_ALLOW_ORIGIN});
  } else if (pathname == "/api/auto/models") {
    return Response.json({data: defaultModels}, {headers: ACCESS_CONTROL_ALLOW_ORIGIN});
  } else if (pathname == "/api/audio/models") {
    return Response.json({data: [{id: 'gpt-audio', audio: true}, ...GPT_AUDIO_VOICES.map((voice)=>{return {id: voice, audio: true}})]}, {headers: ACCESS_CONTROL_ALLOW_ORIGIN});
  } else if (pathname == "/api/ollama/models") {
    return forwardApi(request, "https://ollama.com/api/tags");
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

  // Check token usage limit for AI endpoints
  if (pathname.startsWith("/ai/") || pathname.startsWith("/api/") && pathname.endsWith("/chat/completions")) {
    const tokenCheck = await checkTokenLimit(env, request);
    if (!tokenCheck.allowed) {
      return Response.json({error: {message: `Token limit (${TOKEN_LIMIT_PER_MINUTE} tokens/min) exceeded. Used: ${tokenCheck.usage.tokens} tokens.`}}, {status: 429, headers: {"Retry-After": tokenCheck.retryAfter.toString(), ...ACCESS_CONTROL_ALLOW_ORIGIN}});
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
    const authorizationHeader = request.headers.get('authorization') && request.headers.get('authorization') === 'Bearer secret' ? null : request.headers.get('authorization')
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
      if (provider === "ollama") {
        queryBody.format = "json";
      } else {
        queryBody.response_format = {"type": "json_object"};
      }
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
          const trackedStream = createUsageTrackingStream(response, env, clientIP, ctx, provider, queryBody.model);
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
        response.headers.set("x-provider", provider);
        response.headers.set("x-url", queryUrl);
        // Track usage for streaming responses
        if (queryBody.stream) {
          const clientIP = getClientIP(request);
          const trackedStream = createUsageTrackingStream(response, env, clientIP, ctx, provider, queryBody.model);
          const newResponse = new Response(trackedStream, {
            headers: response.headers
          });
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
      await updateTokenUsage(env, clientIP, usage.total, ctx, provider, queryBody.model, usage.prompt, usage.completion);
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
      "x-provider": provider
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
    for (const model in models){
        let subpath = `/api/${model}`;
        if (pathname.startsWith(subpath)) {
          if (!models[model].url && pathname.endsWith("/models")) {
            return Response.json({data: [{id: 'model-router'}]}, {headers: ACCESS_CONTROL_ALLOW_ORIGIN});
          }
          const apiKeys = models[model].api_key ? models[model].api_key.split("\n") : null;
          const selectedApiKey = apiKeys ? apiKeys[apiKeys.length * Math.random() << 0] : null;
          const authorizationHeader = request.headers.get('authorization') && request.headers.get('authorization') === 'Bearer secret' ? null : request.headers.get('authorization')
          const newRequest = new Request(request, {
            headers: {
              'authorization': authorizationHeader || selectedApiKey ? `Bearer ${selectedApiKey}` : null,
              'content-type': request.headers.get("content-type"),
              'user-agent': request.headers.get("user-agent"),
              'referer': request.headers.get("referer")
            }
          });
          let newUrl = pathWithParams.replace(subpath, '');
          if (!models[model].url || (models[model].endpoint && newUrl === "/chat/completions")) {
            newUrl = models[model].endpoint;
          } else {
            newUrl = models[model].url + newUrl;
          }
          let response;
          if (model === "gemini" && pathname.endsWith("/models") && ["HEAD", "GET"].includes(request.method)) {
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
            const trackUsage = pathname.endsWith('/chat/completions') ? { env, ctx, clientIP: getClientIP(request), provider: model } : null;
            response = await forwardApi(newRequest, newUrl, null, null, CACHE_CONTROL, trackUsage);
          }
          return response;
        }
    }
    if (pathname.startsWith("/api/") || pathname.startsWith("/v1/")|| pathname.startsWith("/backend-api/") || pathname == "/openapi.json") {
      const trackUsage = pathname.endsWith('/chat/completions') ? { env, ctx, clientIP: getClientIP(request), provider: 'api' } : null;
      return forwardApi(request, `https://${API_HOST}${pathWithParams}`, liteRequest, ctx, CACHE_CONTROL, trackUsage);
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

async function forwardApi(request, newUrl, liteRequest=null, ctx=null, cache_control = CACHE_CONTROL, trackUsage = null) {
  let modifiedRequest = request;
  
  // For chat completions, inject stream_options to get usage in streaming responses
  let requestModel = null;
  if (trackUsage && request.method === 'POST') {
    try {
      const body = await request.clone().json();
      requestModel = body.model || null;
      if (body.stream) {
        body.stream_options = { include_usage: true };
        modifiedRequest = new Request(request, {
          body: JSON.stringify(body)
        });
      }
    } catch (e) {
      // Ignore JSON parse errors, proceed with original request
    }
  }
  
  const response = await shield(newUrl, modifiedRequest);
  // Track token usage for chat completions
  if (trackUsage && response.ok) {
    const contentType = response.headers.get('content-type') || '';
    // Handle streaming responses (text/event-stream)
    if (contentType.includes('text/event-stream')) {
      const trackedStream = createUsageTrackingStream(response, trackUsage.env, trackUsage.clientIP, trackUsage.ctx, trackUsage.provider, requestModel);
      const newResponse = new Response(trackedStream, {
        headers: response.headers
      });
      for (const [key, value] of Object.entries(ACCESS_CONTROL_ALLOW_ORIGIN)) {
        newResponse.headers.set(key, value);
      }
      return newResponse;
    }
    
    // Handle non-streaming JSON responses
    if (contentType.includes('application/json')) {
      const clonedResponse = response.clone();
      try {
        const data = await clonedResponse.json();
        const usage = extractDetailedUsage(data);
        if (usage.total > 0) {
          await updateTokenUsage(trackUsage.env, trackUsage.clientIP, usage.total, trackUsage.ctx, trackUsage.provider, requestModel, usage.prompt, usage.completion);
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
    }
  }
  
  const newResponse = new Response(response.body, response);
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
    return Response.json({error: {message: `Shield: Status: ${response.status}, Content-Type: '${contentType}', User-Agent: '${options.headers.get('user-agent')}'`}}, {status: 500, headers: {"x-provider": response.headers.get("x-provider"), "x-url": url, ...ACCESS_CONTROL_ALLOW_ORIGIN}});
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

async function getTokenUsage(env, clientIP) {
  if (!env.TOKEN_USAGE) return { tokens: 0, timestamp: Date.now() };
  const key = `token_usage:${clientIP}`;
  const data = await env.TOKEN_USAGE.get(key, { type: 'json' });
  if (!data) return { tokens: 0, timestamp: Date.now() };
  // Reset if window expired
  if (Date.now() - data.timestamp > TOKEN_WINDOW_MS) {
    return { tokens: 0, timestamp: Date.now() };
  }
  return data;
}

async function updateTokenUsage(env, clientIP, tokensUsed, ctx, provider = null, model = null, promptTokens = 0, completionTokens = 0) {
  if (tokensUsed <= 0) return;
  
  // Persist to database
  ctx.waitUntil(persistUsageToDb(env, clientIP, provider, model, tokensUsed, promptTokens, completionTokens));
  
  // Update rate limit KV
  if (!env.TOKEN_USAGE) return;
  const key = `token_usage:${clientIP}`;
  const now = Date.now();
  
  // Get current usage directly from KV
  const data = await env.TOKEN_USAGE.get(key, { type: 'json' });
  
  let newData;
  if (!data || (now - data.timestamp > TOKEN_WINDOW_MS)) {
    // Start new window
    newData = {
      tokens: tokensUsed,
      timestamp: now,
      requests: 1
    };
  } else {
    // Accumulate in existing window
    newData = {
      tokens: data.tokens + tokensUsed,
      timestamp: data.timestamp,
      requests: (data.requests || 0) + 1
    };
  }
  
  // Calculate TTL based on remaining window time plus buffer
  const remainingWindow = Math.max(60, Math.ceil((TOKEN_WINDOW_MS - (now - newData.timestamp)) / 1000) + 60);
  ctx.waitUntil(env.TOKEN_USAGE.put(key, JSON.stringify(newData), { expirationTtl: remainingWindow }));
}

async function checkTokenLimit(env, request) {
  const clientIP = getClientIP(request);
  const usage = await getTokenUsage(env, clientIP);
  if (usage.tokens >= TOKEN_LIMIT_PER_MINUTE) {
    const retryAfter = Math.ceil((TOKEN_WINDOW_MS - (Date.now() - usage.timestamp)) / 1000);
    return { allowed: false, retryAfter: Math.max(1, retryAfter), usage };
  }
  return { allowed: true, usage };
}

function extractUsageFromResponse(responseData) {
  if (responseData?.usage) {
    return responseData.usage.total_tokens || 
           (responseData.usage.prompt_tokens || 0) + (responseData.usage.completion_tokens || 0);
  }
  return 0;
}

function createUsageTrackingStream(response, env, clientIP, ctx, provider = null, model = null) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      
      if (done) {
        // Process any remaining buffer for usage data
        if (buffer) {
          extractUsageFromBuffer(buffer, env, clientIP, ctx, provider, model);
        }
        controller.close();
        return;
      }
      
      const text = decoder.decode(value, { stream: true });
      buffer += text;
      
      // Look for usage in SSE data chunks
      const lines = buffer.split('\n');
      // Keep the last incomplete line in buffer
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const jsonStr = line.slice(6);
            const data = JSON.parse(jsonStr);
            if (data.usage) {
              const usage = extractDetailedUsage(data);
              if (usage.total > 0) {
                ctx.waitUntil(updateTokenUsage(env, clientIP, usage.total, ctx, provider, model, usage.prompt, usage.completion));
              }
            }
          } catch (e) {
            // Ignore parse errors for incomplete chunks
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

function extractUsageFromBuffer(buffer, env, clientIP, ctx, provider = null, model = null) {
  const lines = buffer.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
      try {
        const jsonStr = line.slice(6);
        const data = JSON.parse(jsonStr);
        if (data.usage) {
          const usage = extractDetailedUsage(data);
          if (usage.total > 0) {
            ctx.waitUntil(updateTokenUsage(env, clientIP, usage.total, ctx, provider, model, usage.prompt, usage.completion));
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }
}

// Persist usage to D1 database
async function persistUsageToDb(env, clientIP, provider, model, tokensUsed, promptTokens, completionTokens) {
  if (!env.USAGE_DB) return;
  
  try {
    await env.USAGE_DB.prepare(
      `INSERT INTO usage_logs (ip, provider, model, tokens_total, tokens_prompt, tokens_completion, timestamp) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      clientIP,
      provider || 'unknown',
      model || 'unknown',
      tokensUsed,
      promptTokens || 0,
      completionTokens || 0,
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