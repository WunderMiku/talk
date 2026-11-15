import { chromium } from "playwright";
import { startServer } from "./tests/lib/server.mjs";
const server = await startServer();
const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const w of [1366, 2560]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 1024 }, serviceWorkers: "block" });
  await ctx.addInitScript(() => localStorage.setItem("talk.theme.v1", "rhineaccess"));
  const page = await ctx.newPage();
  await page.goto(server.origin + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".theme-poster"); await page.waitForTimeout(600);
  const info = await page.evaluate(() => {
    const r = (s) => { const el = document.querySelector(s); return el ? [Math.round(el.getBoundingClientRect().left), Math.round(el.getBoundingClientRect().width)] : null; };
    const m = document.querySelector(".poster-masthead");
    const brand = document.querySelector(".poster-brand-section");
    const edition = document.querySelector(".poster-edition");
    return {
      poster: r(".theme-poster"), mast: r(".poster-masthead"), manifesto: r(".theme-manifesto"),
      brand: brand ? [Math.round(brand.getBoundingClientRect().left), Math.round(brand.getBoundingClientRect().width)] : null,
      edition: edition ? [Math.round(edition.getBoundingClientRect().right)] : null,
      mastPad: m ? getComputedStyle(m).padding + " / " + getComputedStyle(m).margin : null,
      mastDisplay: m ? getComputedStyle(m).display : null,
    };
  });
  console.log(w, JSON.stringify(info));
  await ctx.close();
}
await browser.close(); await server.stop();
