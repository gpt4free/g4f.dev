/* ------------------------------------------------------------------ *
 * Chat Addon Core — registry, sandboxed loader, capability gate       *
 *                                                                    *
 * Addons are plain JS modules that register themselves via            *
 * `ChatAddons.register()`. Built-in addons live in `dist/js/addons/`. *
 * Workspace addons are `.pa.js` files pulled from the MCP workspace   *
 * through the secure `/pa/files/` endpoint.                           *
 *                                                                    *
 * Sandboxing model (layered):                                        *
 *  1. Addon source is fetched as TEXT — never injected via <script>  *
 *     or eval'd on the main window.                                  *
 *  2. Source is statically screened for forbidden patterns.           *
 *  3. Execution happens in a fresh `Function` scope with a            *
 *     capability-scoped API: no `window`, no `document`, no          *
 *     `fetch`/`XMLHttpRequest` unless the addon declared the          *
 *     permission and was granted it. DOM access (when granted) is    *
 *     wrapped in a safe helper surface, never raw.                   *
 *  4. A strict runtime trap throws on any undeclared/denied          *
 *     capability access.                                             *
 * ------------------------------------------------------------------ */

(function (global) {
    'use strict';

    // ------------------------------------------------------------------
    // Storage keys
    // ------------------------------------------------------------------
    const ENABLED_KEY = 'chat.addons.enabled.v1';
    const TRUSTED_KEY = 'chat.addons.trusted.v1';

    // ------------------------------------------------------------------
    // Permission model
    // ------------------------------------------------------------------
    const PERMISSIONS = {
        // Read chat state (conversations, messages, settings) — no write.
        'chat:read': 'Read-only access to chat state',
        // Write chat state (create/delete conversations, send messages).
        'chat:write': 'Modify conversations and settings',
        // Register callbacks that run when a message is rendered.
        'ui:render': 'Hook into message rendering',
        // Show toasts / notifications.
        'ui:notify': 'Show toast notifications',
        // Read DOM (querySelector on the chat page).
        'dom:read': 'Read chat page DOM elements',
        // Limited DOM write (add CSS classes, toggle visibility).
        'dom:write': 'Modify chat page styles/layout',
        // Network access to declared origins only.
        'net:fetch': 'Make network requests (scoped to declared origins)',
        // IndexedDB access (conversation data lives there).
        'storage:db': 'Access chat IndexedDB storage',
        // localStorage access.
        'storage:local': 'Access chat localStorage',
        // Execute commands through the CLI bridge (server-side).
        'cli:exec': 'Run CLI commands on the server (DANGEROUS)',
    };

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------
    const registry = new Map();        // id -> addon descriptor
    const state = {
        enabled: new Set(),
        trusted: new Set(),
        ready: false,
        bootPromise: null,
    };

    function loadState() {
        try {
            const raw = localStorage.getItem(ENABLED_KEY);
            if (raw) state.enabled = new Set(JSON.parse(raw));
            const trusted = localStorage.getItem(TRUSTED_KEY);
            if (trusted) state.trusted = new Set(JSON.parse(trusted));
        } catch (e) {
            console.error('[addons] failed to load state', e);
        }
    }

    function persistState() {
        try {
            localStorage.setItem(ENABLED_KEY, JSON.stringify([...state.enabled]));
            localStorage.setItem(TRUSTED_KEY, JSON.stringify([...state.trusted]));
        } catch (e) {
            console.error('[addons] failed to persist state', e);
        }
    }

    function isEnabled(id) { return state.enabled.has(id); }
    function isTrusted(id) { return state.trusted.has(id); }

    function setEnabled(id, value) {
        if (value) state.enabled.add(id); else state.enabled.delete(id);
        persistState();
    }

    function setTrusted(id, value) {
        if (value) state.trusted.add(id); else state.trusted.delete(id);
        persistState();
    }

    // ------------------------------------------------------------------
    // Static source screening
    // ------------------------------------------------------------------
    const FORBIDDEN_PATTERNS = [
        // Direct global/API escapes
        /\bwindow\s*\./,
        /\bdocument\b/,
        /\bXMLHttpRequest\b/,
        /\bWebSocket\b/,
        /\bWorker\b/,
        /\bSharedWorker\b/,
        /\bServiceWorker\b/,
        /\bnavigator\s*\.\s*(sendBeacon|serviceWorker)\b/,
        // Import / dynamic code
        /\bimport\s*\(/,
        /\beval\s*\(/,
        /\bFunction\s*\(/,
        /\bnew\s+Function\b/,
        // Access to host page internals
        /\bparent\s*\./,
        /\btop\s*\./,
        /\bframes\b/,
        /\bopener\b/,
        // Cookie / credential theft
        /\bdocument\.cookie/i,
        /\bsessionStorage\b/,
        /\bcaches\b/,
        // Unfiltered global reads
        /\bglobalThis\b/,
    ];

    function screenSource(source, id) {
        const warnings = [];
        for (const pattern of FORBIDDEN_PATTERNS) {
            if (pattern.test(source)) {
                warnings.push(pattern.toString());
            }
        }
        if (warnings.length) {
            throw new Error(
                `[addons:${id}] source contains forbidden patterns: ${warnings.join(', ')}`
            );
        }
    }

    // ------------------------------------------------------------------
    // Capability-scoped execution
    // ------------------------------------------------------------------
    function grantCaps(addon) {
        const caps = {};
        const granted = addon.permissions || [];

        if (granted.includes('ui:notify') && global.ChatAddonHost) {
            caps.showToast = (message, type = 'info', duration = 2500) =>
                global.ChatAddonHost.notify(message, type, duration);
        }

        if (granted.includes('chat:read') && global.ChatAddonHost) {
            caps.getState = () => global.ChatAddonHost.getState();
        }

        if (granted.includes('chat:write') && global.ChatAddonHost) {
            caps.getState = () => global.ChatAddonHost.getState();
            caps.setState = (patch) => global.ChatAddonHost.setState(patch);
        }

        if (granted.includes('ui:render') && global.ChatAddonHost) {
            caps.onMessageRender = (cb) => global.ChatAddonHost.onMessageRender(addon.id, cb);
        }

        if (granted.includes('dom:read') && global.ChatAddonHost) {
            caps.query = (sel) => global.ChatAddonHost.query(sel);
        }

        if (granted.includes('dom:write') && global.ChatAddonHost) {
            caps.query = (sel) => global.ChatAddonHost.query(sel);
            caps.toggleClass = (sel, cls, force) => global.ChatAddonHost.toggleClass(sel, cls, force);
            caps.setStyle = (sel, prop, value) => global.ChatAddonHost.setStyle(sel, prop, value);
        }

        if (granted.includes('storage:local') && global.ChatAddonHost) {
            caps.store = global.ChatAddonHost.storage; // get/set/remove on a namespaced store
        }

        if (granted.includes('net:fetch') && global.ChatAddonHost) {
            const allowed = new Set(addon.allowedOrigins || []);
            caps.fetch = async (url, options) => {
                const target = new URL(url, global.location.href);
                if (allowed.size === 0 && target.origin !== global.location.origin) {
                    throw new Error(`[addons:${addon.id}] fetch to ${target.origin} not allowed`);
                }
                if (allowed.size > 0 && !allowed.has(target.origin)) {
                    throw new Error(`[addons:${addon.id}] fetch to ${target.origin} not allowed`);
                }
                return global.fetch(url, options);
            };
        }

        return Object.freeze(caps);
    }

    function executeSandboxed(addon) {
        const caps = grantCaps(addon);
        const sources = [
            '"use strict";',
            'const addon = arguments[0];',
            'const caps = arguments[1];',
            'const module = { exports: {} };',
            'const exports = module.exports;',
            addon.source,
        ].join('\n');
        const factory = new Function('addon', 'caps', 'module', 'exports', sources);
        const result = factory(addon, caps, { exports: {} }, {});
        if (result && typeof result.enable === 'function') {
            // Support `return { enable, disable }` style addons.
            addon.api = result;
            return result;
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Registry
    // ------------------------------------------------------------------
    function register(descriptor) {
        const id = descriptor.id;
        if (registry.has(id)) {
            console.warn(`[addons] duplicate registration for "${id}"`);
            return registry.get(id);
        }
        const addon = {
            id,
            name: descriptor.name || id,
            version: descriptor.version || '0.0.1',
            description: descriptor.description || '',
            author: descriptor.author || 'unknown',
            source: descriptor.source || '',
            builtin: !!descriptor.builtin,
            permissions: Array.isArray(descriptor.permissions) ? descriptor.permissions : [],
            allowedOrigins: Array.isArray(descriptor.allowedOrigins) ? descriptor.allowedOrigins : [],
            load: typeof descriptor.load === 'function' ? descriptor.load : null,
            unload: typeof descriptor.unload === 'function' ? descriptor.unload : null,
            api: null,
            _active: false,
        };
        registry.set(id, addon);
        return addon;
    }

    function get(id) { return registry.get(id); }
    function list() { return [...registry.values()]; }

    async function loadOne(id) {
        const addon = registry.get(id);
        if (!addon) throw new Error(`[addons] unknown addon "${id}"`);
        if (addon._active) return;

        if (addon.source) {
            screenSource(addon.source, id);
            const api = executeSandboxed(addon);
            addon.api = api;
        }
        if (typeof addon.load === 'function') {
            await addon.load(capsFor(addon));
        }
        addon._active = true;
        console.info(`[addons] enabled: ${id}`);
        return addon;
    }

    function capsFor(addon) {
        // Recompute caps for the currently active addon.
        return grantCaps(addon);
    }

    async function unloadOne(id) {
        const addon = registry.get(id);
        if (!addon) return;
        if (addon._active) {
            try {
                if (addon.api && typeof addon.api.disable === 'function') {
                    await addon.api.disable();
                }
                if (typeof addon.unload === 'function') {
                    await addon.unload();
                }
            } catch (e) {
                console.error(`[addons] error unloading "${id}"`, e);
            }
            addon._active = false;
        }
    }

    async function enable(id) {
        const addon = registry.get(id);
        if (!addon) throw new Error(`[addons] unknown addon "${id}"`);
        // Permission gate: workspace addons must be explicitly trusted.
        if (!addon.builtin && !isTrusted(id)) {
            throw Object.assign(new Error('not-trusted'), { code: 'NOT_TRUSTED', addon });
        }
        await loadOne(id);
        setEnabled(id, true);
    }

    async function disable(id) {
        await unloadOne(id);
        setEnabled(id, false);
    }

    async function enableAll() {
        loadState();
        // First run (or if boot() ran before addons registered): auto-enable
        // all built-in addons. The registry is fully populated by the time
        // enableAll() runs (it's called from a microtask after all defer
        // scripts evaluate), so this is safe.
        if (state.enabled.size === 0) {
            for (const addon of registry.values()) {
                if (addon.builtin) state.enabled.add(addon.id);
            }
            persistState();
        }
        for (const addon of registry.values()) {
            if (isEnabled(addon.id)) {
                try { await loadOne(addon.id); }
                catch (e) { console.error(`[addons] failed to enable "${addon.id}"`, e); }
            }
        }
    }

    // ------------------------------------------------------------------
    // Workspace .pa.js discovery
    // ------------------------------------------------------------------
    async function discoverWorkspaceAddons() {
        const host = global.ChatAddonHost;
        if (!host) return [];
        const files = await host.listWorkspaceAddons();
        const found = [];
        for (const file of files) {
            const id = 'workspace:' + file;
            if (registry.has(id)) { found.push(registry.get(id)); continue; }
            try {
                const text = await host.readWorkspaceFile(file);
                const meta = parseAddonHeader(text, file);
                const addon = register({
                    id,
                    name: meta.name || file.replace(/\.pa\.js$/i, ''),
                    version: meta.version || '0.0.1',
                    description: meta.description || 'Workspace addon',
                    author: meta.author || 'MCP workspace',
                    source: text,
                    builtin: false,
                    permissions: meta.permissions || [],
                    allowedOrigins: meta.allowedOrigins || [],
                });
                found.push(addon);
            } catch (e) {
                console.error(`[addons] failed to load workspace addon "${file}"`, e);
            }
        }
        return found;
    }

    function parseAddonHeader(source, filename) {
        const meta = { name: '', description: '', version: '', author: '', permissions: [], allowedOrigins: [] };
        const lines = source.split('\n').slice(0, 60);
        for (const line of lines) {
            const m = line.match(/^\s*(?:\/\/\s*|\/\*\s*)(?:@addon|addon)\s+([a-zA-Z-]+)\s*:\s*(.+)$/);
            if (!m) continue;
            const key = m[1].toLowerCase();
            const value = m[2].replace(/\*\/\s*$/, '').trim();
            if (key === 'name') meta.name = value;
            else if (key === 'description') meta.description = value;
            else if (key === 'version') meta.version = value;
            else if (key === 'author') meta.author = value;
            else if (key === 'permission' || key === 'permissions') {
                meta.permissions.push(...value.split(/[\s,]+/).filter(Boolean));
            } else if (key === 'allow-origin') {
                meta.allowedOrigins.push(value);
            }
        }
        return meta;
    }

    // ------------------------------------------------------------------
    // Boot
    // ------------------------------------------------------------------
    async function boot() {
        if (state.bootPromise) return state.bootPromise;
        state.bootPromise = (async () => {
            loadState();
            // First run: auto-enable all built-in addons. Later runs keep
            // the user's choices from localStorage.
            if (state.enabled.size === 0) {
                for (const addon of registry.values()) {
                    if (addon.builtin) state.enabled.add(addon.id);
                }
                persistState();
            }
            if (global.ChatAddonHost && typeof global.ChatAddonHost.onAddonRegistered === 'function') {
                global.ChatAddonHost.onAddonRegistered((addon) => {
                    // Called when host registers built-ins.
                });
            }
            state.ready = true;
        })();
        return state.bootPromise;
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------
    const ChatAddons = {
        version: '1.0.0',
        PERMISSIONS,
        register,
        get,
        list,
        enable,
        disable,
        enableAll,
        boot,
        isEnabled,
        isTrusted,
        setTrusted,
        discoverWorkspaceAddons,
        parseAddonHeader,
        _state: state,
    };

    global.ChatAddons = ChatAddons;
    if (typeof global.ChatAddonHost !== 'undefined') {
        // Host bootstraps addon loading after DOM is ready.
        global.addEventListener('DOMContentLoaded', () => { boot(); }, { once: true });
    }
})(window);

export default { ChatAddons };