/* ================================================================== *
 * Addon: Message Actions Worker
 *
 * Handles message action buttons including audio playback, regeneration, continuation, sharing, printing, and QR code generation.
 * ================================================================== */

(function () {
    'use strict';

    ChatAddons.register({
        id: 'builtin:message-worker',
        name: 'Message Actions Worker',
        version: '1.0.0',
        description: 'Handles message action buttons including audio playback, regeneration, continuation, sharing, printing, and QR code generation.',
        author: 'g4f',
        builtin: true,
        permissions: ['net:fetch', 'dom:query'],

        load() {
            return (async () => {})
        }
    });
})();

let provider_storage = {};
let message_storage = {};
let content_alt_storage = {};
let content_data_storage = {};
let controller_storage = {};
let content_storage = {};
let error_storage = {};
let synthesize_storage = {};
let title_storage = {};
let parameters_storage = {};
let finish_storage = {};
let usage_storage = {};
let continue_storage = {};
let reasoning_storage = {};
let variant_storage = {};
let debug_response_counter = {}
let title_ids_storage = {};
let image_storage = {};
let headers_storage = {};
let wakeLock = null;
let countTokensEnabled = true;
let suggestions = null;
let tool_calls_storage = {};
let lastUpdated = null;
let mediaRecorder = null;
let stopRecognition = ()=>{};
let providerModelSignal = null;
let searchModels = {};
let client = null;
let voicePreviewAudio = null;

// --- Web Worker for AI API requests (keeps streaming when tab is backgrounded) ---
// Try to load the worker; if it fails (e.g. file missing, CSP, file:// origin),
// fall back to regular fetch() on the main thread.
let apiWorker = null;
try {
// The worker lives next to this script (dist/js/api-worker.js).
// Resolve relative to the script's own URL so it works regardless of
// which HTML page loads this file (e.g. /chat/index.html uses ../dist/js/).
const scriptUrl = document.currentScript?.src || location.href;
const workerUrl = new URL("api-worker.js", scriptUrl);
apiWorker = new Worker(workerUrl);
// If the worker errors out (load failure, syntax error, etc.), disable it
// so subsequent requests fall back to main-thread fetch.
apiWorker.onerror = (event) => {
    console.warn("api-worker failed, falling back to main-thread fetch:", event.message || event, workerUrl.href);
    try { apiWorker.terminate(); } catch (e) {}
    apiWorker = null;
};
} catch (e) {
    console.warn("Failed to create api-worker, using main-thread fetch:", e);
    apiWorker = null;
}
const apiWorkerCallbacks = new Map(); // message_id -> { onOpen, onChunk, onDone, onError, onRatelimit }

if (apiWorker) {
apiWorker.onmessage = (event) => {
    const data = event.data;
    const cb = apiWorkerCallbacks.get(data.id);
    if (!cb) return;
    if (data.type === "open") {
        cb.onOpen?.(data.status, data.headers);
    } else if (data.type === "chunk") {
        cb.onChunk?.(data.value);
    } else if (data.type === "done") {
        cb.onDone?.();
        apiWorkerCallbacks.delete(data.id);
    } else if (data.type === "error") {
        cb.onError?.(data.message, data.aborted);
        apiWorkerCallbacks.delete(data.id);
    } else if (data.type === "ratelimit") {
        cb.onRatelimit?.(data.status, data.body);
        apiWorkerCallbacks.delete(data.id);
    }
};
}

/**
* Runs a fetch() inside the web worker so the request keeps streaming
* even when the tab is backgrounded / the user switches to another app.
* Falls back to regular fetch() on the main thread if the worker is unavailable.
* Returns a Response-like object with a .body ReadableStream.
*/
function workerFetch(message_id, url, options) {
// Fallback: worker not loaded — use main-thread fetch.
if (!apiWorker) {
    return fetch(url, options);
}
return new Promise((resolve, reject) => {
    let streamController;
    const stream = new ReadableStream({
        start(controller) { streamController = controller; }
    });
    let resolved = false;

    apiWorkerCallbacks.set(message_id, {
        onOpen: (status, headers) => {
            // Build a Response-like object the existing code can consume.
            const headersObj = new Headers();
            for (const [k, v] of Object.entries(headers || {})) {
                headersObj.set(k, v);
            }
            const response = new Response(stream, {
                status,
                headers: headersObj,
            });
            resolved = true;
            resolve(response);
        },
        onChunk: (value) => {
            streamController?.enqueue(new Uint8Array(value));
        },
        onDone: () => {
            try { streamController?.close(); } catch (e) {}
        },
        onError: (message, aborted) => {
            try { streamController?.error(new Error(message)); } catch (e) {}
            if (!resolved) {
                if (aborted) {
                    reject(new DOMException("The user aborted a request.", "AbortError"));
                } else {
                    reject(new Error(message));
                }
            }
        },
        onRatelimit: (status, body) => {
            // Resolve with a synthetic 429 response carrying the body text.
            const response = new Response(body, {
                status,
                headers: { "Content-Type": "text/html" },
            });
            resolved = true;
            resolve(response);
        },
    });

    // Strip any signal — the worker manages its own AbortController.
    const { signal, ...safeOptions } = options || {};
    apiWorker.postMessage({ type: "fetch", id: message_id, url, options: safeOptions });
});
}

function workerAbort(message_id) {
    if (!apiWorker) return;
    apiWorker.postMessage({ type: "abort", id: message_id });
}

appStorage = window.localStorage || {
    setItem: (key, value) => self[key] = value,
    getItem: (key) => self[key],
    removeItem: (key) => delete self[key],
};
