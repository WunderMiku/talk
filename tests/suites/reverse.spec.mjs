import { suite } from "../lib/harness.mjs";
import { startEnv } from "../lib/browser.mjs";

/* The reverse desk now speaks Markdown with [[expression]] anchors. The stub
   answers any unrecognised request (the client sends natural language, not a
   JSON task envelope), so other tasks keep their fixtures. */
const NOTE = `你这句话的重点不是“荒诞”，而是“荒诞里还有一点线索”。

- **第一层**：[[absurdity]] 说的是处境本身不合逻辑，不是人蠢。
- **第二层**：[[faint traces of]] 比 hint 更克制，适合书面叙述。

如果想把两层压进一句，可以写：

> A surreal reality underpinned by subtle clues.

这样 [[a surreal reality underpinned by subtle clues]] 就把两层放在一起了。`;

suite("dictionary · context word search", { timeout: 45_000 }, (s) => {
  s.beforeAll(async (state) => {
    state.env = await startEnv();
    state.env.server.mock.setFallback("*", { content: NOTE });
    state.env.server.mock.setFallback("word", { fixture: "word-min" });
    state.env.server.mock.setFallback("chunk", { fixture: "chunk-takeoff" });
  });

  s.beforeEach((state) => {
    state.env.server.mock.requests = [];
    state.env.server.mock.requestCount = {};
  });
  s.afterAll(async (state) => {
    if (state.env) await state.env.close();
  });

  s.test("renders Markdown and keeps [[...]] as inline anchors", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", "想表达荒诞里带一点线索");
    await page.keyboard.press("Enter");
    await page.waitForPage("reverse");
    await page.waitForSelector(".reverse-markdown");

    t.expect(await page.locator(".rev-anchor").count()).toBeGreaterThan(2);
    t.expect(await page.locator(".rev-anchor.is-word").count()).toBe(1);
    t.expect(await page.locator(".rev-anchor.is-phrase").count()).toBeGreaterThan(1);
    t.expect(await page.locator("strong").count()).toBeGreaterThan(0);
    t.expect(await page.locator("blockquote").count()).toBe(1);
    t.expect(await page.evaluate(() => document.body.innerText.includes("[["))).toBe(false);
    t.expect(page.errors).toEqual([]);
  });

  s.test("keeps the thread in place and dedupes follow-up chips", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", "想表达荒诞里带一点线索");
    await page.keyboard.press("Enter");
    await page.waitForPage("reverse");
    await page.waitForSelector(".reverse-markdown");

    await page.fill("#reverse-input", "再口语一点怎么说");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    t.expect(await page.locator(".reverse-turn-mine").count()).toBe(2);
    t.expect(await page.locator(".reverse-markdown").count()).toBe(2);
    const chips = await page.locator(".reverse-chip").allInnerTexts();
    t.expect(chips.some((text) => text.includes("再口语一点怎么说"))).toBe(false);
    t.expect(await page.evaluate(() => location.hash)).toMatch("#/reverse/");
  });

  s.test("restores the whole thread after a reload", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", "想表达荒诞里带一点线索");
    await page.keyboard.press("Enter");
    await page.waitForPage("reverse");
    await page.waitForSelector(".reverse-markdown");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForPage("reverse");
    await page.waitForSelector(".reverse-markdown");
    t.expect(await page.locator(".reverse-turn-mine").count()).toBe(1);
    t.expect(await page.locator(".rev-anchor").count()).toBeGreaterThan(2);
    t.expect(state.env.server.mock.requestsOf("reverse").length).toBe(0);
  });

  s.test("opens an anchor as its own lookup and returns to the thread", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", "想表达荒诞里带一点线索");
    await page.keyboard.press("Enter");
    await page.waitForPage("reverse");
    await page.waitForSelector(".rev-anchor");

    await page.locator(".rev-anchor.is-word").first().click();
    await page.waitForPage("word");
    await page.goBack();
    await page.waitForPage("reverse");
    t.expect(await page.locator(".rev-anchor").count()).toBeGreaterThan(2);
  });
});
