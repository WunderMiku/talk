import { suite } from "../lib/harness.mjs";
import { startEnv } from "../lib/browser.mjs";

suite("dictionary · context word search", { timeout: 45_000 }, (s) => {
  s.beforeAll(async (state) => {
    state.env = await startEnv();
    state.env.server.mock.setFallback("reverse", { fixture: "reverse-arrive" });
    state.env.server.mock.on({ task: "chunk", query: "by the way" }, { fixture: "chunk-bytheway" });
    state.env.server.mock.setFallback("chunk", { fixture: "chunk-takeoff" });
    state.env.server.mock.setFallback("word", { fixture: "word-min" });
  });

  s.beforeEach((state) => {
    state.env.server.mock.reset();
    state.env.server.mock.on({ task: "chunk", query: "by the way" }, { fixture: "chunk-bytheway" });
  });
  s.afterAll(async (state) => {
    if (state.env) await state.env.close();
  });

  s.test("turns a situation into three candidates", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", "想在聊天里顺便提一句");
    await page.keyboard.press("Enter");
    await page.waitForPage("reverse");

    t.expect(await page.locator(".reverse-card").count()).toBe(3);
    t.expect(await page.locator(".reverse-card .paradigm-tag").allInnerTexts()).toEqual(["意群", "词", "句"]);
    t.expect(await page.locator(".reverse-overview").innerText()).toMatch("轻描淡写");
    t.expect(page.errors).toEqual([]);
  });

  s.test("routes a candidate to its own paradigm and restores the note on back", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", "想在聊天里顺便提一句");
    await page.keyboard.press("Enter");
    await page.waitForPage("reverse");

    await page.locator(".reverse-card").first().click();
    await page.waitForPage("chunk");
    t.expect(await page.evaluate(() => location.hash)).toMatch("#/chunk/by");
    t.expect(await page.textContent(".chunk-title")).toBe("by the way");

    await page.goBack();
    await page.waitForPage("reverse");
    t.expect(await page.locator(".reverse-card").count()).toBe(3);
    t.expect(state.env.server.mock.requestsOf("reverse").length).toBe(1);
  });

  s.test("serves the note from storage after a reload", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", "想在聊天里顺便提一句");
    await page.keyboard.press("Enter");
    await page.waitForPage("reverse");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForPage("reverse");
    t.expect(await page.locator(".reverse-card").count()).toBe(3);
    t.expect(state.env.server.mock.requestsOf("reverse").length).toBe(1);
  });
});
