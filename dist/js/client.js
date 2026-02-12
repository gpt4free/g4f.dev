/**
 * Manages a list of CORS proxies with failover capabilities.
 */
class CorsProxyManager {
    /**
     * @param {string[]} proxies - An array of CORS proxy base URLs.
     */
    constructor(proxies = [
        'https://corsproxy.io/?',
        'https://api.allorigins.win/raw?url=',
        'https://cloudflare-cors-anywhere.queakchannel42.workers.dev/?',
        'https://proxy.cors.sh/',
        'https://cors-anywhere.herokuapp.com/',
        'https://thingproxy.freeboard.io/fetch/',
        'https://cors.bridged.cc/',
        'https://cors-proxy.htmldriven.com/?url=',
        'https://yacdn.org/proxy/',
        'https://api.codetabs.com/v1/proxy?quest=',
    ]) {
        if (!Array.isArray(proxies) || proxies.length === 0) {
            throw new Error('CorsProxyManager requires a non-empty array of proxy URLs.');
        }
        this.proxies = proxies;
        this.currentIndex = 0;
    }

    /**
     * Gets the full proxied URL for the current proxy.
     * @param {string} targetUrl - The URL to be proxied.
     * @returns {string} The full proxied URL.
     */
    getProxiedUrl(targetUrl) {
        const proxy = this.proxies[this.currentIndex];
        return proxy + encodeURIComponent(targetUrl);
    }

    /**
     * Rotates to the next proxy in the list.
     */
    rotateProxy() {
        this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
        console.warn(`Rotated to next CORS proxy: ${this.proxies[this.currentIndex]}`);
    }
}

/**
 * Extracts the delay time (in seconds) from a "Try again in X seconds" message
 * @param {string} message - The message containing the delay
 * @returns {number|null} - The delay in seconds, or null if no match found
 */
function extractRetryDelay(message) {
    // Regular expression to match "Try again in X seconds" where X can be integer or decimal
    const regex = /(Try again in ([0-9.]+) seconds?|Retry after ([0-9.]+))/i;
    const match = message.match(regex);
    
    if (match && (match[2] || match[3])) {
        // Convert the matched string to a number
        const delay = parseFloat(match[2] || match[3]);
        return isNaN(delay) ? null : delay;
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
    return await response.text();
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
    let totalTokens = usage?.total_tokens || parseInt(headers.get('x-usage-total-tokens') || '0');
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
            options.baseUrl = "https://g4f.space/api/auto";
            options.apiEndpoint = "https://g4f.space/ai/";
            options.sleep = 10000;
        }
        this.proxyManager = new CorsProxyManager();
        this.baseUrl = options.baseUrl;
        this.apiEndpoint = options.apiEndpoint || `${this.baseUrl}/chat/completions`;
        this.imageEndpoint = options.imageEndpoint || `${this.baseUrl}/images/generations`;
        this.modelsEndpoint = options.modelsEndpoint || `${this.baseUrl}/models`;
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

        // Caching for models
        this._models = [];
    }
    
    async _fetchWithProxyRotation(targetUrl, requestConfig={}) {
        const maxAttempts = this.proxyManager.proxies.length;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const proxiedUrl = this.proxyManager.getProxiedUrl(targetUrl);
            try {
                const response = await fetch(proxiedUrl, requestConfig);
                if (!response.ok) {
                    throw new Error(`Proxy fetch failed with status ${response.status}`);
                }
                const contentType = response.headers.get('Content-Type');
                if (contentType && !contentType.includes('application/json')) {
                    throw new Error(`Expected JSON response, got ${contentType}`);
                }
                return response
            } catch (error) {
                console.warn(`CORS proxy attempt ${attempt + 1}/${maxAttempts} failed for ${targetUrl}:`, error.message);
                this.proxyManager.rotateProxy();
            }
        }
        throw new Error(`All CORS proxy attempts failed for ${targetUrl}.`);
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
                let response = await fetch(this.apiEndpoint.replace('{model}', orginalModel), requestOptions);
                if (response.status === 429) {
                    console.error("Error during completion, retrying without custom endpoint:", response);
                    const delay = parseInt(response.headers.get('Retry-After'), 10) || extractRetryDelay(await response.text()) || this.sleep / 1000 || 10;
                    console.log(`Retrying after ${delay} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, delay * 1000));
                    response = await fetch(this.apiEndpoint.replace('{model}', orginalModel), requestOptions);
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
          const response = await fetch(this.modelsEndpoint.replace('{model}', 'auto'), {
            method: 'GET',
            headers: this.extraHeaders
          });
          
          if (!response.ok) {
            throw new Error(`Failed to fetch models: ${response.status}`);
          }

          let data = await response.json();
          data = data.data || data.result || data.models || data;
          data = data.map((model) => {
            if (!model.id || this.useModelName) {
                model.id = model.name;
            }
            model.label = model.id.replace('models/', '');
            if (!model.type) {
              if (model.task?.name === "Text Generation") {
                model.type = 'chat';
              } else if (model.task?.name === "Text-to-Image") {
                model.type = 'image';
              } else if (model.id.toLowerCase().includes("video")) {
                model.type = 'video';
              } else if (model.video) {
                model.type = 'video';
              } else if (model.supports_chat) {
                model.type = 'chat';
              } else if (model.supports_images) {
                model.type = 'image';
              } else if (model.image) {
                model.type = 'image';
              } else if (model.task?.name) {
                model.type = "unknown";
              } else if (model.id.toLowerCase().includes("embedding")) {
                model.type = "embedding";
              } else if (model.id.toLowerCase().includes("tts") || model.id.toLowerCase().includes("whisper")) {
                model.type = "audio";
              } else if (model.id.toLowerCase().includes("flux") || model.id.toLowerCase().includes("image")) {
                model.type = "image";
              } else if (["sdxl", "nano-banana", "lucid-origin"].includes(model.id)) {
                model.type = "image";
              } else if (model.id.includes("generate")) {
                model.type = "image";
              }
            }
            if (model.type === 'text') {
                model.type = 'chat';
            }
            return model;
          });
          return data;
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
        const response = await fetch(imageEndpoint, {
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
                    data.model = data.model.replace('models/', '');
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
        const response = await fetch(url, requestOptions);
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
        let response = await fetch(imageEndpoint, requestOptions);
        captureUserTierHeaders(response.headers);
        if (!response.ok) {
            const delay = parseInt(response.headers.get('Retry-After'), 10) || extractRetryDelay(await response.clone().text()) || this.sleep / 1000;
            if (delay > 0) {
                console.log(`Retrying after ${delay} seconds...`);
                await new Promise(resolve => setTimeout(resolve, delay * 1000));
                response = await fetch(imageEndpoint, requestOptions);
            }
        }
        if (!response.ok) {
            const errorBody = await getErrorMessage(response);
            throw new Error(`Status ${response.status}: ${errorBody}`);
        }
        if (response.headers.get('Content-Type').startsWith('application/json')) {
            const data = await response.json();
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

class PollinationsAI extends Client {
    constructor(options = {}) {
        super({
            ...options,
            baseUrl: options.apiKey ? 'https://gen.pollinations.ai/v1' : options.baseUrl || 'https://text.pollinations.ai',
            apiEndpoint: options.apiKey || options.baseUrl ? null : options.apiEndpoint || 'https://text.pollinations.ai/openai',
            imageEndpoint: options.apiKey ? 'https://gen.pollinations.ai/image/{prompt}' : options.imageEndpoint || 'https://image.pollinations.ai/prompt/{prompt}',
            modelsEndpoint: options.modelsEndpoint || 'https://gen.pollinations.ai/text/models',
            imageModelsEndpoint: options.imageModelsEndpoint || options.apiKey ? 'https://gen.pollinations.ai/image/models' : 'https://image.pollinations.ai/models',
            defaultModel: options.defaultModel || 'openai',
            extraBody: options.extraBody || {
                seed: 10352102
            },
            modelAliases: {
                "sdxl-turbo": "turbo",
                "gpt-image": "gptimage",
                "flux-kontext": "kontext",
                ...(options.modelAliases || {})
            }
        });
        if (!options.apiKey) {
            this.balance = this.checkBalance();
        }
    }

    async checkBalance() {
        const BALANCE_ENDPOINT = "https://g4f.space/api/pollinations/account/balance";
        return fetch(BALANCE_ENDPOINT).then(r=>r.json()).then(d=>{
            console.log(`PollinationsAI balance: ${d.balance}`);
            if (d.balance > 0) {
                this.baseUrl = 'https://g4f.space/api/pollinations';
                this.apiEndpoint = `${this.baseUrl}/chat/completions`;
                const userInfo = {
                    tier: 'free',
                    remainingRequests: 10,
                    remainingTokens: d.balance,
                    limitRequests: 10,
                    limitTokens: 20
                };
                if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent('userTierUpdate', { detail: userInfo }));
                }
            }
            return d.balance;
        })
    }

    get models() {
      return {
        list: async () => {
          if (this._models.length > 0) return this._models;
          try {
            let textModelsResponse;
            let imageModelsResponse;
            try {
                await this._sleep();
                textModelsResponse = await fetch(this.modelsEndpoint);
                if (!textModelsResponse.ok) {
                    throw new Error(`Status ${textModelsResponse.status}: ${await textModelsResponse.text()}`);
                }
            } catch (e) {
                console.error("Failed to fetch pollinations.ai models from g4f.dev:", e);
                textModelsResponse = await this._fetchWithProxyRotation('https://text.pollinations.ai/models').catch(e => {
                    console.error("Failed to fetch text models from all proxies:", e); return { data: [] };
                });
            }
            try {
                const imageModelsUrl = 'https://gen.pollinations.ai/image/models';
                imageModelsResponse = await fetch(imageModelsUrl);
                if (!imageModelsResponse.ok) {
                    const delay = parseInt(response.headers.get('Retry-After'), 10);
                    if (delay > 0) {
                        console.log(`Retrying after ${delay} seconds...`);
                        await new Promise(resolve => setTimeout(resolve, delay * 1000));
                        imageModelsResponse = await fetch(imageModelsUrl);
                    }
                    if (!imageModelsResponse.ok) {
                       throw new Error(`Status ${imageModelsResponse.status}: ${await imageModelsResponse.text()}`);
                    }
                }
            } catch (e) {
                console.error("Failed to fetch pollinations.ai image models from g4f.dev:", e);
                imageModelsResponse = await this._fetchWithProxyRotation('https://image.pollinations.ai/models').catch(e => {
                    console.error("Failed to fetch image models from all proxies:", e); return { data: [] };
                });
            }
            textModelsResponse = await textModelsResponse.json();
            imageModelsResponse = await imageModelsResponse.json();
            const textModels = (textModelsResponse.data || textModelsResponse || []);
            this._models = [
                ...textModels.map(model => {
                    model.id = model.name;
                    model.label = model.aliases && model.aliases.length > 0 ? model.aliases[0] : (this.swapAliases[model.name]  || model.name);
                    this.modelAliases[model.label] = model.name;
                    model.type = model.type || 'chat';
                    return model
                }),
                ...imageModelsResponse.map(model => {
                    const isVideo = model.output_modalities && model.output_modalities.includes('video');
                    const modelName = model.name || model
                    return { id: modelName, label: this.swapAliases[modelName]  || modelName, type: isVideo ? 'video' : 'image', seed: true};
                })
            ];
            return this._models;
          } catch (err) {
              console.error("Final fallback for Pollinations models:", err);
              return [
                  { id: "openai", type: "chat" },
                  { id: "deepseek", type: "chat" },
                  { id: "flux", type: "image" },
              ];
          }
        }
      };
    }
}

class Pollinations extends PollinationsAI {}

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
                    response = await fetch(`${this.baseUrl}/chat/completions`, requestOptions);
                    this.logCallback && this.logCallback({request: options, type: 'chat'});
                } catch(e) {
                    options.model = this.defaultModel;
                    requestOptions.body = JSON.stringify(options);
                    response = await fetch(this.apiEndpoint, requestOptions);
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

class Worker extends Client {}

class Together extends Client {
    constructor(options = {}) {
        if (!options.baseUrl && !options.apiEndpoint && !options.apiKey) {
            if (typeof localStorage !== "undefined" && localStorage.getItem("Together-api_key")) {
                options.apiKey = localStorage.getItem("Together-api_key");
            } else {
                throw new Error('Together requires a "apiKey" to be set.');
            }
        }
        super({
            baseUrl: 'https://api.together.xyz/v1',
            ...options
        });
    }
}


class Puter extends Client {
    constructor(options = {}) {
        super({});
        this.baseUrl = options.baseUrl || null;
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
                    this.extraHeaders = {
                        ...this.extraHeaders,
                        'Authorization': `Bearer ${localStorage.getItem("puter.auth.token") || ''}`
                    };
                    if (this.baseUrl) {
                        return super.chat.completions.create(params);
                    }
                    const { messages, signal, ...options } = params;
                    if (!options.model && this.defaultModel) {
                        options.model = this.defaultModel;
                    }
                    if (options.stream) {
                        return this._streamPuter(options.model, messages, options);
                    }
                    const response = await this.puter.ai.chat(messages, false, options);
                    this.logCallback && this.logCallback({response: response, type: 'chat'});
                    if (response.choices === undefined && response.message !== undefined) {
                        return {
                            ...response,
                            get choices() {
                                return [{message: response.message}];
                            }
                        };
                    } else {
                        return response;
                    }
                }
            }
        };
    }

    get models() {
      return {
        list: async () => {
            const response = await fetch("https://api.puter.com/puterai/chat/models/");
            let data = await response.json();
            return data.models.map(model => {
                return {
                    id: model,
                    type: "chat"
                };
            });
        }
      };
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
        for await (const item of await this.puter.ai.chat(messages, false, options)) {
          item.model = model;
          this.logCallback && this.logCallback({response: item, type: 'chat'});
          if (item.text) {
            item.choices = [{delta: {content: item.text}}]
          } else if (item.reasoning) {
            item.choices = [{delta: {reasoning: item.reasoning}}]
          }
          yield item;
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
            baseUrl: 'https://api-inference.huggingface.co/v1',
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
            ...options
        });
        this.providerMapping = {
            "google/gemma-3-27b-it": {
                "hf-inference/models/google/gemma-3-27b-it": {
                    "task": "conversational",
                    "providerId": "google/gemma-3-27b-it"
                }
            }
        };
    }

    get models() {
      return {
        list: async () => {
            const response = await fetch("https://huggingface.co/api/models?inference=warm&&expand[]=inferenceProviderMapping");
            if (!response.ok) {
              throw new Error(`Failed to fetch models: ${response.status}`);
            }
            const data = await response.json();
            return data
                .filter(model => 
                    model.inferenceProviderMapping?.some(provider => 
                        provider.status === "live" && provider.task === "conversational"
                    )
                )
                .concat(Object.keys(this.providerMapping).map(model => ({
                    id: model,
                    type: "chat"
                })))
        }
      };
    }

    async _getMapping(model) {
        if (this.providerMapping[model]) {
            return this.providerMapping[model];
        }
        const response = await fetch(`https://huggingface.co/api/models/${model}?expand[]=inferenceProviderMapping`, {
            headers: this.extraHeaders
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch model mapping: ${response.status}`);
        }

        const modelData = await response.json();
        this.providerMapping[model] = modelData.inferenceProviderMapping;
        return this.providerMapping[model];
    }

    get chat() {
        return {
            completions: {
                create: async (params) => {
                    if (!this.apiKey) {
                        throw new Error("HuggingFace API key is required. Set it in the options or as an environment variable HUGGINGFACE_API_KEY.");
                    }
                    let { model, signal, ...options } = params;

                    if (!model) {
                      model = this.defaultModel;
                    }
                    if (this.modelAliases[model]) {
                      model = this.modelAliases[model];
                    }

                    // Model resolution would go here
                    const providerMapping = await this._getMapping(model);
                    if (!providerMapping) {
                        throw new Error(`Model is not supported: ${model}`);
                    }

                    let apiBase = this.apiBase;
                    for (const providerKey in providerMapping) {
                        let apiPath;
                        if (providerKey === "zai-org")
                            apiPath = "zai-org/api/paas/v4"
                        else if (providerKey === "novita")
                            apiPath = "novita/v3/openai";
                        else if (providerKey === "groq")
                            apiPath = "groq/openai/v1";
                        else if (providerKey === "hf-inference")
                            apiPath = `${providerKey}/models/${model}/v1`;
                        else
                            apiPath = `${providerKey}/v1`;
                        apiBase = `https://router.huggingface.co/${apiPath}`;

                        const task = providerMapping[providerKey].task;
                        if (task !== "conversational") {
                            throw new Error(`Model is not supported: ${model} task: ${task}`);
                        }

                        model = providerMapping[providerKey].providerId;
                        break;
                    }
                    this.logCallback && this.logCallback({request: {baseUrl: apiBase, model, ...options}, type: 'chat'});
                    const requestOptions = {
                        method: 'POST',
                        headers: this.extraHeaders,
                        body: JSON.stringify({
                            model,
                            ...options
                        }),
                        signal: signal
                    };
                    const response = await fetch(`${apiBase}/chat/completions`, requestOptions);
                    if (params.stream) {
                        return this._streamCompletion(response);
                    } else {
                        return this._regularCompletion(response);
                    }
                }
            }
        };
    }
}


export { Client, Pollinations, PollinationsAI, DeepInfra, Together, Puter, HuggingFace, Worker, Audio, captureUserTierHeaders };
export default Client;
