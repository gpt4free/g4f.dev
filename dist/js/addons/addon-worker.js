/* ================================================================== *
 * Addon: Message Actions Worker
 *
 * Handles message action buttons including audio playback, regeneration, continuation, sharing, printing, and QR code generation.
 * ================================================================== */

addonsLoaded.then(() => {
    ChatAddons.register({
        id: 'builtin:message-worker',
        name: 'Message Actions Worker',
        version: '1.0.0',
        description: 'Handles message action buttons including audio playback, regeneration, continuation, sharing, printing, and QR code generation.',
        author: 'g4f',
        builtin: true,
        permissions: ['net:fetch', 'dom:query'],

        load() {
            return (async () => {})
        }
    });
});

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
            const provider_forms_container = document.querySelector(".provider_forms");
            provider_forms_container.querySelectorAll("form").forEach(form => form.classList.add("hidden"));
            const provider_form = provider_forms_container.querySelector(`#${sanitizeSelector(el.dataset.provider)}-form`);
            if (provider_form) {
                provider_form.classList.remove("hidden");
                provider_forms_container.classList.remove("hidden");
                chat.classList.add("hidden");
            }
            return false;
        });
    });

    chatBody.querySelectorAll(".message .fa-xmark, .message .delete-message").forEach(async (el) => {
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
            await safe_load_conversation(window.conversation_id);
        });
    });
    
    chatBody.querySelectorAll(".message .edit_button").forEach(async (el) => {
        if (el.dataset.click) {
            return
        }
        el.dataset.click = true;
        el.addEventListener("click", async () => {
            const message_el = get_message_el(el);
            if (!message_el || message_el.classList.contains("editing")) {
                return;
            }
            const content_inner = message_el.querySelector(".content_inner");
            if (!content_inner) {
                return;
            }
            const index = parseInt(message_el.dataset.index);
            const conversation = await get_conversation(window.conversation_id);
            if (!conversation || !conversation.items[index]) {
                return;
            }
            const item = conversation.items[index];
            if (Array.isArray(item.content)) {
                return;
            }

            // Enter edit mode
            message_el.classList.add("editing");
            const original_html = content_inner.innerHTML;
            const original_text = item.content;

            // Create edit UI
            content_inner.innerHTML = "";
            const textarea = document.createElement("textarea");
            textarea.className = "edit_textarea";
            textarea.value = original_text;
            textarea.rows = Math.max(3, Math.min(15, original_text.split("\n").length + 1));
            content_inner.appendChild(textarea);

            const button_container = document.createElement("div");
            button_container.className = "edit_buttons";
            const save_btn = document.createElement("button");
            save_btn.className = "edit_save_button";
            save_btn.innerHTML = `<i class="fa-solid fa-check"></i> ${framework.translate('Save')}`;
            const cancel_btn = document.createElement("button");
            cancel_btn.className = "edit_cancel_button";
            cancel_btn.innerHTML = `<i class="fa-solid fa-xmark"></i> ${framework.translate('Cancel')}`;
            button_container.appendChild(save_btn);
            button_container.appendChild(cancel_btn);
            content_inner.appendChild(button_container);

            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);

            // Cancel handler
            cancel_btn.addEventListener("click", () => {
                message_el.classList.remove("editing");
                content_inner.innerHTML = original_html;
            });

            // Save handler
            save_btn.addEventListener("click", async () => {
                const new_text = textarea.value.trim();
                if (!new_text || new_text === original_text) {
                    message_el.classList.remove("editing");
                    content_inner.innerHTML = original_html;
                    return;
                }

                // Update the message in conversation
                conversation.items[index].content = new_text;
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

                // Remove all messages after the edited one
                const new_items = conversation.items.slice(0, index + 1);
                conversation.items = new_items;
                await save_conversation(update_conversation(conversation));

                // Reload conversation and re-ask
                await load_conversation(conversation);
                await ask_gpt(get_message_id(), index);
            });

            // Ctrl+Enter to save, Escape to cancel
            textarea.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    save_btn.click();
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancel_btn.click();
                }
            });
        });
    });

    chatBody.querySelectorAll(".message .options_button div").forEach(async (el) => {
        if (el.dataset.click) {
            return
        }
        el.dataset.click = true;
        let message_el = get_message_el(el);
        const buttons = el.childNodes;
        const functions  = [
            async() => {
                iframe.src = 'qrcode.html' + (window.conversation_id ? `#${window.conversation_id}` : '');
                iframe_container.classList.remove("hidden");
            },
            async () => {
                const text = get_message_el(el).innerText;
                window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
            },
            async () => {
                let audio;
                if (message_el.dataset.synthesize_url) {
                    el.classList.add("active");
                    if (message_el.dataset.synthesize_url.startsWith("https://g4f.space/ai/audio/")) {
                        const response = await fetch(message_el.dataset.synthesize_url, {
                            headers: appStorage.getItem("g4f_session") ? {
                                'Authorization': `Bearer ${appStorage.getItem("g4f_session")}`
                            } : {}
                        });
                        window.captureUserTierHeaders?.(response.headers);
                        const object = await response.blob();
                        message_el.dataset.synthesize_url = URL.createObjectURL(object);
                    }
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
            },
            async () => {
                el.classList.add("clicked");
                chatBody.scrollTop = 0;
                message_el.classList.add("print");
                setTimeout(() => {
                    el.classList.remove("clicked");
                    message_el.classList.remove("print");
                }, 1000);
                window.print()
            },
            async () => {
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
            },
            async () => {
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
                const startText = el.innerText;
                if (startText) {
                    el.innerText = framework.translate("Copied")
                    setTimeout(() => el.innerText = startText, 1000);
                }
            }
        ]
        let x = 0;
        for (let i = 0; i < buttons.length; i++) {
            if (buttons[i].nodeName !== "SPAN") {
                continue;
            }
            const el = buttons[i];
            el.addEventListener("click", functions[x]);
            x++;
        }
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

export default {
    register_message_buttons
};