/* ================================================================== *
 * Addon: Conversation Management
 *
 * Handles conversation creation, deletion, loading, and management.
 * ================================================================== */

(function () {
    'use strict';

    ChatAddons.register({
        id: 'builtin:conversations',
        name: 'Conversation Management',
        version: '1.0.0',
        description: 'Handles conversation creation, deletion, loading, and management.',
        author: 'g4f',
        builtin: true,
        permissions: ['storage:local', 'dom:write', 'dom:query'],

        load() {
            return (async () => {
            async function scroll_to_bottom() {
                if (document.body.classList.contains("screen-reader")) {
                    return; // Skip enhancements for screen readers
                }
                window.scrollTo(0, 0);
                chatBody.scrollTop = chatBody.scrollHeight;
            }

            let autoScrollEnabled = true;

            chatBody.addEventListener('scroll', () => {
                const atBottom = chatBody.scrollTop + chatBody.clientHeight >= chatBody.scrollHeight - 40;
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
            function sanitizeSelector(input) {
                return input.replace(/([ #;?%&,.+*~\':"!^$[\]()=>|\/@])/g, '-');
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

            const load_conversation = async (conversation, append = false) => {
                console.log("Loading conversation...", conversation ? conversation.id : "new", append ? "(append)" : "");
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

                if (!append) {
                    chatBody.innerHTML = "";
                }

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
                    let provider_link = item.provider?.name ? `<a href="${item.provider.modelUrl || item.provider.url || ('#' + item.provider.name) || ''}" target="_blank">${provider_label}</a>` : "";
                    let provider = provider_link ? `
                        <div class="provider" data-provider="${item.provider.name}">
                            ${provider_link}
                            ${item.provider.model ? ' ' + framework.translate('with') + ' ' + (item.provider.modelLabel || item.provider.model) : ''}
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
                        if (!framework.backendUrl || appStorage.getItem("voice")) {
                            // synthesize_params = (new URLSearchParams({input: filter_message(text), voice: appStorage.getItem("voice") || "alloy"})).toString();
                            // synthesize_url = `https://www.openai.fm/api/generate?${synthesize_params}`;
                            synthesize_url = `https://g4f.space/ai/audio/${encodeURIComponent(filter_message(text))}?voice=${encodeURIComponent(appStorage.getItem("voice") || "alloy")}`;
                        } else {
                            if (item.synthesize) {
                                synthesize_params = item.synthesize.data
                                synthesize_provider = item.synthesize.provider;
                            } else {
                                synthesize_params = {text: filter_message(text)}
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

                    if (document.body.classList.contains("screen-reader")) {
                        add_buttons.push(`
                            <div role="group" aria-label="Message controls">
                                <button class="delete-message" aria-label="Delete message">Delete Message</button>
                                <button class="volume-high" aria-label="Play audio" aria-pressed="false" title="Play audio">Play Audio</button>
                                <button class="copy-to-clipboard" aria-label="Copy message to clipboard">Copy</button>
                            </div>
                        `);
                    } else {
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
                    }

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

                    const messageElement = `
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
                                    ${renderer(buffer)}
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
                    `;
                    const letter = document.createElement("div");
                    letter.innerHTML = messageElement;
                    chatBody.appendChild(letter.firstElementChild);
                });

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

                if (suggestions && suggestions.length > 0) {
                    try {
                            if (!Array.isArray(suggestions)) {
                            suggestions = [suggestions];
                        }
                        suggestions_el = document.createElement("div");
                        suggestions_el.classList.add("suggestions");
                        suggestions.forEach((suggestion)=> {
                            if (!suggestion || suggestion == "answer_guess") {
                                return;
                            }
                            const el = document.createElement("button");
                            el.classList.add("suggestion");
                            el.innerHTML = `<span>${framework.escape(suggestion)}</span> <i class="fa-solid fa-turn-up"></i>`;
                            el.onclick = async () => {
                                suggestions = null;
                                suggestions_el = chatBody.querySelector('.suggestions');
                                suggestions_el ? suggestions_el.remove() : null;
                                await handle_ask(true, suggestion);
                            }
                            suggestions_el.appendChild(el);
                        });
                        chatBody.querySelectorAll('.suggestions').forEach((suggestions_el) => suggestions_el.remove());
                        chatBody.appendChild(suggestions_el);
                    } catch (e) {
                        add_error("Error showing suggestions:", e);
                    }
                } else if (countTokensEnabled && window.GPTTokenizer_o200k_base) {
                    try {
                        let total_tokens = 0;
                        for (const msg of messages) {
                            if (msg.usage) {
                                total_tokens = msg.usage.total_tokens || msg.usage.prompt_tokens + msg.usage.completion_tokens;
                            }
                        }
                        console.debug("Total tokens from usage:", total_tokens);
                        let filtered = prepare_messages(messages, null, true, false);
                        filtered = filtered.filter((item)=>!Array.isArray(item.content) && item.content);
                        if (filtered.length > 0 || total_tokens > 0) {
                            let count_total = total_tokens || GPTTokenizer_o200k_base.encodeChat(filtered, "gpt-5").length
                            if (count_total > 0) {
                                const count_total_el = document.createElement("div");
                                count_total_el.classList.add("count_total");
                                count_total_el.innerText = framework.translate("{0} total tokens").replace("{0}", count_total);
                                chatBody.appendChild(count_total_el);
                            }
                        }
                    } catch (e) {
                        add_error("Error counting tokens:", e);
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
            })();
        },
    });
})();
