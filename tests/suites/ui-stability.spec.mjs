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

  s.test("settings sentence-level chip only toggles its own group and preserves scroll", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    await page.click('[data-action="settings"]');
    await page.waitForSelector(".settings-sheet");
    await page.click('[data-action="settings-tab"][data-tab="data"]');
    await page.waitForSelector('[data-action="sentence-level"][data-level="cet6"]');

    await page.click('[data-action="sentence-level"][data-level="cet6"]');
    const chipState = await page.evaluate(() => ({
      langActive: document.querySelectorAll('[data-action="lang"].active').length,
      foldActive: document.querySelectorAll('[data-action="fold-mode"].active').length,
      genMetaActive: document.querySelectorAll('[data-action="gen-meta"].active').length,
      levelActive: document.querySelector('[data-action="sentence-level"].active')?.dataset.level || ""
    }));
    t.expect(chipState).toEqual({
      langActive: 1,
      foldActive: 1,
      genMetaActive: 1,
      levelActive: "cet6"
    });

    const cacheBtn = page.locator('[data-action="cache-display"][data-display="corner"]');
    await cacheBtn.scrollIntoViewIfNeeded();
    const beforeScroll = await page.evaluate(() => document.querySelector("#sheet-scroll")?.scrollTop || 0);
    t.expect(beforeScroll).toBeGreaterThan(0);
    await cacheBtn.click();
    const afterScroll = await page.evaluate(() => document.querySelector("#sheet-scroll")?.scrollTop || 0);
    t.expect(afterScroll).toBe(beforeScroll);
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
});
