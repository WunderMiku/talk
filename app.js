/* ============================================================
   talk. — interactive dictionary prototype
   Vanilla JS. No build step.
   ============================================================ */

(() => {
  "use strict";

  const DATA = window.TALK_DATA;
  const app = document.getElementById("app");
  const screen = document.getElementById("screen");
  const layerRoot = document.getElementById("layer-root");
  const overlayRoot = document.getElementById("overlay-root");
  const cacheCorner = document.getElementById("cache-corner");
  const toastEl = document.getElementById("toast");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isDesktop = () => window.matchMedia("(min-width: 861px)").matches;

  const CONFIG_KEY = "talk.model.v1";
  const PREFERENCES_KEY = "talk.prefs.v1";
  const PREFERENCE_FIELDS = ["prefetch", "cacheDisplay", "ttsEngine", "kokoroVoice", "detailLevel"];
  const HISTORY_KEY = "talk.history.v1";
  const SAVED_KEY = "talk.saved.v1";
  const WORD_CACHE_KEY = "talk.wordcache.v1";
  const WORD_CACHE_TTL = 1000 * 60 * 60 * 24 * 90;
  const WORD_CACHE_MAX = 300;

  const DEFAULT_SETTINGS = {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    apiKey: "",
    remember: false,
    prefetch: false,
    cacheDisplay: "borders",
    detailLevel: "standard",
    ttsEngine: "kokoro",
    kokoroVoice: "af_heart"
  };

  const KOKORO_CDN = "./vendor/kokoro.web.js";
  const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
  const KOKORO_VOICES = [
    ["af_heart", "Heart · 美式女声"],
    ["af_bella", "Bella · 美式女声"],
    ["af_nicole", "Nicole · 美式女声"],
    ["am_michael", "Michael · 美式男声"],
    ["bf_emma", "Emma · 英式女声"],
    ["bm_george", "George · 英式男声"]
  ];

  const DETAIL_LEVELS = {
    fast: {
      label: "快速",
      maxTokens: 1400,
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
      maxTokens: 2600,
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
      maxTokens: 3800,
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
    custom: { baseUrl: "", model: "" }
  };

  const wordRequests = new Map();
  let prefetchToken = 0;
  let currentAudio = null;
  let ttsAudio = null;
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
    lastAttempt: null,
    openKey: 0,
    moodOffset: 0
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

  function posLabel(value) {
    const key = String(value || "").toLowerCase();
    return ({
      noun: "名词",
      verb: "动词",
      adjective: "形容词",
      adverb: "副词",
      phrase: "短语",
      preposition: "介词",
      pronoun: "代词",
      conjunction: "连词"
    })[key] || value || "词";
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

    return {
      ...fallback,
      ...preferences,
      ...parsed,
      prefetch: Boolean(preferences.prefetch || parsed.prefetch),
      apiKey: String(parsed.apiKey || ""),
      remember: Boolean(parsed.remember),
      ttsEngine: preferences.ttsEngine || parsed.ttsEngine || "kokoro",
      detailLevel: preferences.detailLevel || parsed.detailLevel || "standard",
      kokoroVoice: preferences.kokoroVoice || parsed.kokoroVoice || "af_heart"
    };
  }

  function persistSettings(settings) {
    const raw = JSON.stringify(settings);
    try { sessionStorage.setItem(CONFIG_KEY, raw); } catch (_) { /* no-op */ }
    try {
      if (settings.remember) localStorage.setItem(CONFIG_KEY, raw);
      else localStorage.removeItem(CONFIG_KEY);
    } catch (_) { /* no-op */ }
    try {
      const preferences = {};
      for (const key of PREFERENCE_FIELDS) preferences[key] = settings[key];
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    } catch (_) { /* no-op */ }
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
      .filter((item) => item && (item.type === "word" || item.type === "sentence") && item.query)
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

  function loadWordCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(WORD_CACHE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function cacheGetWord(word, detail = state.settings?.detailLevel || "standard") {
    const key = normalizeWord(word);
    const all = loadWordCache();
    const hit = all[key];
    if (!hit || !hit.data) return null;
    if (hit.detail && hit.detail !== detail) return null;
    if (Date.now() - Number(hit.at || 0) > WORD_CACHE_TTL) {
      delete all[key];
      try { localStorage.setItem(WORD_CACHE_KEY, JSON.stringify(all)); } catch (_) { /* no-op */ }
      return null;
    }
    return { ...hit.data, cached: true };
  }

  function cachePutWord(word, data, detail = state.settings?.detailLevel || "standard") {
    const key = normalizeWord(word);
    if (!key || !data) return;
    const all = loadWordCache();
    const { context, ...clean } = data;
    all[key] = { at: Date.now(), detail, data: clean };
    const entries = Object.entries(all)
      .sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0))
      .slice(0, WORD_CACHE_MAX);
    try { localStorage.setItem(WORD_CACHE_KEY, JSON.stringify(Object.fromEntries(entries))); } catch (_) {
      // A full storage quota should never break the lookup.
      try { localStorage.removeItem(WORD_CACHE_KEY); } catch (_) { /* no-op */ }
    }
  }

  function lookupWordDeduped(word) {
    const key = normalizeWord(word);
    const cached = cacheGetWord(key);
    if (cached) return Promise.resolve({ type: "word", data: cached });
    if (wordRequests.has(key)) return wordRequests.get(key);
    const request = modelLookup(key, "word", state.settings)
      .finally(() => wordRequests.delete(key));
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
    const queue = [...plan.fresh];
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
    volume: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/></svg>`
  };

  /* ============================================================
     Routing & transitions
     ============================================================ */

  function routeHash(route) {
    if (route.name === "word") return `#/word/${encodeURIComponent(route.word || "")}`;
    if (route.name === "sentence") return `#/sentence/${encodeURIComponent(route.id || route.result?.id || "")}`;
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
      }
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

  function renderRoute(route, direction = "forward", { instant = false } = {}) {
    const apply = () => {
      state.route = route;
      closeSheet({ immediate: true });
      closeAllWordLayers({ immediate: true });
      screen.innerHTML = pageHtml(route);
      applyCacheDisplay();
      refreshCacheBorders(screen);
      if (route.name === "word") {
        const word = getWord(route);
        if (word) schedulePrefetch(word);
      } else {
        prefetchToken += 1;
        hideCacheCorner();
      }
      screen.scrollTop = 0;
      screen.classList.remove("is-leaving", "is-back-leaving", "is-entering");
      void screen.offsetWidth;
      screen.classList.add("is-entering");
      window.setTimeout(() => screen.classList.remove("is-entering"), 1300);
      document.title = pageTitle(route);
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
    return ensureSentence(DATA.sentences.find((item) => item.id === route?.id));
  }

  /* ============================================================
     Top bar
     ============================================================ */

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

  function homePage() {
    const recent = state.history.length ? state.history.slice(0, 3) : sanitizeHistory(DATA.recent);
    const daily = dailyEntry();
    const moods = visibleMoods();
    const registerLabels = { common: "日常", formal: "正式", literary: "文学", informal: "口语", technical: "技术" };
    const dailyKicker = daily ? `${String(dayNumber()).padStart(3, "0")} · ${registerLabels[daily.register] || "每日"}` : "每日";
    return `
      ${homeTopbar()}
      <section class="home-hero">
        <div class="eyebrow reveal" style="--d:0"><span class="spark"></span>英语 · 在语境中理解</div>
        <h1 class="home-title reveal" style="--d:0.5">把词，<em>看透。</em></h1>
        <p class="home-lede reveal" style="--d:1">不只告诉你词义，更让你看见一个词<strong>怎么活</strong>。查一个单词，或读懂一整句话。</p>
      </section>

      <div class="search-wrap reveal" style="--d:1.5">
        <form class="search-card" id="search-form" novalidate>
          <div class="search-top">
            <span class="mono">查一查</span>
            <div class="mode-switch" role="group" aria-label="查询模式">
              <button class="mode-btn ${state.mode === "auto" ? "active" : ""}" type="button" data-action="mode" data-mode="auto" aria-pressed="${state.mode === "auto"}">自动</button>
              <button class="mode-btn ${state.mode === "word" ? "active" : ""}" type="button" data-action="mode" data-mode="word" aria-pressed="${state.mode === "word"}">单词</button>
              <button class="mode-btn ${state.mode === "sentence" ? "active" : ""}" type="button" data-action="mode" data-mode="sentence" aria-pressed="${state.mode === "sentence"}">句子</button>
            </div>
          </div>
          <div class="search-row">
            <textarea class="search-input" id="search-input" rows="1" maxlength="320" placeholder="输入一个单词，或一整句话…" aria-label="单词或句子" spellcheck="false"></textarea>
            <button class="search-submit" type="submit" aria-label="查询">${icon("arrowUpRight")}</button>
          </div>
          <div class="search-bottom">
            <span class="detected"><i></i><span id="detect-label">自动 · 单词</span></span>
            <span class="search-kbd"><span>↵</span> to search</span>
          </div>
        </form>
        <div class="recent-row" aria-label="最近查询">
          <span class="recent-label">最近</span>
          ${recent.map((item) => `
            <button class="chip" type="button" data-action="lookup" data-query="${attr(item.query)}" data-type="${attr(item.type)}">
              ${item.type === "sentence" ? `<span class="quote-dot"></span>` : ""}
              ${esc(shorten(item.query, 34))}
            </button>`).join("")}
        </div>
      </div>

      <section class="section reveal" style="--d:2">
        <div class="section-head">
          <div>
            <span class="section-kicker">每天一个小仪式</span>
            <h2>今日一词</h2>
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
            <div class="daily-phonetic">${esc(daily.phonetic || "")} · ${esc(daily.pos || "word")}</div>
          </div>
          <div class="daily-bottom">
            <p class="daily-meaning">${esc(daily.translation || daily.short || "")}</p>
            <span class="daily-arrow">${icon("arrowUpRight")}</span>
          </div>
        </button>` : ""}
      </section>

      <section class="section reveal" style="--d:2.5">
        <div class="section-head">
          <div>
            <span class="section-kicker">跟着感觉走</span>
            <h2>按心情漫游</h2>
          </div>
          <div class="section-actions">
            <span class="side-note" id="mood-count">${String(moods.length).padStart(2, "0")} 组词单</span>
            <button class="mood-refresh" type="button" data-action="shuffle-moods">换一组</button>
          </div>
        </div>
        <div class="mood-scroll" id="mood-scroll">
          ${moodCardsMarkup(moods)}
        </div>
      </section>

      <footer class="home-footer">
        <span>为好奇的人而做</span><i></i><span>随时接入模型</span>
      </footer>`;
  }

  function shorten(value, length) {
    const s = String(value ?? "").replace(/\s+/g, " ").trim();
    return s.length > length ? `${s.slice(0, length).trim()}…` : s;
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

    return {
      ...raw,
      word: String(raw.word || ""),
      phonetic: String(raw.phonetic || raw.ipa || ""),
      pos: String(raw.pos || raw.partOfSpeech || ""),
      level: String(raw.level || "—"),
      register: String(raw.register || "common"),
      short: String(raw.short || senses[0]?.en || ""),
      translation: String(raw.translation || senses[0]?.zh || ""),
      note: String(raw.note || ""),
      senses,
      family: normalizeRelations(raw.family || raw.derivatives),
      synonyms: normalizeRelations(raw.synonyms),
      antonyms: normalizeRelations(raw.antonyms),
      examples: normalizeExamples(raw.examples),
      collocations: normalizeStrings(raw.collocations),
      related: normalizeStrings(raw.related),
      origin: normalizeOrigin(raw.origin || raw.etymology),
      spelling: normalizeSpelling(raw.spelling, raw.word),
      source: raw.source || "demo",
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

  function wordPage(word, layer = null) {
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
          </div>
          <h1 class="word-title" aria-label="${attr(word.word)}">${letterTitle(word.word)}</h1>
          <div class="word-subrow reveal" style="--d:1">
            <span class="ipa">${esc(word.phonetic || "—")}</span>
            <span class="dot-sep"></span>
            <span class="pos-pill">${esc(posLabel(word.pos))}</span>
            <button class="speak-btn" type="button" data-action="speak" data-text="${attr(word.word)}">${icon("volume")} 发音</button>
          </div>
          <p class="word-gloss reveal" style="--d:1.1">${esc(word.translation || word.short)}</p>
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

        <section class="block reveal" style="--d:1.8">
          ${blockHead("01", "词义", `${word.senses.length} 个义项`)}
          <div class="meaning-card">
            ${word.senses.map((sense, index) => `
              <div class="sense">
                <span class="sense-num">${String(index + 1).padStart(2, "0")}</span>
                <div>
                  <p class="sense-zh">${esc(sense.zh || sense.en)}</p>
                  ${sense.zh && sense.en ? `<p class="sense-en">${esc(sense.en)}</p>` : ""}
                  ${sense.tag ? `<span class="micro-tag">${esc(tagLabel(sense.tag))}</span>` : ""}
                </div>
              </div>`).join("")}
          </div>
        </section>

        ${word.family.length ? `
        <section class="block reveal" style="--d:2">
          ${blockHead("02", "同根词", "派生词")}
          <div class="h-scroll">
            ${word.family.map((item) => `
              <button class="family-card" type="button" data-action="word-layer" data-word="${attr(item.word)}" data-cache-word="${attr(item.word)}" data-gloss="${attr(item.gloss)}" data-pos="${attr(item.pos)}" data-relation="同根词">
                <span class="family-top">
                  <span class="family-pos">${esc(item.pos || "—")}</span>
                  ${icon("arrowUpRight", "family-arrow")}
                </span>
                <strong class="family-word">${esc(item.word)}</strong>
                <span class="family-gloss">${esc(item.gloss)}</span>
              </button>`).join("")}
          </div>
        </section>` : ""}

        ${(word.synonyms.length || word.antonyms.length) ? `
        <section class="block reveal" style="--d:2.2">
          ${blockHead("03", "近义与反义", "点击继续查")}
          <div class="relation-grid">
            <div class="relation-card syn">
              <div class="relation-head"><h3>近义词</h3><span class="relation-icon">+</span></div>
              <div class="rel-list">
                ${word.synonyms.map((item) => `
                  <button class="rel-chip" type="button" data-action="word-layer" data-word="${attr(item.word)}" data-cache-word="${attr(item.word)}" data-gloss="${attr(item.gloss)}" data-pos="${attr(item.pos)}" data-relation="近义词">
                    <span class="rel-word">${esc(item.word)}</span>
                    <span class="rel-gloss">${esc(item.gloss)}</span>
                  </button>`).join("")}
              </div>
            </div>
            <div class="relation-card ant">
              <div class="relation-head"><h3>反义词</h3><span class="relation-icon">−</span></div>
              <div class="rel-list">
                ${word.antonyms.map((item) => `
                  <button class="rel-chip" type="button" data-action="word-layer" data-word="${attr(item.word)}" data-cache-word="${attr(item.word)}" data-gloss="${attr(item.gloss)}" data-pos="${attr(item.pos)}" data-relation="反义词">
                    <span class="rel-word">${esc(item.word)}</span>
                    <span class="rel-gloss">${esc(item.gloss)}</span>
                  </button>`).join("")}
              </div>
            </div>
          </div>
        </section>` : ""}

        ${word.examples.length ? `
        <section class="block reveal" style="--d:2.4">
          ${blockHead("04", "例句", `${word.examples.length} 个例句`)}
          ${word.examples.map((example) => `
            <div class="example-card">
              <span class="example-quote">“</span>
              <p class="example-en">${highlightPlain(example.en, word.word)}</p>
              ${example.zh ? `<p class="example-zh">${esc(example.zh)}</p>` : ""}
              ${example.source ? `<span class="example-source">${esc(example.source)}</span>` : ""}
            </div>`).join("")}
        </section>` : ""}

        ${word.collocations.length ? `
        <section class="block reveal" style="--d:2.6">
          ${blockHead("05", "常见搭配", "固定说法")}
          <div class="collocation-row">
            ${word.collocations.map((item) => `<button class="collocation" type="button" data-action="lookup" data-query="${attr(item)}" data-type="word">${esc(item)}</button>`).join("")}
          </div>
        </section>` : ""}

        ${word.memory ? `
        <section class="block reveal" style="--d:2.8">
          ${blockHead("06", "记法", "一个记忆钩子")}
          <div class="memory-card">
            <span class="memory-label">顺着这根线</span>
            <p class="memory-text">${rich(word.memory)}</p>
          </div>
        </section>` : ""}

        ${word.origin ? `
        <section class="block reveal" style="--d:3">
          ${blockHead("07", "词源与演变", "从词根看")}
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
        <section class="block reveal" style="--d:3.2">
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
        </div>
      </main>`;
  }

  /* ============================================================
     Sentence page
     ============================================================ */

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
      keyWords,
      sourceType: raw.sourceType || raw.source || "demo",
      model: raw.model || ""
    };
  }

  function sentencePage(sentence) {
    const bookmark = `sentence:${sentence.id}`;
    return `
      ${backTopbar({ label: "句子", title: `${sentence.keyWords.length} 个重点词`, bookmark })}
      <main class="result-page">
        <section class="sentence-hero">
          <div class="result-kicker reveal" style="--d:0">
            <span class="kicker-pill accent">句子</span>
            <span class="kicker-pill">${sentence.keyWords.length} 个重点词</span>
          </div>
          <p class="sentence-text reveal" style="--d:0.6">${annotateSentence(sentence.text, sentence.keyWords)}</p>
          <div class="sentence-source reveal" style="--d:1">
            <span>${esc(sentence.source || "Talk corpus")}</span>
            <span class="wave"></span>
            <button class="speak-btn" type="button" data-action="speak" data-text="${attr(sentence.text)}">${icon("volume")} 朗读</button>
          </div>
        </section>

        <section class="block reveal" style="--d:1.3">
          ${blockHead("01", "整句意思", "中文翻译")}
          <div class="translation-card">
            <span class="translation-label">${icon("quote")} 整句理解</span>
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

        <section class="block reveal" style="--d:1.5">
          ${blockHead("02", "值得注意的词", "点击展开")}
          <div class="key-list">
            ${sentence.keyWords.map((keyWord, index) => keyCard(keyWord, index)).join("")}
          </div>
        </section>

        <div class="page-actions reveal" style="--d:2">
          <button class="btn btn-primary" type="button" data-action="save">${icon("bookmark")} 收藏句子</button>
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
                    data-action="word-layer" data-word="${attr(item.word)}" data-cache-word="${attr(item.word)}" data-gloss="${attr(item.gloss)}" data-pos="${attr(item.pos)}"
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
        word: String(keyWord.word || keyWord.surface || "")
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
      out += `<button class="kw" type="button" data-action="open-key" data-index="${matched.index}" aria-label="查看 ${attr(matched.word)}">${esc(match[0])}</button>`;
      last = match.index + match[0].length;
    }
    out += esc(text.slice(last));
    return out;
  }

  /* ============================================================
     Loading / missing / error
     ============================================================ */

  function loadingPage(query, type) {
    return `
      ${backTopbar({ label: type === "sentence" ? "正在理解句子" : "正在查询单词", title: shorten(query, 28) })}
      <main class="result-page loading-page">
        <div class="result-kicker reveal" style="--d:0">
          <span class="kicker-pill accent">${type === "sentence" ? "句子" : "单词"}</span>
          <span class="kicker-pill">正在整理</span>
        </div>
        <h1 class="loading-query reveal" style="--d:0.4">${esc(query)}</h1>
        <div class="loading-status reveal" style="--d:0.8">
          <span class="loading-dots"><i></i><i></i><i></i></span>
          <span id="loading-status-text">${type === "sentence" ? "找出真正重要的词" : "正在理解词义"}</span>
        </div>
        <div class="skeleton-stack reveal" style="--d:1">
          <div class="skeleton hero"></div>
          <div class="skeleton line"></div>
          <div class="skeleton line short"></div>
          <div class="skeleton card tall"></div>
          <div class="skeleton card"></div>
          <div class="skeleton line"></div>
        </div>
      </main>`;
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
        <p class="state-copy reveal" style="--d:0.6">模型请求没有完整返回。${isCors ? "浏览器直连常会被 CORS 拦截；Android 版会改为原生请求，不受这个限制。" : "请检查接口地址、模型名和密钥，然后再试一次。"}</p>
        <span class="state-query reveal" style="--d:0.8">${esc(shorten(route.query || "", 88))}</span>
        ${route.message ? `<div class="error-detail reveal" style="--d:1">${esc(shorten(route.message, 320))}</div>` : ""}
        <div class="state-actions reveal" style="--d:1.1">
          <button class="btn btn-primary" type="button" data-action="retry">${icon("refresh")} 重试</button>
          <button class="btn btn-secondary" type="button" data-action="settings">${icon("settings")} 模型设置</button>
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
    screen.classList.toggle("is-locked", state.sheetOpen || state.wordLayers.length > 0);
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
      <main class="result-page loading-page layer-wait">
        <div class="result-kicker reveal" style="--d:0">
          <span class="kicker-pill accent">正在查词</span>
          <span class="kicker-pill">模型正在整理</span>
        </div>
        <h1 class="loading-query reveal" style="--d:0.3">${esc(word)}</h1>
        <div class="loading-status reveal" style="--d:0.5">
          <span class="loading-dots"><i></i><i></i><i></i></span>
          <span>正在生成完整词条</span>
        </div>
        <div class="skeleton-stack reveal" style="--d:0.7">
          <div class="skeleton hero"></div>
          <div class="skeleton line"></div>
          <div class="skeleton line short"></div>
          <div class="skeleton card tall"></div>
          <div class="skeleton card"></div>
        </div>
      </main>`;
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
      data: data || null,
      origin,
      relation,
      depth,
      options,
      loading: !data,
      error: null
    };
    state.wordLayers.push(record);
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
    scroll.innerHTML = content;
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
        <div class="sheet-scroll" id="sheet-scroll"></div>
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
            <button class="sheet-rel" type="button" data-action="sheet-word" data-word="${attr(item.word)}" data-gloss="${attr(item.gloss || "")}" data-pos="${attr(item.pos || "")}">
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
        ${isStub ? `<div class="sheet-note">${icon("info")}<span>这是演示词库里的迷你词条。连接模型后，可以补全义项、细微差别和更多例句。</span></div>` : ""}
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
    state.draft = { ...state.settings };
    openSheetShell({ kicker: "模型设置", title: "连接模型" });
    renderSettingsContent();
    requestAnimationFrame(updateTtsBackendStatus);
  }

  function ttsSettingsHtml(draft) {
    const engine = draft.ttsEngine || "kokoro";
    return `
      <div class="settings-divider"></div>
      <div class="tts-head">
        <span class="settings-subhead">发音</span>
        <div class="tts-engine-switch" role="group" aria-label="发音引擎">
          <button class="tts-engine-btn ${engine === "kokoro" ? "active" : ""}" type="button" data-action="tts-engine" data-engine="kokoro" aria-pressed="${engine === "kokoro"}">Kokoro</button>
          <button class="tts-engine-btn ${engine === "native" ? "active" : ""}" type="button" data-action="tts-engine" data-engine="native" aria-pressed="${engine === "native"}">系统原生</button>
        </div>
      </div>
      ${engine === "native" ? `
        <div class="tts-row">
          <span class="tts-line">设备原生语音 · 点击即读，无需加载模型</span>
          <button class="btn btn-secondary tts-test-btn" type="button" data-action="test-tts">${icon("volume")} 试听</button>
        </div>
        <span class="tts-status" id="tts-test-status">将使用设备系统语音</span>` : `
        <div class="tts-row">
          <select id="kokoro-voice" data-setting="kokoroVoice" aria-label="Kokoro 语音">
            ${KOKORO_VOICES.map(([id, label]) => `<option value="${id}" ${(draft.kokoroVoice || "af_heart") === id ? "selected" : ""}>${label}</option>`).join("")}
          </select>
          <button class="btn btn-secondary tts-test-btn" type="button" data-action="test-tts">${icon("volume")} 试听</button>
        </div>
        <span class="tts-status" id="tts-test-status">首次点发音会加载模型</span>
        <p class="tts-line" id="tts-backend-status">当前后端：未加载</p>
        ${!window.isSecureContext ? `<p class="tts-line tts-https-warning">HTTP 环境不会启用 WebGPU，语音加载会慢一些</p>` : ""}
        <p class="tts-error" id="tts-error" hidden></p>`}`;
  }

  function renderSettingsContent() {
    const holder = $("#sheet-scroll");
    if (!holder || !state.draft) return;
    const draft = state.draft;
    holder.innerHTML = `
      <div class="sheet-content">
        <p class="settings-intro">接入你自己的模型。Talk 使用 OpenAI 兼容的 Chat Completions 格式，DeepSeek、OpenAI 或本地服务都可以。</p>
        <div class="provider-switch" role="group" aria-label="服务商">
          ${Object.entries({ deepseek: "DeepSeek", openai: "OpenAI", custom: "自定义" }).map(([id, label]) => `
            <button class="provider-btn ${draft.provider === id ? "active" : ""}" type="button" data-action="provider" data-provider="${id}">${label}</button>`).join("")}
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
          <p class="field-hint">快速减少义项和例句，token 更少；标准为默认；深入更完整但更慢。词典建议使用 deepseek-chat，deepseek-reasoner 会更慢。</p>
        </div>
        <div class="field">
          <label for="api-key">API 密钥</label>
          <input id="api-key" type="password" data-setting="apiKey" value="${attr(draft.apiKey)}" placeholder="sk-…" spellcheck="false" autocomplete="off" />
          <p class="field-hint">密钥只会发送到你的接口。当前 HTML 原型保存在浏览器中；Android 版会改用系统 Keystore。</p>
        </div>
        <label class="check-row">
          <input type="checkbox" data-setting="remember" ${draft.remember ? "checked" : ""} />
          在这台设备上记住密钥
        </label>
        <label class="pref-toggle">
          <span class="pref-copy">
            <strong>预加载二级词条</strong>
            <span>词页出现后，在后台生成同根词、近反义词等相关词，点开更快；会额外消耗模型额度。开关立即生效，无需点保存。</span>
          </span>
          <span class="pref-switch">
            <input type="checkbox" data-setting="prefetch" ${draft.prefetch ? "checked" : ""} />
            <span class="pref-slider" aria-hidden="true"></span>
          </span>
        </label>
        <div class="cache-display-setting">
          <span class="pref-copy">
            <strong>缓存提示方式</strong>
            <span>边框：相关词的边框虚线为未缓存、实线为已缓存。三角标：只在词页右下角显示整页缓存状态。切换立即生效。</span>
          </span>
          <div class="cache-display-switch" role="group" aria-label="缓存提示方式">
            <button class="cache-display-btn ${draft.cacheDisplay !== "corner" ? "active" : ""}" type="button" data-action="cache-display" data-display="borders" aria-pressed="${draft.cacheDisplay !== "corner"}">边框</button>
            <button class="cache-display-btn ${draft.cacheDisplay === "corner" ? "active" : ""}" type="button" data-action="cache-display" data-display="corner" aria-pressed="${draft.cacheDisplay === "corner"}">三角标</button>
          </div>
        </div>
        <div class="key-status ${hasModelConfig(draft) ? "" : "off"}" id="api-test-status">
          ${hasModelConfig(draft) ? `${icon("shield")} <span>已配置模型 · ${esc(draft.model || "自定义")}</span>` : "<span>演示模式 · 无需密钥</span>"}
        </div>
        ${ttsSettingsHtml(draft)}
        <div class="settings-actions">
          <button class="btn btn-primary" type="button" data-action="save-settings">${icon("check")} 保存</button>
          <button class="btn btn-secondary" type="button" data-action="test-connection">${icon("sparkle")} 测试</button>
        </div>
        <p class="api-note"><b>浏览器限制：</b>部分服务商会用 CORS 拦截网页直连；这里失败不代表密钥有误，Android 原生请求不会有这个限制。<br /><b>子词条缓存：</b>模型生成的词条会保存在本机，最多 300 个、90 天后过期。<button class="link-btn" type="button" data-action="clear-word-cache">清除缓存</button></p>
      </div>`;
  }

  function openHistorySheet() {
    openSheetShell({ kicker: "查询足迹", title: "最近查询" });
    renderHistoryContent();
  }

  function renderHistoryContent() {
    const holder = $("#sheet-scroll");
    if (!holder) return;
    const items = state.history;
    holder.innerHTML = `
      <div class="sheet-content">
        ${items.length ? `
          <div class="history-list">
            ${items.map((item) => `
              <button class="history-item" type="button" data-action="history-item" data-query="${attr(item.query)}" data-type="${attr(item.type)}">
                <span class="history-icon ${item.type === "sentence" ? "sentence" : ""}">${item.type === "sentence" ? icon("sentence") : icon("book")}</span>
                <span class="history-copy">
                  <strong>${esc(shorten(item.query, 44))}</strong>
                  <span>${item.type === "sentence" ? "句子" : "单词"} · ${esc(timeAgo(item.at))}</span>
                </span>
              </button>`).join("")}
          </div>
          <div class="settings-actions">
            <button class="btn btn-secondary" type="button" data-action="clear-history">${icon("trash")} 清空记录</button>
          </div>` : `
          <div class="history-empty">还没有查询记录。<br />查一个词，它会在这里等你。</div>`}
      </div>`;
  }

  /* ============================================================
     Settings actions
     ============================================================ */

  function saveSettings() {
    if (!state.draft) return;
    state.draft.apiKey = String(state.draft.apiKey || "").trim();
    state.draft.baseUrl = String(state.draft.baseUrl || "").trim();
    state.draft.model = String(state.draft.model || "").trim();
    state.settings = { ...state.draft };
    persistSettings(state.settings);
    closeSheet();
    const topLayer = state.wordLayers[state.wordLayers.length - 1];
    if (topLayer && !topLayer.data) void hydrateLayerWithModel(topLayer);
    const active = activeWordData();
    if (active) schedulePrefetch(active);
    toast(hasModelConfig() ? "模型已连接" : "已切换到演示模式");
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
      const response = await fetch(endpointFor(state.draft.baseUrl), {
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
          stream: false
        }),
        signal: controller.signal
      });
      window.clearTimeout(timer);
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}${text ? ` · ${text.slice(0, 120)}` : ""}`);
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

  async function runSearch(rawQuery, requestedMode = "auto") {
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
    if (query.length > 320) {
      toast("请控制在 320 个字符以内");
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
        result = type === "word"
          ? await lookupWordDeduped(query)
          : await modelLookup(query, type, state.settings);
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

  function endpointFor(baseUrl) {
    let base = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!base) throw new Error("请先在模型设置里填写 API 地址。");
    if (!/^https?:\/\//i.test(base)) throw new Error("API 地址需要以 http:// 或 https:// 开头。");
    if (!/\/chat\/completions$/i.test(base)) base += "/chat/completions";
    return base;
  }

  function systemPrompt() {
    return [
      "你是 Talk，一位面向中文母语者的双语英语词典编辑。",
      "用户主要看中文，所以解释、提示、语气判断都用自然、简洁的简体中文。",
      "英文只用来保留词汇本身的定义、例句和必要的语感说明，不要写大段英文导语。",
      "解释词在语境中的真实用法，而不是只给一个对译词。",
      "定义与例句用自然英文；中文翻译要像中文，不要逐字硬译。",
      "只返回一个合法 JSON 对象，不要使用 Markdown 代码块或额外说明。",
      "不确定音标时返回空字符串，不要编造。",
      "例句要短、自然、值得记住。"
    ].join(" ");
  }

  function wordPrompt(query, detail = "standard") {
    const level = DETAIL_LEVELS[detail] || DETAIL_LEVELS.standard;
    return `请为一位中文母语学习者查这个词或短语：「${query}」。

只返回下面结构的 JSON：
{
  "kind": "word",
  "word": "词头，小写",
  "phonetic": "/IPA/",
  "pos": "noun | verb | adjective | adverb | phrase",
  "level": "A1-C2",
  "register": "common | formal | literary | informal | technical",
  "spelling": {
    "input": "用户原始输入，原样保留",
    "corrected": "用户真正想查的正确拼写；如果拼写正确就重复原词",
    "changed": false,
    "confidence": 0.0,
    "note": "中文，一句话说明为什么判断为拼写错误"
  },
  "short": "一句简洁、自然的英文释义",
  "translation": "简体中文释义，放在最显眼的位置",
  "note": "一条中文使用提示，讲清楚什么时候用、容易错在哪",
  "senses": [{"en": "英文定义", "zh": "中文解释", "tag": "中文标签，如：核心义 / 正式 / 引申义"}],
  "family": [{"word": "派生词", "pos": "adj.", "gloss": "简短英文释义"}],
  "synonyms": [{"word": "近义词", "gloss": "用英文点出细微差别"}],
  "antonyms": [{"word": "反义词", "gloss": "用英文点出细微差别"}],
  "examples": [{"en": "自然英文例句", "zh": "中文翻译"}],
  "collocations": ["常见搭配"],
  "memory": "一句中文记忆钩子，可以保留少量英文，并可用 <em>强调</em>",
  "related": ["相关词头"],
  "origin": {
    "root": "词根与构词，例如：拉丁语 re- + salire",
    "original": "这个词最初的意思，用中文说明",
    "story": "一段简短的中文词源故事，讲清楚它怎么从原义走到今天",
    "stages": [{"when": "时间", "label": "阶段名", "text": "这一阶段的变化，用中文"}]
  }
}

规则：在生成词条前先判断输入是否像拼写错误。只有当你高置信度地知道用户想查哪个正确英文词时，才把 spelling.changed 设为 true，并把 spelling.corrected 设为该词；随后整条词条必须针对 corrected 生成。拼写正确时 changed 为 false，corrected 重复原词。不要为了“纠正”而改动真实存在的生僻词、人名、品牌名或外来词。本次深度为「${level.label}」：义项 ${level.senses} 个；同根词 ${level.family} 个；近义词 ${level.synonyms} 个；反义词 ${level.antonyms} 个；例句 ${level.examples} 个；搭配 ${level.collocations} 个；词源演变 ${level.stages} 个阶段。近义词和反义词的 gloss 要具体说明差别，不要写空泛标签。中文解释优先，英文只作为词汇本身的补充。词源必须尽量准确；不确定的词源可以给空对象，不要编故事。`;
  }

  function sentencePrompt(query, detail = "standard") {
    const level = DETAIL_LEVELS[detail] || DETAIL_LEVELS.standard;
    return `请为一位中文母语学习者拆解这句英文：
"${query}"

只返回下面结构的 JSON：
{
  "kind": "sentence",
  "text": "原句，保持完全不变",
  "translation": "自然、通顺的简体中文翻译",
  "tone": "用 2-4 个中文词描述语气与文体，例如：克制 · 略带讽刺",
  "structure": "一句中文句式观察，讲清楚这句话是怎么搭起来的",
  "keyWords": [
    {
      "word": "词头",
      "surface": "在句中出现的原样子串",
      "phonetic": "/IPA/",
      "pos": "词性",
      "meaning": "英文：这个词在本句中的意思",
      "meaningZh": "中文：这个词在本句中的意思，放在最显眼的位置",
      "why": "用中文说明：为什么这个词值得注意，它对句子的意思做了什么",
      "family": [{"word": "派生词", "pos": "adj.", "gloss": "简短英文释义"}],
      "synonyms": [{"word": "近义词", "gloss": "英文细微差别"}],
      "antonyms": [{"word": "反义词", "gloss": "英文细微差别"}],
      "example": {"en": "自然英文例句", "zh": "中文翻译"}
    }
  ]
}

挑选 ${level.keyWords} 个真正重要的词：支撑论点、情绪或意象的词，不要只挑最长的词。surface 必须原样出现在原句中。每个重点词至少给 1 个同根词、${level.synonyms} 个近义词、${level.antonyms} 个反义词和 1 个例句。中文负责解释，英文负责呈现词汇本身。`;
  }

  async function modelLookup(query, type, cfg) {
    const detail = cfg.detailLevel || "standard";
    if (type === "word") {
      const cached = cacheGetWord(query, detail);
      if (cached) return { type: "word", data: cached };
    }
    const endpoint = endpointFor(cfg.baseUrl);
    const prompt = type === "sentence" ? sentencePrompt(query, detail) : wordPrompt(query, detail);
    const messages = [
      { role: "system", content: systemPrompt() },
      { role: "user", content: prompt }
    ];
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 60_000);
    let response;
    try {
      response = await postChat(endpoint, cfg, messages, controller.signal, true, (DETAIL_LEVELS[detail] || DETAIL_LEVELS.standard).maxTokens);
    } finally {
      window.clearTimeout(timer);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${text ? ` · ${text.slice(0, 260)}` : ""}`);
    }
    const json = await response.json();
    const message = json?.choices?.[0]?.message;
    let content = message?.content;
    if (Array.isArray(content)) {
      content = content.map((part) => typeof part === "string" ? part : part?.text || "").join("");
    }
    if (!content) throw new Error("模型返回了空消息。");
    const parsed = parseJsonObject(content);
    if (type === "word") {
      const data = normalizeModelWord(parsed, query);
      data.source = "model";
      data.model = cfg.model;
      cachePutWord(normalizeWord(data.word), data, detail);
      if (normalizeWord(query) !== normalizeWord(data.word)) cachePutWord(query, data, detail);
      return { type: "word", data };
    }
    const data = normalizeModelSentence(parsed, query);
    data.sourceType = "model";
    data.model = cfg.model;
    data.source = "语境分析";
    return { type: "sentence", data };
  }

  async function postChat(endpoint, cfg, messages, signal, allowJsonMode, maxTokens = 2600) {
    const body = {
      model: cfg.model,
      messages,
      temperature: 0.4,
      max_tokens: maxTokens,
      stream: false
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
    const first = senses[0] || {};
    const word = String(base.word || base.headword || fallbackWord || "").trim().toLowerCase();
    if (!word) throw new Error("模型返回的内容里没有词头。");
    const result = {
      word,
      phonetic: String(base.phonetic || base.ipa || ""),
      pos: String(base.pos || base.partOfSpeech || ""),
      level: String(base.level || "—"),
      register: String(base.register || "common"),
      short: String(base.short || base.definition || first.en || ""),
      translation: String(base.translation || first.zh || ""),
      note: String(base.note || base.usageNote || ""),
      senses: senses.length ? senses : [{ en: String(base.definition || ""), zh: String(base.translation || ""), tag: "" }],
      family: normalizeRelations(base.family || base.derivatives),
      synonyms: normalizeRelations(base.synonyms),
      antonyms: normalizeRelations(base.antonyms),
      examples: normalizeExamples(base.examples),
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
    const keyWords = normalizeKeyWords(base.keyWords || base.key_words || base.words);
    if (!text) throw new Error("模型返回的内容里没有原句。");
    if (!keyWords.length) throw new Error("模型没有返回重点词。");
    return {
      id: `model-${Date.now()}`,
      text,
      translation: String(base.translation || ""),
      tone: String(base.tone || ""),
      structure: String(base.structure || ""),
      keyWords,
      source: "语境分析",
      sourceType: "model"
    };
  }

  function normalizeSpelling(value, fallbackWord = "") {
    if (!value || typeof value !== "object") return null;
    const input = String(value.input || value.query || "").trim();
    const corrected = String(value.corrected || value.correction || value.word || fallbackWord || "").trim();
    if (!input || !corrected) return null;
    const changed = value.changed !== undefined
      ? Boolean(value.changed)
      : normalizeWord(input) !== normalizeWord(corrected);
    if (!changed || normalizeWord(input) === normalizeWord(corrected)) return null;
    return {
      input,
      corrected,
      confidence: Number(value.confidence || 0),
      note: String(value.note || value.reason || "").trim()
    };
  }

  function normalizeOrigin(value) {
    if (!value || typeof value !== "object") return null;
    const stages = asArray(value.stages).map((stage) => ({
      when: String(stage.when || stage.time || stage.period || ""),
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
          family: [],
          synonyms: [],
          antonyms: [],
          example: null
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
        family: normalizeRelations(item.family || item.derivatives),
        synonyms: normalizeRelations(item.synonyms),
        antonyms: normalizeRelations(item.antonyms),
        example: normalizeExample(example)
      };
    }).filter((item) => item.word);
  }

  function normalizeRelations(value) {
    return asArray(value).map((item) => {
      if (typeof item === "string") return { word: item, pos: "", gloss: "" };
      return {
        word: String(item.word || item.term || item.text || ""),
        pos: String(item.pos || item.partOfSpeech || ""),
        gloss: String(item.gloss || item.meaning || item.definition || item.nuance || "")
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

  function handleClick(event) {
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

      case "copy":
        event.preventDefault();
        copyCurrentPage();
        break;

      case "provider":
        event.preventDefault();
        if (!state.draft) break;
        state.draft.provider = target.dataset.provider || "custom";
        if (PROVIDERS[state.draft.provider]) {
          state.draft.baseUrl = PROVIDERS[state.draft.provider].baseUrl || state.draft.baseUrl;
          state.draft.model = PROVIDERS[state.draft.provider].model || state.draft.model;
        }
        renderSettingsContent();
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
        state.settings = { ...state.settings, detailLevel: state.draft.detailLevel };
        persistSettings(state.settings);
        renderSettingsContent();
        break;

      case "tts-engine":
        event.preventDefault();
        if (!state.draft) break;
        state.draft.ttsEngine = target.dataset.engine === "native" ? "native" : "kokoro";
        state.settings = { ...state.settings, ttsEngine: state.draft.ttsEngine };
        persistSettings(state.settings);
        renderSettingsContent();
        break;

      case "cache-display":
        event.preventDefault();
        if (!state.draft) break;
        state.draft.cacheDisplay = target.dataset.display === "corner" ? "corner" : "borders";
        state.settings = { ...state.settings, cacheDisplay: state.draft.cacheDisplay };
        persistSettings(state.settings);
        applyCacheDisplay();
        refreshCacheBorders();
        if (state.draft.cacheDisplay === "corner") {
          const active = activeWordData();
          if (active) schedulePrefetch(active);
        } else {
          hideCacheCorner();
        }
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
        runSearch(target.dataset.query || "", target.dataset.type || "auto");
        break;

      case "clear-history":
        event.preventDefault();
        state.history = [];
        persistHistory();
        renderHistoryContent();
        toast("记录已清空");
        break;

      case "clear-word-cache":
        event.preventDefault();
        try { localStorage.removeItem(WORD_CACHE_KEY); } catch (_) { /* no-op */ }
        refreshCacheBorders();
        const active = activeWordData();
        if (active) schedulePrefetch(active);
        toast("子词条缓存已清除");
        break;

      default:
        break;
    }
  }

  function handleInput(event) {
    const target = event.target;
    if (target.id === "search-input") {
      autoGrow(target);
      updateSearchMeta();
      return;
    }
    if (target.matches("[data-setting]") && state.draft) {
      const key = target.dataset.setting;
      state.draft[key] = target.type === "checkbox" ? target.checked : target.value;
      if (key === "prefetch") {
        state.settings = { ...state.settings, prefetch: Boolean(target.checked) };
        persistSettings(state.settings);
        const active = activeWordData();
        if (active) schedulePrefetch(active);
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
    }
  }

  function handleSubmit(event) {
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
    return voices[0] || null;
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
    if (!blob.size) throw new Error("Kokoro returned empty audio.");
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

  /* ---------- Kokoro: local browser TTS ---------- */

  let kokoroTTSPromise = null;
  let kokoroBackend = "";
  let kokoroBackendDetail = "";
  let kokoroLoadMs = 0;
  let kokoroGenerateMs = 0;
  let lastKokoroError = "";

  function rejectAfter(ms, message) {
    return new Promise((_, reject) => window.setTimeout(() => reject(new Error(message)), ms));
  }

  async function detectWebGPU() {
    if (!("gpu" in navigator)) return false;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;
      const device = await adapter.requestDevice();
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("webgpu");
      if (!context) {
        device.destroy();
        return false;
      }
      context.configure({
        device,
        format: navigator.gpu.getPreferredCanvasFormat(),
        alphaMode: "opaque"
      });
      device.destroy();
      return true;
    } catch (_) {
      return false;
    }
  }

  function openKokoroFileDb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const request = indexedDB.open("talk.kokoro.files.v1", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function makeKokoroFileCache() {
    const keyOf = (input) => typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input?.url || String(input);
    return {
      async match(input) {
        try {
          const db = await openKokoroFileDb();
          const key = keyOf(input);
          const record = await new Promise((resolve) => {
            const request = db.transaction("files", "readonly").objectStore("files").get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
          });
          if (!record?.blob) return undefined;
          return new Response(record.blob, {
            status: record.status || 200,
            headers: record.headers || {}
          });
        } catch (_) {
          return undefined;
        }
      },
      async put(input, response) {
        try {
          const db = await openKokoroFileDb();
          const key = keyOf(input);
          const blob = await response.clone().blob();
          const headers = {};
          response.headers.forEach((value, name) => { headers[name] = value; });
          await new Promise((resolve, reject) => {
            const tx = db.transaction("files", "readwrite");
            tx.objectStore("files").put({
              blob,
              headers,
              status: response.status,
              at: Date.now()
            }, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
        } catch (_) {
          // A failed cache write must not break model loading.
        }
      }
    };
  }

  function installKokoroVoiceBridge() {
    if (window.__talkKokoroVoiceBridge) return;
    const originalFetch = window.fetch.bind(window);
    const modelMarker = "Kokoro-82M-v1.0-ONNX";
    const localRoot = new URL("./models/onnx-community/Kokoro-82M-v1.0-ONNX/", location.href).href;

    window.fetch = (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input?.url || "";

      if (url.includes(modelMarker) && url.startsWith("https://huggingface.co/")) {
        const clean = url.split("?")[0].split("#")[0];
        const filename = clean.split("/").pop() || "";
        let folder = "";
        if (clean.includes("/onnx/") || filename.endsWith(".onnx")) folder = "onnx/";
        else if (clean.includes("/voices/") || filename.endsWith(".bin")) folder = "voices/";
        if (filename && (folder || filename.endsWith(".json"))) {
          return originalFetch(new URL(`${folder}${filename}`, localRoot).href, init);
        }
      }
      return originalFetch(input, init);
    };
    window.__talkKokoroVoiceBridge = true;
  }

  function showTtsHttpsNotice() {
    if (window.isSecureContext) return;
    try {
      if (localStorage.getItem("talk.httpsNoticeSeen") === "1") return;
      localStorage.setItem("talk.httpsNoticeSeen", "1");
    } catch (_) { /* show it if storage is unavailable */ }
    if (document.getElementById("tts-https-notice")) return;

    const layer = document.createElement("div");
    layer.id = "tts-https-notice";
    layer.className = "notice-layer";
    layer.innerHTML = `
      <section class="notice-card" role="dialog" aria-labelledby="notice-title">
        <span class="mono">ENVIRONMENT</span>
        <h2 id="notice-title">WebGPU 被 HTTP 禁用了</h2>
        <p>当前页面通过 <code>${esc(location.origin)}</code> 打开。浏览器只在 HTTPS 或 localhost 下启用 WebGPU，所以 Talk 正在回退到 WASM，语音加载和合成会明显变慢。</p>
        <p class="notice-hint">部署到 GitHub Pages 的 <code>https://…</code> 地址，或在本机用 <code>localhost</code> 访问，就能启用 WebGPU。</p>
        <button class="btn btn-primary notice-close" type="button" data-notice-close>知道了</button>
      </section>`;
    app.appendChild(layer);
    requestAnimationFrame(() => layer.classList.add("show"));
    const close = () => {
      layer.classList.remove("show");
      window.setTimeout(() => layer.remove(), 260);
    };
    layer.querySelectorAll("[data-notice-close]").forEach((el) => el.addEventListener("click", close));
    layer.querySelector(".notice-close")?.focus({ preventScroll: true });
  }

  async function loadKokoro() {
    if (kokoroTTSPromise) return kokoroTTSPromise;
    kokoroTTSPromise = (async () => {
      const loadStarted = performance.now();
      installKokoroVoiceBridge();
      const module = await import(KOKORO_CDN);
      if (module.env) {
        const hasCacheApi = typeof caches !== "undefined";
        module.env.useBrowserCache = hasCacheApi;
        module.env.useCustomCache = !hasCacheApi;
        if (!hasCacheApi) module.env.customCache = makeKokoroFileCache();
        module.env.allowRemoteModels = false;
        module.env.allowLocalModels = true;
        module.env.localModelPath = new URL("./models/", location.href).href;
        const ortPath = new URL("./vendor/ort/", location.href).href;
        module.env.wasmPaths = ortPath;
        if (module.env.backends?.onnx?.wasm) {
          module.env.backends.onnx.wasm.wasmPaths = ortPath;
        }
      }
      const { KokoroTTS } = module;
      if (await detectWebGPU()) {
        try {
          const webgpu = KokoroTTS.from_pretrained(KOKORO_MODEL, {
            dtype: "q8",
            device: "webgpu"
          });
          webgpu.catch(() => { /* handled by the race below */ });
          const tts = await Promise.race([
            webgpu,
            rejectAfter(60_000, "WebGPU model load timed out")
          ]);
          kokoroBackend = "webgpu";
          kokoroBackendDetail = "WebGPU";
          kokoroLoadMs = Math.round(performance.now() - loadStarted);
          updateTtsBackendStatus();
          return tts;
        } catch (error) {
          kokoroBackendDetail = "WebGPU 初始化失败，已回退 WASM";
          console.warn("Kokoro WebGPU unavailable, falling back to WASM.", error);
          if (!window.isSecureContext) showTtsHttpsNotice();
        }
      } else if (!window.isSecureContext) {
        showTtsHttpsNotice();
      }
      const wasm = KokoroTTS.from_pretrained(KOKORO_MODEL, {
        dtype: "q8",
        device: "wasm"
      });
      wasm.catch(() => { /* handled by the race below */ });
      const tts = await Promise.race([
        wasm,
        rejectAfter(120_000, "Kokoro WASM model load timed out")
      ]);
      kokoroBackend = "wasm";
      if (!kokoroBackendDetail) kokoroBackendDetail = "WebGPU 不可用";
      kokoroLoadMs = Math.round(performance.now() - loadStarted);
      updateTtsBackendStatus();
      return tts;
    })();
    try {
      return await kokoroTTSPromise;
    } catch (error) {
      kokoroTTSPromise = null;
      throw error;
    }
  }

  function openKokoroAudioDb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const request = indexedDB.open("talk.kokoro.audio.v1", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getKokoroAudio(key) {
    try {
      const db = await openKokoroAudioDb();
      return await new Promise((resolve) => {
        const request = db.transaction("audio", "readonly").objectStore("audio").get(key);
        request.onsuccess = () => resolve(request.result?.blob || null);
        request.onerror = () => resolve(null);
      });
    } catch (_) {
      return null;
    }
  }

  async function putKokoroAudio(key, blob) {
    try {
      const db = await openKokoroAudioDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("audio", "readwrite");
        tx.objectStore("audio").put({ blob, at: Date.now() }, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {
      // Cache failures must never block playback.
    }
  }

  async function speakKokoro(text, button, cfg, { bypassCache = false } = {}) {
    const voice = KOKORO_VOICES.some(([id]) => id === cfg.kokoroVoice)
      ? cfg.kokoroVoice
      : "af_heart";
    const cacheKey = `${voice}|${text}|0.98`;
    if (!bypassCache) {
      const cached = await getKokoroAudio(cacheKey);
      if (cached) {
        await playAudioBlob(cached, button);
        return "kokoro-cache";
      }
    }

    const tts = await loadKokoro();
    const generateStarted = performance.now();
    const audio = await tts.generate(text, { voice, speed: 0.98 });
    kokoroGenerateMs = Math.round(performance.now() - generateStarted);
    updateTtsBackendStatus();
    const blob = audio.toBlob ? audio.toBlob() : new Blob([audio.toWav()], { type: "audio/wav" });
    await putKokoroAudio(cacheKey, blob);
    await playAudioBlob(blob, button);
    return kokoroBackend === "webgpu" ? "kokoro-webgpu" : "kokoro-wasm";
  }

  async function speakText(text, button = null, cfg = state.settings, options = {}) {
    const clean = String(text || "").trim();
    if (!clean) return null;
    if ((cfg.ttsEngine || "kokoro") === "native") {
      stopSpeech();
      return speakSystem(clean, button);
    }
    primeAudio();
    stopSpeech();
    setTtsLoading(button, true);
    try {
      return await speakKokoro(clean, button, cfg, options);
    } catch (error) {
      lastKokoroError = String(error?.message || error || "未知错误");
      console.warn("Kokoro TTS failed; silently falling back to system speech.", error);
      return speakSystem(clean, button);
    } finally {
      setTtsLoading(button, false);
    }
  }

  function updateTtsBackendStatus() {
    const target = $("#tts-backend-status");
    if (!target) return;
    if (!kokoroBackend) {
      target.textContent = "当前后端：未加载";
      return;
    }
    const backend = kokoroBackend === "webgpu" ? "WebGPU" : "WASM";
    const loadTiming = kokoroLoadMs ? ` · 模型 ${(kokoroLoadMs / 1000).toFixed(1)}s` : "";
    const timing = kokoroGenerateMs
      ? ` · 合成 ${(kokoroGenerateMs / 1000).toFixed(1)}s`
      : "";
    target.textContent = `当前后端：${backend}${kokoroBackendDetail ? ` · ${kokoroBackendDetail}` : ""}${loadTiming}${timing}`;
    const errorBox = $("#tts-error");
    if (errorBox) {
      errorBox.hidden = !lastKokoroError;
      errorBox.textContent = lastKokoroError ? `最近错误：${lastKokoroError}` : "";
    }
  }

  async function testTts(button) {
    const status = $("#tts-test-status");
    if (status) status.textContent = "正在加载 Kokoro 模型…";
    lastKokoroError = "";
    const selected = state.draft || state.settings;
    const engine = await speakText(
      "Kokoro is ready.",
      button,
      selected,
      { bypassCache: true }
    );
    if (status) {
      if ((selected.ttsEngine || "kokoro") === "native") {
        status.textContent = "正在使用设备系统语音";
      } else {
        const timing = kokoroGenerateMs ? ` · 合成 ${(kokoroGenerateMs / 1000).toFixed(1)}s` : "";
        const backend = kokoroBackend === "webgpu" ? "WebGPU" : "WASM";
        status.textContent = engine === "system"
          ? (kokoroBackend
              ? `已加载，但合成或播放失败：${lastKokoroError || "未知错误"}`
              : `模型加载失败：${lastKokoroError || "未知错误"}`)
          : `Kokoro 已就绪 · ${backend}${timing}`;
      }
    }
    if ((selected.ttsEngine || "kokoro") !== "native") updateTtsBackendStatus();
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
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      toast("Copied to clipboard");
    } catch (_) {
      toast("Could not copy in this browser");
    }
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

  function init() {
    applyCacheDisplay();
    app.addEventListener("click", handleClick);
    app.addEventListener("input", handleInput);
    app.addEventListener("change", handleInput);
    app.addEventListener("submit", handleSubmit);
    document.addEventListener("keydown", handleKeydown);

    window.addEventListener("popstate", (event) => {
      state.searchSeq += 1;
      clearLoadingTimer();
      const route = event.state?.route;
      renderRoute(route && route.name ? route : { name: "home" }, "back");
    });

    if ("scrollRestoration" in history) history.scrollRestoration = "manual";

    const initial = routeFromHash();
    history.replaceState({ route: initial, depth: 0 }, "", routeHash(initial));
    renderRoute(initial, "forward", { instant: true });

    // Expose a tiny debugging surface for the design review.
    window.TALK_APP = {
      goHome: () => navigate({ name: "home" }, { replace: true }),
      openWord: (word) => openWordRoute(word),
      openSentence: (id) => {
        const sentence = DATA.sentences.find((item) => item.id === id);
        if (sentence) navigate({ name: "sentence", id, result: sentence });
      },
      search: (query, mode = "auto") => runSearch(query, mode),
      state
    };
  }

  init();
})();
