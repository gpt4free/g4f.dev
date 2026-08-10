/* ================================================================== *
 * Addon: Message Renderers
 *
 * Custom message renderers and formatting.
 * ================================================================== */

(function () {
    'use strict';

    ChatAddons.register({
        id: 'builtin:renderers',
        name: 'Message Renderers',
        version: '1.0.0',
        description: 'Custom message renderers and formatting.',
        author: 'g4f',
        builtin: true,
        permissions: ['dom:write'],

        load() {
            return (async () => {});
        }
    })
})();


function render_reasoning(reasoning, final = false) {
    const inner_text = reasoning.text ? `<div class="reasoning_text${final ? " final hidden" : ""}">
        ${renderer(reasoning.text)}
    </div>` : "";
    return `<div class="reasoning_body">
        <div class="reasoning_title">
        <strong>${reasoning.label ? reasoning.label : framework.translate('Reasoning') + ' <i class="brain">🧠</i>'}: </strong>
        ${typeof reasoning.status === 'string' ? framework.escape(reasoning.status) : '<i class="fas fa-spinner fa-spin"></i>'}
        </div>
        ${inner_text}
    </div>`;
}

function render_reasoning_text(reasoning) {
    return `${reasoning.label ? reasoning.label : framework.translate('Reasoning') + ' 🧠'}: ${reasoning.status}\n\n${reasoning.text}\n\n`;
}

function filter_message(text) {
    if (Array.isArray(text) || !text) {
        return text;
    }
    // Remove images from text
    return filter_message_content(text.replaceAll(
        /!\[.*?\]\(.*?\)/gm, ""
    ))
}

function filter_message_content(text) {
    if (Array.isArray(text) || !text) {
        return text;
    }
    return text.replace(/ \[aborted\]$/g, "").replace(/ \[error\]$/g, "")
}

function fallback_clipboard (text) {
    var textBox = document.createElement("textarea");
    textBox.value = text;
    textBox.style.top = "0";
    textBox.style.left = "0";
    textBox.style.position = "fixed";
    document.body.appendChild(textBox);
    textBox.focus();
    textBox.select();
    try {
        var success = document.execCommand('copy');
        var msg = success ? 'succeeded' : 'failed';
        console.log('Clipboard Fallback: Copying text command ' + msg);
    } catch (e) {
        console.error('Clipboard Fallback: Unable to copy', e);
    }
    document.body.removeChild(textBox);
}
let iframe_container;
document.addEventListener("DOMContentLoaded", () => {
    iframe_container = document.querySelector(".hljs-iframe-container");
    const iframe = document.querySelector(".hljs-iframe");
    const iframe_close = Object.assign(document.createElement("button"), {
        className: "hljs-iframe-close",
        innerHTML: '<i class="fa-regular fa-x"></i>',
    });
    iframe_close.onclick = () => {
        iframe_container.classList.add("hidden");
        iframe.src = "";
    }
    iframe_container.appendChild(iframe_close);
});

class HtmlRenderPlugin {
    constructor(options = {}) {
        self.hook = options.hook;
        self.callback = options.callback
    }
    "after:highlightElement"({
        el,
        text
    }) {
        if (!el.classList.contains("language-html") && !el.classList.contains("language-svg")) {
            return;
        }
        let button = Object.assign(document.createElement("button"), {
            innerHTML: '<i class="fa-regular fa-folder-open"></i>',
            className: "hljs-iframe-button",
        });
        el.parentElement.appendChild(button);
        button.onclick = async () => {
            let newText = text;
            if (hook && typeof hook === "function") {
                newText = hook(text, el) || text
            }
            const mimeType = el.classList.contains("language-svg") ? "image/svg+xml" : "text/html";
            iframe.src = `data:${mimeType};charset=utf-8,${encodeURIComponent(newText)}`;
            iframe_container.classList.remove("hidden");
            if (typeof callback === "function") return callback(newText, el);
        }
    }
}
let typesetPromise = Promise.resolve();
let hljs_loaded = false;
const highlight = (container) => {
    if (window.hljs) {
        if (window.hljs && !hljs_loaded) {
            hljs.addPlugin(new HtmlRenderPlugin());
            if (typeof CopyButtonPlugin === 'function') {
                hljs.addPlugin(new CopyButtonPlugin());
                hljs_loaded = true;
            }
        }
        container.querySelectorAll('code:not(.hljs)').forEach((el) => {
            if (el.className != "hljs") {
                hljs.highlightElement(el);
            }
        });
    }
    if (window.MathJax && window.MathJax.typesetPromise) {
        typesetPromise = typesetPromise.then(
            () => MathJax.typesetPromise([container])
        ).catch(
            (err) => console.log('Typeset failed: ' + err.message)
        );
    }
}

const get_message_el = (el) => {
    let message_el = el;
    while(!(message_el.classList.contains('message')) && message_el.parentElement) {
        message_el = message_el.parentElement;
    }
    if (message_el.classList.contains('message')) {
        return message_el;
    }
}

function register_message_images() {
    chatBody.querySelectorAll(".message .fa-clipboard").forEach(async (el) => {
        if (el.dataset.click) {
            return
        }
        el.dataset.click = true;
        el.addEventListener("click", async () => {
            let message_el = get_message_el(el);
            let response = await fetch(message_el.dataset.object_url);
            let copyText = await response.text();

            try {        
                if (!navigator.clipboard) {
                    throw new Error("navigator.clipboard: Clipboard API unavailable.");
                }
                await navigator.clipboard.writeText(copyText);
                showNotification("Text copied to clipboard");
            } catch (e) {
                console.error(e);
                console.error("Clipboard API writeText() failed! Fallback to document.exec(\"copy\")...");
                try {
                    fallback_clipboard(copyText);
                    showNotification("Text copied to clipboard");
                } catch (fallbackError) {
                    console.error("Fallback clipboard also failed:", fallbackError);
                    showNotification("Failed to copy text", "error");
                }
            }
            el.classList.add("clicked");
            setTimeout(() => el.classList.remove("clicked"), 1000);
        });
    });
}

function showToast(message, type = 'info', duration = 2000) {
    showNotification(message, type, duration);
    // duration currently controlled by showNotification animation, but we keep param compatibility.
}

function showOAuthCodePrompt(userCode, verificationUri) {
    const existingPrompt = document.getElementById('oauth-code-prompt');
    if (existingPrompt) existingPrompt.remove();

    const prompt = document.createElement('div');
    prompt.id = 'oauth-code-prompt';
    prompt.style.position = 'fixed';
    prompt.style.bottom = '20px';
    prompt.style.left = '20px';
    prompt.style.zIndex = '10000';
    prompt.style.backgroundColor = '#111';
    prompt.style.color = '#fff';
    prompt.style.padding = '12px';
    prompt.style.borderRadius = '8px';
    prompt.style.boxShadow = '0 8px 20px rgba(0,0,0,0.5)';
    prompt.style.minWidth = '300px';

    prompt.innerHTML = `
        <div style="font-weight:700; margin-bottom:8px;">GitHub Copilot Login</div>
        <div style="margin-bottom:6px;">Enter this code at GitHub:</div>
        <div id="oauth-user-code" style="font-size:1.2rem; font-weight:700; letter-spacing:0.1em; background:#222; padding:8px; border-radius:4px; word-break:break-all;">${framework.escape(userCode)}</div>
        <div style="display:flex; gap:6px; margin-top:8px;">
            <button id="oauth-copy-code" style="flex:1; padding:8px; background:#2563eb; border:none; color:#fff; border-radius:4px; cursor:pointer;">Copy code</button>
            <button id="oauth-open-url" style="flex:1; padding:8px; background:#059669; border:none; color:#fff; border-radius:4px; cursor:pointer;">Open GitHub</button>
        </div>
        <div style="text-align:right; margin-top:8px;"><button id="oauth-close" style="color:#aaa; background:transparent; border:none; cursor:pointer;">Close</button></div>
    `;

    document.body.appendChild(prompt);

    prompt.querySelector('#oauth-copy-code').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(userCode);
            showNotification('Code copied to clipboard', 'success');
        } catch (copyErr) {
            showNotification('Copy failed', 'error');
        }
    });

    prompt.querySelector('#oauth-open-url').addEventListener('click', () => {
        window.open(verificationUri, '_blank');
    });

    prompt.querySelector('#oauth-close').addEventListener('click', () => {
        prompt.remove();
    });
}

function showNotification(message, type = 'success', duration = 2000) {
    // Check if notification container exists, create if not
    let container = document.getElementById('notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-container';
        container.style.position = 'fixed';
        container.style.bottom = '20px';
        container.style.right = '20px';
        container.style.zIndex = '9999';
        document.body.appendChild(container);
    }

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.padding = '10px 20px';
    notification.style.marginTop = '10px';
    notification.style.borderRadius = '4px';
    notification.style.backgroundColor = type === 'success' ? '#4CAF50' : (type === 'info' ? '#2196F3' : '#F44336');
    notification.style.color = 'white';
    notification.style.opacity = '0';
    notification.style.transform = 'translateY(20px)';
    notification.style.transition = 'opacity 0.3s, transform 0.3s';

    container.appendChild(notification);

    // Show notification with animation
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateY(0)';

        // Hide and remove after delay
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(20px)';

            setTimeout(() => {
                container.removeChild(notification);
                if (container.children.length === 0) {
                    document.body.removeChild(container);
                }
            }, 300);
        }, duration);
    }, 10);
}

async function showErrorPopup(errorMessage) {
    // Only show popup occasionally (30% chance or first time)
    const HOUR_IN_MS = 3600000; // 1 hour in milliseconds
    const SHOW_PROBABILITY = 0.3; // 30% chance to show

    const lastShown = appStorage.getItem('errorPopupLastShown');
    const now = Date.now();

    // Show if: never shown before OR (more than 1 hour since last shown AND random chance)
    const isFirstTime = !lastShown;
    const hasEnoughTimePassed = lastShown && (now - parseInt(lastShown) > HOUR_IN_MS);
    const shouldShow = isFirstTime || (hasEnoughTimePassed && Math.random() < SHOW_PROBABILITY);

    if (!shouldShow) {
        return; // Don't show popup this time
    }

    // Mark as shown
    appStorage.setItem('errorPopupLastShown', now.toString());

    // Remove any existing error popup
    const existingOverlay = document.querySelector('.error-popup-overlay');
    const existingPopup = document.querySelector('.error-popup');
    if (existingOverlay) existingOverlay.remove();
    if (existingPopup) existingPopup.remove();

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'error-popup-overlay';
    overlay.addEventListener('click', () => closeErrorPopup());

    // Fetch popup content from HTML file
    let hintsHtml = '';
    try {
        const response = await fetch('/chat/error-popup.html');
        if (response.ok) {
            hintsHtml = await response.text();
        } else {
            // Fallback if fetch fails
            console.warn('Failed to load error popup HTML, using fallback');
            hintsHtml = generateFallbackHints();
        }
    } catch (error) {
        console.warn('Error fetching popup HTML:', error);
        hintsHtml = generateFallbackHints();
    }

    let translatedResponse;
    if (!navigator.language.startsWith('en')) {
        translatedResponse = framework.query(`Translate this document to (${navigator.language}):\n\`\`\`html\n${hintsHtml}\`\`\``)
    }

    // Create popup
    const popup = document.createElement('div');
    popup.className = 'error-popup';
    const hintsTemplate = hintsHtml=>`
        <div class="error-popup-header">
            <h3>⚠️ ${framework.translate('Error Occurred')}</h3>
            <button class="error-popup-close" aria-label="Close">×</button>
        </div>
        <div class="error-popup-body">
            <div class="error-popup-message"></div>
            ${hintsHtml}
        </div>
    `;
    const updateErrorMessage = ()=>{
        // Safely set error message text content to prevent XSS
        const messageDiv = popup.querySelector('.error-popup-message');
        messageDiv.textContent = errorMessage;

        // Add close button event
        const closeBtn = popup.querySelector('.error-popup-close');
        closeBtn.addEventListener('click', () => closeErrorPopup());
    }
    popup.innerHTML = hintsTemplate(hintsHtml);
    updateErrorMessage();

    if (translatedResponse)
    translatedResponse.then(r=>r.text())
        .then(t=>framework.filterMarkdown(t, 'html', t))
        .then(t=>window.sanitizeHtml(t, framework.sanitizedConfig()))
        .then(t=>(popup.innerHTML=hintsTemplate(t)) && updateErrorMessage())

    // Add to document
    document.body.appendChild(overlay);
    document.body.appendChild(popup);

    // Show with animation
    setTimeout(() => {
        overlay.classList.add('show');
        popup.classList.add('show');
    }, 10);
}

function generateFallbackHints() {
    return ``;
}

function closeErrorPopup() {
    const overlay = document.querySelector('.error-popup-overlay');
    const popup = document.querySelector('.error-popup');

    if (overlay) {
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 300);
    }

    if (popup) {
        popup.classList.remove('show');
        setTimeout(() => popup.remove(), 300);
    }
}