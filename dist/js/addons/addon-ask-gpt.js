/* ================================================================== *
 * Addon: Ask GPT
 *
 * Core ask_gpt implementation for sending prompts to providers and handling responses.
 * ================================================================== */

(function () {
    'use strict';

    ChatAddons.register({
        id: 'builtin:ask-gpt',
        name: 'Ask GPT',
        version: '1.0.0',
        description: 'Core ask_gpt implementation for sending prompts to providers and handling responses.',
        author: 'g4f',
        builtin: true,
        permissions: ['net:fetch', 'dom:write', 'dom:query'],

        load() {
            return (async () => {})
        }
    })
})();

async function add_message_chunk(message, message_id, provider, finish_message=null) {
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

const ask_gpt = async (message_id, message_index = -1, regenerate = false, provider = null, model = null, action = null, message = null) => {
    console.debug("ask_gpt called with message_id:", message_id, "message_index:", message_index, "regenerate:", regenerate, "provider:", provider, "model:", model, "action:", action, "message:", message);
    if (!model && !provider) {
        model = get_selected_model();
        provider = providerSelect?.value;
    }
    const selectedOption = modelSelect.options[modelSelect.selectedIndex];
    const modelType = selectedOption?.dataset.type || 'chat';
    const is_youtube = provider == "YouTube";
    let conversation = await get_conversation(window.conversation_id);
    if (!conversation) {
        return;
    }
    await requestWakeLock();
    let messages = prepare_messages(conversation.items, is_youtube ? -1 : message_index, action=="continue" || is_youtube);
    message_storage[message_id] = "";
    stop_generating.classList.remove("stop_generating-hidden");

    chatBody.querySelectorAll('.suggestions').forEach((suggestions_el) => suggestions_el.remove());
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
        const parent_message = chatBody.querySelector(`.message[data-index="${message_index}"]`);
        if (!parent_message) {
            return;
        }
        parent_message.after(message_el);
    }

    let content_el = message_el.querySelector('.content');
    const content_map = content_storage[message_id] = {
        container: message_el,
        content: content_el,
        inner: content_el.querySelector('.content_inner'),
        count: content_el.querySelector('.count'),
        message_index: message_index,
    }
    async function finish_message() {
        let final_message  = null;
        // Handle tool calls if any
        if (tool_calls_storage[message_id] && mcpClient) {
            const tool_calls = Object.values(tool_calls_storage[message_id]);
            delete tool_calls_storage[message_id];
            await handleToolCalls(tool_calls, messages, model, provider, message_id, finish_message);
            // Remove spinner/loading indicator after tool call is handled
            if (content_storage[message_id] && content_storage[message_id].inner) {
                let spinner = content_storage[message_id].inner.querySelector('.tool-call-spinner');
                if (spinner) spinner.remove();
            }
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
                regenerate = conversation.items[conversation.items.length-1]?.role != "user";
            }
            // Create final message content
            final_message = message_storage[message_id]
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
            delete reasoning_storage[message_id];
            delete synthesize_storage[message_id];
            delete title_storage[message_id];
            delete finish_storage[message_id];
            if (variant_storage[message_id]) {
                message_index = await add_message(
                    window.conversation_id,
                    "assistant",
                    variant_storage[message_id],
                    {...message_provider, modelLabel: message_provider.variantLabel, modelUrl: message_provider.variantUrl},
                    message_index,
                    null,
                    true
                );
                delete variant_storage[message_id];
            }
            // Send usage to the server
            if ((!framework.logUrl && isLive()) || !usage_storage[message_id] || !usage_storage[message_id].prompt_tokens) {
                usage = {
                    model: message_provider?.model,
                    provider: message_provider?.name,
                    label: message_provider?.label,
                    ...usage
                };
                const user = appStorage.getItem("user");
                if (user) {
                    usage = {user: user, ...usage};
                }
                api("usage", usage);
            }
            delete usage_storage[message_id];
        }
        // Update controller storage
        if (controller_storage[message_id]) {
            delete controller_storage[message_id];
        }
        // Reload conversation if no error
        if (message_storage[message_id] && !document.body.classList.contains("screen-reader")) {
            try {
                if(await safe_load_conversation(window.conversation_id)) {
                    // Play last message async
                    if(!await play_last_message(content_data_storage[message_id])) {
                        if (action === "next" && final_message) {
                            load_follow_up_questions(messages, final_message);
                        }
                    }
                    delete content_data_storage[message_id];
                    if (window.client) {
                        loadClientModels();
                    } else {
                        refreshModels(providerSelect?.value);
                    }
                }
            } catch (e) {
                add_error("Failed to load the conversation:", e);
            }
        }
        delete message_storage[message_id];
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
    if (window.client && modelType === "chat") {
        for (const file of Object.values(image_storage)) {
            media.push({
                "type": "image_url",
                "image_url": {
                    "url": await toUrl(file)
                }
            });
        }
        // Helper function to solve bucket content
        const solveBucketContent = async (item) => {
            if (item.type) {
                return item;
            }
            // Check if this is a media bucket (has url with /media/ path)
            if (item.bucket_id && item.url && item.url.includes('/media/')) {
                // Always pass media as image_url for the backend to resolve
                return {
                    type: "image_url",
                    image_url: {
                        url: item.url
                    }
                };
            }
            // Check if this is a text bucket (has bucket_id but no media url)
            if (item.bucket_id && !item.text) {
                // Fetch plain text content from backend
                try {
                    const response = await fetch(`${framework.backendUrl}/backend-api/v2/files/${item.bucket_id}`);
                    if (response.ok) {
                        const text = await response.text();
                        return {
                            type: "text",
                            text: text
                        };
                    }
                } catch (e) {
                    console.error("Failed to fetch bucket content:", e);
                }
                return null;
            }
            // Regular text content
            return {
                type: "text",
                text: item.text || ""
            };
        };
        // Process messages with async bucket resolution
        messages = await Promise.all(messages.map(async (message) => {
            if (Array.isArray(message.content)) {
                const resolvedContent = await Promise.all(message.content.map(solveBucketContent));
                return {
                    role: message.role,
                    content: resolvedContent.filter(item => item !== null)
                };
            }
            return {
                role: message.role,
                content: message.content
            };
        }));
    }
    if (messages.length > 0) {
        const last_message = messages[messages.length - 1];
        if (!message) {
            message = last_message?.content;
        }
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
    let lastValue = "";
    requestAnimationFrame(function update() {
        if (!(message_id in message_storage)) {
            return;
        } else if (message_storage[message_id] != lastValue) {
            content_storage[message_id].inner.innerHTML = renderer(message_storage[message_id]);
            highlight(content_storage[message_id].inner);
            lastValue = message_storage[message_id];
            // Auto-scroll if enabled
            if (autoScrollEnabled) {
                chatBody.scrollTop = chatBody.scrollHeight;
            }
        }
        requestAnimationFrame(update);
    });
    if (window.client) {
        const providerSelectOption = providerSelect.options[providerSelect.selectedIndex];
        const selectedModel = get_selected_model() || window.client.defaultModel;
        const modelSeed = selectedOption?.dataset.seed;
        let providerLabel = providerSelectOption?.dataset.label || provider;
        const isAudio = selectedOption?.dataset.audio == "true";
        try {
            // Conditionally call the correct client method based on model type.
            if (['image', 'image-edit', 'video'].includes(modelType)) {
                const method = ['image', 'video'].includes(modelType) ? 'generate' : 'edit';
                // Handle image generation
                const image = image_storage ? Object.values(image_storage)[0] : null;
                const isAutomaticOrientation = appStorage.getItem("automaticOrientation") != "false";
                const imageHeight = isAutomaticOrientation ? (window.innerHeight > window.innerWidth ? 832 : 480) : undefined;
                const imageWidth = isAutomaticOrientation ? (window.innerHeight > window.innerWidth ? 480 : 832) : undefined;
                const response = await window.client.images[method]({
                    model: selectedModel,
                    prompt: message,
                    ...(modelSeed && regenerate ? { seed: Math.floor(Date.now() / 1000) } : {}),
                    ...(!modelSeed ? { response_format: 'b64_json' } : {}),
                    ...(image && image.url ? { image: image.url } : {}),
                    height: imageHeight,
                    width: imageWidth,
                });
                if (!response.data) {
                    throw new Error(framework.translate("No image URL returned from the API."));
                }
                if (response.usage) {
                    add_message_chunk({type: "usage", usage: response.usage}, message_id);
                }
                response.data.forEach(img => {
                    if (img.b64_json) {
                        const mimeType = modelType === 'video' ? 'video/mp4' : 'image/png';
                        img.url = `data:${mimeType};base64,${img.b64_json}`;
                    }
                    if (modelType === 'video') {
                        message_storage[message_id] += `<video controls src="${img.url}"></video>`;
                    } else {
                        message_storage[message_id] += `[![${sanitize(message, ' ')}](${img.url})](${img.url.startsWith('data:') ? '' : img.url})`
                    }
                });
            } else if (isAudio) {
                // Handle audio generation
                const response = await window.client.chat.completions.create({
                    model: selectedModel,
                    messages,
                });
                message_storage[message_id] = response.choices[0].message.content;
                if (response.usage) {
                    add_message_chunk({type: "usage", usage: response.usage}, message_id);
                }
                if (response.choices && response.choices[0].message.audio) {
                    const audio = response.choices[0].message.audio;
                    message_storage[message_id] = `<audio controls></audio>\n\n\n${audio.transcript}`;
                    content_data_storage[message_id] = `data:audio/mpeg;base64,${audio.data}`;
                }
            } else {
                if (framework.backendUrl && searchButton.classList.contains("active") && provider != "CachedSearch") {
                    let query = message.split(":");
                    query = query.length > 1 ? query[1].trim() : message;
                    query = query.split("\n")[0].trim();
                    const searchUrl = `${framework.backendUrl}/backend-api/v2/create?provider=CachedSearch&prompt=${encodeURIComponent(query)}`;
                    const response = await fetch(searchUrl);
                    if (response.ok) {
                        const result = await response.text();
                        if (result) {
                            const new_message = `<details><summary>${framework.translate("Web search:")} ${query}</summary>\n\n\n${result}</details>`;
                            await add_message(window.conversation_id, "user", new_message);
                            await safe_load_conversation(window.conversation_id);
                            messages = messages.slice(0, -1).concat([{role: "user", content: new_message}, messages.slice(-1)[0]]);
                        }
                    }
                }

                controller_storage[message_id] = new AbortController();

                // Get MCP tools if available
                const mcpTools = mcpClient && mcpClient.selectedTools.length > 0 
                    ? mcpClient.getSelectedToolsForAPI() 
                    : undefined;

                // Handle chat completion (existing logic)
                const body = {
                    model: selectedModel,
                    messages,
                    stream: true,
                    signal: controller_storage[message_id].signal,
                    ...(mcpTools && mcpTools.length > 0 ? { tools: mcpTools } : {}),
                    ...(conversation.data ? { conversation: conversation.data[provider] } : {}),
                    ...getExtraBody(provider)
                };
                const response = await window.client.chat.completions.create(body);

                add_message_chunk({type: "provider", provider: {name: provider, model: selectedModel, label: providerLabel}}, message_id);

                if (!body.stream) {
                    if (response.usage) {
                        add_message_chunk({type: "usage", usage: response.usage}, message_id);
                    }
                    if (response.model) {
                        let provider;
                        if (window.client.id) {
                            provider = window.client.id;
                        } else if (response.server && response.provider) {
                            provider = `custom:${response.server}`;
                        } else if (response.provider) {
                            provider = response.provider || provider;
                        }
                        add_message_chunk({type: "provider", provider: {name: provider, model: response.model, label: response.provider, server: response.server}}, message_id);
                    }
                    if (response.error) {
                        add_message_chunk({type: "error", ...response.error}, message_id, null, finish_message);
                        return;
                    }
                    if (response.conversation) {
                        const conversation = await get_conversation(window.conversation_id);
                        if (!conversation.data) {
                            conversation.data = {};
                        }
                        conversation.data[provider] = response.conversation;
                        await save_conversation(update_conversation(conversation));
                    }
                    if (response.choices) {
                        const choice = response.choices[0];
                        if (choice.reasoning || choice.reasoning_content) {
                            await add_message_chunk({type: "reasoning", token: choice.reasoning || choice.reasoning_content}, message_id);
                        }
                        if (choice.content) {
                            await add_message_chunk({type: "content", content: choice.content}, message_id);
                        }
                    }
                    await finish_message();
                    return;
                }

                let hasModel = false;
                let sources = null;

                for await (const chunk of response) {
                    if (chunk.usage) {
                        add_message_chunk({type: "usage", usage: chunk.usage}, message_id);
                    }
                    if (chunk.model && !hasModel) {
                        hasModel = true;
                        if (window.client.id) {
                            provider = window.client.id;
                        }
                        if (chunk.server && chunk.provider) {
                            provider = `custom:${chunk.server}`;
                            providerLabel = chunk.provider;
                        } else if (chunk.provider) {
                            provider = chunk.provider || provider;
                        }
                        add_message_chunk({type: "provider", provider: {name: provider, model: chunk.model, label: providerLabel, server: chunk.server}}, message_id);
                    }
                    if (chunk.error) {
                        add_message_chunk({type: "error", ...chunk.error}, message_id, null, finish_message);
                        return;
                    }
                    if (chunk.conversation) {
                        const conversation = await get_conversation(window.conversation_id);
                        if (!conversation.data) {
                            conversation.data = {};
                        }
                        conversation.data[provider] = chunk.conversation;
                        await save_conversation(update_conversation(conversation));
                    }
                    if (chunk.choices) {
                        const choice = chunk.choices[0];
                        if (choice?.groundingMetadata?.groundingChunks) {
                            sources = choice.groundingMetadata;
                        }
                        // Handle tool calls
                        if (choice?.delta?.tool_calls) {
                            await add_message_chunk({type: "tool_calls", tool_calls: choice.delta.tool_calls}, message_id);
                        }
                        if (choice?.delta?.reasoning || choice?.delta?.reasoning_content) {
                            await add_message_chunk({type: "reasoning", token: choice.delta.reasoning || choice.delta.reasoning_content}, message_id);
                        }
                        if (choice?.delta?.content) {
                            const delta = choice?.delta?.content || '';
                            await add_message_chunk({type: "content", content: delta}, message_id);
                        }
                    }
                    if (chunk.citations) {
                        sources = {citations: chunk.citations};
                    }
                    if (chunk.type == "sources") {
                        sources = {sources: chunk.data};
                    } else if (chunk.type == "followups") {
                        suggestions = chunk.data;
                    }
                }
                if (sources) {
                    add_sources(sources, message_id);
                }
                if (tool_calls_storage[message_id] && mcpClient) {
                    const toolCalls = Object.values(tool_calls_storage[message_id]);
                    delete tool_calls_storage[message_id];
                    await handleToolCalls(toolCalls, messages, selectedModel, provider, message_id, finish_message);
                }
            }
        } catch (err) {
            add_error(err, true);
            safe_remove_cancel_button();
            error_storage[message_id] = `${err.message || err}`;
            content_map.inner.innerHTML += framework.markdown(`${framework.translate('**An error occurred:**')} ${error_storage[message_id]}`);
        } finally {
            await finish_message();
        }
        return;
    }
    console.debug("Sending request to backend API for provider:", provider, "model:", model, "message_id:", message_id);
    try {
        const apiKey = get_api_key_by_provider(provider);
        const downloadMedia = document.getElementById("download_media")?.checked;
        let apiBase;
        if (provider == "Custom") {
            apiBase = appStorage.getItem("Custom-api_base");
        }
        const ignored = Array.from(settings.querySelectorAll("input.provider:not(:checked)")).map((el)=>el.value);
        const extraBody = getExtraBody(provider);
        const isAutomaticOrientation = appStorage.getItem("automaticOrientation") != "false";
        const aspectRatio = isAutomaticOrientation ? (window.innerHeight > window.innerWidth ? "9:16" : "16:9") : null;
        let conversationData = null;
        if (provider == "AnyProvider") {
            conversationData = conversation.data;
        } else if (provider && conversation.data && provider in conversation.data) {
            conversationData = conversation.data[provider];
        }
        controller_storage[message_id] = new AbortController();
        // Get MCP tools if available
        const mcpTools = mcpClient && mcpClient.selectedTools.length > 0 
            ? mcpClient.getSelectedToolsForAPI() 
            : undefined;
        console.debug("Request body for API call:", {
            id: message_id,
            conversation_id: window.conversation_id,
        });
        await api("conversation", {
            id: message_id,
            conversation_id: window.conversation_id,
            conversation: conversationData,
            model: model,
            web_search: searchButton.classList.contains("active"),
            provider: provider,
            messages: messages,
            prompt: ["image", "image-edit", "video"].includes(modelType) ? message : null,
            action: action,
            download_media: downloadMedia,
            debug_mode: appStorage.getItem("debugMode") == "true",
            api_key: apiKey,
            base_url: apiBase,
            ignored: ignored,
            aspect_ratio: aspectRatio,
            ...(mcpTools && mcpTools.length > 0 ? { tools: mcpTools } : {}),
            ...extraBody
        }, Object.values(image_storage), message_id, finish_message);
    } catch (e) {
        add_error(e, true);
    }
};

export default {
    //ask_gpt,
    //play_last_message,
    //requestWakeLock,
};
