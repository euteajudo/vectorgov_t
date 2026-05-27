#!/usr/bin/env node
/**
 * Baixa skills do R2 para `packages/skills/active`.
 *
 * Requer Wrangler autenticado. Por padrao usa o bucket `vectorgov-t-skills`
 * e o prefixo `active/`.
 */

import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "packages", "skills", "active");

const args = process.argv.slice(2);
const BUCKET =
  args.find((arg) => arg.startsWith("--bucket="))?.split("=")[1] ??
  "vectorgov-t-skills";
const PREFIX =
  args.find((arg) => arg.startsWith("--prefix="))?.split("=")[1] ?? "active/";
const CLEAN = args.includes("--clean");

function runWrangler(wranglerArgs, options = {}) {
  const result = spawnSync("wrangler", wranglerArgs, {
    encoding: "utf-8",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `wrangler ${wranglerArgs.join(" ")} falhou com exit ${result.status}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function extractObjects(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.objects)) return payload.objects;
  if (payload.result && Array.isArray(payload.result.objects)) {
    return payload.result.objects;
  }
  return [];
}

console.log(`[skills-download] bucket: ${BUCKET}`);
console.log(`[skills-download] prefix: ${PREFIX}`);
console.log(`[skills-download] out   : ${OUT_DIR}`);

mkdirSync(OUT_DIR, { recursive: true });
if (CLEAN) {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
}

const listRaw = runWrangler([
  "r2",
  "object",
  "list",
  BUCKET,
  "--prefix",
  PREFIX,
  "--remote",
  "--json",
]);
const objects = extractObjects(JSON.parse(listRaw)).filter((item) =>
  String(item.key ?? "").endsWith(".md"),
);

if (objects.length === 0) {
  console.log("[skills-download] nenhuma skill markdown encontrada.");
  process.exit(0);
}

for (const obj of objects) {
  const key = String(obj.key);
  const fileName = key.slice(PREFIX.length);
  const destination = join(OUT_DIR, fileName);
  console.log(`  <- ${key}`);
  runWrangler([
    "r2",
    "object",
    "get",
    `${BUCKET}/${key}`,
    "--file",
    destination,
    "--remote",
  ]);
}

console.log(`[skills-download] OK: ${objects.length} arquivo(s) baixado(s).`);
