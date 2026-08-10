
let startup_questions = [];

const generateUUID = () => {
    if (crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
};

async function on_api() {
    let prompt_lock = false;
    userInput.addEventListener("keydown", async (evt) => {
        if (prompt_lock) return;
        // If not mobile and not shift enter
        let do_enter = userInput.value.endsWith("\n\n\n\n");
        if (do_enter || !window.matchMedia("(pointer:coarse)").matches && evt.keyCode === 13 && !evt.shiftKey) {
            evt.preventDefault();
            console.log("pressed enter");
            prompt_lock = true;
            setTimeout(()=>prompt_lock=false, 3000);
            await handle_ask(!do_enter);
        }
    });
    let timeoutBlur = null;
    userInput.addEventListener("focus", async (evt) => {
        userInput.style.height = userInputHeight?.value + "px";
    });
    userInput.addEventListener("blur", async (evt) => {
        timeoutBlur = setTimeout(() => userInput.style.height = "", 200);
    });
    codeButton?.addEventListener("click", async () => {
        clearTimeout(timeoutBlur);
        insertBackticksInTextarea(userInput);
    });
    sendButton.addEventListener(`click`, async () => {
        console.log("clicked send");
        if (prompt_lock) return;
        prompt_lock = true;
        setTimeout(()=>prompt_lock=false, 3000);
        stopRecognition();
        await handle_ask();
    });
    addButton.addEventListener(`click`, async () => {
        stopRecognition();
        await handle_ask(false);
    });
    userInput.addEventListener(`click`, async () => {
        stopRecognition();
    });

    // Get the Providers tab containers (or fall back to settingsContent for backward compatibility)
    const providersApiKeysContainer = document.getElementById("providers-api-keys-container") || settingsContent;
    const providersToggleContainer = document.getElementById("providers-toggle-container") || settingsContent;

    let providersListContainer = document.createElement("div");
    providersListContainer.classList.add("field", "collapsible");
    providersListContainer.innerHTML = `
        <div class="collapsible-header">
            <span class="label">${framework.translate('Providers API key')}</span>
            <i class="fa-solid fa-chevron-down"></i>
        </div>
        <div class="collapsible-content api-key hidden"></div>
    `;
    providersApiKeysContainer.appendChild(providersListContainer);

    providersListContainer.querySelector(".collapsible-header").addEventListener('click', (e) => {
        providersListContainer.querySelector(".collapsible-content").classList.toggle('hidden');
        providersListContainer.querySelector(".collapsible-header").classList.toggle('active');
    });
    if (providerSelect) {
        // Add Live Providers optgroup
        const optgroup = document.createElement("optgroup");
        optgroup.id = "live-providers-optgroup";
        optgroup.label = framework.translate('Live Providers');
        const liveProvidersEnabled = appStorage.getItem("enableLiveProviders") !== "false";
        if (!liveProvidersEnabled) {
            optgroup.disabled = true;
        }
        providerSelect.appendChild(optgroup);
        async function updateLiveProviderOptions() {
            try {
                Object.entries(await window.loadProviders()).forEach(([name, config]) => {
                    if (name === "custom") {
                        return; // Skip custom here, will be added separately
                    }
                    if (["together", "huggingface", "typegpt"].includes(name) && !appStorage.getItem(window.providerLocalStorage[name])) {
                        return;
                    }
                    let option = document.createElement("option");
                    if (name === config.defaultModel) {
                        option.selected = true;
                    }
                    option.value = name;
                    option.dataset.live = "true";
                    option.text = (config.label || name) + (config.tags ? ` ${config.tags} 🟢` : " 🟢");
                    if (config.id) {
                        option.dataset.serverId = config.id;
                    }
                    optgroup.appendChild(option);
                });
                providerSelect.value = "default";
            } catch(e) {
                add_error(e, true);
            }
        }

        // Add Custom Providers optgroup
        const customOptgroup = document.createElement("optgroup");
        customOptgroup.id = "custom-providers-optgroup";
        customOptgroup.label = framework.translate('Custom Providers');
        const customProvidersEnabled = appStorage.getItem("enableCustomProviders") !== "false";
        if (!customProvidersEnabled) {
            customOptgroup.disabled = true;
        }
        providerSelect.appendChild(customOptgroup);
        async function loadCustomProvidersSelect() {
            try {
                // Add Custom provider if configured (local custom provider)
                if (appStorage.getItem("Custom-api_base")) {
                    const customOption = document.createElement("option");
                    customOption.value = "custom";
                    customOption.dataset.live = "true";
                    customOption.dataset.custom = "true";
                    customOption.text = "Custom Provider 🔧";
                    customOptgroup.appendChild(customOption);
                } 
                // Load custom providers from API and add to toggle list
                await loadCustomProvidersFromAPI(document.getElementById("custom-providers-optgroup"));
            } catch(e) {
                add_error(e, true);
            }
        }

        // Add PA Providers optgroup
        const paOptgroup = document.createElement("optgroup");
        paOptgroup.id = "pa-providers-optgroup";
        paOptgroup.label = framework.translate('PA Providers');
        providerSelect.appendChild(paOptgroup);

        async function loadCoreProvidersSelect() {
            let provider_options = [];
            await api("providers").then(async (providers) => {
                await load_providers(providers, provider_options, providersListContainer, providersToggleContainer);
            }).catch(async (e)=>{
                add_error(e, true);
                providerSelect.querySelectorAll("option:not([data-live])").forEach((el)=>el.remove());
                await load_provider_login_urls(providersListContainer, providers);
                await load_settings(provider_options);
            });
        }

        await Promise.all([
            updateLiveProviderOptions(),
            loadCustomProvidersSelect(),
            loadPaProviderSelect(paOptgroup),
            loadCoreProvidersSelect()
        ]).then(() => {
            loadProviderModels(appStorage.getItem("provider"));
        });

        set_favorite_providers();
    } else {
        await load_provider_login_urls(providersListContainer, providers);
        await load_settings({});
        await initClient();
    }

    const update_systemPrompt_icon = (checked) => {
        slide_systemPrompt_icon.classList[checked ? "remove": "add"]("fa-angles-up");
        slide_systemPrompt_icon.classList[checked ? "add": "remove"]("fa-angles-down");
        chatPrompt.classList[checked ? "add": "remove"]("hidden");
    };
    if (appStorage.getItem("hide-systemPrompt") == "true") {
        update_systemPrompt_icon(true);
    }
    slide_systemPrompt_icon.addEventListener("click", ()=>{
        update_systemPrompt_icon(slide_systemPrompt_icon.classList.contains("fa-angles-up"));
    });
    hide_systemPrompt ? hide_systemPrompt.addEventListener('change', async (event) => {
        update_systemPrompt_icon(event.target.checked);
    }) : null;
    const darkMode = document.getElementById("darkMode");
    if (darkMode) {
        darkMode.addEventListener('change', async (event) => {
            if (event.target.checked) {
                document.body.classList.remove("white");
            } else {
                document.body.classList.add("white");
            }
        });
    }
    const enableModelSearch = document.getElementById("enableModelSearch");
    const searchProviderField = document.getElementById("searchProviderField");
    const searchModelField = document.getElementById("searchModelField");
    if (enableModelSearch) {
        enableModelSearch.addEventListener('change', async (event) => {
            appStorage.setItem("enableModelSearch", event.target.checked ? "true" : "false");
            if (event.target.checked) {
                document.getElementById("model_edit")?.parentElement.classList.remove("hidden");
                if (searchProviderField) searchProviderField.style.display = "flex";
                if (searchModelField) searchModelField.style.display = "flex";
            } else {
                document.getElementById("model_edit")?.parentElement.classList.add("hidden");
                if (searchProviderField) searchProviderField.style.display = "none";
                if (searchModelField) searchModelField.style.display = "none";
                // Reset search UI if it was open
                if (modelSelector && !modelSelector.classList.contains("hidden")) {
                    providerSelect?.classList.remove("hidden");
                    modelSelect?.classList.remove("hidden");
                    modelSelector.classList.add("hidden");
                }
            }
        });
        if (appStorage.getItem("enableModelSearch") === "false") {
            enableModelSearch.checked = false;
            document.getElementById("model_edit")?.parentElement.classList.add("hidden");
            if (searchProviderField) searchProviderField.style.display = "none";
            if (searchModelField) searchModelField.style.display = "none";
        } else {
            enableModelSearch.checked = true;
            if (searchProviderField) searchProviderField.style.display = "flex";
            if (searchModelField) searchModelField.style.display = "flex";
        }
    }
    const searchByProvider = document.getElementById("searchByProvider");
    if (searchByProvider) {
        searchByProvider.addEventListener('change', async (event) => {
            appStorage.setItem("searchByProvider", event.target.checked ? "true" : "false");
        });
        if (appStorage.getItem("searchByProvider") !== "true") {
            searchByProvider.checked = false;
        } else {
            searchByProvider.checked = true;
        }
    }
    const searchByModel = document.getElementById("searchByModel");
    if (searchByModel) {
        searchByModel.addEventListener('change', async (event) => {
            appStorage.setItem("searchByModel", event.target.checked ? "true" : "false");
        });
        if (appStorage.getItem("searchByModel") === "false") {
            searchByModel.checked = false;
        } else {
            searchByModel.checked = true;
        }
    }
    const liquid = document.getElementById("liquid");
    if (liquid) {
        liquid.addEventListener('change', async (event) => {
            if (event.target.checked) {
                document.body.classList.add("liquid");
            } else {
                document.body.classList.remove("liquid");
            }
        });
    }
    const disableAnimations = document.getElementById("disableAnimations");
    if (disableAnimations) {
        disableAnimations.addEventListener('change', async (event) => {
            if (event.target.checked) {
                document.body.classList.add("no-animations");
            } else {
                document.body.classList.remove("no-animations");
            }
        });
    }

    document.getElementById('recognition-language').placeholder = await get_recognition_language();
}

addonsLoaded.then(() => {
    console.log("addonsLoaded, calling on_load and on_api");
    domReady.then(async () => {
        console.log("domReady, calling on_load and on_api");
        await on_load();
        await on_api();

        if (window.conversation_id) {
            let conversation = await get_conversation(window.conversation_id);
            if (!conversation) {
                // New conversation not yet in IndexedDB, nothing to load
                return;
            }
            if (!conversation.share) {
                await load_conversation(conversation);
                await play_last_message();
                return;
            }
            const response = await fetch(`${framework.backendUrl}/backend-api/v2/chat/${window.conversation_id}`, {
                headers: {'accept': 'application/json'},
            });
            if (!response.ok) {
                return await load_conversation(conversation);
            }
            conversation = await response.json();
            if (conversation.id == window.conversation_id) {
                await save_conversation(conversation);
                await load_conversations();
            }
            await load_conversation(window.conversation_id);
        }
        
        // Set default sidebar state based on screen size
        if (window.innerWidth >= 640) { // 40em = 640px
            sidebar.classList.add("shown");
            sidebar.classList.remove("minimized");
        } else {
            sidebar.classList.remove("shown");
        }
        // Ensure sidebar is shown by default on desktop
        if (window.innerWidth >= 640) { // 40em = 640px
            sidebar.classList.add("shown");
            sidebar.classList.remove("minimized");
        }
    });
});

let refreshOnHidden = true;
document.addEventListener("visibilitychange", () => {
    refreshOnHidden = !document.hidden;
});

let lastUpdated = null;;
addonsLoaded.then(() => {
    setInterval(async () => {
        if (!refreshOnHidden || !window.conversation_id) {
            return;
        }
        let conversation = await get_conversation(window.conversation_id);
        if (!conversation || !conversation.share) {
            return
        }
        refreshOnHidden = false;
        const now = Math.floor(Date.now() / 1000);
        const response = await fetch(`${framework.backendUrl}/backend-api/v2/chat/${conversation.id}?now=${now - now % 5}`, {
            headers: {
                'accept': 'application/json',
                'if-none-match': conversation.updated,
            },
        });
        refreshOnHidden = true;
        if (response.status == 200) {
            const new_conversation = await response.json();
            if (conversation.id == window.conversation_id && new_conversation.updated != conversation.updated) {
                conversation = new_conversation;
                await save_conversation(conversation);
            }
        }
        if (lastUpdated != conversation.updated) {
            lastUpdated = conversation.updated;
            await load_conversations();
            await load_conversation(conversation);
        }
    }, 5000);
});

window.addEventListener("load", (event) => {
    if (!window.location.hash.substring(1)) {
        render_startup_questions();
    }
});

async function on_load() {
    count_input();
    const locationHash = window.location.hash.substring(1);
    if (locationHash === "login") {
        window.location.href='https://g4f.dev/members?redirect='+encodeURIComponent(location.href.split('#')[0])+'&conversation='+encodeURIComponent(window.conversation_id);
        return;
    }
    if (locationHash === "settings") {
        open_settings();
        await load_conversations();
        return;
    }
    let isNewConversation = locationHash === "" || ["new", "private"].includes(locationHash);
    if (!isNewConversation && !locationHash.startsWith("session=") && locationHash !== "menu") {
        window.conversation_id = locationHash;
    } else {
        window.conversation_id = generateUUID();
    }
    if (chatPrompt) {
        chatPrompt.value = document.getElementById("systemPrompt")?.value || "";
    }
    let chatParams = new URLSearchParams(window.location.search);
    if (chatParams.get("prompt")) {
        userInput.value = chatParams.get("prompt");
        userInput.focus();
        window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    }
    if (isNewConversation) {
        await new_conversation(locationHash === "private");
    } else {
        await load_conversations();
    }
    // Ensure sidebar is shown by default on desktop
    if (window.innerWidth >= 640) {
        sidebar.classList.add("shown");
        sidebar.classList.remove("minimized");
    }
}

function render_startup_questions() {
    if (!Array.isArray(startup_questions) || !startup_questions.length) {
        return;
    }
    try {
        const used_startup_questions = startup_questions.sort(() => .5 - Math.random()).slice(0, 4);
        const suggestions_el = document.createElement("div");
        suggestions_el.classList.add("suggestions");
        used_startup_questions.forEach((suggestion)=> {
            const el = document.createElement("button");
            el.classList.add("suggestion");
            el.innerHTML = `<span>${framework.escape(suggestion)}</span> <i class="fa-solid fa-turn-up"></i>`;
            el.onclick = async () => {
                startup_questions = startup_questions.filter((q) => q != suggestion);
                await handle_ask(true, suggestion);
            }
            suggestions_el.appendChild(el);
        });
        chatBody.querySelectorAll('.suggestions').forEach((suggestions_el) => suggestions_el.remove());
        chatBody.appendChild(suggestions_el);
    } catch (e) {
        add_error("Failed to render startup questions:", e);
    }
}
async function load_startup_questions() {
    let prompt = `Generate a JSON-formatted list of engaging and diverse questions I can ask you at the start of a new conversation.
Example: 
\`\`\`json
{
    "q": [
        "🤖 What are the latest advancements in AI?",
        "🗾✈️ Can you help me plan a trip to Japan?",
        "🥗🍎 What are some healthy meal ideas?"
    ]
}
\`\`\``;
    if (appStorage.getItem(framework.translationKey) && navigator.language.startsWith("en") == false) {
        prompt += `\nRespond in ${navigator.language}.`;
    }
    try {
        const response = await framework.query(prompt, {json: true, seed: Math.floor(Date.now() / 1000 / 3600 / 24)});
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        startup_questions = await response.json()
        startup_questions = startup_questions.q || startup_questions.questions || startup_questions;
    } catch (e) {
        add_error("Failed to parse startup questions:", e);
    }
}
async function load_follow_up_questions(messages, new_response) {
    if (appStorage.getItem("aiFeatures") !== "true") {
        return;
    }
    if (suggestions) {
        return;
    }
    messages = messages.filter((msg) => !Array.isArray(msg.content) && msg.content && msg.role === "user");
    let prompt = `Suggest 3-4 follow-up questions that sound like they come from the user.
    Use first-person language and reflect the user's intent, curiosity, or goals.
    Stay relevant, avoid generic questions, and help deepen the conversation naturally.
    Generate a short conversation title with emojis. Keep it natural and relevant. Return as JSON with "questions" and "title" keys.`;
    prompt += `
\`\`\`json
{
  "title": "✨ 🧠 The Next Steps",
  "q": [
    "🛠️ Can you help me brainstorm ideas for a weekend project?",
    "🇩🇪 What are some interesting facts about Germany I might not know?",
    "🌙 How do I stay productive when working late at night?",
    "😌 What are some relaxing things to do before bed?"
  ]
}
\`\`\``;
    if (appStorage.getItem(framework.translationKey) && navigator.language.startsWith("en") == false) {
        prompt += `\n\nRespond in language ${navigator.language}.`;
    }
    const new_messages = [{role: "assistant", content: new_response}, {role: "user", content: prompt}];
    console.log("Loading follow up questions with messages:", new_messages);
    try {
        const response = await fetch("https://g4f.space/ai/?json=true", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...appStorage.getItem("g4f_session") ? {"Authorization": `Bearer ${appStorage.getItem("g4f_session")}`} : {}
            },
            body: JSON.stringify({
                messages: messages.concat(new_messages)
        })});
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        window.captureUserTierHeaders?.(response.headers);
        const follow_up_questions = await response.json()
        suggestions = follow_up_questions.q || follow_up_questions.questions || follow_up_questions;
        const conversation = await get_conversation(window.conversation_id);
        conversation.title = follow_up_questions.title || conversation.title || "";
        await save_conversation(conversation);
        await load_conversations();
        await safe_load_conversation(window.conversation_id);
    } catch (e) {
        add_error("Failed to parse follow up questions:", e);
    }
}

async function hide_sidebar(remove_shown=false) {
    if (remove_shown && window.innerWidth < 640) { // Only apply on mobile
        sidebar.classList.remove("shown");
    }
    settings.classList.add("hidden");
    chat.classList.remove("hidden");
    logStorage?.classList.add("hidden");
    await hide_settings();
    if (window.location.hash.endsWith("#menu") || window.location.hash.endsWith("#settings")) {
        history.back();
    }
}

async function hide_settings() {
    settings.classList.add("hidden");
    let provider_forms = document.querySelectorAll(".provider_forms from");
    Array.from(provider_forms).forEach((form) => form.classList.add("hidden"));
}

addonsLoaded.then(() => {
    domReady.then(() => {
        load_startup_questions();
    });
});
export default {
    load_startup_questions,
    load_follow_up_questions,
    render_startup_questions,
    hide_sidebar,
    hide_settings,
    generateUUID,
};