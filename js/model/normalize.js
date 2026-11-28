/* ============================================================
   talk. — Pure model payload normalizers (word / chunk / sentence)
   Keeps schema normalization deterministic and directly unit-testable.
   ============================================================ */

import { asArray, normalizeChunk, normalizeStrings, normalizeWord, posAbbr } from "../core/utils.js";

// Model sometimes echoes a parameter value (e.g. "standard") instead of the requested word.
// Only that narrow mistake is treated as a hallucination; inflections and irregular forms
// (went -> go, mice -> mouse) are legitimate answers and must pass.
export const PARAM_WORDS = new Set(["standard", "detail", "fast", "deep", "word", "query", "json", "english", "chinese"]);

export function isHallucinatedWord(returnedWord, requestedWord) {
  const got = normalizeWord(returnedWord);
  const req = normalizeWord(requestedWord);
  if (!got || !req || got === req) return false;
  return PARAM_WORDS.has(got) && !PARAM_WORDS.has(req);
}

export const PROTECTED_SPELLING = new Set([
  "google", "standard", "apple", "amazon", "microsoft", "openai", "qwen",
  "deepseek", "github", "android", "iphone", "chatgpt", "twitter", "youtube"
]);

export const CHUNK_FORMS = ["idiom", "phrasal-verb", "collocation", "chunk-skeleton"];
export const STRUCTURE_KINDS = ["main", "clause", "phrase", "modifier"];
export const SEGMENT_ROLES = ["theme", "rheme", "focus", "modifier"];
export const SEGMENT_ROLE_LABELS = { theme: "起点", rheme: "推进", focus: "焦点", modifier: "背景" };

export function unwrapModel(raw) {
  if (!raw || typeof raw !== "object") return {};
  if (raw.data && typeof raw.data === "object") return raw.data;
  if (raw.result && typeof raw.result === "object") return raw.result;
  return raw;
}

export function normalizeSpelling(value, fallbackWord = "") {
  if (!value || typeof value !== "object") return null;
  const input = String(value.input || value.query || "").trim();
  const corrected = String(value.corrected || value.correction || value.word || fallbackWord || "").trim();
  if (!input || !corrected) return null;
  // Multi-word input is a phrase/idiom, never a spelling mistake.
  if (/\s/.test(input.trim())) return null;
  const changed = value.changed !== undefined
    ? Boolean(value.changed)
    : normalizeWord(input) !== normalizeWord(corrected);
  const inputKey = normalizeWord(input);
  if (!changed || inputKey === normalizeWord(corrected)) return null;
  const confidence = Number(value.confidence || 0);
  if (PROTECTED_SPELLING.has(inputKey)) return null;
  return {
    input,
    corrected,
    confidence,
    note: String(value.note || value.reason || "").trim()
  };
}

export function localizeTimelineWhen(value) {
  const text = String(value || "").trim();
  if (!text || /[\u3400-\u9fff]/.test(text)) return text;
  const lower = text.toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  const map = {
    "old english": "古英语时期",
    "middle english": "中古英语时期",
    "early modern english": "早期现代英语",
    "modern english": "现代英语",
    "ancient greek": "古希腊时期",
    "latin": "拉丁语时期",
    "old norse": "古诺斯语时期",
    "proto germanic": "原始日耳曼语时期",
    "today": "今天",
    "present": "今天",
    "now": "今天"
  };
  if (map[lower]) return map[lower];
  let match = lower.match(/^(early|mid|late)?\s*(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+century$/);
  if (match) {
    const prefix = match[1] === "early" ? "早期" : match[1] === "mid" ? "中期" : match[1] === "late" ? "晚期" : "";
    return `${match[2]} 世纪${prefix}`;
  }
  match = lower.match(/^(?:c\.?\s*)?(\d{3,4})$/);
  if (match) return `${match[1]} 年`;
  match = lower.match(/^(?:before|prior to)\s+(\d{3,4})$/);
  if (match) return `${match[1]} 年以前`;
  match = lower.match(/^(\d{3,4})\s*[-–—]\s*(\d{3,4})$/);
  if (match) return `${match[1]}–${match[2]} 年`;
  return text;
}

export function normalizeOrigin(value) {
  if (!value || typeof value !== "object") return null;
  const stages = asArray(value.stages).map((stage) => ({
    when: localizeTimelineWhen(stage.when || stage.time || stage.period || ""),
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

export function normalizeSenses(value) {
  return asArray(value).map((item) => {
    if (typeof item === "string") return { en: item, zh: "", tag: "" };
    return {
      en: String(item.en || item.definition || item.meaning || ""),
      zh: String(item.zh || item.translation || item.meaningZh || ""),
      tag: String(item.tag || item.label || "")
    };
  }).filter((item) => item.en || item.zh);
}

export function normalizePosGroups(value, fallbackPos, fallbackSenses) {
  const groups = asArray(value).map((item) => {
    if (!item || typeof item !== "object") return null;
    const senses = normalizeSenses(item.senses || item.meanings || item.definitions);
    if (!senses.length) return null;
    return {
      pos: String(item.pos || item.partOfSpeech || "").trim().toLowerCase(),
      senses
    };
  }).filter(Boolean);
  if (!groups.length) {
    groups.push({ pos: String(fallbackPos || "").trim().toLowerCase(), senses: fallbackSenses });
  }
  const wanted = String(fallbackPos || "").trim().toLowerCase();
  const mainIndex = groups.findIndex((group) => group.pos === wanted);
  if (mainIndex > 0) {
    const [main] = groups.splice(mainIndex, 1);
    groups.unshift(main);
  }
  return groups;
}

export function normalizeRelations(value) {
  return asArray(value).map((item) => {
    if (typeof item === "string") return { word: item, pos: "", gloss: "" };
    return {
      word: String(item.word || item.term || item.text || ""),
      pos: posAbbr(item.pos || item.partOfSpeech || ""),
      gloss: String(item.gloss || item.meaning || item.definition || item.nuance || ""),
      zh: String(item.zh || item.glossZh || item.meaningZh || item.translation || "")
    };
  }).filter((item) => item.word);
}

export function normalizeExample(item) {
  if (!item) return null;
  if (typeof item === "string") return { en: item, zh: "", source: "" };
  return {
    en: String(item.en || item.sentence || item.text || item.example || ""),
    zh: String(item.zh || item.translation || ""),
    source: String(item.source || "")
  };
}

export function normalizeExamples(value) {
  return asArray(value).map((item) => normalizeExample(item)).filter((item) => item?.en);
}

export function normalizeExamplesByTheme(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const [id, list] of Object.entries(value)) {
    const examples = normalizeExamples(list);
    if (examples.length) out[id] = examples;
  }
  return Object.keys(out).length ? out : null;
}

export function normalizeKeyWords(value) {
  return asArray(value).map((item) => {
    if (typeof item === "string") {
      return {
        word: item,
        surface: item,
        phonetic: "",
        pos: "",
        meaning: "",
        why: "",
        level: "",
        sentenceIndex: 0,
        family: [],
        synonyms: [],
        antonyms: [],
        example: null,
        externalExample: null
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
      level: String(item.level || item.stage || "").trim().toLowerCase(),
      sentenceIndex: Number.isFinite(Number(item.sentenceIndex)) ? Number(item.sentenceIndex) : 0,
      family: normalizeRelations(item.family || item.derivatives),
      synonyms: normalizeRelations(item.synonyms),
      antonyms: normalizeRelations(item.antonyms),
      example: normalizeExample(example),
      externalExample: normalizeExample(item.externalExample || item.outsideExample || item.extraExample)
    };
  }).filter((item) => item.word);
}

/* The sentence tree is model-authored. The client only normalises it so a
   partial or malformed tree still renders, and so a future node kind can be
   added without breaking old data. */
export function normalizeStructureNodes(value, depth = 0, out = { count: 0 }) {
  if (!Array.isArray(value) || depth > 4) return [];
  return value.map((node, index) => {
    if (!node || typeof node !== "object") return null;
    const text = String(node.text || node.en || "").trim();
    if (!text) return null;
    out.count += 1;
    const kind = STRUCTURE_KINDS.includes(node.kind) ? node.kind : (depth === 0 ? "main" : "clause");
    const children = normalizeStructureNodes(node.children || node.items, depth + 1, out);
    return {
      id: String(node.id || `n${depth}-${index}`),
      kind,
      depth,
      anchor: String(node.anchor || node.attachAfter || "").trim(),
      label: String(node.label || node.role || "").trim(),
      text,
      role: String(node.role || node.function || "").trim(),
      gloss: String(node.gloss || node.meaningZh || node.zh || "").trim(),
      note: String(node.note || node.explain || "").trim(),
      children
    };
  }).filter(Boolean);
}

export function normalizeStructureTree(value) {
  if (!value) return [];
  if (Array.isArray(value)) return normalizeStructureNodes(value);
  if (typeof value !== "object") return [];
  const nodes = value.tree || value.nodes || value.root;
  if (Array.isArray(nodes)) return normalizeStructureNodes(nodes);
  if (nodes && typeof nodes === "object") return normalizeStructureNodes([nodes]);
  return [];
}

export function splitSentences(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return [];
  const ABBR = /^(mr|mrs|ms|dr|prof|st|jr|sr|vs|etc|e\.g|i\.e|fig|no|approx|dept|est|al)$/i;
  const edges = /[.!?。！？…]["”’')」』]?$/;
  const mergePiece = (prev, next) => {
    if (!prev) return next;
    const bare = prev.replace(/[)"”’」』]+$/, "");
    const lastWord = (bare.split(/[\s(]/).pop() || "").replace(/\.$/, "");
    if (ABBR.test(lastWord)) return `${prev} ${next}`;
    if (/^[A-Z]$/.test(lastWord)) return `${prev} ${next}`;
    if (!edges.test(bare)) return `${prev} ${next}`;
    return null;
  };
  const collect = (input) => {
    try {
      if (typeof Intl !== "undefined" && Intl.Segmenter) {
        const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
        return [...segmenter.segment(input)].map((item) => item.segment.trim()).filter(Boolean);
      }
    } catch (_) { /* fall through to the regex */ }
    return input.split(/(?<=[.!?。！？…])\s+|(?<=[。！？])/).map((item) => item.trim()).filter(Boolean);
  };
  const merged = [];
  collect(value).forEach((piece) => {
    if (!merged.length) { merged.push(piece); return; }
    const joined = mergePiece(merged[merged.length - 1], piece);
    if (joined) merged[merged.length - 1] = joined;
    else merged.push(piece);
  });
  return merged.map((item) => item.trim()).filter(Boolean).slice(0, 8);
}

export function normalizeContrast(value) {
  if (!value || typeof value !== "object" || !value.text) return null;
  return {
    label: String(value.label || "结构对照").trim(),
    text: String(value.text).trim(),
    zh: String(value.zh || "").trim()
  };
}

export function normalizeSegments(value, text = "") {
  const source = String(text || "").trim();
  if (!Array.isArray(value) || !source) return [];
  const items = value.map((item) => ({
    text: String(item?.text ?? ""),
    role: SEGMENT_ROLES.includes(item?.role) ? item.role : "rheme",
    gloss: String(item?.gloss || "").trim(),
    chunk: String(item?.chunk || "").trim()
  })).filter((item) => item.text.trim());
  // A one-word function segment ("was", "is", "of") makes a stub of a rule;
  // fold it into its neighbour so the tray always carries a phrase.
  const LONE_FUNCTION = /^(is|am|are|was|were|be|been|being|do|does|did|has|have|had|will|would|can|could|may|might|must|shall|should|of|to|in|on|at|by|for|with|and|but|or|so|that|which|who)$/i;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!LONE_FUNCTION.test(String(item.text).trim())) continue;
    if (index > 0) {
      items[index - 1].text += item.text;
      items.splice(index, 1);
    } else if (items.length > 1) {
      items[1].text = item.text + items[1].text;
      items.splice(0, 1);
    }
  }
  if (items.length < 1 || items.length > 6) return [];
  const squeeze = (val) => String(val).replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  const tail = (source.match(/[.!?…]+$/) || [""])[0];
  const body = tail ? source.slice(0, -tail.length) : source;
  const joined = squeeze(items.map((item) => item.text).join(""));
  if (joined === squeeze(source)) return items;
  if (joined !== squeeze(body)) return [];
  if (tail) items[items.length - 1].text += tail;
  return items;
}

export function normalizeSentenceParts(value) {
  if (!Array.isArray(value)) return [];
  return value.map((part) => {
    const text = String(part?.text || part?.sentence || "").trim();
    const index = Number.isInteger(part?.index) ? part.index : null;
    if (!text && index === null) return null;
    return {
      text,
      index,
      translation: String(part.translation || "").trim(),
      summary: String(part.summary || "").trim(),
      tree: normalizeStructureTree(part.tree || part.structure),
      segments: normalizeSegments(part.segments, text),
      orderNote: String(part.orderNote || part.order_note || "").trim(),
      contrast: normalizeContrast(part.contrast),
      keyWords: normalizeKeyWords(part.keyWords || part.key_words || part.words)
    };
  }).filter(Boolean);
}

export function alignSentenceParts(parts, pieces) {
  if (!pieces.length) return parts;
  const byText = new Map();
  parts.forEach((part, index) => {
    const key = normalizeWord(part.text);
    if (key && !byText.has(key)) byText.set(key, part);
    if (index < pieces.length && !byText.has(normalizeWord(pieces[index]))) byText.set(normalizeWord(pieces[index]), part);
  });
  return pieces.map((text, index) => {
    const key = normalizeWord(text);
    const hit = byText.get(key)
      || parts.find((part) => part.index === index || part.index === index + 1)
      || parts[index]
      || null;
    const matches = hit && (!hit.text || normalizeWord(hit.text) === key);
    return {
      text,
      translation: matches ? hit.translation || "" : "",
      summary: matches ? hit.summary || "" : "",
      tree: matches ? hit.tree || [] : [],
      segments: matches ? hit.segments || [] : [],
      orderNote: matches ? hit.orderNote || "" : "",
      contrast: matches ? hit.contrast || null : null,
      keyWords: matches ? hit.keyWords || [] : [],
      incomplete: Boolean(hit && !matches)
    };
  });
}

export function normalizeModelWord(raw, fallbackWord) {
  const base = unwrapModel(raw);
  const senses = normalizeSenses(base.senses);
  const posGroups = normalizePosGroups(base.posGroups, base.pos || base.partOfSpeech, senses);
  const mainGroup = posGroups[0] || { pos: "", senses };
  const mainSenses = mainGroup.senses.length ? mainGroup.senses : senses;
  const first = mainSenses[0] || {};
  const word = String(base.word || base.headword || fallbackWord || "").trim().toLowerCase();
  if (!word) throw new Error("模型返回的内容里没有词头。");
  const result = {
    word,
    phonetic: String(base.phonetic || base.ipa || ""),
    pos: String(base.pos || base.partOfSpeech || mainGroup.pos || ""),
    level: String(base.level || "—"),
    register: String(base.register || "common"),
    short: String(base.short || base.definition || first.en || ""),
    translation: String(base.translation || first.zh || ""),
    note: String(base.note || base.usageNote || ""),
    senses: mainSenses.length ? mainSenses : [{ en: String(base.definition || ""), zh: String(base.translation || ""), tag: "" }],
    posGroups,
    family: normalizeRelations(base.family || base.derivatives),
    synonyms: normalizeRelations(base.synonyms),
    antonyms: normalizeRelations(base.antonyms),
    examples: normalizeExamples(base.examples),
    examplesByTheme: normalizeExamplesByTheme(base.examplesByTheme || base.examples_by_theme),
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

export function normalizeModelSentence(raw, fallbackSentence) {
  const base = unwrapModel(raw);
  const text = String(base.text || base.sentence || fallbackSentence || "").trim();
  let keyWords = normalizeKeyWords(base.keyWords || base.key_words || base.words);
  const sentences = normalizeSentenceParts(base.sentences || base.parts);
  if (sentences.length) {
    const bySentence = new Map();
    keyWords.forEach((item) => {
      const index = Number(item.sentenceIndex) || 0;
      if (!index) return;
      if (!bySentence.has(index)) bySentence.set(index, []);
      bySentence.get(index).push(item);
    });
    sentences.forEach((part, index) => {
      if (!part.keyWords?.length) part.keyWords = bySentence.get(index + 1) || bySentence.get(part.index || -1) || [];
    });
  }
  if (!keyWords.length && sentences.length) {
    const seen = new Set();
    keyWords = sentences.flatMap((part, index) => part.keyWords.map((item) => ({ ...item, sentenceIndex: index })))
      .filter((item) => {
        const key = `${normalizeWord(item.word)}:${item.sentenceIndex}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 12);
  }
  if (!text) throw new Error("模型返回的内容里没有原句。");
  const joinedTranslation = sentences.map((part) => part.translation).filter(Boolean).join(" ");
  // A sentence with no key words is still a valid page (short or plain
  // sentences happen); only a missing sentence is fatal.
  return {
    id: `model-${Date.now()}`,
    text,
    translation: String(base.translation || joinedTranslation || ""),
    tone: String(base.tone || ""),
    structure: typeof base.structure === "string" ? base.structure : String(base.structure?.note || ""),
    summary: String(base.summary || base.gist || "").trim(),
    syntax: String(base.syntax || "").trim(),
    segments: normalizeSegments(base.segments, text),
    orderNote: String(base.orderNote || base.order_note || "").trim(),
    contrast: normalizeContrast(base.contrast),
    tree: normalizeStructureTree(base.tree || base.structureTree || (base.structure && base.structure.tree)),
    sentences,
    keyWords,
    source: "语境分析",
    sourceType: "model"
  };
}

export function ensureChunk(raw) {
  if (!raw) return null;
  const chunk = normalizeChunk(raw.chunk || raw.query || raw.word || "");
  if (!chunk) return null;
  const form = CHUNK_FORMS.includes(raw.form) ? raw.form : "collocation";
  const senses = (Array.isArray(raw.senses) ? raw.senses : [])
    .map((sense) => ({
      zh: String(sense?.zh || sense?.translation || "").trim(),
      en: String(sense?.en || sense?.definition || "").trim(),
      when: String(sense?.when || sense?.usage || "").trim()
    }))
    .filter((sense) => sense.zh || sense.en)
    .slice(0, 3);
  const keyWords = (Array.isArray(raw.keyWords) ? raw.keyWords : [])
    .map((item) => ({
      word: String(item?.word || "").trim(),
      pos: posAbbr(item?.pos),
      gloss: String(item?.gloss || item?.zh || "").trim(),
      why: String(item?.why || "").trim()
    }))
    .filter((item) => item.word && chunk.includes(item.word.toLowerCase()))
    .slice(0, 2);
  const example = (value) => {
    if (!value || (!value.en && !value.zh)) return null;
    return { en: String(value.en || "").trim(), zh: String(value.zh || "").trim() };
  };
  const slots = (Array.isArray(raw.slots) ? raw.slots : [])
    .map((item) => ({
      slot: String(item?.slot || "").trim(),
      role: String(item?.role || item?.why || "").trim(),
      example: example(item?.example)
    }))
    .filter((item) => item.slot)
    .slice(0, 3);
  const variants = (Array.isArray(raw.variants) ? raw.variants : [])
    .map((item) => ({
      form: String(item?.form || "").trim(),
      example: example(item?.example)
    }))
    .filter((item) => item.form)
    .slice(0, 3);
  const origin = raw.origin && (raw.origin.story || raw.origin.era)
    ? { story: String(raw.origin.story || "").trim(), era: String(raw.origin.era || "").trim() }
    : null;
  return {
    kind: "chunk",
    chunk,
    form,
    phonetic: String(raw.phonetic || "").trim(),
    translation: String(raw.translation || senses[0]?.zh || "").trim(),
    short: String(raw.short || senses[0]?.en || "").trim(),
    register: String(raw.register || "neutral").trim(),
    note: String(raw.note || "").trim(),
    senses,
    keyWords,
    slots,
    variants,
    origin,
    examples: normalizeExamples(raw.examples).slice(0, 4),
    cached: Boolean(raw.cached),
    source: raw.source || ""
  };
}

export function ensureWord(raw) {
  if (!raw) return null;
  const senses = Array.isArray(raw.senses) && raw.senses.length
    ? raw.senses.map((sense) => ({
        en: String(sense.en || sense.definition || sense.meaning || ""),
        zh: String(sense.zh || sense.translation || ""),
        tag: String(sense.tag || "")
      }))
    : [{ en: String(raw.short || raw.definition || ""), zh: String(raw.translation || ""), tag: "" }];
  const posGroups = normalizePosGroups(raw.posGroups, raw.pos || raw.partOfSpeech, senses);
  const mainGroup = posGroups[0] || { pos: "", senses };
  const mainSenses = mainGroup.senses.length ? mainGroup.senses : senses;

  return {
    ...raw,
    word: String(raw.word || ""),
    phonetic: String(raw.phonetic || raw.ipa || ""),
    pos: String(raw.pos || raw.partOfSpeech || mainGroup.pos || ""),
    level: String(raw.level || "—"),
    register: String(raw.register || "common"),
    short: String(raw.short || mainSenses[0]?.en || ""),
    translation: String(raw.translation || mainSenses[0]?.zh || ""),
    note: String(raw.note || ""),
    senses: mainSenses,
    posGroups,
    family: normalizeRelations(raw.family || raw.derivatives),
    synonyms: normalizeRelations(raw.synonyms),
    antonyms: normalizeRelations(raw.antonyms),
    examples: normalizeExamples(raw.examples),
    examplesByTheme: normalizeExamplesByTheme(raw.examplesByTheme || raw.examples_by_theme),
    collocations: normalizeStrings(raw.collocations),
    related: normalizeStrings(raw.related),
    origin: normalizeOrigin(raw.origin || raw.etymology),
    spelling: normalizeSpelling(raw.spelling, raw.word),
    source: raw.source || "demo",
    cached: Boolean(raw.cached),
    model: raw.model || ""
  };
}

export function ensureSentence(raw) {
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
    summary: String(raw.summary || raw.gist || "").trim(),
    syntax: String(raw.syntax || "").trim(),
    segments: normalizeSegments(raw.segments, String(raw.text || raw.sentence || "")),
    orderNote: String(raw.orderNote || raw.order_note || "").trim(),
    contrast: normalizeContrast(raw.contrast),
    tree: normalizeStructureTree(raw.tree || raw.structureTree || (raw.structure && raw.structure.tree)),
    sentences: normalizeSentenceParts(raw.sentences || raw.parts),
    keyWords,
    sourceType: raw.sourceType || raw.source || "demo",
    model: raw.model || ""
  };
}
