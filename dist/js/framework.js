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
 *   3. Error reporting (add_error)
 *   4. Backend connection
 *   5. Translations
 *   6. DOM & string utilities
 *   7. Markdown rendering & model queries
 *   8. Auth headers
 *   9. Conversation storage (IndexedDB)
 *  10. Ads & iframe messaging
 *  11. Public API exports
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
            debugEl.src = '/dist/js/debug.js';
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
// 3. Error reporting (add_error)
//
// Legacy entry point used by all addons — delegates to ErrorTracker
// (window.ErrorTracker, provided by debug.js) when present.
// ---------------------------------------------------------------------------

function add_error(event, log = false) {
    if (log instanceof Error) {
        log.message = event + " " + (log.message || "");
        event = log;
        log = true;
    }
    if (log) {
        // console.error is hooked by ErrorTracker (debug.js) when loaded.
        console.error(event);
    }
}

window.addEventListener('error', add_error, true);

// ---------------------------------------------------------------------------
// 4. Backend connection
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
// Central language resolution: the language package selected on the language
// selection page wins, navigator.language is the fallback. Everything that
// needs "the user's language" should go through this helper.
framework.getLanguage = () => {
    const selected = framework.getSelectedLanguage ? framework.getSelectedLanguage() : null;
    return selected || navigator.language || "en-US";
};
// Normalized display locale ("de" → "de-DE", "en*" → "en-US"), always
// reflecting the current selection.
Object.defineProperty(framework, "language", {
    get: () => {
        const lang = framework.getLanguage();
        const locale = lang === "de" ? 'de-DE' : lang === "es" ? 'es-ES' : lang;
        return !locale || locale.startsWith("en") ? "en-US" : locale;
    },
    configurable: true,
});

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
    if (stripText && !stripText.startsWith("https://") && !stripText.startsWith("http://")) {
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

// ---- Global translations store -------------------------------------------
// Community translations from the challenge worker, kept per base language
// ("de-DE" → "de") in localStorage under "globalTranslations". Used by
// translateAll() as a free first source and by the translations UI to show
// coverage per language.
const GLOBAL_TRANSLATIONS_KEY = "globalTranslations";
const CHALLENGE_TRANSLATIONS_URL = "https://beta.g4f.dev/challenge/translations";
framework.globalTranslations = (() => {
    try {
        return JSON.parse(localStorage.getItem(GLOBAL_TRANSLATIONS_KEY) || "{}");
    } catch (e) {
        return {};
    }
})();

function storeGlobalTranslations(store) {
    framework.globalTranslations = store || {};
    try {
        localStorage.setItem(GLOBAL_TRANSLATIONS_KEY, JSON.stringify(framework.globalTranslations));
    } catch (e) { /* private mode — in-memory copy still works */ }
}

// Single-selection policy: only one community language package stays loaded
// at a time. The language selection page stores the chosen base language here
// and unloads the previous package when a new one is picked.
const SELECTED_LANGUAGE_KEY = "selectedTranslationLanguage";
framework.getSelectedLanguage = () => {
    try {
        return localStorage.getItem(SELECTED_LANGUAGE_KEY);
    } catch (e) {
        return null;
    }
};
framework.setSelectedLanguage = (language) => {
    try {
        if (language) {
            localStorage.setItem(SELECTED_LANGUAGE_KEY, language);
        } else {
            localStorage.removeItem(SELECTED_LANGUAGE_KEY);
        }
    } catch (e) { /* private mode — selection stays in-memory only */ }
};

/** Fetch the community translation store for one base language and merge it
 *  into the global store. Returns the entry: {language, count, translations,
 *  total?, remaining?, percent?} — progress fields come from the worker when
 *  its snippet catalog is loadable. */
framework.loadGlobalTranslations = async (language) => {
    const base = (language || framework.getLanguage() || "en").split(/[-_]/)[0].toLowerCase();
    if (!base || base === "en") {
        throw new Error("invalid_language");
    }
    const response = await fetch(`${CHALLENGE_TRANSLATIONS_URL}?lang=${encodeURIComponent(base)}`);
    if (!response.ok) {
        throw new Error(`translations fetch failed: HTTP ${response.status}`);
    }
    const data = await response.json();
    const entry = {
        language: data.language || base,
        count: data.count || 0,
        translations: data.translations || {},
    };
    if (typeof data.total === "number") {
        entry.total = data.total;
        entry.remaining = data.remaining;
        entry.percent = data.percent;
    }
    const store = framework.globalTranslations || {};
    store[entry.language] = entry;
    storeGlobalTranslations(store);
    return entry;
};

/** List every language in the community store with translation counts and
 *  translated percent: {languages: [{language, count, total?, remaining?,
 *  percent?}], total_snippets}. Cached for 60s by the worker. */
framework.listGlobalTranslations = async () => {
    const response = await fetch(`${CHALLENGE_TRANSLATIONS_URL}/languages`);
    if (!response.ok) {
        throw new Error(`translations listing failed: HTTP ${response.status}`);
    }
    return await response.json();
};

/** Clear translations: without arguments the global community store (and,
 *  with clearLocal, the per-page localStorage copies too). With a language,
 *  only that language's community entry is dropped. Server-side clearing is
 *  an admin action on the worker (DELETE /challenge/translations). */
framework.clearTranslations = (language = null, clearLocal = false) => {
    let cleared = false;
    if (language) {
        const base = String(language).split(/[-_]/)[0].toLowerCase();
        if (framework.globalTranslations && framework.globalTranslations[base]) {
            delete framework.globalTranslations[base];
            cleared = true;
        }
    } else if (framework.globalTranslations && Object.keys(framework.globalTranslations).length) {
        framework.globalTranslations = {};
        cleared = true;
    }
    if (clearLocal) {
        cleared = deleteTranslations() || cleared;
        framework.translations = {};
    }
    storeGlobalTranslations(framework.globalTranslations);
    return cleared;
};

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
    framework.translateElements();
    const missing = newTranslations.filter(text => !framework.translations[text]);
    if (missing.length === 0) {
        return;
    }
    if (!document.body.classList.contains("translate") && !framework.getSelectedLanguage()) {
        return;
    }
    try {
        // translateAll() persists and applies whatever it could translate
        // (community store and/or model) — no reload needed.
        await framework.translateAll();
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
    const targetLanguage = framework.getLanguage();
    if (targetLanguage === "en" || targetLanguage.startsWith("en-")) {
        return false;
    }
    if (newTranslations.length === 0) {
        console.log("No new translations to process.");
        return false;
    }
    // Collect every text rendered so far, keeping translations that are
    // already known so a refetch never loses them.
    const allTranslations = {};
    newTranslations.forEach(text => {
        allTranslations[text] = framework.translations[text] || "";
    });
    // Reuse community translations from the global store / challenge worker
    // first — only snippets nobody has translated yet go to the model.
    try {
        const base = targetLanguage.split(/[-_]/)[0].toLowerCase();
        let community = framework.globalTranslations?.[base]?.translations;
        if (!community || Object.keys(community).length === 0) {
            const entry = await framework.loadGlobalTranslations(targetLanguage);
            community = entry.translations;
        }
        for (const [text, translated] of Object.entries(community || {})) {
            if (allTranslations.hasOwnProperty(text) && translated) {
                allTranslations[text] = translated;
            }
        }
    } catch (e) {
        add_error(`Community translation store unavailable: ${e}`, e);
    }
    const missing = Object.fromEntries(Object.entries(allTranslations).filter(([, translated]) => !translated));
    if (Object.keys(missing).length === 0) {
        storeTranslations(allTranslations);
        // Apply to the DOM here too — this path previously returned without
        // rendering, leaving the first visit in the source language.
        framework.translateElements();
        return allTranslations;
    }
    const jsonTranslations = "\n\n```json\n" + JSON.stringify(missing, null, 4) + "\n```";
    const languageName = targetLanguage === "de" ? 'de-DE' : targetLanguage === "es" ? 'es-ES' : targetLanguage;
    const jsonLanguage = "`" + languageName + "`";
    const prompt = `Translate the following text snippets in a JSON object to ${jsonLanguage}: ${jsonTranslations} (iso-code)`;
    // Ask the model for the missing snippets. A failure here must not
    // discard the translations collected so far (community + stored).
    let translations = null;
    try {
        const response = await query(prompt, true);
        if (response && response.ok) {
            translations = await response.json();
        } else {
            add_error(`Translation query failed: HTTP ${response ? response.status : "no response"}`, true);
        }
    } catch (e) {
        add_error(`Translation query failed: ${e}`, e);
    }
    // The model may wrap the result in a per-language object.
    if (translations && translations[targetLanguage] && typeof translations[targetLanguage] === 'object' && Object.keys(translations[targetLanguage]).length > 0) {
        translations = translations[targetLanguage];
    }
    if (translations && typeof translations === 'object') {
        // Merge the model's answers into the full map instead of replacing it.
        // Models often answer only part of a batch or rephrase keys — accept
        // every entry whose key matches a requested snippet (whitespace
        // normalized) and only report an error when nothing usable came back.
        let matched = 0;
        for (const [text, translated] of Object.entries(translations)) {
            const key = String(text).replace(/\s+/g, ' ').trim();
            if (key in allTranslations && translated) {
                allTranslations[key] = translated;
                matched += 1;
            }
        }
        if (matched === 0) {
            add_error("Invalid translations received: " + JSON.stringify(translations), true);
        }
    }
    // Persist and apply whatever is covered — even when the model query
    // failed, community/stored translations must still reach the UI.
    if (Object.values(allTranslations).some(Boolean)) {
        storeTranslations(allTranslations);
        framework.translateElements();
        return allTranslations;
    }
    return false;
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

framework.query = query;
framework.markdown = renderMarkdown;
framework.filterMarkdown = filterMarkdown;
framework.escape = escapeHtml;
framework.getHeaders = getHeaders;
framework.getPublicKey = getPublicKey;
framework.nl2br = nl2br;
framework.sanitizedConfig = sanitizedConfig;
framework.errors = window.ErrorTracker || null;

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
        if (window.deleteSecretConversation) {
            window.deleteSecretConversation(id);
        }
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
    getHeaders,
    escapeHtml,
    deleteTranslations,
    storeGlobalTranslations,
    getSelectedLanguage: framework.getSelectedLanguage,
    setSelectedLanguage: framework.setSelectedLanguage,
});

// Live bindings for the log panel: getters so window.logStorage /
// window.logContent always reflect the current elements instead of the
// null captured at head-parse time.
Object.defineProperties(window, {
    logStorage: { get: () => logStorage, configurable: true },
    logContent: { get: () => logContent, configurable: true },
});