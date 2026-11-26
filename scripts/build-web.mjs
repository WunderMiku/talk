#!/usr/bin/env node
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

const FILES = [
  "index.html",
  "favicon.svg",
  "manifest.webmanifest",
  "sw.js",
  ".nojekyll",
  "LICENSE"
];
const DIRS = ["icons", "css", "js", "vendor"];

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

for (const file of FILES) {
  await cp(path.join(ROOT, file), path.join(DIST, file));
}
for (const dir of DIRS) {
  await cp(path.join(ROOT, dir), path.join(DIST, dir), { recursive: true });
}

console.log("Assembled static bundle into dist/");
