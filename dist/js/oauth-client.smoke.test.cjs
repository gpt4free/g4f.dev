const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {webcrypto} = require("node:crypto");

const OAUTH_CLIENT_SOURCE = fs.readFileSync(
    path.join(__dirname, "oauth-client.js"),
    "utf8",
);

function loadOAuthClient({href, state = null} = {}) {
    const storage = new Map();
    if (state) {
        storage.set("g4f_oauth_state", JSON.stringify(state));
    }
    const replaceStateCalls = [];
    const makeStorage = () => ({
        getItem: (key) => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
    });
    const window = {
        location: new URL(href),
        history: {
            replaceState: (...args) => replaceStateCalls.push(args),
        },
        self: null,
        top: null,
        opener: null,
        addEventListener: () => {},
        dispatchEvent: () => {},
        sessionStorage: makeStorage(),
        localStorage: makeStorage(),
    };
    window.self = window;
    window.top = window;

    const context = {
        window,
        document: {title: "Members Area"},
        sessionStorage: window.sessionStorage,
        localStorage: window.localStorage,
        fetch: async () => ({
            ok: true,
            json: async () => ({
                access_token: "token-123",
                user: {id: "user-1"},
                expires_in: 3600,
            }),
        }),
        URL,
        URLSearchParams,
        TextEncoder,
        btoa,
        crypto: webcrypto,
        console,
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(OAUTH_CLIENT_SOURCE, context, {filename: "oauth-client.js"});
    return {context, replaceStateCalls, storage};
}

test("handleCallback cleans the URL on the current origin despite a cross-origin <base>", async () => {
    const oauthState = "state-123";
    const redirectUri = "https://auth.g4f.space/members.html";
    const {context, replaceStateCalls} = loadOAuthClient({
        href: `${redirectUri}?code=abc&state=${oauthState}`,
        state: {
            state: oauthState,
            redirectUri,
            data: null,
            provider: null,
        },
    });

    const result = await context.window.G4FOAuth.handleCallback(redirectUri);
    assert.equal(result.token, "token-123");
    assert.equal(replaceStateCalls.length, 1);

    // auth.g4f.space serves members.html with <base href="https://g4f.dev/">.
    // A path-relative history URL would resolve to g4f.dev and throw a
    // SecurityError, so the clean URL must be absolute on the current origin.
    const cleaned = new URL(replaceStateCalls[0][2]);
    assert.equal(cleaned.origin, "https://auth.g4f.space");
    assert.equal(cleaned.pathname, "/members.html");
    assert.equal(cleaned.searchParams.get("code"), null);
    assert.equal(cleaned.searchParams.get("state"), null);
});
