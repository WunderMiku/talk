/* ============================================================
   talk. — Settings, Model Profiles, History & Saved Persistence
   ============================================================ */

import { SEAL_PREFIX, canSeal, sealText, unlockSettingsKeys } from "./vault.js";

export const CONFIG_KEY = "talk.model.v1";
export const PREFERENCES_KEY = "talk.prefs.v1";
export const PREFERENCE_FIELDS = [
  "prefetch",
  "cacheDisplay",
  "ttsEngine",
  "qwenTtsModel",
  "qwenTtsVoice",
  "detailLevel",
  "cacheMax",
  "cacheTtlDays",
  "sentenceLevel",
  "foldMode",
  "showGenMeta",
  "reverseMaxTokens"
];
export const EXAMPLE_STYLE_KEY = "talk.exampleStyles.v1";
export const HISTORY_KEY = "talk.history.v1";
export const SAVED_KEY = "talk.saved.v1";
export const DEFAULT_CACHE_MAX = 300;
export const DEFAULT_CACHE_TTL_DAYS = 90;

// One table drives the prompt, the settings picker and the on-page slicing.
export const SENTENCE_LEVELS = [
  { id: "zhongkao", label: "中考", maxKeyWords: 3, hint: "基础词与固定搭配优先" },
  { id: "gaokao", label: "高考", maxKeyWords: 4, hint: "常见高频词与基本句型" },
  { id: "cet4", label: "CET-4", maxKeyWords: 5, hint: "四级核心词与常见从句" },
  { id: "cet6", label: "CET-6", maxKeyWords: 6, hint: "六级词与复杂修饰" },
  { id: "kaoyan", label: "考研", maxKeyWords: 7, hint: "考研长难句与学术表达" },
  { id: "ielts", label: "雅思", maxKeyWords: 7, hint: "雅思阅读句式与同义替换" },
  { id: "toefl", label: "托福", maxKeyWords: 8, hint: "托福学术句与抽象概念" }
];
export const SENTENCE_LEVEL_DEFAULT = "gaokao";

export const DEFAULT_SETTINGS = {
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

export const DETAIL_LEVELS = {
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

export const PROVIDERS = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  google: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-3.6-flash" },
  custom: { baseUrl: "", model: "" }
};

export const MODEL_PRESETS = [
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

export const CUSTOM_TEMPLATE = {
  id: "custom",
  name: "自定义（OpenAI 兼容）",
  provider: "custom",
  protocol: "openai",
  baseUrl: "",
  model: "",
  note: "任何兼容 /chat/completions 的服务：填地址、模型名和密钥即可。"
};

export const PROVIDER_TEMPLATES = [...MODEL_PRESETS, CUSTOM_TEMPLATE];

export function sentenceLevelOf(value) {
  return SENTENCE_LEVELS.find((level) => level.id === value)
    || SENTENCE_LEVELS.find((level) => level.id === SENTENCE_LEVEL_DEFAULT);
}

export function legacyModelProfiles(parsed = {}) {
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

export function normalizeModelProfiles(raw, parsed = {}) {
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

export function applyProfileToSettings(settings, profile) {
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

export function syncDraftProfile(draft, activeProfileFn) {
  if (!draft?.profiles?.length) return;
  const profile = activeProfileFn(draft);
  if (!profile) return;
  profile.provider = draft.provider || profile.provider || "custom";
  profile.protocol = profile.protocol || (String(profile.provider).toLowerCase() === "google" ? "google" : "openai");
  profile.baseUrl = String(draft.baseUrl || "");
  profile.model = String(draft.model || "");
  profile.apiKey = String(draft.apiKey || "");
  profile.enableThinking = Boolean(draft.enableThinking);
  profile.thinkingBudget = Math.max(0, Math.min(262144, Number(draft.thinkingBudget) || 0));
}

export function sanitizeHistory(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && ["word", "chunk", "sentence", "translation"].includes(item.type) && item.query)
    .map((item) => ({
      type: item.type,
      query: String(item.query),
      at: Number(item.at) || 0
    }))
    .slice(0, 10);
}

export function themeIds() {
  const list = window.TALK_THEME?.list?.() || [];
  return list.map((theme) => theme.id);
}

export function exampleStyleOverrides() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EXAMPLE_STYLE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

export function exampleStyleFor(themeId) {
  const overrides = exampleStyleOverrides();
  const own = String(overrides[themeId] || "").trim();
  if (own) return own;
  const meta = window.TALK_THEME?.metaOf?.(themeId);
  const registered = String(meta?.exampleStyle || "").trim();
  return registered || "自然、日常的英语，句子短，适合记忆";
}

export function saveExampleStyles(next) {
  try { localStorage.setItem(EXAMPLE_STYLE_KEY, JSON.stringify(next || {})); } catch (_) { /* no-op */ }
}

export function exampleForTheme(word, themeId = window.TALK_THEME?.current?.().id) {
  if (!word) return [];
  const themed = word.examplesByTheme?.[themeId];
  if (Array.isArray(themed) && themed.length) return themed;
  return word.examples || [];
}

export function themesMissingExamples(word) {
  if (!word) return [];
  return themeIds().filter((id) => !(word.examplesByTheme?.[id] || []).length);
}

export function createSettingsStore({ state, data: DATA, llm: LLM, toast }) {
  let storedKeysPlain = false;
  let plainKeyDropWarned = false;
  let storageChain = Promise.resolve();

  const activeProfile = (settings) => LLM.activeProfile(settings);
  const profileSupportsThinking = (profile) => LLM.profileSupportsThinking(profile);

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

  function unlockStoredKeys() {
    return unlockSettingsKeys(state.settings, activeProfile);
  }

  function hadPlainKeys() {
    return storedKeysPlain;
  }

  function hasModelConfig(cfg = state.settings) {
    const key = String(cfg.apiKey || "").trim();
    const base = String(cfg.baseUrl || "").trim();
    return Boolean(base) && (Boolean(key) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(base));
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

  return {
    activeProfile,
    profileSupportsThinking,
    syncDraftProfile: (draft) => syncDraftProfile(draft, activeProfile),
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
    normalizeSavedKey,
    findSavedIndex,
    isSavedKey
  };
}
