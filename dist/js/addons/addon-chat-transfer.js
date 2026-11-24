/* ================================================================== *
 * Addon: Chat transfer (import / export / account tracking)
 *
 * - Imports ChatGPT, Claude and Google Takeout (Gemini Apps, Google AI,
 *   Google Search) exports, plus conversations tracked by the g4f
 *   browser extension.
 * - Exports conversations as g4f JSON, ChatGPT-style conversations.json
 *   or Markdown.
 * - Every source is opt-in: nothing is imported or tracked unless the
 *   user enabled it (stored as `transfer_optin_<source>`).
 * ================================================================== */

const TRANSFER_SOURCES = {
    chatgpt: "ChatGPT",
    claude: "Claude",
    gemini: "Gemini",
    google_ai: "Google AI",
    google_search: "Google Search",
};

const TRANSFER_TRACK_KEY = "transfer_track_accounts";

function transfer_optin(source) {
    return appStorage.getItem(`transfer_optin_${source}`) === "true";
}

function transfer_set_optin(source, value) {
    appStorage.setItem(`transfer_optin_${source}`, value ? "true" : "false");
}

function transfer_tracking_enabled() {
    return appStorage.getItem(TRANSFER_TRACK_KEY) !== "false";
}

function _text(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(_text).filter(Boolean).join("\n");
    if (typeof value === "object") {
        if (value.parts) return _text(value.parts);
        if (value.text) return _text(value.text);
        if (value.content) return _text(value.content);
        return "";
    }
    return String(value);
}

function _htmlToText(html) {
    const doc = new DOMParser().parseFromString(html || "", "text/html");
    doc.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    doc.querySelectorAll("p, li, div").forEach((el) => el.append("\n"));
    return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

function _title(text, fallback) {
    const line = (text || "").split("\n").find((l) => l.trim()) || fallback;
    return line.trim().slice(0, 80);
}

function _conversation(source, id, title, items, created, updated) {
    const added = created || Date.now();
    return {
        id: `${source}:${id}`,
        title: title || _title(items[0]?.content, TRANSFER_SOURCES[source]),
        added,
        updated: updated || added,
        system: "",
        items,
        imported_from: source,
    };
}

// ChatGPT: conversations.json (a tree per conversation, walk back from current_node)
function parse_chatgpt(data) {
    const result = [];
    for (const conv of data) {
        const mapping = conv.mapping || {};
        const chain = [];
        let node = conv.current_node || Object.keys(mapping).find((k) => !(mapping[k].children || []).length);
        const seen = new Set();
        while (node && mapping[node] && !seen.has(node)) {
            seen.add(node);
            chain.unshift(mapping[node]);
            node = mapping[node].parent;
        }
        const items = [];
        for (const entry of chain) {
            const message = entry.message;
            const role = message?.author?.role;
            if (!message || !["user", "assistant"].includes(role) || message.metadata?.is_visually_hidden_from_conversation) continue;
            const content = _text(message.content).trim();
            if (!content) continue;
            const item = {role, content};
            if (message.metadata?.model_slug && role === "assistant") item.model = message.metadata.model_slug;
            items.push(item);
        }
        if (items.length) {
            result.push(_conversation("chatgpt", conv.conversation_id || conv.id, conv.title,
                items, (conv.create_time || 0) * 1000, (conv.update_time || 0) * 1000));
        }
    }
    return result;
}

function parse_claude(data) {
    const result = [];
    for (const conv of data) {
        const items = (conv.chat_messages || []).map((m) => ({
            role: m.sender === "human" ? "user" : "assistant",
            content: (m.text || _text(m.content)).trim(),
        })).filter((m) => m.content);
        if (items.length) {
            result.push(_conversation("claude", conv.uuid, conv.name, items,
                Date.parse(conv.created_at), Date.parse(conv.updated_at)));
        }
    }
    return result;
}

// Google Takeout "My Activity" entries: one prompt/answer pair per entry.
function _activitySource(entry) {
    const header = `${entry.header || ""} ${(entry.products || []).join(" ")}`.toLowerCase();
    if (header.includes("gemini") || header.includes("bard")) return "gemini";
    if (header.includes("search")) {
        const url = entry.titleUrl || "";
        return /udm=50|ai.?mode|ai.?overview/i.test(`${url} ${header}`) ? "google_ai" : "google_search";
    }
    if (header.includes("ai")) return "google_ai";
    return null;
}

function parse_google_activity(data, allowed) {
    const groups = {};
    for (const entry of data) {
        const source = _activitySource(entry);
        if (!source || !allowed(source)) continue;
        const title = (entry.title || "").replace(/^(Prompted|Searched for|Asked)\s+/i, "").trim();
        if (!title) continue;
        const answer = (entry.safeHtmlItem || []).map((i) => _htmlToText(i.html)).filter(Boolean).join("\n\n");
        const time = Date.parse(entry.time) || Date.now();
        const day = new Date(time).toISOString().slice(0, 10);
        const key = `${source}:${day}`;
        (groups[key] ||= {source, day, time, items: []}).items.push({role: "user", content: title});
        if (answer) groups[key].items.push({role: "assistant", content: answer});
        groups[key].time = Math.min(groups[key].time, time);
    }
    return Object.values(groups).map((g) => {
        g.items.reverse();
        // Takeout lists newest first; keep prompts before their answers.
        const items = [];
        for (let i = 0; i < g.items.length; i++) {
            if (g.items[i].role === "assistant" && g.items[i + 1]?.role === "user") {
                items.push(g.items[i + 1], g.items[i]);
                i++;
            } else {
                items.push(g.items[i]);
            }
        }
        return _conversation(g.source, g.day, `${TRANSFER_SOURCES[g.source]} ${g.day}`, items, g.time);
    });
}

// Conversations tracked by the browser extension.
function parse_tracked(data, allowed) {
    return data.filter((c) =>
        TRANSFER_SOURCES[c.source] && allowed(c.source) &&
        Array.isArray(c.messages) && c.messages.length)
        .map((c) => _conversation(c.source, c.id, c.title,
            c.messages.map((m) => ({role: m.role, content: m.content})).filter((m) => m.content),
            c.created, c.updated));
}

function detect_chat_format(data) {
    const list = Array.isArray(data) ? data : data?.conversations;
    if (!Array.isArray(list) || !list.length) return null;
    const first = list[0] || {};
    if (first.mapping) return "chatgpt";
    if (first.chat_messages) return "claude";
    if (first.messages && first.source) return "tracked";
    if (first.header || first.safeHtmlItem || (first.title && first.time && first.products)) return "activity";
    return null;
}

/**
 * Import external chat data. `allowed(source)` decides per source
 * (default: the opt-in setting). Returns {count, skipped}.
 */
async function import_external_chats(data, allowed = transfer_optin) {
    const format = detect_chat_format(data);
    if (!format) return null;
    const list = Array.isArray(data) ? data : data.conversations;
    let conversations = [];
    if (format === "chatgpt") conversations = allowed("chatgpt") ? parse_chatgpt(list) : [];
    else if (format === "claude") conversations = allowed("claude") ? parse_claude(list) : [];
    else if (format === "tracked") conversations = parse_tracked(list, allowed);
    else conversations = parse_google_activity(list, allowed);
    let count = 0;
    for (const conversation of conversations) {
        const existing = await get_conversation(conversation.id);
        if (existing && (existing.updated || 0) >= conversation.updated && existing.items?.length >= conversation.items.length) continue;
        await save_conversation(conversation);
        count += 1;
    }
    if (count && typeof load_conversations === "function") await load_conversations();
    return {format, count, skipped: list.length - conversations.length};
}

// Export ---------------------------------------------------------------

function _download(content, filename, type) {
    const blob = new Blob([content], {type});
    const elem = document.createElement("a");
    elem.href = URL.createObjectURL(blob);
    elem.download = filename;
    document.body.appendChild(elem);
    elem.click();
    document.body.removeChild(elem);
    setTimeout(() => URL.revokeObjectURL(elem.href), 1000);
}

function _toChatGPT(conversation) {
    const mapping = {"root": {id: "root", message: null, parent: null, children: []}};
    let parent = "root";
    conversation.items.forEach((item, index) => {
        if (!["user", "assistant", "system"].includes(item.role)) return;
        const id = `msg-${index}`;
        mapping[id] = {
            id, parent, children: [],
            message: {
                id, author: {role: item.role},
                create_time: (conversation.updated || conversation.added || Date.now()) / 1000,
                content: {content_type: "text", parts: [_text(item.content)]},
                metadata: item.model ? {model_slug: item.model} : {},
            },
        };
        mapping[parent].children.push(id);
        parent = id;
    });
    return {
        id: conversation.id, conversation_id: conversation.id,
        title: conversation.title,
        create_time: (conversation.added || Date.now()) / 1000,
        update_time: (conversation.updated || conversation.added || Date.now()) / 1000,
        mapping, current_node: parent,
    };
}

function _toMarkdown(conversation) {
    const body = conversation.items
        .map((i) => `**${i.role === "user" ? "User" : i.role === "assistant" ? "Assistant" : i.role}:**\n\n${_text(i.content)}`)
        .join("\n\n---\n\n");
    return `# ${conversation.title || "Conversation"}\n\n${body}\n`;
}

async function export_conversations(format = "g4f", conversationId = null) {
    let conversations = await list_conversations();
    if (conversationId) conversations = conversations.filter((c) => c.id === conversationId);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "chatgpt") {
        _download(JSON.stringify(conversations.map(_toChatGPT), null, 2), `conversations ${stamp}.json`, "application/json");
    } else if (format === "markdown") {
        _download(conversations.map(_toMarkdown).join("\n\n"), `chats ${stamp}.md`, "text/markdown");
    } else {
        return save_storage();
    }
}

// Extension bridge ------------------------------------------------------
// The g4f browser extension posts tracked conversations to this page.
window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const msg = event.data;
    if (msg?.type === "g4f-tracked-chats-ready") {
        const status = document.getElementById("transfer-status");
        if (status) status.textContent = "Automatic saving enabled. No new tracked chats.";
        return;
    }
    if (msg?.type === "g4f-tracked-chats-ack") {
        const status = document.getElementById("transfer-status");
        if (status) {
            status.textContent = msg.count
                ? `Automatically imported ${msg.count} conversation${msg.count === 1 ? "" : "s"}.`
                : "Automatic sync is up to date.";
        }
        return;
    }
    if (msg?.type !== "g4f-tracked-chats" || !transfer_tracking_enabled()) return;
    const result = await import_external_chats(msg.conversations || [], () => true);
    window.postMessage({type: "g4f-tracked-chats-ack", count: result?.count || 0, ids: (msg.conversations || []).map((c) => c.id)}, window.location.origin);
});
if (transfer_tracking_enabled()) {
    window.postMessage({type: "g4f-tracked-chats-request"}, window.location.origin);
}

// UI --------------------------------------------------------------------

function open_chat_transfer() {
    document.getElementById("chat-transfer-dialog")?.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "chat-transfer-dialog";
    dialog.className = "chat-transfer-dialog";
    dialog.setAttribute("aria-labelledby", "chat-transfer-title");
    const rows = Object.entries(TRANSFER_SOURCES).map(([key, label]) =>
        `<label class="chat-transfer-source">
            <input type="checkbox" data-source="${key}" ${transfer_optin(key) ? "checked" : ""}>
            <span class="chat-transfer-source-mark" aria-hidden="true">${label.slice(0, 1)}</span>
            <span>${label}</span>
        </label>`).join("");
    dialog.innerHTML = `
        <div class="chat-transfer-header">
            <div>
                <h2 id="chat-transfer-title">Import / Export chats</h2>
                <p>Bring conversations from other assistants into this browser.</p>
            </div>
            <button type="button" class="chat-transfer-close" id="transfer-close" aria-label="Close">×</button>
        </div>
        <section class="chat-transfer-section">
            <div class="chat-transfer-section-heading">
                <h3>Import sources</h3>
                <span>Manual files</span>
            </div>
            <p class="chat-transfer-help">Choose which sources may be read from an imported ChatGPT, Claude or Google Takeout file.</p>
            <div class="chat-transfer-source-grid">${rows}</div>
        </section>
        <label class="chat-transfer-auto">
            <input type="checkbox" id="transfer-track" ${transfer_tracking_enabled() ? "checked" : ""}>
            <span>
                <strong>Automatically save extension-tracked chats</strong>
                <small>Sources enabled in the g4f browser extension are saved to local chat history without file imports.</small>
            </span>
        </label>
        <section class="chat-transfer-section">
            <div class="chat-transfer-section-heading">
                <h3>Import a file</h3>
            </div>
            <button type="button" class="chat-transfer-primary" id="transfer-import">Choose JSON file…</button>
            <input type="file" id="transfer-file" accept=".json,application/json" hidden>
        </section>
        <section class="chat-transfer-section">
            <div class="chat-transfer-section-heading">
                <h3>Export chats</h3>
            </div>
            <div class="chat-transfer-export-grid">
                <button type="button" data-export="g4f"><strong>g4f JSON</strong><span>Chats and settings backup</span></button>
                <button type="button" data-export="chatgpt"><strong>ChatGPT JSON</strong><span>Conversations only</span></button>
                <button type="button" data-export="markdown"><strong>Markdown</strong><span>Readable text files</span></button>
            </div>
        </section>
        <p class="chat-transfer-status" id="transfer-status" aria-live="polite"></p>`;
    document.body.appendChild(dialog);
    const status = dialog.querySelector("#transfer-status");
    dialog.querySelectorAll("input[data-source]").forEach((box) =>
        box.addEventListener("change", () => transfer_set_optin(box.dataset.source, box.checked)));
    dialog.querySelector("#transfer-track").addEventListener("change", (e) => {
        appStorage.setItem(TRANSFER_TRACK_KEY, e.target.checked ? "true" : "false");
        status.textContent = e.target.checked
            ? "Automatic saving enabled."
            : "Automatic saving disabled.";
        if (e.target.checked) {
            window.postMessage({type: "g4f-tracked-chats-request"}, window.location.origin);
        }
    });
    const file = dialog.querySelector("#transfer-file");
    dialog.querySelector("#transfer-import").addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
        try {
            const data = JSON.parse(await file.files[0].text());
            const result = await import_external_chats(data);
            status.textContent = result
                ? `Imported ${result.count} conversations (${result.format}); ${result.skipped} skipped (source not enabled or empty).`
                : "Unrecognized file format.";
        } catch (e) {
            status.textContent = `Import failed: ${e.message}`;
        }
        file.value = "";
    });
    dialog.querySelectorAll("button[data-export]").forEach((btn) =>
        btn.addEventListener("click", () => export_conversations(btn.dataset.export)));
    dialog.querySelector("#transfer-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
}

export default {
    TRANSFER_SOURCES,
    transfer_optin,
    transfer_tracking_enabled,
    detect_chat_format,
    import_external_chats,
    export_conversations,
    open_chat_transfer,
};
