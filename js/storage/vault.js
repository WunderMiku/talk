/* ============================================================
   talk. — AES-GCM API key vault (js/storage/vault.js)
   API keys are never written as plain text when WebCrypto is available.
   A non-extractable AES-GCM key lives in IndexedDB (it cannot be read
   back out), and the settings blob stores only ciphertext. This keeps
   keys out of a casual devtools/localStorage inspection and out of
   storage backups; it is not a defence against someone who can run code
   in this origin, because the page itself can decrypt.
   ============================================================ */

const VAULT_DB_NAME = "talk.vault.v1";
const VAULT_STORE = "keys";
const VAULT_KEY_ID = "api-key-wrap";

export const SEAL_PREFIX = "sealed:v1:";

const vault = { db: null, key: null, broken: false };

export function canSeal() {
  return Boolean(typeof window !== "undefined" && window.crypto?.subtle && window.idb?.openDB && "indexedDB" in window);
}

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

export async function sealText(text) {
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

export async function unsealText(value) {
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

export async function unlockSettingsKeys(settings, activeProfileFn) {
  if (!canSeal() || !settings) return;
  settings.apiKey = await unsealText(settings.apiKey);
  for (const profile of settings.profiles || []) {
    profile.apiKey = await unsealText(profile.apiKey);
  }
  const active = typeof activeProfileFn === "function" ? activeProfileFn(settings) : null;
  if (active) settings.apiKey = active.apiKey || "";
}
