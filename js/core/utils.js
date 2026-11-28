/* ============================================================
   talk. — Core DOM, text, normalization & formatting utilities
   ============================================================ */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function attr(value) {
  return esc(value).replace(/`/g, "&#96;");
}

export function rich(value) {
  return esc(value)
    .replace(/&lt;em&gt;/gi, "<em>")
    .replace(/&lt;\/em&gt;/gi, "</em>");
}

export function shorten(value, length) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s.length > length ? `${s.slice(0, length).trim()}…` : s;
}

export function sanitizeQuery(value) {
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

export function normalizeWord(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[.,!?;:]+$/g, "")
    .replace(/\s+/g, " ");
}

export function normalizeSentence(value) {
  return String(value ?? "")
    .trim()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function normalizeChunk(value) {
  let query = String(value ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  query = query.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  return query.toLowerCase();
}

export function chunkSlug(value) {
  return normalizeChunk(value).replace(/\s+/g, "+");
}

export function chunkFromSlug(slug) {
  let raw = String(slug || "");
  try {
    raw = decodeURIComponent(raw);
  } catch (_) {
    /* keep the raw slug */
  }
  return normalizeChunk(raw.replace(/\+/g, " "));
}

export function hasCJK(value) {
  return /[\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(String(value || ""));
}

export function detectSourceLanguage(text) {
  const source = String(text || "");
  const chinese = (source.match(/[\u3400-\u9fff]/g) || []).length;
  const latin = (source.match(/[A-Za-z]/g) || []).length;
  return chinese > 0 && chinese * 2 >= latin ? "zh" : "en";
}

export function hashText(value) {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function countWords(value) {
  return String(value || "").split(/\s+/).filter(Boolean).length;
}

// 三范式分流：中文/情境描述 → 语境寻词；单词 → 词；完整句 → 句子；
// 其余 2-5 个词、无句末标点 → 意群。启发式，不引入 NLP；手动 chip 可覆盖。
export function detectParadigm(value) {
  const query = sanitizeQuery(value);
  if (!query) return "word";
  if (hasCJK(query)) return "reverse";
  if (/^(how (?:do|can|could|would) (?:you|i|we) (?:say|express|put)|what(?:'s| is) the (?:word|phrase|english) for|how to say)/i.test(query)) {
    return "reverse";
  }
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return "word";
  if (/[.!?…]$/.test(query) || words.length >= 6) return "sentence";
  return "chunk";
}

export function detectType(value) {
  const paradigm = detectParadigm(value);
  return paradigm === "chunk" ? "word" : paradigm === "reverse" ? "sentence" : paradigm;
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function tapFeedback() {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try { navigator.vibrate(7); } catch (_) { /* no-op */ }
  }
}

export function blockHead(index, title, note = "") {
  return `
      <div class="block-head">
        <span class="block-index">${esc(index)}</span>
        <h2>${esc(title)}</h2>
        <span class="rule"></span>
        ${note ? `<span class="block-note">${esc(note)}</span>` : ""}
      </div>`;
}

export function letterTitle(value) {
  const chars = Array.from(String(value ?? ""));
  return chars.map((char, i) => {
    if (char === " ") return `<span class="letter" style="--i:${i}">&nbsp;</span>`;
    return `<span class="letter" style="--i:${i}">${esc(char)}</span>`;
  }).join("");
}

export function highlightPlain(text, term) {
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

export function timeAgo(ts) {
  if (!ts) return "已保存";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function titleCase(value) {
  const s = String(value ?? "");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function registerLabel(value) {
  const key = String(value || "").toLowerCase();
  return ({
    common: "常用",
    neutral: "通用",
    spoken: "口语",
    slang: "俚语",
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
export const POS_ABBREVIATIONS = {
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

export function posAbbr(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parts = raw.split(/\s*[/、,·]\s*|\s+or\s+|\s+and\s+/i).map((part) => part.trim()).filter(Boolean);
  const mapped = parts.map((part) => POS_ABBREVIATIONS[part.toLowerCase().replace(/\.$/, "")] || POS_ABBREVIATIONS[part] || "");
  if (!mapped.length || mapped.some((item) => !item)) return raw;
  return [...new Set(mapped)].join(" / ");
}

export function posLabel(value) {
  return posAbbr(value) || "—";
}

export function tagLabel(value) {
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

export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

export function normalizeStrings(value) {
  return asArray(value).map((item) => {
    if (typeof item === "string") return item;
    return String(item.word || item.text || item.value || "");
  }).filter(Boolean);
}

export function secureRemoteUrl(url) {
  const value = String(url || "");
  if (typeof location !== "undefined" && location.protocol === "https:" && /^http:\/\//i.test(value)) {
    return value.replace(/^http:\/\//i, "https://");
  }
  return value;
}

export async function copyText(text) {
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
