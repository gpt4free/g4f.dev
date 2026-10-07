import { convertModel, getModelLabel } from "./model.js";

/**
 * Extracts the delay time (in seconds) from a "Try again in X seconds" message
 * @param {string} message - The message containing the delay
 * @returns {number|null} - The delay in seconds, or null if no match found
 */
function extractRetryDelay(message) {
    // Regular expression to match "Try again in X seconds" where X can be integer or decimal
    const regex = /(Try again in ([0-9.]+) seconds?|Retry after ([0-9.]+)|Please retry in ([0-9.]+)s)/i;
    const match = message.match(regex);

    const delay = match ? parseFloat(match[2] || match[3] || match[4] || '0') : 0;
    if (delay > 0) {
        return delay;
    }

    return null;
}

async function getErrorMessage(response) {
    try {
        let data = await response.clone().json();
        if (Array.isArray(data) && data) {
            data = data[0];
        }
        if (data.error?.message) {
            return data.error.message
        }
    } catch { }
    return await response.clone().text();
}

function captureUserTierHeaders(headers, usage) {
    if (!headers) return;
    const limitRequests = headers.get('x-ratelimit-limit-requests');
    const limitTokens = headers.get('x-ratelimit-limit-tokens');
    if (!limitRequests && !limitTokens) return;
    const isCached = (usage?.cache || headers.get('x-cache')) === 'HIT';
    const userTier = headers.get('x-user-tier');
    const modelFactor = parseFloat(headers.get('x-ratelimit-model-factor') || '1');
    const remainingRequests = parseInt(headers.get('x-ratelimit-remaining-requests') || '1') - (usage ? 1 : 0);
    let totalTokens = usage?.pollen_cost ? (usage?.pollen_cost * 1e7) : usage?.total_tokens || parseInt(headers.get('x-usage-total-tokens') || '0');
    let remainingTokens = parseInt(headers.get('x-ratelimit-remaining-tokens') || '0');
    if (!isCached && totalTokens > 0) {
        remainingTokens -= totalTokens * modelFactor;
    }
    if (userTier || remainingRequests || remainingTokens || limitRequests || limitTokens) {
        const userInfo = {
            tier: userTier,
            remainingRequests: remainingRequests,
            remainingTokens: remainingTokens,
            limitRequests: limitRequests ? parseInt(limitRequests, 10) : null,
            limitTokens: limitTokens ? parseInt(limitTokens, 10) : null
        };
        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent('userTierUpdate', { detail: userInfo }));
        }
    }
}

const toBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
});

class Client {
    constructor(options = {}) {
        if (!options.baseUrl && !options.apiEndpoint) {
            options.baseUrl = "https://g4f.space/v1";
            options.sleep = 10000;
        }
        this.id = options.id;
        this.baseUrl = options.baseUrl;
        this.apiEndpoint = options.apiEndpoint || `${this.baseUrl}/chat/completions`;
        this.imageEndpoint = options.imageEndpoint || `${this.baseUrl}/images/generations`;
        this.modelsEndpoint = options.modelsEndpoint || `${this.baseUrl}/models`;
        if (!("quotaEndpoint" in options)) {
            this.quotaEndpoint = `${this.baseUrl}/quota`;
        } else {
            this.quotaEndpoint = options.quotaEndpoint;
        }
        this.defaultModel = options.defaultModel;
        this.useModelName = options.useModelName || false;
        this.apiKey = options.apiKey;
        this.extraBody = options.extraBody || {};
        this.logCallback = options.logCallback || console.log;
        this.sleep = options.sleep || 0;

        this.extraHeaders = {
            'Content-Type': 'application/json',
            ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
            ...(options.extraHeaders || {})
        };

        this.modelAliases = options.modelAliases || {};
        this.swapAliases = {}
        Object.keys(this.modelAliases).forEach(key => {
          this.swapAliases[this.modelAliases[key]] = key;
        });

        this._models = options.models || [];
        // Optional custom fetch function (e.g. routed through a Web Worker
        // so streaming continues when the tab is backgrounded).
        this.fetchFn = options.fetchFn || null;
        // Optional fallback API base (e.g. a g4f backend exposing the same
        // provider at {backendUrl}/api/{Provider}). Used when the primary
        // endpoint is unreachable (CORS, proxy or network failures).
        this.fallbackBaseUrl = options.fallbackBaseUrl !== undefined ? options.fallbackBaseUrl : null;
    }

    /**
     * Internal: use the custom fetch function if provided, otherwise global fetch.
     */
    _fetch(url, options) {
        return this.fetchFn ? this.fetchFn(url, options) : fetch(url, options);
    }

    _route(url) {
        return window.framework?.getRoutedUrl(url) ?? url;
    }

    /**
     * Internal: fallback endpoint base, or null when no fallback is available.
     * Subclasses may resolve this lazily (e.g. from framework.backendUrl).
     */
    _getFallbackBaseUrl() {
        return this.fallbackBaseUrl || null;
    }

    /**
     * Internal: map a primary endpoint URL to its fallback counterpart by
     * replacing the primary base URL with the fallback base URL.
     */
    _fallbackUrl(url) {
        const fallbackBase = this._getFallbackBaseUrl();
        if (!fallbackBase || !this.baseUrl || !url.startsWith(this.baseUrl)) {
            return null;
        }
        return fallbackBase + url.slice(this.baseUrl.length);
    }

    /**
     * Internal: fetch with automatic fallback when the primary endpoint is
     * unreachable (network/CORS errors) or clearly broken (403/404/405/5xx).
     * Upstream responses like 401/429 are returned untouched.
     */
    async _fetchWithFallback(url, options) {
        const fallbackUrl = this._fallbackUrl(url);
        let response;
        try {
            response = await this._fetch(url, options);
        } catch (err) {
            if (!fallbackUrl) throw err;
            console.warn(`Request to ${url} failed (${err.message || err}), retrying via fallback: ${fallbackUrl}`);
            return this._fetch(fallbackUrl, options);
        }
        if (!response.ok && fallbackUrl && [403, 404, 405, 429, 500, 501, 502, 503, 504].includes(response.status)) {
            console.warn(`Request to ${url} failed with status ${response.status}, retrying via fallback: ${fallbackUrl}`);
            return this._fetch(fallbackUrl, options);
        }
        return response;
    }

    async _sleep() {
        if (this.sleep && this.lastRequest) {
            let timeSinceLastRequest = Date.now() - this.lastRequest;
            while (this.sleep > timeSinceLastRequest) {
                console.log(`Sleeping for ${this.sleep - timeSinceLastRequest} ms to respect rate limits.`);
                await new Promise(resolve => setTimeout(resolve, this.sleep - timeSinceLastRequest + 100));
                timeSinceLastRequest = Date.now() - this.lastRequest;
            }
        }
        this.lastRequest = Date.now();
    }

    get chat() {
        return {
            completions: {
            create: async (params) => {
                const orginalModel = params.model || this.defaultModel;
                let modelId = orginalModel;
                if(this.modelAliases[modelId]) {
                    modelId = this.modelAliases[modelId];
                }
                if (!modelId) {
                    delete params.model;
                } else {
                    params.model = modelId;
                }
                if (this.extraBody) {
                    params = { ...params, ...this.extraBody };
                }
                if (params.stream && !params.stream_options) {
                    params.stream_options = {include_usage: true};
                }
                this.logCallback && this.logCallback({request: params, type: 'chat'});
                const { signal, ...options } = params;
                const requestOptions = {
                    method: 'POST',
                    headers: this.extraHeaders,
                    body: JSON.stringify(options),
                    signal: signal
                };
                await this._sleep();
                let response = await this._fetchWithFallback(this._route(this.apiEndpoint.replace('{model}', orginalModel)), requestOptions);
                if (response.status === 429) {
                    const delay = parseInt(response.headers.get('Retry-After'), 10) || extractRetryDelay(await response.clone().text()) || this.sleep / 1000 || 10;
                    if (delay > 0 && delay <= 30) {
                        console.log(`Retrying after ${delay} seconds...`);
                        await new Promise(resolve => setTimeout(resolve, delay * 1000));
                        response = await this._fetch(this._route(this.apiEndpoint.replace('{model}', orginalModel)), requestOptions);
                    }
                }
                if (params.stream) {
                    return this._streamCompletion(response);
                } else {
                    return this._regularCompletion(response);
                }
            }
            }
        };
    }

    get models() {
      return {
        list: async () => {
          if (this._models && this._models.length > 0) {
            return this._models.map((model) => convertModel(model, { defaultModel: this.defaultModel, useModelName: this.useModelName }));
          }
          const response = await this._fetchWithFallback(this._route(this.modelsEndpoint.replace('{model}', 'auto')), {
            method: 'GET',
            headers: this.extraHeaders,
            signal: this.modelsSignal?.signal
          });
          delete this.modelsSignal;

          if (!response.ok) {
            throw new Error(`Failed to fetch models: ${response.status}`);
          }

          let data = await response.json();
          data = data.data || data.result || data.models || data;
          data = data.map((model) => convertModel(model, { defaultModel: this.defaultModel, useModelName: this.useModelName }));
          const uniqueModels = {};
          data.forEach(model => {
            if (!uniqueModels[model.id]) {
                uniqueModels[model.id] = model;
            }
          });
          return Object.values(uniqueModels);
        }
      };
    }

    get images() {
        return {
            generate: async (params) => {
                let modelId = params.model;
                if(modelId && this.modelAliases[modelId]) {
                    params.model = this.modelAliases[modelId];
                }
                if (this.imageEndpoint.includes('{prompt}')) {
                    return this._defaultImageGeneration(this.imageEndpoint, params, { headers: this.extraHeaders });
                }
                return this._regularImageGeneration(this.imageEndpoint, params, { headers: this.extraHeaders });
            },

            edit: async (params) => {
                const extraHeaders = {...this.extraHeaders};
                delete extraHeaders['Content-Type'];
                return this._regularImageEditing(this.imageEndpoint.replace('/generations', '/edits'), params, { headers: extraHeaders });
            }
        };
    }

    async _regularImageEditing(imageEndpoint, params, requestOptions) {
        const formData = new FormData();
        Object.entries(params).forEach(([key, value]) => {
            formData.append(key, value);
        });
        const response = await this._fetchWithFallback(this._route(imageEndpoint), {
            method: 'POST',
            body: formData,
            ...requestOptions
        });
        captureUserTierHeaders(response.headers);
        if (!response.ok) {
            const errorBody = await getErrorMessage(response);
            throw new Error(`Status ${response.status}: ${errorBody}`);
        }
        return {data: [{url: await toBase64(await response.blob())}]};
    }

    async getQuota() {
        if (!this.quotaEndpoint) {
            throw new Error("Quota endpoint is not defined");
        }

        const response = await fetch(this._route(this.quotaEndpoint), {
            method: 'GET',
            headers: this.apiKey ? { "Authorization": `Bearer ${this.apiKey}` } : {}
        });
        return response.ok ? response.json() : undefined;
    }

    async _regularCompletion(response) {
        if (!response.ok) {
            const errorBody = await getErrorMessage(response);
            captureUserTierHeaders(response.headers);
            throw new Error(`Status ${response.status}: ${errorBody}`);
        }
        const data = await response.json();
        if (response.headers.get('x-provider')) {
            data.provider = response.headers.get('x-provider');
        }
        if (!data.model && response.headers.get('x-model')) {
            data.model = response.headers.get('x-model');
        }
        if (response.headers.get('x-server')) {
            data.server = response.headers.get('x-server');
        }
        // Capture user tier info from headers
        captureUserTierHeaders(response.headers, data.usage);
        this.logCallback && this.logCallback({response: data, type: 'chat'});
        return data;
    }

    async *_streamCompletion(response) {
      if (!response.ok) {
        const errorBody = await getErrorMessage(response);
        throw new Error(`Status ${response.status}: ${errorBody}`);
      }
      if (!response.body) {
        throw new Error('Streaming not supported in this environment');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let usage = {};
      try {
        while (true) {
          const { done, value } = await reader.read();
          let parts = [];
          if (!done) {
            buffer += decoder.decode(value, { stream: true });
            parts = buffer.split('\n');
            buffer = parts.pop();
          } else if (buffer) {
            parts =  [buffer];
            buffer = '';
          } else {
            // Capture user tier info from headers
            captureUserTierHeaders(response.headers, usage);
            break;
          }
          for (const part of parts) {
            if (!part.trim() || part === 'data: [DONE]') continue;
            try {
              if (part.startsWith('data: ')) {
                const data = JSON.parse(part.slice(6));
                if (data.usage) {
                    usage = data.usage;
                }
                if (data.choices === undefined) {
                    if (data.response) {
                        data.choices = [{delta: {content: "" + data.response}}];
                    }
                    if (data.choices && data.choices[0]?.delta?.reasoning_content) {
                        data.choices[0].delta.reasoning = data.choices[0].delta.reasoning_content;
                    }
                }
                if (response.headers.get('x-provider')) {
                    data.provider = response.headers.get('x-provider');
                }
                if (!data.model && response.headers.get('x-model')) {
                    data.model = response.headers.get('x-model');
                }
                if (response.headers.get('x-server')) {
                    data.server = response.headers.get('x-server');
                }
                this.logCallback && this.logCallback({response: data, type: 'chat'});
                yield data;
              } else if (response.headers.get('Content-Type').startsWith('application/json')) {
                const data = JSON.parse(part);
                if (data.usage) {
                    usage = data.usage;
                }
                if (data.choices && data.choices[0]?.message) {
                    data.choices[0].delta = data.choices[0].message;
                } else if (data.choices === undefined) {
                    if (data.output) {
                        for (const message of data.output) {
                            if (message.type === 'message') {
                                yield {choices: [{delta: {content: message.content[0].text}}]};
                            } else if (message.type === 'reasoning') {
                                yield {choices: [{delta: {reasoning: message.content[0].text}}]};
                            }
                        }
                    } else if (data.message) {
                        if (data.message.thinking) {
                            data.message.reasoning = data.message.thinking;
                        }
                        data.choices = [{delta: data.message}];
                    }
                }
                if (data.model) {
                    data.model = getModelLabel(data.model);
                }
                if (response.headers.get('x-provider')) {
                    data.provider = response.headers.get('x-provider');
                }
                if (response.headers.get('x-server')) {
                    data.server = response.headers.get('x-server');
                }
                this.logCallback && this.logCallback({response: data, type: 'chat'});
                yield data;
            }
            } catch (err) {
              console.error('Error parsing chunk:', part, err);
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    }

    async _defaultImageGeneration(imageEndpoint, params, requestOptions) {
        const payload = {...params};
        const prompt = encodeURIComponent(params.prompt || '').replaceAll('%20', '+');
        delete payload.prompt;
        delete payload.response_format;
        if (payload.nologo === undefined) payload.nologo = true;
        if (payload.size) {
            payload.width = payload.size.split('x')[0];
            payload.height = payload.size.split('x')[1];
            delete payload.size;
        }
        this.logCallback && this.logCallback({request: {prompt, ...payload}, type: 'image'});
        const encodedParams = new URLSearchParams(payload);
        const url = imageEndpoint.replace('{prompt}', prompt) + '?' + encodedParams.toString();
        await this._sleep();
        const response = await fetch(this._route(url), requestOptions);
        this.logCallback && this.logCallback({response: response, type: 'image'});
        if (!response.ok) {
            if (response.headers.get('Retry-After')) {
                const retryAfter = parseInt(response.headers.get('Retry-After'), 10) * 1000;
                console.warn(`Rate limited. Retrying after ${retryAfter} ms.`);
                await new Promise(resolve => setTimeout(resolve, retryAfter));
                return this._defaultImageGeneration(imageEndpoint, params, requestOptions);
            }
            const errorBody = await getErrorMessage(response);
            throw new Error(`Status ${response.status}: ${errorBody}`);
        }
        if (params.response_format === 'b64_json') {
            const data = await response.blob();
            return {data: [{b64_json: await toBase64(data).then(b64 => b64.split(',')[1])}]};
        }
        return {data: [{url: response.url}]}
    }

    async _regularImageGeneration(imageEndpoint, params, requestOptions) {
        requestOptions = {
            method: 'POST',
            body: JSON.stringify(params),
            ...requestOptions
        };
        this.logCallback && this.logCallback({request: params, type: 'image'});
        await this._sleep();
        let response = await this._fetchWithFallback(this._route(imageEndpoint), requestOptions);
        captureUserTierHeaders(response.headers);
        if (!response.ok) {
            const delay = parseInt(response.headers.get('Retry-After'), 10) || extractRetryDelay(await response.clone().text()) || this.sleep / 1000;
            if (delay > 0 && delay <= 30) {
                console.log(`Retrying after ${delay} seconds...`);
                await new Promise(resolve => setTimeout(resolve, delay * 1000));
                response = await this._fetch(this._route(imageEndpoint), requestOptions);
            }
        }
        if (!response.ok) {
            const errorBody = await getErrorMessage(response);
            throw new Error(`Status ${response.status}: ${errorBody}`);
        }
        if (response.headers.get('Content-Type').startsWith('application/json')) {
            const data = await response.json();
            if (response.headers.get('x-pollen-cost')) {
                data.usage = data.usage || {};
                data.usage.pollen_cost = parseFloat(response.headers.get('x-pollen-cost'));
            }
            this.logCallback && this.logCallback({response: data, type: 'image'});
            if (data?.error?.message) {
                throw new Error(`Image generation failed: ${data.error.message}`);
            }
            if (data.image) {
                return {data: [{b64_json: data.image, url: `data:image/png;base64,${data.image}`}]};
            }
            return data;
        }
        return {data: [{url: await toBase64(await response.blob())}]};
    }
}

class Pollinations extends Client {
    constructor(options = {}) {
        super({
            ...options,
            baseUrl: options.baseUrl || 'https://g4f.space/api/pollinations',
            modelAliases: {
                "gpt-image": "gptimage",
                "flux-kontext": "kontext",
                ...(options.modelAliases || {})
            }
        });
    }
}

class Audio extends Client {
    constructor(options = {}) {
        super({
            apiEndpoint: 'https://text.pollinations.ai/openai',
            defaultModel: 'openai-audio',
            ...options
        });
    }

    get chat() {
        return {
            completions: {
            create: async (params) => {
                if (this.extraBody) {
                    params = { ...params, ...this.extraBody };
                }
                const isStream = params.stream;
                if (!params.audio) {
                    params.audio = {
                        "voice": params.model === 'gpt-audio' ? "alloy" : params.model,
                        "format": "mp3"
                    }
                    delete params.stream;
                }
                if (!params.modalities) {
                    params.modalities = ["text", "audio"]
                }
                const { signal, ...options } = params;
                const requestOptions = {
                    method: 'POST',
                    headers: this.extraHeaders,
                    body: JSON.stringify(options),
                    signal: signal
                };
                let response;
                try {
                    if (!this.baseUrl) {
                        throw new Error('No baseUrl defined');
                    }
                    requestOptions.body = JSON.stringify(options);
                    response = await this._fetch(this._route(`${this.baseUrl}/chat/completions`), requestOptions);
                    this.logCallback && this.logCallback({request: options, type: 'chat'});
                } catch(e) {
                    options.model = this.defaultModel;
                    requestOptions.body = JSON.stringify(options);
                    response = await this._fetch(this._route(this.apiEndpoint), requestOptions);
                    this.logCallback && this.logCallback({request: options, type: 'chat'});
                }
                if (isStream) {
                    return this._streamCompletion(response);
                } else {
                    return this._regularCompletion(response);
                }
            }
            }
        };
    }
}

class DeepInfra extends Client {
    constructor(options = {}) {
        super({
            baseUrl: 'https://api.deepinfra.com/v1/openai',
            defaultModel: 'openai/gpt-oss-120b',
            ...options
        });
    }

   get models() {
        const listModels = super.models.list();

        return {
            list: async () => {
                const modelsArray = await listModels; // Await the promise returned by listModels

                return modelsArray.map(model => {
                    // Check if 'metadata' exists and is null, then set type
                    if (!model.type) {
                        if (model.id.toLowerCase().includes('image-edit') || model.id.toLowerCase().includes('kontext')) {
                            model.type = 'image-edit';
                        } else if (model.id.toLowerCase().includes('embedding')) {
                            model.type = 'embedding';
                        } else if ('metadata' in model && model.metadata === null) {
                            model.type = 'image';
                        }
                    }
                    return model;
                });
            }
        };
    }
}

class Puter extends Client {
    constructor(options = {}) {
        super({});
        this.id = 'puter';
        this.quotaEndpoint = options.quotaEndpoint || 'https://api.puter.com/metering/usage';
        this.extraHeaders = {
            "content-type": "application/json",
            ...(options.extraHeaders || {})
        };
        this.defaultModel = options.defaultModel || null;
        this.logCallback = options.logCallback || console.log;
        this.sleep = options.sleep || 0;
        this.puter = null;
    }

    get chat() {
        return {
            completions: {
                create: async (params) => {
                    this.puter = this.puter || await this._injectPuter();
                    const { messages, signal, ...options } = params;
                    if (!options.model && this.defaultModel) {
                        options.model = this.defaultModel;
                    }
                    if (options.stream) {
                        return this._streamPuter(options.model, messages, options);
                    }
                    const response = await this.puter.ai.chat(messages, false, options);
                    this.logCallback && this.logCallback({response: response, type: 'chat'});
                    return {
                        choices: [response]
                    };
                }
            }
        };
    }

    get models() {
      return {
        list: async () => {
            const response = await fetch("https://api.puter.com/puterai/chat/models/", {
                signal: this.modelsSignal?.signal
            });
            let data = await response.json();
            data.models = data.models.filter(model => !model.includes("claude-3-5") && !model.includes("claude-3-7"));
            return data.models.map(model => {
                return convertModel({id: model, type: "chat"});
            });
        }
      };
    }

    async signIn(options = {attempt_temp_user_creation: true}) {
        this.puter = this.puter || await this._injectPuter();
        return this.puter.auth.signIn(options).then((res) => {
            console.log('Puter signed in:', res);
            return res;
        });
    }

    async getQuota() {
        this.apiKey = this.apiKey || (await this.signIn()).token;
        if (!this.apiKey) {
            throw new Error('Puter requires an API key to check quota. Please set the "puter.auth.token" in localStorage.');
        }
        return super.getQuota();
    }

    async _injectPuter() {
        return new Promise((resolve, reject) => {
            if (typeof window === 'undefined') {
                reject(new Error('Puter can only be used in a browser environment'));
                return;
            }
            if (window.puter) {
                resolve(puter);
                return;
            }
            var tag = document.createElement('script');
            tag.src = "https://js.puter.com/v2/";
            tag.onload = () => {
                resolve(puter);
            }
            tag.onerror = reject;
            var firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        });
    }

    async *_streamPuter(model, messages, options = {}) {
        this.logCallback && this.logCallback({request: {messages, ...options}, type: 'chat'});
        let idx = 0;
        for await (const item of await this.puter.ai.chat(messages, false, options)) {
          item.model = model;
          this.logCallback && this.logCallback({response: item, type: 'chat'});
          if (item.type === 'tool_use') {
            yield {choices: [{delta: {tool_calls: [{
                id: item.id,
                index: idx++,
                type: 'function',
                function: {
                    name: item.name,
                    arguments: item.input
                }
            }]}}]};
          } else if (item.text) {
            yield {choices: [{delta: {content: item.text}}]}
          } else if (item.reasoning) {
            yield {choices: [{delta: {reasoning: item.reasoning}}]}
          } else {
            yield item;
          }
        }
    }
}

class HuggingFace extends Client {
    constructor(options = {}) {
        if (!options.apiKey) {
            if (typeof process !== 'undefined' && process.env.HUGGINGFACE_API_KEY) {
                options.apiKey = process.env.HUGGINGFACE_API_KEY;
            } else if (typeof localStorage !== "undefined" && localStorage.getItem("HuggingFace-api_key")) {
                options.apiKey = localStorage.getItem("HuggingFace-api_key");
            }
        }
        super({
            modelAliases: {
                // Chat //
                "llama-3": "meta-llama/Llama-3.3-70B-Instruct",
                "llama-3.3-70b": "meta-llama/Llama-3.3-70B-Instruct",
                "command-r-plus": "CohereForAI/c4ai-command-r-plus-08-2024",
                "deepseek-r1": "deepseek-ai/DeepSeek-R1",
                "deepseek-v3": "deepseek-ai/DeepSeek-V3",
                "qwq-32b": "Qwen/QwQ-32B",
                "nemotron-70b": "nvidia/Llama-3.1-Nemotron-70B-Instruct-HF",
                "qwen-2.5-coder-32b": "Qwen/Qwen2.5-Coder-32B-Instruct",
                "llama-3.2-11b": "meta-llama/Llama-3.2-11B-Vision-Instruct",
                "mistral-nemo": "mistralai/Mistral-Nemo-Instruct-2407",
                "phi-3.5-mini": "microsoft/Phi-3.5-mini-instruct",
                "gemma-3-27b": "google/gemma-3-27b-it",
                // Image //
                "flux": "black-forest-labs/FLUX.1-dev",
                "flux-dev": "black-forest-labs/FLUX.1-dev",
                "flux-schnell": "black-forest-labs/FLUX.1-schnell",
                "stable-diffusion-3.5-large": "stabilityai/stable-diffusion-3.5-large",
                "sdxl-1.0": "stabilityai/stable-diffusion-xl-base-1.0",
                "sdxl-turbo": "stabilityai/sdxl-turbo",
                "sd-3.5-large": "stabilityai/stable-diffusion-3.5-large",
            },
            ...options,
            baseUrl: options.baseUrl || 'https://router.huggingface.co/v1',
            quotaEndpoint: options.quotaEndpoint
        });
    }
}

class WebGPU extends Client {
    constructor(options = {}) {
        super({
            ...options,
            baseUrl: options.baseUrl || 'webgpu://local',
            quotaEndpoint: null
        });
        this.id = options.id || 'webgpu';
        this.defaultModel = options.defaultModel || 'Llama-3.1-8B-Instruct-q4f32_1-MLC';
        this.logCallback = options.logCallback || console.log;
        this.progressCallback = options.progressCallback || null;
        // Filter the model catalogue by the device's available memory (RAM/VRAM)
        this.filterByMemory = options.filterByMemory !== false;

        // Singleton engine cache keyed by model id
        this._engines = {};
        this._webllm = null;
    }

    /**
     * Check whether the current browser supports WebGPU.
     * @returns {Promise<boolean>}
     */
    static async isSupported() {
        if (typeof navigator === 'undefined' || !navigator.gpu) return false;
        try {
            const adapter = await navigator.gpu.requestAdapter();
            return !!adapter;
        } catch {
            return false;
        }
    }

    /**
     * Estimate the memory available for local inference, in MB.
     *
     * Browsers don't expose VRAM size, so this mirrors the WebLLM demo
     * heuristic based on navigator.deviceMemory (approximate RAM in GB,
     * capped at 8 by spec): a model fits if
     *   vram_required_MB * 1.2 < 0.95 * deviceMemory * 1024
     * The returned value is the largest vram_required_MB that fits.
     * Returns Infinity when memory cannot be determined (no filtering).
     */
    static getAvailableMemoryMB() {
        const gb = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 0;
        if (!gb) return Infinity;
        return Math.floor(gb * 1024 * 0.95 / 1.2);
    }

    /**
     * Check whether a model fits into the device's available memory.
     * @param {{vram_required_MB?: number}} model
     * @returns {boolean|null} true/false, or null when memory is unknown
     */
    static fitsInMemory(model) {
        const availableMB = WebGPU.getAvailableMemoryMB();
        if (availableMB === Infinity) return null;
        const required = model.vram_required_MB;
        if (typeof required !== 'number') return null;
        return required <= availableMB;
    }

    /**
     * Lazily import @mlc-ai/web-llm from the ESM CDN.
     */
    async _loadWebLLM() {
        if (this._webllm) return this._webllm;
        this._webllm = await import(
            /* webpackIgnore: true */
            'https://esm.run/@mlc-ai/web-llm'
        );
        return this._webllm;
    }

    /**
     * Get (or create) a cached MLC engine for the given model.
     */
    async _getEngine(modelId) {
        if (this._engines[modelId]) return this._engines[modelId];
        const webllm = await this._loadWebLLM();
        const engine = await webllm.CreateMLCEngine(modelId, {
            initProgressCallback: (progress) => {
                if (this.progressCallback) {
                    this.progressCallback(progress);
                } else {
                    console.log(`[WebGPU] ${progress.text}`);
                }
            }
        });
        this._engines[modelId] = engine;
        return engine;
    }

    get chat() {
        return {
            completions: {
                create: async (params) => {
                    const modelId = params.model || this.defaultModel;
                    const engine = await this._getEngine(modelId);
                    const { signal, ...options } = params;
                    options.model = modelId;

                    this.logCallback && this.logCallback({ request: options, type: 'chat' });

                    if (params.stream) {
                        return this._streamWebGPU(engine, options);
                    }

                    const response = await engine.chat.completions.create(options);
                    response.provider = 'WebGPU (local)';
                    this.logCallback && this.logCallback({ response, type: 'chat' });
                    return response;
                }
            }
        };
    }

    get models() {
        return {
            list: async () => {
                const webllm = await this._loadWebLLM();
                // prebuiltAppConfig contains the catalogue of available models
                let models = (webllm.prebuiltAppConfig?.model_list || []).map(m => {
                    const id = m.model_id || m.model;
                    const required = m.vram_required_MB;
                    const size = typeof required === 'number' && required > 0
                        ? required >= 1024
                            ? `${(required / 1024).toFixed(1)} GB`
                            : `${Math.round(required)} MB`
                        : null;
                    return {
                        id,
                        label: size ? `${id} · ${size}` : id,
                        type: m.model_type == 1 ? 'embedding' : 'chat',
                        ...m
                    };
                });
                // Drop models that exceed the device's available memory
                if (this.filterByMemory) {
                    const availableMB = WebGPU.getAvailableMemoryMB();
                    if (availableMB !== Infinity) {
                        const fits = models.filter(m =>
                            typeof m.vram_required_MB !== 'number' || m.vram_required_MB <= availableMB
                        );
                        // never filter down to zero — keep the catalogue usable
                        if (fits.length) models = fits;
                    }
                }
                return models;
            }
        };
    }

    get images() {
        return {
            generate: async () => {
                throw new Error('WebGPU provider does not support image generation. Use a cloud provider for images.');
            },
            edit: async () => {
                throw new Error('WebGPU provider does not support image editing. Use a cloud provider for images.');
            }
        };
    }

    async *_streamWebGPU(engine, options) {
        this.logCallback && this.logCallback({ request: options, type: 'chat' });
        const stream = await engine.chat.completions.create({ ...options, stream: true });
        for await (const chunk of stream) {
            chunk.provider = 'WebGPU (local)';
            this.logCallback && this.logCallback({ response: chunk, type: 'chat' });
            yield chunk;
        }
    }
}

/**
 * Local 1-bit Bonsai models running entirely in the browser on WebGPU
 * via @huggingface/transformers (same engine as the official HF Space).
 */
class Bonsai extends Client {
    constructor(options = {}) {
        super({
            ...options,
            baseUrl: options.baseUrl || "webgpu://bonsai",
            quotaEndpoint: null,
        });
        this.id = options.id || "bonsai";
        this.defaultModel = options.defaultModel || "1.7b";
        this.logCallback = options.logCallback || console.log;
        this.progressCallback = options.progressCallback || null;

        // Map friendly keys → Hugging Face model IDs (extend as new sizes appear)
        this.MODEL_IDS = {
            "1.7b": "onnx-community/Bonsai-1.7B-ONNX",
            // add more when available, e.g.
            // "8b": "onnx-community/Bonsai-8B-ONNX",
            ...(options.modelAliases || {}),
        };

        this._pipeline = null;          // cached transformers pipeline
        this._currentKey = null;
        this._pastKeyValues = null;     // DynamicCache
        this._stoppingCriteria = null;  // InterruptableStoppingCriteria
        this._transformers = null;      // lazy-loaded module
    }

    /** Check WebGPU availability (same heuristic as the official worker). */
    static async isSupported() {
        if (typeof navigator === "undefined" || !navigator.gpu) return false;
        try {
            const adapter = await navigator.gpu.requestAdapter();
            return !!adapter;
        } catch {
            return false;
        }
    }

    /** Lazy-load @huggingface/transformers from the ESM CDN. */
    async _loadTransformers() {
        if (this._transformers) return this._transformers;
        this._transformers = await import(
            /* webpackIgnore: true */
            "https://cdn.jsdelivr.net/npm/@huggingface/transformers"
        );
        return this._transformers;
    }

    /** Dispose previous KV cache when switching models. */
    _disposeCache() {
        this._pastKeyValues?.dispose?.();
        this._pastKeyValues = null;
    }

    /**
     * Get (or create) a text-generation pipeline for the requested model key.
     * Performs the same “warm-up” generate call that the official worker uses
     * to force 1-bit kernel compilation.
     */
    async _getPipeline(modelKey) {
        const modelId = this.MODEL_IDS[modelKey];
        if (!modelId) throw new Error(`Unknown Bonsai model: ${modelKey}`);

        if (this._pipeline && this._currentKey === modelKey) {
            return this._pipeline;
        }

        // model change → drop old cache
        if (this._currentKey && this._currentKey !== modelKey) {
            this._disposeCache();
        }
        this._currentKey = modelKey;

        const { pipeline, TextStreamer, DynamicCache, InterruptableStoppingCriteria } =
            await this._loadTransformers();

        this._stoppingCriteria = new InterruptableStoppingCriteria();

        this.logCallback?.({ status: "loading", data: "Loading Bonsai model…" });

        this._pipeline = await pipeline("text-generation", modelId, {
            device: "webgpu",
            dtype: "q1",
            progress_callback: (info) => {
                if (this.progressCallback) {
                    this.progressCallback(info);
                } else if (info.status === "progress") {
                    this.logCallback?.({
                        status: "progress",
                        progress: info.progress,
                        loaded: info.loaded,
                        total: info.total,
                    });
                }
            },
        });

        // Force 1-bit kernel compilation (exactly as the HF worker does)
        this.logCallback?.({ status: "loading", data: "Optimizing model for 1-bit execution" });
        const inputs = this._pipeline.tokenizer("a");
        await this._pipeline.model.generate({ ...inputs, max_new_tokens: 1 });

        this.logCallback?.({ status: "ready" });
        return this._pipeline;
    }

    get chat() {
        return {
            completions: {
                create: async (params) => {
                    const modelKey = params.model || this.defaultModel;
                    const generator = await this._getPipeline(modelKey);

                    const { signal, stream, messages, ...options } = params;
                    options.max_new_tokens ??= 1024;
                    options.do_sample ??= false;

                    this.logCallback?.({ request: { model: modelKey, ...options }, type: "chat" });

                    // Always keep a DynamicCache for multi-turn
                    this._pastKeyValues ??= new (await this._loadTransformers()).DynamicCache();

                    if (stream) {
                        return this._streamBonsai(generator, messages, options);
                    }

                    // Non-streaming path
                    const output = await generator(messages, {
                        ...options,
                        past_key_values: this._pastKeyValues,
                        stopping_criteria: this._stoppingCriteria,
                    });

                    const content = output[0].generated_text.at(-1).content;
                    const response = {
                        choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
                        model: modelKey,
                        provider: "Bonsai (local WebGPU)",
                    };
                    this.logCallback?.({ response, type: "chat" });
                    return response;
                },
            },
        };
    }

    async *_streamBonsai(generator, messages, options) {
        const { TextStreamer } = await this._loadTransformers();
        let startTime;
        let numTokens = 0;
        let tps;

        // Bridge the callback-based TextStreamer into an async generator
        const queue = [];
        let resolveNext = null;
        let done = false;
        let error = null;

        const push = (value) => {
            if (resolveNext) {
                resolveNext({ value, done: false });
                resolveNext = null;
            } else {
                queue.push(value);
            }
        };

        const streamer = new TextStreamer(generator.tokenizer, {
            skip_prompt: true,
            skip_special_tokens: true,
            callback_function: (output) => {
                push({
                    choices: [{ delta: { content: output }, index: 0 }],
                    model: this._currentKey,
                    provider: "Bonsai (local WebGPU)",
                    tps,
                    numTokens,
                });
            },
            token_callback_function: () => {
                startTime ??= performance.now();
                if (numTokens++ > 0) {
                    tps = (numTokens / (performance.now() - startTime)) * 1000;
                }
            },
        });

        this._stoppingCriteria.reset();

        // Start generation in the background
        const generationPromise = generator(messages, {
            ...options,
            streamer,
            past_key_values: this._pastKeyValues,
            stopping_criteria: this._stoppingCriteria,
        }).then(() => {
            done = true;
            if (resolveNext) {
                resolveNext({ value: undefined, done: true });
                resolveNext = null;
            }
        }).catch((e) => {
            if (e.name !== "AbortError") {
                error = e;
                done = true;
                if (resolveNext) {
                    resolveNext({ value: undefined, done: true });
                    resolveNext = null;
                }
            } else {
                done = true;
                if (resolveNext) {
                    resolveNext({ value: undefined, done: true });
                    resolveNext = null;
                }
            }
        });

        try {
            while (true) {
                if (queue.length > 0) {
                    yield queue.shift();
                    continue;
                }
                if (done) {
                    if (error) throw error;
                    break;
                }
                // Wait for the next chunk
                const next = await new Promise((resolve) => {
                    resolveNext = resolve;
                });
                if (next.done) {
                    if (error) throw error;
                    break;
                }
                yield next.value;
            }
        } finally {
            // Ensure generation is fully settled
            await generationPromise;
        }
    }

    get models() {
        return {
            list: async () => {
                return Object.keys(this.MODEL_IDS).map((key) =>
                    convertModel({
                        id: key,
                        label: `Bonsai ${key.toUpperCase()} (1-bit WebGPU)`,
                        type: "chat",
                    })
                );
            },
        };
    }

    get images() {
        return {
            generate: async () => {
                throw new Error("Bonsai provider does not support image generation.");
            },
            edit: async () => {
                throw new Error("Bonsai provider does not support image editing.");
            },
        };
    }

    /** Allow the caller to abort generation (mirrors the worker’s “interrupt”). */
    interrupt() {
        this._stoppingCriteria?.interrupt();
    }

    /** Drop the KV cache (new conversation). */
    reset() {
        this._disposeCache();
        this._stoppingCriteria?.reset();
    }
}

/**
 * Bonsai 2 (Ternary-Bonsai-2-27B) running entirely in the browser on WebGPU
 * via the local bonsai2-engine (GGUF, 1-bit ternary weights).
 */
class Bonsai2 extends Client {
    constructor(options = {}) {
        super({
            ...options,
            baseUrl: options.baseUrl || "webgpu://bonsai2",
            quotaEndpoint: null,
        });
        this.id = options.id || "bonsai2";
        this.defaultModel = options.defaultModel || "27b";
        this.logCallback = options.logCallback || console.log;
        this.progressCallback = options.progressCallback || null;

        // Friendly keys → GGUF model ids on Hugging Face
        this.MODEL_IDS = {
            "27b": "prism-ml/Ternary-Bonsai-2-27B-gguf",
            ...(options.modelAliases || {}),
        };

        this._engine = null;        // cached bonsai2 engine instance
        this._currentKey = null;
        this._engineModule = null;  // lazy-loaded module
    }

    /** Check WebGPU availability (same heuristic as the other local providers). */
    static async isSupported() {
        if (typeof navigator === "undefined" || !navigator.gpu) return false;
        try {
            const adapter = await navigator.gpu.requestAdapter();
            return !!adapter;
        } catch {
            return false;
        }
    }

    /** Lazy-load the local bonsai2 engine module. */
    async _loadEngineModule() {
        if (this._engineModule) return this._engineModule;
        this._engineModule = await import("./vendor/bonsai2-engine.js");
        return this._engineModule;
    }

    /** Dispose the loaded engine (model switch or explicit release). */
    _disposeEngine() {
        this._engine?.dispose?.();
        this._engine = null;
        this._currentKey = null;
    }

    /**
     * Get (or create) a loaded engine for the requested model key.
     * Reports load progress via progressCallback / logCallback.
     */
    async _getEngine(modelKey) {
        const modelId = this.MODEL_IDS[modelKey];
        if (!modelId) throw new Error(`Unknown Bonsai 2 model: ${modelKey}`);

        if (this._engine && this._currentKey === modelKey) {
            return this._engine;
        }

        // model change → drop old engine
        if (this._engine && this._currentKey !== modelKey) {
            this._disposeEngine();
        }

        const { Bonsai2Engine } = await this._loadEngineModule();

        const onProgress = (info) => {
            if (this.progressCallback) {
                this.progressCallback(info);
            } else if (info?.message) {
                this.logCallback?.({ status: info.status || "loading", data: info.message });
            }
        };

        this.logCallback?.({ status: "loading", data: "Loading Bonsai 2 model…" });

        this._engine = await Bonsai2Engine.load(modelId, { onProgress });
        this._currentKey = modelKey;

        this.logCallback?.({ status: "ready" });
        return this._engine;
    }

    get chat() {
        return {
            completions: {
                create: async (params) => {
                    const modelKey = params.model || this.defaultModel;
                    const engine = await this._getEngine(modelKey);

                    const { signal, stream, messages, ...options } = params;
                    options.maxNewTokens ??= 1024;

                    this.logCallback?.({ request: { model: modelKey, ...options }, type: "chat" });

                    if (stream) {
                        return this._streamBonsai2(engine, messages, options, signal);
                    }

                    // Non-streaming path
                    let content = "";
                    for await (const part of engine.generate(messages, options)) {
                        if (signal?.aborted) break;
                        content = part.text;
                    }

                    const response = {
                        choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
                        model: modelKey,
                        provider: "Bonsai 2 (local WebGPU)",
                    };
                    this.logCallback?.({ response, type: "chat" });
                    return response;
                },
            },
        };
    }

    async *_streamBonsai2(engine, messages, options, signal) {
        let startTime;
        let numTokens = 0;
        let tps;

        for await (const part of engine.generate(messages, options)) {
            if (signal?.aborted) break;
            numTokens++;
            startTime ??= performance.now();
            if (startTime) {
                tps = (numTokens / (performance.now() - startTime)) * 1000;
            }
            yield {
                choices: [{ delta: { content: part.delta ?? "" }, index: 0 }],
                model: this._currentKey,
                provider: "Bonsai 2 (local WebGPU)",
                tps,
                numTokens,
            };
        }
    }

    get models() {
        return {
            list: async () => {
                return Object.keys(this.MODEL_IDS).map((key) =>
                    convertModel({
                        id: key,
                        label: `Bonsai 2 ${key.toUpperCase()} (WebGPU)`,
                        type: "chat",
                    })
                );
            },
        };
    }

    get images() {
        return {
            generate: async () => {
                throw new Error("Bonsai 2 provider does not support image generation.");
            },
            edit: async () => {
                throw new Error("Bonsai 2 provider does not support image editing.");
            },
        };
    }

    /** Abort the current generation (the engine loop checks the signal). */
    interrupt() {
        // handled via AbortSignal passed in create(); nothing cached to reset
    }

    /** Drop the engine cache (new conversation). */
    reset() {
        // Keep the loaded engine; only generation state is per-call.
    }
}

/**
 * Chrome built-in AI provider (Gemini Nano) using the Prompt API.
 * Runs entirely locally in Chrome: https://developer.chrome.com/docs/ai/prompt-api
 */
class ChromeAI extends Client {
    constructor(options = {}) {
        super({
            ...options,
            baseUrl: options.baseUrl || 'chrome://local',
            quotaEndpoint: null
        });
        this.id = options.id || 'chromeai';
        this.defaultModel = options.defaultModel || 'gemini-nano';
        this.logCallback = options.logCallback || console.log;
        this.progressCallback = options.progressCallback || null;
        // Cached LanguageModel session
        this._session = null;
    }

    static get allowedLanguages() {
        return ["de", "en", "es", "fr", "ja"];
    }

    static get currentLanguage() {
        function baseLanguage(tag) {
            return (tag || "en").split(/[-_]/)[0].toLowerCase();
        }
        return baseLanguage(window.framework?.getLanguage?.() || navigator.language);
    }

    /**
     * Check whether the Chrome built-in Prompt API is available.
     * @returns {Promise<boolean>}
     */
    static async isSupported() {
        if (!ChromeAI.allowedLanguages.includes(ChromeAI.currentLanguage)) return false;
        if (typeof self === 'undefined' || !self.LanguageModel) return false;
        try {
            const availability = await self.LanguageModel.availability();
            return !!availability && availability !== 'unavailable';
        } catch {
            return false;
        }
    }


    /**
     * Get (or create) the cached LanguageModel session.
     * System prompts are not accepted by session.prompt() and must be passed
     * via initialPrompts, so they are applied on a cheap session clone.
     */
    async _getSession(systemMessages = []) {
        if (!this._session) {
            this._session = await LanguageModel.create({
                expectedInputs: [
                    { type: "text", languages: ["en", this.currentLanguage] }
                ],
                expectedOutputs: [
                    { type: "text", languages: ["en", this.currentLanguage] }
                ],
                initialPrompts: [],
                monitor: this.progressCallback ? (monitor) => {
                    monitor.addEventListener('downloadprogress', (e) => {
                        this.progressCallback({
                            progress: e.loaded,
                            text: `Downloading Gemini Nano: ${Math.round(e.loaded * 100)}%`
                        });
                    });
                } : undefined,
            });
        }
        if (systemMessages.length) {
            try {
                return await this._session.clone({ initialPrompts: systemMessages });
            } catch {
                // Older Chrome versions may not support clone(); fall back to the base session.
            }
        }
        return this._session;
    }

    get chat() {
        return {
            completions: {
                create: async (params) => {
                    const { signal, stream, messages, ...options } = params;
                    const model = params.model || this.defaultModel;
                    const systemMessages = (messages || []).filter((m) => m.role === "system");
                    const promptMessages = (messages || []).filter((m) => m.role !== "system");
                    const input = promptMessages.length ? promptMessages : "";
                    const session = await this._getSession(systemMessages);

                    this.logCallback && this.logCallback({ request: { model, messages, ...options }, type: 'chat' });

                    if (stream) {
                        return this._streamChromeAI(session, input, model, signal);
                    }

                    const content = await session.prompt(input);
                    const response = {
                        choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
                        model,
                        provider: "Chrome AI (local Gemini Nano)",
                    };
                    this.logCallback && this.logCallback({ response, type: 'chat' });
                    return response;
                }
            }
        };
    }

    async *_streamChromeAI(session, input, model, signal) {
        let startTime;
        let numTokens = 0;
        let tps;

        for await (const chunk of session.promptStreaming(input)) {
            if (signal?.aborted) break;
            numTokens++;
            startTime ??= performance.now();
            if (startTime) {
                tps = (numTokens / (performance.now() - startTime)) * 1000;
            }
            yield {
                choices: [{ delta: { content: chunk ?? "" }, index: 0 }],
                model,
                provider: "Chrome AI (local Gemini Nano)",
                tps,
                numTokens,
            };
        }
    }

    get models() {
        return {
            list: async () => {
                return [convertModel({
                    id: 'gemini-nano',
                    label: 'Gemini Nano (Chrome built-in)',
                    type: 'chat',
                })];
            }
        };
    }

    get images() {
        return {
            generate: async () => {
                throw new Error('Chrome AI provider does not support image generation. Use a cloud provider for images.');
            },
            edit: async () => {
                throw new Error('Chrome AI provider does not support image editing. Use a cloud provider for images.');
            }
        };
    }

    /** Abort the current generation. */
    interrupt() {
        try { this._session?.interrupt?.(); } catch { /* noop */ }
    }

    /** Destroy the cached session (frees model resources). */
    reset() {
        try { this._session?.destroy?.(); } catch { /* noop */ }
        this._session = null;
    }
}

class LLM7 extends Client {
    constructor(options = {}) {
        options.baseUrl = options.baseUrl ?? "https://api.llm7.io/v1";
        options.quotaEndpoint = options.quotaEndpoint ?? null;
        options.defaultModel = options.defaultModel || "default";
        options.models = options.models || ["default", "fast"];
        super(options);
    }
}

/**
 * Default CORS proxy prefix for providers whose APIs do not send CORS
 * headers (Kilo, OpenCode, ...). corsfix.com is free for localhost and
 * registered domains. Pass `corsProxy: false` to disable proxying or
 * `corsProxy: "https://my-proxy/?"` to use a custom prefix.
 */
const DEFAULT_CORS_PROXY = "https://proxy.corsfix.com/?";

function withCorsProxy(url, proxy = DEFAULT_CORS_PROXY) {
    if (!proxy || url.startsWith(proxy)) return url;
    return proxy + url;
}

function randomClientId(prefix) {
    const uuid = typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    return `${prefix}_${uuid.replaceAll("-", "").slice(0, 24)}`;
}

/**
 * Kilo Gateway (kilo.ai) — OpenAI compatible API with a free tier.
 * Anonymous access is limited to free models (e.g. "kilo-auto/free");
 * pass an apiKey to unlock all models. The API does not send CORS
 * headers, so requests are routed through a CORS proxy by default.
 * When the proxy or API is unreachable, requests fall back to a g4f
 * backend exposing the provider at {backendUrl}/api/Kilo.
 */
class Kilo extends Client {
    constructor(options = {}) {
        const corsProxy = options.corsProxy === undefined ? DEFAULT_CORS_PROXY : options.corsProxy;
        const baseUrl = options.baseUrl || "https://api.kilo.ai/api/gateway/v1";
        super({
            defaultModel: "kilo-auto/free",
            quotaEndpoint: null,
            ...options,
            baseUrl: withCorsProxy(baseUrl, corsProxy),
        });
        this.id = options.id || "kilo";
        this.corsProxy = corsProxy;
        this._baseUrl = baseUrl;
    }

    _fallbackUrl(url) {
        if (this.fallbackBaseUrl !== null) {
            return this.fallbackBaseUrl || null;
        }
        const backendUrl = (typeof window !== "undefined" && window.framework?.backendUrl) || "";
        const subPath = url.substring(this.baseUrl.length).replace(/^\/+/, "");
        return backendUrl ? `${backendUrl}/proxy/${this._baseUrl}/${subPath}` : null;
    }

    get models() {
        return {
            list: async () => {
                const models = await super.models.list();
                if (this.apiKey) {
                    return models;
                }
                // Anonymous requests are restricted to the free tier
                return models.filter((model) =>
                    model.id === "kilo-auto/free" || model.id.endsWith(":free")
                );
            }
        };
    }
}

/**
 * OpenCode Zen (opencode.ai) — OpenAI compatible API with free models.
 * Free models require the "public" access token plus OpenCode client
 * headers. The API does not send CORS headers, so requests are routed
 * through a CORS proxy by default. When the proxy or API is unreachable,
 * requests fall back to a g4f backend exposing the provider at
 * {backendUrl}/api/OpenCode.
 */
class OpenCode extends Client {
    constructor(options = {}) {
        const corsProxy = options.corsProxy === undefined ? DEFAULT_CORS_PROXY : options.corsProxy;
        const baseUrl = options.baseUrl || "https://opencode.ai/zen/v1";
        super({
            defaultModel: "space-bunny-free",
            quotaEndpoint: null,
            ...options,
            apiKey: options.apiKey || "public",
            baseUrl: withCorsProxy(baseUrl, corsProxy),
            extraHeaders: {
                "x-opencode-client": "cli",
                "x-opencode-project": "global",
                "x-opencode-session": randomClientId("ses"),
                "x-opencode-request": randomClientId("msg"),
                ...(options.extraHeaders || {})
            },
        });
        this.id = options.id || "opencode";
        this.corsProxy = corsProxy;
        this._baseUrl = baseUrl;
    }

    /**
     * Fallback: g4f backend proxying the same provider at {backendUrl}/api/OpenCode.
     * Resolved lazily so a backend connected after client creation is still used.
     * Pass `fallbackBaseUrl: false` to disable the fallback.
     */
    _fallbackUrl(url) {
        if (this.fallbackBaseUrl !== null) {
            return this.fallbackBaseUrl || null;
        }
        const backendUrl = (typeof window !== "undefined" && window.framework?.backendUrl) || "";
        const subPath = url.substring(this.baseUrl.length).replace(/^\/+/, "");
        return backendUrl ? `${backendUrl}/proxy/${this._baseUrl}/${subPath}` : null;
    }

    get models() {
        return {
            list: async () => {
                const models = await super.models.list();
                if (this.apiKey && this.apiKey !== "public") {
                    return models;
                }
                // Anonymous requests are restricted to the free tier
                return models.filter((model) =>
                    model.id.startsWith("big-") ||
                    model.id.endsWith("-free") || model.id.endsWith(":free")
                );
            }
        };
    }
}

export {
    Client,
    Pollinations,
    DeepInfra,
    Puter,
    HuggingFace,
    Audio,
    WebGPU,
    Bonsai,
    Bonsai2,
    ChromeAI,
    LLM7,
    Kilo,
    OpenCode,
    withCorsProxy,
    captureUserTierHeaders,
};

export default {
    Client,
    Pollinations,
    DeepInfra,
    Puter,
    HuggingFace,
    Audio,
    WebGPU,
    Bonsai,
    Bonsai2,
    ChromeAI,
    LLM7,
    Kilo,
    OpenCode,
};

// Publish the classes on window so classic scripts (e.g. challenge-client.js)
// can fall back to them when a dynamic import of this module fails (CSP,
// blocked module fetch, offline).
if (typeof window !== "undefined") {
    window.G4FClient = window.G4FClient || {
        Client,
        Pollinations,
        DeepInfra,
        Puter,
        HuggingFace,
        Audio,
        WebGPU,
        Bonsai,
        Bonsai2,
        ChromeAI,
        LLM7,
        Kilo,
        OpenCode,
        withCorsProxy,
        captureUserTierHeaders,
    };
}