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

    t.expect(await page.locator(".rev-anchor").count()).toBeGreaterThanOrEqual(3);
    t.expect(await page.locator(".rev-anchor.is-word").count()).toBeGreaterThanOrEqual(1);
    t.expect(await page.locator(".rev-anchor.is-phrase").count()).toBeGreaterThanOrEqual(2);
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
    t.expect(await page.locator(".rev-anchor").count()).toBeGreaterThanOrEqual(3);
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
    t.expect(await page.locator(".rev-anchor").count()).toBeGreaterThanOrEqual(3);
  });

  s.test("follow-up preserves [[...]] in history, never truncates chips mid-word, and regenerate avoids duplicate user turns", async (state, t) => {
    const LONG_NOTE = `核心表达可以用 [[a surreal reality underpinned by subtle clues]] 整句收束，或者拆分用 [[in the nick of time]] 与 [[faint traces of]]。`;
    state.env.server.mock.setFallback("*", { content: LONG_NOTE });
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", "想表达千钧一发里的荒诞线索");
    await page.keyboard.press("Enter");
    await page.waitForPage("reverse");
    await page.waitForSelector(".reverse-chip");

    // Chips must NOT chop long phrases mid-word (old .slice(0, 16) produced "a surreal realit").
    const chips = await page.locator('[data-action="reverse-follow"]').allInnerTexts();
    t.expect(chips.length).toBeGreaterThanOrEqual(1);
    t.expect(chips.some((c) => c.includes("a surreal realit"))).toBe(false);
    t.expect(chips.some((c) => c.includes("in the nick of time"))).toBe(true);

    // Send a follow-up and inspect the actual request payload sent to the model.
    await page.fill("#reverse-input", "换成发给老板的正式邮件怎么改");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelectorAll(".reverse-markdown").length === 2, null, { timeout: 10_000 });

    const followReq = state.env.server.mock.requests.at(-1);
    const followMsgs = followReq?.body?.messages || [];
    const assistantHistory = followMsgs.find((m) => m.role === "assistant");
    t.expect(Boolean(assistantHistory?.content?.includes("[[in the nick of time]]"))).toBe(true);
    t.expect(followMsgs.at(-1)).toEqual({ role: "user", content: "换成发给老板的正式邮件怎么改" });

    // Regenerate the follow-up: must NOT send two identical consecutive user messages!
    await page.click('[data-action="reverse-regen"]');
    await page.waitForFunction(() => !document.querySelector(".reverse-turn.is-pending"), null, { timeout: 10_000 });

    const regenReq = state.env.server.mock.requests.at(-1);
    const regenMsgs = regenReq?.body?.messages || [];
    const nonSystem = regenMsgs.filter((m) => m.role !== "system");
    for (let i = 1; i < nonSystem.length; i++) {
      t.expect(nonSystem[i].role === nonSystem[i - 1].role).toBe(false);
    }
    t.expect(nonSystem.at(-1)).toEqual({ role: "user", content: "换成发给老板的正式邮件怎么改" });

    // Restore default fallback for any subsequent tests.
    state.env.server.mock.setFallback("*", { content: NOTE });
    t.expect(page.errors).toEqual([]);
  });

  s.test("errored follow-up exposes a working retry button and recovers cleanly", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", "测试追问失败重试");
    await page.keyboard.press("Enter");
    await page.waitForPage("reverse");
    await page.waitForSelector(".reverse-markdown");

    // Make the next follow-up fail (500), then recover on retry.
    state.env.server.mock.setFallback("*", { status: 500, body: { error: { message: "mock gateway hiccup" } } });
    await page.fill("#reverse-input", "帮我改短一点");
    await page.keyboard.press("Enter");
    await page.waitForSelector('.reverse-turn.is-error [data-action="reverse-regen"]');

    state.env.server.mock.setFallback("*", { content: NOTE });
    await page.click('.reverse-turn.is-error [data-action="reverse-regen"]');
    await page.waitForFunction(() => document.querySelectorAll(".reverse-markdown").length === 2, null, { timeout: 10_000 });
    t.expect(await page.locator(".reverse-turn.is-error").count()).toBe(0);
    t.expect(page.errors.filter((msg) => !msg.includes("status of 500"))).toEqual([]);
  });
});
