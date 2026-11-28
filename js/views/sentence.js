/* ============================================================
   talk. — Sentence analysis view, structure tree, onion clauses & actions
   ============================================================ */

import {
  $,
  $$,
  esc,
  attr,
  chunkSlug,
  escapeRegExp,
  tapFeedback,
  blockHead,
  highlightPlain,
  posAbbr,
  posLabel
} from "../core/utils.js";
import { icon } from "../core/icons.js";
import { SEGMENT_ROLE_LABELS } from "../model/normalize.js";
import { reclassifyRow } from "./status.js";
import { relationGloss } from "./word.js";

export function treeKindLabel(kind) {
  return ({ main: "主干", clause: "从句", phrase: "短语", modifier: "修饰" })[kind] || "结构";
}

export function registerTreeNodes(nodes, bucket) {
  (nodes || []).forEach((node) => {
    bucket[node.id] = node;
    registerTreeNodes(node.children, bucket);
  });
  return bucket;
}

export function segmentRole(role) {
  return SEGMENT_ROLE_LABELS[role] || "推进";
}

function tidyClauseText(text) {
  return String(text || "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])(\s*[,;:])+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function hoistDetached(nodes, depth = 1, out = []) {
  (Array.isArray(nodes) ? nodes : []).forEach((node) => {
    if (!node || !node.text) return;
    node.__depth = depth;
    const kids = Array.isArray(node.children) ? node.children : [];
    const inside = [];
    const detached = [];
    kids.forEach((child) => {
      if (!child || !child.text) return;
      (String(node.text).includes(child.text) ? inside : detached).push(child);
    });
    node.children = inside;
    out.push(node);
    hoistDetached(detached, depth + 1, out);
  });
  return out;
}

export function createSentenceView({
  state,
  data,
  backTopbar,
  layerTopbar,
  isSavedKey,
  hasModelConfig,
  openSheetShell,
  cacheGetChunk,
  navigate,
  runSearch,
  getActiveSurface,
  sentenceLevelOf,
  sentenceKey,
  removeSentenceRecord,
  clearSentenceCache,
  hydrateSentenceLayer,
  closeTopWordLayer,
  toast
}) {
  function annotateSentence(text, keyWords) {
    const items = keyWords
      .map((keyWord, index) => ({
        index,
        surface: String(keyWord.surface || keyWord.word || ""),
        word: String(keyWord.word || keyWord.surface || ""),
        tip: String(keyWord.meaningZh || keyWord.meaning || "").slice(0, 46)
      }))
      .filter((item) => item.surface)
      .sort((a, b) => b.surface.length - a.surface.length);

    if (!items.length) return esc(text);
    let re;
    try {
      re = new RegExp(items.map((item) => escapeRegExp(item.surface)).join("|"), "gi");
    } catch (_) {
      return esc(text);
    }

    let out = "";
    let last = 0;
    for (const match of text.matchAll(re)) {
      out += esc(text.slice(last, match.index));
      const matched = items.find((item) => item.surface.toLowerCase() === match[0].toLowerCase()) || items[0];
      out += `<button class="kw" type="button" data-action="open-key" data-index="${matched.index}"${matched.tip ? ` data-tip="${attr(matched.tip)}"` : ""} aria-label="查看 ${attr(matched.word)}">${esc(match[0])}</button>`;
      last = match.index + match[0].length;
    }
    out += esc(text.slice(last));
    return out;
  }

  function structureTreeHtml(nodes, depth = 0) {
    if (!Array.isArray(nodes) || !nodes.length) return "";
    return `<ul class="tree-list" data-depth="${depth}">
      ${nodes.map((node) => `
        <li class="tree-node kind-${esc(node.kind)}">
          <div class="tree-row">
            ${node.children?.length ? `<button class="tree-expand" type="button" data-action="tree-expand" aria-expanded="false" aria-label="展开这一层">${icon("chevronDown")}</button>` : `<span class="tree-expand is-leaf" aria-hidden="true"></span>`}
            <button class="tree-main" type="button" data-action="structure-node" data-node-id="${attr(node.id)}">
              <span class="tree-kind">${treeKindLabel(node.kind)}</span>
              <span class="tree-text">${esc(node.text)}</span>
              ${node.role ? `<span class="tree-role">${esc(node.role)}</span>` : ""}
            </button>
          </div>
          ${node.children?.length ? `<div class="tree-children" hidden>${structureTreeHtml(node.children, depth + 1)}</div>` : ""}
        </li>`).join("")}
    </ul>`;
  }

  function openSegmentSheet(seg) {
    const role = segmentRole(seg.dataset.role);
    const clone = seg.cloneNode(true);
    clone.querySelectorAll(".seg-no, .seg-arrow").forEach((node) => node.remove());
    const text = String(clone.textContent || "").replace(/\s+/g, " ").trim();
    const gloss = String(seg.dataset.gloss || "").trim();
    const chunk = String(seg.dataset.chunk || "").trim();
    openSheetShell({ kicker: "意群", title: text || "这一段在做什么" });
    const holder = $("#sheet-scroll");
    if (!holder) return;
    holder.innerHTML = `
      <div class="insight-sheet segment-sheet">
        <div class="insight-rows">
          <div class="insight-row is-key">
            <span class="insight-label">作用</span>
            <p class="insight-value">${esc(role)}</p>
          </div>
          ${gloss ? `<div class="insight-row">
            <span class="insight-label">大意</span>
            <p class="insight-value">${esc(gloss)}</p>
          </div>` : ""}
        </div>
        ${chunk ? `<button class="segment-open-chunk" type="button" data-action="chunk-jump" data-chunk="${attr(chunk)}">
          <span>${esc(chunk)}</span><i aria-hidden="true">↗</i>
        </button>` : ""}
        <p class="segment-hint">这段在下方「02 信息推进」里对应该编号；可复用的搭配会单独收进意群页。</p>
      </div>`;
  }

  function openInsightSheet(node) {
    const kind = treeKindLabel(node.kind);
    const depthLabel = Number(node.depth) > 0 ? `第 ${Number(node.depth) + 1} 层` : "";
    openSheetShell({ kicker: [kind, depthLabel].filter(Boolean).join(" · "), title: node.label || "这一层在做什么" });
    const holder = $("#sheet-scroll");
    if (!holder) return;
    const rows = [
      { label: "作用", value: node.role, key: true },
      { label: "大意", value: node.gloss },
      { label: "阅读提示", value: node.note }
    ].filter((row) => row.value);
    holder.innerHTML = `
      <div class="insight-sheet">
        <p class="insight-clause">${esc(node.text || "")}</p>
        <div class="insight-rows">
          ${rows.map((row) => `
            <div class="insight-row ${row.key ? "is-key" : ""}">
              <span class="insight-label">${row.label}</span>
              <p class="insight-value">${esc(row.value)}</p>
            </div>`).join("")}
        </div>
        ${node.children?.length ? `
          <div class="insight-nested">
            <span class="insight-label">里面还有</span>
            <ul>${node.children.map((child) => `<li>${esc(child.label || child.text || "")}</li>`).join("")}</ul>
          </div>` : ""}
      </div>`;
  }

  function onionSlot(node, keyWords, depth = 1, suffix = "") {
    const inner = onionCompose(node.text || "", Array.isArray(node.children) ? node.children : [], keyWords, depth + 1);
    return `<span class="onion-slot" data-node-id="${attr(node.id)}"><button class="onion-mark" type="button" data-action="onion-toggle" aria-expanded="false" aria-label="展开这层修饰">+</button><span class="onion-wrap"><span class="onion-clause depth-${Math.min(depth, 3)}" data-depth="${Math.min(depth, 3)}" data-action="onion-open" data-node-id="${attr(node.id)}" role="button" tabindex="0">${inner}${esc(suffix)}</span></span></span>`;
  }

  function onionCompose(text, children, keyWords, depth = 1) {
    const source = String(text || "");
    const plain = (chunk) => annotateSentence(chunk, keyWords || []);
    const list = (Array.isArray(children) ? children : []).filter((child) => child && child.text && !/…|\.{2,}/.test(child.text));
    if (!list.length) return plain(source);

    const hits = [];
    list.forEach((child) => {
      const at = source.indexOf(child.text);
      if (at >= 0) hits.push({ child, start: at, end: at + child.text.length });
    });
    hits.sort((a, b) => a.start - b.start);

    const segments = [];
    let cursor = 0;
    const nested = new Set();
    hits.forEach((hit) => {
      let { start, end } = hit;
      if (start < cursor) { nested.add(hit.child); return; }
      const before = source.slice(0, start);
      if (/,\s*$/.test(before)) start = before.replace(/,\s*$/, "").length;
      const rest = source.slice(end);
      if (/^\s*,/.test(rest)) end += rest.match(/^\s*,/)[0].length;
      segments.push({ kind: "text", html: plain(tidyClauseText(source.slice(cursor, start))) });
      const tail = source.slice(end).match(/^\s*([.,;:!?]+)\s*$/);
      segments.push({
        kind: "slot",
        node: hit.child,
        suffix: tail ? tail[1] : "",
        html: onionSlot(hit.child, keyWords, hit.child.__depth || depth, tail ? tail[1] : "")
      });
      cursor = end + (tail ? tail[0].length : 0);
    });
    segments.push({ kind: "text", html: plain(tidyClauseText(source.slice(cursor))) });

    const placed = new Set(hits.map((hit) => hit.child));
    list.forEach((child) => {
      if (placed.has(child) || nested.has(child)) return;
      segments.push({ kind: "slot", node: child, suffix: "", html: onionSlot(child, keyWords, child.__depth || depth) });
    });

    const flow = segments.filter((segment) => segment.kind === "slot" || segment.html !== "");
    let html = "";
    for (let i = 0; i < flow.length; i += 1) {
      const segment = flow[i];
      if (segment.kind === "text") { html += segment.html; continue; }
      const run = [segment];
      while (i + 1 < flow.length && flow[i + 1].kind === "slot") { i += 1; run.push(flow[i]); }
      const padBefore = /[\s]$/.test(html) || !html ? "" : " ";
      const padAfter = /^\s/.test(flow[i + 1]?.html || "") ? "" : " ";
      const body = run.map((item) => item.html).join("");
      html += padBefore + body + padAfter;
    }
    return html;
  }

  function onionLine(text, tree, keyWords) {
    const nodes = Array.isArray(tree) ? tree.filter((node) => node && (node.text || node.children?.length)) : [];
    if (!nodes.length) return annotateSentence(text, keyWords);
    const main = nodes.find((node) => node.kind === "main");
    // Models often return only the folded layers; treat them as children of the sentence itself.
    const children = main
      ? hoistDetached((main.children || []).concat(nodes.filter((node) => node !== main)), 1)
      : hoistDetached(nodes, 1);
    if (!children.length) return annotateSentence(text, keyWords);
    return onionCompose(text, children, keyWords, 1);
  }

  function segmentLine(part, keyWords) {
    const text = String(part.text || "");
    const segments = Array.isArray(part.segments) ? part.segments : [];
    if (!segments.length) return `<p class="sentence-line">${annotateSentence(text, keyWords)}</p>`;
    const spans = segments.map((segment, index) => {
      const chunk = segment.chunk ? ` data-chunk="${attr(segment.chunk)}"` : "";
      const raw = String(segment.text || "");
      const lead = raw.match(/^\s+/)?.[0] || "";
      const rest = lead ? raw.slice(lead.length) : raw;
      const tail = rest.match(/\s+$/)?.[0] || "";
      const core = tail ? rest.slice(0, -tail.length) : rest;
      const marker = String(index + 1).padStart(2, "0");
      const arrow = segment.chunk ? `<i class="seg-arrow" aria-hidden="true">↗</i>` : "";
      return (lead ? `<span class="seg-space" aria-hidden="true">${esc(lead)}</span>` : "")
        + `<span class="seg" data-action="seg-open" data-role="${esc(segment.role)}" data-seg="${marker}" data-gloss="${attr(segment.gloss || "")}"${chunk}>`
        + `<i class="seg-no" aria-hidden="true">${marker}</i>${annotateSentence(core, keyWords)}${arrow}</span>`
        + `<span class="seg-space" aria-hidden="true">${esc(tail)}</span>`;
    }).join("");
    return `<p class="sentence-line is-segmented">${spans}</p>`;
  }

  function sentenceViewSwitch() {
    return `<div class="seg-switch" role="group" aria-label="句子显示方式">
      <button class="seg-switch-btn is-active" type="button" data-action="sentence-view" data-view="original">原句</button>
      <button class="seg-switch-btn" type="button" data-action="sentence-view" data-view="segments">意群切分</button>
      <button class="seg-switch-btn" type="button" data-action="sentence-view" data-view="focus">信息焦点</button>
    </div>
    <p class="seg-legend" aria-live="polite">
      <span data-for="original">— 重点词（点击查词）</span>
      <span data-for="segments">01–04 阅读意群边界（编号对应下方信息推进） · ↗ 可点进意群页</span>
      <span data-for="focus">深色：信息起点与末端焦点　浅色：修饰背景（已降噪）</span>
    </p>`;
  }

  function sentenceFlow(part) {
    const segments = Array.isArray(part.segments) ? part.segments : [];
    if (!segments.length) return "";
    return `<ol class="flow">
      ${segments.map((segment, index) => `
        <li class="flow-row" data-role="${esc(segment.role)}">
          <span class="flow-no">${String(index + 1).padStart(2, "0")}</span>
          <div class="flow-body">
            <div class="flow-line">
              <span class="flow-role">${segmentRole(segment.role)}</span>
              <span class="flow-text">${esc(segment.text.trim())}</span>
            </div>
            ${segment.gloss ? `<p class="flow-gloss">${esc(segment.gloss)}</p>` : ""}
          </div>
        </li>`).join("")}
    </ol>
    ${part.orderNote ? `<p class="flow-note">${esc(part.orderNote)}</p>` : ""}`;
  }

  function sentenceConstructions(part) {
    const rows = (Array.isArray(part.segments) ? part.segments : []).filter((segment) => segment.chunk);
    if (!rows.length) return "";
    return `<div class="construction-list">
      ${rows.map((segment) => `
        <button class="construction-row" type="button" data-action="chunk-jump" data-chunk="${attr(segment.chunk)}">
          <span class="construction-text">
            <span class="construction-chunk">${esc(segment.chunk)}</span>
            <span class="construction-gloss">${esc(segment.gloss || "看意群卡片")}</span>
          </span>
          <span class="construction-go" aria-hidden="true">↗</span>
        </button>`).join("")}
    </div>`;
  }

  function contrastCard(part) {
    const contrast = part.contrast;
    if (!contrast?.text) return "";
    return `<div class="contrast-card">
      <span class="contrast-label">${esc(contrast.label || "结构对照")}</span>
      <p class="contrast-en">${esc(contrast.text)}</p>
      ${contrast.zh ? `<p class="contrast-zh">${esc(contrast.zh)}</p>` : ""}
    </div>`;
  }

  function keyCard(keyWord, index) {
    const open = index === 0;
    const relations = [
      ...keyWord.family.map((item) => ({ ...item, kind: "family" })),
      ...keyWord.synonyms.map((item) => ({ ...item, kind: "syn" })),
      ...keyWord.antonyms.map((item) => ({ ...item, kind: "ant" }))
    ].slice(0, 7);
    return `
      <article class="key-card ${open ? "open" : ""}">
        <button class="key-toggle" type="button" data-action="key-toggle" aria-expanded="${open}" aria-controls="key-body-${index}">
          <span class="key-number">${String(index + 1).padStart(2, "0")}</span>
          <span class="key-main">
            <span class="key-word-line">
              <span class="key-word">${esc(keyWord.word)}</span>
              <span class="key-ipa">${esc(keyWord.phonetic || "")}</span>
              <span class="key-pos">${esc(posLabel(keyWord.pos))}</span>
            </span>
            <span class="key-context">${esc(keyWord.meaningZh || keyWord.meaning || "")}</span>
          </span>
          <span class="key-chevron">${icon("chevronDown")}</span>
        </button>
        <div class="key-body" id="key-body-${index}">
          <div class="key-body-inner">
            <div class="key-content">
              <div class="key-meaning"><strong>在本句中</strong> · ${esc(keyWord.meaningZh || keyWord.meaning || "")}</div>
              ${keyWord.meaningZh && keyWord.meaning ? `<p class="key-meaning-en">${esc(keyWord.meaning)}</p>` : ""}
              ${keyWord.why ? `<p class="key-why"><b>为什么重要：</b> ${esc(keyWord.why)}</p>` : ""}
              ${relations.length ? `
              <div class="mini-relations">
                ${relations.map((item) => `
                  <button class="mini-rel ${item.kind === "syn" ? "syn" : item.kind === "ant" ? "ant" : ""}" type="button"
                    data-action="word-layer" data-word="${attr(item.word)}" data-cache-word="${attr(item.word)}" data-gloss="${attr(relationGloss(item, data))}" data-pos="${attr(posAbbr(item.pos))}"
                    data-relation="${item.kind === "syn" ? "近义词" : item.kind === "ant" ? "反义词" : "同根词"}"
                    title="${attr(item.gloss)}">${esc(item.word)}</button>`).join("")}
              </div>` : ""}
              ${keyWord.example?.en ? `
              <div class="key-example">
                ${highlightPlain(keyWord.example.en, keyWord.word)}
                ${keyWord.example.zh ? `<span>${esc(keyWord.example.zh)}</span>` : ""}
              </div>` : ""}
              <button class="key-open" type="button" data-action="word-layer" data-word="${attr(keyWord.word)}" data-relation="重点词">
                查看完整词条 ${icon("arrowUpRight")}
              </button>
            </div>
          </div>
        </div>
      </article>`;
  }

  function sentencePartBlocks(part, index, keyWords, nextNo) {
    return `<section class="block sentence-part reveal">
      ${blockHead(nextNo(), `句子 ${index + 1}`, part.segments?.length ? "意群" : "分析")}
      <div class="sentence-stage part-stage">${segmentLine(part, keyWords)}</div>
      ${part.translation ? `<p class="sentence-part-zh">${esc(part.translation)}</p>` : ""}
      ${sentenceFlow(part)}
      ${sentenceConstructions(part)}
      ${contrastCard(part)}
      ${part.incomplete ? `<p class="sentence-part-missing">模型把这几句并成了一段，这一句没有单独分析；重试或逐句查询即可。</p>` : ""}
      ${part.keyWords?.length ? `<div class="key-list">${part.keyWords.map((keyWord, n) => keyCard(keyWord, index * 100 + n)).join("")}</div>` : ""}
    </section>`;
  }

  function sentencePage(sentence, layer = null) {
    let blockNo = 0;
    const nextNo = () => String(++blockNo).padStart(2, "0");
    const parts = Array.isArray(sentence.sentences) && sentence.sentences.length
      ? sentence.sentences
      : [{
        text: sentence.text,
        translation: sentence.translation,
        summary: sentence.summary || "",
        segments: sentence.segments || [],
        orderNote: sentence.orderNote || "",
        contrast: sentence.contrast || null
      }];
    const multi = parts.length > 1;
    const topKeyWords = Array.isArray(sentence.keyWords) ? sentence.keyWords : [];
    const renderParts = parts.map((part, index) => ({
      ...part,
      keyWords: Array.isArray(part.keyWords) ? part.keyWords : [],
      segments: Array.isArray(part.segments) && part.segments.length
        ? part.segments
        : (index === 0 && Array.isArray(sentence.segments) ? sentence.segments : []),
      orderNote: String(part.orderNote || ""),
      contrast: part.contrast || null
    }));
    const wholeTranslation = sentence.translation
      || renderParts.map((part) => part.translation).filter(Boolean).join(" ");
    const primary = renderParts[0];
    const primaryKeyWords = primary.keyWords.length ? primary.keyWords : topKeyWords;
    const bookmark = `sentence:${sentence.text || sentence.id}`;
    const single = !multi;
    return `
      ${layer
        ? layerTopbar({
            label: multi ? "多句" : "句子",
            title: multi ? `${renderParts.length} 句` : `${topKeyWords.length} 个重点词`,
            bookmark,
            origin: layer.origin,
            relation: layer.relation,
            depth: layer.depth
          })
        : backTopbar({ label: multi ? "多句" : "句子", title: multi ? `${renderParts.length} 句` : `${topKeyWords.length} 个重点词`, bookmark, share: true })}
      <main class="result-page sentence-page" data-view="original">
        <section class="sentence-hero">
          <div class="result-kicker reveal" style="--d:0">
            <span class="kicker-pill accent">句子</span>
            <span class="kicker-pill">${multi ? `${renderParts.length} 句` : `${topKeyWords.length} 个重点词`}</span>
          </div>
          ${single ? `<div class="sentence-stage reveal" style="--d:0.4">${segmentLine(primary, primaryKeyWords)}</div>
          ${primary.segments?.length ? `<div class="reveal" style="--d:0.55">${sentenceViewSwitch()}</div>` : ""}` : ""}
          <div class="sentence-source reveal" style="--d:1">
            <span>${esc(sentence.source || "Talk corpus")}</span>
            <span class="wave"></span>
            <button class="speak-btn" type="button" data-action="speak" data-text="${attr(sentence.text)}">${icon("volume")} 朗读</button>
            <button class="speak-btn speak-regen" type="button" data-action="regenerate-audio" data-text="${attr(sentence.text)}" title="跳过语音缓存，重新生成">${icon("refresh")}</button>
            <button class="speak-btn" type="button" data-action="copy-text" data-copy="${attr(sentence.text)}" aria-label="复制句子" title="复制句子">${icon("copy")}</button>
          </div>
        </section>

        <section class="block reveal" style="--d:1.2">
          ${blockHead(nextNo(), multi ? "整段意译" : "整句意译", "中文翻译")}
          <div class="translation-card">
            <span class="translation-label">${icon("quote")} ${multi ? "整段理解" : "整句理解"}</span>
            <p class="translation-text">${esc(wholeTranslation || "连接模型后生成翻译。")}</p>
            ${sentence.tone ? `<span class="translation-tone">${esc(sentence.tone)}</span>` : ""}
          </div>
          ${(sentence.tone || sentence.syntax || sentence.structure) ? `
          <div class="insight-grid">
            <div class="insight">
              <span class="mono">语气</span>
              <p>${esc(sentence.tone || "—")}</p>
            </div>
            <div class="insight">
              <span class="mono">句式</span>
              <p>${esc(sentence.syntax || sentence.structure || "—")}</p>
            </div>
          </div>` : ""}
        </section>

        ${single && primary.segments?.length ? `
        <section class="block reveal" style="--d:1.4">
          ${blockHead(nextNo(), "信息推进", "从起点到焦点")}
          ${sentence.summary ? `<p class="flow-lead">${esc(sentence.summary)}</p>` : ""}
          ${sentenceFlow(primary)}
        </section>` : ""}

        ${single && sentenceConstructions(primary) ? `
        <section class="block reveal" style="--d:1.55">
          ${blockHead(nextNo(), "句中构式", "点开看意群")}
          ${sentenceConstructions(primary)}
        </section>` : ""}

        ${single && contrastCard(primary) ? `
        <section class="block reveal" style="--d:1.7">
          ${blockHead(nextNo(), "结构对照", "换一种说法")}
          ${contrastCard(primary)}
        </section>` : ""}

        ${multi ? renderParts.map((part, index) => sentencePartBlocks(part, index, part.keyWords.length ? part.keyWords : topKeyWords, nextNo)).join("") : ""}

        ${sentence.summary && multi ? `
        <section class="block reveal" style="--d:1.8">
          ${blockHead(nextNo(), "整段主旨", "一句话记住")}
          <div class="summary-card">${esc(sentence.summary)}</div>
        </section>` : ""}

        ${single && topKeyWords.length ? `
        <section class="block reveal" style="--d:1.85">
          ${blockHead(nextNo(), "值得注意的词", "点击展开")}
          <div class="key-list">
            ${topKeyWords.map((keyWord, index) => keyCard(keyWord, index)).join("")}
          </div>
        </section>` : ""}

        ${reclassifyRow("sentence")}
        <div class="page-actions reveal" style="--d:2">
          <button class="btn btn-primary${isSavedKey(bookmark) ? " is-saved" : ""}" type="button" data-action="save" data-save-label="收藏句子" aria-pressed="${isSavedKey(bookmark)}">${icon("bookmark")} ${isSavedKey(bookmark) ? "已收藏" : "收藏句子"}</button>
          ${hasModelConfig() ? `<button class="btn btn-secondary" type="button" data-action="ask-ai-about" data-kind="sentence" data-subject="${attr(sentence.text)}">${icon("sparkle")} 向 AI 提问</button>` : ""}
          ${hasModelConfig() ? `<button class="btn btn-secondary" type="button" data-action="regenerate-sentence">${icon("refresh")} 重新生成分析</button>` : ""}
          <button class="btn btn-secondary" type="button" data-action="forget-sentence">删除缓存</button>
          <button class="btn btn-secondary" type="button" data-action="copy">${icon("copy")} 复制</button>
        </div>
      </main>`;
  }

  const actions = {
    "seg-open"({ event, target }) {
      const seg = target.closest(".seg");
      const view = document.querySelector(".sentence-page")?.dataset.view;
      if (!seg || view !== "segments") return;
      event.preventDefault();
      if (seg.dataset.chunk) {
        tapFeedback();
        if (cacheGetChunk(chunkSlug(seg.dataset.chunk))) {
          navigate({ name: "chunk", query: seg.dataset.chunk });
        } else {
          void runSearch(seg.dataset.chunk, "chunk");
        }
        return;
      }
      openSegmentSheet(seg);
    },
    "key-toggle"({ event, target }) {
      event.preventDefault();
      const card = target.closest(".key-card");
      if (!card) return;
      const open = !card.classList.contains("open");
      card.classList.toggle("open", open);
      target.setAttribute("aria-expanded", String(open));
    },
    "tree-expand"({ event, target }) {
      event.preventDefault();
      const row = target.closest(".tree-node");
      const box = row?.querySelector(":scope > .tree-children");
      if (!box) return;
      box.hidden = !box.hidden;
      row.classList.toggle("open", !box.hidden);
      target.setAttribute("aria-expanded", String(!box.hidden));
    },
    "tree-toggle-all"({ event, target }) {
      event.preventDefault();
      const expand = target.dataset.mode !== "collapse";
      $$(".tree-children").forEach((box) => { box.hidden = !expand; });
      $$(".tree-node").forEach((node) => node.classList.toggle("open", expand));
      $$(".tree-expand").forEach((btn) => btn.setAttribute("aria-expanded", String(expand)));
    },
    "sentence-view"({ event, target }) {
      event.preventDefault();
      const page = target.closest(".sentence-page");
      if (!page) return;
      const view = ["original", "segments", "focus"].includes(target.dataset.view) ? target.dataset.view : "original";
      page.dataset.view = view;
      $$(".seg-switch-btn", page).forEach((btn) => btn.classList.toggle("is-active", btn.dataset.view === view));
    },
    "chunk-jump"({ event, target }) {
      event.preventDefault();
      const row = target.closest("[data-action='chunk-jump']");
      const chunk = String(row?.dataset.chunk || "").trim();
      if (!chunk) return;
      tapFeedback();
      if (cacheGetChunk(chunkSlug(chunk))) {
        navigate({ name: "chunk", query: chunk });
      } else {
        void runSearch(chunk, "chunk");
      }
    },
    async "regenerate-sentence"({ event }) {
      event.preventDefault();
      const surface = getActiveSurface();
      if (surface.kind !== "sentence" || !surface.query || !hasModelConfig()) return;
      const level = sentenceLevelOf(state.settings?.sentenceLevel).id;
      const detail = state.settings?.detailLevel || "standard";
      removeSentenceRecord(await sentenceKey(surface.query, level, detail));
      if (surface.isLayer) await hydrateSentenceLayer(surface.record, surface.query);
      else await runSearch(surface.query, "sentence", { skipCache: true });
    },
    async "forget-sentence"({ event }) {
      event.preventDefault();
      const surface = getActiveSurface();
      if (surface.kind !== "sentence" || !surface.query) return;
      const level = sentenceLevelOf(state.settings?.sentenceLevel).id;
      const detail = state.settings?.detailLevel || "standard";
      removeSentenceRecord(await sentenceKey(surface.query, level, detail));
      toast("已删除这条句子缓存");
      if (surface.isLayer) closeTopWordLayer();
    },
    "clear-sentence-cache"({ event }) {
      event.preventDefault();
      clearSentenceCache();
      toast("句子缓存已清除");
    }
  };

  return {
    structureTreeHtml,
    openSegmentSheet,
    openInsightSheet,
    onionLine,
    segmentLine,
    sentenceViewSwitch,
    sentenceFlow,
    sentenceConstructions,
    contrastCard,
    sentencePartBlocks,
    sentencePage,
    keyCard,
    annotateSentence,
    actions
  };
}
