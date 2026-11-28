#!/usr/bin/env node
/**
 * Sync and bump the cache-busting build number across:
 *   - js/app.js      (APP_BUILD = "<N>")
 *   - index.html     (?v=<N>)
 *   - sw.js          (talk-shell-v<N>, ?v=<N>, and // @shell-esm-start..end)
 *
 * Usage:
 *   node scripts/bump-build.mjs          # increment APP_BUILD by 1 and sync SW ESM graph
 *   node scripts/bump-build.mjs 300      # set build number explicitly
 *   node scripts/bump-build.mjs --sync   # keep current APP_BUILD, sync ?v= and SW ESM graph
 *   node scripts/bump-build.mjs --check  # exit 1 if anything is out of sync
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..");

const APP_JS = path.join(ROOT, "js/app.js");
const INDEX_HTML = path.join(ROOT, "index.html");
const SW_JS = path.join(ROOT, "sw.js");

const ESM_START = "// @shell-esm-start";
const ESM_END = "// @shell-esm-end";

export function readAppBuild(root = ROOT) {
  const src = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
  const match = src.match(/const APP_BUILD = "(\d+)"/);
  if (!match) throw new Error('Could not find `const APP_BUILD = "<num>"` in js/app.js');
  return Number(match[1]);
}

export function extractHtmlAssets(root = ROOT) {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const styles = [];
  const scripts = [];
  const moduleEntries = [];

  for (const m of html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const href = m[1];
    if (!/^https?:\/\//i.test(href)) styles.push(href);
  }
  for (const m of html.matchAll(/<script\b([^>]*)src=["']([^"']+)["'][^>]*>/gi)) {
    const attrs = m[1] || "";
    const src = m[2];
    if (/^https?:\/\//i.test(src)) continue;
    scripts.push(src);
    if (/\btype=["']module["']/i.test(attrs)) {
      moduleEntries.push(src.split("?")[0]);
    }
  }
  return { styles, scripts, moduleEntries };
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
}

export function extractStaticImports(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const clean = stripComments(raw);
  const specifiers = new Set();

  // Matches:
  //   import ... from "./foo.js"
  //   export ... from "./foo.js"
  //   import "./foo.js"
  const fromRe = /(?:^|[\n;])\s*(?:import|export)\s+(?:[^"'`;]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g;
  for (const m of clean.matchAll(fromRe)) {
    specifiers.add(m[1]);
  }
  return [...specifiers];
}

/**
 * Recursively collects all ES module files imported by the module entries in
 * index.html, excluding the entries themselves (which are already listed in
 * SHELL with their ?v= query string).
 */
export function collectEsmSubmodules(root = ROOT) {
  const { moduleEntries } = extractHtmlAssets(root);
  const entrySet = new Set(moduleEntries.map((rel) => path.resolve(root, rel)));
  const visited = new Set();
  const queue = [...entrySet];

  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    if (!fs.existsSync(current)) continue;
    for (const spec of extractStaticImports(current)) {
      const resolved = path.resolve(path.dirname(current), spec.split("?")[0]);
      if (!visited.has(resolved)) queue.push(resolved);
    }
  }

  return [...visited]
    .filter((abs) => !entrySet.has(abs))
    .map((abs) => `./${path.relative(root, abs).split(path.sep).join("/")}`)
    .sort();
}

export function parseSwShell(root = ROOT) {
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  const cacheMatch = sw.match(/const SHELL_CACHE = "talk-shell-v(\d+)"/);
  const shellMatch = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  if (!cacheMatch || !shellMatch) {
    throw new Error("Could not parse SHELL_CACHE or SHELL array in sw.js");
  }
  const entries = [];
  for (const m of shellMatch[1].matchAll(/"([^"]+)"/g)) {
    entries.push(m[1]);
  }
  return {
    cacheBuild: Number(cacheMatch[1]),
    entries
  };
}

function rewriteEsmBlock(swSource, submodules) {
  const startIdx = swSource.indexOf(ESM_START);
  const endIdx = swSource.indexOf(ESM_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`sw.js is missing ${ESM_START} / ${ESM_END} markers`);
  }
  const body = submodules.length
    ? "\n" + submodules.map((rel) => `  "${rel}",`).join("\n") + "\n  "
    : "\n  ";
  return swSource.slice(0, startIdx + ESM_START.length) + body + swSource.slice(endIdx);
}

export function computeSyncedFiles(targetBuild, root = ROOT) {
  const submodules = collectEsmSubmodules(root);

  const appSrc = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
  const nextApp = appSrc.replace(/const APP_BUILD = "\d+"/, `const APP_BUILD = "${targetBuild}"`);

  const htmlSrc = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const nextHtml = htmlSrc.replace(/\?v=\d+/g, `?v=${targetBuild}`);

  const swSrc = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  let nextSw = swSrc
    .replace(/const SHELL_CACHE = "talk-shell-v\d+"/, `const SHELL_CACHE = "talk-shell-v${targetBuild}"`)
    .replace(/\?v=\d+/g, `?v=${targetBuild}`);
  nextSw = rewriteEsmBlock(nextSw, submodules);

  return {
    submodules,
    files: [
      { path: path.join(root, "js/app.js"), before: appSrc, after: nextApp },
      { path: path.join(root, "index.html"), before: htmlSrc, after: nextHtml },
      { path: path.join(root, "sw.js"), before: swSrc, after: nextSw }
    ]
  };
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const syncOnly = args.includes("--sync");
  const explicitArg = args.find((a) => /^\d+$/.test(a));

  const currentBuild = readAppBuild(ROOT);
  const targetBuild = explicitArg
    ? Number(explicitArg)
    : (checkOnly || syncOnly ? currentBuild : currentBuild + 1);

  const { submodules, files } = computeSyncedFiles(targetBuild, ROOT);
  const changed = files.filter((f) => f.before !== f.after);

  if (checkOnly) {
    if (changed.length) {
      console.error(`Build/shell out of sync (build ${targetBuild}):`);
      for (const f of changed) {
        console.error(`  - ${path.relative(ROOT, f.path)}`);
      }
      process.exit(1);
    }
    console.log(`OK: build ${targetBuild} (${submodules.length} ESM submodules synced)`);
    return;
  }

  for (const f of changed) {
    fs.writeFileSync(f.path, f.after, "utf8");
  }
  console.log(
    `Build ${currentBuild} -> ${targetBuild}: updated ${changed.length} file(s), ${submodules.length} ESM submodule(s) in sw.js.`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
