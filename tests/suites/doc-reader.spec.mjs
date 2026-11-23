import { suite } from "../lib/harness.mjs";
import { startEnv } from "../lib/browser.mjs";

const TEXT = `What looked like a modest concession quietly hollowed out the very safeguard the treaty depended on. Negotiators described the change as a technical clarification, a narrowing of scope to cases confirmed in writing by both sides.

In practice, that phrase moved the burden of proof onto the weaker party, and the safeguard stopped functioning long before anyone admitted it had gone.`;

suite("reader · long text", { timeout: 90_000 }, (s) => {
  s.beforeAll(async (state) => {
    state.env = await startEnv();
    state.env.server.mock.setFallback("docOverview", { fixture: "doc-overview" });
    state.env.server.mock.setFallback("docBlock", { fixture: "doc-block" });
  });

  s.beforeEach((state) => state.env.server.mock.reset());
  s.afterAll(async (state) => {
    if (state.env) await state.env.close();
  });

  s.test("reads a pasted text and caches every block", async (state, t) => {
    const page = await state.env.newPage({ theme: "paper" });
    await page.open("/#/reader");
    await page.waitForSelector(".reader-input");
    await page.fill("#reader-text", TEXT);
    await page.click('[data-reader-action="start"]');
    await page.waitForSelector(".reader-cover", { timeout: 30_000 });
    await page.waitForSelector(".reader-block:not(.is-pending)", { timeout: 30_000 });

    t.expect(await page.evaluate(() => document.querySelector(".screen")?.dataset.page)).toBe("reader");
    t.expect(await page.locator(".reader-title").innerText()).toBe("条约的静默掏空");
    t.expect(await page.locator(".reader-block").count()).toBeGreaterThan(0);
    t.expect(await page.locator(".reader-note-item").count()).toBeGreaterThan(0);
    t.expect(await page.locator(".reader-anchor").count()).toBeGreaterThan(0);
    t.expect(await page.evaluate(() => location.hash.startsWith("#/reader/"))).toBe(true);

    const calls = state.env.server.mock.requestsOf("docBlock").length;
    t.expect(calls).toBeGreaterThan(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".reader-block:not(.is-pending)", { timeout: 30_000 });
    t.expect(await page.locator(".reader-title").innerText()).toBe("条约的静默掏空");
    t.expect(state.env.server.mock.requestsOf("docBlock").length).toBe(calls);
  });

  s.test("prints the sheet without the app chrome", async (state, t) => {
    const page = await state.env.newPage({ theme: "paper" });
    await page.open("/#/reader");
    await page.waitForSelector(".reader-input");
    await page.fill("#reader-text", TEXT);
    await page.click('[data-reader-action="start"]');
    await page.waitForSelector(".reader-block:not(.is-pending)", { timeout: 30_000 });
    await page.emulateMedia({ media: "print" });
    const styles = await page.evaluate(() => ({
      toolbar: getComputedStyle(document.querySelector(".reader-toolbar")).display,
      screen: getComputedStyle(document.querySelector(".screen")).position,
      overflow: getComputedStyle(document.querySelector(".screen")).overflow
    }));
    t.expect(styles.toolbar).toBe("none");
    t.expect(styles.screen).toBe("static");
    t.expect(styles.overflow).toBe("visible");
  });
});
