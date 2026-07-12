/**
 * Web Worker for AI API requests.
 *
 * Runs fetch() calls off the main thread so they keep streaming
 * even when the tab is backgrounded / the user switches to another app.
 *
 * Protocol (main -> worker):
 *   { type: "abort", id: <messageId> }                      -> abort a request
 *   { type: "fetch", id: <messageId>, url, options }        -> start a fetch
 *
 * Protocol (worker -> main):
 *   { type: "open",    id, status, headers }                -> response started
 *   { type: "chunk",   id, value }                          -> streamed chunk (Uint8Array)
 *   { type: "done",    id }                                  -> stream finished
 *   { type: "error",   id, message }                        -> error / abort
 *   { type: "ratelimit", id, status, body }                 -> 429 response body
 */

const controllers = new Map();

self.onmessage = async (event) => {
    const data = event.data;

    if (data.type === "abort") {
        const controller = controllers.get(data.id);
        if (controller) {
            try {
                controller.abort();
            } catch (e) {
                // ignore
            }
        }
        return;
    }

    if (data.type === "fetch") {
        const { id, url, options } = data;
        const controller = new AbortController();
        controllers.set(id, controller);

        try {
            // Re-attach the AbortController signal; headers are passed as a plain object.
            const fetchOptions = { ...options, signal: controller.signal };

            const response = await fetch(url, fetchOptions);

            // Handle rate limit (429) by reading body in the worker and forwarding it.
            if (response.status === 429) {
                let bodyText = "";
                try {
                    bodyText = await response.text();
                } catch (e) {
                    // ignore
                }
                self.postMessage({ type: "ratelimit", id, status: response.status, body: bodyText });
                controllers.delete(id);
                return;
            }

            // Forward response headers as a plain object.
            const headers = {};
            response.headers.forEach((value, key) => {
                headers[key] = value;
            });

            self.postMessage({ type: "open", id, status: response.status, headers });

            if (!response.body) {
                self.postMessage({ type: "done", id });
                controllers.delete(id);
                return;
            }

            const reader = response.body.getReader();
            while (true) {
                let readResult;
                try {
                    readResult = await reader.read();
                } catch (e) {
                    // AbortError or network error
                    self.postMessage({ type: "error", id, message: e?.message || String(e) });
                    break;
                }
                const { value, done } = readResult;
                if (done) {
                    self.postMessage({ type: "done", id });
                    break;
                }
                if (value) {
                    // Transfer the underlying ArrayBuffer to avoid copying.
                    self.postMessage({ type: "chunk", id, value }, [value.buffer]);
                }
            }
            controllers.delete(id);
        } catch (err) {
            controllers.delete(id);
            if (err && err.name === "AbortError") {
                self.postMessage({ type: "error", id, message: "aborted", aborted: true });
            } else {
                self.postMessage({ type: "error", id, message: err?.message || String(err) });
            }
        }
    }
};