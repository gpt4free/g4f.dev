/* ------------------------------------------------------------------ *
 * Chat Addon Host Bridge — the trusted surface addons talk to.        *
 * Loaded from chat.v1.js core (slim section).                         *
 *                                                                     *
 * Every capability granted to an addon is implemented here, scoped    *
 * and namespaced so a malicious .pa.js addon cannot reach the raw     *
 * window/document/fetch surfaces.                                     *
 * ------------------------------------------------------------------ */

(function (global) {
    'use strict';

    const host = {
        // ---- state ----------------------------------------------------
        getState() {
            const state = global.__chatAddonState || {};
            return {
                conversation_id: state.conversation_id ?? global.conversation_id ?? null,
                provider: state.provider ?? null,
                model: state.model ?? null,
                settings: state.settings ?? null,
            };
        },
        setState(patch) {
            if (!global.__chatAddonState) global.__chatAddonState = {};
            Object.assign(global.__chatAddonState, patch || {});
        },

        // ---- UI --------------------------------------------------------
        notify(message, type = 'info', duration = 2500) {
            if (typeof global.showToast === 'function') {
                return global.showToast(message, type, duration);
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
            if (typeof global.mcpClient !== 'undefined' && typeof global.mcpClient.getAllTools === 'function') {
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
                 let result = await mcpClient.executeToolCalls(toolCalls);
                 console.log('[addons] workspace addon listing raw result:', result);
                 result = result.map(result => {
                    console.log('[addons] workspace addon listing result:', result);
                    try {
                        const data = JSON.parse(result.content);
                        const r = (data.matches || []);
                        console.log('[addons] workspace addon listing parsed:', r);
                        return r;
                    } catch (e) {
                        console.warn('[addons] failed to parse workspace addon listing:', e);
                        return [];
                    }
                })
                
                return result.flat();
            }
        },
        readWorkspaceFile(file) {
            const first = mcpClient.servers.find(s => s.enabled) || mcpClient.servers[0];
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
            if (!global.__chatAddonRenderHooks) global.__chatAddonRenderHooks = [];
            global.__chatAddonRenderHooks.push({ addonId, cb });
        },
        emitMessageRender(ctx) {
            const hooks = global.__chatAddonRenderHooks || [];
            for (const h of hooks) {
                try { h.cb(ctx); } catch (e) { console.error(`[addons] render hook "${h.addonId}" failed`, e); }
            }
        },
    };

    global.ChatAddonHost = host;

    // Boot addons as early as possible. The built-in addon files each run
    // synchronously at script-eval time and only register; their load()
    // bodies are synchronous too, so the globals they expose (workerFetch,
    // appStorage, showToast, generateUUID, ...) are available before
    // chat.v1.js's own DOMContentLoaded handler runs. We therefore boot
    // immediately rather than waiting for DOMContentLoaded here — any
    // DOM work inside addons defers itself.
    if (typeof global.ChatAddons?.boot === 'function') {
        global.ChatAddons.boot().then(() => global.ChatAddons.enableAll());
    }
})(window);

export default { ChatAddonHost };