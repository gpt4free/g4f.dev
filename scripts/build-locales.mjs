// Generates locale-prefixed static routes (for example /fr/chat/) for the
// GitHub Pages deployment. GitHub Pages is static only, so the Flask locale
// middleware in g4f/gui/server/locale.py cannot run here. Instead we mirror
// every HTML page under each locale with:
//   - the document language set to the locale,
//   - relative links and asset references rewritten to root-absolute URLs,
//   - canonical + hreflang alternates,
//   - text nodes, visible attributes, and SEO metadata translated from the
//     community translation store at build time, and
//   - the same runtime translation bootstrap the GUI uses (for dynamic copy).
//
// Usage: node scripts/build-locales.mjs [--root <dir>]
//        [--no-translations] [--translations-url <url>]
//        [--translations-file <json>]
import { readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://g4f.dev";
// Every language with a community translation package at
// https://beta.g4f.dev/challenge/translations/languages. English stays
// unprefixed, so it is not generated.
export const LOCALES = [
  "ar", "bg", "cs", "da", "de", "el", "es", "et", "fa", "fi",
  "fr", "he", "hi", "hr", "hu", "id", "it", "ja", "kk", "ko",
  "nb", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sq", "sr",
  "sv", "th", "tr", "uk", "ur", "uz", "vi", "zh",
];
export const ALL_LOCALES = ["en", ...LOCALES];
const RTL_LANGUAGES = new Set(["ar", "fa", "he", "ur"]);
const SKIP_DIRS = new Set([
  ".git", ".github", "node_modules", "private", "dist", "assets",
  "workers", ".vercel", ".wrangler",
]);
const SKIP_FILES = new Set(["404.html", "google-site-verification.html"]);
const DEFAULT_TRANSLATIONS_URL = "https://beta.g4f.dev/challenge/translations";
const TRANSLATIONS_TIMEOUT_MS = 15000;
const TRANSLATIONS_CONCURRENCY = 6;
// Metadata is translated from the same community catalog as the visible copy.
// Write the collected English strings into the snippet store so community
// translation challenges can cover <title> and the SEO meta tags too.
const META_CATALOG = "dist/js/snippets/meta.json";
// Restored community stores (recovered from the challenge KV RDB). The build
// falls back to these files when the API is unavailable or returns an empty
// package, so a translation-storage outage never strips the static site.
const BUNDLED_TRANSLATIONS_DIR = "dist/js/translations";

const PROTECTED_BLOCKS = /(<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->)/i;
const TEXT_NODE = />([^<]+)</g;
const TAG = /<[a-zA-Z][^>]*>/g;
// Attributes the browser runtime also translates, plus ARIA labels/tooltips
// which are visible to assistive technology and hover users.
const TRANSLATABLE_ATTRIBUTE = /(\s)(alt|title|placeholder|aria-label|aria-description|aria-placeholder|data-tooltip|data-title)(\s*=\s*)(["'])([\s\S]*?)\4/gi;
const SEO_META = new Set([
  "description", "keywords", "title",
  "og:title", "og:description", "twitter:title", "twitter:description",
]);
const META_TAG = /<meta\b[^>]*>/gi;
const META_KEY = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i;
const META_CONTENT = /(?:\s)content\s*=\s*("([^"]*)"|'([^']*)')/i;
const TITLE_TAG = /<title\b[^>]*>([\s\S]*?)<\/title>/i;
const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
};

export function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function decodeEntities(value) {
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const radix = entity[1].toLowerCase() === "x" ? 16 : 10;
      const digits = radix === 16 ? entity.slice(2) : entity.slice(1);
      const code = Number.parseInt(digits, radix);
      if (!Number.isFinite(code)) return match;
      try {
        return String.fromCodePoint(code);
      } catch (e) {
        return match;
      }
    }
    const named = NAMED_ENTITIES[entity.toLowerCase()];
    return named === undefined ? match : named;
  });
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Trim-aware translation lookup that preserves surrounding whitespace. */
export function translateText(text, translations) {
  if (!text || !translations || !text.trim()) return text;
  const key = normalizeText(decodeEntities(text));
  if (!key || key.startsWith(("http://", "https://"))) return text;
  if (!/[\p{L}]/u.test(key) || !/\p{Script=Latin}/u.test(key)) {
    // Keep non-Latin source text and pictograms untouched. Community
    // translations use English source strings, so there is nothing to look up.
    return text;
  }
  const translated = translations[key];
  if (!translated || translated === key) return text;
  const leading = text.slice(0, text.length - text.trimStart().length);
  const trailing = text.slice(text.trimEnd().length);
  return leading + translated + trailing;
}

function translateAttributes(tag, translations) {
  let result = tag.replace(
    TRANSLATABLE_ATTRIBUTE,
    (match, space, name, equals, quote, value) => {
      const translated = translateText(value, translations);
      if (translated === value) return match;
      return space + name + equals + quote + escapeAttribute(translated) + quote;
    },
  );
  if (/^<meta\b/i.test(tag)) {
    const name = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (name && SEO_META.has(name[1].toLowerCase())) {
      result = result.replace(
        /(\scontent\s*=\s*)("([^"]*)"|'([^']*)')/i,
        (match, prefix, _quoted, doubleValue, singleValue) => {
          const quote = doubleValue === undefined ? "'" : '"';
          const value = doubleValue === undefined ? singleValue : doubleValue;
          const translated = translateText(value, translations);
          if (translated === value) return match;
          return prefix + quote + escapeAttribute(translated) + quote;
        },
      );
    }
  }
  if (/^<input\b/i.test(tag)) {
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (type && /^(?:button|submit|reset)$/i.test(type[1])) {
      result = result.replace(
        /(\svalue\s*=\s*)("([^"]*)"|'([^']*)')/i,
        (match, prefix, _quoted, doubleValue, singleValue) => {
          const quote = doubleValue === undefined ? "'" : '"';
          const value = doubleValue === undefined ? singleValue : doubleValue;
          const translated = translateText(value, translations);
          if (translated === value) return match;
          return prefix + quote + escapeAttribute(translated) + quote;
        },
      );
    }
  }
  return result;
}

function translateTag(tag, translations) {
  if (/^<(?:script|style)\b/i.test(tag)) return tag;
  return translateAttributes(tag, translations);
}

/** Translate text nodes and visible attributes in a static HTML document. */
export function translateHtml(html, translations) {
  if (!translations || Object.keys(translations).length === 0) return html;
  const parts = html.split(PROTECTED_BLOCKS);
  for (let index = 0; index < parts.length; index += 2) {
    parts[index] = parts[index]
      .replace(TEXT_NODE, (match, text) => {
        const translated = translateText(text, translations);
        return translated === text ? match : ">" + escapeText(translated) + "<";
      })
      .replace(TAG, (tag) => translateTag(tag, translations));
  }
  return parts.join("");
}

/** Collect the translatable `<title>` and SEO meta text of one document.
 *  Community translation challenges are generated from this list, so keeping
 *  it in sync with `translateHtml` is what makes localized meta tags work. */
export function collectMetaSnippets(html) {
  const snippets = new Set();
  const add = (value) => {
    const text = normalizeText(decodeEntities(value));
    if (!text || text.length > 2000) return;
    if (text.startsWith("http://") || text.startsWith("https://")) return;
    if (!/\p{L}/u.test(text)) return;
    snippets.add(text);
  };
  // Mirror translateHtml(): never collect tags that only exist inside a
  // script, style block, or comment.
  const parts = html.split(PROTECTED_BLOCKS);
  for (let index = 0; index < parts.length; index += 2) {
    const title = TITLE_TAG.exec(parts[index]);
    if (title) add(title[1]);
    for (const tag of parts[index].match(META_TAG) || []) {
      const key = META_KEY.exec(tag);
      if (!key || !SEO_META.has(key[1].toLowerCase())) continue;
      const content = META_CONTENT.exec(tag);
      if (content) add(content[2] ?? content[3]);
    }
  }
  return [...snippets];
}

/** Build the snippet catalog for page metadata. It uses the same shape as the
 *  per-page UI catalogs, so the challenge worker serves the strings to
 *  community translators and the locale build translates them back. */
export function buildMetaCatalog(root) {
  const snippets = new Set();
  for (const rel of walk(root).sort()) {
    const html = readFileSync(join(root, rel), "utf8");
    for (const text of collectMetaSnippets(html)) snippets.add(text);
  }
  return {
    _meta: {
      page: "meta",
      comment: "Translatable <title> and SEO metadata of every English HTML page. "
        + "Generated by scripts/build-locales.mjs and consumed by the challenge "
        + "worker's batch translation challenges (kind=translations), so localized "
        + "pages can translate their metadata from the community catalog. Groups "
        + "starting with '_' are metadata.",
    },
    Metadata: [...snippets],
  };
}

function writeMetaCatalog(root) {
  const catalog = buildMetaCatalog(root);
  const target = join(root, META_CATALOG);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(catalog, null, 4) + "\n");
  return catalog.Metadata.length;
}

function walk(root, dir = root, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = posix.join(posix.relative(root, dir).replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      // Never recurse into a locale output directory from a previous build.
      if (dir === root && ALL_LOCALES.includes(entry.name)) continue;
      walk(root, full, out);
    } else if (entry.name.endsWith(".html") && !SKIP_FILES.has(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

export function pagePath(rel) {
  const clean = rel.replace(/\\/g, "/");
  if (clean === "index.html") return "/";
  if (clean.endsWith("/index.html")) return "/" + clean.slice(0, -"index.html".length);
  return "/" + clean;
}

const STATE_ATTR = /(\s(?:href|src|action|poster)\s*=\s*)(["'])([^"']*)\2/gi;
const ABSOLUTE_OR_SPECIAL = /^(?:#|\/|\\|(?:[a-z][a-z0-9+.-]*:)|$)/i;

/** Resolve relative `href`/`src` references to root-absolute URLs.
 *
 *  Locale pages used to inject `<base href="/chat/">` so relative assets kept
 *  working. A base element also changes how fragment-only links and
 *  `history.pushState("#settings")` resolve: `#login` became
 *  `/chat/#login`, so /de/chat/ silently dropped back to /chat/ (breaking the
 *  language choice and the login round-trip). Rewriting the few relative
 *  references at build time lets the locale page keep its own URL instead.
 *  Fragment-only links are left untouched so they stay on the current page. */
export function rewriteRelativeUrls(html, rel) {
  const base = "https://g4f.dev" + originalDir(rel);
  const parts = html.split(PROTECTED_BLOCKS);
  for (let index = 0; index < parts.length; index += 2) {
    parts[index] = parts[index].replace(TAG, (tag) =>
      tag.replace(STATE_ATTR, (match, prefix, quote, value) => {
        const trimmed = value.trim();
        if (!trimmed || trimmed.startsWith("#") || ABSOLUTE_OR_SPECIAL.test(trimmed)) {
          return match;
        }
        if (trimmed.startsWith("{{") || trimmed.startsWith("${")) {
          return match;
        }
        let resolved;
        try {
          resolved = new URL(trimmed, base);
        } catch (e) {
          return match;
        }
        if (resolved.origin !== "https://g4f.dev") {
          return match;
        }
        const target = resolved.pathname + resolved.search + resolved.hash;
        return prefix + quote + escapeAttribute(target) + quote;
      }),
    );
  }
  return parts.join("");
}

export function originalDir(rel) {
  const dir = posix.dirname(rel.replace(/\\/g, "/"));
  return dir === "." ? "/" : "/" + dir.replace(/\/?$/, "/");
}

function setHtmlLang(html, locale) {
  return html.replace(/<html\b([^>]*)>/i, (tag, attrs) => {
    const cleaned = attrs
      .replace(/\s+lang\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "")
      .replace(/\s+dir\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "");
    const dir = RTL_LANGUAGES.has(locale) ? "rtl" : "ltr";
    return `<html${cleaned} lang="${locale}" dir="${dir}">`;
  });
}

function stripSeoTags(html) {
  return html
    .replace(/<link\b(?=[^>]*\brel\s*=\s*["']canonical["'])[^>]*>\s*/gi, "")
    .replace(/<link\b(?=[^>]*\bhreflang\s*=)[^>]*>\s*/gi, "")
    // og:url and og:locale describe the current URL/market, not the English
    // source, so they are replaced with locale-specific values.
    .replace(
      /<meta\b(?=[^>]*\b(?:name|property)\s*=\s*["'](?:og:url|og:locale)["'])[^>]*>\s*/gi,
      "",
    );
}

function insertHead(html, markup) {
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (match) => match + "\n" + markup);
  }
  return markup + html;
}

function seoMarkup(rel, locale) {
  const pathname = pagePath(rel);
  const canonical = `${SITE}/${locale}${pathname}`.replace(/(?<!:)\/{2,}/g, "/");
  const lines = [
    `<meta property="og:locale" content="${escapeAttribute(locale)}">`,
    `<meta property="og:url" content="${escapeAttribute(canonical)}">`,
    `<link rel="canonical" href="${escapeAttribute(canonical)}">`,
  ];
  for (const lang of ALL_LOCALES) {
    const href = lang === "en"
      ? `${SITE}${pathname}`
      : `${SITE}/${lang}${pathname}`;
    lines.push(
      `<link rel="alternate" hreflang="${lang}" href="${escapeAttribute(href.replace(/(?<!:)\/{2,}/g, "/"))}">`
    );
  }
  lines.push(
    `<link rel="alternate" hreflang="x-default" href="${escapeAttribute(`${SITE}${pathname}`)}">`
  );
  return lines.join("\n    ");
}

function runtimeScript(locale) {
  return `
<script data-g4f-locale-runtime="1">
(function () {
    "use strict";
    const locale = ${JSON.stringify(locale)};
    const supported = ${JSON.stringify(ALL_LOCALES)};
    const match = location.pathname.match(/^\\/([a-z]{2})(?:\\/|$)/i);
    const opened = match && supported.includes(match[1].toLowerCase())
        ? match[1].toLowerCase()
        : String(document.documentElement.lang || locale || "en")
            .split(/[-_]/)[0].toLowerCase();
    const base = supported.includes(opened) ? opened : "en";
    const apply = () => {
        if (!window.framework) return false;
        try {
            if (framework.setSelectedLanguage) framework.setSelectedLanguage(base);
        } catch (e) { /* private mode */ }
        const cached = framework.globalTranslations && framework.globalTranslations[base];
        if (cached && cached.translations) {
            framework.translations = Object.assign({}, framework.translations, cached.translations);
            if (framework.translateElements) framework.translateElements();
        }
        if (base !== "en" && typeof framework.loadGlobalTranslations === "function") {
            framework.loadGlobalTranslations(base).then((entry) => {
                if (entry && entry.translations) {
                    framework.translations = Object.assign(
                        {}, framework.translations, entry.translations
                    );
                }
                if (framework.translateElements) framework.translateElements();
                if (typeof framework.translateAll === "function") framework.translateAll();
            }).catch(() => {});
        } else if (typeof framework.translateAll === "function") {
            framework.translateAll();
        }
        return true;
    };
    if (!apply()) {
        document.addEventListener("DOMContentLoaded", apply, { once: true });
        window.addEventListener("load", apply, { once: true });
    }
})();
</script>
`;
}

export function localize(html, rel, locale, translations = {}) {
  let result = setHtmlLang(html, locale);
  result = stripSeoTags(result);
  result = removeBase(result);
  // Translate the original markup first, so the injected canonical and
  // runtime script are never treated as translatable content.
  result = translateHtml(result, translations);
  // Resolve relative references at build time instead of injecting a <base>
  // element, which would break fragment links and history.pushState().
  result = rewriteRelativeUrls(result, rel);
  result = insertHead(result, seoMarkup(rel, locale));
  const script = runtimeScript(locale);
  if (!/data-g4f-locale-runtime/.test(result)) {
    if (/<\/body>/i.test(result)) {
      result = result.replace(/<\/body>/i, script + "</body>");
    } else {
      result += script;
    }
  }
  return result;
}

function removeBase(html) {
  return html.replace(/<base\b[^>]*>\s*/gi, "");
}

function normalizeTranslations(value) {
  if (!value || typeof value !== "object") return {};
  if (value.translations && typeof value.translations === "object") {
    return value.translations;
  }
  const translations = {};
  for (const [source, translated] of Object.entries(value)) {
    if (typeof translated === "string" && translated.trim() && source.trim()) {
      translations[source] = translated;
    }
  }
  return translations;
}

/** Read one restored `<locale>.json` store bundled with the repository. */
export function readBundledTranslation(root, locale) {
  try {
    const path = join(root, BUNDLED_TRANSLATIONS_DIR, `${locale}.json`);
    return normalizeTranslations(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}

function readTranslationsFile(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  const stores = {};
  for (const locale of LOCALES) {
    if (data[locale] !== undefined) stores[locale] = normalizeTranslations(data[locale]);
  }
  // A file containing a single store (for example a saved API response) can
  // be used as the source for every generated locale.
  if (Object.keys(stores).length === 0 && data.translations) {
    for (const locale of LOCALES) {
      stores[locale] = normalizeTranslations(data);
    }
  }
  return stores;
}

async function fetchTranslations(locales, url, root = ROOT) {
  const stores = {};
  const queue = [...locales];

  async function worker() {
    while (queue.length) {
      const locale = queue.shift();
      const endpoint = new URL(url);
      endpoint.searchParams.set("lang", locale);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TRANSLATIONS_TIMEOUT_MS);
      try {
        const response = await fetch(endpoint, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const remote = normalizeTranslations(data);
        stores[locale] = Object.keys(remote).length
          ? remote
          : readBundledTranslation(root, locale);
      } catch (error) {
        const reason = error && error.name === "AbortError"
          ? `timed out after ${TRANSLATIONS_TIMEOUT_MS / 1000}s`
          : String(error && error.message ? error.message : error);
        const bundled = readBundledTranslation(root, locale);
        if (Object.keys(bundled).length) {
          stores[locale] = bundled;
          console.warn(`  ! ${locale}: ${reason} (using bundled translations)`);
        } else {
          console.warn(`  ! ${locale}: ${reason}`);
        }
      } finally {
        clearTimeout(timer);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(TRANSLATIONS_CONCURRENCY, locales.length) }, worker)
  );
  return stores;
}

export async function loadTranslations(options = {}) {
  if (options.translations === false) return {};
  if (options.translationsFile) {
    console.log(`Reading translations from ${options.translationsFile}.`);
    return readTranslationsFile(options.translationsFile);
  }
  const url = options.translationsUrl || DEFAULT_TRANSLATIONS_URL;
  console.log(`Loading community translations from ${url} ...`);
  return fetchTranslations(LOCALES, url, options.root || ROOT);
}

function parseArgs(argv) {
  const options = {
    root: ROOT,
    translations: true,
    translationsUrl: process.env.G4F_TRANSLATIONS_URL || DEFAULT_TRANSLATIONS_URL,
    translationsFile: process.env.G4F_TRANSLATIONS_FILE || null,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--root") {
      options.root = argv[++index];
    } else if (arg === "--no-translations") {
      options.translations = false;
    } else if (arg === "--translations-url") {
      options.translationsUrl = argv[++index];
    } else if (arg === "--translations-file") {
      options.translationsFile = argv[++index];
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/build-locales.mjs [--root <dir>] [--no-translations]");
      console.log("       [--translations-url <url>] [--translations-file <json>]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const pages = walk(options.root).sort();
  // Refresh the metadata snippet catalog before translating, so a deploy also
  // publishes every <title> and SEO string for community translation.
  const metaCount = writeMetaCatalog(options.root);
  console.log(`Wrote ${metaCount} metadata snippets to ${META_CATALOG}.`);
  const stores = await loadTranslations(options);
  const translated = Object.values(stores).filter(
    (store) => store && Object.keys(store).length,
  ).length;
  if (options.translations !== false) {
    console.log(`Applied translation packages for ${translated}/${LOCALES.length} locales.`);
  }
  let written = 0;
  for (const locale of LOCALES) {
    const localeRoot = join(options.root, locale);
    rmSync(localeRoot, { recursive: true, force: true });
    for (const rel of pages) {
      const source = join(options.root, rel);
      const target = join(localeRoot, rel);
      const html = localize(
        readFileSync(source, "utf8"),
        rel,
        locale,
        stores[locale] || {},
      );
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, html);
      written++;
    }
  }
  console.log(`Generated ${written} locale pages in ${LOCALES.join(", ")}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
