import { suite } from "../lib/harness.mjs";
import { startEnv } from "../lib/browser.mjs";

const SAMPLE_ARTICLE = [
  "Commoditizing Intelligence: The Business Model of Open-Weight AI",
  "For years, the prevailing orthodoxy in artificial intelligence held that frontier capabilities could only survive behind proprietary walls. However, the rapid ascent of open-weight model developers has fundamentally disrupted this assumption."
].join("\n");

suite("reader · intensive booklet & linkages", { timeout: 60_000 }, (s) => {
  s.beforeAll(async (state) => {
    state.env = await startEnv();
    state.env.server.mock.setFallback("docOverview", { fixture: "reader-overview" });
    state.env.server.mock.setFallback("docBlock", { fixture: "reader-block" });
    state.env.server.mock.setFallback("docQuickGloss", { fixture: "reader-quick-gloss" });
    state.env.server.mock.setFallback("word", { fixture: "word-min" });
    state.env.server.mock.setFallback("chunk", { fixture: "chunk-takeoff" });
  });

  s.beforeEach((state) => state.env.server.mock.reset());
  s.afterAll(async (state) => {
    if (state.env) await state.env.close();
  });

  s.test("loads built-in offline sample with separate text/study sheets and notranslate guard", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/#/reader");
    await page.click('[data-reader-action="load-sample"]');

    await page.waitForSelector(".pdf-sheet--text");
    t.expect(await page.locator(".pdf-sheet--text").count()).toBe(3);
    t.expect(await page.locator(".pdf-sheet--study").count()).toBe(3);
    t.expect(await page.locator(".pdf-appendix--index").count()).toBe(1);
    t.expect(await page.locator(".pdf-appendix--recall").count()).toBe(1);
    t.expect(await page.locator('.pdf-en-prose[translate="no"]').count()).toBe(3);
    t.expect(await page.locator(".pdf-simplified").count()).toBeGreaterThan(0);
    t.expect(page.errors).toEqual([]);
  });

  s.test("runs mocked docOverview + docBlock pipeline, caches locally, and supports library deletion", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/#/reader");
    await page.fill("#reader-textarea", SAMPLE_ARTICLE);
    await page.click('[data-reader-action="start-read"]');

    await page.waitForSelector(".pdf-sheet--study");
    t.expect(state.env.server.mock.requestsOf("docOverview").length).toBe(1);
    t.expect(state.env.server.mock.requestsOf("docBlock").length).toBe(1);
    t.expect(await page.textContent(".pdf-cover-title-zh")).toMatch("开放权重模型的商业逻辑");

    await page.click('[data-reader-action="back-input"]');
    await page.waitForSelector(".reader-recent-row");
    t.expect(await page.locator(".reader-recent-row").count()).toBe(1);

    await page.click('[data-reader-action="delete-recent"]');
    await page.waitForFunction(() => document.querySelectorAll(".reader-recent-row").length === 0);
    t.expect(page.errors).toEqual([]);
  });

  s.test("shows inline contextual quick gloss in bottom dock and syncs saved wordbook in clock drawer", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/#/reader");
    await page.fill("#reader-textarea", SAMPLE_ARTICLE);
    await page.click('[data-reader-action="start-read"]');
    await page.waitForSelector(".pdf-en-prose .pdf-w");

    await page.locator(".pdf-en-prose .pdf-w").first().click();
    await page.waitForSelector("#reader-lookup-dock:not([hidden])");
    await page.click('[data-reader-action="dock-word"]');
    await page.waitForSelector(".reader-dock-gloss-zh");
    t.expect(state.env.server.mock.requestsOf("docQuickGloss").length).toBe(1);

    await page.click('#reader-dock-gloss [data-reader-action="save-term"]');
    await page.click('[data-action="history"]');
    await page.click('[data-action="history-tab"][data-tab="wordbooks"]');
    await page.waitForSelector(".wb-row-title");
    t.expect(await page.locator(".wb-row-title").count()).toBeGreaterThan(0);
    t.expect(page.errors).toEqual([]);
  });

  s.test("toggles left binding margin option in export modal", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/#/reader");
    await page.click('[data-reader-action="load-sample"]');
    await page.waitForSelector(".pdf-sheet--text");

    await page.click('[data-reader-action="open-modal"]');
    await page.click('[data-opt="bindingMargin"]');
    t.expect(await page.locator(".reader-doc-wrap.reader-binding-margin").count()).toBe(1);
    t.expect(page.errors).toEqual([]);
  });
});
