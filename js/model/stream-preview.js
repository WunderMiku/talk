/* ============================================================
   talk. — Incremental streaming JSON preview extractor
   ============================================================ */

export function partialJsonString(text, key) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const match = String(text || "").match(pattern);
  if (!match) return "";
  try { return JSON.parse(`"${match[1]}"`); } catch (_) { return ""; }
}

export function streamPreviewFromJson(text, type, query) {
  if (type === "reverse") {
    let clean = String(text || "").replace(/```[\s\S]*$/, "");
    const open = clean.lastIndexOf("[[");
    if (open !== -1 && clean.indexOf("]]", open) === -1) clean = clean.slice(0, open);
    clean = clean.trim();
    if (!clean) return null;
    return { kind: "reverse", narrative: clean, received: String(text).length };
  }
  if (type === "chunk") return null;
  if (type === "sentence") {
    const translation = partialJsonString(text, "translation");
    const tone = partialJsonString(text, "tone");
    const structure = partialJsonString(text, "structure");
    if (!translation && !tone && !structure) return null;
    return { kind: "sentence", text: query, translation, tone, structure, received: String(text).length };
  }
  const word = partialJsonString(text, "word") || query;
  const phonetic = partialJsonString(text, "phonetic");
  const translation = partialJsonString(text, "translation");
  const short = partialJsonString(text, "short");
  const pos = partialJsonString(text, "pos");
  const senses = Array.from(String(text).matchAll(/"zh"\s*:\s*"((?:\\.|[^"\\])*)"/g))
    .map((match) => { try { return JSON.parse(`"${match[1]}"`); } catch (_) { return ""; } })
    .filter(Boolean)
    .slice(0, 3);
  if (!word && !translation && !short && !senses.length) return null;
  return { kind: "word", word, phonetic, translation, short, pos, senses, received: String(text).length };
}
