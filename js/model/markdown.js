/* ============================================================
   talk. — Reverse-search Markdown & [[expression]] anchor renderer
   Reverse replies are plain Markdown with [[expression]] anchors.
   The renderer runs on every streamed frame, so it has to be cheap
   and tolerate a half-written [[ at the tail.
   ============================================================ */

import { esc, attr } from "../core/utils.js";

export const ANCHOR_TYPES = { s: "sentence", c: "chunk", w: "word" };
export const REVERSE_ANCHOR_RE = /\[\[([^\n]{1,140}?)\]\]/g;

export function reverseAnchorWords(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

export function stripReverseAnchors(text) {
  return String(text || "").replace(REVERSE_ANCHOR_RE, "$1");
}

export function inlineMarkup(text) {
  const slots = [];
  const working = String(text || "").replace(REVERSE_ANCHOR_RE, (_match, expression) => {
    const index = slots.push(String(expression).trim()) - 1;
    return `\u0000${index}\u0000`;
  });
  let html = esc(working);
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  html = html.replace(/\u0000(\d+)\u0000/g, (_match, index) => {
    const expression = slots[Number(index)] || "";
    const cls = reverseAnchorWords(expression) <= 2 ? "is-word" : "is-phrase";
    return `<span class="rev-anchor ${cls}" role="button" tabindex="0" data-action="reverse-anchor" data-text="${attr(expression)}">${esc(expression)}</span>`;
  });
  return html;
}

export function ensureMarkdownAnchors(source) {
  const englishSentence = (text) => {
    const value = String(text || "").trim();
    if (value.length < 8 || /[\u4e00-\u9fff]/.test(value)) return "";
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length < 3 || !/^[A-Za-z"'“(]/.test(value)) return "";
    return value;
  };
  return String(source || "").split("\n").map((line) => {
    if (line.includes("[[") || /^\s*#{1,4}\s/.test(line)) return line;
    const pair = line.match(/^(\s*[-*]\s+)([A-Za-z][^\n—–]{1,90}?)(\s+[—–]\s+)(.+)$/);
    if (pair) return `${pair[1]}[[${pair[2].trim()}]]${pair[3]}${pair[4]}`;
    const solo = line.match(/^(\s*[-*]\s+)([A-Za-z][^\n]{1,140}?[.!?])\s*$/);
    if (solo) return `${solo[1]}[[${solo[2].trim()}]]`;
    const quote = line.match(/^(\s*>\s*)(.+)$/);
    if (quote) {
      const body = englishSentence(quote[2]);
      return body ? `${quote[1]}[[${body}]]` : line;
    }
    const plain = englishSentence(line);
    return plain ? `[[${plain}]]` : line;
  }).join("\n");
}

export function markdownLite(source, final = true) {
  let text = String(source || "").replace(/\r\n/g, "\n");
  if (final) text = ensureMarkdownAnchors(text);
  if (!final) {
    const open = text.lastIndexOf("[[");
    if (open !== -1 && text.indexOf("]]", open) === -1) text = text.slice(0, open);
  }
  const out = [];
  let paragraph = [];
  let quote = [];
  let list = "";
  let listItems = [];
  let code = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${paragraph.join("<br>")}</p>`);
    paragraph = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    out.push(`<blockquote>${quote.map((line) => `<p>${line}</p>`).join("")}</blockquote>`);
    quote = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push(`<${list}>${listItems.join("")}</${list}>`);
    list = "";
    listItems = [];
  };

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (/^```/.test(line)) {
      flushParagraph(); flushQuote(); flushList();
      if (code === null) code = [];
      else { out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`); code = null; }
      continue;
    }
    if (code !== null) { code.push(raw); continue; }
    if (!line.trim()) { flushParagraph(); flushQuote(); flushList(); continue; }
    if (/^ {0,3}([-*_])(?: *\1){2,} *$/.test(line)) {
      flushParagraph(); flushQuote(); flushList();
      out.push('<hr class="rev-rule">');
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph(); flushQuote(); flushList();
      const level = Math.min(6, heading[1].length + 2);
      out.push(`<h${level}>${inlineMarkup(heading[2])}</h${level}>`);
      continue;
    }
    const quoted = line.match(/^>\s?(.*)$/);
    if (quoted) {
      flushParagraph(); flushList();
      quote.push(inlineMarkup(quoted[1]));
      continue;
    }
    const bullets = line.match(/^[-*]\s+(.*)$/);
    if (bullets) {
      flushParagraph(); flushQuote();
      if (list !== "ul") { flushList(); list = "ul"; }
      listItems.push(`<li>${inlineMarkup(bullets[1])}</li>`);
      continue;
    }
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (numbered) {
      flushParagraph(); flushQuote();
      if (list !== "ol") { flushList(); list = "ol"; }
      listItems.push(`<li>${inlineMarkup(numbered[1])}</li>`);
      continue;
    }
    flushList(); flushQuote();
    paragraph.push(inlineMarkup(line));
  }
  if (code !== null) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
  flushParagraph(); flushQuote(); flushList();
  return out.join("");
}
