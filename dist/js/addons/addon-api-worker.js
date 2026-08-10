/* ================================================================== *
 * Addon: Web Worker for AI API requests                              *
 *                                                                    *
 * Extracted from chat.v1.js lines 222-345. Keeps streaming when the  *
 * tab is backgrounded. Falls back to main-thread fetch() when the    *
 * worker cannot load.                                                *
 * ================================================================== */

(function () {
    'use strict';

    ChatAddons.register({
        id: 'builtin:api-worker',
        name: 'API Web Worker',
        version: '1.0.0',
        description: 'Keeps AI streaming alive in background tabs by running API requests in a Web Worker.',
        author: 'g4f',
        builtin: true,
        permissions: ['net:fetch'],

        load() {
            // Try to load the worker; if it fails (file missing, CSP, file://
            // origin), fall back to regular fetch() on the main thread.
            try {
                const scriptUrl = document.currentScript?.src || location.href;
                const workerUrl = new URL('api-worker.js', scriptUrl);
                window.apiWorker = new Worker(workerUrl);
                window.apiWorker.onerror = (event) => {
                    console.warn('api-worker failed, falling back to main-thread fetch:', event.message || event, workerUrl.href);
                    try { window.apiWorker.terminate(); } catch (e) {}
                    window.apiWorker = null;
                };
            } catch (e) {
                console.warn('Failed to create api-worker:', e);
                window.apiWorker = null;
            }

            window.workerFetch = function workerFetch(message_id, url, options) {
                // Fallback: worker not loaded — use main-thread fetch.
                if (!window.apiWorker) {
                    return fetch(url, options);
                }
                return new Promise((resolve, reject) => {
                    let streamController;
                    const stream = new ReadableStream({
                        start(controller) {
                            streamController = controller;
                        },
                    });
                    const reader = stream.getReader();
                    const state = { done: false };

                    const onMessage = (event) => {
                        if (event.data?.type === 'response') {
                            const { headers, status } = event.data;
                            const response = new Response(reader, {
                                headers,
                                status,
                            });
                            window.apiWorker.removeEventListener('message', onMessage);
                            resolve(response);
                        } else if (event.data?.type === 'error') {
                            window.apiWorker.removeEventListener('message', onMessage);
                            reject(new Error(event.data.message || 'Worker fetch failed'));
                        } else if (event.data?.type === 'stream') {
                            if (event.data.data) {
                                streamController.enqueue(new Uint8Array(event.data.data));
                            }
                            if (event.data.done) {
                                state.done = true;
                                streamController.close();
                            }
                        }
                    };
                    window.apiWorker.addEventListener('message', onMessage);
                    window.apiWorker.postMessage({ type: 'fetch', id: message_id, url, options });
                });
            };

            window.workerAbort = function workerAbort(message_id) {
                if (!window.apiWorker) return;
                window.apiWorker.postMessage({ type: 'abort', id: message_id });
            };
        },

        unload() {
            if (window.apiWorker) {
                try { window.apiWorker.terminate(); } catch (e) {}
                window.apiWorker = null;
            }
        },
    });
})();
