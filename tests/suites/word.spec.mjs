import { suite } from "../lib/harness.mjs";
import { startEnv } from "../lib/browser.mjs";

suite("dictionary · word lookup", { timeout: 45_000 }, (s) => {
  s.beforeAll(async (state) => {
    state.env = await startEnv();
    state.env.server.mock.setFallback("word", { fixture: "word-min" });
    state.env.server.mock.setFallback("themes", { fixture: "theme-min" });
    state.env.server.mock.setFallback("chunk", { fixture: "chunk-takeoff" });
  });

  s.beforeEach((state) => {
    state.env.server.mock.reset();
  });

  s.afterAll(async (state) => {
    if (state.env) await state.env.close();
  });

  s.test("paints the word, senses and examples", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", "serendipity");
    await page.keyboard.press("Enter");
    await page.waitForPage("word");

    t.expect(await page.textContent(".word-title")).toBe("serendipity");
    t.expect(await page.locator(".meaning-card .sense").count()).toBeGreaterThanOrEqual(1);
    t.expect(await page.locator(".example-card").count()).toBeGreaterThanOrEqual(1);
    t.expect(await page.locator(".reclassify").count()).toBe(1);
    t.expect(page.errors).toEqual([]);
  });

  s.test("hits the cache on a reload instead of the model", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", "serendipity");
    await page.keyboard.press("Enter");
    await page.waitForPage("word");
    t.expect(state.env.server.mock.requestsOf("word").length).toBe(1);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForPage("word");
    t.expect(await page.textContent(".word-title")).toBe("serendipity");
    t.expect(state.env.server.mock.requestsOf("word").length).toBe(1);
  });

  s.test("opens a nested word layer from the family card", async (state, t) => {
    state.env.server.mock.on({ task: "word", query: "take" }, { fixture: "word-take" });
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", "take off");
    await page.keyboard.press("Enter");
    await page.waitForPage("chunk");
    await page.locator(".keyeye").first().click();
    await page.waitForSelector(".word-layer .word-title");
    t.expect(await page.locator(".word-layer .word-title").innerText()).toBe("take");
    t.expect(await page.locator(".word-layer").count()).toBe(1);
  });
});
