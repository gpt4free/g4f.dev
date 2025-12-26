
import { Client, Pollinations, DeepInfra, Puter, HuggingFace, Worker, Audio } from "./client.js";
let fs;
if (typeof window === "undefined") {
    fs = require("fs");
}

let providers = {};
let defaultModels = {};
let providerLocalStorage = {};
let providerClassMap = {};

async function loadProviders() {
    let data;
    if (typeof window !== "undefined" && window.fetch) {
        // Web: fetch providers.json
        return fetch("https://g4f.dev/dist/js/providers.json")
            .then(res => res.json())
            .then(json => {
                providers = json.providers || {};
                defaultModels = json.defaultModels || {};
                providerLocalStorage = json.providerLocalStorage || {};
                providerClassMap = {
                    "default": Client,
                    "pollinations": Pollinations,
                    "nectar": Pollinations,
                    "audio": Audio,
                    "deepinfra": DeepInfra,
                    "huggingface": HuggingFace,
                    "puter": Puter,
                    "worker": Worker,
                };
                return providers;
            });
    } else {
        // Node: read providers.json
        data = JSON.parse(fs.readFileSync("./providers.json", "utf-8"));
        providers = data.providers || {};
        defaultModels = data.defaultModels || {};
        providerLocalStorage = data.providerLocalStorage || {};
        providerClassMap = {
            "default": Client,
            "pollinations": Pollinations,
            "nectar": Pollinations,
            "audio": Audio,
            "deepinfra": DeepInfra,
            "huggingface": HuggingFace,
            "puter": Puter,
            "worker": Worker,
        };
    }
    return providers;
}

async function createClient(provider, options = {}) {
    if (provider.startsWith("custom:")) {
        const serverId = provider.substring(7);
        options.baseUrl = `https://g4f.dev/custom/${serverId}`;
        options.apiKey = options.apiKey || (typeof window !== "undefined" ? window?.localStorage.getItem("session_token") : undefined);
        provider = "custom";
    }
    if (!providers) {
        providers = await loadProviders();
    }
    if (!providers[provider]) {
        throw new Error(`Provider "${provider}" not found.`);
    }
    const { class: ClientClass = (providerClassMap[provider] || Client), backupUrl, localStorageApiKey, tags, ...config } = providers[provider];

    if (provider === "default") {
        options.modelAliases = defaultModels;
    }

    // Set baseUrl
    if (typeof localStorage !== "undefined" && providerLocalStorage[provider] && localStorage.getItem(providerLocalStorage[provider])) {
        options.apiKey = localStorage.getItem(providerLocalStorage[provider]);
    }
    
    // Set baseUrl
    if (backupUrl && !options.apiKey && !options.baseUrl) {
        options.baseUrl = backupUrl;
        options.apiKey = (typeof window !== "undefined" ? window?.localStorage.getItem("session_token") : undefined);
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

export { loadProviders, createClient, providerLocalStorage, Puter };