import { suite } from "../lib/harness.mjs";
import { startEnv } from "../lib/browser.mjs";

const NOTE = `核心表达可以用 [[absurdity]] 或 [[faint traces of]]，适合书面语境。`;

suite("ui stability · bug & twitch regressions", { timeout: 60_000 }, (s) => {
  s.beforeAll(async (state) => {
    state.env = await startEnv();
    state.env.server.mock.setFallback("word", { fixture: "word-min" });
    state.env.server.mock.setFallback("themes", { fixture: "theme-min" });
    state.env.server.mock.setFallback("chunk", { fixture: "chunk-takeoff" });
    state.env.server.mock.setFallback("*", { content: NOTE });
  });

  s.beforeEach((state) => {
    state.env.server.mock.reset();
    state.env.server.mock.setFallback("word", { fixture: "word-min" });
    state.env.server.mock.setFallback("themes", { fixture: "theme-min" });
    state.env.server.mock.setFallback("chunk", { fixture: "chunk-takeoff" });
    state.env.server.mock.setFallback("*", { content: NOTE });
  });

  s.afterAll(async (state) => {
    if (state.env) await state.env.close();
  });

  s.test("settings 4-tab layout removes legacy fold-mode, toggles controls in-place, and preserves scroll", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.click('[data-action="settings"]');
    await page.waitForSelector(".settings-sheet");

    const tabIds = await page.evaluate(() =>
      [...document.querySelectorAll('[data-action="settings-tab"]')].map((el) => el.dataset.tab)
    );
    t.expect(tabIds).toEqual(["model", "reading", "appearance", "data"]);

    // Reading tab: sentence-level & detail-level toggle in place; legacy fold-mode is gone.
    await page.click('[data-action="settings-tab"][data-tab="reading"]');
    await page.waitForSelector('[data-action="sentence-level"][data-level="cet6"]');
    await page.click('[data-action="sentence-level"][data-level="cet6"]');
    await page.click('[data-action="detail-level"][data-level="deep"]');
    const readingState = await page.evaluate(() => ({
      foldCount: document.querySelectorAll('[data-action="fold-mode"]').length,
      levelActive: document.querySelector('[data-action="sentence-level"].active')?.dataset.level || "",
      detailActive: document.querySelector('[data-action="detail-level"].active')?.dataset.level || ""
    }));
    t.expect(readingState).toEqual({
      foldCount: 0,
      levelActive: "cet6",
      detailActive: "deep"
    });

    // Appearance tab: one-tap theme card + display toggles preserve scroll position.
    await page.click('[data-action="settings-tab"][data-tab="appearance"]');
    await page.waitForSelector('[data-action="cache-display"][data-display="corner"]');
    const appearanceChips = await page.evaluate(() => ({
      langActive: document.querySelectorAll('[data-action="lang"].active').length,
      genMetaActive: document.querySelectorAll('[data-action="gen-meta"].active').length,
      themeCards: document.querySelectorAll('.theme-grid [data-action="theme"]').length
    }));
    t.expect(appearanceChips.langActive).toBe(1);
    t.expect(appearanceChips.genMetaActive).toBe(1);
    t.expect(appearanceChips.themeCards).toBeGreaterThanOrEqual(6);

    const cacheBtn = page.locator('[data-action="cache-display"][data-display="corner"]');
    await cacheBtn.scrollIntoViewIfNeeded();
    const beforeScroll = await page.evaluate(() => document.querySelector("#sheet-scroll")?.scrollTop || 0);
    t.expect(beforeScroll).toBeGreaterThan(0);
    await cacheBtn.click();
    const afterScroll = await page.evaluate(() => document.querySelector("#sheet-scroll")?.scrollTop || 0);
    t.expect(afterScroll).toBe(beforeScroll);

    // One-tap theme switch updates active card in place without jumping scroll.
    await page.click('.theme-grid [data-action="theme"][data-theme="swiss-lab"]');
    const afterTheme = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      activeCard: document.querySelector('.theme-grid [data-action="theme"].is-active')?.dataset.theme || "",
      scrollTop: document.querySelector("#sheet-scroll")?.scrollTop || 0
    }));
    t.expect(afterTheme.theme).toBe("swiss-lab");
    t.expect(afterTheme.activeCard).toBe("swiss-lab");
    t.expect(afterTheme.scrollTop).toBe(beforeScroll);
    t.expect(page.errors).toEqual([]);
  });

  s.test("settings button and active tab clicks are strictly idempotent across rapid taps and close/reopen races", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.click('[data-action="settings"]');
    await page.waitForSelector(".settings-sheet");
    await page.waitForTimeout(120);

    // Switch to reading tab, scroll down, and mark an in-flight setting change.
    await page.click('[data-action="settings-tab"][data-tab="reading"]');
    await page.waitForSelector('[data-action="sentence-level"][data-level="ielts"]');
    await page.click('[data-action="sentence-level"][data-level="ielts"]');
    await page.evaluate(() => {
      const scroller = document.querySelector("#sheet-scroll");
      if (scroller) scroller.scrollTop = 120;
      window.__sheetRef = document.querySelector("#overlay-root .sheet");
      window.__settingsRef = document.querySelector("#sheet-scroll .settings-sheet");
    });
    const scrollBefore = await page.evaluate(() => document.querySelector("#sheet-scroll")?.scrollTop || 0);

    // Fire 8 rapid clicks on the settings button and 5 rapid clicks on the active tab.
    await page.evaluate(() => {
      const settingsBtn = document.querySelector('[data-action="settings"]');
      const activeTab = document.querySelector('[data-action="settings-tab"].active');
      for (let i = 0; i < 8; i++) settingsBtn?.click();
      for (let i = 0; i < 5; i++) activeTab?.click();
    });
    await page.waitForTimeout(80);

    const idempotent = await page.evaluate(() => ({
      sheets: document.querySelectorAll("#overlay-root .sheet").length,
      backdrops: document.querySelectorAll("#overlay-root .sheet-backdrop").length,
      sameSheet: document.querySelector("#overlay-root .sheet") === window.__sheetRef,
      sameSettings: document.querySelector("#sheet-scroll .settings-sheet") === window.__settingsRef,
      scrollTop: document.querySelector("#sheet-scroll")?.scrollTop || 0,
      levelActive: document.querySelector('[data-action="sentence-level"].active')?.dataset.level || ""
    }));
    t.expect(idempotent).toEqual({
      sheets: 1,
      backdrops: 1,
      sameSheet: true,
      sameSettings: true,
      scrollTop: scrollBefore,
      levelActive: "ielts"
    });

    // Sub-sheet navigation (Data -> Cache Manager -> Back to Settings) reuses the same shell.
    await page.click('[data-action="settings-tab"][data-tab="data"]');
    await page.click('[data-action="open-cache"]');
    await page.waitForSelector("#cache-dashboard");
    const inSubSheet = await page.evaluate(() => ({
      sameSheet: document.querySelector("#overlay-root .sheet") === window.__sheetRef,
      hasBack: Boolean(document.querySelector('[data-action="settings-back"]'))
    }));
    t.expect(inSubSheet).toEqual({ sameSheet: true, hasBack: true });

    // Clicking settings button while in a sub-sheet returns cleanly to Settings root in the same shell.
    await page.evaluate(() => document.querySelector('[data-action="settings"]')?.click());
    await page.waitForSelector(".settings-sheet");
    const returnedSameShell = await page.evaluate(() => ({
      sameSheet: document.querySelector("#overlay-root .sheet") === window.__sheetRef,
      hasBack: Boolean(document.querySelector('[data-action="settings-back"]'))
    }));
    t.expect(returnedSameShell).toEqual({ sameSheet: true, hasBack: false });

    // Rapid close + immediate reopen within the 520ms close animation must not get wiped by a stale timer.
    await page.click(".sheet-close");
    await page.waitForTimeout(80);
    await page.click('[data-action="settings"]');
    await page.waitForTimeout(620);
    const survivedCloseRace = await page.evaluate(() => ({
      sheets: document.querySelectorAll("#overlay-root .sheet.show").length,
      hasSettings: Boolean(document.querySelector("#sheet-scroll .settings-sheet"))
    }));
    t.expect(survivedCloseRace).toEqual({ sheets: 1, hasSettings: true });
    t.expect(page.errors).toEqual([]);
  });

  s.test("data tab and cache dashboard stay fast with 500 cached words in IndexedDB", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");

    // Seed 500 realistic cached word records (~3.5KB each) into IndexedDB.
    await page.evaluate(async () => {
      const db = await window.idb.openDB("talk.words.v1", 2, {
        upgrade(upgradeDb) {
          if (!upgradeDb.objectStoreNames.contains("entries")) {
            upgradeDb.createObjectStore("entries", { keyPath: "key" });
          }
          if (!upgradeDb.objectStoreNames.contains("sentences")) {
            upgradeDb.createObjectStore("sentences", { keyPath: "key" });
          }
        }
      });
      const tx = db.transaction("entries", "readwrite");
      const pad = "Detailed contextual usage note explaining subtle register differences and common collocations. ".repeat(24);
      const now = Date.now();
      for (let i = 0; i < 500; i++) {
        const word = `benchword${i}`;
        tx.store.put({
          key: word,
          at: now - i * 1000,
          detail: "standard",
          schema: 3,
          data: {
            word,
            phonetic: "/ˈbentʃ.wɜːrd/",
            pos: "noun",
            translation: `基准词 ${i}`,
            short: `Synthetic entry ${i} for cache latency verification.`,
            note: pad,
            senses: [
              { pos: "noun", gloss: `义项 ${i}`, en: pad.slice(0, 180) },
              { pos: "verb", gloss: `动词义 ${i}`, en: pad.slice(0, 180) }
            ],
            examples: [
              { en: `We benchmarked ${word} across five hundred stored entries.`, zh: `我们在五百条缓存记录上测试了 ${word}。` }
            ]
          }
        });
      }
      await tx.done;
      db.close();
    });

    await page.open("/");
    await page.click('[data-action="settings"]');
    await page.waitForSelector(".settings-sheet");

    // Measure first click into Data tab (cold summary build) and repeat click (O(1) cached summary).
    const firstDataMs = await page.evaluate(() => {
      const t0 = performance.now();
      document.querySelector('[data-action="settings-tab"][data-tab="data"]')?.click();
      return performance.now() - t0;
    });
    await page.waitForSelector(".data-metrics-row");
    const dataText = await page.textContent(".data-metrics-row");
    t.expect(dataText).toContain("500");

    await page.click('[data-action="settings-tab"][data-tab="model"]');
    const secondDataMs = await page.evaluate(() => {
      const t0 = performance.now();
      document.querySelector('[data-action="settings-tab"][data-tab="data"]')?.click();
      return performance.now() - t0;
    });

    const cacheOpenMs = await page.evaluate(async () => {
      const t0 = performance.now();
      document.querySelector('[data-action="open-cache"]')?.click();
      while (!document.querySelector("#cache-dashboard .cache-word-item")) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      return performance.now() - t0;
    });
    const dashboardStats = await page.evaluate(() => ({
      items: document.querySelectorAll("#cache-dashboard .cache-word-item").length,
      text: document.querySelector("#cache-dashboard")?.textContent || ""
    }));
    t.expect(dashboardStats.items).toBe(24);
    t.expect(dashboardStats.text).toContain("500");
    t.expect(firstDataMs).toBeLessThan(250);
    t.expect(secondDataMs).toBeLessThan(80);
    t.expect(cacheOpenMs).toBeLessThan(350);
    t.expect(page.errors).toEqual([]);
  });

  s.test("desktop word page and theme switch keep .screen scroll auto and 0 unrevealed above-fold blocks", async (state, t) => {
    const page = await state.env.newPage({
      viewport: { width: 1280, height: 800 },
      reducedMotion: "no-preference"
    });
    await page.open("/");

    const scrollBehavior = await page.evaluate(() => getComputedStyle(document.querySelector(".screen")).scrollBehavior);
    t.expect(scrollBehavior).toBe("auto");

    await page.fill("#search-input", "serendipity");
    await page.keyboard.press("Enter");
    await page.waitForPage("word");
    await page.waitForTimeout(350);

    const unrevealedWord = await page.evaluate(() =>
      [...document.querySelectorAll(".screen .reveal:not(.is-in)")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top < window.innerHeight && r.bottom > 0;
      }).length
    );
    t.expect(unrevealedWord).toBe(0);

    await page.evaluate(() => {
      window.TALK_THEME?.set?.("swiss-lab");
    });
    await page.waitForTimeout(120);
    const unrevealedAfterTheme = await page.evaluate(() =>
      [...document.querySelectorAll(".screen .reveal:not(.is-in)")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top < window.innerHeight && r.bottom > 0;
      }).length
    );
    t.expect(unrevealedAfterTheme).toBe(0);
    t.expect(page.errors).toEqual([]);
  });

  s.test("reverse follow-up redraw preserves #reverse-input node and focus in place", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", "想表达荒诞里带一点线索");
    await page.keyboard.press("Enter");
    await page.waitForPage("reverse");
    await page.waitForSelector(".reverse-markdown");

    await page.evaluate(() => {
      const input = document.querySelector("#reverse-input");
      window.__revInputRef = input;
      input.focus();
    });
    await page.fill("#reverse-input", "更书面一点");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelectorAll(".reverse-markdown").length === 2, null, { timeout: 10_000 });

    const preserved = await page.evaluate(() => ({
      sameNode: document.querySelector("#reverse-input") === window.__revInputRef,
      stillFocused: document.activeElement === window.__revInputRef
    }));
    t.expect(preserved).toEqual({ sameNode: true, stillFocused: true });
    t.expect(page.errors).toEqual([]);
  });

  s.test("reverse streaming and completion do not force-scroll the user down on long replies", async (state, t) => {
    const longNote = Array.from({ length: 30 }, (_, i) =>
      `- **第 ${i + 1} 层**：可以用 [[absurdity]] 或 [[faint traces of]] 表达细致语境变化，适合书面与口语自然过渡。`
    ).join("\n\n");
    state.env.server.mock.setFallback("*", { content: longNote });

    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", "想表达荒诞里带一点线索的长解释");
    await page.keyboard.press("Enter");
    await page.waitForPage("reverse");
    await page.waitForSelector(".reverse-markdown");

    const scrollState = await page.evaluate(() => {
      const scroller = document.querySelector(".reverse-page");
      return {
        scrollTop: scroller?.scrollTop ?? -1,
        overflows: (scroller?.scrollHeight || 0) > (scroller?.clientHeight || 0)
      };
    });
    t.expect(scrollState).toEqual({ scrollTop: 0, overflows: true });
    t.expect(page.errors).toEqual([]);
  });

  s.test("nested layer rapid close/reopen does not get wiped by stale cleanup timer", async (state, t) => {
    state.env.server.mock.on({ task: "word", query: "take" }, { fixture: "word-take" });
    const page = await state.env.newPage();
    await page.open("/");
    await page.fill("#search-input", "take off");
    await page.keyboard.press("Enter");
    await page.waitForPage("chunk");

    await page.locator(".keyeye").first().click();
    await page.waitForSelector(".word-layer .word-title");
    await page.click('.word-layer [data-action="layer-back"]');
    // Immediately reopen within the 420ms scrim / 540ms close animation window.
    await page.waitForTimeout(80);
    await page.locator(".keyeye").first().click();
    await page.waitForTimeout(650);

    const alive = await page.evaluate(() => ({
      openLayers: document.querySelectorAll("#layer-root .word-layer:not(.is-closing)").length,
      hasScrim: Boolean(document.querySelector("#layer-root .layer-scrim"))
    }));
    t.expect(alive).toEqual({ openLayers: 1, hasScrim: true });
    t.expect(page.errors).toEqual([]);
  });

  s.test("Android native backButton closes nested word layer and avoids transform on <html>", async (state, t) => {
    state.env.server.mock.on({ task: "word", query: "take" }, { fixture: "word-take" });
    const page = await state.env.newPage();
    await page.addInitScript(() => {
      window.__nativeBackHandlers = [];
      window.__exitAppCalled = 0;
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          App: {
            addListener(event, fn) {
              if (event === "backButton") window.__nativeBackHandlers.push(fn);
            },
            exitApp() {
              window.__exitAppCalled += 1;
            }
          }
        }
      };
    });

    await page.open("/");
    await page.fill("#search-input", "take off");
    await page.keyboard.press("Enter");
    await page.waitForPage("chunk");
    await page.locator(".keyeye").first().click();
    await page.waitForSelector(".word-layer .word-title");

    // Fire simulated Android back button: should pop the nested word layer, not exitApp.
    await page.evaluate(() => {
      window.__nativeBackHandlers.forEach((fn) => fn());
    });
    await page.waitForTimeout(120);

    const afterBack = await page.evaluate(() => ({
      openLayers: document.querySelectorAll("#layer-root .word-layer:not(.is-closing)").length,
      exitAppCalled: window.__exitAppCalled,
      stillOnChunk: document.querySelector(".screen")?.dataset.page === "chunk"
    }));
    t.expect(afterBack).toEqual({ openLayers: 0, exitAppCalled: 0, stillOnChunk: true });

    // Trigger native resume repaint: <html> must never receive a transform that breaks position:fixed.
    const htmlTransformed = await page.evaluate(async () => {
      let sawTransform = false;
      const obs = new MutationObserver(() => {
        if (document.documentElement.style.transform) sawTransform = true;
      });
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
      window.dispatchEvent(new Event("talk:native-resume"));
      await new Promise((r) => setTimeout(r, 120));
      obs.disconnect();
      return sawTransform;
    });
    t.expect(htmlTransformed).toBe(false);
    t.expect(page.errors).toEqual([]);
  });

  s.test("3-mode switching including inside an open Reader article avoids ViewTransition, preserves doc scroll, and aligns indicator", async (state, t) => {
    const page = await state.env.newPage({
      viewport: { width: 390, height: 844 },
      reducedMotion: "no-preference"
    });
    await page.open("/");

    // Spy on startViewTransition during 3-mode switching.
    await page.evaluate(() => {
      window.__vtCalls = 0;
      const orig = document.startViewTransition?.bind(document);
      if (orig) {
        document.startViewTransition = (...args) => {
          window.__vtCalls += 1;
          return orig(...args);
        };
      }
    });

    // Switch to Reader and open built-in offline sample article.
    await page.click('[data-action="module"][data-module="reader"]');
    await page.waitForPage("reader");
    await page.click('[data-reader-action="load-sample"]');
    await page.waitForSelector(".reader-doc-wrap");

    // Scroll mid-article, then rapidly toggle all 3 modules and return to Reader article.
    await page.evaluate(() => {
      const scr = document.querySelector(".screen");
      if (scr) scr.scrollTop = 420;
    });
    const savedBefore = await page.evaluate(() => document.querySelector(".screen")?.scrollTop || 0);
    t.expect(savedBefore).toBeGreaterThan(200);

    let sawScreenTransform = false;
    for (const mod of ["dictionary", "translator", "reader", "translator", "dictionary", "reader"]) {
      await page.click(`[data-action="module"][data-module="${mod}"]`);
      const transform = await page.evaluate(() => getComputedStyle(document.querySelector(".screen")).transform);
      if (transform && transform !== "none") sawScreenTransform = true;
      await page.waitForTimeout(45);
    }
    await page.waitForTimeout(280);

    const finalState = await page.evaluate(() => {
      const scr = document.querySelector(".screen");
      const ind = document.querySelector(".module-indicator");
      const activeBtn = document.querySelector(".module-btn.active");
      return {
        page: scr?.dataset.page || "",
        hasDoc: Boolean(document.querySelector(".reader-doc-wrap")),
        restoredScroll: scr?.scrollTop || 0,
        vtCalls: window.__vtCalls || 0,
        glideLeftover: scr?.classList.contains("is-module-glide") || false,
        moduleDirLeftover: document.documentElement.dataset.moduleDir || null,
        indWidthMatches: ind && activeBtn ? Math.round(parseFloat(ind.style.width)) === activeBtn.offsetWidth : false,
        activeMod: activeBtn?.dataset.module || ""
      };
    });

    t.expect(sawScreenTransform).toBe(false);
    t.expect(finalState).toEqual({
      page: "reader",
      hasDoc: true,
      restoredScroll: savedBefore,
      vtCalls: 0,
      glideLeftover: false,
      moduleDirLeftover: null,
      indWidthMatches: true,
      activeMod: "reader"
    });
    t.expect(page.errors).toEqual([]);
  });

  s.test("migrates legacy wordbooks, reverse threads, and translation cache from localStorage into IndexedDB without loss", async (state, t) => {
    const page = await state.env.newPage();
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__seeded_idb_test")) return;
      sessionStorage.setItem("__seeded_idb_test", "1");
      localStorage.setItem("talk.wordbooks.v1", JSON.stringify({
        version: 1,
        books: [
          { id: "dense-stacks", name: "密集书库", system: true, createdAt: 1, items: [{ term: "ephemeral", addedAt: 1 }] },
          { id: "custom-1", name: "外刊高频", system: false, createdAt: 2, items: [{ term: "ubiquitous", addedAt: 2 }] }
        ]
      }));
      localStorage.setItem("talk.saved.v1", JSON.stringify(["ephemeral", "resilient"]));
      localStorage.setItem("talk.reverse.threads.v1", JSON.stringify({
        "rv-legacy-1": {
          id: "rv-legacy-1",
          title: "legacy thread",
          updatedAt: Date.now(),
          messages: [
            { role: "user", content: "测试迁移" },
            { role: "assistant", content: "已迁移到 [[IndexedDB]]。" }
          ]
        }
      }));
      localStorage.setItem("talk.translations.v3", JSON.stringify({
        "hello": { at: Date.now(), result: { sourceText: "hello", variants: [{ style: "natural", text: "Hello" }] } }
      }));
    });

    await page.open("/");
    await page.waitForTimeout(200);

    const migrated = await page.evaluate(async () => {
      const wb = window.TALK_WORDBOOKS;
      wb.addTerm("persistedword", "dense-stacks");
      await wb.flush();
      return {
        backend: wb.backend(),
        wouldFitLarge: wb.wouldFit(10_000_000),
        hasEphemeral: wb.hasTerm("ephemeral"),
        hasUbiquitous: wb.hasTerm("ubiquitous"),
        hasResilient: wb.hasTerm("resilient"),
        hasPersisted: wb.hasTerm("persistedword"),
        lsWordbooks: localStorage.getItem("talk.wordbooks.v1"),
        lsSaved: localStorage.getItem("talk.saved.v1"),
        lsReverse: localStorage.getItem("talk.reverse.threads.v1"),
        lsTrans: localStorage.getItem("talk.translations.v3")
      };
    });

    t.expect(migrated).toEqual({
      backend: "IndexedDB",
      wouldFitLarge: true,
      hasEphemeral: true,
      hasUbiquitous: true,
      hasResilient: true,
      hasPersisted: true,
      lsWordbooks: null,
      lsSaved: null,
      lsReverse: null,
      lsTrans: null
    });

    // Reload and confirm all migrated + newly added data survive from IndexedDB alone.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".screen");
    await page.waitForTimeout(200);

    const afterReload = await page.evaluate(() => ({
      backend: window.TALK_WORDBOOKS.backend(),
      uniqueWords: window.TALK_WORDBOOKS.stats().uniqueWords,
      hasPersisted: window.TALK_WORDBOOKS.hasTerm("persistedword"),
      hasUbiquitous: window.TALK_WORDBOOKS.hasTerm("ubiquitous"),
      lsWordbooks: localStorage.getItem("talk.wordbooks.v1")
    }));
    t.expect(afterReload).toEqual({
      backend: "IndexedDB",
      uniqueWords: 4,
      hasPersisted: true,
      hasUbiquitous: true,
      lsWordbooks: null
    });

    // Verify migrated legacy reverse thread is still openable from IndexedDB.
    await page.goto(`${state.env.origin}/#/reverse/rv-legacy-1`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".reverse-markdown");
    t.expect(await page.textContent(".reverse-markdown")).toContain("IndexedDB");
    t.expect(page.errors).toEqual([]);
  });
});
