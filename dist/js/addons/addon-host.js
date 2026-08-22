/* ------------------------------------------------------------------ *
 * Chat Addon Host Bridge — the trusted surface addons talk to.        *
 * Loaded from chat.v1.js core (slim section).                         *
 *                                                                     *
 * Every capability granted to an addon is implemented here, scoped    *
 * and namespaced so a malicious .pa.js addon cannot reach the raw     *
 * window/document/fetch surfaces.                                     *
 * ------------------------------------------------------------------ */

const host = {
    // ---- state ----------------------------------------------------
    getState() {
        const state = window.__chatAddonState || {};
        return {
            conversation_id: state.conversation_id ?? window.conversation_id ?? null,
            provider: state.provider ?? null,
            model: state.model ?? null,
            settings: state.settings ?? null,
        };
    },
    setState(patch) {
        if (!window.__chatAddonState) window.__chatAddonState = {};
        Object.assign(window.__chatAddonState, patch || {});
    },

    // ---- UI --------------------------------------------------------
    notify(message, type = 'info', duration = 2500) {
        if (typeof window.showToast === 'function') {
            return window.showToast(message, type, duration);
        }
        return false;
    },

    // ---- DOM (read) ------------------------------------------------
    query(selector) {
        try {
            const el = document.querySelector(selector);
            if (!el) return null;
            // Return a read-only snapshot-ish handle.
            return {
                exists: true,
                text: el.textContent || '',
                html: el.innerHTML || '',
                value: el.value ?? undefined,
                attrs: Object.fromEntries([...el.attributes].map(a => [a.name, a.value])),
            };
        } catch (e) {
            console.error('[addons] query failed', e);
            return null;
        }
    },

    // ---- DOM (write) ------------------------------------------------
    toggleClass(selector, cls, force) {
        try {
            const el = document.querySelector(selector);
            if (el) el.classList.toggle(cls, force);
            return !!el;
        } catch (e) { return false; }
    },
    setStyle(selector, prop, value) {
        try {
            const el = document.querySelector(selector);
            if (el) el.style[prop] = value;
            return !!el;
        } catch (e) { return false; }
    },

    // ---- storage (namespaced) ---------------------------------------
    storage: (() => {
        const NS = 'chat.addons.data.';
        return {
            get(key) { try { return localStorage.getItem(NS + key); } catch (e) { return null; } },
            set(key, value) { try { localStorage.setItem(NS + key, String(value)); } catch (e) {} },
            remove(key) { try { localStorage.removeItem(NS + key); } catch (e) {} },
            getJSON(key) { try { return JSON.parse(localStorage.getItem(NS + key)); } catch (e) { return null; } },
            setJSON(key, value) { try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch (e) {} },
        };
    })(),

    // ---- workspace (.pa.js) -----------------------------------------
    async listWorkspaceAddons() {
        if (typeof window.mcpClient !== 'undefined' && typeof window.mcpClient.getAllTools === 'function') {
            try {
                // Ensure the MCP tool list is loaded before executing tool
                // calls. fetchAllTools() populates mcpClient.tools; without
                // it executeToolCall throws "Tool file_search_glob not found"
                // and the workspace (.pa.js) addon scan silently dies.
                if (typeof window.mcpClient.fetchAllTools === 'function') {
                    await window.mcpClient.fetchAllTools();
                }
                const allTools = window.mcpClient.getAllTools();
                if (!allTools.some(t => t.name === 'file_search_glob')) {
                    console.warn('[addons] file_search_glob tool not available on any MCP server; skipping workspace addon scan');
                    return [];
                }
                const toolCalls = [{
                    id: `file_search_${Date.now()}`,
                    function: {
                        name: 'file_search_glob',
                        arguments: {
                            recursive: true,
                            max_results: 100,
                            query: '**/*.pa.js',
                        }
                    }
                }, {
                    id: `file_search_${Date.now()}`,
                    function: {
                        name: 'file_search_glob',
                        arguments: {
                            recursive: true,
                            max_results: 100,
                            query: '**/pa-*.js',
                        }
                    }
                }];
                let result = await window.mcpClient.executeToolCalls(toolCalls);
                result = result.map(result => {
                    try {
                        const data = JSON.parse(result.content);
                        return (data.matches || []);
                    } catch (e) {
                        console.warn('[addons] failed to parse workspace addon listing:', e);
                        return [];
                    }
                });

                return result.flat();
            } catch (e) {
                console.warn('[addons] workspace addon scan failed:', e);
                return [];
            }
        }
        return [];
    },
    readWorkspaceFile(file) {
        const client = window.mcpClient;
        if (!client || !Array.isArray(client.servers) || !client.servers.length) {
            return Promise.reject(new Error('No MCP server configured'));
        }
        const first = client.servers.find(s => s.enabled) || client.servers[0];
        const backendUrl = first.url.replace(/\/mcp$/, '');
        const safe = String(file).replace(/^\/+/, '').replace(/\.\./g, '');
        const url = `${backendUrl}/pa/files/${safe}`;
        return fetch(url, { headers: { 'Accept': 'text/plain' } })
            .then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.text();
            });
    },

    // ---- render hooks ----------------------------------------------
    onMessageRender(addonId, cb) {
        if (!window.__chatAddonRenderHooks) window.__chatAddonRenderHooks = [];
        window.__chatAddonRenderHooks.push({ addonId, cb });
    },
    emitMessageRender(ctx) {
        const hooks = window.__chatAddonRenderHooks || [];
        for (const h of hooks) {
            try { h.cb(ctx); } catch (e) { console.error(`[addons] render hook "${h.addonId}" failed`, e); }
        }
    },

    // ---- sidebar panel (addon features & options) --------------------
    // Addons register buttons/options into the sidebar "addon panel"
    // (`#addon-panel` in v2.html). Each entry is a plain button; the
    // addon supplies a label, an optional FontAwesome icon and a click
    // handler. Entries are sorted by `order` (default 100).
    sidebar: (() => {
        const items = new Map();
        let panelEl = null;

        function getPanel() {
            if (panelEl && panelEl.isConnected) return panelEl;
            panelEl = document.getElementById('addon-panel');
            return panelEl;
        }

        function render() {
            const panel = getPanel();
            if (!panel) return;
            const sorted = [...items.values()].sort((a, b) =>
                (a.order ?? 100) - (b.order ?? 100));
            panel.textContent = '';
            for (const item of sorted) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.id = item.id;
                btn.title = item.title || item.label || item.id;
                btn.className = 'addon-panel-item';
                if (item.ariaLabel) btn.setAttribute('aria-label', item.ariaLabel);
                if (item.icon) {
                    const i = document.createElement('i');
                    i.className = item.icon;
                    i.setAttribute('aria-hidden', 'true');
                    btn.appendChild(i);
                }
                const span = document.createElement('span');
                span.textContent = item.label || item.title || item.id;
                btn.appendChild(span);
                if (item.badge != null) {
                    const badge = document.createElement('span');
                    badge.className = 'addon-panel-badge';
                    badge.textContent = item.badge;
                    btn.appendChild(badge);
                }
                if (typeof item.onClick === 'function') {
                    btn.addEventListener('click', () => {
                        try { item.onClick(); } catch (e) {
                            console.error(`[addons] sidebar item "${item.id}" failed`, e);
                        }
                    });
                }
                panel.appendChild(btn);
            }
        }

        return {
            register(item) {
                if (!item || !item.id) return false;
                items.set(item.id, item);
                render();
                return true;
            },
            unregister(id) {
                if (!items.delete(id)) return false;
                render();
                return true;
            },
            has(id) { return items.has(id); },
            list() { return [...items.keys()]; },
            clear() { items.clear(); render(); },
            // Force a re-render (e.g. after the panel element appears).
            refresh: render,
            // Convenience accessor for the panel element itself.
            getPanel,
        };
    })(),
};

addonsLoaded.then(() => {
    ChatAddons.boot().then(() => ChatAddons.enableAll());
});

export default { ChatAddonHost: host };