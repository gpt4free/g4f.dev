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
// selection page wins, navigator.language is the fallback for explicit
// translate actions. Automatic translation never guesses the language; it
// detects a candidate with framework.detectLanguage() and asks first through
// framework.maybePromptTranslation().
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

// In-memory view of the community translations for the currently selected
// language. Populated from the global store at startup and refreshed by
// loadGlobalTranslations()/translateAll() — there are no per-page caches and
// no model-generated translations anymore; the community store is the only
// source.
framework.translations = (() => {
    try {
        // Only an explicit selection may preload a package. Falling back to
        // navigator.language here used to translate the page silently; the
        // detected language is now offered through a confirmation prompt
        // instead (see maybePromptTranslation()).
        const selected = framework.getSelectedLanguage ? framework.getSelectedLanguage() : null;
        const base = (selected || "").split(/[-_]/)[0].toLowerCase();
        const entry = base ? framework.globalTranslations?.[base] : null;
        return entry?.translations ? {...entry.translations} : {};
    } catch (e) {
        return {};
    }
})();

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
    // Refresh the in-memory view when this package is the active selection,
    // so newly loaded community translations apply without a reload.
    if (framework.getSelectedLanguage && framework.getSelectedLanguage() === entry.language) {
        framework.translations = {...entry.translations};
    }
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
        if (framework.getSelectedLanguage && framework.getSelectedLanguage() === base) {
            framework.translations = {};
        }
    } else if (framework.globalTranslations && Object.keys(framework.globalTranslations).length) {
        framework.globalTranslations = {};
        framework.translations = {};
        cleared = true;
    }
    if (clearLocal) {
        cleared = framework.deleteTranslations() || cleared;
    }
    storeGlobalTranslations(framework.globalTranslations);
    return cleared;
};

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
// ---- Language detection & consent prompt --------------------------------
// Translations are never applied just because the browser reports a
// language. detectLanguage() suggests a target (browser locales first, then
// the IP country served by /country-ip) and maybePromptTranslation() asks the
// visitor before any community package is loaded.
const DISMISSED_PROMPT_KEY = "translationPromptDismissed";
const COUNTRY_LANGUAGES = {
    ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es",
    UY: "es", PY: "es", BO: "es", EC: "es", CR: "es", PA: "es", DO: "es",
    GT: "es", HN: "es", SV: "es", NI: "es", CU: "es", PR: "es",
    FR: "fr", BE: "fr", CH: "fr", CA: "fr", LU: "fr", MC: "fr", SN: "fr",
    CI: "fr", CM: "fr", HT: "fr",
    DE: "de", AT: "de", LI: "de",
    IT: "it", PT: "pt", BR: "pt", NL: "nl", PL: "pl", RU: "ru", UA: "uk",
    TR: "tr", CN: "zh", TW: "zh", HK: "zh", JP: "ja", KR: "ko", IN: "hi",
    SA: "ar", AE: "ar", EG: "ar", IL: "he", ID: "id", VN: "vi", TH: "th",
    SE: "sv", DK: "da", FI: "fi", NO: "nb", CZ: "cs", GR: "el", HU: "hu",
    RO: "ro", BG: "bg",
};

function baseLanguage(tag) {
    return String(tag || "").split(/[-_]/)[0].toLowerCase();
}

function dismissedPromptLanguages() {
    try {
        const parsed = JSON.parse(localStorage.getItem(DISMISSED_PROMPT_KEY) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
        return {};
    }
}

function dismissTranslationPrompt(language) {
    try {
        const dismissed = dismissedPromptLanguages();
        dismissed[language] = true;
        localStorage.setItem(DISMISSED_PROMPT_KEY, JSON.stringify(dismissed));
    } catch (e) { /* private mode — the prompt may reappear */ }
}

function languageDisplayName(language) {
    try {
        const names = new Intl.DisplayNames([navigator.language || "en"], {type: "language"});
        return names.of(language) || language;
    } catch (e) {
        return language;
    }
}

/** Detect a likely translation target: browser languages win over the IP
 *  country. Returns {language, source, country?} or null. Every failure is
 *  non-fatal so static hosting and private mode keep working. */
framework.detectLanguage = async () => {
    const candidates = Array.isArray(navigator.languages) && navigator.languages.length
        ? navigator.languages
        : [navigator.language];
    for (const tag of candidates) {
        const base = baseLanguage(tag);
        if (base && base !== "en") {
            return {language: base, source: "browser"};
        }
    }
    let country = typeof window.g4fCountry === "string" ? window.g4fCountry.toUpperCase() : "";
    if (!country) {
        country = (document.documentElement.getAttribute("data-g4f-country") || "").toUpperCase();
    }
    if (!country) {
        try {
            const response = await fetch("/country-ip", {
                cache: "no-store",
                signal: AbortSignal.timeout(2500),
            });
            if (response.ok) {
                const data = await response.json();
                country = String(data.country || "").toUpperCase();
            }
        } catch (e) { /* static hosting has no geo endpoint */ }
    }
    const language = country ? COUNTRY_LANGUAGES[country] : null;
    if (language && language !== "en") {
        return {language, source: "country", country};
    }
    return null;
};

/** Ask before switching the UI language. Returns true when the prompt was
 *  shown (it removes itself on Translate / Not now). */
framework.askForTranslation = (language, options = {}) => {
    if (!language || language === "en" || !document.body) {
        return false;
    }
    if (document.getElementById("g4f-translate-prompt")) {
        return false;
    }
    const name = languageDisplayName(language);
    const prompt = document.createElement("div");
    prompt.id = "g4f-translate-prompt";
    prompt.className = "notranslate";
    prompt.setAttribute("role", "dialog");
    prompt.setAttribute("aria-live", "polite");
    prompt.style.cssText = [
        "position:fixed", "left:50%", "bottom:24px", "transform:translateX(-50%)",
        "z-index:2147483647", "max-width:min(92vw,420px)", "display:flex",
        "flex-direction:column", "gap:10px", "padding:14px 16px",
        "border:1px solid rgba(163,230,53,.45)", "border-radius:14px",
        "background:#0b100a", "color:#eef5e4", "font:14px/1.4 system-ui,sans-serif",
        "box-shadow:0 12px 40px rgba(0,0,0,.55)", "box-sizing:border-box",
    ].join(";");

    const message = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `Translate this page to ${name}?`;
    const reason = document.createElement("div");
    reason.style.cssText = "color:#9fb08c;font-size:12px;margin-top:4px";
    reason.textContent = options.source === "country"
        ? "Detected from your approximate location."
        : "Detected from your browser language.";
    message.append(title, reason);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end";
    const button = (label, primary) => {
        const el = document.createElement("button");
        el.type = "button";
        el.textContent = label;
        el.style.cssText = [
            "cursor:pointer", "border-radius:9px", "padding:7px 12px",
            "font:inherit", "font-size:13px",
            primary
                ? "border:1px solid #a3e635;background:#a3e635;color:#0b100a;font-weight:600"
                : "border:1px solid rgba(163,230,53,.3);background:transparent;color:#eef5e4",
        ].join(";");
        return el;
    };
    const accept = button(`Translate to ${name}`, true);
    const decline = button("Not now", false);
    const choose = button("Choose language", false);
    actions.append(choose, decline, accept);
    prompt.append(message, actions);

    decline.addEventListener("click", () => {
        dismissTranslationPrompt(language);
        prompt.remove();
    });
    choose.addEventListener("click", () => {
        dismissTranslationPrompt(language);
        prompt.remove();
        if (typeof window.open_language_selection === "function") {
            window.open_language_selection();
        } else {
            window.location.href = "/language-selection.html";
        }
    });
    accept.addEventListener("click", async () => {
        accept.disabled = decline.disabled = choose.disabled = true;
        title.textContent = "Loading translations…";
        try {
            const entry = await framework.loadGlobalTranslations(language);
            if (!entry || !entry.count) {
                title.textContent = `No ${name} translations are available yet.`;
                reason.textContent = "You can keep using English or pick another language.";
                accept.remove();
                decline.textContent = "Close";
                decline.disabled = choose.disabled = false;
                return;
            }
            framework.setSelectedLanguage(language);
            framework.translations = {...entry.translations};
            framework.translateElements();
            if (typeof framework.translateAll === "function") {
                await framework.translateAll().catch(() => {});
            }
            prompt.remove();
        } catch (e) {
            title.textContent = "Translations could not be loaded.";
            reason.textContent = String(e.message || e);
            accept.disabled = decline.disabled = choose.disabled = false;
        }
    });

    document.body.appendChild(prompt);
    return true;
};

/** Called on load for pages that opted into translation (body.translate).
 *  An explicit selection is applied directly; otherwise the detected
 *  language is offered and only applied after the visitor accepts. */
framework.maybePromptTranslation = async () => {
    if (!document.body || !document.body.classList.contains("translate")) {
        return null;
    }
    if (framework.getSelectedLanguage && framework.getSelectedLanguage()) {
        return null;
    }
    if (/\/language-selection\.html?$/.test(location.pathname)) {
        return null;
    }
    if (document.getElementById("g4f-translate-prompt")) {
        return null;
    }
    const detected = await framework.detectLanguage();
    if (!detected || dismissedPromptLanguages()[detected.language]) {
        return null;
    }
    framework.askForTranslation(detected.language, detected);
    return detected.language;
};

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
    if (framework.getSelectedLanguage && framework.getSelectedLanguage()) {
        // An explicit selection (URL locale or language selection page) may
        // be applied immediately.
        try {
            await framework.translateAll();
        } catch (e) {
            add_error(e, true);
        }
        return;
    }
    try {
        await framework.maybePromptTranslation();
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
    // Community translations are the only source: refresh the package for
    // the target language from the challenge worker and apply it to every
    // text rendered so far. No model queries, no per-page persistence.
    let community = null;
    try {
        const entry = await framework.loadGlobalTranslations(targetLanguage);
        community = entry.translations;
    } catch (e) {
        add_error(`Community translation store unavailable: ${e}`, e);
        const base = targetLanguage.split(/[-_]/)[0].toLowerCase();
        community = framework.globalTranslations?.[base]?.translations;
    }
    if (!community || Object.keys(community).length === 0) {
        return false;
    }
    const translations = {};
    newTranslations.forEach(text => {
        if (community[text]) {
            translations[text] = community[text];
        }
    });
    if (Object.keys(translations).length === 0) {
        return false;
    }
    framework.translations = translations;
    framework.translateElements();
    return translations;
}

framework.deleteAllTranslations = () => {
    framework.setSelectedLanguage();
    return framework.deleteTranslations();
}

framework.deleteTranslations = () => {
    let hasDeleted = false;
    // Legacy per-page translation caches (no longer written) + in-memory copy.
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith("translations")) {
            localStorage.removeItem(key);
            hasDeleted = true;
        }
    }
    if (framework.translations && Object.keys(framework.translations).length) {
        framework.translations = {};
        hasDeleted = true;
    }
    if (localStorage.getItem(GLOBAL_TRANSLATIONS_KEY)) {
        localStorage.removeItem(GLOBAL_TRANSLATIONS_KEY);
        hasDeleted = true;
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
        if (!document.body.classList.contains("noads")) {
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
    deleteTranslations: framework.deleteTranslations,
    deleteAllTranslations: framework.deleteAllTranslations,
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