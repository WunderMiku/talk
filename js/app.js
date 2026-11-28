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
import { relationGloss, createWordView } from "./views/word.js";
import { createChunkView } from "./views/chunk.js";
import { createSentenceView } from "./views/sentence.js";
import { createReverseView } from "./views/reverse.js";

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
    renderSettingsContent,
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
    hydrateLayerWithModel,
    runSearch,
    scrollScreenTo,
    applyCacheDisplay,
    refreshCacheBorders,
    persistSettings,
    refreshThemedPage,
    closeTopWordLayer: popWordLayer,
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
    hydrateChunkLayer,
    runSearch,
    closeTopWordLayer: popWordLayer,
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
    hydrateSentenceLayer,
    closeTopWordLayer: popWordLayer,
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
    closeAllWordLayers,
    closeSheet,
    navigate,
    runSearch,
    openHistorySheet,
    renderHistoryContent,
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

  actions.register({
    ...tts.actions,
    ...share.actions,
    ...themeSalon.actions,
    ...translator.actions,
    ...statusViews.actions,
    ...wordView.actions,
    ...chunkView.actions,
    ...sentenceView.actions,
    ...reverseView.actions
  });

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
     Sheets
     ============================================================ */

  /* ============================================================
     Nested word layers
     ============================================================ */

  function updateScrollLock() {
    if (!screen) return;
    screen.classList.toggle("is-locked", state.sheetOpen || state.workspaceOpen || state.wordLayers.length > 0);
  }

  function currentLayerData() {
    if (state.wordLayers.length) return state.wordLayers[state.wordLayers.length - 1].data;
    if (state.route.name === "word") return getWord(state.route);
    return null;
  }

  function currentLayerOrigin() {
    if (state.wordLayers.length) return state.wordLayers[state.wordLayers.length - 1].word;
    if (state.route.name === "word") return getWord(state.route)?.word || "当前词条";
    if (state.route.name === "sentence") return "句子";
    return "Talk";
  }

  function uniqueWords(items, exclude = "") {
    const skip = normalizeWord(exclude);
    const seen = new Set();
    const out = [];
    for (const item of items) {
      const word = typeof item === "string" ? item : item?.word;
      const key = normalizeWord(word);
      if (!key || key === skip || seen.has(key)) continue;
      seen.add(key);
      out.push(String(word));
    }
    return out;
  }

  function siblingsFor(data, exclude = "") {
    if (!data) return [];
    return uniqueWords([
      ...(data.family || []),
      ...(data.synonyms || []),
      ...(data.antonyms || []),
      ...(data.related || [])
    ], exclude).slice(0, 8);
  }

  function sentenceSiblings(exclude = "") {
    const sentence = getSentence(state.route);
    return uniqueWords(sentence?.keyWords?.map((item) => item.word) || [], exclude).slice(0, 8);
  }

  function makeMiniWord(word, options, origin, relation) {
    const key = normalizeWord(word);
    const stub = DATA.lexicon[key] || {};
    const gloss = options.gloss || stub.gloss || "";
    const zh = options.zh || stub.zh || "";
    const context = options.context || null;
    const siblings = options.siblings || [];
    const shortMeaning = context?.meaning || gloss || "";
    const chineseMeaning = context?.meaningZh || zh || "";
    if (!shortMeaning && !chineseMeaning) return null;
    return ensureWord({
      word,
      phonetic: options.ipa || stub.phonetic || "",
      pos: options.pos || stub.pos || "",
      level: "—",
      register: "common",
      short: shortMeaning,
      translation: chineseMeaning || shortMeaning,
      note: context?.why || `来自 ${origin} 的${relation}。`,
      senses: [{
        zh: chineseMeaning || shortMeaning,
        en: shortMeaning,
        tag: "关联词"
      }],
      family: [],
      synonyms: [],
      antonyms: [],
      examples: [],
      collocations: [],
      related: siblings,
      origin: null,
      context
    });
  }

  function layerLoadingPage(word, origin, relation, depth) {
    return `
      ${layerTopbar({ title: word, origin, relation, depth })}
      ${loadingBody(word, "word", { statusText: "正在生成完整词条" })}`;
  }

  function layerConnectPage(word, origin, relation, depth) {
    return `
      ${layerTopbar({ title: word, origin, relation, depth })}
      <main class="result-page state-page layer-state">
        <div class="state-orb lavender reveal" style="--d:0">✦</div>
        <h1 class="state-title reveal" style="--d:0.3">还没生成过这个词。</h1>
        <p class="state-copy reveal" style="--d:0.5">Talk 的词义由模型实时生成。连接模型后，<b>${esc(word)}</b> 会补全中文释义、音标、同根词、近反义词和词源。</p>
        <span class="state-query reveal" style="--d:0.7">${esc(shorten(origin ? `来自 ${origin} · ${relation}` : relation, 70))}</span>
        <div class="state-actions reveal" style="--d:0.9">
          <button class="btn btn-primary" type="button" data-action="settings">${icon("wand")} 连接模型</button>
          <button class="btn btn-secondary" type="button" data-action="layer-back">返回</button>
        </div>
      </main>`;
  }

  function layerErrorPage(word, origin, relation, depth, message) {
    return `
      ${layerTopbar({ title: word, origin, relation, depth })}
      <main class="result-page state-page layer-state">
        <div class="state-orb coral reveal" style="--d:0">!</div>
        <h1 class="state-title reveal" style="--d:0.3">这一层没生成出来。</h1>
        <p class="state-copy reveal" style="--d:0.5">模型没有完成这个子词条。可以重试，或检查模型设置。</p>
        ${message ? `<div class="error-detail reveal" style="--d:0.7">${esc(shorten(message, 260))}</div>` : ""}
        <div class="state-actions reveal" style="--d:0.8">
          <button class="btn btn-primary" type="button" data-action="retry-layer">${icon("refresh")} 重试这一层</button>
          <button class="btn btn-secondary" type="button" data-action="settings">${icon("settings")} 模型设置</button>
        </div>
      </main>`;
  }

  function ensureLayerScrim() {
    let scrim = $(".layer-scrim", layerRoot);
    if (!scrim) {
      scrim = document.createElement("div");
      scrim.className = "layer-scrim";
      layerRoot.appendChild(scrim);
      requestAnimationFrame(() => scrim.classList.add("show"));
    }
    return scrim;
  }

  /**
   * Unified surface renderer shared by initial layer mount and async hydration.
   * Ensures data-page, reveal state, widescreen word columns, and cache borders
   * are always applied through one single code path.
   */
  function mountResultSurface(container, { kind = "word", content = "", animate = false } = {}) {
    if (!container) return;
    const holder = document.createElement("div");
    holder.innerHTML = content;
    holder.querySelectorAll(".reveal, .reveal-item").forEach((node) => node.classList.add("is-in"));
    container.replaceChildren(...holder.childNodes);
    if (kind === "word") enhanceWordColumns(container);
    applyCacheDisplay();
    refreshCacheBorders(container);
    container.scrollTop = 0;
    if (animate && !reduceMotion) {
      const first = $(".sheet-content, .result-page", container);
      if (first) {
        first.animate(
          [
            { opacity: 0, transform: "translateY(8px)" },
            { opacity: 1, transform: "translateY(0)" }
          ],
          { duration: 320, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
        );
      }
    }
  }

  function mountWordLayer({ word, data, origin, relation, depth, content, options = {}, kind = "word" }) {
    const layerKind = kind || "word";
    const layer = document.createElement("section");
    layer.className = "word-layer";
    layer.dataset.page = layerKind;
    layer.dataset.layerKind = layerKind;
    layer.style.setProperty("--depth", String(depth));
    layer.style.zIndex = String(2 + depth);
    layer.tabIndex = -1;
    layer.setAttribute("role", "region");
    layer.setAttribute("aria-label", `${word} 词条，第 ${depth} 层`);
    const scroll = document.createElement("div");
    scroll.className = "layer-scroll";
    layer.appendChild(scroll);
    mountResultSurface(scroll, { kind: layerKind, content, animate: false });

    ensureLayerScrim();
    const previous = state.wordLayers[state.wordLayers.length - 1];
    if (previous) {
      previous.el.classList.add("is-behind");
      previous.el.setAttribute("aria-hidden", "true");
    }

    layerRoot.appendChild(layer);
    const record = {
      el: layer,
      kind: layerKind,
      word,
      content,
      data: data || null,
      origin,
      relation,
      depth,
      options,
      loading: !data,
      error: null
    };
    state.wordLayers.push(record);
    shelveLayersBelow();
    updateScrollLock();
    if (data && layerKind === "word") schedulePrefetch(data);
    else if (!data) updateCacheCorner(false, "正在生成本层词条");

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        layer.classList.add("is-open");
        layer.focus({ preventScroll: true });
      });
    });
    return record;
  }

  function replaceLayerContent(record, content) {
    if (!record?.el?.isConnected) return;
    const scroll = $(".layer-scroll", record.el);
    if (!scroll) return;
    record.content = content;
    record.shelved = false;
    mountResultSurface(scroll, { kind: record.kind || "word", content, animate: true });
  }

  async function hydrateLayerWithModel(record) {
    if (!record || !record.el.isConnected) return;
    if (!hasModelConfig()) {
      replaceLayerContent(record, layerConnectPage(record.word, record.origin, record.relation, record.depth));
      return;
    }
    record.loading = true;
    record.error = null;
    replaceLayerContent(record, layerLoadingPage(record.word, record.origin, record.relation, record.depth));
    try {
      const result = await lookupWordDeduped(record.word);
      if (!record.el.isConnected) return;
      let data = ensureWord(result.data);
      if (!data) throw new Error("模型返回的词条为空。");
      if (record.options?.context) data = { ...data, context: record.options.context };
      if (!data.related?.length && record.options?.siblings?.length) {
        data.related = record.options.siblings.slice(0, 6);
      }
      record.data = data;
      record.word = data.word;
      record.loading = false;
      record.el.setAttribute("aria-label", `${data.word} 词条，第 ${record.depth} 层`);
      addHistory("word", data.word);
      replaceLayerContent(record, wordPage(data, {
        origin: record.origin,
        relation: record.relation,
        depth: record.depth
      }));
      schedulePrefetch(data);
    } catch (error) {
      if (!record.el.isConnected) return;
      const message = error?.name === "AbortError"
        ? `${MODEL_TIMEOUT_TEXT}，已中断。`
        : String(error?.message || "模型请求失败。");
      record.loading = false;
      record.error = message;
      updateCacheCorner(false, "本层词条未缓存");
      replaceLayerContent(record, layerErrorPage(record.word, record.origin, record.relation, record.depth, message));
    }
  }

  async function openWordLayer(word, options = {}) {
    const key = normalizeWord(word);
    if (!key) return;
    if (state.sheetOpen) closeSheet({ immediate: true });

    const depth = state.wordLayers.length + 1;
    const origin = options.origin || currentLayerOrigin();
    const relation = options.relation || "相关词";
    const entry = DATA.words[key];
    const siblings = options.siblings !== undefined
      ? options.siblings
      : (state.route.name === "sentence" && !state.wordLayers.length
          ? sentenceSiblings(key)
          : siblingsFor(currentLayerData(), key));
    const layerOptions = { ...options, siblings };

    let data = entry ? ensureWord(entry) : null;
    if (!data) {
      const cached = cacheGetWord(key);
      if (cached) data = ensureWord(cached);
    }
    if (data) {
      if (options.context) data = { ...data, context: options.context };
      if (!data.related?.length && siblings.length) data.related = siblings.slice(0, 6);
      addHistory("word", data.word);
      mountWordLayer({
        word: data.word,
        data,
        origin,
        relation,
        depth,
        options: layerOptions,
        content: wordPage(data, { origin, relation, depth })
      });
      return;
    }

    const hasLocalMini = Boolean(DATA.lexicon[key] || options.gloss || options.context?.meaning);
    if (!hasModelConfig()) {
      if (hasLocalMini) {
        const mini = makeMiniWord(word, { ...options, siblings }, origin, relation);
        if (mini) {
          mountWordLayer({
            word: mini.word,
            data: mini,
            origin,
            relation,
            depth,
            options: layerOptions,
            content: wordPage(mini, { origin, relation, depth })
          });
          return;
        }
      }
      mountWordLayer({
        word: key,
        data: null,
        origin,
        relation,
        depth,
        options: layerOptions,
        content: layerConnectPage(key, origin, relation, depth)
      });
      return;
    }

    const record = mountWordLayer({
      word: key,
      data: null,
      origin,
      relation,
      depth,
      options: layerOptions,
      content: layerLoadingPage(key, origin, relation, depth)
    });
    await hydrateLayerWithModel(record);
  }

  async function hydrateChunkLayer(record, phrase) {
    if (!record || !record.el?.isConnected) return;
    const cfg = applyProfileToSettings(state.settings, activeProfile(state.settings));
    if (!hasModelConfig(cfg)) {
      replaceLayerContent(record, layerConnectPage(phrase, record.origin, record.relation, record.depth));
      return;
    }
    record.loading = true;
    replaceLayerContent(record, layerLoadingPage(phrase, record.origin, record.relation, record.depth));
    try {
      const result = await modelLookup(phrase, "chunk", cfg);
      if (!state.wordLayers.includes(record)) return;
      const chunkData = ensureChunk(result.data);
      if (!chunkData) throw new Error("模型返回的意群为空");
      record.data = chunkData;
      record.word = chunkData.chunk;
      record.loading = false;
      addHistory("chunk", chunkData.chunk);
      replaceLayerContent(record, chunkPage(chunkData, { origin: record.origin, relation: record.relation, depth: record.depth }));
    } catch (error) {
      if (!state.wordLayers.includes(record)) return;
      record.loading = false;
      replaceLayerContent(record, layerErrorPage(phrase, record.origin, record.relation, record.depth, error?.message || "意群加载失败"));
    }
  }

  async function openChunkLayer(phrase, options = {}) {
    const clean = String(phrase || "").trim();
    if (!clean) return;
    if (state.sheetOpen) closeSheet({ immediate: true });
    const depth = state.wordLayers.length + 1;
    const origin = options.origin || currentLayerOrigin();
    const relation = options.relation || "意群";
    const slug = chunkSlug(clean);
    let data = !options.skipCache && DATA.chunks?.[slug] ? ensureChunk(DATA.chunks[slug]) : null;
    if (!data && !options.skipCache) {
      const cached = cacheGetChunk(clean);
      if (cached) data = ensureChunk(cached);
    }
    if (data) {
      addHistory("chunk", data.chunk);
      mountWordLayer({
        word: data.chunk,
        kind: "chunk",
        data,
        origin,
        relation,
        depth,
        options,
        content: chunkPage(data, { origin, relation, depth })
      });
      return;
    }
    const cfg = applyProfileToSettings(state.settings, activeProfile(state.settings));
    if (!hasModelConfig(cfg)) {
      mountWordLayer({
        word: clean,
        kind: "chunk",
        data: null,
        origin,
        relation,
        depth,
        options,
        content: layerConnectPage(clean, origin, relation, depth)
      });
      return;
    }
    const record = mountWordLayer({
      word: clean,
      kind: "chunk",
      data: null,
      origin,
      relation,
      depth,
      options,
      content: layerLoadingPage(clean, origin, relation, depth)
    });
    await hydrateChunkLayer(record, clean);
  }

  async function hydrateSentenceLayer(record, clean) {
    if (!record || !record.el?.isConnected) return;
    const titleShort = shorten(clean, 26);
    const cfg = applyProfileToSettings(state.settings, activeProfile(state.settings));
    if (!hasModelConfig(cfg)) {
      replaceLayerContent(record, layerConnectPage(titleShort, record.origin, record.relation, record.depth));
      return;
    }
    record.loading = true;
    replaceLayerContent(record, layerLoadingPage(titleShort, record.origin, record.relation, record.depth));
    try {
      const result = await modelLookup(clean, "sentence", cfg);
      if (!state.wordLayers.includes(record)) return;
      const sentData = result.data;
      if (!sentData) throw new Error("模型返回的拆句为空");
      record.data = sentData;
      record.word = shorten(sentData?.text || clean, 26);
      record.loading = false;
      addHistory("sentence", sentData?.text || clean);
      replaceLayerContent(record, sentencePage(sentData, { origin: record.origin, relation: record.relation, depth: record.depth }));
    } catch (error) {
      if (!state.wordLayers.includes(record)) return;
      record.loading = false;
      replaceLayerContent(record, layerErrorPage(titleShort, record.origin, record.relation, record.depth, error?.message || "拆句加载失败"));
    }
  }

  async function openSentenceLayer(text, options = {}) {
    const clean = String(text || "").trim();
    if (!clean) return;
    if (state.sheetOpen) closeSheet({ immediate: true });
    const depth = state.wordLayers.length + 1;
    const origin = options.origin || currentLayerOrigin();
    const relation = options.relation || "拆句";
    const titleShort = shorten(clean, 26);

    const localHit = !options.skipCache
      ? DATA.sentences?.find((item) => String(item.text || "").trim().toLowerCase() === clean.toLowerCase())
      : null;
    if (localHit) {
      addHistory("sentence", localHit.text || clean);
      mountWordLayer({
        word: titleShort,
        kind: "sentence",
        data: localHit,
        origin,
        relation,
        depth,
        options,
        content: sentencePage(localHit, { origin, relation, depth })
      });
      return;
    }

    const detail = state.settings?.detailLevel || "standard";
    const sKey = await sentenceKey(clean, sentenceLevelOf(state.settings?.sentenceLevel).id, detail);
    const cached = !options.skipCache && sKey ? cacheGetSentence(sKey) : null;
    if (cached) {
      addHistory("sentence", cached.text || clean);
      mountWordLayer({
        word: titleShort,
        kind: "sentence",
        data: cached,
        origin,
        relation,
        depth,
        options,
        content: sentencePage(cached, { origin, relation, depth })
      });
      return;
    }

    const cfg = applyProfileToSettings(state.settings, activeProfile(state.settings));
    if (!hasModelConfig(cfg)) {
      mountWordLayer({
        word: titleShort,
        kind: "sentence",
        data: null,
        origin,
        relation,
        depth,
        options,
        content: layerConnectPage(titleShort, origin, relation, depth)
      });
      return;
    }

    const record = mountWordLayer({
      word: titleShort,
      kind: "sentence",
      data: null,
      origin,
      relation,
      depth,
      options,
      content: layerLoadingPage(titleShort, origin, relation, depth)
    });
    await hydrateSentenceLayer(record, clean);
  }

  function openWordLayerFromButton(button) {
    const word = button.dataset.word || "";
    if (!word) return;
    const relation = button.dataset.relation || "相关词";
    const origin = currentLayerOrigin();
    const contextLayer = state.wordLayers[state.wordLayers.length - 1];
    const siblings = state.route.name === "sentence" && !contextLayer
      ? sentenceSiblings(word)
      : siblingsFor(contextLayer?.data || (state.route.name === "word" ? getWord(state.route) : null), word);
    openWordLayer(word, {
      gloss: button.dataset.gloss || "",
      pos: button.dataset.pos || "",
      relation,
      origin,
      siblings
    });
  }

  function openKeyLayer(index) {
    const sentence = getSentence(state.route);
    const keyWord = sentence?.keyWords?.[index];
    if (!keyWord) return;
    openWordLayer(keyWord.word, {
      context: keyWord,
      gloss: keyWord.meaning,
      zh: keyWord.meaningZh,
      ipa: keyWord.phonetic,
      pos: keyWord.pos,
      relation: "重点词",
      origin: "句子",
      siblings: uniqueWords(sentence.keyWords.map((item) => item.word), keyWord.word)
    });
  }

  /* Only the top layer is on screen; everything below it is a 14px strip of
     background. Emptying those pages keeps long "word chains" from piling up
     full entries in the document. The markup is kept on the record and put
     back when the user walks back up the stack. */
  function shelveLayersBelow() {
    if (!state.wordLayers.length) return;
    const top = state.wordLayers[state.wordLayers.length - 1];
    state.wordLayers.forEach((layer) => {
      if (layer === top || layer.shelved || layer.loading || !layer.data) return;
      const scroll = $(".layer-scroll", layer.el);
      if (!scroll) return;
      layer.scrollTop = scroll.scrollTop;
      scroll.replaceChildren();
      layer.shelved = true;
    });
  }

  function restoreLayerContent(record) {
    if (!record?.shelved) return;
    const scroll = $(".layer-scroll", record.el);
    if (!scroll) return;
    record.shelved = false;
    scroll.innerHTML = record.content || "";
    // The layer already played its entrance once; restoring it should not
    // replay a cascade the reader has already seen.
    scroll.querySelectorAll(".reveal, .reveal-item").forEach((element) => element.classList.add("is-in"));
    enhanceWordColumns(scroll);
    applyCacheDisplay();
    refreshCacheBorders(scroll);
    const offset = record.scrollTop || 0;
    scroll.scrollTop = offset;
    requestAnimationFrame(() => {
      scroll.scrollTop = offset;
    });
  }

  function popWordLayer() {
    const item = state.wordLayers.pop();
    if (!item) return;
    item.el.classList.remove("is-open");
    item.el.classList.add("is-closing");
    item.el.setAttribute("aria-hidden", "true");
    window.setTimeout(() => item.el.remove(), 540);

    const previous = state.wordLayers[state.wordLayers.length - 1];
    if (previous) {
      previous.el.classList.remove("is-behind");
      previous.el.removeAttribute("aria-hidden");
      restoreLayerContent(previous);
      previous.el.focus({ preventScroll: true });
      refreshCacheBorders(previous.el);
      if (previous.data) schedulePrefetch(previous.data);
    } else {
      const scrim = $(".layer-scrim", layerRoot);
      if (scrim) {
        scrim.classList.remove("show");
        window.setTimeout(() => scrim.remove(), 420);
      }
      if (state.route.name === "word") {
        const mainWord = getWord(state.route);
        if (mainWord) schedulePrefetch(mainWord);
        else hideCacheCorner();
      } else {
        hideCacheCorner();
      }
    }
    updateScrollLock();
  }

  function closeAllWordLayers({ immediate = false } = {}) {
    if (!state.wordLayers.length && !layerRoot.firstElementChild) return;
    state.wordLayers = [];
    if (immediate) {
      layerRoot.innerHTML = "";
    } else {
      $$(".word-layer", layerRoot).forEach((layer) => {
        layer.classList.remove("is-open");
        layer.classList.add("is-closing");
      });
      const scrim = $(".layer-scrim", layerRoot);
      if (scrim) scrim.classList.remove("show");
      window.setTimeout(() => { layerRoot.innerHTML = ""; }, 540);
    }
    updateScrollLock();
  }

  function openKeySheet(index) {
    openKeyLayer(index);
  }

  function openSheetShell({ kicker, title }) {
    state.sheetOpenedAt = performance.now();
    if (state.sheetCloseTimer) {
      window.clearTimeout(state.sheetCloseTimer);
      state.sheetCloseTimer = null;
    }
    overlayRoot.innerHTML = `
      <div class="sheet-backdrop" data-action="close-sheet"></div>
      <section class="sheet" role="dialog" aria-modal="true" aria-label="${attr(title)}" tabindex="-1">
        <div class="sheet-handle" aria-hidden="true"></div>
        <div class="sheet-head">
          <div class="sheet-head-left">
            <span class="mono">${esc(kicker)}</span>
            <h2 class="sheet-title">${esc(title)}</h2>
          </div>
          <button class="sheet-close" type="button" data-action="close-sheet" aria-label="关闭">${icon("close")}</button>
        </div>
        <div class="sheet-scroll" id="sheet-scroll" data-lenis-prevent></div>
      </section>`;

    state.sheetOpen = true;
    updateScrollLock();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        $(".sheet-backdrop", overlayRoot)?.classList.add("show");
        $(".sheet", overlayRoot)?.classList.add("show");
        $(".sheet", overlayRoot)?.focus({ preventScroll: true });
      });
    });
  }

  function closeSheet({ immediate = false } = {}) {
    if (!state.sheetOpen && !overlayRoot.firstElementChild) return;
    if (state.settingsOpen) flushSettingsDraft();
    state.settingsOpen = false;
    state.sheetOpen = false;
    state.sheetStack = [];
    updateScrollLock();
    const backdrop = $(".sheet-backdrop", overlayRoot);
    const sheet = $(".sheet", overlayRoot);
    if (immediate) {
      overlayRoot.innerHTML = "";
      return;
    }
    backdrop?.classList.remove("show");
    sheet?.classList.remove("show");
    if (state.sheetCloseTimer) window.clearTimeout(state.sheetCloseTimer);
    state.sheetCloseTimer = window.setTimeout(() => {
      overlayRoot.innerHTML = "";
      state.sheetCloseTimer = null;
    }, 520);
  }

  function renderSheetContent() {
    const holder = $("#sheet-scroll");
    if (!holder) return;
    const payload = state.sheetStack[state.sheetStack.length - 1];
    if (!payload) return;
    holder.innerHTML = wordSheetContent(payload);
    holder.scrollTop = 0;
    const content = $(".sheet-content", holder);
    if (content && !reduceMotion) {
      content.animate(
        [
          { opacity: 0, transform: "translateY(12px)" },
          { opacity: 1, transform: "translateY(0)" }
        ],
        { duration: 360, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
      );
    }
  }

  function sheetBackButton() {
    if (state.sheetStack.length <= 1) return "";
    return `<button class="sheet-back" type="button" data-action="sheet-back">${icon("arrowLeft")} 返回</button>`;
  }

  function wordSheetContent(payload) {
    const entry = payload.entry || null;
    const context = payload.context || null;
    const word = payload.word || entry?.word || "";
    const ipa = payload.ipa || entry?.phonetic || "";
    const pos = payload.pos || entry?.pos || "";
    const short = context?.meaning || entry?.short || payload.gloss || "这个词来自当前词条的关联词。";
    const translation = entry?.translation || "";
    const family = payload.family || context?.family || entry?.family || [];
    const synonyms = payload.synonyms || context?.synonyms || entry?.synonyms || [];
    const antonyms = payload.antonyms || context?.antonyms || entry?.antonyms || [];
    const example = context?.example || (entry?.examples && entry.examples[0]) || null;
    const isStub = !entry && !context;
    const canOpen = entry || context;

    const relGroup = (label, items, kind = "") => items.length ? `
      <div class="sheet-section">
        <span class="sheet-section-label">${esc(label)}</span>
        <div class="sheet-rel-row">
          ${items.map((item) => `
            <button class="sheet-rel" type="button" data-action="sheet-word" data-word="${attr(item.word)}" data-gloss="${attr(relationGloss(item))}" data-pos="${attr(posAbbr(item.pos))}">
              ${esc(item.word)} ${item.gloss ? `<small>${esc(item.gloss)}</small>` : ""}
            </button>`).join("")}
        </div>
      </div>` : "";

    return `
      <div class="sheet-content">
        ${sheetBackButton()}
        <div class="sheet-word-head">
          <div>
            <h3 class="sheet-word">${esc(word)}</h3>
            <div class="sheet-sub">
              ${ipa ? `<span class="ipa">${esc(ipa)}</span>` : ""}
              ${pos ? `<span class="pos-pill">${esc(posLabel(pos))}</span>` : ""}
            </div>
          </div>
          <button class="speak-btn" type="button" data-action="speak" data-text="${attr(word)}">${icon("volume")}</button>
        </div>
        ${context ? "" : `<p class="sheet-definition">${esc(translation || short)}</p>`}
        ${translation && short && !context ? `<p class="sheet-translation">${esc(short)}</p>` : ""}
        ${context ? `
          <div class="sheet-context">
            <span class="mono">在本句中</span>
            <p>${esc(context.meaningZh || context.meaning || short)}</p>
            ${context.meaningZh && context.meaning ? `<span class="sheet-context-en">${esc(context.meaning)}</span>` : ""}
            ${context.why ? `<span class="sheet-context-why">${esc(context.why)}</span>` : ""}
          </div>` : ""}
        ${relGroup("同根词", family)}
        ${relGroup("近义词", synonyms)}
        ${relGroup("反义词", antonyms)}
        ${example?.en ? `
          <div class="sheet-section">
            <span class="sheet-section-label">例句</span>
            <div class="sheet-example">
              <p>${highlightPlain(example.en, word)}</p>
              ${example.zh ? `<span>${esc(example.zh)}</span>` : ""}
            </div>
          </div>` : ""}
        ${isStub ? `<div class="sheet-note">${icon("info")}<span>演示词条。连接模型后可补全。</span></div>` : ""}
        ${entry?.note && !context ? `<div class="sheet-note">${icon("sparkle")}<span>${rich(entry.note)}</span></div>` : ""}
        <div class="sheet-actions">
          <button class="btn btn-primary" type="button" data-action="full-entry" data-word="${attr(word)}">${icon("arrowUpRight")} ${canOpen ? "查看完整词条" : "去查这个词"}</button>
          <button class="btn btn-secondary" type="button" data-action="close-sheet">关闭</button>
        </div>
      </div>`;
  }

  function openWordSheet(word, options = {}) {
    const key = normalizeWord(word);
    const entry = DATA.words[key] || null;
    const stub = !entry ? DATA.lexicon[key] : null;
    const payload = {
      word: word,
      entry: entry || (stub ? { word, ...stub } : null),
      gloss: options.gloss || "",
      pos: options.pos || "",
      ipa: options.ipa || "",
      context: options.context || null
    };
    state.sheetStack = [payload];
    openSheetShell({ kicker: "单词详解", title: "词义速览" });
    renderSheetContent();
  }

  function pushSheetWord(button) {
    const word = button.dataset.word || "";
    if (!word) return;
    const key = normalizeWord(word);
    const entry = DATA.words[key] || null;
    const stub = !entry ? DATA.lexicon[key] : null;
    state.sheetStack.push({
      word,
      entry: entry || (stub ? { word, ...stub } : null),
      gloss: button.dataset.gloss || "",
      pos: button.dataset.pos || "",
      ipa: "",
      context: null
    });
    renderSheetContent();
  }

  function goBackInSheet() {
    if (state.sheetStack.length > 1) {
      state.sheetStack.pop();
      renderSheetContent();
    }
  }

  function openSettingsSheet() {
    state.settingsOpen = true;
    state.settingsDirty = false;
    state.settingsTab = state.settingsTab || "model";
    state.draft = {
      ...state.settings,
      profiles: (state.settings.profiles || []).map((profile) => ({ ...profile }))
    };
    const copy = copyFor("settings");
    openSheetShell({ kicker: copy.kicker, title: copy.title });
    renderSettingsContent();
  }

  function settingsStatus(text) {
    const target = $("#settings-save-status");
    if (target) target.textContent = text;
  }

  function scheduleSettingsCommit() {
    if (!state.draft) return;
    state.settingsDirty = true;
    settingsStatus("正在保存…");
    if (state.settingsSaveTimer) window.clearTimeout(state.settingsSaveTimer);
    state.settingsSaveTimer = window.setTimeout(commitSettingsDraft, 240);
  }

  function commitSettingsDraft() {
    if (!state.draft) return;
    if (state.settingsSaveTimer) {
      window.clearTimeout(state.settingsSaveTimer);
      state.settingsSaveTimer = null;
    }
    syncDraftProfile(state.draft);
    state.draft.apiKey = String(state.draft.apiKey || "").trim();
    state.draft.baseUrl = String(state.draft.baseUrl || "").trim();
    state.draft.model = String(state.draft.model || "").trim();
    state.settings = {
      ...state.draft,
      profiles: state.draft.profiles.map((profile) => ({ ...profile }))
    };
    persistSettings(state.settings);
    state.settingsDirty = false;
    applyCacheDisplay();
    refreshCacheBorders();
    const active = activeWordData();
    if (active) schedulePrefetch(active);
    settingsStatus("已自动保存");
  }

  function flushSettingsDraft() {
    if (!state.settingsDirty) return;
    commitSettingsDraft();
  }

  function ttsSettingsHtml(draft) {
    const engine = draft.ttsEngine === "qwen" ? "qwen" : "native";
    return `
      <div class="tts-head">
        <span class="settings-subhead">发音</span>
        <div class="tts-engine-switch" role="group" aria-label="发音引擎">
          <button class="tts-engine-btn ${engine === "native" ? "active" : ""}" type="button" data-action="tts-engine" data-engine="native" aria-pressed="${engine === "native"}">系统原生</button>
          <button class="tts-engine-btn ${engine === "qwen" ? "active" : ""}" type="button" data-action="tts-engine" data-engine="qwen" aria-pressed="${engine === "qwen"}">Qwen 语音</button>
        </div>
      </div>
      ${engine === "qwen" ? (() => {
        const qwen = qwenTtsProfile(draft);
        return `<div class="qwen-tts-panel">
          <div class="tts-row">
            <input id="qwen-tts-model" type="text" data-setting="qwenTtsModel" value="${attr(draft.qwenTtsModel || "qwen-audio-3.1-tts-plus")}" placeholder="qwen-audio-3.1-tts-plus" spellcheck="false" aria-label="Qwen TTS 模型" />
            <input id="qwen-tts-voice" type="text" data-setting="qwenTtsVoice" value="${attr(draft.qwenTtsVoice || "longanhuan_v3.1")}" placeholder="longanhuan_v3.1" spellcheck="false" aria-label="Qwen TTS 音色" />
            <button class="btn btn-secondary tts-test-btn" type="button" data-action="test-tts">${icon("volume")} 试听</button>
          </div>
          ${qwen ? `<p class="tts-line" id="qwen-tts-endpoint">使用「${esc(qwen.name)}」的 API 密钥 · ${esc(qwenTtsEndpoint(qwen, draft.qwenTtsModel))}</p>` : `<p class="tts-line tts-error">还没有可用的 Qwen 密钥。请先在「模型」里填写 Qwen 的 API 密钥。</p>`}
          <p class="tts-line">模型默认 qwen-audio-3.1-tts-plus；音色可填 longanhuan_v3.1 或其他 Qwen 音色。</p>
          <span class="tts-status" id="tts-test-status">${qwen ? "密钥已就绪" : "需要先配置 Qwen 密钥"}</span>
          <p class="tts-line tts-https-warning">密钥只保存在本机；语音请求由浏览器直接发往 Qwen。公共设备建议关闭「记住密钥」。</p>
        </div>`;
      })() : `
        <div class="tts-row">
          <span class="tts-line">点击即读，无需下载</span>
          <button class="btn btn-secondary tts-test-btn" type="button" data-action="test-tts">${icon("volume")} 试听</button>
        </div>
        <span class="tts-status" id="tts-test-status"></span>
        <p class="tts-error" id="tts-error" hidden></p>`}`;
  }


  const PROTOCOL_OPTIONS = [
    { id: "openai", label: "OpenAI 兼容" },
    { id: "google", label: "Google Gemini" }
  ];

  function profileHost(profile) {
    try {
      return new URL(String(profile.baseUrl || "")).host;
    } catch (_) {
      return String(profile.baseUrl || "").replace(/^https?:\/\//, "").split("/")[0] || "未填地址";
    }
  }

  function fetchChannelModels(profile) {
    return LLM.listModels(profile, { timeoutMs: 15_000 });
  }

  function testChannel(profile) {
    return LLM.pingModel(profile, {
      timeoutMs: 20_000,
      prompt: "Reply with the single word: pong",
      maxTokens: 16
    });
  }

  function readProviderForm(previous = {}) {
    const read = (name) => $(`[data-provider-field="${name}"]`)?.value;
    const baseUrl = String(read("baseUrl") ?? previous.baseUrl ?? "").trim();
    const name = String(read("name") ?? previous.name ?? "").trim();
    return {
      id: previous.id || `channel-${Date.now()}`,
      name,
      protocol: previous.protocol || "openai",
      provider: previous.provider || ((previous.protocol === "google") ? "google" : "custom"),
      baseUrl,
      model: String(read("model") ?? previous.model ?? "").trim(),
      apiKey: String(read("apiKey") || previous.apiKey || ""),
      models: previous.models || [],
      note: previous.note || "",
      isNew: Boolean(previous.isNew)
    };
  }

  const CHANNEL_PICKS = {
    google: ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
    openai: ["deepseek-chat", "gpt-4o-mini", "qwen3.7-flash", "moonshot-v1-8k"]
  };

  function channelPicks(profile, models) {
    const picks = CHANNEL_PICKS[(profile.protocol || "openai") === "google" ? "google" : "openai"] || [];
    return picks.filter((id) => models.includes(id));
  }

  function openProviderPicker() {
    openSheetShell({ kicker: "MODEL SETUP", title: "选择供应商" });
    const body = $("#sheet-scroll", overlayRoot);
    if (!body) return;
    body.innerHTML = `
      <div class="template-list">
        ${PROVIDER_TEMPLATES.map((template) => `
          <button class="template-row" type="button" data-action="provider-template" data-template="${attr(template.id)}">
            <span class="template-head">
              <strong>${esc(template.name)}</strong>
              <span class="template-badge">${(template.protocol || "openai") === "google" ? "Gemini" : "OpenAI 兼容"}</span>
            </span>
            <span class="template-url mono">${esc(template.baseUrl || "自行填写地址")}</span>
            <span class="template-note">${esc(template.note || "")}</span>
          </button>`).join("")}
      </div>`;
  }

  function openProviderSheet(profileId, template = null) {
    const draft = state.draft;
    if (!draft) return;
    const existing = profileId ? draft.profiles.find((item) => item.id === profileId) : null;
    state.providerDraft = existing
      ? { ...existing, isNew: false }
      : {
        id: `channel-${Date.now()}`,
        name: template?.name || "",
        protocol: template?.protocol || "openai",
        provider: template?.provider || "custom",
        baseUrl: template?.baseUrl || "",
        model: template?.model || "",
        apiKey: "",
        models: [],
        note: template?.note || "",
        isNew: true
      };
    state.providerStatus = null;
    openSheetShell({ kicker: "MODEL", title: existing ? "编辑模型" : "添加模型" });
    renderProviderSheet();
  }

  function renderProviderSheet() {
    const sheet = $("#sheet-scroll");
    const d = state.providerDraft;
    if (!sheet || !d) return;
    const status = state.providerStatus || {};
    sheet.innerHTML = `
      <div class="provider-form">
        <label class="provider-field"><span>名称</span>
          <input data-provider-field="name" value="${attr(d.name || "")}" placeholder="例如 DeepSeek 主力" autocomplete="off" spellcheck="false" />
        </label>
        <div class="provider-field"><span>协议</span>
          <div class="provider-protocols" role="group" aria-label="协议">
            ${PROTOCOL_OPTIONS.map((item) => `<button class="provider-protocol ${(d.protocol || "openai") === item.id ? "active" : ""}" type="button" data-action="provider-protocol" data-protocol="${item.id}" aria-pressed="${(d.protocol || "openai") === item.id}">${esc(item.label)}</button>`).join("")}
          </div>
        </div>
        <label class="provider-field"><span>Base URL</span>
          <input data-provider-field="baseUrl" value="${attr(d.baseUrl || "")}" inputmode="url" placeholder="${d.protocol === "google" ? "https://generativelanguage.googleapis.com/v1beta" : "https://api.deepseek.com"}" autocomplete="off" spellcheck="false" />
        </label>
        <label class="provider-field"><span>API Key</span>
          <input data-provider-field="apiKey" type="password" value="${attr(d.apiKey || "")}" placeholder="sk-…" autocomplete="off" />
        </label>
        <div class="provider-field"><span>模型</span>
          <div class="provider-model-row">
            <input data-provider-field="model" value="${attr(d.model || "")}" list="provider-model-options" placeholder="先获取，或手动填写" autocomplete="off" spellcheck="false" />
            <button class="btn btn-secondary" type="button" data-action="provider-fetch">获取模型</button>
          </div>
          <datalist id="provider-model-options">
            ${(d.models || []).map((id) => `<option value="${attr(id)}"></option>`).join("")}
          </datalist>
          <p class="provider-hint">${(d.models || []).length ? `${d.models.length} 个可用模型` : "填好地址与密钥后点「获取模型」"}</p>
          ${channelPicks(d, d.models || []).length ? `<div class="provider-picks">${channelPicks(d, d.models || []).map((id, index) => `<button class="provider-pick ${index === 0 ? "primary" : ""}" type="button" data-action="provider-pick" data-model="${attr(id)}">${esc(id)}${index === 0 ? " · 推荐" : ""}</button>`).join("")}</div>` : ""}
          ${(d.models || []).length ? `<div class="provider-models" role="listbox" aria-label="可选模型">
            ${d.models.map((id) => `<button class="provider-model-option ${id === d.model ? "is-current" : ""}" type="button" role="option" aria-selected="${id === d.model}" data-action="provider-pick" data-model="${attr(id)}">${esc(id)}</button>`).join("")}
          </div>` : ""}
        </div>
        <p class="provider-status ${status.tone || ""}">${esc(status.text || "先获取模型，再点测试确认能连通。")}</p>
        <div class="provider-actions">
          <button class="btn btn-secondary" type="button" data-action="provider-test">测试</button>
          <button class="btn btn-primary" type="button" data-action="provider-save">保存</button>
        </div>
        ${d.isNew ? "" : '<button class="link-btn provider-delete" type="button" data-action="provider-delete">删除这个模型</button>'}
      </div>`;
  }

  function modelSettingsHtml(draft) {
    const current = activeProfile(draft);
    return `
      <div class="model-profile-head">
        <span class="settings-subhead">可用模型</span>
        <span class="mono">${draft.profiles.length} 个</span>
      </div>
      ${draft.profiles.length ? "" : '<p class="provider-empty">还没有可用的模型。点下面添加一个，填好密钥就能查词。</p>'}
      <div class="provider-list" role="list" aria-label="模型渠道">
        ${draft.profiles.map((profile) => `
          <div class="provider-row ${profile.id === draft.activeProfileId ? "is-active" : ""}" role="listitem">
            <button class="provider-select" type="button" data-action="provider-select" data-profile="${attr(profile.id)}" aria-pressed="${profile.id === draft.activeProfileId}">
              <span class="provider-row-copy">
                <strong>${esc(profile.model || "未选模型")}</strong>
                <small class="mono">${esc(profile.name || "未命名")} · ${esc(profileHost(profile))}</small>
              </span>
              ${profile.id === draft.activeProfileId ? '<i class="provider-dot" aria-hidden="true"></i>' : ""}
            </button>
            <button class="provider-edit" type="button" data-action="provider-edit" data-profile="${attr(profile.id)}">编辑</button>
          </div>`).join("")}
        <button class="provider-add" type="button" data-action="provider-new">+ 添加模型</button>
      </div>
      <div class="field">
        <label>生成深度</label>
        <div class="detail-switch" role="group" aria-label="生成深度">
          ${Object.entries(DETAIL_LEVELS).map(([id, item]) => `
            <button class="detail-btn ${(draft.detailLevel || "standard") === id ? "active" : ""}" type="button" data-action="detail-level" data-level="${id}" aria-pressed="${(draft.detailLevel || "standard") === id}">${item.label}</button>`).join("")}
        </div>
      </div>
      ${profileSupportsThinking(current) ? `
      <div class="thinking-panel">
        <label class="check-row">
          <input type="checkbox" data-profile-option="enableThinking" ${draft.enableThinking ? "checked" : ""} />
          开启深度思考
        </label>
        <div class="thinking-budget-row">
          <label for="thinking-budget">思考预算（tokens）</label>
          <input id="thinking-budget" type="number" min="0" max="262144" step="128" data-profile-option="thinkingBudget" value="${Number(draft.thinkingBudget) || 0}" inputmode="numeric" />
        </div>
      </div>` : ""}
      <label class="check-row">
        <input type="checkbox" data-setting="remember" ${draft.remember ? "checked" : ""} />
        在这台设备上记住密钥
      </label>
      <div class="key-status ${hasModelConfig(draft) ? "" : "off"}" id="api-test-status">
        ${hasModelConfig(draft) ? `${icon("shield")} <span>已配置 · ${esc(current?.name || draft.model || "自定义")}</span>` : "<span>演示模式 · 无需密钥</span>"}
      </div>
      <div class="settings-inline-actions">
        <button class="btn btn-secondary" type="button" data-action="test-connection" ${draft.profiles.length ? "" : "disabled"}>${icon("sparkle")} 测试当前模型</button>
      </div>
      <p class="api-note"><b>浏览器限制：</b>部分服务商会用 CORS 拦截网页直连；这里失败不代表密钥有误。把地址换成自建代理可以绕开，也能把真实密钥留在服务端。</p>`;
  }

  function dataSettingsHtml(draft) {
    const stats = wordCacheStats();
    const lang = window.TALK_I18N?.lang || "zh";
    return `
      <div class="setting-group">
        <span class="settings-subhead">界面语言</span>
        <div class="level-row">
          <button class="level-chip${lang === "zh" ? " active" : ""}" type="button" data-action="lang" data-lang="zh" aria-pressed="${lang === "zh"}">中文</button>
          <button class="level-chip${lang === "en" ? " active" : ""}" type="button" data-action="lang" data-lang="en" aria-pressed="${lang === "en"}">English</button>
        </div>
      </div>
      <div class="theme-setting">
        <span class="settings-subhead">外观主题</span>
        <div class="theme-list" role="list" aria-label="外观主题">
          ${Object.values(window.TALK_THEME.themes).map((theme) => {
            const active = window.TALK_THEME.current().id === theme.id;
            return `<div class="theme-row${active ? " is-active open" : ""}" role="listitem" data-theme-row="${attr(theme.id)}">
              <button class="theme-row-head" type="button" data-action="theme-toggle" data-theme="${attr(theme.id)}" aria-expanded="${active}">
                <span class="theme-swatch" aria-hidden="true"><i style="background:${attr(theme.themeColor || "#f3f0e7")}"></i><i style="background:${attr(theme.accentFill || theme.accent || "#171813")}"></i></span>
                <span class="theme-row-copy"><strong>${esc(theme.label)}</strong><small>${esc(theme.description || "")}</small></span>
                <span class="theme-row-state">${active ? "使用中" : ""}</span>
                <span class="theme-row-chevron" aria-hidden="true">▾</span>
              </button>
              <div class="theme-row-body">
                <div class="theme-row-inner">
                  <div class="theme-row-actions">
                    ${active
                      ? '<span class="theme-row-current">当前正在使用</span>'
                      : `<button class="btn btn-secondary theme-apply" type="button" data-action="theme" data-theme="${attr(theme.id)}">使用这套主题</button>`}
                  </div>
                </div>
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>
      <div class="setting-group">
        <span class="settings-subhead">学习阶段</span>
        <p class="settings-note">只影响句子模式</p>
        <div class="level-row">
          ${SENTENCE_LEVELS.map((level) => `
            <button class="level-chip${draft.sentenceLevel === level.id ? " active" : ""}" type="button"
              data-action="sentence-level" data-level="${attr(level.id)}" aria-pressed="${draft.sentenceLevel === level.id}"
              title="${attr(level.hint)}">${esc(level.label)}</button>`).join("")}
        </div>
      </div>
      <div class="setting-group">
        <span class="settings-subhead">从句展开方式</span>
        <div class="level-row">
          <button class="level-chip${(draft.foldMode || "block") === "block" ? " active" : ""}" type="button" data-action="fold-mode" data-mode="block" aria-pressed="${(draft.foldMode || "block") === "block"}">缩进块</button>
          <button class="level-chip${draft.foldMode === "inline" ? " active" : ""}" type="button" data-action="fold-mode" data-mode="inline" aria-pressed="${draft.foldMode === "inline"}">句内插入</button>
        </div>
      </div>
      <div class="setting-group">
        <span class="settings-subhead">语境寻词长度</span>
        <p class="settings-note"><span id="reverse-token-value">${Number(draft.reverseMaxTokens) || 1500}</span> tokens · <span id="reverse-token-zone">${reverseZoneName(Number(draft.reverseMaxTokens) || 1500)}</span></p>
        <input class="setting-range" type="range" min="600" max="3000" step="100"
          value="${Number(draft.reverseMaxTokens) || 1500}" data-setting="reverseMaxTokens" aria-label="语境寻词输出上限" />
        <div class="token-scale" id="reverse-token-scale">
          <span class="token-zone${(Number(draft.reverseMaxTokens) || 1500) < 1000 ? " is-active" : ""}" style="flex:4">只给结论</span>
          <span class="token-zone${(Number(draft.reverseMaxTokens) || 1500) >= 1000 && (Number(draft.reverseMaxTokens) || 1500) < 2000 ? " is-active" : ""}" style="flex:10">分块讲解</span>
          <span class="token-zone${(Number(draft.reverseMaxTokens) || 1500) >= 2000 ? " is-active" : ""}" style="flex:10">成句拆解</span>
        </div>
        <div class="token-ticks">
          <span style="left:0">600</span>
          <span style="left:16.7%">1000</span>
          <span style="left:58.3%">2000</span>
          <span style="left:100%">3000</span>
        </div>
      </div>
      <div class="setting-group">
        <span class="settings-subhead">生成信息</span>
        <div class="level-row">
          <button class="level-chip${draft.showGenMeta !== false ? " active" : ""}" type="button" data-action="gen-meta" data-on="1" aria-pressed="${draft.showGenMeta !== false}">显示</button>
          <button class="level-chip${draft.showGenMeta === false ? " active" : ""}" type="button" data-action="gen-meta" data-on="0" aria-pressed="${draft.showGenMeta === false}">隐藏</button>
        </div>
      </div>
      <div class="setting-group">
        <span class="settings-subhead">例句风格</span>
        <p class="settings-note">只影响之后生成的例句</p>
        <div class="example-style-list">
          ${(window.TALK_THEME?.list?.() || []).map((theme) => `
            <label class="example-style-row">
              <span>${esc(theme.label)}</span>
              <input type="text" data-example-style="${attr(theme.id)}" value="${attr(exampleStyleFor(theme.id))}" spellcheck="false" aria-label="${attr(theme.label)} 的例句风格" />
            </label>`).join("")}
        </div>
        <button class="link-btn" type="button" data-action="reset-example-styles">恢复默认风格</button>
      </div>
      <label class="pref-toggle">
        <span class="pref-copy">
          <strong>预加载二级词条</strong>
          <span>词页出现后，在后台生成最多 ${PREFETCH_LIMIT} 个相关词；会额外消耗模型额度。</span>
        </span>
        <span class="pref-switch">
          <input type="checkbox" data-setting="prefetch" ${draft.prefetch ? "checked" : ""} />
          <span class="pref-slider" aria-hidden="true"></span>
        </span>
      </label>
      <div class="cache-display-setting">
        <span class="pref-copy">
          <strong>缓存提示方式</strong>
          <span>虚线未缓存，实线已缓存</span>
        </span>
        <div class="cache-display-switch" role="group" aria-label="缓存提示方式">
          <button class="cache-display-btn ${draft.cacheDisplay !== "corner" ? "active" : ""}" type="button" data-action="cache-display" data-display="borders" aria-pressed="${draft.cacheDisplay !== "corner"}">边框</button>
          <button class="cache-display-btn ${draft.cacheDisplay === "corner" ? "active" : ""}" type="button" data-action="cache-display" data-display="corner" aria-pressed="${draft.cacheDisplay === "corner"}">三角标</button>
        </div>
      </div>
      <div class="cache-settings-summary">
        <span><strong>${stats.count}</strong> / ${stats.max} 个词条</span>
        <span>${formatBytes(stats.bytes)} · ${stats.backend}</span>
      </div>
      <p class="field-hint">句子分析缓存 ${sentenceCache.size} 条（按原文、深度、水平区分），可单独删除或整表清空。</p>
      <div class="cache-actions">
        <button class="btn btn-secondary cache-action-btn" type="button" data-action="open-cache">${icon("archive")} 缓存管理</button>
        <button class="btn btn-secondary cache-action-btn" type="button" data-action="export-word-cache">导出 JSON</button>
        <button class="btn btn-secondary cache-action-btn" type="button" data-action="import-word-cache">导入 JSON</button>
        <button class="btn btn-secondary cache-action-btn" type="button" data-action="clear-sentence-cache">清空句子</button>
        <input id="word-cache-file" type="file" accept="application/json,.json" hidden />
      </div>
      <div class="theme-cache-setting">
        <span class="settings-subhead">主题库</span>
        <div id="theme-cache-stats"><p class="api-note">正在读取主题缓存…</p></div>
        <button class="link-btn" type="button" data-action="clear-theme-cache">清空主题库</button>
      </div>
      <div class="diag-card">
        <span class="settings-subhead">运行日志</span>
        <p class="api-note">只记录请求类型、字符数与错误文本；密钥、令牌和长串已脱敏。出问题时复制它发给开发者。</p>
        <pre class="diag-preview" id="diag-preview">${esc(diagText().split("\n").slice(-9).join("\n"))}</pre>
        <div class="cache-actions">
          <button class="btn btn-secondary cache-action-btn" type="button" data-action="copy-diagnostics">${icon("copy")} 复制诊断</button>
          <button class="btn btn-secondary cache-action-btn" type="button" data-action="clear-diagnostics">清空日志</button>
        </div>
      </div>
      <button class="btn btn-secondary install-settings-btn" id="install-app" type="button" data-action="install-app" ${state.installPrompt ? "" : "hidden"}>${icon("external")} 安装到主屏幕</button>
`;
  }

  function renderSettingsContent() {
    window.setTimeout(() => window.TALK_I18N?.apply(document.body), 0);
    const holder = $("#sheet-scroll");
    if (!holder || !state.draft) return;
    const draft = state.draft;
    const tab = state.settingsTab || "model";
    const settingsCopy = copyFor("settings");
    const tabs = settingsCopy.tabs;
    const sheetTitle = $(".sheet-title", overlayRoot);
    if (sheetTitle) sheetTitle.textContent = settingsCopy.title;
    const sheetKicker = $(".sheet-head .mono", overlayRoot);
    if (sheetKicker) sheetKicker.textContent = settingsCopy.kicker;
    holder.innerHTML = `
      <div class="sheet-content settings-sheet">
        <div class="settings-tabs" role="tablist" aria-label="设置分类">
          ${tabs.map(([id, label]) => `<button class="settings-tab ${tab === id ? "active" : ""}" type="button" role="tab" aria-selected="${tab === id}" data-action="settings-tab" data-tab="${id}">${label}</button>`).join("")}
        </div>
        <div class="settings-pane" role="tabpanel">
          ${tab === "tts" ? ttsSettingsHtml(draft) : tab === "data" ? dataSettingsHtml(draft) : modelSettingsHtml(draft)}
        </div>
        <div class="settings-footer">
          <span id="settings-save-status"><span data-app-version>v${APP_VERSION}</span> · build <span data-app-build>${APP_BUILD}</span> · ${state.settingsDirty ? "正在保存…" : "更改自动保存"}</span>
          <button class="btn btn-primary" type="button" data-action="save-settings">完成</button>
        </div>
      </div>`;
    if (tab === "tts") requestAnimationFrame(refreshTtsError);
    if (tab === "data") requestAnimationFrame(renderThemeCacheStats);
  }

  function refreshCacheUi() {
    if ($("#cache-dashboard")) {
      void renderCacheContent();
    } else if (state.sheetOpen && $("#sheet-scroll .settings-intro")) {
      renderSettingsContent();
    }
  }

  function openCacheSheet() {
    openSheetShell({ kicker: "本机数据", title: "缓存与空间" });
    void renderCacheContent();
  }

  async function renderCacheContent() {
    const holder = $("#sheet-scroll");
    if (!holder) return;
    holder.innerHTML = `<div class="sheet-content" id="cache-dashboard"><p class="settings-intro">正在读取本机缓存…</p></div>`;
    const words = wordCacheStats();
    const audio = await getAudioStats();
    if (!holder.isConnected) return;
    const estimate = wordCacheEstimate();
    const percent = Math.min(100, words.max ? (words.count / words.max) * 100 : 0);
    const totalBytes = words.bytes + audio.bytes;
    const recent = words.entries.slice(0, 24);
    holder.innerHTML = `
      <div class="sheet-content" id="cache-dashboard">
        <p class="settings-intro">只存本机；导出不含音频。</p>
        <div class="cache-summary-grid">
          <div class="cache-summary-card">
            <span class="cache-summary-label">词条</span>
            <strong>${words.count}<small> / ${words.max}</small></strong>
            <span>${formatBytes(words.bytes)} · ${words.ttlDays} 天</span>
          </div>
          <div class="cache-summary-card">
            <span class="cache-summary-label">语音</span>
            <strong>${audio.count}</strong>
            <span>${formatBytes(audio.bytes)}</span>
          </div>
          <div class="cache-summary-card accent">
            <span class="cache-summary-label">合计</span>
            <strong>${formatBytes(totalBytes)}</strong>
            <span>${words.backend}</span>
          </div>
        </div>
        <div class="cache-meter" aria-label="词条缓存占用 ${percent.toFixed(0)}%">
          <span style="width:${percent}%"></span>
        </div>
        <div class="cache-limit-grid">
          <label>词条上限
            <input type="number" min="10" max="2000" step="10" value="${words.max}" data-cache-setting="cacheMax" inputmode="numeric" />
          </label>
          <label>保留天数
            <input type="number" min="1" max="3650" step="1" value="${words.ttlDays}" data-cache-setting="cacheTtlDays" inputmode="numeric" />
          </label>
        </div>
        <p class="cache-estimate" id="cache-estimate">按当前平均 ${formatBytes(estimate.average)}/词条估算，上限占用约 <strong>${estimate.label}</strong>。</p>
        <div class="cache-list-head">
          <span class="settings-subhead">已缓存词条</span>
          <span class="mono">${words.count} 条</span>
        </div>
        ${recent.length ? `<div class="cache-word-list">
          ${recent.map((entry) => `<button class="cache-word-item" type="button" data-action="word" data-word="${attr(entry.key)}">
            <span><strong>${esc(entry.word)}</strong><small>${esc(entry.detail)} · ${formatBytes(entry.bytes)}</small></span>
            <span class="cache-word-date">${entry.at ? new Date(entry.at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) : "—"}</span>
          </button>`).join("")}
        </div>` : `<p class="field-hint">还没有缓存词条。查一个模型词条后，它会出现在这里。</p>`}
        ${words.count > recent.length ? `<p class="field-hint">只显示最近 ${recent.length} 条，共 ${words.count} 条。</p>` : ""}
        <div class="cache-actions">
          <button class="btn btn-secondary cache-action-btn" type="button" data-action="export-word-cache">导出 JSON</button>
          <button class="btn btn-secondary cache-action-btn" type="button" data-action="import-word-cache">导入 JSON</button>
          <button class="link-btn" type="button" data-action="clear-word-cache">清空词条</button>
          <button class="link-btn" type="button" data-action="clear-sentence-cache">清空句子</button>
          <button class="link-btn" type="button" data-action="clear-audio-cache">清空语音</button>
          <input id="word-cache-file" type="file" accept="application/json,.json" hidden />
        </div>
      </div>`;
  }

  let historySheetTab = "history"; // "history" | "wordbooks"
  let historySubTab = "recent";    // "recent" | "reverse"
  let activeWordbookId = null;     // null = shelf list, string = book detail
  let wordbookImportOpen = false;
  let wordbookMenuOpen = false;
  let wordbookAuditNote = "";
  let wordbookSorting = false;
  let wordbookExtracting = false;

  function openHistorySheet(defaultTab) {
    syncSavedFromWordbooks();
    const translating = state.module === "translator";
    if (defaultTab === "saved" || defaultTab === "wordbooks") {
      historySheetTab = "wordbooks";
    } else if (defaultTab === "reverse") {
      historySheetTab = "history";
      historySubTab = "reverse";
    } else if (defaultTab === "recent" || defaultTab === "history") {
      historySheetTab = "history";
      historySubTab = "recent";
    } else if (state.module === "reader" && state.saved.length) {
      historySheetTab = "wordbooks";
    } else {
      historySheetTab = "history";
    }
    wordbookImportOpen = false;
    openSheetShell({
      kicker: translating ? "TRANSLATION" : "ARCHIVE",
      title: translating ? "最近翻译" : "历史与书库"
    });
    renderHistoryContent();
  }

  function historyForCurrentModule() {
    const translating = state.module === "translator";
    return state.history.filter((item) =>
      translating ? item.type === "translation" : item.type !== "translation"
    );
  }

  function isTermLocallyCached(term) {
    const entry = parseSavedEntry(term);
    if (!entry.text) return false;
    if (entry.kind === "chunk") return Boolean(cacheGetChunk(entry.text) || DATA.chunks?.[chunkSlug(entry.text)]);
    if (entry.kind === "word") return Boolean(cacheGetWord(entry.text) || DATA.words?.[normalizeWord(entry.text)]);
    return false;
  }

  function renderWordbooksPanel() {
    const wb = window.TALK_WORDBOOKS;
    if (!wb) return '<div class="history-empty">词汇书库模块未加载。</div>';
    wb.loadStore(state.saved);
    const books = wb.listBooks();
    const st = wb.stats();

    const importBox = wordbookImportOpen ? `
      <div class="wb-import-box" data-surface="inset">
        <div class="wb-import-head">
          <span>导入到「${esc(wb.getBook(activeWordbookId)?.name || wb.DEFAULT_BOOK_NAME)}」</span>
          <button class="wb-text-btn" type="button" data-action="wb-import-close" aria-label="关闭导入">取消</button>
        </div>
        <textarea id="wb-import-textarea" class="wb-import-ta" rows="3" placeholder="每行一词，或粘贴 CSV / JSON 备份"></textarea>
        <p class="wb-import-hint" id="wb-import-hint" role="status"></p>
        <div class="wb-import-actions">
          <label class="wb-text-btn wb-file-btn">
            选择文件
            <input id="wb-import-file" type="file" accept=".txt,.csv,.json,text/plain,text/csv,application/json" hidden />
          </label>
          <div class="wb-text-actions">
            ${hasModelConfig() ? `<button class="wb-text-btn" type="button" data-action="wb-import-extract" ${wordbookExtracting ? "disabled" : ""}>${wordbookExtracting ? "提取中…" : "AI 提取"}</button>` : ""}
            <button class="wb-text-btn is-accent" type="button" data-action="wb-import-submit" ${wordbookExtracting ? "disabled" : ""}>导入</button>
          </div>
        </div>
      </div>` : "";

    const auditBanner = wordbookAuditNote ? `
      <div class="wb-audit-strip">
        <span>${esc(wordbookAuditNote)}</span>
        <button class="wb-text-btn" type="button" data-action="wb-dismiss-audit">知道了</button>
      </div>` : "";

    // View A: Quiet editorial vertical list of books
    if (!activeWordbookId) {
      return `
        ${auditBanner}
        <div class="wb-list-header">
          <span class="wb-list-meta">${st.bookCount} 本分册 · ${st.uniqueWords} 词</span>
          <div class="wb-text-actions">
            <button class="wb-text-btn" type="button" data-action="wb-create-book">+ 新建</button>
            <div class="wb-menu-wrap">
              <button class="wb-text-btn" type="button" data-action="wb-toggle-menu" aria-expanded="${wordbookMenuOpen}">···</button>
              ${wordbookMenuOpen ? `
                <div class="wb-pop-menu" role="menu">
                  <button class="wb-pop-item" type="button" data-action="wb-import-open">批量导入</button>
                  <button class="wb-pop-item" type="button" data-action="wb-export-json">导出 JSON</button>
                </div>` : ""}
            </div>
          </div>
        </div>
        ${importBox}
        <div class="wb-editorial-list">
          ${books.map((book) => {
            const cachedCount = book.items.filter((it) => isTermLocallyCached(it.term)).length;
            return `
              <button class="wb-list-row" type="button" data-action="wb-open-book" data-book-id="${attr(book.id)}">
                <span class="wb-row-main">
                  <strong class="wb-row-title">${esc(book.name)}</strong>
                  ${book.system ? '<span class="wb-pin-tag">未分类</span>' : ""}
                </span>
                <span class="wb-row-right" title="已缓存 ${cachedCount} 词">
                  <span>${book.items.length} 词</span>
                  <span aria-hidden="true">›</span>
                </span>
              </button>`;
          }).join("")}
        </div>`;
    }

    // View B: Clean single-book detail with AI 分册 + ··· menu
    const book = wb.getBook(activeWordbookId) || books[0];
    if (!book) {
      activeWordbookId = null;
      return renderWordbooksPanel();
    }
    const otherBooks = books.filter((b) => b.id !== book.id);

    return `
      ${auditBanner}
      <div class="wb-list-header">
        <button class="wb-text-btn wb-back-link" type="button" data-action="wb-back-shelf">← ${esc(book.name)} <span class="wb-list-meta">${book.items.length}</span></button>
        <div class="wb-text-actions">
          ${book.items.length >= 2 && hasModelConfig() ? `<button class="wb-text-btn is-accent" type="button" data-action="wb-ai-sort" data-book-id="${attr(book.id)}" ${wordbookSorting ? "disabled" : ""}>${wordbookSorting ? "分册中…" : "AI 分册"}</button>` : ""}
          <div class="wb-menu-wrap">
            <button class="wb-text-btn" type="button" data-action="wb-toggle-menu" aria-expanded="${wordbookMenuOpen}">···</button>
            ${wordbookMenuOpen ? `
              <div class="wb-pop-menu" role="menu">
                ${book.items.length >= 1 ? `<button class="wb-pop-item" type="button" data-action="wb-to-reader" data-book-id="${attr(book.id)}">生成精读</button>` : ""}
                <button class="wb-pop-item" type="button" data-action="wb-import-open">导入词条</button>
                ${book.items.length ? `<button class="wb-pop-item" type="button" data-action="wb-export-txt" data-book-id="${attr(book.id)}">导出 .txt</button>` : ""}
                ${!book.system ? `<button class="wb-pop-item" type="button" data-action="wb-rename-book" data-book-id="${attr(book.id)}">重命名</button>` : ""}
                ${!book.system ? `<button class="wb-pop-item is-danger" type="button" data-action="wb-delete-book" data-book-id="${attr(book.id)}">删除分册</button>` : ""}
              </div>` : ""}
          </div>
        </div>
      </div>
      ${importBox}
      ${book.items.length ? `
        <div class="wb-editorial-list">
          ${book.items.map((item) => {
            const entry = parseSavedEntry(item.term);
            const cached = isTermLocallyCached(item.term);
            return `
              <div class="wb-list-row wb-word-item">
                <button class="wb-word-trigger" type="button" data-action="saved-item" data-term="${attr(item.term)}">
                  <span class="wb-cache-dot ${cached ? "is-cached" : ""}" title="${cached ? "本机已有词条缓存" : "未查词（点开按需查询）"}"></span>
                  <strong class="wb-row-title notranslate" translate="no" lang="en">${esc(shorten(entry.label, 42))}</strong>
                </button>
                <span class="wb-row-right">
                  ${otherBooks.length ? `<button class="wb-text-btn wb-mini-act" type="button" data-action="wb-move-term" data-term="${attr(item.term)}" data-book-id="${attr(book.id)}" title="移到其他分册">换册</button>` : ""}
                  <button class="wb-text-btn wb-mini-del" type="button" data-action="wb-remove-term" data-term="${attr(item.term)}" data-book-id="${attr(book.id)}" aria-label="移出本册" title="移出本册">×</button>
                </span>
              </div>`;
          }).join("")}
        </div>` : `
        <div class="history-empty">「${esc(book.name)}」暂无词条</div>`}`;
  }

  function renderHistoryContent() {
    const holder = $("#sheet-scroll");
    if (!holder) return;
    const items = historyForCurrentModule();
    const translating = state.module === "translator";
    const revThreads = listReverseThreads();
    const wbStats = window.TALK_WORDBOOKS ? window.TALK_WORDBOOKS.stats() : { uniqueWords: state.saved.length };
    const topTab = historySheetTab === "wordbooks" ? "wordbooks" : "history";
    const subTab = historySubTab === "reverse" ? "reverse" : "recent";

    const topTabsHtml = `
      <div class="history-tabs" role="tablist">
        <button class="history-tab ${topTab === "history" ? "active" : ""}" type="button" role="tab" aria-selected="${topTab === "history"}" data-action="history-tab" data-tab="history">${translating ? "最近翻译" : "历史记录"} (${items.length + revThreads.length})</button>
        <button class="history-tab ${topTab === "wordbooks" ? "active" : ""}" type="button" role="tab" aria-selected="${topTab === "wordbooks"}" data-action="history-tab" data-tab="wordbooks">词汇书库 (${wbStats.uniqueWords})</button>
      </div>`;

    let bodyHtml = "";
    if (topTab === "wordbooks") {
      bodyHtml = renderWordbooksPanel();
    } else {
      const subPills = !translating ? `
        <div class="wb-sub-pills" role="tablist">
          <button class="wb-sub-pill${subTab === "recent" ? " active" : ""}" type="button" data-action="history-subtab" data-subtab="recent">最近查询 (${items.length})</button>
          <button class="wb-sub-pill${subTab === "reverse" ? " active" : ""}" type="button" data-action="history-subtab" data-subtab="reverse">寻词记录 (${revThreads.length})</button>
        </div>` : "";

      const recentBody = items.length ? `
        <div class="history-list">
          ${items.map((item) => `
            <button class="history-item" type="button" data-action="history-item" data-query="${attr(item.query)}" data-type="${attr(item.type)}">
              <span class="history-icon ${item.type === "sentence" ? "sentence" : item.type === "translation" ? "translation" : ""}">${item.type === "sentence" ? icon("sentence") : item.type === "translation" ? icon("sparkle") : icon("book")}</span>
              <span class="history-copy">
                <strong>${esc(shorten(item.query, 44))}</strong>
                <span>${item.type === "sentence" ? "句子" : item.type === "translation" ? "翻译" : "单词"} · ${esc(timeAgo(item.at))}</span>
              </span>
            </button>`).join("")}
        </div>
        <div class="settings-actions">
          <button class="btn btn-secondary" type="button" data-action="clear-history" data-scope="${translating ? "translation" : "dictionary"}">${icon("trash")} ${translating ? "清空翻译记录" : "清空词典记录"}</button>
        </div>` : `
        <div class="history-empty">${translating ? "还没有翻译记录。<br />译一句，它会在这里等你。" : "还没有查询记录。<br />查一个词，它会在这里等你。"}</div>`;

      const reverseBody = revThreads.length ? `
        <div class="history-list">
          ${revThreads.map((entry) => {
            const turns = Math.max(1, Math.ceil((entry.messages?.length || 0) / 2));
            const isCurrent = state.route?.name === "reverse" && state.reverseThreadId === entry.id;
            return `
              <div class="saved-row">
                <button class="history-item saved-item-btn${isCurrent ? " is-current" : ""}" type="button" data-action="reverse-open-thread" data-id="${attr(entry.id)}">
                  <span class="history-icon">${icon("sparkle")}</span>
                  <span class="history-copy">
                    <strong>${esc(shorten(entry.title || "语境寻词", 44))}</strong>
                    <span>${turns} 轮对话 · ${esc(timeAgo(entry.updatedAt || Date.now()))}${isCurrent ? " · 当前" : ""}</span>
                  </span>
                </button>
                <button class="saved-remove-btn" type="button" data-action="reverse-delete-thread" data-id="${attr(entry.id)}" aria-label="删除对话" title="删除对话">×</button>
              </div>`;
          }).join("")}
        </div>
        <div class="settings-actions">
          <button class="btn btn-secondary" type="button" data-action="clear-reverse-threads">${icon("trash")} 清空寻词记录</button>
        </div>` : `
        <div class="history-empty">还没有语境寻词记录。<br />问一次 AI，对话会自动留在这里。</div>`;

      bodyHtml = `${subPills}${subTab === "reverse" && !translating ? reverseBody : recentBody}`;
    }

    holder.innerHTML = `<div class="sheet-content">${topTabsHtml}${bodyHtml}</div>`;
    const fileInput = $("#wb-import-file", holder);
    if (fileInput) {
      fileInput.addEventListener("change", async () => {
        const f = fileInput.files?.[0];
        if (!f || !window.TALK_WORDBOOKS) return;
        try {
          const text = await f.text();
          const res = window.TALK_WORDBOOKS.importData(text, activeWordbookId || window.TALK_WORDBOOKS.DEFAULT_BOOK_ID);
          syncSavedFromWordbooks();
          wordbookImportOpen = false;
          wordbookAuditNote = `导入核对：导入前 ${res.before.uniqueWords} 词 → 导入后 ${res.after.uniqueWords} 词（新增 ${res.added}，去重跳过 ${res.skipped}）`;
          renderHistoryContent();
          toast(`已导入 ${res.added} 词`);
        } catch (err) {
          toast(err?.message || "文件读取失败");
        }
      });
    }
  }

  /* ============================================================
     Settings actions
     ============================================================ */

  function saveSettings() {
    if (!state.draft) return;
    flushSettingsDraft();
    closeSheet();
    const topLayer = state.wordLayers[state.wordLayers.length - 1];
    if (topLayer && !topLayer.data) void hydrateLayerWithModel(topLayer);
    const active = activeWordData();
    if (active) schedulePrefetch(active);
    toast(hasModelConfig() ? "设置已保存" : "已切换到演示模式");
  }

  async function testConnection() {
    if (!state.draft) return;
    const status = $("#api-test-status");
    if (!status) return;
    if (!hasModelConfig(state.draft)) {
      status.className = "key-status off";
      status.innerHTML = "<span>填入密钥，或把地址指向本地服务。</span>";
      return;
    }
    status.className = "key-status";
    status.innerHTML = `<span>正在测试 ${esc(state.draft.model || "模型")}…</span>`;
    const result = await LLM.pingModel(state.draft, {
      timeoutMs: 30_000,
      prompt: "Reply with exactly: OK",
      maxTokens: 16
    });
    if (result.ok) {
      status.className = "key-status";
      status.innerHTML = `${icon("check")} <span>已连接 ${esc(state.draft.model || "模型")} · ${result.ms} ms</span>`;
    } else {
      status.className = "key-status off";
      status.innerHTML = `<span>${esc(shorten(result.text, 140))}</span>`;
    }
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
    const action = target.dataset.action;

    if (actions.has(action)) {
      await actions.dispatch(action, { event, target });
      return;
    }

    switch (action) {
      case "home":
        event.preventDefault();
        tapFeedback();
        navigate({ name: "home" }, { direction: "back" });
        break;

      case "back":
        event.preventDefault();
        goBack();
        break;

      case "layer-back":
        event.preventDefault();
        popWordLayer();
        break;

      case "retry-layer":
        event.preventDefault();
        tapFeedback();
        if (state.wordLayers.length) void hydrateLayerWithModel(state.wordLayers[state.wordLayers.length - 1]);
        break;

      case "cache-status":
        event.preventDefault();
        toast(cacheCorner?.dataset.label || "缓存状态");
        break;

      case "settings":
        event.preventDefault();
        tapFeedback();
        openSettingsSheet();
        break;

      case "history":
        event.preventDefault();
        tapFeedback();
        openHistorySheet();
        break;

      case "module": {
        event.preventDefault();
        const rawMod = target.dataset.module;
        const module = rawMod === "translator" ? "translator" : rawMod === "reader" ? "reader" : "dictionary";
        if (module === state.module) break;
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
        break;
      }

      case "mode": {
        event.preventDefault();
        state.mode = target.dataset.mode || "auto";
        $$(".mode-btn", screen).forEach((button) => {
          const active = button.dataset.mode === state.mode;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", String(active));
        });
        updateSearchMeta();
        break;
      }

      case "lookup":
        event.preventDefault();
        tapFeedback();
        closeSheet({ immediate: true });
        runSearch(target.dataset.query || "", target.dataset.type || "auto");
        break;

      case "word":
        event.preventDefault();
        tapFeedback();
        openWordRoute(target.dataset.word || "");
        break;

      case "open-key":
        event.preventDefault();
        tapFeedback();
        openKeySheet(Number(target.dataset.index || 0));
        break;

      case "word-layer":
        event.preventDefault();
        tapFeedback();
        openWordLayerFromButton(target);
        break;

      case "sheet-word":
        event.preventDefault();
        tapFeedback();
        openWordLayerFromButton(target);
        break;

      case "sheet-back":
        event.preventDefault();
        goBackInSheet();
        break;

      case "close-sheet":
        event.preventDefault();
        if (target.classList.contains("sheet-backdrop") && performance.now() - state.sheetOpenedAt < 480) break;
        closeSheet();
        break;

      case "full-entry":
        event.preventDefault();
        openWordLayerFromButton(target);
        break;

      case "save":
        event.preventDefault();
        toggleSaved(target);
        break;

      case "sentence-level": {
        event.preventDefault();
        const level = sentenceLevelOf(target.dataset.level);
        if (state.draft) state.draft.sentenceLevel = level.id;
        scheduleSettingsCommit();
        $$(".level-chip").forEach((chip) => {
          const active = chip.dataset.level === level.id;
          chip.classList.toggle("active", active);
          chip.setAttribute("aria-pressed", String(active));
        });
        break;
      }

      case "gen-meta": {
        event.preventDefault();
        const on = target.dataset.on === "1";
        if (state.draft) state.draft.showGenMeta = on;
        scheduleSettingsCommit();
        break;
      }

      case "fold-mode": {
        event.preventDefault();
        const mode = target.dataset.mode === "inline" ? "inline" : "block";
        if (state.draft) state.draft.foldMode = mode;
        scheduleSettingsCommit();
        $$('[data-action="fold-mode"]').forEach((chip) => {
          const active = chip.dataset.mode === mode;
          chip.classList.toggle("active", active);
          chip.setAttribute("aria-pressed", String(active));
        });
        if (state.route?.name === "sentence") refreshThemedPage();
        break;
      }

      case "reset-example-styles": {
        event.preventDefault();
        saveExampleStyles({});
        $$("[data-example-style]").forEach((input) => {
          input.value = exampleStyleFor(input.dataset.exampleStyle);
        });
        toast("已恢复默认例句风格");
        break;
      }

      case "copy":
        event.preventDefault();
        copyCurrentPage();
        break;

      case "copy-text": {
        event.preventDefault();
        const text = target.dataset.copy || "";
        if (!text) break;
        void copyText(text).then((copied) => toast(copied ? "已复制" : "这个浏览器不允许复制"));
        break;
      }

      case "theme-toggle": {
        event.preventDefault();
        const row = target.closest(".theme-row");
        if (!row) break;
        const willOpen = !row.classList.contains("open");
        $$(".theme-row.open").forEach((other) => {
          other.classList.remove("open");
          const head = other.querySelector(".theme-row-head");
          if (head) head.setAttribute("aria-expanded", "false");
        });
        row.classList.toggle("open", willOpen);
        target.setAttribute("aria-expanded", String(willOpen));
        break;
      }

      case "lang": {
        event.preventDefault();
        const next = target.dataset.lang === "en" ? "en" : "zh";
        window.TALK_I18N?.set(next);
        if (state.draft) state.draft.lang = next;
        renderSettingsContent();
        window.TALK_I18N?.apply(document.body);
        toast(next === "en" ? "Interface set to English" : "界面已切换为中文");
        break;
      }

      case "theme":
        event.preventDefault();
        window.TALK_THEME.apply(target.dataset.theme);
        applyContentCopy();
        refreshThemedPage();
        if (state.route?.name === "word") {
          const current = getWord(state.route);
          if (current) scheduleThemeExamples(current);
        }
        renderSettingsContent();
        break;

      case "settings-tab":
        event.preventDefault();
        state.settingsTab = target.dataset.tab || "model";
        renderSettingsContent();
        $("#sheet-scroll")?.scrollTo({ top: 0 });
        break;

      case "select-profile": {
        event.preventDefault();
        if (!state.draft) break;
        syncDraftProfile(state.draft);
        const profile = state.draft.profiles.find((item) => item.id === target.dataset.profile);
        if (!profile) break;
        state.draft = applyProfileToSettings(state.draft, profile);
        scheduleSettingsCommit();
        renderSettingsContent();
        break;
      }

      case "provider-new":
        event.preventDefault();
        if (!state.draft) break;
        syncDraftProfile(state.draft);
        openProviderPicker();
        break;

      case "provider-template": {
        event.preventDefault();
        const template = PROVIDER_TEMPLATES.find((item) => item.id === target.dataset.template) || CUSTOM_TEMPLATE;
        openProviderSheet(null, template);
        break;
      }

      case "provider-select": {
        event.preventDefault();
        const profile = state.draft?.profiles.find((item) => item.id === target.dataset.profile);
        if (!profile || profile.id === state.draft.activeProfileId) break;
        syncDraftProfile(state.draft);
        state.draft = applyProfileToSettings(state.draft, profile);
        commitSettingsDraft();
        renderSettingsContent();
        toast(`已切换到 ${profile.model || profile.name}`);
        break;
      }

      case "provider-edit":
        event.preventDefault();
        if (!state.draft) break;
        syncDraftProfile(state.draft);
        openProviderSheet(target.dataset.profile || null);
        break;

      case "provider-protocol": {
        event.preventDefault();
        const next = readProviderForm(state.providerDraft);
        next.protocol = target.dataset.protocol || "openai";
        next.provider = next.protocol === "google" ? "google" : (next.provider === "google" ? "custom" : next.provider);
        next.models = [];
        state.providerDraft = next;
        renderProviderSheet();
        break;
      }

      case "provider-pick":
        event.preventDefault();
        if (state.providerDraft && target.dataset.model) {
          state.providerDraft.model = target.dataset.model;
          const input = $('[data-provider-field="model"]');
          if (input) input.value = target.dataset.model;
        }
        break;

      case "provider-fetch": {
        event.preventDefault();
        const profile = readProviderForm(state.providerDraft);
        if (!profile.baseUrl) { toast("先填 Base URL"); break; }
        state.providerDraft = profile;
        state.providerStatus = { tone: "", text: "正在获取模型…" };
        renderProviderSheet();
        try {
          const models = await fetchChannelModels(profile);
          state.providerDraft = { ...profile, models, model: profile.model || models[0] || "" };
          state.providerStatus = models.length
            ? { tone: "ok", text: `找到 ${models.length} 个模型，选一个再测试。` }
            : { tone: "bad", text: "没有取到模型；可以手动填写模型名。" };
        } catch (error) {
          state.providerStatus = { tone: "bad", text: `获取失败：${error.message}` };
        }
        renderProviderSheet();
        break;
      }

      case "provider-test": {
        event.preventDefault();
        const profile = readProviderForm(state.providerDraft);
        if (!profile.baseUrl || !profile.model) { toast("地址与模型都要填"); break; }
        state.providerDraft = profile;
        state.providerStatus = { tone: "", text: "正在测试…" };
        renderProviderSheet();
        const result = await testChannel(profile);
        state.providerStatus = result.ok
          ? { tone: "ok", text: `连通 · ${result.ms} ms · 回复「${result.text}」` }
          : { tone: "bad", text: `失败 · ${result.ms} ms · ${result.text}` };
        renderProviderSheet();
        break;
      }

      case "provider-save": {
        event.preventDefault();
        const profile = readProviderForm(state.providerDraft);
        if (!profile.baseUrl || !profile.model) { toast("地址与模型都要填"); break; }
        const clean = { ...profile };
        delete clean.isNew;
        if (!clean.name) clean.name = profileHost(clean);
        const draft = state.draft;
        const index = draft.profiles.findIndex((item) => item.id === clean.id);
        if (index >= 0) draft.profiles[index] = clean;
        else draft.profiles.push(clean);
        state.draft = applyProfileToSettings(draft, clean);
        commitSettingsDraft();
        closeSheet();
        openSettingsSheet();
        renderSettingsContent();
        toast("模型已保存");
        break;
      }

      case "provider-delete": {
        event.preventDefault();
        const profile = state.providerDraft;
        if (!profile || !state.draft) break;
        if (!window.confirm(`删除「${profile.model || profile.name || "这个模型"}」？`)) break;
        state.draft.profiles = state.draft.profiles.filter((item) => item.id !== profile.id);
        state.draft = state.draft.profiles.length
          ? applyProfileToSettings(state.draft, state.draft.profiles[0])
          : { ...state.draft, activeProfileId: "", baseUrl: "", model: "", apiKey: "" };
        commitSettingsDraft();
        closeSheet();
        openSettingsSheet();
        renderSettingsContent();
        break;
      }

      case "delete-profile": {
        event.preventDefault();
        if (!state.draft || state.draft.profiles.length <= 1) break;
        const current = activeProfile(state.draft);
        if (!current) break;
        if (!window.confirm(`删除「${current.name}」？`)) break;
        state.draft.profiles = state.draft.profiles.filter((item) => item.id !== current.id);
        const next = state.draft.profiles[0];
        state.draft = applyProfileToSettings(state.draft, next);
        scheduleSettingsCommit();
        renderSettingsContent();
        break;
      }

      case "shuffle-moods":
        event.preventDefault();
        state.moodOffset += 3;
        renderMoods();
        tapFeedback();
        break;

      case "detail-level":
        event.preventDefault();
        if (!state.draft) break;
        state.draft.detailLevel = target.dataset.level || "standard";
        scheduleSettingsCommit();
        renderSettingsContent();
        break;

      case "tts-engine":
        event.preventDefault();
        if (!state.draft) break;
        state.draft.ttsEngine = target.dataset.engine === "qwen" ? "qwen" : "native";
        scheduleSettingsCommit();
        renderSettingsContent();
        break;

      case "cache-display":
        event.preventDefault();
        if (!state.draft) break;
        state.draft.cacheDisplay = target.dataset.display === "corner" ? "corner" : "borders";
        scheduleSettingsCommit();
        renderSettingsContent();
        break;

      case "save-settings":
        event.preventDefault();
        saveSettings();
        break;

      case "test-connection":
        event.preventDefault();
        testConnection();
        break;

      case "history-item":
        event.preventDefault();
        closeSheet({ immediate: true });
        if (target.dataset.type === "translation") {
          const text = String(target.dataset.query || "").trim();
          navigate({ name: "translator", text });
          break;
        }
        runSearch(target.dataset.query || "", target.dataset.type || "auto");
        break;

      case "history-tab": {
        event.preventDefault();
        historySheetTab = target.dataset.tab === "wordbooks" ? "wordbooks" : "history";
        wordbookAuditNote = "";
        renderHistoryContent();
        break;
      }

      case "history-subtab": {
        event.preventDefault();
        historySubTab = target.dataset.subtab === "reverse" ? "reverse" : "recent";
        renderHistoryContent();
        break;
      }

      case "wb-toggle-menu": {
        event.preventDefault();
        wordbookMenuOpen = !wordbookMenuOpen;
        renderHistoryContent();
        break;
      }

      case "wb-dismiss-audit": {
        event.preventDefault();
        wordbookAuditNote = "";
        renderHistoryContent();
        break;
      }

      case "wb-open-book": {
        event.preventDefault();
        activeWordbookId = target.dataset.bookId || window.TALK_WORDBOOKS?.DEFAULT_BOOK_ID || null;
        wordbookMenuOpen = false;
        wordbookImportOpen = false;
        wordbookAuditNote = "";
        renderHistoryContent();
        break;
      }

      case "wb-back-shelf": {
        event.preventDefault();
        activeWordbookId = null;
        wordbookImportOpen = false;
        wordbookMenuOpen = false;
        wordbookAuditNote = "";
        renderHistoryContent();
        break;
      }

      case "wb-create-book": {
        event.preventDefault();
        const name = window.prompt("新建主题词汇书名称（如：科技与产品、外刊高频）");
        if (!name || !name.trim() || !window.TALK_WORDBOOKS) break;
        const created = window.TALK_WORDBOOKS.createBook(name.trim());
        if (created) {
          activeWordbookId = created.id;
          renderHistoryContent();
          toast(`已新建「${created.name}」`);
        }
        break;
      }

      case "wb-rename-book": {
        event.preventDefault();
        wordbookMenuOpen = false;
        const bid = target.dataset.bookId;
        const book = window.TALK_WORDBOOKS?.getBook(bid);
        if (!book || book.system) break;
        const next = window.prompt("重命名词汇书", book.name);
        if (next && next.trim() && window.TALK_WORDBOOKS.renameBook(bid, next.trim())) {
          renderHistoryContent();
          toast("已重命名");
        }
        break;
      }

      case "wb-delete-book": {
        event.preventDefault();
        wordbookMenuOpen = false;
        const bid = target.dataset.bookId;
        const book = window.TALK_WORDBOOKS?.getBook(bid);
        if (!book || book.system) break;
        if (!window.confirm(`删除「${book.name}」？里面的 ${book.items.length} 个词会自动退回「密集书库」，不会丢失。`)) break;
        const res = window.TALK_WORDBOOKS.deleteBook(bid, { rescueToDense: true });
        if (res.ok) {
          syncSavedFromWordbooks();
          activeWordbookId = null;
          wordbookAuditNote = `已删除分册，${res.rescued} 个词已安全退回「密集书库」（0 丢失）`;
          renderHistoryContent();
        }
        break;
      }

      case "wb-import-open": {
        event.preventDefault();
        wordbookImportOpen = true;
        wordbookMenuOpen = false;
        renderHistoryContent();
        break;
      }

      case "wb-import-close": {
        event.preventDefault();
        wordbookImportOpen = false;
        renderHistoryContent();
        break;
      }

      case "wb-import-submit": {
        event.preventDefault();
        const ta = $("#wb-import-textarea");
        const raw = ta ? ta.value : "";
        if (!raw.trim() || !window.TALK_WORDBOOKS) {
          toast("请先粘贴词表或选择文件");
          break;
        }
        const res = window.TALK_WORDBOOKS.importData(raw, activeWordbookId || window.TALK_WORDBOOKS.DEFAULT_BOOK_ID);
        if (res?.storageFull) {
          toast("存储空间不够导入这些词：先导出 JSON 备份，再删掉一些词条。");
          break;
        }
        syncSavedFromWordbooks();
        wordbookImportOpen = false;
        wordbookAuditNote = `导入核对：导入前 ${res.before.uniqueWords} 词 → 导入后 ${res.after.uniqueWords} 词（新增 ${res.added}，去重跳过 ${res.skipped}）`;
        renderHistoryContent();
        toast(`已导入 ${res.added} 词`);
        break;
      }

      case "wb-import-extract": {
        event.preventDefault();
        if (wordbookExtracting) break;
        const ta = $("#wb-import-textarea");
        const raw = ta ? ta.value.trim() : "";
        if (!raw || !window.TALK_WORDBOOKS) {
          toast("请先粘贴一段包含英文词句的文本");
          break;
        }
        if (!hasModelConfig()) {
          toast("请先在设置中配置模型 API");
          break;
        }
        wordbookExtracting = true;
        renderHistoryContent();
        try {
          const aiRes = await callWordbookAi("extract", { text: raw.slice(0, 6000) });
          const extracted = Array.isArray(aiRes?.words)
            ? aiRes.words.map((w) => String(w || "").trim()).filter(Boolean)
            : [];
          if (!extracted.length) {
            toast("未从文本中提取到可收录的英文词条");
          } else {
            const res = window.TALK_WORDBOOKS.importData(
              extracted.join("\n"),
              activeWordbookId || window.TALK_WORDBOOKS.DEFAULT_BOOK_ID
            );
            if (res?.storageFull) {
              toast("存储空间不够导入这些词：先导出 JSON 备份，再删掉一些词条。");
              break;
            }
            syncSavedFromWordbooks();
            wordbookImportOpen = false;
            const truncated = Math.max(0, raw.length - 6000);
            wordbookAuditNote = `AI 提取核对：导入前 ${res.before.uniqueWords} 词 → 导入后 ${res.after.uniqueWords} 词（提取 ${extracted.length}，新增 ${res.added}，去重跳过 ${res.skipped}）${truncated ? `；已按前 6,000 字提取，截断 ${truncated.toLocaleString()} 字` : ""}`;
            toast(`已提取并导入 ${res.added} 词`);
          }
        } catch (err) {
          toast(err?.message || "AI 提取失败，请重试");
        } finally {
          wordbookExtracting = false;
          renderHistoryContent();
        }
        break;
      }

      case "wb-export-txt": {
        event.preventDefault();
        wordbookMenuOpen = false;
        const bid = target.dataset.bookId;
        const book = window.TALK_WORDBOOKS?.getBook(bid);
        if (!book || !book.items.length) { toast("这本词册为空"); break; }
        const text = window.TALK_WORDBOOKS.exportBookTxt(bid);
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `talk-${book.name}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast(`已导出「${book.name}」${book.items.length} 词`);
        break;
      }

      case "wb-export-json": {
        event.preventDefault();
        wordbookMenuOpen = false;
        if (!window.TALK_WORDBOOKS) break;
        const json = window.TALK_WORDBOOKS.exportAllJson();
        const st = window.TALK_WORDBOOKS.stats();
        const blob = new Blob([json], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "talk-wordbooks-backup.json";
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast(`已导出 ${st.bookCount} 本词汇书（共 ${st.uniqueWords} 词）`);
        break;
      }

      case "wb-remove-term": {
        event.preventDefault();
        const term = target.dataset.term || "";
        const bid = target.dataset.bookId || "";
        if (!term || !window.TALK_WORDBOOKS) break;
        window.TALK_WORDBOOKS.removeTerm(term, bid || null);
        syncSavedFromWordbooks();
        renderHistoryContent();
        toast("已移出本册");
        break;
      }

      case "wb-move-term": {
        event.preventDefault();
        const term = target.dataset.term || "";
        const fromId = target.dataset.bookId || "";
        const wb = window.TALK_WORDBOOKS;
        if (!term || !fromId || !wb) break;
        const others = wb.listBooks().filter((b) => b.id !== fromId);
        if (!others.length) break;
        const menu = others.map((b, i) => `${i + 1}. ${b.name}`).join("\n");
        const pick = window.prompt(`把「${term}」移到哪本分册？请输入序号：\n${menu}`, "1");
        const idx = Number(pick) - 1;
        if (!Number.isInteger(idx) || !others[idx]) break;
        wb.moveTerm(term, fromId, others[idx].id);
        syncSavedFromWordbooks();
        renderHistoryContent();
        toast(`已移至「${others[idx].name}」`);
        break;
      }

      case "wb-ai-sort": {
        event.preventDefault();
        wordbookMenuOpen = false;
        const bid = target.dataset.bookId;
        const wb = window.TALK_WORDBOOKS;
        const book = wb?.getBook(bid);
        if (!book || book.items.length < 2 || wordbookSorting) break;
        wordbookSorting = true;
        const beforeTotal = wb.stats().uniqueWords;
        const allWords = book.items.map((it) => it.term);
        const BATCH_SIZE = 60;
        const totalBatches = Math.ceil(allWords.length / BATCH_SIZE);
        let totalMoved = 0;
        const createdAll = new Set();
        wordbookAuditNote = `整理前 ${beforeTotal} 词 · 正在分批归类（1/${totalBatches}）…`;
        renderHistoryContent();
        try {
          for (let i = 0; i < totalBatches; i++) {
            const batchWords = allWords.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
            if (totalBatches > 1) {
              wordbookAuditNote = `整理前 ${beforeTotal} 词 · 正在分批归类（${i + 1}/${totalBatches}，共 ${allWords.length} 词）…`;
              renderHistoryContent();
            }
            const existingBooks = wb.listBooks().filter((b) => !b.system).map((b) => b.name);
            const aiRes = await callWordbookAi("classify", { existingBooks, words: batchWords });
            const audit = wb.applyAiClassification(bid, aiRes?.groups || []);
            totalMoved += audit.moved;
            audit.createdBooks.forEach((n) => createdAll.add(n));
            syncSavedFromWordbooks();
          }
          const afterTotal = wb.stats().uniqueWords;
          const remaining = wb.getBook(bid)?.items.length || 0;
          const lost = Math.max(0, beforeTotal - afterTotal);
          const createdList = [...createdAll];
          const newInfo = createdList.length ? ` · 新建「${createdList.slice(0, 6).join(" / ")}${createdList.length > 6 ? "…" : ""}」` : "";
          wordbookAuditNote = `整理核对：整理前 ${beforeTotal} 词 → 整理后 ${afterTotal} 词（归类 ${totalMoved}，留守 ${remaining}，丢失 ${lost}）${newInfo}`;
          toast(`分册完成 · 0 丢失`);
        } catch (err) {
          const afterTotal = wb.stats().uniqueWords;
          wordbookAuditNote = `分册中断（已完成部分已保存，当前全库 ${afterTotal}/${beforeTotal} 词）：${err?.message || "请求失败"}`;
        } finally {
          wordbookSorting = false;
          renderHistoryContent();
        }
        break;
      }

      case "wb-to-reader": {
        event.preventDefault();
        wordbookMenuOpen = false;
        const bid = target.dataset.bookId || "";
        window.__TALK_BRIDGE__?.openReaderWithBook?.(bid);
        break;
      }

      case "saved-item": {
        event.preventDefault();
        const raw = String(target.dataset.term || "").trim();
        if (!raw) break;
        const entry = parseSavedEntry(raw);
        if (!entry.text) break;
        closeSheet({ immediate: true });
        if (entry.kind === "sentence") runSearch(entry.text, "sentence");
        else if (entry.kind === "chunk") runSearch(entry.text, "chunk");
        else openWordLayer(entry.text, { relation: "收藏词册", origin: "收藏" });
        break;
      }

      case "remove-saved": {
        event.preventDefault();
        const raw = String(target.dataset.term || "").trim();
        const idx = findSavedIndex(raw);
        if (idx >= 0) {
          state.saved.splice(idx, 1);
        } else {
          const lower = raw.toLowerCase();
          state.saved = state.saved.filter((w) => String(w).toLowerCase() !== lower);
        }
        persistSaved();
        renderHistoryContent();
        if (state.route.name === "reader" && window.TALK_READER?.refreshTheme) {
          window.TALK_READER.refreshTheme();
        }
        toast("已移出收藏词册");
        break;
      }

      case "export-saved": {
        event.preventDefault();
        if (!state.saved.length) {
          toast("收藏词册为空");
          break;
        }
        const blob = new Blob([state.saved.map((item) => parseSavedEntry(item).label).join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "talk-saved-words.txt";
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast(`已导出 ${state.saved.length} 条收藏`);
        break;
      }

      case "clear-saved": {
        event.preventDefault();
        state.saved = [];
        persistSaved();
        renderHistoryContent();
        if (state.route.name === "reader" && window.TALK_READER?.refreshTheme) {
          window.TALK_READER.refreshTheme();
        }
        toast("收藏词册已清空");
        break;
      }

      case "clear-history": {
        event.preventDefault();
        const scope = target.dataset.scope || "all";
        if (scope === "all") {
          state.history = [];
          toast("记录已清空");
        } else if (scope === "translation") {
          state.history = state.history.filter((item) => item.type !== "translation");
          toast("翻译记录已清空");
        } else {
          state.history = state.history.filter((item) => item.type === "translation");
          toast("词典记录已清空");
        }
        persistHistory();
        renderHistoryContent();
        break;
      }

      case "copy-diagnostics": {
        const text = diagText();
        try {
          await navigator.clipboard.writeText(text);
          toast("诊断日志已复制（已脱敏）");
        } catch (_) {
          toast("复制失败，可在设置里手动查看");
        }
        break;
      }
      case "clear-diagnostics":
        localStorage.removeItem("talk.diagnostics.v1");
        renderSettingsContent();
        toast("运行日志已清空");
        break;

      case "clear-word-cache":
        event.preventDefault();
        await clearWordStore();
        refreshCacheBorders();
        {
          const active = activeWordData();
          if (active) schedulePrefetch(active);
        }
        refreshCacheUi();
        toast("词条缓存已清除");
        break;

      case "export-word-cache":
        event.preventDefault();
        exportWordCache();
        break;

      case "import-word-cache":
        event.preventDefault();
        $("#word-cache-file")?.click();
        break;

      case "install-app":
        event.preventDefault();
        if (!state.installPrompt) {
          toast("请用浏览器菜单安装到主屏幕");
          break;
        }
        state.installPrompt.prompt();
        await state.installPrompt.userChoice.catch(() => null);
        state.installPrompt = null;
        target.hidden = true;
        break;

      case "open-cache":
        event.preventDefault();
        openCacheSheet();
        break;

      case "clear-audio-cache":
        event.preventDefault();
        if (!window.confirm("清空所有已生成的语音缓存？")) break;
        await clearAudioCache();
        refreshCacheUi();
        toast("语音缓存已清空");
        break;

      default:
        break;
    }
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

  function updateWordbookImportHint() {
    const field = $("#wb-import-textarea");
    const hint = $("#wb-import-hint");
    if (!field || !hint) return;
    const length = field.value.length;
    if (length <= 6000) {
      hint.textContent = "";
      hint.hidden = true;
      return;
    }
    hint.hidden = false;
    hint.textContent = `AI 提取只读前 6,000 字：将截断 ${(length - 6000).toLocaleString()} 字（其余内容仍会导入）。`;
  }
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
