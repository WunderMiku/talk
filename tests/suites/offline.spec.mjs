import { suite } from "../lib/harness.mjs";
import { startEnv } from "../lib/browser.mjs";

suite("dictionary · offline fallback", { timeout: 45_000 }, (s) => {
  s.beforeAll(async (state) => {
    state.env = await startEnv();
  });
  s.afterAll(async (state) => {
    if (state.env) await state.env.close();
  });

  s.test("explains that an unknown word needs a model", async (state, t) => {
    const page = await state.env.newPage({ config: null });
    await page.open("/");
    await page.fill("#search-input", "zorblex");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".state-page");
    t.expect(await page.locator(".state-title").innerText()).toMatch("离线");
    t.expect(await page.locator(".reclassify").count()).toBe(1);
    t.expect(state.env.server.mock.requests.length).toBe(0);
  });

  s.test("keeps a chunk deep link readable without a model", async (state, t) => {
    const page = await state.env.newPage({ config: null });
    await page.open("/#/chunk/take+off");
    await page.waitForPage("chunk");
    t.expect(await page.locator(".state-page").count()).toBe(1);
    t.expect(await page.locator(".state-page").innerText()).toMatch("意群");
  });
});
