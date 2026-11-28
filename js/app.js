/* ============================================================
   talk. — interactive dictionary prototype
   Vanilla ES Modules. No build step.
   ============================================================ */

import {
  $,
  $$,
  esc,
  attr,
  rich,
  shorten,
  sanitizeQuery,
  normalizeWord,
  normalizeSentence,
  normalizeChunk,
  chunkSlug,
  chunkFromSlug,
  hasCJK,
  detectSourceLanguage,
  hashText,
  countWords,
  detectParadigm,
  detectType,
  escapeRegExp,
  wait,
  tapFeedback,
  blockHead,
  letterTitle,
  highlightPlain,
  timeAgo,
  titleCase,
  registerLabel,
  posAbbr,
  posLabel,
  tagLabel,
  asArray,
  normalizeStrings,
  secureRemoteUrl,
  copyText
} from "./core/utils.js";
import { icon } from "./core/icons.js";
import {
  DIAG_KEY,
  diagLog,
  formatDiagText,
  installGlobalErrorLogging
} from "./core/diagnostics.js";
import { createActionRegistry } from "./core/actions.js";
import {
  SEAL_PREFIX,
  canSeal,
  sealText,
  unlockSettingsKeys
} from "./storage/vault.js";
import { streamPreviewFromJson } from "./model/stream-preview.js";
import {
  isHallucinatedWord,
  normalizeExamplesByTheme,
  splitSentences,
  alignSentenceParts,
  normalizeModelWord,
  normalizeModelSentence,
  ensureWord,
  ensureChunk,
  ensureSentence
} from "./model/normalize.js";
import {
  isQwenProfile,
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
import { uniqueWords, createLayerController } from "./views/layers.js";
import { createSheetController } from "./views/sheets.js";
import { createSettingsSheet } from "./views/settings-sheet.js";
import { createHistorySheet } from "./views/history-sheet.js";

(() => {
  "use strict";

  const DATA = window.TALK_DATA;
  const CONTENT = window.TALK_CONTENT;
  const LLM = window.TALK_LLM;
  const APP_VERSION = "1.0"; // display version
  const APP_BUILD = "295"; // cache-busting build, kept in step with ?v= and sw.js
  const actions = createActionRegistry();

  function copyFor(section) {
    const theme = window.TALK_THEME?.current?.() || { id: "paper", copyKey: null };
    const base = CONTENT[section] || {};
    const key = theme.copyKey || theme.id;
    const override = CONTENT.themeCopy?.[key]?.[section];
    return override ? { ...base, ...override } : base;
  }
  const app = document.getElementById("app");
  const screen = document.getElementById("screen");
  const layerRoot = document.getElementById("layer-root");
  const workspaceRoot = document.getElementById("workspace-root");
  const overlayRoot = document.getElementById("overlay-root");
  const cacheCorner = document.getElementById("cache-corner");
  const toastEl = document.getElementById("toast");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isDesktop = () => window.matchMedia("(min-width: 861px)").matches;

  const CONFIG_KEY = "talk.model.v1";
  const PREFERENCES_KEY = "talk.prefs.v1";
  const PREFERENCE_FIELDS = ["prefetch", "cacheDisplay", "ttsEngine", "qwenTtsModel", "qwenTtsVoice", "detailLevel", "cacheMax", "cacheTtlDays", "sentenceLevel", "foldMode", "showGenMeta", "reverseMaxTokens"];
  const EXAMPLE_STYLE_KEY = "talk.exampleStyles.v1";
  // One table drives the prompt, the settings picker and the on-page slicing.
  const SENTENCE_LEVELS = [
    { id: "zhongkao", label: "中考", maxKeyWords: 3, hint: "基础词与固定搭配优先" },
    { id: "gaokao", label: "高考", maxKeyWords: 4, hint: "常见高频词与基本句型" },
    { id: "cet4", label: "CET-4", maxKeyWords: 5, hint: "四级核心词与常见从句" },
    { id: "cet6", label: "CET-6", maxKeyWords: 6, hint: "六级词与复杂修饰" },
    { id: "kaoyan", label: "考研", maxKeyWords: 7, hint: "考研长难句与学术表达" },
    { id: "ielts", label: "雅思", maxKeyWords: 7, hint: "雅思阅读句式与同义替换" },
    { id: "toefl", label: "托福", maxKeyWords: 8, hint: "托福学术句与抽象概念" }
  ];
  const SENTENCE_LEVEL_DEFAULT = "gaokao";
  function diagText() {
    return formatDiagText({
      version: APP_VERSION,
      model: state.settings?.model || "",
      baseUrl: state.settings?.baseUrl || "",
      lastModelRaw: state.lastModelRaw
    });
  }
  installGlobalErrorLogging();

  // Sentences now carry a summary, a parse tree and level-tagged key words,
  // which no longer fits in the old per-detail ceiling.
  const SENTENCE_MAX_TOKENS = { fast: 6000, standard: 12000, deep: 20000 };
  // The depth option shapes the prompt; these ceilings only stop a runaway reply.
  const SENTENCE_DEPTH_BRIEF = {
    fast: "需要多少写多少即可，但偏向精简：tree 一般 3–5 个节点，重点词 2–4 个，每层解释一句话。",
    standard: "按内容需要完整展开：tree 一般 6–9 个节点，重点词按等级上限，解释具体但不铺陈。",
    deep: "尽量讲透：tree 可到 12–14 个节点，重点词到上限，补语域、易错点与阅读提示，但不要重复。"
  };
  // Single source for the model-request deadline; error copy derives from it.
  const MODEL_TIMEOUT_MS = 180_000;
  const MODEL_TIMEOUT_TEXT = `请求超过 ${MODEL_TIMEOUT_MS / 1000} 秒`;
  const HISTORY_KEY = "talk.history.v1";
  const SAVED_KEY = "talk.saved.v1";
  // Bumped when the shape of a cached entry changes (POS spelled out, English
  // glosses, ...). Older records are ignored and quietly replaced on the next
  // lookup, so nobody keeps reading a stale mix of Chinese and English.
  // Bumped when the stored shape grows, never to invalidate old entries:
  // schema 2 payloads stay readable and are upgraded in place on next write.
  const WORD_CACHE_SCHEMA = 3;
  const WORD_CACHE_MIN_SCHEMA = 2;
  const REVERSE_KEY = "talk.reverse.v1";
  const REVERSE_LIMIT = 20;
  const REVERSE_TTL = 7 * 24 * 60 * 60 * 1000;
  const WORD_CACHE_KEY = "talk.wordcache.v1";
  const WORD_DB_NAME = "talk.words.v1";
  const WORD_DB_STORE = "entries";
  const SENTENCE_DB_STORE = "sentences";
  const SENTENCE_CACHE_SCHEMA = 2;
  const SENTENCE_LIMIT = 120;
  const sentenceCache = new Map();
  const DEFAULT_CACHE_MAX = 300;
  const PREFETCH_LIMIT = 4;
  const DEFAULT_CACHE_TTL_DAYS = 90;
  let wordDb = null;
  let wordStoreFallback = false;
  const wordCache = new Map();

  let storedKeysPlain = false;
  let storageChain = Promise.resolve();

  function unlockStoredKeys() {
    return unlockSettingsKeys(state.settings, activeProfile);
  }

  // A still-sealed key means unsealing failed (e.g. no WebCrypto here).
  // Never send the ciphertext as a credential; ask the user to re-enter it.
  const usableApiKey = (value) => LLM.usableApiKey(value);

  const DEFAULT_SETTINGS = {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    apiKey: "",
    enableThinking: false,
    thinkingBudget: 0,
    remember: false,
    prefetch: false,
    cacheDisplay: "borders",
    detailLevel: "standard",
    ttsEngine: "native",
    qwenTtsModel: "qwen-audio-3.1-tts-plus",
    qwenTtsVoice: "longanhuan_v3.1",
    showGenMeta: true,
    reverseMaxTokens: 1500
  };

  const DETAIL_LEVELS = {
    fast: {
      label: "快速",
      maxTokens: 1200,
      senses: 1,
      family: 2,
      synonyms: 2,
      antonyms: 1,
      examples: 1,
      collocations: 2,
      stages: 2,
      keyWords: 3
    },
    standard: {
      label: "标准",
      maxTokens: 2200,
      senses: 2,
      family: 3,
      synonyms: 3,
      antonyms: 2,
      examples: 2,
      collocations: 4,
      stages: 3,
      keyWords: 4
    },
    deep: {
      label: "深入",
      maxTokens: 3200,
      senses: 3,
      family: 4,
      synonyms: 4,
      antonyms: 3,
      examples: 3,
      collocations: 5,
      stages: 4,
      keyWords: 5
    }
  };

  const PROVIDERS = {
    deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
    openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    google: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-3.6-flash" },
    custom: { baseUrl: "", model: "" }
  };

  const MODEL_PRESETS = [
    {
      id: "deepseek",
      name: "DeepSeek",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      protocol: "openai",
      note: "OpenAI 兼容；浏览器直连 CORS 可用。"
    },
    {
      id: "openai",
      name: "OpenAI",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      protocol: "openai",
      note: "OpenAI 官方接口；浏览器直连可能受 CORS 限制。"
    },
    {
      id: "google",
      name: "Google Gemini",
      provider: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-3.6-flash",
      protocol: "google",
      note: "Google AI Studio 原生接口（generateContent）；模型名可改，例如 gemini-2.5-flash。"
    },
    {
      id: "qwen",
      name: "Qwen",
      provider: "custom",
      baseUrl: "https://cn-beijing.maas.qianwenaiapi.com/compatible-mode/v1",
      model: "qwen3.7-flash",
      note: "Qwen3.7 Flash 混合思考模型；默认关闭思考以降低延迟，可在下方单独调整。",
      thinkingCapable: true,
      enableThinking: false,
      thinkingBudget: 0
    },
    {
      id: "kimi",
      name: "Kimi",
      provider: "custom",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "moonshot-v1-8k",
      note: "Moonshot 开放平台；浏览器直连可能受 CORS 限制。"
    },
    {
      id: "glm",
      name: "GLM",
      provider: "custom",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      model: "glm-4-flash",
      note: "智谱开放平台；浏览器直连可能受 CORS 限制。"
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      provider: "custom",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "anthropic/claude-3.5-sonnet",
      note: "OpenRouter 可转接 Claude 等多种模型。"
    },
    {
      id: "claude",
      name: "Claude",
      provider: "custom",
      baseUrl: "",
      model: "claude-sonnet-4-5",
      note: "Anthropic 原生协议不是 OpenAI 格式；请填写兼容代理地址。"
    },
    {
      id: "custom",
      name: "自定义",
      provider: "custom",
      baseUrl: "",
      model: "",
      note: "任意 OpenAI 兼容服务。"
    }
  ];
  const CUSTOM_TEMPLATE = {
    id: "custom",
    name: "自定义（OpenAI 兼容）",
    provider: "custom",
    protocol: "openai",
    baseUrl: "",
    model: "",
    note: "任何兼容 /chat/completions 的服务：填地址、模型名和密钥即可。"
  };

  const PROVIDER_TEMPLATES = [...MODEL_PRESETS, CUSTOM_TEMPLATE];


  function defaultModelProfiles() {
    return [];
  }

  function legacyModelProfiles(parsed = {}) {
    const baseUrl = String(parsed.baseUrl || "").trim();
    const model = String(parsed.model || "").trim();
    const apiKey = String(parsed.apiKey || "");
    if (!baseUrl && !model && !apiKey) return { profiles: [], activeProfileId: "" };
    return {
      profiles: [{
        id: "legacy-custom",
        name: "我的配置",
        provider: parsed.provider || "custom",
        protocol: String(baseUrl).includes("generativelanguage") ? "google" : "openai",
        baseUrl,
        model,
        apiKey,
        note: "从旧版单配置迁移而来。"
      }],
      activeProfileId: "legacy-custom"
    };
  }

  function normalizeModelProfiles(raw, parsed = {}) {
    if (!Array.isArray(raw) || !raw.length) return legacyModelProfiles(parsed);
    const profiles = raw.map((profile, index) => {
      const id = String(profile.id || `profile-${index + 1}`);
      const isQwen = id === "qwen";
      const oldQwen = isQwen && String(profile.baseUrl || "").includes("dashscope.aliyuncs.com") && profile.model === "qwen-plus";
      const preset = MODEL_PRESETS.find((item) => item.id === id);
      return {
        id,
        name: String(profile.name || `模型 ${index + 1}`),
        provider: String(profile.provider || "custom"),
        baseUrl: oldQwen ? preset.baseUrl : String(profile.baseUrl || ""),
        model: oldQwen ? preset.model : String(profile.model || ""),
        apiKey: String(profile.apiKey || ""),
        note: String(profile.note || (oldQwen ? preset.note : "")),
        protocol: String(profile.protocol || (String(profile.baseUrl || "").includes("generativelanguage") ? "google" : "openai")),
        templateId: String(profile.templateId || (profile.baseUrl ? "" : "custom")),
        thinkingCapable: Boolean(profile.thinkingCapable) || isQwen,
        enableThinking: Boolean(profile.enableThinking),
        thinkingBudget: Math.max(0, Math.min(262144, Number(profile.thinkingBudget) || 0))
      };
    });
    const active = String(parsed.activeProfileId || profiles[0]?.id || "");
    const kept = profiles.filter((profile) => {
      const preset = MODEL_PRESETS.some((item) => item.id === profile.id);
      if (!preset) return true;
      if (profile.id === active) return true;
      return Boolean(String(profile.apiKey || "").trim());
    });
    return { profiles: kept, activeProfileId: kept.some((item) => item.id === active) ? active : (kept[0]?.id || "") };
  }

  const activeProfile = (settings) => LLM.activeProfile(settings);
  const profileSupportsThinking = (profile) => LLM.profileSupportsThinking(profile);

  function applyProfileToSettings(settings, profile) {
    if (!profile) return settings;
    return {
      ...settings,
      provider: profile.provider || "custom",
      baseUrl: profile.baseUrl || "",
      model: profile.model || "",
      apiKey: profile.apiKey || "",
      enableThinking: Boolean(profile.enableThinking),
      thinkingBudget: Number(profile.thinkingBudget) || 0,
      activeProfileId: profile.id
    };
  }

  function syncDraftProfile(draft) {
    if (!draft?.profiles?.length) return;
    const profile = activeProfile(draft);
    if (!profile) return;
    profile.provider = draft.provider || profile.provider || "custom";
    profile.protocol = profile.protocol || (String(profile.provider).toLowerCase() === "google" ? "google" : "openai");
    profile.baseUrl = String(draft.baseUrl || "");
    profile.model = String(draft.model || "");
    profile.apiKey = String(draft.apiKey || "");
    profile.enableThinking = Boolean(draft.enableThinking);
    profile.thinkingBudget = Math.max(0, Math.min(262144, Number(draft.thinkingBudget) || 0));
  }

  const wordRequests = new Map();
  const wordPreviewListeners = new Map();
  let prefetchToken = 0;
  let suppressNextPopstate = false;

  let activeViewTransition = null;
  let queuedRender = null;

  const state = {
    mode: "auto",
    settings: loadSettings(),
    history: loadHistory(),
    saved: loadSaved(),
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

  const tts = createTtsController({
    state,
    usableApiKey,
    toast
  });
  const { stopSpeech, getAudioStats, clearAudioCache, refreshTtsError, speakText, testTts } = tts;

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
  const { openSheetShell, closeSheet, renderCacheContent, refreshCacheUi } = sheets;

  const share = createShareController({
    state,
    screen,
    activeWordData,
    exampleForTheme,
    openSheetShell,
    toast
  });
  const { openShareSheet, renderShareChooser, renderSharePreview } = share;

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
    renderThemeSalon,
    renderThemeCacheStats,
    themeCacheStats,
    clearThemeStore
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
  const { loadingBody, loadingPage, missPage, errorPage, hasDemo } = statusViews;

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
  const { moveWordPos, updateExamplesBlock, wordPage } = wordView;

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
    cacheGetReverseFirst,
    reversePage,
    updateReverseStream,
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
    hydrateLayerWithModel: (...args) => layers.hydrateLayerWithModel(...args),
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
      window.setTimeout(() => {
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

  function updateScrollLock() {
    if (!screen) return;
    screen.classList.toggle("is-locked", state.sheetOpen || state.workspaceOpen || state.wordLayers.length > 0);
  }

  /* ============================================================
     Small app-scoped helpers
     ============================================================ */

  function chunkCacheKey(value) {
    return CHUNK_CACHE_PREFIX + normalizeChunk(value);
  }

  function reverseIdFor(text) {
    return `r${hashText(normalizeSentence(text))}${uiLang() === "en" ? "e" : ""}`;
  }

  /* ============================================================
     Persistence
     ============================================================ */

  function loadSettings() {
    const fallback = { ...DEFAULT_SETTINGS };
    let preferences = {};
    let parsed = {};
    try {
      const rawPrefs = localStorage.getItem(PREFERENCES_KEY);
      if (rawPrefs) {
        const value = JSON.parse(rawPrefs);
        if (value && typeof value === "object") preferences = value;
      }
    } catch (_) { /* no-op */ }
    try {
      const raw = localStorage.getItem(CONFIG_KEY) || sessionStorage.getItem(CONFIG_KEY);
      if (raw) {
        const value = JSON.parse(raw);
        if (value && typeof value === "object") parsed = value;
      }
    } catch (_) { /* no-op */ }

    const normalized = normalizeModelProfiles(parsed.profiles, parsed);
    const activeKeys = [parsed.apiKey, ...(normalized.profiles || []).map((profile) => profile.apiKey)];
    storedKeysPlain = activeKeys.some(
      (value) => typeof value === "string" && value.trim() && !value.startsWith(SEAL_PREFIX)
    );
    const selected = normalized.profiles.find((profile) => profile.id === normalized.activeProfileId) || normalized.profiles[0];
    return applyProfileToSettings({
      ...fallback,
      ...preferences,
      ...parsed,
      prefetch: Boolean(preferences.prefetch || parsed.prefetch),
      remember: Boolean(parsed.remember),
      ttsEngine: preferences.ttsEngine || parsed.ttsEngine || "native",
      detailLevel: preferences.detailLevel || parsed.detailLevel || "standard",
      cacheMax: Number(preferences.cacheMax || parsed.cacheMax || DEFAULT_CACHE_MAX),
      cacheTtlDays: Number(preferences.cacheTtlDays || parsed.cacheTtlDays || DEFAULT_CACHE_TTL_DAYS),
      qwenTtsModel: preferences.qwenTtsModel || parsed.qwenTtsModel || "qwen-audio-3.1-tts-plus",
      qwenTtsVoice: preferences.qwenTtsVoice || parsed.qwenTtsVoice || "longanhuan_v3.1",
      enableThinking: Boolean(selected?.enableThinking),
      thinkingBudget: Number(selected?.thinkingBudget) || 0,
      profiles: normalized.profiles,
      activeProfileId: selected?.id || ""
    }, selected);
  }

  function persistSettings(settings) {
    const active = activeProfile(settings);
    if (active) {
      active.baseUrl = String(settings.baseUrl || "");
      active.model = String(settings.model || "");
      active.apiKey = String(settings.apiKey || "");
      active.provider = String(settings.provider || active.provider || "custom");
    }
    const raw = JSON.parse(JSON.stringify(settings));
    storageChain = storageChain
      .then(async () => {
        await sealSettingsSnapshot(raw);
        const payload = JSON.stringify(raw);
        try { sessionStorage.setItem(CONFIG_KEY, payload); } catch (_) { /* no-op */ }
        try {
          if (raw.remember) localStorage.setItem(CONFIG_KEY, payload);
          else localStorage.removeItem(CONFIG_KEY);
        } catch (_) { /* no-op */ }
        try {
          const preferences = {};
          for (const key of PREFERENCE_FIELDS) preferences[key] = settings[key];
          localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
        } catch (_) { /* no-op */ }
      })
      .catch((error) => console.warn("Could not save settings.", error));
    return storageChain;
  }

  let plainKeyDropWarned = false;

  async function sealSettingsSnapshot(snapshot) {
    const sealKey = async (value) => {
      const text = String(value || "");
      if (!text || text.startsWith(SEAL_PREFIX)) return text;
      const sealed = canSeal() ? await sealText(text) : text;
      if (sealed.startsWith(SEAL_PREFIX)) return sealed;
      // Cannot encrypt here: keep the key in memory for this session only,
      // never write it to localStorage/sessionStorage in plain text.
      if (!plainKeyDropWarned) {
        plainKeyDropWarned = true;
        toast("当前环境无法加密存储，密钥仅保留在本次会话");
      }
      return "";
    };
    snapshot.apiKey = await sealKey(snapshot.apiKey);
    for (const profile of snapshot.profiles || []) {
      profile.apiKey = await sealKey(profile.apiKey);
    }
    return snapshot;
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return sanitizeHistory(DATA.recent);
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return sanitizeHistory(DATA.recent);
      return sanitizeHistory(parsed);
    } catch (_) {
      return sanitizeHistory(DATA.recent);
    }
  }

  function sanitizeHistory(items) {
    return items
      .filter((item) => item && ["word", "chunk", "sentence", "translation"].includes(item.type) && item.query)
      .map((item) => ({
        type: item.type,
        query: String(item.query),
        at: Number(item.at) || 0
      }))
      .slice(0, 10);
  }

  function persistHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history)); } catch (_) { /* no-op */ }
  }

  function addHistory(type, query) {
    const clean = String(query).trim();
    if (!clean) return;
    state.history = [
      { type, query: clean, at: Date.now() },
      ...state.history.filter((item) => !(item.type === type && item.query.toLowerCase() === clean.toLowerCase()))
    ].slice(0, 10);
    persistHistory();
  }

  function loadSaved() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
    } catch (_) {
      return [];
    }
  }

  function persistSaved() {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(state.saved)); } catch (_) { /* no-op */ }
  }

  function syncSavedFromWordbooks() {
    if (!window.TALK_WORDBOOKS) return;
    window.TALK_WORDBOOKS.loadStore(state.saved);
    state.saved = window.TALK_WORDBOOKS.allTermsFlat();
    persistSaved();
  }

  function cacheMax() {
    const value = Number(state.settings?.cacheMax) || DEFAULT_CACHE_MAX;
    return Math.max(10, Math.min(2000, Math.round(value)));
  }

  function cacheTtlDays() {
    const value = Number(state.settings?.cacheTtlDays) || DEFAULT_CACHE_TTL_DAYS;
    return Math.max(1, Math.min(3650, Math.round(value)));
  }

  function cacheTtlMs() {
    return cacheTtlDays() * 86400000;
  }

  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function cacheRecordBytes(record) {
    try {
      return new Blob([JSON.stringify(record)]).size;
    } catch (_) {
      return 0;
    }
  }

  function legacyWordCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(WORD_CACHE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function persistFallbackWordCache() {
    const entries = [...wordCache.values()]
      .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
      .slice(0, cacheMax());
    try {
      localStorage.setItem(WORD_CACHE_KEY, JSON.stringify(Object.fromEntries(entries.map((item) => [item.key, item]))));
    } catch (_) {
      try { localStorage.removeItem(WORD_CACHE_KEY); } catch (_) { /* no-op */ }
    }
  }

  async function initWordStore() {
    if (!window.idb?.openDB || !("indexedDB" in window)) {
      wordStoreFallback = true;
      const legacy = legacyWordCache();
      for (const [key, hit] of Object.entries(legacy)) {
        if (hit?.data) wordCache.set(normalizeWord(key), { ...hit, key: normalizeWord(key) });
      }
      return;
    }
    try {
      wordDb = await window.idb.openDB(WORD_DB_NAME, 2, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(WORD_DB_STORE)) {
            db.createObjectStore(WORD_DB_STORE, { keyPath: "key" });
          }
          if (!db.objectStoreNames.contains(SENTENCE_DB_STORE)) {
            db.createObjectStore(SENTENCE_DB_STORE, { keyPath: "key" });
          }
        }
      });
      const entries = await wordDb.getAll(WORD_DB_STORE);
      for (const entry of entries) {
        if (entry?.key && entry?.data) wordCache.set(entry.key, entry);
      }
      try {
        const storedSentences = await wordDb.getAll(SENTENCE_DB_STORE);
        for (const record of storedSentences) {
          if (record?.key && record?.data) sentenceCache.set(record.key, record);
        }
      } catch (_) { /* older databases may not have the store yet */ }
      const legacy = legacyWordCache();
      let migrated = 0;
      for (const [key, hit] of Object.entries(legacy)) {
        const normalized = normalizeWord(key);
        if (!hit?.data || wordCache.has(normalized)) continue;
        const record = {
          key: normalized,
          at: Number(hit.at) || Date.now(),
          detail: hit.detail || "standard",
          data: hit.data
        };
        wordCache.set(normalized, record);
        await wordDb.put(WORD_DB_STORE, record);
        migrated += 1;
      }
      if (migrated) {
        try { localStorage.removeItem(WORD_CACHE_KEY); } catch (_) { /* no-op */ }
      }
      await pruneWordCache();
    } catch (error) {
      console.warn("IndexedDB word store unavailable; using localStorage fallback.", error);
      wordStoreFallback = true;
      const legacy = legacyWordCache();
      for (const [key, hit] of Object.entries(legacy)) {
        if (hit?.data) wordCache.set(normalizeWord(key), { ...hit, key: normalizeWord(key) });
      }
    }
  }

  async function removeWordRecord(key) {
    wordCache.delete(key);
    if (wordDb) {
      try { await wordDb.delete(WORD_DB_STORE, key); } catch (_) { /* no-op */ }
    } else if (wordStoreFallback) {
      persistFallbackWordCache();
    }
  }

  async function deleteWordCacheFor(word) {
    const target = normalizeWord(word);
    if (!target) return 0;
    const keys = [...wordCache.entries()]
      .filter(([key, record]) => key === target || normalizeWord(record?.data?.word) === target)
      .map(([key]) => key);
    for (const key of keys) await removeWordRecord(key);
    refreshCacheBorders();
    if ($("#cache-dashboard")) void renderCacheContent();
    return keys.length;
  }

  async function pruneWordCache() {
    const now = Date.now();
    const entries = [...wordCache.entries()].sort((a, b) => Number(b[1].at || 0) - Number(a[1].at || 0));
    for (const [key, entry] of entries) {
      if (now - Number(entry.at || 0) > cacheTtlMs()) await removeWordRecord(key);
    }
    for (const [key] of entries.slice(cacheMax())) {
      if (wordCache.has(key)) await removeWordRecord(key);
    }
  }

  async function sentenceKey(text, level, detail) {
    const raw = `${String(text).trim()}|${level}|${detail}|${uiLang()}`;
    try {
      const buffer = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch (_) {
      return `k-${raw.length}-${raw.slice(0, 40).replace(/\s+/g, "_")}`;
    }
  }

  function cacheGetSentence(key) {
    const record = sentenceCache.get(key);
    if (!record || !(record.schema >= 1)) return null;
    if (Date.now() - Number(record.savedAt || 0) > cacheTtlMs()) {
      removeSentenceRecord(key);
      return null;
    }
    return record.data || null;
  }

  function cachePutSentence(key, data, level, detail) {
    const record = { key, schema: SENTENCE_CACHE_SCHEMA, savedAt: Date.now(), level, detail, data };
    sentenceCache.set(key, record);
    if (wordDb) {
      wordDb.put(SENTENCE_DB_STORE, record).catch(() => {});
    }
    if (sentenceCache.size > SENTENCE_LIMIT) {
      const ordered = [...sentenceCache.values()].sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
      ordered.slice(0, sentenceCache.size - SENTENCE_LIMIT).forEach((entry) => {
        sentenceCache.delete(entry.key);
        if (wordDb) wordDb.delete(SENTENCE_DB_STORE, entry.key).catch(() => {});
      });
    }
  }

  function removeSentenceRecord(key) {
    if (!key) return;
    sentenceCache.delete(key);
    if (wordDb) wordDb.delete(SENTENCE_DB_STORE, key).catch(() => {});
  }

  function clearSentenceCache() {
    sentenceCache.clear();
    if (wordDb) wordDb.clear(SENTENCE_DB_STORE).catch(() => {});
  }

  function cacheGetWord(word, detail = state.settings?.detailLevel || "standard") {
    const key = normalizeWord(word) + langSuffix();
    const hit = wordCache.get(key);
    if (!hit || !hit.data) return null;
    if (Number(hit.schema || 0) < WORD_CACHE_MIN_SCHEMA) {
      void removeWordRecord(key);
      return null;
    }
    // Detail is metadata only. A cached word is reusable across fast/standard/deep;
    // the user can explicitly regenerate if a different depth is desired.
    if (Date.now() - Number(hit.at || 0) > cacheTtlMs()) {
      void removeWordRecord(key);
      return null;
    }
    if (hit.data?.word && isHallucinatedWord(hit.data.word, word)) {
      void removeWordRecord(key);
      return null;
    }
    return { ...hit.data, gen: hit.gen || hit.data.gen || null, cached: true };
  }

  function cacheGetChunk(query) {
    const key = chunkCacheKey(query);
    const hit = wordCache.get(key);
    if (!hit?.data || hit.data.kind !== "chunk") return null;
    if (Date.now() - Number(hit.at || 0) > cacheTtlMs()) {
      void removeWordRecord(key);
      return null;
    }
    return { ...ensureChunk(hit.data), cached: true };
  }

  async function pruneChunkCache() {
    const chunks = [...wordCache.entries()]
      .filter(([key]) => key.startsWith(CHUNK_CACHE_PREFIX))
      .sort((a, b) => Number(b[1].at || 0) - Number(a[1].at || 0));
    for (const [key] of chunks.slice(CHUNK_CACHE_LIMIT)) {
      if (wordCache.has(key)) await removeWordRecord(key);
    }
  }

  function cachePutChunk(query, data, detail = state.settings?.detailLevel || "standard") {
    const key = chunkCacheKey(query);
    if (!chunkCacheKey(query) || !data) return;
    const record = { key, at: Date.now(), detail, schema: WORD_CACHE_SCHEMA, data: { ...data, kind: "chunk" } };
    wordCache.set(key, record);
    if (wordDb) {
      wordDb.put(WORD_DB_STORE, record).catch((error) => {
        console.warn("Could not write chunk cache to IndexedDB.", error);
      });
    } else if (wordStoreFallback) {
      persistFallbackWordCache();
    }
    void pruneChunkCache();
  }

  function loadReverseStore() {
    try {
      const raw = localStorage.getItem(REVERSE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const now = Date.now();
      const entries = Object.entries(parsed)
        .filter(([, entry]) => entry?.result && now - Number(entry.at || 0) <= REVERSE_TTL)
        .sort((a, b) => Number(b[1].at || 0) - Number(a[1].at || 0))
        .slice(0, REVERSE_LIMIT);
      return Object.fromEntries(entries);
    } catch (_) {
      return {};
    }
  }

  function saveReverseStore() {
    const entries = Object.entries(reverseStore || {})
      .sort((a, b) => Number(b[1].at || 0) - Number(a[1].at || 0))
      .slice(0, REVERSE_LIMIT);
    try {
      localStorage.setItem(REVERSE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch (_) {
      /* storage may be full or blocked */
    }
  }

  const reverseStore = loadReverseStore();

  function cachePutReverse(id, text, data) {
    reverseStore[id] = { at: Date.now(), text, result: data };
    saveReverseStore();
  }

  function cachePutWord(word, data, detail = state.settings?.detailLevel || "standard", gen = null) {
    const key = normalizeWord(word) + langSuffix();
    if (!key || !data) return;
    const { context, ...clean } = data;
    const record = { key, at: Date.now(), detail, schema: WORD_CACHE_SCHEMA, gen: gen || data.gen || null, data: clean };
    wordCache.set(key, record);
    if (wordDb) {
      wordDb.put(WORD_DB_STORE, record).catch((error) => {
        console.warn("Could not write word cache to IndexedDB.", error);
      });
    } else if (wordStoreFallback) {
      persistFallbackWordCache();
    }
    void pruneWordCache();
  }

  async function clearWordStore() {
    wordCache.clear();
    if (wordDb) {
      try { await wordDb.clear(WORD_DB_STORE); } catch (_) { /* no-op */ }
    }
    try { localStorage.removeItem(WORD_CACHE_KEY); } catch (_) { /* no-op */ }
  }

  function exportWordCache() {
    const now = Date.now();
    const entries = [...wordCache.values()]
      .filter((entry) => entry?.key && entry?.data && now - Number(entry.at || 0) <= cacheTtlMs())
      .sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
    if (!entries.length) {
      toast("还没有可导出的词条缓存");
      return;
    }
    const payload = {
      app: "talk.",
      format: "talk.word-cache",
      version: 1,
      exportedAt: new Date().toISOString(),
      entries
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `talk-word-cache-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`已导出 ${entries.length} 个词条`);
  }

  async function importWordCache(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) throw new Error("缓存文件超过 8MB");
    const text = await file.text();
    const parsed = JSON.parse(text);
    const entries = Array.isArray(parsed) ? parsed : parsed?.entries;
    if (!Array.isArray(entries)) throw new Error("不是有效的 Talk 缓存文件");
    let count = 0;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const data = entry.data && typeof entry.data === "object" ? entry.data : null;
      if (!data) continue;
      const key = normalizeWord(entry.key || data.word || "");
      if (!key || !data.word) continue;
      const record = {
        key,
        at: Number(entry.at) || Date.now(),
        detail: entry.detail || "standard",
        schema: Number(entry.schema) >= WORD_CACHE_MIN_SCHEMA ? Number(entry.schema) : WORD_CACHE_MIN_SCHEMA,
        data
      };
      wordCache.set(key, record);
      if (wordDb) await wordDb.put(WORD_DB_STORE, record);
      count += 1;
    }
    if (!count) throw new Error("文件里没有可导入的词条");
    await pruneWordCache();
    if (wordStoreFallback) persistFallbackWordCache();
    refreshCacheBorders();
    return count;
  }

  function wordCacheStats() {
    const now = Date.now();
    const entries = [...wordCache.values()]
      .filter((entry) => entry?.key && entry?.data && now - Number(entry.at || 0) <= cacheTtlMs())
      .sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
    return {
      count: entries.length,
      max: cacheMax(),
      ttlDays: cacheTtlDays(),
      bytes: entries.reduce((sum, entry) => sum + cacheRecordBytes(entry), 0),
      backend: wordDb ? "IndexedDB" : "localStorage",
      fallback: wordStoreFallback,
      entries: entries.map((entry) => ({
        key: entry.key,
        word: entry.data.word || entry.key,
        detail: entry.detail || "standard",
        at: Number(entry.at) || 0,
        bytes: cacheRecordBytes(entry)
      }))
    };
  }

  function wordCacheEstimate() {
    const stats = wordCacheStats();
    const average = stats.count ? stats.bytes / stats.count : 2600;
    const bytes = Math.round(average * stats.max);
    return { average, bytes, label: formatBytes(bytes) };
  }

  function lookupWordDeduped(word, options = {}) {
    const key = normalizeWord(word);
    const cached = cacheGetWord(key);
    if (cached) return Promise.resolve({ type: "word", data: cached });
    if (options.onPreview) {
      const listeners = wordPreviewListeners.get(key) || new Set();
      listeners.add(options.onPreview);
      wordPreviewListeners.set(key, listeners);
    }
    if (wordRequests.has(key)) return wordRequests.get(key);
    const listeners = wordPreviewListeners.get(key) || new Set();
    const request = modelLookup(key, "word", state.settings, {
      onPreview: (preview) => listeners.forEach((listener) => {
        try { listener(preview); } catch (_) { /* preview is best-effort */ }
      })
    }).finally(() => {
      wordRequests.delete(key);
      wordPreviewListeners.delete(key);
    });
    wordRequests.set(key, request);
    return request;
  }

  function isWordCached(word) {
    const key = normalizeWord(word);
    return Boolean(key) && (Boolean(DATA.words[key]) || Boolean(cacheGetWord(key)));
  }

  function applyCacheDisplay() {
    if (!app) return;
    app.classList.toggle("cache-display-borders", state.settings.cacheDisplay !== "corner");
    if (state.settings.cacheDisplay === "corner") return;
    if (cacheCorner) cacheCorner.hidden = true;
  }

  function refreshCacheBorders(root = document) {
    $$('[data-cache-word]', root).forEach((element) => {
      const cached = isWordCached(element.dataset.cacheWord);
      element.classList.toggle("is-cache-ready", cached);
      element.classList.toggle("is-cache-pending", !cached);
      element.dataset.cacheState = cached ? "cached" : "pending";
    });
  }

  function prefetchPlan(data) {
    if (!data) return { all: [], fresh: [] };
    const all = uniqueWords([
      ...(data.family || []),
      ...(data.synonyms || []),
      ...(data.antonyms || []),
      ...(data.related || [])
    ], data.word);
    const fresh = all.filter((word) => {
      const key = normalizeWord(word);
      return Boolean(key) && !DATA.words[key] && !cacheGetWord(key);
    });
    return { all, fresh };
  }

  function updateCacheCorner(filled, label) {
    if (!cacheCorner) return;
    if (state.settings.cacheDisplay !== "corner") {
      cacheCorner.hidden = true;
      cacheCorner.dataset.label = label;
      return;
    }
    cacheCorner.hidden = false;
    cacheCorner.dataset.state = filled ? "filled" : "hollow";
    cacheCorner.dataset.label = label;
    cacheCorner.classList.toggle("is-filled", filled);
    cacheCorner.classList.toggle("is-hollow", !filled);
    cacheCorner.title = label;
    cacheCorner.setAttribute("aria-label", `缓存状态：${label}`);
  }

  function hideCacheCorner() {
    if (!cacheCorner) return;
    cacheCorner.hidden = true;
    cacheCorner.dataset.label = "";
  }

  function cachedRelatedCount(plan) {
    return plan.all.filter((word) => {
      const key = normalizeWord(word);
      return Boolean(key) && (Boolean(DATA.words[key]) || Boolean(cacheGetWord(key)));
    }).length;
  }

  function schedulePrefetch(data) {
    if (!data) {
      hideCacheCorner();
      return;
    }
    const plan = prefetchPlan(data);
    const total = plan.all.length;
    if (!total) {
      hideCacheCorner();
      return;
    }
    const cached = cachedRelatedCount(plan);
    const token = ++prefetchToken;

    if (!plan.fresh.length) {
      updateCacheCorner(true, `本页 ${total} 个相关词已缓存`);
      return;
    }

    if (!hasModelConfig() || !state.settings.prefetch) {
      updateCacheCorner(
        false,
        !hasModelConfig()
          ? "连接模型后可预加载相关词"
          : `预加载已关闭 · ${cached}/${total} 个相关词已缓存`
      );
      return;
    }

    updateCacheCorner(false, `正在预加载 ${cached}/${total} 个相关词`);
    window.setTimeout(() => {
      if (token === prefetchToken) void runPrefetch(plan, token);
    }, 900);
  }

  async function runPrefetch(plan, token) {
    const queue = [...plan.fresh].slice(0, PREFETCH_LIMIT);
    const worker = async () => {
      while (queue.length) {
        if (token !== prefetchToken || !state.settings.prefetch) return;
        const word = queue.shift();
        const key = normalizeWord(word);
        if (!key || DATA.words[key] || cacheGetWord(key)) continue;
        try {
          await lookupWordDeduped(key);
        } catch (_) {
          // Prefetch is best-effort; never interrupt the reading flow.
        }
        refreshCacheBorders();
        if (token === prefetchToken) {
          const cached = cachedRelatedCount(plan);
          const total = plan.all.length;
          if (cached >= total) {
            updateCacheCorner(true, `本页 ${total} 个相关词已缓存`);
          } else {
            updateCacheCorner(false, `正在预加载 ${cached}/${total} 个相关词`);
          }
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (token !== prefetchToken) return;
    const cached = cachedRelatedCount(plan);
    const total = plan.all.length;
    if (cached >= total) {
      updateCacheCorner(true, `本页 ${total} 个相关词已缓存`);
    } else {
      updateCacheCorner(false, `预加载未完成 · ${cached}/${total} 个相关词已缓存`);
    }
  }

  function hasModelConfig(cfg = state.settings) {
    const key = String(cfg.apiKey || "").trim();
    const base = String(cfg.baseUrl || "").trim();
    return Boolean(base) && (Boolean(key) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(base));
  }

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

  function setOnionOpen(slot, open) {
    if (!slot) return;
    slot.classList.toggle("is-open", open);
    const mark = slot.querySelector(":scope > .onion-mark");
    if (mark) {
      mark.textContent = open ? "−" : "+";
      mark.setAttribute("aria-expanded", open ? "true" : "false");
    }
  }

  function refreshThemedPage() {
    if (!screen || !state.route || state.route.name === "loading") return;
    const html = pageHtml(state.route);
    if (!html) return;
    screen.innerHTML = html;
    enhanceWordColumns(screen);
    applyCacheDisplay();
    refreshCacheBorders();
    updateModuleBar();
    applyContentCopy();
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
     Theme example backfill
     ============================================================ */

  const examplesInFlight = new Set();
  const THEME_EXAMPLE_LIMIT = 8;

  function scheduleThemeExamples(word) {
    if (!word || !hasModelConfig()) return;
    const activeTheme = window.TALK_THEME?.current?.();
    const missing = themesMissingExamples(word).filter((id) => !activeTheme || id === activeTheme.id);
    if (!missing.length) return;
    const key = normalizeWord(word.word);
    if (!key || examplesInFlight.has(key)) return;
    examplesInFlight.add(key);
    fillThemeExamples(word, missing)
      .catch(() => { /* keep the old examples; try again on a later visit */ })
      .finally(() => examplesInFlight.delete(key));
  }

  async function fillThemeExamples(word, missing) {
    const themes = missing.slice(0, THEME_EXAMPLE_LIMIT).map((id) => ({ id, style: exampleStyleFor(id) }));
    if (!themes.length) return;
    const payload = {
      task: "themes",
      word: word.word,
      pos: word.pos,
      short: word.short,
      senses: (word.senses || []).slice(0, 3).map((sense) => sense.zh || sense.en).filter(Boolean),
      existing: (word.examples || []).map((item) => item.en).filter(Boolean).slice(0, 6),
      themes
    };
    const data = await LLM.requestJson({
      settings: state.settings,
      system: window.TALK_PROMPTS.examples,
      user: payload,
      maxTokens: 900,
      timeoutMs: 45_000,
      label: "主题例句补全",
      disableThinking: true,
      temperature: 0.3,
      retries: 0
    });
    const fresh = normalizeExamplesByTheme(data.examplesByTheme || data.examples_by_theme || data);
    if (!fresh) return;
    const merged = normalizeExamplesByTheme({ ...(word.examplesByTheme || {}), ...fresh });
    if (!merged) return;
    word.examplesByTheme = merged;
    const cached = cacheGetWord(word.word);
    if (cached) {
      cached.examplesByTheme = merged;
      // Keep the original receipt: refilling examples must not erase when,
      // by which model, or for how many tokens the entry was written.
      cachePutWord(normalizeWord(word.word), cached, state.settings.detailLevel || "standard", cached.gen || null);
    }
    updateExamplesBlock(word);
  }

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

  const STAGGER_MS = 55;
  let revealMode = "normal";
  let revealWatcher = null;

  function setRevealMode(mode) {
    revealMode = mode;
  }

  function observeReveals(scope) {
    if (!revealObserver) return;
    const root = scope || screen;
    if (!root) return;
    // Nested .reveal nodes ride along with their section (CSS handles it).
    root.querySelectorAll(".reveal").forEach((element) => {
      if (element.parentElement?.closest(".reveal")) element.classList.add("is-in");
    });
    const viewport = window.innerHeight || 800;
    let order = 0;
    root.querySelectorAll(".reveal:not(.is-in)").forEach((element) => {
      if (element.parentElement?.closest(".reveal")) return;
      const rect = element.getBoundingClientRect();
      const mode = revealMode;
      // A route that lands on top of an existing screen does not need to push
      // in: the top band is simply there.
      if ((mode === "instant-home" || mode === "instant-top") && rect.top < (mode === "instant-home" ? viewport * 0.92 : 220)) {
        element.style.transition = "none";
        element.classList.add("is-in");
        window.requestAnimationFrame(() => { element.style.transition = ""; });
        return;
      }
      // Content that replaces a skeleton fades in without scale, so the grey
      // blocks never appear to morph into text.
      if (mode === "soft" && rect.top < viewport * 0.92) {
        element.classList.add("reveal-soft");
        const delay = order * 40;
        order += 1;
        window.setTimeout(() => {
          if (element.classList.contains("is-in")) return;
          element.style.transitionDelay = "0ms";
          element.classList.add("is-in");
        }, delay);
        return;
      }
      // Anything already on the first screen cascades top-to-bottom, one beat
      // after another; everything below waits for the observer.
      if (rect.top < viewport * 0.92) {
        const delay = order * STAGGER_MS;
        order += 1;
        window.setTimeout(() => {
          if (element.classList.contains("is-in")) return;
          element.style.transitionDelay = "0ms";
          element.classList.add("is-in");
        }, delay);
      } else {
        revealObserver.observe(element);
      }
    });
    root.querySelectorAll(".reveal-item:not(.is-in)").forEach((element) => {
      revealObserver.observe(element);
    });
    revealMode = "normal";
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
            node.nodeType === 1 && (node.matches?.(".reveal, .reveal-item") || node.querySelector?.(".reveal, .reveal-item"))));
        if (!fresh) return;
        window.requestAnimationFrame(() => observeReveals(document));
      });
      revealWatcher.observe(document.body, { childList: true, subtree: true });
    }
  }

  function queueReveal(scope) {
    if (!revealObserver) return;
    const target = scope || screen;
    window.requestAnimationFrame(() => observeReveals(target));
  }

  function renderRoute(route, direction = "forward", { instant = false } = {}) {
    if (route.name === "home" && revealMode === "normal") setRevealMode("instant-home");
    const apply = () => {
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
      queueReveal(screen);
      if (route.name === "word") {
        const word = getWord(route);
        if (word) {
          schedulePrefetch(word);
          scheduleThemeExamples(word);
        }
      } else {
        prefetchToken += 1;
        hideCacheCorner();
      }
      scrollScreenTo(0, true);
      resizeSmoothScroll();
      screen.classList.remove("is-leaving", "is-back-leaving", "is-entering");
      void screen.offsetWidth;
      screen.classList.add("is-entering");
      window.setTimeout(() => screen.classList.remove("is-entering"), 1300);
      document.title = pageTitle(route);
      window.TALK_I18N?.apply(document.body);
      if (route.name === "reverse" && Number.isFinite(state.restoreScroll) && state.restoreScroll >= 0) {
        const target = state.restoreScroll;
        state.restoreScroll = -1;
        window.requestAnimationFrame(() => { screen.scrollTop = target; });
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

    if (!instant && !reduceMotion && document.startViewTransition) {
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
        const transition = document.startViewTransition(apply);
        activeViewTransition = transition;
        transition.finished.catch(() => {}).finally(() => { activeViewTransition = null; });
        return;
      } catch (_) {
        /* Fall through to the static render. */
      }
    }

    if (!instant && !reduceMotion && !document.startViewTransition) {
      screen.classList.add(direction === "back" ? "is-back-leaving" : "is-leaving");
      window.setTimeout(apply, 150);
      return;
    }

    apply();
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

  function getReverse(route) {
    if (route?.result) return route.result;
    const entry = reverseStore[idSafe(route?.id)];
    return entry?.result || null;
  }

  function idSafe(value) {
    return String(value || "").replace(/[^a-z0-9]/gi, "").slice(0, 24);
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
     Top bar
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


  function backTopbar({ label, title, bookmark = null, share = false, actions = "" }) {
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
          ${actions}
          <button class="icon-btn" type="button" data-action="settings" aria-label="连接模型" title="连接模型">${icon("settings")}</button>
        </div>
      </header>`;
  }

  function layerTopbar({ label, title, bookmark = null, origin = "", relation = "", depth = 1 }) {
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
     Home
     ============================================================ */

  function dayNumber(date = new Date()) {
    const start = new Date(date.getFullYear(), 0, 0);
    return Math.floor((date - start) / 86400000);
  }

  function dailyEntry() {
    const keys = Array.isArray(DATA.dailyWords) && DATA.dailyWords.length
      ? DATA.dailyWords
      : Object.keys(DATA.words);
    const key = keys[dayNumber() % keys.length];
    return DATA.words[key] || DATA.words[keys[0]] || null;
  }

  function visibleMoods() {
    const pool = Array.isArray(DATA.moods) ? DATA.moods : [];
    if (!pool.length) return [];
    const count = Math.min(3, pool.length);
    const start = (dayNumber() + state.moodOffset) % pool.length;
    return Array.from({ length: count }, (_, index) => pool[(start + index) % pool.length]);
  }

  function moodCardsMarkup(moods) {
    return moods.map((mood) => `
      <button class="mood-card ${mood.tone}" type="button" data-action="word" data-word="${attr(mood.target)}" aria-label="探索${attr(mood.title)}">
        <span class="mood-kicker"><span>${esc(mood.kicker)}</span><span>↗</span></span>
        <strong class="mood-title">${esc(mood.title)}</strong>
        <span class="mood-words">${esc(mood.words)}</span>
      </button>`).join("");
  }

  function renderMoods() {
    const container = $("#mood-scroll");
    if (!container) return;
    const moods = visibleMoods();
    container.innerHTML = moodCardsMarkup(moods);
    const count = $("#mood-count");
    if (count) count.textContent = `${String(moods.length).padStart(2, "0")} 组词单`;
    container.classList.remove("is-swapping");
    void container.offsetWidth;
    container.classList.add("is-swapping");
  }

  /* Phones pick a keyboard from inputmode. A word search wants a Latin
     keyboard; translating from Chinese wants the Chinese one. Keep this in one
     place so a future language pair only needs a mapping entry. */
  function inputModeFor(lang) {
    if (lang === "zh") return { inputmode: "text", lang: "zh-CN", autocapitalize: "off" };
    return { inputmode: "latin", lang: "en", autocapitalize: "none" };
  }

  function applyInputMode(target, lang) {
    if (!target) return;
    const mode = inputModeFor(lang);
    target.setAttribute("inputmode", mode.inputmode);
    target.setAttribute("lang", mode.lang);
    target.setAttribute("autocapitalize", mode.autocapitalize);
  }

  function homePage() {
    const dictionaryHistory = state.history.filter((item) => item.type !== "translation");
    const recent = dictionaryHistory.length ? dictionaryHistory.slice(0, 3) : sanitizeHistory(DATA.recent);
    const daily = dailyEntry();
    const moods = visibleMoods();
    const copy = copyFor("home");
    const registerLabels = { common: "日常", formal: "正式", literary: "文学", informal: "口语", technical: "技术" };
    const dailyKicker = daily ? `${String(dayNumber()).padStart(3, "0")} · ${registerLabels[daily.register] || "每日"}` : "每日";
    return `
      ${homeTopbar()}
      <section class="home-hero">
        <div class="eyebrow reveal" style="--d:0"><span class="spark"></span>${esc(copy.eyebrow)}</div>
        <h1 class="home-title reveal" style="--d:0.5">${esc(copy.titleLead)}<em>${esc(copy.titleAccent)}</em></h1>
        <p class="home-lede reveal" style="--d:1">${copy.lede}</p>
      </section>
      ${copy.manifesto ? `<div class="theme-manifesto reveal" style="--d:1.2"><span class="manifesto-ru">${esc(copy.manifesto.ru)}</span><span class="manifesto-zh">${esc(copy.manifesto.zh)}</span></div>` : ""}

      <div class="search-wrap reveal" style="--d:1.5">
        <form class="search-card" id="search-form" novalidate>
          <div class="search-top">
            <span class="mono">${esc(copy.searchKicker)}</span>
            <div class="mode-switch" role="group" aria-label="查询模式">
              <button class="mode-btn ${state.mode === "auto" ? "active" : ""}" type="button" data-action="mode" data-mode="auto" aria-pressed="${state.mode === "auto"}">${esc(copy.modes.auto)}</button>
              <button class="mode-btn ${state.mode === "word" ? "active" : ""}" type="button" data-action="mode" data-mode="word" aria-pressed="${state.mode === "word"}">${esc(copy.modes.word)}</button>
              <button class="mode-btn ${state.mode === "chunk" ? "active" : ""}" type="button" data-action="mode" data-mode="chunk" aria-pressed="${state.mode === "chunk"}">${esc(copy.modes.chunk || "意群")}</button>
              <button class="mode-btn ${state.mode === "sentence" ? "active" : ""}" type="button" data-action="mode" data-mode="sentence" aria-pressed="${state.mode === "sentence"}">${esc(copy.modes.sentence)}</button>
            </div>
          </div>
          <div class="search-row">
            <textarea class="search-input" id="search-input" rows="1" placeholder="${attr(copy.searchPlaceholder)}" aria-label="单词或句子" spellcheck="false"></textarea>
            <button class="search-submit" type="submit" aria-label="查询">${icon("arrowUpRight")}</button>
          </div>
          <div class="search-bottom">
            <span class="detected"><i></i><span id="detect-label">自动 · 单词</span></span>
            <span class="search-kbd"><span>↵</span> to search</span>
          </div>
        </form>
        <div class="recent-row" aria-label="最近查询">
          <span class="recent-label">${esc(copy.recentLabel)}</span>
          ${recent.map((item) => `
            <button class="chip" type="button" data-action="lookup" data-query="${attr(item.query)}" data-type="${attr(item.type)}">
              ${item.type === "sentence" ? `<span class="quote-dot"></span>` : ""}
              ${esc(shorten(item.query, 34))}
            </button>`).join("")}
        </div>
      </div>

      <section class="section daily-section reveal" style="--d:2">
        <div class="section-head">
          <div>
            <span class="section-kicker">${esc(copy.dailySectionKicker)}</span>
            <h2>${esc(copy.dailySectionTitle)}</h2>
          </div>
          <span class="side-note">N° ${String(dayNumber()).padStart(3, "0")}</span>
        </div>
        ${daily ? `<button class="daily" type="button" data-action="word" data-word="${attr(daily.word)}" aria-label="打开 ${attr(daily.word)}">
          <div class="daily-top">
            <span class="mono">${esc(dailyKicker)}</span>
            <span class="daily-badge"><i></i>今日词条</span>
          </div>
          <div class="daily-main">
            <p class="daily-word">${esc(daily.word)}</p>
            <div class="daily-phonetic">${esc(daily.phonetic || "")} · ${esc(posLabel(daily.pos))}</div>
          </div>
          <div class="daily-bottom">
            <p class="daily-meaning">${esc(daily.translation || daily.short || "")}</p>
            <span class="daily-arrow">${icon("arrowUpRight")}</span>
          </div>
        </button>` : ""}
      </section>

      <section class="section theme-salon reveal" id="theme-salon" style="--d:2.5">
        ${themeSalonMarkup(currentThemeDeck())}
      </section>

      <footer class="home-footer">
        <span>${esc(copy.footerLeft)}</span><i></i><span>${esc(copy.footerRight)}</span>
      </footer>`;
  }

  /* ============================================================
     Theme-aware examples
     ============================================================ */

  function themeIds() {
    const list = window.TALK_THEME?.list?.() || [];
    return list.map((theme) => theme.id);
  }

  function exampleStyleOverrides() {
    try {
      const parsed = JSON.parse(localStorage.getItem(EXAMPLE_STYLE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function exampleStyleFor(themeId) {
    const overrides = exampleStyleOverrides();
    const own = String(overrides[themeId] || "").trim();
    if (own) return own;
    const meta = window.TALK_THEME?.metaOf?.(themeId);
    const registered = String(meta?.exampleStyle || "").trim();
    return registered || "自然、日常的英语，句子短，适合记忆";
  }

  function saveExampleStyles(next) {
    try { localStorage.setItem(EXAMPLE_STYLE_KEY, JSON.stringify(next || {})); } catch (_) { /* no-op */ }
  }

  function exampleForTheme(word, themeId = window.TALK_THEME?.current?.().id) {
    if (!word) return [];
    const themed = word.examplesByTheme?.[themeId];
    if (Array.isArray(themed) && themed.length) return themed;
    return word.examples || [];
  }

  function themesMissingExamples(word) {
    if (!word) return [];
    return themeIds().filter((id) => !(word.examplesByTheme?.[id] || []).length);
  }

  function sentenceLevelOf(value) {
    return SENTENCE_LEVELS.find((level) => level.id === value) || SENTENCE_LEVELS.find((level) => level.id === SENTENCE_LEVEL_DEFAULT);
  }

  /* ============================================================
     Search & API
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
    {
      navigate({ name: "loading", query, type }, { instant: true });
      startLoadingStatus(type);
      loadingTimerId = state.loadingTimer;
    }

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

  /* ============================================================
     Model API
     ============================================================ */

  const WORD_SYSTEM_PROMPT = window.TALK_PROMPTS.word;
  const SENTENCE_SYSTEM_PROMPT = window.TALK_PROMPTS.sentence;
  // Long paragraphs are fine: the request only has to fit the model context.
  const TRANSLATOR_MAX_CHARS = 4000;
  // A sentence to analyse can be a paragraph; the word lookup path stays short.
  const SEARCH_MAX_CHARS = 800;
  const CHUNK_SYSTEM_PROMPT = window.TALK_PROMPTS.chunk;
  const REVERSE_SYSTEM_PROMPT = window.TALK_PROMPTS.reverse;
  const CHUNK_CACHE_PREFIX = "chunk:";
  const CHUNK_CACHE_LIMIT = 60;
  const REVERSE_MAX_SENTENCE_WORDS = 20;

  function reverseBudget() {
    return Math.max(600, Math.min(3000, Number(state.settings?.reverseMaxTokens) || 1500));
  }

  function reverseZoneName(budget = reverseBudget()) {
    if (budget < 1000) return "只给结论";
    if (budget < 2000) return "分块讲解";
    return "成句拆解";
  }

  function reverseStyleName(budget = reverseBudget()) {
    if (window.TALK_PROMPTS.reverseFor) return window.TALK_PROMPTS.reverseFor(budget);
    return "editor";
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

  function systemPrompt(type, reverseStyle = "") {
    let base = WORD_SYSTEM_PROMPT;
    if (type === "sentence") base = SENTENCE_SYSTEM_PROMPT;
    else if (type === "chunk") base = CHUNK_SYSTEM_PROMPT;
    else if (type === "reverse") {
      const prompts = window.TALK_PROMPTS.reversePrompts;
      base = (reverseStyle && prompts?.[reverseStyle]) || REVERSE_SYSTEM_PROMPT;
    }
    return base + englishDirective();
  }

  function themeBriefs() {
    return (window.TALK_THEME?.list?.() || []).map((theme) => ({
      id: theme.id,
      style: exampleStyleFor(theme.id)
    }));
  }

  function wordPrompt(query, detail = "standard") {
    // Dynamic query is deliberately last so the static system prefix and the
    // task/detail prefix can be reused by provider prompt caches.
    return JSON.stringify({
      task: "word",
      query: String(query),
      themes: themeBriefs().filter((theme) => {
        const active = window.TALK_THEME?.current?.();
        return !active || theme.id === active.id;
      })
    });
  }

  function chunkPrompt(query, detail = "standard") {
    return JSON.stringify({ task: "chunk", detail, query: String(query) });
  }

  function reversePrompt(text) {
    return String(text || "").trim();
  }

  function sentencePrompt(query, detail = "standard", pieces = []) {
    const level = sentenceLevelOf(state.settings?.sentenceLevel);
    const sentences = pieces.length ? pieces.map((text, index) => ({ index, text })) : undefined;
    return JSON.stringify({
      task: "sentence",
      detail,
      level: level.id,
      maxKeyWords: level.maxKeyWords,
      levelHint: level.hint,
      length: SENTENCE_DEPTH_BRIEF[detail] || SENTENCE_DEPTH_BRIEF.standard,
      text: String(query),
      ...(sentences ? { sentences } : {})
    });
  }

  async function modelLookup(query, type, cfg, options = {}) {
    const resolvedCfg = LLM.resolveConfig(cfg);
    const detail = resolvedCfg.detailLevel || "standard";
    if (type === "word") {
      const cached = cacheGetWord(query, detail);
      if (cached) return { type: "word", data: cached };
    }
    if (type === "chunk" && !options.skipCache) {
      const cached = cacheGetChunk(query);
      if (cached) return { type: "chunk", data: cached };
    }
    if (type === "reverse" && !options.skipCache && !(options.history || []).length) {
      const cached = cacheGetReverseFirst(query);
      if (cached?.content) {
        return { type: "reverse", data: { id: reverseIdFor(query), text: query, narrative: cached.content, reasoning: cached.reasoning || "" } };
      }
    }
    const pieces = type === "sentence" ? splitSentences(query) : [];
    const sentenceCacheKey = type === "sentence"
      ? await sentenceKey(query, sentenceLevelOf(resolvedCfg.sentenceLevel).id, detail)
      : "";
    if (type === "sentence" && !options.skipCache) {
      const cached = cacheGetSentence(sentenceCacheKey);
      if (cached) {
        diagLog("info", "sentence.cache", "hit", { chars: String(query).length });
        return { type: "sentence", data: cached };
      }
    }
    // Validate base URL / key upfront before arming timers.
    LLM.endpointFor(resolvedCfg.baseUrl, resolvedCfg);
    const prompt = type === "sentence"
      ? sentencePrompt(query, detail, pieces)
      : type === "chunk"
        ? chunkPrompt(query, detail)
        : type === "reverse"
          ? reversePrompt(query, detail)
          : wordPrompt(query, detail);
    const history = Array.isArray(options?.history)
      ? options.history
        .filter((turn) => turn && turn.content)
        .map((turn) => ({ role: turn.role === "assistant" ? "assistant" : "user", content: String(turn.content) }))
      : [];
    const messages = [
      { role: "system", content: systemPrompt(type, options.reverseStyle) },
      ...history,
      { role: "user", content: prompt }
    ];
    let controller = new AbortController();
    let timedOut = false;
    let timer = 0;
    const armDeadline = () => {
      window.clearTimeout(timer);
      controller = new AbortController();
      timedOut = false;
      timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, MODEL_TIMEOUT_MS);
    };
    armDeadline();
    const detailTokens = (DETAIL_LEVELS[detail] || DETAIL_LEVELS.standard).maxTokens;
    const wanted = type === "sentence"
      ? Math.max(detailTokens, SENTENCE_MAX_TOKENS[detail] || SENTENCE_MAX_TOKENS.standard)
      : type === "chunk"
        ? Math.max(detailTokens, 2400)
        : type === "reverse"
          ? (Number(options.reverseBudget) || reverseBudget())
          : detailTokens;
    const maxTokens = Math.min(wanted, LLM.outputCeiling(resolvedCfg));
    const temperature = type === "reverse" ? 0.7 : 0.3;
    const isJsonTask = type !== "reverse";
    let content = "";
    let usage = null;
    const addUsage = (u) => {
      if (!u || typeof u !== "object") return;
      const next = {
        prompt: Number(u.prompt_tokens ?? u.promptTokenCount ?? 0) || 0,
        completion: Number(u.completion_tokens ?? u.candidatesTokenCount ?? 0) || 0,
        total: Number(u.total_tokens ?? u.totalTokenCount ?? 0) || 0
      };
      if (!next.total) next.total = next.prompt + next.completion;
      if (!next.total) return;
      usage = usage
        ? { prompt: usage.prompt + next.prompt, completion: usage.completion + next.completion, total: usage.total + next.total }
        : next;
    };
    const startedAt = Date.now();
    state.lastReasoning = "";
    diagLog("info", "model.start", `${type} · ${detail}`, { chars: String(query).length });
    const onBuffered = ({ host, contentType }) => {
      diagLog("info", "stream.buffered", "网关把流式响应缓冲成了整段 JSON", { host, contentType });
      if (!window.__talkStreamWarned) {
        window.__talkStreamWarned = true;
        console.info("Provider returned a buffered JSON response despite stream=true.");
      }
    };
    const streamOnce = (msgs = messages) => LLM.sendChatStream(resolvedCfg, msgs, {
      signal: controller.signal,
      allowJsonMode: false,
      googleJsonMode: isJsonTask,
      maxTokens,
      temperature,
      onDelta: (partial) => {
        if (typeof options.onPreview === "function") {
          try { options.onPreview(streamPreviewFromJson(partial, type, query)); } catch (_) { /* best-effort */ }
        }
      },
      onReasoning: (chunk) => {
        state.lastReasoning = String(state.lastReasoning || "") + chunk;
      },
      onUsage: addUsage,
      onBuffered
    });
    try {
      // Do not combine streaming with response_format by default: some
      // OpenAI-compatible gateways silently return one buffered JSON response
      // when both are present. The static prompt already requires JSON.
      content = await streamOnce();
    } catch (error) {
      diagLog("error", "model.fail", timedOut ? `请求超时（${MODEL_TIMEOUT_MS / 1000} 秒）` : (error?.message || String(error)), { type, detail, ms: Date.now() - startedAt, chars: String(query).length });
      // Mobile networks drop long streams and gateways sometimes cut our
      // deadline. Both are worth one silent retry with a fresh signal.
      const retriable = timedOut || error?.name !== "AbortError" || /不是 JSON|空响应|Failed to fetch|network error/i.test(String(error?.message || ""));
      if (!content && retriable) {
        await wait(timedOut ? 300 : 900);
        armDeadline();
        try {
          content = await streamOnce();
        } catch (retryError) {
          diagLog("error", "model.fail", retryError?.message || String(retryError), { type, detail, ms: Date.now() - startedAt, chars: String(query).length, attempt: 2 });
        }
      }
      // Older/limited gateways may reject streaming. Retry once non-streaming
      // only when no content has been received.
      if (!content && retriable) {
        armDeadline();
        const response = await LLM.sendChat(resolvedCfg, messages, {
          signal: controller.signal,
          allowJsonMode: isJsonTask,
          maxTokens,
          temperature
        });
        if (!response.ok) {
          throw new Error(await LLM.readHttpError(response, 260));
        }
        const json = await LLM.readJsonResponse(response);
        addUsage(json?.usage || json?.usageMetadata);
        content = LLM.extractContent(json, resolvedCfg);
      }
      if (!content) throw timedOut ? new Error(`请求超时（${MODEL_TIMEOUT_MS / 1000} 秒），网关没有返回内容，可以重试或换一个模型。`) : error;
    } finally {
      window.clearTimeout(timer);
    }
    if (!content) {
      diagLog("error", "model.empty", "网关返回了空内容", { type, detail, chars: 0 });
      armDeadline();
      try {
        content = await streamOnce();
      } catch (emptyRetryError) {
        diagLog("error", "model.fail", emptyRetryError?.message || String(emptyRetryError), { type, detail, attempt: 2 });
      } finally {
        window.clearTimeout(timer);
      }
    }
    if (!content) throw new Error("模型返回了空消息。");
    diagLog("info", "model.content", `${type} · ${detail}`, { chars: content.length, ms: Date.now() - startedAt });
    state.lastModelRaw = {
      type,
      detail,
      chars: content.length,
      cut: content.length > 2400,
      text: String(content).slice(0, 2400)
    };

    if (type === "reverse") {
      return { type: "reverse", data: { id: reverseIdFor(query), text: query, narrative: String(content).trim(), reasoning: String(state.lastReasoning || "") } };
    }
    let parsed;
    let retryLength = null;
    const emptyish = content.trim().length < 12;
    try {
      if (emptyish) throw new Error("模型返回的内容过短，可能被网关截断了。");
      parsed = LLM.parseJsonObject(content);
    } catch (parseError) {
      diagLog("error", emptyish ? "model.empty" : "model.parse", parseError?.message || String(parseError), { type, detail, chars: content.length });
      // A truncated answer is the most common cause here: retry once with a
      // larger ceiling instead of showing a raw JSON error to the reader.
      if (!emptyish && !/JSON|Unexpected|Expected|Unterminated/i.test(String(parseError?.message || ""))) throw parseError;
      armDeadline();
      const retryTokens = Math.min(LLM.outputCeiling(resolvedCfg), Math.round(maxTokens * 1.5));
      const retryMessages = messages.concat([{
        role: "user",
        content: '上一次输出不是合法 JSON（常见原因：字符串里出现未转义的双引号或真实换行，或者中途被截断）。请重写：所有字符串内的双引号必须转义，不要输出换行符；保持同样的详细程度，但务必输出完整闭合的 JSON；如果确实太长，只省略 family/synonyms/antonyms 里的嵌套细节，不要删掉义项、句子分析或重点词。'
      }]);
      let retryContent = "";
      try {
        const retry = await LLM.sendChat(resolvedCfg, retryMessages, {
          signal: controller.signal,
          allowJsonMode: true,
          maxTokens: retryTokens,
          temperature
        });
        if (!retry.ok) throw parseError;
        const retryJson = await LLM.readJsonResponse(retry);
        addUsage(retryJson?.usage || retryJson?.usageMetadata);
        retryContent = LLM.extractContent(retryJson, resolvedCfg);
      } finally {
        window.clearTimeout(timer);
      }
      if (!retryContent) throw parseError;
      try {
        parsed = LLM.parseJsonObject(retryContent);
        retryLength = retryContent.length;
        content = retryContent;
      } catch (_) {
        diagLog("error", "model.truncated", "json truncated", { type, detail, chars: retryContent.length, tokens: retryTokens });
        throw new Error(`模型返回的 JSON 被截断（约 ${retryContent.length} 字符），可以重试或把生成深度调到「深入」。`);
      }
    }
    diagLog("info", "model.ok", `${type} · ${detail}`, { chars: content.length, ms: Date.now() - startedAt, retried: retryLength !== null });
    if (type === "chunk") {
      const data = ensureChunk({ ...parsed, chunk: parsed?.chunk || query });
      data.source = "model";
      data.model = resolvedCfg.model;
      cachePutChunk(query, data, detail);
      return { type: "chunk", data };
    }
    if (type === "word") {
      let data = normalizeModelWord(parsed, query);
      if (isHallucinatedWord(data.word, query)) {
        diagLog("warn", "model.wrong-word", `returned "${data.word}" for "${query}", retrying`, { query, got: data.word });
        if (typeof options.onPreview === "function") {
          try { options.onPreview({ kind: "discard", wrongWord: data.word, targetWord: String(query) }); } catch (_) { /* best-effort */ }
        }
        armDeadline();
        try {
          const fixMessages = [
            { role: "system", content: systemPrompt("word") },
            { role: "user", content: `请解释英文词 "${String(query)}"（详细度：${detail}）。注意：JSON 的 word 字段必须是 "${String(query)}"，绝不要把 detail 参数值（如 standard）当成要查的词。` }
          ];
          let fixText = "";
          try {
            fixText = await streamOnce(fixMessages);
          } catch (_) { /* fall back to non-streaming below */ }
          if (!fixText) {
            const fixRes = await LLM.sendChat(resolvedCfg, fixMessages, {
              signal: controller.signal,
              allowJsonMode: true,
              maxTokens,
              temperature
            });
            if (fixRes.ok) {
              const fixJson = await LLM.readJsonResponse(fixRes, "词头纠偏重试");
              addUsage(fixJson?.usage || fixJson?.usageMetadata);
              fixText = LLM.extractContent(fixJson, resolvedCfg);
            }
          }
          if (fixText) {
            const reparsed = LLM.parseJsonObject(fixText);
            const retried = normalizeModelWord(reparsed, query);
            if (!isHallucinatedWord(retried.word, query)) data = retried;
          }
        } catch (_) { /* checked below */ }
        finally { window.clearTimeout(timer); }
        if (isHallucinatedWord(data.word, query)) {
          throw new Error(`模型误返回了无关词条「${data.word}」，请重试查「${query}」。`);
        }
      }
      data.source = "model";
      data.model = resolvedCfg.model;
      data.gen = { ms: Math.max(0, Date.now() - startedAt), model: resolvedCfg.model || "", tokens: usage?.total ?? null, at: Date.now() };
      cachePutWord(normalizeWord(data.word), data, detail, data.gen);
      if (normalizeWord(query) !== normalizeWord(data.word)) cachePutWord(query, data, detail, data.gen);
      return { type: "word", data };
    }
    const data = normalizeModelSentence(parsed, query);
    if (pieces.length > 1 && data.sentences.length) {
      data.sentences = alignSentenceParts(data.sentences, pieces);
    }
    data.sourceType = "model";
    data.model = resolvedCfg.model;
    data.source = "语境分析";
    if (sentenceCacheKey) {
      data.id = `model-${sentenceCacheKey}`;
      cachePutSentence(sentenceCacheKey, data, sentenceLevelOf(resolvedCfg.sentenceLevel).id, detail);
    }
    return { type: "sentence", data };
  }

  function tossWrongPreview(host, wrongWord, targetWord) {
    if (!host) return;
    const skeleton = $(".skeleton-stack");
    const hasCard = !host.hidden && host.innerHTML.trim().length > 0;
    const finishReset = () => {
      host.classList.remove("is-tossing", "has-content");
      host.dataset.signature = "";
      host.dataset.tossing = "";
      host.innerHTML = `<span class="live-preview-kicker is-retry"><i></i>${wrongWord ? `已丢弃跑偏词条「${esc(wrongWord)}」，` : ""}正在重查「${esc(targetWord || "")}」…</span>`;
      host.hidden = false;
      host.classList.add("is-arriving");
      window.setTimeout(() => host.classList.remove("is-arriving"), 280);
      if (skeleton) skeleton.classList.remove("is-streaming");
    };
    if (!hasCard) {
      finishReset();
      return;
    }
    host.dataset.tossing = "1";
    host.classList.remove("is-arriving");
    host.classList.add("is-tossing");
    window.setTimeout(finishReset, 420);
  }

  function updateStreamPreview(preview, type) {
    if (!preview) return;
    if (preview.kind === "reverse") {
      updateReverseStream(preview.narrative || "");
      return;
    }
    const host = $("#live-preview");
    if (!host) return;
    if (preview.kind === "discard") {
      tossWrongPreview(host, preview.wrongWord || "", preview.targetWord || "");
      return;
    }
    if (host.dataset.tossing === "1") return;
    const signature = JSON.stringify(preview);
    if (host.dataset.signature === signature) return;
    host.dataset.signature = signature;
    host.hidden = false;
    host.classList.add("has-content");
    const skeleton = $(".skeleton-stack");
    if (skeleton) skeleton.classList.add("is-streaming");
    if (preview.kind === "reverse") {
      host.innerHTML = `
        <span class="live-preview-kicker"><i></i>正在分段返回${preview.received ? ` · 模型已返回 ${preview.received.toLocaleString("en-US")} 字` : ""}</span>
        <p class="live-preview-narrative">${esc(preview.narrative)}</p>`;
      return;
    }
    if (type === "sentence") {
      host.innerHTML = `
        <span class="live-preview-kicker"><i></i>正在分段返回${preview.received ? ` · 模型已返回 ${preview.received.toLocaleString("en-US")} 字` : ""}</span>
        <h2 class="live-preview-word">${esc(shorten(preview.text || "", 80))}</h2>
        ${preview.tone ? `<span class="live-preview-meta">${esc(preview.tone)}</span>` : ""}
        ${preview.translation ? `<p class="live-preview-translation">${esc(preview.translation)}</p>` : `<p class="live-preview-pending">正在整理译文…</p>`}
        ${preview.structure ? `<p class="live-preview-note">${esc(preview.structure)}</p>` : ""}`;
      return;
    }
    host.innerHTML = `
      <span class="live-preview-kicker"><i></i>正在分段返回${preview.received ? ` · 模型已返回 ${preview.received.toLocaleString("en-US")} 字` : ""}</span>
      <h2 class="live-preview-word">${esc(preview.word || "")}</h2>
      <div class="live-preview-meta">${esc(preview.phonetic || "")}${preview.pos ? ` · ${esc(posLabel(preview.pos))}` : ""}</div>
      ${preview.translation ? `<p class="live-preview-translation">${esc(preview.translation)}</p>` : `<p class="live-preview-pending">正在整理第一段…</p>`}
      ${preview.short ? `<p class="live-preview-note">${esc(preview.short)}</p>` : ""}
      ${(preview.senses || []).length ? `<ul class="live-preview-senses">${preview.senses.map((sense) => `<li>${esc(shorten(sense, 42))}</li>`).join("")}</ul>` : ""}`;
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

  function openFullEntry(word) {
    closeSheet({ immediate: true });
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
      return { kind: "chunk", query: state.route?.query || "", data: state.route?.data || null, isLayer: false, record: null };
    }
    if (name === "sentence") {
      const data = getSentence(state.route);
      return { kind: "sentence", query: data?.text || "", data, isLayer: false, record: null };
    }
    return { kind: name, query: "", data: null, isLayer: false, record: null };
  }

  function activeSentenceData() {
    const surface = getActiveSurface();
    return surface.kind === "sentence" ? surface.data : null;
  }

  function activeWordData() {
    const surface = getActiveSurface();
    return surface.kind === "word" ? surface.data : null;
  }

  function parseSavedEntry(raw) {
    const str = String(raw || "").trim();
    if (str.startsWith("word:")) {
      const text = str.slice(5).trim();
      return { kind: "word", text, label: text };
    }
    if (str.startsWith("chunk:")) {
      const text = str.slice(6).replace(/-/g, " ").trim();
      return { kind: "chunk", text, label: text };
    }
    if (str.startsWith("sentence:")) {
      const rest = str.slice(9).trim();
      const hit = DATA.sentences?.find((item) => item.id === rest);
      const text = hit?.text || rest;
      return { kind: "sentence", text, label: text };
    }
    const kind = str.includes(" ") ? "chunk" : "word";
    return { kind, text: str, label: str };
  }

  function normalizeSavedKey(raw) {
    const entry = parseSavedEntry(raw);
    if (!entry.text) return "";
    if (entry.kind === "sentence") return `sentence:${entry.text.toLowerCase()}`;
    return entry.text.toLowerCase();
  }

  function findSavedIndex(key) {
    const target = normalizeSavedKey(key);
    if (!target) return -1;
    return state.saved.findIndex((item) => normalizeSavedKey(item) === target);
  }

  function isSavedKey(key) {
    return findSavedIndex(key) >= 0;
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
     Init
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
    if (storedKeysPlain) persistSettings(state.settings);
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


  async function callWordbookAi(task, payload) {
    const sys = task === "classify"
      ? window.TALK_PROMPTS.wordbookClassify
      : task === "extract"
        ? window.TALK_PROMPTS.wordbookExtract
        : window.TALK_PROMPTS.wordbookArticle;
    const label = task === "classify" ? "主题分册" : task === "extract" ? "AI 提取词条" : "生成精读文章";
    const maxTokens = task === "extract" ? 2400 : 3200;
    return LLM.requestJson({
      settings: state.settings,
      system: sys,
      user: payload,
      maxTokens,
      timeoutMs: Math.max(MODEL_TIMEOUT_MS, 90_000),
      label,
      disableThinking: true,
      temperature: 0.3,
      retries: 1
    });
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
      const found = typeof SENTENCE_LEVELS !== "undefined" ? SENTENCE_LEVELS.find((x) => x.id === lv) : null;
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
