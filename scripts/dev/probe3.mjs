import { chromium } from "playwright";
import { startServer } from "../../tests/lib/server.mjs";
const server = await startServer();
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, serviceWorkers: "block" });
await ctx.addInitScript(() => localStorage.setItem("talk.theme.v1", "rhineaccess"));
const page = await ctx.newPage();
await page.goto(server.origin + "/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".screen"); await page.waitForTimeout(400);
await page.goto(server.origin + "/#/word/obfuscate", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);
console.log(await page.evaluate(() => {
  const out = [];
  for (const sel of [".screen", ".result-page", ".page-gen-note", ".hero-chip", ".chip", ".home-hero", ".daily"]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    out.push([sel, cs.transform, cs.rotate, cs.letterSpacing, el.getBoundingClientRect().width]);
  }
  return out;
}));
await browser.close(); await server.stop();
