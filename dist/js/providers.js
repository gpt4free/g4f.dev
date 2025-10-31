import { Client, PollinationsAI, DeepInfra, Puter, HuggingFace, Worker, Audio } from "./client.js";

const providers = {
    "default": {class: Client, baseUrl: "https://g4f.dev/api/auto", apiEndpoint: "https://g4f.dev/ai/{now}", tags: ""},
    "api.airforce": {class: Client, baseUrl: "https://api.airforce/v1", tags: "🎨 👓", localStorageApiKey: "ApiAirforce-api_key"},
    "anondrop.net": {class: Client, baseUrl: "https://anondrop.net/v1", tags: ""},
    "audio": {class: Audio, baseUrl: "https://g4f.dev/api/audio", tags: "🎧"},
    "azure": {class: Client, baseUrl: "https://g4f.dev/api/azure", tags: "👓"},
    "custom": {class: Client, tags: "", localStorageApiKey: "Custom-api_key"},
    "deep-infra": {class: DeepInfra, tags: "🎨 👓", localStorageApiKey: "DeepInfra-api_key"},
    "gemini": {class: Client, baseUrl: "https://g4f.dev/api/gemini", tags: "👓", localStorageApiKey: "GeminiPro-api_key"},
    "gpt-oss-120b": {class: Client, baseUrl: "https://g4f.dev/api/gpt-oss-120b", tags: ""},
    "gpt4free.pro": {class: Client, baseUrl: "https://gpt4free.pro/v1", tags: "", defaultModel: "deepseek-v3.2"},
    "groq": {class: Client, baseUrl: "https://api.groq.com/openai/v1", backupUrl: "https://g4f.dev/api/groq", tags: "", defaultModel: "openai/gpt-oss-120b"},
    "hugging-face": {class: HuggingFace, tags: "", localStorageApiKey: "HuggingFace-api_key"},
    "nvidia": {class: Client, baseUrl: "https://integrate.api.nvidia.com/v1", backupUrl: "https://g4f.dev/api/nvidia", tags: "👓", localStorageApiKey: "Nvidia-api_key"},
    "ollama": {class: Client, baseUrl: "https://g4f.dev/api/ollama", tags: "", localStorageApiKey: "Ollama-api_base"},
    "openrouter": {class: Client, baseUrl: "https://openrouter.ai/api/v1", backupUrl: "https://g4f.dev/api/openrouter", tags: "👓", localStorageApiKey: "OpenRouter-api_key"},
    "pollinations.ai": {class: PollinationsAI, tags: "🎨 👓", localStorageApiKey: "PollinationsAI-api_key"},
    "puter": {class: Puter, tags: "👓"},
    // "stringable-inf": {class: Client, baseUrl: "https://stringableinf.com/api", apiEndpoint: "https://stringableinf.com/api/v1/chat/completions", tags: "", extraHeaders: {"HTTP-Referer": "https://g4f.dev/", "X-Title": "G4F Chat"}},
    "typegpt": {class: Client, baseUrl: "https://g4f.dev/api/typegpt", tags: ""},
    "together": {class: Client, baseUrl: "https://api.together.xyz/v1", tags: "👓", localStorageApiKey: "Together-api_key"},
    "worker": {class: Worker, baseUrl: "https://g4f.dev/api/worker", tags: "🎨"},
    "x.ai": {class: Client, baseUrl: "https://api.x.ai/v1", backupUrl: "https://g4f.dev/api/grok", tags: ""}
};

// Factory function to create a client instance based on provider
function createClient(provider, options = {}) {
    const config = providers[provider];
    if (!config) {
        throw new Error(`Provider "${provider}" not found.`);
    }

    // Set baseUrl
    if (typeof localStorage !== "undefined" && config.localStorageApiKey && localStorage.getItem(config.localStorageApiKey)) {
        options.apiKey = localStorage.getItem(config.localStorageApiKey);
    }
    
    // Set baseUrl
    if (provider === "custom") {
        if (!options.baseUrl) {
            if (typeof localStorage !== "undefined" && localStorage.getItem("Custom-api_base")) {
                options.baseUrl = localStorage.getItem("Custom-api_base");
            }
            if (!options.baseUrl) {
                throw new Error("Custom provider requires a baseUrl to be set in options or in localStorage under 'Custom-api_base'.");
            }
        }
    } else if (config.baseUrl) {
        options.baseUrl = config.baseUrl;
    }
    if (config.backupUrl && !options.apiKey) {
        options.baseUrl = config.backupUrl;
    }
    
    // Set apiEndpoint if specified
    if (config.apiEndpoint) {
        options.apiEndpoint = config.apiEndpoint;
    }
    
    // Set extraHeaders if specified
    if (config.extraHeaders) {
        options.extraHeaders = { ...options.extraHeaders, ...config.extraHeaders };
    }

    // Set defaultModel if specified
    if (config.defaultModel) {
        options.defaultModel = config.defaultModel;
    }
    
    // Instantiate the client
    const client = new config.class(options);
    return client;
}
export { createClient };
export default providers;