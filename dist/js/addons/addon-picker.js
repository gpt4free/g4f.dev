/* ================================================================== *
 * Addon: Provider & Model Picker
 *
 * Full-screen modal panel for browsing all providers and models with
 * tag filters, model-name search, quick-select, and easy copy of the
 * provider base URL and model id.
 *
 * Uses: dom:read, dom:write, net:fetch, ui:notify
 * ================================================================== */

const apiExport = {};

(function () {
    'use strict';

    // ------------------------------------------------------------------
    // Tag metadata (mirrors model.js modelTags + provider tags)
    // ------------------------------------------------------------------
    const PICKER_TAG_META = {
        image: { icon: "🎨", label: "Image" },
        "image-edit": { icon: "🎨", label: "Image Edit" },
        vision: { icon: "👓", label: "Vision" },
        audio: { icon: "🎧", label: "Audio" },
        video: { icon: "🎥", label: "Video" },
        paid_only: { icon: "💰", label: "Paid" },
        free: { icon: "🆓", label: "Free" },
        tools: { icon: "🧰", label: "Tools" },
    };
    const TAG_KEYS = Object.keys(PICKER_TAG_META);

    // ------------------------------------------------------------------
    // CSS (injected once on load, removed on unload)
    // ------------------------------------------------------------------
    const CSS_ID = 'addon-picker-css';
    const CSS = `
.picker-overlay {
    position: fixed;
    inset: 0;
    z-index: 1500;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    opacity: 0;
    transition: opacity var(--transition-speed, 0.2s) ease;
    pointer-events: none;
}
.picker-overlay:not(.hidden) {
    opacity: 1;
    pointer-events: auto;
}
.picker-panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0.96);
    width: min(960px, 94vw);
    max-height: min(680px, 88vh);
    background: var(--blur-bg, #16101b80);
    border: 1px solid var(--blur-border, #8471904d);
    border-radius: var(--border-radius-2, 16px);
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(139, 61, 255, 0.08);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 1501;
    opacity: 0;
    transition: opacity var(--transition-speed, 0.2s) ease, transform var(--transition-speed, 0.2s) ease;
    pointer-events: none;
}
.picker-panel:not(.hidden) {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
    pointer-events: auto;
}
.picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--blur-border, #8471904d);
    gap: 12px;
}
.picker-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--colour-3, #e8d8ff);
    display: flex;
    align-items: center;
    gap: 10px;
}
.picker-header h2 i {
    color: var(--accent, #8b3dff);
}
.picker-header-actions {
    display: flex;
    gap: 6px;
}
.picker-icon-btn {
    width: 32px;
    height: 32px;
    border-radius: var(--border-radius-1, 10px);
    border: 1px solid var(--blur-border, #8471904d);
    background: transparent;
    color: var(--colour-3, #e8d8ff);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background var(--transition-speed, 0.2s), color var(--transition-speed, 0.2s);
}
.picker-icon-btn:hover {
    background: var(--button-hover, rgba(255, 255, 255, 0.06));
    color: var(--accent-hover, #9d56ff);
}
.picker-icon-btn.spinning i {
    animation: picker-spin 0.9s linear infinite;
}
@keyframes picker-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
.picker-show-hidden {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--border-radius-1, 10px);
    border: 1px solid var(--blur-border, #8471904d);
    background: transparent;
    color: var(--colour-3, #e8d8ff);
    cursor: pointer;
    font-size: 12px;
    transition: background var(--transition-speed, 0.2s), color var(--transition-speed, 0.2s), border-color var(--transition-speed, 0.2s);
}
.picker-show-hidden:hover {
    background: var(--button-hover, rgba(255, 255, 255, 0.06));
    color: var(--accent-hover, #9d56ff);
}
.picker-show-hidden.active {
    background: var(--accent, #8b3dff);
    color: #fff;
    border-color: var(--accent, #8b3dff);
}
.picker-show-hidden i {
    font-size: 12px;
}
.picker-search-row {
    padding: 12px 18px 6px;
}
.picker-search-box {
    position: relative;
    display: flex;
    align-items: center;
    background: var(--input-bg, #1a1525);
    border: 1px solid var(--blur-border, #8471904d);
    border-radius: var(--border-radius-1, 10px);
    padding: 0 12px;
    transition: border-color var(--transition-speed, 0.2s), box-shadow var(--transition-speed, 0.2s);
}
.picker-search-box:focus-within {
    border-color: var(--accent, #8b3dff);
    box-shadow: 0 0 0 3px var(--accent-glow, rgba(139, 61, 255, 0.25));
}
.picker-search-box > i {
    color: var(--colour-4, #f0f0f0);
    opacity: 0.6;
    font-size: 13px;
}
.picker-search-box input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--colour-3, #e8d8ff);
    font-size: 14px;
    padding: 10px 10px;
}
.picker-search-box input::placeholder {
    color: var(--colour-4, #f0f0f0);
    opacity: 0.45;
}
.picker-clear-btn {
    background: transparent;
    border: none;
    color: var(--colour-4, #f0f0f0);
    opacity: 0.6;
    cursor: pointer;
    padding: 4px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
}
.picker-clear-btn:hover {
    opacity: 1;
    color: var(--accent-hover, #9d56ff);
}
.picker-tags-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 18px 10px;
}
.picker-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--blur-border, #8471904d);
    background: transparent;
    color: var(--colour-3, #e8d8ff);
    font-size: 12px;
    cursor: pointer;
    transition: background var(--transition-speed, 0.2s), border-color var(--transition-speed, 0.2s), color var(--transition-speed, 0.2s);
}
.picker-tag:hover {
    background: var(--button-hover, rgba(255, 255, 255, 0.06));
    border-color: var(--accent, #8b3dff);
}
.picker-tag.active {
    background: var(--accent, #8b3dff);
    border-color: var(--accent, #8b3dff);
    color: #fff;
}
.picker-tag .picker-tag-count {
    font-size: 10px;
    opacity: 0.7;
    padding: 1px 6px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
}
.picker-tag.active .picker-tag-count {
    background: rgba(255, 255, 255, 0.25);
}
.picker-body {
    flex: 1;
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 0;
    overflow: hidden;
    min-height: 0;
}
.picker-providers,
.picker-models {
    overflow-y: auto;
    padding: 10px 12px;
}
.picker-providers {
    border-right: 1px solid var(--blur-border, #8471904d);
    background: rgba(0, 0, 0, 0.18);
}
.picker-section-title {
    margin: 0 0 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.6;
    color: var(--colour-3, #e8d8ff);
    display: flex;
    align-items: center;
    gap: 6px;
}
.picker-section-title i {
    color: var(--accent, #8b3dff);
}
.picker-count {
    margin-left: auto;
    font-size: 11px;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--accent, #8b3dff);
    color: #fff;
    opacity: 0.9;
}
.picker-providers-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.picker-provider {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--border-radius-1, 10px);
    cursor: pointer;
    border: 1px solid transparent;
    transition: background var(--transition-speed, 0.2s), border-color var(--transition-speed, 0.2s);
}
.picker-provider:hover {
    background: var(--button-hover, rgba(255, 255, 255, 0.06));
}
.picker-provider.active {
    background: var(--accent-glow, rgba(139, 61, 255, 0.25));
    border-color: var(--accent, #8b3dff);
}
.picker-provider .picker-provider-label {
    flex: 1;
    font-size: 13px;
    color: var(--colour-3, #e8d8ff);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.picker-provider .picker-provider-tags {
    font-size: 11px;
    opacity: 0.7;
}
.picker-provider .picker-provider-count {
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.1);
    color: var(--colour-3, #e8d8ff);
}
.picker-provider .picker-provider-marker {
    font-size: 12px;
    flex-shrink: 0;
}
.picker-provider.picker-provider-dim {
    opacity: 0.5;
}
.picker-provider .picker-provider-dim-badge {
    font-size: 11px;
    flex-shrink: 0;
}
.picker-models-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.picker-model-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.picker-model-group-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.5;
    color: var(--colour-3, #e8d8ff);
    padding: 4px 6px;
    border-bottom: 1px solid var(--blur-border, #8471904d);
    margin-bottom: 2px;
}
.picker-model {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--border-radius-1, 10px);
    border: 1px solid transparent;
    cursor: pointer;
    transition: background var(--transition-speed, 0.2s), border-color var(--transition-speed, 0.2s);
}
.picker-model:hover {
    background: var(--button-hover, rgba(255, 255, 255, 0.06));
}
.picker-model.active {
    background: var(--accent-glow, rgba(139, 61, 255, 0.18));
}
.picker-model.selected {
    border-color: var(--accent, #8b3dff);
    background: var(--accent-glow, rgba(139, 61, 255, 0.25));
}
.picker-model-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.picker-model-name {
    font-size: 13px;
    color: var(--colour-3, #e8d8ff);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.picker-model-meta {
    font-size: 11px;
    opacity: 0.55;
    color: var(--colour-4, #f0f0f0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.picker-model-tags {
    font-size: 13px;
    letter-spacing: 2px;
    opacity: 0.85;
}
.picker-model-actions {
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity var(--transition-speed, 0.2s);
}
.picker-model:hover .picker-model-actions,
.picker-model.active .picker-model-actions {
    opacity: 1;
}
.picker-model-action {
    width: 28px;
    height: 28px;
    border-radius: var(--border-radius-1, 10px);
    border: 1px solid var(--blur-border, #8471904d);
    background: transparent;
    color: var(--colour-3, #e8d8ff);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    transition: background var(--transition-speed, 0.2s), color var(--transition-speed, 0.2s);
}
.picker-model-action:hover {
    background: var(--accent, #8b3dff);
    color: #fff;
    border-color: var(--accent, #8b3dff);
}
.picker-empty {
    padding: 24px;
    text-align: center;
    opacity: 0.5;
    color: var(--colour-3, #e8d8ff);
    font-size: 13px;
}
.picker-footer {
    border-top: 1px solid var(--blur-border, #8471904d);
    padding: 12px 18px;
    background: rgba(0, 0, 0, 0.22);
}
.picker-detail {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--colour-3, #e8d8ff);
}
.picker-detail-empty {
    opacity: 0.5;
    font-style: italic;
}
.picker-detail-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.55;
    margin-right: 2px;
}
.picker-detail-value {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    background: var(--input-bg, #1a1525);
    padding: 3px 8px;
    border-radius: 6px;
    border: 1px solid var(--blur-border, #8471904d);
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.picker-detail-copy {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: var(--border-radius-1, 10px);
    border: 1px solid var(--blur-border, #8471904d);
    background: transparent;
    color: var(--colour-3, #e8d8ff);
    cursor: pointer;
    font-size: 11px;
    transition: background var(--transition-speed, 0.2s), color var(--transition-speed, 0.2s);
}
.picker-detail-copy:hover {
    background: var(--button-hover, rgba(255, 255, 255, 0.06));
    color: var(--accent-hover, #9d56ff);
}
.picker-detail-copy.copied {
    color: #2ecc71;
    border-color: rgba(46, 204, 113, 0.4);
}
.picker-detail-quick {
    margin-left: auto;
    display: flex;
    gap: 6px;
}
.picker-detail-quick button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: var(--border-radius-1, 10px);
    border: 1px solid var(--accent, #8b3dff);
    background: var(--accent, #8b3dff);
    color: #fff;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    transition: background var(--transition-speed, 0.2s);
}
.picker-detail-quick button:hover {
    background: var(--accent-hover, #9d56ff);
    border-color: var(--accent-hover, #9d56ff);
}
@media (max-width: 720px) {
    .picker-panel {
        width: 100vw;
        max-height: 100vh;
        height: 100vh;
        border-radius: 0;
        border: none;
    }
    .picker-body {
        grid-template-columns: 1fr;
        grid-template-rows: auto 1fr;
    }
    .picker-providers {
        border-right: none;
        border-bottom: 1px solid var(--blur-border, #8471904d);
        max-height: 160px;
    }
    .picker-detail-quick {
        margin-left: 0;
        width: 100%;
        margin-top: 6px;
    }
    .picker-detail-quick button {
        flex: 1;
        justify-content: center;
    }
}
`;

    function ensureCss() {
        if (document.getElementById(CSS_ID)) return;
        const style = document.createElement('style');
        style.id = CSS_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    // ------------------------------------------------------------------
    // Picker state + element refs (resolved lazily so the addon can boot
    // before the v2.html markup is parsed)
    // ------------------------------------------------------------------
    const state = {
        providers: [],          // [{name, label, tags, baseUrl, backupUrl, models, type, isHidden, isDisabled, marker}]
        activeProvider: null,   // selected provider name (or "__all__")
        activeTags: new Set(),  // selected tag names
        searchTerm: '',
        selectedModel: null,    // {provider, model}
        loaded: false,
        showHidden: false,      // when true, show hidden/disabled providers
    };

    let el = null; // element refs cache

    function refs() {
        if (el) return el;
        el = {
            overlay: document.getElementById('picker-overlay'),
            panel: document.getElementById('picker-panel'),
            openBtn: document.getElementById('open_picker'),
            closeBtn: document.getElementById('picker_close'),
            refreshBtn: document.getElementById('picker_refresh'),
            showHiddenBtn: document.getElementById('picker_show_hidden'),
            searchInput: document.getElementById('picker_search'),
            clearBtn: document.getElementById('picker_clear'),
            tagsRow: document.getElementById('picker_tags'),
            providersList: document.getElementById('picker_providers'),
            modelsList: document.getElementById('picker_models'),
            countEl: document.getElementById('picker_count'),
            detailEl: document.getElementById('picker_detail'),
        };
        return el;
    }

    // ------------------------------------------------------------------
    // Helpers — reach shared globals exposed by other addons
    // ------------------------------------------------------------------
    function escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function notify(message, type = 'info', duration = 2000) {
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type, duration);
        } else if (window.ChatAddonHost && typeof window.ChatAddonHost.notify === 'function') {
            window.ChatAddonHost.notify(message, type, duration);
        }
    }

    async function copyText(text, btn) {
        if (!text) {
            notify('Nothing to copy', 'info');
            return;
        }
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            } else if (typeof window.fallback_clipboard === 'function') {
                window.fallback_clipboard(text);
            } else {
                throw new Error('No clipboard API');
            }
            if (btn) {
                const orig = btn.innerHTML;
                btn.classList.add('copied');
                btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
                setTimeout(() => {
                    btn.classList.remove('copied');
                    btn.innerHTML = orig;
                }, 1200);
            } else {
                notify('Copied to clipboard', 'success');
            }
        } catch (e) {
            if (typeof window.fallback_clipboard === 'function') {
                window.fallback_clipboard(text);
                notify('Copied (fallback)', 'success');
            } else {
                console.error('Picker: clipboard failed', e);
                notify('Copy failed', 'error');
            }
        }
    }

    // ------------------------------------------------------------------
    // Open / close
    // ------------------------------------------------------------------
    function open() {
        const r = refs();
        r.overlay?.classList.remove('hidden');
        r.panel?.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        if (!state.loaded) {
            loadAll();
        }
        setTimeout(() => r.searchInput?.focus(), 50);
    }

    function close() {
        const r = refs();
        r.overlay?.classList.add('hidden');
        r.panel?.classList.add('hidden');
        document.body.style.overflow = '';
    }

    // ------------------------------------------------------------------
    // Data loading
    // ------------------------------------------------------------------

    // Read the enabled/disabled state of a provider from the settings
    // checkboxes (input.provider:not(:checked)) in the providers toggle list.
    function isProviderDisabled(providerName) {
        // Map provider name to the checkbox id pattern used in the UI.
        // Core providers use id="Provider{Name}" (capitalized first letter).
        // Live providers use id="ProviderLive{name}".
        // Custom servers use id="ProviderCustom{serverId}".
        // PA providers use id="ProviderPa{paId}".
        const candidates = [
            `Provider${providerName}`,
            `ProviderLive${providerName}`,
        ];
        for (const id of candidates) {
            const cb = document.getElementById(id);
            if (cb && cb.type === 'checkbox') {
                return !cb.checked;
            }
        }
        // Check by value attribute (custom servers use value="custom:{id}", pa uses "pa:{id}")
        const cbByValue = document.querySelector(`input.provider[type="checkbox"][value="${providerName}"]`);
        if (cbByValue) return !cbByValue.checked;
        // Also check the <option> in the provider <select> — disabled attr means disabled
        const opt = document.querySelector(`#provider option[value="${providerName}"]`);
        if (opt && opt.disabled) return true;
        return false;
    }

    // Fetch with timeout and retry.
    // Returns { ok, status, data } or null on failure.
    const FETCH_TIMEOUT = 8000;   // 8s per attempt
    const FETCH_RETRIES = 0;      // 2 retries = 3 total attempts

    // In-memory model cache keyed by request URL.
    // Survives across loadAll() calls within the TTL so re-opening the
    // picker is instant. Cleared by refresh() and on unload.
    // Also persisted to sessionStorage so a page reload doesn't trigger
    // a full re-fetch of every provider's model list.
    const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    const SESSION_CACHE_KEY = 'picker_model_cache';
    const modelCache = new Map(); // url -> { data, expires }

    // Restore persisted cache from sessionStorage on init
    try {
        const saved = sessionStorage.getItem(SESSION_CACHE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object') {
                const now = Date.now();
                for (const [url, entry] of Object.entries(parsed)) {
                    if (entry && entry.expires > now) {
                        modelCache.set(url, entry);
                    }
                }
            }
        }
    } catch (e) { /* corrupt or unavailable — start fresh */ }

    function persistCache() {
        try {
            const obj = {};
            for (const [url, entry] of modelCache.entries()) {
                obj[url] = entry;
            }
            sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(obj));
        } catch (e) { /* quota exceeded — keep in-memory only */ }
    }

    function getCachedModels(url) {
        const entry = modelCache.get(url);
        if (entry && entry.expires > Date.now()) {
            return entry.data;
        }
        if (entry) modelCache.delete(url); // expired
        return null;
    }

    function setCachedModels(url, data) {
        modelCache.set(url, { data, expires: Date.now() + MODEL_CACHE_TTL });
        persistCache();
    }

    function clearModelCache() {
        modelCache.clear();
        try { sessionStorage.removeItem(SESSION_CACHE_KEY); } catch (e) {}
    }

    async function fetchWithRetry(url, headers, label) {
        // Serve from cache when available and fresh
        const cached = getCachedModels(url);
        if (cached !== null) {
            return { ok: true, status: 200, data: cached };
        }
        for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
            try {
                const resp = await fetch(url, { headers, signal: controller.signal });
                clearTimeout(timer);
                if (resp.ok) {
                    const data = await resp.json();
                    setCachedModels(url, data);
                    return { ok: true, status: resp.status, data };
                }
                console.warn(`Picker: ${label} fetch failed (${resp.status}) on attempt ${attempt + 1}`);
                if (resp.status >= 400 && resp.status < 500 && resp.status !== 408 && resp.status !== 429) {
                    return { ok: false, status: resp.status, data: null }; // don't retry client errors
                }
            } catch (e) {
                clearTimeout(timer);
                if (e.name === 'AbortError') {
                    console.warn(`Picker: ${label} timed out on attempt ${attempt + 1}/${FETCH_RETRIES + 1}`);
                } else {
                    console.warn(`Picker: ${label} error on attempt ${attempt + 1}`, e);
                }
            }
        }
        return { ok: false, status: 0, data: null };
    }

    // Fetch models for a single provider via direct fetch.
    // Live providers:   https://g4f.space/api/{name}/models
    // Custom servers:   https://g4f.space/custom/{serverId}/models
    async function fetchLiveProviderModels(providerName) {
        let url;
        if (providerName.startsWith('https://') || providerName.startsWith('http://')) {
            url = `${providerName}/models`;
        } else if (providerName && providerName.startsWith('custom:')) {
            const serverId = providerName.slice('custom:'.length);
            url = `https://g4f.space/custom/${serverId}/models`;
        } else {
            url = `https://g4f.space/api/${providerName}/models`;
        }
        const result = await fetchWithRetry(url, { 'Accept': 'application/json' }, `models for ${providerName}`);
        return result.ok ? (result.data || []) : [];
    }

    // Fetch models for a core provider via the backend API.
    // Core providers: {backendUrl}/backend-api/v2/models/{name}
    async function fetchCoreProviderModels(providerName) {
        const backendUrl = (window.framework && window.framework.backendUrl)
            || window.location.origin;
        const url = `${backendUrl}/backend-api/v2/models/${providerName}`;
        const headers = { 'Accept': 'application/json' };
        // Pass API key if the provider requires auth
        if (typeof window.get_api_key_by_provider === 'function') {
            const apiKey = window.get_api_key_by_provider(providerName);
            if (apiKey) headers['x-api-key'] = apiKey;
        }
        const result = await fetchWithRetry(url, headers, `core models for ${providerName}`);
        return result.ok ? (result.data || []) : [];
    }

    // Build a prefix emoji for a core provider based on its attributes.
    // Mirrors the logic in addon-providers-ui.js load_providers().
    function coreProviderMarker(provider) {
        if (provider.hf_space) return '🤗';
        if (provider.nodriver) return '🌐';
        if (!provider.nodriver && provider.auth) return '🔑';
        if (provider.live > 0) return '🟢';
        return '⭐';
    }

    async function loadAll() {
        const r = refs();
        if (!r.refreshBtn) return;
        r.refreshBtn.classList.add('spinning');
        try {
            state.providers = [];
            const seen = new Set();

            // "All Providers" pseudo-entry — collects models from all visible providers
            const allEntry = {
                name: '__all__',
                label: 'All Providers',
                tags: '',
                baseUrl: '',
                backupUrl: '',
                models: [],
                type: 'all',
                isHidden: false,
                isDisabled: false,
                marker: '',
            };

            // ----------------------------------------------------------
            // 0. Core providers (from /backend-api/v2/providers)
            // ----------------------------------------------------------
            try {
                const backendUrl = (window.framework && window.framework.backendUrl)
                    || window.location.origin;
                const coreUrl = `${backendUrl}/backend-api/v2/providers`;
                const coreResult = await fetchWithRetry(coreUrl, { 'Accept': 'application/json' }, 'core providers');
                if (coreResult.ok && Array.isArray(coreResult.data)) {
                    const coreProviders = coreResult.data;
                    // Sort alphabetically by label, matching load_providers()
                    coreProviders.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
                    for (const provider of coreProviders) {
                        const name = provider.name;
                        if (!name || name === 'default' || seen.has(name)) continue;
                        seen.add(name);
                        const isDisabled = isProviderDisabled(name);
                        // Build prefix emoji from provider attributes
                        const marker = coreProviderMarker(provider);
                        let models = await fetchCoreProviderModels(name);
                        models = normalizeModels(models, name);
                        state.providers.push({
                            name,
                            label: provider.label || name,
                            tags: '',
                            baseUrl: `${backendUrl}/api/${name}`,
                            backupUrl: '',
                            models,
                            type: 'core',
                            isHidden: provider.hf_space,
                            isDisabled,
                            marker,
                        });
                        allEntry.models = allEntry.models.concat(models);
                    }
                }
            } catch (e) {
                console.warn('Picker: failed to load core providers', e);
            }

            // ----------------------------------------------------------
            // 1. Live providers (from window.loadProviders() / providers.json)
            // ----------------------------------------------------------
            const providerConfigs = (typeof window.loadProviders === 'function')
                ? (await window.loadProviders())
                : {};

            // Bulk models index (used as a fallback / for non-live providers)
            let allModels = {};
            try {
                allModels = (typeof window.api === 'function') ? (await window.api('models') || {}) : {};
            } catch (e) {
                console.warn('Picker: failed to load models index', e);
            }
            if (Object.keys(allModels).length === 0 && window.searchModels) {
                allModels = window.searchModels;
            }

            for (const [name, config] of Object.entries(providerConfigs || {})) {
                if (seen.has(name)) continue;
                // Skip providers that require auth tokens the user hasn't set
                if (window.providerLocalStorage && window.providerLocalStorage[name]
                    && (typeof appStorage !== 'undefined')
                    && !appStorage.getItem(window.providerLocalStorage[name])) {
                    continue;
                }
                seen.add(name);
                const isHidden = !!config.is_hidden;
                const isDisabled = isProviderDisabled(name);
                // Live providers fetch models on-demand via api('models', providerName)
                let models = await fetchLiveProviderModels(config.backupUrl || config.baseUrl || name);
                models = normalizeModels(models, name);
                state.providers.push({
                    name,
                    label: config.label || name,
                    tags: config.tags || '',
                    baseUrl: config.backupUrl ? '' : (config.baseUrl || ''),
                    backupUrl: config.backupUrl || '',
                    models,
                    type: 'live',
                    isHidden,
                    isDisabled,
                    marker: '🟢',
                });
                allEntry.models = allEntry.models.concat(models);
            }

            // ----------------------------------------------------------
            // 2. Custom providers (local Custom + API custom servers)
            // ----------------------------------------------------------
            // 2a. Local Custom provider (configured via Custom-api_base)
            if ((typeof appStorage !== 'undefined') && appStorage.getItem('Custom-api_base')) {
                const customName = 'custom';
                if (!seen.has(customName)) {
                    seen.add(customName);
                    const baseUrl = appStorage.getItem('Custom-api_base') || '';
                    const isDisabled = isProviderDisabled(customName);
                    let models = [];
                    if (!isDisabled) {
                        models = await fetchLiveProviderModels(baseUrl);
                    }
                    models = normalizeModels(models, customName);
                    state.providers.push({
                        name: customName,
                        label: 'Custom Provider',
                        tags: '🔧',
                        baseUrl,
                        backupUrl: '',
                        models,
                        type: 'custom',
                        isHidden: false,
                        isDisabled,
                        marker: '🔧',
                    });
                    if (!isDisabled) allEntry.models = allEntry.models.concat(models);
                }
            }
            // 2b. Custom servers from the API (private + public merge)
            // Mirrors loadCustomProvidersFromAPI() in addon-init.js so the
            // picker works even when addon-init hasn't populated window.customServers.
            let customServers = window.customServers;
            if (!Array.isArray(customServers)) {
                try {
                    let privateData;
                    if (typeof appStorage !== 'undefined' && appStorage.getItem("g4f_session")) {
                        const privUrl = "https://g4f.space/custom/api/servers";
                        const privResp = await fetch(privUrl, {
                            headers: { 'Authorization': `Bearer ${appStorage.getItem("g4f_session") || ""}` }
                        });
                        if (privResp.status === 401) {
                            appStorage.removeItem("g4f_session");
                        }
                        privateData = await privResp.json();
                    }
                    const publicUrl = "https://g4f.space/custom/api/servers/public";
                    const publicResult = await fetchWithRetry(publicUrl, { 'Accept': 'application/json' }, 'custom servers (public)');
                    let pubData = publicResult.ok && publicResult.data ? publicResult.data.servers : [];
                    if (!Array.isArray(pubData)) pubData = [];
                    if (privateData) {
                        const publicServerIds = new Set(pubData.map(s => s.id));
                        if (privateData.servers) {
                            pubData = pubData.concat(
                                privateData.servers.filter(s => !publicServerIds.has(s.id))
                            );
                        }
                    }
                    // Filter out servers that are already live in the dropdown
                    const liveServerIds = Object.values(providerConfigs || {}).map(p => p.id);
                    customServers = pubData.filter(s => !liveServerIds.includes(s.id));
                    window.customServers = customServers;
                } catch (e) {
                    console.warn('Picker: failed to load custom servers from API', e);
                    customServers = [];
                }
            }
            for (const server of customServers) {
                if (server.is_offline || server.is_ollama) continue; // skip offline or hidden servers
                const srvName = `custom:${server.id}`;
                if (seen.has(srvName)) continue;
                seen.add(srvName);
                let isEnabled = (typeof appStorage !== 'undefined')
                    && appStorage.getItem(`enableCustomServer_${server.id}`);
                if (isEnabled === null) {
                    isEnabled = !server.is_hidden && !server.is_ollama && !server.is_offline;
                } else {
                    isEnabled = isEnabled === "true";
                }
                const isHidden = !!server.is_hidden;
                const isDisabled = !isEnabled;
                let models = await fetchLiveProviderModels(srvName);
                models = normalizeModels(models, srvName);
                const label = server.label || server.id;
                state.providers.push({
                    name: srvName,
                    label,
                    tags: '',
                    baseUrl: `https://g4f.space/custom/${server.id}`,
                    backupUrl: '',
                    models,
                    type: 'custom',
                    isHidden,
                    isDisabled,
                    marker: '🌐',
                });
                allEntry.models = allEntry.models.concat(models);
            }

            // ----------------------------------------------------------
            // 3. PA providers (from window._paProviders or /pa/providers)
            // ----------------------------------------------------------
            let paProviders = window._paProviders;
            if (!paProviders && typeof window.fetch === 'function') {
                try {
                    const backendUrl = (window.framework && window.framework.backendUrl)
                        || window.location.origin;
                    const paUrl = `${backendUrl}/pa/providers`;
                    const paResult = await fetchWithRetry(paUrl, { 'Accept': 'application/json' }, 'PA providers');
                    if (paResult.ok && Array.isArray(paResult.data)) {
                        paProviders = paResult.data;
                        window._paProviders = paProviders;
                    }
                } catch (e) {
                    console.warn('Picker: failed to fetch PA providers', e);
                }
            }
            if (Array.isArray(paProviders)) {
                const backendUrl = (window.framework && window.framework.backendUrl)
                    || window.location.origin;
                for (const p of paProviders) {
                    const paName = `pa:${p.id}`;
                    if (seen.has(paName)) continue;
                    seen.add(paName);
                    const isDisabled = isProviderDisabled(paName);
                    // PA models come from p.models directly (not the models API)
                    const models = normalizeModels(p.models || [], paName);
                    state.providers.push({
                        name: paName,
                        label: p.label || p.id,
                        tags: '',
                        baseUrl: `${backendUrl}/api/pa:${p.id}`,
                        backupUrl: '',
                        models,
                        type: 'pa',
                        isHidden: false,
                        isDisabled,
                        marker: '🔌',
                    });
                    if (!isDisabled) allEntry.models = allEntry.models.concat(models);
                }
            }

            // ----------------------------------------------------------
            // 4. Providers present in the bulk model index but not yet added
            //    (e.g. legacy / non-live providers returned by api('models'))
            // ----------------------------------------------------------
            // for (const [name, modelList] of Object.entries(allModels || {})) {
            //     if (name === 'default' || seen.has(name)) continue;
            //     seen.add(name);
            //     const isDisabled = isProviderDisabled(name);
            //     const models = normalizeModels(modelList, name);
            //     state.providers.push({
            //         name,
            //         label: name,
            //         tags: '',
            //         baseUrl: '',
            //         backupUrl: '',
            //         models,
            //         type: 'index',
            //         isHidden: false,
            //         isDisabled,
            //         marker: '',
            //     });
            //     if (!isDisabled) allEntry.models = allEntry.models.concat(models);
            // }

            state.providers.unshift(allEntry);
            state.loaded = true;
            state.activeProvider = '__all__';
            renderProviders();
            renderTags();
            renderModels();
        } catch (e) {
            console.error('Picker: failed to load', e);
            notify('Picker: failed to load providers', 'error');
        } finally {
            r.refreshBtn?.classList.remove('spinning');
        }
    }

    function normalizeModels(modelList, providerName) {
        if (modelList.data) modelList = modelList.data;
        if (!Array.isArray(modelList)) return [];
        const out = [];
        for (const raw of modelList) {
            if (raw && raw.models && Array.isArray(raw.models)) {
                for (const sub of raw.models) {
                    out.push(normalizeModel(sub, providerName, raw.group));
                }
            } else {
                out.push(normalizeModel(raw, providerName));
            }
        }
        return out;
    }

    function normalizeModel(raw, providerName, group) {
        const model = raw && typeof raw === 'object' ? { ...raw } : { id: String(raw) };
        if (typeof window.convertModel === 'function' && model.id) {
            try { window.convertModel(model); } catch (e) {}
        }
        model.provider = providerName;
        if (group) model.group = group;
        if (!model.id) model.id = model.name || model.model_name || model.model || '';
        if (!model.label) model.label = model.id;
        return model;
    }

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------
    function renderProviders() {
        const r = refs();
        if (!r.providersList) return;
        r.providersList.innerHTML = '';
        // Filter out hidden/disabled providers unless showHidden is on.
        // "__all__" is always shown.
        const visible = state.providers.filter(p => {
            if (p.name === '__all__') return true;
            if (p.isHidden || p.isDisabled) return state.showHidden;
            return true;
        });
        const sorted = [...visible].sort((a, b) => {
            if (a.name === '__all__') return -1;
            if (b.name === '__all__') return 1;
            return a.label.localeCompare(b.label);
        });
        if (sorted.length <= 1) {
            const empty = document.createElement('div');
            empty.className = 'picker-empty';
            empty.textContent = state.showHidden
                ? 'No providers loaded.'
                : 'No visible providers. Enable "Show hidden" to see disabled/hidden ones.';
            r.providersList.appendChild(empty);
            return;
        }
        for (const p of sorted) {
            const div = document.createElement('div');
            div.className = 'picker-provider';
            if (p.name === state.activeProvider) div.classList.add('active');
            if (p.isHidden || p.isDisabled) div.classList.add('picker-provider-dim');
            const count = p.models.length;
            const markerHtml = p.marker ? `<span class="picker-provider-marker">${p.marker}</span>` : '';
            const dimBadge = (p.isHidden || p.isDisabled)
                ? `<span class="picker-provider-dim-badge" title="${p.isHidden ? 'Hidden' : 'Disabled'}">${p.isHidden ? '⚫' : '⛔'}</span>`
                : '';
            div.innerHTML = `
                ${markerHtml}
                <span class="picker-provider-label">${escapeHtml(p.label)}</span>
                ${p.tags ? `<span class="picker-provider-tags">${escapeHtml(p.tags)}</span>` : ''}
                ${dimBadge}
                ${count ? `<span class="picker-provider-count">${count}</span>` : ''}
            `;
            div.addEventListener('click', () => {
                state.activeProvider = p.name;
                renderProviders();
                renderTags();
                renderModels();
            });
            r.providersList.appendChild(div);
        }
    }

    function collectTags() {
        const counts = {};
        const providers = state.activeProvider === '__all__'
            ? state.providers
            : state.providers.filter(p => p.name === state.activeProvider);
        for (const p of providers) {
            // Skip hidden/disabled providers in tag counts unless showHidden is on
            if (p.name !== '__all__' && (p.isHidden || p.isDisabled) && !state.showHidden) continue;
            for (const m of p.models) {
                for (const k of TAG_KEYS) {
                    if (m[k]) counts[k] = (counts[k] || 0) + 1;
                }
            }
        }
        return counts;
    }

    function renderTags() {
        const r = refs();
        if (!r.tagsRow) return;
        r.tagsRow.innerHTML = '';
        const counts = collectTags();
        const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
        if (keys.length === 0) {
            r.tagsRow.innerHTML = '<span class="picker-detail-empty">No tags available</span>';
            return;
        }
        for (const k of keys) {
            const meta = PICKER_TAG_META[k] || { icon: "🏷️", label: k };
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'picker-tag';
            if (state.activeTags.has(k)) btn.classList.add('active');
            btn.innerHTML = `${meta.icon} <span>${escapeHtml(meta.label)}</span><span class="picker-tag-count">${counts[k]}</span>`;
            btn.addEventListener('click', () => {
                if (state.activeTags.has(k)) state.activeTags.delete(k);
                else state.activeTags.add(k);
                renderTags();
                renderModels();
            });
            r.tagsRow.appendChild(btn);
        }
    }

    function modelMatches(m) {
        if (state.searchTerm) {
            const haystack = (`${m.id || ''} ${m.label || ''} ${m.name || ''} ${m.provider || ''}`).replaceAll('.', '-').toLowerCase();
            if (!haystack.includes(state.searchTerm.replaceAll('.', '-').toLowerCase())) return false;
        }
        if (state.activeTags.size > 0) {
            for (const t of state.activeTags) {
                if (!m[t]) return false;
            }
        }
        return true;
    }

    function renderModels() {
        const r = refs();
        if (!r.modelsList) return;
        r.modelsList.innerHTML = '';
        const provider = state.providers.find(p => p.name === state.activeProvider);
        const models = provider ? provider.models : [];
        const filtered = models.filter(modelMatches);
        if (r.countEl) r.countEl.textContent = filtered.length;
        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'picker-empty';
            empty.textContent = 'No models match your search.';
            r.modelsList.appendChild(empty);
            return;
        }
        let groups;
        if (state.activeProvider === '__all__') {
            const byProv = {};
            for (const m of filtered) {
                if (m.provider === 'default') continue;
                // Skip models from hidden/disabled providers unless showHidden is on
                const prov = state.providers.find(p => p.name === m.provider);
                if (prov && (prov.isHidden || prov.isDisabled) && !state.showHidden) continue;
                const key = prov.label || prov.name;
                if (!byProv[key]) byProv[key] = [];
                byProv[key].push(m);
            }
            groups = Object.entries(byProv).sort((a, b) => a[0].localeCompare(b[0]));
        } else {
            groups = [[provider.label, filtered]];
        }
        for (const [groupLabel, groupModels] of groups) {
            const groupEl = document.createElement('div');
            groupEl.className = 'picker-model-group';
            const labelEl = document.createElement('div');
            labelEl.className = 'picker-model-group-label';
            labelEl.textContent = `${groupLabel} (${groupModels.length})`;
            groupEl.appendChild(labelEl);
            for (const m of groupModels) {
                groupEl.appendChild(buildModelRow(m));
            }
            r.modelsList.appendChild(groupEl);
        }
    }

    function modelTagsString(m) {
        const parts = [];
        for (const k of TAG_KEYS) {
            if (m[k] && PICKER_TAG_META[k]) parts.push(PICKER_TAG_META[k].icon);
        }
        return parts.join(' ');
    }

    function buildModelRow(m) {
        const row = document.createElement('div');
        row.className = 'picker-model';
        const isSelected = state.selectedModel
            && state.selectedModel.model.id === m.id
            && state.selectedModel.provider === m.provider;
        if (isSelected) row.classList.add('selected');
        const tagsHtml = modelTagsString(m);
        const metaParts = [];
        if (m.provider) metaParts.push(m.provider);
        if (m.type && m.type !== 'chat') metaParts.push(m.type);
        if (m.total_cost) metaParts.push(`${m.total_cost.toFixed(3).replace(/0$/, '')}$`);
        row.innerHTML = `
            <div class="picker-model-main">
                <div class="picker-model-name">${escapeHtml(m.label || m.id)}</div>
                <div class="picker-model-meta">${escapeHtml(metaParts.join(' · '))}</div>
            </div>
            <div class="picker-model-tags">${tagsHtml}</div>
            <div class="picker-model-actions">
                <button class="picker-model-action" data-action="copy" title="Copy model id" aria-label="Copy model id">
                    <i class="fa-regular fa-copy"></i>
                </button>
                <button class="picker-model-action" data-action="select" title="Quick select" aria-label="Quick select model">
                    <i class="fa-solid fa-bolt"></i>
                </button>
            </div>
        `;
        row.addEventListener('click', (e) => {
            if (e.target.closest('.picker-model-action')) return;
            selectModel(m);
        });
        row.querySelector('[data-action="copy"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            copyText(m.id || m.label, e.currentTarget);
        });
        row.querySelector('[data-action="select"]')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            await quickSelect(m);
        });
        return row;
    }

    function selectModel(m) {
        state.selectedModel = { provider: m.provider, model: m };
        renderModels();
        renderDetail();
    }

    function renderDetail() {
        const r = refs();
        if (!r.detailEl) return;
        if (!state.selectedModel) {
            r.detailEl.innerHTML = '<span class="picker-detail-empty">Select a model to see base URL &amp; quick actions</span>';
            return;
        }
        const { provider, model } = state.selectedModel;
        const provConfig = state.providers.find(p => p.name === provider);
        const baseUrl = provConfig?.baseUrl || provConfig?.backupUrl || '';
        const modelId = model.id || model.label;
        const typeLabel = provConfig
            ? `${provConfig.marker ? provConfig.marker + ' ' : ''}${provConfig.type}`
            : '';
        r.detailEl.innerHTML = `
            <span class="picker-detail-label">Provider</span>
            <span class="picker-detail-value" title="${escapeHtml(typeLabel)}">${escapeHtml(typeLabel || '—')}</span>
            <span class="picker-detail-label">Base URL</span>
            <span class="picker-detail-value" title="${escapeHtml(baseUrl)}">${escapeHtml(baseUrl || '—')}</span>
            <button class="picker-detail-copy" data-copy="baseurl" title="Copy base URL">
                <i class="fa-regular fa-copy"></i> Copy URL
            </button>
            <span class="picker-detail-label">Model</span>
            <span class="picker-detail-value" title="${escapeHtml(modelId)}">${escapeHtml(modelId)}</span>
            <button class="picker-detail-copy" data-copy="model" title="Copy model id">
                <i class="fa-regular fa-copy"></i> Copy Model
            </button>
            <div class="picker-detail-quick">
                <button data-action="quickselect" title="Use this model now">
                    <i class="fa-solid fa-bolt"></i> Quick Select
                </button>
            </div>
        `;
        r.detailEl.querySelector('[data-copy="baseurl"]')?.addEventListener('click', (e) => {
            copyText(baseUrl, e.currentTarget);
        });
        r.detailEl.querySelector('[data-copy="model"]')?.addEventListener('click', (e) => {
            copyText(modelId, e.currentTarget);
        });
        r.detailEl.querySelector('[data-action="quickselect"]')?.addEventListener('click', async () => {
            await quickSelect(state.selectedModel.model);
        });
    }

    async function quickSelect(m) {
        if (!m || !m.provider) return;
        const providerName = m.provider;
        const modelId = m.id || m.label;
        try {
            const providerSelect = document.getElementById('provider');
            const modelSelect = document.getElementById('model');
            if (providerSelect && providerName !== '__all__') {
                const provOption = providerSelect.querySelector(`option[value="${providerName}"]`);
                if (provOption) {
                    providerSelect.value = providerName;
                    providerSelect.dispatchEvent(new Event('change'));
                    // Wait for the model option to appear in the dropdown.
                    // loadClientModels()/refreshModels() replace modelSelect.innerHTML
                    // asynchronously, so a fixed timeout is unreliable. Poll instead.
                    const selected = await waitForModelOption(modelSelect, modelId, 10000);
                    if (selected) {
                        modelSelect.value = modelId;
                        modelSelect.dispatchEvent(new Event('change'));
                        notify(`Selected ${modelId} on ${providerName}`, 'success');
                        close(); // close the picker panel after successful selection
                    } else {
                        // Model not in the provider's list — fall back to model search
                        const modelSearch = document.getElementById('modelSearch');
                        if (modelSearch) {
                            modelSearch.value = modelId;
                            modelSearch.dispatchEvent(new Event('input'));
                            notify(`Provider set to ${providerName}; using model search for ${modelId}`, 'info');
                            close();
                        } else {
                            notify(`Provider set to ${providerName}; model ${modelId} not in list`, 'info');
                        }
                    }
                } else {
                    notify(`Provider ${providerName} not available in dropdown`, 'info');
                }
            }
            selectModel(m);
        } catch (e) {
            console.error('Picker: quick select failed', e);
            notify('Quick select failed', 'error');
        }
    }

    // Poll modelSelect until an option with the given value exists, or timeout.
    async function waitForModelOption(modelSelect, modelId, timeoutMs) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const opt = modelSelect.querySelector(`option[value="${modelId}"]`);
            if (opt && !opt.disabled) return opt;
            // Also check if the dropdown is still loading ("Loading..." placeholder)
            const loading = modelSelect.querySelector('option[disabled][selected]');
            if (loading && /loading/i.test(loading.textContent || '')) {
                // still loading — keep waiting
            } else if (opt) {
                // option exists but disabled — still return it
                return opt;
            }
            await new Promise(r => setTimeout(r, 100));
        }
        return modelSelect.querySelector(`option[value="${modelId}"]`);
    }

    // ------------------------------------------------------------------
    // Auto-fallback: try next provider/model when a chat request fails
    // ------------------------------------------------------------------
    const fallback = {
        active: false,        // true while a fallback chain is in progress
        tried: new Set(),     // "provider/model" keys already attempted
        lastMessageId: null,  // message_id of the failed request
        retryCount: 0,        // safety cap on total retries per message
    };
    const MAX_FALLBACK_RETRIES = 10;

    // Build an ordered list of candidate {provider, model} pairs from the
    // picker's loaded providers. Excludes disabled/hidden providers and
    // already-tried pairs. Returns [] if the picker hasn't loaded.
    function buildFallbackCandidates() {
        if (!state.loaded || !state.providers.length) return [];
        const candidates = [];
        for (const prov of state.providers) {
            if (prov.name === '__all__') continue;
            if (prov.isDisabled || prov.isHidden) continue;
            if (!prov.models || !prov.models.length) continue;
            for (const m of prov.models) {
                const key = `${prov.name}/${m.id || m.label}`;
                if (fallback.tried.has(key)) continue;
                candidates.push({ provider: prov.name, model: m.id || m.label, key });
            }
        }
        return candidates;
    }

    // Find the next candidate AFTER the just-failed provider/model in the
    // picker's ordered list. This walks forward through the list instead of
    // always jumping back to the first model (which is often the "default").
    // Falls back to the first untried candidate if the failed pair isn't
    // found in the list (e.g. it came from a provider not in the picker).
    function buildFallbackCandidatesAfter(failedProvider, failedModel) {
        if (!state.loaded || !state.providers.length) return [];
        const all = [];
        for (const prov of state.providers) {
            if (prov.name === '__all__') continue;
            if (prov.isDisabled || prov.isHidden) continue;
            if (!prov.models || !prov.models.length) continue;
            for (const m of prov.models) {
                const key = `${prov.name}/${m.id || m.label}`;
                all.push({ provider: prov.name, model: m.id || m.label, key });
            }
        }
        // Find the position of the failed pair
        const failedKey = `${failedProvider}/${failedModel}`;
        const failedIdx = all.findIndex(c => c.key === failedKey);
        if (failedIdx >= 0 && failedIdx + 1 < all.length) {
            // Return everything after the failed pair, filtered by tried-set
            return all.slice(failedIdx + 1).filter(c => !fallback.tried.has(c.key));
        }
        // Failed pair not in list (or it was last) — return all untried
        return all.filter(c => !fallback.tried.has(c.key));
    }

    // Record that a provider/model pair was attempted (so we don't retry it).
    function markTried(providerName, modelId) {
        fallback.tried.add(`${providerName}/${modelId}`);
    }

    // Reset the fallback chain (called when a new user message starts).
    function resetFallback() {
        fallback.active = false;
        fallback.tried.clear();
        fallback.lastMessageId = null;
        fallback.retryCount = 0;
    }

    // Called by ask_gpt's error handler. If there is a next candidate,
    // selects it in the dropdown and re-invokes ask_gpt. Returns true if
    // a retry was started, false if no candidates remain.
    async function tryNextProvider(messageId, messages, action, message) {
        if (!state.loaded) return false;
        // Reset retry count when the message_id changes (new user message)
        if (fallback.lastMessageId !== messageId) {
            fallback.tried.clear();
            fallback.retryCount = 0;
            fallback.lastMessageId = messageId;
        }
        // Safety cap to prevent infinite loops
        if (fallback.retryCount >= MAX_FALLBACK_RETRIES) {
            console.warn('Picker: fallback retry limit reached, stopping');
            fallback.active = false;
            return false;
        }
        // Mark the just-failed provider/model as tried
        const providerSelect = document.getElementById('provider');
        const modelSelect = document.getElementById('model');
        const failedProvider = providerSelect?.value;
        const failedModel = window.get_selected_model ? window.get_selected_model() : modelSelect?.value;
        if (failedProvider && failedModel) {
            markTried(failedProvider, failedModel);
        }
        // Build candidates starting AFTER the just-failed pair, so we
        // advance through the picker's list instead of jumping back to
        // the first (default) model.
        const candidates = buildFallbackCandidatesAfter(failedProvider, failedModel);
        if (!candidates.length) {
            fallback.active = false;
            return false;
        }
        const next = candidates[0];
        console.info(`Picker: auto-fallback → ${next.provider}/${next.model} (attempt ${fallback.retryCount + 1}/${MAX_FALLBACK_RETRIES})`);
        notify(`Retrying with ${next.provider}/${next.model}`, 'info');
        fallback.active = true;
        fallback.retryCount += 1;
        fallback.lastMessageId = messageId;
        // Select the next provider/model in the dropdown
        if (providerSelect) {
            const provOpt = providerSelect.querySelector(`option[value="${next.provider}"]`);
            if (provOpt) {
                providerSelect.value = next.provider;
                providerSelect.dispatchEvent(new Event('change'));
                await waitForModelOption(modelSelect, next.model, 10000);
            }
        }
        if (modelSelect) {
            const modelOpt = modelSelect.querySelector(`option[value="${next.model}"]`);
            if (modelOpt) {
                modelSelect.value = next.model;
                modelSelect.dispatchEvent(new Event('change'));
            }
        }
        // Re-invoke ask_gpt with the new provider/model
        if (typeof window.ask_gpt === 'function') {
            window.ask_gpt(messageId, -1, false, next.provider, next.model, action, message);
        }
        return true;
    }

    // ------------------------------------------------------------------
    // Event wiring
    // ------------------------------------------------------------------
    let wired = false;
    function wireEvents() {
        if (wired) return;
        const r = refs();
        r.openBtn?.addEventListener('click', open);
        r.closeBtn?.addEventListener('click', close);
        r.overlay?.addEventListener('click', close);
        r.refreshBtn?.addEventListener('click', async () => {
            state.loaded = false;
            await loadAll();
        });
        r.showHiddenBtn?.addEventListener('click', () => {
            state.showHidden = !state.showHidden;
            if (r.showHiddenBtn) {
                r.showHiddenBtn.classList.toggle('active', state.showHidden);
                r.showHiddenBtn.setAttribute('aria-pressed', String(state.showHidden));
            }
            renderProviders();
            renderTags();
            renderModels();
        });
        r.searchInput?.addEventListener('input', (e) => {
            state.searchTerm = e.target.value.toLowerCase().trim();
            if (r.clearBtn) r.clearBtn.classList.toggle('hidden', !state.searchTerm);
            renderModels();
        });
        r.clearBtn?.addEventListener('click', () => {
            if (r.searchInput) r.searchInput.value = '';
            state.searchTerm = '';
            r.clearBtn.classList.add('hidden');
            renderModels();
            r.searchInput?.focus();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && r.panel && !r.panel.classList.contains('hidden')) {
                close();
            }
        });
        wired = true;
    }

    // ------------------------------------------------------------------
    // Register addon
    // ------------------------------------------------------------------
    ChatAddons.register({
        id: 'builtin:picker',
        name: 'Provider & Model Picker',
        version: '1.0.0',
        description: 'Browse all providers and models with tag filters, search, quick-select, and copy base URL/model id.',
        author: 'g4f',
        builtin: true,
        permissions: ['dom:read', 'dom:write', 'net:fetch', 'ui:notify'],

        load() {
            ensureCss();
            // The panel markup lives in v2.html. Wire events once the DOM
            // is ready; retry briefly if the page is still parsing.
            const mount = () => {
                const r = refs();
                if (!r.panel) {
                    // Markup not present (e.g. loaded on a non-v2 page) — nothing to do.
                    return;
                }
                wireEvents();
                console.info('[picker] loaded');
            };
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', mount, { once: true });
            } else {
                mount();
            }
        },

        unload() {
            const r = refs();
            r.openBtn?.removeEventListener('click', open);
            r.closeBtn?.removeEventListener('click', close);
            r.overlay?.removeEventListener('click', close);
            wired = false;
            clearModelCache();
            const css = document.getElementById(CSS_ID);
            if (css) css.remove();
            console.info('[picker] unloaded');
        },

        // Public API (also copied to window by v2.js)
        open,
        close,
        refresh: () => { state.loaded = false; clearModelCache(); return loadAll(); },
        tryNextProvider,
        resetFallback,
        isFallbackActive: () => fallback.active,
    });

    // Expose the real functions on the export container so v2.js
    // copies them to window.* (window.tryNextProvider, etc.)
    apiExport.open = open;
    apiExport.close = close;
    apiExport.refresh = () => { state.loaded = false; clearModelCache(); return loadAll(); };
    apiExport.tryNextProvider = tryNextProvider;
    apiExport.resetFallback = resetFallback;
    apiExport.isFallbackActive = () => fallback.active;
    apiExport.quickSelect = quickSelect;
})();

export default apiExport;
