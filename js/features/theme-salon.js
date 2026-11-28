/* ============================================================
   talk. — Theme Salon (AI-curated word exhibitions + IndexedDB store)
   ============================================================ */

import { $, esc, attr, posLabel } from "../core/utils.js";
import { icon } from "../core/icons.js";

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

export function normalizeThemeDeck(raw) {
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

export function createThemeSalon({
  state,
  content,
  llm,
  copyFor,
  hasModelConfig,
  openSheetShell,
  closeSheet,
  renderSettingsContent,
  formatBytes,
  toast
}) {
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

  const themeDeckBytes = new WeakMap();

  function deckByteLength(deck) {
    if (!deck || typeof deck !== "object") return 0;
    const cached = themeDeckBytes.get(deck);
    if (typeof cached === "number") return cached;
    try {
      const str = JSON.stringify(deck);
      let bytes = 0;
      for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff) {
          bytes += 4;
          i += 1;
        } else bytes += 3;
      }
      themeDeckBytes.set(deck, bytes);
      return bytes;
    } catch (_) {
      return 0;
    }
  }

  function themeCacheStatsSync() {
    const decks = Array.isArray(state.themeDecks) ? state.themeDecks : [];
    let bytes = 0;
    let words = 0;
    for (const deck of decks) {
      bytes += deckByteLength(deck);
      words += deck.words?.length || 0;
    }
    return {
      count: decks.length,
      displayCount: Array.isArray(state.themeDisplay) ? state.themeDisplay.length : 0,
      max: THEME_DISPLAY_LIMIT,
      bytes,
      words
    };
  }

  async function themeCacheStats() {
    if (Array.isArray(state.themeDecks)) return themeCacheStatsSync();
    const decks = await themeDecksRead();
    state.themeDecks = decks;
    return themeCacheStatsSync();
  }

  async function renderThemeCacheStats() {
    const target = $("#theme-cache-stats");
    if (!target) return;
    try {
      const stats = await themeCacheStats();
      if (!target.isConnected) return;
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

  function fallbackThemeDeck() {
    const decks = Array.isArray(content.themeDecks) ? content.themeDecks : [];
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

  function cycleTheme(delta) {
    ensureThemeDecks();
    if (state.themeDisplay.length <= 1) return;
    state.themeIndex = (state.themeIndex + Number(delta || 1) + state.themeDisplay.length) % state.themeDisplay.length;
    state.themeDeck = themeDeckByTitle(state.themeDisplay[state.themeIndex]) || state.themeDeck;
    renderThemeSalon({ animate: true });
  }

  async function requestThemeDeck(seed, exclude = []) {
    const data = await llm.requestJson({
      settings: state.settings,
      system: window.TALK_PROMPTS.theme,
      user: { task: "theme", seed, exclude },
      maxTokens: 1400,
      timeoutMs: 50_000,
      label: "主题沙龙",
      disableThinking: true,
      temperature: 0.3,
      retries: 1
    });
    return normalizeThemeDeck(data);
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

  const actions = {
    "theme-cycle": ({ event, target }) => {
      event.preventDefault();
      cycleTheme(target.dataset.delta);
    },
    "theme-generate": ({ event }) => {
      event.preventDefault();
      generateThemeDeck();
    },
    "theme-picker": ({ event }) => {
      event.preventDefault();
      openThemePicker();
    },
    "theme-pick": ({ event, target }) => {
      event.preventDefault();
      pickTheme(target.dataset.title);
    },
    "clear-theme-cache": async ({ event }) => {
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
    }
  };

  return {
    initThemeStore,
    currentThemeDeck,
    themeSalonMarkup,
    renderThemeSalon,
    renderThemeCacheStats,
    themeCacheStats,
    themeCacheStatsSync,
    clearThemeStore,
    actions
  };
}
