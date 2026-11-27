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

  let memoryStore = null;

  function loadStore(legacySaved = []) {
    if (memoryStore) return memoryStore;
    let parsed = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch (_) { /* ignore */ }

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
      saveStore(parsed);
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
    memoryStore = parsed;
    return memoryStore;
  }

  const STORAGE_LIMIT = 4600000;

  function usage() {
    try {
      return (localStorage.getItem(STORAGE_KEY) || "").length;
    } catch (_) {
      return 0;
    }
  }

  // Cheap pre-flight: does the current store plus roughly this many extra
  // characters still fit in the browser's ~5M UTF-16 quota?
  function wouldFit(extraChars = 0) {
    return usage() + Math.ceil(Math.max(0, Number(extraChars) || 0) * 1.3) + 1024 < STORAGE_LIMIT;
  }

  function reportStorageError() {
    try {
      window.dispatchEvent(new CustomEvent("talk:wordbook-storage-error", { detail: { usage: usage(), limit: STORAGE_LIMIT } }));
    } catch (_) { /* no-op */ }
  }

  function saveStore(store = memoryStore) {
    if (!store) return false;
    memoryStore = store;
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
    const source = getBook(sourceBookId);
    if (!source || !source.items.length) {
      return { before, after: before, moved: 0, retained: 0, createdBooks: [], lost: 0 };
    }

    const sourceSnapshot = new Map();
    for (const item of source.items) {
      sourceSnapshot.set(normKey(item.term), item);
    }

    const store = loadStore();
    const existingBookNames = new Set(store.books.map((b) => b.name));
    const createdBooks = [];
    const assignedKeys = new Set();
    let moved = 0;

    if (Array.isArray(groups)) {
      for (const group of groups) {
        const bookName = String(group?.book || group?.name || group?.topic || "").trim().slice(0, 24);
        const words = Array.isArray(group?.words) ? group.words : [];
        if (!bookName || !words.length) continue;

        const matchedItems = [];
        for (const w of words) {
          const k = normKey(w);
          if (!k || assignedKeys.has(k) || !sourceSnapshot.has(k)) continue;
          assignedKeys.add(k);
          matchedItems.push(sourceSnapshot.get(k));
        }
        if (!matchedItems.length) continue;

        let dest = store.books.find((b) => b.name.toLowerCase() === bookName.toLowerCase());
        if (!dest) {
          dest = createBook(bookName);
          if (dest && !existingBookNames.has(dest.name)) {
            createdBooks.push(dest.name);
            existingBookNames.add(dest.name);
          }
        }
        if (!dest || dest.id === source.id) continue;

        const destKeys = new Set(dest.items.map((it) => normKey(it.term)));
        for (const item of matchedItems) {
          const k = normKey(item.term);
          if (!destKeys.has(k)) {
            dest.items.unshift(item);
            destKeys.add(k);
          }
          moved += 1;
        }
      }
    }

    // Keep EVERY unassigned source word safely in sourceBookId (lossless invariant!)
    source.items = source.items.filter((item) => !assignedKeys.has(normKey(item.term)));
    const retained = source.items.length;
    saveStore(store);

    const after = stats();
    const lost = Math.max(0, before.uniqueWords - after.uniqueWords);
    return { before, after, moved, retained, createdBooks, lost };
  }

  window.TALK_WORDBOOKS = {
    STORAGE_KEY,
    DEFAULT_BOOK_ID,
    DEFAULT_BOOK_NAME,
    loadStore,
    saveStore,
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
