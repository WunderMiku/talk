/* ============================================================
   talk. — Composed share image sheet (html-to-image + canvas fallback)
   ============================================================ */

import { $$, esc, shorten, posLabel, registerLabel } from "../core/utils.js";

export const SHARE_PICK_KEY = "talk.share.v1";

function wrapCanvasText(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const char of String(text || "")) {
    const next = line + char;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = char;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function shareCardCanvas(data) {
  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) => (styles.getPropertyValue(name) || fallback).trim();
  const paper = read("--paper", "#f6f1e7");
  const ink = read("--ink", "#171813");
  const accent = read("--lime", "#d9ff6b");
  const accentInk = read("--accent-ink", "#557000");
  const muted = read("--muted", "#6b6a5f");
  const family = read("--font", '"Inter", "Noto Sans SC", sans-serif');
  const mono = read("--mono", 'ui-monospace, "SFMono-Regular", monospace');

  const W = 1080;
  const H = 1350;
  const pad = 84;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, W, H);

  // header
  ctx.fillStyle = accent;
  ctx.fillRect(pad, 74, 44, 44);
  ctx.fillStyle = ink;
  ctx.font = `500 26px ${mono}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`TALK · ${data.theme}`.toUpperCase(), pad + 64, 108);
  ctx.textAlign = "right";
  ctx.fillStyle = muted;
  ctx.fillText(data.kind, W - pad, 108);
  ctx.textAlign = "left";

  // rule
  ctx.fillStyle = accentInk;
  ctx.fillRect(pad, 152, W - pad * 2, 3);

  // title
  let y = 320;
  const titleSize = data.kind === "句子" ? 66 : 104;
  ctx.fillStyle = ink;
  ctx.font = `800 ${titleSize}px ${family}`;
  const titleLines = wrapCanvasText(ctx, data.title, W - pad * 2).slice(0, 4);
  for (const line of titleLines) {
    ctx.fillText(line, pad, y);
    y += titleSize * 1.18;
  }

  // meta
  y += 10;
  ctx.font = `500 30px ${mono}`;
  ctx.fillStyle = muted;
  const meta = [data.phonetic, data.pos].filter(Boolean).join("  ·  ");
  if (meta) ctx.fillText(meta, pad, y);

  // translation
  y += 96;
  ctx.fillStyle = ink;
  ctx.font = `600 42px ${family}`;
  const trLines = wrapCanvasText(ctx, data.translation, W - pad * 2).slice(0, 3);
  for (const line of trLines) {
    ctx.fillText(line, pad, y);
    y += 62;
  }

  // note
  if (data.note) {
    y += 8;
    ctx.fillStyle = muted;
    ctx.font = `400 32px ${family}`;
    const noteLines = wrapCanvasText(ctx, data.note, W - pad * 2).slice(0, 3);
    for (const line of noteLines) {
      ctx.fillText(line, pad, y);
      y += 46;
    }
  }

  // example
  if (data.example) {
    y += 34;
    ctx.fillStyle = accent;
    ctx.fillRect(pad, y - 30, 6, 120);
    ctx.fillStyle = ink;
    ctx.font = `500 34px ${family}`;
    const exLines = wrapCanvasText(ctx, data.example, W - pad * 2 - 36).slice(0, 3);
    for (const line of exLines) {
      ctx.fillText(line, pad + 30, y);
      y += 48;
    }
    if (data.exampleZh) {
      ctx.fillStyle = muted;
      ctx.font = `400 28px ${family}`;
      const zh = wrapCanvasText(ctx, data.exampleZh, W - pad * 2 - 36).slice(0, 2);
      for (const line of zh) {
        ctx.fillText(line, pad + 30, y + 4);
        y += 42;
      }
    }
  } else if (data.senses?.length) {
    y += 6;
    ctx.font = `500 26px ${mono}`;
    data.senses.forEach((sense, index) => {
      ctx.fillStyle = accentInk;
      ctx.fillText(String(index + 1).padStart(2, "0"), pad, y);
      ctx.fillStyle = ink;
      ctx.font = `500 34px ${family}`;
      const lines = wrapCanvasText(ctx, sense, W - pad * 2 - 76).slice(0, 2);
      lines.forEach((line, lineIndex) => {
        ctx.fillText(line, pad + 66, y + lineIndex * 44);
      });
      y += 44 * lines.length + 26;
      ctx.font = `500 26px ${mono}`;
    });
  }

  // collocations & family
  if (data.collocations?.length) {
    y += 22;
    ctx.fillStyle = accentInk;
    ctx.font = `500 24px ${mono}`;
    ctx.fillText("搭配", pad, y);
    ctx.fillStyle = ink;
    ctx.font = `500 30px ${family}`;
    const text = data.collocations.join("  ·  ");
    const lines = wrapCanvasText(ctx, text, W - pad * 2 - 100).slice(0, 2);
    lines.forEach((line, index) => ctx.fillText(line, pad + 84, y + index * 40));
    y += 40 * lines.length + 14;
  }
  if (data.family?.length) {
    ctx.fillStyle = accentInk;
    ctx.font = `500 24px ${mono}`;
    ctx.fillText("同根", pad, y);
    ctx.fillStyle = ink;
    ctx.font = `500 30px ${family}`;
    ctx.fillText(data.family.join("  ·  "), pad + 84, y);
    y += 40;
  }

  // footer
  ctx.fillStyle = accentInk;
  ctx.fillRect(pad, H - 168, W - pad * 2, 2);
  ctx.fillStyle = ink;
  ctx.font = `700 40px ${family}`;
  ctx.fillText("把词，看透。", pad, H - 96);
  ctx.textAlign = "right";
  ctx.fillStyle = muted;
  ctx.font = `500 24px ${mono}`;
  ctx.fillText("wundermiku.github.io/talk", W - pad, H - 96);
  ctx.textAlign = "left";
  return canvas;
}

function savedSharePick() {
  try {
    const raw = JSON.parse(localStorage.getItem(SHARE_PICK_KEY) || "null");
    return Array.isArray(raw) ? raw.map(Number) : null;
  } catch (_) {
    return null;
  }
}

function defaultSharePick(sections) {
  const picked = [];
  for (const pattern of [/词义|释义/, /例句/]) {
    const hit = sections.find((section) => pattern.test(section.label) && !picked.includes(section.index));
    if (hit) picked.push(hit.index);
  }
  for (const section of sections) {
    if (picked.length >= 2) break;
    if (!picked.includes(section.index)) picked.push(section.index);
  }
  return picked;
}

function sharePickFor(sections) {
  const saved = savedSharePick();
  const valid = (saved || []).filter((index) => sections.some((section) => section.index === index));
  return valid.length ? valid : defaultSharePick(sections);
}

function shareChoicesHtml(sections, picked) {
  return sections.map((section) => `
      <label class="share-choice">
        <input type="checkbox" data-share-section="${section.index}" ${picked.includes(section.index) ? "checked" : ""} />
        <span>${esc(section.label)}</span>
      </label>`).join("");
}

export function createShareController({ state, screen, activeWordData, exampleForTheme, openSheetShell, toast }) {
  function sharePageData() {
    const route = state.route;
    const theme = window.TALK_THEME?.current?.() || { label: "Talk" };
    const topLayer = state.wordLayers[state.wordLayers.length - 1];
    if (topLayer?.kind === "sentence" && topLayer.data) {
      const sentence = topLayer.data;
      return {
        kind: "句子",
        title: shorten(sentence.text || "", 36),
        phonetic: "",
        pos: "",
        translation: sentence.translation || "",
        note: sentence.summary || sentence.tone || "",
        example: sentence.text || "",
        exampleZh: sentence.translation || "",
        senses: (sentence.keyWords || []).map((k) => `${k.word} · ${k.meaningZh || k.meaning || ""}`).slice(0, 3),
        theme: theme.label || "Talk"
      };
    }
    if (topLayer?.kind === "chunk" && topLayer.data) {
      const chunk = topLayer.data;
      const example = chunk.examples?.[0] || null;
      return {
        kind: "意群",
        title: chunk.chunk,
        phonetic: chunk.phonetic || "",
        pos: chunk.form || "",
        translation: chunk.translation || "",
        note: chunk.short || "",
        example: example?.en || "",
        exampleZh: example?.zh || "",
        senses: (chunk.senses || []).map((x) => x.zh).filter(Boolean).slice(0, 3),
        theme: theme.label || "Talk"
      };
    }
    if (state.wordLayers.length || route.name === "word") {
      const word = activeWordData();
      if (!word?.word) return null;
      const example = exampleForTheme(word) || word.examples?.[0] || null;
      return {
        kind: "单词",
        title: word.word,
        phonetic: word.phonetic || "",
        pos: posLabel(word.posGroups?.[0]?.pos || word.pos),
        translation: word.translation || "",
        note: word.short || "",
        example: example?.en || "",
        exampleZh: example?.zh || "",
        senses: (word.posGroups || []).flatMap((group) => group.senses || []).map((sense) => sense.zh).filter(Boolean).slice(0, 3),
        collocations: (word.collocations || []).map((item) => item.phrase || item.text || item).filter(Boolean).slice(0, 4),
        family: (word.family || []).map((item) => item.word).filter(Boolean).slice(0, 4),
        theme: theme.label || "Talk"
      };
    }
    if (route.name === "chunk") {
      const chunk = route.result;
      if (!chunk?.chunk) return null;
      const example = chunk.examples?.[0] || null;
      return {
        kind: "意群",
        title: chunk.chunk,
        phonetic: chunk.phonetic || "",
        pos: registerLabel(chunk.register) || "",
        translation: chunk.translation || "",
        note: chunk.short || "",
        example: example?.en || "",
        exampleZh: example?.zh || "",
        senses: (chunk.senses || []).map((sense) => sense.zh).filter(Boolean).slice(0, 3),
        collocations: (chunk.variants || []).map((item) => item.text || item).filter(Boolean).slice(0, 4),
        family: [],
        theme: theme.label || "Talk"
      };
    }
    if (route.name === "sentence") {
      const sentence = route.result;
      if (!sentence?.text) return null;
      return {
        kind: "句子",
        title: sentence.text,
        phonetic: "",
        pos: sentence.tone || "",
        translation: sentence.translation || "",
        note: sentence.syntax || "",
        example: "",
        exampleZh: "",
        senses: (sentence.keyWords || []).map((word) => `${word.word} · ${word.meaningZh || word.meaning || ""}`).slice(0, 3),
        collocations: [],
        family: [],
        theme: theme.label || "Talk"
      };
    }
    return null;
  }

  function activeShareScope() {
    if (state.wordLayers.length) return state.wordLayers[state.wordLayers.length - 1].el;
    return screen || document;
  }

  function shareHeroNode() {
    const scope = activeShareScope();
    if (state.wordLayers.length) {
      return scope.querySelector(".sentence-stage")
        || scope.querySelector(".sentence-line")
        || scope.querySelector(".chunk-hero")
        || scope.querySelector(".result-hero");
    }
    const route = state.route;
    const pick = (selector) => scope.querySelector(selector);
    if (route.name === "word") return pick(".result-hero");
    if (route.name === "chunk") return pick(".chunk-hero");
    if (route.name === "sentence") return pick(".sentence-stage") || pick(".sentence-line");
    return null;
  }

  // Every block on the page can go into the image; the reader decides which.
  function shareSections() {
    const scope = activeShareScope();
    return Array.from(scope.querySelectorAll(".result-page .block"))
      .filter((block) => block.querySelector(".block-head, .sentence-part-head"))
      .map((block, index) => {
        const head = block.querySelector(".block-head, .sentence-part-head");
        let label = `第 ${index + 1} 段`;
        if (head) {
          label = (head.querySelector("h2")?.textContent || head.textContent).replace(/\s+/g, " ").trim() || label;
        }
        return { index, label, node: block };
      });
  }

  async function buildShareImage(data, sections = []) {
    const route = state.route;
    const parts = [shareHeroNode(), ...sections].filter(Boolean);
    if (!parts.length) return null;
    const paper = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim() || "#f6f1e7";
    const theme = window.TALK_THEME?.current?.() || {};
    const stage = document.createElement("div");
    const topLayer = state.wordLayers[state.wordLayers.length - 1];
    const inLayer = Boolean(topLayer);
    const scope = inLayer
      ? (topLayer.kind === "chunk" ? "chunk-page" : topLayer.kind === "sentence" ? "sentence-page" : "result-page")
      : (route.name === "chunk" ? "chunk-page" : route.name === "sentence" ? "sentence-page" : "result-page");
    stage.className = `share-compose ${scope}`;
    stage.setAttribute("data-theme", theme.id || "");
    if (scope === "sentence-page") stage.setAttribute("data-view", "original");
    stage.innerHTML = `
      <div class="share-compose-brand">
        <span class="share-compose-logo">talk.</span>
        <span class="mono">${esc(theme.label || "Talk")} · ${esc(data.kind)}</span>
      </div>
      <div class="share-compose-body"></div>
      <div class="share-compose-foot">
        <span>把词，看透。</span>
        <span class="mono">wundermiku.github.io/talk</span>
      </div>`;
    const body = stage.querySelector(".share-compose-body");
    for (const node of parts) {
      const clone = node.cloneNode(true);
      clone.querySelectorAll(".example-actions, .speak-btn, .copy-inline, .word-copy, .quote-mark, .example-quote, .example-toolbar, .chunk-toolbar, .sentence-tools, .page-actions, .reclassify").forEach((el) => el.remove());
      clone.querySelectorAll(".reveal, .is-in").forEach((el) => el.classList.remove("reveal", "is-in"));
      clone.classList.remove("reveal", "is-in");
      clone.style.opacity = "1";
      clone.style.transform = "none";
      clone.style.color = "var(--ink)";
      clone.querySelectorAll("*").forEach((el) => {
        el.style.animation = "none";
        el.style.opacity = "1";
        el.style.transform = "none";
        el.style.translate = "none";
        el.style.scale = "none";
      });
      clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
      body.appendChild(clone);
    }
    document.body.appendChild(stage);
    try {
      const width = 390;
      const canvas = await window.htmlToImage.toCanvas(stage, {
        width,
        height: stage.scrollHeight,
        pixelRatio: Math.min(3, 1080 / width),
        backgroundColor: paper,
        style: { transform: "none", margin: "0" }
      });
      return canvas;
    } catch (_) {
      return null;
    } finally {
      stage.remove();
    }
  }

  async function renderSharePreview(data, sections) {
    const body = document.getElementById("sheet-scroll");
    if (!body) return;
    body.innerHTML = `
      <div class="share-sheet">
        <div class="share-loading"><span class="mono">正在排版分享图…</span></div>
        <div class="share-actions" hidden>
          <a class="btn btn-primary" data-share-save download="talk-${encodeURIComponent(data.title).slice(0, 24)}.png">保存图片</a>
          <button class="btn btn-secondary" type="button" data-action="share-native">系统分享</button>
          <button class="btn btn-ghost" type="button" data-action="share-adjust">调整内容</button>
        </div>
        <p class="share-hint">${esc(data.theme)} 主题 · ${esc(data.kind)}</p>
      </div>`;
    const canvas = window.htmlToImage ? await buildShareImage(data, sections) : shareCardCanvas(data);
    const sheet = body.querySelector(".share-sheet");
    if (!canvas) {
      if (sheet) sheet.innerHTML = `<p class="share-hint">这一页暂时生成不了分享图</p>`;
      return;
    }
    const url = canvas.toDataURL("image/png");
    state.shareUrl = url;
    if (!sheet) return;
    sheet.querySelector(".share-loading")?.remove();
    const actionsEl = sheet.querySelector(".share-actions");
    const hint = sheet.querySelector(".share-hint");
    const img = document.createElement("img");
    img.className = "share-card-img";
    img.alt = "分享图预览";
    img.src = url;
    img.width = canvas.width;
    img.height = canvas.height;
    sheet.insertBefore(img, actionsEl || hint);
    if (actionsEl) {
      actionsEl.hidden = false;
      const save = actionsEl.querySelector("[data-share-save]");
      if (save) save.href = url;
    }
  }

  function renderShareChooser() {
    const body = document.getElementById("sheet-scroll");
    const data = sharePageData();
    const sections = state.shareSections || [];
    if (!body || !data) return;
    body.innerHTML = `
      <div class="share-sheet">
        <p class="sheet-lead">挑几段放进图片；标题和释义始终保留。</p>
        <div class="share-choices">${shareChoicesHtml(sections, state.sharePicked || [])}</div>
        <button class="btn btn-primary" type="button" data-action="share-generate">生成分享图</button>
        <p class="share-hint">${esc(data.theme)} 主题 · ${esc(data.kind)}</p>
      </div>`;
  }

  async function openShareSheet() {
    const data = sharePageData();
    if (!data) {
      toast("这一页还没有可分享的内容");
      return;
    }
    const sections = shareSections();
    state.shareSections = sections;
    state.sharePicked = sharePickFor(sections);
    openSheetShell({ kicker: "分享这一页", title: data.title });
    const body = document.getElementById("sheet-scroll");
    if (!body) return;
    const nodes = sections.filter((section) => state.sharePicked.includes(section.index)).map((section) => section.node);
    renderSharePreview(data, nodes);
  }

  const actions = {
    "share-page": ({ event }) => {
      event.preventDefault();
      openShareSheet();
    },
    "share-generate": () => {
      const picked = $$("[data-share-section]:checked").map((input) => Number(input.dataset.shareSection));
      const data = sharePageData();
      if (!data) return;
      state.sharePicked = picked;
      try { localStorage.setItem(SHARE_PICK_KEY, JSON.stringify(picked)); } catch (_) { /* private mode */ }
      const sections = (state.shareSections || []).filter((section) => picked.includes(section.index)).map((section) => section.node);
      renderSharePreview(data, sections);
    },
    "share-adjust": () => {
      renderShareChooser();
    },
    "share-native": ({ event }) => {
      event.preventDefault();
      if (!state.shareUrl) return;
      (async () => {
        try {
          const blob = await (await fetch(state.shareUrl)).blob();
          const file = new File([blob], "talk-card.png", { type: "image/png" });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: "talk." });
            return;
          }
          toast("这台设备不支持系统分享，请用「保存图片」");
        } catch (_) {
          toast("分享没有完成，可以保存图片再发");
        }
      })();
    }
  };

  return {
    openShareSheet,
    renderShareChooser,
    renderSharePreview,
    actions
  };
}
