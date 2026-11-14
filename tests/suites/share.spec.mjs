import { suite } from "../lib/harness.mjs";
import { startEnv } from "../lib/browser.mjs";

suite("share · composed page image", { timeout: 60_000 }, (s) => {
  s.beforeAll(async (state) => {
    state.env = await startEnv();
    state.env.server.mock.setFallback("themes", { fixture: "theme-min" });
    state.env.server.mock.setFallback("word", { fixture: "word-take" });
  });
  s.afterAll(async (state) => {
    if (state.env) await state.env.close();
  });

  s.test("composes a 1080 wide image from the current page", async (state, t) => {
    const page = await state.env.newPage({ theme: "bitterworld" });
    await page.open("/");
    await page.fill("#search-input", "take");
    await page.keyboard.press("Enter");
    await page.waitForPage("word");
    await page.click("[data-action=share-page]");
    await page.locator(".share-card-img").waitFor();
    const size = await page.evaluate(() => {
      const img = document.querySelector(".share-card-img");
      return [img.naturalWidth, img.naturalHeight, img.src.startsWith("data:image/png")];
    });
    t.expect(size[0]).toBe(1080);
    t.expect(size[1]).toBeGreaterThan(800);
    t.expect(size[2]).toBe(true);
    const href = await page.locator(".share-actions a").getAttribute("href");
    t.expect(href?.startsWith("data:image/png")).toBe(true);
    t.expect(page.errors).toEqual([]);
  });
});
