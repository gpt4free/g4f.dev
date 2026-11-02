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
        Node: {TEXT_NODE: 3, ELEMENT_NODE: 1},
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

test("clearTranslations also clears the persisted selection", () => {
    const context = loadFramework({
        store: {
            selectedTranslationLanguage: "de",
            globalTranslations: JSON.stringify({
                de: {language: "de", translations: {Hello: "Hallo"}},
            }),
        },
    });
    assert.equal(context.framework.getSelectedLanguage(), "de");
    assert.equal(context.framework.clearTranslations("de"), true);
    assert.equal(context.framework.getSelectedLanguage(), null);
    assert.deepEqual(JSON.parse(JSON.stringify(context.framework.translations)), {});
});

test("unloading a selected language works without a stored package", () => {
    const context = loadFramework({
        store: {selectedTranslationLanguage: "de"},
    });
    // No community entry in localStorage: the selection must still be
    // removable, otherwise the language can never be unloaded.
    assert.equal(context.framework.clearTranslations("de"), false);
    assert.equal(context.framework.getSelectedLanguage(), null);
});

function fakeElement(text, {marked = false, attrs = {}, children = []} = {}) {
    const element = {
        nodeType: 1,
        tagName: "DIV",
        classList: {contains: () => false},
        childNodes: [{nodeType: 3, textContent: text}],
        attrs: {...attrs},
        children,
        matches: (selector) => selector === '[data-translate="true"]'
            && element.attrs["data-translate"] === "true",
        querySelectorAll: (selector) => selector === "*"
            ? children
            : children.filter((child) => child.matches && child.matches(selector)),
        getAttribute(name) { return this.attrs[name] ?? null; },
        setAttribute(name, value) { this.attrs[name] = value; },
    };
    if (marked) element.attrs["data-translate"] = "true";
    return element;
}

test("translateMarked translates cloned UI but not unmarked content", () => {
    const context = loadFramework({languages: ["de-DE"]});
    context.framework.translations = {
        "How can I help you today?": "Wie kann ich dir heute helfen?",
        "Send message": "Nachricht senden",
        "Unrelated model output": "Sollte unübersetzt bleiben",
    };
    const title = fakeElement("How can I help you today?");
    const button = fakeElement("Send message", {attrs: {"aria-label": "Send message"}});
    const message = fakeElement("Unrelated model output");
    const root = fakeElement("", {marked: true, children: [title, button]});

    assert.equal(context.framework.translateMarked(root), 1);
    assert.equal(title.childNodes[0].textContent, "Wie kann ich dir heute helfen?");
    assert.equal(button.attrs["aria-label"], "Nachricht senden");
    assert.equal(message.childNodes[0].textContent, "Unrelated model output");
});
