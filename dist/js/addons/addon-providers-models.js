/* ================================================================== *
 * Addon: Providers & Models
 *
 * Provider loading, model fetching, filtering, favorites, and quota info.
 * ================================================================== */

(function () {
    'use strict';

    ChatAddons.register({
        id: 'builtin:providers-models',
        name: 'Providers & Models',
        version: '1.0.0',
        description: 'Provider loading, model fetching, filtering, favorites, and quota info.',
        author: 'g4f',
        builtin: true,
        permissions: ['net:fetch', 'storage:local', 'dom:write', 'dom:query'],

        load() {
            return (async () => {})
        }
    })
})();
function get_selected_model() {
    let model = null;
    if (modelSearch && modelSearch.value) {
        return modelSearch.value;
    } else if (modelSelect.selectedIndex >= 0) {
        model = modelSelect.options[modelSelect.selectedIndex];
    }
    return model?.value ? model.value : null;
}

async function api(ressource, args=null, files=null, message_id=null, finish_message=null) {
    if (window?.pywebview) {
        if (args !== null) {
            if (ressource == "conversation") {
                return pywebview.api[`get_${ressource}`](args, message_id);
            }
            if (ressource == "models") {
                ressource = "provider_models";
            }
            return pywebview.api[`get_${ressource}`](args);
        }
        return pywebview.api[`get_${ressource}`]();
    }
    let headers = {};
    let user = appStorage.getItem("user");
    if (user) {
        headers['x-user'] = user;
    }
    let url = `${framework.backendUrl}/backend-api/v2/${ressource}`;
    let response;
    if (ressource == "models" && args) {
        if (providerModelSignal) {
            providerModelSignal.abort();
        }
        providerModelSignal = new AbortController();

        api_key = get_api_key_by_provider(args);
        if (api_key) {
            headers['x-api-key'] = api_key;
        }
        api_base = args == "Custom" ? document.getElementById(`${args}-api_base`).value : null;
        if (api_base) {
            headers['x-api-base'] = api_base;
        }
        const ignored = Array.from(settings.querySelectorAll("input.provider:not(:checked)")).map((el)=>el.value);
        if (ignored.length > 0 && args == "AnyProvider") {
            args += '?ignored=' + encodeURIComponent(ignored.join(" "));
        }
        url = `${framework.backendUrl}/backend-api/v2/${ressource}/${args}`;
        headers['content-type'] = 'application/json';
        response = await fetch(url, {
            method: 'GET',
            headers: headers,
            signal: providerModelSignal.signal,
        });
    } else if (ressource == "conversation") {
        let body = JSON.stringify(args);
        headers = {
            accept: 'text/event-stream',
            ...await framework.getHeaders()
        };
        if (files.length > 0) {
            const formData = new FormData();
            for (const file of files) {
                if (file instanceof File) {
                    formData.append('files', file)
                } else {
                    formData.append('media_url', file.url ? file.url : file)
                }
            }
            formData.append('json', body);
            body = formData;
        } else {
            headers['content-type'] = 'application/json';
        }
        // Run the fetch in a Web Worker so it keeps streaming
        // even when the tab is backgrounded / the user switches apps.
        response = await workerFetch(message_id, url, {
            method: 'POST',
            headers: headers,
            body: body,
        });
        // On Ratelimit
        if (response.status == 429) {
            const body = await response.text();
            const title = body.match(/<title>([^<]+?)<\/title>/)[1];
            const message = body.match(/<p>([^<]+?)<\/p>/)[1];
            error_storage[message_id] = `**${title}**\n${message}`;
            await finish_message();
            return;
        } else {
            try {
                await read_response(response, message_id, args.provider || null, finish_message);
            } catch (e) {
                console.error(e);
                if (continue_storage[message_id]) {
                    delete continue_storage[message_id];
                    await api("conversation", args, files, message_id, finish_message)
                }
            }
            await finish_message();
            return;
        }
    } else if (args) {
        if (ressource == "log" ||  ressource == "usage") {
            if (ressource == "log" && !document.getElementById("reportError").checked) {
                return;
            }
        }
        headers['content-type'] = 'application/json';
        response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(args),
        });
    }
    if (!response) {
        response = await fetch(url, {headers: headers});
    }
    if (response.status != 200) {
        console.error(response);
    }
    return await response.json();
}

async function read_response(response, message_id, provider, finish_message) {
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let currentEvent = null;
    let currentData = null;

    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }
        buffer += value;
        const lines = buffer.split("\n");
        // Keep the last incomplete line in the buffer
        buffer = lines.pop();

        for (const line of lines) {
            if (line.startsWith("event: ")) {
                currentEvent = line.substring(7).trim();
            } else if (line.startsWith("data: ")) {
                currentData = line.substring(6);
            } else if (line === "" && currentData !== null) {
                // Empty line marks end of SSE event
                try {
                    const data = JSON.parse(currentData);
                    await add_message_chunk(data, message_id, provider, finish_message);
                } catch (e) {
                    console.error("Failed to parse SSE data:", e, currentData);
                }
                currentEvent = null;
                currentData = null;
            } else if (line && !line.startsWith("event:") && !line.startsWith("data:")) {
                // Fallback for legacy JSON-only format (no SSE prefix)
                try {
                    const data = JSON.parse(line);
                    await add_message_chunk(data, message_id, provider, finish_message);
                } catch {
                    // Ignore parse errors for incomplete lines
                }
            }
        }
    }
}

function get_api_key_by_provider(provider, single=false) {
    let api_key = null;
    if (provider.startsWith("pa:")) {
        return appStorage.getItem(`pa:${provider.slice(3)}-api_key`);
    }
    if (provider) {
        const expires = appStorage.getItem("g4f_expires");
        if (isTokenExpired(expires)) {
            appStorage.removeItem("g4f_session");
            appStorage.removeItem("g4f_expires");
        }
        if (provider === "custom:srv_ml2kr1wn9b1fb453079a") {
            return appStorage.getItem("DeepInfra-api_key") || appStorage.getItem("g4f_session");
        }
        if (provider === "custom:srv_mkomfko63371049b6da6") {
            return appStorage.getItem("Airforce-api_key") || appStorage.getItem("g4f_session");
        }
        if (["custom"].includes(provider)) {
            return appStorage.getItem("Custom-api_key");
        }
        if (provider.startsWith("custom:")) {
            return appStorage.getItem("g4f_session");
        }
        if (!single && provider === "AnyProvider") {
            return {
                "Pollinations": get_api_key_by_provider("Pollinations"),
                "HuggingFace": get_api_key_by_provider("HuggingFace"),
                "Together": get_api_key_by_provider("Together"),
                "GeminiPro": get_api_key_by_provider("GeminiPro"),
                "OpenRouter": get_api_key_by_provider("OpenRouter"),
                "OpenRouterFree": get_api_key_by_provider("OpenRouterFree"),
                "Groq": get_api_key_by_provider("Groq"),
                "DeepInfra": get_api_key_by_provider("DeepInfra"),
                "Replicate": get_api_key_by_provider("Replicate"),
                "PuterJS": get_api_key_by_provider("PuterJS"),
                "Nvidia": get_api_key_by_provider("Nvidia"),
                "Ollama": get_api_key_by_provider("Ollama"),
                "Airforce": get_api_key_by_provider("Airforce"),
            }
        }
        api_key = document.querySelector(`.${provider}-api_key`)?.id || null;
        if (api_key == null) {
            api_key = document.getElementById(`${provider}-api_key`)?.id || null;
        }
        if (api_key) {
            const expires = appStorage.getItem(api_key.replace("-api_key", "-expires"));
            if (isTokenExpired(expires)) {
                appStorage.removeItem(api_key);
                appStorage.removeItem(api_key.replace("-api_key", "-expires"));
            }
            api_key = appStorage.getItem(api_key);
        }
        if (!api_key && provider.startsWith("Puter")) {
            return appStorage.getItem("puter.auth.token");
        }
        if (!api_key && ["GeminiPro", "Ollama", "Nvidia", "OpenRouterFree", "Pollinations", "Groq"].includes(provider)) {
            return appStorage.getItem("g4f_session");
        }
    }
    return api_key;
}

function setFavoriteModels(provider, defaultModel) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = framework.translate("Favorite Models:");
    const favorites = JSON.parse(appStorage.getItem("favorites") || "{}");
    let selected = favorites[provider];
    if (!selected) {
        selected = {};
        if (defaultModel) {
            selected[defaultModel] = 0;
        }
    }
    Object.keys(selected).forEach((key) => {
        const option = document.createElement('option');
        option.value = key;
        option.text = key;
        const value_option = modelSelect.querySelector(`option[value="${key}"]`)
        if (value_option) {
            const option = value_option.cloneNode(true);
            if (typeof option.dataset.remaining === 'undefined' || option.dataset.remaining > 0) {
                option.selected = true;
            }
            optgroup.appendChild(option);
            if (optgroup.childElementCount > 5) {
                delete selected[optgroup.firstChild.value];
                optgroup.removeChild(optgroup.firstChild);
            }
        }
    });
    favorites[provider] = selected;
    appStorage.setItem("favorites", JSON.stringify(favorites));
    modelSelect.appendChild(optgroup);
}

function set_favorite_providers() {
    const optgroup = document.createElement('optgroup');
    optgroup.label = framework.translate("Favorite Providers:");
    let favorites = JSON.parse(appStorage.getItem("favorite_providers") || "null");
    if (!favorites) {
        favorites = {};
        favorites[providerSelect.value] = 0;
    }
    Object.keys(favorites).forEach((key) => {
        const value_option = providerSelect.querySelector(`option[value="${key}"]`)
        if (value_option) {
            const option = value_option.cloneNode(true);
            optgroup.appendChild(option);
        }
    });
    providerSelect.appendChild(optgroup);
}

function setQuotaInfo(models, quota) {
    if (!quota) {
        return;
    }
    let defaultModel = null;
    models.forEach((model) => {
        let percent;
        if (quota.buckets) {
            if (!["gemini-3-pro-preview"].includes(defaultModel)) {
                defaultModel = null; // Use last model with enough quota as default instead of the first one
            }
            percent = (quota.buckets.filter((bucket) => bucket.modelId == model.id).pop()?.remainingFraction || 0) * 100;
            model.label = `${model.label} (${framework.translate("Remaining:")} ${percent}%)`;
        } else if (quota.models) {
            percent = (quota.models[model.id]?.quotaInfo?.remainingFraction || 0) * 100;
            model.label = `${model.label} (${framework.translate("Remaining:")} ${percent}%)`;
        } else if (quota.quota_snapshots) {
            function isPremium(model) {
                return model.includes("claude") || model.includes("gemini") || (model != "gpt-5-mini" && model.includes("gpt-5")) || model.includes("grok");
            }
            if (isPremium(model.id)) {
                percent = Math.max(0, quota.quota_snapshots?.premium_interactions?.percent_remaining || 0);
                model.label = `${model.label} (${framework.translate("Remaining:")} ${percent}%)`;
            } else {
                percent = Math.max(0, quota.quota_snapshots?.chat?.percent_remaining || 0);
                model.label = `${model.label} (${framework.translate("Remaining:")} ${percent}%)`;
            }
        } else {
            return;
        }
        if (percent !== undefined && percent < 10) {
            model.label += ` ⚠️`;
        } else {
            model.label += ` ✅`;
        }
        model.remaining_percent = percent;
        if (!defaultModel && percent >= 10) {
            defaultModel = model.id;
            models.forEach((model) => delete model.default);
            model.default = true;
        }
    });
    if (quota && quota.hasOwnProperty("balance")) {            
        let creditsInfo = `${framework.translate("Balance:")} ${quota.balance.toFixed(2).replace(".00", "")} Pollen`;
        if (quota.balance > 0) {
            creditsInfo += " ✅";
        } else {
            creditsInfo += " ⚠️";
        }
        if (models.length > 10) {
            models.unshift({id: "credits_info", label: creditsInfo, disabled: true});
        }
    }
    if (quota.credits) {
        const percent = (quota.credits.remaining / quota.credits.total) * 100;
        let creditsInfo = `${framework.translate("Credits:")} ${quota.credits.remaining}, ${framework.translate("Remaining:")} ${percent.toFixed(2)}%`;
        if (percent >= 10) {
            creditsInfo += " ✅";
        } else {
            creditsInfo += " ⚠️";
        }
        models.unshift({id: "credits_info", label: creditsInfo, disabled: true});
        if (models.length > 10) {
            models.push({id: "credits_info", label: creditsInfo, disabled: true});
        }
    }
    if (quota.session_usage) {
        models.push({id: "session_usage", label: `${framework.translate("Session usage:")} ${quota.session_usage.used_percent}%` + (quota.session_usage.used_percent > 90 ? " ⚠️" : " ✅"), disabled: true});
    }
    if (quota.weekly_usage) {
        models.push({id: "weekly_usage", label: `${framework.translate("Weekly usage:")} ${quota.weekly_usage.used_percent}%` + (quota.weekly_usage.used_percent > 90 ? " ⚠️" : " ✅"), disabled: true});
    }
    if (quota.allowanceInfo?.remaining) {
        const percent = (quota.allowanceInfo.remaining / quota.allowanceInfo.monthUsageAllowance) * 100;
        const total = (quota?.allowanceInfo?.remaining || 0) / 1e8;
        const creditsInfo = `${framework.translate("Credits:")} ${total.toFixed(2)}$, ${framework.translate("Remaining:")} ${percent.toFixed(2)}%` + (percent > 10 ? " ✅" : " ⚠️");
        models.unshift({id: "credits_info", label: creditsInfo, disabled: true});
    }
    if (quota.total) {
        const providerInfo = quota.total > quota.offset ? `${quota.offset}/${quota.total} ${framework.translate("servers loaded ⚠️")}` : `${quota.total} ${framework.translate("servers loaded ✅")}`;
        models.unshift({id: "provider_info", label: providerInfo, disabled: true});
    }
    if (!defaultModel && client && client.defaultModel) {
        defaultModel = client.defaultModel;
        models.forEach((model) => {
            if ((model.model || model.id) == defaultModel) {
                model.default = true;
            } else {
                delete model.default;
            }
        });
    }
}

// Filter models based on provider count if hideOneProviderModels is enabled
function filterModels(models, shouldFilter) {
    if (!shouldFilter || !models) return models;

    function filterArray(arr) {
        return arr.filter(model => !model.count || model.count !== 1);
    }

    return filterArray(models);
}

function setProviderModels(models, provider, quota=null) {
    const hideOneProvider = appStorage.getItem("hideOneProviderModels") === "true";

    // Filter models if the setting is enabled
    if (hideOneProvider && models) {
        models = filterModels(models, true);
    }

    modelSelect.innerHTML = '';
    const option = providerSelect.options[providerSelect.selectedIndex];
    if (option) option.text = option.text.replaceAll(" 🟢", "") + (quota ? " 🟢" : "");
    function addOptions(group, models, search) {
        if (quota) {
            setQuotaInfo(models, quota);
        }
        models.forEach((model, i) => {
            if (!model.models) {
                let option = document.createElement('option');
                option.dataset.label = model.label || model.id || model;
                if (window.convertModel && model.id) convertModel(model);
                option.value = model.id || model;
                option.text = model.label || model.id || model;
                if (model.type) {
                    option.dataset.type = model.type;
                }
                if (model.audio) {
                    option.dataset.audio = "true";
                }
                if (model.remaining_percent !== undefined) {
                    option.dataset.remaining = model.remaining_percent;
                }
                group.appendChild(option);
                if (model.default) {
                    option.selected = true;
                }
                if (model.disabled) {
                    option.disabled = true;
                }
            } else {
                let optgroup = document.createElement('optgroup');
                optgroup.label = model.group;
                addOptions(optgroup, model.models, search);
                if (optgroup.childElementCount == 0) {
                    return;
                }
                modelSelect.appendChild(optgroup);
            }
        });
    }
    if (Array.isArray(models)) {
        addOptions(modelSelect, models, search);
        if (models.length > 2) {
            const defaultModel = models.map(m => m.models?.find(m => m.default) || m).find(m => m.default)?.id;
            setFavoriteModels(provider, defaultModel);
        }
    }
}
async function get_quota(provider) {
    if (!provider || provider == "AnyProvider" || provider.startsWith("custom:") || provider.startsWith("pa:")) {
        return;
    }
    const url = `${framework.backendUrl}/backend-api/v2/quota/${provider}`;
    const api_key = get_api_key_by_provider(provider, true);
    const response = await fetch(url, { method: 'GET', headers: api_key ? {"x-api-key": api_key} : {} });
    let data;
    try {
        data = await response.json();
    } catch (e) {
        add_error(e, true);
        return;
    }
    if (response.status == 401 || (data && data.error && data.error.code == 401)) {
        let input = document.querySelector(`.${provider}-api_key`);
        if (!input) {
            input = document.getElementById(`${provider}-api_key`);
        }
        console.warn("Unauthorized access for provider:", provider);
        if (input) {
            input.value = "";
            input.dataset.value = "";
            appStorage.removeItem(input.id);
            input.placeholder = framework.translate("Invalid API key");
        }
    }
    return response.ok ? data : undefined;
}
async function refreshModels(provider) {
    // PA providers expose models via the pa providers list, not the models API
    if (provider && String(provider).startsWith("pa:")) {
        const paId = provider.slice(3);
        const paEntry = window._paProviders && window._paProviders.find(p => p.id === paId);
        console.log("PA provider entry for provider:", provider, paEntry);
        if (paEntry && Array.isArray(paEntry.models) && paEntry.models.length > 0) {
            console.log("Setting PA provider models for provider:", provider, paEntry.models);
            setProviderModels(paEntry.models, provider);
        }
        return;
    }
    let models = appStorage.getItem(`${provider}:models`);
    if (models) {
        models = JSON.parse(models);
        setProviderModels(models, provider);
    }
    const [new_models, quota] = await Promise.all([api('models', provider), get_quota(provider)]);
    if (new_models) {
        setProviderModels(new_models, provider, quota);
        appStorage.setItem(`${provider}:models`, JSON.stringify(new_models));
    }
}
async function loadProviderModels(provider=null) {
    const isLoading = !!provider;
    if (!provider) {
        provider = providerSelect?.value;
    }
    if (!provider) {
        modelSelect.classList.add("hidden");
        return;
    }
    if (isLoading && providerSelect) {
        providerSelect.value = provider;
    }
    modelSelect.innerHTML = '';
    modelSelect.name = `model[${provider}]`;
    modelSelect.classList.remove("hidden");
    if (!isLoading && ["PuterJS"].includes(provider) && !appStorage.getItem("puter.auth.token") && window.Puter) {
        try {
            await (new window.Puter()).signIn().then((res) => {
                console.log('PuterJS signed in:', res);
            });
        } catch (error) {
            add_error(error, true);
        }
    }
    if (await initClient()) {
        return;
    }
    console.log("Loading models for provider:", provider);
    await refreshModels(provider);
};
addonsLoaded.then(() => {
    domReady.then(() => {
    if (providerSelect) {
        providerSelect.addEventListener("change", async () => {
            await loadProviderModels()
            const favorites = appStorage.getItem("favorite_providers") ? JSON.parse(appStorage.getItem("favorite_providers")) : {};
            const selected = providerSelect.options[providerSelect.selectedIndex];
            console.log("Selected provider:", providerSelect.value, selected);
            if (!favorites[providerSelect.value]) {
                const option = selected.cloneNode(true);
                const optgroup = providerSelect.querySelector('optgroup:last-child');
                if (optgroup) {
                    optgroup.appendChild(option);
                    if (optgroup.childElementCount > 5) {
                        delete favorites[optgroup.firstChild.value];
                        optgroup.removeChild(optgroup.firstChild);
                    }
                }
            }
            const selected_values = favorites[providerSelect.value] ? favorites[providerSelect.value] + 1 : 1;
            delete favorites[providerSelect.value];
            favorites[providerSelect.value] = selected_values;
            appStorage.setItem("favorite_providers", JSON.stringify(favorites));
        });
    }
    modelSelect.addEventListener("change", () => {
        const favorites = appStorage.getItem("favorites") ? JSON.parse(appStorage.getItem("favorites")) : {};
        const selected = favorites[providerSelect?.value] || {};
        const selectedOption = modelSelect.options[modelSelect.selectedIndex];
        console.log("Selected model:", modelSelect.value, selectedOption);
        if (!selected[modelSelect.value]) {
            const option = selectedOption.cloneNode(true);
            const optgroup = modelSelect.querySelector('optgroup:last-child');
            if (optgroup) {
                optgroup.appendChild(option);
                if (optgroup.childElementCount > 5) {
                    delete selected[optgroup.firstChild.value];
                    optgroup.removeChild(optgroup.firstChild);
                }
            }
        }
        const selected_values = selected[modelSelect.value] ? selected[modelSelect.value] + 1 : 1;
        delete selected[modelSelect.value];
        selected[modelSelect.value] = selected_values;
        favorites[providerSelect?.value] = selected;
        appStorage.setItem("favorites", JSON.stringify(favorites));
    });

    
document.getElementById("model_edit")?.addEventListener("click", () => {
    if (!modelSelector.classList.contains("hidden")) {
        providerSelect.classList.remove("hidden");
        modelSelect.classList.remove("hidden");
        modelSelector.classList.add("hidden");
        modelSearch.value = "";
        return;
    }
    providerSelect.classList.add("hidden");
    modelSelect.classList.add("hidden");
    modelSelector.classList.remove("hidden");
    modelSearch.focus()
});
modelSearch?.addEventListener('input', function() {
    const searchTerm = this.value.toLowerCase();
    modelSuggestions.innerHTML = '';

    if (!searchTerm) return;

    let matches = [];

    const selectedProvider = providerSelect.value;
    const filterByProvider = selectedProvider && selectedProvider !== "AnyProvider";
    const allowProviderMatch = appStorage.getItem("searchByProvider") === "true";
    const allowModelMatch = appStorage.getItem("searchByModel") !== "false";

    // Search across all models
    for (const [provider, modelList] of Object.entries(searchModels)) {
        if (filterByProvider && provider !== selectedProvider) continue;
        if (!Array.isArray(modelList)) continue;

        const providerMatch = allowProviderMatch && provider.toLowerCase().includes(searchTerm);

        modelList.forEach(model => {
            if (model.models) {
            model.models.forEach(subModel => {
                const modelMatch = allowModelMatch && subModel.model.toLowerCase().includes(searchTerm);
                if (modelMatch || providerMatch) {
                matches.push({ provider, model: subModel });
                }
            });
            } else {
            const modelStr = model.id || model;
            const modelMatch = allowModelMatch && modelStr.toLowerCase().includes(searchTerm);
            if (modelMatch || providerMatch) {
                matches.push({ provider, model });
            }
            }
        });
        }

        // Sort matches so that the currently selected provider is at the top
        if (selectedProvider && selectedProvider !== "AnyProvider") {
            matches.sort((a, b) => {
                if (a.provider === selectedProvider && b.provider !== selectedProvider) return -1;
                if (a.provider !== selectedProvider && b.provider === selectedProvider) return 1;
                return 0;
            });
        }

        // Limit matches to top 100 to prevent DOM rendering lag
        const topMatches = matches.slice(0, 100);

        // Display matches
        topMatches.forEach(match => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.innerHTML = `
            <strong>${match.model.id || match.model}</strong>
            <span class="provider-tag">${match.provider}</span>
        `;
        div.addEventListener('click', async () => {
            modelSearch.value = "";
            providerSelect.value = match.provider;
            await loadProviderModels();
            modelSelect.value = match.model.id || match.model;
            modelSelector.classList.add("hidden");
            providerSelect.classList.remove("hidden");
            modelSelect.classList.remove("hidden");
            modelSuggestions.innerHTML = '';
            console.log(`Selected model: ${match.model}`);
        });
        modelSuggestions.appendChild(div);
        });
    });
    async function loadModels(providers) {
        searchModels = await api('models');
    }

    // Close dropdown when clicking outside
    if (modelSuggestions)
    document.addEventListener('click', (e) => {
        if (e.target !== modelSearch) {
        modelSuggestions.innerHTML = '';
        }
    });

    document.getElementById("pin").addEventListener("click", async () => {
        add_pinned(providerSelect?.value, get_selected_model());
    });
    JSON.parse(appStorage.getItem("pinned") || "[]").forEach((el) => {
        add_pinned(el.provider, el.model, false);
    });
});
function add_pinned(selected_provider, selected_model, save=true) {
    if (save) {
        const all_pinned_saved = JSON.parse(appStorage.getItem("pinned") || "[]");
        appStorage.setItem("pinned", JSON.stringify([{
            provider: selected_provider?.value || selected_provider,
            model: selected_model?.value || selected_model,
        }, ...all_pinned_saved]));
    }
    const pinned = document.createElement("button");
    pinned.classList.add("pinned");
    if (selected_provider) pinned.dataset.provider = selected_provider.value || selected_provider;
    if (selected_model) pinned.dataset.model = selected_model.value || selected_model;
    pinned.innerHTML = `
        <span>
        ${selected_provider && selected_provider.dataset ? selected_provider.dataset.label || selected_provider.text : selected_provider}
        ${selected_provider && selected_model ? "/" : ""}
        ${selected_model && selected_model.dataset ? selected_model.dataset.label || selected_model.text : selected_model}
        </span>
        <i class="fa-regular fa-circle-xmark"></i>`;
    pinned.addEventListener("click", () => {
        pin_container.removeChild(pinned);
        let all_pinned = JSON.parse(appStorage.getItem("pinned") || "[]");
        all_pinned = all_pinned.filter((el) => {
            return el.provider != pinned.dataset.provider || el.model != pinned.dataset.model;
        });
        appStorage.setItem("pinned", JSON.stringify(all_pinned));
    });
    all_pinned = pin_container.querySelectorAll(".pinned");
    while (all_pinned.length > 4) {
        pin_container.removeChild(all_pinned[0])
        all_pinned = pin_container.querySelectorAll(".pinned");
    }
    pin_container.appendChild(pinned);
}
    searchButton.addEventListener("click", async () => {
        setTimeout(() => userInput.focus(), 100);
        searchButton.classList.toggle("active");
        (searchButton.querySelector("*")).innerText = (searchButton.classList.contains("active") ? framework.translate("Search On") : framework.translate("Search Off"));
    });
});

async function save_storage(settings=false) {
    let filename = `${settings ? 'settings' : 'chat'} ${new Date().toLocaleString()}.json`.replaceAll(":", "-");
    let data = {"options": {"g4f": ""}};
    if (!settings) {
        const conversations = await list_conversations();
        conversations.forEach((conversation) => {
            data[`conversation:${conversation.id}`] = conversation;
        });
    }
    for (let i = 0; i < appStorage.length; i++) {
        let key = appStorage.key(i);
        let item = appStorage.getItem(key);
        if (key.startsWith("conversation:")) {
            if (!settings) {
                data[key] = JSON.parse(item);
            }
        } else if (key.startsWith("bucket:")) {
            if (!settings) {
                data[key] = item;
            }
        } else if (settings && !key.endsWith("-form") && !key.endsWith("user")) {
            data["options"][key] = item;
        } 
    }
    data = JSON.stringify(data, null, 4);
    const blob = new Blob([data], {type: 'application/json'});
    const elem = window.document.createElement('a');
    elem.href = window.URL.createObjectURL(blob);
    elem.download = filename;        
    document.body.appendChild(elem);
    elem.click();        
    document.body.removeChild(elem);
}

async function get_recognition_language() {
    const lang = document.getElementById("recognition-language")?.value;
    if (lang) {
        return lang;
    }
    if (navigator.language == "en") {
        return "en-US";
    }
    let locale = navigator.language;
    if (!locale.includes("-")) {
        locale = appStorage.getItem(navigator.language);
        if (locale) {
            return locale;
        }
        try {
            const prompt = 'Response the full locale in JSON. Example: {"locale": "en-US"} Language: ' + navigator.language
            response = await framework.query(prompt, true);
            locale = (await response.json()).locale || navigator.language;
            if (locale.includes("-")) {
                appStorage.setItem(navigator.language, locale);
            }
        } catch (e) {
            add_error(e, true);
        }
    }
    return locale;
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let stopRecognition = () => {};
if (SpeechRecognition) {
    domReady.then(() => {
        const microLabel = document.querySelector(".micro-label");
        const mircoIcon = microLabel.querySelector("i");
        mircoIcon.classList.add("fa-microphone");
        mircoIcon.classList.remove("fa-microphone-slash");

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        let startValue;
        let buffer;
        let lastDebounceTranscript;
        recognition.onstart = function() {
            startValue = userInput.value;
            lastDebounceTranscript = "";
            userInput.readOnly = true;
            buffer = "";
        };
        recognition.onend = function() {
            if (buffer) {
                userInput.value += `${startValue ? startValue + "\n" : ""}${buffer}`;
                buffer = "";
                count_input();
            }
            if (microLabel.classList.contains("recognition")) {
                recognition.start();
            } else {
                userInput.readOnly = false;
                userInput.focus();
            }
        };
        recognition.onresult = function(event) {
            if (!event.results) {
                return;
            }
            let result = event.results[event.resultIndex];
            let isFinal = result.isFinal && (result[0].confidence > 0);
            let transcript = result[0].transcript;
            if (isFinal) {
                if(transcript == lastDebounceTranscript) {
                    return;
                }
                lastDebounceTranscript = transcript;
            }
            if (transcript) {
                inputCount.innerText = transcript;
                if (isFinal) {
                    buffer = `${buffer ? buffer + "\n" : ""}${transcript.trim()}`;
                }
            }
        };

        stopRecognition = ()=>{
            if (microLabel.classList.contains("recognition")) {
                microLabel.classList.remove("recognition");
                recognition.stop();
                count_input();
                return true;
            }
            return false;
        }

        microLabel.addEventListener("click", async (e) => {
            if (!stopRecognition()) {
                microLabel.classList.add("recognition");
                microLabel.querySelector("*").innerText = framework.translate("Recognition On");
                recognition.lang = await get_recognition_language();
                recognition.start();
            } else {
                microLabel.querySelector("*").innerText = framework.translate("Recognition Off");
            }
        });
    });
}

export default {
    api,
    read_response,
    get_api_key_by_provider,
    setFavoriteModels,
    set_favorite_providers,
    setQuotaInfo,
    setProviderModels,
    get_quota,
    refreshModels,
    loadProviderModels,
    save_storage,
    get_recognition_language,
    stopRecognition
};