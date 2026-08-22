/* ================================================================== *
 * Addon: Settings UI
 *
 * Settings panel UI, storage, search, and configuration management.
 * ================================================================== */

(function () {
    'use strict';

    ChatAddons.register({
        id: 'builtin:settings',
        name: 'Settings UI',
        version: '1.0.0',
        description: 'Settings panel UI, storage, search, and configuration management.',
        author: 'g4f',
        builtin: true,
        permissions: ['storage:local', 'dom:write', 'dom:query'],

        load() {
            return (async () => {})
        }
    });
})();

const register_settings_storage = async () => {
    const optionElements = document.querySelectorAll(optionElementsSelector);
    optionElements.forEach((element) => {
        const storageKey = element.dataset.storageKey || element.id;
        if (element.type == "textarea") {
            element.addEventListener('input', async (event) => {
                appStorage.setItem(storageKey, element.value);
            });
        } else {
            element.addEventListener('change', async (event) => {
                switch (element.type) {
                    case "checkbox":
                        appStorage.setItem(storageKey, element.checked);
                        break;
                    case "select-one":
                        appStorage.setItem(storageKey, element.value);
                        break;
                    case "url":
                    case "text":
                    case "number":
                        appStorage.setItem(storageKey, element.value);
                        break;
                    default:
                        console.warn("Unresolved element type");
                }
            });
        }
        if (element.id.endsWith("-api_key")) {
            element.addEventListener('focus', async (event) => {
                if (element.dataset.value) {
                    element.value = element.dataset.value
                }
            });
            element.addEventListener('blur', async (event) => {
                element.dataset.value = element.value;
                if (element.value) {
                    element.placeholder = element.value && element.value.length >= 22 ? (element.value.substring(0, 12)+"*".repeat(12)+element.value.substring(element.value.length-12)) : "*".repeat(element.value.length);
                } else if (element.placeholder != "api_key") {
                    element.placeholder = "";
                }
                element.value = ""
            });
        }
        // Handle Custom-api_base changes to update custom provider dropdown
        if (element.id === "Custom-api_base") {
            element.addEventListener('input', async (event) => {
                updateCustomProviderOption(element.value);
            });
            element.addEventListener('change', async (event) => {
                updateCustomProviderOption(element.value);
            });
        }
        // Handle log_routing toggle to enable/disable routing
        if (element.id === "log_routing") {
            element.addEventListener('change', (event) => {
                framework.logUrl = element.checked ? `${framework.backendUrl}/api` : '';
                localStorage.setItem('log_routing', element.checked);
            });
        }
        // Handle hideOneProviderModels changes to refresh model list
        if (element.id === "hideOneProviderModels") {
            element.addEventListener('change', async (event) => {
                // Refresh the current provider's models with the new filter applied
                await refreshModels(providerSelect?.value);
            });
        }
    });
}

function updateCustomProviderOption(apiBaseValue) {
    const customOptgroup = document.getElementById("custom-providers-optgroup");
    if (!customOptgroup) return;

    const existingOption = customOptgroup.querySelector('option[value="Custom"]');

    if (apiBaseValue && apiBaseValue.trim()) {
        if (!existingOption) {
            const customOption = document.createElement("option");
            customOption.value = "Custom";
            customOption.dataset.live = "true";
            customOption.dataset.custom = "true";
            customOption.text = "Custom Provider 🔧";
            customOptgroup.appendChild(customOption);
        }
    } else {
        if (existingOption) {
            existingOption.remove();
        }
    }
}

async function loadCustomProvidersFromAPI(customOptgroup, providersContainer = null) {
    if (!customOptgroup) {
        customOptgroup = document.getElementById("custom-providers-optgroup");
    }
    if (!customOptgroup) return;

    try {
        let privateData;
        if (appStorage.getItem("g4f_session")) {
            const url = "https://g4f.space/custom/api/servers";
            const resp = await fetch(url, {
                headers: {'Authorization': `Bearer ${appStorage.getItem("g4f_session") || ""}`}
            });
            if (resp.status === 401) {
                appStorage.removeItem("g4f_session");
            }
            privateData = await resp.json();
        }
        const publicUrl = "https://g4f.space/custom/api/servers/public";
        const publicResp = await fetch(publicUrl);
        let data = await publicResp.json();
        data = data.servers;
        if (privateData) {
            if (privateData.servers) {
                data = data.concat(privateData.servers.filter(server=>!server.is_public));
            }
        }
        // Store servers globally for client creation
        window.customServers = data;

        data.forEach(server => {
            if (server.is_public && (!server.is_online || server.is_ollama || server.is_hidden)) {
                return;
            }
            // Check if this server already exists in dropdown
            const existingOption = providerSelect.querySelector(`option[data-server-id="${server.id}"]`);
            if (!existingOption) {
                const option = document.createElement("option");
                option.value = `custom:${server.id}`;
                option.dataset.live = "true";
                option.dataset.custom = "true";
                option.dataset.serverId = server.id;
                option.dataset.baseUrl = server.base_url;
                option.dataset.label = server.label;
    
                // Build label with model count if available
                let label = server.label || server.id;
                if (server.allowed_models && server.allowed_models.length > 0) {
                    label += ` (${server.allowed_models.length} models)`;
                }
                option.text = `${label} 🌐`;
    
                customOptgroup.appendChild(option);
            }

            // Add to providers toggle list if container provided
            if (providersContainer) {
                const toggleContent = providersContainer.querySelector(".collapsible-content");
                if (toggleContent && !toggleContent.querySelector(`#ProviderCustom${server.id}`)) {
                    const providerItem = document.createElement("div");
                    providerItem.classList.add("provider-item", "custom-server-item");
                    const isEnabled = appStorage.getItem(`enableCustomServer_${server.id}`) !== "false";
                    providerItem.innerHTML = `
                        <span class="label">${server.label || server.id} 🌐</span>
                        <input id="ProviderCustom${server.id}" type="checkbox" name="ProviderCustom${server.id}" value="custom:${server.id}" class="provider custom-server" data-server-id="${server.id}" ${isEnabled ? 'checked="checked"' : ''}/>
                        <label for="ProviderCustom${server.id}" class="toogle" title="Enable or disable this custom server"></label>
                    `;
                    providerItem.querySelector("input").addEventListener("change", (event) => {
                        appStorage.setItem(`enableCustomServer_${server.id}`, event.target.checked ? "true" : "false");
                        const option = customOptgroup.querySelector(`option[data-server-id="${server.id}"]`);
                        if (option) {
                            option.disabled = !event.target.checked;
                        }
                    });
                    toggleContent.appendChild(providerItem);
                }
            }
        });
    } catch (e) {
        console.debug("Failed to load custom providers from API:", e);
    }
}

window.load_settings = async (provider_options) => {
    await register_settings_storage();
    await load_settings_storage();

    Object.entries(provider_options).forEach(
        ([provider_name, option]) => load_provider_option(option.querySelector("input"), provider_name)
    );
}

const load_settings_storage = async () => {
    const optionElements = document.querySelectorAll(optionElementsSelector);
    optionElements.forEach((element) => {
        const storageKey = element.dataset.storageKey || element.id;
        let value = appStorage.getItem(storageKey);
        if (value == null && element.dataset.value) {
            value = element.dataset.value;
        }
        if (value) {
            switch (element.type) {
                case "checkbox":
                    element.checked = value === "true";
                    break;
                case "select-one":
                    element.value = value;
                    break;
                case "url":
                case "text":
                case "number":
                case "textarea":
                    if (element.id.endsWith("-api_key")) {
                        element.placeholder = value && value.length >= 22 ? (value.substring(0, 12)+"*".repeat(12)+value.substring(value.length-12)) : "*".repeat(value ? value.length : 0);
                        element.dataset.value = value;
                    } else {
                        element.value = value == null ? element.dataset.value : value;
                    }
                    break;
                default:
                    console.warn("`Unresolved element type:", element.type);
            }
        }
    });
}

const say_hello = async () => {
    tokens = framework.translate(`Hello! How can I assist you today?`).split(" ").map((token) => token + " ");

    let to_modify = document.querySelector(`.welcome-message`);
    if (!to_modify) {
        const message_container = document.createElement("div");
        message_container.innerHTML = `
            <div class="message">
                <div class="assistant">
                    ${gpt_image}
                    <i class="fa-regular fa-phone-arrow-down-left"></i>
                </div>
                <div class="content">
                    <p class=" welcome-message"></p>
                </div>
            </div>
        `;
        chatBody.appendChild(message_container.firstElementChild);
    } else {
        to_modify.textContent = "";
    }

    to_modify = document.querySelector(`.welcome-message`);
    for (token of tokens) {
        await new Promise(resolve => setTimeout(resolve, (Math.random() * (100 - 200) + 100)))
        to_modify.textContent += token;
    }
}

function count_tokens(model, text, prompt_tokens = 0) {
    if (!text) {
        return 0;
    }
    if (model) {
        if (window.llamaTokenizer)
        if (model.startsWith("llama") || model.startsWith("codellama")) {
            return llamaTokenizer.encode(text).length;
        }
        if (window.mistralTokenizer)
        if (model.startsWith("mistral") || model.startsWith("mixtral")) {
            return mistralTokenizer.encode(text).length;
        }
    }
    if (window.GPTTokenizer_cl100k_base && (model?.startsWith("gpt-3") || model == "gpt-4")) {
        model = model?.startsWith("gpt-3") ? "gpt-3.5-turbo" : "gpt-4"
        return GPTTokenizer_cl100k_base?.encode(text, model).length;
    } else if (window.GPTTokenizer_o200k_base) {
        return GPTTokenizer_o200k_base?.encode(text, model).length;
    } else {
        return prompt_tokens;
    }
}

function count_words(text) {
    return text.trim().match(/[\w\u4E00-\u9FA5]+/gu)?.length || 0;
}

function count_chars(text) {
    return text.match(/[^\s\p{P}]/gu)?.length || 0;
}

function calculateBase64Size(base64String) {
    // Remove any whitespace that might be in the base64 string
    const cleanBase64 = base64String.replace(/\s/g, '');
    // Each base64 character represents 6 bits, and padding is accounted for
    const padding = (cleanBase64.match(/=/g) || []).length;
    const sizeInBytes = Math.floor((cleanBase64.length * 3) / 4) - padding;
    return sizeInBytes;
}

function get_media_size(text) {
    if (Array.isArray(text) || !text) {
        return null;
    }

    // Check for base64-encoded image in markdown format: [![alt](data:image/...))](...)
    const imageMarkdownMatch = text.match(/!\[.*?\]\(data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)\)/);
    if (imageMarkdownMatch && imageMarkdownMatch[1]) {
        return calculateBase64Size(imageMarkdownMatch[1]);
    }

    // Check for base64-encoded media in video/audio tags: <video controls src="data:..."></video>
    const mediaTagMatch = text.match(/<(?:video|audio)[^>]*src="data:[^;]+;base64,([A-Za-z0-9+/=]+)"/);
    if (mediaTagMatch && mediaTagMatch[1]) {
        return calculateBase64Size(mediaTagMatch[1]);
    }

    return null;
}

function count_words_and_tokens(text, model, completion_tokens, prompt_tokens) {
    if (Array.isArray(text) || !text) {
        return "";
    }

    // Check if the message contains media (image/video)
    const mediaSize = get_media_size(text);
    if (mediaSize !== null) {
        // Show size instead of word/token count for media responses
        return `(${formatFileSize(mediaSize)})`;
    }

    text = filter_message(text);
    return `(${count_words(text)} ${framework.translate('words')}, ${count_chars(text)} ${framework.translate('chars')}, ${completion_tokens ? completion_tokens : count_tokens(model, text, prompt_tokens)} ${framework.translate('tokens')})`;
}
const count_input = async () => {
    let countFocus = userInput;
    const countTokensEnabled = appStorage.getItem("countTokens") != "false";
    if (countTokensEnabled && countFocus.value) {
        if (window.matchMedia("(pointer:coarse)")) {
            inputCount.innerText = `(${count_tokens(get_selected_model(), countFocus.value)} tokens)`;
        } else {
            inputCount.innerText = count_words_and_tokens(countFocus.value, get_selected_model());
        }
    } else {
        inputCount.innerText = "";
    }
};
addonsLoaded.then(() => {
    domReady.then(() => {
        userInput.addEventListener("keyup", count_input);
        chatPrompt.addEventListener("keyup", count_input);
        chatPrompt.addEventListener("focus", function() {
            countFocus = chatPrompt;
            count_input();
        });
        chatPrompt.addEventListener("input", function() {
            countFocus = userInput;
            count_input();
        });
        window.addEventListener("hashchange", async (event) => {
            if (window.iframe_container) window.iframe_container.classList.add("hidden");
            if (window.iframe) window.iframe.src = "";
            const locationHash = window.location.hash.substring(1);
            
            if (locationHash == "login") {
                window.location.href='https://g4f.dev/members?redirect='+encodeURIComponent(location.href.split('#')[0])+'&conversation='+encodeURIComponent(window.conversation_id);
                return;
            }
            if (locationHash == "menu" || locationHash == "settings") {
                if (locationHash == "settings") {
                    open_settings();
                }
                return;
            }
            hide_sidebar(true);
            if (locationHash && locationHash != "new") {
                window.conversation_id = locationHash;
                set_conversation(locationHash);
            } else {
                window.conversation_id = generateUUID();
                new_conversation();
            }
        });
    });
});

export default {
    register_settings_storage,
    load_settings_storage,
    loadCustomProvidersFromAPI,
    updateCustomProviderOption,
    say_hello,
    count_tokens,
    count_words,
    count_chars,
    count_words_and_tokens,
    count_input,
};