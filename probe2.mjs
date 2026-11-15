import { chromium } from "playwright";
import { startServer } from "./tests/lib/server.mjs";
const server = await startServer();
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 2560, height: 1600 }, serviceWorkers: "block" });
const page = await ctx.newPage();
await page.goto(server.origin + "/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".screen"); await page.waitForTimeout(500);
await page.screenshot({ path: "preview/probe2560.png" });
const info = await page.evaluate(() => {
  const els = [...document.querySelectorAll("*")];
  const hits = [];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.left < 100 && r.width > 1000 && cs.backgroundColor !== "rgba(0, 0, 0, 0)") {
      hits.push({ tag: el.tagName + "." + el.className.toString().slice(0,40), bg: cs.backgroundColor, r: [r.left, r.top, r.width, r.height] });
    }
  }
  return hits.slice(0, 8);
});
console.log(info);
await browser.close(); await server.stop();
