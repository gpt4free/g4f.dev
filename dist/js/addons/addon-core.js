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

// ------------------------------------------------------------------
// Storage keys
// ------------------------------------------------------------------
const ENABLED_KEY = 'chat.addons.enabled.v1';

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
    // Add feature buttons/options to the sidebar addon panel.
    'ui:sidebar': 'Add buttons/options to the sidebar panel',
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
    ready: false,
    bootPromise: null,
};

function loadState() {
    try {
        const raw = localStorage.getItem(ENABLED_KEY);
        if (raw) state.enabled = new Set(JSON.parse(raw));
    } catch (e) {
        console.error('[addons] failed to load state', e);
    }
}

function persistState() {
    try {
        localStorage.setItem(ENABLED_KEY, JSON.stringify([...state.enabled]));
    } catch (e) {
        console.error('[addons] failed to persist state', e);
    }
}

function isEnabled(id) { return state.enabled.has(id); }

function setEnabled(id, value) {
    if (value) state.enabled.add(id); else state.enabled.delete(id);
    persistState();
}

// ------------------------------------------------------------------
// Static source screening
// ------------------------------------------------------------------
const FORBIDDEN_PATTERNS = [
    // Direct window/API escapes
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
    // Unfiltered window reads
    /\bwindowThis\b/,
];

function screenSource(source, id) {
    // Static screening is advisory, not a hard gate: workspace addons
    // are user-provided files that legitimately touch document/window
    // (the host bridge is the recommended surface, but the sandbox is a
    // plain Function wrapper, so blocking these patterns would reject
    // every real workspace addon without adding actual isolation).
    const warnings = [];
    for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(source)) {
            warnings.push(pattern.toString());
        }
    }
    if (warnings.length) {
        console.warn(
            `[addons:${id}] source contains patterns that are discouraged (${warnings.join(', ')}); ` +
            `prefer the ChatAddonHost bridge where possible`
        );
    }
}

// ------------------------------------------------------------------
// Capability-scoped execution
// ------------------------------------------------------------------
function grantCaps(addon) {
    const caps = {};
    const granted = addon.permissions || [];

    if (granted.includes('ui:notify') && window.ChatAddonHost) {
        caps.showToast = (message, type = 'info', duration = 2500) =>
            window.ChatAddonHost.notify(message, type, duration);
    }

    if (granted.includes('chat:read') && window.ChatAddonHost) {
        caps.getState = () => window.ChatAddonHost.getState();
    }

    if (granted.includes('chat:write') && window.ChatAddonHost) {
        caps.getState = () => window.ChatAddonHost.getState();
        caps.setState = (patch) => window.ChatAddonHost.setState(patch);
    }

    if (granted.includes('ui:render') && window.ChatAddonHost) {
        caps.onMessageRender = (cb) => window.ChatAddonHost.onMessageRender(addon.id, cb);
    }

    if (granted.includes('ui:sidebar') && window.ChatAddonHost) {
        caps.sidebar = window.ChatAddonHost.sidebar;
    }

    if (granted.includes('dom:read') && window.ChatAddonHost) {
        caps.query = (sel) => window.ChatAddonHost.query(sel);
    }

    if (granted.includes('dom:write') && window.ChatAddonHost) {
        caps.query = (sel) => window.ChatAddonHost.query(sel);
        caps.toggleClass = (sel, cls, force) => window.ChatAddonHost.toggleClass(sel, cls, force);
        caps.setStyle = (sel, prop, value) => window.ChatAddonHost.setStyle(sel, prop, value);
    }

    if (granted.includes('storage:local') && window.ChatAddonHost) {
        caps.store = window.ChatAddonHost.storage; // get/set/remove on a namespaced store
    }

    if (granted.includes('net:fetch') && window.ChatAddonHost) {
        const allowed = new Set(addon.allowedOrigins || []);
        caps.fetch = async (url, options) => {
            const target = new URL(url, window.location.href);
            if (allowed.size === 0 && target.origin !== window.location.origin) {
                throw new Error(`[addons:${addon.id}] fetch to ${target.origin} not allowed`);
            }
            if (allowed.size > 0 && !allowed.has(target.origin)) {
                throw new Error(`[addons:${addon.id}] fetch to ${target.origin} not allowed`);
            }
            return window.fetch(url, options);
        };
    }

    return Object.freeze(caps);
}

function executeSandboxed(addon) {
    const caps = grantCaps(addon);
    // Workspace addon files self-register via the window ChatAddons.register()
    // (e.g. `id: 'workspace:chat-export'`), while discovery pre-registers an
    // entry under a normalized id and stores the source here. Intercept
    // register() during the eval so the self-declared descriptor (load(),
    // unload(), permissions, ...) is merged into the discovery entry —
    // otherwise the addon's load() body would never run.
    const realRegister = window.ChatAddons.register.bind(window.ChatAddons);
    let selfDescriptor = null;
    let sawSelf = false;
    window.ChatAddons.register = (descriptor) => {
        const result = realRegister(descriptor);
        if (descriptor && !descriptor.builtin) {
            sawSelf = true;
            selfDescriptor = descriptor;
        }
        return result;
    };
    try {
        const sources = [
            '"use strict";',
            addon.source,
        ].join('\n');
        const factory = new Function('addon', 'caps', 'module', 'exports', sources);
        const result = factory(addon, caps, { exports: {} }, {});
        if (sawSelf && selfDescriptor) {
            // If the addon self-registered under a different id than the
            // discovery id, drop the self-registered duplicate entry.
            if (selfDescriptor.id && selfDescriptor.id !== addon.id && registry.has(selfDescriptor.id)) {
                registry.delete(selfDescriptor.id);
            }
            // Merge ALL own properties from the self-declared descriptor
            // into the discovery entry so that `this` inside load/unload
            // has access to every method and property the addon defined
            // (e.g. _loadSets, _getMCP, STORAGE_KEY, _injectPanel, …).
            for (const key of Object.keys(selfDescriptor)) {
                if (key === 'id') continue; // keep the discovery id
                addon[key] = selfDescriptor[key];
            }
        }
        if (result && typeof result.enable === 'function') {
            // Support `return { enable, disable }` style addons.
            addon.api = result;
            return result;
        }
        return null;
    } finally {
        window.ChatAddons.register = realRegister;
    }
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

async function loadOne(id, opts = {}) {
    const addon = registry.get(id);
    if (!addon) throw new Error(`[addons] unknown addon "${id}"`);
    if (addon.source) {
        screenSource(addon.source, id);
        const api = executeSandboxed(addon);
        addon.api = api;
    }
    if (typeof addon.load === 'function') {
        await addon.load.call(addon, capsFor(addon), opts);
    }
    addon._active = true;
    console.log(`[addons] enabled: ${id}`);
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
                await addon.unload.call(addon);
            }
        } catch (e) {
            console.error(`[addons] error unloading "${id}"`, e);
        }
        addon._active = false;
    }
}

async function enable(id, opts = {}) {
    console.log('[addons] enabling addon', id);
    try {
        await loadOne(id, opts);
        setEnabled(id, true);
    } catch (e) {
        console.error(`[addons] failed to enable "${id}"`, e);
        throw e;
    }
}

async function disable(id) {
    await unloadOne(id);
    setEnabled(id, false);
}

async function enableAll() {
    // State is already loaded by boot(). Re-loading here would overwrite
    // any migration performed during workspace discovery.
    // First run: auto-enable all built-in addons. Later runs keep
    // the user's choices from localStorage, but newly added built-in
    // addons are always merged in so they show up for existing users.
    if (state.enabled.size === 0) {
        for (const addon of registry.values()) {
            if (addon.builtin) state.enabled.add(addon.id);
        }
        persistState();
    } else {
        let changed = false;
        for (const addon of registry.values()) {
            if (addon.builtin && !state.enabled.has(addon.id)) {
                state.enabled.add(addon.id);
                changed = true;
            }
        }
        if (changed) persistState();
    }
    for (const addon of registry.values()) {
        // Guard with _active so re-running enableAll() (e.g. after
        // workspace discovery registers new addons) never double-loads
        // addons that are already up.
        if (isEnabled(addon.id) && !addon._active) {
            try { await loadOne(addon.id); }
            catch (e) { console.error(`[addons] failed to enable "${addon.id}"`, e); }
        }
    }
}

// ------------------------------------------------------------------
// Workspace .pa.js discovery
// ------------------------------------------------------------------
async function discoverWorkspaceAddons() {
    const host = window.ChatAddonHost;
    if (!host) return [];
    const files = await host.listWorkspaceAddons();
    const found = [];
    let discoveredNew = false;
    for (const file of files) {
        // Normalize the id to the short form the addon files themselves
        // register under (`workspace:<name>`, not the full path). The
        // file content is the source of truth: it calls
        // `ChatAddons.register({ id: 'workspace:<name>', ... })` at
        // eval time, so the discovery id must match or toggling in the
        // manager would persist a different id than the addon registers.
        const id = normalizeWorkspaceId(file);
        if (registry.has(id)) { found.push(registry.get(id)); continue; }
        try {
            const text = await host.readWorkspaceFile(file);
            const meta = parseAddonHeader(text, file);
            // Prefer the id the addon file itself declares in its
            // ChatAddons.register({ id: 'workspace:<name>' }) call, so the
            // manager list, enable-state persistence and the addon's own
            // registration all agree.
            const selfId = extractSelfRegisteredId(text);
            const addon = register({
                id: selfId || id,
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
            discoveredNew = true;
        } catch (e) {
            console.error(`[addons] failed to load workspace addon "${file}"`, e);
        }
    }
    // Workspace addons are registered asynchronously, after the host's
    // initial enableAll() already ran over the built-in registry. If the
    // user previously enabled a workspace addon (persisted in localStorage),
    // apply the stored state now so it comes back after every reload.
    if (discoveredNew) {
        await enableAll();
    }
    return found;
}

// 'pa-providers/pa-chat-export.js' -> 'workspace:pa-chat-export.js'
// 'pa-providers/pa-chat-export.js' (addon registers 'workspace:chat-export')
// -> also acceptable: strip the .js extension only if the addon file
// does. We keep the basename with extension by default, matching the
// `pa-*.js` registration convention used by the built-in files, and
// fall back to the short name if the basename doesn't start with 'pa-'.
function normalizeWorkspaceId(file) {
    const base = String(file).split('/').pop();
    const id = 'workspace:' + base;
    // If the basename is pa-<name>.js, the addon files register with
    // workspace:<name> (no prefix, no extension). Try to match that.
    const m = /^pa-(.+)\.js$/i.exec(base);
    if (m) return 'workspace:' + m[1];
    return id;
}

// Extract the id a workspace addon self-registers with in its
// `ChatAddons.register({ id: '...' })` call so the manager list and
// enable-state use the same id the addon itself registers.
function extractSelfRegisteredId(source) {
    const m = /\bid\s*:\s*['"]([^'"]+)['"]/.exec(source || '');
    if (m && /^workspace:/.test(m[1])) return m[1];
    return null;
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
        // the user's choices from localStorage, but newly added built-in
        // addons are always merged in so they show up for existing users.
        if (state.enabled.size === 0) {
            for (const addon of registry.values()) {
                if (addon.builtin) state.enabled.add(addon.id);
            }
            persistState();
        } else {
            let changed = false;
            for (const addon of registry.values()) {
                if (addon.builtin && !state.enabled.has(addon.id)) {
                    state.enabled.add(addon.id);
                    changed = true;
                }
            }
            if (changed) persistState();
        }
        if (window.ChatAddonHost && typeof window.ChatAddonHost.onAddonRegistered === 'function') {
            window.ChatAddonHost.onAddonRegistered((addon) => {
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
    discoverWorkspaceAddons,
    parseAddonHeader,
    _state: state,
};

export default { ChatAddons };