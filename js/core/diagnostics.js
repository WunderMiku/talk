/* ============================================================
   talk. — Redacted client-side diagnostics trail
   Keep a small, redacted trail of what the model layer actually
   did so a reader can paste it back when something breaks.
   Never store prompts whole: only shapes, sizes and error text.
   ============================================================ */

export const DIAG_KEY = "talk.diagnostics.v1";
export const DIAG_LIMIT = 120;

export function redact(value) {
  let text = typeof value === "string" ? value : JSON.stringify(value || "");
  text = String(text)
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]{6,}/gi, "Bearer ***")
    .replace(/("?(?:apiKey|authorization|token)"?\s*[:=]\s*")([^"]{4,})(")/gi, "$1***$3")
    .replace(/[A-Za-z0-9_-]{32,}/g, "***");
  return text.length > 600 ? text.slice(0, 600) + "…" : text;
}

export function diagLog(level, code, message, meta = {}) {
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

export function formatDiagText({ version = "?", model = "", baseUrl = "", lastModelRaw = null } = {}) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(DIAG_KEY) || "[]"); } catch (_) { list = []; }
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "node";
  const head = [
    `talk ${version} · ${ua}`,
    `time ${new Date().toISOString()}`,
    `model ${redact(model)} · ${redact(baseUrl)}`
  ].join("\n");
  const body = list
    .map((e) => `${e.at} ${e.level.toUpperCase()} ${e.code} · ${e.message}${e.meta && e.meta !== "{}" ? " · " + e.meta : ""}`)
    .join("\n");
  const rawBlock = lastModelRaw
    ? `\n\n--- last model reply (${lastModelRaw.type} · ${lastModelRaw.detail} · ${lastModelRaw.chars} chars${lastModelRaw.cut ? ", truncated" : ""}) ---\n${redact(lastModelRaw.text)}`
    : "";
  return head + "\n" + body + rawBlock;
}

export function installGlobalErrorLogging() {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (event) =>
    diagLog("error", "window", event.message || "script error", { source: event.filename, line: event.lineno })
  );
  window.addEventListener("unhandledrejection", (event) => {
    const message = event.reason?.message || String(event.reason || "");
    // Starting a new view transition aborts the previous one; that rejection is
    // expected and would otherwise drown the diagnostics in noise.
    if (/Transition was (skipped|aborted)/i.test(message)) return;
    diagLog("error", "promise", message);
  });
}
