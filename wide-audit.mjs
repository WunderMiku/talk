import { chromium } from "playwright";
import { startServer } from "./tests/lib/server.mjs";
import { modelSettings } from "./tests/lib/browser.mjs";

const server = await startServer();
server.mock.setFallback("word", { fixture: "word-min" });
server.mock.setFallback("themes", { fixture: "theme-min" });
server.mock.setFallback("sentence", { fixture: "sentence-min" });
const browser = await chromium.launch({ args: ["--no-sandbox"] });

async function run(width, height, tag) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", reducedMotion: "reduce" });
  await ctx.addInitScript((cfg) => localStorage.setItem("talk.model.v1", JSON.stringify(cfg)), modelSettings(server.origin));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  await page.goto(server.origin + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".screen");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `preview/${tag}-home.png` });

  await page.fill("#search-input", "serendipity");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".screen")?.dataset.page === "word", null, { timeout: 15000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `preview/${tag}-word.png` });

  await page.goto(server.origin + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".screen");
  await page.waitForTimeout(500);
  await page.fill("#search-input", "The scientist who proposed the theory, despite the skepticism, continued his research.");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".screen")?.dataset.page === "sentence", null, { timeout: 15000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `preview/${tag}-sentence.png` });

  await page.locator("[data-action=module][data-module=translator]").click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `preview/${tag}-translator.png` });

  console.log(tag, "errors", errs.length, errs.slice(0,2));
  await ctx.close();
}

await run(1366, 1024, "w13");
await run(2560, 1600, "w25");
await browser.close(); await server.stop();
