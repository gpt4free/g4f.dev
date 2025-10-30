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

class Client {
    constructor(options = {}) {
        if (!options.baseUrl && !options.apiEndpoint && !options.apiKey) {
            if (typeof localStorage !== 'undefined' && localStorage && localStorage.getItem("Azure-api_key")) {
                options.apiKey = localStorage.getItem("Azure-api_key");
            } else {
                throw new Error('Client requires at least baseUrl, apiEndpoint, or apiKey to be set.');
            }
        }
        this.proxyManager = new CorsProxyManager();
        this.baseUrl = options.baseUrl || ((typeof G4F_HOST !== 'undefined' && G4F_HOST || "") + "/api/Azure");
        this.apiEndpoint = options.apiEndpoint || `${this.baseUrl}/chat/completions`;
        this.imageEndpoint = options.imageEndpoint || `${this.baseUrl}/images/generations`;
        this.defaultModel = options.defaultModel;
        this.useModelName = options.useModelName || false;
        this.apiKey = options.apiKey;
        this.extraBody = options.extraBody || {};
        this.logCallback = options.logCallback || console.log;

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

    get chat() {
        return {
            completions: {
            create: async (params) => {
                let modelId = params.model || this.defaultModel;
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
                const response = await fetch(this.apiEndpoint.replace("{now}", Date.now()), requestOptions);
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
          const response = await fetch(`${this.baseUrl}/models`, {
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
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Status ${response.status}: ${errorBody}`);
        }
        const toBase64 = file => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
        });
        return {data: [{url: await toBase64(await response.blob())}]};
    }

    async _regularCompletion(response) {
        if (!response.ok) {
            throw new Error(`Status ${response.status}: ${await response.text()}`);
        }
        const data = await response.json();
        if (response.headers.get('x-provider')) {
            data.provider = response.headers.get('x-provider');
        }
        this.logCallback && this.logCallback({response: data, type: 'chat'});
        return data;
    }

    async *_streamCompletion(response) {
      if (!response.ok) {
        throw new Error(`Status ${response.status}: ${await response.text()}`);
      }
      if (!response.body) {
        throw new Error('Streaming not supported in this environment');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          let parts = [];
          console.log({done, value});
          if (!done) {
            buffer += decoder.decode(value, { stream: true });
            parts = buffer.split('\n');
            buffer = parts.pop();
          } else if (buffer) {
            parts =  [buffer];
            buffer = '';
          } else {
            break;
          }
          console.log('Received chunk:', buffer, parts);
          for (const part of parts) {
            console.log('Stream part:', part);
            if (!part.trim() || part === 'data: [DONE]') continue;
            try {
              if (part.startsWith('data: ')) {
                const data = JSON.parse(part.slice(6));
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
                this.logCallback && this.logCallback({response: data, type: 'chat'});
                yield data;
              } else if (response.headers.get('Content-Type').startsWith('application/json')) {
                const data = JSON.parse(part);
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
                        data.choices = [{delta: data.message}];
                    }
                }
                if (data.model) {
                    data.model = data.model.replace('models/', '');
                }
                if (response.headers.get('x-provider')) {
                    data.provider = response.headers.get('x-provider');
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
        params = {...params};
        let prompt = params.prompt ? params.prompt : '';
        prompt = encodeURIComponent(prompt).replaceAll('%20', '+');
        delete params.prompt;
        if (params.nologo === undefined) params.nologo = true;
        if (this.extraBody.referrer) params.referrer = this.extraBody.referrer;
        if (params.size) {
            params.width = params.size.split('x')[0];
            params.height = params.size.split('x')[1];
            delete params.size;
        }
        this.logCallback && this.logCallback({request: {prompt, ...params}, type: 'image'});
        const encodedParams = new URLSearchParams(params);
        let url = imageEndpoint.replace('{prompt}', prompt);
        url += '?' + encodedParams.toString();
        const response = await fetch(url, requestOptions);
        this.logCallback && this.logCallback({response: response, type: 'image'});
        if (!response.ok) {
            throw new Error(`Status ${response.status}: ${await response.text()}`);
        }
        return {data: [{url: response.url}]}
    }

    async _regularImageGeneration(imageEndpoint, params, requestOptions) {
        const response = await fetch(imageEndpoint, {
            method: 'POST',
            body: JSON.stringify(params),
            ...requestOptions
        });
        this.logCallback && this.logCallback({request: params, type: 'image'});
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Status ${response.status}: ${errorBody}`);
        }
        if (response.headers.get('Content-Type').startsWith('application/json')) {
            const data = await response.json();
            this.logCallback && this.logCallback({response: data, type: 'image'});
            if (data?.error?.message) {
                throw new Error(`Image generation failed: ${data.error.message}`);
            }
            if (data.image) {
                return {data: [{b64_json: data.image}]}
            }
            if (data && data[0]?.b64_json) {
                return data.map(img => ({
                    ...img,
                    get url() {
                        return `data:image/png;base64,${img.b64_json}`;
                    }
                }));
            }
            return data;
        }
        const toBase64 = file => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
        });
        return {data: [{url: await toBase64(await response.blob())}]};
    }
}

class PollinationsAI extends Client {
    constructor(options = {}) {
        super({
            baseUrl: 'https://text.pollinations.ai',
            apiEndpoint: 'https://text.pollinations.ai/openai',
            imageEndpoint: 'https://image.pollinations.ai/prompt/{prompt}',
            defaultModel: 'gpt-5-nano',
            extraBody: {
                referrer: 'https://g4f.dev/',
                seed: '10352102'
            },
            modelAliases: {
                "sdxl-turbo": "turbo",
                "gpt-image": "gptimage",
                "flux-kontext": "kontext",
            },
            ...options
        });
    }

    get models() {
      return {
        list: async () => {
          if (this._models.length > 0) return this._models;
          try {
            let textModelsResponse;
            try {
                textModelsResponse = await fetch('https://g4f.dev/api/pollinations.ai/models');
                if (!textModelsResponse.ok) {
                    throw new Error(`Status ${textModelsResponse.status}: ${await textModelsResponse.text()}`);
                }
            } catch (e) {
                console.error("Failed to fetch pollinations.ai models from g4f.dev:", e);
                textModelsResponse = await this._fetchWithProxyRotation('https://text.pollinations.ai/models').catch(e => {
                    console.error("Failed to fetch text models from all proxies:", e); return { data: [] };
                });
            }
            let imageModelsResponse = await this._fetchWithProxyRotation('https://image.pollinations.ai/models').catch(e => {
                console.error("Failed to fetch image models from all proxies:", e); return { data: [] };
            });
            textModelsResponse = await textModelsResponse.json();
            imageModelsResponse = await imageModelsResponse.json();
            const textModels = (textModelsResponse.data || textModelsResponse || []);
            this._models = [
                ...textModels.map(model => {
                    model.id = model.aliases && model.aliases.length > 0 ? model.aliases[0] : (this.swapAliases[model.name]  || model.name);
                    this.modelAliases[model.id] = model.name;
                    model.type = model.type || 'chat';
                    return model
                }),
                ...imageModelsResponse.map(model => {
                    return { id: this.swapAliases[model]  || model, type: 'image', seed: true};
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

class Audio extends Client {
    constructor(options = {}) {
        super({
            apiEndpoint: 'https://text.pollinations.ai/openai',
            extraBody: {
                referrer: 'https://g4f.dev/'
            },
            defaultModel: 'openai-audio',
            ...options
        });
    }

    get chat() {
        return {
            completions: {
            create: async (params) => {
                const originalModel = params.model;
                params.model = this.defaultModel;
                if (this.extraBody) {
                    params = { ...params, ...this.extraBody };
                }
                if (!params.audio) {
                    params.audio = {
                        "voice": "alloy",
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
                try {
                    const response = await fetch(this.apiEndpoint, requestOptions);
                    this.logCallback && this.logCallback({request: params, type: 'chat'});
                    return await this._regularCompletion(response);
                } catch(e) {
                    params.model = originalModel;
                    delete params.referrer;
                    requestOptions.body = JSON.stringify(params);
                    const response = await fetch(`${this.baseUrl}/chat/completions`, requestOptions);
                    return await this._regularCompletion(response);
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

class Worker extends Client {
    constructor(options = {}) {
        super({
            baseUrl: 'https://g4f.dev/api/worker',
            useModelName: true,
            ...options
        });
    }
}

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


class Puter {
    constructor(options = {}) {
        this.defaultModel = options.defaultModel || 'gpt-5';
        this.logCallback = options.logCallback;
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
                        return this._streamCompletion(options.model, messages, options);
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
            let models = await response.json();
            models = models.models;
            const blockList = ["abuse", "costly", "fake", "model-fallback-test-1"];
            models = models.filter((model) => model.startsWith("openrouter:") || !model.includes("/") && !blockList.includes(model));
            return models.map(model => {
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

    async *_streamCompletion(model, messages, options = {}) {
        this.logCallback && this.logCallback({request: {messages, ...options}, type: 'chat'});
        for await (const item of await this.puter.ai.chat(messages, false, options)) {
          item.model = model;
          this.logCallback && this.logCallback({response: item, type: 'chat'});
          if (item.choices == undefined && item.text !== undefined) {
            yield {
                ...item,
                get choices() {
                    return [{delta: {content: item.text}}];
                }
            };
          } else {
            yield item
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
                        if (providerKey === "novita")
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


export { Client, PollinationsAI, DeepInfra, Together, Puter, HuggingFace, Worker, Audio };
export default Client;
