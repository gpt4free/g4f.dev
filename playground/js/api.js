const API = (() => {
  const ENDPOINT_TYPES = {
    openai: 'openai',
    anthropic: 'anthropic',
    responses: 'responses',
    google: 'google',
  };

  const IMAGE_MODEL_PATTERNS = [
    /dall-?e/i,
    /stable-?diffusion/i,
    /sdxl/i,
    /sd3/i,
    /sd-/i,
    /midjourney/i,
    /flux/i,
    /imagen/i,
    /kandinsky/i,
    /playground-v/i,
    /ideogram/i,
    /recraft/i,
    /nova-canvas/i,
    /grok.*image/i,
    /image.*gen/i,
    /img-gen/i,
    /diffusion/i,
    /pixart/i,
    /deepfloyd/i,
    /aura-flow/i,
    /kolors/i,
    /image/i,
  ];

  let mcpClient = null;

  function isImageModel(modelName) {
    if (!modelName) return false;
    return IMAGE_MODEL_PATTERNS.some(p => p.test(modelName));
  }

  function classifyModels(models) {
    const chat = [];
    const image = [];
    for (const m of models) {
      if (isImageModel(m)) image.push(m);
      else chat.push(m);
    }
    return { chat, image };
  }

  function getMCPClient() {
    if (typeof MCPClient === 'undefined') return null;
    if (mcpClient) return mcpClient;
    try {
      mcpClient = new MCPClient();
      if (mcpClient.servers.length === 0) {
        try {
          mcpClient.addServer({ name: 'Default', url: 'https://mcp.g4f.space' });
        } catch {}
      }
      mcpClient.fetchAllTools()
        .then(async r => mcpClient.getAllTools())
        .then(tools=>console.log('Fetched MCP tools:', tools))
        .catch(err => console.warn('Error fetching MCP tools:', err));
      return mcpClient;
    } catch {
      return null;
    }
  }

  function getSelectedMCPToolsForAPI() {
    const client = getMCPClient();
    if (!client) return null;
    try {
      const tools = client.getSelectedToolsForAPI();
      return Array.isArray(tools) && tools.length > 0 ? tools : null;
    } catch {
      return null;
    }
  }

  function isEndpointError(body) {
    if (!body) return false;
    const msg = (body.error?.message || body.message || body.detail || '').toLowerCase();
    return msg.includes('does not support') ||
      msg.includes('not found') ||
      msg.includes('not available') ||
      msg.includes('invalid endpoint') ||
      msg.includes('unknown url') ||
      msg.includes('no route');
  }

  async function probeEndpoint(url, fetchOpts) {
    const r = await fetch(url, fetchOpts);
    if (r.status === 404 || r.status === 405) return { ok: false, status: r.status };
    if (r.status >= 200 && r.status < 500) {
      try {
        const text = await r.text();
        const json = JSON.parse(text);
        if (isEndpointError(json)) return { ok: false, status: r.status };
      } catch {}
      return { ok: true, status: r.status };
    }
    return { ok: false, status: r.status };
  }

  async function checkProvider(provider) {
    console.log('Checking provider:', provider);
    if (provider.apiKey && provider.checkUrl && !provider.isNotProviderKey) {
      let result = null;
      try {
        const headers = { 'Authorization': `Bearer ${provider.apiKey}` };
        result = await fetch(provider.checkUrl, { headers });
        if (result.ok) return 'openai';
      } catch {}
      if (result && result.status === 401) {
        throw Object.assign(new Error('Unauthorized'), { status: 401 });
      }
    }
    return detectEndpointType(provider.baseUrl, provider.apiKey, provider.defaultModel);
  }

  async function detectEndpointType(baseUrl, apiKey, model) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const cleanUrl = baseUrl.replace(/\/$/, '');

    const probes = [
      {
        type: 'openai',
        run: () => probeEndpoint(cleanUrl + '/chat/completions', {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: model || 'test', messages: [{ role: 'user', content: 'hi' }] }),
        }),
      },
      {
        type: 'anthropic',
        run: () => {
          const anthropicHeaders = { 'Content-Type': 'application/json', 'x-api-key': apiKey || '', 'anthropic-version': '2023-06-01' };
          return probeEndpoint(cleanUrl.replace(/\/v1$/, '') + '/v1/messages', {
            method: 'POST',
            headers: anthropicHeaders,
            body: JSON.stringify({ model: model || 'test', messages: [{ role: 'user', content: 'hi' }] }),
          });
        },
      },
      {
        type: 'responses',
        run: () => probeEndpoint(cleanUrl + '/responses', {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: model || 'test', input: 'hi', max_output_tokens: 1 }),
        }),
      },
      {
        type: 'google',
        run: async () => {
          const gUrl = cleanUrl.replace(/\/v1beta$/, '') + '/v1beta/models';
          const googleUrl = apiKey ? `${gUrl}?key=${apiKey}` : gUrl;
          const r = await fetch(googleUrl);
          if (r.status === 404 || r.status === 405) return { ok: false, status: r.status };
          try {
            const data = await r.json();
            if (data.models && Array.isArray(data.models)) return { ok: true, status: r.status };
            if (isEndpointError(data)) return { ok: false, status: r.status };
          } catch {}
          return { ok: r.status >= 200 && r.status < 400, status: r.status };
        },
      },
    ];

    for (const probe of probes) {
      try {
        const result = await probe.run();
        if (result.status === 401) throw Object.assign(new Error('Unauthorized'), { status: 401 });
        if (result.ok) return probe.type;
      } catch {}
    }

    return 'openai';
  }

  async function fetchModels(provider) {
    const type = provider.endpointType || provider.type || 'openai';

    if (type === 'anthropic') {
      return fetchModelsAnthropic(provider);
    }
    if (type === 'google') {
      return fetchModelsGoogle(provider);
    }

    const headers = { 'Content-Type': 'application/json' };
    if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
    const res = await fetchWithRetry(`${provider.baseUrl}/models`, { headers });
    if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
    const data = await res.json();
    return (data.data || data.models || []).filter(m => m.id || m);
  }

  async function fetchModelsAnthropic(provider) {
    const baseUrl = provider.baseUrl.replace(/\/$/, '').replace(/\/v1$/, '');
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey || '',
      'anthropic-version': '2023-06-01',
    };
    try {
      const res = await fetchWithRetry(`${baseUrl}/v1/models`, { headers });
      if (res.ok) {
        const data = await res.json();
        return (data.data || []).map(m => m.id).filter(Boolean);
      }
    } catch {}
    return [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-3-5-haiku-20241022',
    ];
  }

  async function fetchModelsGoogle(provider) {
    const baseUrl = provider.baseUrl.replace(/\/$/, '').replace(/\/v1beta$/, '');
    const url = provider.apiKey
      ? `${baseUrl}/v1beta/models?key=${provider.apiKey}`
      : `${baseUrl}/v1beta/models`;
    try {
      const res = await fetchWithRetry(url, {});
      if (res.ok) {
        const data = await res.json();
        return (data.models || [])
          .map(m => m.name?.replace('models/', ''))
          .filter(Boolean);
      }
    } catch {}
    return ['gemini-2.5-flash', 'gemini-2.5-pro'];
  }

  async function generateImage(provider, prompt, model, options = {}) {
    const type = provider.endpointType || provider.type || 'openai';

    if (type === 'google') {
      return generateImageGoogle(provider, prompt, model, options);
    }

    return generateImageOpenAI(provider, prompt, model, options);
  }

  async function generateImageOpenAI(provider, prompt, model, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;

    const body = {
      model: model || 'dall-e-3',
      prompt,
      n: options.n || 1,
      size: options.size || '1024x1024',
    };

    if (options.quality) body.quality = options.quality;
    if (options.style) body.style = options.style;

    const res = await fetchWithRetry(`${provider.baseUrl}/images/generations`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    }, options.maxRetries || 0);

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Image API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    if (data.error) {
      throw new Error(data.error.message || JSON.stringify(data.error));
    }
    return (data.data || []).map(img => ({
      url: img.url || '',
      b64: img.b64_json || '',
      revisedPrompt: img.revised_prompt || '',
    }));
  }

  async function generateImageGoogle(provider, prompt, model, options = {}) {
    const baseUrl = provider.baseUrl.replace(/\/$/, '').replace(/\/v1beta$/, '');
    const modelName = model || 'imagen-3.0-generate-002';

    const body = {
      instances: [{ prompt }],
      parameters: {
        sampleCount: options.n || 1,
      },
    };

    const url = provider.apiKey
      ? `${baseUrl}/v1beta/models/${modelName}:predict?key=${provider.apiKey}`
      : `${baseUrl}/v1beta/models/${modelName}:predict`;

    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal,
    }, options.maxRetries || 0);

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Image error ${res.status}: ${err}`);
    }

    const data = await res.json();
    if (data.error) {
      throw new Error(data.error.message || JSON.stringify(data.error));
    }
    return (data.predictions || []).map(pred => ({
      url: '',
      b64: pred.bytesBase64Encoded || '',
      revisedPrompt: '',
    }));
  }

  async function* streamChat(provider, messages, model, options = {}) {
    const type = provider.endpointType || provider.type || 'openai';

    const ordered = [];
    if (type === 'anthropic') ordered.push('anthropic', 'openai', 'google', 'responses');
    else if (type === 'google') ordered.push('google', 'openai', 'anthropic', 'responses');
    else if (type === 'responses') ordered.push('responses', 'openai', 'anthropic', 'google');
    else ordered.push('openai', 'anthropic', 'google', 'responses');

    const streamFns = {
      openai: streamChatOpenAI,
      anthropic: streamChatAnthropic,
      google: streamChatGoogle,
      responses: streamChatResponses,
    };

    let lastError = null;
    for (const ep of ordered) {
      try {
        let yielded = false;
        for await (const chunk of streamFns[ep](provider, messages, model, options)) {
          yielded = true;
          yield chunk;
        }
        return;
      } catch (err) {
        lastError = err;
      }
    }

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const prompt = lastUserMsg?.content || '';
    if (prompt) {
      try {
        const images = await generateImage(provider, prompt, model, options);
        const validImages = (images || []).filter(img => img.url || img.b64);
        if (validImages.length > 0) {
          for (const img of validImages) {
            yield { type: 'image', url: img.url, b64: img.b64, revisedPrompt: img.revisedPrompt };
          }
          return;
        }
        throw new Error('Image generation returned no images');
      } catch (imgErr) {
        lastError = imgErr;
      }
    }

    if (lastError) throw lastError;
    throw new Error('All endpoints failed for model: ' + (model || 'unknown'));
  }

  const RETRYABLE_PATTERNS = [
    /no available channel/i,
    /rate limit/i,
    /too many requests/i,
    /overloaded/i,
    /temporarily unavailable/i,
    /capacity/i,
    /try again/i,
  ];

  async function fetchWithRetry(url, opts, maxRetries = 0) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await fetch(url, opts);
      if (res.status === 429 && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      const ct = res.headers.get('content-type') || '';
      const isStream = ct.includes('text/event-stream') || ct.includes('application/x-ndjson');
      if (!isStream && attempt < maxRetries) {
        try {
          const clone = res.clone();
          const text = await clone.text();
          if (RETRYABLE_PATTERNS.some(p => p.test(text))) {
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }
        } catch {}
      }
      return res;
    }
  }

  function checkStreamErrorBody(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
      const json = JSON.parse(trimmed);
      if (json.error) {
        return json.error.message || json.error.type || JSON.stringify(json.error);
      }
      if (json.message && json.code) {
        return json.message;
      }
      return null;
    } catch {
      return null;
    }
  }

  function normalizeToolCall(toolCall) {
    if (!toolCall) return null;
    const normalized = { ...toolCall };
    if (!normalized.function && normalized.tool_call) normalized.function = normalized.tool_call;
    if (!normalized.function && normalized.function_call) normalized.function = normalized.function_call;
    return normalized;
  }

  function mergeToolCalls(accumulator, toolCalls) {
    if (!toolCalls) return accumulator;
    const calls = Array.isArray(toolCalls) ? toolCalls : [toolCalls];
    for (const call of calls) {
      const normalized = normalizeToolCall(call);
      if (!normalized) continue;
      const key = normalized.id || `${normalized.function?.name || 'tool'}:${normalized.index ?? ''}`;
      if (!accumulator[key]) {
        accumulator[key] = normalized;
        continue;
      }
      const existing = accumulator[key];
      const existingFn = existing.function || {};
      const incomingFn = normalized.function || {};
      existing.function = existingFn;
      if (incomingFn.name) existing.function.name = incomingFn.name;
      if (incomingFn.arguments) {
        existing.function.arguments = (existingFn.arguments || '') + incomingFn.arguments;
      }
      if (incomingFn.description) existing.function.description = incomingFn.description;
    }
    return accumulator;
  }

  async function executeToolCalls(toolCalls) {
    if (!toolCalls || toolCalls.length === 0) return [];
    return getMCPClient().executeToolCalls(toolCalls.map(normalizeToolCall).filter(Boolean));
  }

  function filterMessages(messages) {
    const assistantFiltered = [];
    let lastMessageIsAssistant = false;
    for (const m of messages) {
      if (m.error) continue;
      if (m.role === 'assistant') {
        if (!lastMessageIsAssistant) {
          lastMessageIsAssistant = true;
          assistantFiltered.push(m);
        }
      } else {
        lastMessageIsAssistant = false;
        assistantFiltered.push(m);
      }
    }
    for (let i = assistantFiltered.length - 1; i >= 0; i--) {
      const m = assistantFiltered[i];
      if (m.role === 'assistant') {
        assistantFiltered.pop();
      } else {
        break;
      }
    }
    return assistantFiltered.map(m => ({ role: m.role, content: m.content, tool_calls: m.tool_calls, name: m.name }));
  }

  async function* streamChatOpenAI(provider, messages, model, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
  
    const body = {
      model: model || provider.defaultModel || 'llama-4-scout',
      messages: filterMessages(messages),
      stream: true
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (options.reasoningEffort) body.reasoning_effort = options.reasoningEffort;

    if (options.tools) {
      body.tools = options.tools;
      body.tool_choice = options.toolChoice || 'auto';
    }

    const res = await fetchWithRetry(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    }, options.maxRetries || 0);

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API error ${res.status}: ${err}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let firstChunk = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      if (firstChunk) {
        firstChunk = false;
        const errMsg = checkStreamErrorBody(buffer);
        if (errMsg) {
          reader.cancel();
          throw new Error(errMsg);
        }
      }

      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta;
            if (delta?.reasoning_content) yield { type: 'thinking', content: delta.reasoning_content };
            if (delta?.reasoning) yield { type: 'thinking', content: delta.reasoning };
            if (delta?.content) yield { type: 'text', content: delta.content };

            let toolCalls = delta?.tool_calls;
            if (!toolCalls && delta?.function_call) toolCalls = [delta.function_call];
            if (!toolCalls && delta?.tool_call) toolCalls = [delta.tool_call];
            if (toolCalls) yield { type: 'tool_calls', tool_calls: Array.isArray(toolCalls) ? toolCalls : [toolCalls] };
          } catch {}
        }
      }
    }

    if (buffer.trim()) {
      const errMsg = checkStreamErrorBody(buffer);
      if (errMsg) throw new Error(errMsg);
    }
  }

  async function* streamChatAnthropic(provider, messages, model, options = {}) {
    const baseUrl = provider.baseUrl.replace(/\/$/, '').replace(/\/v1$/, '');
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey || '',
      'anthropic-version': '2023-06-01',
    };

    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    const body = {
      model: model || provider.defaultModel || 'claude-sonnet-4-20250514',
      messages: nonSystemMsgs,
      stream: true,
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens) body.max_tokens = options.maxTokens;

    if (systemMsg) body.system = systemMsg.content;

    const thinkingBudget = options.maxTokens ? Math.min(options.maxTokens * 2, 16000) : 16000;
    body.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
    body.temperature = 1;

    const res = await fetchWithRetry(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    }, options.maxRetries || 0);

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic error ${res.status}: ${err}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentBlockType = null;
    let firstChunk = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      if (firstChunk) {
        firstChunk = false;
        const errMsg = checkStreamErrorBody(buffer);
        if (errMsg) {
          reader.cancel();
          throw new Error(errMsg);
        }
      }

      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        try {
          const json = JSON.parse(trimmed.slice(6));
          if (json.type === 'content_block_start') {
            currentBlockType = json.content_block?.type;
          }
          if (json.type === 'content_block_delta') {
            if (currentBlockType === 'thinking' && json.delta?.thinking) {
              yield { type: 'thinking', content: json.delta.thinking };
            }
            if (json.delta?.text) {
              yield { type: 'text', content: json.delta.text };
            }
          }
          if (json.type === 'content_block_stop') {
            currentBlockType = null;
          }
        } catch {}
      }
    }
  }

  async function* streamChatGoogle(provider, messages, model, options = {}) {
    const baseUrl = provider.baseUrl.replace(/\/$/, '').replace(/\/v1beta$/, '');
    const modelName = model || provider.defaultModel || 'gemini-2.5-flash';

    const systemMsg = messages.find(m => m.role === 'system');
    const contents = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const genConfig = {
      thinkingConfig: { thinkingBudget: 8000 },
    };
    if (options.temperature !== undefined) genConfig.temperature = options.temperature;
    if (options.maxTokens) genConfig.maxOutputTokens = options.maxTokens;

    const body = {
      contents,
      generationConfig: genConfig,
    };

    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }

    const url = provider.apiKey
      ? `${baseUrl}/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${provider.apiKey}`
      : `${baseUrl}/v1beta/models/${modelName}:streamGenerateContent?alt=sse`;

    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal,
    }, options.maxRetries || 0);

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google error ${res.status}: ${err}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let firstChunk = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      if (firstChunk) {
        firstChunk = false;
        const errMsg = checkStreamErrorBody(buffer);
        if (errMsg) {
          reader.cancel();
          throw new Error(errMsg);
        }
      }

      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        try {
          const json = JSON.parse(trimmed.slice(6));
          const parts = json.candidates?.[0]?.content?.parts || [];
          for (const part of parts) {
            if (part.thought && part.text) {
              yield { type: 'thinking', content: part.text };
            } else if (part.text) {
              yield { type: 'text', content: part.text };
            }
          }
        } catch {}
      }
    }
  }

  async function* streamChatResponses(provider, messages, model, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;

    const input = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const body = {
      model: model || provider.defaultModel || 'gpt-4o',
      input,
      stream: true,
    };
    if (options.maxTokens) body.max_output_tokens = options.maxTokens;
    if (options.temperature !== undefined) body.temperature = options.temperature;

    const res = await fetchWithRetry(`${provider.baseUrl}/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    }, options.maxRetries || 0);

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Responses API error ${res.status}: ${err}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let firstChunk = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      if (firstChunk) {
        firstChunk = false;
        const errMsg = checkStreamErrorBody(buffer);
        if (errMsg) {
          reader.cancel();
          throw new Error(errMsg);
        }
      }

      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            if (json.type === 'response.output_text.delta' && json.delta) {
              yield { type: 'text', content: json.delta };
            }
            if (json.type === 'response.reasoning.delta' && json.delta) {
              yield { type: 'thinking', content: json.delta };
            }
            if (json.type === 'response.reasoning_summary_text.delta' && json.delta) {
              yield { type: 'thinking', content: json.delta };
            }
          } catch {}
        }
      }
    }
  }

  async function chat(provider, messages, model, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;

    const body = {
      model: model || provider.defaultModel || 'llama-4-scout',
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (options.reasoningEffort) body.reasoning_effort = options.reasoningEffort;
    if (options.tools) {
      body.tools = options.tools;
      body.tool_choice = options.toolChoice || 'auto';
    }

    const res = await fetchWithRetry(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, options.maxRetries || 0);

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  function extractThinkingFromText(text) {
    const patterns = [
      { open: '<think>', close: '</think>' },
      { open: '<thinking>', close: '</thinking>' },
      { open: '<thought>', close: '</thought>' },
      { open: '<reasoning>', close: '</reasoning>' },
      { open: '<inner_thought>', close: '</inner_thought>' },
      { open: '<reflection>', close: '</reflection>' },
    ];

    let thinking = '';
    let content = text;

    for (const pat of patterns) {
      const regex = new RegExp(
        pat.open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        '([\\s\\S]*?)' +
        pat.close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'gi'
      );
      const matches = content.matchAll(regex);
      for (const match of matches) {
        thinking += (thinking ? '\n' : '') + match[1].trim();
      }
      content = content.replace(regex, '').trim();
    }

    return { thinking, content };
  }

  return {
    fetchModels, streamChat, chat, detectEndpointType, extractThinkingFromText,
    executeToolCalls, mergeToolCalls, normalizeToolCall, getMCPClient, getSelectedMCPToolsForAPI,
    generateImage, isImageModel, classifyModels, checkProvider, ENDPOINT_TYPES,
  };
})();
