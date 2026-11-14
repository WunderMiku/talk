/* ============================================================
   talk. — interactive dictionary prototype
   Vanilla JS. No build step.
   ============================================================ */

(() => {
  "use strict";

  const DATA = window.TALK_DATA;
  const CONTENT = window.TALK_CONTENT;
  const APP_VERSION = "187";

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
  const PREFERENCE_FIELDS = ["prefetch", "cacheDisplay", "ttsEngine", "qwenTtsModel", "qwenTtsVoice", "detailLevel", "cacheMax", "cacheTtlDays", "sentenceLevel", "foldMode"];
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
  // --- diagnostics -------------------------------------------------------
  // Keep a small, redacted trail of what the model layer actually did so a
  // reader can paste it back when something breaks. Never store prompts whole:
  // only shapes, sizes and error text.
  const DIAG_KEY = "talk.diagnostics.v1";
  const DIAG_LIMIT = 120;
  function redact(value) {
    let text = typeof value === "string" ? value : JSON.stringify(value || "");
    text = String(text)
      .replace(/sk-[A-Za-z0-9_-]{6,}/g, "sk-***")
      .replace(/Bearer\s+[A-Za-z0-9._-]{6,}/gi, "Bearer ***")
      .replace(/("?(?:apiKey|authorization|token)"?\s*[:=]\s*")([^"]{4,})(")/gi, "$1***$3")
      .replace(/[A-Za-z0-9_-]{32,}/g, "***");
    return text.length > 600 ? text.slice(0, 600) + "…" : text;
  }
  function diagLog(level, code, message, meta = {}) {
    try {
      const entry = {
        at: new Date().toISOString().slice(5, 23),
        level,
        code,
        message: redact(String(message || "")).slice(0, 400),
        meta: redact(meta).slice(0, 600)
      };
      const list = JSON.parse(localStorage.getItem(DIAG_KEY) || "[]");
      list.push(entry);
      while (list.length > DIAG_LIMIT) list.shift();
      localStorage.setItem(DIAG_KEY, JSON.stringify(list));
    } catch (_) { /* never let logging break the app */ }
  }
  function diagText() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(DIAG_KEY) || "[]"); } catch (_) { list = []; }
    const head = [
      `talk ${typeof APP_VERSION !== "undefined" ? APP_VERSION : "?"} · ${navigator.userAgent}`,
      `time ${new Date().toISOString()}`,
      `model ${redact(state.settings?.model || "")} · ${redact(state.settings?.baseUrl || "")}`
    ].join("\n");
    const body = list.map((e) => `${e.at} ${e.level.toUpperCase()} ${e.code} · ${e.message}${e.meta && e.meta !== "{}" ? " · " + e.meta : ""}`).join("\n");
    return head + "\n" + body;
  }
  window.addEventListener("error", (event) => diagLog("error", "window", event.message || "script error", { source: event.filename, line: event.lineno }));
  window.addEventListener("unhandledrejection", (event) => diagLog("error", "promise", event.reason?.message || String(event.reason || "")));

  // Sentences now carry a summary, a parse tree and level-tagged key words,
  // which no longer fits in the old per-detail ceiling.
  const SENTENCE_MAX_TOKENS = { fast: 6000, standard: 12000, deep: 20000 };
  // The depth option shapes the prompt; these ceilings only stop a runaway reply.
  const SENTENCE_DEPTH_BRIEF = {
    fast: "需要多少写多少即可，但偏向精简：tree 一般 3–5 个节点，重点词 2–4 个，每层解释一句话。",
    standard: "按内容需要完整展开：tree 一般 6–9 个节点，重点词按等级上限，解释具体但不铺陈。",
    deep: "尽量讲透：tree 可到 12–14 个节点，重点词到上限，补语域、易错点与阅读提示，但不要重复。"
  };
  const HISTORY_KEY = "talk.history.v1";
  const SAVED_KEY = "talk.saved.v1";
  // Bumped when the shape of a cached entry changes (POS spelled out, English
  // glosses, ...). Older records are ignored and quietly replaced on the next
  // lookup, so nobody keeps reading a stale mix of Chinese and English.
  // Bumped when the stored shape grows, never to invalidate old entries:
  // schema 2 payloads stay readable and are upgraded in place on next write.
  const WORD_CACHE_SCHEMA = 3;
  const WORD_CACHE_MIN_SCHEMA = 2;
  const WORD_CACHE_KEY = "talk.wordcache.v1";
  const WORD_DB_NAME = "talk.words.v1";
  const WORD_DB_STORE = "entries";
  const SENTENCE_DB_STORE = "sentences";
  const SENTENCE_CACHE_SCHEMA = 1;
  const SENTENCE_LIMIT = 120;
  const sentenceCache = new Map();
  const DEFAULT_CACHE_MAX = 300;
  const PREFETCH_LIMIT = 4;
  const DEFAULT_CACHE_TTL_DAYS = 90;
  let wordDb = null;
  let wordStoreFallback = false;
  const wordCache = new Map();

  /* ---- key vault -------------------------------------------------------
     API keys are never written as plain text when WebCrypto is available.
     A non-extractable AES-GCM key lives in IndexedDB (it cannot be read
     back out), and the settings blob stores only ciphertext. This keeps
     keys out of a casual devtools/localStorage inspection and out of
     storage backups; it is not a defence against someone who can run code
     in this origin, because the page itself can decrypt. */
  const VAULT_DB_NAME = "talk.vault.v1";
  const VAULT_STORE = "keys";
  const VAULT_KEY_ID = "api-key-wrap";
  const SEAL_PREFIX = "sealed:v1:";
  const vault = { db: null, key: null, broken: false };
  let storedKeysPlain = false;
  let storageChain = Promise.resolve();

  const canSeal = () => Boolean(window.crypto?.subtle && window.idb?.openDB && "indexedDB" in window);

  function toBase64(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function fromBase64(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function vaultKey() {
    if (vault.key) return vault.key;
    if (vault.broken || !canSeal()) return null;
    try {
      if (!vault.db) {
        vault.db = await window.idb.openDB(VAULT_DB_NAME, 1, {
          upgrade(db) {
            if (!db.objectStoreNames.contains(VAULT_STORE)) db.createObjectStore(VAULT_STORE);
          }
        });
      }
      let key = await vault.db.get(VAULT_STORE, VAULT_KEY_ID);
      if (!key || key.type !== "secret") {
        key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        await vault.db.put(VAULT_STORE, key, VAULT_KEY_ID);
      }
      vault.key = key;
      return key;
    } catch (error) {
      vault.broken = true;
      console.warn("Key vault unavailable; settings will fall back to plain storage.", error);
      return null;
    }
  }

  async function sealText(text) {
    if (!text) return text;
    const key = await vaultKey();
    if (!key) return text;
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
      return `${SEAL_PREFIX}${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`;
    } catch (error) {
      console.warn("Could not seal an API key; storing it unsealed.", error);
      return text;
    }
  }

  async function unsealText(value) {
    const text = String(value || "");
    if (!text.startsWith(SEAL_PREFIX)) return text;
    const key = await vaultKey();
    if (!key) return "";
    try {
      const [ivPart, bodyPart] = text.slice(SEAL_PREFIX.length).split(".");
      if (!ivPart || !bodyPart) return "";
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(ivPart) },
        key,
        fromBase64(bodyPart)
      );
      return new TextDecoder().decode(plain);
    } catch (error) {
      console.warn("A stored API key could not be decrypted; it has been dropped.", error);
      return "";
    }
  }

  async function unlockStoredKeys() {
    if (!canSeal()) return;
    const settings = state.settings;
    settings.apiKey = await unsealText(settings.apiKey);
    for (const profile of settings.profiles || []) {
      profile.apiKey = await unsealText(profile.apiKey);
    }
    const active = activeProfile(settings);
    if (active) settings.apiKey = active.apiKey || "";
  }

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
    qwenTtsVoice: "longanhuan_v3.1"
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
    return MODEL_PRESETS.map((preset) => ({
      ...preset,
      protocol: preset.protocol || "openai",
      templateId: preset.id,
      apiKey: "",
      thinkingCapable: Boolean(preset.thinkingCapable),
      enableThinking: Boolean(preset.enableThinking),
      thinkingBudget: Number(preset.thinkingBudget) || 0
    }));
  }

  function legacyModelProfiles(parsed = {}) {
    const profiles = defaultModelProfiles();
    const baseUrl = String(parsed.baseUrl || "").trim();
    const model = String(parsed.model || "").trim();
    const apiKey = String(parsed.apiKey || "");
    if (!baseUrl && !model && !apiKey) return { profiles, activeProfileId: profiles[0].id };
    const matched = profiles.find((profile) => profile.baseUrl && profile.baseUrl === baseUrl);
    if (matched) {
      matched.baseUrl = baseUrl;
      matched.model = model || matched.model;
      matched.apiKey = apiKey;
      return { profiles, activeProfileId: matched.id };
    }
    profiles.unshift({
      id: "legacy-custom",
      name: "我的配置",
      provider: parsed.provider || "custom",
      baseUrl,
      model,
      apiKey,
      note: "从旧版单配置迁移而来。"
    });
    return { profiles, activeProfileId: "legacy-custom" };
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
    return { profiles, activeProfileId: String(parsed.activeProfileId || profiles[0].id) };
  }

  function activeProfile(settings) {
    if (!settings?.profiles?.length) return null;
    return settings.profiles.find((profile) => profile.id === settings.activeProfileId) || settings.profiles[0];
  }

  function profileSupportsThinking(profile) {
    if (!profile) return false;
    if (profile.thinkingCapable) return true;
    return /(?:qwen(?:3\.[5-9]|[4-9]\.\d)|deepseek-v4|glm-5|kimi-k[2-9])/i.test(String(profile.model || ""));
  }

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
  let currentAudio = null;
  let ttsAudio = null;
  let suppressNextPopstate = false;
  const SILENT_AUDIO = "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

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
    translatorStyles: [],
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
     Small utilities
     ============================================================ */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function attr(value) {
    return esc(value).replace(/`/g, "&#96;");
  }

  function rich(value) {
    return esc(value)
      .replace(/&lt;em&gt;/gi, "<em>")
      .replace(/&lt;\/em&gt;/gi, "</em>");
  }

  function sanitizeQuery(value) {
    let query = String(value ?? "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!query) return "";

    // A pasted word often arrives with a stray quote or repeated punctuation.
    query = query.replace(/^[\p{P}\p{S}]+/u, "").trim();
    if (!query) return "";

    const tokens = query.split(" ").filter(Boolean);
    if (tokens.length <= 1) {
      // For a single word, everything after the word is noise: assessment...
      return query.replace(/[\p{P}\p{S}]+$/u, "").trim();
    }

    const trailing = query.match(/[\p{P}\p{S}]+$/u);
    if (trailing) {
      const terminal = trailing[0].match(/[.!?。！？]/)?.[0] || "";
      query = query.slice(0, -trailing[0].length).trimEnd() + terminal;
    }
    return query;
  }

  function normalizeWord(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
      .replace(/[.,!?;:]+$/g, "")
      .replace(/\s+/g, " ");
  }

  function normalizeSentence(value) {
    return String(value ?? "")
      .trim()
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function detectType(value) {
    const q = sanitizeQuery(value);
    if (!q) return "word";
    const wordCount = q.split(/\s+/).filter(Boolean).length;
    return /[.!?。！？]/.test(q) || wordCount >= 3 ? "sentence" : "word";
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function tapFeedback() {
    if (navigator.vibrate) {
      try { navigator.vibrate(7); } catch (_) { /* no-op */ }
    }
  }

  function icon(name, className = "") {
    const svg = ICONS[name] || "";
    return svg.replace("<svg", `<svg class="${className}"`);
  }

  function blockHead(index, title, note = "") {
    return `
      <div class="block-head">
        <span class="block-index">${esc(index)}</span>
        <h2>${esc(title)}</h2>
        <span class="rule"></span>
        ${note ? `<span class="block-note">${esc(note)}</span>` : ""}
      </div>`;
  }

  function letterTitle(value) {
    const chars = Array.from(String(value ?? ""));
    return chars.map((char, i) => {
      if (char === " ") return `<span class="letter" style="--i:${i}">&nbsp;</span>`;
      return `<span class="letter" style="--i:${i}">${esc(char)}</span>`;
    }).join("");
  }

  function highlightPlain(text, term) {
    if (!text) return "";
    if (!term) return esc(text);
    const source = String(text);
    const target = String(term);
    let re;
    try {
      re = new RegExp(`(${escapeRegExp(target)})(?![\\w])`, "ig");
    } catch (_) {
      return esc(source);
    }
    let out = "";
    let last = 0;
    for (const match of source.matchAll(re)) {
      out += esc(source.slice(last, match.index));
      out += `<mark>${esc(match[0])}</mark>`;
      last = match.index + match[0].length;
    }
    out += esc(source.slice(last));
    return out;
  }

  function timeAgo(ts) {
    if (!ts) return "已保存";
    const diff = Date.now() - ts;
    if (diff < 60_000) return "刚刚";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    return `${Math.floor(diff / 86_400_000)} 天前`;
  }

  function titleCase(value) {
    const s = String(value ?? "");
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function registerLabel(value) {
    const key = String(value || "").toLowerCase();
    return ({
      common: "常用",
      formal: "正式",
      literary: "书面",
      informal: "口语",
      technical: "专业"
    })[key] || value || "通用";
  }

  /* Part of speech is always the English abbreviation, everywhere: the entry,
     relation cards, the sentence key words and the detail sheets. Models tend
     to answer with "noun" one time and "名词" the next, so both spellings are
     folded into the same short form here instead of at each call site. */
  const POS_ABBREVIATIONS = {
    n: "n.",
    noun: "n.",
    v: "v.",
    verb: "v.",
    adj: "adj.",
    adjective: "adj.",
    adv: "adv.",
    adverb: "adv.",
    prep: "prep.",
    preposition: "prep.",
    pron: "pron.",
    pronoun: "pron.",
    conj: "conj.",
    conjunction: "conj.",
    num: "num.",
    numeral: "num.",
    int: "int.",
    interjection: "int.",
    art: "art.",
    article: "art.",
    det: "det.",
    determiner: "det.",
    phr: "phr.",
    phrase: "phr.",
    "名词": "n.",
    "动词": "v.",
    "形容词": "adj.",
    "副词": "adv.",
    "介词": "prep.",
    "代词": "pron.",
    "连词": "conj.",
    "数词": "num.",
    "感叹词": "int.",
    "冠词": "art.",
    "短语": "phr."
  };

  function posAbbr(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const parts = raw.split(/\s*[/、,·]\s*|\s+or\s+|\s+and\s+/i).map((part) => part.trim()).filter(Boolean);
    const mapped = parts.map((part) => POS_ABBREVIATIONS[part.toLowerCase().replace(/\.$/, "")] || POS_ABBREVIATIONS[part] || "");
    if (!mapped.length || mapped.some((item) => !item)) return raw;
    return [...new Set(mapped)].join(" / ");
  }

  function posLabel(value) {
    return posAbbr(value) || "—";
  }

  function tagLabel(value) {
    const key = String(value || "").toLowerCase();
    return ({
      "most common": "最常用",
      core: "核心义",
      "second sense": "第二义",
      formal: "正式",
      literary: "书面",
      literal: "字面义",
      figurative: "比喻义",
      movement: "动作",
      mind: "思绪",
      uncountable: "不可数",
      technical: "专业"
    })[key] || value;
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
      enableThinking: Boolean(selected.enableThinking),
      thinkingBudget: Number(selected.thinkingBudget) || 0,
      profiles: normalized.profiles,
      activeProfileId: selected.id
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

  async function sealSettingsSnapshot(snapshot) {
    if (!canSeal()) return snapshot;
    snapshot.apiKey = await sealText(snapshot.apiKey);
    for (const profile of snapshot.profiles || []) {
      profile.apiKey = await sealText(profile.apiKey);
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
      .filter((item) => item && (item.type === "word" || item.type === "sentence" || item.type === "translation") && item.query)
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
    const raw = `${String(text).trim()}|${level}|${detail}`;
    try {
      const buffer = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch (_) {
      return `k-${raw.length}-${raw.slice(0, 40).replace(/\s+/g, "_")}`;
    }
  }

  function cacheGetSentence(key) {
    const record = sentenceCache.get(key);
    if (!record || record.schema !== SENTENCE_CACHE_SCHEMA) return null;
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
    const key = normalizeWord(word);
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
    return { ...hit.data, cached: true };
  }

  function cachePutWord(word, data, detail = state.settings?.detailLevel || "standard") {
    const key = normalizeWord(word);
    if (!key || !data) return;
    const { context, ...clean } = data;
    const record = { key, at: Date.now(), detail, schema: WORD_CACHE_SCHEMA, data: clean };
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
     Icons
     ============================================================ */

  const ICONS = {
    arrowLeft: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m11 18-6-6 6-6"/></svg>`,
    arrowUpRight: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>`,
    arrowRight: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>`,
    search: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9"/><path d="M17 7h3"/><path d="M4 17h2"/><path d="M10 17h10"/><circle cx="15" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>`,
    speaker: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18.5 6.5a7.8 7.8 0 0 1 0 11"/></svg>`,
    bookmark: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4V4Z"/></svg>`,
    chevronDown: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`,
    close: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
    copy: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/></svg>`,
    info: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 10.5V16"/><circle cx="12" cy="7.8" r=".8" fill="currentColor" stroke="none"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14-4L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14 4l2-2"/><path d="M20 20v-5h-5"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 13h10l1-13"/><path d="M10 11v5M14 11v5"/></svg>`,
    check: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>`,
    quote: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M5 11h5v6H4v-5c0-3.2 1.7-5.4 4.6-6.3l.8 2C7.6 8.3 6.5 9.4 6.2 11H8v-.1H5Zm10 0h5v6h-6v-5c0-3.2 1.7-5.4 4.6-6.3l.8 2c-1.8.6-2.9 1.7-3.2 3.3h1.8v-.1Z"/></svg>`,
    book: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/></svg>`,
    sentence: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 11h16M4 16h11"/><path d="M18 16h2"/></svg>`,
    sparkle: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c.5 4.2 2.6 6.4 7 7-4.4.6-6.5 2.8-7 7-.5-4.2-2.6-6.4-7-7 4.4-.6 6.5-2.8 7-7Z"/><path d="M19 16.5c.2 1.7 1 2.6 2.7 2.9-1.7.3-2.5 1.2-2.7 2.9-.2-1.7-1-2.6-2.7-2.9 1.7-.3 2.5-1.2 2.7-2.9Z"/></svg>`,
    wand: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 19 9-9"/><path d="m13 5 1.2 3.3L17.5 9.5l-3.3 1.2L13 14l-1.2-3.3L8.5 9.5l3.3-1.2L13 5Z"/><path d="M18 14.5v4M16 16.5h4"/></svg>`,
    external: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>`,
    shield: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 2.8 8.1 7 10 4.2-1.9 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-5"/></svg>`,
    archive: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16v13H4z"/><path d="M3 4h18v3H3z"/><path d="M9 11h6"/></svg>`,
    volume: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/></svg>`
  };

  /* ============================================================
     Routing & transitions
     ============================================================ */

  function routeHash(route) {
    if (route.name === "word") return `#/word/${encodeURIComponent(route.word || "")}`;
    if (route.name === "sentence") return `#/sentence/${encodeURIComponent(route.id || route.result?.id || "")}`;
    if (route.name === "translator") return "#/translate";
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
      }
      if (decoded.startsWith("sentence/")) {
        const id = decoded.slice(9);
        const result = DATA.sentences.find((item) => item.id === id);
        if (result) return { name: "sentence", id, result };
        if (id.startsWith("model-")) return { name: "sentence", id };
      }
      if (decoded === "translate" || decoded === "translator") return { name: "translator" };
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
    const cfg = state.settings;
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
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 45_000);
    let data;
    try {
      const response = await postChat(endpointFor(cfg.baseUrl, cfg), cfg, [
        { role: "system", content: window.TALK_PROMPTS.examples },
        { role: "user", content: JSON.stringify(payload) }
      ], controller.signal, true, 900);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      let content = json?.choices?.[0]?.message?.content;
      if (Array.isArray(content)) content = content.map((part) => typeof part === "string" ? part : part?.text || "").join("");
      data = parseJsonObject(content);
    } finally {
      window.clearTimeout(timer);
    }
    const fresh = normalizeExamplesByTheme(data.examplesByTheme || data.examples_by_theme || data);
    if (!fresh) return;
    const merged = normalizeExamplesByTheme({ ...(word.examplesByTheme || {}), ...fresh });
    if (!merged) return;
    word.examplesByTheme = merged;
    const cached = cacheGetWord(word.word);
    if (cached) {
      cached.examplesByTheme = merged;
      cachePutWord(normalizeWord(word.word), cached, state.settings.detailLevel || "standard");
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

  function observeReveals(scope) {
    if (!revealObserver) return;
    const root = scope || screen;
    if (!root) return;
    // Sections animate as one block: nested .reveal nodes settle with their
    // parent instead of drifting in a beat later.
    root.querySelectorAll(".reveal").forEach((element) => {
      if (element.parentElement?.closest(".reveal")) element.classList.add("is-in");
    });
    root.querySelectorAll(".reveal:not(.is-in)").forEach((element) => {
      if (!element.parentElement?.closest(".reveal")) revealObserver.observe(element);
    });
    root.querySelectorAll(".reveal-item:not(.is-in)").forEach((element) => {
      revealObserver.observe(element);
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
  }

  function queueReveal(scope) {
    if (!revealObserver) return;
    const target = scope || screen;
    window.requestAnimationFrame(() => observeReveals(target));
  }

  function renderRoute(route, direction = "forward", { instant = false } = {}) {
    const apply = () => {
      state.route = route;
      screen.dataset.page = route.name;
      state.module = route.name === "translator" ? "translator" : "dictionary";
      updateModuleBar();
      closeTranslationWorkspace({ immediate: true });
      closeSheet({ immediate: true });
      closeAllWordLayers({ immediate: true });
      screen.innerHTML = pageHtml(route);
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
      if (route.name === "translator") {
        updateTranslatorLanguage();
        updateTranslatorStyleControls();
      }
    };

    if (!instant && !reduceMotion && document.startViewTransition) {
      try {
        document.startViewTransition(apply);
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
    if (route.name === "word") return `${titleCase(route.word)} — talk.`;
    if (route.name === "sentence") return "句子理解 — talk.";
    if (route.name === "translator") return "多风格翻译 — talk.";
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
      case "translator":
        return translatorPage();
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
    return ensureWord(DATA.words[normalizeWord(route?.word || "")]);
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

  function updateModuleBar() {
    $$(".module-btn", app).forEach((button) => {
      const active = button.dataset.module === state.module;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

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

  function backTopbar({ label, title, bookmark = null }) {
    const saved = bookmark ? state.saved.includes(bookmark) : false;
    return `
      <header class="topbar">
        <button class="icon-btn" type="button" data-action="back" aria-label="返回">${icon("arrowLeft")}</button>
        <div class="topbar-context">
          <span class="mono">${esc(label)}</span>
          <strong>${esc(title)}</strong>
        </div>
        <div class="top-actions">
          ${bookmark ? `<button class="icon-btn ${saved ? "is-saved" : ""}" type="button" data-action="save" aria-label="${saved ? "取消收藏" : "收藏"}" aria-pressed="${saved}" title="${saved ? "已收藏" : "收藏"}">${icon("bookmark")}</button>` : ""}
          <button class="icon-btn" type="button" data-action="settings" aria-label="连接模型" title="连接模型">${icon("settings")}</button>
        </div>
      </header>`;
  }

  function layerTopbar({ label, title, bookmark = null, origin = "", relation = "", depth = 1 }) {
    const saved = bookmark ? state.saved.includes(bookmark) : false;
    return `
      <header class="topbar">
        <button class="icon-btn" type="button" data-action="layer-back" aria-label="返回上一层">${icon("arrowLeft")}</button>
        <div class="topbar-context">
          <span class="mono">第 ${depth} 层 · 从「${esc(origin)}」${relation ? ` · ${esc(relation)}` : ""}</span>
          <strong>${esc(title)}</strong>
        </div>
        <div class="top-actions">
          ${bookmark ? `<button class="icon-btn ${saved ? "is-saved" : ""}" type="button" data-action="save" aria-label="${saved ? "取消收藏" : "收藏"}" aria-pressed="${saved}" title="${saved ? "已收藏" : "收藏"}">${icon("bookmark")}</button>` : ""}
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

  const TRANSLATION_CACHE_KEY = "talk.translations.v3";
  const TRANSLATION_CACHE_MAX = 40;
  const TRANSLATION_CACHE_TTL = 30 * 86400000;

  function translationCacheAll() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TRANSLATION_CACHE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function translationCacheGet(text) {
    const entry = translationCacheAll()[text];
    if (!entry?.result || Date.now() - Number(entry.at || 0) > TRANSLATION_CACHE_TTL) return null;
    return { ...entry.result, cached: true };
  }

  function translationCachePut(text, result) {
    const all = translationCacheAll();
    all[text] = { at: Date.now(), result };
    const entries = Object.entries(all)
      .sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0))
      .slice(0, TRANSLATION_CACHE_MAX);
    try { localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(Object.fromEntries(entries))); } catch (_) { /* no-op */ }
  }

  function detectSourceLanguage(text) {
    const source = String(text || "");
    const chinese = (source.match(/[\u3400-\u9fff]/g) || []).length;
    const latin = (source.match(/[A-Za-z]/g) || []).length;
    return chinese > 0 && chinese * 2 >= latin ? "zh" : "en";
  }

  function translatorEmptyHtml() {
    const copy = copyFor("translator");
    return `<div class="translator-empty">
      <span class="translator-empty-mark">Aa</span>
      <p>${esc(copy.empty)}</p>
      <div class="translator-examples">
        ${copy.samples.map(([text, label]) => `<button class="translator-example" type="button" data-action="translator-sample" data-text="${attr(text)}">${esc(label)} <span>↗</span></button>`).join("")}
      </div>
    </div>`;
  }

  function styleEmoji(style, className = "") {
    return `<img class="${className}" src="${esc(style.emoji)}" alt="" loading="eager" decoding="async" draggable="false" />`;
  }

  function translatorStylesHtml() {
    return TRANSLATOR_STYLES.map((style) => {
      const selected = state.translatorStyles.includes(style.id);
      return `<button class="translator-style-chip tone-${style.tone} ${selected ? "selected" : ""}" type="button" data-action="translator-style" data-style="${style.id}" aria-pressed="${selected}">
        ${styleEmoji(style, "translator-style-emoji")}
        <strong>${esc(style.name)}</strong>
        <span class="translator-style-check" aria-hidden="true">${selected ? "✓" : ""}</span>
      </button>`;
    }).join("");
  }

  function translatorModeHtml() {
    return copyFor("translator").modes.map(([mode, label]) => `<button class="translator-mode-btn ${state.translatorMode === mode ? "active" : ""}" type="button" data-action="translator-mode" data-mode="${mode}" aria-pressed="${state.translatorMode === mode}">${esc(label)}</button>`).join("");
  }

  function updateTranslatorStyleControls() {
    $$(".translator-style-chip").forEach((button) => {
      const selected = state.translatorStyles.includes(button.dataset.style);
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
      const check = button.querySelector(".translator-style-check");
      if (check) check.textContent = selected ? "✓" : "";
    });
    $$(".translator-style-count").forEach((count) => {
      count.textContent = `已选 ${state.translatorStyles.length} / ${TRANSLATOR_STYLES.length}`;
    });
  }

  function translatorPage() {
    const copy = copyFor("translator");
    return `
      ${homeTopbar()}
      <main class="result-page translator-page">
        <section class="translator-hero reveal" style="--d:0">
          <div class="eyebrow translator-eyebrow">
            <span class="spark"></span>${esc(copy.kicker)}
          </div>
          <h1 class="translator-title">${esc(copy.titleLead)}<em>${esc(copy.titleAccent)}</em></h1>
          <p class="translator-lede">${esc(copy.lede)}</p>
        </section>
        <form class="translator-form reveal" id="translator-form" style="--d:0.4" novalidate>
          <div class="translator-input-shell">
            <div class="translator-input-head">
              <span class="mono">原文</span>
              <div class="translator-mode-switch" role="group" aria-label="翻译方向">${translatorModeHtml()}</div>
            </div>
            <textarea id="translator-input" rows="3" placeholder="${attr(copy.inputPlaceholder)}" spellcheck="false" aria-label="待翻译文本"></textarea>
            <div class="translator-input-foot">
              <span class="translator-input-meta"><span class="translator-language">自动识别</span><span class="translator-style-count">已选 ${state.translatorStyles.length} / ${TRANSLATOR_STYLES.length}</span><span class="translator-char-count">0 字</span></span>
              <button class="search-submit" type="submit" aria-label="生成选中的风格">${icon("arrowUpRight")}</button>
            </div>
          </div>
        </form>
        <div class="translator-styles reveal" style="--d:0.8">${translatorStylesHtml()}</div>
        <div class="translator-landing-hint reveal" style="--d:1">${translatorEmptyHtml()}</div>
      </main>`;
  }

  function translatorSourceLanguage() {
    if (state.translatorMode === "zh" || state.translatorMode === "en") return state.translatorMode;
    const input = $("#translator-input");
    return detectSourceLanguage(input?.value || "");
  }

  function openTranslationWorkspace(text) {
    const value = String(text || "").trim();
    if (!value) {
      toast("先输入一句中文或英文");
      return;
    }
    state.workspaceOpen = true;
    state.lastTranslationInput = value;
    workspaceRoot.innerHTML = `<section class="translation-workspace" aria-label="翻译结果">
      <header class="translation-workspace-head">
        <div>
          <span class="mono">${esc(copyFor("translator").workspaceKicker || "MULTI-STYLE")}</span>
          <h2>${esc(copyFor("translator").workspaceTitle || "翻译结果")}</h2>
        </div>
        <button class="icon-btn" type="button" data-action="close-workspace" aria-label="关闭翻译结果">${icon("close")}</button>
      </header>
      <div class="translation-workspace-body" data-lenis-prevent>
        <form class="workspace-translator-form" id="workspace-translator-form" novalidate>
          <div class="workspace-input-shell">
            <textarea id="workspace-translator-input" rows="2"  spellcheck="false" aria-label="待翻译文本">${esc(value)}</textarea>
            <div class="workspace-input-foot">
              <div class="translator-mode-switch" role="group" aria-label="翻译方向">${translatorModeHtml()}</div>
              <span class="translator-language">自动识别</span>
              <span class="translator-char-count">0 字</span>
              <button class="search-submit" type="submit" aria-label="重新翻译">${icon("arrowUpRight")}</button>
            </div>
          </div>
        </form>
        <div class="workspace-style-row">
          <div class="translator-styles">${translatorStylesHtml()}</div>
          <span class="translator-style-count">已选 ${state.translatorStyles.length} / ${TRANSLATOR_STYLES.length}</span>
        </div>
        <div class="translation-workspace-results" id="translation-workspace-results"></div>
      </div>
    </section>`;
    updateScrollLock();
    requestAnimationFrame(() => {
      const panel = $(".translation-workspace", workspaceRoot);
      panel?.classList.add("show");
      // Do not auto-focus the textarea: opening the result view should not
      // summon the on-screen keyboard every time.
      updateTranslatorLanguage();
      updateTranslatorStyleControls();
    });
    runTranslation(value);
  }

  function closeTranslationWorkspace({ immediate = false } = {}) {
    if (!state.workspaceOpen && !workspaceRoot.firstElementChild) return;
    state.workspaceOpen = false;
    state.translatorSeq += 1;
    updateScrollLock();
    const panel = $(".translation-workspace", workspaceRoot);
    if (immediate || !panel) {
      workspaceRoot.innerHTML = "";
      return;
    }
    panel.classList.remove("show");
    window.setTimeout(() => {
      if (!state.workspaceOpen) workspaceRoot.innerHTML = "";
    }, 300);
  }

  function syncTranslatorInputsFromWorkspace() {
    const workspaceInput = $("#workspace-translator-input");
    const landingInput = $("#translator-input");
    if (workspaceInput && landingInput) landingInput.value = workspaceInput.value;
    updateTranslatorLanguage();
  }

  function updateTranslatorLanguage() {
    const input = $("#translator-input");
    const value = input?.value.trim() || "";
    const text = state.translatorMode === "zh"
      ? "中 → 英"
      : state.translatorMode === "en"
        ? "英 → 英"
        : value
          ? detectSourceLanguage(value) === "zh" ? "自动 · 中 → 英" : "自动 · 英 → 英"
          : "自动识别";
    $$(".translator-language").forEach((label) => { label.textContent = text; });
    const typingLang = translatorTargetIsChinese() ? "zh" : "en";
    applyInputMode(input, typingLang);
    applyInputMode($("#workspace-translator-input"), typingLang);
    const workspaceValue = $("#workspace-translator-input")?.value ?? value;
    const shown = $("#workspace-translator-input") ? workspaceValue : value;
    $$(".translator-char-count").forEach((label) => {
      label.textContent = `${shown.length} 字`;
    });
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

  function translatorTargetIsChinese() {
    return state.translatorMode === "zh";
  }

  function renderTranslatorLoading(styles = state.translatorStyles) {
    const host = $("#translation-workspace-results");
    if (!host) return;
    const selected = TRANSLATOR_STYLES.filter((style) => styles.includes(style.id));
    host.innerHTML = `<div class="translation-loading">
      <div class="translation-loading-head"><span class="loading-dots"><i></i><i></i><i></i></span><span>正在写成 ${selected.length} 个英文版本…</span></div>
      ${selected.map((style) => `<div class="translation-loading-card tone-${style.tone}"><span>${esc(style.name)}</span><i></i><i></i></div>`).join("")}
    </div>`;
  }

  function renderTranslatorNoModel() {
    const host = $("#translation-workspace-results");
    if (!host) return;
    host.innerHTML = `<div class="translator-empty">
      <span class="translator-empty-mark">!</span>
      <p>翻译需要模型。先连接一个 OpenAI 兼容服务，再回来输入。</p>
      <div class="translator-empty-actions">
        <button class="btn btn-primary" type="button" data-action="settings">${icon("settings")} 连接模型</button>
        <button class="btn btn-secondary" type="button" data-action="demo-translation">先看一段示例</button>
      </div>
    </div>`;
  }

  function renderTranslatorError(message) {
    const host = $("#translation-workspace-results");
    if (!host) return;
    host.innerHTML = `<div class="translator-empty error">
      <span class="translator-empty-mark">!</span>
      <p>这次没有翻完：${esc(shorten(message || "未知错误", 160))}</p>
      <button class="btn btn-secondary" type="button" data-action="regenerate-translation">${icon("refresh")} 重试</button>
    </div>`;
  }

  function demoTranslationResult(text) {
    const source = String(text || "").trim() || "今天有点累，但我还是想出去走走。";
    const bodies = [
      "Tired, but I still want to get out for a bit.",
      "Beat, but I could still use some fresh air.",
      "I am somewhat fatigued; nevertheless, I would like to take a walk.",
      "Low-key wiped, but still down for a walk.",
      "Weary as I am, a stroll would do me good."
    ];
    const nuances = ["短、直接，像日常对话", "像母语者会脱口而出的说法", "邮件、报告、正式场合", "社交平台上的轻松口气", "书面语里的从容"];
    return {
      sourceText: source,
      sourceLanguage: state.translatorMode === "en" ? "en" : "zh",
      variants: TRANSLATOR_STYLES.map((style, index) => ({
        style: style.id,
        text: bodies[index] || bodies[0],
        nuance: "",
        phrases: [],
        points: []
      })),
      model: "示例",
      cached: false,
      demo: true,
      at: Date.now()
    };
  }

  function renderTranslatorResult(result) {
    const host = $("#translation-workspace-results");
    if (!host || !result?.variants?.length) return;
    const source = result.sourceLanguage === "zh" ? "中 → 英" : "英 → 英";
    const styleMap = new Map(TRANSLATOR_STYLES.map((style) => [style.id, style]));
    host.innerHTML = `<div class="translation-result">
      <div class="translation-result-head">
        <div><span class="mono">${esc(source)}</span><span class="translation-cache-label">${result.cached ? "本机缓存" : "本次生成"}</span></div>
        <button class="link-btn" type="button" data-action="regenerate-translation">重新生成</button>
      </div>
      <div class="translation-list">
        ${result.variants.map((variant, index) => {
          const style = styleMap.get(variant.style) || TRANSLATOR_STYLES[index] || TRANSLATOR_STYLES[0];
          return `<article class="translation-card reveal-item tone-${style.tone}" style="--i:${Math.min(index, 4)}" data-action="translation-detail" data-index="${index}" tabindex="0" role="button" aria-label="查看${attr(style.name)}版本的搭配与知识点">
            <div class="translation-card-head">
              <span class="translation-emoji" aria-hidden="true">${styleEmoji(style)}</span>
              <div><h2>${esc(style.name)}</h2><p>${esc(style.hint)}</p></div>
              <button class="icon-btn translation-copy" type="button" data-action="copy-translation" data-text="${attr(variant.text)}" aria-label="复制这个版本">${icon("copy")}</button>
            </div>
            <p class="translation-text">${esc(variant.text)}</p>
            ${variant.nuance ? `<p class="translation-nuance">${esc(variant.nuance)}</p>` : ""}
            <span class="translation-open">搭配与知识点 <span aria-hidden="true">↗</span></span>
          </article>`;
        }).join("")}
      </div>
    </div>`;
    queueReveal(host);
  }

  function translationDetailHtml(variant, style) {
    const phrases = variant?.phrases || [];
    const points = variant?.points || [];
    return `<div class="sheet-content translation-detail tone-${style.tone}">
      <div class="translation-detail-head">
        <span class="translation-emoji" aria-hidden="true">${styleEmoji(style)}</span>
        <div><span class="mono">${esc(style.name)}</span><h2>搭配与知识点</h2></div>
      </div>
      <p class="translation-detail-text">${esc(variant.text)}</p>
      ${variant.nuance ? `<p class="translation-detail-nuance">${esc(variant.nuance)}</p>` : ""}
      <div class="translation-detail-section">
        <h3>常见搭配</h3>
        ${phrases.length ? phrases.map((item) => `<div class="translation-phrase">
          <strong>${esc(item.phrase)}</strong>
          <span>${esc(item.zh || "")}${item.note ? ` · ${esc(item.note)}` : ""}</span>
        </div>`).join("") : `<p class="translation-detail-empty">这次没返回，重新生成试试。</p>`}
      </div>
      <div class="translation-detail-section">
        <h3>知识点</h3>
        ${points.length ? `<ul class="translation-points">${points.map((point) => `<li>${esc(point)}</li>`).join("")}</ul>` : `<p class="translation-detail-empty">这次没返回，重新生成试试。</p>`}
      </div>
      <button class="btn btn-secondary translation-detail-copy" type="button" data-action="copy-translation" data-text="${attr(variant.text)}">${icon("copy")} 复制这个版本</button>
    </div>`;
  }

  function openTranslationDetail(index) {
    const result = state.lastTranslationResult;
    const variant = result?.variants?.[Number(index)];
    if (!variant) return;
    const style = TRANSLATOR_STYLES.find((item) => item.id === variant.style) || TRANSLATOR_STYLES[0];
    openSheetShell({ kicker: "风格拆解", title: style.name });
    const sheet = $(".sheet", overlayRoot);
    if (sheet) {
      TRANSLATOR_STYLES.forEach((item) => sheet.classList.remove(`tone-${item.tone}`));
      sheet.classList.add("translation-detail-sheet", `tone-${style.tone}`);
    }
    const holder = $("#sheet-scroll");
    if (holder) holder.innerHTML = translationDetailHtml(variant, style);
  }

  function normalizeTranslation(raw, sourceText, cfg, sourceLanguage, selectedStyles) {
    const base = raw && typeof raw === "object" ? raw : {};
    const sourceVariants = Array.isArray(base.variants) ? base.variants : [];
    const wanted = TRANSLATOR_STYLES.filter((style) => selectedStyles.includes(style.id));
    const variants = wanted.map((style, index) => {
      const found = sourceVariants.find((item) => String(item?.style || "").toLowerCase() === style.id)
        || sourceVariants[index]
        || {};
      const phrases = Array.isArray(found.phrases)
        ? found.phrases.map((item) => ({
            phrase: String(item?.phrase || item?.text || "").trim(),
            zh: String(item?.zh || item?.meaning || "").trim(),
            note: String(item?.note || "").trim()
          })).filter((item) => item.phrase)
        : [];
      return {
        style: style.id,
        text: String(found.text || found.translation || "").trim(),
        nuance: String(found.nuance || found.note || "").trim(),
        phrases,
        points: Array.isArray(found.points)
          ? found.points.map((item) => String(item || "").trim()).filter(Boolean)
          : []
      };
    }).filter((variant) => variant.text);
    if (!variants.length) throw new Error("模型没有返回可用的英文版本。");
    return {
      sourceText,
      sourceLanguage: sourceLanguage || (base.sourceLanguage === "en" ? "en" : "zh"),
      variants,
      model: cfg.model,
      cached: false,
      at: Date.now()
    };
  }

  async function requestTranslation(text, cfg, sourceLanguage, selectedStyles) {
    const endpoint = endpointFor(cfg.baseUrl, cfg);
    const messages = [
      { role: "system", content: TRANSLATOR_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ sourceLanguage, styles: selectedStyles, text }) }
    ];
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 60_000);
    const startedAt = Date.now();
    diagLog("info", "model.start", `translation · ${state.settings?.detailLevel || "standard"}`, { chars: text.length });
    try {
      let content = "";
      try {
        content = await postChatStream(endpoint, cfg, messages, controller.signal, false, 1600);
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        const response = await postChat(endpoint, cfg, messages, controller.signal, false, 1600);
        if (!response.ok) {
          const raw = await response.text().catch(() => "");
          throw new Error(`HTTP ${response.status}${raw ? ` · ${raw.slice(0, 220)}` : ""}`);
        }
        const json = await response.json();
        content = json?.choices?.[0]?.message?.content || "";
      }
      if (!content) throw new Error("模型返回了空内容。");
      return normalizeTranslation(parseJsonObject(content), text, cfg, sourceLanguage, selectedStyles);
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function runTranslation(raw, { bypassCache = false } = {}) {
    const text = String(raw || "").trim();
    if (!text) {
      toast("先输入一句中文或英文");
      return;
    }
    const selectedStyles = TRANSLATOR_STYLES
      .filter((style) => state.translatorStyles.includes(style.id))
      .map((style) => style.id);
    if (!selectedStyles.length) {
      toast("至少选择一个风格");
      return;
    }
    const token = ++state.translatorSeq;
    const sourceLanguage = translatorSourceLanguage();
    state.lastTranslationInput = text;
    updateTranslatorLanguage();
    const cacheKey = `${sourceLanguage}|${selectedStyles.join(",")}|${text}`;
    const cached = bypassCache ? null : translationCacheGet(cacheKey);
    if (cached) {
      state.lastTranslationResult = cached;
      renderTranslatorResult(cached);
      addHistory("translation", text);
      return;
    }
    if (!hasModelConfig()) {
      renderTranslatorNoModel();
      return;
    }
    renderTranslatorLoading(selectedStyles);
    try {
      const result = await requestTranslation(text, state.settings, sourceLanguage, selectedStyles);
      if (token !== state.translatorSeq) return;
      state.lastTranslationResult = result;
      translationCachePut(cacheKey, result);
      renderTranslatorResult(result);
      addHistory("translation", text);
    } catch (error) {
      if (token !== state.translatorSeq) return;
      renderTranslatorError(error?.name === "AbortError" ? "请求超过 60 秒" : String(error?.message || error));
    }
  }

  const THEME_DB_NAME = "talk.themeDecks.v1";
  const THEME_DB_STORE = "decks";
  const THEME_LEGACY_KEY = "talk.themeDecks.v1";
  const THEME_DISPLAY_LIMIT = 8;
  const THEME_DISPLAY_KEY = "talk.themeDisplay.v1";

  function themeDbOpen() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const request = indexedDB.open(THEME_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(THEME_DB_STORE)) {
          const store = db.createObjectStore(THEME_DB_STORE, { keyPath: "key" });
          store.createIndex("at", "at");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Theme DB error"));
    });
  }

  function normalizeStoredTheme(deck) {
    if (!deck || typeof deck !== "object" || !deck.title || !Array.isArray(deck.words)) return null;
    return {
      key: String(deck.key || deck.title).trim(),
      title: String(deck.title),
      subtitle: String(deck.subtitle || ""),
      scene: String(deck.scene || ""),
      words: deck.words,
      at: Number(deck.at) || 0
    };
  }

  async function themeDecksRead() {
    const db = await themeDbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(THEME_DB_STORE, "readonly");
      const request = tx.objectStore(THEME_DB_STORE).getAll();
      request.onsuccess = () => {
        const decks = (Array.isArray(request.result) ? request.result : [])
          .map(normalizeStoredTheme)
          .filter(Boolean)
          .sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
        db.close();
        resolve(decks);
      };
      request.onerror = () => {
        db.close();
        reject(request.error || new Error("Theme read failed"));
      };
    });
  }

  async function themeDeckSave(deck) {
    const db = await themeDbOpen();
    const key = String(deck.title || "").trim();
    if (!key) throw new Error("主题没有标题。");
    const stored = { ...deck, key, at: Date.now() };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(THEME_DB_STORE, "readwrite");
      tx.objectStore(THEME_DB_STORE).put(stored);
      tx.oncomplete = () => { db.close(); resolve(stored); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error("Theme write failed")); };
    });
  }

  async function clearThemeStore() {
    const db = await themeDbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(THEME_DB_STORE, "readwrite");
      tx.objectStore(THEME_DB_STORE).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error("Theme clear failed")); };
    });
  }

  async function themeCacheStats() {
    const decks = await themeDecksRead();
    const bytes = new Blob([JSON.stringify(decks)]).size;
    return {
      count: decks.length,
      displayCount: state.themeDisplay.length,
      max: THEME_DISPLAY_LIMIT,
      bytes,
      words: decks.reduce((sum, deck) => sum + (deck.words?.length || 0), 0)
    };
  }

  async function renderThemeCacheStats() {
    const target = $("#theme-cache-stats");
    if (!target) return;
    try {
      const stats = await themeCacheStats();
      target.innerHTML = `<div class="cache-settings-summary"><span><strong>${stats.count}</strong> 个主题 · 展览 ${stats.displayCount} / ${stats.max}</span><span>${formatBytes(stats.bytes)} · IndexedDB</span></div>
        <p class="api-note">共 ${stats.words} 个词。数据库保留全部主题；首页展览队列最多 ${stats.max} 版，换入新版只会移出最早一版，不删除数据库。</p>`;
    } catch (_) {
      target.innerHTML = `<p class="api-note">主题库暂时无法读取。</p>`;
    }
  }

  function themeDisplayLoad() {
    try {
      const value = JSON.parse(localStorage.getItem(THEME_DISPLAY_KEY) || "[]");
      return Array.isArray(value) ? value.map(String) : [];
    } catch (_) {
      return [];
    }
  }

  function themeDisplaySave() {
    try { localStorage.setItem(THEME_DISPLAY_KEY, JSON.stringify(state.themeDisplay)); } catch (_) { /* no-op */ }
  }

  async function initThemeStore() {
    try {
      let decks = await themeDecksRead();
      if (!decks.length) {
        // One-time migration from the old localStorage cache.
        let legacy = [];
        try { legacy = JSON.parse(localStorage.getItem(THEME_LEGACY_KEY) || "[]"); } catch (_) { legacy = []; }
        if (Array.isArray(legacy) && legacy.length) {
          for (const deck of legacy) {
            try { await themeDeckSave(deck); } catch (_) { /* skip malformed */ }
          }
          try { localStorage.removeItem(THEME_LEGACY_KEY); } catch (_) { /* no-op */ }
          decks = await themeDecksRead();
        }
      }
      state.themeDecks = decks;
      const titles = new Set(decks.map((deck) => deck.title));
      let display = themeDisplayLoad().filter((title) => titles.has(title));
      for (const deck of decks) {
        if (display.length >= THEME_DISPLAY_LIMIT) break;
        if (!display.includes(deck.title)) display.push(deck.title);
      }
      state.themeDisplay = display.slice(0, THEME_DISPLAY_LIMIT);
      state.themeIndex = 0;
      themeDisplaySave();
    } catch (error) {
      console.warn("Theme database unavailable.", error);
      state.themeDecks = [];
      state.themeDisplay = [];
    }
  }

  function ensureThemeDecks() {
    if (!Array.isArray(state.themeDecks)) state.themeDecks = [];
    if (!Array.isArray(state.themeDisplay)) state.themeDisplay = [];
    if (!state.themeDisplay.length && state.themeDecks.length) {
      state.themeDisplay = state.themeDecks.slice(0, THEME_DISPLAY_LIMIT).map((deck) => deck.title);
    }
    if (!state.themeDisplay.length) return;
    state.themeIndex = Math.max(0, Math.min(Number(state.themeIndex) || 0, state.themeDisplay.length - 1));
  }

  function themeDeckByTitle(title) {
    return state.themeDecks.find((deck) => deck.title === title) || null;
  }

  function showThemeDeck(deck, { animate = false } = {}) {
    if (!deck) return;
    ensureThemeDecks();
    let index = state.themeDisplay.indexOf(deck.title);
    if (index === -1) {
      state.themeDisplay.unshift(deck.title);
      if (state.themeDisplay.length > THEME_DISPLAY_LIMIT) {
        state.themeDisplay = state.themeDisplay.slice(0, THEME_DISPLAY_LIMIT);
      }
      themeDisplaySave();
      index = 0;
    }
    state.themeIndex = index;
    state.themeDeck = deck;
    renderThemeSalon({ animate });
  }

  function fallbackThemeDeck() {
    const decks = Array.isArray(CONTENT.themeDecks) ? CONTENT.themeDecks : [];
    return decks[state.themeSeq % Math.max(1, decks.length)] || {
      title: "主题展",
      subtitle: "给词语一个可以站立的地方。",
      scene: "先把一组词放进同一个世界，再让它们彼此照亮。",
      words: []
    };
  }

  function currentThemeDeck() {
    ensureThemeDecks();
    const title = state.themeDisplay[state.themeIndex];
    const deck = title ? themeDeckByTitle(title) : null;
    if (deck) return deck;
    if (state.themeDecks.length) return themeDeckByTitle(state.themeDisplay[0]) || state.themeDecks[0];
    if (state.themeDeck) return state.themeDeck;
    return fallbackThemeDeck();
  }

  function normalizeThemeDeck(raw) {
    const base = raw && typeof raw === "object" ? raw : {};
    const title = String(base.title || "").trim();
    const subtitle = String(base.subtitle || "").trim();
    const scene = String(base.scene || "").trim();
    const words = (Array.isArray(base.words) ? base.words : []).map((item) => ({
      word: String(item?.word || "").trim().toLowerCase(),
      pos: String(item?.pos || "").trim(),
      gloss: String(item?.gloss || "").trim(),
      why: String(item?.why || "").trim()
    })).filter((item) => item.word && item.gloss).slice(0, 5);
    if (!title || words.length < 3) throw new Error("主题内容不完整。");
    return { title, subtitle, scene, words, generated: true, at: Date.now() };
  }

  function themeSalonMarkup(deck) {
    const copy = copyFor("themeSalon");
    const words = Array.isArray(deck.words) ? deck.words : [];
    const lead = words[0];
    const columns = words.slice(1);
    ensureThemeDecks();
    const total = state.themeDisplay.length;
    const libraryTotal = state.themeDecks.length;
    const issue = String(total ? state.themeIndex + 1 : 1).padStart(2, "0");
    const totalLabel = total ? String(total).padStart(2, "0") : "01";
    const libraryLabel = libraryTotal ? String(libraryTotal).padStart(2, "0") : "00";
    const canCycle = total > 1;
    return `<div class="theme-poster">
      <div class="poster-masthead">
        <div class="poster-brand">
          <span class="poster-brand-mark">${esc(copy.brand || "TALK")}</span>
          <span class="poster-brand-section">${esc(copy.masthead)}</span>
        </div>
        <div class="poster-edition">
          <span>${esc(copy.editionLabel)} · No. ${issue} / ${totalLabel}</span>
          <div class="poster-nav" aria-label="缓存内切换">
            <button type="button" data-action="theme-cycle" data-delta="-1" aria-label="上一版" ${canCycle ? "" : "disabled"}>‹</button>
            <button type="button" data-action="theme-cycle" data-delta="1" aria-label="下一版" ${canCycle ? "" : "disabled"}>›</button>
          </div>
        </div>
      </div>
      <div class="poster-rule"></div>
      <div class="poster-head">
        <div>
          <div class="eyebrow poster-kicker"><span class="spark"></span>${esc(copy.kicker)}</div>
          <h2 class="poster-title">${esc(deck.title)}</h2>
          <p class="poster-subtitle">${esc(deck.subtitle || "")}</p>
        </div>
      </div>
      <div class="poster-body">
        ${lead ? `<button class="poster-lead" type="button" data-action="word" data-word="${attr(lead.word)}" aria-label="查看 ${attr(lead.word)}" style="--i:0">
          <span class="poster-lead-label">01 / ${esc(copy.leadLabel)}</span>
          <span class="poster-lead-word">${esc(lead.word)}</span>
          <span class="poster-lead-pos">${esc(posLabel(lead.pos))}</span>
          <span class="poster-lead-gloss">${esc(lead.gloss)}</span>
          <span class="poster-lead-why">${esc(lead.why || "")}</span>
        </button>` : ""}
        <div class="poster-columns">
          ${columns.map((item, index) => `<button class="poster-col" type="button" data-action="word" data-word="${attr(item.word)}" aria-label="查看 ${attr(item.word)}" style="--i:${index + 1}">
            <span class="poster-col-index">${String(index + 2).padStart(2, "0")}</span>
            <span class="poster-col-word">${esc(item.word)}</span>
            <span class="poster-col-pos">${esc(posLabel(item.pos))}</span>
            <span class="poster-col-gloss">${esc(item.gloss)}</span>
            <span class="poster-col-why">${esc(item.why || "")}</span>
          </button>`).join("")}
        </div>
      </div>
      ${deck.scene ? `<div class="poster-scene"><span>${esc(copy.sceneLabel)}</span><p>${esc(deck.scene)}</p></div>` : ""}
      <div class="poster-bottom">
        <span class="poster-cache-count">${total ? `${totalLabel} ${esc(copy.cacheUnit)} · ${esc(copy.libraryLabel)} ${libraryLabel} ${esc(copy.libraryUnit)}` : esc(copy.noCache)}</span>
        <div class="poster-actions">
          <button class="poster-picker" type="button" data-action="theme-picker">${esc(copy.pickerCta)}</button>
          <button class="poster-single ${state.themeGenerating ? "is-loading" : ""}" type="button" data-action="theme-generate" ${state.themeGenerating ? "disabled" : ""}>
            ${state.themeGenerating ? esc(copy.printing) : `${icon("sparkle")} ${esc(copy.singleCta)}`}
          </button>
        </div>
      </div>
      <div class="poster-footer"><span>talk. · ${esc(copy.local)}</span><span>${esc(copy.footerRight)}</span></div>
    </div>`;
  }

  function renderThemeSalon({ animate = false } = {}) {
    const host = $("#theme-salon");
    if (!host) return;
    host.classList.remove("is-printing");
    host.innerHTML = themeSalonMarkup(currentThemeDeck());
    if (animate) {
      void host.offsetWidth;
      host.classList.add("is-printing");
      window.setTimeout(() => host.classList.remove("is-printing"), 1100);
    }
  }

  function cycleTheme(delta) {
    ensureThemeDecks();
    if (state.themeDisplay.length <= 1) return;
    state.themeIndex = (state.themeIndex + Number(delta || 1) + state.themeDisplay.length) % state.themeDisplay.length;
    state.themeDeck = themeDeckByTitle(state.themeDisplay[state.themeIndex]) || state.themeDeck;
    renderThemeSalon({ animate: true });
  }

  async function requestThemeDeck(seed, exclude = []) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 50_000);
    try {
      const endpoint = endpointFor(state.settings.baseUrl, state.settings);
      const messages = [
        { role: "system", content: window.TALK_PROMPTS.theme },
        // Keep the (potentially long) exclusion list last: the static prompt
        // and task prefix stay stable for provider prompt caching.
        { role: "user", content: JSON.stringify({ task: "theme", seed, exclude }) }
      ];
      const response = await postChat(endpoint, state.settings, messages, controller.signal, false, 1200);
      if (!response.ok) {
        const raw = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}${raw ? ` · ${raw.slice(0, 160)}` : ""}`);
      }
      const json = await response.json();
      let content = json?.choices?.[0]?.message?.content;
      if (Array.isArray(content)) content = content.map((part) => typeof part === "string" ? part : part?.text || "").join("");
      return normalizeThemeDeck(parseJsonObject(content));
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function generateThemeDeck() {
    if (state.themeGenerating) return;
    if (!hasModelConfig(state.settings)) {
      toast("未连接模型，先在设置里接入模型");
      return;
    }
    state.themeGenerating = true;
    renderThemeSalon();
    try {
      const exclude = state.themeDecks.map((deck) => deck.title);
      const deck = await requestThemeDeck(`${Date.now()}-${state.themeSeq++}`, exclude);
      await themeDeckSave(deck);
      state.themeDecks = await themeDecksRead();
      showThemeDeck(deck);
      toast("已印好一版，存入主题库");
    } catch (error) {
      console.warn("Theme generation failed.", error);
      toast(`主题生成失败：${String(error?.message || error).slice(0, 100)}`);
    } finally {
      state.themeGenerating = false;
      renderThemeSalon();
    }
  }

  function openThemePicker() {
    const copy = copyFor("themeSalon");
    if (!state.themeDecks.length) {
      toast("主题库里还没有缓存");
      return;
    }
    openSheetShell({ kicker: copy.pickerKicker, title: copy.pickerTitle });
    const holder = $("#sheet-scroll");
    if (!holder) return;
    const currentTitle = currentThemeDeck()?.title || "";
    holder.innerHTML = `<div class="sheet-content theme-picker">
      <p class="settings-intro">数据库共 ${state.themeDecks.length} 版。选一个不在展览队列里的主题，会替换掉队列里最早的一版，但不会删除数据库。</p>
      <div class="theme-picker-list">
        ${state.themeDecks.map((deck, index) => `<button class="theme-picker-item ${deck.title === currentTitle ? "active" : ""}" type="button" data-action="theme-pick" data-title="${attr(deck.title)}">
          <span class="theme-picker-index">No. ${String(index + 1).padStart(2, "0")}</span>
          <span class="theme-picker-copy"><strong>${esc(deck.title)}</strong><small>${esc(deck.subtitle || "无副标题")}</small></span>
          <span class="theme-picker-count">${deck.words?.length || 0} 词${state.themeDisplay.includes(deck.title) ? " · 展览中" : ""}</span>
        </button>`).join("")}
      </div>
    </div>`;
  }

  function pickTheme(title) {
    const deck = themeDeckByTitle(String(title || ""));
    if (!deck) return;
    closeSheet();
    showThemeDeck(deck, { animate: true });
  }

  function homePage() {
    const recent = state.history.length ? state.history.slice(0, 3) : sanitizeHistory(DATA.recent);
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

  function shorten(value, length) {
    const s = String(value ?? "").replace(/\s+/g, " ").trim();
    return s.length > length ? `${s.slice(0, length).trim()}…` : s;
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

  function normalizeExamplesByTheme(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const out = {};
    for (const [id, list] of Object.entries(value)) {
      const examples = normalizeExamples(list);
      if (examples.length) out[id] = examples;
    }
    return Object.keys(out).length ? out : null;
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
     Word page
     ============================================================ */

  function ensureWord(raw) {
    if (!raw) return null;
    const senses = Array.isArray(raw.senses) && raw.senses.length
      ? raw.senses.map((sense) => ({
          en: String(sense.en || sense.definition || sense.meaning || ""),
          zh: String(sense.zh || sense.translation || ""),
          tag: String(sense.tag || "")
        }))
      : [{ en: String(raw.short || raw.definition || ""), zh: String(raw.translation || ""), tag: "" }];
    const posGroups = normalizePosGroups(raw.posGroups, raw.pos || raw.partOfSpeech, senses);
    const mainGroup = posGroups[0] || { pos: "", senses };
    const mainSenses = mainGroup.senses.length ? mainGroup.senses : senses;

    return {
      ...raw,
      word: String(raw.word || ""),
      phonetic: String(raw.phonetic || raw.ipa || ""),
      pos: String(raw.pos || raw.partOfSpeech || mainGroup.pos || ""),
      level: String(raw.level || "—"),
      register: String(raw.register || "common"),
      short: String(raw.short || mainSenses[0]?.en || ""),
      translation: String(raw.translation || mainSenses[0]?.zh || ""),
      note: String(raw.note || ""),
      senses: mainSenses,
      posGroups,
      family: normalizeRelations(raw.family || raw.derivatives),
      synonyms: normalizeRelations(raw.synonyms),
      antonyms: normalizeRelations(raw.antonyms),
      examples: normalizeExamples(raw.examples),
      examplesByTheme: normalizeExamplesByTheme(raw.examplesByTheme || raw.examples_by_theme),
      collocations: normalizeStrings(raw.collocations),
      related: normalizeStrings(raw.related),
      origin: normalizeOrigin(raw.origin || raw.etymology),
      spelling: normalizeSpelling(raw.spelling, raw.word),
      source: raw.source || "demo",
      cached: Boolean(raw.cached),
      model: raw.model || ""
    };
  }

  function spellingBanner(spelling) {
    return `
      <aside class="spelling-banner reveal" style="--d:0" aria-label="拼写校正" title="${attr(spelling.note || "")}">
        <span class="spelling-label">拼写</span>
        <span class="spelling-wrong">${esc(spelling.input)}</span>
        <span class="spelling-arrow" aria-hidden="true">→</span>
        <span class="spelling-right">${esc(spelling.corrected)}</span>
      </aside>`;
  }

  /* Relation cards speak Chinese only. A model (or an older cached entry) may
     hand back an English definition; that is dropped rather than mixed in. */
  function relationGloss(item) {
    const zh = String(item?.zh || "").trim();
    if (/[\u3400-\u9fff]/.test(zh)) return zh;
    const stub = DATA.lexicon[normalizeWord(item?.word || "")];
    if (stub?.zh) return stub.zh;
    // Demo corpus words carry their own Chinese translation; prefer it over an
    // English gloss so the offline cards read Chinese too.
    const entry = DATA.words?.[normalizeWord(item?.word || "")];
    if (entry?.translation && /[\u3400-\u9fff]/.test(entry.translation)) return entry.translation;
    const gloss = String(item?.gloss || "").trim();
    return /[\u3400-\u9fff]/.test(gloss) ? gloss : "";
  }

  function wordPosGroups(word) {
    const groups = Array.isArray(word.posGroups) ? word.posGroups.filter((group) => group && group.senses?.length) : [];
    return groups.length ? groups : [{ pos: word.pos || "", senses: word.senses || [] }];
  }

  function wordPosSwitchHtml(groups) {
    return `<div class="pos-switch" role="tablist" aria-label="词性">
      ${groups.map((group, index) => `<button class="pos-tab pos-pill ${index === 0 ? "active" : ""}" type="button" role="tab" aria-selected="${index === 0}" data-action="word-pos" data-index="${index}" title="${attr(posLabel(group.pos))}">${esc(posLabel(group.pos))}</button>`).join("")}
    </div>`;
  }

  function wordSensesPagerHtml(groups) {
    const totalSenses = groups.reduce((sum, group) => sum + group.senses.length, 0);
    return `<div class="meaning-card meaning-pager" data-word-pos-index="0" data-pos-count="${groups.length}">
      <div class="meaning-track">
        ${groups.map((group, index) => `<section class="meaning-slide" data-pos="${attr(group.pos)}" data-pos-label="${attr(posLabel(group.pos))}" data-sense-count="${group.senses.length}" aria-hidden="${index === 0 ? "false" : "true"}">
          ${group.senses.map((sense, senseIndex) => `
            <div class="sense">
              <span class="sense-num">${String(senseIndex + 1).padStart(2, "0")}</span>
              <div>
                <p class="sense-zh">${esc(sense.zh || sense.en)}</p>
                ${sense.zh && sense.en ? `<p class="sense-en">${esc(sense.en)}</p>` : ""}
                ${sense.tag ? `<span class="micro-tag">${esc(tagLabel(sense.tag))}</span>` : ""}
              </div>
            </div>`).join("")}
        </section>`).join("")}
      </div>
      ${groups.length > 1 ? `<div class="meaning-pager-foot">
        <button class="meaning-pager-arrow" type="button" data-action="word-pos-prev" aria-label="上一组词义">‹</button>
        <span class="meaning-pager-dots" aria-hidden="true">${groups.map((_, index) => `<i class="${index === 0 ? "active" : ""}"></i>`).join("")}</span>
        <span class="meaning-pager-count" data-word-pos-label>1 / ${groups.length}</span>
        <button class="meaning-pager-arrow" type="button" data-action="word-pos-next" aria-label="下一组词义">›</button>
      </div>` : ""}
    </div>`;
  }

  function setWordPos(pager, index) {
    if (!pager) return;
    const slides = $$(".meaning-slide", pager);
    const count = slides.length;
    if (!count) return;
    const next = Math.max(0, Math.min(count - 1, Number(index) || 0));
    pager.dataset.wordPosIndex = String(next);
    const track = $(".meaning-track", pager);
    if (track) track.style.transform = `translateX(-${next * 100}%)`;
    slides.forEach((slide, slideIndex) => {
      slide.setAttribute("aria-hidden", slideIndex === next ? "false" : "true");
    });
    const page = pager.closest(".result-page");
    if (page) {
      $$(".pos-tab", page).forEach((tab) => {
        const active = Number(tab.dataset.index) === next;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
      });
    }
    $$(".meaning-pager-dots i", pager).forEach((dot, dotIndex) => {
      dot.classList.toggle("active", dotIndex === next);
    });
    const label = $("[data-word-pos-label]", pager);
    if (label) label.textContent = `${next + 1} / ${count}`;
  }

  function moveWordPos(pager, delta) {
    if (!pager) return;
    const current = Number(pager.dataset.wordPosIndex) || 0;
    setWordPos(pager, current + Number(delta || 0));
  }

  function wordPagerForTarget(target) {
    const page = target?.closest?.('.result-page');
    return page ? $('.meaning-pager', page) : null;
  }

  function exampleBlockHtml(word, no) {
    const exampleTheme = window.TALK_THEME?.current?.() || { id: "paper", label: "Paper" };
    const themedExamples = exampleForTheme(word, exampleTheme.id);
    if (!themedExamples.length) return "";
    return `
        <section class="block word-example-block reveal" data-block-no="${attr(no)}" style="--d:2.4">
          ${blockHead(no, "例句", `${themedExamples.length} 条`)}
          <div class="example-toolbar">
            <button class="link-btn" type="button" data-action="regen-examples" data-word="${attr(word.word)}">换一批</button>
          </div>
          ${themedExamples.map((example) => `
            <div class="example-card">
              <span class="example-quote">“</span>
              <p class="example-en">${highlightPlain(example.en, word.word)}</p>
              ${example.zh ? `<p class="example-zh">${esc(example.zh)}</p>` : ""}
              <div class="example-foot${example.source ? "" : " is-solo"}">
                ${example.source ? `<span class="example-source">${esc(example.source)}</span>` : ""}
                <button class="example-speak" type="button" data-action="speak" data-text="${attr(example.en)}" aria-label="朗读例句">${icon("volume")}</button>
                <button class="example-speak example-copy" type="button" data-action="copy-text" data-copy="${attr(`${example.en}${example.zh ? `\n${example.zh}` : ""}`)}" aria-label="复制例句">${icon("copy")}</button>
              </div>
            </div>`).join("")}
        </section>`;
  }

  function updateExamplesBlock(word) {
    if (!screen || state.route?.name !== "word") return false;
    const section = $(".word-example-block", screen);
    const no = section?.dataset?.blockNo;
    if (!section || !no) return false;
    const scroll = screen.scrollTop;
    const html = exampleBlockHtml(word, no);
    if (!html) {
      section.remove();
    } else {
      section.outerHTML = html;
    }
    scrollScreenTo(scroll, true);
    applyCacheDisplay();
    refreshCacheBorders(screen);
    return true;
  }

  function wordPage(word, layer = null) {
    let blockNo = 0;
    const nextNo = () => String(++blockNo).padStart(2, "0");
    const bookmark = `word:${normalizeWord(word.word)}`;
    const heroNote = word.note ? rich(word.note) : "";
    const header = layer
      ? layerTopbar({
          label: "词义探索",
          title: word.word,
          bookmark,
          origin: layer.origin,
          relation: layer.relation,
          depth: layer.depth
        })
      : backTopbar({ label: `单词 · ${word.level}`, title: word.word, bookmark });
    return `
      ${header}
      <main class="result-page">
        ${word.spelling ? spellingBanner(word.spelling) : ""}
        <section class="result-hero">
          <div class="result-kicker reveal" style="--d:0">
            <span class="kicker-pill accent">单词</span>
            <span class="kicker-pill">${esc(word.level)}</span>
            <span class="kicker-pill">${esc(registerLabel(word.register))}</span>
            <span class="cache-state-pill ${word.source === "demo" ? "is-builtin" : word.cached ? "is-cached" : "is-generated"}">${word.source === "demo" ? "内置词条" : word.cached ? "本机缓存" : "本次生成"}</span>
          </div>
          <h1 class="word-title" aria-label="${attr(word.word)}">${letterTitle(word.word)}</h1>
          <div class="word-subrow reveal" style="--d:1">
            <span class="ipa">${esc(word.phonetic || "—")}</span>
            <span class="dot-sep"></span>
            ${wordPosSwitchHtml(wordPosGroups(word))}
            <button class="speak-btn" type="button" data-action="speak" data-text="${attr(word.word)}">${icon("volume")} 发音</button>
            <button class="speak-btn speak-regen" type="button" data-action="regenerate-audio" data-text="${attr(word.word)}" title="跳过语音缓存，重新生成">${icon("refresh")}</button>
            <button class="speak-btn word-copy" type="button" data-action="copy-text" data-copy="${attr(`${word.translation || word.short}${word.short && word.translation ? `\n${word.short}` : ""}`)}" aria-label="复制释义" title="复制释义">${icon("copy")}</button>
          </div>
          <div class="word-gloss-row reveal" style="--d:1.1">
            <p class="word-gloss">${esc(word.translation || word.short)}</p>
            <span class="word-gloss-tag">核心义</span>
          </div>
          ${word.translation && word.short ? `<p class="word-short reveal" style="--d:1.2">${esc(word.short)}</p>` : ""}
          ${heroNote ? `<div class="hero-note reveal" style="--d:1.5">
            ${icon("sparkle")}
            <span>${heroNote}</span>
          </div>` : ""}
          ${word.context ? `<div class="context-note reveal" style="--d:1.7">
            <span class="mono">在本句中</span>
            <p>${esc(word.context.meaningZh || word.context.meaning || "")}</p>
            ${word.context.meaningZh && word.context.meaning ? `<span class="context-note-en">${esc(word.context.meaning)}</span>` : ""}
            ${word.context.why ? `<span class="context-note-why">${esc(word.context.why)}</span>` : ""}
          </div>` : ""}
        </section>

        <section class="block word-meaning-block reveal" style="--d:1.8">
          ${(() => {
            const groups = wordPosGroups(word);
            const totalSenses = groups.reduce((sum, group) => sum + group.senses.length, 0);
            return `${blockHead(nextNo(), "词义", `${totalSenses} 个义项`)}${wordSensesPagerHtml(groups)}`;
          })()}
        </section>

        ${word.family.length ? `
        <section class="block word-family-block reveal" style="--d:2">
          ${blockHead(nextNo(), "同根词", "派生词")}
          <div class="h-scroll">
            ${word.family.map((item) => `
              <button class="family-card" type="button" data-action="word-layer" data-word="${attr(item.word)}" data-cache-word="${attr(item.word)}" data-gloss="${attr(relationGloss(item))}" data-pos="${attr(item.pos)}" data-relation="同根词">
                <span class="family-top">
                  <span class="family-pos">${esc(posLabel(item.pos))}</span>
                  ${icon("arrowUpRight", "family-arrow")}
                </span>
                <strong class="family-word">${esc(item.word)}</strong>
                <span class="family-gloss">${esc(relationGloss(item))}</span>
              </button>`).join("")}
          </div>
        </section>` : ""}

        ${(word.synonyms.length || word.antonyms.length) ? `
        <section class="block word-relation-block reveal" style="--d:2.2">
          ${blockHead(nextNo(), "近义与反义", "点击继续查")}
          <div class="relation-grid">
            <div class="relation-card syn">
              <div class="relation-head"><h3>近义词</h3><span class="relation-icon">+</span></div>
              <div class="rel-list">
                ${word.synonyms.map((item) => `
                  <button class="rel-chip" type="button" data-action="word-layer" data-word="${attr(item.word)}" data-cache-word="${attr(item.word)}" data-gloss="${attr(relationGloss(item))}" data-pos="${attr(item.pos)}" data-relation="近义词">
                    <span class="rel-word">${esc(item.word)}</span>
                    <span class="rel-gloss">${esc(relationGloss(item))}</span>
                  </button>`).join("")}
              </div>
            </div>
            <div class="relation-card ant">
              <div class="relation-head"><h3>反义词</h3><span class="relation-icon">−</span></div>
              <div class="rel-list">
                ${word.antonyms.map((item) => `
                  <button class="rel-chip" type="button" data-action="word-layer" data-word="${attr(item.word)}" data-cache-word="${attr(item.word)}" data-gloss="${attr(relationGloss(item))}" data-pos="${attr(item.pos)}" data-relation="反义词">
                    <span class="rel-word">${esc(item.word)}</span>
                    <span class="rel-gloss">${esc(relationGloss(item))}</span>
                  </button>`).join("")}
              </div>
            </div>
          </div>
        </section>` : ""}

        ${exampleBlockHtml(word, nextNo())}

        ${word.collocations.length ? `
        <section class="block word-collocation-block reveal" style="--d:2.6">
          ${blockHead(nextNo(), "常见搭配", "固定说法")}
          <div class="collocation-row">
            ${word.collocations.map((item) => `<button class="collocation" type="button" data-action="lookup" data-query="${attr(item)}" data-type="word">${esc(item)}</button>`).join("")}
          </div>
        </section>` : ""}

        ${word.memory ? `
        <section class="block word-memory-block reveal" style="--d:2.8">
          ${blockHead(nextNo(), "记法", "一个记忆钩子")}
          <div class="memory-card">
            <span class="memory-label">顺着这根线</span>
            <p class="memory-text">${rich(word.memory)}</p>
          </div>
        </section>` : ""}

        ${word.origin ? `
        <section class="block word-origin-block reveal" style="--d:3">
          ${blockHead(nextNo(), "词源与演变", "从词根看")}
          <div class="origin-card">
            <span class="origin-root">${esc(word.origin.root)}</span>
            <p class="origin-story">${rich(word.origin.story)}</p>
            ${word.origin.original ? `<p class="origin-original"><b>最初的意思</b> ${esc(word.origin.original)}</p>` : ""}
          </div>
          ${word.origin.stages.length ? `
          <div class="origin-timeline">
            ${word.origin.stages.map((stage) => `
              <div class="origin-stage">
                <span class="origin-when">${esc(stage.when)}</span>
                <div>
                  <strong class="origin-label">${esc(stage.label)}</strong>
                  <p class="origin-text">${esc(stage.text)}</p>
                </div>
              </div>`).join("")}
          </div>` : ""}
        </section>` : ""}

        ${word.related.length ? `
        <section class="block word-related-block reveal" style="--d:3.2">
          ${blockHead(word.origin ? "08" : "07", "继续漫游", "下一组词")}
          <div class="related-row">
            ${word.related.map((item) => `
              <button class="related-pill" type="button" data-action="word-layer" data-word="${attr(item)}" data-cache-word="${attr(item)}" data-relation="相关词">
                ${esc(item)} <span>↗</span>
              </button>`).join("")}
          </div>
        </section>` : ""}



        <div class="page-actions reveal" style="--d:3.2">
          <button class="btn btn-primary" type="button" data-action="save">${icon("bookmark")} 收藏单词</button>
          <button class="btn btn-secondary" type="button" data-action="copy">${icon("copy")} 复制</button>
          ${hasModelConfig() ? `<button class="btn btn-secondary" type="button" data-action="regenerate-word">${icon("refresh")} 重新生成词条</button>` : ""}
          ${word.source !== "demo" ? `<button class="btn btn-secondary word-delete" type="button" data-action="delete-word-cache" data-word="${attr(word.word)}">${icon("trash")} 删除缓存</button>` : ""}
        </div>
      </main>`;
  }

  /* ============================================================
     Sentence page
     ============================================================ */

  const STRUCTURE_KINDS = ["main", "clause", "phrase", "modifier"];

  /* The sentence tree is model-authored. The client only normalises it so a
     partial or malformed tree still renders, and so a future node kind can be
     added without breaking old data. */
  function normalizeStructureNodes(value, depth = 0, out = { count: 0 }) {
    if (!Array.isArray(value) || depth > 4) return [];
    return value.map((node, index) => {
      if (!node || typeof node !== "object") return null;
      const text = String(node.text || node.en || "").trim();
      if (!text) return null;
      out.count += 1;
      const kind = STRUCTURE_KINDS.includes(node.kind) ? node.kind : (depth === 0 ? "main" : "clause");
      const children = normalizeStructureNodes(node.children || node.items, depth + 1, out);
      return {
        id: String(node.id || `n${depth}-${index}`),
        kind,
        depth,
        anchor: String(node.anchor || node.attachAfter || "").trim(),
        label: String(node.label || node.role || "").trim(),
        text,
        role: String(node.role || node.function || "").trim(),
        gloss: String(node.gloss || node.meaningZh || node.zh || "").trim(),
        note: String(node.note || node.explain || "").trim(),
        children
      };
    }).filter(Boolean);
  }

  function normalizeStructureTree(value) {
    if (!value) return [];
    if (Array.isArray(value)) return normalizeStructureNodes(value);
    if (typeof value !== "object") return [];
    const nodes = value.tree || value.nodes || value.root;
    if (Array.isArray(nodes)) return normalizeStructureNodes(nodes);
    if (nodes && typeof nodes === "object") return normalizeStructureNodes([nodes]);
    return [];
  }

  function splitSentences(text) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (!value) return [];
    const ABBR = /^(mr|mrs|ms|dr|prof|st|jr|sr|vs|etc|e\.g|i\.e|fig|no|approx|dept|est|al)$/i;
    const edges = /[.!?。！？…]["”’')」』]?$/;
    const mergePiece = (prev, next) => {
      if (!prev) return next;
      const bare = prev.replace(/[)"”’」』]+$/, "");
      const lastWord = (bare.split(/[\s(]/).pop() || "").replace(/\.$/, "");
      if (ABBR.test(lastWord)) return `${prev} ${next}`;
      if (/^[A-Z]$/.test(lastWord)) return `${prev} ${next}`;
      if (!edges.test(bare)) return `${prev} ${next}`;
      return null;
    };
    const collect = (input) => {
      const out = [];
      try {
        if (typeof Intl !== "undefined" && Intl.Segmenter) {
          const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
          return [...segmenter.segment(input)].map((item) => item.segment.trim()).filter(Boolean);
        }
      } catch (_) { /* fall through to the regex */ }
      return input.split(/(?<=[.!?。！？…])\s+|(?<=[。！？])/).map((item) => item.trim()).filter(Boolean);
    };
    const merged = [];
    collect(value).forEach((piece) => {
      if (!merged.length) { merged.push(piece); return; }
      const joined = mergePiece(merged[merged.length - 1], piece);
      if (joined) merged[merged.length - 1] = joined;
      else merged.push(piece);
    });
    return merged.map((item) => item.trim()).filter(Boolean).slice(0, 8);
  }

  function normalizeSentenceParts(value) {
    if (!Array.isArray(value)) return [];
    return value.map((part) => {
      const text = String(part?.text || part?.sentence || "").trim();
      const index = Number.isInteger(part?.index) ? part.index : null;
      if (!text && index === null) return null;
      return {
        text,
        index,
        translation: String(part.translation || "").trim(),
        summary: String(part.summary || "").trim(),
        tree: normalizeStructureTree(part.tree || part.structure),
        keyWords: normalizeKeyWords(part.keyWords || part.key_words || part.words)
      };
    }).filter(Boolean);
  }

  function alignSentenceParts(parts, pieces) {
    if (!pieces.length) return parts;
    const byText = new Map();
    parts.forEach((part, index) => {
      const key = normalizeWord(part.text);
      if (key && !byText.has(key)) byText.set(key, part);
      if (index < pieces.length && !byText.has(normalizeWord(pieces[index]))) byText.set(normalizeWord(pieces[index]), part);
    });
    return pieces.map((text, index) => {
      const key = normalizeWord(text);
      const hit = byText.get(key)
        || parts.find((part) => part.index === index || part.index === index + 1)
        || parts[index]
        || null;
      const matches = hit && (!hit.text || normalizeWord(hit.text) === key);
      return {
        text,
        translation: matches ? hit.translation || "" : "",
        summary: matches ? hit.summary || "" : "",
        tree: matches ? hit.tree || [] : [],
        keyWords: matches ? hit.keyWords || [] : [],
        incomplete: Boolean(hit && !matches)
      };
    });
  }

  function ensureSentence(raw) {
    if (!raw) return null;
    const keyWords = normalizeKeyWords(raw.keyWords || raw.key_words || raw.words);
    if (!keyWords.length) return null;
    return {
      ...raw,
      id: String(raw.id || `model-${Date.now()}`),
      text: String(raw.text || raw.sentence || ""),
      translation: String(raw.translation || ""),
      tone: String(raw.tone || ""),
      structure: String(raw.structure || ""),
      source: String(raw.source || "Talk demo corpus"),
      summary: String(raw.summary || raw.gist || "").trim(),
      tree: normalizeStructureTree(raw.tree || raw.structureTree || (raw.structure && raw.structure.tree)),
      sentences: normalizeSentenceParts(raw.sentences || raw.parts),
      keyWords,
      sourceType: raw.sourceType || raw.source || "demo",
      model: raw.model || ""
    };
  }

  function treeKindLabel(kind) {
    return ({ main: "主干", clause: "从句", phrase: "短语", modifier: "修饰" })[kind] || "结构";
  }

  function registerTreeNodes(nodes, bucket) {
    (nodes || []).forEach((node) => {
      bucket[node.id] = node;
      registerTreeNodes(node.children, bucket);
    });
    return bucket;
  }

  function structureTreeHtml(nodes, depth = 0) {
    if (!Array.isArray(nodes) || !nodes.length) return "";
    return `<ul class="tree-list" data-depth="${depth}">
      ${nodes.map((node) => `
        <li class="tree-node kind-${esc(node.kind)}">
          <div class="tree-row">
            ${node.children?.length ? `<button class="tree-expand" type="button" data-action="tree-expand" aria-expanded="false" aria-label="展开这一层">${icon("chevronDown")}</button>` : `<span class="tree-expand is-leaf" aria-hidden="true"></span>`}
            <button class="tree-main" type="button" data-action="structure-node" data-node-id="${attr(node.id)}">
              <span class="tree-kind">${treeKindLabel(node.kind)}</span>
              <span class="tree-text">${esc(node.text)}</span>
              ${node.role ? `<span class="tree-role">${esc(node.role)}</span>` : ""}
            </button>
          </div>
          ${node.children?.length ? `<div class="tree-children" hidden>${structureTreeHtml(node.children, depth + 1)}</div>` : ""}
        </li>`).join("")}
    </ul>`;
  }

  function openInsightSheet(node) {
    const kind = treeKindLabel(node.kind);
    const depthLabel = Number(node.depth) > 0 ? `第 ${Number(node.depth) + 1} 层` : "";
    openSheetShell({ kicker: [kind, depthLabel].filter(Boolean).join(" · "), title: node.label || "这一层在做什么" });
    const holder = $("#sheet-scroll");
    if (!holder) return;
    const rows = [
      { label: "作用", value: node.role, key: true },
      { label: "大意", value: node.gloss },
      { label: "阅读提示", value: node.note }
    ].filter((row) => row.value);
    holder.innerHTML = `
      <div class="insight-sheet">
        <p class="insight-clause">${esc(node.text || "")}</p>
        <div class="insight-rows">
          ${rows.map((row) => `
            <div class="insight-row ${row.key ? "is-key" : ""}">
              <span class="insight-label">${row.label}</span>
              <p class="insight-value">${esc(row.value)}</p>
            </div>`).join("")}
        </div>
        ${node.children?.length ? `
          <div class="insight-nested">
            <span class="insight-label">里面还有</span>
            <ul>${node.children.map((child) => `<li>${esc(child.label || child.text || "")}</li>`).join("")}</ul>
          </div>` : ""}
      </div>`;
  }

  function onionSlot(node, keyWords, depth = 1, suffix = "") {
    const inner = onionCompose(node.text || "", Array.isArray(node.children) ? node.children : [], keyWords, depth + 1);
    return `<span class="onion-slot" data-node-id="${attr(node.id)}"><button class="onion-mark" type="button" data-action="onion-toggle" aria-expanded="false" aria-label="展开这层修饰">+</button><span class="onion-wrap"><span class="onion-clause depth-${Math.min(depth, 3)}" data-depth="${Math.min(depth, 3)}" data-action="onion-open" data-node-id="${attr(node.id)}" role="button" tabindex="0">${inner}${esc(suffix)}</span></span></span>`;
  }

  function tidyClauseText(text) {
    return String(text || "")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/([,;:])(\s*[,;:])+/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function onionCompose(text, children, keyWords, depth = 1) {
    const source = String(text || "");
    const plain = (chunk) => annotateSentence(chunk, keyWords || []);
    const list = (Array.isArray(children) ? children : []).filter((child) => child && child.text && !/…|\.{2,}/.test(child.text));
    if (!list.length) return plain(source);

    const hits = [];
    list.forEach((child) => {
      const at = source.indexOf(child.text);
      if (at >= 0) hits.push({ child, start: at, end: at + child.text.length });
    });
    hits.sort((a, b) => a.start - b.start);

    const segments = [];
    let cursor = 0;
    const nested = new Set();
    hits.forEach((hit) => {
      let { start, end } = hit;
      if (start < cursor) { nested.add(hit.child); return; }
      const before = source.slice(0, start);
      if (/,\s*$/.test(before)) start = before.replace(/,\s*$/, "").length;
      const rest = source.slice(end);
      if (/^\s*,/.test(rest)) end += rest.match(/^\s*,/)[0].length;
      segments.push({ kind: "text", html: plain(tidyClauseText(source.slice(cursor, start))) });
      const tail = source.slice(end).match(/^\s*([.,;:!?]+)\s*$/);
      segments.push({
        kind: "slot",
        node: hit.child,
        suffix: tail ? tail[1] : "",
        html: onionSlot(hit.child, keyWords, hit.child.__depth || depth, tail ? tail[1] : "")
      });
      cursor = end + (tail ? tail[0].length : 0);
    });
    segments.push({ kind: "text", html: plain(tidyClauseText(source.slice(cursor))) });

    const placed = new Set(hits.map((hit) => hit.child));
    list.forEach((child) => {
      if (placed.has(child) || nested.has(child)) return;
      segments.push({ kind: "slot", node: child, suffix: "", html: onionSlot(child, keyWords, child.__depth || depth) });
    });

    const flow = segments.filter((segment) => segment.kind === "slot" || segment.html !== "");
    let html = "";
    for (let i = 0; i < flow.length; i += 1) {
      const segment = flow[i];
      if (segment.kind === "text") { html += segment.html; continue; }
      const run = [segment];
      while (i + 1 < flow.length && flow[i + 1].kind === "slot") { i += 1; run.push(flow[i]); }
      const padBefore = /[\s]$/.test(html) || !html ? "" : " ";
      const padAfter = /^\s/.test(flow[i + 1]?.html || "") ? "" : " ";
      const body = run.map((item) => item.html).join("");
      html += padBefore + body + padAfter;
    }
    return html;
  }

  function hoistDetached(nodes, depth = 1, out = []) {
    (Array.isArray(nodes) ? nodes : []).forEach((node) => {
      if (!node || !node.text) return;
      node.__depth = depth;
      const kids = Array.isArray(node.children) ? node.children : [];
      const inside = [];
      const detached = [];
      kids.forEach((child) => {
        if (!child || !child.text) return;
        (String(node.text).includes(child.text) ? inside : detached).push(child);
      });
      node.children = inside;
      out.push(node);
      hoistDetached(detached, depth + 1, out);
    });
    return out;
  }

  function onionLine(text, tree, keyWords) {
    const nodes = Array.isArray(tree) ? tree.filter((node) => node && (node.text || node.children?.length)) : [];
    if (!nodes.length) return annotateSentence(text, keyWords);
    const main = nodes.find((node) => node.kind === "main");
    // Models often return only the folded layers; treat them as children of the sentence itself.
    const children = main
      ? hoistDetached((main.children || []).concat(nodes.filter((node) => node !== main)), 1)
      : hoistDetached(nodes, 1);
    if (!children.length) return annotateSentence(text, keyWords);
    return onionCompose(text, children, keyWords, 1);
  }

  function onionSentenceBlock(part, index, keyWords) {
    const tree = Array.isArray(part.tree) ? part.tree : [];
    const count = tree.reduce((total, node) => total + 1 + (node.children?.length || 0), 0);
    return `<div class="onion-block" data-onion-block="${index}" data-fold="${state.settings?.foldMode === "inline" ? "inline" : "block"}"><p class="sentence-text onion-line">${onionLine(part.text || "", tree, keyWords)}</p>${count > 1 ? `<div class="onion-tools"><button class="link-btn" type="button" data-action="onion-toggle-all" data-mode="expand">全部展开</button><button class="link-btn" type="button" data-action="onion-toggle-all" data-mode="collapse">收起到主干</button></div>` : ""}</div>`;
  }

  function sentencePage(sentence) {
    let blockNo = 0;
    const nextNo = () => String(++blockNo).padStart(2, "0");
    const parts = Array.isArray(sentence.sentences) && sentence.sentences.length
      ? sentence.sentences
      : [{ text: sentence.text, translation: sentence.translation, summary: sentence.summary || "", tree: sentence.tree || [] }];
    const tree = sentence.tree?.length ? sentence.tree : (parts[0]?.tree || []);
    const renderParts = parts.map((part, index) => ({ ...part, tree: (part.tree && part.tree.length) ? part.tree : (index === 0 ? tree : []) }));
    state.structureNodes = registerTreeNodes(tree.concat(...parts.map((part) => part.tree || [])), {});
    const bookmark = `sentence:${sentence.id}`;
    const multi = renderParts.length > 1;
    return `
      ${backTopbar({ label: multi ? "多句" : "句子", title: multi ? `${renderParts.length} 句` : `${sentence.keyWords.length} 个重点词`, bookmark })}
      <main class="result-page">
        <section class="sentence-hero">
          <div class="result-kicker reveal" style="--d:0">
            <span class="kicker-pill accent">句子</span>
            <span class="kicker-pill">${multi ? `${renderParts.length} 句` : `${sentence.keyWords.length} 个重点词`}</span>
          </div>
          ${multi ? "" : `<div class="onion reveal" style="--d:0.6">${onionSentenceBlock(renderParts[0], 0, sentence.keyWords)}</div>`}
          <div class="sentence-source reveal" style="--d:1">
            <span>${esc(sentence.source || "Talk corpus")}</span>
            <span class="wave"></span>
            <button class="speak-btn" type="button" data-action="speak" data-text="${attr(sentence.text)}">${icon("volume")} 朗读</button>
            <button class="speak-btn speak-regen" type="button" data-action="regenerate-audio" data-text="${attr(sentence.text)}" title="跳过语音缓存，重新生成">${icon("refresh")}</button>
          </div>
        </section>

        <section class="block reveal" style="--d:1.3">
          ${blockHead(nextNo(), multi ? "整段意思" : "整句意思", "中文翻译")}
          <div class="translation-card">
            <span class="translation-label">${icon("quote")} ${multi ? "整段理解" : "整句理解"}</span>
            <p class="translation-text">${esc(sentence.translation || "连接模型后生成翻译。")}</p>
            ${sentence.tone ? `<span class="translation-tone">${esc(sentence.tone)}</span>` : ""}
          </div>
          ${(sentence.tone || sentence.structure) ? `
          <div class="insight-grid">
            <div class="insight">
              <span class="mono">语气</span>
              <p>${esc(sentence.tone || "—")}</p>
            </div>
            <div class="insight">
              <span class="mono">句式</span>
              <p>${esc(sentence.structure || "—")}</p>
            </div>
          </div>` : ""}
        </section>

        ${multi ? renderParts.map((part, index) => `
        <section class="block sentence-part reveal" style="--d:1.3">
          ${blockHead(nextNo(), `句子 ${index + 1}`, part.translation ? "中文翻译" : "结构")}
          <div class="onion">${onionSentenceBlock(part, index, part.keyWords.length ? part.keyWords : sentence.keyWords)}</div>
          ${part.translation ? `<p class="sentence-part-zh">${esc(part.translation)}</p>` : ""}
          ${part.summary ? `<div class="summary-card">${esc(part.summary)}</div>` : ""}
          ${part.incomplete ? `<p class="sentence-part-missing">模型把这几句并成了一段，这一句没有单独分析；重试或逐句查询即可。</p>` : ""}
          ${part.keyWords.length ? `<div class="key-list">${part.keyWords.map((keyWord, n) => keyCard(keyWord, index * 100 + n)).join("")}</div>` : ""}
        </section>`).join("") : ""}

        ${sentence.summary ? `
        <section class="block reveal" style="--d:1.35">
          ${blockHead(nextNo(), multi ? "整段主旨" : "浓缩主旨", "一句话记住")}
          <div class="summary-card">${esc(sentence.summary)}</div>
        </section>` : ""}

        ${multi ? "" : `<section class="block reveal" style="--d:1.5">
          ${blockHead(nextNo(), "值得注意的词", "点击展开")}
          <div class="key-list">
            ${sentence.keyWords.map((keyWord, index) => keyCard(keyWord, index)).join("")}
          </div>
        </section>`}

        <div class="page-actions reveal" style="--d:2">
          <button class="btn btn-primary" type="button" data-action="save">${icon("bookmark")} 收藏句子</button>
          ${hasModelConfig() ? `<button class="btn btn-secondary" type="button" data-action="regenerate-sentence">${icon("refresh")} 重新生成分析</button>` : ""}
          <button class="btn btn-secondary" type="button" data-action="forget-sentence">删除缓存</button>
          <button class="btn btn-secondary" type="button" data-action="copy">${icon("copy")} 复制</button>
        </div>
      </main>`;
  }

  function keyCard(keyWord, index) {
    const open = index === 0;
    const relations = [
      ...keyWord.family.map((item) => ({ ...item, kind: "family" })),
      ...keyWord.synonyms.map((item) => ({ ...item, kind: "syn" })),
      ...keyWord.antonyms.map((item) => ({ ...item, kind: "ant" }))
    ].slice(0, 7);
    return `
      <article class="key-card ${open ? "open" : ""}">
        <button class="key-toggle" type="button" data-action="key-toggle" aria-expanded="${open}" aria-controls="key-body-${index}">
          <span class="key-number">${String(index + 1).padStart(2, "0")}</span>
          <span class="key-main">
            <span class="key-word-line">
              <span class="key-word">${esc(keyWord.word)}</span>
              <span class="key-ipa">${esc(keyWord.phonetic || "")}</span>
              <span class="key-pos">${esc(posLabel(keyWord.pos))}</span>
            </span>
            <span class="key-context">${esc(keyWord.meaningZh || keyWord.meaning || "")}</span>
          </span>
          <span class="key-chevron">${icon("chevronDown")}</span>
        </button>
        <div class="key-body" id="key-body-${index}">
          <div class="key-body-inner">
            <div class="key-content">
              <div class="key-meaning"><strong>在本句中</strong> · ${esc(keyWord.meaningZh || keyWord.meaning || "")}</div>
              ${keyWord.meaningZh && keyWord.meaning ? `<p class="key-meaning-en">${esc(keyWord.meaning)}</p>` : ""}
              ${keyWord.why ? `<p class="key-why"><b>为什么重要：</b> ${esc(keyWord.why)}</p>` : ""}
              ${relations.length ? `
              <div class="mini-relations">
                ${relations.map((item) => `
                  <button class="mini-rel ${item.kind === "syn" ? "syn" : item.kind === "ant" ? "ant" : ""}" type="button"
                    data-action="word-layer" data-word="${attr(item.word)}" data-cache-word="${attr(item.word)}" data-gloss="${attr(relationGloss(item))}" data-pos="${attr(posAbbr(item.pos))}"
                    data-relation="${item.kind === "syn" ? "近义词" : item.kind === "ant" ? "反义词" : "同根词"}"
                    title="${attr(item.gloss)}">${esc(item.word)}</button>`).join("")}
              </div>` : ""}
              ${keyWord.example?.en ? `
              <div class="key-example">
                ${highlightPlain(keyWord.example.en, keyWord.word)}
                ${keyWord.example.zh ? `<span>${esc(keyWord.example.zh)}</span>` : ""}
              </div>` : ""}
              <button class="key-open" type="button" data-action="word-layer" data-word="${attr(keyWord.word)}" data-relation="重点词">
                查看完整词条 ${icon("arrowUpRight")}
              </button>
            </div>
          </div>
        </div>
      </article>`;
  }

  function annotateSentence(text, keyWords) {
    const items = keyWords
      .map((keyWord, index) => ({
        index,
        surface: String(keyWord.surface || keyWord.word || ""),
        word: String(keyWord.word || keyWord.surface || ""),
        tip: String(keyWord.meaningZh || keyWord.meaning || "").slice(0, 46)
      }))
      .filter((item) => item.surface)
      .sort((a, b) => b.surface.length - a.surface.length);

    if (!items.length) return esc(text);
    let re;
    try {
      re = new RegExp(items.map((item) => escapeRegExp(item.surface)).join("|"), "gi");
    } catch (_) {
      return esc(text);
    }

    let out = "";
    let last = 0;
    for (const match of text.matchAll(re)) {
      out += esc(text.slice(last, match.index));
      const matched = items.find((item) => item.surface.toLowerCase() === match[0].toLowerCase()) || items[0];
      out += `<button class="kw" type="button" data-action="open-key" data-index="${matched.index}"${matched.tip ? ` data-tip="${attr(matched.tip)}"` : ""} aria-label="查看 ${attr(matched.word)}">${esc(match[0])}</button>`;
      last = match.index + match[0].length;
    }
    out += esc(text.slice(last));
    return out;
  }

  /* ============================================================
     Loading / missing / error
     ============================================================ */

  function loadingBody(query, type, { statusText, withPreview = false } = {}) {
    const status = statusText || (type === "sentence" ? "找出真正重要的词" : "正在理解词义");
    return `
      <main class="result-page loading-page">
        <div class="loading-lead">
          <div class="result-kicker reveal" style="--d:0">
            <span class="kicker-pill accent">${type === "sentence" ? "句子" : "单词"}</span>
            <span class="kicker-pill">正在整理</span>
          </div>
          <h1 class="loading-query reveal" style="--d:0.4">${esc(query)}</h1>
          <div class="loading-status reveal" style="--d:0.8">
            <span class="loading-dots"><i></i><i></i><i></i></span>
            <span${withPreview ? ' id="loading-status-text"' : ""}>${status}</span>
          </div>
          ${withPreview ? '<div class="live-preview" id="live-preview" hidden></div>' : ""}
          <div class="skeleton-stack reveal" style="--d:1">
            <div class="skeleton hero"></div>
            <div class="skeleton line"></div>
            <div class="skeleton line short"></div>
          </div>
        </div>
        <div class="skeleton-blocks reveal" style="--d:1">
          <div class="skeleton card tall"></div>
          <div class="skeleton card"></div>
          <div class="skeleton line"></div>
        </div>
      </main>`;
  }

  function loadingPage(query, type) {
    return `
      ${backTopbar({ label: type === "sentence" ? "正在理解句子" : "正在查询单词", title: shorten(query, 28) })}
      ${loadingBody(query, type, { withPreview: true })}`;
  }

  function missPage(type, query, suggestions = []) {
    const isSentence = type === "sentence";
    const fallback = suggestions.length
      ? suggestions
      : isSentence
        ? DATA.sentences.slice(0, 2).map((item) => item.text)
        : ["serendipity", "ephemeral", "resilient"];
    return `
      ${backTopbar({ label: "离线演示", title: isSentence ? "句子尚未收录" : "单词尚未收录" })}
      <main class="result-page state-page">
        <div class="state-orb reveal" style="--d:0">?</div>
        <h1 class="state-title reveal" style="--d:0.4">离线词库还没收录。</h1>
        <p class="state-copy reveal" style="--d:0.6">离线词库很小。连接模型后，可以${isSentence ? "把任何句子拆成重点词，读懂语气与结构" : "查任何单词，连带近义词、反义和例句"}。也可以先看下面的示例。</p>
        <span class="state-query reveal" style="--d:0.8">${esc(shorten(query, 88))}</span>
        <div class="state-actions reveal" style="--d:1">
          <button class="btn btn-primary" type="button" data-action="settings">${icon("wand")} 连接模型</button>
          <button class="btn btn-secondary" type="button" data-action="lookup" data-query="${attr(fallback[0])}" data-type="${isSentence ? "sentence" : "word"}">先看示例</button>
        </div>
        <div class="recent-row reveal" style="--d:1.2; padding-left:0; padding-right:0; margin-top:22px; flex-wrap:wrap;">
          ${fallback.slice(0, 3).map((item) => `
            <button class="chip" type="button" data-action="lookup" data-query="${attr(item)}" data-type="${isSentence ? "sentence" : "word"}">
              ${isSentence ? '<span class="quote-dot"></span>' : ""}${esc(shorten(item, 43))}
            </button>`).join("")}
        </div>
      </main>`;
  }

  function errorPage(route) {
    const isCors = /failed to fetch|network|cors|load failed/i.test(route.message || "");
    return `
      ${backTopbar({ label: "模型请求", title: "请求中断" })}
      <main class="result-page state-page">
        <div class="state-orb coral reveal" style="--d:0">!</div>
        <h1 class="state-title reveal" style="--d:0.4">这次没接住。</h1>
        <p class="state-copy reveal" style="--d:0.6">模型请求没有完整返回。${isCors ? "浏览器直连常会被 CORS 拦截；可以把 API 地址换成你自己的代理。" : "请检查接口地址、模型名和密钥，然后再试一次。"}</p>
        <span class="state-query reveal" style="--d:0.8">${esc(shorten(route.query || "", 88))}</span>
        ${route.message ? `<div class="error-detail reveal" style="--d:1">${esc(shorten(route.message, 320))}</div>` : ""}
        <div class="state-actions reveal" style="--d:1.1">
          <button class="btn btn-primary" type="button" data-action="retry">${icon("refresh")} 重试</button>
          <button class="btn btn-secondary" type="button" data-action="settings">${icon("settings")} 模型设置</button>
          <button class="btn btn-secondary" type="button" data-action="copy-diagnostics">${icon("copy")} 复制诊断</button>
          ${hasDemo(route.query, route.type) ? `<button class="btn btn-secondary" type="button" data-action="demo">使用演示词条</button>` : ""}
        </div>
      </main>`;
  }

  function hasDemo(query, type) {
    try {
      if (type === "word") return Boolean(DATA.words[normalizeWord(query)]);
      return Boolean(DATA.sentences.find((item) => normalizeSentence(item.text) === normalizeSentence(query)));
    } catch (_) {
      return false;
    }
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

  function mountWordLayer({ word, data, origin, relation, depth, content, options = {} }) {
    const layer = document.createElement("section");
    layer.className = "word-layer";
    layer.style.setProperty("--depth", String(depth));
    layer.style.zIndex = String(2 + depth);
    layer.tabIndex = -1;
    layer.setAttribute("role", "region");
    layer.setAttribute("aria-label", `${word} 词条，第 ${depth} 层`);
    layer.innerHTML = `<div class="layer-scroll">${content}</div>`;
    applyCacheDisplay();
    refreshCacheBorders(layer);

    ensureLayerScrim();
    const previous = state.wordLayers[state.wordLayers.length - 1];
    if (previous) {
      previous.el.classList.add("is-behind");
      previous.el.setAttribute("aria-hidden", "true");
    }

    layerRoot.appendChild(layer);
    const record = {
      el: layer,
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
    if (data) schedulePrefetch(data);
    else updateCacheCorner(false, "正在生成本层词条");

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
    scroll.innerHTML = content;
    enhanceWordColumns(scroll);
    applyCacheDisplay();
    refreshCacheBorders(scroll);
    scroll.scrollTop = 0;
    const first = $(".sheet-content, .result-page", scroll);
    if (first && !reduceMotion) {
      first.animate(
        [
          { opacity: 0, transform: "translateY(8px)" },
          { opacity: 1, transform: "translateY(0)" }
        ],
        { duration: 320, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
      );
    }
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
      replaceLayerContent(record, wordPage(data, {
        origin: record.origin,
        relation: record.relation,
        depth: record.depth
      }));
      schedulePrefetch(data);
    } catch (error) {
      if (!record.el.isConnected) return;
      const message = error?.name === "AbortError"
        ? "请求超过 60 秒，已中断。"
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

  function openTemplatePicker() {
    openSheetShell({ kicker: "MODEL TEMPLATES", title: "从模板新建配置" });
    const body = $("#sheet-scroll", overlayRoot);
    if (!body) return;
    body.innerHTML = `
      <div class="template-list">
        ${PROVIDER_TEMPLATES.map((template) => `
          <button class="template-row" type="button" data-action="new-from-template" data-template="${attr(template.id)}">
            <span class="template-head">
              <strong>${esc(template.name)}</strong>
              <span class="template-badge">${template.protocol === "google" ? "Gemini" : "OpenAI 兼容"}</span>
            </span>
            <span class="template-url mono">${esc(template.baseUrl || "自行填写地址")}</span>
            <span class="template-note">${esc(template.note || "")}</span>
          </button>`).join("")}
      </div>`;
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

  function isQwenProfile(profile = {}) {
    return profile.id === "qwen" || /qianwenaiapi|dashscope|qwencloudapi/i.test(profile.baseUrl || "");
  }

  function qwenTtsProfile(cfg = state.settings) {
    const profiles = (cfg.profiles || []).filter((profile) => profile.apiKey && isQwenProfile(profile));
    if (!profiles.length) return null;
    return profiles.find((profile) => profile.id === cfg.activeProfileId)
      || profiles.find((profile) => profile.id === "qwen")
      || profiles[0];
  }

  function secureRemoteUrl(url) {
    const value = String(url || "");
    if (location.protocol === "https:" && /^http:\/\//i.test(value)) {
      return value.replace(/^http:\/\//i, "https://");
    }
    return value;
  }

  function qwenTtsEndpoint(profile, model = state.settings?.qwenTtsModel) {
    const base = String(profile?.baseUrl || "").trim();
    if (!base) return "";
    try {
      const origin = secureRemoteUrl(new URL(base).origin);
      // Qwen3-TTS uses the multimodal generation route; Qwen-Audio-TTS uses
      // the dedicated non-realtime speech route.
      const path = /^qwen3-tts/i.test(String(model || ""))
        ? "/api/v1/services/aigc/multimodal-generation/generation"
        : "/api/v1/services/audio/tts/SpeechSynthesizer";
      return `${origin}${path}`;
    } catch (_) {
      return "";
    }
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

  function modelSettingsHtml(draft) {
    return `
      <div class="model-profile-head">
        <span class="settings-subhead">模型配置</span>
        <span class="mono">${draft.profiles.length} 个</span>
      </div>
      <div class="model-profile-strip" role="list" aria-label="模型配置">
        ${draft.profiles.map((profile) => `
          <button class="model-profile-chip ${profile.id === draft.activeProfileId ? "active" : ""}" type="button" role="listitem" data-action="select-profile" data-profile="${attr(profile.id)}" aria-pressed="${profile.id === draft.activeProfileId}">
            <strong>${esc(profile.name)}</strong>
            <small>${esc(profile.model || profile.baseUrl || "未配置")}</small>
          </button>`).join("")}
        <button class="model-profile-add" type="button" data-action="add-profile" aria-label="新增模型配置">+</button>
      </div>
            <div class="field">
        <label for="profile-name">配置名称</label>
        <input id="profile-name" type="text" data-profile-name value="${attr(activeProfile(draft)?.name || "")}" placeholder="例如：DeepSeek 主力" spellcheck="false" autocomplete="off" />
      </div>
      <div class="field">
        <label for="base-url">API 地址</label>
        <input id="base-url" type="url" inputmode="url" data-setting="baseUrl" value="${attr(draft.baseUrl)}" placeholder="https://api.deepseek.com" spellcheck="false" autocomplete="off" />
      </div>
      <div class="field">
        <label for="model-name">模型</label>
        <input id="model-name" type="text" data-setting="model" value="${attr(draft.model)}" placeholder="deepseek-chat" spellcheck="false" autocomplete="off" />
      </div>
      <div class="field">
        <label>生成深度</label>
        <div class="detail-switch" role="group" aria-label="生成深度">
          ${Object.entries(DETAIL_LEVELS).map(([id, item]) => `
            <button class="detail-btn ${(draft.detailLevel || "standard") === id ? "active" : ""}" type="button" data-action="detail-level" data-level="${id}" aria-pressed="${(draft.detailLevel || "standard") === id}">${item.label}</button>`).join("")}
        </div>
      </div>
      ${profileSupportsThinking(activeProfile(draft)) ? `
      <div class="thinking-panel">
        <label class="check-row">
          <input type="checkbox" data-profile-option="enableThinking" ${draft.enableThinking ? "checked" : ""} />
          开启深度思考
        </label>
        <div class="thinking-budget-row">
          <label for="thinking-budget">思考预算（tokens）</label>
          <input id="thinking-budget" type="number" min="0" max="262144" step="128" data-profile-option="thinkingBudget" value="${Number(draft.thinkingBudget) || 0}" inputmode="numeric" />
        </div>
        <p class="field-hint">0 = 模型默认；一般 256–1024。</p>
      </div>` : ""}
      ${activeProfile(draft)?.note ? `<p class="field-hint model-profile-note">${esc(activeProfile(draft).note)}</p>` : ""}
      <div class="field">
        <label for="api-key">API 密钥</label>
        <input id="api-key" type="password" data-setting="apiKey" value="${attr(draft.apiKey)}" placeholder="sk-…" spellcheck="false" autocomplete="off" />
        <p class="field-hint">加密后保存在本机；关闭“记住”时只留在当前会话。</p>
      </div>
      <label class="check-row">
        <input type="checkbox" data-setting="remember" ${draft.remember ? "checked" : ""} />
        在这台设备上记住密钥
      </label>
      ${draft.profiles.length > 1 ? `<button class="link-btn model-profile-delete" type="button" data-action="delete-profile">删除当前配置</button>` : ""}
      <div class="key-status ${hasModelConfig(draft) ? "" : "off"}" id="api-test-status">
        ${hasModelConfig(draft) ? `${icon("shield")} <span>已配置 · ${esc(activeProfile(draft)?.name || draft.model || "自定义")}</span>` : "<span>演示模式 · 无需密钥</span>"}
      </div>
      <div class="settings-inline-actions">
        <button class="btn btn-secondary" type="button" data-action="test-connection">${icon("sparkle")} 测试连接</button>
      </div>
      <p class="api-note"><b>浏览器限制：</b>部分服务商会用 CORS 拦截网页直连；这里失败不代表密钥有误。把地址换成自建代理可以绕开，也能把真实密钥留在服务端。</p>`;
  }

  function dataSettingsHtml(draft) {
    const stats = wordCacheStats();
    return `
      <div class="theme-setting">
        <span class="settings-subhead">外观主题</span>
        <div class="theme-list" role="list" aria-label="外观主题">
          ${Object.values(window.TALK_THEME.themes).map((theme) => {
            const active = window.TALK_THEME.current().id === theme.id;
            return `<div class="theme-row${active ? " is-active open" : ""}" role="listitem" data-theme-row="${attr(theme.id)}">
              <button class="theme-row-head" type="button" data-action="theme-toggle" data-theme="${attr(theme.id)}" aria-expanded="${active}">
                <span class="theme-swatch" aria-hidden="true"><i style="background:${attr(theme.themeColor || "#f3f0e7")}"></i><i style="background:${attr(theme.accent || "#171813")}"></i></span>
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
          <span id="settings-save-status"><span data-app-version>v${APP_VERSION}</span> · ${state.settingsDirty ? "正在保存…" : "更改自动保存"}</span>
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

  function openHistorySheet() {
    const translating = state.module === "translator";
    openSheetShell({
      kicker: translating ? "翻译足迹" : "查询足迹",
      title: translating ? "最近翻译" : "最近查询"
    });
    renderHistoryContent();
  }

  function historyForCurrentModule() {
    const translating = state.module === "translator";
    return state.history.filter((item) =>
      translating ? item.type === "translation" : item.type !== "translation"
    );
  }

  function renderHistoryContent() {
    const holder = $("#sheet-scroll");
    if (!holder) return;
    const items = historyForCurrentModule();
    const translating = state.module === "translator";
    holder.innerHTML = `
      <div class="sheet-content">
        ${items.length ? `
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
          <div class="history-empty">${translating ? "还没有翻译记录。<br />译一句，它会在这里等你。" : "还没有查询记录。<br />查一个词，它会在这里等你。"}</div>`}
      </div>`;
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
    const started = performance.now();
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 30_000);
      if (isGoogleProvider(state.draft)) {
        await googleChat(state.draft, [{ role: "user", content: "Reply with exactly: OK" }], controller.signal, 16, false);
        window.clearTimeout(timer);
      } else {
        const response = await fetch(endpointFor(state.draft.baseUrl, state.draft), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${String(state.draft.apiKey || "").trim()}`
          },
          body: JSON.stringify({
            model: state.draft.model,
            messages: [{ role: "user", content: "Reply with exactly: OK" }],
            temperature: 0,
            max_tokens: 8,
            stream: false,
            ...thinkingParams(state.draft)
          }),
          signal: controller.signal
        });
        window.clearTimeout(timer);
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(`HTTP ${response.status}${text ? ` · ${text.slice(0, 120)}` : ""}`);
        }
      }
      const elapsed = Math.round(performance.now() - started);
      status.className = "key-status";
      status.innerHTML = `${icon("check")} <span>已连接 ${esc(state.draft.model || "模型")} · ${elapsed} ms</span>`;
    } catch (error) {
      const message = error?.name === "AbortError" ? "请求超时。" : String(error?.message || "无法连接。");
      status.className = "key-status off";
      status.innerHTML = `<span>${esc(shorten(message, 140))}</span>`;
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

    const type = requestedMode === "auto" ? detectType(query) : requestedMode;
    state.lastAttempt = { query, type };
    const token = ++state.searchSeq;
    navigate({ name: "loading", query, type });
    startLoadingStatus(type);

    try {
      let result;
      if (hasModelConfig()) {
        const onPreview = (preview) => updateStreamPreview(preview, type);
        result = type === "word"
          ? await lookupWordDeduped(query, { onPreview })
          : await modelLookup(query, type, state.settings, { ...options, onPreview });
      } else {
        await wait(820);
        result = lookupDemo(query, type);
      }
      if (token !== state.searchSeq) return;
      clearLoadingTimer();
      addHistory(type, query);
      const route = result.type === "word"
        ? { name: "word", word: result.data.word, result: result.data }
        : { name: "sentence", id: result.data.id, result: result.data };
      navigate(route, { replace: true, direction: "forward" });
    } catch (error) {
      if (token !== state.searchSeq) return;
      clearLoadingTimer();
      if (error instanceof DemoMiss) {
        navigate({ name: "miss", type: error.type, query: error.query, suggestions: error.suggestions }, { replace: true });
        return;
      }
      const message = error?.name === "AbortError"
        ? "请求超过 60 秒，已中断。"
        : String(error?.message || "模型返回了未知错误。");
      navigate({ name: "error", query, type, message }, { replace: true });
    }
  }

  function startLoadingStatus(type) {
    clearLoadingTimer();
    const messages = type === "sentence"
      ? ["正在读这句话", "找出真正重要的词", "整理语气与含义"]
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

  function outputCeiling(cfg) {
    const provider = String(cfg?.provider || "").toLowerCase();
    if (provider === "google") return 32000;
    if (provider === "openai") return 16000;
    if (provider === "deepseek") return 8192;
    return 20000;
  }

  function isGoogleProvider(cfg) {
    if (cfg?.protocol) return String(cfg.protocol).toLowerCase() === "google";
    if (String(cfg?.provider || "").toLowerCase() === "google") return true;
    return /generativelanguage\.googleapis\.com/i.test(String(cfg?.baseUrl || ""));
  }

  function googleRoot(baseUrl) {
    const base = String(baseUrl || "https://generativelanguage.googleapis.com/v1beta").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(base)) throw new Error("API 地址需要以 http:// 或 https:// 开头。");
    return /\/v\d+(?:beta|alpha)?(?:\/|$)/i.test(base) ? base : `${base}/v1beta`;
  }

  function googleModelUrl(cfg, stream) {
    const model = String(cfg?.model || "gemini-3.6-flash").trim().replace(/^models\//, "") || "gemini-3.6-flash";
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    const sep = action.includes("?") ? "&" : "?";
    return `${googleRoot(cfg?.baseUrl)}/models/${encodeURIComponent(model)}:${action}${sep}key=${encodeURIComponent(String(cfg?.apiKey || "").trim())}`;
  }

  function googlePayload(messages, maxTokens, jsonMode, cfg = {}) {
    const system = messages.filter((m) => m.role === "system").map((m) => String(m.content || "")).join("\n\n");
    const user = messages.filter((m) => m.role !== "system").map((m) => String(m.content || "")).join("\n\n");
    const payload = {
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: maxTokens
      }
    };
    if (jsonMode) payload.generationConfig.responseMimeType = "application/json";
    // Gemini 2.5/3 spend output tokens on thinking unless told otherwise; a
    // long JSON answer then gets cut mid-object even with a generous ceiling.
    const model = String(cfg.model || "").toLowerCase();
    if (/gemini-3/.test(model)) payload.generationConfig.thinkingConfig = { thinkingLevel: "LOW" };
    else if (/gemini-2\.5/.test(model)) payload.generationConfig.thinkingConfig = { thinkingBudget: 0 };
    if (system) payload.systemInstruction = { parts: [{ text: system }] };
    return payload;
  }

  function googleText(json) {
    const parts = json?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return "";
    return parts.map((part) => String(part?.text || "")).join("");
  }

  function endpointFor(baseUrl, cfg) {
    if (isGoogleProvider(cfg)) return googleModelUrl(cfg, false).replace(/:generateContent\?.*$/, "");
    let base = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!base) throw new Error("请先在模型设置里填写 API 地址。");
    if (!/^https?:\/\//i.test(base)) throw new Error("API 地址需要以 http:// 或 https:// 开头。");
    if (!/\/chat\/completions$/i.test(base)) base += "/chat/completions";
    return base;
  }

  const WORD_SYSTEM_PROMPT = window.TALK_PROMPTS.word;
  const SENTENCE_SYSTEM_PROMPT = window.TALK_PROMPTS.sentence;
  const TRANSLATOR_STYLES = window.TALK_CONTENT.translator.styles;
  // Long paragraphs are fine: the request only has to fit the model context.
  const TRANSLATOR_MAX_CHARS = 4000;
  // A sentence to analyse can be a paragraph; the word lookup path stays short.
  const SEARCH_MAX_CHARS = 800;
  const TRANSLATOR_SYSTEM_PROMPT = window.TALK_PROMPTS.translator;

  state.translatorStyles = TRANSLATOR_STYLES.map((style) => style.id);

  function systemPrompt(type) {
    return type === "sentence" ? SENTENCE_SYSTEM_PROMPT : WORD_SYSTEM_PROMPT;
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
      detail,
      themes: themeBriefs().filter((theme) => {
        const active = window.TALK_THEME?.current?.();
        return !active || theme.id === active.id;
      }),
      query: String(query)
    });
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
    const detail = cfg.detailLevel || "standard";
    if (type === "word") {
      const cached = cacheGetWord(query, detail);
      if (cached) return { type: "word", data: cached };
    }
    const pieces = type === "sentence" ? splitSentences(query) : [];
    const sentenceCacheKey = type === "sentence"
      ? await sentenceKey(query, sentenceLevelOf(cfg.sentenceLevel).id, detail)
      : "";
    if (type === "sentence" && !options.skipCache) {
      const cached = cacheGetSentence(sentenceCacheKey);
      if (cached) {
        diagLog("info", "sentence.cache", "hit", { chars: String(query).length });
        return { type: "sentence", data: cached };
      }
    }
    const endpoint = endpointFor(cfg.baseUrl, cfg);
    const prompt = type === "sentence" ? sentencePrompt(query, detail, pieces) : wordPrompt(query, detail);
    const messages = [
      { role: "system", content: systemPrompt(type) },
      { role: "user", content: prompt }
    ];
    let controller = new AbortController();
    let timedOut = false;
    let timer = 0;
    const armDeadline = () => {
      window.clearTimeout(timer);
      controller = new AbortController();
      timedOut = false;
      timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
    };
    armDeadline();
    const detailTokens = (DETAIL_LEVELS[detail] || DETAIL_LEVELS.standard).maxTokens;
    const wanted = type === "sentence"
      ? Math.max(detailTokens, SENTENCE_MAX_TOKENS[detail] || SENTENCE_MAX_TOKENS.standard)
      : detailTokens;
    const maxTokens = Math.min(wanted, outputCeiling(cfg));
    let content = "";
    const startedAt = Date.now();
    diagLog("info", "model.start", `${type} · ${detail}`, { chars: String(query).length });
    const streamOnce = () => postChatStream(endpoint, cfg, messages, controller.signal, false, maxTokens, (partial) => {
      if (typeof options.onPreview === "function") {
        try { options.onPreview(streamPreviewFromJson(partial, type, query)); } catch (_) { /* best-effort */ }
      }
    });
    try {
      // Do not combine streaming with response_format by default: some
      // OpenAI-compatible gateways silently return one buffered JSON response
      // when both are present. The static prompt already requires JSON.
      content = await streamOnce();
    } catch (error) {
      diagLog("error", "model.fail", error?.message || String(error), { type, detail, ms: Date.now() - startedAt, chars: String(query).length });
      // Mobile networks drop long streams and gateways sometimes cut our 60s
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
        let response;
        try {
          response = await postChat(endpoint, cfg, messages, controller.signal, true, maxTokens);
        } catch (fallbackError) {
          throw fallbackError;
        }
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(`HTTP ${response.status}${text ? ` · ${text.slice(0, 260)}` : ""}`);
        }
        const json = await readJsonResponse(response);
        const message = json?.choices?.[0]?.message;
        content = message?.content;
        if (Array.isArray(content)) {
          content = content.map((part) => typeof part === "string" ? part : part?.text || "").join("");
        }
      }
      if (!content) throw error;
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
      }
    }
    if (!content) throw new Error("模型返回了空消息。");
    diagLog("info", "model.content", `${type} · ${detail}`, { chars: content.length, ms: Date.now() - startedAt });
    let parsed;
    let retryLength = null;
    const emptyish = content.trim().length < 12;
    try {
      if (emptyish) throw new Error("模型返回的内容过短，可能被网关截断了。");
      parsed = parseJsonObject(content);
    } catch (parseError) {
      diagLog("error", emptyish ? "model.empty" : "model.parse", parseError?.message || String(parseError), { type, detail, chars: content.length });
      // A truncated answer is the most common cause here: retry once with a
      // larger ceiling instead of showing a raw JSON error to the reader.
      if (!emptyish && !/JSON|Unexpected|Expected|Unterminated/i.test(String(parseError?.message || ""))) throw parseError;
      const retryTokens = Math.min(outputCeiling(cfg), Math.round(maxTokens * 1.5));
      const retryMessages = messages.concat([{
        role: "user",
        content: "上一次输出在中途被截断了（或几乎没有内容）。请保持同样的详细程度重写，但务必输出完整闭合的 JSON：如果确实太长，只省略 family/synonyms/antonyms 里的嵌套细节，不要删掉义项、句子分析或重点词。"
      }]);
      const retry = await postChat(endpoint, cfg, retryMessages, controller.signal, true, retryTokens);
      if (!retry.ok) throw parseError;
      const retryJson = await readJsonResponse(retry);
      const retryMessage = retryJson?.choices?.[0]?.message;
      let retryContent = retryMessage?.content;
      if (Array.isArray(retryContent)) {
        retryContent = retryContent.map((part) => typeof part === "string" ? part : part?.text || "").join("");
      }
      if (!retryContent) throw parseError;
      try {
        parsed = parseJsonObject(retryContent);
        retryLength = retryContent.length;
        content = retryContent;
      } catch (_) {
        diagLog("error", "model.truncated", "json truncated", { type, detail, chars: retryContent.length, tokens: retryTokens });
        throw new Error(`模型返回的 JSON 被截断（约 ${retryContent.length} 字符），可以重试或把生成深度调到「深入」。`);
      }
    }
    diagLog("info", "model.ok", `${type} · ${detail}`, { chars: content.length, ms: Date.now() - startedAt, retried: retryLength !== null });
    if (type === "word") {
      const data = normalizeModelWord(parsed, query);
      data.source = "model";
      data.model = cfg.model;
      cachePutWord(normalizeWord(data.word), data, detail);
      if (normalizeWord(query) !== normalizeWord(data.word)) cachePutWord(query, data, detail);
      return { type: "word", data };
    }
    const data = normalizeModelSentence(parsed, query);
    if (pieces.length > 1 && data.sentences.length) {
      data.sentences = alignSentenceParts(data.sentences, pieces);
    }
    data.sourceType = "model";
    data.model = cfg.model;
    data.source = "语境分析";
    if (sentenceCacheKey) {
      data.id = `model-${sentenceCacheKey}`;
      cachePutSentence(sentenceCacheKey, data, sentenceLevelOf(cfg.sentenceLevel).id, detail);
    }
    return { type: "sentence", data };
  }

  function streamDeltaText(delta) {
    const value = delta?.content;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value.map((part) => typeof part === "string" ? part : part?.text || "").join("");
    }
    return "";
  }

  async function googleChatStream(cfg, messages, signal, maxTokens, onDelta) {
    const url = googleModelUrl(cfg, true);
    const post = () => fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
      body: JSON.stringify(googlePayload(messages, maxTokens, true, cfg)),
      signal
    });
    let response = await post();
    if (response.status === 503 || response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      response = await post();
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${text ? ` · ${text.slice(0, 260)}` : ""}`);
    }
    if (!response.body) return googleText(await response.json());
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const consumeFrame = (frame) => {
      const line = frame.split("\n").find((row) => row.startsWith("data:"));
      if (!line) return;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") return;
      try {
        const text = googleText(JSON.parse(data));
        if (text) {
          content += text;
          if (typeof onDelta === "function") onDelta(content);
        }
      } catch (_) { /* partial frames are skipped */ }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\n\n");
        consumeFrame(frame);
      }
    }
    // The final event often arrives without the trailing blank line; dropping
    // it cuts the closing braces off the JSON, which looks like model failure.
    buffer += decoder.decode();
    if (buffer.trim()) consumeFrame(buffer);
    return content;
  }

  async function googleChat(cfg, messages, signal, maxTokens, jsonMode = true) {
    const url = googleModelUrl(cfg, false);
    const post = () => fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(googlePayload(messages, maxTokens, jsonMode, cfg)),
      signal
    });
    let response = await post();
    if (response.status === 503 || response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      response = await post();
    }
    const raw = await response.text().catch(() => "");
    let json = null;
    try { json = raw ? JSON.parse(raw) : null; } catch (_) { /* keep raw for the error */ }
    if (!response.ok) {
      const message = json?.error?.message || raw.slice(0, 260);
      throw new Error(`HTTP ${response.status}${message ? ` · ${message}` : ""}`);
    }
    const content = googleText(json);
    return {
      ok: true,
      status: response.status,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => raw
    };
  }

  async function postChatStream(endpoint, cfg, messages, signal, allowJsonMode, maxTokens, onDelta) {
    if (isGoogleProvider(cfg)) {
      return googleChatStream(cfg, messages, signal, maxTokens, onDelta);
    }
    const body = {
      model: cfg.model,
      messages,
      temperature: 0.3,
      max_tokens: maxTokens,
      stream: true,
      ...thinkingParams(cfg)
    };
    if (allowJsonMode) body.response_format = { type: "json_object" };

    const send = async (withJsonMode) => {
      const payload = { ...body };
      if (!withJsonMode) delete payload.response_format;
      return fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
          "Authorization": `Bearer ${String(cfg.apiKey || "").trim()}`
        },
        body: JSON.stringify(payload),
        signal
      });
    };

    let response = await send(allowJsonMode);
    if (!response.ok && allowJsonMode && [400, 422].includes(response.status)) {
      response = await send(false);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${text ? ` · ${text.slice(0, 260)}` : ""}`);
    }

    const type = response.headers.get("content-type") || "";
    if (type.includes("application/json")) {
      if (!window.__talkStreamWarned) {
        window.__talkStreamWarned = true;
        console.info("Provider returned a buffered JSON response despite stream=true.");
      }
      const json = await readJsonResponse(response, "流式接口");
      const message = json?.choices?.[0]?.message;
      let content = message?.content;
      if (Array.isArray(content)) {
        content = content.map((part) => typeof part === "string" ? part : part?.text || "").join("");
      }
      if (content) onDelta?.(content);
      return content || "";
    }

    if (!response.body?.getReader) {
      return await response.text();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const choice = json?.choices?.[0];
          const piece = streamDeltaText(choice?.delta) || (typeof choice?.message?.content === "string" ? choice.message.content : "");
          if (piece) {
            content += piece;
            onDelta?.(content);
          }
        } catch (_) {
          // Ignore keep-alive/partial SSE lines.
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim().startsWith("data:")) {
      const payload = buffer.trim().slice(5).trim();
      if (payload && payload !== "[DONE]") {
        try {
          const json = JSON.parse(payload);
          const piece = streamDeltaText(json?.choices?.[0]?.delta);
          if (piece) content += piece;
        } catch (_) { /* ignore */ }
      }
    }
    return content;
  }

  function partialJsonString(text, key) {
    const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
    const match = String(text || "").match(pattern);
    if (!match) return "";
    try { return JSON.parse(`"${match[1]}"`); } catch (_) { return ""; }
  }

  function streamPreviewFromJson(text, type, query) {
    if (type === "sentence") {
      const translation = partialJsonString(text, "translation");
      const tone = partialJsonString(text, "tone");
      const structure = partialJsonString(text, "structure");
      if (!translation && !tone && !structure) return null;
      return { kind: "sentence", text: query, translation, tone, structure };
    }
    const word = partialJsonString(text, "word") || query;
    const phonetic = partialJsonString(text, "phonetic");
    const translation = partialJsonString(text, "translation");
    const short = partialJsonString(text, "short");
    const pos = partialJsonString(text, "pos");
    if (!word && !translation && !short) return null;
    return { kind: "word", word, phonetic, translation, short, pos };
  }

  function updateStreamPreview(preview, type) {
    if (!preview) return;
    const host = $("#live-preview");
    if (!host) return;
    const signature = JSON.stringify(preview);
    if (host.dataset.signature === signature) return;
    host.dataset.signature = signature;
    host.hidden = false;
    host.classList.add("has-content");
    const skeleton = $(".skeleton-stack");
    if (skeleton) skeleton.classList.add("is-streaming");
    if (type === "sentence") {
      host.innerHTML = `
        <span class="live-preview-kicker"><i></i>正在分段返回</span>
        <h2 class="live-preview-word">${esc(shorten(preview.text || "", 80))}</h2>
        ${preview.tone ? `<span class="live-preview-meta">${esc(preview.tone)}</span>` : ""}
        ${preview.translation ? `<p class="live-preview-translation">${esc(preview.translation)}</p>` : `<p class="live-preview-pending">正在整理译文…</p>`}
        ${preview.structure ? `<p class="live-preview-note">${esc(preview.structure)}</p>` : ""}`;
      return;
    }
    host.innerHTML = `
      <span class="live-preview-kicker"><i></i>正在分段返回</span>
      <h2 class="live-preview-word">${esc(preview.word || "")}</h2>
      <div class="live-preview-meta">${esc(preview.phonetic || "")}${preview.pos ? ` · ${esc(posLabel(preview.pos))}` : ""}</div>
      ${preview.translation ? `<p class="live-preview-translation">${esc(preview.translation)}</p>` : `<p class="live-preview-pending">正在整理第一段…</p>`}
      ${preview.short ? `<p class="live-preview-note">${esc(preview.short)}</p>` : ""}`;
  }

  function thinkingParams(cfg) {
    const profile = activeProfile(cfg);
    if (!profileSupportsThinking(profile) && !cfg.enableThinking) return {};
    const params = { enable_thinking: Boolean(cfg.enableThinking) };
    const budget = Number(cfg.thinkingBudget) || 0;
    if (params.enable_thinking && budget > 0) params.thinking_budget = budget;
    return params;
  }

  async function postChat(endpoint, cfg, messages, signal, allowJsonMode, maxTokens = 2600) {
    if (isGoogleProvider(cfg)) {
      return googleChat(cfg, messages, signal, maxTokens);
    }
    const body = {
      model: cfg.model,
      messages,
      temperature: 0.3,
      max_tokens: maxTokens,
      stream: false,
      ...thinkingParams(cfg)
    };
    if (allowJsonMode) body.response_format = { type: "json_object" };

    const send = async (withJsonMode) => {
      const payload = { ...body };
      if (!withJsonMode) delete payload.response_format;
      return fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${String(cfg.apiKey || "").trim()}`
        },
        body: JSON.stringify(payload),
        signal
      });
    };

    let response = await send(allowJsonMode);
    if (!response.ok && allowJsonMode && [400, 422].includes(response.status)) {
      response = await send(false);
    }
    return response;
  }

  async function readJsonResponse(response, label = "接口") {
    const raw = await response.text().catch(() => "");
    if (!raw) throw new Error(`${label}返回了空响应（HTTP ${response.status}），可能是网关超时，请重试。`);
    try {
      return JSON.parse(raw);
    } catch (_) {
      throw new Error(`${label}返回的不是 JSON（HTTP ${response.status}）：${raw.slice(0, 160)}`);
    }
  }

  function parseJsonObject(content) {
    let text = String(content).trim();
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) throw new Error("模型没有返回 JSON 对象。");
    const slice = text.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch (error) {
      throw new Error(`模型 JSON 解析失败：${error.message}`);
    }
  }

  function unwrapModel(raw) {
    if (!raw || typeof raw !== "object") return {};
    if (raw.data && typeof raw.data === "object") return raw.data;
    if (raw.result && typeof raw.result === "object") return raw.result;
    return raw;
  }

  function normalizeModelWord(raw, fallbackWord) {
    const base = unwrapModel(raw);
    const senses = normalizeSenses(base.senses);
    const posGroups = normalizePosGroups(base.posGroups, base.pos || base.partOfSpeech, senses);
    const mainGroup = posGroups[0] || { pos: "", senses };
    const mainSenses = mainGroup.senses.length ? mainGroup.senses : senses;
    const first = mainSenses[0] || {};
    const word = String(base.word || base.headword || fallbackWord || "").trim().toLowerCase();
    if (!word) throw new Error("模型返回的内容里没有词头。");
    const result = {
      word,
      phonetic: String(base.phonetic || base.ipa || ""),
      pos: String(base.pos || base.partOfSpeech || mainGroup.pos || ""),
      level: String(base.level || "—"),
      register: String(base.register || "common"),
      short: String(base.short || base.definition || first.en || ""),
      translation: String(base.translation || first.zh || ""),
      note: String(base.note || base.usageNote || ""),
      senses: mainSenses.length ? mainSenses : [{ en: String(base.definition || ""), zh: String(base.translation || ""), tag: "" }],
      posGroups,
      family: normalizeRelations(base.family || base.derivatives),
      synonyms: normalizeRelations(base.synonyms),
      antonyms: normalizeRelations(base.antonyms),
      examples: normalizeExamples(base.examples),
      examplesByTheme: normalizeExamplesByTheme(base.examplesByTheme || base.examples_by_theme),
      collocations: normalizeStrings(base.collocations),
      memory: String(base.memory || base.memoryHook || ""),
      related: normalizeStrings(base.related),
      origin: normalizeOrigin(base.origin || base.etymology),
      spelling: normalizeSpelling(base.spelling || base.correction, base.word || fallbackWord)
    };
    if (result.spelling?.corrected) result.word = normalizeWord(result.spelling.corrected);
    if (!result.short) result.short = "";
    return result;
  }

  function normalizeModelSentence(raw, fallbackSentence) {
    const base = unwrapModel(raw);
    const text = String(base.text || base.sentence || fallbackSentence || "").trim();
    let keyWords = normalizeKeyWords(base.keyWords || base.key_words || base.words);
    const sentences = normalizeSentenceParts(base.sentences || base.parts);
    if (sentences.length) {
      const bySentence = new Map();
      keyWords.forEach((item) => {
        const index = Number(item.sentenceIndex) || 0;
        if (!index) return;
        if (!bySentence.has(index)) bySentence.set(index, []);
        bySentence.get(index).push(item);
      });
      sentences.forEach((part, index) => {
        if (!part.keyWords?.length) part.keyWords = bySentence.get(index + 1) || bySentence.get(part.index || -1) || [];
      });
    }
    if (!keyWords.length && sentences.length) {
      const seen = new Set();
      keyWords = sentences.flatMap((part, index) => part.keyWords.map((item) => ({ ...item, sentenceIndex: index })))
        .filter((item) => {
          const key = `${normalizeWord(item.word)}:${item.sentenceIndex}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 12);
    }
    if (!text) throw new Error("模型返回的内容里没有原句。");
    // A sentence with no key words is still a valid page (short or plain
    // sentences happen); only a missing sentence is fatal.
    return {
      id: `model-${Date.now()}`,
      text,
      translation: String(base.translation || ""),
      tone: String(base.tone || ""),
      structure: typeof base.structure === "string" ? base.structure : String(base.structure?.note || ""),
      summary: String(base.summary || base.gist || "").trim(),
      tree: normalizeStructureTree(base.tree || base.structureTree || (base.structure && base.structure.tree)),
      sentences,
      keyWords,
      source: "语境分析",
      sourceType: "model"
    };
  }


  const PROTECTED_SPELLING = new Set([
    "google", "standard", "apple", "amazon", "microsoft", "openai", "qwen",
    "deepseek", "github", "android", "iphone", "chatgpt", "twitter", "youtube"
  ]);

  function normalizeSpelling(value, fallbackWord = "") {
    if (!value || typeof value !== "object") return null;
    const input = String(value.input || value.query || "").trim();
    const corrected = String(value.corrected || value.correction || value.word || fallbackWord || "").trim();
    if (!input || !corrected) return null;
    // Multi-word input is a phrase/idiom, never a spelling mistake.
    if (/\s/.test(input.trim())) return null;
    const changed = value.changed !== undefined
      ? Boolean(value.changed)
      : normalizeWord(input) !== normalizeWord(corrected);
    const inputKey = normalizeWord(input);
    if (!changed || inputKey === normalizeWord(corrected)) return null;
    const confidence = Number(value.confidence || 0);
    if (PROTECTED_SPELLING.has(inputKey)) return null;
    return {
      input,
      corrected,
      confidence,
      note: String(value.note || value.reason || "").trim()
    };
  }

  function localizeTimelineWhen(value) {
    const text = String(value || "").trim();
    if (!text || /[\u3400-\u9fff]/.test(text)) return text;
    const lower = text.toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
    const map = {
      "old english": "古英语时期",
      "middle english": "中古英语时期",
      "early modern english": "早期现代英语",
      "modern english": "现代英语",
      "ancient greek": "古希腊时期",
      "latin": "拉丁语时期",
      "old norse": "古诺斯语时期",
      "proto germanic": "原始日耳曼语时期",
      "today": "今天",
      "present": "今天",
      "now": "今天"
    };
    if (map[lower]) return map[lower];
    let match = lower.match(/^(early|mid|late)?\s*(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+century$/);
    if (match) {
      const prefix = match[1] === "early" ? "早期" : match[1] === "mid" ? "中期" : match[1] === "late" ? "晚期" : "";
      return `${match[2]} 世纪${prefix}`;
    }
    match = lower.match(/^(?:c\.?\s*)?(\d{3,4})$/);
    if (match) return `${match[1]} 年`;
    match = lower.match(/^(?:before|prior to)\s+(\d{3,4})$/);
    if (match) return `${match[1]} 年以前`;
    match = lower.match(/^(\d{3,4})\s*[-–—]\s*(\d{3,4})$/);
    if (match) return `${match[1]}–${match[2]} 年`;
    return text;
  }

  function normalizeOrigin(value) {
    if (!value || typeof value !== "object") return null;
    const stages = asArray(value.stages).map((stage) => ({
      when: localizeTimelineWhen(stage.when || stage.time || stage.period || ""),
      label: String(stage.label || stage.title || ""),
      text: String(stage.text || stage.description || "")
    })).filter((stage) => stage.when || stage.text);
    const origin = {
      root: String(value.root || value.rootWord || ""),
      original: String(value.original || value.originalMeaning || ""),
      story: String(value.story || value.etymology || ""),
      stages
    };
    return origin.root || origin.story || origin.original || stages.length ? origin : null;
  }

  function normalizeSenses(value) {
    return asArray(value).map((item) => {
      if (typeof item === "string") return { en: item, zh: "", tag: "" };
      return {
        en: String(item.en || item.definition || item.meaning || ""),
        zh: String(item.zh || item.translation || item.meaningZh || ""),
        tag: String(item.tag || item.label || "")
      };
    }).filter((item) => item.en || item.zh);
  }

  function normalizePosGroups(value, fallbackPos, fallbackSenses) {
    const groups = asArray(value).map((item) => {
      if (!item || typeof item !== "object") return null;
      const senses = normalizeSenses(item.senses || item.meanings || item.definitions);
      if (!senses.length) return null;
      return {
        pos: String(item.pos || item.partOfSpeech || "").trim().toLowerCase(),
        senses
      };
    }).filter(Boolean);
    if (!groups.length) {
      groups.push({ pos: String(fallbackPos || "").trim().toLowerCase(), senses: fallbackSenses });
    }
    const wanted = String(fallbackPos || "").trim().toLowerCase();
    const mainIndex = groups.findIndex((group) => group.pos === wanted);
    if (mainIndex > 0) {
      const [main] = groups.splice(mainIndex, 1);
      groups.unshift(main);
    }
    return groups;
  }

  function normalizeKeyWords(value) {
    return asArray(value).map((item) => {
      if (typeof item === "string") {
        return {
          word: item,
          surface: item,
          phonetic: "",
          pos: "",
          meaning: "",
          why: "",
          level: "",
          sentenceIndex: 0,
          family: [],
          synonyms: [],
          antonyms: [],
          example: null,
          externalExample: null
        };
      }
      const word = String(item.word || item.term || item.surface || "").trim();
      const exampleRaw = item.example || item.examples;
      const example = Array.isArray(exampleRaw) ? exampleRaw[0] : exampleRaw;
      return {
        word,
        surface: String(item.surface || item.text || word),
        phonetic: String(item.phonetic || item.ipa || ""),
        pos: String(item.pos || item.partOfSpeech || ""),
        meaning: String(item.meaning || item.definition || item.meaningInContext || ""),
        meaningZh: String(item.meaningZh || item.meaning_zh || item.zh || ""),
        why: String(item.why || item.whyItMatters || item.nuance || ""),
        level: String(item.level || item.stage || "").trim().toLowerCase(),
        sentenceIndex: Number.isFinite(Number(item.sentenceIndex)) ? Number(item.sentenceIndex) : 0,
        family: normalizeRelations(item.family || item.derivatives),
        synonyms: normalizeRelations(item.synonyms),
        antonyms: normalizeRelations(item.antonyms),
        example: normalizeExample(example),
        externalExample: normalizeExample(item.externalExample || item.outsideExample || item.extraExample)
      };
    }).filter((item) => item.word);
  }

  function normalizeRelations(value) {
    return asArray(value).map((item) => {
      if (typeof item === "string") return { word: item, pos: "", gloss: "" };
      return {
        word: String(item.word || item.term || item.text || ""),
        pos: posAbbr(item.pos || item.partOfSpeech || ""),
        gloss: String(item.gloss || item.meaning || item.definition || item.nuance || ""),
        zh: String(item.zh || item.glossZh || item.meaningZh || item.translation || "")
      };
    }).filter((item) => item.word);
  }

  function normalizeExamples(value) {
    return asArray(value).map((item) => normalizeExample(item)).filter((item) => item?.en);
  }

  function normalizeExample(item) {
    if (!item) return null;
    if (typeof item === "string") return { en: item, zh: "", source: "" };
    return {
      en: String(item.en || item.sentence || item.text || item.example || ""),
      zh: String(item.zh || item.translation || ""),
      source: String(item.source || "")
    };
  }

  function normalizeStrings(value) {
    return asArray(value).map((item) => {
      if (typeof item === "string") return item;
      return String(item.word || item.text || item.value || "");
    }).filter(Boolean);
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value];
  }

  /* ============================================================
     Interactions
     ============================================================ */

  async function handleClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;

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
        const module = target.dataset.module === "translator" ? "translator" : "dictionary";
        if (module === state.module) break;
        state.module = module;
        tapFeedback();
        closeAllWordLayers({ immediate: true });
        if (module === "translator") navigate({ name: "translator" }, { replace: false });
        else navigate({ name: "home" }, { replace: false });
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

      case "word-pos": {
        event.preventDefault();
        const pager = wordPagerForTarget(target);
        if (pager) {
          setWordPos(pager, Number(target.dataset.index) || 0);
          pager.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
        }
        break;
      }

      case "word-pos-prev":
        event.preventDefault();
        moveWordPos(wordPagerForTarget(target), -1);
        break;

      case "word-pos-next":
        event.preventDefault();
        moveWordPos(wordPagerForTarget(target), 1);
        break;

      case "open-key":
        event.preventDefault();
        tapFeedback();
        openKeySheet(Number(target.dataset.index || 0));
        break;

      case "key-toggle": {
        event.preventDefault();
        const card = target.closest(".key-card");
        if (!card) break;
        const open = !card.classList.contains("open");
        card.classList.toggle("open", open);
        target.setAttribute("aria-expanded", String(open));
        break;
      }

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

      case "speak":
        event.preventDefault();
        speakText(target.dataset.text || "", target);
        break;

      case "regenerate-audio":
        event.preventDefault();
        speakText(target.dataset.text || "", target, state.settings, { bypassCache: true });
        break;

      case "regenerate-sentence": {
        event.preventDefault();
        const active = activeSentenceData();
        if (!active || !hasModelConfig()) break;
        const level = sentenceLevelOf(state.settings?.sentenceLevel).id;
        const detail = state.settings?.detailLevel || "standard";
        const key = await sentenceKey(active.text, level, detail);
        removeSentenceRecord(key);
        await runSearch(active.text, "sentence", { skipCache: true });
        break;
      }

      case "forget-sentence": {
        event.preventDefault();
        const active = activeSentenceData();
        if (!active) break;
        const level = sentenceLevelOf(state.settings?.sentenceLevel).id;
        const detail = state.settings?.detailLevel || "standard";
        removeSentenceRecord(await sentenceKey(active.text, level, detail));
        toast("已删除这条句子缓存");
        break;
      }

      case "clear-sentence-cache":
        event.preventDefault();
        clearSentenceCache();
        toast("句子缓存已清除");
        break;

      case "regenerate-word": {
        event.preventDefault();
        const active = activeWordData();
        if (!active) break;
        const key = normalizeWord(active.word);
        if (!key || !hasModelConfig()) break;
        await removeWordRecord(key);
        await runSearch(key, "word");
        break;
      }

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

      case "regen-examples": {
        event.preventDefault();
        const active = activeWordData();
        if (!active) break;
        if (!hasModelConfig()) {
          toast("先连接模型，才能按主题换例句。");
          break;
        }
        const themeId = window.TALK_THEME?.current?.().id || "paper";
        const needed = [themeId, ...themesMissingExamples(active).filter((id) => id !== themeId)];
        await fillThemeExamples(active, needed).catch(() => {});
        toast("已按当前主题换了一批例句");
        break;
      }

      case "tree-expand": {
        event.preventDefault();
        const row = target.closest(".tree-node");
        const box = row?.querySelector(":scope > .tree-children");
        if (!box) break;
        box.hidden = !box.hidden;
        row.classList.toggle("open", !box.hidden);
        target.setAttribute("aria-expanded", String(!box.hidden));
        break;
      }

      case "tree-toggle-all": {
        event.preventDefault();
        const expand = target.dataset.mode !== "collapse";
        $$(".tree-children").forEach((box) => { box.hidden = !expand; });
        $$(".tree-node").forEach((node) => node.classList.toggle("open", expand));
        $$(".tree-expand").forEach((btn) => btn.setAttribute("aria-expanded", String(expand)));
        break;
      }

      case "onion-toggle": {
        event.preventDefault();
        event.stopPropagation();
        const slot = target.closest(".onion-slot");
        if (!slot) break;
        setOnionOpen(slot, !slot.classList.contains("is-open"));
        break;
      }

      case "onion-toggle-all": {
        event.preventDefault();
        const mode = target.dataset.mode === "collapse" ? "collapse" : "expand";
        const open = mode === "expand";
        $$(".onion-slot", screen || document).forEach((slot) => setOnionOpen(slot, open));
        break;
      }

      case "onion-open": {
        event.preventDefault();
        const node = state.structureNodes?.[target.dataset.nodeId];
        if (!node) break;
        openInsightSheet(node);
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

      case "translator-style": {
        event.preventDefault();
        const styleId = target.dataset.style;
        if (!TRANSLATOR_STYLES.some((style) => style.id === styleId)) break;
        state.translatorStyles = state.translatorStyles.includes(styleId)
          ? state.translatorStyles.filter((id) => id !== styleId)
          : [...state.translatorStyles, styleId];
        updateTranslatorStyleControls();
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

      case "translator-mode": {
        event.preventDefault();
        state.translatorMode = target.dataset.mode === "zh" || target.dataset.mode === "en" ? target.dataset.mode : "auto";
        $$(".translator-mode-btn").forEach((button) => {
          const active = button.dataset.mode === state.translatorMode;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", String(active));
        });
        updateTranslatorLanguage();
        break;
      }

      case "close-workspace":
        event.preventDefault();
        closeTranslationWorkspace();
        break;

      case "translation-detail":
        event.preventDefault();
        openTranslationDetail(Number(target.dataset.index));
        break;

      case "copy-translation": {
        event.preventDefault();
        const text = target.dataset.text || "";
        if (!text) break;
        void copyText(text).then((copied) => {
          toast(copied ? "已复制这个版本" : "复制失败");
        });
        break;
      }

      case "translator-sample": {
        event.preventDefault();
        const input = $("#translator-input");
        if (!input) break;
        input.value = target.dataset.text || "";
        updateTranslatorLanguage();
        openTranslationWorkspace(input.value);
        break;
      }

      case "regenerate-translation":
        event.preventDefault();
        if (state.lastTranslationInput) runTranslation(state.lastTranslationInput, { bypassCache: true });
        break;

      case "demo-translation":
        event.preventDefault();
        renderTranslatorResult(demoTranslationResult($("#translator-input")?.value || $("#workspace-translator-input")?.value));
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

      case "add-profile": {
        event.preventDefault();
        if (!state.draft) break;
        syncDraftProfile(state.draft);
        openTemplatePicker();
        break;
      }

      case "new-from-template": {
        event.preventDefault();
        if (!state.draft) break;
        const template = PROVIDER_TEMPLATES.find((item) => item.id === target.dataset.template) || CUSTOM_TEMPLATE;
        closeSheet();
        const profile = {
          id: `${template.id}-${Date.now()}`,
          name: template.name,
          provider: template.provider || "custom",
          protocol: template.protocol || "openai",
          templateId: template.id,
          baseUrl: template.baseUrl || "",
          model: template.model || "",
          apiKey: "",
          note: template.note || ""
        };
        state.draft.profiles = [...state.draft.profiles, profile];
        state.draft = applyProfileToSettings(state.draft, profile);
        commitSettingsDraft();
        openSettingsSheet();
        renderSettingsContent();
        break;
      }

      case "delete-word-cache": {
        event.preventDefault();
        const targetWord = target.dataset.word || "";
        if (!targetWord) break;
        if (!window.confirm("删除这个词的本地缓存？相关拼写也会一起删除。")) break;
        const removed = await deleteWordCacheFor(targetWord);
        toast(removed ? "已删除这条缓存" : "没有找到对应缓存");
        goBack();
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

      case "theme-cycle":
        event.preventDefault();
        cycleTheme(target.dataset.delta);
        break;

      case "theme-generate":
        event.preventDefault();
        generateThemeDeck();
        break;

      case "theme-picker":
        event.preventDefault();
        openThemePicker();
        break;

      case "theme-pick":
        event.preventDefault();
        pickTheme(target.dataset.title);
        break;

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

      case "test-tts":
        event.preventDefault();
        testTts(target);
        break;

      case "save-settings":
        event.preventDefault();
        saveSettings();
        break;

      case "test-connection":
        event.preventDefault();
        testConnection();
        break;

      case "retry":
        event.preventDefault();
        if (state.lastAttempt) runSearch(state.lastAttempt.query, state.lastAttempt.type);
        break;

      case "demo":
        event.preventDefault();
        if (state.lastAttempt) {
          try {
            const result = lookupDemo(state.lastAttempt.query, state.lastAttempt.type);
            if (result.type === "word") {
              addHistory("word", state.lastAttempt.query);
              navigate({ name: "word", word: result.data.word, result: result.data }, { replace: true });
            } else {
              addHistory("sentence", state.lastAttempt.query);
              navigate({ name: "sentence", id: result.data.id, result: result.data }, { replace: true });
            }
          } catch (_) {
            toast("No demo entry for that one");
          }
        }
        break;

      case "history-item":
        event.preventDefault();
        closeSheet({ immediate: true });
        if (target.dataset.type === "translation") {
          const text = String(target.dataset.query || "").trim();
          navigate({ name: "translate" });
          const input = $("#translator-input");
          if (input && text) {
            input.value = text;
            updateTranslatorLanguage();
            runTranslation(text);
          }
          break;
        }
        runSearch(target.dataset.query || "", target.dataset.type || "auto");
        break;

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
      case "clear-theme-cache":
        event.preventDefault();
        await clearThemeStore();
        state.themeDecks = [];
        state.themeDisplay = [];
        state.themeIndex = 0;
        state.themeDeck = null;
        themeDisplaySave();
        renderThemeSalon();
        renderSettingsContent();
        toast("主题库已清空");
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
    const detected = state.mode === "auto" ? detectType(input.value) : state.mode;
    label.textContent = state.mode === "auto"
      ? `自动 · ${detected === "sentence" ? "句子" : "单词"}`
      : `${state.mode === "sentence" ? "句子" : "单词"}模式`;
    input.placeholder = state.mode === "sentence"
      ? "粘贴一句想读懂的英文…"
      : state.mode === "word"
        ? "输入一个想查的单词…"
        : "输入一个单词，或一整句话…";
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

  function activeSentenceData() {
    if (state.route.name !== "sentence") return null;
    return getSentence(state.route);
  }

  function activeWordData() {
    if (state.wordLayers.length) return state.wordLayers[state.wordLayers.length - 1].data;
    if (state.route.name === "word") return getWord(state.route);
    return null;
  }

  function bookmarkKey() {
    const active = activeWordData();
    if (active?.word) return `word:${normalizeWord(active.word)}`;
    if (state.route.name === "sentence") return `sentence:${state.route.result?.id || state.route.id}`;
    return null;
  }

  function toggleSaved(button) {
    const key = bookmarkKey();
    if (!key) return;
    const index = state.saved.indexOf(key);
    if (index >= 0) {
      state.saved.splice(index, 1);
      toast("已取消收藏");
    } else {
      state.saved.push(key);
      toast("已收藏，稍后再看");
    }
    persistSaved();
    const saved = state.saved.includes(key);
    if (button) {
      button.classList.toggle("is-saved", saved);
      button.setAttribute("aria-pressed", String(saved));
      button.setAttribute("aria-label", saved ? "取消收藏" : "收藏");
      button.setAttribute("title", saved ? "已收藏" : "收藏");
    }
    const scope = state.wordLayers.length ? state.wordLayers[state.wordLayers.length - 1].el : screen;
    $$('[data-action="save"]', scope).forEach((item) => {
      item.classList.toggle("is-saved", saved);
      item.setAttribute("aria-pressed", String(saved));
      item.setAttribute("aria-label", saved ? "取消收藏" : "收藏");
      item.setAttribute("title", saved ? "已收藏" : "收藏");
    });
  }

  function primeAudio() {
    if (!ttsAudio) {
      ttsAudio = new Audio();
      ttsAudio.preload = "auto";
    }
    if (!ttsAudio.dataset.primed) {
      ttsAudio.dataset.primed = "1";
      ttsAudio.src = SILENT_AUDIO;
      const attempt = ttsAudio.play();
      if (attempt) attempt.catch(() => { /* The first click may be silent. */ });
    }
  }

  function stopSpeech() {
    if (currentAudio) {
      const audio = currentAudio;
      currentAudio = null;
      try { audio.pause(); } catch (_) { /* no-op */ }
      if (audio.dataset.url) URL.revokeObjectURL(audio.dataset.url);
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    $$(".is-speaking, .is-loading").forEach((item) => {
      item.classList.remove("is-speaking", "is-loading");
      item.removeAttribute("aria-busy");
    });
  }

  function setTtsLoading(button, loading) {
    if (!button) return;
    button.classList.toggle("is-loading", loading);
    if (loading) button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
  }

  function pickSystemVoice() {
    if (!("speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices()
      .filter((voice) => /^en([-_]|$)/i.test(voice.lang) || /English/i.test(voice.name));
    const patterns = [
      /Microsoft.*(Aria|Jenny|Guy|Sonia|Ryan).*(Natural|Online)/i,
      /Microsoft.*(Aria|Jenny|Guy|Sonia|Ryan)/i,
      /Google US English/i,
      /Samantha/i,
      /Ava/i,
      /Microsoft.*English/i,
      /en-US/i
    ];
    for (const pattern of patterns) {
      const found = voices.find((voice) => pattern.test(voice.name) || pattern.test(voice.lang));
      if (found) return found;
    }
    return null;
  }

  function speakSystem(text, button) {
    if (!("speechSynthesis" in window)) return "system";
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.92;
    utterance.pitch = 1;
    const voice = pickSystemVoice();
    if (voice) utterance.voice = voice;
    if (button) {
      button.classList.add("is-speaking");
      utterance.onend = () => button.classList.remove("is-speaking");
      utterance.onerror = () => button.classList.remove("is-speaking");
    }
    window.speechSynthesis.speak(utterance);
    return "system";
  }

  async function playAudioBlob(blob, button) {
    if (!blob.size) throw new Error("语音接口返回了空音频。");
    const url = URL.createObjectURL(blob);
    const audio = ttsAudio || new Audio();
    ttsAudio = audio;
    try { audio.pause(); } catch (_) { /* no-op */ }
    if (audio.dataset.url) URL.revokeObjectURL(audio.dataset.url);
    audio.src = url;
    audio.dataset.url = url;
    currentAudio = audio;
    if (button) button.classList.add("is-speaking");
    const cleanup = () => {
      if (button) button.classList.remove("is-speaking");
      if (currentAudio === audio) currentAudio = null;
      URL.revokeObjectURL(url);
    };
    audio.onended = cleanup;
    audio.onerror = cleanup;
    try {
      await audio.play();
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  async function playAudioUrl(url, button) {
    if (!url) throw new Error("语音接口没有返回音频地址。");
    url = secureRemoteUrl(url);
    const audio = ttsAudio || new Audio();
    ttsAudio = audio;
    try { audio.pause(); } catch (_) { /* no-op */ }
    if (audio.dataset.url) {
      URL.revokeObjectURL(audio.dataset.url);
      delete audio.dataset.url;
    }
    audio.src = url;
    currentAudio = audio;
    if (button) button.classList.add("is-speaking");
    const cleanup = () => {
      if (button) button.classList.remove("is-speaking");
      if (currentAudio === audio) currentAudio = null;
    };
    audio.onended = cleanup;
    audio.onerror = cleanup;
    try {
      await audio.play();
    } catch (error) {
      cleanup();
      throw error;
    }
    return "qwen-url";
  }

  function base64ToBlob(data, type = "audio/mpeg") {
    const raw = String(data || "").includes(",") ? String(data).split(",").pop() : String(data || "");
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  async function speakQwen(text, button, cfg, { bypassCache = false } = {}) {
    const profile = qwenTtsProfile(cfg);
    if (!profile) throw new Error("还没有可用的 Qwen API 密钥，请先在模型设置里填写。");
    const model = String(cfg.qwenTtsModel || "qwen-audio-3.1-tts-plus").trim();
    const endpoint = qwenTtsEndpoint(profile, model);
    if (!endpoint) throw new Error("Qwen API 地址为空，无法定位语音接口。");
    const isQwen3 = /^qwen3-tts/i.test(model);
    let voice = String(cfg.qwenTtsVoice || "").trim();
    if (isQwen3 && (!voice || /^longanhuan/i.test(voice))) voice = "Cherry";
    if (!voice) voice = "longanhuan_v3.1";
    const cacheKey = `qwen|${model}|${voice}|${text}|${AUDIO_CACHE_VERSION}`;
    if (!bypassCache) {
      const cached = await getCachedAudio(cacheKey);
      if (cached) {
        await playAudioBlob(cached, button);
        return "qwen-cache";
      }
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${String(profile.apiKey || "").trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: isQwen3
          ? {
              text,
              voice,
              language_type: detectSourceLanguage(text) === "zh" ? "Chinese" : "English"
            }
          : {
              text,
              voice,
              format: "mp3",
              sample_rate: 24000
            }
      })
    });
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch (_) { /* handled below */ }
    if (!response.ok || !payload) {
      const message = payload?.message || payload?.code || raw.slice(0, 180) || `HTTP ${response.status}`;
      throw new Error(`Qwen 语音失败：${message}`);
    }
    const audio = payload.output?.audio || payload.audio || payload.output || {};
    if (audio.data) {
      const blob = base64ToBlob(audio.data, "audio/mpeg");
      await putCachedAudio(cacheKey, blob);
      await playAudioBlob(blob, button);
      return "qwen";
    }
    if (audio.url) {
      const audioUrl = secureRemoteUrl(audio.url);
      try {
        const file = await fetch(audioUrl);
        if (file.ok) {
          const blob = await file.blob();
          if (blob.size) {
            await putCachedAudio(cacheKey, blob);
            await playAudioBlob(blob, button);
            return "qwen";
          }
        }
      } catch (_) {
        // The signed OSS URL can still be played directly even when fetch is blocked.
      }
      return playAudioUrl(audioUrl, button);
    }
    throw new Error("Qwen 语音返回里没有 audio.url 或 audio.data。");
  }

  /* ---------- Audio cache (Qwen TTS results only; no local model) ---------- */

  const AUDIO_DB_NAME = "talk.audio.v1";
  const AUDIO_DB_STORE = "audio";
  const AUDIO_CACHE_VERSION = "v4";
  let lastTtsError = "";

  function openAudioDb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const request = indexedDB.open(AUDIO_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(AUDIO_DB_STORE)) db.createObjectStore(AUDIO_DB_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getCachedAudio(key) {
    try {
      const db = await openAudioDb();
      return await new Promise((resolve) => {
        const request = db.transaction(AUDIO_DB_STORE, "readonly").objectStore(AUDIO_DB_STORE).get(key);
        request.onsuccess = () => resolve(request.result?.blob || null);
        request.onerror = () => resolve(null);
      });
    } catch (_) {
      return null;
    }
  }

  async function getAudioStats() {
    try {
      const db = await openAudioDb();
      const records = await new Promise((resolve) => {
        const req = db.transaction(AUDIO_DB_STORE, "readonly").objectStore(AUDIO_DB_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      return {
        count: records.length,
        bytes: records.reduce((sum, record) => sum + (record?.blob?.size || 0), 0),
        latest: records
          .filter((record) => record?.at)
          .sort((a, b) => Number(b.at) - Number(a.at))
          .slice(0, 8)
          .map((record) => ({ at: Number(record.at), bytes: record?.blob?.size || 0 }))
      };
    } catch (_) {
      return { count: 0, bytes: 0, latest: [] };
    }
  }

  async function clearAudioCache() {
    try {
      const db = await openAudioDb();
      await new Promise((resolve) => {
        const tx = db.transaction(AUDIO_DB_STORE, "readwrite");
        tx.objectStore(AUDIO_DB_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (_) {
      // Ignore unavailable storage.
    }
  }

  async function putCachedAudio(key, blob) {
    try {
      const db = await openAudioDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(AUDIO_DB_STORE, "readwrite");
        tx.objectStore(AUDIO_DB_STORE).put({ blob, at: Date.now() }, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {
      // Cache failures must never block playback.
    }
  }

  function refreshTtsError() {
    const box = $("#tts-error");
    if (!box) return;
    box.hidden = !lastTtsError;
    box.textContent = lastTtsError ? `最近错误：${lastTtsError}` : "";
  }

  async function speakText(text, button = null, cfg = state.settings, options = {}) {
    const clean = String(text || "").trim();
    if (!clean) return null;
    const engine = cfg.ttsEngine === "qwen" ? "qwen" : "native";
    if (engine === "native") {
      stopSpeech();
      return speakSystem(clean, button);
    }
    primeAudio();
    stopSpeech();
    setTtsLoading(button, true);
    try {
      const result = await speakQwen(clean, button, cfg, options);
      lastTtsError = "";
      return result;
    } catch (error) {
      lastTtsError = String(error?.message || error || "未知错误");
      refreshTtsError();
      toast(lastTtsError);
      console.warn("Qwen TTS failed; falling back to system speech.", error);
      return speakSystem(clean, button);
    } finally {
      setTtsLoading(button, false);
    }
  }

  async function testTts(button) {
    const status = $("#tts-test-status");
    const selected = state.draft || state.settings;
    const engine = selected.ttsEngine === "qwen" ? "qwen" : "native";
    if (status) {
      status.textContent = engine === "qwen" ? "正在请求 Qwen 语音…" : "正在使用设备系统语音";
    }
    lastTtsError = "";
    const result = await speakText("Talk is ready.", button, selected, { bypassCache: true });
    if (engine === "native") {
      refreshTtsError();
      return;
    }
    if (status) {
      status.textContent = String(result || "").startsWith("qwen")
        ? "Qwen 语音已就绪"
        : `Qwen 语音失败，已回退系统语音：${lastTtsError || "未知错误"}`;
    }
    refreshTtsError();
  }

  async function copyText(text) {
    const value = String(text ?? "");
    if (!value) return false;
    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {
      // Fall through to the selection fallback (HTTP LAN preview, etc.).
    }
    try {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      area.style.top = "0";
      document.body.appendChild(area);
      area.focus({ preventScroll: true });
      area.select();
      area.setSelectionRange(0, area.value.length);
      const copied = document.execCommand("copy");
      area.remove();
      return Boolean(copied);
    } catch (_) {
      return false;
    }
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

    app.addEventListener("click", handleClick);
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
      const route = event.state?.route;
      renderRoute(route && route.name ? route : { name: "home" }, "back");
    });

    if ("scrollRestoration" in history) history.scrollRestoration = "manual";

    const initial = routeFromHash();
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

  init().catch((error) => {
    console.error("Talk failed to initialise.", error);
    renderRoute({ name: "home" }, "forward", { instant: true });
  });
})();
