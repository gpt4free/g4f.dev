/* ================================================================== *
 * Addon: Message Management
 *
 * Handles message rendering, chunking, sources, and sanitization.
 * ================================================================== */

(function () {
    'use strict';

    ChatAddons.register({
        id: 'builtin:messages',
        name: 'Message Management',
        version: '1.0.0',
        description: 'Handles message rendering, chunking, sources, and sanitization.',
        author: 'g4f',
        builtin: true,
        permissions: ['dom:write', 'dom:query'],

        load() {
            return (async () => {})
        }
    });
})();
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
    let last_steps_messages = [];
    if (document.getElementById('globalPrompt')?.value) {
        last_steps_messages.push({
            "role": "system",
            "content": document.getElementById('globalPrompt').value
        });
    }
    if (chatPrompt?.value) {
        last_steps_messages.push({
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
                last_steps_messages.push(new_message)
            } else if (!do_filter) {
                last_steps_messages.push(new_message)
            }
        }
    });

    // Remove multiple assistant messages
    let has_assistant = false;
    let final_messages = [];
    for (let new_message of last_steps_messages.reverse()) {
        if (new_message.role == "assistant") {
            if (has_assistant) {
                continue;
            }
            has_assistant = true;
        }
        final_messages.push(new_message);
    }
    final_messages = final_messages.reverse();

    console.debug("Final messages:", final_messages)

    return final_messages;
}

async function load_provider_parameters(provider) {
    console.debug("Load provider parameters:", provider);
    let form_id = `${sanitizeSelector(provider)}-form`;
    if (!parameters_storage[provider]) {
        parameters_storage[provider] = JSON.parse(appStorage.getItem(form_id));
    }
    if (!parameters_storage[provider]) {
        parameters_storage[provider] = {"provider": provider, "model": "", "messages": [{"role": "system", "content": ""}, {"role": "user", "content": ""}], "stream": true, "timeout": 0, "response_format": {"type": "json_object"}, "max_tokens": 4096, "stop": ["stop1", "stop2"], "media": [["data:image/jpeg;base64,...", "filename.jpg"]], "temperature": 1, "presence_penalty": 1, "top_p": 1, "frequency_penalty": 1}
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
                    max =  key === "n" ? 10 : value == 42 || value >= 4096 ? 8192 : value >= 100 ? 4096 : value > 1 ? 100 : value === 0 ? 600 : 2;
                    step = value >= 1024 ? 8 : value > 1 ? 1 : value > 0 ? 0.1 : 1;
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
    console.debug("Message chunk received:", message);
    const content_map = content_storage[message_id];
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
        content_map.inner.innerHTML += framework.markdown(`${framework.translate('**An error occurred:**')} ${message.message}`);

        // Show error popup with partner hints for auth errors
        await showErrorPopup(message.message);

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
        const error_message = message.message || message.error;
        error_storage[message_id] = error_message;
        console.error(error_message);
        content_map.inner.innerHTML += framework.markdown(`${framework.translate('**An error occurred:**')} ${error_message}`);

        // Show error popup with partner hints
        await showErrorPopup(error_message);

        if (finish_message) {
            await finish_message();
        }
        let p = document.createElement("p");
        p.innerText = error_message;
        logContent?.appendChild(p);
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
            content_map.inner.innerHTML = framework.markdown(message.preview + ' <span class="cursor"></span>');
            await register_message_images();
        }
    } else if (message.type == "content") {
        if (message.content) {
            if (!message_storage[message_id]) {
                content_map.inner.innerHTML = '<pre><span class="cursor"></span><pre><br>';
                content_map.innerPre = content_map.inner.querySelector("pre");
            }
            message_storage[message_id] += message.content;
            if (message.data) {
                content_data_storage[message_id] = message.data;
            }
        }
        if (message.urls) {
            content_alt_storage[message_id] = message.alt;
            const div = document.createElement("div");
            div.innerHTML = framework.markdown(message.content);
            content_map.inner.appendChild(div);
            let cursorDiv = content_map.inner.querySelector(".cursor");
            if (cursorDiv) cursorDiv.parentNode.removeChild(cursorDiv);
        }
    } else if (message.type == "log") {
        let p = document.createElement("p");
        p.innerText = message.log;
        logContent?.appendChild(p);
    } else if (message.type == "synthesize") {
        synthesize_storage[message_id] = message.synthesize;
    } else if (message.type == "title") {
        title_storage[message_id] = message.title;
    } else if (message.type == "login") {
        content_map.inner.innerHTML = framework.markdown(message.login + ' <span class="cursor"></span>');
    } else if (message.type == "finish") {
        finish_storage[message_id] = message.finish;
    } else if (message.type == "variant") {
        variant_storage[message_id] = message.variant;
    } else if (message.type == "continue") {
        continue_storage[message_id] = message;
    } else if (message.type == "usage") {
        usage_storage[message_id] = message.usage;
        if (headers_storage[message_id]) {
            window.captureUserTierHeaders?.(new Headers(headers_storage[message_id]), message.usage);
            delete headers_storage[message_id];
        }
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
        if (message.status || message.token || message.label) {
            const reasoning_body = content_map.inner;
            reasoning_body.innerHTML = render_reasoning(reasoning_storage[message_id]);
            if (autoScrollEnabled) {
                chatBody.scrollTop = chatBody.scrollHeight;
            }
        }
    } else if (message.type == "parameters") {
        if (!parameters_storage[provider]) {
            parameters_storage[provider] = {};
        }
        Object.entries(message.parameters).forEach(([key, value]) => {
            parameters_storage[provider][key] = value;
        });
    } else if (message.type == "suggestions") {
        suggestions = message.suggestions;
    } else if (message.type == "tool_calls") {
        // Handle tool calls and show spinner
        if (message.tool_calls) {
            if (!tool_calls_storage[message_id]) {
                tool_calls_storage[message_id] = {};
            }
            window.mergeToolCalls?.(tool_calls_storage[message_id], message.tool_calls);
            // Show spinner/loading indicator in the message
            if (content_storage[message_id] && content_storage[message_id].inner) {
                let spinner = content_storage[message_id].inner.querySelector('.tool-call-spinner');
                if (!spinner) {
                    spinner = document.createElement('div');
                    spinner.className = 'tool-call-spinner';
                    spinner.innerHTML = `<span>${framework.translate('Waiting for tool response...')}</span>`;
                    content_storage[message_id].inner.appendChild(spinner);
                }
            }
        }
    } else if (["request", "response"].includes(message.type)) {
        debug_response_counter[message_id] = (debug_response_counter[message_id] || 0) + (message.type == "response" ? 1 : 0);
        logRequestResponse(message, message_id, debug_response_counter[message_id]);
    } else if (message.type == "headers") {
        headers_storage[message_id] = message.headers;
    } 
}

function add_sources(data, message_id) {
    console.debug("Adding sources for message", message_id, data);
    const blockquote = document.createElement("blockquote");
    if (data.webSearchQueries) {
        suggestions = data.webSearchQueries;
    }
    if (data.groundingChunks) {
        const links = data.groundingChunks.map((chunk, index) => {
            return `<p>[${index}] <a target="_blank" href="${chunk.web.uri}">${chunk.web.title}</a></p>`;
        }).join("");
        blockquote.innerHTML = links;
    }
    if (data.citations) {
        const links = data.citations.map((citation, index) => {
            return `<p>[${index+1}] <a target="_blank" href="${citation}">${citation.replace("https://www.", "").replace("https://", "")}</a></p>`;
        }).join("");
        blockquote.innerHTML = links;
    }
    if (data.sources) {
        const links = data.sources.map((source, index) => {
            return `<p>[${index}] <a target="_blank" href="${source.link || source.url}">${source.title || source.name}</a></p>`;
        }).join("");
        blockquote.innerHTML = links;
    }
    if (blockquote.innerHTML) {
        message_storage[message_id] += blockquote.outerHTML;
        content_storage[message_id].inner.innerHTML += blockquote.outerHTML;
    }
}

function renderer(text) {
    if (appStorage.getItem("renderMarkdown") == "false") {
        return `<pre>${framework.escape(text)}</pre>`;
    }
    return framework.markdown(text);
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
    const last_content = last_message ? last_message.querySelector(".content_inner") : null;
    const last_media = last_message ? last_content.querySelector("audio, iframe, img") : null;
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
        } else if (last_media.tagName == "AUDIO") {
            if (response) {
                if (response.choices && response.choices[0].message?.audio?.data) {
                    response = `data:audio/mpeg;base64,${response.choices[0].message.audio.data}`;
                }
                last_media.src = response;
            }
            last_media.play();
        } else {
            // width = last_media.parentElement.dataset.width || last_media.naturalWidth;
            // height = last_media.parentElement.dataset.height || last_media.naturalHeight;
            // if (width > 0 && height > 0) {
            //     last_message.querySelector(".count").childNodes[0].nodeValue = `(width: ${width}px, height: ${height}px)`;
            // }
        }
        return true;
    }
    return false;
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

export default {
    prepare_messages,
    load_provider_parameters,
    //add_message_chunk,
    add_sources,
    renderer,
    is_stopped,
    requestWakeLock,
    play_last_message,
    toBase64,
    toUrl,
    getExtraBody,
};