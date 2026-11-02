// Generates locale-prefixed static routes (for example /fr/chat/) for the
// GitHub Pages deployment. GitHub Pages is static only, so the Flask locale
// middleware in g4f/gui/server/locale.py cannot run here. Instead we mirror
// every HTML page under each locale with:
//   - the document language set to the locale,
//   - a <base> pointing at the original page directory (so relative assets,
//     manifests and links keep working without duplicating static files),
//   - canonical + hreflang alternates,
//   - text nodes and visible attributes translated from the community
//     translation store at build time, and
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

const PROTECTED_BLOCKS = /(<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->)/i;
const TEXT_NODE = />([^<]+)</g;
const TAG = /<[a-zA-Z][^>]*>/g;
// Attributes the browser runtime also translates, plus ARIA labels/tooltips
// which are visible to assistive technology and hover users.
const TRANSLATABLE_ATTRIBUTE = /(\s)(alt|title|placeholder|aria-label|aria-description|aria-placeholder|data-tooltip|data-title)(\s*=\s*)(["'])([\s\S]*?)\4/gi;
const SEO_META = new Set([
  "description", "og:title", "og:description", "twitter:title", "twitter:description",
]);
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
    .replace(/<link\b(?=[^>]*\bhreflang\s*=)[^>]*>\s*/gi, "");
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
  // Translate the original markup first, so the injected <base>, canonical
  // and runtime script are never treated as translatable content.
  result = translateHtml(result, translations);
  result = insertHead(
    result,
    `<base href="${escapeAttribute(originalDir(rel))}">\n    ${seoMarkup(rel, locale)}`
  );
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

async function fetchTranslations(locales, url) {
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
        stores[locale] = normalizeTranslations(data);
      } catch (error) {
        const reason = error && error.name === "AbortError"
          ? `timed out after ${TRANSLATIONS_TIMEOUT_MS / 1000}s`
          : String(error && error.message ? error.message : error);
        console.warn(`  ! ${locale}: ${reason}`);
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
  return fetchTranslations(LOCALES, url);
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
