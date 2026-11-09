// Tests for the challenge worker's translation storage behavior.
//
// The translation store must survive a primary-KV outage: it may be served
// from the Blob mirror, and it must never be reported as an empty store (or
// overwritten) when the primary cannot be read. This covers the Upstash
// Fixed-plan-limit failure mode.
//
// Run with: node --test workers/challenge-worker.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import { UpstashKv } from "../api/challenge.js";
import worker from "./challenge-worker.js";

class MemoryKv {
  constructor(entries = {}) {
    this.data = new Map(Object.entries(entries));
    this.lastError = null;
    this.failReads = false;
    this.failWrites = false;
    this.failList = false;
  }
  async getStrict(key) {
    if (this.failReads) {
      this.lastError = "storage offline";
      throw new Error("storage offline");
    }
    this.lastError = null;
    return this.data.has(key) ? this.data.get(key) : null;
  }
  async get(key) {
    try {
      return await this.getStrict(key);
    } catch {
      return null;
    }
  }
  async put(key, value) {
    if (this.failWrites) throw new Error("storage offline");
    this.data.set(key, value);
  }
  async delete(key) {
    this.data.delete(key);
  }
  async list({ prefix = "" } = {}) {
    if (this.failList) {
      this.lastError = "storage offline";
      return { keys: [], list_complete: true };
    }
    this.lastError = null;
    return {
      keys: [...this.data.keys()]
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true,
    };
  }
}

const ctx = { waitUntil() {} };

/** Serve the snippet catalog locally; the worker only needs the keys for
 *  pruning, not a network round-trip. Seed translation files are served from
 *  `seeds` (one object per language) and `seedIndex`; anything else is a 404,
 *  so tests never depend on the real network. */
async function callWorker(path, env, { seeds = {}, seedIndex = null } = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/dist/js/snippets/")) {
      return new Response(JSON.stringify({ Section: ["Home"] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (target.includes("/translations/index.json")) {
      return seedIndex
        ? new Response(JSON.stringify(seedIndex), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        : new Response("not found", { status: 404 });
    }
    const seed = target.match(/\/translations\/([^/]+)\.json$/);
    if (seed) {
      const language = decodeURIComponent(seed[1]);
      return seeds[language]
        ? new Response(JSON.stringify(seeds[language]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        : new Response("not found", { status: 404 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    return await worker.fetch(new Request(`https://g4f.dev${path}`), env, ctx);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("translations fall back to the Blob mirror when the primary fails", async () => {
  const primary = new MemoryKv();
  primary.failReads = true;
  const mirror = new MemoryKv({
    "challenge:translations:de": JSON.stringify({ Home: "Startseite" }),
  });
  const response = await callWorker("/challenge/translations?lang=de", {
    CAKE_KV: primary,
    CHALLENGE_TRANSLATIONS_KV: mirror,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.language, "de");
  assert.equal(body.count, 1);
  assert.equal(body.translations.Home, "Startseite");
});

test("an empty primary still falls back to a populated mirror", async () => {
  const primary = new MemoryKv();
  const mirror = new MemoryKv({
    "challenge:translations:es": JSON.stringify({ Home: "Inicio" }),
  });
  const response = await callWorker("/challenge/translations?lang=es", {
    CAKE_KV: primary,
    CHALLENGE_TRANSLATIONS_KV: mirror,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.count, 1);
  assert.equal(body.translations.Home, "Inicio");
});

test("an empty primary store is reported as empty, not unavailable", async () => {
  const response = await callWorker("/challenge/translations?lang=nl", {
    CAKE_KV: new MemoryKv(),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.count, 0);
  assert.deepEqual(body.translations, {});
});

test("a primary outage without a mirror copy returns 503 and is not cached", async () => {
  const primary = new MemoryKv();
  primary.failReads = true;
  const mirror = new MemoryKv();
  mirror.failReads = true;
  const response = await callWorker("/challenge/translations?lang=fr", {
    CAKE_KV: primary,
    CHALLENGE_TRANSLATIONS_KV: mirror,
  });
  assert.equal(response.status, 503);
  assert.match(response.headers.get("Cache-Control") || "", /no-store/);
  assert.equal(response.headers.get("Retry-After"), "60");
  const body = await response.json();
  assert.equal(body.error, "translations_unavailable");
});

test("the language index reports an unreadable store instead of zero counts", async () => {
  const primary = new MemoryKv({
    "challenge:translations:it": JSON.stringify({ Home: "Casa" }),
  });
  primary.failList = true;
  const response = await callWorker("/challenge/translations/languages", {
    CAKE_KV: primary,
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, "translations_unavailable");
});

test("translations prefer the dedicated Blob store over the shared KV", async () => {
  const primary = new MemoryKv({
    "challenge:translations:ja": JSON.stringify({ Home: "shared" }),
  });
  const mirror = new MemoryKv({
    "challenge:translations:ja": JSON.stringify({ Home: "ホーム" }),
  });
  const response = await callWorker("/challenge/translations?lang=ja", {
    CAKE_KV: primary,
    CHALLENGE_TRANSLATIONS_KV: mirror,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.translations.Home, "ホーム");
});

test("a missing store is hydrated from the bundled seed into Blob", async () => {
  const primary = new MemoryKv();
  const mirror = new MemoryKv();
  const response = await callWorker(
    "/challenge/translations?lang=pt",
    { CAKE_KV: primary, CHALLENGE_TRANSLATIONS_KV: mirror },
    { seeds: { pt: { Home: "Início" } } }
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.count, 1);
  assert.equal(body.translations.Home, "Início");
  // The seed was persisted to the durable translation store.
  const stored = mirror.data.get("challenge:translations:pt");
  assert.ok(stored, "expected the hydrated store in Blob");
  assert.equal(JSON.parse(stored).Home, "Início");
});

test("the language index reports not-yet-hydrated seed language counts", async () => {
  const response = await callWorker(
    "/challenge/translations/languages",
    { CAKE_KV: new MemoryKv() },
    { seeds: { pl: { Home: "Dom" } }, seedIndex: { pl: 1 } }
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  const entry = body.languages.find((item) => item.language === "pl");
  assert.ok(entry, "expected the seed language in the index");
  assert.equal(entry.count, 1);
});

test("Upstash errors in HTTP 200 bodies are surfaced and backed off", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        error:
          "ERR This database has reached current Fixed plan limits. Please upgrade manually or enable auto upgrade on Upstash Console",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  try {
    const kv = new UpstashKv("https://example.upstash.io", "token");
    await assert.rejects(kv.command(["GET", "key"]), /Fixed plan limits/);
    assert.equal(kv.quotaExceeded, true);

    // The cooldown short-circuits further commands, so an exhausted database
    // is not hammered by translation reads.
    assert.equal(await kv.get("key"), null);
    const health = await kv.health();
    assert.equal(health.ok, false);
    assert.equal(health.quota_exceeded, true);
    assert.ok(health.retry_after_s > 0);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Upstash HTTP errors carry their detail", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "ERR max memory limit reached" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  try {
    const kv = new UpstashKv("https://example.upstash.io", "token");
    await assert.rejects(kv.getStrict("key"), /max memory limit reached/);
    assert.equal(kv.quotaExceeded, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
