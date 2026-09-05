/* ================================================================== *
 * Addon: Web Worker for AI API requests                              *
 *                                                                    *
 * Extracted from chat.v1.js lines 222-345. Keeps streaming when the  *
 * tab is backgrounded. Falls back to main-thread fetch() when the    *
 * worker cannot load.                                                *
 * ================================================================== */


// --- Web Worker for AI API requests (keeps streaming when tab is backgrounded) ---
// Try to load the worker; if it fails (e.g. file missing, CSP, file:// origin),
// fall back to regular fetch() on the main thread.
let apiWorker = null;
let isEnabled = false;
const apiWorkerCallbacks = new Map(); // workerId -> { onOpen, onChunk, onDone, onError, onRatelimit }

ChatAddons.register({
    id: 'builtin:api-worker',
    name: 'API Web Worker',
    version: '1.0.0',
    description: 'Keeps AI streaming alive in background tabs by running API requests in a Web Worker.',
    author: 'g4f',
    builtin: true,
    permissions: ['net:fetch'],

    load() {
        isEnabled = true;
    },

    unload() {
        isEnabled = false;
    },
});

try {
    // The worker lives next to this script (dist/js/api-worker.js).
    // Resolve relative to the script's own URL so it works regardless of
    // which HTML page loads this file (e.g. /chat/index.html uses ../dist/js/).
    const scriptUrl = document.currentScript?.src || location.href;
    const workerUrl = new URL("/dist/js/api-worker.js", scriptUrl);
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
function workerFetch(workerId, url, options) {
    // Fallback: worker not loaded — use main-thread fetch.
    if (!apiWorker || !isEnabled) {
        return fetch(url, options);
    }
    return new Promise((resolve, reject) => {
        let streamController;
        const stream = new ReadableStream({
            start(controller) { streamController = controller; }
        });
        let resolved = false;

        apiWorkerCallbacks.set(workerId, {
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
        apiWorker.postMessage({ type: "fetch", id: workerId, url, options: safeOptions });
    });
}

function fetchFn(url, fetchOptions) {
    if (!apiWorker || !isEnabled) {
        return fetch(url, fetchOptions);
    }
    const workerId = `client-${generateUUID()}`;
    // Forward aborts from the provided signal to the worker.
    const signal = fetchOptions?.signal;
    if (signal) {
        if (signal.aborted) {
            apiWorker.postMessage({ type: "abort", id: workerId });
        } else {
            signal.addEventListener("abort", () => {
                apiWorker.postMessage({ type: "abort", id: workerId });
            });
        }
    }
    return workerFetch(workerId, url, fetchOptions);
};

export default {
    apiWorker,
    fetchFn
};
