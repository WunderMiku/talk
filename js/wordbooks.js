/* ============================================================
   talk. — Wordbooks (分册词汇书库) Engine
   Completely decoupled from IndexedDB wordCache (supports both
   cached and uncached terms). Guarantees lossless AI sorting
   with before/after database counts.
   ============================================================ */
(function () {
  "use strict";

  const STORAGE_KEY = "talk.wordbooks.v1";
  const DEFAULT_BOOK_ID = "dense-stacks";
  const DEFAULT_BOOK_NAME = "密集书库";

  function cleanTerm(raw) {
    let s = String(raw || "").trim();
    if (!s) return "";
    if (s.startsWith("word:")) s = s.slice(5).trim();
    else if (s.startsWith("chunk:")) s = s.slice(6).replace(/-/g, " ").trim();
    return s.replace(/\s+/g, " ");
  }

  function normKey(raw) {
    return cleanTerm(raw).toLowerCase();
  }

  function slugId(name) {
    const base = String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24);
    return `${base || "book"}-${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 4)}`;
  }

  function defaultStore() {
    return {
      version: 1,
      books: [
        {
          id: DEFAULT_BOOK_ID,
          name: DEFAULT_BOOK_NAME,
          system: true,
          createdAt: Date.now(),
          items: []
        }
      ]
    };
  }

  const WB_DB_NAME = "talk.wordbooks.v1";
  const WB_DB_STORE = "store";
  const WB_RECORD_ID = "main";

  let memoryStore = null;
  let wbDb = null;
  let idbReady = false;
  let wbWriteChain = Promise.resolve();

  function openRawWbDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const req = indexedDB.open(WB_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(WB_DB_STORE)) {
          db.createObjectStore(WB_DB_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function rawWbGet(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(WB_DB_STORE, "readonly");
      const req = tx.objectStore(WB_DB_STORE).get(WB_RECORD_ID);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  function rawWbPut(db, record) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(WB_DB_STORE, "readwrite");
      tx.objectStore(WB_DB_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function normalizeStoreShape(parsed, legacySaved = []) {
    if (!parsed || !Array.isArray(parsed.books)) {
      parsed = defaultStore();
      // Migrate legacy flat saved list into 密集书库 without losing anything
      const seen = new Set();
      if (Array.isArray(legacySaved)) {
        for (const raw of legacySaved) {
          const term = cleanTerm(raw);
          const key = normKey(term);
          if (!term || seen.has(key)) continue;
          seen.add(key);
          parsed.books[0].items.push({ term, addedAt: Date.now() });
        }
      }
    }
    // Ensure 密集书库 always exists and sits first
    let dense = parsed.books.find((b) => b.id === DEFAULT_BOOK_ID);
    if (!dense) {
      dense = { id: DEFAULT_BOOK_ID, name: DEFAULT_BOOK_NAME, system: true, createdAt: Date.now(), items: [] };
      parsed.books.unshift(dense);
    } else {
      dense.system = true;
      if (!dense.name) dense.name = DEFAULT_BOOK_NAME;
    }
    parsed.books.forEach((b) => {
      if (!Array.isArray(b.items)) b.items = [];
    });
    return parsed;
  }

  // Merge any books/terms from a legacy localStorage copy into the primary IDB store without losing anything.
  function mergeStoresLossless(primary, extra) {
    if (!extra || !Array.isArray(extra.books)) return primary;
    const seen = new Set();
    primary.books.forEach((b) => {
      (b.items || []).forEach((it) => {
        const k = normKey(it?.term);
        if (k) seen.add(k);
      });
    });
    for (const srcBook of extra.books) {
      if (!srcBook || !Array.isArray(srcBook.items) || !srcBook.items.length) continue;
      let dstBook = primary.books.find((b) => b.id === srcBook.id)
        || primary.books.find((b) => b.name === srcBook.name);
      if (!dstBook) {
        dstBook = {
          id: srcBook.id || slugId(srcBook.name),
          name: srcBook.name || DEFAULT_BOOK_NAME,
          system: srcBook.id === DEFAULT_BOOK_ID,
          createdAt: srcBook.createdAt || Date.now(),
          items: []
        };
        primary.books.push(dstBook);
      }
      for (const it of srcBook.items) {
        const term = cleanTerm(it?.term);
        const k = normKey(term);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        dstBook.items.push({ term, addedAt: Number(it?.addedAt) || Date.now() });
      }
    }
    return primary;
  }

  function readLocalStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.books)) return parsed;
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  function loadStore(legacySaved = []) {
    if (memoryStore) return memoryStore;
    const rawLocal = readLocalStore();
    const hadLocal = Boolean(rawLocal);
    const parsed = normalizeStoreShape(rawLocal, legacySaved);
    memoryStore = parsed;
    if (!hadLocal) saveStore(parsed);
    return memoryStore;
  }

  async function initStore(legacySaved = []) {
    if (idbReady) return memoryStore || loadStore(legacySaved);
    if (typeof indexedDB === "undefined") {
      return loadStore(legacySaved);
    }
    try {
      let existingRow = null;
      if (window.idb?.openDB) {
        wbDb = await window.idb.openDB(WB_DB_NAME, 1, {
          upgrade(db) {
            if (!db.objectStoreNames.contains(WB_DB_STORE)) {
              db.createObjectStore(WB_DB_STORE, { keyPath: "id" });
            }
          }
        });
        existingRow = await wbDb.get(WB_DB_STORE, WB_RECORD_ID);
      } else {
        const rawDb = await openRawWbDb();
        wbDb = {
          __raw: rawDb,
          put: (_store, record) => rawWbPut(rawDb, record)
        };
        existingRow = await rawWbGet(rawDb);
      }

      const idbStore = existingRow?.data && Array.isArray(existingRow.data.books) ? existingRow.data : null;
      const localStore = readLocalStore();
      let merged;
      if (idbStore) {
        merged = normalizeStoreShape(idbStore, []);
        if (localStore) mergeStoresLossless(merged, localStore);
      } else if (localStore) {
        merged = normalizeStoreShape(localStore, []);
      } else if (memoryStore) {
        merged = normalizeStoreShape(memoryStore, []);
      } else {
        merged = normalizeStoreShape(null, []);
      }
      if (Array.isArray(legacySaved) && legacySaved.length) {
        mergeStoresLossless(merged, normalizeStoreShape(null, legacySaved));
      }

      memoryStore = merged;
      await wbDb.put(WB_DB_STORE, { id: WB_RECORD_ID, data: merged, updatedAt: Date.now() });
      idbReady = true;
      // Clear legacy localStorage copy only after IndexedDB commit succeeded.
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
      return memoryStore;
    } catch (error) {
      console.warn("IndexedDB wordbooks store unavailable; using localStorage fallback.", error);
      wbDb = null;
      idbReady = false;
      return loadStore(legacySaved);
    }
  }

  const STORAGE_LIMIT = 4600000;

  function usage() {
    try {
      if (memoryStore) return JSON.stringify(memoryStore).length;
      return (localStorage.getItem(STORAGE_KEY) || "").length;
    } catch (_) {
      return 0;
    }
  }

  // IndexedDB has hundreds of MB to GB available; only enforce the ~4.6M UTF-16
  // guard when running on the localStorage fallback.
  function wouldFit(extraChars = 0) {
    if (idbReady) return true;
    return usage() + Math.ceil(Math.max(0, Number(extraChars) || 0) * 1.3) + 1024 < STORAGE_LIMIT;
  }

  function backend() {
    return idbReady ? "IndexedDB" : "localStorage";
  }

  function reportStorageError() {
    try {
      window.dispatchEvent(new CustomEvent("talk:wordbook-storage-error", { detail: { usage: usage(), limit: STORAGE_LIMIT } }));
    } catch (_) { /* no-op */ }
  }

  function saveStore(store = memoryStore) {
    if (!store) return false;
    memoryStore = store;
    if (idbReady && wbDb) {
      const snapshot = store;
      wbWriteChain = wbWriteChain
        .catch(() => {})
        .then(() => wbDb.put(WB_DB_STORE, { id: WB_RECORD_ID, data: snapshot, updatedAt: Date.now() }))
        .catch(() => {
          reportStorageError();
        });
      return true;
    }
    let payload = "";
    try {
      payload = JSON.stringify(store);
    } catch (_) {
      reportStorageError();
      return false;
    }
    if (payload.length >= STORAGE_LIMIT) {
      reportStorageError();
      return false;
    }
    try {
      localStorage.setItem(STORAGE_KEY, payload);
      return true;
    } catch (_) {
      reportStorageError();
      return false;
    }
  }

  function flush() {
    return wbWriteChain.catch(() => {});
  }

  function resetMemoryCache() {
    memoryStore = null;
  }

  function stats() {
    const store = loadStore();
    const unique = new Set();
    let totalEntries = 0;
    const perBook = store.books.map((b) => {
      totalEntries += b.items.length;
      b.items.forEach((it) => unique.add(normKey(it.term)));
      return { id: b.id, name: b.name, count: b.items.length };
    });
    return {
      bookCount: store.books.length,
      totalEntries,
      uniqueWords: unique.size,
      perBook
    };
  }

  function listBooks() {
    return loadStore().books;
  }

  function getBook(id) {
    return loadStore().books.find((b) => b.id === id) || null;
  }

  function allTermsFlat() {
    const seen = new Set();
    const out = [];
    for (const book of loadStore().books) {
      for (const item of book.items) {
        const key = normKey(item.term);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item.term);
      }
    }
    return out;
  }

  function findBookOf(term) {
    const key = normKey(term);
    if (!key) return null;
    for (const book of loadStore().books) {
      if (book.items.some((it) => normKey(it.term) === key)) return book;
    }
    return null;
  }

  function hasTerm(term) {
    return Boolean(findBookOf(term));
  }

  function createBook(name) {
    const clean = String(name || "").trim().slice(0, 24);
    if (!clean) return null;
    const store = loadStore();
    const existing = store.books.find((b) => b.name.toLowerCase() === clean.toLowerCase());
    if (existing) return existing;
    const book = { id: slugId(clean), name: clean, system: false, createdAt: Date.now(), items: [] };
    store.books.push(book);
    saveStore(store);
    return book;
  }

  function renameBook(id, newName) {
    const clean = String(newName || "").trim().slice(0, 24);
    if (!clean || id === DEFAULT_BOOK_ID) return false;
    const book = getBook(id);
    if (!book) return false;
    book.name = clean;
    saveStore();
    return true;
  }

  function deleteBook(id, { rescueToDense = true } = {}) {
    if (id === DEFAULT_BOOK_ID) return { ok: false, rescued: 0 };
    const store = loadStore();
    const idx = store.books.findIndex((b) => b.id === id);
    if (idx < 0) return { ok: false, rescued: 0 };
    const [removed] = store.books.splice(idx, 1);
    let rescued = 0;
    if (rescueToDense && removed.items.length) {
      const dense = getBook(DEFAULT_BOOK_ID);
      const existingKeys = new Set(dense.items.map((it) => normKey(it.term)));
      for (const item of removed.items) {
        const key = normKey(item.term);
        if (!existingKeys.has(key)) {
          dense.items.unshift(item);
          existingKeys.add(key);
          rescued += 1;
        }
      }
    }
    saveStore(store);
    return { ok: true, rescued };
  }

  function addTerm(term, bookId = DEFAULT_BOOK_ID) {
    const clean = cleanTerm(term);
    const key = normKey(clean);
    if (!clean) return { added: false, book: null };
    const target = getBook(bookId) || getBook(DEFAULT_BOOK_ID);
    if (target.items.some((it) => normKey(it.term) === key)) {
      return { added: false, book: target };
    }
    target.items.unshift({ term: clean, addedAt: Date.now() });
    saveStore();
    return { added: true, book: target };
  }

  function removeTerm(term, bookId = null) {
    const key = normKey(term);
    if (!key) return false;
    const store = loadStore();
    let changed = false;
    for (const book of store.books) {
      if (bookId && book.id !== bookId) continue;
      const before = book.items.length;
      book.items = book.items.filter((it) => normKey(it.term) !== key);
      if (book.items.length !== before) changed = true;
    }
    if (changed) saveStore(store);
    return changed;
  }

  function moveTerm(term, fromBookId, toBookId) {
    if (fromBookId === toBookId) return false;
    const key = normKey(term);
    const from = getBook(fromBookId);
    const to = getBook(toBookId);
    if (!from || !to || !key) return false;
    const idx = from.items.findIndex((it) => normKey(it.term) === key);
    if (idx < 0) return false;
    const [item] = from.items.splice(idx, 1);
    if (!to.items.some((it) => normKey(it.term) === key)) {
      to.items.unshift(item);
    }
    saveStore();
    return true;
  }

  /* Batch import: supports .json (full wordbooks backup or string[]), .csv, or line/comma-separated .txt */
  function importData(rawText, targetBookId = DEFAULT_BOOK_ID) {
    const before = stats();
    const text = String(rawText || "").trim();
    if (!text) return { before, after: before, added: 0, skipped: 0, booksImported: 0 };
    if (!wouldFit(text.length)) {
      reportStorageError();
      return { before, after: before, added: 0, skipped: 0, booksImported: 0, storageFull: true };
    }

    let added = 0;
    let skipped = 0;
    let booksImported = 0;

    // 1. Try JSON backup or JSON array
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.books)) {
          for (const incoming of parsed.books) {
            if (!incoming || !Array.isArray(incoming.items)) continue;
            const dest = incoming.id === DEFAULT_BOOK_ID || incoming.name === DEFAULT_BOOK_NAME
              ? getBook(DEFAULT_BOOK_ID)
              : createBook(incoming.name || "导入分册");
            if (!dest) continue;
            booksImported += 1;
            for (const it of incoming.items) {
              const t = typeof it === "string" ? it : it?.term;
              const res = addTerm(t, dest.id);
              if (res.added) added += 1;
              else if (cleanTerm(t)) skipped += 1;
            }
          }
          const after = stats();
          return { before, after, added, skipped, booksImported };
        }
        if (Array.isArray(parsed)) {
          const dest = getBook(targetBookId) || getBook(DEFAULT_BOOK_ID);
          for (const it of parsed) {
            const t = typeof it === "string" ? it : it?.term || it?.word;
            const res = addTerm(t, dest.id);
            if (res.added) added += 1;
            else if (cleanTerm(t)) skipped += 1;
          }
          const after = stats();
          return { before, after, added, skipped, booksImported: 1 };
        }
      } catch (_) { /* fall through to plain text */ }
    }

    // 2. Plain text / CSV: split by newlines, semicolons, or Chinese commas (keep spaces inside phrases!)
    const dest = getBook(targetBookId) || getBook(DEFAULT_BOOK_ID);
    const lines = text.split(/\r?\n/);
    const terms = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      // If CSV with tab or comma, take parts if they look like word list; if "word, 中文释义", keep first col
      if (trimmed.includes("\t")) {
        terms.push(trimmed.split("\t")[0].trim());
      } else if (trimmed.includes(",")) {
        const parts = trimmed.split(",").map((x) => x.trim()).filter(Boolean);
        // If second column contains Chinese characters, treat as "term, meaning" CSV and take column 1 only
        if (parts.length >= 2 && /[\u3400-\u9fff]/.test(parts[1])) {
          terms.push(parts[0].replace(/^["']|["']$/g, ""));
        } else {
          parts.forEach((p) => terms.push(p.replace(/^["']|["']$/g, "")));
        }
      } else {
        terms.push(trimmed);
      }
    }

    for (const t of terms) {
      const res = addTerm(t, dest.id);
      if (res.added) added += 1;
      else if (cleanTerm(t)) skipped += 1;
    }

    const after = stats();
    return { before, after, added, skipped, booksImported: 1 };
  }

  function exportBookTxt(bookId) {
    const book = getBook(bookId);
    if (!book) return "";
    return book.items.map((it) => it.term).join("\n") + (book.items.length ? "\n" : "");
  }

  function exportAllJson() {
    return JSON.stringify(loadStore(), null, 2);
  }

  /**
   * Lossless AI Thematic Classification:
   * Takes a sourceBookId (typically 密集书库) and AI-returned groups:
   *   [{ book: "科技与产品", words: ["autocomplete", ...] }, ...]
   * Audits before/after counts and GUARANTEES zero word loss:
   * any source word omitted or misspelled by the AI stays safely in sourceBookId.
   */
  function applyAiClassification(sourceBookId, groups) {
    const before = stats();
    const store = loadStore();
    const source = store.books.find((b) => b.id === sourceBookId) || null;
    if (!source || !source.items.length) {
      return { before, after: before, moved: 0, retained: 0, createdBooks: [], lost: 0, recovered: 0 };
    }

    // Snapshot EVERY unique word across ALL books before touching anything (hard zero-loss baseline)
    const beforeAllMap = new Map();
    for (const b of store.books) {
      for (const item of b.items) {
        const k = normKey(item.term);
        if (k && !beforeAllMap.has(k)) beforeAllMap.set(k, item);
      }
    }

    const sourceSnapshot = new Map();
    for (const item of source.items) {
      const k = normKey(item.term);
      if (k && !sourceSnapshot.has(k)) sourceSnapshot.set(k, item);
    }

    const existingBookNames = new Set(store.books.map((b) => b.name));
    const createdBooks = [];
    const movedKeys = new Set(); // ONLY tracks words actually inserted into a DIFFERENT destination book
    let moved = 0;

    if (Array.isArray(groups)) {
      for (const group of groups) {
        const bookName = String(group?.book || group?.name || group?.topic || "").trim().slice(0, 24);
        const words = Array.isArray(group?.words) ? group.words : [];
        if (!bookName || !words.length) continue;

        // Resolve or create destination book FIRST before marking any word as moved
        let dest = store.books.find((b) => b.name.toLowerCase() === bookName.toLowerCase());
        if (!dest) {
          dest = createBook(bookName);
          if (dest && !existingBookNames.has(dest.name)) {
            createdBooks.push(dest.name);
            existingBookNames.add(dest.name);
          }
        }
        // If AI assigned words back to the same source book (e.g. "密集书库"), keep them safely in source!
        if (!dest || dest.id === source.id) continue;

        const destKeys = new Set(dest.items.map((it) => normKey(it.term)));
        for (const w of words) {
          const k = normKey(w);
          if (!k || movedKeys.has(k) || !sourceSnapshot.has(k)) continue;
          const item = sourceSnapshot.get(k);
          if (!destKeys.has(k)) {
            dest.items.unshift(item);
            destKeys.add(k);
          }
          movedKeys.add(k);
          moved += 1;
        }
      }
    }

    // Remove ONLY words confirmed moved to another book
    source.items = source.items.filter((item) => !movedKeys.has(normKey(item.term)));

    // Hard post-audit reconciliation: compare against beforeAllMap and restore any missing word
    const afterKeys = new Set();
    for (const b of store.books) {
      for (const item of b.items) {
        const k = normKey(item.term);
        if (k) afterKeys.add(k);
      }
    }
    let recovered = 0;
    const rescueBook = store.books.find((b) => b.id === source.id) || store.books.find((b) => b.id === DEFAULT_BOOK_ID);
    if (rescueBook) {
      for (const [k, item] of beforeAllMap.entries()) {
        if (!afterKeys.has(k)) {
          rescueBook.items.push(item);
          afterKeys.add(k);
          recovered += 1;
        }
      }
    }

    const retained = source.items.length;
    saveStore(store);

    const after = stats();
    const lost = Math.max(0, before.uniqueWords - after.uniqueWords);
    return { before, after, moved, retained, createdBooks, lost, recovered };
  }

  window.TALK_WORDBOOKS = {
    STORAGE_KEY,
    DEFAULT_BOOK_ID,
    DEFAULT_BOOK_NAME,
    initStore,
    loadStore,
    saveStore,
    flush,
    backend,
    resetMemoryCache,
    stats,
    listBooks,
    getBook,
    allTermsFlat,
    findBookOf,
    hasTerm,
    createBook,
    renameBook,
    deleteBook,
    addTerm,
    removeTerm,
    moveTerm,
    importData,
    exportBookTxt,
    exportAllJson,
    usage,
    wouldFit,
    STORAGE_LIMIT,
    applyAiClassification
  };
})();
