import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_LOCALES,
  LOCALES,
  escapeAttribute,
  localize,
  normalizeText,
  translateHtml,
  translateText,
} from "./build-locales.mjs";

const translations = {
  "Backend Tools & Modules": "Backend-Werkzeuge & Module",
  Home: "Startseite",
  "Send message": "Nachricht senden",
  "Search the web...": "Das Web durchsuchen...",
  "Tools & Modules": "Werkzeuge & Module",
  "Explore free AI tools.": "Entdecke kostenlose KI-Werkzeuge.",
};

test("normalizeText collapses whitespace like the runtime", () => {
  assert.equal(normalizeText("  Hello\n   world  "), "Hello world");
});

test("translateText preserves surrounding whitespace", () => {
  assert.equal(translateText("\n  Home\n", translations), "\n  Startseite\n");
  assert.equal(translateText("  ", translations), "  ");
  assert.equal(translateText("https://example.com", { "https://example.com": "x" }), "https://example.com");
  assert.equal(translateText("G4F", { G4F: "GPT4Free" }), "GPT4Free");
});

test("translateHtml translates text nodes", () => {
  const html = "<h1>Backend Tools &amp; Modules</h1><p>\n  Home\n</p>";
  const result = translateHtml(html, translations);
  assert.match(result, /^<h1>Backend-Werkzeuge &amp; Module<\/h1>/);
  assert.match(result, /\n  Startseite\n/);
});

test("translateHtml translates visible attributes", () => {
  const html = [
    '<a title="Send message" aria-label="Send message" href="/send">',
    '<button title="Send message">Send message</button>',
    '<input type="button" value="Send message">',
    '<input placeholder="Search the web...">',
    '<meta name="description" content="Explore free AI tools.">',
  ].join("");
  const result = translateHtml(html, translations);
  assert.match(result, /title="Nachricht senden"/);
  assert.match(result, /aria-label="Nachricht senden"/);
  assert.match(result, /value="Nachricht senden"/);
  assert.match(result, /placeholder="Das Web durchsuchen..."/);
  assert.match(result, /content="Entdecke kostenlose KI-Werkzeuge."/);
});

test("translateHtml leaves scripts, styles and comments alone", () => {
  const html = [
    "<script>const Home = 'Home';</script>",
    "<style>.Home{content:'Home'}</style>",
    "<!-- Home -->",
    "<p>Home</p>",
  ].join("");
  const result = translateHtml(html, translations);
  assert.match(result, /<script>const Home = 'Home';<\/script>/);
  assert.match(result, /<style>\.Home\{content:'Home'\}<\/style>/);
  assert.match(result, /<!-- Home -->/);
  assert.match(result, /<p>Startseite<\/p>/);
});

test("translateHtml escapes translated markup", () => {
  const result = translateHtml("<p>Home</p>", { Home: '<b>Start</b> & "done"' });
  assert.equal(result, "<p>&lt;b&gt;Start&lt;/b&gt; &amp; \"done\"</p>");
});

test("localize injects all locale alternates and the runtime bootstrap", () => {
  const result = localize(
    '<!doctype html><html lang="en"><head><title>Home</title></head><body><p>Home</p></body></html>',
    "chat/index.html",
    "de",
    translations,
  );
  assert.match(result, /<html lang="de" dir="ltr">/);
  assert.match(result, /<base href="\/chat\/">/);
  assert.match(result, /<p>Startseite<\/p>/);
  for (const locale of ALL_LOCALES) {
    assert.match(result, new RegExp(`hreflang="${locale}"`));
  }
  assert.match(result, /const supported = \[[\s\S]*"zh"[\s\S]*\]/);
  assert.match(result, /data-g4f-locale-runtime="1"/);
});

test("all API locales are unique and include the wider catalog", () => {
  assert.equal(new Set(LOCALES).size, LOCALES.length);
  assert.ok(LOCALES.includes("ja"));
  assert.ok(LOCALES.includes("kk"));
  assert.ok(LOCALES.includes("uz"));
  assert.equal(escapeAttribute('<a href="x">'), "&lt;a href=&quot;x&quot;&gt;");
});
