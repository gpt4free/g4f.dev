// Generates locale-prefixed static routes (for example /fr/chat/) for the
// GitHub Pages deployment. GitHub Pages is static only, so the Flask locale
// middleware in g4f/gui/server/locale.py cannot run here. Instead we mirror
// every HTML page under /es/, /fr/ and /de/ with:
//   - the document language set to the locale,
//   - a <base> pointing at the original page directory (so relative assets,
//     manifests and links keep working without duplicating static files),
//   - canonical + hreflang alternates, and
//   - the same runtime translation bootstrap the GUI uses.
//
// Usage: node scripts/build-locales.mjs [--root <dir>]
import { readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://g4f.dev";
// Every language with a community translation package at
// https://beta.g4f.dev/challenge/translations/languages. English stays
// unprefixed, so it is not generated.
const LOCALES = [
  "ar", "bg", "cs", "da", "de", "el", "es", "et", "fa", "fi",
  "fr", "he", "hi", "hr", "hu", "id", "it", "ja", "kk", "ko",
  "nb", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sq", "sr",
  "sv", "th", "tr", "uk", "ur", "uz", "vi", "zh",
];
const ALL_LOCALES = ["en", ...LOCALES];
const RTL_LANGUAGES = new Set(["ar", "fa", "he", "ur"]);
const SKIP_DIRS = new Set([
  ".git", ".github", "node_modules", "private", "dist", "assets",
  "workers", ".vercel", ".wrangler",
]);
const SKIP_FILES = new Set(["404.html", "google-site-verification.html"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = posix.join(dir.slice(ROOT.length + 1).replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      // Never recurse into a locale output directory from a previous build.
      if (dir === ROOT && ALL_LOCALES.includes(entry.name)) continue;
      walk(full, out);
    } else if (entry.name.endsWith(".html") && !SKIP_FILES.has(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

function pagePath(rel) {
  const clean = rel.replace(/\\/g, "/");
  if (clean === "index.html") return "/";
  if (clean.endsWith("/index.html")) return "/" + clean.slice(0, -"index.html".length);
  return "/" + clean;
}

function originalDir(rel) {
  const dir = posix.dirname(rel.replace(/\\/g, "/"));
  return dir === "." ? "/" : "/" + dir.replace(/\/?$/, "/");
}

function escapeAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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
    const supported = ["en", "es", "fr", "de"];
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

function localize(html, rel, locale) {
  let result = setHtmlLang(html, locale);
  result = stripSeoTags(result);
  result = removeBase(result);
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

function main() {
  const pages = walk(ROOT).sort();
  let written = 0;
  for (const locale of LOCALES) {
    const localeRoot = join(ROOT, locale);
    rmSync(localeRoot, { recursive: true, force: true });
    for (const rel of pages) {
      const source = join(ROOT, rel);
      const target = join(localeRoot, rel);
      const html = localize(readFileSync(source, "utf8"), rel, locale);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, html);
      written++;
    }
  }
  console.log(`Generated ${written} locale pages in ${LOCALES.join(", ")}.`);
}

main();
