import { startEnv } from "./lib/browser.mjs";
const env = await startEnv();
const themes = ["paper", "constructivist", "swiss-lab", "topo-acid", "archive-grid", "retro-stub"];
for (const theme of themes) {
  const page = await env.newPage({ theme });
  await page.open("/");
  await page.waitForTimeout(500);
  const id = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.fill("#search-input", "serendipity");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  const pageName = await page.evaluate(() => document.querySelector(".screen")?.dataset.page);
  console.log(theme, "→", id, pageName, page.errors.length ? page.errors : "ok");
}
await env.close();
