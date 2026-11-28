/* ============================================================
   talk. — Status views (loading, offline miss, error) & shared reclassify bar
   ============================================================ */

import { esc, attr, shorten, normalizeWord, normalizeSentence } from "../core/utils.js";
import { icon } from "../core/icons.js";

export function reclassifyRow(current) {
  const items = [["word", "词"], ["chunk", "意群"], ["sentence", "句"]];
  return `<div class="reclassify reveal" style="--d:2.9">
      <span class="reclassify-label">当它是</span>
      <span class="reclassify-group" role="group" aria-label="改判颗粒度">
        ${items.map(([id, label]) => `<button class="reclassify-btn${id === current ? " is-current" : ""}" type="button"
          data-action="reclassify" data-paradigm="${id}"
          ${id === current ? 'disabled aria-disabled="true"' : ""}>${label}</button>`).join("")}
      </span>
    </div>`;
}

export function createStatusViews({
  state,
  data,
  backTopbar,
  runSearch,
  lookupDemo,
  addHistory,
  navigate,
  toast
}) {
  function hasDemo(query, type) {
    try {
      if (type === "word") return Boolean(data.words[normalizeWord(query)]);
      return Boolean(data.sentences.find((item) => normalizeSentence(item.text) === normalizeSentence(query)));
    } catch (_) {
      return false;
    }
  }

  function loadingBody(query, type, { statusText, withPreview = false } = {}) {
    const statusByName = {
      sentence: "找出真正重要的词",
      chunk: "拆开它的槽位",
      reverse: "翻找贴切的表达",
      word: "正在理解词义"
    };
    const status = statusText || statusByName[type] || statusByName.word;
    const typePill = type === "sentence" ? "句子" : type === "chunk" ? "意群" : type === "reverse" ? "寻词" : "单词";
    return `
      <main class="result-page loading-page">
        <div class="loading-lead">
          <div class="result-kicker reveal" style="--d:0">
            <span class="kicker-pill accent">${typePill}</span>
            <span class="kicker-pill">正在整理</span>
          </div>
          <h1 class="loading-query reveal" style="--d:0.4">${esc(query)}</h1>
          <div class="loading-status reveal" style="--d:0.8">
            <span class="loading-dots"><i></i><i></i><i></i></span>
            <span${withPreview ? ' id="loading-status-text"' : ""}>${status}</span>
          </div>

          ${withPreview ? '<div class="live-preview" id="live-preview" hidden></div>' : ""}
          <div class="skeleton-stack">
            <div class="skeleton hero"></div>
            <div class="skeleton line"></div>
            <div class="skeleton line short"></div>
          </div>
        </div>
        <div class="skeleton-blocks">
          <div class="skeleton card tall"></div>
          <div class="skeleton card"></div>
          <div class="skeleton line"></div>
        </div>
      </main>`;
  }

  function loadingPage(query, type) {
    return `
      ${backTopbar({ label: type === "sentence" ? "正在理解句子" : type === "chunk" ? "正在辨认意群" : type === "reverse" ? "正在挑选说法" : "正在查询单词", title: shorten(query, 28) })}
      ${loadingBody(query, type, { withPreview: true })}`;
  }

  function missPage(type, query, suggestions = []) {
    const isSentence = type === "sentence";
    const isChunk = type === "chunk";
    const isReverse = type === "reverse";
    const fallback = suggestions.length
      ? suggestions
      : isSentence
        ? data.sentences.slice(0, 2).map((item) => item.text)
        : isChunk
          ? ["by and large", "take off", "in the end"]
          : isReverse
            ? ["怎么礼貌地拒绝", "表达“顺便说一下”", "形容雨很小"]
            : ["serendipity", "ephemeral", "resilient"];
    const typeForChip = isSentence ? "sentence" : "auto";
    return `
      ${backTopbar({ label: "离线演示", title: isSentence ? "句子尚未收录" : isChunk ? "意群尚未收录" : isReverse ? "还没连上模型" : "单词尚未收录" })}
      <main class="result-page state-page">
        <div class="state-orb reveal" style="--d:0">?</div>
        <h1 class="state-title reveal" style="--d:0.4">离线词库还没收录。</h1>
        <p class="state-copy reveal" style="--d:0.6">离线词库很小。连接模型后，可以${isSentence ? "把任何句子拆成重点词，读懂语气与结构" : isChunk ? "拆开任何固定搭配，看它的槽位与来历" : isReverse ? "用一句中文描述，找到最贴切的英文说法" : "查任何单词，连带近义词、反义和例句"}。也可以先看下面的示例。</p>
        <span class="state-query reveal" style="--d:0.8">${esc(shorten(query, 88))}</span>
        <div class="state-actions reveal" style="--d:1">
          <button class="btn btn-primary" type="button" data-action="settings">${icon("wand")} 连接模型</button>
          <button class="btn btn-secondary" type="button" data-action="lookup" data-query="${attr(fallback[0])}" data-type="${typeForChip}">先看示例</button>
        </div>
        ${reclassifyRow("")}
        <div class="recent-row reveal" style="--d:1.2; padding-left:0; padding-right:0; margin-top:22px; flex-wrap:wrap;">
          ${fallback.slice(0, 3).map((item) => `
            <button class="chip" type="button" data-action="lookup" data-query="${attr(item)}" data-type="${typeForChip}">
              ${isSentence ? '<span class="quote-dot"></span>' : ""}${esc(shorten(item, 43))}
            </button>`).join("")}
        </div>
      </main>`;
  }

  function errorPage(route) {
    const isCors = /failed to fetch|network|cors|load failed/i.test(route.message || "");
    return `
      ${backTopbar({ label: "模型请求", title: "请求中断" })}
      <main class="result-page state-page">
        <div class="state-orb coral reveal" style="--d:0">!</div>
        <h1 class="state-title reveal" style="--d:0.4">这次没接住。</h1>
        <p class="state-copy reveal" style="--d:0.6">模型请求没有完整返回。${isCors ? "浏览器直连常会被 CORS 拦截；可以把 API 地址换成你自己的代理。" : "请检查接口地址、模型名和密钥，然后再试一次。"}</p>
        <span class="state-query reveal" style="--d:0.8">${esc(shorten(route.query || "", 88))}</span>
        ${route.message ? `<div class="error-detail reveal" style="--d:1">${esc(shorten(route.message, 320))}</div>` : ""}
        <div class="state-actions reveal" style="--d:1.1">
          <button class="btn btn-primary" type="button" data-action="retry">${icon("refresh")} 重试</button>
          <button class="btn btn-secondary" type="button" data-action="settings">${icon("settings")} 模型设置</button>
          <button class="btn btn-secondary" type="button" data-action="copy-diagnostics">${icon("copy")} 复制诊断</button>
          ${hasDemo(route.query, route.type) ? `<button class="btn btn-secondary" type="button" data-action="demo">使用演示词条</button>` : ""}
        </div>
      </main>`;
  }

  const actions = {
    retry({ event }) {
      event.preventDefault();
      if (state.lastAttempt) runSearch(state.lastAttempt.query, state.lastAttempt.type);
    },
    demo({ event }) {
      event.preventDefault();
      if (!state.lastAttempt) return;
      try {
        const result = lookupDemo(state.lastAttempt.query, state.lastAttempt.type);
        if (result.type === "word") {
          addHistory("word", state.lastAttempt.query);
          navigate({ name: "word", word: result.data.word, result: result.data }, { replace: true });
        } else {
          addHistory("sentence", state.lastAttempt.query);
          navigate({ name: "sentence", id: result.data.id, result: result.data }, { replace: true });
        }
      } catch (_) {
        toast("No demo entry for that one");
      }
    }
  };

  return {
    loadingBody,
    loadingPage,
    missPage,
    errorPage,
    hasDemo,
    actions
  };
}
