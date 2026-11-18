import { chromium } from "playwright";
import { startServer } from "../../tests/lib/server.mjs";
const server = await startServer();
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 2560, height: 1600 }, serviceWorkers: "block" });
const page = await ctx.newPage();
await page.goto(server.origin + "/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".screen"); await page.waitForTimeout(400);
console.log(await page.evaluate(() => {
  const pick = (el) => el ? { bg: getComputedStyle(el).backgroundColor, img: getComputedStyle(el).backgroundImage.slice(0, 40), w: el.getBoundingClientRect().width } : null;
  return { html: pick(document.documentElement), body: pick(document.body), stage: pick(document.querySelector(".stage")), app: pick(document.querySelector(".app")), screen: pick(document.querySelector(".screen")), paper: getComputedStyle(document.querySelector(".app")).getPropertyValue("--paper") };
}));
await browser.close(); await server.stop();
