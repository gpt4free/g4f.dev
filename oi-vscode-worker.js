/**
 * OI VSCode Server 2 Proxy Worker
 * 
 * Cloudflare Worker for proxying requests to OI VSCode Server 2.
 * Generates random userid header for each request.
 */

const TARGET_URL = "https://oi-vscode-server-2.onrender.com/v1";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Expose-Headers": "Content-Type, X-Provider"
};

/**
 * Generate a random user ID (21 alphanumeric characters)
 */
function generateUserId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const randomValues = new Uint8Array(21);
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < 21; i++) {
        result += chars[randomValues[i] % chars.length];
    }
    return result;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const pathname = url.pathname;

        // Handle CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: CORS_HEADERS });
        }

        try {
            // Route: /v1/chat/completions
            if (pathname === "/v1/chat/completions" || pathname === "/chat/completions") {
                return handleChatCompletions(request);
            }

            // Route: /v1/models
            if (pathname === "/v1/models" || pathname === "/models") {
                return handleModels(request);
            }

            // Health check
            if (pathname === "/" || pathname === "/health") {
                return jsonResponse({ 
                    status: "ok", 
                    provider: "OIVSCodeSer2",
                    target: TARGET_URL 
                });
            }

            // Generic proxy for other /v1/* endpoints
            if (pathname.startsWith("/v1/")) {
                return proxyRequest(request, pathname);
            }

            return jsonResponse({ error: "Not found" }, 404);
        } catch (error) {
            console.error("Worker error:", error);
            return jsonResponse({ error: error.message || "Internal server error" }, 500);
        }
    }
};

async function handleChatCompletions(request) {
    return proxyRequest(request, "/v1/chat/completions");
}

async function handleModels(request) {
    return proxyRequest(request, "/v1/models");
}

async function proxyRequest(request, subPath) {
    const userid = generateUserId();
    const isStream = request.headers.get("Accept")?.includes("text/event-stream");

    // Build headers
    const proxyHeaders = {
        "Content-Type": "application/json",
        "Accept": isStream ? "text/event-stream" : "application/json",
        "userid": userid
    };

    // Forward Authorization header if present
    const authHeader = request.headers.get("Authorization");
    if (authHeader) {
        proxyHeaders["Authorization"] = authHeader;
    }

    const targetUrl = `${TARGET_URL}${subPath.startsWith('/v1') ? subPath.substring(3) : subPath}`;

    const fetchOptions = {
        method: request.method,
        headers: proxyHeaders
    };

    if (request.method === "POST") {
        fetchOptions.body = await request.text();
    }

    const response = await fetch(targetUrl, fetchOptions);

    // Create new response with CORS headers
    const newResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
    });

    for (const [key, value] of Object.entries(CORS_HEADERS)) {
        newResponse.headers.set(key, value);
    }
    newResponse.headers.set("X-Provider", "OIVSCodeSer2");
    newResponse.headers.set("X-User-Id", userid);

    return newResponse;
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS
        }
    });
}
