import { Client, Pollinations, DeepInfra, Puter, HuggingFace, Worker, Audio } from "./client.js";

const defaultModels = {
    "nectar": "openai",
    "pollinations": "openai",
    "azure": "model-router",
    "gemini": "gemini-2.5-flash",
    "openrouter": "openai/gpt-oss-120b:free",
    "nvidia": "deepseek-ai/deepseek-v3.1",
    "ollama": "deepseek-v3.1:671b",
    "groq": "openai/gpt-oss-120b",
    "gpt4free.pro": "deepseek-v3.2",
};

const providerLocalStorage = {
    "api.airforce": "ApiAirforce-api_key",
    "deepinfra": "DeepInfra-api_key",
    "huggingface": "HuggingFace-api_key",
    "gemini": "GeminiPro-api_key",
    "nvidia": "Nvidia-api_key",
    "ollama": "Ollama-api_base",
    "openrouter": "OpenRouter-api_key",
    "pollinations": "PollinationsAI-api_key",
    "together": "Together-api_key",
    "puter": "puter.auth.token",
}

const providers = {
    "default": {class: Client, baseUrl: "https://g4f.dev/api/{model}", tags: "", defaultModel: "auto", modelAliases: defaultModels},
    "pollinations": {label: "pollinations.ai", class: Pollinations, tags: "🎨 👓"},
    "nectar": {label: "nectar by pollinations.ai", class: Pollinations, baseUrl: "https://g4f.dev/api/nectar", apiEndpoint: "https://g4f.dev/api/nectar/v1/chat/completions", imageEndpoint: "https://g4f.dev/api/nectar/image/{prompt}", modelsEndpoint: "https://g4f.dev/api/nectar/text/models", tags: ""},
    "api.airforce": {class: Client, baseUrl: "https://api.airforce/v1", tags: "🎨 👓", localStorageApiKey: "ApiAirforce-api_key", sleep: 60000},
    "master": {label: "master by api.airforce", class: Client, baseUrl: "https://g4f.dev/api/api.airforce", tags: "🎨 👓", sleep: 10000},
    "anondrop.net": {class: Client, baseUrl: "https://anondrop.net/v1", tags: ""},
    "audio": {label: "audio by g4f.dev", class: Audio, baseUrl: "https://g4f.dev/api/audio", tags: "🎧", sleep: 10000},
    "azure": {label: "azure by g4f.dev", class: Client, baseUrl: "https://g4f.dev/api/azure", tags: "👓", sleep: 10000},
    "custom": {class: Client, tags: ""},
    "deepinfra": {class: DeepInfra, tags: "🎨 👓"},
    "gemini": {class: Client, baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", backupUrl: "https://g4f.dev/api/gemini", tags: "👓"},
    // "gpt-oss-120b": {class: Client, baseUrl: "https://g4f.dev/api/gpt-oss-120b", tags: ""},
    // "gpt4free.pro": {class: Client, baseUrl: "https://gpt4free.pro/v1", tags: ""},
    "groq": {class: Client, baseUrl: "https://api.groq.com/openai/v1", backupUrl: "https://g4f.dev/api/groq", tags: ""},
    "huggingface": {class: HuggingFace, tags: "🤗"},
    "nvidia": {class: Client, baseUrl: "https://integrate.api.nvidia.com/v1", backupUrl: "https://g4f.dev/api/nvidia", tags: "📟"},
    "ollama": {class: Client, baseUrl: "https://g4f.dev/api/ollama", tags: "🦙", sleep: 10000},
    "openrouter": {class: Client, baseUrl: "https://openrouter.ai/api/v1", backupUrl: "https://g4f.dev/api/openrouter", tags: "👓"},
    "puter": {class: Puter, tags: "👓"},
    // "stringable-inf": {class: Client, baseUrl: "https://stringableinf.com/api", apiEndpoint: "https://stringableinf.com/api/v1/chat/completions", tags: "", extraHeaders: {"HTTP-Referer": "https://g4f.dev/", "X-Title": "G4F Chat"}},
    // "typegpt": {class: Client, baseUrl: "https://typegpt.net/api/v1", tags: "", modelsEndpoint: "https://typegpt.net/api/v1/models", localStorageApiKey: "typegpt-api_key"},
    "together": {class: Client, baseUrl: "https://api.together.xyz/v1", tags: "👓"},
    "worker": {class: Worker, baseUrl: "https://g4f.dev/api/worker", tags: "🎨", sleep: 10000},
    // "x.ai": {class: Client, baseUrl: "https://api.x.ai/v1", backupUrl: "https://g4f.dev/api/x.ai", tags: ""}
};

// Factory function to create a client instance based on provider
function createClient(provider, options = {}) {
    const { class: ClientClass, backupUrl, localStorageApiKey, tags, ...config } = providers[provider];
    if (!ClientClass) {
        throw new Error(`Provider "${provider}" not found.`);
    }

    // Set baseUrl
    if (typeof localStorage !== "undefined" && providerLocalStorage[provider] && localStorage.getItem(providerLocalStorage[provider])) {
        options.apiKey = localStorage.getItem(providerLocalStorage[provider]);
    }
    
    // Set baseUrl
    if (backupUrl && !options.apiKey && !options.baseUrl) {
        options.baseUrl = backupUrl;
        options.sleep = 10000; // 10 seconds delay to avoid rate limiting
    }

    if (provider === "custom") {
        if (!options.baseUrl) {
            if (typeof localStorage !== "undefined" && localStorage.getItem("Custom-api_base")) {
                options.baseUrl = localStorage.getItem("Custom-api_base");
            }
            if (!options.baseUrl) {
                throw new Error("Custom provider requires a baseUrl to be set in options or in localStorage under 'Custom-api_base'.");
            }
        }
    }

    if (defaultModels[provider]) {
        options.defaultModel = options.defaultModel || defaultModels[provider];
    }
    
    // Instantiate the client
    return new ClientClass({ ...config, ...options });
}
export { createClient, providerLocalStorage };
export default providers;