import { suite } from "../lib/harness.mjs";
import { startEnv } from "../lib/browser.mjs";

suite("dictionary · sentence analysis", { timeout: 60_000 }, (s) => {
  function wire(state) {
    const mock = state.env.server.mock;
    mock.setFallback("sentence", { fixture: "sentence-min" });
    mock.setFallback("themes", { fixture: "theme-min" });
    mock.setFallback("chunk", { fixture: "chunk-bytheway" });
    mock.on(
      { task: "sentence", text: "The quiet scientist kept going." },
      { fixture: "sentence-legacy" }
    );
    mock.on(
      { task: "sentence", text: "The scientist continued his research. Critics now admit that they were wrong." },
      { fixture: "sentence-two" }
    );
  }

  s.beforeAll(async (state) => {
    state.env = await startEnv();
    wire(state);
  });

  s.beforeEach((state) => {
    state.env.server.mock.reset();
    wire(state);
  });
  s.afterAll(async (state) => {
    if (state.env) await state.env.close();
  });

  async function analyse(state, text) {
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", text);
    await page.keyboard.press("Enter");
    await page.waitForPage("sentence");
    return page;
  }

  s.test("splits the line into segments with a flow and a contrast card", async (state, t) => {
    const page = await analyse(state, "The scientist who faced doubt continued his research.");

    t.expect(await page.locator(".sentence-line .seg").count()).toBe(3);
    t.expect(await page.locator(".flow-row").count()).toBe(3);
    t.expect(await page.locator(".construction-row").count()).toBe(0);
    t.expect(await page.locator(".contrast-card").count()).toBe(1);
    t.expect(await page.locator(".flow-note").innerText()).toMatch("定语从句");
    t.expect(page.errors).toEqual([]);
  });

  s.test("switches between original, segmented and focus views", async (state, t) => {
    const page = await analyse(state, "The scientist who faced doubt continued his research.");
    const main = page.locator(".sentence-page");

    t.expect(await main.getAttribute("data-view")).toBe("original");
    await page.click("[data-action=sentence-view][data-view=segments]");
    t.expect(await main.getAttribute("data-view")).toBe("segments");
    await page.click("[data-action=sentence-view][data-view=focus]");
    t.expect(await main.getAttribute("data-view")).toBe("focus");
    t.expect(await page.locator(".seg-switch-btn.is-active").innerText()).toBe("信息焦点");
  });

  s.test("opens a chunk when a segment carries one", async (state, t) => {
    const page = await analyse(state, "The scientist continued his research. Critics now admit that they were wrong.");
    await page.click(".construction-row");
    t.expect(state.env.server.mock.requestsOf("chunk").length).toBe(1);
  });

  s.test("keeps every sentence of a paragraph in its own block", async (state, t) => {
    const page = await analyse(state, "The scientist continued his research. Critics now admit that they were wrong.");

    t.expect(await page.locator(".sentence-part").count()).toBe(2);
    t.expect(await page.locator(".sentence-part .seg").count()).toBe(5);
    t.expect(await page.locator(".seg-switch").count()).toBe(0);
    t.expect(page.errors).toEqual([]);
  });

  s.test("still renders a cached sentence that predates segments", async (state, t) => {
    const page = await analyse(state, "The quiet scientist kept going.");

    t.expect(await page.locator(".sentence-line").count()).toBe(1);
    t.expect(await page.locator(".sentence-line .seg").count()).toBe(0);
    t.expect(await page.locator(".flow-row").count()).toBe(0);
    t.expect(await page.locator(".translation-text").innerText()).toMatch("科学家");
  });
});
