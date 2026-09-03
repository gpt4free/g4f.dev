const appStorage = window.localStorage || {
    setItem: (key, value) => window[key] = value,
    getItem: (key) => window[key],
    removeItem: (key) => delete window[key],
    length: 0,
};

const domReady = new Promise((resolve) => {
    document.addEventListener("DOMContentLoaded", resolve);
    if (document.readyState !== "loading" ) {
        resolve();
    }
});

const translationSnipptes = [
    "with", "**An error occurred:**", "Private Conversation", "New Conversation", "Regenerate", "Continue",
    "Hello! How can I assist you today?", "words", "chars", "tokens", "{0} total tokens",
    "{0} Messages were imported", "{0} File(s) uploaded successfully",
    "{0} Conversations/Settings were imported successfully",
    "No content found", "Files are loaded successfully",
    "Importing conversations...", "New version:", "Providers API key", "Providers (Enable/Disable)",
    "Get API key", "Uploading files...", "Invalid link", "Loading...", "Live Providers", "Custom Providers",
    "Search Off", "Search On", "Recognition On", "Recognition Off", "Delete Conversation",
    "Favorite Models:", "Stop Recording", "Record Audio", "Upload Audio", "No Title", "1 Copy",
    "Delete all conversations?", "Error Occurred", "Remaining:", "Balance:", "Reasoning", "Credits:",
    "Login", "Login to", "Enable", "Invalid API key", "Waiting for tool response...", "Hide Models with One Provider"
];

window.providers = [
    {"name": "Airforce", "label": "Api.Airforce", "login_url": "https://panel.api.airforce/dashboard", "active_by_default": true},
    {"name": "HuggingFace", "login_url": "https://huggingface.co/settings/tokens", "active_by_default": true},
    {"name": "HuggingFaceMedia", "parent": "HuggingFace", "active_by_default": true},
    {"name": "Pollinations", "label": "Pollinations AI", "login_url": "https://enter.pollinations.ai", "active_by_default": true},
    {"name": "Puter", "label": "Puter.js", "login_url": "https://discord.gg/qXA4Wf4Fsm", "active_by_default": true},
];

window.client = null;

domReady.then((event) => {
    // Addon bootstrap (no-op if addon-host.js already booted us)
    if (window.ChatAddons && typeof window.ChatAddons.boot === 'function') {
        window.ChatAddons.boot().then(() => window.ChatAddons.enableAll());
    }

    translationSnipptes.forEach((text) => framework.translate(text));
});


function add_url_to_history(url) {
    if (!window?.pywebview) {
        try {
            history.pushState({}, null, url);
        } catch (e) {
            console.error(e);
        }
    }
}

const new_conversation = async (is_private = false) => {
    if (window.location.hash) {
        await clear_conversation();
        add_url_to_history(is_private ? "#private" : window.location.pathname);
    }
    window.conversation_id = is_private ? null : generateUUID();
    document.title = window.title || document.title;
    document.querySelector(".chat-top-panel .convo-title").innerText = is_private ? framework.translate("Private Conversation") : framework.translate("New Conversation");
    
    window.suggestions = null;
    if (chatPrompt) {
        chatPrompt.value = document.getElementById("systemPrompt")?.value;
    }
    load_conversations();
    hide_sidebar(true);
    // say_hello();
    render_startup_questions?.();
};

domReady.then((event) => {
    document.querySelectorAll(".new_convo_icon, .new_convo").forEach((el) => {
        el.addEventListener("click", async () => {
            await new_conversation(el.classList.contains("private_conversation"));
        });
    });
});

const delete_conversations = async () => {
    if (!confirm(framework.translate("Delete all conversations?"))) {
        return;
    }
    // Delete all conversations
    const { store, done } = await withStore('readwrite');
    store.clear();

    hide_sidebar();
    await new_conversation();
    return done;
};

async function safe_remove_cancel_button() {
    for (let key in controller_storage) {
        if (!controller_storage[key].signal.aborted) {
            return;
        }
    }
    stop_generating.classList.add("stop_generating-hidden");
    if (wakeLock) {
        wakeLock.release();
        wakeLock = null;
    }
}

addonsLoaded.then(() => {
    domReady.then((event) => {
        regenerate_button.addEventListener("click", async () => {
            regenerate_button.classList.add("regenerate-hidden");
            setTimeout(()=>window.regenerate_button.classList.remove("regenerate-hidden"), 3000);
            const all_pinned = document.querySelectorAll("#pin_container button.pinned")
            if (all_pinned.length > 0) {
                all_pinned.forEach((el) => ask_gpt(get_message_id(), -1, true, el.dataset.provider, el.dataset.model, "variant"));
            } else {
                await ask_gpt(get_message_id(), -1, true, null, null, "variant");
            }
        });
        stop_generating.addEventListener("click", async () => {
            window.regenerate_button.classList.remove("regenerate-hidden");
            stop_generating.classList.add("stop_generating-hidden");
            // Stop the picker's auto-fallback retry chain so it doesn't
            // re-invoke ask_gpt with another provider after we abort.
            if (typeof window.resetFallback === "function") {
                window.resetFallback();
            }
            let key;
            for (key in controller_storage) {
                if (!controller_storage[key].signal.aborted) {
                    console.log(`aborted ${window.conversation_id} #${key}`);
                    try {
                        controller_storage[key].abort();
                    } finally {
                        // Also abort the worker-side fetch if applicable
                        workerAbort(key);
                        let message = message_storage[key];
                        if (message) {
                            content_storage[key].inner.innerHTML += " [aborted]";
                            message_storage[key] += " [aborted]";
                        }
                    }
                }
            }
            await safe_load_conversation(window.conversation_id);
        });
        document.querySelector(".media-player .fa-x").addEventListener("click", ()=>{
            const media_player = document.querySelector(".media-player");
            media_player.classList.remove("show");
            const audio = document.querySelector(".media-player audio");
            media_player.removeChild(audio);
        });
        document.getElementById("close_provider_forms").addEventListener("click", async () => {
            const provider_forms = document.querySelector(".provider_forms");
            provider_forms.classList.add("hidden");
            chat.classList.remove("hidden");
        });
    });
});

const toBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
});
const toUrl = async (file)=>{
    if (file instanceof File) {
        return await toBase64(file);
    }
    return file.url ? file.url : file;
}

function getExtraBody(provider) {
    const extraBody = {};
    for (el of document.getElementById(`${sanitizeSelector(provider)}-form`)?.querySelectorAll(".saved input, .saved textarea") || []) {
        let value;
        if (el.type == "checkbox") {
            value = el.checked;
        } else {
            value = el.value;
            try {
                value = JSON.parse(value);
            } catch (e) {}
        }
        extraBody[el.name] = value;
    };
    return extraBody;
}

async function scroll_to_bottom() {
    if (document.body.classList.contains("screen-reader")) {
        return; // Skip enhancements for screen readers
    }
    window.scrollTo(0, 0);
    chatBody.scrollTop = chatBody.scrollHeight;
}

let autoScrollEnabled = true;

domReady.then(() => {
    chatBody.addEventListener('scroll', () => {
        const atBottom = chatBody.scrollTop + chatBody.clientHeight >= chatBody.scrollHeight - 40;
        autoScrollEnabled = atBottom && chatBody.clientHeight > 0;
    });
});

const clear_conversations = async () => {
    const box_conversations = document.querySelector(`#box_conversations, .top`);
    const elements = box_conversations.childNodes;
    let index = elements.length;

    if (index > 0) {
        while (index--) {
            const element = elements[index];
            if (
                element.nodeType === Node.ELEMENT_NODE &&
                element.tagName.toLowerCase() !== `button`
            ) {
                box_conversations.removeChild(element);
            }
        }
    }
};

const clear_conversation = async () => {
    let messages = chatBody.getElementsByTagName(`div`);

    while (messages.length > 0) {
        chatBody.removeChild(messages[0]);
    }
};

var illegalRe = /[\/\?<>\\:\*\|":]/g;
var controlRe = /[\x00-\x1f\x80-\x9f]/g;
var reservedRe = /^\.+$/;
var windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

function sanitize(input, replacement) {
  var sanitized = input
    .replace(illegalRe, replacement)
    .replace(controlRe, replacement)
    .replace(reservedRe, replacement)
    .replace(windowsReservedRe, replacement);
  return sanitized.replaceAll(/\/|#|\s{2,}/g, replacement).trim();
}
function sanitizeSelector(input) {
    return input.replace(/([ #;?%&,.+*~\':"!^$[\]()=>|\/@])/g, '-');
}

const show_option = async (conversation_id) => {
    const conv = document.getElementById(`conv-${conversation_id}`);
    const choi = document.getElementById(`cho-${conversation_id}`);

    conv.style.display = "none";
    choi.style.display  = "block";

    const el = document.getElementById(`convo-${conversation_id}`);
    const trash_el = el.querySelector(".fa-trash");
    const title_el = el.querySelector("span.convo-title");
    if (title_el) {
        const left_el = el.querySelector(".left");
        const input_el = document.createElement("input");
        input_el.value = title_el.innerText;
        input_el.classList.add("convo-title");
        input_el.onclick = (e) => e.stopPropagation()
        input_el.onfocus = () => trash_el.style.display = "none";
        input_el.onchange = () => set_conversation_title(conversation_id, input_el.value);
        input_el.onblur = () => set_conversation_title(conversation_id, input_el.value);
        left_el.removeChild(title_el);
        left_el.appendChild(input_el);
    }
};

const hide_option = async (conversation_id) => {
    const conv = document.getElementById(`conv-${conversation_id}`);
    const choi  = document.getElementById(`cho-${conversation_id}`);

    conv.style.display = "block";
    choi.style.display  = "none";

    const el = document.getElementById(`convo-${conversation_id}`);
    el.querySelector(".fa-trash").style.display = "";
    const input_el = el.querySelector("input.convo-title");
    if (input_el) {
        const left_el = el.querySelector(".left");
        const span_el = document.createElement("span");
        span_el.innerText = input_el.value;
        span_el.classList.add("convo-title");
        left_el.removeChild(input_el);
        left_el.appendChild(span_el);
    }
};

const on_delete_conversation = async (conversation_id) => {
    const conversation = await get_conversation(conversation_id);
    for (const message of conversation.items)  {
        if (Array.isArray(message.content)) {
            for (const item of message.content) {
                if (item.bucket_id) {
                    await framework.delete(item.bucket_id);
                }
            }
        }
    }
    if (conversation.share) {
        await framework.delete(conversation.id);
    }

    const { store, done } = await withStore('readwrite');
    store.delete(conversation.id);
    if (window.conversation_id == conversation_id) {
        await new_conversation();
    }

    await load_conversations();
    return done;
};

const on_star_conversation = async (conversation_id, target) => {
    const conversation = await get_conversation(conversation_id);
    if (conversation.star) {
        target.classList.remove("active");
    } else {
        target.classList.add("active");
    }
    await save_conversation(update_conversation({
        ...conversation,
        star: !conversation.star
    }));
    await load_conversations();
};

const on_preset_conversation = async (conversation_id) => {
    const conversation = await get_conversation(conversation_id);
    delete conversation.data;
    delete conversation.share;
    delete conversation.star;
    conversation.id = generateUUID();
    conversation.items = conversation.items.slice(0, 2);
    conversation.title = `${framework.translate("1 Copy").split(" ").pop()}: ${conversation.title || framework.translate("No Title")}`;
    await save_conversation(update_conversation(conversation));
    await set_conversation(conversation.id);
}

function merge_messages(message1, message2) {
    if (Array.isArray(message2) || !message1) {
        return message2;
    }
    let newContent = message2;
    // Remove start tokens
    if (newContent.startsWith("```")) {
        const index = newContent.indexOf("\n");
        if (index != -1) {
            newContent = newContent.substring(index);
        }
    } else if (newContent.startsWith("...")) {
        newContent = " " + newContent.substring(3);
    } else if (newContent.startsWith(message1)) {
        newContent = newContent.substring(message1.length);
    } else {
        // Remove duplicate lines
        let lines = message1.trim().split("\n");
        let lastLine = lines[lines.length - 1];
        let foundLastLine = newContent.indexOf(lastLine + "\n");
        if (foundLastLine != -1) {
            foundLastLine += 1;
        } else {
            foundLastLine = newContent.indexOf(lastLine);
        }
        if (foundLastLine != -1) {
            newContent = newContent.substring(foundLastLine + lastLine.length);
        } // Remove duplicate words
        else if (newContent.indexOf(" ") > 0) {
            let words = message1.trim().split(" ");
            let lastWord = words[words.length - 1];
            if (newContent.startsWith(lastWord)) {
                newContent = newContent.substring(lastWord.length);
            }
        }
    }
    return message1 + newContent;
}

// console.log(merge_messages("Hello", "Hello,\nhow are you?"));
// console.log(merge_messages("Hello", "Hello, how are you?"));
// console.log(merge_messages("Hello", "Hello,\nhow are you?"));
// console.log(merge_messages("Hello,\n", "Hello,\nhow are you?"));
// console.log(merge_messages("Hello,\n", "how are you?"));
// console.log(merge_messages("1 != 2", "1 != 2;"));
// console.log(merge_messages("1 != 2", "```python\n1 != 2;"));
// console.log(merge_messages("1 != 2;\n1 != 3;\n", "1 != 2;\n1 != 3;\n"));

async function safe_load_conversation(conversation_id) {
    let is_running = false
    for (const key in controller_storage) {
        if (!controller_storage[key].signal.aborted) {
            is_running = true;
            break
        }
    }
    if (!is_running) {
        await load_conversation(await get_conversation(conversation_id));
        return true;
    }
    return false;
}

function update_conversation(conversation) {
    conversation.updated = Date.now();
    return conversation;
}

async function get_messages(conversation_id) {
    const conversation = await get_conversation(conversation_id);
    return conversation?.items || [];
}

async function save_system_message() {
    if (!window.conversation_id) {
        return;
    }
    const conversation = await get_conversation(window.conversation_id);
    if (conversation) {
        conversation.system = chatPrompt?.value;
        await save_conversation(update_conversation(conversation));
    }
}

const remove_message = async (conversation_id, index) => {
    const conversation = await get_conversation(conversation_id);
    const old_message = conversation.items[index];
    let new_items = [];
    for (i in conversation.items) {
        if (i == index - 1) {
            if (!conversation.items[index]?.regenerate) {
                delete conversation.items[i]["regenerate"];
            }
        }
        if (i != index) {
            new_items.push(conversation.items[i])
        }
    }
    conversation.items = new_items;
    const data = update_conversation(conversation);
    await save_conversation(data);
    if (conversation.share) {
        const url = `${framework.backendUrl}/backend-api/v2/chat/${conversation.id}`;
        await fetch(url, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify(data),
        });
    }
    if (Array.isArray(old_message.content)) {
        for (const item of old_message.content) {
            if (item.bucket_id) {
                await framework.delete(item.bucket_id);
            }
        }
    }
};

const get_message = async (conversation_id, index) => {
    const messages = await get_messages(conversation_id);
    if (index in messages)
        return messages[index]["content"];
};

const add_message = async (
    conversation_id, role, content,
    provider = null,
    message_index = -1,
    synthesize_data = null,
    regenerate = false,
    title = null,
    finish = null,
    usage = null,
    reasoning = null,
    do_continue = false
) => {
    const conversation = await get_conversation(conversation_id);
    if (!conversation) {
        return;
    }
    if (title) {
        conversation.title = title;
    } else if (!conversation.title && !Array.isArray(content)) {
        let new_value = content.trim();
        let new_lenght = new_value.indexOf("\n");
        new_lenght = new_lenght > 200 || new_lenght < 0 ? 200 : new_lenght;
        conversation.title = new_value.substring(0, new_lenght);
    }
    const new_message = {
        role: role,
        content: content,
        provider: provider,
    };
    if (synthesize_data) {
        new_message.synthesize = synthesize_data;
    }
    if (regenerate) {
        new_message.regenerate = true;
    }
    if (finish) {
        new_message.finish = finish;
    }
    if (usage) {
        new_message.usage = usage;
    }
    if (reasoning) {
        new_message.reasoning = reasoning;
    }
    if (do_continue) {
        new_message.continue = true;
    }
    if (message_index == -1) {
         conversation.items.push(new_message);
    } else {
        const new_messages = [];
        conversation.items.forEach((item, index)=>{
            new_messages.push(item);
            if (index == message_index) {
                new_messages.push(new_message);
            }
        });
        conversation.items = new_messages;
    }
    const data = update_conversation(conversation);
    await save_conversation(data);
    if (conversation.share) {
        const url = `${framework.backendUrl}/backend-api/v2/chat/${conversation.id}`;
        fetch(url, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify(data),
        });
    }
    if (message_index == -1) {
        return conversation.items.length - 1;
    } else {
        return message_index + 1;
    }
};

const toLocaleDateString = (date) => {
    date = new Date(date);
    return date.toLocaleString('en-GB', {dateStyle: 'short', timeStyle: 'short', monthStyle: 'short'}).replace("/" + date.getFullYear(), "");
}

const load_conversations = async () => {
    let conversations = await list_conversations();
    conversations.sort((a, b) => (b.updated || b.added) - (a.updated || a.added));
    await clear_conversations();
    const box_conversations = document.querySelector(`#box_conversations, .top`);
    conversations.forEach((conversation) => {
        // const length = conversation.items.map((item) => (
        //     !item.content.toLowerCase().includes("hello") &&
        //     !item.content.toLowerCase().includes("hi") &&
        //     item.content
        // ) ? 1 : 0).reduce((a,b)=>a+b, 0);
        // if (!length) {
        //     appStorage.removeItem(`conversation:${conversation.id}`);
        //     return;
        // }
        const shareIcon = conversation.share ? '<i class="fa-solid fa-qrcode"></i>': '';
        const starIcon = conversation.star ? `<i onclick="on_preset_conversation('${conversation.id}', this); return false;" class="fa-solid fa-star" style="margin-right: 12px;"></i>`: '';
        let convo = document.createElement("div");
        convo.classList.add("convo");
        convo.id = `convo-${conversation.id}`;
        let choise;
        if (document.body.classList.contains("screen-reader")) {
            choise = `<button onclick="on_delete_conversation('${conversation.id}')" class="delete">
                    ${framework.translate('Delete Conversation')}
                </button>`;
        } else {
            choise = `
                <i onclick="show_option('${conversation.id}')" class="fa-solid fa-ellipsis-vertical" id="conv-${conversation.id}"></i>
                <div id="cho-${conversation.id}" class="choise" style="display:none;">
                    <i onclick="on_star_conversation('${conversation.id}', this)" class="fa-solid fa-star ${conversation.star ? 'active' : ''}"></i>
                    <i onclick="on_delete_conversation('${conversation.id}')" class="fa-solid fa-trash"></i>
                    <i onclick="hide_option('${conversation.id}')" class="fa-regular fa-x"></i>
                </div>
            `;
        }
        convo.innerHTML = `
            <a class="left" href="#${conversation.id}" onclick="set_conversation('${conversation.id}'); return false;">
                <i class="fa-regular fa-comments"></i>
                <span class="datetime">${conversation.updated ? toLocaleDateString(conversation.updated) : ""}</span>
                <span class="convo-title">${shareIcon} ${framework.escape(conversation.new_title ? conversation.new_title : conversation.title)}</span>
                ${starIcon}
            </a>
            ${choise}
        `;
        box_conversations.appendChild(convo);
    });
};

domReady.then(async () => {
    const hide_input = document.querySelector(".chat-toolbar .hide-input");
    hide_input.addEventListener("click", async (e) => {
        const icon = hide_input.querySelector("i");
        const func = icon.classList.contains("fa-angles-down") ? "add" : "remove";
        const remv = icon.classList.contains("fa-angles-down") ? "remove" : "add";
        icon.classList[func]("fa-angles-up");
        icon.classList[remv]("fa-angles-down");
        document.querySelector(".chat-footer .user-input").classList[func]("hidden");
        document.querySelector(".chat-footer .chat-buttons").classList[func]("hidden");
    });
});
function get_message_id() {
    const random_bytes = (Math.floor(Math.random() * 1338377565) + 2956589730).toString(
        2
    );
    const unix = Math.floor(Date.now() / 1000).toString(2);

    return BigInt(`0b${unix}${random_bytes}`).toString();
};

domReady.then(async () => {
    const sidebar_buttons = document.querySelectorAll(".mobile-sidebar-toggle");
    sidebar_buttons.forEach((el) => {
        if (el.dataset.click) {
            return;
        }
        el.dataset.click = true;
        el.addEventListener("click", async (e) => {
        e.preventDefault();
        // Animate sidebar buttons
        sidebar_buttons.forEach((el) => {
            el.classList.toggle("rotated");
        });
        // For desktop
        if (window.innerWidth >= 640) {
            // Toggle between shown and minimized only
            if (sidebar.classList.contains("shown")) {
                // Change from shown to minimized
                sidebar.classList.remove("shown");
                sidebar.classList.add("minimized");
            } else {
                // Change from minimized to shown
                sidebar.classList.remove("minimized");
                sidebar.classList.add("shown");
            }
        } 
        // For mobile
        else {
            if (sidebar.classList.contains("shown")) {
                // Hide sidebar on mobile
                sidebar.classList.remove("shown");
            } else {
                // Show sidebar on mobile
                sidebar.classList.add("shown");
            }
        }
        });
    });
});

async function show_menu() {
    sidebar.classList.add("shown");
    sidebar.classList.remove("minimized");
    await hide_settings();
    add_url_to_history("#menu");
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

async function updateLiveProviderOptions(optgroup) {
    try {
        Object.entries(await window.loadProviders()).forEach(([name, config]) => {
            if (name === "custom") {
                return; // Skip custom here, will be added separately
            }
            if (["together", "huggingface", "typegpt"].includes(name) && !appStorage.getItem(window.providerLocalStorage[name])) {
                return;
            }
            let option = document.createElement("option");
            if (config.is_hidden) {
                option.disabled = true;
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
            const publicServerIds = new Set(data.map(server => server.id));
            if (privateData.servers) {
                data = data.concat(privateData.servers.filter(server => !publicServerIds.has(server.id)));
            }
        }

        // Filter out servers that are already live in the dropdown
        const liveServerIds = Object.values(await window.loadProviders()).map(p => p.id);
        data = data.filter(server => !liveServerIds.includes(server.id));

        // Store servers globally for client creation
        window.customServers = data;
        
        data.forEach(server => {
            let isEnabled = appStorage.getItem(`enableCustomServer_${server.id}`);
            if (isEnabled === null) {
                isEnabled = !server.is_hidden && !server.is_ollama && !server.is_offline;
            } else {
                isEnabled = isEnabled === "true";
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
                if (server.default_model) {
                    option.dataset.defaultModel = server.default_model;
                }
                option.dataset.label = server.label;
                
                // Build label with model count if available
                let label = server.label || server.id;
                if (server.allowed_models && server.allowed_models.length > 0) {
                    label += ` (${server.allowed_models.length} models)`;
                }
                option.text = `${label} 🌐`;
                option.disabled = !isEnabled;

                customOptgroup.appendChild(option);
            }
            // Add to providers toggle list if container provided
            if (providersContainer) {
                const toggleContent = providersContainer.querySelector(".collapsible-content");
                if (toggleContent && !toggleContent.querySelector(`#ProviderCustom${server.id}`)) {
                    const providerItem = document.createElement("div");
                    providerItem.classList.add("provider-item", "custom-server-item");
                    let isEnabled = appStorage.getItem(`enableCustomServer_${server.id}`);
                    if (isEnabled === null) {
                        isEnabled = !server.is_hidden && !server.is_ollama && !server.is_offline;
                    } else {
                        isEnabled = isEnabled === "true";
                    }
                    const statusIcon = server.is_hidden ? "⚫" : server.is_offline ? "🔴" : server.is_ollama ? "🦙" : "🌐";
                    providerItem.innerHTML = `
                        <span class="label">${framework.translate("Enable")} ${server.label || server.id} ${statusIcon}</span>
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

function load_provider_login_urls(providersListContainer, providers = []) {
    for (const provider of providers) {
        if (provider.parent || provider.name == "AnyProvider") {
            continue;
        }
        let childs = providers.filter((p) => p.parent == provider.name).map((p) => p.name);
        let providerBox = document.createElement("div");
        providerBox.classList.add("field", "box");
        if (!provider.active_by_default || appStorage.getItem(`Provider${provider.name}`) === "false") {
            providerBox.classList.add("hidden");
        }
        let isChecked = false;
        async function checkStatus() {
            setTimeout(async () => {
                if (isChecked) {
                    return;
                }
                isChecked = true;
                const label = providerBox.querySelector('label');
                if (!label) {
                    return;
                }
                label.textContent = label.textContent.replaceAll(" ✅", "") + " 🔄";
                const quota = await get_quota(provider.name);
                label.textContent = label.textContent.replaceAll(" 🔄", "").replaceAll(" ✅", "")
                if (quota) {
                    label.textContent += " ✅";
                }
            }, Math.random() * 100);
        }
        providerBox.addEventListener('mouseenter', checkStatus);
        const label = provider.label || provider.name;
        childs = childs.map((child) => `${child}-api_key`).join(" ");
        const login_provider = provider.name.replace("AI", "").replace("Api", "").toLowerCase();
        let oauthButton = "";
        
        // Add OAuth button for providers that support it (server-side endpoint)
        if (provider.login) {
            oauthButton = `<button class="oauth-btn" data-provider="${provider.name}" data-login-url="/backend-api/v2/oauth/${provider.name}" title="${framework.translate("Login to")} ${framework.escape(label)}">${framework.translate('Login')}</button>`;
        }

        const apiKeyLink = ["Pollinations", "HuggingFace", "Airforce"].includes(provider.name)
            ? `<a href="/members.html?provider=${login_provider}&redirect=${encodeURIComponent(window.location.href.split("#")[0])}" title="${framework.translate("Login to")} ${framework.escape(label)}">${framework.translate('Login')}</a>`
            : (provider.login_url ? `<a href="${framework.escape(provider.login_url)}" target="_blank" title="${framework.translate("Login to")} ${framework.escape(label)}">${framework.translate('Get API key')}</a>` : "");
        const inputId = `${provider.name}-api_key`;
        const storageKey = provider.name == "Puter" ? "puter.auth.token" : inputId;
        providerBox.innerHTML = `
            <label for="${inputId}" class="label" title="">${framework.escape(label)}:</label>
        ` + (oauthButton || (apiKeyLink ? `
            <input type="text" id="${inputId}" name="${provider.name}[api_key]" class="${childs}" placeholder="api_key" autocomplete="off" data-storage-key="${storageKey}"/>
        ` + apiKeyLink : ""));

        if (provider.name == "Puter") {
            const link = providerBox.querySelector("a");
            link.textContent = framework.translate("Login");
            link.addEventListener("click", async (event) => {
                event.preventDefault();
                await (new window.Puter()).signIn().then((res) => {
                    console.log('Puter signed in:', res);
                    providerBox.querySelector("input").value = res.token;
                    appStorage.setItem(storageKey, res.token);
                });
            });
        }

        providerBox.addEventListener("click", () => {
            isChecked = false;
            setTimeout(checkStatus, 100);
        });
        
        // Add OAuth button event listener
        if (oauthButton) {
            providerBox.querySelector(".oauth-btn").addEventListener("click", async (event) => {
                const provider = event.target.dataset.provider;
                event.target.disabled = true;
                event.target.textContent = "Authenticating...";
                try {
                    const loginUrl = event.target.dataset.loginUrl || `/backend-api/v2/oauth/${provider}`;
                    const response = await fetch(loginUrl, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ action: "start" })
                    });
                    const result = await response.json();

                    if (result.status === "pending" && result.user_code && result.verification_uri) {
                        showOAuthCodePrompt(result.user_code, result.verification_uri);
                        showToast("GitHub Copilot authorization started. Click Open GitHub and enter the code.", "info", 10000);

                        // Poll for completion
                        let pollResult;
                        const maxPollAttempts = 45;
                        let pollAttempts = 0;
                        while (pollAttempts < maxPollAttempts) {
                            pollAttempts += 1;
                            await new Promise(resolve => setTimeout(resolve, result.interval ? result.interval * 1000 : 5000));
                            const pollResponse = await fetch(loginUrl, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action: "poll", device_code: result.device_code })
                            });
                            pollResult = await pollResponse.json();

                            if (pollResult.status === "success") {
                                showToast("OAuth authentication successful!", "success");
                                await load_providers(providers, {}, providersListContainer, null);
                                break;
                            }
                            if (pollResult.status !== "pending") {
                                showToast(`OAuth failed: ${pollResult.error?.message || pollResult.message || "Unknown error"}`, "error");
                                break;
                            }
                        }

                        if (pollAttempts >= maxPollAttempts) {
                            showToast("OAuth poll timed out. Please retry.", "error");
                        }

                    } else if (result.status === "success") {
                        showToast("OAuth authentication successful!", "success");
                        await load_providers(providers, {}, providersListContainer, null);
                    } else {
                        showToast(`OAuth failed: ${result.error?.message || result.message || "Unknown error"}`, "error");
                    }
                } catch (error) {
                    showToast(`OAuth error: ${error.message}`, "error");
                } finally {
                    event.target.disabled = false;
                    event.target.textContent = framework.translate('Login');
                }
            });
        }
        providersListContainer.querySelector(".collapsible-content").appendChild(providerBox);
    }
}
async function load_version() {
    let new_version = document.querySelector(".new_version");
    if (new_version) return;
    api("version").then((versions)=>{
        window.title = 'G4F - ' + versions["version"];
        if (document.title == "G4F Chat") {
            document.title = window.title;
        }
        let text = ""
        if (versions["latest_version"] && versions["version"] != versions["latest_version"]) {
            let release_url = 'https://github.com/xtekky/gpt4free/releases/latest';
            let title = `${framework.translate('New version:')} ${versions["latest_version"]}`;
            text = `<a href="${release_url}" target="_blank" title="${title}">${versions["version"]}</a> 🆕`;
            new_version = document.createElement("div");
            new_version.classList.add("new_version");
            const link = `<a href="${release_url}" target="_blank" title="${title}">v${versions["latest_version"]}</a>`;
            new_version.innerHTML = `G4F ${link}&nbsp;&nbsp;🆕`;
            new_version.addEventListener("click", ()=>new_version.parentElement.removeChild(new_version));
            document.body.appendChild(new_version);
        } else {
            text = versions["version"];
        }
        document.getElementById("version_text").innerHTML = text;
    }).catch((e)=>{
        console.error("Error loading version:", e);
        fetch("https://api.github.com/repos/xtekky/gpt4free/releases/latest").then((response)=>response.json()).then((data)=>{
            document.getElementById("version_text").innerText = data.tag_name;
        });
    });
    setTimeout(load_version, 1000 * 60 * 60); // 1 hour
}

addonsLoaded.then(() => {
    load_version();
});

async function upload_image(file) {
    if (file instanceof File) {
        try {
            const url = "https://media.pollinations.ai/upload";
            const formData = new FormData();
            formData.append('file', file);
            const response = await fetch(url, {
                method: 'POST',
                body: formData,
                headers: {"Authorization": "Bearer pk_7X0QLj0xijSd0xj7"}
            });
            if (!response.ok) {
                throw new Error(`Error uploading image: ${await response.text()}`);
            }
            return await response.json();
        } catch (error) {
            if (window.location.protocol == "https:") {
                const formData = new FormData();
                formData.append('files', file);
                const response = await fetch(framework.backendUrl + "/backend-api/v2/files/" + bucket_id, {
                    method: 'POST',
                    body: formData
                });
                if (!response.ok) {
                    throw error;
                }
                const result = await response.json()
                if (result.media) {
                    result.media.forEach((part)=> {
                        part = part.name ? part : {name: part};
                        let url = framework.backendUrl ? framework.backendUrl : window.location.origin;
                        url = `${url}/files/${bucket_id}/media/${part.name}`;
                        object_url = url.replaceAll("/media/", "/thumbnail/");
                        return { bucket_id: bucket_id, url: url, ...part };
                    });
                }
            }
            throw error;
        }
    }
}

function renderMediaSelect() {
    const mediaSelect = document.querySelector(".media-select");
    const oldImages = mediaSelect.querySelectorAll("a:has(img)");
    oldImages.forEach((el)=>el.remove());
    Object.entries(image_storage).forEach(async ([object_url, file]) => {
        const bucket_id = generateUUID();
        const link = document.createElement("a");
        link.title = file.name;
        const img = document.createElement("img");
        img.src = object_url;
        img.onclick = async () => {
            link.remove();
            delete image_storage[object_url];
            await framework.delete(item.bucket_id);
        }
        img.onload = () => {
            link.title += `\n${img.naturalWidth}x${img.naturalHeight}`;
        };
        img.onerror = () => {
            img.remove();
            delete image_storage[object_url];
        }
        link.appendChild(img);
        mediaSelect.appendChild(link);
        upload_image(file).then((result) => {
            delete image_storage[object_url];
            image_storage[result.url] = result;
        }).catch((error) => {
            add_error("Error uploading image:", error);
        });
    });
}

domReady.then(() => {
    const imageInput        = document.querySelector(".image-label");
    imageInput ? imageInput.onclick = () => mediaSelect.classList.toggle("hidden") : null;
    const mediaSelect = document.querySelector(".media-select");
    mediaSelect.querySelector(".close").onclick = () => {
        if (Object.values(image_storage).length) {
            Object.entries(image_storage).forEach(async ([object_url, file]) => {
                if (file instanceof File) {
                    URL.revokeObjectURL(object_url)
                } else if (file.bucket_id) {
                    await framework.delete(file.bucket_id);
                }
            });
            image_storage = {};
            renderMediaSelect();
        } else {
            mediaSelect.classList.add("hidden");
        }
    }

    const imageSelect = document.getElementById("image");
    const cameraInput = document.getElementById("camera");

    [imageSelect, cameraInput].filter(el=>el).forEach((el) => {
        el.addEventListener('change', async () => {
            if (el.files.length) {
                Array.from(el.files).forEach((file) => {
                    image_storage[URL.createObjectURL(file)] = file;
                });
                el.value = "";
                renderMediaSelect();
            }
        });
    });
});

async function upload_audio(blob) {
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'file-upload-loading';
    loadingIndicator.innerHTML = `
        <div class="upload-spinner"></div>
        <p>${framework.translate("Uploading audio...")}</p>
    `;
    document.body.appendChild(loadingIndicator);
    try {
        const formData = new FormData();
        formData.append('files', blob);
        const bucket_id = generateUUID();
        const response = await fetch(framework.backendUrl + "/backend-api/v2/files/" + bucket_id, {
            method: 'POST',
            body: formData,
            headers: {
                "x-recognition-language": await get_recognition_language()
            }
        });
        if (!response.ok) {
            inputCount.innerText = framework.translate("Error uploading audio");
            return;
        }
        const result = await response.json()
        if (result.media) {
            const media = [];
            result.media.forEach((part)=> {
                part = part.name ? part : {name: part};
                const url = `${framework.backendUrl}/files/${bucket_id}/media/${part.name}`;
                media.push({bucket_id: bucket_id, url: url, ...part});
            });
            await handle_ask(false, media);
        }
    } finally {
        document.body.removeChild(loadingIndicator);
    }
}

const audioButton = document.querySelector(".capture-audio");
audioButton.addEventListener('click', async (event) => {
    const i = audioButton.querySelector("i");
    const t = audioButton.querySelector("*");
    if (mediaRecorder) {
        i.classList.remove("fa-stop");
        i.classList.add("fa-microphone");
        mediaRecorder.stop();
        t.innerText = framework.translate("Upload Audio");
        if(mediaRecorder.stream) {
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        if (mediaRecorder.wavBlob) {
            if (modelSelect.selectedIndex >= 0 && modelSelect.options[modelSelect.selectedIndex].dataset.audio) {
                await add_conversation(window.conversation_id);
                await ask_gpt(get_message_id(), -1, false, providerSelect.value, get_selected_model(), "next");
            } else {
                await upload_audio(mediaRecorder.wavBlob);
            }
            t.innerText = framework.translate("Record Audio");
        }
        mediaRecorder = null;
        return;
    }

    i.classList.remove("fa-microphone");
    i.classList.add("fa-stop");
    t.innerText = framework.translate("Stop Recording");

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: true
        });

        //if (modelSelect.selectedIndex && modelSelect.options[modelSelect.selectedIndex].dataset.audio) {
            mediaRecorder = new Recorder(stream);
            mediaRecorder.start();
            return;
        //}

        if (!MediaRecorder.isTypeSupported('audio/webm')) {
            console.warn('audio/webm is not supported');
        }
        mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm',
        });
        
        mediaRecorder.addEventListener('dataavailable', async event => {
            await upload_audio(event.data);
            t.innerText = framework.translate("Record Audio");
        });

        mediaRecorder.start()
    } catch (err) {
        console.error('Error accessing microphone:', err);
        i.classList.remove("fa-stop");
        i.classList.add("fa-microphone");
        t.innerText = framework.translate("Record Audio");
        if(mediaRecorder?.stream) {
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        mediaRecorder = null;
    }
});

const linkButton = document.querySelector(".add-link");
linkButton.addEventListener('click', async (event) => {
    const i = audioButton.querySelector("i");
    const link = prompt("Please enter a link");
    if (!link) {
        return;
    }
    if (link.startsWith("http") === false) {
        inputCount.innerText = framework.translate("Invalid link");
        return;
    }
    image_storage[link] = link;
    renderMediaSelect();
});

const fileInput = document.getElementById("file");
fileInput.addEventListener('click', async (event) => {
    fileInput.value = '';
});

const cameraInput = document.getElementById("camera");
cameraInput.addEventListener("click", (e) => {
    if (window?.pywebview) {
        e.preventDefault();
        pywebview.api.take_picture();
    }
});
const imageSelect = document.getElementById("image");
imageSelect.addEventListener("click", (e) => {
    if (window?.pywebview) {
        e.preventDefault();
        pywebview.api.choose_image();
    }
});

async function upload_cookies() {
    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file);
    response = await fetch(framework.backendUrl + "/backend-api/v2/upload_cookies", {
        method: 'POST',
        body: formData,
    });
    if (response.status == 200) {
        inputCount.innerText = framework.translate("{0} File(s) uploaded successfully").replace('{0}', file.name);
    }
    fileInput.value = "";
}

function formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;
    while (bytes >= 1024 && unitIndex < units.length - 1) {
        bytes /= 1024;
        unitIndex++;
    }
    return `${bytes.toFixed(2)} ${units[unitIndex]}`;
}

function connectToSSE(url, do_refine, bucket_id) {
    const eventSource = new EventSource(url);
    eventSource.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        if (data.error) {
            inputCount.innerText = `${framework.translate('Error:')} ${data.error.message}`;
            paperclip.classList.remove("blink");
            fileInput.value = "";
        } else if (data.action == "load") {
            inputCount.innerText = `${framework.translate('Read data:')} ${formatFileSize(data.size)}`;
        } else if (data.action == "refine") {
            inputCount.innerText = `${framework.translate('Refine data:')} ${formatFileSize(data.size)}`;
        } else if (data.action == "download") {
            inputCount.innerText = `${framework.translate('Download:')} ${data.count} files`;
        } else if (data.action == "done") {
            if (do_refine) {
                connectToSSE(`${framework.backendUrl}/backend-api/v2/files/${encodeURIComponent(bucket_id)}?refine_chunks_with_spacy=true`, false, bucket_id);
                return;
            }
            fileInput.value = "";
            paperclip.classList.remove("blink");
            if (!data.size) {
                inputCount.innerText = framework.translate("No content found");
                return
            }
            appStorage.setItem(`bucket:${bucket_id}`, data.size);
            inputCount.innerText = framework.translate("Files are loaded successfully");

            const url = `${framework.backendUrl}/backend-api/v2/files/${encodeURIComponent(bucket_id)}`;
            const media = [{bucket_id: bucket_id, url: url}];
            await handle_ask(false, media);
        }
    };
    eventSource.onerror = (event) => {
        eventSource.close();
        paperclip.classList.remove("blink");
    }
}

async function upload_files(fileInput) {
    try {
        const bucket_id = generateUUID();
        paperclip.classList.add("blink");

        // Handle image files
        const imageFiles = Array.from(fileInput.files).filter(file => 
            file.type.startsWith('image/')
        );
        
        if (imageFiles.length > 0) {
            const urls = await Promise.all(imageFiles.map(async file => upload_image(file)));
            const media = urls.map((part)=> {
                return {type: "image_url", image_url: {url: part.url}}
            });
            await handle_ask(false, media);
            return;
        }

        const formData = new FormData();
        Array.from(fileInput.files).forEach(file => {
            formData.append('files', file);
        });
        const response = await fetch(framework.backendUrl + "/backend-api/v2/files/" + bucket_id, {
            method: 'POST',
            body: formData
        });
        const result = await response.json()
        const count = result.files.length + result.media.length;
        inputCount.innerText = framework.translate('{0} File(s) uploaded successfully').replace('{0}', count);
        if (result.files.length > 0) {
            let do_refine = document.getElementById("refine")?.checked;
            connectToSSE(`${framework.backendUrl}/backend-api/v2/files/${bucket_id}/stream`, do_refine, bucket_id);
        } else {
            paperclip.classList.remove("blink");
            fileInput.value = "";
        }
        if (result.media) {
            const media = [];
            result.media.forEach((part)=> {
                part = part.name ? part : {name: part};
                const url = `${framework.backendUrl}/files/${bucket_id}/media/${part.name}`;
                media.push({bucket_id: bucket_id, url: url, ...part});
            });
            await handle_ask(false, media);
        }
    } catch(e) {
        add_error(e, true);
    }
}

domReady.then(() => {
    const fileInput = document.getElementById("file");
    fileInput.addEventListener('change', async (event) => {
        if (fileInput.files.length) {
            type = fileInput.files[0].name.split('.').pop()
            if (type == "har") {
                return await upload_cookies();
            } else if (type != "json") {
                await upload_files(fileInput);
            }
            fileInput.dataset.type = type
            if (type == "json") {
                const reader = new FileReader();
                reader.addEventListener('load', async (event) => {
                    const data = JSON.parse(event.target.result);
                    if (data.options && "g4f" in data.options) {
                        let count = 0;
                        Object.keys(data).forEach(async key => {
                            if (key == "options") {
                                Object.keys(data[key]).forEach(keyOption => {
                                    appStorage.setItem(keyOption, data[key][keyOption]);
                                    count += 1;
                                });
                            } else if (!appStorage.getItem(key)) {
                                if (key.startsWith("conversation:")) {
                                    await save_conversation(data[key]);
                                    count += 1;
                                } else {
                                    appStorage.setItem(key, data[key]);
                                }
                            }
                        });
                        await load_conversations();
                        await load_settings_storage();
                        fileInput.value = "";
                        inputCount.innerText = framework.translate('{0} Conversations/Settings were imported successfully').replace('{0}', count);
                    } else {
                        is_cookie_file = data.api_key;
                        if (Array.isArray(data)) {
                            data.forEach((item) => {
                                if (item.domain && item.name && item.value) {
                                    is_cookie_file = true;
                                }
                            });
                        }
                        if (is_cookie_file) {
                            await upload_cookies();
                        } else {
                            await upload_files(fileInput);
                        }
                    }
                });
                reader.readAsText(fileInput.files[0]);
            }
        }
    });
    
    if (!window.matchMedia("(pointer:coarse)").matches) {
        document.getElementById("image").setAttribute("multiple", "multiple");
    }

    chatPrompt?.addEventListener("input", async () => {
        await save_system_message();
    });
});

// Create overlay element for sidebar
function isLive() {
    if (!providerSelect) {
        return true;
    }
    return providerSelect.options[providerSelect.selectedIndex]?.dataset?.live;
}

async function initClient() {
    if (!isLive()) {
        window.client = null;
        return;
    }
    const selectedProviderOption = providerSelect.options[providerSelect.selectedIndex];
    const serverId = selectedProviderOption?.dataset?.serverId;
    const defaultModel = selectedProviderOption?.dataset?.defaultModel;
    let messageId = null;
    let count = 0;
    function logCallback(event) {
        if (event.request) {
            messageId = generateUUID();
            count = 0;
        }
        if (event.response || event.request) {
            logRequestResponse(event, messageId, count);
            count += 1;
        }
    }
    const provider = providerSelect?.value;
    const apiKey = get_api_key_by_provider(provider);
    const options = apiKey ? { apiKey } : {};
    if (serverId && options.backupUrl) {
        options.backupUrl = `https://g4f.space/custom/${serverId}`;
    }
    if (defaultModel) {
        options.defaultModel = defaultModel;
    }
    if (appStorage.getItem("debugMode") == "true") {
        options.logCallback = logCallback;
    }
    // Route client fetch() calls through the Web Worker so streaming
    // continues even when the tab is backgrounded / the user switches apps.
    // Falls back to regular fetch() if the worker is unavailable.
    options.fetchFn = window.fetchFn;
    try {
        // Handle custom providers with custom:server_id format
        window.client = await window.createClient(provider, options);
    } catch (error) {
        console.error('Failed to create client:', error);
        return;
    }
    await loadClientModels();
    return true;
}

async function loadClientModels() {
    modelSelect.innerHTML = `<option value="" disabled selected>${framework.translate("Loading...")}</option>`;
    try {
        const [models, quota] = await Promise.all([window.client.models.list(), window.client.getQuota().catch(() => undefined)]);
        setQuotaInfo(models, quota);
        modelSelect.innerHTML = '';
        models.forEach(model => {
            if (window.isValidModel && !isValidModel(model)) {
                return;
            }
            const opt = document.createElement('option');
            opt.value = model.id;
            opt.text = model.label;
            if (model.type) {
                opt.dataset.type = model.type;
            }
            if (model.audio) {
                opt.dataset.audio = model.audio;
            }
            if (model.remaining_percent !== undefined) {
                opt.dataset.remaining = model.remaining_percent;
            }
            if (model.default) {
                opt.selected = true;
            }
            if (model.disabled) {
                opt.disabled = true;
            }
            modelSelect.appendChild(opt);
        });
        if (models.length > 2) {
            setFavoriteModels(providerSelect?.value, window.client.defaultModel || models[0].id);
        }
    } catch (err) {
        console.error('Model load failed:', err);
        modelSelect.innerHTML = "";
    }
}

/**
 * Insert or wrap text with Markdown triple back‑ticks (```).
 *
 * @param {HTMLTextAreaElement|HTMLInputElement} el   – The <textarea> (or <input type="text">).
 */
function insertBackticksInTextarea(el) {
  // Modern browsers expose selectionStart / selectionEnd.
  const start = el.selectionStart;
  const end   = el.selectionEnd;
  const value = el.value;

  // ---------- CASE 1: a range is selected → wrap it ----------
  if (start !== end) {
    const selected = value.slice(start, end);
    const before   = value.slice(0, start);
    const after    = value.slice(end);

    // Wrap the selected text: ```selected```
    const newText = `${before}\`\`\`\n${selected}\n\`\`\`${after}`;

    // Replace and bring focus back to the textarea
    el.value = newText;
    // Keep the wrapped text selected (optional)
    el.setSelectionRange(start, start + newText.length - after.length);
    el.focus();
    return;
  }

  // ---------- CASE 2: nothing selected → insert empty block ----------
  // Insert a block like:
  // ```
  // |
  // ```
  // where | is the new caret position.
  const fence = "```\n\n```";
  const before = value.slice(0, start);
  const after  = value.slice(start);

  const newValue = before + fence + after;
  el.value = newValue;

  // Put caret between the two newline characters (i.e. inside the empty block)
  const caretPos = start + 4; // after the opening ```\n
  el.setSelectionRange(caretPos, caretPos);
  el.focus();
}

// ============================================================
// MCP (Model Context Protocol) Integration
// ============================================================

const mcpClient = new MCPClient();
try {
    initializeMCPUI();
} catch(e) {
    add_error(e)
}

function initializeMCPUI() {
    // Default to the local MCP server (full file access incl. list_dir).
    // If the user only has the old remote default saved, replace it.
    // if (mcpClient.servers.length === 0) {
    //     mcpClient.addServer({ name: 'Local', url: 'http://localhost:8765/mcp' });
    // } else {
    //     const hasLocal = mcpClient.servers.some(s =>
    //         s.url && (s.url.includes('localhost:8765') || s.url.includes('127.0.0.1:8765')));
    //     const onlyRemote = mcpClient.servers.every(s =>
    //         s.url && s.url.includes('mcp.g4f.space'));
    //     if (onlyRemote && !hasLocal) {
    //         mcpClient.addServer({ name: 'Local', url: 'http://localhost:8765/mcp' });
    //     }
    // }
    if (mcpClient.servers.length === 0) {
         mcpClient.addServer({ name: 'Demo', url: 'https://mcp.g4f.space/mcp' });
    }

    // Render servers list
    renderMCPServers();
    
    // Render tools list
    renderMCPTools();

    // Initial refresh of tools
    refreshMCPTools();
    
    // Add server button
    document.getElementById('add-mcp-server-btn')?.addEventListener('click', showAddServerDialog);
    
    // Refresh tools button
    document.getElementById('refresh-mcp-tools-btn')?.addEventListener('click', refreshMCPTools);

    // PA providers
    document.getElementById('refresh-pa-providers-btn')?.addEventListener('click', loadPaProviders);
    loadPaProviders();
}

function renderMCPServers() {
    const container = document.getElementById('mcp-servers-list');
    if (!container || !mcpClient) return;
    
    const servers = mcpClient.servers;
    
    if (servers.length === 0) {
        container.innerHTML = '<div class="mcp-empty">No MCP servers configured. Click + to add one.</div>';
        return;
    }
    
    container.innerHTML = servers.map(server => `
        <div class="mcp-server-item" data-server-id="${server.id}">
            <div class="mcp-server-info">
                <input type="checkbox" 
                       id="mcp-server-${server.id}" 
                       ${server.enabled ? 'checked' : ''}
                       onchange="toggleMCPServer('${server.id}')">
                <label for="mcp-server-${server.id}" class="mcp-server-name">${escapeHtml(server.name)}</label>
                <span class="mcp-server-url">${escapeHtml(server.url)}</span>
            </div>
            <button type="button" 
                    class="mcp-remove-btn" 
                    onclick="removeMCPServer('${server.id}')"
                    aria-label="Remove server">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `).join('');
}

function renderMCPTools() {
    const container = document.getElementById('mcp-tools-list');
    if (!container || !mcpClient) return;
    
    const tools = mcpClient.getAllTools();
    
    if (tools.length === 0) {
        container.innerHTML = '<div class="mcp-empty">No tools available. Add an MCP server and refresh.</div>';
        return;
    }
    
    // Group tools by server
    const toolsByServer = {};
    tools.forEach(tool => {
        if (!toolsByServer[tool.serverName]) {
            toolsByServer[tool.serverName] = [];
        }
        toolsByServer[tool.serverName].push(tool);
    });
    
    container.innerHTML = Object.entries(toolsByServer).map(([serverName, serverTools]) => `
        <div class="mcp-server-tools">
            <div class="mcp-server-group-title">${escapeHtml(serverName)}</div>
            ${serverTools.map(tool => `
                <div class="mcp-tool-item">
                    <input type="checkbox" 
                           id="mcp-tool-${tool.toolId}" 
                           ${mcpClient.isToolSelected(tool.toolId) ? 'checked' : ''}
                           onchange="toggleMCPTool('${tool.toolId}')">
                    <label for="mcp-tool-${tool.toolId}">
                        <span class="mcp-tool-name">${escapeHtml(tool.name)}</span>
                        ${tool.description ? `<span class="mcp-tool-desc">${escapeHtml(tool.description)}</span>` : ''}
                    </label>
                </div>
            `).join('')}
        </div>
    `).join('');
}

function showAddServerDialog() {
    const name = prompt('Enter MCP server name:');
    if (!name) return;
    
    const url = prompt('Enter MCP server URL (e.g., http://localhost:3000):');
    if (!url) return;
    
    try {
        mcpClient.addServer({ name, url });
        renderMCPServers();
        refreshMCPTools();
    } catch (error) {
        alert('Error adding server: ' + error.message);
    }
}

function removeMCPServer(serverId) {
    if (!confirm('Remove this MCP server?')) return;
    
    mcpClient.removeServer(serverId);
    renderMCPServers();
    renderMCPTools();
}

function toggleMCPServer(serverId) {
    mcpClient.toggleServer(serverId);
    renderMCPServers();
    renderMCPTools();
}

function toggleMCPTool(toolId) {
    mcpClient.toggleToolSelection(toolId);
}

async function refreshMCPTools() {
    const button = document.getElementById('refresh-mcp-tools-btn');
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fa-solid fa-sync fa-spin"></i>';
    }
    
    try {
        await mcpClient.fetchAllTools();
        renderMCPTools();
    } catch (error) {
        alert('Error refreshing tools: ' + error.message);
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = '<i class="fa-solid fa-sync"></i>';
        }
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================
// PA Providers listing
// ============================================================

/**
 * Derive the base URL for PA endpoints.
 * Uses the first enabled MCP server URL (strips /mcp suffix) or falls back
 * to window.location.origin.
 */
function getPaBaseUrl() {
    if (typeof mcpClient !== 'undefined' && mcpClient.servers.length > 0) {
        const first = mcpClient.servers.find(s => s.enabled) || mcpClient.servers[0];
        // MCP server URLs end with /mcp — strip that to get the base
        return first.url.replace(/\/mcp$/, '');
    }
    return window.location.origin;
}

async function fetchPaProviders() {
    const res = await fetch(`${framework.backendUrl}/pa/providers`, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
}

async function loadPaProviderSelect(optgroup) {
    optgroup = optgroup || document.getElementById('pa-providers-optgroup');
    if (!optgroup) return;
    try {
        window._paProviders = window._paProviders || await fetchPaProviders();
        // Remove stale options
        optgroup.innerHTML = '';
        window._paProviders.forEach(p => {
            const opt = document.createElement('option');
            opt.value = `pa:${p.id}`;
            opt.dataset.pa = 'true';
            opt.dataset.paId = p.id;
            opt.dataset.label = p.label || p.id;
            const modelHint = Array.isArray(p.models) && p.models.length > 0 ? ` (${p.models.length} model${p.models.length > 1 ? 's' : ''})` : '';
            opt.text = `${p.label || p.id}${modelHint} 🔌`;
            optgroup.appendChild(opt);
        });
    } catch (e) {
        console.debug('Failed to load PA providers into select:', e);
    }
}

async function loadPaProviders() {
    const btn = document.getElementById('refresh-pa-providers-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-sync fa-spin"></i>';
    }
    try {
        const providers = await fetchPaProviders();
        window._paProviders = providers;
        renderPaProviders(providers);
        // Also refresh the select dropdown
        await loadPaProviderSelect();
    } catch (err) {
        const container = document.getElementById('pa-providers-list');
        if (container) container.innerHTML = `<div class="mcp-empty">Failed to load PA providers: ${escapeHtml(String(err))}</div>`;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-sync"></i>';
        }
    }
}

function renderPaProviders(providers) {
    const container = document.getElementById('pa-providers-list');
    if (!container) return;
    if (!providers || providers.length === 0) {
        container.innerHTML = '<div class="mcp-empty">No PA providers found. Add <code>.pa.py</code> files to <code>~/.g4f/workspace</code> and refresh.</div>';
        return;
    }
    container.innerHTML = providers.map(p => {
        const models = Array.isArray(p.models) ? p.models.join(', ') : '';
        const url = p.url ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer" class="mcp-server-url">${escapeHtml(p.url)}</a>` : '';
        return `<div class="mcp-tool-item">
            <div>
                <span class="mcp-tool-name">${escapeHtml(p.label || p.id)}</span>
                ${url}
                ${models ? `<span class="mcp-tool-desc">${escapeHtml(models)}</span>` : ''}
            </div>
        </div>`;
    }).join('');
}

document.getElementById('refresh-pa-providers-btn')?.addEventListener('click', loadPaProviders);

/**
 * Handle tool calls from assistant
 */
async function handleToolCalls(toolCalls, messages, model, provider, message_id, finish_message=()=>{}) {
    try {
        console.debug('Handling tool calls:', toolCalls);
        // Display tool calls in the chat
        for (const toolCall of toolCalls) {
            const toolName = toolCall.function.name;
            const toolArgs = toolCall.function.arguments;

            const toolMessage = `\n🔧 **Tool Call:** \`${toolName}\`\n\`\`\`json\n${typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs, null, 2)}\n\`\`\``;
            await add_message_chunk({type: "reasoning", token: toolMessage}, message_id);
        }
        
        // Execute tool calls
        const toolResults = await mcpClient.executeToolCalls(toolCalls);
        
        // Display tool results
        for (const result of toolResults) {
            const resultMessage = `\n✅ **Tool Result:** \`${result.name}\`\n\`\`\`json\n${result.content}\n\`\`\`\n`;
            await add_message_chunk({type: "reasoning", token: resultMessage}, message_id);
        }
        
        // Add tool results to messages and continue conversation
        const updatedMessages = [...messages, {
            role: 'assistant',
            content: '',
            tool_calls: toolCalls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments
                }
            }))
        }, ...toolResults];

        
        // Make another API call with tool results
        controller_storage[message_id] = new AbortController();
        if (window.client) {
            const stream = await window.client.chat.completions.create({
                model: model,
                messages: updatedMessages,
                stream: true,
                signal: controller_storage[message_id].signal
            });
            
            for await (const chunk of stream) {
                if (chunk.error) {
                    add_message_chunk({type: "error", ...chunk.error}, message_id);
                    return;
                }
                if (chunk.choices) {
                    const choice = chunk.choices[0];
                    if (choice?.delta?.reasoning || choice?.delta?.reasoning_content) {
                        await add_message_chunk({type: "reasoning", token: choice.delta.reasoning || choice.delta.reasoning_content}, message_id);
                    }
                    if (choice?.delta?.content) {
                        const delta = choice?.delta?.content || '';
                        if (delta) {
                            await add_message_chunk({type: "content", content: delta}, message_id);
                        }
                    }
                }
            }
        } else {
            const apiKey = get_api_key_by_provider(provider);
            const downloadMedia = document.getElementById("download_media")?.checked;
            let apiBase;
            if (provider == "Custom") {
                apiBase = appStorage.getItem("Custom-api_base");
            }
            const ignored = Array.from(settings.querySelectorAll("input.provider:not(:checked)")).map((el)=>el.value);
            await api("conversation", {
                id: message_id,
                conversation_id: window.conversation_id,
                model: model,
                provider: provider,
                messages: updatedMessages,
                action: "next",
                download_media: downloadMedia,
                debug_mode: appStorage.getItem("debugMode") == "true",
                api_key: apiKey,
                api_base: apiBase,
                ignored: ignored
            }, [], message_id, finish_message);
        }
    } catch (error) {
        console.error('Error handling tool calls:', error);
        const errorMessage = `\n❌ **Tool Execution Error:** ${error.message}`;
        await add_message_chunk({type: "reasoning", token: errorMessage}, message_id);
    }
}

// Cloud Sync Functions
const CLOUD_SYNC_API = "https://auth.g4f.space/members/api";

async function checkCloudSyncSession() {
    const token = appStorage.getItem("g4f_session");
    if (!token) {
        showCloudSyncLogin();
        return;
    }
    try {
        const url = token.startsWith("g4f_") ? `${CLOUD_SYNC_API}/keys/validate` : `${CLOUD_SYNC_API}/session`;
        const response = await fetch(url, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (response.ok) {
            const data = await response.json();
            if (data.expires) {
                appStorage.setItem("g4f_expires", data.expires);
            }
            if (data.authenticated || data.username) {
                showCloudSyncLoggedIn(data.user || {name: data.username, tier: data.tier});
                return;
            } else {
                appStorage.removeItem("g4f_session");
                appStorage.removeItem("g4f_user");
                appStorage.removeItem("g4f_expires");
                showCloudSyncLogin();
                return;
            }
        } else {
            appStorage.removeItem("g4f_session");
            appStorage.removeItem("g4f_user");
            appStorage.removeItem("g4f_expires");
            showCloudSyncLogin();
            return;
        }
    } catch (e) {
        console.error("Cloud sync session check failed:", e);
        // Keep the token but show login section on error (network issue)
        showCloudSyncLogin();
    }
}

function showCloudSyncLogin() {
    const loginSection = document.getElementById("cloudSyncLogin");
    const syncSection = document.getElementById("cloudSyncSection");
    if (loginSection) loginSection.style.display = "block";
    if (syncSection) syncSection.style.display = "none";
    
    // Update sidebar login/logout buttons
    const sidebarLoginBtn = document.getElementById("sidebar-login-btn");
    const sidebarLogoutBtn = document.getElementById("sidebar-logout-btn");
    const tierText = document.getElementById("user-tier-text");
    const tierLimitsRow = document.getElementById("tier-limits-row");
    if (sidebarLoginBtn) sidebarLoginBtn.classList.remove("hidden");
    if (sidebarLogoutBtn) sidebarLogoutBtn.classList.add("hidden");
    if (tierText) tierText.textContent = "Guest";
    if (tierLimitsRow) tierLimitsRow.classList.add("hidden");
}

function showCloudSyncLoggedIn(user) {
    const loginSection = document.getElementById("cloudSyncLogin");
    const syncSection = document.getElementById("cloudSyncSection");
    const userEl = document.getElementById("cloudSyncUser");
    if (loginSection) loginSection.style.display = "none";
    if (syncSection) syncSection.style.display = "block";
    if (userEl) userEl.textContent = user.name || user.email || "User";
    
    // Update sidebar login/logout buttons
    const sidebarLoginBtn = document.getElementById("sidebar-login-btn");
    const sidebarLogoutBtn = document.getElementById("sidebar-logout-btn");
    const tierText = document.getElementById("user-tier-text");
    const tierLimitsRow = document.getElementById("tier-limits-row");
    const infoBar = document.getElementById("user-tier-info");
    if (sidebarLoginBtn) sidebarLoginBtn.classList.add("hidden");
    if (sidebarLogoutBtn) sidebarLogoutBtn.classList.remove("hidden");
    if (tierText) tierText.textContent = user.name || user.email || "User";
    if (tierLimitsRow) tierLimitsRow.classList.remove("hidden");
    if (infoBar && user.tier) {
        infoBar.setAttribute("data-tier", user.tier);
    }
}

function isTokenExpired(expires) {
    if (!expires) return false;
    const expiresMs = expires > 1e12 ? expires : expires * 1000;
    return Date.now() > expiresMs;
}

function handleCloudSyncCallback() {
    // Check hash fragment for provider-specific API keys or session tokens
    const hashStr = window.location.hash ? decodeURIComponent(window.location.hash.substring(1)) : "";
    const hashParams = new URLSearchParams(hashStr);
    const token = hashParams.get("session");
    const userParam = hashParams.get("user");
    const expires = hashParams.get("expires");
    const openSettings = hashParams.has("settings");

    // Handle central G4F OAuth code callback (?code=&state=)
    if (window.G4FOAuth && new URLSearchParams(window.location.search).get("code")) {
        window.G4FOAuth.handleCallback(window.location.origin + window.location.pathname).then((result) => {
            if (!result) return;
            appStorage.setItem("g4f_session", result.token);
            if (result.expires) appStorage.setItem("g4f_expires", String(result.expires));
            if (result.user) appStorage.setItem("g4f_user", JSON.stringify(result.user));
            const stateData = result.stateData || {};
            if (stateData.conversation) {
                window.location.hash = `#${stateData.conversation}`;
            }
            showCloudSyncLoggedIn(result.user);
            if (openSettings) open_settings();
        }).catch((e) => {
            console.error("OAuth callback failed:", e);
        });
        return;
    }

    // Handle provider API keys from URL hash (set by members page after OAuth)
    if (token) {
        const location_url = window.location.href.split("#")[0] + (hashParams.get("conversation") ? `#${hashParams.get("conversation")}` : "");
        window.history.replaceState({}, document.title, location_url);

        if (!isTokenExpired(expires)) {
            appStorage.setItem("g4f_expires", expires);
        } else if (expires) {
            console.warn("Received expired token, not saving.");
            return;
        }
        appStorage.setItem("g4f_session", token);

        // Parse and use user info if provided
        if (userParam) {
            try {
                const user = JSON.parse(decodeURIComponent(userParam));
                appStorage.setItem("g4f_user", JSON.stringify(user));
                // Also store provider-specific API key if included in user info
                if (user.pollinations?.api_key) {
                    if (!isTokenExpired(user.pollinations.expires)) {
                        appStorage.setItem("Pollinations-api_key", user.pollinations.api_key);
                        if (user.pollinations.expires) {
                            appStorage.setItem("Pollinations-expires", user.pollinations.expires);
                        } else {
                            appStorage.removeItem("Pollinations-expires");
                        }
                    }
                }
                if (user.huggingface?.access_token) {
                    if (!isTokenExpired(user.huggingface.expires)) {
                        appStorage.setItem("HuggingFace-api_key", user.huggingface.access_token);
                        if (user.huggingface.expires) {
                            appStorage.setItem("HuggingFace-expires", user.huggingface.expires);
                        } else {
                            appStorage.removeItem("HuggingFace-expires");
                        }
                    }
                }
                if (user.airforce?.access_token) {
                    if (!isTokenExpired(user.airforce.expires)) {
                        appStorage.setItem("Airforce-api_key", user.airforce.access_token);
                        if (user.airforce.expires) {
                            appStorage.setItem("Airforce-expires", user.airforce.expires);
                        } else {
                            appStorage.removeItem("Airforce-expires");
                        }
                    }
                }
                showCloudSyncLoggedIn(user);
            } catch (e) {
                console.error("Failed to parse user data:", e);
            }
        }
        
        // Open settings to cloud sync tab if requested
        if (openSettings) {
            setTimeout(() => {
                open_settings();
                const cloudSyncTab = document.querySelector(`.settings-tab[data-tab="${hashParams.get("tab")}"]`);
                if (cloudSyncTab) cloudSyncTab.click();
            }, 100);
        }
        
        checkCloudSyncSession();
    }
}

async function cloudSyncLogout() {
    const token = appStorage.getItem("g4f_session");
    if (token) {
        try {
            await fetch(`${CLOUD_SYNC_API}/logout`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}` }
            });
        } catch (e) {
            console.error("Logout failed:", e);
        }
    }
    appStorage.removeItem("g4f_session");
    appStorage.removeItem("g4f_user");
    appStorage.removeItem("g4f_expires");
    showCloudSyncLogin();
}

// Helper function to show/hide cloud sync loading indicator
function showCloudSyncLoading(message) {
    let loadingEl = document.getElementById("cloudSyncLoading");
    if (!loadingEl) {
        loadingEl = document.createElement("div");
        loadingEl.id = "cloudSyncLoading";
        loadingEl.className = "file-upload-loading";
        document.body.appendChild(loadingEl);
    }
    loadingEl.innerHTML = `
        <div class="upload-spinner"></div>
        <p>${framework.translate(message)}</p>
    `;
    loadingEl.style.display = "flex";
}

function hideCloudSyncLoading() {
    const loadingEl = document.getElementById("cloudSyncLoading");
    if (loadingEl) {
        loadingEl.style.display = "none";
    }
}

async function syncConversationsToCloud() {
    const token = appStorage.getItem("g4f_session");
    if (!token) {
        cloudSyncLoginRedirect();
        return;
    }
    showCloudSyncLoading("Uploading conversations...");
    try {
        const conversations = await list_conversations();
        if (!conversations || conversations.length === 0) {
            hideCloudSyncLoading();
            alert("No conversations to sync.");
            return;
        }
        const response = await fetch(`${CLOUD_SYNC_API}/conversations/sync`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ conversations })
        });
        hideCloudSyncLoading();
        if (response.ok) {
            const data = await response.json();
            console.log("Conversations synced to cloud:", data);
            alert(`${conversations.length} conversations uploaded to cloud successfully!`);
        } else {
            const error = await response.json();
            throw new Error(error.error || "Sync failed");
        }
    } catch (e) {
        hideCloudSyncLoading();
        console.error("Cloud sync upload failed:", e);
        alert("Failed to upload conversations to cloud: " + e.message);
    }
}

async function syncConversationsFromCloud() {
    const token = appStorage.getItem("g4f_session");
    if (!token) {
        cloudSyncLoginRedirect();
        return;
    }
    showCloudSyncLoading("Downloading conversations...");
    try {
        const response = await fetch(`${CLOUD_SYNC_API}/conversations`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (response.ok) {
            const data = await response.json();
            if (data.conversations && data.conversations.length > 0) {
                for (const conv of data.conversations) {
                    // Remove cloud-specific fields before saving locally
                    delete conv.synced_at;
                    delete conv.user_id;
                    await save_conversation(conv);
                }
                await load_conversations();
                hideCloudSyncLoading();
                console.log("Conversations synced from cloud");
                alert(`Downloaded ${data.conversations.length} conversations from cloud!`);
            } else {
                hideCloudSyncLoading();
                alert("No conversations found in cloud.");
            }
        } else {
            const error = await response.json();
            throw new Error(error.error || "Sync failed");
        }
    } catch (e) {
        hideCloudSyncLoading();
        console.error("Cloud sync download failed:", e);
        alert("Failed to download conversations from cloud: " + e.message);
    }
}

// Initialize cloud sync on page load
handleCloudSyncCallback();
checkCloudSyncSession();

// Redirect to members login page (central G4F OAuth when available)
function cloudSyncLoginRedirect(provider = null) {
    if (window.G4FOAuth) {
        // Central OAuth flow: returns to this page with ?code=, handled by
        // handleCloudSyncCallback. Round-trip the provider choice + current
        // conversation through the state parameter.
        const redirectUri = window.location.origin + window.location.pathname;
        window.G4FOAuth.authorize(redirectUri, {
            conversation: window.conversation_id || null,
            provider: provider,
        });
        return;
    }
    const returnUrl = encodeURIComponent(window.location.href.split("#")[0]);
    const conversation = window.conversation_id ? `&conversation=${encodeURIComponent(window.conversation_id)}` : "";
    const providerParam = provider ? `&provider=${encodeURIComponent(provider)}` : "";
    window.location.href = `/members.html?redirect=${returnUrl}${conversation}${providerParam}`;
}

// Cloud Sync button event listeners
const cloudSyncLoginBtn = document.getElementById("cloudSyncLoginBtn");
const cloudSyncUploadBtn = document.getElementById("cloudSyncUpload");
const cloudSyncDownloadBtn = document.getElementById("cloudSyncDownload");
const cloudSyncLogoutBtn = document.getElementById("cloudSyncLogoutBtn");

if (cloudSyncLoginBtn) cloudSyncLoginBtn.addEventListener("click", () => cloudSyncLoginRedirect());
if (cloudSyncUploadBtn) cloudSyncUploadBtn.addEventListener("click", syncConversationsToCloud);
if (cloudSyncDownloadBtn) cloudSyncDownloadBtn.addEventListener("click", syncConversationsFromCloud);
if (cloudSyncLogoutBtn) cloudSyncLogoutBtn.addEventListener("click", cloudSyncLogout);

// Expose functions to global scope
window.toggleMCPServer = toggleMCPServer;
window.removeMCPServer = removeMCPServer;
window.toggleMCPTool = toggleMCPTool;
window.renderMCPServers = renderMCPServers;
window.renderMCPTools = renderMCPTools;
window.refreshMCPTools = refreshMCPTools;
window.showAddServerDialog = showAddServerDialog;
window.cloudSyncLoginRedirect = cloudSyncLoginRedirect;
window.syncConversationsToCloud = syncConversationsToCloud;
window.syncConversationsFromCloud = syncConversationsFromCloud;
window.cloudSyncLogout = cloudSyncLogout;

// Settings Search Logic
const settingsSearch = document.getElementById('settingsSearch');
if (settingsSearch) {
    settingsSearch.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        
        document.querySelectorAll('.settings-tab-content .field').forEach(field => {
            const text = field.textContent.toLowerCase();
            if (text.includes(query)) {
                field.style.display = '';
            } else {
                field.style.display = 'none';
            }
        });
        
        if (query.trim() !== '') {
            document.querySelectorAll('.settings-tab-content').forEach(tab => tab.classList.add('active'));
            document.querySelectorAll('.settings-tab').forEach(btn => btn.classList.remove('active'));
        } else {
            // Restore default view (just first tab active)
            document.querySelectorAll('.settings-tab-content').forEach(tab => tab.classList.remove('active'));
            document.getElementById('tab-general').classList.add('active');
            const generalTab = document.querySelector('.settings-tab[data-tab="general"]');
            if (generalTab) generalTab.classList.add('active');
        }
    });
}

// Sidebar Conversation Search Logic
const conversationSearch = document.getElementById('conversationSearch');
if (conversationSearch) {
    conversationSearch.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        document.querySelectorAll('.conversations .convo').forEach(convo => {
            const titleEl = convo.querySelector('.convo-title');
            if (titleEl) {
                const text = titleEl.textContent.toLowerCase();
                if (text.includes(query)) {
                    convo.style.display = '';
                } else {
                    convo.style.display = 'none';
                }
            }
        });
    });
}

export default {
    insertBackticksInTextarea,
    handleToolCalls,
    checkCloudSyncSession,
    cloudSyncLoginRedirect,
    syncConversationsToCloud,
    syncConversationsFromCloud,
    cloudSyncLogout,
    new_conversation,
    appStorage,
    load_conversations,
    mcpClient,
    getPaBaseUrl,
    load_version,
    renderMCPServers,
    renderMCPTools,
    loadPaProviders,
    loadPaProviderSelect,
    renderPaProviders,
    loadCustomProvidersFromAPI,
    loadClientModels,
    initClient,
    updateLiveProviderOptions
}