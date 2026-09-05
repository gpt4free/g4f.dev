
import { Client, Pollinations, DeepInfra, HuggingFace, Worker, Audio, captureUserTierHeaders, Puter } from "./client.js";
let fs;
if (typeof window === "undefined") {
    fs = require("fs");
}

let providers = {};
let defaultModels = {};
let providerLocalStorage = {};
let serverDefaultModels = {};
let hiddenServers = [];
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

function mapProviderDefaults(providers) {
    for (const provider of Object.values(providers)) {
        if (provider.id && hiddenServers.includes(provider.id)) {
            provider.is_hidden = true;
        }
        if (provider.id && serverDefaultModels[provider.id]) {
            provider.defaultModel = serverDefaultModels[provider.id];
        }
    }
    return providers;
}

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
                serverDefaultModels = json.serverDefaultModels || {};
                providerLocalStorage = json.providerLocalStorage || {};
                hiddenServers = json.hiddenServers || [];
                return mapProviderDefaults(providers);
            });
    } else {
        // Node: read providers.json
        data = JSON.parse(fs.readFileSync("./providers.json", "utf-8"));
        providers = data.providers || {};
        defaultModels = data.defaultModels || {};
        serverDefaultModels = data.serverDefaultModels || {};
        providerLocalStorage = data.providerLocalStorage || {};
        hiddenServers = data.hiddenServers || [];
        return mapProviderDefaults(providers);
    }
}

async function createClient(provider, options = {}) {
    options.id = provider;

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

    if (!providers) {
        providers = await loadProviders();
    }

    let serverId = null;
    if (provider.startsWith("custom:")) {
        serverId = provider.substring(7);
        options.baseUrl = `https://g4f.space/custom/${serverId}`;
        provider = "custom";
    } else if (providers[provider]) {
        serverId = providers[provider].id;
    }

    if (serverId && serverDefaultModels[serverId] && !options.defaultModel) {
        options.defaultModel = serverDefaultModels[serverId];
    }

    if (!providers[provider]) {
        if (provider.startsWith("https://") || provider.startsWith("http://")) {
            options.baseUrl = provider;
        } else {
            options.baseUrl = options.baseUrl || `https://g4f.space/api/${provider}`;
        }
        options.apiKey = options.apiKey || (typeof window !== "undefined" ? window?.localStorage.getItem("g4f_session") : undefined);
        options.sleep = options.sleep || 10000; // 10 seconds delay to avoid rate limiting
        return new Client(options);
    }
    const { class: ClientClass = (providerClassMap[provider] || Client), backupUrl, localStorageApiKey, tags, ...config } = providers[provider];

    if (typeof localStorage !== "undefined") {
        if (providerLocalStorage[provider] && !options.apiKey) {
            options.apiKey = localStorage.getItem(providerLocalStorage[provider]);
        }
        if (!options.apiKey && backupUrl) {
            options.apiKey = localStorage.getItem("g4f_session");
        }
    }
    
    if (backupUrl && !options.baseUrl) {
        options.baseUrl = backupUrl;
        options.sleep = 10000; // 10 seconds delay to avoid rate limiting
    }

    if (defaultModels[provider] && !options.defaultModel) {
        options.defaultModel = defaultModels[provider];
    }
    
    // Instantiate the client
    return new ClientClass({ ...config, ...options });
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
        const key = "index" in normalized ? normalized.index : (normalized.id || "null");
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

export { loadProviders, createClient, providerLocalStorage, captureUserTierHeaders, mergeToolCalls, Puter };
export default { loadProviders, createClient, providerLocalStorage, captureUserTierHeaders, mergeToolCalls, Puter };