/* ============================================================
   talk. — interactive dictionary prototype
   Vanilla ES Modules. No build step.
   ============================================================ */

import {
  $,
  $$,
  esc,
  attr,
  shorten,
  sanitizeQuery,
  normalizeWord,
  normalizeSentence,
  chunkSlug,
  chunkFromSlug,
  hashText,
  detectParadigm,
  wait,
  tapFeedback,
  titleCase,
  copyText
} from "./core/utils.js";
import { icon } from "./core/icons.js";
import { formatDiagText, installGlobalErrorLogging } from "./core/diagnostics.js";
import { createActionRegistry } from "./core/actions.js";
import {
  SENTENCE_LEVELS,
  DETAIL_LEVELS,
  CUSTOM_TEMPLATE,
  PROVIDER_TEMPLATES,
  sentenceLevelOf,
  applyProfileToSettings,
  sanitizeHistory,
  exampleStyleOverrides,
  exampleStyleFor,
  saveExampleStyles,
  exampleForTheme,
  themesMissingExamples,
  createSettingsStore
} from "./storage/settings.js";
import {
  PREFETCH_LIMIT,
  formatBytes,
  chunkCacheKey,
  createWordCacheStore
} from "./storage/word-cache.js";
import { ensureWord, ensureChunk, ensureSentence } from "./model/normalize.js";
import {
  MODEL_TIMEOUT_MS,
  MODEL_TIMEOUT_TEXT,
  createLookupService
} from "./model/lookup.js";
import {
  qwenTtsProfile,
  qwenTtsEndpoint,
  createTtsController
} from "./features/tts.js";
import { createShareController } from "./features/share.js";
import { createThemeSalon } from "./features/theme-salon.js";
import { createTranslatorView } from "./views/translator.js";
import { createStatusViews } from "./views/status.js";
import { createWordView } from "./views/word.js";
import { createChunkView } from "./views/chunk.js";
import { createSentenceView } from "./views/sentence.js";
import { createReverseView } from "./views/reverse.js";
import { createLayerController } from "./views/layers.js";
import { createSheetController } from "./views/sheets.js";
import { createSettingsSheet } from "./views/settings-sheet.js";
import { createHistorySheet } from "./views/history-sheet.js";
import { applyInputMode, createHomeView } from "./views/home.js";

(() => {
  "use strict";

  const DATA = window.TALK_DATA;
  const CONTENT = window.TALK_CONTENT;
  const LLM = window.TALK_LLM;
  const APP_VERSION = "1.0"; // display version
  const APP_BUILD = "296"; // cache-busting build, kept in step with ?v= and sw.js
  const actions = createActionRegistry();

  const app = document.getElementById("app");
  const screen = document.getElementById("screen");
  const layerRoot = document.getElementById("layer-root");
  const workspaceRoot = document.getElementById("workspace-root");
  const overlayRoot = document.getElementById("overlay-root");
  const cacheCorner = document.getElementById("cache-corner");
  const toastEl = document.getElementById("toast");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const usableApiKey = (value) => LLM.usableApiKey(value);

  installGlobalErrorLogging();

  function copyFor(section) {
    const theme = window.TALK_THEME?.current?.() || { id: "paper", copyKey: null };
    const base = CONTENT[section] || {};
    const key = theme.copyKey || theme.id;
    const override = CONTENT.themeCopy?.[key]?.[section];
    return override ? { ...base, ...override } : base;
  }

  function uiLang() {
    return window.TALK_I18N?.lang === "en" ? "en" : "zh";
  }

  function langSuffix() {
    return uiLang() === "en" ? "::en" : "";
  }

  function englishDirective() {
    if (uiLang() !== "en") return "";
    return "\n\nIMPORTANT: The interface language is English. Write every human-readable string in English — translation, note, memory, zh, gloss, why, tag, summary, verdict, tone, structure, examples[].zh. Never contain Chinese characters. Keep JSON keys, English words, phonetics and pos abbreviations unchanged.";
  }

  function reverseIdFor(text) {
    return `r${hashText(normalizeSentence(text))}${uiLang() === "en" ? "e" : ""}`;
  }

  function diagText() {
    return formatDiagText({
      version: APP_VERSION,
      model: state.settings?.model || "",
      baseUrl: state.settings?.baseUrl || "",
      lastModelRaw: state.lastModelRaw
    });
  }

  function updateScrollLock() {
    if (!screen) return;
    screen.classList.toggle("is-locked", state.sheetOpen || state.workspaceOpen || state.wordLayers.length > 0);
  }

  let suppressNextPopstate = false;
  let activeViewTransition = null;
  let queuedRender = null;

  const state = {
    mode: "auto",
    settings: null,
    history: [],
    saved: [],
    route: { name: "home" },
    sheetOpen: false,
    sheetStack: [],
    wordLayers: [],
    draft: null,
    searchSeq: 0,
    loadingTimer: null,
    toastTimer: null,
    sheetCloseTimer: null,
    sheetOpenedAt: 0,
    settingsOpen: false,
    settingsTab: "model",
    settingsDirty: false,
    settingsSaveTimer: null,
    module: "dictionary",
    translatorSeq: 0,
    translatorMode: "auto",
    translatorStyles: (CONTENT.translator?.styles || []).map((style) => style.id),
    workspaceOpen: false,
    themeDeck: null,
    themeDecks: [],
    themeDisplay: [],
    themeIndex: 0,
    themeGenerating: false,
    themeSeq: 0,
    lastTranslationInput: "",
    lastTranslationResult: null,
    lastAttempt: null,
    openKey: 0,
    moodOffset: 0,
    installPrompt: null
  };

  /* ============================================================
     Stores, services & view controllers
     ============================================================ */

  const settingsStore = createSettingsStore({ state, data: DATA, llm: LLM, toast });
  const {
    activeProfile,
    profileSupportsThinking,
    syncDraftProfile,
    loadSettings,
    persistSettings,
    unlockStoredKeys,
    hadPlainKeys,
    hasModelConfig,
    loadHistory,
    persistHistory,
    addHistory,
    loadSaved,
    persistSaved,
    syncSavedFromWordbooks,
    parseSavedEntry,
    findSavedIndex,
    isSavedKey
  } = settingsStore;

  state.settings = loadSettings();
  state.history = loadHistory();
  state.saved = loadSaved();

  const cacheStore = createWordCacheStore({
    state,
    data: DATA,
    appEl: app,
    cacheCornerEl: cacheCorner,
    uiLang,
    langSuffix,
    renderCacheContent: () => sheets.renderCacheContent(),
    toast
  });
  const {
    sentenceCache,
    initWordStore,
    removeWordRecord,
    deleteWordCacheFor,
    pruneWordCache,
    clearWordStore,
    sentenceKey,
    cacheGetSentence,
    cachePutSentence,
    removeSentenceRecord,
    clearSentenceCache,
    cacheGetWord,
    cachePutWord,
    cacheGetChunk,
    cachePutChunk,
    exportWordCache,
    importWordCache,
    wordCacheStats,
    wordCacheEstimate,
    applyCacheDisplay,
    refreshCacheBorders,
    updateCacheCorner,
    hideCacheCorner
  } = cacheStore;

  const lookup = createLookupService({
    state,
    data: DATA,
    llm: LLM,
    englishDirective,
    reverseIdFor,
    sentenceLevelOf,
    exampleStyleFor,
    themesMissingExamples,
    hasModelConfig,
    cacheGetWord,
    cachePutWord,
    cacheGetChunk,
    cachePutChunk,
    cacheGetSentence,
    cachePutSentence,
    sentenceKey,
    cacheGetReverseFirst: (...args) => reverseView.cacheGetReverseFirst(...args),
    updateReverseStream: (...args) => reverseView.updateReverseStream(...args),
    updateExamplesBlock: (...args) => wordView.updateExamplesBlock(...args),
    refreshCacheBorders,
    updateCacheCorner,
    hideCacheCorner
  });
  const {
    reverseBudget,
    reverseZoneName,
    reverseStyleName,
    modelLookup,
    lookupWordDeduped,
    schedulePrefetch,
    cancelPrefetch,
    scheduleThemeExamples,
    fillThemeExamples,
    updateStreamPreview,
    callWordbookAi
  } = lookup;

  const tts = createTtsController({
    state,
    usableApiKey,
    toast
  });
  const { getAudioStats, clearAudioCache, refreshTtsError, speakText } = tts;

  const sheets = createSheetController({
    state,
    overlayRoot,
    data: DATA,
    reduceMotion,
    updateScrollLock,
    flushSettingsDraft: () => settingsSheet.flushSettingsDraft(),
    renderSettingsContent: () => settingsSheet.renderSettingsContent(),
    wordCacheStats,
    wordCacheEstimate,
    getAudioStats,
    formatBytes,
    clearWordStore,
    clearAudioCache,
    exportWordCache,
    refreshCacheBorders,
    activeWordData,
    schedulePrefetch,
    toast
  });
  const { openSheetShell, closeSheet, refreshCacheUi } = sheets;

  const share = createShareController({
    state,
    screen,
    activeWordData,
    exampleForTheme,
    openSheetShell,
    toast
  });

  const themeSalon = createThemeSalon({
    state,
    content: CONTENT,
    llm: LLM,
    copyFor,
    hasModelConfig,
    openSheetShell,
    closeSheet,
    renderSettingsContent: () => settingsSheet.renderSettingsContent(),
    formatBytes,
    toast
  });
  const {
    initThemeStore,
    currentThemeDeck,
    themeSalonMarkup,
    renderThemeCacheStats
  } = themeSalon;

  const translator = createTranslatorView({
    state,
    workspaceRoot,
    overlayRoot,
    llm: LLM,
    styles: CONTENT.translator?.styles || [],
    systemPrompt: window.TALK_PROMPTS.translator,
    modelTimeoutMs: MODEL_TIMEOUT_MS,
    modelTimeoutText: MODEL_TIMEOUT_TEXT,
    copyFor,
    uiLang,
    englishDirective,
    hasModelConfig,
    homeTopbar,
    applyInputMode,
    updateScrollLock,
    queueReveal,
    openSheetShell,
    addHistory,
    toast
  });
  const {
    translatorPage,
    openTranslationWorkspace,
    closeTranslationWorkspace,
    syncTranslatorInputsFromWorkspace,
    updateTranslatorLanguage,
    updateTranslatorStyleControls,
    runTranslation
  } = translator;

  const statusViews = createStatusViews({
    state,
    data: DATA,
    backTopbar,
    runSearch,
    lookupDemo,
    addHistory,
    navigate,
    toast
  });
  const { loadingBody, loadingPage, missPage, errorPage } = statusViews;

  const wordView = createWordView({
    state,
    screen,
    data: DATA,
    reduceMotion,
    backTopbar,
    layerTopbar,
    isSavedKey,
    hasModelConfig,
    exampleForTheme,
    themesMissingExamples,
    fillThemeExamples,
    activeWordData,
    getActiveSurface,
    removeWordRecord,
    deleteWordCacheFor,
    hydrateLayerWithModel: (...args) => layers.hydrateLayerWithModel(...args),
    runSearch,
    scrollScreenTo,
    applyCacheDisplay,
    refreshCacheBorders,
    persistSettings,
    refreshThemedPage,
    closeTopWordLayer: () => layers.popWordLayer(),
    goBack,
    toast
  });
  const { moveWordPos, wordPage } = wordView;

  const chunkView = createChunkView({
    state,
    copyFor,
    backTopbar,
    layerTopbar,
    isSavedKey,
    hasModelConfig,
    activeWordData,
    getActiveSurface,
    chunkCacheKey,
    removeWordRecord,
    hydrateChunkLayer: (...args) => layers.hydrateChunkLayer(...args),
    runSearch,
    closeTopWordLayer: () => layers.popWordLayer(),
    toast
  });
  const { chunkPage } = chunkView;

  const sentenceView = createSentenceView({
    state,
    data: DATA,
    backTopbar,
    layerTopbar,
    isSavedKey,
    hasModelConfig,
    openSheetShell,
    cacheGetChunk,
    navigate,
    runSearch,
    getActiveSurface,
    sentenceLevelOf,
    sentenceKey,
    removeSentenceRecord,
    clearSentenceCache,
    refreshCacheUi: () => sheets.refreshCacheUi(),
    hydrateSentenceLayer: (...args) => layers.hydrateSentenceLayer(...args),
    closeTopWordLayer: () => layers.popWordLayer(),
    toast
  });
  const { sentencePage } = sentenceView;

  const reverseView = createReverseView({
    state,
    copyFor,
    uiLang,
    reverseIdFor,
    reverseBudget,
    reverseStyleName,
    modelLookup,
    closeAllWordLayers: (...args) => layers.closeAllWordLayers(...args),
    closeSheet,
    navigate,
    runSearch,
    openHistorySheet: (...args) => historySheet.openHistorySheet(...args),
    renderHistoryContent: () => historySheet.renderHistoryContent(),
    toast
  });
  const {
    loadReverseThread,
    listReverseThreads,
    reversePage,
    startReverse,
    submitReverseComposer,
    gotoReverseAnchor
  } = reverseView;

  const layers = createLayerController({
    state,
    layerRoot,
    data: DATA,
    reduceMotion,
    modelTimeoutText: MODEL_TIMEOUT_TEXT,
    layerTopbar,
    loadingBody,
    wordPage,
    chunkPage,
    sentencePage,
    getWord,
    getSentence,
    cacheGetWord,
    cacheGetChunk,
    cacheGetSentence,
    sentenceLevelOf,
    sentenceKey,
    activeProfile,
    applyProfileToSettings,
    hasModelConfig,
    lookupWordDeduped,
    modelLookup,
    addHistory,
    closeSheet,
    enhanceWordColumns,
    applyCacheDisplay,
    refreshCacheBorders,
    schedulePrefetch,
    updateCacheCorner,
    hideCacheCorner,
    updateScrollLock
  });
  const {
    openWordLayer,
    openChunkLayer,
    openSentenceLayer,
    popWordLayer,
    closeAllWordLayers
  } = layers;

  const settingsSheet = createSettingsSheet({
    state,
    overlayRoot,
    llm: LLM,
    appVersion: APP_VERSION,
    appBuild: APP_BUILD,
    providerTemplates: PROVIDER_TEMPLATES,
    customTemplate: CUSTOM_TEMPLATE,
    detailLevels: DETAIL_LEVELS,
    sentenceLevels: SENTENCE_LEVELS,
    prefetchLimit: PREFETCH_LIMIT,
    sentenceCache,
    copyFor,
    openSheetShell,
    closeSheet,
    activeProfile,
    applyProfileToSettings,
    syncDraftProfile,
    profileSupportsThinking,
    hasModelConfig,
    persistSettings,
    applyCacheDisplay,
    refreshCacheBorders,
    activeWordData,
    schedulePrefetch,
    hydrateLayerWithModel: (...args) => layers.hydrateLayer(...args),
    sentenceLevelOf,
    reverseZoneName,
    exampleStyleFor,
    saveExampleStyles,
    wordCacheStats,
    formatBytes,
    diagText,
    refreshTtsError,
    renderThemeCacheStats,
    applyContentCopy,
    refreshThemedPage,
    getWord,
    scheduleThemeExamples,
    toast
  });
  const { scheduleSettingsCommit } = settingsSheet;

  const historySheet = createHistorySheet({
    state,
    data: DATA,
    openSheetShell,
    closeSheet,
    listReverseThreads,
    syncSavedFromWordbooks,
    parseSavedEntry,
    findSavedIndex,
    persistSaved,
    persistHistory,
    cacheGetWord,
    cacheGetChunk,
    hasModelConfig,
    callWordbookAi,
    navigate,
    runSearch,
    openWordLayer,
    toast
  });
  const { openHistorySheet, isTermLocallyCached, updateWordbookImportHint } = historySheet;

  const homeView = createHomeView({
    state,
    data: DATA,
    copyFor,
    sanitizeHistory,
    homeTopbar,
    themeSalonMarkup,
    currentThemeDeck
  });
  const { renderMoods, homePage } = homeView;

  actions.register({
    ...tts.actions,
    ...sheets.actions,
    ...share.actions,
    ...themeSalon.actions,
    ...translator.actions,
    ...statusViews.actions,
    ...wordView.actions,
    ...chunkView.actions,
    ...sentenceView.actions,
    ...reverseView.actions,
    ...layers.actions,
    ...settingsSheet.actions,
    ...historySheet.actions,
    home({ event }) {
      event.preventDefault();
      tapFeedback();
      navigate({ name: "home" }, { direction: "back" });
    },
    back({ event }) {
      event.preventDefault();
      goBack();
    },
    "cache-status"({ event }) {
      event.preventDefault();
      toast(cacheCorner?.dataset.label || "缓存状态");
    },
    module({ event, target }) {
      event.preventDefault();
      const rawMod = target.dataset.module;
      const module = rawMod === "translator" ? "translator" : rawMod === "reader" ? "reader" : "dictionary";
      if (module === state.module) return;
      const modOrder = { dictionary: 0, translator: 1, reader: 2 };
      const dir = (modOrder[module] ?? 0) >= (modOrder[state.module] ?? 0) ? "next" : "prev";
      document.documentElement.dataset.moduleDir = dir;
      state.module = module;
      updateModuleBar();
      tapFeedback();
      closeAllWordLayers({ immediate: true });
      if (module === "translator") navigate({ name: "translator" }, { replace: false });
      else if (module === "reader") navigate({ name: "reader" }, { replace: false });
      else navigate({ name: "home" }, { replace: false });
      if (!document.startViewTransition) {
        screen.classList.remove("is-module-glide");
        void screen.offsetWidth;
        screen.classList.add("is-module-glide");
      }
      if (state.moduleGlideTimer) window.clearTimeout(state.moduleGlideTimer);
      state.moduleGlideTimer = window.setTimeout(() => {
        state.moduleGlideTimer = 0;
        delete document.documentElement.dataset.moduleDir;
        screen.classList.remove("is-module-glide");
      }, 360);
    },
    mode({ event, target }) {
      event.preventDefault();
      state.mode = target.dataset.mode || "auto";
      $$(".mode-btn", screen).forEach((button) => {
        const active = button.dataset.mode === state.mode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      updateSearchMeta();
    },
    lookup({ event, target }) {
      event.preventDefault();
      tapFeedback();
      closeSheet({ immediate: true });
      runSearch(target.dataset.query || "", target.dataset.type || "auto");
    },
    word({ event, target }) {
      event.preventDefault();
      tapFeedback();
      openWordRoute(target.dataset.word || "");
    },
    save({ event, target }) {
      event.preventDefault();
      toggleSaved(target);
    },
    copy({ event }) {
      event.preventDefault();
      copyCurrentPage();
    },
    "copy-text"({ event, target }) {
      event.preventDefault();
      const text = target.dataset.copy || "";
      if (!text) return;
      void copyText(text).then((copied) => toast(copied ? "已复制" : "这个浏览器不允许复制"));
    },
    "shuffle-moods"({ event }) {
      event.preventDefault();
      state.moodOffset += 3;
      renderMoods();
      tapFeedback();
    }
  });

  /* ============================================================
     Routing & transitions
     ============================================================ */

  function routeHash(route) {
    if (route.name === "word") return `#/word/${encodeURIComponent(route.word || "")}`;
    if (route.name === "sentence") return `#/sentence/${encodeURIComponent(route.id || route.result?.id || "")}`;
    if (route.name === "chunk") return `#/chunk/${encodeURIComponent(chunkSlug(route.query || route.result?.chunk || ""))}`;
    if (route.name === "reverse") return `#/reverse/${encodeURIComponent(route.id || route.result?.id || "")}`;
    if (route.name === "translator") return "#/translate";
    if (route.name === "reader") return "#/reader";
    if (route.name === "loading") return "#/search";
    if (route.name === "miss" || route.name === "error") {
      return `#/search?q=${encodeURIComponent(route.query || "")}&type=${encodeURIComponent(route.type || "auto")}`;
    }
    return "#/";
  }

  function routeFromHash() {
    const raw = location.hash.replace(/^#\/?/, "");
    if (!raw) return { name: "home" };
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded.startsWith("word/")) {
        const word = normalizeWord(decoded.slice(5));
        if (DATA.words[word]) return { name: "word", word, result: DATA.words[word] };
        if (word && cacheGetWord(word)) return { name: "word", word };
      }
      if (decoded.startsWith("sentence/")) {
        const id = decoded.slice(9);
        const result = DATA.sentences.find((item) => item.id === id);
        if (result) return { name: "sentence", id, result };
        if (id.startsWith("model-")) return { name: "sentence", id };
      }
      if (decoded.startsWith("chunk/")) {
        const query = chunkFromSlug(decoded.slice(6));
        if (query) return { name: "chunk", query };
      }
      if (decoded === "reverse") return { name: "reverse", id: "" };
      if (decoded.startsWith("reverse/")) {
        const id = decoded.slice(8);
        if (id) return { name: "reverse", id };
      }
      if (decoded === "translate" || decoded === "translator") return { name: "translator" };
      if (decoded === "reader") return { name: "reader" };
    } catch (_) {
      return { name: "home" };
    }
    return { name: "home" };
  }

  function navigate(route, { replace = false, instant = false, direction = "forward" } = {}) {
    const currentDepth = Number(history.state?.depth) || 0;
    const depth = replace ? currentDepth : route.name === "home" ? 0 : currentDepth + 1;
    const histState = { route, depth };
    try {
      if (replace) history.replaceState(histState, "", routeHash(route));
      else history.pushState(histState, "", routeHash(route));
    } catch (_) {
      /* History can fail in private frames. The screen still works. */
    }
    if (direction === "back" && route.name === "home") setRevealMode("instant-top");
    renderRoute(route, direction, { instant });
  }

  function refreshThemedPage() {
    if (!screen || !state.route || state.route.name === "loading") return;
    const html = pageHtml(state.route);
    if (!html) return;
    const prevScroll = screen.scrollTop;
    const prevReverseScroll = $(".reverse-page", screen)?.scrollTop || 0;
    screen.innerHTML = html;
    screen.querySelectorAll(".reveal, .reveal-item").forEach((element) => element.classList.add("is-in"));
    enhanceWordColumns(screen);
    applyCacheDisplay();
    refreshCacheBorders();
    updateModuleBar();
    applyContentCopy();
    window.TALK_I18N?.apply(document.body);
    scrollScreenTo(prevScroll, true);
    if (prevReverseScroll) {
      const revScroller = $(".reverse-page", screen);
      if (revScroller) revScroller.scrollTop = prevReverseScroll;
    }
  }

  function enhanceWordColumns(root = screen) {
    const page = root?.querySelector?.(".result-page");
    if (!page || page.querySelector(":scope > .word-columns")) return;
    const meaning = page.querySelector(":scope > .word-meaning-block");
    const family = page.querySelector(":scope > .word-family-block");
    const anchor = family || meaning;
    if (!anchor) return;
    const blocks = [];
    let node = anchor.nextElementSibling;
    while (node) {
      if (node.classList?.contains("block")) blocks.push(node);
      node = node.nextElementSibling;
    }
    const origin = blocks.find((block) => block.classList.contains("word-origin-block"));
    const related = blocks.find((block) => block.classList.contains("word-related-block"));
    const columns = blocks.filter((block) => block !== origin && block !== related);
    let wrapper = null;
    if (columns.length) {
      wrapper = document.createElement("div");
      wrapper.className = "word-columns";
      anchor.after(wrapper);
      columns.forEach((block) => wrapper.append(block));
    }
    const tailAnchor = wrapper || anchor;
    if (origin) tailAnchor.after(origin);
    if (related) (origin || tailAnchor).after(related);
  }

  /* ============================================================
     Smooth scroll & reveal observer
     ============================================================ */

  let revealObserver = null;
  let lenis = null;

  function setupSmoothScroll() {
    if (reduceMotion || !window.Lenis || lenis) return;
    try {
      lenis = new Lenis({
        wrapper: screen,
        content: screen,
        lerp: 0.09,
        smoothWheel: true,
        syncTouch: false,
        wheelMultiplier: 1
      });
    } catch (_) {
      lenis = null;
      return;
    }
    const raf = (time) => {
      lenis?.raf(time);
      window.requestAnimationFrame(raf);
    };
    window.requestAnimationFrame(raf);
  }

  function scrollScreenTo(top, immediate = false) {
    if (lenis) {
      lenis.scrollTo(top, { immediate, force: true });
      if (immediate) screen.scrollTop = top;
      return;
    }
    screen.scrollTop = top;
  }

  function resizeSmoothScroll() {
    if (!lenis) return;
    window.requestAnimationFrame(() => lenis?.resize());
  }

  function revealAllRemaining() {
    const pending = $$(".reveal:not(.is-in), .reveal-item:not(.is-in)");
    pending.forEach((element) => element.classList.add("is-in"));
  }

  const STAGGER_MS = 40;
  const MAX_STAGGER_MS = 180;
  let revealMode = "normal";
  let revealWatcher = null;
  let revealRafId = 0;
  let screenEnterTimer = 0;

  function setRevealMode(mode) {
    revealMode = mode;
  }

  function observeReveals(scope, { syncAboveFold = false } = {}) {
    if (!revealObserver) return;
    const root = scope || screen;
    if (!root) return;
    // Nested .reveal nodes ride along with their section (CSS handles it).
    root.querySelectorAll(".reveal").forEach((element) => {
      if (element.parentElement?.closest(".reveal")) element.classList.add("is-in");
    });
    const pending = [...root.querySelectorAll(".reveal:not(.is-in)")].filter(
      (element) => !element.parentElement?.closest(".reveal") && element.dataset.revealQueued !== "1"
    );
    const pendingItems = [...root.querySelectorAll(".reveal-item:not(.is-in)")].filter(
      (element) => element.dataset.revealQueued !== "1"
    );
    if (!pending.length && !pendingItems.length) return;

    const viewport = window.innerHeight || 800;
    const mode = revealMode;
    revealMode = "normal";
    let order = 0;
    pending.forEach((element) => {
      const rect = element.getBoundingClientRect();
      const inView = rect.top < viewport && rect.bottom > 0;
      // When ViewTransition is handling the crossfade/slide, mark above-the-fold
      // blocks visible synchronously so the transition snapshot never captures
      // semi-transparent / scaled-down cards that pop a second time afterward.
      if (syncAboveFold && inView) {
        element.dataset.revealQueued = "1";
        element.classList.add("is-in");
        return;
      }
      // A route that lands on top of an existing screen does not need to push
      // in: the top band is simply there.
      if ((mode === "instant-home" || mode === "instant-top") && rect.top < (mode === "instant-home" ? viewport : 220)) {
        element.dataset.revealQueued = "1";
        element.style.transition = "none";
        element.classList.add("is-in");
        window.requestAnimationFrame(() => { element.style.transition = ""; });
        return;
      }
      // Content that replaces a skeleton fades in without scale, so the grey
      // blocks never appear to morph into text.
      if (mode === "soft" && rect.top < viewport) {
        element.dataset.revealQueued = "1";
        element.classList.add("reveal-soft");
        const delay = Math.min(order * 35, MAX_STAGGER_MS);
        order += 1;
        window.setTimeout(() => {
          if (element.classList.contains("is-in")) return;
          element.style.transitionDelay = "0ms";
          element.classList.add("is-in");
        }, delay);
        return;
      }
      // Anything already on the first screen cascades top-to-bottom quickly;
      // everything below waits for the observer.
      if (rect.top < viewport) {
        element.dataset.revealQueued = "1";
        const delay = Math.min(order * STAGGER_MS, MAX_STAGGER_MS);
        order += 1;
        window.setTimeout(() => {
          if (element.classList.contains("is-in")) return;
          element.style.transitionDelay = "0ms";
          element.classList.add("is-in");
        }, delay);
      } else {
        element.dataset.revealQueued = "1";
        revealObserver.observe(element);
      }
    });
    pendingItems.forEach((element) => {
      element.dataset.revealQueued = "1";
      const rect = element.getBoundingClientRect();
      if (syncAboveFold && rect.top < viewport && rect.bottom > 0) {
        element.classList.add("is-in");
      } else {
        revealObserver.observe(element);
      }
    });
  }

  function setupReveal() {
    const html = document.documentElement;
    if (reduceMotion) {
      html.classList.add("motion-off");
      html.classList.remove("motion-ready");
      return;
    }
    if (!("IntersectionObserver" in window)) {
      html.classList.remove("motion-ready");
      return;
    }
    html.classList.add("motion-ready");
    window.__talkReveal = true;
    screen.addEventListener("scroll", () => {
      if (screen.scrollHeight - screen.scrollTop - screen.clientHeight < 40) revealAllRemaining();
    }, { passive: true });
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        revealObserver.unobserve(entry.target);
      });
    }, {
      root: null,
      threshold: 0.01,
      rootMargin: "0px 0px 120px 0px"
    });
    observeReveals(screen);
    if (!revealWatcher) {
      revealWatcher = new MutationObserver((mutations) => {
        const fresh = mutations.some((mutation) =>
          [...mutation.addedNodes].some((node) =>
            node.nodeType === 1 && (
              (node.matches?.(".reveal:not(.is-in), .reveal-item:not(.is-in)") && node.dataset.revealQueued !== "1")
              || Boolean(node.querySelector?.(".reveal:not(.is-in):not([data-reveal-queued='1']), .reveal-item:not(.is-in):not([data-reveal-queued='1'])"))
            )));
        if (!fresh) return;
        if (!revealRafId) {
          revealRafId = window.requestAnimationFrame(() => {
            revealRafId = 0;
            observeReveals(document);
          });
        }
      });
      revealWatcher.observe(document.body, { childList: true, subtree: true });
    }
  }

  function queueReveal(scope) {
    if (!revealObserver) return;
    const target = scope || screen;
    if (revealRafId) window.cancelAnimationFrame(revealRafId);
    revealRafId = window.requestAnimationFrame(() => {
      revealRafId = 0;
      observeReveals(target);
    });
  }

  function renderRoute(route, direction = "forward", { instant = false } = {}) {
    if (route.name === "home" && revealMode === "normal") setRevealMode("instant-home");
    const useViewTransition = Boolean(!instant && !reduceMotion && document.startViewTransition);
    const apply = (withViewTransition = false) => {
      if (!screen) return;
      state.route = route;
      screen.dataset.page = route.name;
      state.module = route.name === "translator" ? "translator" : route.name === "reader" ? "reader" : "dictionary";
      updateModuleBar();
      closeTranslationWorkspace({ immediate: true });
      closeSheet({ immediate: true });
      closeAllWordLayers({ immediate: true });
      // Drop observed nodes from the outgoing page before it is discarded.
      revealObserver?.disconnect();
      screen.innerHTML = pageHtml(route);
      screen.classList.toggle("reveal-soft-mode", revealMode === "soft");
      applyInputMode($("#search-input"), "en");
      enhanceWordColumns(screen);
      applyCacheDisplay();
      refreshCacheBorders(screen);
      scrollScreenTo(0, true);
      if (withViewTransition) {
        observeReveals(screen, { syncAboveFold: true });
      } else {
        queueReveal(screen);
      }
      if (route.name === "word") {
        const word = getWord(route);
        if (word) {
          schedulePrefetch(word);
          scheduleThemeExamples(word);
        }
      } else {
        cancelPrefetch();
      }
      resizeSmoothScroll();
      screen.classList.remove("is-leaving", "is-back-leaving", "is-entering");
      if (!withViewTransition) {
        void screen.offsetWidth;
        screen.classList.add("is-entering");
        if (screenEnterTimer) window.clearTimeout(screenEnterTimer);
        screenEnterTimer = window.setTimeout(() => {
          screenEnterTimer = 0;
          screen.classList.remove("is-entering");
        }, 1300);
      }
      document.title = pageTitle(route);
      window.TALK_I18N?.apply(document.body);
      if (route.name === "reverse" && Number.isFinite(state.restoreScroll) && state.restoreScroll >= 0) {
        const target = state.restoreScroll;
        state.restoreScroll = -1;
        window.requestAnimationFrame(() => {
          const scroller = $(".reverse-page", screen) || screen;
          scroller.scrollTop = target;
        });
      }
      if (route.name === "reader") {
        window.TALK_READER?.onMount?.(screen);
      }
      if (route.name === "translator") {
        updateTranslatorLanguage();
        updateTranslatorStyleControls();
        if (route.text) {
          const field = $("#translator-input");
          if (field) field.value = route.text;
          updateTranslatorLanguage();
          openTranslationWorkspace(route.text);
        }
      }
    };

    if (useViewTransition) {
      if (activeViewTransition) {
        /* The running transition has not painted its own update callback yet.
           Rendering now would let that callback overwrite this page later. */
        queuedRender = { route, direction };
        activeViewTransition.finished.catch(() => {}).finally(() => {
          activeViewTransition = null;
          const next = queuedRender;
          queuedRender = null;
          if (next) renderRoute(next.route, next.direction, { instant: true });
        });
        return;
      }
      try {
        const transition = document.startViewTransition(() => apply(true));
        activeViewTransition = transition;
        transition.finished.catch(() => {}).finally(() => { activeViewTransition = null; });
        return;
      } catch (_) {
        /* Fall through to the static render. */
      }
    }

    if (!instant && !reduceMotion && !document.startViewTransition) {
      screen.classList.add(direction === "back" ? "is-back-leaving" : "is-leaving");
      window.setTimeout(() => apply(false), 150);
      return;
    }

    apply(false);
  }

  function goBack() {
    if (state.sheetOpen) {
      closeSheet();
      return;
    }
    if (state.workspaceOpen) {
      closeTranslationWorkspace();
      return;
    }
    if (state.wordLayers.length) {
      popWordLayer();
      return;
    }
    state.searchSeq += 1;
    clearLoadingTimer();
    tapFeedback();
    const depth = Number(history.state?.depth) || 0;
    if (depth > 0) {
      history.back();
    } else {
      navigate({ name: "home" }, { replace: true, direction: "back" });
    }
  }

  function pageTitle(route) {
    if (uiLang() === "en") {
      if (route.name === "word") return `${titleCase(route.word)} — talk. dictionary`;
      if (route.name === "sentence") return "Sentence analysis — talk.";
      if (route.name === "translate" || route.name === "translator") return "Multi-style translation — talk.";
      if (route.name === "reader") return "Intensive Reader — talk.";
      if (route.name === "reverse") return "Find the wording — talk.";
      if (route.name === "chunk") return `${route.chunk || route.query || "Chunk"} — talk.`;
      return "talk. — English, in context";
    }
    if (route.name === "word") return `${titleCase(route.word)} — talk.`;
    if (route.name === "sentence") return "句子理解 — talk.";
    if (route.name === "translator") return "多风格翻译 — talk.";
    if (route.name === "reader") return "长文精读 — talk.";
    return "talk. — 英语，在语境中理解";
  }

  function pageHtml(route) {
    switch (route.name) {
      case "word": {
        const word = getWord(route);
        return word ? wordPage(word) : missPage("word", route.word || "", ["serendipity", "ephemeral", "resilient"]);
      }
      case "sentence": {
        const sentence = getSentence(route);
        return sentence ? sentencePage(sentence) : missPage("sentence", route.query || "", []);
      }
      case "chunk": {
        const chunk = getChunk(route);
        return chunk ? chunkPage(chunk) : missPage("chunk", route.query || "", ["by and large", "take off", "in the end"]);
      }
      case "reverse": {
        state.reverse = null;
        if (!state.reverseThread?.length || state.reverseThreadId !== route.id) {
          const stored = loadReverseThread(route.id);
          if (stored) {
            state.reverseThreadId = stored.id;
            state.reverseThread = stored.messages.map((turn) => ({ ...turn }));
            state.reverseBudget = Number(stored.budget) || state.reverseBudget;
            state.reverseStyle = stored.style || state.reverseStyle;
          }
        }
        if (!state.reverseThread?.length) {
          // No thread in the URL: resume the most recent conversation so the
          // history entry point stays reachable.
          const recent = listReverseThreads()[0];
          if (recent) {
            state.reverseThreadId = recent.id;
            state.reverseThread = recent.messages.map((turn) => ({ ...turn }));
            state.reverseBudget = Number(recent.budget) || state.reverseBudget;
            state.reverseStyle = recent.style || state.reverseStyle;
            history.replaceState({ ...history.state, route: { name: "reverse", id: recent.id } }, "", routeHash({ name: "reverse", id: recent.id }));
          } else {
            return missPage("reverse", route.query || "", []);
          }
        }
        return reversePage({ id: route.id });
      }
      case "translator":
        return translatorPage();
      case "reader":
        return window.TALK_READER ? window.TALK_READER.pageHtml() : "";
      case "loading":
        return loadingPage(route.query, route.type);
      case "miss":
        return missPage(route.type, route.query, route.suggestions || []);
      case "error":
        return errorPage(route);
      default:
        return homePage();
    }
  }

  function getWord(route) {
    if (route?.result) return ensureWord(route.result);
    const cached = cacheGetWord(route?.word || "");
    if (cached) return ensureWord(cached);
    return ensureWord(DATA.words[normalizeWord(route?.word || "")]);
  }

  function getChunk(route) {
    if (route?.result) return ensureChunk(route.result);
    return cacheGetChunk(route?.query || "");
  }

  function getSentence(route) {
    if (route?.result) return ensureSentence(route.result);
    const id = String(route?.id || "");
    if (id.startsWith("model-")) {
      const cached = cacheGetSentence(id.slice("model-".length));
      if (cached) return ensureSentence(cached);
    }
    return ensureSentence(DATA.sentences.find((item) => item.id === id));
  }

  /* ============================================================
     Top bar & module indicator
     ============================================================ */

  function contentValue(path) {
    const parts = String(path || "").split(".");
    const section = parts.shift();
    return parts.reduce((value, key) => value?.[key], copyFor(section));
  }

  function applyContentCopy(root = document) {
    $$("[data-copy]", root).forEach((element) => {
      const value = contentValue(element.dataset.copy);
      if (value) element.textContent = value;
    });
  }

  function syncModuleIndicator({ instant = false } = {}) {
    const sw = $(".module-switch", app);
    if (!sw) return;
    let ind = $(".module-indicator", sw);
    if (!ind) {
      ind = document.createElement("span");
      ind.className = "module-indicator";
      ind.setAttribute("aria-hidden", "true");
      sw.prepend(ind);
    }
    const activeBtn = $(".module-btn.active", sw);
    if (!activeBtn) return;
    const swRect = sw.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    if (!swRect.width || !btnRect.width) return;
    const x = btnRect.left - swRect.left;
    const y = btnRect.top - swRect.top;
    if (instant) {
      const prev = ind.style.transition;
      ind.style.transition = "none";
      ind.style.width = `${btnRect.width}px`;
      ind.style.height = `${btnRect.height}px`;
      ind.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      void ind.offsetWidth;
      ind.style.transition = prev;
    } else {
      ind.style.width = `${btnRect.width}px`;
      ind.style.height = `${btnRect.height}px`;
      ind.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
    sw.classList.add("has-indicator");
  }

  function updateModuleBar() {
    if (!app) return;
    $$(".module-btn", app).forEach((button) => {
      const active = button.dataset.module === state.module;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    window.requestAnimationFrame(() => syncModuleIndicator({ instant: !app.dataset.modIndReady }));
    app.dataset.modIndReady = "1";
  }

  window.addEventListener("resize", () => syncModuleIndicator({ instant: true }));

  function homeTopbar() {
    return `
      <header class="topbar">
        <button class="brand" type="button" data-action="home" aria-label="Talk 首页">talk<span class="dot">.</span></button>
        <div class="top-actions">
          <button class="icon-btn" type="button" data-action="history" aria-label="最近查询" title="最近查询">${icon("clock")}</button>
          <button class="icon-btn" type="button" data-action="settings" aria-label="连接模型" title="连接模型">${icon("settings")}</button>
        </div>
      </header>`;
  }

  function backTopbar({ label, title, bookmark = null, share = false, actions: extraActions = "" }) {
    const saved = bookmark ? isSavedKey(bookmark) : false;
    return `
      <header class="topbar">
        <button class="icon-btn" type="button" data-action="back" aria-label="返回">${icon("arrowLeft")}</button>
        <div class="topbar-context">
          <span class="mono">${esc(label)}</span>
          <strong>${esc(title)}</strong>
        </div>
        <div class="top-actions">
          ${bookmark ? `<button class="icon-btn ${saved ? "is-saved" : ""}" type="button" data-action="save" aria-label="${saved ? "取消收藏" : "收藏"}" aria-pressed="${saved}" title="${saved ? "已收藏" : "收藏"}">${icon("bookmark")}</button>` : ""}
          ${share ? `<button class="icon-btn" type="button" data-action="share-page" aria-label="分享这一页" title="分享这一页">${icon("share")}</button>` : ""}
          ${extraActions}
          <button class="icon-btn" type="button" data-action="settings" aria-label="连接模型" title="连接模型">${icon("settings")}</button>
        </div>
      </header>`;
  }

  function layerTopbar({ title, bookmark = null, origin = "", relation = "", depth = 1 }) {
    const saved = bookmark ? isSavedKey(bookmark) : false;
    return `
      <header class="topbar">
        <button class="icon-btn" type="button" data-action="layer-back" aria-label="返回上一层">${icon("arrowLeft")}</button>
        <div class="topbar-context">
          <span class="mono">第 ${depth} 层 · 从「${esc(origin)}」${relation ? ` · ${esc(relation)}` : ""}</span>
          <strong>${esc(title)}</strong>
        </div>
        <div class="top-actions">
          ${bookmark ? `<button class="icon-btn ${saved ? "is-saved" : ""}" type="button" data-action="save" aria-label="${saved ? "取消收藏" : "收藏"}" aria-pressed="${saved}" title="${saved ? "已收藏" : "收藏"}">${icon("bookmark")}</button>` : ""}
          <button class="icon-btn" type="button" data-action="share-page" aria-label="分享这一页" title="分享这一页">${icon("share")}</button>
          <button class="icon-btn" type="button" data-action="settings" aria-label="连接模型" title="连接模型">${icon("settings")}</button>
        </div>
      </header>`;
  }

  /* ============================================================
     Search & offline demo fallback
     ============================================================ */

  class DemoMiss extends Error {
    constructor(type, query, suggestions = []) {
      super("Not in the offline demo");
      this.name = "DemoMiss";
      this.type = type;
      this.query = query;
      this.suggestions = suggestions;
    }
  }

  function suggestionsForWord(query) {
    const q = normalizeWord(query);
    const keys = Object.keys(DATA.words);
    const close = keys.filter((key) => key !== q && (key.includes(q.slice(0, 3)) || q.includes(key.slice(0, 3))));
    return (close.length ? close : ["serendipity", "ephemeral", "resilient"]).slice(0, 3);
  }

  function lookupDemo(query, type) {
    if (type === "word") {
      const key = normalizeWord(query);
      if (DATA.words[key]) return { type: "word", data: DATA.words[key] };
      throw new DemoMiss("word", query, suggestionsForWord(query));
    }

    const target = normalizeSentence(query);
    const match = DATA.sentences.find((item) => {
      const text = normalizeSentence(item.text);
      return text === target || target.includes(text) || text.includes(target);
    });
    if (match) return { type: "sentence", data: match };
    throw new DemoMiss("sentence", query, DATA.sentences.slice(0, 2).map((item) => item.text));
  }

  function startLoadingStatus(type) {
    clearLoadingTimer();
    const messages = type === "sentence"
      ? ["正在读这句话", "找出真正重要的词", "整理语气与含义"]
      : type === "chunk"
        ? ["正在辨认这个意群", "拆开它的槽位", "找出关键的那个词"]
        : type === "reverse"
          ? ["正在读你描述的场景", "翻找贴切的表达", "把候选写进手记"]
          : ["正在理解词义", "收集同根词", "寻找自然例句"];
    let index = 0;
    const timer = window.setInterval(() => {
      index = (index + 1) % messages.length;
      const target = $("#loading-status-text");
      if (target) target.textContent = messages[index];
    }, 1200);
    state.loadingTimer = timer;
  }

  function clearLoadingTimer() {
    if (state.loadingTimer) {
      window.clearInterval(state.loadingTimer);
      state.loadingTimer = null;
    }
  }

  async function runSearch(rawQuery, requestedMode = "auto", options = {}) {
    const query = sanitizeQuery(rawQuery);
    const input = $("#search-input");
    if (input && input.value.trim() !== query) {
      input.value = query;
      autoGrow(input);
      updateSearchMeta();
    }
    if (!query) {
      const card = $(".search-card");
      if (card) {
        card.classList.remove("is-shaking");
        void card.offsetWidth;
        card.classList.add("is-shaking");
      }
      toast("先输入一个单词或一句话");
      return;
    }

    const type = requestedMode === "auto" ? detectParadigm(query) : requestedMode;
    state.lastAttempt = { query, type };
    const token = ++state.searchSeq;
    let loadingTimerId = null;
    if (type === "reverse" && hasModelConfig()) {
      clearLoadingTimer();
      void startReverse(query);
      return;
    }
    navigate({ name: "loading", query, type }, { instant: true });
    startLoadingStatus(type);
    loadingTimerId = state.loadingTimer;

    try {
      let result;
      if (hasModelConfig()) {
        const onPreview = (preview) => {
          if (token !== state.searchSeq) return;
          updateStreamPreview(preview, type);
        };
        result = type === "word"
          ? await lookupWordDeduped(query, { onPreview })
          : await modelLookup(query, type, state.settings, { ...options, onPreview });
      } else if (type === "chunk") {
        await wait(620);
        throw new DemoMiss("chunk", query, ["by and large", "take off", "in the end"]);
      } else if (type === "reverse") {
        await wait(620);
        throw new DemoMiss("reverse", query, []);
      } else {
        await wait(820);
        result = lookupDemo(query, type);
      }
      if (token !== state.searchSeq) {
        if (loadingTimerId && state.loadingTimer === loadingTimerId) clearLoadingTimer();
        return;
      }
      clearLoadingTimer();
      if (result.type !== "reverse") addHistory(result.type, query);
      const route = result.type === "word"
        ? { name: "word", word: result.data.word, query, result: result.data }
        : result.type === "chunk"
          ? { name: "chunk", query, result: result.data }
          : result.type === "reverse"
            ? { name: "reverse", id: result.data.id, result: result.data }
            : { name: "sentence", id: result.data.id, query, result: result.data };
      if (result.type === "reverse") {
        state.reverseThread = [{ role: "user", text: query }, { role: "assistant", result: result.data }];
      }
      setRevealMode("soft");
      /* The pending reverse shell was pushed a few milliseconds ago; a second
         replace in the same frame can be swallowed by the running transition.
         Render the settled route directly when we are already on the desk. */
      if (result.type === "reverse" && state.route?.name === "reverse") {
        try {
          history.replaceState({ route, depth: Number(history.state?.depth) || 1 }, "", routeHash(route));
        } catch (_) {}
        renderRoute(route, "forward", { instant: true });
      } else {
        navigate(route, { replace: true, direction: "forward" });
      }
    } catch (error) {
      if (token !== state.searchSeq) {
        if (loadingTimerId && state.loadingTimer === loadingTimerId) clearLoadingTimer();
        return;
      }
      clearLoadingTimer();
      if (error instanceof DemoMiss) {
        navigate({ name: "miss", type: error.type, query: error.query, suggestions: error.suggestions }, { replace: true });
        return;
      }
      const message = error?.name === "AbortError"
        ? `${MODEL_TIMEOUT_TEXT}，已中断。`
        : String(error?.message || "模型返回了未知错误。");
      navigate({ name: "error", query, type, message }, { replace: true });
    }
  }

  /* ============================================================
     Interactions
     ============================================================ */

  let suppressClickUntil = 0;

  async function handleClick(event) {
    if (Date.now() < suppressClickUntil) {
      suppressClickUntil = 0;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const target = event.target.closest("[data-action]");
    if (!target) return;
    await actions.dispatch(target.dataset.action, { event, target });
  }

  function handleInput(event) {
    const target = event.target;
    if (target.matches("[data-cache-setting]")) {
      const key = target.dataset.cacheSetting;
      let value = Number(target.value);
      if (!Number.isFinite(value)) return;
      if (key === "cacheMax") value = Math.max(10, Math.min(2000, Math.round(value)));
      if (key === "cacheTtlDays") value = Math.max(1, Math.min(3650, Math.round(value)));
      state.settings = { ...state.settings, [key]: value };
      if (state.draft) state.draft[key] = value;
      persistSettings(state.settings);
      if (event.type === "change") {
        void pruneWordCache().then(() => refreshCacheUi());
      } else {
        const estimate = $("#cache-estimate");
        if (estimate) estimate.textContent = `按当前平均 ${formatBytes(wordCacheEstimate().average)}/词条估算，上限占用约 ${wordCacheEstimate().label}；语音缓存另计。`;
      }
      return;
    }
    if (target.id === "word-cache-file") {
      const file = target.files?.[0];
      target.value = "";
      if (!file) return;
      void importWordCache(file).then((count) => {
        refreshCacheUi();
        refreshCacheBorders();
        toast(`已导入 ${count} 个词条`);
      }).catch((error) => {
        toast(`导入失败：${String(error?.message || error)}`);
      });
      return;
    }
    if (target.id === "translator-input") {
      updateTranslatorLanguage();
      return;
    }
    if (target.id === "workspace-translator-input") {
      syncTranslatorInputsFromWorkspace();
      return;
    }
    if (target.id === "search-input") {
      autoGrow(target);
      updateSearchMeta();
      return;
    }
    if (target.matches("[data-profile-option]") && state.draft) {
      const profile = activeProfile(state.draft);
      if (!profile) return;
      const key = target.dataset.profileOption;
      if (key === "enableThinking") {
        profile.enableThinking = Boolean(target.checked);
        state.draft.enableThinking = profile.enableThinking;
      }
      if (key === "thinkingBudget") {
        const value = Math.max(0, Math.min(262144, Math.round(Number(target.value) || 0)));
        profile.thinkingBudget = value;
        state.draft.thinkingBudget = value;
      }
      scheduleSettingsCommit();
      return;
    }
    if (target.matches("[data-profile-name]") && state.draft) {
      const profile = activeProfile(state.draft);
      if (profile) profile.name = target.value;
      scheduleSettingsCommit();
      return;
    }
    if (target.matches("[data-example-style]")) {
      const id = target.dataset.exampleStyle;
      const next = exampleStyleOverrides();
      const value = String(target.value || "").trim();
      if (value) next[id] = value;
      else delete next[id];
      saveExampleStyles(next);
      return;
    }
    if (target.matches("[data-setting]") && state.draft) {
      const key = target.dataset.setting;
      state.draft[key] = target.type === "checkbox" ? target.checked : target.value;
      if (key === "reverseMaxTokens") {
        let value = Number(target.value) || 1500;
        for (const stop of [1000, 2000]) {
          if (Math.abs(value - stop) <= 40) value = stop;
        }
        if (String(value) !== String(target.value)) target.value = String(value);
        const badge = $("#reverse-token-value");
        if (badge) badge.textContent = String(value);
        const zone = $("#reverse-token-zone");
        if (zone) zone.textContent = reverseZoneName(value);
        const scale = $("#reverse-token-scale");
        if (scale) {
          [...scale.children].forEach((el, index) => {
            const active = index === (value < 1000 ? 0 : value < 2000 ? 1 : 2);
            el.classList.toggle("is-active", active);
          });
        }
      }
      if (key === "qwenTtsModel") {
        if (/^qwen3-tts/i.test(target.value) && /^longanhuan/i.test(state.draft.qwenTtsVoice || "")) {
          state.draft.qwenTtsVoice = "Cherry";
          const voiceInput = $("#qwen-tts-voice");
          if (voiceInput) voiceInput.value = "Cherry";
        }
        const endpoint = $("#qwen-tts-endpoint");
        if (endpoint) {
          const profile = qwenTtsProfile(state.draft);
          if (profile) endpoint.textContent = `使用「${profile.name}」的 API 密钥 · ${qwenTtsEndpoint(profile, target.value)}`;
        }
      }
      if (key === "apiKey" || key === "baseUrl" || key === "model") {
        const status = $("#api-test-status");
        if (status) {
          status.className = `key-status ${hasModelConfig(state.draft) ? "" : "off"}`;
          status.innerHTML = hasModelConfig(state.draft)
            ? `${icon("shield")} <span>已配置模型 · ${esc(state.draft.model || "自定义")}</span>`
            : "<span>演示模式 · 无需密钥</span>";
        }
      }
      scheduleSettingsCommit();
    }
  }

  function handleSubmit(event) {
    if (event.target.classList?.contains("reverse-composer")) {
      event.preventDefault();
      submitReverseComposer();
      return;
    }
    if (event.target.id === "translator-form") {
      event.preventDefault();
      const input = $("#translator-input");
      if (input) openTranslationWorkspace(input.value);
      return;
    }
    if (event.target.id === "workspace-translator-form") {
      event.preventDefault();
      const input = $("#workspace-translator-input");
      if (input) {
        syncTranslatorInputsFromWorkspace();
        runTranslation(input.value);
      }
      return;
    }
    if (event.target.id !== "search-form") return;
    event.preventDefault();
    const input = $("#search-input");
    if (input) runSearch(input.value, state.mode);
  }

  function autoGrow(input) {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
  }

  function updateSearchMeta() {
    const input = $("#search-input");
    const label = $("#detect-label");
    if (!input || !label) return;
    const paradigmLabels = { word: "单词", chunk: "意群", sentence: "句子", reverse: "语境寻词" };
    const detected = state.mode === "auto" ? detectParadigm(input.value) : state.mode;
    label.textContent = state.mode === "auto"
      ? `自动 · ${paradigmLabels[detected] || "单词"}`
      : `${paradigmLabels[state.mode] || "单词"}模式`;
    input.placeholder = state.mode === "sentence"
      ? "粘贴一句想读懂的英文…"
      : state.mode === "word"
        ? "输入一个想查的单词…"
        : state.mode === "chunk"
          ? "输入一个搭配或短语，例如 take off…"
          : "输入一个单词、一个搭配，或一句中文…";
  }

  function openWordRoute(word) {
    const key = normalizeWord(word);
    const entry = DATA.words[key];
    if (entry) {
      addHistory("word", key);
      navigate({ name: "word", word: key, result: entry });
      return;
    }
    runSearch(word, "word");
  }

  /**
   * Unified active surface resolver: checks top overlay layer first, then main screen route.
   * All page-level actions (regenerate, delete cache, ask AI, save) read from here.
   */
  function getActiveSurface() {
    const top = state.wordLayers[state.wordLayers.length - 1];
    if (top) {
      const kind = top.kind || "word";
      const query = kind === "chunk"
        ? (top.data?.chunk || top.word || "")
        : kind === "sentence"
          ? (top.data?.text || top.word || "")
          : (top.data?.word || top.word || "");
      return { kind, query, data: top.data || null, isLayer: true, record: top };
    }
    const name = state.route?.name || "home";
    if (name === "word") {
      const data = getWord(state.route);
      return { kind: "word", query: data?.word || state.route?.word || "", data, isLayer: false, record: null };
    }
    if (name === "chunk") {
      const data = getChunk(state.route);
      return { kind: "chunk", query: data?.chunk || state.route?.query || "", data, isLayer: false, record: null };
    }
    if (name === "sentence") {
      const data = getSentence(state.route);
      return { kind: "sentence", query: data?.text || "", data, isLayer: false, record: null };
    }
    return { kind: name, query: "", data: null, isLayer: false, record: null };
  }

  function activeWordData() {
    const surface = getActiveSurface();
    return surface.kind === "word" ? surface.data : null;
  }

  function bookmarkKey() {
    const topLayer = state.wordLayers[state.wordLayers.length - 1];
    if (topLayer?.kind === "chunk" && topLayer.data?.chunk) return String(topLayer.data.chunk).trim().toLowerCase();
    if (topLayer?.kind === "sentence" && topLayer.data?.text) return `sentence:${String(topLayer.data.text).trim()}`;
    const active = activeWordData();
    if (active?.word) return normalizeWord(active.word);
    if (state.route.name === "sentence") {
      const text = String(state.route.result?.text || state.route.query || "").trim();
      return text ? `sentence:${text}` : null;
    }
    if (state.route.name === "chunk") {
      const text = String(state.route.result?.chunk || state.route.query || "").trim().toLowerCase();
      return text || null;
    }
    return null;
  }

  function syncSaveButton(item, saved) {
    if (!item) return;
    item.classList.toggle("is-saved", saved);
    item.setAttribute("aria-pressed", String(saved));
    item.setAttribute("aria-label", saved ? "取消收藏" : "收藏");
    item.setAttribute("title", saved ? "已收藏" : "收藏");
    const baseLabel = item.dataset.saveLabel;
    if (baseLabel) {
      item.innerHTML = `${icon("bookmark")} ${saved ? "已收藏" : esc(baseLabel)}`;
    }
  }

  function toggleSaved(button) {
    const key = bookmarkKey();
    if (!key) return;
    const wb = window.TALK_WORDBOOKS;
    if (wb) wb.loadStore(state.saved);
    const index = findSavedIndex(key);
    if (index >= 0) {
      if (wb) wb.removeTerm(key);
      state.saved.splice(index, 1);
      toast("已移出词汇书库");
    } else {
      if (wb) wb.addTerm(key, wb.DEFAULT_BOOK_ID);
      state.saved.unshift(key);
      toast("已收入「密集书库」");
    }
    if (wb) state.saved = wb.allTermsFlat();
    persistSaved();
    const saved = isSavedKey(key);
    syncSaveButton(button, saved);
    const scope = state.wordLayers.length ? state.wordLayers[state.wordLayers.length - 1].el : screen;
    $$('[data-action="save"]', scope).forEach((item) => syncSaveButton(item, saved));
  }

  async function copyCurrentPage() {
    let text = "";
    const active = activeWordData();
    if (active) {
      text = `${active.word} ${active.phonetic}\n${active.translation}\n${active.short}`;
    } else if (state.route.name === "sentence") {
      const sentence = getSentence(state.route);
      if (sentence) text = `${sentence.text}\n${sentence.translation}`;
    }
    if (!text) return;
    const copied = await copyText(text);
    toast(copied ? "Copied to clipboard" : "Could not copy in this browser");
  }

  function toast(message) {
    if (!toastEl) return;
    if (state.toastTimer) window.clearTimeout(state.toastTimer);
    toastEl.textContent = message;
    toastEl.classList.add("show");
    state.toastTimer = window.setTimeout(() => {
      toastEl.classList.remove("show");
      state.toastTimer = null;
    }, 2300);
  }

  let lastWordbookStorageWarn = 0;
  window.addEventListener("talk:wordbook-storage-error", () => {
    const now = Date.now();
    if (now - lastWordbookStorageWarn < 6000) return;
    lastWordbookStorageWarn = now;
    toast("词汇书库存储已满，这次改动可能没保存。先导出 JSON 备份，再删掉一些词条。");
  });

  document.addEventListener("input", (event) => {
    if (event.target?.id === "wb-import-textarea") updateWordbookImportHint();
  });

  /* ============================================================
     Keyboard
     ============================================================ */

  function handleKeydown(event) {
    if (event.key === "Escape") {
      if (state.sheetOpen) {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (state.workspaceOpen) {
        event.preventDefault();
        closeTranslationWorkspace();
        return;
      }
      if (state.wordLayers.length) {
        event.preventDefault();
        popWordLayer();
        return;
      }
      const input = $("#search-input");
      if (input && document.activeElement === input) input.blur();
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      const input = $("#search-input");
      if (input) {
        event.preventDefault();
        input.focus();
        input.select();
      }
    }

    if (event.key === "Enter" && !event.shiftKey && event.target?.id === "search-input") {
      event.preventDefault();
      event.target.form?.requestSubmit();
    }
  }

  /* ============================================================
     Init & bridges
     ============================================================ */

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    if (location.hostname === "127.0.0.1" || location.hostname === "localhost") return;
    if (window.Capacitor?.isNativePlatform?.()) return;
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((error) => {
      console.warn("PWA service worker registration failed.", error);
    });
  }

  function setupInstallPrompt() {
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      state.installPrompt = event;
      const button = $("#install-app");
      if (button) button.hidden = false;
    });
    window.addEventListener("appinstalled", () => {
      state.installPrompt = null;
      const button = $("#install-app");
      if (button) button.hidden = true;
      toast("已安装到主屏幕");
    });
  }

  async function init() {
    await unlockStoredKeys();
    if (hadPlainKeys()) persistSettings(state.settings);
    setupInstallPrompt();
    await initThemeStore();
    applyCacheDisplay();
    applyContentCopy();
    $$("[data-app-version]").forEach((element) => { element.textContent = `v${APP_VERSION}`; });
    await initWordStore();
    let wordSwipe = null;
    app.addEventListener("pointerdown", (event) => {
      const pager = event.target.closest?.(".meaning-pager");
      if (!pager) return;
      wordSwipe = { pager, x: event.clientX, y: event.clientY };
    }, { passive: true });
    app.addEventListener("pointerup", (event) => {
      if (!wordSwipe) return;
      const swipe = wordSwipe;
      wordSwipe = null;
      const dx = event.clientX - swipe.x;
      const dy = event.clientY - swipe.y;
      if (Math.abs(dx) > 38 && Math.abs(dx) > Math.abs(dy) * 1.15) {
        moveWordPos(swipe.pager, dx < 0 ? 1 : -1);
      }
    }, { passive: true });
    app.addEventListener("pointercancel", () => { wordSwipe = null; }, { passive: true });

    document.addEventListener("click", handleClick);
    function englishOnly(text) {
      const head = String(text || "").split(/\s[—–]\s|\s-\s/)[0] || "";
      const cleaned = head.replace(/[「」“”"'`]/g, "").replace(/\s+/g, " ").trim();
      return /[A-Za-z]/.test(cleaned) ? cleaned : "";
    }

    function appendToComposer(text) {
      const field = $("#reverse-input");
      if (!field) return false;
      const clean = String(text || "").replace(/\s+/g, " ").trim();
      if (!clean) return false;
      field.value = field.value.trim() ? `${field.value.trim()} ${clean}` : clean;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
      toast("已加入输入框");
      return true;
    }

    let pressStart = null;
    document.addEventListener("pointerdown", (event) => {
      pressStart = { x: event.clientX, y: event.clientY, at: Date.now(), target: event.target };
    }, { passive: true });
    document.addEventListener("pointerup", (event) => {
      const start = pressStart;
      pressStart = null;
      if (!start || Date.now() - start.at < 450) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 14) return;
      if (!$("#reverse-input")) return;
      const selection = window.getSelection();
      const text = englishOnly(selection?.toString() || "");
      if (!text) return;
      const node = selection.anchorNode;
      const element = node?.nodeType === 3 ? node.parentElement : node;
      if (!element?.closest?.(".reverse-markdown")) return;
      if (appendToComposer(text)) suppressClickUntil = Date.now() + 700;
    });

    document.addEventListener("keydown", (event) => {
      const anchor = event.target instanceof Element ? event.target.closest(".rev-anchor") : null;
      if (anchor && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        gotoReverseAnchor(anchor.dataset.text || "");
        return;
      }
      const example = event.target instanceof Element ? event.target.closest('[data-action="example-lookup"]') : null;
      if (example && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        example.click();
        return;
      }
      if (event.key !== "Enter" || event.target?.id !== "reverse-input") return;
      if (event.isComposing) return;
      event.preventDefault();
      submitReverseComposer();
    });
    app.addEventListener("input", handleInput);
    app.addEventListener("change", handleInput);
    app.addEventListener("submit", handleSubmit);
    document.addEventListener("keydown", handleKeydown);

    window.addEventListener("popstate", (event) => {
      if (suppressNextPopstate) {
        suppressNextPopstate = false;
        return;
      }
      // Browser back should peel one overlay at a time. The URL has already
      // moved to the previous history entry, so immediately move forward
      // again while closing the overlay; otherwise the app would jump to the
      // previous page and close every layer at once.
      if (state.sheetOpen || state.workspaceOpen || state.wordLayers.length) {
        if (state.sheetOpen) closeSheet();
        else if (state.workspaceOpen) closeTranslationWorkspace();
        else popWordLayer();
        suppressNextPopstate = true;
        history.forward();
        window.setTimeout(() => { suppressNextPopstate = false; }, 700);
        return;
      }
      state.searchSeq += 1;
      clearLoadingTimer();
      const stored = event.state?.route;
      const route = stored && stored.name && routeHash(stored) === location.hash
        ? stored
        : routeFromHash();
      renderRoute(route, "back");
    });

    if ("scrollRestoration" in history) history.scrollRestoration = "manual";

    const storedRoute = history.state?.route;
    const initial = storedRoute && storedRoute.name && routeHash(storedRoute) === location.hash
      ? storedRoute
      : routeFromHash();
    history.replaceState({ route: initial, depth: 0 }, "", routeHash(initial));
    setupReveal();
    renderRoute(initial, "forward", { instant: true });
    setupSmoothScroll();
    registerServiceWorker();

    // Expose a tiny debugging surface for the design review.
    window.TALK_APP = {
      goHome: () => navigate({ name: "home" }, { replace: true }),
      openWord: (word) => openWordRoute(word),
      openSentence: (id) => {
        const sentence = DATA.sentences.find((item) => item.id === id);
        if (sentence) navigate({ name: "sentence", id, result: sentence });
      },
      search: (query, mode = "auto") => runSearch(query, mode),
      wordCacheStats,
      exportWordCache,
      state
    };
  }

  window.__TALK_BRIDGE__ = {
    isWordCached: (term) => isTermLocallyCached(term),
    callWordbookAi,
    openWordbooksSheet: () => openHistorySheet("wordbooks"),
    openReaderWithBook: (bookId) => {
      closeSheet({ immediate: true });
      state.module = "reader";
      updateModuleBar();
      navigate({ name: "reader" }, { replace: false });
      window.setTimeout(() => window.TALK_READER?.selectWordbook?.(bookId), 80);
    },
    hasModelConfig: () => hasModelConfig(),
    renderEntryBodyHtml: (kind, data) => {
      if (!data) return "";
      const full = kind === "chunk" ? chunkPage(ensureChunk(data)) : wordPage(ensureWord(data));
      return full.replace(/^\s*<header class="topbar">[\s\S]*?<\/header>/i, "");
    },
    enhanceEntryDom: (container) => {
      if (!container) return;
      enhanceWordColumns(container);
      container.querySelectorAll(".reveal, .reveal-item").forEach((el) => el.classList.add("is-in"));
      refreshCacheBorders(container);
    },
    lookupFullEntry: async (phrase, mode = "word") => {
      const clean = String(phrase || "").trim();
      if (!clean) return null;
      const isChunk = mode === "chunk" || clean.includes(" ");
      if (isChunk) {
        const cached = cacheGetChunk(clean);
        if (cached) return { kind: "chunk", data: cached };
        const demo = DATA.chunks?.[chunkSlug(clean)];
        if (demo) return { kind: "chunk", data: ensureChunk(demo) };
        if (!hasModelConfig()) return null;
        const res = await modelLookup(clean, "chunk", state.settings);
        return res?.data ? { kind: "chunk", data: res.data } : null;
      }
      const key = normalizeWord(clean);
      const cached = cacheGetWord(key);
      if (cached) return { kind: "word", data: ensureWord(cached) };
      const demo = DATA.words?.[key];
      if (demo) return { kind: "word", data: ensureWord(demo) };
      if (!hasModelConfig()) return null;
      const res = await lookupWordDeduped(key);
      return res?.data ? { kind: "word", data: ensureWord(res.data) } : null;
    },
    homeTopbar: () => homeTopbar(),
    toast: (msg) => toast(msg),
    isWordSaved: (term) => isSavedKey(term),
    toggleSaveWord: (term, bookId = null) => {
      const clean = String(term || "").trim();
      if (!clean) return false;
      const wb = window.TALK_WORDBOOKS;
      if (wb) wb.loadStore(state.saved);
      const idx = findSavedIndex(clean);
      if (idx >= 0) {
        if (wb) wb.removeTerm(clean);
        state.saved.splice(idx, 1);
        if (wb) state.saved = wb.allTermsFlat();
        persistSaved();
        return false;
      }
      if (wb) wb.addTerm(clean, bookId || wb.DEFAULT_BOOK_ID);
      state.saved.unshift(clean);
      if (wb) state.saved = wb.allTermsFlat();
      persistSaved();
      return true;
    },
    openWord: (word, opts = {}) => openWordLayer(word, { relation: "精读词眼", origin: "精读本", ...opts }),
    openChunk: (phrase, opts = {}) => openChunkLayer(phrase, { relation: "精读意群", origin: "精读本", ...opts }),
    openSentence: (sentence, opts = {}) => openSentenceLayer(sentence, { relation: "精读拆句", origin: "精读本", ...opts }),
    openTranslator: (text) => navigate({ name: "translator", text }),
    speakText: (text, btn) => speakText(text, btn),
    getSentenceLevel: () => state.settings?.sentenceLevel || "cet6",
    getSentenceLevelLabel: () => {
      const lv = state.settings?.sentenceLevel || "cet6";
      const found = SENTENCE_LEVELS.find((x) => x.id === lv);
      return found ? found.label : lv.toUpperCase();
    },
    callModelJSON: async (systemPrompt, userPayload, { signal, maxTokens = 4096, temperature = 0.3 } = {}) => {
      return LLM.requestJson({
        settings: state.settings,
        system: systemPrompt,
        user: userPayload,
        maxTokens,
        timeoutMs: Math.max(MODEL_TIMEOUT_MS, 90_000),
        signal,
        label: "模型接口",
        disableThinking: true,
        temperature,
        retries: 1
      });
    }
  };

  init().catch((error) => {
    console.error("Talk failed to initialise.", error);
    renderRoute({ name: "home" }, "forward", { instant: true });
  });
})();
