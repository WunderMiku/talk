/* ============================================================
   talk. — Bottom sheet shell, word quick sheet & cache dashboard
   ============================================================ */

import {
  $,
  esc,
  attr,
  rich,
  normalizeWord,
  highlightPlain,
  posAbbr,
  posLabel
} from "../core/utils.js";
import { icon } from "../core/icons.js";
import { relationGloss } from "./word.js";

export function createSheetController({
  state,
  overlayRoot,
  data: DATA,
  reduceMotion,
  updateScrollLock,
  flushSettingsDraft,
  renderSettingsContent,
  wordCacheStats,
  wordCacheEstimate,
  getAudioStats,
  getStorageEstimate,
  formatBytes,
  clearWordStore,
  clearAudioCache,
  exportWordCache,
  refreshCacheBorders,
  activeWordData,
  schedulePrefetch,
  toast
}) {
  let sheetAnimToken = 0;

  function renderSheetBackMarkup(backAction, backLabel) {
    if (!backAction) return "";
    return `<button class="sheet-head-back" type="button" data-action="${attr(backAction)}" aria-label="${attr(backLabel)}">${icon("arrowLeft")}<span>${esc(backLabel)}</span></button>`;
  }

  function openSheetShell({ kicker, title, reuse = false, backAction = "", backLabel = "返回" }) {
    state.sheetOpenedAt = performance.now();
    if (state.sheetCloseTimer) {
      window.clearTimeout(state.sheetCloseTimer);
      state.sheetCloseTimer = null;
    }
    const existingBackdrop = $(".sheet-backdrop", overlayRoot);
    const existingSheet = $(".sheet", overlayRoot);
    if (reuse && existingBackdrop && existingSheet && $("#sheet-scroll", overlayRoot)) {
      sheetAnimToken += 1;
      existingSheet.setAttribute("aria-label", title);
      const kickerEl = $(".sheet-head .mono", existingSheet);
      if (kickerEl) kickerEl.textContent = kicker;
      const titleEl = $(".sheet-title", existingSheet);
      if (titleEl) titleEl.textContent = title;
      const head = $(".sheet-head", existingSheet);
      if (head) {
        const oldBack = $(".sheet-head-back", head);
        if (backAction) {
          if (oldBack) {
            oldBack.dataset.action = backAction;
            oldBack.setAttribute("aria-label", backLabel);
            const span = $("span", oldBack);
            if (span) span.textContent = backLabel;
          } else {
            head.insertAdjacentHTML("afterbegin", renderSheetBackMarkup(backAction, backLabel));
          }
        } else if (oldBack) {
          oldBack.remove();
        }
      }
      state.sheetOpen = true;
      updateScrollLock();
      existingBackdrop.classList.add("show");
      existingSheet.classList.add("show");
      return;
    }

    const token = ++sheetAnimToken;
    overlayRoot.innerHTML = `
      <div class="sheet-backdrop" data-action="close-sheet"></div>
      <section class="sheet" role="dialog" aria-modal="true" aria-label="${attr(title)}" tabindex="-1">
        <div class="sheet-handle" aria-hidden="true"></div>
        <div class="sheet-head">
          ${renderSheetBackMarkup(backAction, backLabel)}
          <div class="sheet-head-left">
            <span class="mono">${esc(kicker)}</span>
            <h2 class="sheet-title">${esc(title)}</h2>
          </div>
          <button class="sheet-close" type="button" data-action="close-sheet" aria-label="关闭">${icon("close")}</button>
        </div>
        <div class="sheet-scroll" id="sheet-scroll" data-lenis-prevent></div>
      </section>`;

    state.sheetOpen = true;
    updateScrollLock();
    requestAnimationFrame(() => {
      if (token !== sheetAnimToken) return;
      requestAnimationFrame(() => {
        if (token !== sheetAnimToken) return;
        $(".sheet-backdrop", overlayRoot)?.classList.add("show");
        $(".sheet", overlayRoot)?.classList.add("show");
        $(".sheet", overlayRoot)?.focus({ preventScroll: true });
      });
    });
  }

  function closeSheet({ immediate = false } = {}) {
    if (!state.sheetOpen && !overlayRoot.firstElementChild) return;
    sheetAnimToken += 1;
    if (state.settingsOpen) flushSettingsDraft();
    state.settingsOpen = false;
    state.settingsSubView = "";
    state.providerDraft = null;
    state.providerStatus = null;
    state.sheetOpen = false;
    state.sheetStack = [];
    updateScrollLock();
    const backdrop = $(".sheet-backdrop", overlayRoot);
    const sheet = $(".sheet", overlayRoot);
    if (immediate) {
      if (state.sheetCloseTimer) {
        window.clearTimeout(state.sheetCloseTimer);
        state.sheetCloseTimer = null;
      }
      overlayRoot.innerHTML = "";
      return;
    }
    backdrop?.classList.remove("show");
    sheet?.classList.remove("show");
    if (state.sheetCloseTimer) window.clearTimeout(state.sheetCloseTimer);
    state.sheetCloseTimer = window.setTimeout(() => {
      overlayRoot.innerHTML = "";
      state.sheetCloseTimer = null;
    }, 520);
  }

  function sheetBackButton() {
    if (state.sheetStack.length <= 1) return "";
    return `<button class="sheet-back" type="button" data-action="sheet-back">${icon("arrowLeft")} 返回</button>`;
  }

  function wordSheetContent(payload) {
    const entry = payload.entry || null;
    const context = payload.context || null;
    const word = payload.word || entry?.word || "";
    const ipa = payload.ipa || entry?.phonetic || "";
    const pos = payload.pos || entry?.pos || "";
    const short = context?.meaning || entry?.short || payload.gloss || "这个词来自当前词条的关联词。";
    const translation = entry?.translation || "";
    const family = payload.family || context?.family || entry?.family || [];
    const synonyms = payload.synonyms || context?.synonyms || entry?.synonyms || [];
    const antonyms = payload.antonyms || context?.antonyms || entry?.antonyms || [];
    const example = context?.example || (entry?.examples && entry.examples[0]) || null;
    const isStub = !entry && !context;
    const canOpen = entry || context;

    const relGroup = (label, items) => items.length ? `
      <div class="sheet-section">
        <span class="sheet-section-label">${esc(label)}</span>
        <div class="sheet-rel-row">
          ${items.map((item) => `
            <button class="sheet-rel" type="button" data-action="sheet-word" data-word="${attr(item.word)}" data-gloss="${attr(relationGloss(item, DATA))}" data-pos="${attr(posAbbr(item.pos))}">
              ${esc(item.word)} ${item.gloss ? `<small>${esc(item.gloss)}</small>` : ""}
            </button>`).join("")}
        </div>
      </div>` : "";

    return `
      <div class="sheet-content">
        ${sheetBackButton()}
        <div class="sheet-word-head">
          <div>
            <h3 class="sheet-word">${esc(word)}</h3>
            <div class="sheet-sub">
              ${ipa ? `<span class="ipa">${esc(ipa)}</span>` : ""}
              ${pos ? `<span class="pos-pill">${esc(posLabel(pos))}</span>` : ""}
            </div>
          </div>
          <button class="speak-btn" type="button" data-action="speak" data-text="${attr(word)}">${icon("volume")}</button>
        </div>
        ${context ? "" : `<p class="sheet-definition">${esc(translation || short)}</p>`}
        ${translation && short && !context ? `<p class="sheet-translation">${esc(short)}</p>` : ""}
        ${context ? `
          <div class="sheet-context">
            <span class="mono">在本句中</span>
            <p>${esc(context.meaningZh || context.meaning || short)}</p>
            ${context.meaningZh && context.meaning ? `<span class="sheet-context-en">${esc(context.meaning)}</span>` : ""}
            ${context.why ? `<span class="sheet-context-why">${esc(context.why)}</span>` : ""}
          </div>` : ""}
        ${relGroup("同根词", family)}
        ${relGroup("近义词", synonyms)}
        ${relGroup("反义词", antonyms)}
        ${example?.en ? `
          <div class="sheet-section">
            <span class="sheet-section-label">例句</span>
            <div class="sheet-example">
              <p>${highlightPlain(example.en, word)}</p>
              ${example.zh ? `<span>${esc(example.zh)}</span>` : ""}
            </div>
          </div>` : ""}
        ${isStub ? `<div class="sheet-note">${icon("info")}<span>演示词条。连接模型后可补全。</span></div>` : ""}
        ${entry?.note && !context ? `<div class="sheet-note">${icon("sparkle")}<span>${rich(entry.note)}</span></div>` : ""}
        <div class="sheet-actions">
          <button class="btn btn-primary" type="button" data-action="full-entry" data-word="${attr(word)}">${icon("arrowUpRight")} ${canOpen ? "查看完整词条" : "去查这个词"}</button>
          <button class="btn btn-secondary" type="button" data-action="close-sheet">关闭</button>
        </div>
      </div>`;
  }

  function renderSheetContent() {
    const holder = $("#sheet-scroll");
    if (!holder) return;
    const payload = state.sheetStack[state.sheetStack.length - 1];
    if (!payload) return;
    holder.innerHTML = wordSheetContent(payload);
    holder.scrollTop = 0;
    const content = $(".sheet-content", holder);
    if (content && !reduceMotion) {
      content.animate(
        [
          { opacity: 0, transform: "translateY(12px)" },
          { opacity: 1, transform: "translateY(0)" }
        ],
        { duration: 360, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
      );
    }
  }

  function openWordSheet(word, options = {}) {
    const key = normalizeWord(word);
    const entry = DATA.words[key] || null;
    const stub = !entry ? DATA.lexicon[key] : null;
    const payload = {
      word,
      entry: entry || (stub ? { word, ...stub } : null),
      gloss: options.gloss || "",
      pos: options.pos || "",
      ipa: options.ipa || "",
      context: options.context || null
    };
    state.sheetStack = [payload];
    openSheetShell({ kicker: "单词详解", title: "词义速览" });
    renderSheetContent();
  }

  function pushSheetWord(button) {
    const word = button.dataset.word || "";
    if (!word) return;
    const key = normalizeWord(word);
    const entry = DATA.words[key] || null;
    const stub = !entry ? DATA.lexicon[key] : null;
    state.sheetStack.push({
      word,
      entry: entry || (stub ? { word, ...stub } : null),
      gloss: button.dataset.gloss || "",
      pos: button.dataset.pos || "",
      ipa: "",
      context: null
    });
    renderSheetContent();
  }

  function goBackInSheet() {
    if (state.sheetStack.length > 1) {
      state.sheetStack.pop();
      renderSheetContent();
    }
  }

  async function renderCacheContent() {
    const holder = $("#sheet-scroll");
    if (!holder) return;
    const words = wordCacheStats({ limit: 24 });
    const average = words.count ? words.bytes / words.count : 2600;
    const recent = words.entries;
    const [audio, quotaEst] = await Promise.all([
      getAudioStats(),
      getStorageEstimate ? getStorageEstimate() : Promise.resolve({ usage: 0, quota: 0, persisted: false })
    ]);
    if (!holder.isConnected) return;
    const totalBytes = words.bytes + audio.bytes;
    const quotaText = quotaEst.quota > 0
      ? `本机可用配额 ${formatBytes(quotaEst.quota)}${quotaEst.persisted ? " · 已开启持久化" : ""}；书库、词条、寻词与精读均存 IndexedDB。`
      : "只存本机 IndexedDB；导出不含音频。";
    holder.innerHTML = `
      <div class="sheet-content" id="cache-dashboard">
        <p class="settings-intro">${quotaText}</p>
        <div class="cache-summary-grid">
          <div class="cache-summary-card">
            <span class="cache-summary-label">词条</span>
            <strong>${words.count}</strong>
            <span>${formatBytes(words.bytes)} · 永久保留</span>
          </div>
          <div class="cache-summary-card">
            <span class="cache-summary-label">语音</span>
            <strong>${audio.count}</strong>
            <span>${formatBytes(audio.bytes)}</span>
          </div>
          <div class="cache-summary-card accent">
            <span class="cache-summary-label">合计</span>
            <strong>${formatBytes(totalBytes)}</strong>
            <span>${words.backend}</span>
          </div>
        </div>
        <p class="cache-estimate" id="cache-estimate">平均 ${formatBytes(average)}/词条 · 词条、句子、寻词、翻译与精读均不限数量与时长，仅在手动清空时删除。</p>
        <div class="cache-list-head">
          <span class="settings-subhead">已缓存词条</span>
          <span class="mono">${words.count} 条</span>
        </div>
        ${recent.length ? `<div class="cache-word-list">
          ${recent.map((entry) => `<button class="cache-word-item" type="button" data-action="word" data-word="${attr(entry.key)}">
            <span><strong>${esc(entry.word)}</strong><small>${esc(entry.detail)} · ${formatBytes(entry.bytes)}</small></span>
            <span class="cache-word-date">${entry.at ? new Date(entry.at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) : "—"}</span>
          </button>`).join("")}
        </div>` : `<p class="field-hint">还没有缓存词条。查一个模型词条后，它会出现在这里。</p>`}
        ${words.count > recent.length ? `<p class="field-hint">只显示最近 ${recent.length} 条，共 ${words.count} 条。</p>` : ""}
        <div class="cache-actions">
          <button class="btn btn-secondary cache-action-btn" type="button" data-action="export-word-cache">导出 JSON</button>
          <button class="btn btn-secondary cache-action-btn" type="button" data-action="import-word-cache">导入 JSON</button>
          <button class="link-btn" type="button" data-action="clear-word-cache">清空词条</button>
          <button class="link-btn" type="button" data-action="clear-sentence-cache">清空句子</button>
          <button class="link-btn" type="button" data-action="clear-audio-cache">清空语音</button>
          <input id="word-cache-file" type="file" accept="application/json,.json" hidden />
        </div>
      </div>`;
    holder.scrollTop = 0;
  }

  function refreshCacheUi() {
    if ($("#cache-dashboard")) {
      void renderCacheContent();
    } else if (state.sheetOpen && $("#sheet-scroll .settings-sheet")) {
      renderSettingsContent();
    }
  }

  function openCacheSheet() {
    const fromSettings = Boolean(state.settingsOpen);
    if (fromSettings) state.settingsSubView = "cache";
    openSheetShell({
      kicker: "本机数据",
      title: "缓存与空间",
      reuse: Boolean(state.sheetOpen),
      backAction: fromSettings ? "settings-back" : "",
      backLabel: "返回设置"
    });
    void renderCacheContent();
  }

  const actions = {
    "sheet-back"({ event }) {
      event.preventDefault();
      goBackInSheet();
    },
    "close-sheet"({ event, target }) {
      event.preventDefault();
      if (target.classList.contains("sheet-backdrop") && performance.now() - state.sheetOpenedAt < 480) return;
      closeSheet();
    },
    "open-cache"({ event }) {
      event.preventDefault();
      openCacheSheet();
    },
    async "clear-word-cache"({ event }) {
      event.preventDefault();
      await clearWordStore();
      refreshCacheBorders();
      const active = activeWordData();
      if (active) schedulePrefetch(active);
      refreshCacheUi();
      toast("词条缓存已清除");
    },
    "export-word-cache"({ event }) {
      event.preventDefault();
      exportWordCache();
    },
    "import-word-cache"({ event }) {
      event.preventDefault();
      $("#word-cache-file")?.click();
    },
    async "clear-audio-cache"({ event }) {
      event.preventDefault();
      if (!window.confirm("清空所有已生成的语音缓存？")) return;
      await clearAudioCache();
      refreshCacheUi();
      toast("语音缓存已清空");
    }
  };

  return {
    openSheetShell,
    closeSheet,
    openWordSheet,
    pushSheetWord,
    goBackInSheet,
    openCacheSheet,
    renderCacheContent,
    refreshCacheUi,
    actions
  };
}
