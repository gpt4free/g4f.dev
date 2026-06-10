
import { Client, Pollinations, DeepInfra, HuggingFace, Worker, Audio, captureUserTierHeaders, Puter } from "./client.js";
let fs;
if (typeof window === "undefined") {
    fs = require("fs");
}

let providers = {};
let defaultModels = {};
let providerLocalStorage = {};
let providerClassMap = {
    "default": Client,
    "pollinations": Pollinations,
    "nectar": Pollinations,
    "audio": Audio,
    "deepinfra": DeepInfra,
    "huggingface": HuggingFace,
    "puter": Puter,
    "worker": Worker,
};

async function loadProviders() {
    let data;
    if (typeof window !== "undefined" && window.fetch) {
        // Web: fetch providers.json
        let origin = "https://g4f.dev";
        if (window.location.hostname === "gpt4free.github.io") {
            origin = "";
        } else if (window.location.origin === "http://localhost:8090") {
            origin = "";
        }
        return fetch(origin + "/dist/js/providers.json")
            .then(res => res.json())
            .then(json => {
                providers = json.providers || {};
                defaultModels = json.defaultModels || {};
                window.providerLocalStorage = providerLocalStorage = json.providerLocalStorage || {};
                return providers;
            });
    } else {
        // Node: read providers.json
        data = JSON.parse(fs.readFileSync("./providers.json", "utf-8"));
        providers = data.providers || {};
        defaultModels = data.defaultModels || {};
        providerLocalStorage = data.providerLocalStorage || {};
    }
    return providers;
}

async function createClient(provider, options = {}) {
    options.id = provider;
    if (provider.startsWith("custom:")) {
        const serverId = provider.substring(7);
        options.baseUrl = `https://g4f.space/custom/${serverId}`;
        options.apiKey = options.apiKey || (typeof window !== "undefined" ? window?.localStorage.getItem("g4f_session") : undefined);
        provider = "custom";
    }
    
    if (!providers) {
        providers = await loadProviders();
    }

    if (provider === "custom") {
        if (!options.baseUrl) {
            if (typeof localStorage !== "undefined" && localStorage.getItem("Custom-api_base")) {
                options.baseUrl = localStorage.getItem("Custom-api_base");
            }
            if (typeof localStorage !== "undefined" && localStorage.getItem("Custom-api_key")) {
                options.apiKey = localStorage.getItem("Custom-api_key");
            }
            if (!options.baseUrl) {
                throw new Error("Custom provider requires a baseUrl to be set in options or in localStorage under 'Custom-api_base'.");
            }
        }
        return new Client(options);
    }

    if (!providers[provider]) {
        options.baseUrl = options.baseUrl || `https://g4f.space/api/${provider}`;
        options.apiKey = options.apiKey || (typeof window !== "undefined" ? window?.localStorage.getItem("g4f_session") : undefined);
        options.sleep = options.sleep || 10000; // 10 seconds delay to avoid rate limiting
        return new Client(options);
    }
    const { class: ClientClass = (providerClassMap[provider] || Client), backupUrl, localStorageApiKey, tags, ...config } = providers[provider];

    if (typeof localStorage !== "undefined" && providerLocalStorage[provider] && localStorage.getItem(providerLocalStorage[provider])) {
        options.apiKey = localStorage.getItem(providerLocalStorage[provider]);
    }
    
    if (backupUrl && !options.apiKey && !options.baseUrl) {
        options.baseUrl = backupUrl;
        options.apiKey = (typeof window !== "undefined" ? window?.localStorage.getItem("g4f_session") : undefined);
        options.sleep = 10000; // 10 seconds delay to avoid rate limiting
    }

    if (defaultModels[provider]) {
        options.defaultModel = options.defaultModel || defaultModels[provider];
    }
    
    // Instantiate the client
    return new ClientClass({ ...config, ...options });
}

export { loadProviders, createClient, providerLocalStorage, captureUserTierHeaders, Puter };