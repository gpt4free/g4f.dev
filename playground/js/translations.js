window.framework = window.framework || {};
framework.backendUrl = "";

let newTranslations = [];

// Pre-populate newTranslations from snippets.json so translateAll() covers
// strings that may not have been rendered yet.
fetch('js/snippets.json')
    .then(r => r.json())
    .then(snippets => {
        for (const key of Object.keys(snippets)) {
            if (!newTranslations.includes(key)) {
                newTranslations.push(key);
            }
        }
    })
    .catch(() => {});

framework.translate = (text) => {
    const stripText = text.trim().replace(/\s+/g, ' ');
    if (stripText) {
        const startWithSpace = text.startsWith(" ");
        const endWithSpace = text.endsWith(" ");
        if (stripText in framework.translations && framework.translations[stripText]) {
            return (startWithSpace ? " " : "") + framework.translations[stripText] + (endWithSpace ? " " : "");
        }
        stripText && !newTranslations.includes(stripText) ? newTranslations.push(stripText) : null;
    }
    return text;
};

function countWords(text) {
    return text.trim().match(/[\w\u4E00-\u9FA5]+/gu)?.length || 0;
}

framework.translationKey = "translations" + document.location.pathname;
framework.translations = {};
try {
    const storedTranslations = localStorage.getItem(framework.translationKey);
    if (storedTranslations) {
        framework.translations = JSON.parse(storedTranslations);
        const btn = document.getElementById("btn-translate");
        if (btn) {
            btn.textContent += " ✕";
            btn.title = framework.translate('Reset Translations');
            btn.onclick = function () {
                deleteTranslations();
                window.location.reload();
            };
        }
    }
} catch (e) {
    console.error("Failed to parse stored translations:", e);
}

framework.translateElements = function (check = null) {
    if (!framework.translations) {
        return;
    }
    const elements = check || document.querySelectorAll("*");
    elements.forEach(function (element) {
        let parent = element.parentElement;
        if (element.classList.contains("notranslate")) {
            return;
        }
        if (element.parentElement?.classList.contains("notranslate")) {
            return;
        }
        if (element.dataset.translated === "true") {
            return;
        }
        if (["SCRIPT", "STYLE", "OPTION"].includes(element.tagName)) {
            return;
        }
        element.childNodes.forEach(child => {
            if (child.nodeType === Node.TEXT_NODE) {
                if (countWords(child.textContent) > 0) {
                    child.textContent = framework.translate(child.textContent);
                }
            }
        });
        if (element.alt) {
            element.alt = framework.translate(element.alt);
        }
        if (element.title) {
            element.title = framework.translate(element.title);
        }
        if (element.placeholder) {
            element.placeholder = framework.translate(element.placeholder);
        }
        if (element.classList.contains("title-input") && element.value) {
            element.value = framework.translate(element.value);
        }
        if (check) {
            element.dataset.translated = "true";
        }
    });
};


function deleteTranslations() {
    localStorage.removeItem(framework.translationKey);
}

function btnTranslate(btn) {
    btn.textContent = framework.translate('⏳ Translating');
    let dotCount = 0;
    const interval = setInterval(() => {
        btn.textContent = framework.translate('⏳ Translating') + '.'.repeat((dotCount + 1) % 4);
        dotCount = (dotCount + 1) % 4;
    }, 500);
    btn.disabled = true;
    framework.translateAll()
        .then(result => {
            if (result) {
                window.location.reload();
            } else {
                clearInterval(interval);
                btn.textContent = framework.translate('🌐');
                btn.disabled = false;
            }
        })
        .catch(() => {
            clearInterval(interval);
            btn.textContent = framework.translate('🌐');
            btn.disabled = false;
        });
}

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
    const encodedParams = (new URLSearchParams(options)).toString();
    const secondPartyUrl = `https://g4f.space/ai/auto/${encodeURIComponent(prompt)}?${encodedParams}`;
    let response;
    try {
        response = await fetch(secondPartyUrl, {
            headers: localStorage.getItem("session_token") ? {
                'Authorization': `Bearer ${localStorage.getItem("session_token")}`
            } : {}
        });
        window.captureUserTierHeaders?.(response.headers);
    } catch (e) {
        console.warn(`Error fetching URL: \`${secondPartyUrl}\``, e);
    }
    if (response && !response.ok) {
        const delay = parseInt(response.headers.get('Retry-After'), 10);
        if (delay > 0 && delay <= 60) {
            console.log(`Retrying after ${delay} seconds...`);
            await new Promise(resolve => setTimeout(resolve, delay * 1000));
            try {
                response = await fetch(secondPartyUrl, {
                    headers: localStorage.getItem("session_token") ? {
                        'Authorization': `Bearer ${localStorage.getItem("session_token")}`
                    } : {}
                });
                window.captureUserTierHeaders?.(response.headers);
            } catch (e) {
                console.warn(`Error fetching URL: \`${secondPartyUrl}\``, e);
            }
        }
    }
    if (!response || !response.ok) {
        if (response) {
            console.warn(`Error ${response.status} with URL: \`${secondPartyUrl}\`\n ${await response.clone().text()}`);
        }
        const firstPartyUrl = `https://g4f.space/ai/pollinations/${encodeURIComponent(prompt)}?${encodedParams}`;
        response = await fetch(firstPartyUrl, { headers: { "Authorization": `Bearer ${["sk", "_fPLVqg5vAQRCZWzPoYUG6dzSu5czowKf"].join("")}` } });
        if (!response.ok) {
            console.warn(`Error ${response.status} with URL: \`${firstPartyUrl}\`\n ${await response.clone().text()}`);
            return response;
        }
    }
    if (options.json) {
        try {
            try {
                await response.clone().json();
            } catch (e) {
                const text = await response.clone().text();
                return new Response(filterMarkdown(text, ["json"], text), response);
            }
        } catch (e) {
            console.warn(`Error parsing JSON response from URL: \`${response.url}\``, e);
        }
    }
    return response;
}

framework.translateAll = async () => {
    if (navigator.language === "en" || navigator.language.startsWith("en-")) {
        return false;
    }
    let allTranslations = {};
    newTranslations.forEach(text => {
        allTranslations[text] = "";
    });
    const jsonTranslations = "\n\n```json\n" + JSON.stringify(allTranslations) + "\n```";
    const languageName = navigator.language === "de" ? 'de-DE' : navigator.language === "es" ? 'es-ES' : navigator.language;
    const jsonLanguage = "`" + languageName + "`";
    const prompt = `Translate the following text snippets in a JSON object to ${jsonLanguage}: ${jsonTranslations} (iso-code)`;
    const response = await query(prompt, true);
    if (!response.ok) {
        return false;
    }
    let translations = await response.json();
    if (translations[navigator.language] && typeof translations[navigator.language] === 'object' && Object.keys(translations[navigator.language]).length > 0) {
        translations = translations[navigator.language];
    }
    localStorage.setItem(framework.translationKey, JSON.stringify(translations));
    return allTranslations;
};

try {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            framework.translateElements();
        });
    } else {
        framework.translateElements();
    }
} catch (e) {
    console.warn(e);
}
