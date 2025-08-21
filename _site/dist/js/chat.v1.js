const chatBody          = document.getElementById(`chatBody`);
const userInput         = document.getElementById("userInput");
const codeButton        = document.querySelector(".code");
const box_conversations = document.querySelector(`.top`);
const stop_generating   = document.querySelector(`.stop_generating`);
const regenerate_button = document.querySelector(`.regenerate`);
const sidebar           = document.querySelector(".sidebar");
const sidebar_buttons   = document.querySelectorAll(".mobile-sidebar-toggle");
const sendButton        = document.getElementById("sendButton");
const addButton         = document.getElementById("addButton");
const imageInput        = document.querySelector(".image-label");
const mediaSelect       = document.querySelector(".media-select");
const imageSelect       = document.getElementById("image");
const cameraInput       = document.getElementById("camera");
const audioButton       = document.querySelector(".capture-audio");
const linkButton        = document.querySelector(".add-link");
const fileInput         = document.getElementById("file");
const microLabel        = document.querySelector(".micro-label");
const inputCount        = document.getElementById("input-count").querySelector(".text");
const providerSelect    = document.getElementById("provider");
const modelSelect       = document.getElementById("model");
const modelProvider     = document.getElementById("model2");
const modelSearch       = document.getElementById("model-search");
const modelSelector     = document.querySelector(".model-selector");
const modelSuggestions  = document.getElementById('model-suggestions');
const chatPrompt        = document.getElementById("chatPrompt");
const settings          = document.querySelector(".settings");
const chat              = document.querySelector(".chat-container");
const album             = document.querySelector(".images");
const log_storage       = document.querySelector(".log");
const switchInput       = document.getElementById("switch");
const searchButton      = document.getElementById("search");
const paperclip         = document.querySelector(".user-input .fa-paperclip");
const hide_systemPrompt = document.getElementById("hide-systemPrompt")
const slide_systemPrompt_icon = document.querySelector(".slide-header i");

const optionElementsSelector = ".settings input, .settings textarea, .chat-body input, #model, #model2, #provider";

const translationSnipptes = [
    "with", "**An error occured:**", "Private Conversation", "New Conversation", "Regenerate", "Continue",
    "Hello! How can I assist you today?", "words", "chars", "tokens", "{0} total tokens",
    "{0} Messages were imported", "{0} File(s) uploaded successfully",
    "{0} Conversations/Settings were imported successfully",
    "No content found", "Files are loaded successfully",
    "Importing conversations...", "New version:", "Providers API key", "Providers (Enable/Disable)",
    "Get API key", "Uploading files...", "Invalid link", "Loading...", "Live Providers"
];

let login_urls_storage = {
    "Azure": ["Azure", "", []],
    "HuggingFace": ["HuggingFace", "https://huggingface.co/settings/tokens", ["HuggingFaceMedia"]],
    "HuggingSpace": ["HuggingSpace", "", []],
    "PollinationsAI": ["Pollinations AI", "https://auth.pollinations.ai", ["Live"]],
    "Puter": ["Puter.js", "", []],
};

const modelTags = {
    image: "🎨",
    vision: "👓",
    audio: "🎧",
    video: "🎥"
}

document.addEventListener("DOMContentLoaded", (event) => {
    translationSnipptes.forEach((text) => framework.translate(text));
});

let provider_storage = {};
let message_storage = {};
let content_alt_storage = {};
let content_data_storage = {};
let controller_storage = {};
let content_storage = {};
let error_storage = {};
let synthesize_storage = {};
let title_storage = {};
let parameters_storage = {};
let finish_storage = {};
let usage_storage = {};
let continue_storage = {};
let reasoning_storage = {};
let title_ids_storage = {};
let image_storage = {};
let wakeLock = null;
let countTokensEnabled = true;
let suggestions = null;
let lastUpdated = null;
let mediaRecorder = null;
let stopRecognition = ()=>{};
let providerModelSignal = null;
let searchModels = {};
let client = null;

// Hotfix for mobile
document.querySelector(".container").style.maxHeight = window.innerHeight + "px"

appStorage = window.localStorage || {
    setItem: (key, value) => self[key] = value,
    getItem: (key) => self[key],
    removeItem: (key) => delete self[key],
    length: 0
}

function render_reasoning(reasoning, final = false) {
    const inner_text = reasoning.text ? `<div class="reasoning_text${final ? " final hidden" : ""}">
        ${framework.markdown(reasoning.text)}
    </div>` : "";
    return `<div class="reasoning_body">
        <div class="reasoning_title">
           <strong>${reasoning.label ? reasoning.label :'Reasoning <i class="brain">🧠</i>'}: </strong>
           ${typeof reasoning.status === 'string' || reasoning.status instanceof String ? framework.escape(reasoning.status) : '<i class="fas fa-spinner fa-spin"></i>'}
        </div>
        ${inner_text}
    </div>`;
}

function render_reasoning_text(reasoning) {
    return `${reasoning.label ? reasoning.label :'Reasoning 🧠'}: ${reasoning.status}\n\n${reasoning.text}\n\n`;
}

function filter_message(text) {
    if (Array.isArray(text) || !text) {
        return text;
    }
    // Remove images from text
    return filter_message_content(text.replaceAll(
        /!\[.*?\]\(.*?\)/gm, ""
    ))
}

function filter_message_content(text) {
    if (Array.isArray(text) || !text) {
        return text;
    }
    return text.replace(/ \[aborted\]$/g, "").replace(/ \[error\]$/g, "")
}

function fallback_clipboard (text) {
    var textBox = document.createElement("textarea");
    textBox.value = text;
    textBox.style.top = "0";
    textBox.style.left = "0";
    textBox.style.position = "fixed";
    document.body.appendChild(textBox);
    textBox.focus();
    textBox.select();
    try {
        var success = document.execCommand('copy');
        var msg = success ? 'succeeded' : 'failed';
        console.log('Clipboard Fallback: Copying text command ' + msg);
    } catch (e) {
        console.error('Clipboard Fallback: Unable to copy', e);
    }
    document.body.removeChild(textBox);
}

const iframe_container = document.querySelector(".hljs-iframe-container");
const iframe = document.querySelector(".hljs-iframe");
const iframe_close = Object.assign(document.createElement("button"), {
    className: "hljs-iframe-close",
    innerHTML: '<i class="fa-regular fa-x"></i>',
});
iframe_close.onclick = () => {
    iframe_container.classList.add("hidden");
    iframe.src = "";
}
iframe_container.appendChild(iframe_close);

class HtmlRenderPlugin {
    constructor(options = {}) {
        self.hook = options.hook;
        self.callback = options.callback
    }
    "after:highlightElement"({
        el,
        text
    }) {
        if (!el.classList.contains("language-html")) {
            return;
        }
        let button = Object.assign(document.createElement("button"), {
            innerHTML: '<i class="fa-regular fa-folder-open"></i>',
            className: "hljs-iframe-button",
        });
        el.parentElement.appendChild(button);
        button.onclick = async () => {
            let newText = text;
            if (hook && typeof hook === "function") {
                newText = hook(text, el) || text
            }
            iframe.src = `data:text/html;charset=utf-8,${encodeURIComponent(newText)}`;
            iframe_container.classList.remove("hidden");
            if (typeof callback === "function") return callback(newText, el);
        }
    }
}
let typesetPromise = Promise.resolve();
const highlight = (container) => {
    if (window.hljs) {
        container.querySelectorAll('code:not(.hljs').forEach((el) => {
            if (el.className != "hljs") {
                hljs.highlightElement(el);
            }
        });
    }
    if (window.MathJax && window.MathJax.typesetPromise) {
        typesetPromise = typesetPromise.then(
            () => MathJax.typesetPromise([container])
        ).catch(
            (err) => console.log('Typeset failed: ' + err.message)
        );
    }
}

const get_message_el = (el) => {
    let message_el = el;
    while(!(message_el.classList.contains('message')) && message_el.parentElement) {
        message_el = message_el.parentElement;
    }
    if (message_el.classList.contains('message')) {
        return message_el;
    }
}

function generateUUID() {
    if (crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function register_message_images() {
    chatBody.querySelectorAll(".message .fa-clipboard").forEach(async (el) => {
        if (el.dataset.click) {
            return
        }
        el.dataset.click = true;
        el.addEventListener("click", async () => {
            let message_el = get_message_el(el);
            let response = await fetch(message_el.dataset.object_url);
            let copyText = await response.text();
            
            try {        
                if (!navigator.clipboard) {
                    throw new Error("navigator.clipboard: Clipboard API unavailable.");
                }
                await navigator.clipboard.writeText(copyText);
                showNotification("Text copied to clipboard");
            } catch (e) {
                console.error(e);
                console.error("Clipboard API writeText() failed! Fallback to document.exec(\"copy\")...");
                try {
                    fallback_clipboard(copyText);
                    showNotification("Text copied to clipboard");
                } catch (fallbackError) {
                    console.error("Fallback clipboard also failed:", fallbackError);
                    showNotification("Failed to copy text", "error");
                }
            }
            el.classList.add("clicked");
            setTimeout(() => el.classList.remove("clicked"), 1000);
        });
    });
}

function showNotification(message, type = 'success') {
    // Check if notification container exists, create if not
    let container = document.getElementById('notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-container';
        container.style.position = 'fixed';
        container.style.bottom = '20px';
        container.style.right = '20px';
        container.style.zIndex = '9999';
        document.body.appendChild(container);
    }
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.padding = '10px 20px';
    notification.style.marginTop = '10px';
    notification.style.borderRadius = '4px';
    notification.style.backgroundColor = type === 'success' ? '#4CAF50' : '#F44336';
    notification.style.color = 'white';
    notification.style.opacity = '0';
    notification.style.transform = 'translateY(20px)';
    notification.style.transition = 'opacity 0.3s, transform 0.3s';
    
    container.appendChild(notification);
    
    // Show notification with animation
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateY(0)';
        
        // Hide and remove after delay
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(20px)';
            
            setTimeout(() => {
                container.removeChild(notification);
                if (container.children.length === 0) {
                    document.body.removeChild(container);
                }
            }, 300);
        }, 2000);
    }, 10);
}

const register_message_buttons = async () => {
    chatBody.querySelectorAll(".message .content .provider").forEach(async (el) => {
        if (el.dataset.click) {
            return
        }
        el.dataset.click = true;
        const provider_link = el.querySelector("a");
        provider_link?.addEventListener("click", async (event) => {
            event.preventDefault();
            await load_provider_parameters(el.dataset.provider);
            const provider_forms = document.querySelector(".provider_forms");
            const provider_form = provider_forms.querySelector(`#${el.dataset.provider}-form`);
            if (provider_form) {
                provider_form.classList.remove("hidden");
                provider_forms.classList.remove("hidden");
                chat.classList.add("hidden");
            }
            return false;
        });
    });

    chatBody.querySelectorAll(".message .fa-xmark").forEach(async (el) => {
        if (el.dataset.click) {
            return
        }
        el.dataset.click = true;
        el.addEventListener("click", async () => {
            const message_el = get_message_el(el);
            if (message_el) {
                if ("index" in message_el.dataset) {
                    await remove_message(window.conversation_id, message_el.dataset.index);
                    chatBody.removeChild(message_el);
                }
            }
            await safe_load_conversation(window.conversation_id, false);
        });
    });

    chatBody.querySelectorAll(".message .fa-clipboard").forEach(async (el) => {
        if (el.dataset.click) {
            return
        }
        el.dataset.click = true;
        el.addEventListener("click", async () => {
            let message_el = get_message_el(el);
            let response = await fetch(message_el.dataset.object_url);
            let copyText = await response.text();
            try {        
                if (!navigator.clipboard) {
                    throw new Error("navigator.clipboard: Clipboard API unavailable.");
                }
                await navigator.clipboard.writeText(copyText);
            } catch (e) {
                console.error(e);
                console.error("Clipboard API writeText() failed! Fallback to document.exec(\"copy\")...");
                fallback_clipboard(copyText);
            }
            el.classList.add("clicked");
            setTimeout(() => el.classList.remove("clicked"), 1000);
        });
    })

    chatBody.querySelectorAll(".message .fa-file-export").forEach(async (el) => {
        if (el.dataset.click) {
            return
        }
        el.dataset.click = true;
        el.addEventListener("click", async () => {
            const elem = window.document.createElement('a');
            let filename = `chat ${new Date().toLocaleString()}.txt`.replaceAll(":", "-");
            const conversation = await get_conversation(window.conversation_id);
            let buffer = "";
            conversation.items.forEach(message => {
                if (message.reasoning) {
                    buffer += render_reasoning_text(message.reasoning);
                }
                buffer += `${message.role == 'user' ? 'User' : 'Assistant'}: ${message.content.trim()}\n\n`;
            });
            var download = document.getElementById("download");
            download.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(buffer.trim()));
            download.setAttribute("download", filename);
            download.click();
            el.classList.add("clicked");
            setTimeout(() => el.classList.remove("clicked"), 1000);
        });
    })

    chatBody.querySelectorAll(".message .fa-volume-high").forEach(async (el) => {
        if (el.dataset.click) {
            return
        }
        el.dataset.click = true;
        el.addEventListener("click", async () => {
            const message_el = get_message_el(el);
            let audio;
            if (message_el.dataset.synthesize_url) {
                el.classList.add("active");
                setTimeout(()=>el.classList.remove("active"), 2000);
                const media_player = document.querySelector(".media-player");
                if (!media_player.classList.contains("show")) {
                    media_player.classList.add("show");
                    audio = new Audio(message_el.dataset.synthesize_url);
                    audio.controls = true;   
                    media_player.appendChild(audio);
                } else {
                    audio = media_player.querySelector("audio");
                    audio.src = message_el.dataset.synthesize_url;
                }
                audio.play();
                return;
            }
        });
    });

    chatBody.querySelectorAll(".message .regenerate_button").forEach(async (el) => {
        if (el.dataset.click) {
            return
        }
        el.dataset.click = true;
        el.addEventListener("click", async () => {
            const message_el = get_message_el(el);
            el.classList.add("clicked");
            setTimeout(() => el.classList.remove("clicked"), 1000);
            await ask_gpt(get_message_id(), message_el.dataset.index);
        });
    });

    chatBody.querySelectorAll(".message .continue_button").forEach(async (el) => {
        if (el.dataset.click) {
            return
        }
        el.dataset.click = true;
        el.addEventListener("click", async () => {
            if (!el.disabled) {
                el.disabled = true;
                const message_el = get_message_el(el);
                el.classList.add("clicked");
                setTimeout(() => {el.classList.remove("clicked"); el.disabled = false}, 1000);
                await ask_gpt(get_message_id(), message_el.dataset.index, false, null, null, "continue");
            }
        });
    });

    chatBody.querySelectorAll(".message .fa-whatsapp").forEach(async (el) => {
        if (el.dataset.click) {
            return
        }
        el.dataset.click = true;
        el.addEventListener("click", async () => {
            const text = get_message_el(el).innerText;
            window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
            });
    });

    chatBody.querySelectorAll(".message .fa-print").forEach(async (el) => {
        if (el.dataset.click) {
            return
        }
        el.dataset.click = true;
        el.addEventListener("click", async () => {
            const message_el = get_message_el(el);
            el.classList.add("clicked");
            chatBody.scrollTop = 0;
            message_el.classList.add("print");
            setTimeout(() => {
                el.classList.remove("clicked");
                message_el.classList.remove("print");
            }, 1000);
            window.print()
        });
    });

    chatBody.querySelectorAll(".message .fa-qrcode").forEach(async (el) => {
        if (el.dataset.click) {
            return
        }
        el.dataset.click = true;
        el.addEventListener("click", async () => {
            iframe.src = '/qrcode.html' + (window.conversation_id ? `#${window.conversation_id}` : '');
            iframe_container.classList.remove("hidden");
        });
    });

    chatBody.querySelectorAll(".message .reasoning_title").forEach(async (el) => {
        if (el.dataset.click) {
            return
        }
        el.dataset.click = true;
        el.addEventListener("click", async () => {
            let text_el = el.parentElement.querySelector(".reasoning_text");
            if (text_el) {
                text_el.classList.toggle("hidden");
            }
        });
    });
}

const delete_conversations = async () => {
    // Delete all conversations
    const { store, done } = await withStore('readwrite');
    store.clear();
    
    // const remove_keys = [];
    // for (let i = 0; i < appStorage.length; i++){
    //     let key = appStorage.key(i);
    //     if (key.startsWith("conversation:")) {
    //         remove_keys.push(key);
    //     }
    // }
    // remove_keys.forEach((key)=>appStorage.removeItem(key));

    hide_sidebar();
    await new_conversation();
    return done;
};

const handle_ask = async (do_ask_gpt = true, message = null) => {
    await scroll_to_bottom();

    if (!message) {
        message = userInput.value.trim();
        if (!message) {
            return;
        }
        userInput.value = "";
        await count_input()
    }

    // Is message a url?
    const expression = /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/gi;
    const regex = new RegExp(expression);
    if (!Array.isArray(message) && message.match(regex)) {
        paperclip.classList.add("blink");
        const blob = new Blob([JSON.stringify([{url: message}])], { type: 'application/json' });
        const file = new File([blob], 'downloads.json', { type: 'application/json' }); // Create File object
        let formData = new FormData();
        formData.append('files', file); // Append as a file
        const bucket_id = generateUUID();
        await fetch(`${framework.backendUrl}/backend-api/v2/files/${bucket_id}`, {
            method: 'POST',
            body: formData
        });
        connectToSSE(`${framework.backendUrl}/backend-api/v2/files/${bucket_id}`, false, bucket_id); //Retrieve and refine
        return;
    }
    if (!message.length) {
        return;
    }

    await add_conversation(window.conversation_id);
    let message_index = await add_message(window.conversation_id, "user", message);
    let message_id = get_message_id();

    const message_el = document.createElement("div");
    message_el.classList.add("message");
    message_el.dataset.index = message_index;
    message_el.innerHTML = `
        <div class="user">
            ${user_image}
            <i class="fa-solid fa-xmark"></i>
            <i class="fa-regular fa-phone-arrow-up-right"></i>
        </div>
        <div class="content"> 
            <div class="content_inner">
            ${framework.markdown(message)}
            </div>
            <div class="count">
                ${countTokensEnabled ? count_words_and_tokens(message, get_selected_model()) : ""}
            </div>
        </div>
    `;
    chatBody.appendChild(message_el);
    highlight(message_el);
    if (do_ask_gpt) {
        const all_pinned = document.querySelectorAll("#pin_container button.pinned")
        if (all_pinned.length > 0) {
            all_pinned.forEach((el, idx) => ask_gpt(
                idx == 0 ? message_id : get_message_id(),
                -1,
                idx != 0,
                el.dataset.provider,
                el.dataset.model
            ));
        } else {
            await ask_gpt(message_id, -1, false, null, null, "next", message);
        }
    } else {
        await safe_load_conversation(window.conversation_id, true);
        await load_conversations();
    }
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

regenerate_button.addEventListener("click", async () => {
    regenerate_button.classList.add("regenerate-hidden");
    setTimeout(()=>regenerate_button.classList.remove("regenerate-hidden"), 3000);
    const all_pinned = document.querySelectorAll("#pin_container button.pinned")
    if (all_pinned.length > 0) {
        all_pinned.forEach((el) => ask_gpt(get_message_id(), -1, true, el.dataset.provider, el.dataset.model, "variant"));
    } else {
        await ask_gpt(get_message_id(), -1, true, null, null, "variant");
    }
});

stop_generating.addEventListener("click", async () => {
    regenerate_button.classList.remove("regenerate-hidden");
    stop_generating.classList.add("stop_generating-hidden");
    let key;
    for (key in controller_storage) {
        if (!controller_storage[key].signal.aborted) {
            console.log(`aborted ${window.conversation_id} #${key}`);
            try {
                controller_storage[key].abort();
            } finally {
                let message = message_storage[key];
                if (message) {
                    content_storage[key].inner.innerHTML += " [aborted]";
                    message_storage[key] += " [aborted]";
                }
            }
        }
    }
    await safe_load_conversation(window.conversation_id, false);
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

const prepare_messages = (messages, message_index = -1, do_continue = false, do_filter = true) => {
    messages = [ ...messages ]
    if (message_index != null) {
        console.debug("Messages Index:", message_index);

        // Removes messages after selected
        if (message_index >= 0) {
            messages = messages.filter((_, index) => message_index >= index);
        }
        // Removes none user messages at end
        if (!do_continue) {
            let last_message;
            while (last_message = messages.pop()) {
                if (last_message["role"] == "user") {
                    messages.push(last_message);
                    break;
                }
            }
            console.debug("Messages filtered:", messages);
        }
    }
    // Combine assistant messages
    // let last_message;
    // let new_messages = [];
    // messages.forEach((message) => {
    //     message_copy = { ...message };
    //     if (last_message) {
    //         if (last_message["role"] == message["role"] &&  message["role"] == "assistant") {
    //             message_copy["content"] = last_message["content"] + message_copy["content"];
    //             new_messages.pop();
    //         }
    //     }
    //     last_message = message_copy;
    //     new_messages.push(last_message);
    // });
    // messages = new_messages;
    // console.log(2, messages);

    // Insert system prompt as first message
    let final_messages = [];
    if (chatPrompt?.value) {
        final_messages.push({
            "role": "system",
            "content": chatPrompt.value
        });
    }

    // Remove history, only add new user messages
    // The message_index is null on count total tokens
    if (!do_continue && document.getElementById('history')?.checked && do_filter && message_index != null) {
        let filtered_messages = [];
        while (last_message = messages.pop()) {
            if (last_message["role"] == "user") {
                filtered_messages.push(last_message);
            } else {
                break;
            }
        }
        messages = filtered_messages.reverse();
        if (last_message) {
            console.debug("History removed:", messages)
        }
    }

    messages.forEach((new_message, i) => {
        // Copy message first
        new_message = { ...new_message };
        // Include last message, if do_continue
        if (i + 1 == messages.length && do_continue) {
            delete new_message.regenerate;
        }
        // Include only not regenerated messages
        if (new_message) {
            // Remove generated images from content
            if (new_message.content) {
                new_message.content = filter_message(new_message.content);
            }
            // Remove internal fields
            new_message = {role: new_message.role, content: new_message.content};
            // Append message to new messages
            if (do_filter && !new_message.regenerate) {
                final_messages.push(new_message)
            } else if (!do_filter) {
                final_messages.push(new_message)
            }
        }
    });
    console.debug("Final messages:", final_messages)

    return final_messages;
}

async function load_provider_parameters(provider) {
    let form_id = `${provider}-form`;
    if (!parameters_storage[provider]) {
        parameters_storage[provider] = JSON.parse(appStorage.getItem(form_id));
    }
    if (parameters_storage[provider]) {
        let provider_forms = document.querySelector(".provider_forms");
        let form_el = document.createElement("form");
        form_el.id = form_id;
        form_el.classList.add("hidden");
        appStorage.setItem(form_el.id, JSON.stringify(parameters_storage[provider]));
        let old_form = document.getElementById(form_id);
        if (old_form) {
            old_form.remove();
        }
        Object.entries(parameters_storage[provider]).forEach(([key, value]) => {
            let el_id = `${provider}-${key}`;
            let saved_value = appStorage.getItem(el_id);
            let input_el;
            let field_el;
            if (typeof value == "boolean") {
                field_el = document.createElement("div");
                field_el.classList.add("field");
                if (saved_value) {
                    field_el.classList.add("saved");
                    saved_value = saved_value == "true";
                } else {
                    saved_value = value;
                }
                field_el.innerHTML = `<span class="label">${key}:</span>
                <input type="checkbox" id="${el_id}" name="${key}">
                <label for="${el_id}" class="toogle" title=""></label>
                <i class="fa-solid fa-xmark"></i>`;
                form_el.appendChild(field_el);
                input_el = field_el.querySelector("input");
                input_el.checked = saved_value;
                input_el.dataset.checked = value ? "true" : "false";
                input_el.onchange = () => {
                    field_el.classList.add("saved");
                    appStorage.setItem(el_id, input_el.checked ? "true" : "false");
                }
            } else if (typeof value == "string" || typeof value == "object"|| typeof value == "number") {
                field_el = document.createElement("div");
                field_el.classList.add("field");
                field_el.classList.add("box");
                if (typeof value == "object" && value != null) {
                    value = JSON.stringify(value, null, 4);
                }
                if (saved_value) {
                    field_el.classList.add("saved");
                } else {
                    saved_value = value;
                }
                let placeholder;
                if (["api_key", "proof_token"].includes(key)) {
                    placeholder = saved_value && saved_value.length >= 22 ? (saved_value.substring(0, 12) + "*".repeat(12) + saved_value.substring(saved_value.length-12)) : value;
                } else {
                    placeholder = value == null ? "null" : value;
                }
                field_el.innerHTML = `<label for="${el_id}" title="">${key}:</label>`;
                if (Number.isInteger(value)) {
                    max = value == 42 || value >= 4096 ? 8192 : value >= 100 ? 4096 : value == 1 ? 10 : 100;
                    step = value >= 1024 ? 8 : 1;
                    field_el.innerHTML += `<input type="range" id="${el_id}" name="${key}" value="${framework.escape(value)}" class="slider" min="0" max="${max}" step="${step}"/><output>${framework.escape(value)}</output>`;
                    field_el.innerHTML += `<i class="fa-solid fa-xmark"></i>`;
                } else if (typeof value == "number") {
                    field_el.innerHTML += `<input type="range" id="${el_id}" name="${key}" value="${framework.escape(value)}" class="slider" min="0" max="2" step="0.1"/><output>${framework.escape(value)}</output>`;
                    field_el.innerHTML += `<i class="fa-solid fa-xmark"></i>`;
                } else {
                    field_el.innerHTML += `<textarea id="${el_id}" name="${key}"></textarea>`;
                    field_el.innerHTML += `<i class="fa-solid fa-xmark"></i>`;
                    input_el = field_el.querySelector("textarea");
                    if (value != null) {
                        input_el.dataset.text = value;
                    }
                    input_el.placeholder = placeholder;
                    if (!["api_key", "proof_token"].includes(key)) {
                        input_el.value = saved_value;
                    } else {
                        input_el.dataset.saved_value = saved_value;
                    }
                    input_el.oninput = () => {
                        field_el.classList.add("saved");
                        appStorage.setItem(el_id, input_el.value);
                        input_el.dataset.saved_value = input_el.value;
                    };
                    input_el.onfocus = () => {
                        if (input_el.dataset.saved_value) {
                            input_el.value = input_el.dataset.saved_value;
                        } else if (["api_key", "proof_token"].includes(key)) {
                            input_el.value = input_el.dataset.text;
                        }
                        input_el.style.height = (input_el.scrollHeight) + "px";
                    }
                    input_el.onblur = () => {
                        input_el.style.removeProperty("height");
                        if (["api_key", "proof_token"].includes(key)) {
                            input_el.value = "";
                        }
                    }
                }
                if (!input_el) {
                    input_el = field_el.querySelector("input");
                    input_el.dataset.value = value;
                    input_el.value = saved_value;
                    input_el.nextElementSibling.value = input_el.value;
                    input_el.oninput = () => {
                        input_el.nextElementSibling.value = input_el.value;
                        field_el.classList.add("saved");
                        appStorage.setItem(input_el.id, input_el.value);
                    };
                }
            }
            form_el.appendChild(field_el);
            let xmark_el = field_el.querySelector(".fa-xmark");
            xmark_el.onclick = () => {
                if (input_el.dataset.checked) {
                    input_el.checked = input_el.dataset.checked == "true";
                } else if (input_el.dataset.value) {
                    input_el.value = input_el.dataset.value;
                    input_el.nextElementSibling.value = input_el.dataset.value;
                } else if (input_el.dataset.text) {
                    input_el.value = input_el.dataset.text;
                }
                delete input_el.dataset.saved_value;
                appStorage.removeItem(el_id);
                field_el.classList.remove("saved");
            }
        });
        provider_forms.appendChild(form_el);
    }
}

async function add_message_chunk(message, message_id, provider, finish_message=null) {
    content_map = content_storage[message_id];
    if (message.type == "conversation") {
        const conversation = await get_conversation(window.conversation_id);
        if (!conversation.data) {
            conversation.data = {};
        }
        for (const [key, value] of Object.entries(message.conversation)) {
            conversation.data[key] = value;
        }
        await save_conversation(update_conversation(conversation));
    } else if (message.type == "auth") {
        error_storage[message_id] = message.message
        content_map.inner.innerHTML += framework.markdown(`${framework.translate('**An error occured:**')} ${message.message}`);
        let provider = provider_storage[message_id]?.name;
        let configEl = document.querySelector(`.settings .${provider}-api_key`);
        if (configEl) {
            configEl = configEl.parentElement.cloneNode(true);
            content_map.content.appendChild(configEl);
            await register_settings_storage();
        }
    } else if (message.type == "provider") {
        provider_storage[message_id] = message.provider;
        let provider_el = content_map.content.querySelector('.provider');
        provider_el.innerHTML = `
            <a href="${message.provider.url}" target="_blank">
                ${message.provider.label ? message.provider.label : message.provider.name}
            </a>
            ${message.provider.model ? ' ' + framework.translate('with') + ' ' + message.provider.model : ''}
        `;
    } else if (message.type == "message") {
        console.error(message.message)
        await api("log", {...message, provider: provider_storage[message_id]});
    } else if (message.type == "error") {
        content_map.update_timeouts.forEach((timeoutId)=>clearTimeout(timeoutId));
        content_map.update_timeouts = [];
        error_storage[message_id] = message.message
        console.error(message.message);
        content_map.inner.innerHTML += framework.markdown(`${framework.translate('**An error occured:**')} ${message.message}`);
        if (finish_message) {
            await finish_message();
        }
        let p = document.createElement("p");
        p.innerText = message.error;
        log_storage.appendChild(p);
        await api("log", {...message, provider: provider_storage[message_id]});
    } else if (message.type == "preview") {
        let img;
        if (img = content_map.inner.querySelector("img")) {
            if (img.complete) {
                const backup = img.src;
                img.src = message.urls;
                img.onerror = () => img.src = backup;
            }
        } else {
            content_map.inner.innerHTML = framework.markdown(message.preview);
            await register_message_images();
        }
    } else if (message.type == "content") {
        message_storage[message_id] += message.content;
        if (message.data) {
            content_data_storage[message_id] = message.data;
        }
        if (message.urls) {
            content_alt_storage[message_id] = message.alt;
            const div = document.createElement("div");
            div.innerHTML = framework.markdown(message.content);
            const media = div.querySelector("img, video")
            content_map.inner.appendChild(div);
            let cursorDiv = content_map.inner.querySelector(".cursor");
            if (cursorDiv) cursorDiv.parentNode.removeChild(cursorDiv);
        } else if(message.content) {
            update_message(content_map, message_id, null);
        }
    } else if (message.type == "log") {
        let p = document.createElement("p");
        p.innerText = message.log;
        log_storage.appendChild(p);
    } else if (message.type == "synthesize") {
        synthesize_storage[message_id] = message.synthesize;
    } else if (message.type == "title") {
        title_storage[message_id] = message.title;
    } else if (message.type == "login") {
        update_message(content_map, message_id, framework.markdown(message.login));
    } else if (message.type == "finish") {
        finish_storage[message_id] = message.finish;
    } else if (message.type == "continue") {
        continue_storage[message_id] = message;
    } else if (message.type == "usage") {
        usage_storage[message_id] = message.usage;
    } else if (message.type == "reasoning") {
        if (!reasoning_storage[message_id]) {
            reasoning_storage[message_id] = message;
            reasoning_storage[message_id].text = "";
            if (message.is_thinking && message_storage[message_id]) {
                reasoning_storage[message_id].text = message_storage[message_id];
                message_storage[message_id] = "";
            }
        } else if (typeof message.status !== 'undefined') {
            reasoning_storage[message_id].status = message.status;
        } if (message.label) {
            reasoning_storage[message_id].label = message.label;
        } if (message.token) {
            reasoning_storage[message_id].text += message.token;
        }
        let reasoning_body = content_map.inner.querySelector(".reasoning_body") || content_map.inner;
        reasoning_body.classList.remove("reasoning_body");
        reasoning_body.innerHTML = render_reasoning(reasoning_storage[message_id]);
    } else if (message.type == "parameters") {
        if (!parameters_storage[provider]) {
            parameters_storage[provider] = {};
        }
        Object.entries(message.parameters).forEach(([key, value]) => {
            parameters_storage[provider][key] = value;
        });
    } else if (message.type == "suggestions") {
        suggestions = message.suggestions;
    }
}

function is_stopped() {
    if (stop_generating.classList.contains('stop_generating-hidden')) {
        return true;
    }
    return false;
}

const requestWakeLock = async () => {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    }
    catch(err) {
      console.error(err);
    }
};

async function play_last_message(response = null) {
    const last_message = Array.from(document.querySelectorAll(".message")).at(-1);
    const last_media = last_message ? last_message.querySelector("audio, iframe") : null;
    if (last_media) {
        if (last_media.tagName == "IFRAME") {
            if (YT) {
                async function onPlayerReady(event) {
                    event.target.setVolume(100);
                    event.target.playVideo();
                }
                player = new YT.Player(last_media, {
                    events: {
                        'onReady': onPlayerReady,
                    }
                });
            }
        } else {
            if (response) {
                if (response.choices) {
                    response = `data:audio/mpeg;base64,${response.choices[0].message.audio.data}`;
                }
                last_media.src = response;
            }
            last_media.play();
        }
    }
}

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

const ask_gpt = async (message_id, message_index = -1, regenerate = false, provider = null, model = null, action = null, message = null) => {
    if (!model && !provider) {
        model = get_selected_model();
        provider = providerSelect.options[providerSelect.selectedIndex]?.value;
    }
    const is_youtube = provider == "YouTube";
    let conversation = await get_conversation(window.conversation_id);
    if (!conversation) {
        return;
    }
    await requestWakeLock();
    let messages = prepare_messages(conversation.items, is_youtube ? -1 : message_index, action=="continue" || is_youtube);
    message_storage[message_id] = "";
    stop_generating.classList.remove("stop_generating-hidden");

    let suggestions_el = chatBody.querySelector('.suggestions');
    suggestions_el ? suggestions_el.remove() : null;
    if (countTokensEnabled) {
        let count_total = chatBody.querySelector('.count_total');
        count_total ? count_total.parentElement.removeChild(count_total) : null;
    }

    const message_el = document.createElement("div");
    message_el.classList.add("message");
    if (message_index != -1 || regenerate) {
        message_el.classList.add("regenerate");
    }
    message_el.innerHTML = `
        <div class="assistant">
            ${gpt_image}
            <i class="fa-solid fa-xmark"></i>
            <i class="fa-regular fa-phone-arrow-down-left"></i>
        </div>
        <div class="content">
            <div class="provider" data-provider="${provider}"></div>
            <div class="content_inner"><span class="cursor"></span></div>
            <div class="count"></div>
        </div>
    `;
    if (message_index == -1) {
        chatBody.appendChild(message_el);
    } else {
        parent_message = chatBody.querySelector(`.message[data-index="${message_index}"]`);
        if (!parent_message) {
            return;
        }
        parent_message.after(message_el);
    }

    let content_el = message_el.querySelector('.content');
    let content_map = content_storage[message_id] = {
        container: message_el,
        content: content_el,
        inner: content_el.querySelector('.content_inner'),
        count: content_el.querySelector('.count'),
        update_timeouts: [],
        message_index: message_index,
    }
    async function finish_message() {
        content_map.update_timeouts.forEach((timeoutId)=>clearTimeout(timeoutId));
        content_map.update_timeouts = [];
        if (!error_storage[message_id] && message_storage[message_id]) {
            html = framework.markdown(message_storage[message_id]);
            content_map.inner.innerHTML = html;
            highlight(content_map.inner);
        }
        if (message_storage[message_id] || reasoning_storage[message_id]?.status || reasoning_storage[message_id]?.text) {
            const message_provider = message_id in provider_storage ? provider_storage[message_id] : null;
            let usage = {};
            if (usage_storage[message_id]) {
                usage = usage_storage[message_id];
            }
            // Calculate usage if we don't have it jet
            if (countTokensEnabled && !usage.prompt_tokens && window.GPTTokenizer_cl100k_base) {
                const prompt_token_model = model?.startsWith("gpt-3") ? "gpt-3.5-turbo" : "gpt-4"
                let prompt_tokens = 0;
                if (content_alt_storage[message_id]) {
                    prompt_tokens = count_tokens(content_alt_storage[message_id], content_alt_storage[message_id]);
                } else {
                    const filtered = messages.filter((item)=>!Array.isArray(item.content) && item.content);
                    prompt_tokens = GPTTokenizer_cl100k_base?.encodeChat(filtered, prompt_token_model).length;
                }
                const completion_tokens = count_tokens(message_provider?.model, message_storage[message_id])
                    + (reasoning_storage[message_id] ? count_tokens(message_provider?.model, reasoning_storage[message_id].text) : 0);
                usage = {
                    ...usage,
                    prompt_tokens: prompt_tokens,
                    completion_tokens: completion_tokens,
                    total_tokens: prompt_tokens + completion_tokens
                }
            }
            // It is not regenerated, if it is the first response to a new question
            if (regenerate && message_index == -1) {
                let conversation = await get_conversation(window.conversation_id);
                regenerate = conversation.items[conversation.items.length-1]["role"] != "user";
            }
            // Create final message content
            const final_message = message_storage[message_id]
                                + (error_storage[message_id] ? " [error]" : "")
                                + (stop_generating.classList.contains('stop_generating-hidden') ? " [aborted]" : "")
            if (reasoning_storage[message_id] && !reasoning_storage[message_id].status) {
                reasoning_storage[message_id].status = "";
            }
            // Save message in local storage
            message_index = await add_message(
                window.conversation_id,
                "assistant",
                final_message,
                message_provider,
                message_index,
                synthesize_storage[message_id],
                regenerate && provider != "YouTube",
                title_storage[message_id],
                finish_storage[message_id],
                usage,
                reasoning_storage[message_id],
                action=="continue"
            );
            delete message_storage[message_id];
            delete reasoning_storage[message_id];
            delete synthesize_storage[message_id];
            delete title_storage[message_id];
            delete finish_storage[message_id];
            delete usage_storage[message_id];
            // Send usage to the server
            if (!usage_storage[message_id] || !usage_storage[message_id].prompt_tokens) {
                usage = {
                    model: message_provider?.model,
                    provider: message_provider?.name,
                    ...usage
                };
                const user = localStorage.getItem("user");
                if (user) {
                    usage = {user: user, ...usage};
                }
                api("usage", usage);
            }
        }
        // Update controller storage
        if (controller_storage[message_id]) {
            delete controller_storage[message_id];
        }
        // Reload conversation if no error
        if (!error_storage[message_id]) {
            if(await safe_load_conversation(window.conversation_id)) {
                play_last_message(content_data_storage[message_id]); // Play last message async
                delete content_data_storage[message_id];
                if (message_index == -1) {
                    chatBody.scrollTop = chatBody.scrollHeight;
                }
            }
        }
        let cursorDiv = message_el.querySelector(".cursor");
        if (cursorDiv) cursorDiv.parentNode.removeChild(cursorDiv);
        await safe_remove_cancel_button();
        await register_message_images();
        await register_message_buttons();
        await load_conversations();
        regenerate_button.classList.remove("regenerate-hidden");
    }
    const media = [];
    if (mediaRecorder && mediaRecorder.wavBlob) {
        const data = await toBase64(mediaRecorder.wavBlob);
        media.push({
            "type": "input_audio",
            "input_audio": {
                "data": data.split(",")[1],
                "format": "wav"
            }
        });
    }
    if (client) {
        for (const file of Object.values(image_storage)) {
            media.push({
                "type": "image_url",
                "image_url": {
                    "url": await toUrl(file)
                }
            });
        }
        messages = messages.map((message) => {
            return {
                role: message.role,
                content: Array.isArray(message.content) ? message.content.map((item) => {
                    return {
                        type: "text",
                        text: item.text || ""
                    }
                }) : message.content
            }
        });
    }
    let last_message;
    if (messages.length > 0) {
        last_message = messages[messages.length - 1];
        if (last_message.content && media.length > 0) {
            last_message.content = [
                ...(Array.isArray(last_message.content) ? last_message.content : [{type: "text", text: last_message.content}]),
                ...media
            ];
        } else {
            last_message.content = media.length > 0 ? media : last_message.content;
        }
    } else {
        messages = [{
            role: "user",
            content: media.length > 0 ? media : message || ""
        }];
    }
    if (!message) {
        message = last_message?.content;
    }
    if (client) {
        const selectedOption = modelProvider.options[modelProvider.selectedIndex];
        const selectedModel = selectedOption.value || client.defaultModel;
        const modelType = selectedOption.dataset.type || 'chat';
        try {
            // Conditionally call the correct client method based on model type.
            if (modelType === 'image') {
                // Handle image generation
                const response = await client.images.generate({
                    model: selectedModel,
                    prompt: message,
                    seed: regenerate ? Math.floor(Date.now() / 1000) : null
                });
                const imageUrl = response.data[0].url;
                await add_message(
                    window.conversation_id,
                    "assistant",
                    `[![${sanitize(message, ' ')}](${imageUrl})](${imageUrl})`,
                    null,
                    message_index,
                );
                await load_conversation(await get_conversation(conversation_id));
                safe_remove_cancel_button();
                load_conversations();
                hide_sidebar();
            } else {
                // if (model == "openai-audio") {
                //     body.audio = {voice: "alloy", format: "mp3"};
                //     body.modalities = ["text", "audio"];
                // }
                // Handle chat completion (existing logic)
                const stream = await client.chat.completions.create({
                    model: selectedModel,
                    messages,
                    stream: true
                });

                const baseUrl = client.baseUrl ? client.baseUrl.split("/api/")[0] : "";
                let hasModel = false;
                for await (const chunk of stream) {
                    let delta;
                    if (chunk.usage) {
                        add_message_chunk({type: "usage", usage: chunk.usage}, message_id);
                    }
                    if (chunk.model && !hasModel) {
                        hasModel = true;
                        add_message_chunk({type: "provider", provider: {name: provider, model: chunk.model}}, message_id);
                    }
                    if (chunk.error) {
                        add_message_chunk({type: "error", ...chunk.error}, message_id);
                        return;
                    }
                    if (chunk.choices[0]?.delta?.reasoning_content) {
                        delta = chunk.choices[0].delta.reasoning_content;
                        add_message_chunk({type: "reasoning", token: delta}, message_id);
                    } else {
                        delta = chunk.choices[0]?.delta?.content || '';
                        delta = delta.replaceAll("/media/", baseUrl + "/media/");
                        delta = delta.replaceAll("/thumbnail/", baseUrl + "/thumbnail/");
                        add_message_chunk({type: "content", content: delta}, message_id);
                    }
                }
                await finish_message();
            }
        } catch (err) {
            safe_remove_cancel_button();
            console.error(err);
            error_storage[message_id] = `${err?.error?.message || err}`;
            content_map.inner.innerHTML += framework.markdown(`${framework.translate('**An error occured:**')} ${error_storage[message_id]}`);
            await finish_message();
        }
        return;
    }
    try {
        const apiKey = get_api_key_by_provider(provider);
        const downloadMedia = document.getElementById("download_media")?.checked;
        let apiBase;
        if (provider == "Custom") {
            apiBase = document.getElementById("api_base")?.value;
            if (!apiBase) {
                provider = "";
            }
        }
        const ignored = Array.from(settings.querySelectorAll("input.provider:not(:checked)")).map((el)=>el.value);
        const extraBody = {};
        for (el of document.getElementById(`${provider}-form`)?.querySelectorAll(".saved input, .saved textarea") || []) {
            let value;
            if (el.type == "checkbox") {
                value = el.checked;
            } else {
                value = el.value;
                try {
                    value = await JSON.parse(value);
                } catch (e) {}
            }
            extraBody[el.name] = value;
        };
        const isAutomaticOrientation = appStorage.getItem("automaticOrientation") != "false";
        const aspectRatio = isAutomaticOrientation ? (window.innerHeight > window.innerWidth ? "9:16" : "16:9") : null;
        let conversationData = null;
        if (provider == "AnyProvider") {
            conversationData = conversation.data;
        } else if (provider && conversation.data && provider in conversation.data) {
            conversationData = conversation.data[provider];
        }
        controller_storage[message_id] = new AbortController();
        await api("conversation", {
            id: message_id,
            conversation_id: window.conversation_id,
            conversation: conversationData,
            model: model,
            web_search: switchInput.checked,
            provider: provider,
            messages: messages,
            action: action,
            download_media: downloadMedia,
            api_key: apiKey,
            api_base: apiBase,
            ignored: ignored,
            aspect_ratio: aspectRatio,
            ...extraBody
        }, Object.values(image_storage), message_id, finish_message);
    } catch (e) {
        console.error(e);
    }
};

async function scroll_to_bottom() {
    window.scrollTo(0, 0);
    chatBody.scrollTop = chatBody.scrollHeight;
}

let autoScrollEnabled = true;

setInterval(() => {
    // Auto-scroll if enabled
    if (autoScrollEnabled) {
        chatBody.scrollTop = chatBody.scrollHeight;
    }
}, 500);

chatBody.addEventListener('scroll', () => {
    const atBottom = chatBody.scrollTop + chatBody.clientHeight >= chatBody.scrollHeight - 10;
    autoScrollEnabled = atBottom && chatBody.clientHeight > 0;
});

const clear_conversations = async () => {
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

async function set_conversation_title(conversation_id, title) {
    conversation = await get_conversation(conversation_id)
    conversation.new_title = title;
    delete conversation.share;
    const new_id = sanitize(title, " ");
    const new_conv = await get_conversation(new_id);
    if (new_id && !new_conv) {
        await delete_conversation(conversation_id);
        title_ids_storage[conversation_id] = new_id;
        conversation.backup = conversation.backup || conversation.id;
        conversation.id = new_id;
        add_url_to_history(`#${new_id}`);
    }
    await save_conversation(conversation);
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

const set_conversation = async (conversation_id) => {
    if (title_ids_storage[conversation_id]) {
        conversation_id = title_ids_storage[conversation_id];
    }
    add_url_to_history(`#${conversation_id}`);
    window.conversation_id = conversation_id;

    suggestions = null;
    await clear_conversation();
    await load_conversation(await get_conversation(conversation_id));
    play_last_message();
    load_conversations();
    hide_sidebar(true);
};

const new_conversation = async (private = false) => {
    if (window.location.hash) {
        add_url_to_history("#new");
    }
    window.conversation_id = private ? null : generateUUID();
    document.title = window.title || document.title;
    document.querySelector(".chat-top-panel .convo-title").innerText = private ? framework.translate("Private Conversation") : framework.translate("New Conversation");
    
    suggestions = null;
    await clear_conversation();
    if (chatPrompt) {
        chatPrompt.value = document.getElementById("systemPrompt")?.value;
    }
    load_conversations();
    hide_sidebar(true);
    say_hello();
};

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

const load_conversation = async (conversation) => {
    if (!conversation) {
        return;
    }
    lastUpdated = conversation.updated;
    let messages = conversation?.items || [];
    console.debug("Conversation:", conversation.id)

    let conversation_title = conversation.new_title || conversation.title;
    title = conversation_title ? `${conversation_title} - G4F` : window.title;
    if (title) {
        document.title = title;
    }
    const chatHeader = document.querySelector(".chat-top-panel .convo-title");
    if (conversation.share) {
        chatHeader.innerHTML = '<i class="fa-solid fa-qrcode"></i> ' + framework.escape(conversation_title);
    } else if (window.conversation_id) {
        chatHeader.innerText = conversation_title;
    }

    if (chatPrompt) {
        chatPrompt.value = conversation.system || "";
    }

    let elements = [];
    let last_model = null;
    let providers = [];
    let buffer = "";
    let completion_tokens = 0;

    messages.forEach((item, i) => {
        if (item.continue) {
            elements.pop();
        } else {
            buffer = "";
        }
        buffer = filter_message_content(buffer);
        new_content = filter_message_content(item.content);
        buffer = merge_messages(buffer, new_content);
        last_model = item.provider?.model;
        providers.push(item.provider?.name);
        let next_i = parseInt(i) + 1;
        let next_provider = item.provider ? item.provider : (messages.length > next_i ? messages[next_i].provider : null);
        let provider_label = item.provider?.label ? item.provider.label : item.provider?.name;
        let provider_link = item.provider?.name ? `<a href="${item.provider.url}" target="_blank">${provider_label}</a>` : "";
        let provider = provider_link ? `
            <div class="provider" data-provider="${item.provider.name}">
                ${provider_link}
                ${item.provider.model ? ' ' + framework.translate('with') + ' ' + item.provider.model : ''}
            </div>
        ` : "";
        let synthesize_url = "";
        let synthesize_params;
        let synthesize_provider;
        let text = Array.isArray(buffer) && buffer.length ? buffer[0].text : buffer;
        if (!text) {
            text = item.reasoning ? item.reasoning.text : "";
        }
        if (text) {
            if (!framework.backendUrl) {
                synthesize_params = (new URLSearchParams({input: text, voice: "alloy"})).toString();
                synthesize_url = `https://www.openai.fm/api/generate?${synthesize_params}`;
            } else {
                if (item.synthesize) {
                    synthesize_params = item.synthesize.data
                    synthesize_provider = item.synthesize.provider;
                } else {
                    synthesize_params = {text: text}
                    synthesize_provider = "Gemini";
                }
                synthesize_params = (new URLSearchParams(synthesize_params)).toString();
                synthesize_url = `${framework.backendUrl}/backend-api/v2/synthesize/${synthesize_provider}?${synthesize_params}`;
            }
        }
        const file = new File([text], 'message.md', {type: 'text/plain'});
        const objectUrl = URL.createObjectURL(file);

        let add_buttons = [];
        // Find buttons to add
        actions = ["variant"]
        // Add continue button if possible
        if (buffer && item.role == "assistant" && !Array.isArray(buffer)) {
            let reason = "stop";
            // Read finish reason from conversation
            if (item.finish && item.finish.reason) {
                reason = item.finish.reason;
            }
            let lines = buffer.trim().split("\n");
            let lastLine = lines[lines.length - 1];
            // Has a stop or error token at the end
            if (lastLine.endsWith("[aborted]") || lastLine.endsWith("[error]")) {
                reason = "error";
            // Has an even number of start or end code tags
            } else if (reason == "stop" && buffer.split("```").length - 1 % 2 === 1) {
                reason = "length";
            }
            if (reason != "stop") {
                actions.push("continue")
            }
        }

        add_buttons.push(`<button class="options_button">
            <div>
                <span><i class="fa-solid fa-qrcode"></i></span>
                <span><i class="fa-brands fa-whatsapp"></i></span>
                <span><i class="fa-solid fa-volume-high"></i></i></span>
                <span><i class="fa-solid fa-print"></i></span>
                <span><i class="fa-solid fa-file-export"></i></span>
                <span><i class="fa-regular fa-clipboard"></i></span>
            </div>
            <i class="fa-solid fa-plus"></i>
        </button>`);

        if (actions.includes("variant")) {
            add_buttons.push(`<button class="regenerate_button">
                <span>${framework.translate('Regenerate')}</span>
                <i class="fa-solid fa-rotate"></i>
            </button>`);
        }
        if (actions.includes("continue")) {
            if (messages.length >= i - 1) {
                add_buttons.push(`<button class="continue_button">
                    <span>${framework.translate('Continue')}</span>
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                </button>`);
            }
        }

        countTokensEnabled = appStorage.getItem("countTokens") != "false";
        let next_usage;
        let prompt_tokens; 
        if (countTokensEnabled) {
            if (!item.continue) {
                completion_tokens = 0;
            }
            completion_tokens += item.usage?.completion_tokens ? item.usage.completion_tokens : 0;
            next_usage = messages.length > next_i ? messages[next_i].usage : null;
            prompt_tokens = next_usage?.prompt_tokens ? next_usage?.prompt_tokens : 0
        }

        elements.push(`
            <div class="message${item.regenerate ? " regenerate": ""}" data-index="${i}" data-object_url="${objectUrl}" data-synthesize_url="${synthesize_url}">
                <div class="${item.role}">
                    ${item.role == "assistant" ? gpt_image : user_image}
                    <i class="fa-solid fa-xmark"></i>
                    ${item.role == "assistant"
                        ? `<i class="fa-regular fa-phone-arrow-down-left"></i>`
                        : `<i class="fa-regular fa-phone-arrow-up-right"></i>`
                    }
                </div>
                <div class="content">
                    ${provider}
                    <div class="content_inner">
                        ${item.reasoning ? render_reasoning(item.reasoning, true): ""}
                        ${framework.markdown(buffer)}
                    </div>
                    <div class="count">
                        ${countTokensEnabled ? count_words_and_tokens(
                            item.reasoning ? item.reasoning.text + text : text,
                            next_provider?.model, completion_tokens, prompt_tokens
                        ) : ""}
                        ${add_buttons.join("")}
                    </div>
                </div>
            </div>
        `);
    });
    chatBody.innerHTML = elements.join("");

    chatBody.querySelectorAll("video").forEach((el) => {
        el.onloadedmetadata = () => {
            if (el.videoWidth > 0) {
                el.muted = true;
                el.onclick = () => el.click();
                el.onmouseover = () => {
                    el.loop = true;
                    el.play()
                };
                el.onmouseleave = () => {
                    el.loop = false;
                };
                el.ontouchstart = () => {
                    el.loop = true;
                    el.play();
                };
                el.ontouchend = () => {
                    el.loop = false;
                };
            } else {
                el.style.width = "300px";
                el.style.height = "40px";
            }
        }
    });

    if (suggestions) {
        const suggestions_el = document.createElement("div");
        suggestions_el.classList.add("suggestions");
        suggestions.forEach((suggestion)=> {
            const el = document.createElement("button");
            el.classList.add("suggestion");
            el.innerHTML = `<span>${framework.escape(suggestion)}</span> <i class="fa-solid fa-turn-up"></i>`;
            el.onclick = async () => {
                suggestions = null;
                await handle_ask(true, suggestion);
            }
            suggestions_el.appendChild(el);
        });
        chatBody.appendChild(suggestions_el);
    } else if (countTokensEnabled && window.GPTTokenizer_cl100k_base) {
        let filtered = prepare_messages(messages, null, true, false);
        filtered = filtered.filter((item)=>!Array.isArray(item.content) && item.content);
        if (filtered.length > 0) {
            last_model = last_model?.startsWith("gpt-3") ? "gpt-3.5-turbo" : "gpt-4"
            let count_total = GPTTokenizer_cl100k_base?.encodeChat(filtered, last_model).length
            if (count_total > 0) {
                const count_total_el = document.createElement("div");
                count_total_el.classList.add("count_total");
                count_total_el.innerText = framework.translate("{0} total tokens").replace("{0}", count_total);
                chatBody.appendChild(count_total_el);
            }
        }
    }

    await register_message_buttons();
    highlight(chatBody);
    regenerate_button.classList.remove("regenerate-hidden");
    chatBody.scrollTo({ top: chatBody.scrollHeight, behavior: "smooth" });
};

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

async function add_conversation(conversation_id) {
    if (!conversation_id) {
        privateConversation = {
            id: conversation_id,
            title: "",
            added: Date.now(),
            system: chatPrompt?.value,
            items: [],
        }
        return;
    }
    if (!await get_conversation(conversation_id)) {
        await save_conversation(update_conversation({
            id: conversation_id,
            title: "",
            added: Date.now(),
            system: chatPrompt?.value,
            items: [],
        }));
    }
    add_url_to_history(`#${conversation_id}`);
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
    data = update_conversation(conversation);
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
    conversations.sort((a, b) => (b.updated||0)-(a.updated||0));
    await clear_conversations();
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
        let convo = document.createElement("div");
        convo.classList.add("convo");
        convo.id = `convo-${conversation.id}`;
        convo.innerHTML = `
            <div class="left" onclick="set_conversation('${conversation.id}')">
                <i class="fa-regular fa-comments"></i>
                <span class="datetime">${conversation.updated ? toLocaleDateString(conversation.updated) : ""}</span>
                <span class="convo-title">${shareIcon} ${framework.escape(conversation.new_title ? conversation.new_title : conversation.title)}</span>
            </div>
            <i onclick="show_option('${conversation.id}')" class="fa-solid fa-ellipsis-vertical" id="conv-${conversation.id}"></i>
            <div id="cho-${conversation.id}" class="choise" style="display:none;">
                <i onclick="on_delete_conversation('${conversation.id}')" class="fa-solid fa-trash"></i>
                <i onclick="hide_option('${conversation.id}')" class="fa-regular fa-x"></i>
            </div>
        `;
        box_conversations.appendChild(convo);
    });
};

const hide_input = document.querySelector(".chat-toolbar .hide-input");
hide_input.addEventListener("click", async (e) => {
    const icon = hide_input.querySelector("i");
    const func = icon.classList.contains("fa-angles-down") ? "add" : "remove";
    const remv = icon.classList.contains("fa-angles-down") ? "remove" : "add";
    icon.classList[func]("fa-angles-up");
    icon.classList[remv]("fa-angles-down");
    document.querySelector(".chat-footer .user-input").classList[func]("hidden");
    document.querySelector(".chat-footer .buttons").classList[func]("hidden");
});

function get_message_id() {
    random_bytes = (Math.floor(Math.random() * 1338377565) + 2956589730).toString(
        2
    );
    unix = Math.floor(Date.now() / 1000).toString(2);

    return BigInt(`0b${unix}${random_bytes}`).toString();
};

async function hide_sidebar(remove_shown=false) {
    if (remove_shown && window.innerWidth < 640) { // Only apply on mobile
        sidebar.classList.remove("shown");
    }
    settings.classList.add("hidden");
    chat.classList.remove("hidden");
    log_storage.classList.add("hidden");
    await hide_settings();
    if (window.location.hash.endsWith("#menu") || window.location.pathname.endsWith("#settings")) {
        history.back();
    }
}

async function hide_settings() {
    settings.classList.add("hidden");
    let provider_forms = document.querySelectorAll(".provider_forms from");
    Array.from(provider_forms).forEach((form) => form.classList.add("hidden"));
}

sidebar_buttons.forEach((el) => el.addEventListener("click", async () => {
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
}));

function add_url_to_history(url) {
    if (!window?.pywebview) {
        try {
            history.pushState({}, null, url);
        } catch (e) {
            console.error(e);
        }
    }
}

async function show_menu() {
    sidebar.classList.add("shown");
    sidebar.classList.remove("minimized");
    await hide_settings();
    add_url_to_history("#menu");
}

function open_settings() {
    if (settings.classList.contains("hidden")) {
        chat.classList.add("hidden");
        sidebar.classList.remove("shown");
        settings.classList.remove("hidden");
        add_url_to_history("#settings");
    } else {
        settings.classList.add("hidden");
        chat.classList.remove("hidden");
        add_url_to_history(window.conversation_id ? `#${window.conversation_id}` : window.location.search);
    }
    log_storage.classList.add("hidden");
}

const register_settings_storage = async () => {
    const optionElements = document.querySelectorAll(optionElementsSelector);
    optionElements.forEach((element) => {
        if (element.type == "textarea") {
            element.addEventListener('input', async (event) => {
                appStorage.setItem(element.id, element.value);
            });
        } else {
            element.addEventListener('change', async (event) => {
                switch (element.type) {
                    case "checkbox":
                        appStorage.setItem(element.id, element.checked);
                        break;
                    case "select-one":
                        appStorage.setItem(element.id, element.value);
                        break;
                    case "text":
                    case "number":
                        appStorage.setItem(element.id, element.value);
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
    });
}

async function load_settings(provider_options) {
    await register_settings_storage();
    await load_settings_storage();

    Object.entries(provider_options).forEach(
        ([provider_name, option]) => load_provider_option(option.querySelector("input"), provider_name)
    );
}

const load_settings_storage = async () => {
    const optionElements = document.querySelectorAll(optionElementsSelector);
    optionElements.forEach((element) => {
        value = appStorage.getItem(element.id);
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

    chatBody.innerHTML += `
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
    if (window.GPTTokenizer_cl100k_base && window.GPTTokenizer_o200k_base) {
        if (model?.startsWith("gpt-4o") || model?.startsWith("o1")) {
            return GPTTokenizer_o200k_base?.encode(text, model).length;
        } else {
            model = model?.startsWith("gpt-3") ? "gpt-3.5-turbo" : "gpt-4"
            return GPTTokenizer_cl100k_base?.encode(text, model).length;
        }
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

function count_words_and_tokens(text, model, completion_tokens, prompt_tokens) {
    if (Array.isArray(text) || !text) {
        return "";
    }
    text = filter_message(text);
    return `(${count_words(text)} ${framework.translate('words')}, ${count_chars(text)} ${framework.translate('chars')}, ${completion_tokens ? completion_tokens : count_tokens(model, text, prompt_tokens)} ${framework.translate('tokens')})`;
}

function update_message(content_map, message_id, content=null) {
    // Clear previous timeouts
    content_map.update_timeouts.forEach(timeoutId => clearTimeout(timeoutId));
    content_map.update_timeouts = [];
    
    // Create new timeout
    content_map.update_timeouts.push(setTimeout(() => {
        // Existing function body
        if (!content) {
            if (reasoning_storage[message_id] && message_storage[message_id]) {
                content = render_reasoning(reasoning_storage[message_id], true) + framework.markdown(message_storage[message_id]);
            } else if (reasoning_storage[message_id]) {
                content = render_reasoning(reasoning_storage[message_id]);
            } else {
                content = framework.markdown(message_storage[message_id]);
            }
            
            // Find last element for cursor placement
            let lastElement, lastIndex = null;
            for (element of ['</p>', '</code></pre>', '</p>\n</li>\n</ol>', '</li>\n</ol>', '</li>\n</ul>']) {
                const index = content.lastIndexOf(element)
                if (index - element.length > lastIndex) {
                    lastElement = element;
                    lastIndex = index;
                }
            }
            if (lastIndex) {
                content = content.substring(0, lastIndex) + '<span class="cursor"></span>' + lastElement;
            }
        }
        
        if (error_storage[message_id]) {
            content += framework.markdown(`${framework.translate('**An error occured:**')} ${error_storage[message_id]}`);
        }
        
        // Use progressive rendering for large content
        if (content.length > 10000) {
            //renderLargeMessage(content_map.inner, content);
            content_map.inner.innerHTML = content;
        } else {
            content_map.inner.innerHTML = content;
        }

        if (countTokensEnabled) {
            content_map.count.innerText = count_words_and_tokens(
                (reasoning_storage[message_id] ? reasoning_storage[message_id].text : "")
                + message_storage[message_id],
                provider_storage[message_id]?.model);
        }
        
        highlight(content_map.inner);
    }, 100));
};

function renderLargeMessage(container, content, chunkSize = 50) {
    if (content.length <= chunkSize * 100) {
        container.innerHTML = content;
        return;
    }
    
    // Split content into chunks
    const lines = content.split("\n");
    const chunks = [];
    const buffer = [];
    for (let i = 0; i < lines.length; i += 1) {
        buffer.push(lines[i]);
        if (buffer.length >= chunkSize || i === lines.length - 1) {
            chunks.push(buffer.join("\n"));
            buffer.length = 0; // Clear the buffer
        }
    }
    
    // Render chunks progressively
    let index = 0;
    container.innerHTML = chunks[0];
    
    const renderNextChunk = () => {
        index++;
        if (index < chunks.length) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = chunks[index];
            while (tempDiv.firstChild) {
                container.appendChild(tempDiv.firstChild);
            }
            setTimeout(renderNextChunk, 10);
        }
    };
    
    setTimeout(renderNextChunk, 10);
}

let countFocus = userInput;
const count_input = async () => {
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
window.addEventListener("hashchange", (event) => {
    iframe_container.classList.add("hidden");
    iframe.src = "";
    const conversation_id = window.location.hash.replace("#", "");
    if (conversation_id == "menu" || conversation_id == "settings") {
        if (conversation_id == "settings") {
            open_settings();
        }
        return;
    }
    hide_sidebar(true);
    if (conversation_id && conversation_id != "new") {
        window.conversation_id = conversation_id;
        set_conversation(conversation_id);
    } else {
        window.conversation_id = generateUUID();
        new_conversation();
    }
});
window.addEventListener('load', async function() {
    await on_load();
    await on_api();

    let conversation = await get_conversation(window.conversation_id);
    if (conversation && !conversation.share) {
        return await load_conversation(conversation);
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

let refreshOnHidden = true;
document.addEventListener("visibilitychange", () => {
    refreshOnHidden = !document.hidden;
});
setInterval(async () => {
    if (!refreshOnHidden || !window.conversation_id) {
        return;
    }
    let conversation = await get_conversation(window.conversation_id);
    if (!conversation || !conversation.share) {
        return
    }
    const response = await fetch(`${framework.backendUrl}/backend-api/v2/chat/${conversation.id}`, {
        headers: {
            'accept': 'application/json',
            'if-none-match': conversation.updated,
        },
    });
    if (response.status == 200) {
        const new_conversation = await response.json();
        if (conversation.id == window.conversation_id && new_conversation.updated != conversation.updated) {
            conversation = new_conversation;
            await save_conversation(conversation);
        }
    }
    if (lastUpdated != conversation.updated) {
        await load_conversations();
        await load_conversation(conversation);
    }
}, 5000);

window.addEventListener('pywebviewready', async function() {
    await on_api();
});

async function on_load() {
    translationSnipptes.forEach((snippet)=>this.framework.translate(snippet));
    count_input();
    if (window.location.hash == "#settings") {
        open_settings();
        await load_conversations();
        return;
    }
    const conversation_id = window.location.hash.replace("#", "");
    if (conversation_id && conversation_id != "new" && conversation_id != "menu") {
        window.conversation_id = conversation_id;
    } else {
        window.conversation_id = generateUUID();
    }
    chatPrompt.value = document.getElementById("systemPrompt")?.value || "";
    let chat_params = new URLSearchParams(window.location.query);
    if (chat_params.get("prompt")) {
        userInput.value = chat_params.get("prompt");
        userInput.style.height = "100%";
        userInput.focus();
        await load_conversations();
    } else if (!conversation_id) {
        await new_conversation();
    } else {
        await load_conversations();
    }
    hljs.addPlugin(new HtmlRenderPlugin())
    hljs.addPlugin(new CopyButtonPlugin());
    // Ensure sidebar is shown by default on desktop
    if (window.innerWidth >= 640) {
        sidebar.classList.add("shown");
        sidebar.classList.remove("minimized");
    }
}

const load_provider_option = (input, provider_name) => {
    if (input.checked) {
        modelSelect.querySelectorAll(`option[data-disabled_providers*="${provider_name}"]`).forEach(
            (el) => {
                el.dataset.disabled_providers = el.dataset.disabled_providers ? el.dataset.disabled_providers.split(" ").filter((provider) => provider!=provider_name).join(" ") : "";
                el.dataset.providers = (el.dataset.providers ? el.dataset.providers + " " : "") + provider_name;
                modelSelect.querySelectorAll(`option[value="${el.value}"]`).forEach((o)=>o.removeAttribute("disabled", "disabled"))
            }
        );
        providerSelect.querySelectorAll(`option[value="${provider_name}"]`).forEach(
            (el) => el.removeAttribute("disabled")
        );
        providerSelect.querySelectorAll(`option[data-parent="${provider_name}"]`).forEach(
            (el) => el.removeAttribute("disabled")
        );
        settings.querySelector(`.field:has(#${provider_name}-api_key)`)?.classList.remove("hidden");
        settings.querySelector(`.field:has(#${provider_name}-api_base)`)?.classList.remove("hidden");
    } else {
        modelSelect.querySelectorAll(`option[data-providers*="${provider_name}"]`).forEach(
            (el) => {
                el.dataset.providers = el.dataset.providers ? el.dataset.providers.split(" ").filter((provider) => provider!=provider_name).join(" ") : "";
                el.dataset.disabled_providers = (el.dataset.disabled_providers ? el.dataset.disabled_providers + " " : "") + provider_name;
                if (!el.dataset.providers) modelSelect.querySelectorAll(`option[value="${el.value}"]`).forEach((o)=>o.setAttribute("disabled", "disabled"))
            }
        );
        providerSelect.querySelectorAll(`option[value="${provider_name}"]`).forEach(
            (el) => el.setAttribute("disabled", "disabled")
        );
        providerSelect.querySelectorAll(`option[data-parent="${provider_name}"]`).forEach(
            (el) => el.setAttribute("disabled", "disabled")
        );
    }
};

function get_modelTags(model, add_vision = true) {
    if (model.type == "image") {
        model.image = true;
    }
    const parts = []
    for (let [name, text] of Object.entries(modelTags)) {
        if (name != "vision" || add_vision) {
            parts.push(model[name] ? ` ${text}` : "")
        }
    }
    return parts.join("");
}

async function load_providers(providers, provider_options, providersListContainer) {
    providers.sort((a, b) => a.label.localeCompare(b.label));
    providers.forEach((provider) => {
        let option = document.createElement("option");
        option.value = provider.name;
        option.dataset.label = provider.label;
        option.text = provider.label
            + get_modelTags(provider)
            + (provider.hf_space ? " 🤗" : "")
            + (provider.nodriver ? " 🌐" : "")
            + (!provider.nodriver && provider.auth ? " 🔑" : "");
        if (provider.parent)
            option.dataset.parent = provider.parent;
        providerSelect.appendChild(option);

        if (provider.parent && provider.name != "PuterJS") {
            if (!login_urls_storage[provider.parent]) {
                login_urls_storage[provider.parent] = [provider.label, provider.login_url, [provider.name], provider.auth];
            } else {
                login_urls_storage[provider.parent][2].push(provider.name);
            }
        } else if (provider.login_url) {
            const name = provider.parent || provider.name;
            if (!login_urls_storage[name]) {
                login_urls_storage[name] = [provider.label, provider.login_url, [name, provider.name], provider.auth];
            } else {
                login_urls_storage[name][0] = provider.label;
                login_urls_storage[name][1] = provider.login_url;
            }
        }
    });

    let providersContainer = document.createElement("div");
    providersContainer.classList.add("field", "collapsible");
    providersContainer.innerHTML = `
        <div class="collapsible-header">
            <span class="label">${framework.translate('Providers (Enable/Disable)')}</span>
            <i class="fa-solid fa-chevron-down"></i>
        </div>
        <div class="collapsible-content hidden"></div>
    `;
    settings.querySelector(".paper").appendChild(providersContainer);

    providers.forEach((provider) => {
        if (!provider.parent || provider.name == "PuterJS") {
            const name = provider.parent || provider.name;
            let option = document.createElement("div");
            option.classList.add("provider-item");
            let api_key = appStorage.getItem(`${name}-api_key`);
            option.innerHTML = `
                <span class="label">Enable ${provider.label}</span>
                <input id="Provider${name}" type="checkbox" name="Provider${name}" value="${name}" class="provider" ${(provider.active_by_default || api_key) ? 'checked="checked"' : ''}/>
                <label for="Provider${name}" class="toogle" title="Remove provider from dropdown"></label>
            `;
            option.querySelector("input").addEventListener("change", (event) => load_provider_option(event.target, name));
            providersContainer.querySelector(".collapsible-content").appendChild(option);
            provider_options[name] = option;
        }
    });

    providersContainer.querySelector(".collapsible-header").addEventListener('click', (e) => {
        providersContainer.querySelector(".collapsible-content").classList.toggle('hidden');
        providersContainer.querySelector(".collapsible-header").classList.toggle('active');
    });
    load_provider_login_urls(providersListContainer);
    await load_settings(provider_options);
    loadModels(providers);
}
function load_provider_login_urls(providersListContainer) {
    for (let [name, [label, login_url, childs, auth]] of Object.entries(login_urls_storage)) {
        if (!login_url) {
            continue;
        }
        let providerBox = document.createElement("div");
        providerBox.classList.add("field", "box");
        childs = childs.map((child) => `${child}-api_key`).join(" ");
        const placeholder = `placeholder="${name == "HuggingSpace" ? "zerogpu_token" : "api_key"}"`;
        const input_id = name == "PuterJS" ? "puter.auth.token" : `${name}-api_key`;
        providerBox.innerHTML = `
            <label for="${input_id}" class="label" title="">${label}:</label>
            <input type="text" id="${input_id}" name="${name}[api_key]" class="${childs}" ${placeholder} autocomplete="off"/>
        ` + (login_url ? `<a href="${login_url}" target="_blank" title="Login to ${label}">${framework.translate('Get API key')}</a>` : "");
        if (auth) {
            providerBox.querySelector("input").addEventListener("input", (event) => {
                const input = document.getElementById(`Provider${name}`);
                input.checked = !!event.target.value;
                load_provider_option(input, name);
            });
        }
        providersListContainer.querySelector(".collapsible-content").appendChild(providerBox);
    }
}
async function on_api() {
    load_version();
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
        userInput.style.height = "100%";
    });
    userInput.addEventListener("blur", async (evt) => {
        timeoutBlur = setTimeout(() => userInput.style.height = "", 200);
    });
    codeButton.addEventListener("click", async () => {
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

    let providersListContainer = document.createElement("div");
    providersListContainer.classList.add("field", "collapsible");
    providersListContainer.innerHTML = `
        <div class="collapsible-header">
            <span class="label">${framework.translate('Providers API key')}</span>
            <i class="fa-solid fa-chevron-down"></i>
        </div>
        <div class="collapsible-content api-key hidden"></div>
    `;
    settings.querySelector(".paper").appendChild(providersListContainer);

    providersListContainer.querySelector(".collapsible-header").addEventListener('click', (e) => {
        providersListContainer.querySelector(".collapsible-content").classList.toggle('hidden');
        providersListContainer.querySelector(".collapsible-header").classList.toggle('active');
    });

    const optgroup = document.createElement("optgroup");
    optgroup.label = framework.translate('Live Providers');
    Object.entries(window.providers).forEach(([name, _]) => {
        let option = document.createElement("option");
        option.value = name;
        option.dataset.live = "true";
        option.text = name;
        optgroup.appendChild(option);
    });
    providerSelect.appendChild(optgroup);

    let provider_options = [];
    api("providers").then(async (providers) => {
        await load_providers(providers, provider_options, providersListContainer);
        load_provider_models(appStorage.getItem("provider"));
    }).catch(async (e)=>{
        console.log(e)
        await load_provider_models(appStorage.getItem("provider"));
        await load_provider_login_urls(providersListContainer);
        await load_settings(provider_options);
    });

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
    hide_systemPrompt.addEventListener('change', async (event) => {
        update_systemPrompt_icon(event.target.checked);
    });
    const userInputHeight = appStorage.getItem("userInput-height");
    if (userInputHeight) {
        userInput.style.maxHeight = `${userInputHeight}px`;
    }
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

    const method = switchInput.checked ? "add" : "remove";
    searchButton.classList[method]("active");
    document.getElementById('recognition-language').placeholder = await get_recognition_language();
}

async function load_version() {
    let new_version = document.querySelector(".new_version");
    if (new_version) return;
    let text = "version ~ "
    api("version").then((versions)=>{
        window.title = 'G4F - ' + versions["version"];
        if (document.title == "G4F Chat") {
            document.title = window.title;
        }
        if (versions["latest_version"] && versions["version"] != versions["latest_version"]) {
            let release_url = 'https://github.com/xtekky/gpt4free/releases/latest';
            let title = `${framework.translate('New version:')} ${versions["latest_version"]}`;
            text += `<a href="${release_url}" target="_blank" title="${title}">${versions["version"]}</a> 🆕`;
            new_version = document.createElement("div");
            new_version.classList.add("new_version");
            const link = `<a href="${release_url}" target="_blank" title="${title}">v${versions["latest_version"]}</a>`;
            new_version.innerHTML = `G4F ${link}&nbsp;&nbsp;🆕`;
            new_version.addEventListener("click", ()=>new_version.parentElement.removeChild(new_version));
            document.body.appendChild(new_version);
        } else {
            text += versions["version"];
        }
        document.getElementById("version_text").innerHTML = text
    }).catch((e)=>{
        console.error("Error loading version:", e);
        fetch("https://api.github.com/repos/xtekky/gpt4free/releases/latest").then((response)=>response.json()).then((data)=>{
            document.getElementById("version_text").innerText = text + data.tag_name;
        });
    });
    setTimeout(load_version, 1000 * 60 * 60); // 1 hour
}

function renderMediaSelect() {
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
        if (file instanceof File && window.location.protocol == "https:") {
            const formData = new FormData();
            formData.append('files', file);
            const response = await fetch(framework.backendUrl + "/backend-api/v2/files/" + bucket_id, {
                method: 'POST',
                body: formData
            });
            const result = await response.json()
            if (result.media) {
                const media = [];
                result.media.forEach((part)=> {
                    part = part.name ? part : {name: part};
                    let url = framework.backendUrl ? framework.backendUrl : window.location.origin;
                    url = `${url}/files/${bucket_id}/media/${part.name}`;
                    delete image_storage[object_url];
                    object_url = url.replaceAll("/media/", "/thumbnail/");
                    image_storage[object_url] = {bucket_id: bucket_id, url: url, ...part};
                });
            }
        }
    });
}

imageInput.onclick = () => {
    mediaSelect.classList.toggle("hidden");
}

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

[imageSelect, cameraInput].forEach((el) => {
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

audioButton.addEventListener('click', async (event) => {
    const i = audioButton.querySelector("i");
    if (mediaRecorder) {
        i.classList.remove("fa-stop");
        i.classList.add("fa-microphone");
        mediaRecorder.stop();
        if(mediaRecorder.stream) {
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        if (mediaRecorder.wavBlob) {
            await add_conversation(window.conversation_id);
            provider = providerSelect.value;
            model = get_selected_model();
            if (provider == "Live") {
                model = "openai-audio";
            }
            await ask_gpt(get_message_id(), -1, false, provider, model, "next");
            mediaRecorder.wavBlob = null;
        }
        mediaRecorder = null;
        return;
    }

    i.classList.remove("fa-microphone");
    i.classList.add("fa-stop");

    stream = await navigator.mediaDevices.getUserMedia({
        audio: true
    });

    if (modelProvider.options[modelProvider.selectedIndex].dataset.audio) {
        mediaRecorder = new Recorder(stream);
        mediaRecorder.start();
        return;
    }

    if (!MediaRecorder.isTypeSupported('audio/webm')) {
        console.warn('audio/webm is not supported');
    }
    mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
    });
    
    mediaRecorder.addEventListener('dataavailable', async event => {
        const loadingIndicator = document.createElement('div');
        loadingIndicator.className = 'file-upload-loading';
        loadingIndicator.innerHTML = `
            <div class="upload-spinner"></div>
            <p>${framework.translate("Uploading audio...")}</p>
        `;
        document.body.appendChild(loadingIndicator);
        const formData = new FormData();
        formData.append('files', event.data);
        const bucket_id = generateUUID();
        const response = await fetch(framework.backendUrl + "/backend-api/v2/files/" + bucket_id, {
            method: 'POST',
            body: formData,
            headers: {
                "x-recognition-language": await get_recognition_language()
            }
        });
        document.body.removeChild(loadingIndicator);
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
    });

    mediaRecorder.start()
});

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

fileInput.addEventListener('click', async (event) => {
    fileInput.value = '';
});

cameraInput?.addEventListener("click", (e) => {
    if (window?.pywebview) {
        e.preventDefault();
        pywebview.api.take_picture();
    }
});

imageSelect?.addEventListener("click", (e) => {
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
    const bucket_id = generateUUID();
    paperclip.classList.add("blink");

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
        connectToSSE(`${framework.backendUrl}/backend-api/v2/files/${bucket_id}`, do_refine, bucket_id);
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
}

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
                        } else if (!localStorage.getItem(key)) {
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

function get_selected_model() {
    let model = null;
    if (modelSearch.value) {
        return modelSearch.value;
    } else if (modelProvider.selectedIndex >= 0) {
        model = modelProvider.options[modelProvider.selectedIndex];
    } else if (modelSelect.selectedIndex >= 0) {
        model = modelSelect.options[modelSelect.selectedIndex];
    }
    return model.value ? model.value : null;
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
        // if (providerModelSignal) {
        //     providerModelSignal.abort();
        // }
        // providerModelSignal = new AbortController();
        api_key = get_api_key_by_provider(args);
        if (api_key) {
            headers.x_api_key = api_key;
        }
        api_base = args == "Custom" ? document.getElementById(`${args}-api_base`).value : null;
        if (api_base) {
            headers.x_api_base = api_base;
        }
        const ignored = Array.from(settings.querySelectorAll("input.provider:not(:checked)")).map((el)=>el.value);
        if (ignored) {
            headers.x_ignored = ignored.join(" ");
        }
        url = `${framework.backendUrl}/backend-api/v2/${ressource}/${args}`;
        headers['content-type'] = 'application/json';
        response = await fetch(url, {
            method: 'GET',
            headers: headers,
            //signal: providerModelSignal.signal,
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
        response = await fetch(url, {
            method: 'POST',
            signal: controller_storage[message_id].signal,
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
            if (response.status == 524) {
                await api("conversation", args, files, message_id, finish_message)
            }
            await finish_message();
            return;
        }
    } else if (args) {
        if (ressource == "log" ||  ressource == "usage") {
            if (ressource == "log" && !document.getElementById("report_error").checked) {
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
    let buffer = ""
    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }
        for (const line of value.split("\n")) {
            if (!line) {
                continue;
            }
            try {
                add_message_chunk(JSON.parse(buffer + line), message_id, provider, finish_message);
                buffer = "";
            } catch {
                buffer += line
            }
        }
    }
}

function get_api_key_by_provider(provider) {
    let api_key = null;
    if (provider) {
        if (provider == "Azure" && framework.backendUrl != window.location.origin) {
            return api_key;
        }
        if (provider == "AnyProvider") {
            return {
                "PollinationsAI": appStorage.getItem("PollinationsAI-api_key"),
                "HuggingFace": appStorage.getItem("HuggingFace-api_key"),
                "Together": appStorage.getItem("Together-api_key"),
                "GeminiPro": appStorage.getItem("GeminiPro-api_key"),
                "OpenRouter": appStorage.getItem("OpenRouter-api_key"),
                "Groq": appStorage.getItem("Groq-api_key"),
                "DeepInfra": appStorage.getItem("DeepInfra-api_key"),
                "Replicate": appStorage.getItem("Replicate-api_key"),
                "PuterJS": appStorage.getItem("puter.auth.token"),
                "Azure": appStorage.getItem("Azure-api_key"),
            }
        }
        api_key = document.querySelector(`.${provider}-api_key`)?.id || null;
        if (api_key == null) {
            api_key = document.getElementById(`${provider}-api_key`)?.id || null;
        }
        if (api_key) {
            api_key = appStorage.getItem(api_key);
        }
        if (!api_key && provider.startsWith("Puter") && localStorage.getItem('puter.auth.token')) {
            return localStorage.getItem("puter.auth.token");
        }
    }
    return api_key;
}


async function load_provider_models(provider=null, search=null) {
    if (!provider) {
        provider = providerSelect.value;
    }
    modelSelect.classList.add("hidden");
    modelProvider.classList.remove("hidden");
    modelProvider.innerHTML = '';
    modelProvider.name = `model[${provider}]`;
    if (!provider) {
        modelProvider.classList.add("hidden");
        return;
    }
    if (await initClient()) {
        return;
    }
    function set_provider_models(models) {
        modelProvider.innerHTML = '';
        modelSelect.classList.add("hidden");
        let defaultIndex = 0;
        function add_options(group, models, search) {
            models.forEach((model, i) => {
                if (!model.models) {
                    let option = document.createElement('option');
                    option.value = model.model;
                    option.dataset.label = model.model;
                    option.text = model.label + (model.count > 1 ? ` (${model.count}+)` : "") + get_modelTags(model);
                    if (search && !option.text.includes(search)) {
                        return;
                    }
                    if (model.audio) {
                        option.dataset.audio = "true";
                    }
                    group.appendChild(option);
                    if (model.default) {
                        defaultIndex = i;
                    }
                } else {
                    let optgroup = document.createElement('optgroup');
                    optgroup.label = model.group;
                    add_options(optgroup, model.models, search);
                    if (optgroup.childElementCount == 0) {
                        return;
                    }
                    modelProvider.appendChild(optgroup);
                }
            });
        }
        if (Array.isArray(models)) {
            add_options(modelProvider, models, search);
            modelProvider.selectedIndex = defaultIndex;
        }
        const optgroup = document.createElement('optgroup');
        optgroup.label = "Favorites:";
        const favorites = JSON.parse(appStorage.getItem("favorites") || "{}");
        const selected = favorites[provider] || {};
        Object.keys(selected).forEach((key) => {
            const option = document.createElement('option');
            option.value = key;
            option.text = key;
            const value_option = modelProvider.querySelector(`option[value="${key}"]`)
            if (value_option) {
                option.text = value_option.text;
                option.dataset.audio = value_option.dataset.audio;
            }
            if (search && !option.text.includes(search)) {
                return;
            }
            if (optgroup.childElementCount > 0) {
                optgroup.appendChild(option);
                if (optgroup.childElementCount > 5) {
                    delete selected[optgroup.firstChild.value];
                    optgroup.removeChild(optgroup.firstChild);
                }
            }
        });
        favorites[provider] = selected;
        appStorage.setItem("favorites", JSON.stringify(favorites));
        optgroup.lastChild?.setAttribute("selected", "selected");
        modelProvider.appendChild(optgroup);
    }
    let models = appStorage.getItem(`${provider}:models`);
    if (models) {
        models = JSON.parse(models);
        set_provider_models(models);
    }
    models = await api('models', provider);
    if (models) {
        set_provider_models(models);
        appStorage.setItem(`${provider}:models`, JSON.stringify(models));
    }
};
providerSelect.addEventListener("change", () => load_provider_models());
modelProvider.addEventListener("change", () => {
    const favorites = appStorage.getItem("favorites") ? JSON.parse(appStorage.getItem("favorites")) : {};
    const selected = favorites[providerSelect.value] || {};
    if (!selected[modelProvider.value]) {
        let option = document.createElement('option');
        option.value = modelProvider.value;
        option.text = modelProvider.querySelector(`option[value="${modelProvider.value}"]`).text;
        option.selected = true;
        const optgroup = modelProvider.querySelector('optgroup:last-child');
        if (optgroup) {
            optgroup.appendChild(option);
            if (optgroup.childElementCount > 5) {
                delete selected[optgroup.firstChild.value];
                optgroup.removeChild(optgroup.firstChild);
            }
        }
    }
    const selected_values = selected[modelProvider.value] ? selected[modelProvider.value] + 1 : 1;
    delete selected[modelProvider.value];
    selected[modelProvider.value] = selected_values;
    favorites[providerSelect.value] = selected;
    appStorage.setItem("favorites", JSON.stringify(favorites));
});
document.getElementById("model_edit")?.addEventListener("click", () => {
    if (!modelSelector.classList.contains("hidden")) {
        providerSelect.classList.remove("hidden");
        modelProvider.classList.remove("hidden");
        modelSelector.classList.add("hidden");
        modelSearch.value = "";
        return;
    }
    providerSelect.classList.add("hidden");
    modelProvider.classList.add("hidden");
    modelSelector.classList.remove("hidden");
    modelSearch.focus()
});
modelSearch.addEventListener('input', function() {
  const searchTerm = this.value.toLowerCase();
  modelSuggestions.innerHTML = '';

  if (!searchTerm) return;

  let matches = [];
  
  // Search across all models
  for (const [provider, modelList] of Object.entries(searchModels)) {
    if (!Array.isArray(modelList)) continue;
    modelList.forEach(model => {
      if (model.models) {
        model.models.forEach(subModel => {
          if (subModel.model.toLowerCase().includes(searchTerm)) {
            matches.push({ provider, model: subModel });
          }
        });
      } else if (model.model.toLowerCase().includes(searchTerm)) {
        matches.push({ provider, model });
      }
    });
  }

  // Display matches
  matches.forEach(match => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    div.innerHTML = `
      <strong>${match.model.model}</strong>
      <span class="provider-tag">${match.provider}</span>
    `;
    div.addEventListener('click', async () => {
      modelSearch.value = "";
      providerSelect.value = match.provider;
      await load_provider_models();
      modelProvider.value = match.model.model;
      modelSelector.classList.add("hidden");
      providerSelect.classList.remove("hidden");
      modelProvider.classList.remove("hidden");
      modelSuggestions.innerHTML = '';
      console.log(`Selected model: ${match.model.model}`);
    });
    modelSuggestions.appendChild(div);
  });
});
function loadModels(providers) {
    providers.forEach((provider) => {
        searchModels[provider.name] = appStorage.getItem(`${provider.name}:models`);
        if (searchModels[provider.name]) {
            searchModels[provider.name] = JSON.parse(searchModels[provider.name]);
        }
    });
    cached = appStorage.getItem('models_cached');
    if (cached && Date.now() - cached < 1000 * 60 * 60 * 12) {
        return;
    }
    const loadNext = async () => {
        const provider = providers.pop();
        if (!provider.hf_space) {
            searchModels[provider.name] = await api('models', provider.name);
            if (searchModels[provider.name]) {
                appStorage.setItem(`${provider.name}:models`, JSON.stringify(searchModels[provider.name]));
            }
        }
        if (providers.length > 0) {
            setTimeout(() => {
                loadNext();
            }, 1000);
        } else {
            appStorage.setItem('models_cached', Date.now());
        }
    }
    setTimeout(loadNext, 1000);
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (e.target !== modelSearch) {
    modelSuggestions.innerHTML = '';
  }
});

document.getElementById("pin").addEventListener("click", async () => {
    const pin_container = document.getElementById("pin_container");
    let selected_provider = providerSelect.options[providerSelect.selectedIndex];
    selected_provider = selected_provider.value ? selected_provider : null;
    const selected_model = get_selected_model();
    add_pinned(selected_provider, selected_model);
});

(async () => {
    JSON.parse(appStorage.getItem("pinned") || "[]").forEach((el) => {
        add_pinned(el.provider, el.model, false);
    });
})();

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

switchInput.addEventListener("change", () => {
    const method = switchInput.checked ? "add" : "remove";
    searchButton.classList[method]("active");
});
searchButton.addEventListener("click", async () => {
    switchInput.click();
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
    let locale = navigator.language;
    if (!locale.includes("-")) {
        locale = appStorage.getItem(navigator.language);
        if (locale) {
            return locale;
        }
        const prompt = 'Response the full locale in JSON. Example: {"locale": "en-US"} Language: ' + navigator.language
        response = await fetch(`https://text.pollinations.ai/${encodeURIComponent(prompt)}?json=true`);
        locale = (await response.json()).locale || navigator.language;
        if (locale.includes("-")) {
            appStorage.setItem(navigator.language, locale);
        }
    }
    return locale;
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
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
            userInput.value = `${startValue ? startValue + "\n" : ""}${buffer}`;
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
            userInput.value = `${startValue ? startValue + "\n" : ""}${buffer}`;
            count_input();
            return true;
        }
        return false;
    }

    microLabel.addEventListener("click", async (e) => {
        if (!stopRecognition()) {
            microLabel.classList.add("recognition");
            recognition.lang = await get_recognition_language();
            recognition.start();
        }
    });
}

document.getElementById("showLog").addEventListener("click", ()=> {
    log_storage.classList.remove("hidden");
    settings.classList.add("hidden");
    log_storage.scrollTop = log_storage.scrollHeight;
});

// Mobile Experience Enhancements

// Create overlay element for sidebar
function createSidebarOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('shown');
    overlay.classList.remove('active');
  });
  document.body.appendChild(overlay);
  return overlay;
}

// Initialize mobile enhancements
function initMobileEnhancements() {
  const overlay = createSidebarOverlay();
  
  // Enhance sidebar toggle behavior
  sidebar_buttons.forEach((el) => {
    el.removeEventListener('click', null);
    el.addEventListener('click', () => {
      if (window.innerWidth < 640) {
        if (sidebar.classList.contains('shown')) {
          sidebar.classList.remove('shown');
          overlay.classList.remove('active');
        } else {
          sidebar.classList.add('shown');
          overlay.classList.add('active');
        }
      } else {
        // Desktop behavior remains the same
        if (sidebar.classList.contains('shown')) {
          sidebar.classList.remove('shown');
          sidebar.classList.add('minimized');
        } else {
          sidebar.classList.remove('minimized');
          sidebar.classList.add('shown');
        }
      }
    });
  });
  
  // Add swipe gesture support
  let touchStartX = 0;
  let touchEndX = 0;
  
  document.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });
  
  document.addEventListener('touchend', e => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipeGesture();
  }, { passive: true });
  
  function handleSwipeGesture() {
    const swipeThreshold = 100;
    
    // Right swipe (from left edge) - open sidebar
    if (touchEndX - touchStartX > swipeThreshold && touchStartX < 30) {
      sidebar.classList.add('shown');
      overlay.classList.add('active');
    }
    
    // Left swipe - close sidebar
    if (touchStartX - touchEndX > swipeThreshold && sidebar.classList.contains('shown')) {
      sidebar.classList.remove('shown');
      overlay.classList.remove('active');
    }
  }
  
  // Double tap to scroll to bottom
//   let lastTap = 0;
//   chatBody.addEventListener('touchend', e => {
//     const currentTime = new Date().getTime();
//     const tapLength = currentTime - lastTap;
    
//     if (tapLength < 300 && tapLength > 0) {
//       // Double tap detected
//       scroll_to_bottom();
//       e.preventDefault();
//     }
    
//     lastTap = currentTime;
//   });
  
  // Improve file input experience on mobile
  const fileLabels = document.querySelectorAll('.file-label');
  fileLabels.forEach(label => {
    label.addEventListener('touchstart', () => {
      label.classList.add('active-touch');
    });
    
    label.addEventListener('touchend', () => {
      setTimeout(() => {
        label.classList.remove('active-touch');
      }, 200);
    });
  });
}

// Call this function after the DOM is loaded
window.addEventListener('load', () => {
  if (window.matchMedia('(max-width: 640px)').matches || window.matchMedia('(pointer: coarse)').matches) {
    initMobileEnhancements();
  }
});

// Handle orientation changes
window.addEventListener('orientationchange', () => {
  // Adjust UI based on new orientation
  setTimeout(() => {
    document.querySelector(".container").style.maxHeight = window.innerHeight + "px";
    
    // Adjust media content display
    // adjustMediaContentForOrientation();
  }, 200);
});

// // Adaptive Media Content Display

// // Function to adjust media content based on screen size and orientation
// function adjustMediaContentForOrientation() {
//   const isLandscape = window.innerWidth > window.innerHeight;
//   const mediaElements = document.querySelectorAll('.message .content img, .message .content video');
  
//   mediaElements.forEach(media => {
//     // Reset styles first
//     media.style.maxWidth = '';
//     media.style.maxHeight = '';
    
//     // Get natural dimensions
//     const naturalWidth = media.naturalWidth || media.videoWidth || 400;
//     const naturalHeight = media.naturalHeight || media.videoHeight || 300;
//     const aspectRatio = naturalWidth / naturalHeight;
    
//     if (isLandscape) {
//       // In landscape, prioritize height
//       media.style.maxHeight = '70vh';
//       media.style.maxWidth = '90vw';
//     } else {
//       // In portrait, limit width more strictly
//       media.style.maxWidth = '95vw';
//       media.style.maxHeight = '50vh';
//     }
    
//     // Add special class for better display
//     media.classList.add('adaptive-media');
//   });
// }

// // Function to enhance image viewing experience
// function enhanceMobileImageViewing() {
//   // Improve image tap behavior
//   document.addEventListener('click', e => {
//     const target = e.target;
    
//     // Check if clicked element is an image in a message
//     if (target.tagName === 'IMG' && target.closest('.message')) {
//       // Don't apply to avatar images
//       if (target.alt === 'your avatar') return;
      
//       // Toggle fullscreen-like view
//       if (target.classList.contains('expanded-view')) {
//         target.classList.remove('expanded-view');
//       } else {
//         // Remove expanded view from any other images
//         document.querySelectorAll('.expanded-view').forEach(img => {
//           img.classList.remove('expanded-view');
//         });
        
//         target.classList.add('expanded-view');
//       }
//     } else if (!target.closest('img.expanded-view')) {
//       // Close expanded view when clicking elsewhere
//       document.querySelectorAll('.expanded-view').forEach(img => {
//         img.classList.remove('expanded-view');
//       });
//     }
//   });
// }

// // Register these functions to run after content is loaded
// function registerMediaEnhancements() {
//   // Run initially
//   adjustMediaContentForOrientation();
//   enhanceMobileImageViewing();
  
//   // Also run when new messages are added
//   const originalRegisterMessageImages = register_message_images;
//   register_message_images = function() {
//     originalRegisterMessageImages();
//     adjustMediaContentForOrientation();
//   };
  
//   // And when window is resized
//   window.addEventListener('resize', adjustMediaContentForOrientation);
// }

// Add this to the window load event
// window.addEventListener('load', registerMediaEnhancements);

// Mobile Experience Initialization

// Function to check if device is mobile
function isMobileDevice() {
  return window.matchMedia('(max-width: 640px)').matches || 
         window.matchMedia('(pointer: coarse)').matches;
}

// Function to apply mobile-specific enhancements
function applyMobileEnhancements() {
  // Add mobile class to body for CSS targeting
  document.body.classList.add('mobile-device');
  
  // Adjust height for mobile browsers (handles address bar)
  function setMobileHeight() {
    document.querySelector(".container").style.maxHeight = window.innerHeight + "px";
    document.querySelector(".container").style.height = window.innerHeight + "px";
  }
  
  setMobileHeight();
  window.addEventListener('resize', setMobileHeight);
  
  // Improve scroll behavior
  const chatBody = document.getElementById('chatBody');
  chatBody.style.overscrollBehavior = 'contain';
  
  // Enhance touch feedback for all interactive elements
  const touchElements = document.querySelectorAll('button, .file-label, .micro-label, select, .convo');
  touchElements.forEach(el => {
    el.addEventListener('touchstart', () => {
      el.classList.add('active-touch');
    }, { passive: true });
    
    el.addEventListener('touchend', () => {
      setTimeout(() => {
        el.classList.remove('active-touch');
      }, 200);
    }, { passive: true });
  });
  
  // Optimize input field behavior
  const userInput = document.getElementById('userInput');
  userInput.addEventListener('focus', () => {
    // Small delay to ensure keyboard is open
    setTimeout(() => {
      window.scrollTo(0, 0);
      document.body.scrollTop = 0;
    }, 300);
  });
  
  // Show/hide floating action button based on scroll position
  let lastScrollTop = 0;
  const floatingButton = document.querySelector('.new_convo_icon.mobile-only');
  if (floatingButton) {
    chatBody.addEventListener('scroll', () => {
      const st = chatBody.scrollTop;
      if (st > lastScrollTop && st > 100) {
        // Scrolling down - hide button
        floatingButton.style.transform = 'translateY(80px)';
      } else {
        // Scrolling up - show button
        floatingButton.style.transform = 'translateY(0)';
      }
      lastScrollTop = st;
    }, { passive: true });
  }
}

// Initialize mobile enhancements if on mobile device
document.addEventListener('DOMContentLoaded', () => {
  if (isMobileDevice()) {
    applyMobileEnhancements();
    initMobileEnhancements(); // From previous code
  }
  
  // Add CSS class based on orientation
  function updateOrientationClass() {
    if (window.innerWidth > window.innerHeight) {
      document.body.classList.add('landscape');
      document.body.classList.remove('portrait');
    } else {
      document.body.classList.add('portrait');
      document.body.classList.remove('landscape');
    }
  }
  
  updateOrientationClass();
  window.addEventListener('resize', updateOrientationClass);
  window.addEventListener('orientationchange', updateOrientationClass);
});

// Create drag-and-drop zones
function setupDragAndDrop() {
    const dropZone = document.createElement('div');
    dropZone.className = 'file-drop-zone hidden';
    dropZone.innerHTML = `
        <div class="file-drop-content">
            <i class="fa-solid fa-cloud-arrow-up"></i>
            <p>Drop files here to upload</p>
        </div>
    `;
    document.querySelector('.container').appendChild(dropZone);
    
    // Add CSS for drop zone
    const dropZoneStyles = document.createElement('style');
    dropZoneStyles.textContent = `
        .file-drop-zone {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            z-index: 2000;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        
        .file-drop-zone.active {
            opacity: 1;
            pointer-events: auto;
        }
        
        .file-drop-zone.drag-over {
            background-color: rgba(139, 61, 255, 0.3);
        }
        
        .file-drop-content {
            background-color: var(--blur-bg);
            border: 2px dashed var(--accent);
            border-radius: var(--border-radius-1);
            padding: 40px;
            text-align: center;
            color: var(--colour-3);
            max-width: 80%;
        }
        
        .file-drop-content i {
            font-size: 48px;
            margin-bottom: 20px;
            color: var(--accent);
        }
        
        .file-drop-content p {
            font-size: 18px;
            margin: 0;
        }
        
        /* Add highlight to chat area when dragging */
        .chat-body.drag-highlight {
            border: 2px dashed var(--accent);
            background-color: rgba(139, 61, 255, 0.1);
        }
    `;
    document.head.appendChild(dropZoneStyles);
    
    // Handle drag and drop events
    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('active');
        dropZone.classList.add('drag-over');
    };
    
    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
        
        // Check if the drag left the document
        const rect = dropZone.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        
        if (
            x < rect.left ||
            x >= rect.right ||
            y < rect.top ||
            y >= rect.bottom
        ) {
            dropZone.classList.remove('active');
        }
    };
    
    const handleDrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        dropZone.classList.remove('active');
        dropZone.classList.remove('drag-over');
        chatBody.classList.remove('drag-highlight');
        
        if (e.dataTransfer.files.length > 0) {
            // Handle image files
            const imageFiles = Array.from(e.dataTransfer.files).filter(file => 
                file.type.startsWith('image/')
            );
            
            if (imageFiles.length > 0) {
                imageFiles.forEach(file => {
                    image_storage[URL.createObjectURL(file)] = file;
                });
                renderMediaSelect();
                mediaSelect.classList.remove('hidden');
            }
            
            // Handle other files
            const otherFiles = Array.from(e.dataTransfer.files).filter(file => 
                !file.type.startsWith('image/')
            );
            
            if (otherFiles.length > 0) {
                // Create a new FileList-like object
                const dataTransfer = new DataTransfer();
                otherFiles.forEach(file => dataTransfer.items.add(file));
                
                // Set the files to the file input
                fileInput.files = dataTransfer.files;
                
                // Trigger the change event
                const event = new Event('change', { bubbles: true });
                fileInput.dispatchEvent(event);
            }
        }
    };
    
    // Add event listeners to document
    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('active');
        chatBody.classList.add('drag-highlight');
    });
    
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);
    
    // Add specific handling for chat body
    chatBody.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        chatBody.classList.add('drag-highlight');
    });
    
    chatBody.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        chatBody.classList.remove('drag-highlight');
    });
    
    // NEW: Add a click handler to hide the drop zone when clicked outside
    dropZone.addEventListener('click', (e) => {
        if (e.target === dropZone) {
            dropZone.classList.remove('active');
            dropZone.classList.remove('drag-over');
            chatBody.classList.remove('drag-highlight');
        }
    });
    
    // NEW: Add a global escape key handler to hide the drop zone
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            dropZone.classList.remove('active');
            dropZone.classList.remove('drag-over');
            chatBody.classList.remove('drag-highlight');
        }
    });
    
    // NEW: Force hide drop zone when window loses focus
    window.addEventListener('blur', () => {
        dropZone.classList.remove('active');
        dropZone.classList.remove('drag-over');
        chatBody.classList.remove('drag-highlight');
    });
    
    // NEW: Add a safety cleanup function that runs periodically
    setInterval(() => {
        // If no drag is happening but the zone is still active, hide it
        if (!document.querySelector('.drag-highlight') && dropZone.classList.contains('active')) {
            dropZone.classList.remove('active');
            dropZone.classList.remove('drag-over');
        }
    }, 2000);
}

// Initialize drag and drop
setupDragAndDrop();

// Enhance the existing file upload functionality
function enhanceFileUpload() {
    // Add visual feedback when files are being processed
    const originalUploadFiles = upload_files;
    upload_files = async function(fileInput) {
        // Show loading indicator
        const loadingIndicator = document.createElement('div');
        loadingIndicator.className = 'file-upload-loading';
        loadingIndicator.innerHTML = `
            <div class="upload-spinner"></div>
            <p>${framework.translate("Uploading files...")}</p>
        `;
        document.body.appendChild(loadingIndicator);
        
        try {
            await originalUploadFiles(fileInput);
        } finally {
            // Remove loading indicator
            document.body.removeChild(loadingIndicator);
        }
    };
    
    // Add CSS for loading indicator
    const loadingStyles = document.createElement('style');
    loadingStyles.textContent = `
        .file-upload-loading {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background-color: var(--blur-bg);
            border-radius: var(--border-radius-1);
            padding: 15px;
            display: flex;
            align-items: center;
            gap: 10px;
            z-index: 1000;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        }
        
        .upload-spinner {
            width: 20px;
            height: 20px;
            border: 2px solid var(--colour-3);
            border-top-color: var(--accent);
            border-radius: 50%;
            animation: spinner 0.8s linear infinite;
        }
        
        .file-upload-loading p {
            margin: 0;
            color: var(--colour-3);
        }
    `;
    document.head.appendChild(loadingStyles);
}

enhanceFileUpload();

function isLive() {
    return providerSelect.options[providerSelect.selectedIndex]?.dataset?.live;
}

async function initClient() {
    if (!isLive()) {
        client = null;
        return;
    }
    const provider = providerSelect.value;
    const apiKey = get_api_key_by_provider(provider);
    const options = apiKey ? { apiKey } : {};

    if (provider == "ApiAirforce") {
        options.baseUrl = "https://api.airforce/v1";
    } else if (provider == "AnonDrop") {
        options.baseUrl = "https://anondrop.net/v1";
    }

    if (!window.providers[provider]) {
        console.error(`No client class found for provider: ${provider}`);
        return;
    }

    client = new window.providers[provider](options);
    await loadClientModels();
    return true;
}

async function loadClientModels() {
    modelProvider.innerHTML = `<option disabled selected>${framework.translate("Loading...")}</option>`;
    try {
        const models = await client.models.list();
        modelProvider.innerHTML = '';
        models.forEach(model => {
            const opt = document.createElement('option');
            opt.value = model.id;
            opt.textContent = model.id + get_modelTags(model);
            // Store the model type (e.g., 'chat' or 'image') in a data attribute.
            if (model.type) {
                opt.dataset.type = model.type;
            }
            if (model.audio) {
                opt.dataset.audio = model.audio;
            }
            if (model.id === client.defaultModel) opt.selected = true;
            modelProvider.appendChild(opt);
        });
    } catch (err) {
        console.error('Model load failed:', err);
        modelProvider.innerHTML = "";
    }
}

// Import old conversations from localStorage into IndexedDB
async function import_from_localStorage() {
  const prefix = 'conversation:';
  const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix));

  for (const key of keys) {
    try {
      const json = localStorage.getItem(key);
      if (!json) continue;
      const conv = JSON.parse(json);
      // Use the id from conversation, if missing fallback to key after prefix
      conv.id = conv.id || key.substring(prefix.length);
      conv.updated = conv.updated || Date.now();
      await save_conversation(conv);
      localStorage.removeItem(key); // Optionally clear old storage
    } catch (e) {
      console.warn(`Skipping localStorage item ${key} due to error`, e);
    }
  }
}

import_from_localStorage();

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