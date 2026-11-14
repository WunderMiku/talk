import { suite } from "../lib/harness.mjs";
import { startEnv } from "../lib/browser.mjs";

suite("themes · bitterworld chunk page", { timeout: 45_000 }, (s) => {
  s.beforeAll(async (state) => {
    state.env = await startEnv();
    state.env.server.mock.setFallback("chunk", { fixture: "chunk-takeoff" });
  });

  s.beforeEach((state) => state.env.server.mock.reset());
  s.afterAll(async (state) => {
    if (state.env) await state.env.close();
  });

  s.test("applies the theme tokens and squares every card", async (state, t) => {
    const page = await state.env.newPage({ theme: "bitterworld" });
    await page.open("/");
    await page.fill("#search-input", "take off");
    await page.keyboard.press("Enter");
    await page.waitForPage("chunk");

    t.expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("bitterworld");
    const radius = await page.evaluate(() => getComputedStyle(document.querySelector(".sense-card")).borderRadius);
    t.expect(radius).toBe("0px");
    t.expect(await page.locator(".chunk-title").innerText()).toBe("take off");
  });
});
