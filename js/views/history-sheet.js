/* ============================================================
   talk. — History, Reverse Threads & Wordbooks drawer sheet
   ============================================================ */

import {
  $,
  esc,
  attr,
  shorten,
  normalizeWord,
  chunkSlug,
  timeAgo,
  tapFeedback
} from "../core/utils.js";
import { icon } from "../core/icons.js";

function downloadTextFile(text, filename, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createHistorySheet({
  state,
  data: DATA,
  openSheetShell,
  closeSheet,
  listReverseThreads,
  syncSavedFromWordbooks,
  parseSavedEntry,
  findSavedIndex,
  persistSaved,
  persistHistory,
  cacheGetWord,
  cacheGetChunk,
  hasModelConfig,
  callWordbookAi,
  navigate,
  runSearch,
  openWordLayer,
  toast
}) {
  let historySheetTab = "history"; // "history" | "wordbooks"
  let historySubTab = "recent";    // "recent" | "reverse"
  let activeWordbookId = null;     // null = shelf list, string = book detail
  let wordbookImportOpen = false;
  let wordbookMenuOpen = false;
  let wordbookAuditNote = "";
  let wordbookSorting = false;
  let wordbookExtracting = false;

  function historyForCurrentModule() {
    const translating = state.module === "translator";
    return state.history.filter((item) =>
      translating ? item.type === "translation" : item.type !== "translation"
    );
  }

  function isTermLocallyCached(term) {
    const entry = parseSavedEntry(term);
    if (!entry.text) return false;
    if (entry.kind === "chunk") return Boolean(cacheGetChunk(entry.text) || DATA.chunks?.[chunkSlug(entry.text)]);
    if (entry.kind === "word") return Boolean(cacheGetWord(entry.text) || DATA.words?.[normalizeWord(entry.text)]);
    return false;
  }

  function renderWordbooksPanel() {
    const wb = window.TALK_WORDBOOKS;
    if (!wb) return '<div class="history-empty">词汇书库模块未加载。</div>';
    wb.loadStore(state.saved);
    const books = wb.listBooks();
    const st = wb.stats();

    const importBox = wordbookImportOpen ? `
      <div class="wb-import-box" data-surface="inset">
        <div class="wb-import-head">
          <span>导入到「${esc(wb.getBook(activeWordbookId)?.name || wb.DEFAULT_BOOK_NAME)}」</span>
          <button class="wb-text-btn" type="button" data-action="wb-import-close" aria-label="关闭导入">取消</button>
        </div>
        <textarea id="wb-import-textarea" class="wb-import-ta" rows="3" placeholder="每行一词，或粘贴 CSV / JSON 备份"></textarea>
        <p class="wb-import-hint" id="wb-import-hint" role="status"></p>
        <div class="wb-import-actions">
          <label class="wb-text-btn wb-file-btn">
            选择文件
            <input id="wb-import-file" type="file" accept=".txt,.csv,.json,text/plain,text/csv,application/json" hidden />
          </label>
          <div class="wb-text-actions">
            ${hasModelConfig() ? `<button class="wb-text-btn" type="button" data-action="wb-import-extract" ${wordbookExtracting ? "disabled" : ""}>${wordbookExtracting ? "提取中…" : "AI 提取"}</button>` : ""}
            <button class="wb-text-btn is-accent" type="button" data-action="wb-import-submit" ${wordbookExtracting ? "disabled" : ""}>导入</button>
          </div>
        </div>
      </div>` : "";

    const auditBanner = wordbookAuditNote ? `
      <div class="wb-audit-strip">
        <span>${esc(wordbookAuditNote)}</span>
        <button class="wb-text-btn" type="button" data-action="wb-dismiss-audit">知道了</button>
      </div>` : "";

    // View A: Quiet editorial vertical list of books
    if (!activeWordbookId) {
      return `
        ${auditBanner}
        <div class="wb-list-header">
          <span class="wb-list-meta">${st.bookCount} 本分册 · ${st.uniqueWords} 词</span>
          <div class="wb-text-actions">
            <button class="wb-text-btn" type="button" data-action="wb-create-book">+ 新建</button>
            <div class="wb-menu-wrap">
              <button class="wb-text-btn" type="button" data-action="wb-toggle-menu" aria-expanded="${wordbookMenuOpen}">···</button>
              ${wordbookMenuOpen ? `
                <div class="wb-pop-menu" role="menu">
                  <button class="wb-pop-item" type="button" data-action="wb-import-open">批量导入</button>
                  <button class="wb-pop-item" type="button" data-action="wb-export-json">导出 JSON</button>
                </div>` : ""}
            </div>
          </div>
        </div>
        ${importBox}
        <div class="wb-editorial-list">
          ${books.map((book) => {
            const cachedCount = book.items.filter((it) => isTermLocallyCached(it.term)).length;
            return `
              <button class="wb-list-row" type="button" data-action="wb-open-book" data-book-id="${attr(book.id)}">
                <span class="wb-row-main">
                  <strong class="wb-row-title">${esc(book.name)}</strong>
                  ${book.system ? '<span class="wb-pin-tag">未分类</span>' : ""}
                </span>
                <span class="wb-row-right" title="已缓存 ${cachedCount} 词">
                  <span>${book.items.length} 词</span>
                  <span aria-hidden="true">›</span>
                </span>
              </button>`;
          }).join("")}
        </div>`;
    }

    // View B: Clean single-book detail with AI 分册 + ··· menu
    const book = wb.getBook(activeWordbookId) || books[0];
    if (!book) {
      activeWordbookId = null;
      return renderWordbooksPanel();
    }
    const otherBooks = books.filter((b) => b.id !== book.id);

    return `
      ${auditBanner}
      <div class="wb-list-header">
        <button class="wb-text-btn wb-back-link" type="button" data-action="wb-back-shelf">← ${esc(book.name)} <span class="wb-list-meta">${book.items.length}</span></button>
        <div class="wb-text-actions">
          ${book.items.length >= 2 && hasModelConfig() ? `<button class="wb-text-btn is-accent" type="button" data-action="wb-ai-sort" data-book-id="${attr(book.id)}" ${wordbookSorting ? "disabled" : ""}>${wordbookSorting ? "分册中…" : "AI 分册"}</button>` : ""}
          <div class="wb-menu-wrap">
            <button class="wb-text-btn" type="button" data-action="wb-toggle-menu" aria-expanded="${wordbookMenuOpen}">···</button>
            ${wordbookMenuOpen ? `
              <div class="wb-pop-menu" role="menu">
                ${book.items.length >= 1 ? `<button class="wb-pop-item" type="button" data-action="wb-to-reader" data-book-id="${attr(book.id)}">生成精读</button>` : ""}
                <button class="wb-pop-item" type="button" data-action="wb-import-open">导入词条</button>
                ${book.items.length ? `<button class="wb-pop-item" type="button" data-action="wb-export-txt" data-book-id="${attr(book.id)}">导出 .txt</button>` : ""}
                ${!book.system ? `<button class="wb-pop-item" type="button" data-action="wb-rename-book" data-book-id="${attr(book.id)}">重命名</button>` : ""}
                ${!book.system ? `<button class="wb-pop-item is-danger" type="button" data-action="wb-delete-book" data-book-id="${attr(book.id)}">删除分册</button>` : ""}
              </div>` : ""}
          </div>
        </div>
      </div>
      ${importBox}
      ${book.items.length ? `
        <div class="wb-editorial-list">
          ${book.items.map((item) => {
            const entry = parseSavedEntry(item.term);
            const cached = isTermLocallyCached(item.term);
            return `
              <div class="wb-list-row wb-word-item">
                <button class="wb-word-trigger" type="button" data-action="saved-item" data-term="${attr(item.term)}">
                  <span class="wb-cache-dot ${cached ? "is-cached" : ""}" title="${cached ? "本机已有词条缓存" : "未查词（点开按需查询）"}"></span>
                  <strong class="wb-row-title notranslate" translate="no" lang="en">${esc(shorten(entry.label, 42))}</strong>
                </button>
                <span class="wb-row-right">
                  ${otherBooks.length ? `<button class="wb-text-btn wb-mini-act" type="button" data-action="wb-move-term" data-term="${attr(item.term)}" data-book-id="${attr(book.id)}" title="移到其他分册">换册</button>` : ""}
                  <button class="wb-text-btn wb-mini-del" type="button" data-action="wb-remove-term" data-term="${attr(item.term)}" data-book-id="${attr(book.id)}" aria-label="移出本册" title="移出本册">×</button>
                </span>
              </div>`;
          }).join("")}
        </div>` : `
        <div class="history-empty">「${esc(book.name)}」暂无词条</div>`}`;
  }

  function renderHistoryContent() {
    const holder = $("#sheet-scroll");
    if (!holder) return;
    const items = historyForCurrentModule();
    const translating = state.module === "translator";
    const revThreads = listReverseThreads();
    const wbStats = window.TALK_WORDBOOKS ? window.TALK_WORDBOOKS.stats() : { uniqueWords: state.saved.length };
    const topTab = historySheetTab === "wordbooks" ? "wordbooks" : "history";
    const subTab = historySubTab === "reverse" ? "reverse" : "recent";

    const topTabsHtml = `
      <div class="history-tabs" role="tablist">
        <button class="history-tab ${topTab === "history" ? "active" : ""}" type="button" role="tab" aria-selected="${topTab === "history"}" data-action="history-tab" data-tab="history">${translating ? "最近翻译" : "历史记录"} (${items.length + revThreads.length})</button>
        <button class="history-tab ${topTab === "wordbooks" ? "active" : ""}" type="button" role="tab" aria-selected="${topTab === "wordbooks"}" data-action="history-tab" data-tab="wordbooks">词汇书库 (${wbStats.uniqueWords})</button>
      </div>`;

    let bodyHtml = "";
    if (topTab === "wordbooks") {
      bodyHtml = renderWordbooksPanel();
    } else {
      const subPills = !translating ? `
        <div class="wb-sub-pills" role="tablist">
          <button class="wb-sub-pill${subTab === "recent" ? " active" : ""}" type="button" data-action="history-subtab" data-subtab="recent">最近查询 (${items.length})</button>
          <button class="wb-sub-pill${subTab === "reverse" ? " active" : ""}" type="button" data-action="history-subtab" data-subtab="reverse">寻词记录 (${revThreads.length})</button>
        </div>` : "";

      const recentBody = items.length ? `
        <div class="history-list">
          ${items.map((item) => `
            <button class="history-item" type="button" data-action="history-item" data-query="${attr(item.query)}" data-type="${attr(item.type)}">
              <span class="history-icon ${item.type === "sentence" ? "sentence" : item.type === "translation" ? "translation" : ""}">${item.type === "sentence" ? icon("sentence") : item.type === "translation" ? icon("sparkle") : icon("book")}</span>
              <span class="history-copy">
                <strong>${esc(shorten(item.query, 44))}</strong>
                <span>${item.type === "sentence" ? "句子" : item.type === "translation" ? "翻译" : "单词"} · ${esc(timeAgo(item.at))}</span>
              </span>
            </button>`).join("")}
        </div>
        <div class="settings-actions">
          <button class="btn btn-secondary" type="button" data-action="clear-history" data-scope="${translating ? "translation" : "dictionary"}">${icon("trash")} ${translating ? "清空翻译记录" : "清空词典记录"}</button>
        </div>` : `
        <div class="history-empty">${translating ? "还没有翻译记录。<br />译一句，它会在这里等你。" : "还没有查询记录。<br />查一个词，它会在这里等你。"}</div>`;

      const reverseBody = revThreads.length ? `
        <div class="history-list">
          ${revThreads.map((entry) => {
            const turns = Math.max(1, Math.ceil((entry.messages?.length || 0) / 2));
            const isCurrent = state.route?.name === "reverse" && state.reverseThreadId === entry.id;
            return `
              <div class="saved-row">
                <button class="history-item saved-item-btn${isCurrent ? " is-current" : ""}" type="button" data-action="reverse-open-thread" data-id="${attr(entry.id)}">
                  <span class="history-icon">${icon("sparkle")}</span>
                  <span class="history-copy">
                    <strong>${esc(shorten(entry.title || "语境寻词", 44))}</strong>
                    <span>${turns} 轮对话 · ${esc(timeAgo(entry.updatedAt || Date.now()))}${isCurrent ? " · 当前" : ""}</span>
                  </span>
                </button>
                <button class="saved-remove-btn" type="button" data-action="reverse-delete-thread" data-id="${attr(entry.id)}" aria-label="删除对话" title="删除对话">×</button>
              </div>`;
          }).join("")}
        </div>
        <div class="settings-actions">
          <button class="btn btn-secondary" type="button" data-action="clear-reverse-threads">${icon("trash")} 清空寻词记录</button>
        </div>` : `
        <div class="history-empty">还没有语境寻词记录。<br />问一次 AI，对话会自动留在这里。</div>`;

      bodyHtml = `${subPills}${subTab === "reverse" && !translating ? reverseBody : recentBody}`;
    }

    holder.innerHTML = `<div class="sheet-content">${topTabsHtml}${bodyHtml}</div>`;
    const fileInput = $("#wb-import-file", holder);
    if (fileInput) {
      fileInput.addEventListener("change", async () => {
        const f = fileInput.files?.[0];
        if (!f || !window.TALK_WORDBOOKS) return;
        try {
          const text = await f.text();
          const res = window.TALK_WORDBOOKS.importData(text, activeWordbookId || window.TALK_WORDBOOKS.DEFAULT_BOOK_ID);
          syncSavedFromWordbooks();
          wordbookImportOpen = false;
          wordbookAuditNote = `导入核对：导入前 ${res.before.uniqueWords} 词 → 导入后 ${res.after.uniqueWords} 词（新增 ${res.added}，去重跳过 ${res.skipped}）`;
          renderHistoryContent();
          toast(`已导入 ${res.added} 词`);
        } catch (err) {
          toast(err?.message || "文件读取失败");
        }
      });
    }
  }

  function openHistorySheet(defaultTab) {
    syncSavedFromWordbooks();
    const translating = state.module === "translator";
    if (defaultTab === "saved" || defaultTab === "wordbooks") {
      historySheetTab = "wordbooks";
    } else if (defaultTab === "reverse") {
      historySheetTab = "history";
      historySubTab = "reverse";
    } else if (defaultTab === "recent" || defaultTab === "history") {
      historySheetTab = "history";
      historySubTab = "recent";
    } else if (state.module === "reader" && state.saved.length) {
      historySheetTab = "wordbooks";
    } else {
      historySheetTab = "history";
    }
    wordbookImportOpen = false;
    openSheetShell({
      kicker: translating ? "TRANSLATION" : "ARCHIVE",
      title: translating ? "最近翻译" : "历史与书库"
    });
    renderHistoryContent();
  }

  function updateWordbookImportHint() {
    const field = $("#wb-import-textarea");
    const hint = $("#wb-import-hint");
    if (!field || !hint) return;
    const length = field.value.length;
    if (length <= 6000) {
      hint.textContent = "";
      hint.hidden = true;
      return;
    }
    hint.hidden = false;
    hint.textContent = `AI 提取只读前 6,000 字：将截断 ${(length - 6000).toLocaleString()} 字（其余内容仍会导入）。`;
  }

  const actions = {
    history({ event }) {
      event.preventDefault();
      tapFeedback();
      openHistorySheet();
    },
    "history-item"({ event, target }) {
      event.preventDefault();
      closeSheet({ immediate: true });
      if (target.dataset.type === "translation") {
        const text = String(target.dataset.query || "").trim();
        navigate({ name: "translator", text });
        return;
      }
      runSearch(target.dataset.query || "", target.dataset.type || "auto");
    },
    "history-tab"({ event, target }) {
      event.preventDefault();
      historySheetTab = target.dataset.tab === "wordbooks" ? "wordbooks" : "history";
      wordbookAuditNote = "";
      renderHistoryContent();
    },
    "history-subtab"({ event, target }) {
      event.preventDefault();
      historySubTab = target.dataset.subtab === "reverse" ? "reverse" : "recent";
      renderHistoryContent();
    },
    "wb-toggle-menu"({ event }) {
      event.preventDefault();
      wordbookMenuOpen = !wordbookMenuOpen;
      renderHistoryContent();
    },
    "wb-dismiss-audit"({ event }) {
      event.preventDefault();
      wordbookAuditNote = "";
      renderHistoryContent();
    },
    "wb-open-book"({ event, target }) {
      event.preventDefault();
      activeWordbookId = target.dataset.bookId || window.TALK_WORDBOOKS?.DEFAULT_BOOK_ID || null;
      wordbookMenuOpen = false;
      wordbookImportOpen = false;
      wordbookAuditNote = "";
      renderHistoryContent();
    },
    "wb-back-shelf"({ event }) {
      event.preventDefault();
      activeWordbookId = null;
      wordbookImportOpen = false;
      wordbookMenuOpen = false;
      wordbookAuditNote = "";
      renderHistoryContent();
    },
    "wb-create-book"({ event }) {
      event.preventDefault();
      const name = window.prompt("新建主题词汇书名称（如：科技与产品、外刊高频）");
      if (!name || !name.trim() || !window.TALK_WORDBOOKS) return;
      const created = window.TALK_WORDBOOKS.createBook(name.trim());
      if (created) {
        activeWordbookId = created.id;
        renderHistoryContent();
        toast(`已新建「${created.name}」`);
      }
    },
    "wb-rename-book"({ event, target }) {
      event.preventDefault();
      wordbookMenuOpen = false;
      const bid = target.dataset.bookId;
      const book = window.TALK_WORDBOOKS?.getBook(bid);
      if (!book || book.system) return;
      const next = window.prompt("重命名词汇书", book.name);
      if (next && next.trim() && window.TALK_WORDBOOKS.renameBook(bid, next.trim())) {
        renderHistoryContent();
        toast("已重命名");
      }
    },
    "wb-delete-book"({ event, target }) {
      event.preventDefault();
      wordbookMenuOpen = false;
      const bid = target.dataset.bookId;
      const book = window.TALK_WORDBOOKS?.getBook(bid);
      if (!book || book.system) return;
      if (!window.confirm(`删除「${book.name}」？里面的 ${book.items.length} 个词会自动退回「密集书库」，不会丢失。`)) return;
      const res = window.TALK_WORDBOOKS.deleteBook(bid, { rescueToDense: true });
      if (res.ok) {
        syncSavedFromWordbooks();
        activeWordbookId = null;
        wordbookAuditNote = `已删除分册，${res.rescued} 个词已安全退回「密集书库」（0 丢失）`;
        renderHistoryContent();
      }
    },
    "wb-import-open"({ event }) {
      event.preventDefault();
      wordbookImportOpen = true;
      wordbookMenuOpen = false;
      renderHistoryContent();
    },
    "wb-import-close"({ event }) {
      event.preventDefault();
      wordbookImportOpen = false;
      renderHistoryContent();
    },
    "wb-import-submit"({ event }) {
      event.preventDefault();
      const ta = $("#wb-import-textarea");
      const raw = ta ? ta.value : "";
      if (!raw.trim() || !window.TALK_WORDBOOKS) {
        toast("请先粘贴词表或选择文件");
        return;
      }
      const res = window.TALK_WORDBOOKS.importData(raw, activeWordbookId || window.TALK_WORDBOOKS.DEFAULT_BOOK_ID);
      if (res?.storageFull) {
        toast("存储空间不够导入这些词：先导出 JSON 备份，再删掉一些词条。");
        return;
      }
      syncSavedFromWordbooks();
      wordbookImportOpen = false;
      wordbookAuditNote = `导入核对：导入前 ${res.before.uniqueWords} 词 → 导入后 ${res.after.uniqueWords} 词（新增 ${res.added}，去重跳过 ${res.skipped}）`;
      renderHistoryContent();
      toast(`已导入 ${res.added} 词`);
    },
    async "wb-import-extract"({ event }) {
      event.preventDefault();
      if (wordbookExtracting) return;
      const ta = $("#wb-import-textarea");
      const raw = ta ? ta.value.trim() : "";
      if (!raw || !window.TALK_WORDBOOKS) {
        toast("请先粘贴一段包含英文词句的文本");
        return;
      }
      if (!hasModelConfig()) {
        toast("请先在设置中配置模型 API");
        return;
      }
      wordbookExtracting = true;
      renderHistoryContent();
      try {
        const aiRes = await callWordbookAi("extract", { text: raw.slice(0, 6000) });
        const extracted = Array.isArray(aiRes?.words)
          ? aiRes.words.map((w) => String(w || "").trim()).filter(Boolean)
          : [];
        if (!extracted.length) {
          toast("未从文本中提取到可收录的英文词条");
        } else {
          const res = window.TALK_WORDBOOKS.importData(
            extracted.join("\n"),
            activeWordbookId || window.TALK_WORDBOOKS.DEFAULT_BOOK_ID
          );
          if (res?.storageFull) {
            toast("存储空间不够导入这些词：先导出 JSON 备份，再删掉一些词条。");
            return;
          }
          syncSavedFromWordbooks();
          wordbookImportOpen = false;
          const truncated = Math.max(0, raw.length - 6000);
          wordbookAuditNote = `AI 提取核对：导入前 ${res.before.uniqueWords} 词 → 导入后 ${res.after.uniqueWords} 词（提取 ${extracted.length}，新增 ${res.added}，去重跳过 ${res.skipped}）${truncated ? `；已按前 6,000 字提取，截断 ${truncated.toLocaleString()} 字` : ""}`;
          toast(`已提取并导入 ${res.added} 词`);
        }
      } catch (err) {
        toast(err?.message || "AI 提取失败，请重试");
      } finally {
        wordbookExtracting = false;
        renderHistoryContent();
      }
    },
    "wb-export-txt"({ event, target }) {
      event.preventDefault();
      wordbookMenuOpen = false;
      const bid = target.dataset.bookId;
      const book = window.TALK_WORDBOOKS?.getBook(bid);
      if (!book || !book.items.length) { toast("这本词册为空"); return; }
      downloadTextFile(window.TALK_WORDBOOKS.exportBookTxt(bid), `talk-${book.name}.txt`);
      toast(`已导出「${book.name}」${book.items.length} 词`);
    },
    "wb-export-json"({ event }) {
      event.preventDefault();
      wordbookMenuOpen = false;
      if (!window.TALK_WORDBOOKS) return;
      const json = window.TALK_WORDBOOKS.exportAllJson();
      const st = window.TALK_WORDBOOKS.stats();
      downloadTextFile(json, "talk-wordbooks-backup.json", "application/json;charset=utf-8");
      toast(`已导出 ${st.bookCount} 本词汇书（共 ${st.uniqueWords} 词）`);
    },
    "wb-remove-term"({ event, target }) {
      event.preventDefault();
      const term = target.dataset.term || "";
      const bid = target.dataset.bookId || "";
      if (!term || !window.TALK_WORDBOOKS) return;
      window.TALK_WORDBOOKS.removeTerm(term, bid || null);
      syncSavedFromWordbooks();
      renderHistoryContent();
      toast("已移出本册");
    },
    "wb-move-term"({ event, target }) {
      event.preventDefault();
      const term = target.dataset.term || "";
      const fromId = target.dataset.bookId || "";
      const wb = window.TALK_WORDBOOKS;
      if (!term || !fromId || !wb) return;
      const others = wb.listBooks().filter((b) => b.id !== fromId);
      if (!others.length) return;
      const menu = others.map((b, i) => `${i + 1}. ${b.name}`).join("\n");
      const pick = window.prompt(`把「${term}」移到哪本分册？请输入序号：\n${menu}`, "1");
      const idx = Number(pick) - 1;
      if (!Number.isInteger(idx) || !others[idx]) return;
      wb.moveTerm(term, fromId, others[idx].id);
      syncSavedFromWordbooks();
      renderHistoryContent();
      toast(`已移至「${others[idx].name}」`);
    },
    async "wb-ai-sort"({ event, target }) {
      event.preventDefault();
      wordbookMenuOpen = false;
      const bid = target.dataset.bookId;
      const wb = window.TALK_WORDBOOKS;
      const book = wb?.getBook(bid);
      if (!book || book.items.length < 2 || wordbookSorting) return;
      wordbookSorting = true;
      const beforeTotal = wb.stats().uniqueWords;
      const allWords = book.items.map((it) => it.term);
      const BATCH_SIZE = 60;
      const totalBatches = Math.ceil(allWords.length / BATCH_SIZE);
      let totalMoved = 0;
      const createdAll = new Set();
      wordbookAuditNote = `整理前 ${beforeTotal} 词 · 正在分批归类（1/${totalBatches}）…`;
      renderHistoryContent();
      try {
        for (let i = 0; i < totalBatches; i++) {
          const batchWords = allWords.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
          if (totalBatches > 1) {
            wordbookAuditNote = `整理前 ${beforeTotal} 词 · 正在分批归类（${i + 1}/${totalBatches}，共 ${allWords.length} 词）…`;
            renderHistoryContent();
          }
          const existingBooks = wb.listBooks().filter((b) => !b.system).map((b) => b.name);
          const aiRes = await callWordbookAi("classify", { existingBooks, words: batchWords });
          const audit = wb.applyAiClassification(bid, aiRes?.groups || []);
          totalMoved += audit.moved;
          audit.createdBooks.forEach((n) => createdAll.add(n));
          syncSavedFromWordbooks();
        }
        const afterTotal = wb.stats().uniqueWords;
        const remaining = wb.getBook(bid)?.items.length || 0;
        const lost = Math.max(0, beforeTotal - afterTotal);
        const createdList = [...createdAll];
        const newInfo = createdList.length ? ` · 新建「${createdList.slice(0, 6).join(" / ")}${createdList.length > 6 ? "…" : ""}」` : "";
        wordbookAuditNote = `整理核对：整理前 ${beforeTotal} 词 → 整理后 ${afterTotal} 词（归类 ${totalMoved}，留守 ${remaining}，丢失 ${lost}）${newInfo}`;
        toast("分册完成 · 0 丢失");
      } catch (err) {
        const afterTotal = wb.stats().uniqueWords;
        wordbookAuditNote = `分册中断（已完成部分已保存，当前全库 ${afterTotal}/${beforeTotal} 词）：${err?.message || "请求失败"}`;
      } finally {
        wordbookSorting = false;
        renderHistoryContent();
      }
    },
    "wb-to-reader"({ event, target }) {
      event.preventDefault();
      wordbookMenuOpen = false;
      const bid = target.dataset.bookId || "";
      window.__TALK_BRIDGE__?.openReaderWithBook?.(bid);
    },
    "saved-item"({ event, target }) {
      event.preventDefault();
      const raw = String(target.dataset.term || "").trim();
      if (!raw) return;
      const entry = parseSavedEntry(raw);
      if (!entry.text) return;
      closeSheet({ immediate: true });
      if (entry.kind === "sentence") runSearch(entry.text, "sentence");
      else if (entry.kind === "chunk") runSearch(entry.text, "chunk");
      else openWordLayer(entry.text, { relation: "收藏词册", origin: "收藏" });
    },
    "remove-saved"({ event, target }) {
      event.preventDefault();
      const raw = String(target.dataset.term || "").trim();
      const idx = findSavedIndex(raw);
      if (idx >= 0) {
        state.saved.splice(idx, 1);
      } else {
        const lower = raw.toLowerCase();
        state.saved = state.saved.filter((w) => String(w).toLowerCase() !== lower);
      }
      persistSaved();
      renderHistoryContent();
      if (state.route.name === "reader" && window.TALK_READER?.refreshTheme) {
        window.TALK_READER.refreshTheme();
      }
      toast("已移出收藏词册");
    },
    "export-saved"({ event }) {
      event.preventDefault();
      if (!state.saved.length) {
        toast("收藏词册为空");
        return;
      }
      downloadTextFile(
        state.saved.map((item) => parseSavedEntry(item).label).join("\n") + "\n",
        "talk-saved-words.txt"
      );
      toast(`已导出 ${state.saved.length} 条收藏`);
    },
    "clear-saved"({ event }) {
      event.preventDefault();
      state.saved = [];
      persistSaved();
      renderHistoryContent();
      if (state.route.name === "reader" && window.TALK_READER?.refreshTheme) {
        window.TALK_READER.refreshTheme();
      }
      toast("收藏词册已清空");
    },
    "clear-history"({ event, target }) {
      event.preventDefault();
      const scope = target.dataset.scope || "all";
      if (scope === "all") {
        state.history = [];
        toast("记录已清空");
      } else if (scope === "translation") {
        state.history = state.history.filter((item) => item.type !== "translation");
        toast("翻译记录已清空");
      } else {
        state.history = state.history.filter((item) => item.type === "translation");
        toast("词典记录已清空");
      }
      persistHistory();
      renderHistoryContent();
    }
  };

  return {
    openHistorySheet,
    renderHistoryContent,
    isTermLocallyCached,
    updateWordbookImportHint,
    actions
  };
}
