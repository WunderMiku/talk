import { readFile } from "node:fs/promises";
import { suite } from "../lib/harness.mjs";
import { startEnv } from "../lib/browser.mjs";

suite("dictionary · word cache export/import", { timeout: 45_000 }, (s) => {
  s.beforeAll(async (state) => {
    state.env = await startEnv();
    state.env.server.mock.setFallback("word", { fixture: "word-min" });
    state.env.server.mock.setFallback("themes", { fixture: "theme-min" });
  });

  s.beforeEach((state) => {
    state.env.server.mock.reset();
  });

  s.afterAll(async (state) => {
    if (state.env) await state.env.close();
  });

  s.test("an exported cache file still hits the cache after clear + import", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", "serendipity");
    await page.keyboard.press("Enter");
    await page.waitForPage("word");
    t.expect(state.env.server.mock.requestsOf("word").length).toBe(1);

    // Real user path: word page topbar → settings → 数据 tab → 缓存管理.
    await page.click('.topbar [data-action="settings"]');
    await page.click('[data-action="settings-tab"][data-tab="data"]');
    await page.click('[data-action="open-cache"]');
    await page.waitForSelector("#cache-dashboard .cache-word-item");

    // Export downloads a JSON file; keep its exact bytes for the round-trip.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click('#cache-dashboard [data-action="export-word-cache"]'),
    ]);
    const exportedText = await readFile(await download.path(), "utf8");
    const exported = JSON.parse(exportedText);
    t.expect(exported.entries.some((entry) => entry.key === "serendipity")).toBe(true);

    // Clear the store; the dashboard must fall back to the empty state.
    await page.click('#cache-dashboard [data-action="clear-word-cache"]');
    await page.waitForFunction(() =>
      document.querySelector("#cache-dashboard")?.textContent.includes("还没有缓存词条")
    );

    // Import through the same hidden file input the 导入 JSON button opens.
    await page.setInputFiles("#word-cache-file", {
      name: "talk-word-cache.json",
      mimeType: "application/json",
      buffer: Buffer.from(exportedText),
    });
    await page.waitForFunction(() =>
      document.getElementById("toast")?.textContent.includes("已导入")
    );
    await page.waitForSelector("#cache-dashboard .cache-word-item");
    t.expect(await page.textContent("#cache-dashboard .cache-word-item strong")).toBe("serendipity");

    // Look the word up again (fresh load, so the record must come back from
    // IndexedDB). A schema-less import would be evicted by cacheGetWord and
    // silently re-fetched from the model — the request count must stay at 1.
    await page.click(".sheet-close");
    await page.open("/");
    await page.fill("#search-input", "serendipity");
    await page.keyboard.press("Enter");
    await page.waitForPage("word");

    t.expect(await page.textContent(".word-title")).toBe("serendipity");
    t.expect(await page.locator(".meaning-card .sense").count()).toBeGreaterThanOrEqual(1);
    t.expect(state.env.server.mock.requestsOf("word").length).toBe(1);
    // Cached pages carry the generation footnote instead of a fresh receipt.
    t.expect(await page.locator(".gen-meta").count()).toBe(0);
    t.expect(await page.textContent(".page-gen-note")).toContain("mock-model");
    t.expect(page.errors).toEqual([]);
  });
});