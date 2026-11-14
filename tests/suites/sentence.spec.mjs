import { suite } from "../lib/harness.mjs";
import { startEnv } from "../lib/browser.mjs";

suite("dictionary · sentence analysis", { timeout: 45_000 }, (s) => {
  s.beforeAll(async (state) => {
    state.env = await startEnv();
    state.env.server.mock.setFallback("sentence", { fixture: "sentence-two" });
    state.env.server.mock.setFallback("themes", { fixture: "theme-min" });
  });

  s.beforeEach((state) => state.env.server.mock.reset());
  s.afterAll(async (state) => {
    if (state.env) await state.env.close();
  });

  s.test("splits two sentences into two analysed blocks", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill(
      "#search-input",
      "The scientist continued his research. Critics now admit that they were wrong."
    );
    await page.keyboard.press("Enter");
    await page.waitForPage("sentence");

    t.expect(await page.locator(".sentence-part").count()).toBe(2);
    t.expect(await page.locator(".sentence-part-zh").first().innerText()).toMatch("科学家");
    t.expect(page.errors).toEqual([]);
  });

  s.test("folds one clause without touching the other", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill(
      "#search-input",
      "The scientist continued his research. Critics now admit that they were wrong."
    );
    await page.keyboard.press("Enter");
    await page.waitForPage("sentence");

    const mark = page.locator(".onion-mark").first();
    await mark.click();
    t.expect(await page.locator(".onion-slot.is-open").count()).toBe(1);
    await mark.click();
    t.expect(await page.locator(".onion-slot.is-open").count()).toBe(0);
  });
});
