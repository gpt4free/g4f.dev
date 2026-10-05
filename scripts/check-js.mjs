// Syntax-checks every JavaScript file in this repository (build check).
// Usage: node scripts/check-js.mjs  — exits non-zero on the first invalid file.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", ".git"]);
const EXTENSIONS = [".js", ".mjs"];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      yield join(dir, entry.name);
    }
  }
}

let count = 0;
let failed = false;
for (const file of walk(ROOT)) {
  count++;
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "pipe" });
  if (result.status !== 0) {
    failed = true;
    console.error(`\n✘ ${file}`);
    process.stderr.write(result.stderr);
  }
}

if (failed) {
  console.error(`\nJS syntax check failed (${count} files scanned).`);
  process.exit(1);
}
console.log(`JS syntax check passed: ${count} files OK.`);
