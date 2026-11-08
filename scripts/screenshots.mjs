#!/usr/bin/env node
/**
 * Regenerate the README screenshots.
 *
 * The repo stays dependency-free on purpose, so this script is not wired into
 * any build. To run it you need Playwright and Chromium once:
 *
 *   npx playwright install chromium
 *   npm i playwright
 *
 * Then start the static preview and shoot:
 *
 *   python3 -m http.server 8080        # from the repo root
 *   node scripts/screenshots.mjs       # writes docs/screenshots/*.jpg
 *
 * APP_BASE overrides the origin, SHOT_OUT the output directory.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.APP_BASE || "http://127.0.0.1:8080/";
const OUT = process.env.SHOT_OUT || "docs/screenshots";

const SHOTS = [
  { name: "home-paper", hash: "", width: 390, height: 844 },
  { name: "word-paper", hash: "#/word/serendipity", width: 390, height: 844 },
  { name: "word-ussr", hash: "#/word/serendipity", width: 390, height: 844, theme: "constructivist" },
  { name: "word-wide-paper", hash: "#/word/serendipity", width: 1366, height: 1024, expand: true },
  { name: "sentence", hash: "#/sentence/science-serendipity", width: 390, height: 844 },
  { name: "translator", hash: "#/translate", width: 390, height: 844 },
  { name: "theme-salon", hash: "", width: 390, height: 844, scrollTo: ".theme-salon", scrollOffset: 40 },
  { name: "settings-data", hash: "", width: 390, height: 844, settings: "数据" }
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

for (const shot of SHOTS) {
  const context = await browser.newContext({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 1.5,
    reducedMotion: "reduce"
  });
  if (shot.theme) {
    await context.addInitScript((theme) => localStorage.setItem("talk.theme.v1", theme), shot.theme);
  }
  const page = await context.newPage();
  await page.goto(BASE + (shot.hash || ""), { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  if (shot.expand) {
    // The word page scrolls inside .screen; let it grow for a full capture.
    await page.evaluate(() => {
      const screen = document.querySelector("#screen");
      screen.style.overflow = "visible";
      screen.style.height = "auto";
      screen.style.maxHeight = "none";
    });
    await page.waitForTimeout(300);
  }

  if (shot.scrollTo) {
    await page.evaluate(({ selector, offset }) => {
      const target = document.querySelector(selector);
      const screen = document.querySelector("#screen");
      if (target) screen.scrollTop = target.offsetTop + offset;
    }, { selector: shot.scrollTo, offset: shot.scrollOffset || 0 });
    await page.waitForTimeout(400);
  }

  if (shot.settings) {
    await page.click('[data-action="settings"]');
    await page.waitForTimeout(450);
    await page.click(`.settings-tab:has-text("${shot.settings}")`);
    await page.waitForTimeout(450);
  }

  const file = path.join(OUT, `${shot.name}.jpg`);
  await page.screenshot({ path: file, type: "jpeg", quality: 82, fullPage: Boolean(shot.expand) });
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`${shot.name}.jpg  ${kb} KB`);
  await context.close();
}

await browser.close();
