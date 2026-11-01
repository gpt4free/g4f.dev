const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const FRAMEWORK_SOURCE = fs.readFileSync(
    path.join(__dirname, "framework.js"),
    "utf8",
);

// Load framework.js in a tiny browser-like VM. The script is a classic browser
// script, so `window` must also be the global object.
function loadFramework({languages = ["en-US"], country = null, store = {}} = {}) {
    const storage = new Map(Object.entries({
        backendUrl: "http://127.0.0.1:9",
        lastConnectToBackend: String(Date.now()),
        ...store,
    }));
    const noop = () => {};
    const document = {
        readyState: "complete",
        body: {classList: {contains: () => true}},
        documentElement: {
            getAttribute: (name) => name === "data-g4f-country" ? country : null,
        },
        head: {appendChild: noop},
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: noop,
        createElement: () => ({
            style: {},
            classList: {contains: () => false},
            setAttribute: noop,
            appendChild: noop,
            addEventListener: noop,
        }),
        getElementById: () => null,
    };
    const context = {
        console,
        document,
        navigator: {languages, language: languages[0]},
        localStorage: {
            getItem: (key) => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: (key) => storage.delete(key),
            key: (index) => [...storage.keys()][index] ?? null,
            get length() { return storage.size; },
        },
        location: {origin: "https://example.test", pathname: "/", protocol: "https:"},
        fetch: async () => ({ok: false, status: 404}),
        AbortSignal,
        setTimeout,
        clearTimeout,
        Intl,
    };
    context.window = context;
    context.globalThis = context;
    context.self = context;
    context.top = context;
    context.addEventListener = noop;
    vm.createContext(context);
    vm.runInContext(FRAMEWORK_SOURCE, context, {filename: "framework.js"});
    return context;
}

test("detectLanguage prefers a non-English browser language", async () => {
    const context = loadFramework({languages: ["fr-CA", "en"], country: "ES"});
    assert.deepEqual(
        JSON.parse(JSON.stringify(await context.framework.detectLanguage())),
        {language: "fr", source: "browser"},
    );
});

test("detectLanguage falls back to the IP country for English browsers", async () => {
    const context = loadFramework({languages: ["en-US"], country: "ES"});
    assert.deepEqual(
        JSON.parse(JSON.stringify(await context.framework.detectLanguage())),
        {language: "es", source: "country", country: "ES"},
    );
});

test("detectLanguage ignores unsupported or unknown countries", async () => {
    const context = loadFramework({languages: ["en-US"], country: "ZZ"});
    assert.equal(await context.framework.detectLanguage(), null);
});

test("stored packages are not applied to the browser language without a selection", () => {
    const context = loadFramework({
        languages: ["es-ES"],
        store: {
            globalTranslations: JSON.stringify({
                es: {language: "es", translations: {Hello: "Hola"}},
            }),
        },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(context.framework.translations)), {});
    assert.equal(context.framework.getSelectedLanguage(), null);
});
