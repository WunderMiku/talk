import { chromium } from "playwright";
import { startServer } from "./tests/lib/server.mjs";
const server = await startServer();
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, serviceWorkers: "block" });
await ctx.addInitScript(() => localStorage.setItem("talk.theme.v1", "rhineaccess"));
const page = await ctx.newPage();
await page.goto(server.origin + "/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".screen"); await page.waitForTimeout(700);
console.log(await page.evaluate(() => {
  const m = document.querySelector(".theme-manifesto");
  const p = document.querySelector(".theme-poster");
  return {
    blocks: [...document.querySelectorAll(".screen .result-page > *")].map(e => e.className.toString().slice(0, 40)),
    manifesto: m ? m.innerText : null,
    manifestoAfter: m ? getComputedStyle(m, "::after").content : null,
    poster: p ? p.innerText.slice(0, 120) : null,
  };
}));
await page.evaluate(() => { const s = document.querySelector(".screen"); s.scrollTop = s.scrollHeight; });
await page.waitForTimeout(400);
await page.screenshot({ path: "preview/acc3-bottom.png" });
await browser.close(); await server.stop();
