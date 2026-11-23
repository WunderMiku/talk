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
  const CONCURRENCY = 3;
  const RETRIES = 1;
  const LEVELS = ["gaokao", "cet4", "cet6", "kaoyan", "ielts", "toefl", "advanced"];
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
    lastError: ""
  };

  let dbPromise = null;

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
    const usable = (notes || [])
      .map((note) => ({ ...note, term: String(note.term || "").trim() }))
      .filter((note) => note.term && text.includes(note.term))
      .sort((a, b) => b.term.length - a.term.length);
    if (!usable.length) return { html: escapeParagraphs(text), marks: [] };

    const order = new Map();
    const marks = [];
    usable.forEach((note) => {
      if (!order.has(note.term)) {
        order.set(note.term, order.size + 1);
        marks.push(note);
      }
    });
    const pattern = usable.map((note) => note.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const regex = new RegExp(`(${pattern})`, "g");
    let index = 0;
    let html = "";
    let match;
    const takeOverlap = new Map();
    while ((match = regex.exec(text))) {
      const found = match[0];
      const note = usable.find((item) => item.term === found);
      html += escapeParagraphs(text.slice(index, match.index));
      if (note) {
        const number = order.get(note.term);
        html += `<sup class="reader-anchor" data-note="${number}" title="${esc(note.inContextZh || "")}">${number}</sup><span class="reader-term">${esc(found)}</span>`;
        takeOverlap.set(number, note);
      } else {
        html += escapeParagraphs(found);
      }
      index = match.index + found.length;
      if (regex.lastIndex === match.index) regex.lastIndex += 1;
    }
    html += escapeParagraphs(text.slice(index));
    return { html, marks: marks.filter((note) => takeOverlap.has(order.get(note.term))) };
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
    return { translation: String(raw.translation || "").trim(), focusSentence: focus && focus.en ? focus : null, notes };
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
    const doc = S.doc;
    const p = progress();
    const running = S.status === "running";
    const cover = S.overview ? coverHtml() : `<div class="reader-cover is-pending"><div class="reader-skeleton"></div><p>${t("正在写导读…", "Writing the guide…")}</p></div>`;
    root.innerHTML = `
      <div class="reader-doc" id="reader-doc">
        <div class="reader-toolbar" data-reader-toolbar>
          <button class="btn btn-ghost" type="button" data-reader-action="back">${t("换一篇", "New text")}</button>
          <span class="reader-progress" data-reader-progress>${p.done} / ${p.total}</span>
          <label class="reader-toggle"><input type="checkbox" data-reader-toggle="cover" ${S.showCover ? "checked" : ""}> ${t("封面", "Cover")}</label>
          <label class="reader-toggle"><input type="checkbox" data-reader-toggle="focus" ${S.showFocus ? "checked" : ""}> ${t("长难句", "Hard sentences")}</label>
          <label class="reader-toggle"><input type="checkbox" data-reader-toggle="notes" ${S.showNotes ? "checked" : ""}> ${t("词注", "Notes")}</label>
          ${running ? `<button class="btn btn-ghost" type="button" data-reader-action="pause">${t("暂停", "Pause")}</button>` : ""}
          ${!running && p.done < p.total ? `<button class="btn btn-ghost" type="button" data-reader-action="resume">${t("继续", "Resume")}</button>` : ""}
          <button class="btn btn-primary" type="button" data-reader-action="print">${t("打印 / PDF", "Print / PDF")}</button>
        </div>
        <article class="reader-sheet${S.showCover ? "" : " hide-cover"}">
          ${cover}
          <div class="reader-meta-line"><span>${doc.wordCount} ${t("词", "words")}</span><span>${p.done}/${p.total}</span><span>${t("按", "")} ${LEVEL_NAMES[doc.level] || doc.level} ${t("取词", "")}</span></div>
          <main class="reader-body" data-reader-body>${bodyHtml()}</main>
          ${S.showNotes ? appendixHtml() : ""}
        </article>
        ${S.errors.length ? `<p class="reader-error">${esc(S.errors.slice(-2).join("；"))}</p>` : ""}
      </div>`;
  }

  function coverHtml() {
    const o = S.overview;
    return `
      <header class="reader-cover">
        <p class="reader-kicker">${esc(o.genre || t("精读", "CLOSE READING"))} · ${esc(o.tone || "")}</p>
        <h1 class="reader-title">${esc(o.titleZh)}</h1>
        ${o.subtitle ? `<p class="reader-subtitle">${esc(o.subtitle)}</p>` : ""}
        <p class="reader-summary">${esc(o.summary)}</p>
        ${o.readingTips.length ? `<ul class="reader-tips">${o.readingTips.map((tip) => `<li>${esc(tip)}</li>`).join("")}</ul>` : ""}
        ${o.glossary.length ? `<div class="reader-glossary">${o.glossary.map((item) => `<span class="reader-gloss"><b>${esc(item.term)}</b>${esc(item.zh)}<i>${esc(item.note)}</i></span>`).join("")}</div>` : ""}
      </header>`;
  }

  function bodyHtml() {
    const doc = S.doc;
    let passageNo = 0;
    return (doc.blocks || []).map((block) => {
      if (block.type === "heading") {
        return `<h2 class="reader-heading">${esc(block.text)}</h2>`;
      }
      passageNo += 1;
      const key = blockId(doc.docHash, block.hash);
      const result = S.blocks.get(key);
      if (!result) return `<article class="reader-block is-pending" data-reader-block="${passageNo}"><div class="reader-block-head"><span>${String(passageNo).padStart(2, "0")}</span><i>${t("正在精读…", "Reading…")}</i></div><div class="reader-skeleton"></div></article>`;
      return blockHtml(block, result, passageNo);
    }).join("");
  }

  function blockHtml(block, result, number) {
    const { html, marks } = annotate(block.text, result.notes);
    const notes = (result.notes || []).map((note, i) => {
      const mark = marks.findIndex((item) => item.term === note.term) + 1;
      return `<li class="reader-note-item" id="rn-${number}-${i + 1}">${mark ? `<sup>${mark}</sup>` : `<sup class="is-muted">·</sup>`}<b>${esc(note.term)}</b><span class="reader-pos">${esc(note.pos)}</span><span class="reader-zh">${esc(note.inContextZh)}</span>${note.nuance ? `<i>${esc(note.nuance)}</i>` : ""}${note.chunk ? `<code>${esc(note.chunk)}</code>` : ""}</li>`;
    }).join("");
    return `
      <article class="reader-block" data-reader-block="${number}">
        <div class="reader-block-head"><span>${String(number).padStart(2, "0")}</span><i>${block.words} ${t("词", "words")}</i></div>
        <div class="reader-en"><p>${html}</p></div>
        ${result.translation ? `<div class="reader-translation"><p>${esc(result.translation)}</p></div>` : ""}
        ${S.showFocus && result.focusSentence ? `<aside class="reader-focus"><cite>${esc(result.focusSentence.en)}</cite>${result.focusSentence.why ? `<p>${esc(result.focusSentence.why)}</p>` : ""}</aside>` : ""}
        ${S.showNotes && notes ? `<ol class="reader-notes">${notes}</ol>` : ""}
      </article>`;
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
      <section class="reader-appendix">
        <h2>${t("词汇总表", "Glossary")}</h2>
        <ol class="reader-gloss-list">
          ${rows.map(({ note, blocks }) => `<li><b>${esc(note.term)}</b><span class="reader-pos">${esc(note.pos)}</span><span>${esc(note.inContextZh)}</span><i>${esc(note.nuance)}</i><span class="reader-ref">${blocks.map((n) => `§${n}`).join(" ")}</span></li>`).join("")}
        </ol>
      </section>`;
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
    const el = document.querySelector("[data-reader-progress]");
    if (el) el.textContent = `${p.done} / ${p.total}`;
  }

  /* ---------------- events ---------------- */

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
    else if (action === "print") { document.documentElement.classList.add("reader-printing"); window.print(); window.setTimeout(() => document.documentElement.classList.remove("reader-printing"), 800); }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target?.id === "reader-file") void openFile(target.files?.[0]);
    const toggle = target?.dataset?.readerToggle;
    if (toggle) {
      if (toggle === "cover") { S.showCover = target.checked; }
      if (toggle === "focus") { S.showFocus = target.checked; }
      if (toggle === "notes") { S.showNotes = target.checked; }
      renderShell();
    }
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

  window.TALK_DOC_READER = { render, start, state: S };
})();
