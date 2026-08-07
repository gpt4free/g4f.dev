/**
 * Headless smoke test for cake-baker.js new controls:
 * worker-count slider, on/off toggle, throttle slider.
 * Run: node g4f.dev/dist/js/cake-baker.smoke.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "cake-baker.js"), "utf8");

// ---- Minimal browser mocks ---------------------------------------------
const storage = new Map();
const listeners = {};
const elements = [];
let workerCounter = 0;
let lastPollDelay = null;

class FakeWorker {
    constructor(url) {
        this.url = url;
        this.id = ++workerCounter;
        this.busy = false;
        this.terminated = false;
        this._msgs = [];
        elements.push(this);
        this.onmessage = null;
    }
    postMessage(msg) { this._msgs.push(msg); }
    terminate() { this.terminated = true; }
}

function makeEl(tag) {
    return {
        tag, children: [], listeners: {}, attrs: {},
        textContent: "", innerText: "", innerHTML: "", value: "0",
        classList: { toggle() {}, },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener(evt, fn) { (this.listeners[evt] ||= []).push(fn); },
        appendChild(c) { this.children.push(c); return c; },
        setAttribute(k, v) { this.attrs[k] = v; },
        isConnected: true,
    };
}

const fakeDoc = {
    body: makeEl("body"),
    head: makeEl("head"),
    readyState: "complete",
    getElementById(id) { return null; },
    createElement(tag) { return makeEl(tag); },
    addEventListener() {},
    dispatchEvent() { return true; },
};

const sandbox = {
    console,
    navigator: { hardwareConcurrency: 8 },
    localStorage: {
        getItem: (k) => storage.get(k) ?? null,
        setItem: (k, v) => storage.set(k, String(v)),
        removeItem: (k) => storage.delete(k),
    },
    document: fakeDoc,
    window: {
        location: { pathname: "/chat", hostname: "g4f.space" },
        addEventListener() {},
        dispatchEvent() { return true; },
    },
    Worker: FakeWorker,
    Blob: class { constructor(parts, opts) { this.parts = parts; this.opts = opts; } },
    URL: { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} },
    fetch: async () => {
        lastPollDelay = null;
        return {
            ok: true,
            status: 200,
            json: async () => ({ uuids: [], credit_cents: 0, baked_today: 0, limit_per_day: 100 }),
        };
    },
    performance: { now: () => Date.now() },
    setTimeout: (fn, delay) => { lastPollDelay = delay; return 1; },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.init = init; } },
    crypto: {},
    TextEncoder: class { encode(s) { return s; } },
    Math,
    Date,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    Number,
};
sandbox.window.window = sandbox.window;
sandbox.window.document = fakeDoc;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.G4FCakeBaker = undefined;

vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "cake-baker.js" });

const api = sandbox.window.G4FCakeBaker;
let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log("  ok  " + name); }
    else { fail++; console.log(" FAIL " + name); }
}

console.log("API surface:");
check("window.G4FCakeBaker exposed", !!api);
for (const k of ["start", "stop", "status", "setWorkers", "setThrottle", "setEnabled", "getSettings"]) {
    check("has " + k, typeof api[k] === "function");
}

console.log("Defaults:");
const s0 = api.getSettings();
check("default enabled=true", s0.enabled === true);
check("default workers=" + s0.workers, s0.workers >= 1 && s0.workers <= 16);
check("default throttle=15000", s0.throttleMs === 15000);

console.log("Worker resizing:");
api.setEnabled(true);
const before = workerCounter;
check("start() spawns workers", before >= 1);
api.setWorkers(1);
check("pool shrinks to 1", api.status().workers === 1);
check("extra workers terminated", elements.filter(e => e.terminated).length >= before - 1);
api.setWorkers(8);
check("pool grows to 8", api.status().workers === 8);

console.log("Throttle:");
api.setThrottle(3000);
check("throttleMs=3000", api.getSettings().throttleMs === 3000);
api.setThrottle(-5);
check("throttle clamps to 0", api.getSettings().throttleMs === 0);
api.setThrottle(9999999);
check("throttle clamps to max", api.getSettings().throttleMs === 120000);

console.log("Toggle off/on:");
api.setEnabled(false);
check("stopped after disable", api.status().running === false);
check("settings persisted enabled=false", JSON.parse(storage.get("g4f_cake_settings") || "{}").enabled === false);
api.setEnabled(true);
check("restarts after enable", api.status().running === true);

console.log("Persistence:");
const s1 = api.getSettings();
const stored = JSON.parse(storage.get("g4f_cake_settings"));
check("workers persisted", stored.workers === s1.workers);
check("throttle persisted", stored.throttleMs === s1.throttleMs);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
