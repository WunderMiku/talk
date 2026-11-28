/* ============================================================
   talk. — Unified IndexedDB Key-Value Store (with zero-loss
   localStorage migration & synchronous in-memory read mirror)
   ============================================================ */

export const KV_DB_NAME = "talk.kv.v1";
export const KV_DB_STORE = "kv";

const mem = new Map();
const writeChains = new Map();
let kvDb = null;
let idbReady = false;
let fallbackMode = false;
let storagePersisted = null;

function openRawDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(KV_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV_DB_STORE)) {
        db.createObjectStore(KV_DB_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function rawGetAll(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_DB_STORE, "readonly");
    const req = tx.objectStore(KV_DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function rawPut(db, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_DB_STORE, "readwrite");
    tx.objectStore(KV_DB_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function rawDelete(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_DB_STORE, "readwrite");
    tx.objectStore(KV_DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function readLegacyJson(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { found: false, value: null };
    return { found: true, value: JSON.parse(raw) };
  } catch (_) {
    return { found: false, value: null };
  }
}

function writeFallbackJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    /* storage can be full */
  }
}

function queueDbOp(key, op) {
  const prev = writeChains.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(op).finally(() => {
    if (writeChains.get(key) === next) writeChains.delete(key);
  });
  writeChains.set(key, next);
  return next;
}

export async function requestPersistentStorage() {
  try {
    if (navigator?.storage?.persisted) {
      const already = await navigator.storage.persisted();
      if (already) {
        storagePersisted = true;
        return true;
      }
    }
    if (navigator?.storage?.persist) {
      storagePersisted = Boolean(await navigator.storage.persist());
      return storagePersisted;
    }
  } catch (_) {
    /* ignore */
  }
  return false;
}

export async function initKvStore(legacyKeys = []) {
  if (idbReady) return true;
  if (typeof indexedDB === "undefined") {
    fallbackMode = true;
    return false;
  }
  try {
    if (window.idb?.openDB) {
      kvDb = await window.idb.openDB(KV_DB_NAME, 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(KV_DB_STORE)) {
            db.createObjectStore(KV_DB_STORE, { keyPath: "key" });
          }
        }
      });
      const rows = await kvDb.getAll(KV_DB_STORE);
      for (const row of rows) {
        if (row?.key) mem.set(row.key, row.value);
      }
    } else {
      const rawDb = await openRawDb();
      kvDb = {
        __raw: rawDb,
        put: (_store, record) => rawPut(rawDb, record),
        delete: (_store, key) => rawDelete(rawDb, key)
      };
      const rows = await rawGetAll(rawDb);
      for (const row of rows) {
        if (row?.key) mem.set(row.key, row.value);
      }
    }

    // One-time zero-loss migration from localStorage -> IndexedDB.
    for (const key of legacyKeys) {
      if (!key) continue;
      const legacy = readLegacyJson(key);
      if (!legacy.found) continue;
      if (!mem.has(key)) {
        mem.set(key, legacy.value);
        await kvDb.put(KV_DB_STORE, { key, value: legacy.value, updatedAt: Date.now() });
      }
      // Remove legacy localStorage blob only after IndexedDB write succeeded.
      try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
    }

    idbReady = true;
    fallbackMode = false;
    void requestPersistentStorage();
    return true;
  } catch (error) {
    console.warn("IndexedDB KV store unavailable; using localStorage fallback.", error);
    kvDb = null;
    idbReady = false;
    fallbackMode = true;
    return false;
  }
}

export function kvGet(key, fallbackValue = null) {
  if (idbReady) {
    return mem.has(key) ? mem.get(key) : fallbackValue;
  }
  const legacy = readLegacyJson(key);
  return legacy.found && legacy.value !== null && legacy.value !== undefined
    ? legacy.value
    : fallbackValue;
}

export function kvSet(key, value) {
  if (!key) return;
  mem.set(key, value);
  if (idbReady && kvDb) {
    void queueDbOp(key, async () => {
      try {
        await kvDb.put(KV_DB_STORE, { key, value, updatedAt: Date.now() });
      } catch (error) {
        console.warn("IndexedDB KV put failed:", key, error);
      }
    });
    return;
  }
  writeFallbackJson(key, value);
}

export function kvDelete(key) {
  if (!key) return;
  mem.delete(key);
  if (idbReady && kvDb) {
    void queueDbOp(key, async () => {
      try { await kvDb.delete(KV_DB_STORE, key); } catch (_) { /* ignore */ }
    });
  }
  try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
}

export async function kvFlush() {
  if (!writeChains.size) return;
  await Promise.allSettled([...writeChains.values()]);
}

export function kvBackend() {
  return idbReady ? "IndexedDB" : "localStorage";
}

export function kvStats() {
  let bytes = 0;
  for (const value of mem.values()) {
    try { bytes += JSON.stringify(value).length; } catch (_) { /* ignore */ }
  }
  return {
    backend: kvBackend(),
    keys: mem.size,
    bytes,
    fallback: fallbackMode
  };
}

export async function getStorageEstimate() {
  try {
    const est = navigator?.storage?.estimate ? await navigator.storage.estimate() : null;
    const persisted = storagePersisted !== null
      ? storagePersisted
      : (navigator?.storage?.persisted ? Boolean(await navigator.storage.persisted()) : false);
    return {
      usage: Number(est?.usage) || 0,
      quota: Number(est?.quota) || 0,
      persisted
    };
  } catch (_) {
    return { usage: 0, quota: 0, persisted: false };
  }
}
