/* ================================================================== *
 * g4f.dev framework — shared runtime for all pages
 *
 * Classic script (no build step), loaded in <head> before the addons.
 * Everything public is exposed as window globals plus the `framework`
 * object at the end of this file.
 *
 * Sections:
 *   1. Constants & environment
 *   2. Log panel (lazy element resolution)
 *   3. ErrorTracker
 *   4. Error reporting (add_error)
 *   5. Backend connection
 *   6. Translations
 *   7. DOM & string utilities
 *   8. Markdown rendering & model queries
 *   9. Auth headers
 *  10. Conversation storage (IndexedDB)
 *  11. Ads & iframe messaging
 *  12. Public API exports
 * ================================================================== */

// ---------------------------------------------------------------------------
// 1. Constants & environment
// ---------------------------------------------------------------------------

const G4F_HOST = "https://g4f.dev";
const G4F_WILDCARD = ".g4f.dev";
const G4F_HOST_PASS = "https://g4f.space";
const DB_NAME = 'chat-db';
const STORE_NAME = 'conversations';
const VERSION = 1;

const isG4fHost = window.location.origin === G4F_HOST || window.location.origin.endsWith(G4F_WILDCARD);

window.framework = {}

if (localStorage.getItem("debugMode") === "true") {
    if (!document.querySelector('script[src="https://g4f.dev/dist/js/debug.js"]')) {
        if (window.location === window.parent.location) {
            const debugEl = document.createElement('script');
            debugEl.src = 'https://g4f.dev/dist/js/debug.js';
            document.head.appendChild(debugEl);
        }
    }
}

// ---------------------------------------------------------------------------
// 2. Log panel (lazy element resolution)
//
// This classic script runs in <head> before the body (and the .log section)
// exists, so an eager query would return null. Resolved on DOMContentLoaded
// and re-queried whenever the cached node is no longer connected (e.g. after
// a UI re-render).
// ---------------------------------------------------------------------------

let logStorage = null;
let logContent = null;

function resolveLogElements() {
    if (!logStorage || !logStorage.isConnected) {
        logStorage = document.querySelector(".log");
        logContent = document.querySelector(".log-content") || logStorage;
    }
    return logContent;
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", resolveLogElements);
} else {
    resolveLogElements();
}

let privateConversation = null;

// ---------------------------------------------------------------------------
// 3. ErrorTracker
// ============================================================================
//  * ErrorTracker captures all browser errors (console.error, window.onerror,
//  * unhandled promise rejections, resource load failures, network errors)
//  * and stores them in a ring buffer with rich metadata. It provides:
//  *   - Categorized error types (js, resource, promise, network, console)
//  *   - Severity levels (error, warn, info)
//  *   - Stack trace extraction and formatting
//  *   - Deduplication of repeated errors
//  *   - Error rate tracking and burst detection
//  *   - Export to JSON for the MCP agent
//  *   - Visual error log in the .log-content panel
//  *   - Global API via window.ErrorTracker for other scripts/addons
//  * ================================================================== */
const ErrorTracker = (() => {
    const MAX_ERRORS = 200;
    const MAX_DEDUP = 50;
    const _errors = [];
    const _dedupMap = new Map(); // key → count
    _dedupMap._maxSize = MAX_DEDUP;
    let _installed = false;
    let _errorCount = 0;
    let _warnCount = 0;
    let _burstWindow = [];
    const _BURST_THRESHOLD = 5;
    const _BURST_INTERVAL = 3000; // ms

    // --- helpers ---
    function _stringify(val) {
        if (val == null) return String(val);
        if (typeof val === 'string') return val;
        if (val instanceof Error) return val.message + (val.stack ? '\n' + val.stack : '');
        try { return JSON.stringify(val, null, 0); } catch (e) { return String(val); }
    }

    function _extractStack(args) {
        for (const a of args) {
            if (a instanceof Error && a.stack) return a.stack;
            if (a && typeof a === 'object' && a.stack) return String(a.stack);
        }
        // Try to get stack from Error.captureStackTrace
        try {
            const err = new Error();
            if (err.stack) return err.stack.split('\n').slice(3).join('\n');
        } catch (e) { /* ignore */ }
        return '';
    }

    function _dedupKey(entry) {
        return `${entry.type}:${entry.message}`.slice(0, 200);
    }

    function _truncate(str, max = 2000) {
        if (!str) return str;
        return str.length > max ? str.slice(0, max) + '…' : str;
    }

    // --- core capture ---
    function _capture(type, severity, args, extra = {}) {
        const message = Array.isArray(args) ? args.map(_stringify).join(' ') : _stringify(args);
        const stack = Array.isArray(args) ? _extractStack(args) : '';
        const entry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type,           // 'js' | 'resource' | 'promise' | 'network' | 'console'
            severity,       // 'error' | 'warn' | 'info'
            message: _truncate(message),
            stack: _truncate(stack, 4000),
            time: new Date().toISOString(),
            timestamp: Date.now(),
            url: location.href,
            ...extra,
        };

        // Deduplication
        const key = _dedupKey(entry);
        if (_dedupMap.has(key)) {
            const count = _dedupMap.get(key);
            _dedupMap.set(key, count + 1);
            entry.repeat = count + 1;
        } else {
            if (_dedupMap.size >= _dedupMap._maxSize) {
                // Evict oldest entry
                const firstKey = _dedupMap.keys().next().value;
                _dedupMap.delete(firstKey);
            }
            _dedupMap.set(key, 1);
            entry.repeat = 1;
        }

        _errors.push(entry);
        if (_errors.length > MAX_ERRORS) _errors.shift();

        if (severity === 'error') _errorCount++;
        else if (severity === 'warn') _warnCount++;

        // Burst detection
        const now = Date.now();
        _burstWindow.push(now);
        _burstWindow = _burstWindow.filter(t => now - t < _BURST_INTERVAL);
        if (_burstWindow.length >= _BURST_THRESHOLD) {
            entry._burst = true;
        }

        // Render to visual log
        _renderToLog(entry);

        // Notify listeners
        _notifyListeners(entry);

        return entry;
    }

    // --- visual log rendering ---
    function _renderToLog(entry) {
        if (!resolveLogElements()) return;
        const p = document.createElement("p");
        p.className = `error-entry error-${entry.severity}`;
        p.dataset.errorId = entry.id;
        p.dataset.errorType = entry.type;

        const icon = entry.severity === 'error' ? '🔴' : entry.severity === 'warn' ? '🟡' : '🔵';
        const repeatStr = entry.repeat > 1 ? ` (×${entry.repeat})` : '';
        const burstStr = entry._burst ? ' ⚡BURST' : '';

        let text = `${icon} [${entry.type}] ${entry.message}${repeatStr}${burstStr}`;
        if (entry.stack) {
            text += `\n${entry.stack.split('\n').slice(0, 4).join('\n')}`;
        }
        if (entry.resource) {
            text += `\nResource: ${entry.resource}`;
        }
        if (entry.status) {
            text += `\nHTTP ${entry.status}: ${entry.url || ''}`;
        }

        p.innerText = text;
        p.innerHTML = p.innerHTML.replaceAll("\n", "<br>");
        window.logContent.appendChild(p);
    }

    // --- listeners (for other addons / MCP agent) ---
    const _listeners = new Set();
    function _notifyListeners(entry) {
        for (const fn of _listeners) {
            try { fn(entry); } catch (e) { /* avoid infinite loop */ }
        }
    }

    // --- hook installation ---
    function install() {
        if (_installed) return;
        _installed = true;

        // --- console.error ---
        const _origError = console.error;
        console.error = function (...args) {
            _capture('console', 'error', args);
            return _origError.apply(console, args);
        };

        // --- console.warn ---
        const _origWarn = console.warn;
        console.warn = function (...args) {
            _capture('console', 'warn', args);
            return _origWarn.apply(console, args);
        };

        // --- window.onerror (uncaught JS exceptions) ---
        window.addEventListener('error', function (event) {
            if (event.target && (event.target.src || event.target.href)) {
                // Resource load failure
                _capture('resource', 'error', [
                    `Resource failed to load: ${event.target.src || event.target.href}`,
                ], {
                    resource: event.target.src || event.target.href,
                    tagName: event.target.tagName,
                });
            } else {
                // JS error
                _capture('js', 'error', [event.message || event], {
                    filename: event.filename,
                    lineno: event.lineno,
                    colno: event.colno,
                    type: event.type,
                });
            }
        }, true);

        // --- unhandledrejection (promise rejections) ---
        window.addEventListener('unhandledrejection', function (event) {
            const reason = event.reason;
            _capture('promise', 'error', [reason], {
                reason: _stringify(reason),
            });
        });

        // --- Network error interception (fetch) ---
        const _origFetch = window.fetch;
        window.fetch = async function (...args) {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
            try {
                const response = await _origFetch.apply(this, args);
                if (!response.ok) {
                    _capture('network', 'warn', [`HTTP ${response.status} ${response.statusText}: ${url}`], {
                        status: response.status,
                        statusText: response.statusText,
                        url,
                    });
                }
                return response;
            } catch (err) {
                _capture('network', 'error', [`Fetch failed: ${url}`, err], { url });
                throw err;
            }
        };

        // --- XHR error interception ---
        const _origXhrOpen = XMLHttpRequest.prototype.open;
        const _origXhrSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            this._paMethod = method;
            this._paUrl = url;
            return _origXhrOpen.call(this, method, url, ...rest);
        };
        XMLHttpRequest.prototype.send = function (...args) {
            this.addEventListener('error', () => {
                _capture('network', 'error', [`XHR failed: ${this._paMethod} ${this._paUrl}`], {
                    method: this._paMethod,
                    url: this._paUrl,
                });
            });
            this.addEventListener('load', () => {
                if (this.status >= 400) {
                    _capture('network', 'warn', [`XHR ${this.status}: ${this._paMethod} ${this._paUrl}`], {
                        method: this._paMethod,
                        url: this._paUrl,
                        status: this.status,
                    });
                }
            });
            return _origXhrSend.apply(this, args);
        };
    }

    // --- public API ---
    return {
        install,
        getErrors() { return [..._errors]; },
        getErrorsByType(type) { return _errors.filter(e => e.type === type); },
        getErrorsBySeverity(severity) { return _errors.filter(e => e.severity === severity); },
        getRecent(limit = 20) { return _errors.slice(-limit); },
        getErrorCount() { return _errorCount; },
        getWarnCount() { return _warnCount; },
        getTotalCount() { return _errors.length; },
        clearErrors() { _errors.length = 0; _dedupMap.clear(); _errorCount = 0; _warnCount = 0; return true; },
        hasBurst() { return _burstWindow.length >= _BURST_THRESHOLD; },
        getStats() {
            const byType = {};
            const bySeverity = {};
            for (const e of _errors) {
                byType[e.type] = (byType[e.type] || 0) + 1;
                bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
            }
            return {
                total: _errors.length,
                errors: _errorCount,
                warnings: _warnCount,
                byType,
                bySeverity,
                burst: _burstWindow.length >= _BURST_THRESHOLD,
            };
        },
        exportJSON() { return JSON.stringify(_errors, null, 2); },
        onError(fn) {
            _listeners.add(fn);
            return () => _listeners.delete(fn);
        },
    };
})();

// Install error tracking immediately
ErrorTracker.install();
window.ErrorTracker = ErrorTracker;

if (localStorage.getItem("debugMode") === "true") {
    if (!document.querySelector('script[src="https://g4f.dev/dist/js/debug.js"]')) {
        if (window.location === window.parent.location) {
            const debugEl = document.createElement('script');
            debugEl.src = 'https://g4f.dev/dist/js/debug.js';
            document.head.appendChild(debugEl);
        }
    }
}

// ---------------------------------------------------------------------------
// 4. Error reporting (add_error)
//
// Legacy entry point used by all addons — now delegates to ErrorTracker.
// ---------------------------------------------------------------------------

function add_error(event, log = false) {
    if (log instanceof Error) {
        log.message = event + " " + (log.message || "");
        event = log;
        log = true;
    }
    if (log) {
        // console.error is already hooked by ErrorTracker, so this single
        // call captures the error in the structured tracking system.
        console.error(event);
    }
}

window.addEventListener('error', add_error, true);

// ---------------------------------------------------------------------------
// 5. Backend connection
// ---------------------------------------------------------------------------

const checkUrls = [];
if (window.location.protocol === "file:") {
    checkUrls.push("http://localhost:1337");
    checkUrls.push("http://localhost:8080");
}
if (["https:", "http:"].includes(window.location.protocol)) {
    checkUrls.push(window.location.origin);
}
checkUrls.push(G4F_HOST_PASS);

async function checkUrl(url, connectStatus) {
    let response;
    try {
        response = await fetch(`${url}/backend-api/v2/version?cache=true`, {signal: AbortSignal.timeout(10000)});
    } catch (error) {
        console.debug("Error check url: ", url, error);
        console.warn(`Backend unreachable: ${url} — ${error.message || error}`);
        return false;
    }
    if (response.ok) {
        connectStatus ? connectStatus.innerText = url : null;
        localStorage.setItem('backendUrl', url);
        framework.backendUrl = url;
        return true;
    }
    console.warn(`Backend responded ${response.status}: ${url}`);
    return false;
}

framework.backendUrl = localStorage.getItem('backendUrl') || '';
framework.logUrl = localStorage.getItem('log_routing') === 'true' ? `${framework.backendUrl}/api` : '';
framework.getRoutedUrl = (url) => framework.logUrl ? `${framework.logUrl}/${url}` : url;
framework.language = navigator.language === "de" ? 'de-DE' : navigator.language === "es" ? 'es-ES' : navigator.language;
framework.language = !framework.language || framework.language.startsWith("en") ? "en-US" : framework.language;

framework.connectToBackend = async (connectStatus) => {
    for (const url of checkUrls) {
        if(await checkUrl(url, connectStatus)) {
            return;
        }
    }
    if (framework.backendUrl) {
        if(await checkUrl(framework.backendUrl, connectStatus)) {
            return;
        }
        localStorage.removeItem('backendUrl');
        framework.backendUrl = "";
    }
};

function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

let newTranslations = [];
framework.translate = (text, escape = true) => {
    const stripText = text.replace(/\s+/g, ' ').trim();
    if (stripText) {
        const startWithSpace = text.startsWith(" ");
        const endWithSpace = text.endsWith(" ");
        if (!newTranslations.includes(stripText)) {
            newTranslations.push(stripText);
        }
        if (stripText in framework.translations && framework.translations[stripText]) {
            return (startWithSpace ? " " : "") + (escape ? escapeHtml(framework.translations[stripText]) : framework.translations[stripText]) + (endWithSpace ? " " : "");
        }
    }
    return text;
};
function hasWords(text) {
    return text.trim().match(/[a-zA-Z]+/gu)?.length > 0;
}
framework.translationKey = "translations" + document.location.pathname;
framework.translations = (() => {
    try {
        return JSON.parse(localStorage.getItem(framework.translationKey) || "{}");
    } catch (e) {
        return {};
    }
})();

// Persist translations and update the in-memory copy, so translateElements()
// can apply freshly fetched translations without a reload.
function storeTranslations(translations) {
    framework.translations = translations;
    localStorage.setItem(framework.translationKey, JSON.stringify(translations));
}

framework.translateElements = function (elements = null) {
    if (!framework.translations) {
        return;
    }
    elements = elements || document.querySelectorAll("*");
    elements.forEach(function (element) {
        let parent = element.parentElement;
        if (element.classList.contains("notranslate") || parent && parent.classList.contains("notranslate")) {
            return;
        }
        if (["SCRIPT", "STYLE"].includes(element.tagName)) {
            return;
        } 
        for (const child of element.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                if (hasWords(child.textContent)) {
                    child.textContent = framework.translate(child.textContent, false);
                }
            }
        }
        if (element.alt) {
            element.alt = framework.translate(element.alt, false);
        }
        if (element.title) {
            element.title = framework.translate(element.title, false);
        }
        if (element.placeholder) {
            element.placeholder = framework.translate(element.placeholder, false);
        }
    });
}
try {
    const lastConnect = parseInt(localStorage.getItem('lastConnectToBackend') || '0', 10);
    const oneHour = 60 * 60 * 1000;
    if (!framework.backendUrl || (Date.now() - lastConnect) > oneHour) {
        framework.connectToBackend().catch(e => add_error(`connectToBackend failed: ${e}`, e));
        localStorage.setItem('lastConnectToBackend', Date.now().toString());
    }
} catch (e) {
    add_error(`Backend connection init failed: ${e}`, e);
}
window.addEventListener('load', async () => {
    if (!document.body.classList.contains("translate")) {
        framework.translateElements();
        return;
    }
    const missing = newTranslations.filter(text => !framework.translations[text]);
    if (missing.length === 0) {
        // Everything is translated already — just apply it to the DOM.
        framework.translateElements();
        return;
    }
    try {
        if (await framework.translateAll()) {
            framework.translateElements();
        }
    } catch (e) {
        add_error(e, true);
    }
});

function filterMarkdown(text, allowedTypes = null, defaultValue = null) {
    const match = text.match(/```(.+)\n(?<code>[\s\S]+?)(\n```|$)/);
    if (match) {
        const [, type, code] = match;
        if (!allowedTypes || allowedTypes.includes(type)) {
            return code;
        }
    }
    return defaultValue;
}

async function query(prompt, options = { json: false, cache: true }) {
    if (options === true || options === false) {
        options = { json: options, cache: true };
    }
    const chatUrl = `https://g4f.space/v1/chat/completions`;
    const body = {
        messages: [
            {
                role: "user",
                content: prompt
            }
        ],
        ...(options.json ? {"response_format": {"type": "json_object"}} : {})
    };
    const request = () => fetch(chatUrl, {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
            "Content-Type": "application/json",
            ...(localStorage.getItem("g4f_session") ? {
                'Authorization': `Bearer ${localStorage.getItem("g4f_session")}`
            } : {})
        }
    });
    let response;
    try {
        response = await request();
        window.captureUserTierHeaders?.(response.headers);
    } catch (e) {
        add_error(`Error fetching URL: \`${chatUrl}\``, e);
    }
    if (response && !response.ok) {
        const delay = parseInt(response.headers.get('Retry-After'), 10);
        if (delay > 0 && delay <= 60) {
            console.log(`Retrying after ${delay} seconds...`);
            await new Promise(resolve => setTimeout(resolve, delay * 1000));
            try {
                response = await request();
                window.captureUserTierHeaders?.(response.headers);
            } catch (e) {
                add_error(`Error fetching URL: \`${chatUrl}\`\n ${e}`, e);
            }
        }
    }
    if (response && response.ok) {
        try {
            const json = await response.clone().json();
            const data = json.choices[0].message.content;
            if (options.json) {
                return new Response(filterMarkdown(data, ["json"], data), response);
            }
            return new Response(data, response);
        } catch (e) {
            add_error(`Error parsing JSON response from URL: \`${chatUrl}\`\n ${e}`, e);
        }
    }
    return response;
}

framework.translateAll = async () => {
    if (navigator.language === "en" || navigator.language.startsWith("en-")) {
        return false;
    }
    if (newTranslations.length === 0) {
        return false;
    }
    // Collect every text rendered so far, keeping translations that are
    // already known so a refetch never loses them.
    const allTranslations = {};
    newTranslations.forEach(text => {
        allTranslations[text] = framework.translations[text] || "";
    });
    // Reuse community translations from the challenge worker first — only
    // snippets nobody has translated yet go to the model.
    try {
        const communityRes = await fetch(`https://beta.g4f.dev/challenge/translations?lang=${encodeURIComponent(navigator.language)}`);
        if (communityRes.ok) {
            const community = (await communityRes.json()).translations || {};
            for (const [text, translated] of Object.entries(community)) {
                if (allTranslations.hasOwnProperty(text) && translated) {
                    allTranslations[text] = translated;
                }
            }
        }
    } catch (e) { /* community store unavailable — translate everything */ }
    const missing = Object.fromEntries(Object.entries(allTranslations).filter(([, translated]) => !translated));
    if (Object.keys(missing).length === 0) {
        storeTranslations(allTranslations);
        return allTranslations;
    }
    const jsonTranslations = "\n\n```json\n" + JSON.stringify(missing, null, 4) + "\n```";
    const languageName = navigator.language === "de" ? 'de-DE' : navigator.language === "es" ? 'es-ES' : navigator.language;
    const jsonLanguage = "`" + languageName + "`";
    const prompt = `Translate the following text snippets in a JSON object to ${jsonLanguage}: ${jsonTranslations} (iso-code)`;
    let response;
    try {
        response = await query(prompt, true);
    } catch (e) {
        add_error(`Translation query failed: ${e}`, e);
        return false;
    }
    let translations;
    try {
        translations = await response.json();
    } catch (e) {
        add_error(`Translation response parse failed: ${e}`, e);
        return false;
    }
    // The model may wrap the result in a per-language object.
    if (translations[navigator.language] && typeof translations[navigator.language] === 'object' && Object.keys(translations[navigator.language]).length > 0) {
        translations = translations[navigator.language];
    }
    if (typeof translations === 'object' && translations[newTranslations[0]]) {
        // Merge the model's answers into the full map instead of replacing it.
        for (const [text, translated] of Object.entries(translations)) {
            if (text in allTranslations && translated) {
                allTranslations[text] = translated;
            }
        }
        storeTranslations(allTranslations);
    } else if (Object.keys(missing).length < newTranslations.length) {
        // Model failed but community/stored translations covered part of the UI.
        storeTranslations(allTranslations);
    } else {
        add_error("Invalid translations received: " + JSON.stringify(translations), true);
    }
    return allTranslations;
}

function deleteTranslations() {
    let hasDeleted = false;
    for (let i = 0; i < localStorage.length; i++) {
        let key = localStorage.key(i);
        if (key.startsWith("translations")) {
            localStorage.removeItem(key);
            hasDeleted = true;
        }
    }
    return hasDeleted;
}
framework.delete = async (bucketId) => {
    const deleteUrl = `${framework.backendUrl}/backend-api/v2/files/${encodeURIComponent(bucketId)}`;
    return await fetch(deleteUrl, {
        method: 'DELETE'
    });
}
const sanitizedConfig = () => {
    return {
        allowedTags: window?.sanitizeHtml?.defaults.allowedTags.concat(['img', 'iframe', 'audio', 'video', 'details', 'summary', 'div']),
        allowedAttributes: {
            a: [ 'href', 'title', 'target', 'rel', 'data-width', 'data-height', 'data-src' ],
            i: [ 'class' ],
            span: [ 'class', 'style' ],
            code: [ 'class' ],
            img: [ 'src', 'alt', 'width', 'height' ],
            iframe: [ 'src', 'type', 'frameborder', 'allow', 'height', 'width' ],
            audio: [ 'src', 'controls' ],
            video: [ 'src', 'controls', 'loop', 'autoplay', 'muted' ],
            div: [ 'class' ]
        },
        allowedIframeHostnames: ['www.youtube.com'],
        allowedSchemes: [ 'http', 'https', 'data' ]
    }
};
const renderMarkdown = (content) => {
    if (!content) {
        return "";
    }
    if (Array.isArray(content)) {
        content = content.map((item) => {
            if (!item.name) {
                if (item.text) {
                    return item.text;
                }
                if (item.bucket_id) {
                    const size = parseInt(localStorage.getItem(`bucket:${item.bucket_id}`), 10);
                    return `**Bucket:** [[${item.bucket_id}]](${item.url})${size ? ` (${formatFileSize(size)})` : ""}`
                }
                return `![](${item.image_url?.url})`
            }
            if (item.name.endsWith(".wav") || item.name.endsWith(".mp3")) {
                return `<audio controls src="${item.url}"></audio>` + (item.text ? `\n${item.text}` : "");
            }
            if (item.name.endsWith(".mp4") || item.name.endsWith(".webm")) {
                return `<video controls src="${item.url}"></video>` + (item.text ? `\n${item.text}` : "");
            }
            if (item.width && item.height) {
                return `<a href="${item.url}" data-width="${item.width}" data-height="${item.height}"><img src="${item.url.replaceAll("/media/", "/thumbnail/") || item.image_url?.url}" alt="${framework.escape(item.name)}"></a>`;
            }
            return `[![${item.name}](${item.url.replaceAll("/media/", "/thumbnail/") || item.image_url?.url})](${item.url || item.image_url?.url})`;
        }).join("\n");
    }
    if (!window.markdownit) {
        console.warn("markdownit not loaded, falling back to escaped HTML");
        return escapeHtml(content);
    }
    let markdown;
    try {
        markdown = window.markdownit({
            html: window.sanitizeHtml ? true : false,
            breaks: true
        });
    } catch (e) {
        add_error(`markdownit init failed: ${e}`, e);
        return escapeHtml(content);
    }
    let rendered = content;
    try {
        if (rendered.includes('</think>')) {
            rendered = markdown.render(
                rendered.replaceAll('<think>', `<details><summary>${framework.translate('Reasoning')}</summary>`)
                .replaceAll('</think>', '\n</details>\n')
            )
        }
        if (rendered.includes('</thought>')) {
            rendered = markdown.render(
                rendered.replaceAll('<thought>', `<details><summary>${framework.translate('Reasoning')}</summary>`)
                .replaceAll('</thought>', '\n</details>\n')
            )
        }
        rendered = markdown.render(rendered)
        .replaceAll("<a href=", '<a target="_blank" href=')
        .replaceAll('<code>', '<code class="language-plaintext">')
        .replaceAll('<iframe src="', '<iframe frameborder="0" height="224" width="400" src="')
        .replaceAll('<iframe type="text/html" src="', '<iframe type="text/html" frameborder="0" allow="fullscreen" height="224" width="400" src="')
        .replaceAll('"></iframe>', `?enablejsapi=1"></iframe>`)
        .replaceAll('src="/media/', `src="${framework.backendUrl}/media/`)
        .replaceAll('src="/thumbnail/', `src="${framework.backendUrl}/thumbnail/`)
        .replaceAll('href="/media/', `href="${framework.backendUrl}/media/`)
    } catch (e) {
        add_error(`Markdown render failed: ${e}`, e);
        return escapeHtml(content);
    }
    if (window.sanitizeHtml) {
        try {
            rendered = window.sanitizeHtml(rendered, sanitizedConfig());
        } catch (e) {
            rendered = escapeHtml(rendered);
            add_error(`sanitizeHtml failed: ${e}`, e);
        }
    }
    return rendered;
};
// ---------------------------------------------------------------------------
// 7. DOM & string utilities
// ---------------------------------------------------------------------------

function nl2br(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML.replace(/\n/g, "<br>");
}
async function getPublicKey(backendUrl) {
    let response;
    try {
        response = await fetch(`${backendUrl || framework.backendUrl}/backend-api/v2/public-key`);
    } catch (e) {
        add_error(`Public key fetch failed: ${e}`, e);
        throw new Error("Failed to load public key: " + (e.message || e));
    }
    if (response.ok) {
        try {
            return await response.json();
        } catch (e) {
            add_error(`Public key parse failed: ${e}`, e);
            throw new Error("Failed to parse public key response");
        }
    }
    throw new Error("Failed to load public key");
}
async function getHeaders(){const _0x2658={};const _0x3f7c=localStorage.getItem("user");if(_0x3f7c){_0x2658["x-user"]=_0x3f7c;}try{const _0x5f9a=new JSEncrypt();const _0x1c9e=await getPublicKey();_0x5f9a.setPublicKey(_0x1c9e['public_key']);const _0x36a5=["x-","sec","ret"].join("");_0x2658[_0x36a5]=_0x5f9a.encrypt(_0x1c9e['data']);return {..._0x2658, ...(localStorage.getItem("g4f_session") ? {'authorization': `Bearer ${localStorage.getItem("g4f_session")}`} : {})};}catch(_0x4b7f){console.error("Encryption failed:",_0x4b7f);}return _0x2658;}
async function includeAdsense() {
    if (window.location.pathname.startsWith("/chat/")) {
        return;
    }
    const script = document.createElement("script");
    script.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5896143631849307";
    script.async = true;
    script.crossOrigin = "anonymous";
    document.head.appendChild(script);
}

// Global listener for content-rendered messages from child iframes
if (!framework._iframeResizeListenerAdded) {
    framework._iframeResizeListenerAdded = true;
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'g4f-content-rendered') {
            const iframes = document.querySelectorAll('iframe');
            iframes.forEach(iframe => {
                if (iframe.contentWindow === event.source) {
                    iframe.style.height = event.data.height + 'px';
                }
            });
        }
    });
}

framework.query = query;
framework.markdown = renderMarkdown;
framework.filterMarkdown = filterMarkdown;
framework.escape = escapeHtml;
framework.getHeaders = getHeaders;
framework.getPublicKey = getPublicKey;
framework.nl2br = nl2br;
framework.sanitizedConfig = sanitizedConfig;
framework.errors = ErrorTracker;

function openDB() {
  return new Promise((resolve, reject) => {
    let request;
    try {
        request = indexedDB.open(DB_NAME, VERSION);
    } catch (e) {
        console.error("IndexedDB open failed:", e);
        reject(e);
        return;
    }
    request.onerror = () => {
        console.error("IndexedDB open error:", request.error);
        reject(request.error);
    };
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

function withStore(mode) {
  return openDB().then(db => {
    const tx = db.transaction(STORE_NAME, mode);
    return {
      store: tx.objectStore(STORE_NAME),
      done: new Promise((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => {
            console.error("IndexedDB transaction error:", tx.error);
            rej(tx.error);
        };
      }),
    };
  }).catch(e => {
      console.error("IndexedDB withStore failed:", e);
      throw e;
  });
}

// Get one conversation by id
async function get_conversation(id) {
    if (!id) {
        return window.privateConversation;
    }
    try {
        const { store } = await withStore('readonly');
        return new Promise((resolve, reject) => {
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                console.error("IndexedDB get failed:", request.error);
                reject(request.error);
            };
        });
    } catch (e) {
        add_error(`get_conversation failed for id "${id}": ${e}`, e);
        return null;
    }
}

// Save conversation (insert or update)
async function save_conversation(conv) {
    if (!conv.id) {
        window.privateConversation = conv;
        return true;
    }
    try {
        const { store, done } = await withStore('readwrite');
        store.put(conv);
        return done;
    } catch (e) {
        add_error(`save_conversation failed for id "${conv.id}": ${e}`, e);
        return false;
    }
}

// List all conversations
async function list_conversations() {
  try {
    const { store } = await withStore('readonly');
    return new Promise((resolve, reject) => {
        const conversations = [];
        const request = store.openCursor();

        request.onsuccess = event => {
            const cursor = event.target.result;
            if (cursor) {
                const conversation = cursor.value;
                const hasUserContent = conversation.items && conversation.items.some(
                    item => item.role == 'user' && item.content && !["Hi", "Hello", "hi", "hello", "hey", ""].includes(item.content)
                );
                if ((hasUserContent || conversation.added > Date.now() - 24 * 60 * 60 * 1000) && conversation.title) {
                    conversations.push(conversation);
                } else {
                    delete_conversation(conversation.id);
                }
                cursor.continue();
            } else {
                resolve(conversations);
            }
        };

        request.onerror = () => {
            console.error("IndexedDB list cursor error:", request.error);
            reject(request.error);
        };
    });
  } catch (e) {
      console.error("IndexedDB not available:", e);
      add_error(`list_conversations failed: ${e}`, e);
      return [];
  }
}

const delete_conversation = async (id) => {
    try {
        const { store, done } = await withStore('readwrite');
        store.delete(id);
        return done;
    } catch (e) {
        add_error(`delete_conversation failed for id "${id}": ${e}`, e);
        return false;
    }
};

function chunkArray(array, chunkSize) {
    return Array.from(
        { length: Math.ceil(array.length / chunkSize) },
        (_, index) => array.slice(index * chunkSize, index * chunkSize + chunkSize)
    );
}

if (window.location.origin === G4F_HOST || window.location.origin.endsWith(G4F_WILDCARD)) {
    if (window.self === window.top) {
        if (!["/members", "/members.html"].includes(location.pathname)) {
            includeAdsense().catch(e => add_error(`Adsense load failed: ${e}`, e));
        }
    }
}

// Expose module-style exports as window globals (classic script — loaded
// directly by the pages instead of through the v2.js addon loader).
Object.assign(window, {
    framework,
    get_conversation,
    save_conversation,
    list_conversations,
    delete_conversation,
    chunkArray,
    add_error,
    ErrorTracker,
    getHeaders,
    escapeHtml,
    deleteTranslations,
});

// Live bindings for the log panel: getters so window.logStorage /
// window.logContent always reflect the current elements instead of the
// null captured at head-parse time.
Object.defineProperties(window, {
    logStorage: { get: () => logStorage, configurable: true },
    logContent: { get: () => logContent, configurable: true },
});