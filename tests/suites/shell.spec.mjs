import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { suite } from "../lib/harness.mjs";
import {
  ROOT,
  readAppBuild,
  extractHtmlAssets,
  collectEsmSubmodules,
  parseSwShell,
  computeSyncedFiles
} from "../../scripts/bump-build.mjs";

function walkJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJsFiles(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

suite("shell · build versions, SW precache & static integrity (unit)", { timeout: 15_000 }, (s) => {
  s.test("APP_BUILD, index.html ?v=, and sw.js SHELL_CACHE stay in sync", async (_state, t) => {
    const build = readAppBuild(ROOT);
    const { cacheBuild } = parseSwShell(ROOT);
    t.expect(cacheBuild).toBe(build);

    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");

    const htmlVersions = [...html.matchAll(/\?v=(\d+)/g)].map((m) => Number(m[1]));
    const swVersions = [...sw.matchAll(/\?v=(\d+)/g)].map((m) => Number(m[1]));

    t.expect(htmlVersions.length > 0).toBe(true);
    t.expect(swVersions.length > 0).toBe(true);
    for (const v of htmlVersions) t.expect(v).toBe(build);
    for (const v of swVersions) t.expect(v).toBe(build);

    const { files } = computeSyncedFiles(build, ROOT);
    const drifted = files
      .filter((f) => f.before !== f.after)
      .map((f) => path.relative(ROOT, f.path));
    t.expect(drifted).toEqual([]);
  });

  s.test("sw.js SHELL covers every index.html asset, every ESM submodule, and only existing files", async (_state, t) => {
    const { styles, scripts } = extractHtmlAssets(ROOT);
    const submodules = collectEsmSubmodules(ROOT);
    const { entries } = parseSwShell(ROOT);
    const shellSet = new Set(entries);

    // Every local stylesheet & script in index.html must be precached by sw.js
    const missingFromSw = [];
    for (const asset of [...styles, ...scripts]) {
      const normalized = asset.startsWith("./") ? asset : `./${asset}`;
      if (!shellSet.has(normalized)) missingFromSw.push(normalized);
    }
    for (const mod of submodules) {
      if (!shellSet.has(mod)) missingFromSw.push(mod);
    }
    t.expect(missingFromSw).toEqual([]);

    // Every file listed in SHELL must exist on disk so SW install never 404s
    const missingOnDisk = [];
    for (const entry of entries) {
      if (entry === "./") continue;
      const rel = entry.replace(/^\.\//, "").split("?")[0];
      if (!fs.existsSync(path.join(ROOT, rel))) missingOnDisk.push(rel);
    }
    t.expect(missingOnDisk).toEqual([]);
  });

  s.test("build-web.mjs and pages.yml package every top-level asset directory", async (_state, t) => {
    const { styles, scripts } = extractHtmlAssets(ROOT);
    const { entries } = parseSwShell(ROOT);
    const topDirs = new Set();
    for (const item of [...styles, ...scripts, ...entries]) {
      const clean = item.replace(/^\.\//, "").split("?")[0];
      if (clean.includes("/")) topDirs.add(clean.split("/")[0]);
    }

    const buildWeb = fs.readFileSync(path.join(ROOT, "scripts/build-web.mjs"), "utf8");
    const pagesYml = fs.readFileSync(path.join(ROOT, ".github/workflows/pages.yml"), "utf8");

    for (const dir of topDirs) {
      t.expect(buildWeb.includes(`"${dir}"`)).toBe(true);
      t.expect(new RegExp(`\\b${dir}\\b`).test(pagesYml)).toBe(true);
    }
  });

  s.test("every JS source file passes Node syntax verification", async (_state, t) => {
    const files = [...walkJsFiles(path.join(ROOT, "js")), path.join(ROOT, "sw.js")];
    t.expect(files.length > 0).toBe(true);
    for (const file of files) {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    }
  });

  s.test("docs stay synchronized with README assets, themes, ESM submodules, and test suites", async (_state, t) => {
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
    const arch = fs.readFileSync(path.join(ROOT, "docs/ARCHITECTURE.md"), "utf8");
    const testing = fs.readFileSync(path.join(ROOT, "docs/TESTING.md"), "utf8");
    const themeDoc = fs.readFileSync(path.join(ROOT, "THEME.md"), "utf8");
    const themeJs = fs.readFileSync(path.join(ROOT, "js/theme.js"), "utf8");

    // 1) Every local image & relative markdown link in README.md must exist on disk.
    const readmeAssets = [
      ...[...readme.matchAll(/src="([^"]+)"/g)].map((m) => m[1]),
      ...[...readme.matchAll(/\]\(([^)"\s#]+)/g)].map((m) => m[1])
    ].filter((u) => !/^https?:\/\//.test(u));
    const missingAssets = readmeAssets.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
    t.expect(missingAssets).toEqual([]);

    // 2) Every theme registered in js/theme.js must be documented in README.md and THEME.md.
    const themeIds = [...themeJs.matchAll(/\bid:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
    t.expect(themeIds.length).toBeGreaterThanOrEqual(7);
    const missingThemes = [];
    for (const id of themeIds) {
      if (!themeDoc.includes(`\`${id}\``)) missingThemes.push(`THEME.md:${id}`);
      const labelMatch = themeJs.match(new RegExp(`id:\\s*"${id}"[\\s\\S]{0,120}?label:\\s*"([^"]+)"`));
      const label = labelMatch ? labelMatch[1] : id;
      if (!readme.includes(label)) missingThemes.push(`README.md:${label}`);
    }
    t.expect(missingThemes).toEqual([]);

    // 3) Every ESM submodule under js/*/*.js must be listed in docs/ARCHITECTURE.md.
    const submodules = collectEsmSubmodules(ROOT).map((p) => path.basename(p));
    const missingModules = submodules.filter((name) => !arch.includes(name));
    t.expect(missingModules).toEqual([]);

    // 4) Every test suite under tests/suites/*.spec.mjs must be listed in docs/TESTING.md.
    const suiteFiles = fs
      .readdirSync(path.join(ROOT, "tests/suites"))
      .filter((name) => name.endsWith(".spec.mjs"));
    const missingSuites = suiteFiles.filter((name) => !testing.includes(name));
    t.expect(missingSuites).toEqual([]);
  });
});
