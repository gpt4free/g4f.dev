// Uploads the restored community translation stores to Vercel Blob.
//
// The stores in dist/js/translations/ were recovered from the Upstash RDB
// (challenge:translations:<lang>) after the Fixed-plan limit made the live
// database read-only. The challenge worker already hydrates a missing language
// from these files on first use, but this script can pre-seed Blob directly so
// every language is available immediately.
//
// It uses the same REST API and TTL envelope as BlobKv in api/challenge.js:
// PUT https://blob.vercel-storage.com/<key> with a {"v": <value>, "e": <ms>}
// body and the deterministic (no random suffix) header.
//
// Usage:
//   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... \
//     node scripts/restore-translations-blob.mjs [options]
//
// Options:
//   --dir <path>       seed directory (default: dist/js/translations)
//   --lang <code>      upload only this language (repeatable)
//   --ttl-days <n>     expiration in days (default: 365)
//   --concurrency <n>  parallel uploads (default: 4)
//   --access <mode>    store access mode: private or public
//                      (default: BLOB_ACCESS or "private")
//   --verify           read every uploaded store back after writing
//   --clean            delete existing translation blobs before uploading
//   --dry-run          print the uploads without sending them
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BLOB_BASE = "https://blob.vercel-storage.com";
const BLOB_API = "https://vercel.com/api/blob";
const BLOB_API_VERSION = "12";
const KEY_PREFIX = "challenge:translations:";

function parseArgs(argv) {
  const options = {
    dir: join(ROOT, "dist/js/translations"),
    langs: [],
    ttlDays: 365,
    concurrency: 4,
    access: process.env.BLOB_ACCESS || "private",
    verify: false,
    clean: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case "--dir":
        options.dir = next();
        break;
      case "--lang":
        options.langs.push(next());
        break;
      case "--ttl-days":
        options.ttlDays = Number(next());
        break;
      case "--concurrency":
        options.concurrency = Number(next());
        break;
      case "--access":
        options.access = next();
        break;
      case "--verify":
        options.verify = true;
        break;
      case "--clean":
        options.clean = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(options.ttlDays) || options.ttlDays <= 0) {
    throw new Error("--ttl-days must be a positive number");
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  if (!["private", "public"].includes(options.access)) {
    throw new Error("--access must be private or public");
  }
  return options;
}

function storeIdFromEnv() {
  const storeId = (process.env.BLOB_STORE_ID || "").trim();
  return storeId.replace(/^store_/, "");
}

function blobHeaders(token, access, storeId, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    "x-api-version": BLOB_API_VERSION,
    ...(access ? { "x-vercel-blob-access": access } : {}),
    ...(storeId ? { "x-vercel-blob-store-id": storeId } : {}),
    ...extra,
  };
}

function blobUrl(storeId, access, key) {
  const encoded = encodeURIComponent(key);
  // Reads use the store host: <store>.<public|private>.blob.vercel-storage.com.
  return storeId
    ? `https://${storeId}.${access}.blob.vercel-storage.com/${encoded}`
    : `${BLOB_BASE}/${encoded}`;
}

function readSeedLanguages(dir, only) {
  const wanted = new Set(only);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json") && name !== "index.json")
    .sort();
  const languages = [];
  for (const name of files) {
    const language = name.slice(0, -".json".length);
    if (wanted.size && !wanted.has(language)) continue;
    const raw = readFileSync(join(dir, name), "utf8");
    let store;
    try {
      store = JSON.parse(raw);
    } catch (error) {
      throw new Error(`${name}: invalid JSON (${error.message})`);
    }
    if (!store || typeof store !== "object" || Array.isArray(store)) {
      throw new Error(`${name}: expected a JSON object`);
    }
    languages.push({ language, value: raw.trim() });
  }
  return languages;
}

async function uploadOne(token, { language, value }, options) {
  const key = `${KEY_PREFIX}${language}`;
  const body = JSON.stringify({
    v: value,
    e: Date.now() + Math.round(options.ttlDays * 86400) * 1000,
  });
  const params = new URLSearchParams({ pathname: key });
  const response = await fetch(`${BLOB_API}/?${params.toString()}`, {
    method: "PUT",
    headers: blobHeaders(token, options.access, options.storeId, {
      "x-content-type": "text/plain; charset=utf-8",
      "x-add-random-suffix": "0",
      "x-allow-overwrite": "1",
    }),
    body,
  });
  if (!response.ok) {
    throw new Error(`${language}: Blob ${response.status}: ${await response.text()}`);
  }
}

async function verifyOne(token, { language }, options) {
  const key = `${KEY_PREFIX}${language}`;
  if (!options.storeId) throw new Error(`${language}: BLOB_STORE_ID is required to verify reads`);
  // Newly written private blobs can take a moment to appear on the read host,
  // so retry a few times and bypass the CDN cache.
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    const url = `${blobUrl(options.storeId, options.access, key)}?cache=0`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 404) {
      lastError = new Error(`${language}: verify Blob 404: ${await response.text()}`);
      continue;
    }
    if (!response.ok) {
      throw new Error(`${language}: verify Blob ${response.status}: ${await response.text()}`);
    }
    const parsed = JSON.parse(await response.text());
    if (!parsed || typeof parsed.v !== "string" || !parsed.v.includes('"')) {
      throw new Error(`${language}: verify returned an unexpected body`);
    }
    return;
  }
  throw lastError || new Error(`${language}: verify failed`);
}

async function listExistingBlobs(token, options) {
  const blobs = [];
  let cursor;
  do {
    const params = new URLSearchParams({ limit: "1000", prefix: KEY_PREFIX });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`${BLOB_API}?${params.toString()}`, {
      headers: blobHeaders(token, options.access, options.storeId),
    });
    if (!response.ok) {
      throw new Error(`list failed: Blob ${response.status}: ${await response.text()}`);
    }
    const data = await response.json();
    blobs.push(...(data.blobs || []));
    cursor = data.hasMore ? data.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function deleteExistingBlobs(token, options) {
  const blobs = await listExistingBlobs(token, options);
  for (const blob of blobs) {
    const params = new URLSearchParams({ pathname: blob.pathname });
    const response = await fetch(`${BLOB_API}/?${params.toString()}`, {
      method: "DELETE",
      headers: blobHeaders(token, options.access, options.storeId),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`${blob.pathname}: delete Blob ${response.status}: ${await response.text()}`);
    }
  }
  console.log(`  cleaned ${blobs.length} existing translation blob(s)`);
}

async function runPool(items, concurrency, task) {
  const failures = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      try {
        await task(item);
      } catch (error) {
        failures.push(error);
      }
    }
  });
  await Promise.all(workers);
  return failures;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (options.help) {
    console.log("Usage: BLOB_READ_WRITE_TOKEN=... node scripts/restore-translations-blob.mjs [--dir <path>] [--lang <code>]... [--ttl-days <n>] [--concurrency <n>] [--dry-run]");
    return;
  }

  const languages = readSeedLanguages(options.dir, options.langs);
  if (!languages.length) {
    console.error(`No translation seeds found in ${options.dir}`);
    process.exit(1);
  }

  if (options.dryRun) {
    console.log(`Would upload ${languages.length} languages to Vercel Blob:`);
    for (const { language } of languages) console.log(`  ${KEY_PREFIX}${language}`);
    return;
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN;
  if (!token) {
    console.error("No Blob credentials. Set BLOB_READ_WRITE_TOKEN (or VERCEL_OIDC_TOKEN with BLOB_STORE_ID), or run with --dry-run.");
    process.exit(1);
  }
  options.storeId = storeIdFromEnv();

  if (options.clean) {
    console.log("Removing existing translation blobs ...");
    await deleteExistingBlobs(token, options);
  }

  console.log(`Uploading ${languages.length} languages to Vercel Blob (${options.access}) ...`);
  const failures = await runPool(languages, options.concurrency, async (entry) => {
    await uploadOne(token, entry, options);
    if (options.verify) await verifyOne(token, entry, options);
    console.log(`  ok ${entry.language}`);
  });

  if (failures.length) {
    console.error(`\n${failures.length} upload(s) failed:`);
    for (const error of failures) console.error(`  ${error.message}`);
    process.exit(1);
  }
  console.log(`Done: ${languages.length} languages restored.`);
}

await main();
