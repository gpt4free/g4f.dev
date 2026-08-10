/* ================================================================== *
 * Addon: Ask Action
 *
 * Prepares messages and initiates ask flow for selected models.
 * ================================================================== */

(function () {
    'use strict';

    ChatAddons.register({
        id: 'builtin:ask',
        name: 'Ask Action',
        version: '1.0.0',
        description: 'Prepares messages and initiates ask flow for selected models.',
        author: 'g4f',
        builtin: true,
        permissions: ['dom:query'],

        load() {
            return (async () => {
            const handle_ask = async (do_ask_gpt = true, message = null) => {
                await scroll_to_bottom();

                if (!message) {
                    message = userInput.value;
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
                    connectToSSE(`${framework.backendUrl}/backend-api/v2/files/${bucket_id}/stream`, false, bucket_id); //Retrieve and refine
                    return;
                }
                if (!Array.isArray(message)) {
                    message = message.trim();
                    if (!message.length) {
                        return;
                    }
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
                        ${renderer(message)}
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
                    await safe_load_conversation(window.conversation_id);
                    await load_conversations();
                }
            };
            })();
        },
    });
})();
