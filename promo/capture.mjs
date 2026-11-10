import { chromium } from "playwright";
import fs from "node:fs";

const FPS = 30;
const mode = process.argv[2] || "stills";
const root = new URL(".", import.meta.url).pathname;

const browser = await chromium.launch({ args: ["--no-sandbox", "--force-color-profile=srgb"] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await page.goto("file://" + root + "index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(400);

const total = await page.evaluate(() => window.TOTAL);

if (mode === "stills") {
  fs.mkdirSync(root + "stills", { recursive: true });
  for (const t of [1.2, 4.2, 7.6, 11.6, 14.6, 17.8]) {
    await page.evaluate((tt) => window.render(tt), t);
    await page.waitForTimeout(60);
    await page.screenshot({ path: `${root}stills/t${String(t).replace(".", "_")}.png` });
  }
  console.log("stills done");
} else {
  const dir = root + "frames";
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const n = Math.round(total * FPS);
  for (let i = 0; i < n; i++) {
    await page.evaluate((tt) => window.render(tt), i / FPS);
    await page.screenshot({ path: `${dir}/f${String(i).padStart(4, "0")}.png` });
    if (i % 60 === 0) console.log("frame", i, "/", n);
  }
  console.log("frames done", n);
}
await browser.close();
