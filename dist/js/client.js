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
        this.proxyManager = new CorsProxyManager();
        this.baseUrl = options.baseUrl;
        this.apiEndpoint = options.apiEndpoint || `${this.baseUrl}/chat/completions`;
        this.imageEndpoint = options.imageEndpoint || `${this.baseUrl}/images/generations`;
        this.defaultModel = options.defaultModel || null;
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
        this._modelsCached = false;
    }
    
    async _fetchWithProxyRotation(targetUrl) {
        const maxAttempts = this.proxyManager.proxies.length;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const proxiedUrl = this.proxyManager.getProxiedUrl(targetUrl);
            try {
                const response = await fetch(proxiedUrl);
                if (!response.ok) {
                    throw new Error(`Proxy fetch failed with status ${response.status}`);
                }
                return await response.json();
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

                if (params.stream) {
                    return this._streamCompletion(this.apiEndpoint, requestOptions);
                } else {
                    return this._regularCompletion(this.apiEndpoint, requestOptions);
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
          return data.data || data;
        }
      };
    }

    get images() {
        return {
            generate: async (params) => {
                let modelId = params.model || "flux";
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

    async _regularCompletion(apiEndpoint, requestOptions) {
        const response = await fetch(apiEndpoint, requestOptions);
        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        return await response.json();
    }

    async *_streamCompletion(apiEndpoint, requestOptions) {
      const response = await fetch(apiEndpoint, requestOptions);
      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
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
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n');
          buffer = parts.pop();
          for (const part of parts) {
            if (!part.trim() || part === 'data: [DONE]') continue;
            try {
              if (part.startsWith('data: ')) {
                yield JSON.parse(part.slice(6));
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
        prompt = encodeURIComponent(prompt.replaceAll(" ", "+"));
        delete params.prompt;
        if (params.nologo === undefined) params.nologo = true;
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
        return await response.json();
    }
}

class Pollinations extends Client {
    constructor(options = {}) {
        super({
            baseUrl: 'https://text.pollinations.ai',
            apiEndpoint: 'https://text.pollinations.ai/openai',
            imageEndpoint: 'https://image.pollinations.ai/prompt/{prompt}',
            defaultModel: 'gpt-4o-mini',
            referrer: 'https://g4f.dev',
            modelAliases: {
                "gpt-4o-mini": "openai", "gpt-4.1-nano": "openai-fast", "gpt-4": "openai-large",
                "gpt-4o": "openai-large", "gpt-4.1": "openai-large", "o4-mini": "openai-reasoning",
                "gpt-4.1-mini": "openai", "command-r-plus": "command-r", "gemini-2.5-flash": "gemini",
                "gemini-2.0-flash-thinking": "gemini-thinking", "qwen-2.5-coder-32b": "qwen-coder",
                "llama-3.3-70b": "llama", "llama-4-scout": "llamascout", "llama-4-scout-17b": "llamascout",
                "mistral-small-3.1-24b": "mistral", "deepseek-r1": "deepseek-reasoning-large",
                "deepseek-r1-distill-llama-70b": "deepseek-reasoning-large", "deepseek-r1-distill-qwen-32b": "deepseek-reasoning",
                "phi-4": "phi", "qwq-32b": "qwen-qwq", "deepseek-v3": "deepseek", "deepseek-v3-0324": "deepseek",
                "grok-3-mini": "grok", "gpt-4o-audio": "openai-audio", "gpt-4o-mini-audio": "openai-audio",
                "sdxl-turbo": "turbo", "gpt-image": "gptimage", "dall-e-3": "gptimage", "flux-pro": "flux", "flux-schnell": "flux"
            },
            ...options
        });
    }

    get models() {
      return {
        list: async () => {
          if (this._modelsCached && this._models.length > 0) return this._models;
          try {
            const [textModelsResponse, imageModelsResponse] = await Promise.all([
                this._fetchWithProxyRotation('https://text.pollinations.ai/models').catch(e => {
                    console.error("Failed to fetch text models from all proxies:", e); return { data: [] };
                }),
                this._fetchWithProxyRotation('https://image.pollinations.ai/models').catch(e => {
                    console.error("Failed to fetch image models from all proxies:", e); return [];
                }),
            ]);
            const textModelIds = (textModelsResponse.data || textModelsResponse || []).map(m => m.id || m.name);
            const imageModelIds = Array.isArray(imageModelsResponse) ? imageModelsResponse : [];
            const allDisplayNames = new Set([
                ...textModelIds.map(id => this.swapAliases[id] || id),
                ...imageModelIds.map(id => this.swapAliases[id] || id),
                ...Object.keys(this.modelAliases),
            ].filter(Boolean));
            this._models = Array.from(allDisplayNames).map(displayName => {
                const internalName = this.modelAliases[displayName] || displayName;
                const isImageModel = imageModelIds.includes(internalName) ||
                    ["gpt-image", "sdxl-turbo", "flux", "dall-e-3"].some(imgAlias => internalName.includes(imgAlias));
                return { id: displayName, type: isImageModel ? 'image' : 'chat' };
            }).sort((a, b) => a.id.localeCompare(b.id));
            this._modelsCached = true;
            return this._models;
          } catch (err) {
              console.error("Final fallback for Pollinations models:", err);
              return [
                  { id: "gpt-4o-mini", type: "chat" }, { id: "deepseek-v3", type: "chat" },
                  { id: "flux", type: "image" }, { id: "dall-e-3", type: "image" }
              ].sort((a,b) => a.id.localeCompare(b.id));
          }
        }
      };
    }
}

class DeepInfra extends Client {
    constructor(options = {}) {
        super({
            baseUrl: 'https://api.deepinfra.com/v1/openai',
            defaultModel: 'deepseek-ai/DeepSeek-V3-0324',
            ...options
        });
    }
}

class Together extends Client {
    constructor(options = {}) {
        super({
            baseUrl: 'https://api.together.xyz/v1',
            defaultModel: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
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
        
        this.activationEndpoint = "https://www.codegeneration.ai/activate-v2";
        this.modelsEndpoint = "https://api.together.xyz/v1/models";
        this.modelConfigs = {};
        this._modelsCached = false;
        this._apiKeyCache = null;
        this._cachedModels = [];
        this.imageModels = [];
        
        this.visionModels = [
            'Qwen/Qwen2-VL-72B-Instruct',
            'Qwen/Qwen2.5-VL-72B-Instruct',
            'arcee-ai/virtuoso-medium-v2',
            'arcee_ai/arcee-spotlight',
            'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo',
            'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo',
            this.defaultModel,
            'meta-llama/Llama-4-Scout-17B-16E-Instruct',
            'meta-llama/Llama-Vision-Free',
        ];
    }

    async getApiKey() {
        if (this._apiKeyCache) {
            return this._apiKeyCache;
        }
        
        if (this.apiKey) {
            this._apiKeyCache = this.apiKey;
            return this.apiKey;
        }
        
        if (typeof process !== 'undefined' && process.env.TOGETHER_API_KEY) {
            this.apiKey = process.env.TOGETHER_API_KEY;
            this._apiKeyCache = this.apiKey;
            return this.apiKey;
        }
        
        try {
            console.log('Fetching Together API key via CORS proxy...');
            const response = await this._fetchWithProxyRotation('https://www.codegeneration.ai/activate-v2');
            
            if (response?.openAIParams?.apiKey) {
                this.apiKey = response.openAIParams.apiKey;
                this._apiKeyCache = this.apiKey;
                this.extraHeaders['Authorization'] = `Bearer ${this.apiKey}`;
                console.log('Successfully obtained Together API key via proxy');
                return this.apiKey;
            } else {
                throw new Error('No API key found in response');
            }
            
        } catch (error) {
            console.error('Failed to get Together API key via proxy:', error);
            throw new Error(`Failed to obtain Together API key: ${error.message}`);
        }
    }

    getModel(model) {
        if (!model) {
            return this.defaultModel;
        }
        
        if (this._cachedModels.includes(model)) {
            return model;
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

    getModelConfig(model) {
        const resolvedModel = this.getModel(model);
        return this.modelConfigs[resolvedModel] || {};
    }

    async loadModels() {
        if (this._modelsCached && this._cachedModels.length > 0) {
            return this._cachedModels;
        }
        
        try {
            const apiKey = await this.getApiKey();
            
            const response = await fetch(this.modelsEndpoint, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                mode: 'cors',
                credentials: 'omit'
            });
            
            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.status}`);
            }
            
            const modelsData = await response.json();
            
            this._cachedModels = [];
            this.imageModels = [];
            this.modelConfigs = {};
            
            for (const model of modelsData) {
                if (!model?.id) continue;
                
                const modelId = model.id;
                const modelType = (model.type || '').toLowerCase();
                
                if (model.config) {
                    this.modelConfigs[modelId] = {
                        stop: model.config.stop || [],
                        chatTemplate: model.config.chat_template,
                        bosToken: model.config.bos_token,
                        eosToken: model.config.eos_token,
                        contextLength: model.context_length
                    };
                }
                
                if (this.visionModels.includes(modelId)) {
                    this._cachedModels.push(modelId);
                } else if (modelType === 'chat' || modelType === 'language' || modelType === '') {
                    this._cachedModels.push(modelId);
                } else if (modelType === 'image') {
                    this.imageModels.push(modelId);
                    this._cachedModels.push(modelId); // Add to general list as well
                }
            }
            
            if (!this._cachedModels.includes(this.defaultModel)) {
                this._cachedModels.unshift(this.defaultModel);
            }
            
            for (const visionModel of this.visionModels) {
                if (!this._cachedModels.includes(visionModel)) {
                    this._cachedModels.push(visionModel);
                }
            }
            
            this._cachedModels.sort();
            this.imageModels.sort();
            
            this._modelsCached = true;
            return this._cachedModels;
            
        } catch (error) {
            console.error('Failed to load Together models:', error);
            this._cachedModels = [this.defaultModel];
            return this._cachedModels;
        }
    }

    get models() {
        return {
            list: async () => {
                const models = await this.loadModels();
                return models.map(model => ({
                    id: model,
                    type: this.imageModels.includes(model) ? 'image' : 'chat'
                }));
            }
        };
    }

    get chat() {
        return {
            completions: {
                create: async (params) => {
                    if (!this.apiKey) {
                        await this.getApiKey();
                    }
                    
                    if (!this._modelsCached) {
                        await this.loadModels();
                    }
                    
                    if (params.model) {
                        params.model = this.getModel(params.model);
                    } else if (this.defaultModel) {
                        params.model = this.defaultModel;
                    }
                    
                    const modelConfig = this.getModelConfig(params.model);
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

                    if (params.stream) {
                        return this._streamCompletion(this.apiEndpoint, requestOptions);
                    } else {
                        return this._regularCompletion(this.apiEndpoint, requestOptions);
                    }
                }
            }
        };
    }

    get images() {
        return {
            generate: async (params) => {
                if (!this.apiKey) {
                    await this.getApiKey();
                }

                if (!this._modelsCached) {
                    await this.loadModels();
                }

                const resolvedModel = params.model ? this.getModel(params.model) : null;
                
                if (resolvedModel && this.imageModels.includes(resolvedModel)) {
                    params.model = resolvedModel;
                } else {
                    if (resolvedModel) {
                        console.warn(`Model '${resolvedModel}' is not a valid image model. Falling back to default.`);
                    }
                    params.model = 'black-forest-labs/FLUX.1.1-pro'; // Default image model
                }
                
                return this._regularImageGeneration(params, { headers: this.extraHeaders });
            }
        };
    }
}


class Puter {
    constructor(options = {}) {
        this.defaultModel = options.defaultModel || 'gpt-4.1';
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
            } else {
                throw new Error("HuggingFace API key is required. Set it in the options or as an environment variable HUGGINGFACE_API_KEY.");
            }
        }
        super({
            baseUrl: 'https://api-inference.huggingface.co/v1',
            defaultModel: 'meta-llama/Meta-Llama-3-8B-Instruct',
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

                    if (model && this.modelAliases[model]) {
                      model = this.modelAliases[model];
                    } else if (!model && this.defaultModel) {
                      model = this.defaultModel;
                    }

                    // Model resolution would go here
                    const providerMapping = await this._getMapping(model);
                    if (!providerMapping) {
                        throw new Error(`Model is not supported: ${model}`);
                    }

                    let apiBase = this.apiBase;
                    for (const providerKey in providerMapping) {
                        const apiPath = providerKey === "novita" ? 
                            "novita/v3/openai" : 
                            `${providerKey}/v1`;
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

                    if (params.stream) {
                        return this._streamCompletion(`${apiBase}/chat/completions`, requestOptions);
                    } else {
                        return this._regularCompletion(`${apiBase}/chat/completions`, requestOptions);
                    }
                }
            }
        };
    }
}


export { Client, Pollinations, DeepInfra, Together, Puter, HuggingFace };
export default Client;
