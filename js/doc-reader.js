/* talk. — 长文精读
 *
 * Drop a .md/.txt file (or paste text), get a two-stage study pass:
 * one docOverview call for the cover, then one docBlock call per passage with
 * at most three in flight. Everything is cached in IndexedDB so a reload
 * resumes exactly where it stopped.
 */
(function () {
  const DB_NAME = "talk.docs.v1";
  const DB_VERSION = 1;
  const CONCURRENCY = 4;
  const RETRIES = 1;
  const LEVELS = ["gaokao", "cet4", "cet6", "kaoyan", "ielts", "toefl", "advanced"];
  const FORMATS = {
    a4: { label: ["A4 竖版", "A4 portrait"], size: "A4 portrait", width: "210mm", height: "297mm", columns: 2, margin: "18mm 16mm 16mm" },
    a4l: { label: ["A4 横版", "A4 landscape"], size: "A4 landscape", width: "297mm", height: "210mm", columns: 3, margin: "14mm 14mm 12mm" },
    a5: { label: ["A5 小册", "A5 booklet"], size: "A5 portrait", width: "148mm", height: "210mm", columns: 2, margin: "14mm 12mm 12mm" },
    letter: { label: ["Letter", "Letter"], size: "Letter portrait", width: "216mm", height: "279mm", columns: 2, margin: "18mm 16mm 16mm" }
  };
  const FORMAT_KEY = "talk.reader.format.v1";
  const LEVEL_NAMES = {
    gaokao: "高考", cet4: "CET-4", cet6: "CET-6", kaoyan: "考研",
    ielts: "雅思", toefl: "托福", advanced: "精翻"
  };

  const S = {
    doc: null,
    overview: null,
    blocks: new Map(),
    runId: 0,
    controller: null,
    root: null,
    errors: [],
    status: "input",
    showCover: true,
    showFocus: true,
    showNotes: true,
    showAppendix: true,
    format: "a4",
    lastError: ""
  };

  let dbPromise = null;

  function formatOf() {
    return FORMATS[S.format] || FORMATS.a4;
  }

  function applyFormat() {
    const format = formatOf();
    document.documentElement.dataset.readerPaper = S.format;
    let style = document.getElementById("reader-page-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "reader-page-style";
      document.head.appendChild(style);
    }
    style.textContent = `@media print { @page { size: ${format.size}; margin: ${format.margin}; } }`;
    const sheet = document.querySelector(".reader-sheet");
    if (sheet) {
      sheet.style.setProperty("--reader-page-width", format.width);
      sheet.style.setProperty("--reader-page-height", format.height);
      sheet.style.setProperty("--reader-columns", String(format.columns));
    }
  }

  function setFormat(next) {
    if (!FORMATS[next]) return;
    S.format = next;
    try { localStorage.setItem(FORMAT_KEY, next); } catch (_) { /* no-op */ }
    applyFormat();
    renderShell();
  }

  function attr(value) {
    return esc(String(value ?? "")).replace(/"/g, "&quot;");
  }

  function wordsOf(text) {
    return String(text || "").trim().split(/\s+/).filter(Boolean).length;
  }

  function passageNumber(block) {
    const list = (S.doc?.blocks || []).filter((item) => item.type === "passage");
    return list.findIndex((item) => item.hash === block.hash) + 1;
  }

  function t(zh, en) {
    return window.TALK_LLM?.getLang?.() === "en" ? en : zh;
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs", { keyPath: "docHash" });
        if (!db.objectStoreNames.contains("blocks")) {
          const store = db.createObjectStore("blocks", { keyPath: "id" });
          store.createIndex("docHash", "docHash", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB 打开失败"));
    });
    return dbPromise;
  }

  async function idbGet(store, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, "readonly").objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function idbPut(store, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, "readwrite").objectStore(store).put(value);
      request.onsuccess = () => resolve(value);
      request.onerror = () => reject(request.error);
    });
  }

  async function idbDelete(store, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function blocksOf(docHash) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction("blocks", "readonly").objectStore("blocks").index("docHash").getAll(docHash);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  function level() {
    return window.TALK_LLM?.getLevel?.() || "gaokao";
  }

  function langSuffix() {
    return window.TALK_LLM?.getLang?.() === "en" ? "::en" : "";
  }

  function blockId(docHash, hash) {
    return `${docHash}:${hash}${langSuffix()}`;
  }

  /* ---------------- annotation ---------------- */

  function annotate(text, notes) {
    const source = String(text || "");
    const usable = (notes || [])
      .map((note) => ({ ...note, term: String(note.term || "").trim() }))
      .filter((note) => {
        if (!note.term) return false;
        const at = source.toLowerCase().indexOf(note.term.toLowerCase());
        return at >= 0;
      })
      .map((note) => ({ ...note, at: source.toLowerCase().indexOf(note.term.toLowerCase()) }))
      .sort((a, b) => a.at - b.at || b.term.length - a.term.length);

    const accepted = [];
    usable.forEach((note) => {
      const endsBefore = note.at;
      const endsAfter = note.at + note.term.length;
      const overlaps = accepted.some((other) => !(endsAfter <= other.at || endsBefore >= other.at + other.term.length));
      if (!overlaps) accepted.push(note);
    });
    if (!accepted.length) return { html: escapeParagraphs(source), marks: [] };

    const order = new Map(accepted.map((note, index) => [note.term.toLowerCase(), index + 1]));
    const marks = accepted.map((note, index) => ({ ...note, number: index + 1 }));
    const pattern = accepted
      .slice()
      .sort((a, b) => b.term.length - a.term.length)
      .map((note) => note.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    const regex = new RegExp(`(${pattern})`, "gi");
    let index = 0;
    let html = "";
    let match;
    while ((match = regex.exec(source))) {
      const found = match[0];
      const number = order.get(found.toLowerCase());
      html += escapeParagraphs(source.slice(index, match.index));
      if (number) {
        const note = marks[number - 1];
        html += `<span class="reader-term term-mark">${esc(found)}</span><sup class="reader-anchor" data-note="${number}" title="${esc(note.inContextZh || "")}">${number}</sup>`;
      } else {
        html += escapeParagraphs(found);
      }
      index = match.index + found.length;
    }
    html += escapeParagraphs(source.slice(index));
    return { html, marks };
  }

  function escapeParagraphs(text) {
    return esc(text).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");
  }

  /* ---------------- model calls ---------------- */

  async function ask(system, user, maxTokens) {
    const bridge = window.TALK_LLM;
    if (!bridge?.completeJSON) throw new Error(t("模型桥未就绪", "Model bridge is not ready"));
    const payload = { ...user };
    if (bridge.englishDirective?.()) {
      // The reader asks for Chinese study notes; honour an English UI by
      // asking for English prose without touching the JSON keys.
      payload._language = "en";
    }
    return bridge.completeJSON({ system, user: payload, maxTokens, signal: S.controller?.signal });
  }

  function normalizeOverview(raw) {
    if (!raw || typeof raw !== "object") throw new Error(t("导读结构不完整", "Overview missing"));
    return {
      titleZh: String(raw.titleZh || "").trim(),
      subtitle: String(raw.subtitle || "").trim(),
      genre: String(raw.genre || "").trim(),
      tone: String(raw.tone || "").trim(),
      summary: String(raw.summary || "").trim(),
      readingTips: Array.isArray(raw.readingTips) ? raw.readingTips.map(String).filter(Boolean) : [],
      glossary: Array.isArray(raw.glossary)
        ? raw.glossary.map((item) => ({ term: String(item?.term || ""), zh: String(item?.zh || ""), note: String(item?.note || "") })).filter((item) => item.term && item.zh)
        : []
    };
  }

  function normalizeBlock(raw) {
    if (!raw || typeof raw !== "object") throw new Error(t("精读结构不完整", "Block missing"));
    const notes = Array.isArray(raw.notes)
      ? raw.notes
          .map((note) => ({
            term: String(note?.term || "").trim(),
            pos: String(note?.pos || "").trim(),
            inContextZh: String(note?.inContextZh || "").trim(),
            nuance: String(note?.nuance || "").trim(),
            chunk: String(note?.chunk || "").trim()
          }))
          .filter((note) => note.term && note.inContextZh)
      : [];
    const focus = raw.focusSentence && typeof raw.focusSentence === "object"
      ? { en: String(raw.focusSentence.en || "").trim(), why: String(raw.focusSentence.why || "").trim() }
      : null;
    const sentences = Array.isArray(raw.sentences)
      ? raw.sentences
          .map((item) => ({
            en: String(item?.en || "").trim(),
            zh: String(item?.zh || "").trim(),
            role: String(item?.role || "").trim(),
            reading: String(item?.reading || "").trim()
          }))
          .filter((item) => item.en && item.zh)
      : [];
    const chunks = Array.isArray(raw.chunks)
      ? raw.chunks
          .map((item) => ({
            en: String(item?.en || "").trim(),
            zh: String(item?.zh || "").trim(),
            type: String(item?.type || "").trim()
          }))
          .filter((item) => item.en && item.zh)
      : [];
    const craft = raw.craft && typeof raw.craft === "object" && Array.isArray(raw.craft.devices)
      ? raw.craft.devices
          .map((item) => ({
            name: String(item?.name || "").trim(),
            en: String(item?.en || "").trim(),
            effect: String(item?.effect || "").trim()
          }))
          .filter((item) => item.name && item.effect)
      : [];
    return {
      translation: String(raw.translation || "").trim(),
      focusSentence: focus && focus.en ? focus : null,
      sentences,
      chunks,
      craft,
      notes
    };
  }

  /* ---------------- state helpers ---------------- */

  function progress() {
    const total = (S.doc?.blocks || []).filter((block) => block.type === "passage").length;
    let done = 0;
    (S.doc?.blocks || []).forEach((block) => {
      if (block.type !== "passage") return;
      if (S.blocks.has(blockId(S.doc.docHash, block.hash))) done += 1;
    });
    return { done, total };
  }

  function saveDoc(patch = {}) {
    if (!S.doc) return Promise.resolve();
    Object.assign(S.doc, patch, { updatedAt: Date.now() });
    return idbPut("docs", S.doc).catch(() => {});
  }

  /* ---------------- rendering ---------------- */

  function render(route) {
    const root = document.querySelector("[data-reader-root]");
    if (!root) return;
    S.root = root;
    if (route?.hash && (!S.doc || S.doc.docHash !== route.hash)) {
      S.status = "loading";
      renderShell();
      void loadDoc(route.hash);
      return;
    }
    if (!S.doc) { renderInput(); return; }
    renderShell();
  }

  async function loadDoc(docHash) {
    const doc = await idbGet("docs", docHash);
    if (!doc) {
      S.status = "missing";
      renderInput(t("没有找到这篇精读，可能已被清理。", "This reading is gone — it may have been cleared."));
      return;
    }
    S.doc = doc;
    S.overview = doc.overview || null;
    S.blocks = new Map();
    const stored = await blocksOf(docHash);
    stored.forEach((row) => S.blocks.set(row.id, row.result));
    S.status = S.overview && progress().done === progress().total ? "done" : "paused";
    renderShell();
    if (S.status !== "done") void runMissing();
  }

  function renderInput(message = "") {
    const root = S.root;
    if (!root) return;
    S.status = "input";
    root.innerHTML = `
      <div class="reader-input">
        <header class="reader-input-head">
          <p class="reader-kicker">${t("长文精读", "CLOSE READING")}</p>
          <h1>${t("丢一篇长文进来。", "Drop a long read here.")}</h1>
          <p class="reader-lede">${t("会先给一份导读，再逐段精翻、拆长难句、讲词眼，最后排成一份能打印的读物。", "A guide first, then a paragraph-by-paragraph translation with sentence work and word notes — printed as a reading sheet.")}</p>
        </header>
        <label class="reader-drop" data-reader-drop>
          <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" id="reader-file" hidden>
          <span class="reader-drop-icon" aria-hidden="true">↑</span>
          <strong>${t("选择 .md / .txt 文件", "Choose a .md / .txt file")}</strong>
          <span>${t("或把文件拖到这里，直接粘贴也可以", "or drop it here — pasting works too")}</span>
        </label>
        <textarea id="reader-text" class="reader-textarea" rows="10" placeholder="${t("把英文长文粘贴到这里…", "Paste the English text here…")}"></textarea>
        <div class="reader-input-foot">
          <span class="reader-level">${t("按", "Level")} ${LEVEL_NAMES[level()] || level()} ${t("取词", "")}</span>
          <button class="btn btn-primary" type="button" data-reader-action="start">${t("开始精读", "Start reading")}</button>
        </div>
        ${message ? `<p class="reader-error">${esc(message)}</p>` : ""}
        <p class="reader-note">${t("当前模型会收到 1 次导读请求与每段 1 次精读请求；中断后可以从断点继续。", "One guide call plus one call per passage; an interrupted run resumes where it stopped.")}</p>
      </div>`;
  }

  function renderShell() {
    const root = S.root;
    if (!root) return;
    if (!S.doc) { renderInput(); return; }
    const p = progress();
    const running = S.status === "running";
    const lang = window.TALK_LLM?.getLang?.() === "en" ? 1 : 0;
    const cover = S.overview ? coverHtml() : `<div class="reader-cover is-pending"><div class="reader-skeleton"></div><p>${t("正在写导读…", "Writing the guide…")}</p></div>`;
    const chip = (key, label) => `<button class="level-chip${S[key] ? " active" : ""}" type="button" data-reader-action="option" data-key="${key}" aria-pressed="${!!S[key]}">${label}</button>`;
    root.innerHTML = `
      <div class="reader-doc${S.focusEn ? " reader-focus-en" : ""}" id="reader-doc">
        <header class="reader-bar">
          <span class="reader-brand">talk<i>.</i></span>
          <button class="reader-bar-back" type="button" data-reader-action="back">← ${t("换一篇", "New text")}</button>
          <span class="reader-bar-progress mono">${p.done}/${p.total}</span>
          <button class="btn btn-primary reader-bar-export" type="button" data-reader-action="options">${t("导出 PDF", "Export PDF")}</button>
        </header>
        <div class="reader-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.done}"><i style="width:${p.total ? Math.round((p.done / p.total) * 100) : 0}%"></i><span class="reader-progress-label mono">${p.done}/${p.total} · ${p.total ? Math.round((p.done / p.total) * 100) : 0}%</span></div>
        ${running ? `<div class="reader-running"><span class="reader-typing"><i></i><i></i><i></i></span>${t("正在精读", "Reading")} ${p.done}/${p.total}${p.done < p.total ? ` · <button class="reader-inline-action" type="button" data-reader-action="pause">${t("暂停", "Pause")}</button>` : ""}</div>` : ""}
        ${!running && p.done < p.total ? `<div class="reader-running is-paused">${t("还有", "Still")} ${p.total - p.done} ${t("段没读", "passages left")} · <button class="reader-inline-action" type="button" data-reader-action="resume">${t("继续", "Resume")}</button></div>` : ""}
        <article class="reader-sheet${S.showCover ? "" : " hide-cover"}">
          ${cover}
          <main class="reader-body" data-reader-body>${bodyHtml()}</main>
          ${S.showAppendix ? appendixHtml() : ""}
        </article>
        ${S.errors.length ? `<p class="reader-error">${esc(S.errors.slice(-2).join("；"))}</p>` : ""}
        <div class="reader-options" data-reader-options hidden>
          <div class="reader-options-backdrop" data-reader-action="close-options"></div>
          <section class="reader-options-sheet" role="dialog" aria-label="${t("导出 PDF", "Export PDF")}">
            <header class="reader-options-head">
              <span class="mono">${t("导出 PDF", "EXPORT PDF")}</span>
              <button class="reader-options-close" type="button" data-reader-action="close-options" aria-label="${t("关闭", "Close")}">×</button>
            </header>
            <div class="reader-options-row">
              ${chip("showCover", t("封面", "Cover"))}
              ${chip("showFocus", t("长难句", "Hard sentence"))}
              ${chip("showNotes", t("词注", "Notes"))}
              ${chip("showAppendix", t("词汇总表", "Glossary"))}
              ${chip("focusEn", t("专注英文", "English only"))}
            </div>
            <label class="reader-format">
              <span>${t("纸型", "Paper")}</span>
              <select data-reader-format aria-label="${t("纸张与比例", "Paper size")}">
                ${Object.entries(FORMATS).map(([id, format]) => `<option value="${id}"${S.format === id ? " selected" : ""}>${format.label[lang]}</option>`).join("")}
              </select>
            </label>
            <button class="btn btn-primary reader-options-print" type="button" data-reader-action="print">${t("开始打印 / 存为 PDF", "Start printing / Save as PDF")}</button>
            <button class="btn btn-ghost reader-options-refresh" type="button" data-reader-action="refresh">${t("重新精读", "Re-read this text")}</button>
            <p class="reader-print-hint">${t("打印时请勾选「背景图形」，以保留主题纸底与高亮。", "In the print dialog, enable “Background graphics” to keep the paper and highlights.")}</p>
          </section>
        </div>
      </div>`;
    applyFormat();
  }

  function sheetMasthead() {
    const theme = window.TALK_THEME?.current?.() || {};
    return `<header class="masthead"><span class="brand-mark">talk.</span><span class="masthead-meta mono">${esc((theme.label || "Paper").toUpperCase())} · ${t("精读本", "READER")}</span></header>`;
  }

  function sheetFoot(page) {
    return `<footer class="sheet-foot"><span>${t("把词，看透。", "See a word through.")}</span><span class="sheet-foot-mono mono">WUNDERMIKU.GITHUB.IO/TALK · P.${String(page).padStart(2, "0")}</span></footer>`;
  }

  function secBar(num, title, sub) {
    return `<div class="sec-bar"><span class="sec-num">${esc(num)}</span><span class="sec-title">${esc(title)}</span><span class="sec-rule"></span><span class="sec-sub mono">${esc(sub)}</span></div>`;
  }

  function paragraphs(text) {
    return String(text || "").split(/\n{2,}/).map((chunk) => `<p>${esc(chunk.trim())}</p>`).join("");
  }

  function coverHtml() {
    const o = S.overview;
    const doc = S.doc;
    const count = doc.blocks.filter((b) => b.type === "passage").length;
    return `
      <article class="rv-sheet">
        ${sheetMasthead()}
        <div class="cover-genre">${esc(o.genre || t("精读", "Close reading"))} · ${esc(o.tone || "")}</div>
        <h1 class="cover-title-zh">${esc(o.titleZh)}</h1>
        ${doc.title ? `<p class="cover-title-en">${esc(doc.title)}</p>` : ""}
        ${o.subtitle ? `<p class="cover-subtitle">${esc(o.subtitle)}</p>` : ""}
        <div class="cover-stats mono">${doc.wordCount} ${t("词", "WORDS")} · ${count} ${t("节", "SECTIONS")} · ${t("按", "LEVEL")} ${esc(LEVEL_NAMES[doc.level] || doc.level)} ${t("取词", "")}</div>
        ${o.summary ? `${secBar("01", t("导读概览", "Overview"), t("PRE-READING", "PRE-READING"))}<div class="t-card"><span class="card-kicker">“ ${t("整篇主旨", "SUMMARY")}</span><p class="summary-prose">${esc(o.summary)}</p></div>` : ""}
        ${o.readingTips.length ? `${secBar("02", t("精读前提示", "Noticing cues"), t("NOTICING CUES", "NOTICING CUES"))}<ul class="tips-list">${o.readingTips.map((tip) => `<li>${esc(tip)}</li>`).join("")}</ul>` : ""}
        ${o.glossary.length ? `${secBar("03", t("全篇统一术语锚点", "Global glossary"), t("GLOBAL GLOSSARY", "GLOBAL GLOSSARY"))}<div class="glossary-grid">${o.glossary.map((item) => `<div class="gloss-item"><div class="gloss-head"><span class="gloss-en">${esc(item.term)}</span><span class="gloss-zh">${esc(item.zh)}</span></div>${item.note ? `<p class="gloss-note">${esc(item.note)}</p>` : ""}</div>`).join("")}</div>` : ""}
        ${sheetFoot(1)}
      </article>`;
  }

  function bodyHtml() {
    const doc = S.doc;
    const sheets = [];
    let current = null;
    (doc.blocks || []).forEach((block) => {
      if (block.type === "heading") {
        if (current && current.parts.length) sheets.push(current);
        current = { heading: block.text, parts: [] };
        return;
      }
      if (!current) current = { heading: "", parts: [] };
      current.parts.push(block);
    });
    if (current && current.parts.length) sheets.push(current);
    return sheets.map((sheet, index) => sectionSheetHtml(sheet, index + 1)).join("");
  }

  function sectionSheetHtml(sheet, sectionNo) {
    const words = sheet.parts.reduce((sum, block) => sum + (block.words || wordsOf(block.text)), 0);
    const title = sheet.heading || `${t("精读", "Reading")} ${String(sectionNo).padStart(2, "0")}`;
    const main = sheet.parts.map((block, partNo) => passageBodyHtml(block, partNo)).join("");
    const notes = sheet.parts.map((block, partNo) => notesColumnHtml(block, partNo)).join("");
    return `
      <article class="rv-sheet">
        ${sheetMasthead()}
        ${secBar(`§${sectionNo}`, title, `${words} WORDS`)}
        <div class="spread-grid">
          <div class="spread-main">
            ${sheet.heading && sheet.heading !== title ? `<h2 class="chapter-heading-en">${esc(sheet.heading)}</h2>` : ""}
            ${main}
          </div>
          ${notes ? `<aside class="sidenotes-col" aria-label="${attr(t("本节语境眉批", "Context notes"))}">${notes}</aside>` : ""}
        </div>
        ${sheetFoot(sectionNo + 1)}
      </article>`;
  }

  function passageBodyHtml(block, partNo) {
    const key = blockId(S.doc.docHash, block.hash);
    const result = S.blocks.get(key);
    const number = passageNumber(block);
    if (!result) {
      return `<div class="reader-part is-pending" data-reader-block="${number}"><div class="reader-skeleton"></div><p class="reader-pending-note">${t("这一节正在精读…", "Reading this section…")}</p></div>`;
    }
    if (result.error) {
      return `<div class="reader-part" data-reader-block="${number}"><p class="reader-error-line">${esc(result.error)}</p></div>`;
    }
    const sentences = Array.isArray(result.sentences) ? result.sentences : [];
    const chunks = Array.isArray(result.chunks) ? result.chunks : [];
    const craft = Array.isArray(result.craft) ? result.craft : [];
    return `
      <div class="reader-part" data-reader-block="${number}">
        <div class="en-prose">${String(annotate(block.text, result.notes || []).html || "").split(/\n{2,}/).filter(Boolean).map((para) => `<p>${para}</p>`).join("")}</div>
        ${result.translation ? `<div class="zh-trans-card"><span class="card-kicker">“ ${t("整段意译", "Translation")}</span><div class="zh-body">${paragraphs(result.translation)}</div></div>` : ""}
        ${sentences.length ? `<div class="pdf-block"><div class="pdf-head small"><b class="pdf-num">01</b><h2>${t("句子解读", "Sentence by sentence")}</h2><i></i></div><ol class="reader-sentences">${sentences.map((row, i) => `<li class="reader-sentence"><span class="pdf-tick mono">${String(i + 1).padStart(2, "0")}</span><p class="rs-en">${esc(row.en)}</p>${row.zh ? `<p class="rs-zh">${esc(row.zh)}</p>` : ""}${row.role ? `<p class="rs-role mono">${esc(row.role)}${row.reading ? ` · ${esc(row.reading)}` : ""}</p>` : ""}</li>`).join("")}</ol></div>` : ""}
        ${chunks.length ? `<div class="pdf-block"><div class="pdf-head small"><b class="pdf-num">02</b><h2>${t("意群分解", "Chunks")}</h2><i></i></div><div class="reader-chunks">${chunks.map((row) => `<div class="reader-chunk"><span class="rc-type mono">${esc(row.type)}</span><p class="rc-en">${esc(row.en)}</p>${row.zh ? `<p class="rc-zh">${esc(row.zh)}</p>` : ""}</div>`).join("")}</div></div>` : ""}
        ${craft.length ? `<div class="pdf-block"><div class="pdf-head small"><b class="pdf-num">03</b><h2>${t("句子刻画", "Craft")}</h2><i></i></div><div class="reader-craft">${craft.map((row) => `<div class="reader-craft-item"><span class="pdf-craft-name mono">${esc(row.name)}</span><p class="pdf-craft-en">${esc(row.en)}</p>${row.effect ? `<p class="pdf-craft-effect">${esc(row.effect)}</p>` : ""}</div>`).join("")}</div></div>` : ""}
        ${result.focusSentence?.en ? `<div class="focus-card"><span class="card-kicker">${t("焦点难句", "Hard sentence")}</span><p class="focus-en">${esc(result.focusSentence.en)}</p>${result.focusSentence.why ? `<p class="focus-why">${esc(result.focusSentence.why)}</p>` : ""}</div>` : ""}
      </div>`;
  }

  function notesColumnHtml(block, partNo) {
    const key = blockId(S.doc.docHash, block.hash);
    const result = S.blocks.get(key);
    if (!result || !result.notes?.length) return "";
    const source = String(block.text || "").toLowerCase();
    const notes = (result.notes || [])
      .filter((note) => source.includes(String(note.term || "").toLowerCase()))
      .slice()
      .sort((a, b) => source.indexOf(String(a.term).toLowerCase()) - source.indexOf(String(b.term).toLowerCase()));
    return notes.map((note, i) => `
      <div class="sidenote-item" data-note="${attr(note.term)}">
        <span class="sn-num">${i + 1}</span>
        <div>
          <div class="sn-head"><span class="sn-term">${esc(note.term)}</span>${note.pos ? `<span class="sn-pos">${esc(note.pos)}</span>` : ""}${note.inContextZh ? `<span class="sn-zh">${esc(note.inContextZh)}</span>` : ""}</div>
          ${note.nuance ? `<p class="sn-nuance">${esc(note.nuance)}</p>` : ""}
          ${note.chunk ? `<span class="sn-chunk">${esc(note.chunk)}</span>` : ""}
        </div>
      </div>`).join("");
  }

  function appendixHtml() {
    const seen = new Map();
    let passageNo = 0;
    (S.doc.blocks || []).forEach((block) => {
      if (block.type !== "passage") return;
      passageNo += 1;
      const result = S.blocks.get(blockId(S.doc.docHash, block.hash));
      if (!result) return;
      (result.notes || []).forEach((note) => {
        const key = note.term.toLowerCase();
        if (!seen.has(key)) seen.set(key, { note, blocks: [] });
        const row = seen.get(key);
        if (!row.blocks.includes(passageNo)) row.blocks.push(passageNo);
      });
    });
    if (!seen.size) return "";
    const rows = [...seen.values()].sort((a, b) => a.note.term.toLowerCase().localeCompare(b.note.term.toLowerCase()));
    return `
      <article class="rv-sheet reader-appendix">
        ${sheetMasthead()}
        ${secBar("§", t("词汇总表", "Glossary"), `${rows.length} ${t("条", "TERMS")}`)}
        <div class="glossary-grid">
          ${rows.map(({ note, blocks }) => `<div class="gloss-item"><div class="gloss-head"><span class="gloss-en">${esc(note.term)}</span>${note.pos ? `<span class="gloss-pos mono">${esc(note.pos)}</span>` : ""}<span class="gloss-zh">${esc(note.inContextZh)}</span><span class="gloss-ref mono">${blocks.map((n) => `§${n}`).join(" ")}</span></div>${note.nuance ? `<p class="gloss-note">${esc(note.nuance)}</p>` : ""}</div>`).join("")}
        </div>
        ${sheetFoot(99)}
      </article>`;
  }

  function updateBlock(block, result, number) {
    const doc = S.doc;
    const body = document.querySelector("[data-reader-body]");
    if (!body) return;
    const holder = document.createElement("div");
    holder.innerHTML = blockHtml(block, result, number);
    const next = holder.firstElementChild;
    const old = body.querySelector(`[data-reader-block="${number}"]`);
    if (old && old.parentNode) old.replaceWith(next);
    else body.appendChild(next);
  }

  /* ---------------- pipeline ---------------- */

  async function start(text, filename = "") {
    const root = S.root;
    if (!root) return;
    const parser = window.TALK_DOC_PARSER;
    if (!parser) { renderInput(t("解析器未加载", "Parser not loaded")); return; }
    S.runId += 1;
    const runId = S.runId;
    S.errors = [];
    S.lastError = "";
    S.blocks = new Map();
    S.status = "running";
    try {
      const parsed = await parser.parseText(text, { level: level() });
      if (!parsed.blocks.some((block) => block.type === "passage")) throw new Error(t("没有找到可精读的段落。", "No paragraphs to read."));
      S.doc = {
        docHash: parsed.docHash,
        title: parsed.title || filename || t("未命名长文", "Untitled"),
        wordCount: parsed.wordCount,
        level: parsed.level,
        blocks: parsed.blocks,
        markdown: parsed.markdown,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "running",
        overview: null
      };
      const cached = await idbGet("docs", parsed.docHash);
      if (cached?.overview) {
        S.doc.overview = cached.overview;
        S.overview = cached.overview;
      }
      const rows = await blocksOf(parsed.docHash);
      rows.forEach((row) => S.blocks.set(row.id, row.result));
      await idbPut("docs", S.doc);
      history.replaceState(history.state, "", `#/reader/${parsed.docHash}`);
      renderShell();
      await runMissing();
    } catch (error) {
      S.status = "input";
      renderInput(error.message || String(error));
    }
  }

  async function runMissing() {
    if (!S.doc) return;
    const doc = S.doc;
    S.status = "running";
    S.errors = [];
    S.runId += 1;
    const runId = S.runId;
    S.controller = new AbortController();
    renderShell();

    if (!S.overview) {
      try {
        const raw = await ask(window.TALK_PROMPTS.docOverview, {
          task: "docOverview",
          title: doc.title,
          excerpt: excerptOf(doc)
        }, 1800);
        S.overview = normalizeOverview(raw);
        doc.overview = S.overview;
        await saveDoc({ status: "running" });
        renderShell();
      } catch (error) {
        if (runId !== S.runId) return;
        S.errors.push(error.message || String(error));
        S.status = "paused";
        renderShell();
        return;
      }
    }

    const passages = doc.blocks.filter((block) => block.type === "passage");
    const pending = passages.filter((block) => !S.blocks.has(blockId(doc.docHash, block.hash)));
    const queue = pending.slice();
    let cursor = 0;

    const worker = async () => {
      while (cursor < queue.length) {
        if (runId !== S.runId) return;
        const block = queue[cursor];
        cursor += 1;
        const number = passages.indexOf(block) + 1;
        const key = blockId(doc.docHash, block.hash);
        let attempt = 0;
        let lastError = null;
        while (attempt <= RETRIES) {
          if (runId !== S.runId) return;
          try {
            const raw = await ask(window.TALK_PROMPTS.docBlock, {
              task: "docBlock",
              level: doc.level,
              globalContext: {
                tone: S.overview?.tone || "",
                glossary: (S.overview?.glossary || []).map((item) => ({ term: item.term, zh: item.zh }))
              },
              text: block.text
            }, 1800);
            const result = normalizeBlock(raw);
            S.blocks.set(key, result);
            await idbPut("blocks", { id: key, docHash: doc.docHash, blockHash: block.hash, result, savedAt: Date.now() });
            if (runId === S.runId) {
              updateBlock(block, result, number);
              paintProgress();
            }
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            attempt += 1;
            if (attempt > RETRIES) break;
            await new Promise((resolve) => setTimeout(resolve, 600));
          }
        }
        if (lastError && runId === S.runId) {
          S.errors.push(`${t("第", "Block")} ${number} ${t("段失败：", "failed: ")}${lastError.message || lastError}`);
          renderShell();
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, worker));
    if (runId !== S.runId) return;
    S.status = S.errors.length ? "paused" : "done";
    await saveDoc({ status: S.status });
    renderShell();
  }

  function excerptOf(doc) {
    const text = (doc.blocks || []).filter((block) => block.type === "passage").map((block) => block.text).join("\n\n");
    const words = text.split(/\s+/);
    return words.slice(0, 1200).join(" ");
  }

  function paintProgress() {
    const p = progress();
    document.querySelectorAll("[data-reader-progress]").forEach((el) => { el.textContent = `${p.done} / ${p.total}`; });
    const bar = document.querySelector(".reader-progress");
    if (bar) {
      const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
      bar.setAttribute("aria-valuenow", String(p.done));
      bar.setAttribute("aria-valuemax", String(p.total));
      const fill = bar.querySelector("i");
      if (fill) fill.style.width = `${pct}%`;
      const label = bar.querySelector(".reader-progress-label");
      if (label) label.textContent = `${p.done}/${p.total} · ${pct}%`;
    }
  }

  /* ---------------- events ---------------- */

  async function refreshDoc() {
    if (!S.doc) return;
    S.blocks = new Map();
    S.errors = [];
    S.overview = null;
    S.doc.overview = null;
    await idbDeleteBlocks(S.doc.docHash);
    await saveDoc({ status: "running" });
    renderShell();
    void runMissing();
  }

  function openOptions() {
    const sheet = S.root?.querySelector("[data-reader-options]");
    if (sheet) sheet.hidden = false;
    document.documentElement.classList.add("reader-options-open");
  }

  function closeOptions() {
    const sheet = S.root?.querySelector("[data-reader-options]");
    if (sheet) sheet.hidden = true;
    document.documentElement.classList.remove("reader-options-open");
  }

  function pause() {
    S.runId += 1;
    S.controller?.abort();
    S.status = "paused";
    renderShell();
  }

  async function pickText() {
    const area = document.getElementById("reader-text");
    const text = area?.value?.trim() || "";
    if (!text) return;
    await start(text);
  }

  async function openFile(file) {
    if (!file) return;
    try {
      const parsed = await window.TALK_DOC_PARSER.parseFile(file);
      await start(parsed.text, file.name);
    } catch (error) {
      const area = document.querySelector(".reader-input");
      if (area) {
        const note = document.createElement("p");
        note.className = "reader-error";
        note.textContent = error.message || String(error);
        area.appendChild(note);
      }
    }
  }

  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-reader-action]")?.dataset.readerAction;
    if (!action || !S.root) return;
    if (!S.root.contains(event.target) && action !== "print") return;
    event.preventDefault();
    if (action === "start") void pickText();
    else if (action === "back") { S.runId += 1; S.controller?.abort(); S.doc = null; S.overview = null; S.blocks = new Map(); history.replaceState(history.state, "", "#/reader"); renderInput(); }
    else if (action === "pause") pause();
    else if (action === "resume") void runMissing();
    else if (action === "options") openOptions();
    else if (action === "close-options") closeOptions();
    else if (action === "option") {
      const key = event.target.closest("[data-key]")?.dataset.key;
      if (key && key in S) { S[key] = !S[key]; renderShell(); openOptions(); }
    }
    else if (action === "refresh") { closeOptions(); void refreshDoc(); }
    else if (action === "print") { document.documentElement.classList.add("reader-printing"); window.print(); window.setTimeout(() => document.documentElement.classList.remove("reader-printing"), 800); }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target?.id === "reader-file") void openFile(target.files?.[0]);
    if (target?.dataset?.readerFormat !== undefined && target?.tagName === "SELECT") setFormat(target.value);
  });

  document.addEventListener("dragover", (event) => {
    const drop = event.target.closest?.("[data-reader-drop]");
    if (!drop) return;
    event.preventDefault();
    drop.classList.add("is-over");
  });

  document.addEventListener("drop", (event) => {
    const drop = event.target.closest?.("[data-reader-drop]");
    if (!drop) return;
    event.preventDefault();
    drop.classList.remove("is-over");
    const file = event.dataTransfer?.files?.[0];
    if (file) void openFile(file);
  });

  try {
    const saved = localStorage.getItem(FORMAT_KEY);
    if (saved && FORMATS[saved]) S.format = saved;
  } catch (_) { /* no-op */ }

  window.TALK_DOC_READER = { render, start, state: S };
})();
