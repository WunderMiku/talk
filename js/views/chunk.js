/* ============================================================
   talk. — Chunk (sense group) view & granularity actions
   ============================================================ */

import { esc, attr, rich, shorten, chunkSlug, blockHead, registerLabel } from "../core/utils.js";
import { icon } from "../core/icons.js";
import { reclassifyRow } from "./status.js";

export function createChunkView({
  state,
  copyFor,
  backTopbar,
  layerTopbar,
  isSavedKey,
  hasModelConfig,
  activeWordData,
  getActiveSurface,
  chunkCacheKey,
  removeWordRecord,
  hydrateChunkLayer,
  runSearch,
  closeTopWordLayer,
  toast
}) {
  function currentLookupText() {
    const route = state.route;
    if (route.name === "word") return activeWordData()?.word || route.word || "";
    if (route.name === "chunk") return route.result?.chunk || route.query || "";
    if (route.name === "sentence") return route.result?.text || route.query || "";
    if (route.name === "reverse") return route.result?.text || "";
    return route.query || "";
  }

  function chunkPage(chunk, layer = null) {
    let blockNo = 0;
    const nextNo = () => String(++blockNo).padStart(2, "0");
    const copy = copyFor("chunk");
    const sections = copy.sections || {};
    const formLabel = copy.forms?.[chunk.form] || "固定搭配";
    const bookmark = `chunk:${chunkSlug(chunk.chunk)}`;
    const note = chunk.note ? rich(chunk.note) : "";
    const cachePill = chunk.source === "demo"
      ? "内置意群"
      : chunk.cached
        ? "本机缓存"
        : "本次生成";
    const exampleRow = (item, index) => `
      <article class="chunk-example reveal" style="--d:0">
        <div class="chunk-example-head">
          <span class="chunk-example-index">${String(index + 1).padStart(2, "0")}</span>
          <p class="chunk-example-en"><span class="chunk-example-link" role="button" tabindex="0" data-action="example-lookup" data-text="${attr(item.en)}">${esc(item.en)}</span></p>
        </div>
        ${item.zh ? `<p class="chunk-example-zh">${esc(item.zh)}</p>` : ""}
        <div class="example-actions">
          <button class="example-speak" type="button" data-action="speak" data-text="${attr(item.en)}" aria-label="朗读例句">${icon("volume")}</button>
          <button class="example-speak example-copy" type="button" data-action="copy-text" data-copy="${attr(`${item.en}${item.zh ? `\n${item.zh}` : ""}`)}" aria-label="复制例句">${icon("copy")}</button>
        </div>
      </article>`;

    return `
      ${layer
        ? layerTopbar({
            label: `${copy.label || "意群"} · ${formLabel}`,
            title: shorten(chunk.chunk, 26),
            bookmark,
            origin: layer.origin,
            relation: layer.relation,
            depth: layer.depth
          })
        : backTopbar({ label: `${copy.label || "意群"} · ${formLabel}`, title: shorten(chunk.chunk, 26), bookmark, share: true })}
      <main class="result-page chunk-page">
        <section class="result-hero chunk-hero">
          <div class="result-kicker reveal" style="--d:0">
            <span class="kicker-pill accent">${esc(copy.label || "意群")}</span>
            <span class="kicker-pill">${esc(formLabel)}</span>
            <span class="kicker-pill">${esc(registerLabel(chunk.register))}</span>
            <span class="cache-state-pill ${chunk.cached ? "is-cached" : "is-generated"}">${esc(cachePill)}</span>
          </div>
          <h1 class="chunk-title reveal" style="--d:0.4">${esc(chunk.chunk)}</h1>
          <div class="word-subrow reveal" style="--d:1">
            <span class="ipa">${esc(chunk.phonetic || "—")}</span>
            <span class="dot-sep"></span>
            <button class="speak-btn" type="button" data-action="speak" data-text="${attr(chunk.chunk)}">${icon("volume")} 发音</button>
            <button class="speak-btn word-copy" type="button" data-action="copy-text" data-copy="${attr(chunk.chunk)}" aria-label="复制意群" title="复制意群">${icon("copy")}</button>
          </div>
          <div class="word-gloss-row reveal" style="--d:1.1">
            <p class="word-gloss">${esc(chunk.translation || chunk.chunk)}</p>
          </div>
          ${chunk.short ? `<p class="word-short reveal" style="--d:1.2">${esc(chunk.short)}</p>` : ""}
          ${note ? `<div class="hero-note reveal" style="--d:1.5">${note}</div>` : ""}
        </section>

        ${chunk.senses.length ? `
        <section class="block chunk-senses reveal" style="--d:1.8">
          ${blockHead(nextNo(), sections.senses?.[0] || "整体意思", sections.senses?.[1] || "")}
          <div class="sense-list">
            ${chunk.senses.map((sense) => `
              <article class="sense-card">
                <p class="sense-zh">${esc(sense.zh)}</p>
                ${sense.en ? `<p class="sense-en">${esc(sense.en)}</p>` : ""}
                ${sense.when ? `<p class="sense-when">${esc(sense.when)}</p>` : ""}
              </article>`).join("")}
          </div>
        </section>` : ""}

        ${chunk.keyWords.length ? `
        <section class="block chunk-keywords reveal" style="--d:2">
          ${blockHead(nextNo(), sections.keyWords?.[0] || "词眼", sections.keyWords?.[1] || "")}
          <div class="keyeye-row">
            ${chunk.keyWords.map((item) => `
              <button class="keyeye" type="button" data-action="word-layer"
                data-word="${attr(item.word)}" data-cache-word="${attr(item.word)}"
                data-gloss="${attr(item.gloss)}" data-pos="${attr(item.pos)}" data-relation="词眼">
                <span class="keyeye-word">${esc(item.word)}</span>
                <span class="keyeye-pos">${esc(item.pos || "—")}</span>
                <span class="keyeye-gloss">${esc(item.gloss)}</span>
                ${icon("arrowUpRight")}
              </button>`).join("")}
          </div>
        </section>` : ""}

        ${chunk.slots.length ? `
        <section class="block chunk-slots reveal" style="--d:2.2">
          ${blockHead(nextNo(), sections.slots?.[0] || "句法槽位", sections.slots?.[1] || "")}
          <div class="slot-list">
            ${chunk.slots.map((slot) => `
              <div class="slot-row">
                <code class="slot-code">${esc(slot.slot)}</code>
                <span class="slot-role">${esc(slot.role)}</span>
                ${slot.example ? `<p class="slot-example"><span>${esc(slot.example.en)}</span><em>${esc(slot.example.zh)}</em></p>` : ""}
              </div>`).join("")}
          </div>
        </section>` : ""}

        ${chunk.variants.length ? `
        <section class="block chunk-variants reveal" style="--d:2.4">
          ${blockHead(nextNo(), sections.variants?.[0] || "变形与替换", sections.variants?.[1] || "")}
          <div class="variant-list">
            ${chunk.variants.map((variant) => `
              <div class="variant-row">
                <p class="variant-form">${esc(variant.form)}</p>
                ${variant.example ? `<p class="variant-example"><span>${esc(variant.example.en)}</span><em>${esc(variant.example.zh)}</em></p>` : ""}
              </div>`).join("")}
          </div>
        </section>` : ""}

        ${chunk.origin ? `
        <section class="block chunk-origin reveal" style="--d:2.6">
          ${blockHead(nextNo(), sections.origin?.[0] || "来历", sections.origin?.[1] || "")}
          <div class="origin-story">
            ${chunk.origin.era ? `<span class="origin-era">${esc(chunk.origin.era)}</span>` : ""}
            <p>${esc(chunk.origin.story)}</p>
          </div>
        </section>` : ""}

        ${chunk.examples.length ? `
        <section class="block chunk-examples reveal" style="--d:2.8">
          ${blockHead(nextNo(), sections.examples?.[0] || "例句", sections.examples?.[1] || "")}
          <div class="chunk-example-list">
            ${chunk.examples.map(exampleRow).join("")}
          </div>
        </section>` : ""}

        ${reclassifyRow("chunk")}
        <div class="page-actions reveal" style="--d:3">
          <button class="btn btn-primary${isSavedKey(bookmark) ? " is-saved" : ""}" type="button" data-action="save" data-save-label="${attr(copy.bookmark || "收藏意群")}" aria-pressed="${isSavedKey(bookmark)}">${icon("bookmark")} ${isSavedKey(bookmark) ? "已收藏" : esc(copy.bookmark || "收藏意群")}</button>
          ${hasModelConfig() ? `<button class="btn btn-secondary" type="button" data-action="ask-ai-about" data-kind="chunk" data-subject="${attr(chunk.chunk)}">${icon("sparkle")} 向 AI 提问</button>` : ""}
          <button class="btn btn-secondary" type="button" data-action="copy">${icon("copy")} ${esc(copy.copy || "复制")}</button>
          ${hasModelConfig() ? `<button class="btn btn-secondary" type="button" data-action="regenerate-chunk">${icon("refresh")} 重新生成意群</button>` : ""}
          ${chunk.cached ? `<button class="btn btn-secondary word-delete" type="button" data-action="delete-chunk-cache">${icon("trash")} 删除缓存</button>` : ""}
        </div>
      </main>`;
  }

  const actions = {
    reclassify({ event, target }) {
      event.preventDefault();
      const paradigm = target.dataset.paradigm || "";
      const text = currentLookupText();
      if (!text || !paradigm) return;
      runSearch(text, paradigm);
    },
    async "regenerate-chunk"({ event }) {
      event.preventDefault();
      const surface = getActiveSurface();
      if (surface.kind !== "chunk" || !surface.query) return;
      await removeWordRecord(chunkCacheKey(surface.query));
      if (surface.isLayer) await hydrateChunkLayer(surface.record, surface.query);
      else runSearch(surface.query, "chunk", { skipCache: true });
    },
    async "delete-chunk-cache"({ event }) {
      event.preventDefault();
      const surface = getActiveSurface();
      if (surface.kind !== "chunk" || !surface.query) return;
      await removeWordRecord(chunkCacheKey(surface.query));
      toast("已删除这份意群缓存");
      if (surface.isLayer) closeTopWordLayer();
    },
    "example-lookup"({ event, target }) {
      event.preventDefault();
      const text = String(target.dataset.text || "").trim();
      if (text) void runSearch(text, "sentence");
    }
  };

  return {
    currentLookupText,
    chunkPage,
    actions
  };
}
