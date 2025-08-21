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
            if (localStorage && localStorage.getItem("Azure-api_key")) {
                options.apiKey = localStorage.getItem("Azure-api_key");
            } else {
                throw new Error('Client requires at least baseUrl, apiEndpoint, or apiKey to be set.');
            }
        }
        this.proxyManager = new CorsProxyManager();
        this.baseUrl = options.baseUrl || ((g4f_host || "") + "/api/Azure");
        this.apiEndpoint = options.apiEndpoint || `${this.baseUrl}/chat/completions`;
        this.imageEndpoint = options.imageEndpoint || `${this.baseUrl}/images/generations`;
        this.defaultModel = options.defaultModel || 'openai/gpt-oss-120b';
        this.defaulImageModel = options.defaultImageModel || 'flux';
        this.apiKey = options.apiKey;
        this.referrer = options.referrer;
        
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
                params.model = modelId;
                if (this.referrer) {
                    params.referrer = this.referrer;
                }
                const requestOptions = {
                    method: 'POST',
                    headers: this.extraHeaders,
                    body: JSON.stringify(params)
                };
                const response = await fetch(this.apiEndpoint, requestOptions);
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
          data = data.data || data;
          data = data.map((model) => {
            if (!model.type) {
              if (model.supports_chat) {
                model.type = 'chat';
              } else if (model.supports_images) {
                model.type = 'image';
              } else if (model.image) {
                model.type = 'image';
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
                let modelId = params.model || this.defaulImageModel;
                if(this.modelAliases[modelId]) {
                    modelId = this.modelAliases[modelId];
                }
                params.model = modelId;

                if (this.imageEndpoint.includes('{prompt}')) {
                    return this._defaultImageGeneration(params, { headers: this.extraHeaders });
                }
                return this._regularImageGeneration(params, { headers: this.extraHeaders });
            }
        };
    }

    async _regularCompletion(response) {
        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        return await response.json();
    }

    async *_streamCompletion(response) {
      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }
      if (!response.body) {
        throw new Error('Streaming not supported in this environment');
      }
      if (response.headers.get('Content-Type') === 'application/json') {
            const data = await response.json();
            if (data.choices && data.choices[0]?.message) {
                data.choices[0].delta = data.choices[0].message;
            }
            yield data;
            return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n');
          buffer = parts.pop();
          for (const part of parts) {
            if (!part.trim() || part === 'data: [DONE]') continue;
            try {
              if (part.startsWith('data: ')) {
                const data = JSON.parse(part.slice(6));
                if (data.choices && data.choices[0]?.delta?.reasoning) {
                    data.choices[0].delta.reasoning_content = data.choices[0].delta.reasoning;
                }
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

    async _defaultImageGeneration(params, requestOptions) {
        params = {...params};
        let prompt = params.prompt ? params.prompt : '';
        prompt = encodeURIComponent(prompt).replaceAll('%20', '+');
        delete params.prompt;
        if (params.nologo === undefined) params.nologo = true;
        if (this.referrer) params.referrer = this.referrer;
        if (params.size) {
            params.width = params.size.split('x')[0];
            params.height = params.size.split('x')[1];
            delete params.size;
        }
        const encodedParams = new URLSearchParams(params);
        let url = this.imageEndpoint.replace('{prompt}', prompt);
        url += '?' + encodedParams.toString();
        const response = await fetch(url, requestOptions);
        if (!response.ok) {
            throw new Error(`Image generation request failed with status ${response.status}`);
        }
        return {data: [{url: response.url}]}
    }

    async _regularImageGeneration(params, requestOptions) {
        const response = await fetch(this.imageEndpoint, {
            method: 'POST',
            body: JSON.stringify(params),
            ...requestOptions
        });
        if (!response.ok) {
            const errorBody = await response.text();
            console.error("Image generation failed. Server response:", errorBody);
            throw new Error(`Image generation request failed with status ${response.status}`);
        }
        data = await response.json();
        if (data?.error?.message) {
            throw new Error(`Image generation failed: ${data.error.message}`);
        }
        return data;
    }
}

class PollinationsAI extends Client {
    constructor(options = {}) {
        super({
            baseUrl: 'https://text.pollinations.ai',
            apiEndpoint: 'https://text.pollinations.ai/openai',
            imageEndpoint: 'https://image.pollinations.ai/prompt/{prompt}',
            defaultModel: 'gpt-5-nano',
            referrer: 'https://g4f.dev',
            modelAliases: {
                "gpt-oss-120b": "gpt-oss",
                "gpt-4o-mini": "openai",
                "gpt-4.1-nano": "openai-fast",
                "gpt-4.1": "openai-large",
                "o4-mini": "openai-reasoning",
                "command-r-plus": "command-r",
                "gemini-2.5-flash": "gemini",
                "gemini-2.0-flash-thinking": "gemini-thinking",
                "qwen-2.5-coder-32b": "qwen-coder",
                "llama-3.3-70b": "llama",
                "llama-4-scout": "llamascout",
                "mistral-small-3.1-24b": "mistral",
                "deepseek-r1": "deepseek-reasoning",
                "phi-4": "phi",
                "deepseek-v3": "deepseek",
                "grok-3-mini-high": "grok",
                "gpt-4o-audio": "openai-audio",
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
            let [textModelsResponse, imageModelsResponse] = await Promise.all([
                this._fetchWithProxyRotation('https://text.pollinations.ai/models').catch(e => {
                    console.error("Failed to fetch text models from all proxies:", e); return { data: [] };
                }),
                this._fetchWithProxyRotation('https://image.pollinations.ai/models').catch(e => {
                    console.error("Failed to fetch image models from all proxies:", e); return [];
                }),
            ]);
            textModelsResponse = await textModelsResponse.json();
            imageModelsResponse = await imageModelsResponse.json();
            const textModels = (textModelsResponse.data || textModelsResponse || []);
            this._models = [
                ...textModels.map(model => {
                    model.id = model.id || this.swapAliases[model.name]  || model.name;
                    model.type = model.type || 'chat';
                    return model
                }),
                ...imageModelsResponse.map(model => {
                    return { id: this.swapAliases[model]  || model, type: 'image'};
                })
            ];
            return this._models;
          } catch (err) {
              console.error("Final fallback for Pollinations models:", err);
              return [
                  { id: "gpt-4.1-mini", type: "chat" }, { id: "deepseek-v3", type: "chat" },
                  { id: "flux", type: "image" }, { id: "gpt-image", type: "image" }
              ];
          }
        }
      };
    }
}

class Custom extends Client {
    constructor(options = {}) {
        super({
            baseUrl: localStorage ? localStorage.getItem("Custom-api_base") : undefined,
            apiKey: localStorage ? localStorage.getItem("Custom-api_key") : undefined,
            ...options
        });
    }
}

class DeepInfra extends Client {
    constructor(options = {}) {
        super({
            baseUrl: 'https://api.deepinfra.com/v1/openai',
            ...options
        });
    }
}

class Together extends Client {
    constructor(options = {}) {
        if (!options.baseUrl && !options.apiEndpoint && !options.apiKey) {
            if (localStorage && localStorage.getItem("Together-api_key")) {
                options.apiKey = localStorage.getItem("Together-api_key");
            } else {
                throw new Error('Together requires a "apiKey" to be set.');
            }
        }
        super({
            baseUrl: 'https://api.together.xyz/v1',
            defaulImageModel: 'black-forest-labs/FLUX.1.1-pro',
            modelAliases: {
                // Models Chat/Language
                // meta-llama
                "llama-3.2-3b": "meta-llama/Llama-3.2-3B-Instruct-Turbo",
                "llama-2-70b": ["meta-llama/Llama-2-70b-hf", "meta-llama/Llama-2-70b-hf"],
                "llama-3-70b": ["meta-llama/Meta-Llama-3-70B-Instruct-Turbo", "meta-llama/Llama-3-70b-chat-hf"],
                "llama-3.2-90b": "meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo",
                "llama-3.3-70b": ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free"],
                "llama-4-scout": "meta-llama/Llama-4-Scout-17B-16E-Instruct",
                "llama-3.1-8b": ["meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo", "blackbox/meta-llama-3-1-8b"],
                "llama-3.2-11b": "meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo",
                "llama-3-8b": ["meta-llama/Llama-3-8b-chat-hf", "meta-llama/Meta-Llama-3-8B-Instruct-Lite"],
                "llama-3.1-70b": ["meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo"],
                "llama-3.1-405b": "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo",
                "llama-4-maverick": "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
                
                // deepseek-ai
                "deepseek-r1": "deepseek-ai/DeepSeek-R1",
                "deepseek-v3": ["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-V3-p-dp"],
                "deepseek-r1-distill-llama-70b": ["deepseek-ai/DeepSeek-R1-Distill-Llama-70B", "deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free"],
                "deepseek-r1-distill-qwen-1.5b": "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B",
                "deepseek-r1-distill-qwen-14b": "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B",
                
                // Qwen
                "qwen-2.5-vl-72b": "Qwen/Qwen2.5-VL-72B-Instruct",
                "qwen-2.5-coder-32b": "Qwen/Qwen2.5-Coder-32B-Instruct",
                "qwen-2.5-7b": "Qwen/Qwen2.5-7B-Instruct-Turbo",
                "qwen-2-vl-72b": "Qwen/Qwen2-VL-72B-Instruct",
                "qwq-32b": "Qwen/QwQ-32B",
                "qwen-2.5-72b": "Qwen/Qwen2.5-72B-Instruct-Turbo",
                "qwen-3-235b": ["Qwen/Qwen3-235B-A22B-fp8", "Qwen/Qwen3-235B-A22B-fp8-tput"],
                "qwen-2-72b": "Qwen/Qwen2-72B-Instruct",
                
                // mistralai
                "mixtral-8x7b": "mistralai/Mixtral-8x7B-Instruct-v0.1",
                "mistral-small-24b": "mistralai/Mistral-Small-24B-Instruct-2501",
                "mistral-7b": ["mistralai/Mistral-7B-Instruct-v0.1", "mistralai/Mistral-7B-Instruct-v0.2", "mistralai/Mistral-7B-Instruct-v0.3"],
                
                // google
                "gemma-2-27b": "google/gemma-2-27b-it",
                
                // nvidia
                "nemotron-70b": "nvidia/Llama-3.1-Nemotron-70B-Instruct-HF",
                
                // NousResearch
                "hermes-2-dpo": "NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO",
                
                // perplexity-ai
                "r1-1776": "perplexity-ai/r1-1776",

                // Models Image
                // black-forest-labs
                "flux": ["black-forest-labs/FLUX.1-schnell-Free", "black-forest-labs/FLUX.1-schnell", "black-forest-labs/FLUX.1.1-pro", "black-forest-labs/FLUX.1-pro", "black-forest-labs/FLUX.1-dev"],
                "flux-schnell": ["black-forest-labs/FLUX.1-schnell-Free", "black-forest-labs/FLUX.1-schnell"],
                "flux-pro": ["black-forest-labs/FLUX.1.1-pro", "black-forest-labs/FLUX.1-pro"],
                "flux-redux": "black-forest-labs/FLUX.1-redux",
                "flux-depth": "black-forest-labs/FLUX.1-depth",
                "flux-canny": "black-forest-labs/FLUX.1-canny",
                "flux-kontext-max": "black-forest-labs/FLUX.1-kontext-max",
                "flux-dev-lora": "black-forest-labs/FLUX.1-dev-lora",
                "flux-dev": ["black-forest-labs/FLUX.1-dev", "black-forest-labs/FLUX.1-dev-lora"],
                "flux-kontext-pro": "black-forest-labs/FLUX.1-kontext-pro",
                
                ...options.modelAliases
            },
            ...options
        });
        
        this.modelsEndpoint = "https://api.together.xyz/v1/models";
        this._modelConfigs = {};
        this._cachedModels = [];
    }

    _getModel(model, defaultModel) {
        if (!model) {
            model = defaultModel;
        }
        
        if (this.modelAliases[model]) {
            const alias = this.modelAliases[model];
            if (Array.isArray(alias)) {
                const selected = alias[Math.floor(Math.random() * alias.length)];
                console.log(`Together: Selected model '${selected}' from alias '${model}'`);
                return selected;
            }
            console.log(`Together: Using model '${alias}' for alias '${model}'`);
            return alias;
        }
        
        return model;
    }

    _getModelConfig(model) {
        return this._modelConfigs[model] || {};
    }

    async _loadModels() {
        if (this._cachedModels.length > 0) {
            return this._cachedModels;
        }
        
        try {
            await this.getApiKey();
            
            const response = await fetch(this.modelsEndpoint, {
                method: 'GET',
                headers: this.extraHeaders
            });
            
            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.status}`);
            }
            
            const modelsData = await response.json();
            
            this._cachedModels = modelsData;
            this._modelConfigs = {};
            
            for (const model of modelsData) {
                if (!model?.id) continue;
                const modelId = model.id;                
                if (model.config) {
                    this._modelConfigs[modelId] = {
                        stop: model.config.stop || [],
                        chatTemplate: model.config.chat_template,
                        bosToken: model.config.bos_token,
                        eosToken: model.config.eos_token,
                        contextLength: model.context_length
                    };
                } else {
                    this._modelConfigs[modelId] = {};
                }
            }
            return this._cachedModels;
            
        } catch (error) {
            console.error('Failed to load Together models:', error);
            return this._cachedModels;
        }
    }

    async _regularImageGeneration(params, requestOptions) {
        if (params.image) {
            params.image_url = params.image;
            delete params.image;
        }
        return await super._regularImageGeneration(params, requestOptions);
    }

    get models() {
        return {
            list: async () => {
                return await this._loadModels();
            }
        };
    }

    get chat() {
        return {
            completions: {
                create: async (params) => {
                    if (!this._cachedModels.length < 1) {
                        await this._loadModels();
                    }
                    
                    params.model = this._getModel(params.model, this.defaultModel);
                    
                    const modelConfig = this._getModelConfig(params.model);
                    if (!params.stop && modelConfig.stop && modelConfig.stop.length > 0) {
                        params.stop = modelConfig.stop;
                    }
                    
                    const requestOptions = {
                        method: 'POST',
                        headers: {
                            ...this.extraHeaders,
                            'Authorization': `Bearer ${this.apiKey}`
                        },
                        body: JSON.stringify(params)
                    };
                    const response = await fetch(this.apiEndpoint, requestOptions);
                    if (params.stream) {
                        return this._streamCompletion(response);
                    } else {
                        return this._regularCompletion(response);
                    }
                }
            }
        };
    }

    get images() {
        return {
            generate: async (params) => {
                if (this._cachedModels.length < 1) {
                    await this.loadModels();
                }
                params.model = this._getModel(params.model, this.defaulImageModel);
                return this._regularImageGeneration(params, { headers: this.extraHeaders });
            }
        };
    }
}


class Puter {
    constructor(options = {}) {
        this.defaultModel = options.defaultModel || 'gpt-5';
        this.puter = options.puter || this._injectPuter();
    }

    get chat() {
        return {
            completions: {
                create: async (params) => {
                    const { messages, ...options } = params;
                    if (!options.model && this.defaultModel) {
                        options.model = this.defaultModel;
                    }
                    if (options.stream) {
                        return this._streamCompletion(messages, options);
                    }
                    const response = await (await this.puter).ai.chat(messages, false, options);
                    if (response.choices == undefined && response.message !== undefined) {
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
            models = models.filter((model) => !model.includes("/") && !blockList.includes(model));
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

    async *_streamCompletion(messages, options = {}) {
        for await (const item of await ((await this.puter).ai.chat(messages, false, options))) {
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
            } else {
                throw new Error("HuggingFace API key is required. Set it in the options or as an environment variable HUGGINGFACE_API_KEY.");
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
                    let { model, ...options } = params;

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

                    const requestOptions = {
                        method: 'POST',
                        headers: this.extraHeaders,
                        body: JSON.stringify({
                            model,
                            ...options
                        })
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


export { Client, Custom, PollinationsAI, DeepInfra, Together, Puter, HuggingFace };
export default Client;
