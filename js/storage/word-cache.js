/* ============================================================
   talk. — Word, Chunk & Sentence IndexedDB / localStorage Cache Store
   ============================================================ */

import { $, $$, normalizeWord, normalizeChunk } from "../core/utils.js";
import { isHallucinatedWord, ensureChunk } from "../model/normalize.js";
import { DEFAULT_CACHE_MAX, DEFAULT_CACHE_TTL_DAYS } from "./settings.js";

// Bumped when the stored shape grows, never to invalidate old entries:
// schema 2 payloads stay readable and are upgraded in place on next write.
export const WORD_CACHE_SCHEMA = 3;
export const WORD_CACHE_MIN_SCHEMA = 2;
export const WORD_CACHE_KEY = "talk.wordcache.v1";
export const WORD_DB_NAME = "talk.words.v1";
export const WORD_DB_STORE = "entries";
export const SENTENCE_DB_STORE = "sentences";
export const SENTENCE_CACHE_SCHEMA = 2;
export const SENTENCE_LIMIT = 120;
export const CHUNK_CACHE_PREFIX = "chunk:";
export const CHUNK_CACHE_LIMIT = 60;
export const PREFETCH_LIMIT = 4;

export function formatBytes(bytes) {
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

export function chunkCacheKey(value) {
  return CHUNK_CACHE_PREFIX + normalizeChunk(value);
}

export function createWordCacheStore({
  state,
  data: DATA,
  appEl,
  cacheCornerEl,
  uiLang,
  langSuffix,
  renderCacheContent,
  toast
}) {
  let wordDb = null;
  let wordStoreFallback = false;
  const wordCache = new Map();
  const sentenceCache = new Map();

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
      .sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
    try {
      localStorage.setItem(WORD_CACHE_KEY, JSON.stringify(Object.fromEntries(entries.map((item) => [item.key, item]))));
    } catch (_) {
      try { localStorage.removeItem(WORD_CACHE_KEY); } catch (_) { /* no-op */ }
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

  // IndexedDB caches are unlimited and never auto-expire; users can clear manually.
  async function pruneWordCache() {}

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
    } catch (error) {
      console.warn("IndexedDB word store unavailable; using localStorage fallback.", error);
      wordStoreFallback = true;
      const legacy = legacyWordCache();
      for (const [key, hit] of Object.entries(legacy)) {
        if (hit?.data) wordCache.set(normalizeWord(key), { ...hit, key: normalizeWord(key) });
      }
    }
  }

  function cacheGetWord(word, detail = state.settings?.detailLevel || "standard") {
    const key = normalizeWord(word) + langSuffix();
    const hit = wordCache.get(key);
    if (!hit || !hit.data) return null;
    if (Number(hit.schema || 0) < WORD_CACHE_MIN_SCHEMA) {
      void removeWordRecord(key);
      return null;
    }
    if (hit.data?.word && isHallucinatedWord(hit.data.word, word)) {
      void removeWordRecord(key);
      return null;
    }
    return { ...hit.data, gen: hit.gen || hit.data.gen || null, cached: true };
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
  }

  function cacheGetChunk(query) {
    const key = chunkCacheKey(query);
    const hit = wordCache.get(key);
    if (!hit?.data || hit.data.kind !== "chunk") return null;
    return { ...ensureChunk(hit.data), cached: true };
  }

  function cachePutChunk(query, data, detail = state.settings?.detailLevel || "standard") {
    const key = chunkCacheKey(query);
    if (!key || !data) return;
    const record = { key, at: Date.now(), detail, schema: WORD_CACHE_SCHEMA, data: { ...data, kind: "chunk" } };
    wordCache.set(key, record);
    if (wordDb) {
      wordDb.put(WORD_DB_STORE, record).catch((error) => {
        console.warn("Could not write chunk cache to IndexedDB.", error);
      });
    } else if (wordStoreFallback) {
      persistFallbackWordCache();
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

  function removeSentenceRecord(key) {
    if (!key) return;
    sentenceCache.delete(key);
    if (wordDb) wordDb.delete(SENTENCE_DB_STORE, key).catch(() => {});
  }

  function cacheGetSentence(key) {
    const record = sentenceCache.get(key);
    if (!record || !(record.schema >= 1)) return null;
    return record.data || null;
  }

  function cachePutSentence(key, data, level, detail) {
    const record = { key, schema: SENTENCE_CACHE_SCHEMA, savedAt: Date.now(), level, detail, data };
    sentenceCache.set(key, record);
    if (wordDb) {
      wordDb.put(SENTENCE_DB_STORE, record).catch(() => {});
    }
  }

  function clearSentenceCache() {
    sentenceCache.clear();
    if (wordDb) wordDb.clear(SENTENCE_DB_STORE).catch(() => {});
  }

  function isWordCached(word) {
    const key = normalizeWord(word);
    return Boolean(key) && (Boolean(DATA.words[key]) || Boolean(cacheGetWord(key)));
  }

  function applyCacheDisplay() {
    if (!appEl) return;
    appEl.classList.toggle("cache-display-borders", state.settings.cacheDisplay !== "corner");
    if (state.settings.cacheDisplay === "corner") return;
    if (cacheCornerEl) cacheCornerEl.hidden = true;
  }

  function refreshCacheBorders(root = document) {
    $$("[data-cache-word]", root).forEach((element) => {
      const cached = isWordCached(element.dataset.cacheWord);
      element.classList.toggle("is-cache-ready", cached);
      element.classList.toggle("is-cache-pending", !cached);
      element.dataset.cacheState = cached ? "cached" : "pending";
    });
  }

  function updateCacheCorner(filled, label) {
    if (!cacheCornerEl) return;
    if (state.settings.cacheDisplay !== "corner") {
      cacheCornerEl.hidden = true;
      cacheCornerEl.dataset.label = label;
      return;
    }
    cacheCornerEl.hidden = false;
    cacheCornerEl.dataset.state = filled ? "filled" : "hollow";
    cacheCornerEl.dataset.label = label;
    cacheCornerEl.classList.toggle("is-filled", filled);
    cacheCornerEl.classList.toggle("is-hollow", !filled);
    cacheCornerEl.title = label;
    cacheCornerEl.setAttribute("aria-label", `缓存状态：${label}`);
  }

  function hideCacheCorner() {
    if (!cacheCornerEl) return;
    cacheCornerEl.hidden = true;
    cacheCornerEl.dataset.label = "";
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

  async function clearWordStore() {
    wordCache.clear();
    if (wordDb) {
      try { await wordDb.clear(WORD_DB_STORE); } catch (_) { /* no-op */ }
    }
    try { localStorage.removeItem(WORD_CACHE_KEY); } catch (_) { /* no-op */ }
  }

  function exportWordCache() {
    const entries = [...wordCache.values()]
      .filter((entry) => entry?.key && entry?.data)
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
    if (file.size > 200 * 1024 * 1024) throw new Error("缓存文件超过 200MB");
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
    const entries = [...wordCache.values()]
      .filter((entry) => entry?.key && entry?.data)
      .sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
    return {
      count: entries.length,
      unlimited: true,
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
    return { average, bytes: stats.bytes, label: formatBytes(stats.bytes) };
  }

  return {
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
    isWordCached,
    applyCacheDisplay,
    refreshCacheBorders,
    updateCacheCorner,
    hideCacheCorner
  };
}
