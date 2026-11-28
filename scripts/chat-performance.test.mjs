// Guards for the Lighthouse-driven chat page speed fixes.
// These checks keep the heavy optional scripts and first-paint layout stable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

const chat = read("chat/index.html");
const style = read("dist/css/style.css");
const addonLoad = read("dist/js/addons/addon-load.js");
const language = read("language-selection.html");

test("chat defers optional third-party scripts until they are needed", () => {
    assert.match(chat, /window\.loadMathJax\s*=/);
    assert.match(chat, /window\.loadTokenCounter\s*=/);
    assert.doesNotMatch(chat, /<script[^>]+src="[^"]*mathjax@3[^"]*"/);
    assert.doesNotMatch(chat, /<script[^>]+src="[^"]*gpt-tokenizer[^"]*"/);
});

test("chat discovers and prioritizes its LCP image", () => {
    assert.match(chat, /<link[^>]+rel="preload"[^>]+as="image"[^>]+g4f\.svg/);
    assert.match(chat, /fetchpriority="high"/);
});

test("the full-size iframe is an overlay, not an in-flow element", () => {
    const rule = style.match(/\.hljs-iframe-container\s*\{([^}]*)\}/)?.[1] || "";
    assert.match(rule, /position:\s*fixed\s*;/);
    assert.doesNotMatch(rule, /position:\s*absolute\s*;/);
});

test("first-paint UI is not replaced by async content", () => {
    assert.match(chat, /dataset\.consentBound = "true"/);
    assert.match(addonLoad, /dataset\.consentBound === "true"/);
    assert.match(chat, /buildEmptyState\(\);/);
    assert.match(addonLoad, /chat-empty-state/);
    assert.match(language, /render\(\);/);
    assert.doesNotMatch(language, /listEl\.innerHTML = `<div class="loading"/);
});
