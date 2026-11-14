import { suite } from "../lib/harness.mjs";
import { startEnv } from "../lib/browser.mjs";

suite("dictionary · sense group", { timeout: 45_000 }, (s) => {
  s.beforeAll(async (state) => {
    state.env = await startEnv();
    state.env.server.mock.setFallback("chunk", { fixture: "chunk-takeoff" });
    state.env.server.mock.setFallback("word", { fixture: "word-min" });
    state.env.server.mock.setFallback("themes", { fixture: "theme-min" });
  });

  s.beforeEach((state) => state.env.server.mock.reset());
  s.afterAll(async (state) => {
    if (state.env) await state.env.close();
  });

  s.test("recognises a phrasal verb and renders every section", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", "take off");
    await page.keyboard.press("Enter");
    await page.waitForPage("chunk");

    t.expect(await page.textContent(".chunk-title")).toBe("take off");
    t.expect(await page.locator(".sense-card").count()).toBe(2);
    t.expect(await page.locator(".keyeye").count()).toBe(2);
    t.expect(await page.locator(".chunk-example").count()).toBe(2);
    t.expect(await page.locator(".sense-card .sense-zh").first().innerText()).toMatch("起飞");
    t.expect(page.errors).toEqual([]);
  });

  s.test("keeps the chunk in cache on the next visit", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", "take off");
    await page.keyboard.press("Enter");
    await page.waitForPage("chunk");
    t.expect(state.env.server.mock.requestsOf("chunk").length).toBe(1);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForPage("chunk");
    t.expect(state.env.server.mock.requestsOf("chunk").length).toBe(1);
  });
});
