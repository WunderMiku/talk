/* ============================================================
   talk. — Word entry view, POS pager, theme examples & actions
   ============================================================ */

import {
  $,
  $$,
  esc,
  attr,
  rich,
  normalizeWord,
  blockHead,
  letterTitle,
  highlightPlain,
  registerLabel,
  posLabel,
  tagLabel
} from "../core/utils.js";
import { icon } from "../core/icons.js";
import { reclassifyRow } from "./status.js";

export function spellingBanner(spelling) {
  return `
      <aside class="spelling-banner reveal" style="--d:0" aria-label="拼写校正" title="${attr(spelling.note || "")}">
        <span class="spelling-label">拼写</span>
        <span class="spelling-wrong">${esc(spelling.input)}</span>
        <span class="spelling-arrow" aria-hidden="true">→</span>
        <span class="spelling-right">${esc(spelling.corrected)}</span>
      </aside>`;
}

/* Relation cards speak Chinese only. A model (or an older cached entry) may
   hand back an English definition; that is dropped rather than mixed in. */
export function relationGloss(item, data = window.TALK_DATA) {
  const zh = String(item?.zh || "").trim();
  if (/[\u3400-\u9fff]/.test(zh)) return zh;
  const stub = data?.lexicon?.[normalizeWord(item?.word || "")];
  if (stub?.zh) return stub.zh;
  // Demo corpus words carry their own Chinese translation; prefer it over an
  // English gloss so the offline cards read Chinese too.
  const entry = data?.words?.[normalizeWord(item?.word || "")];
  if (entry?.translation && /[\u3400-\u9fff]/.test(entry.translation)) return entry.translation;
  const gloss = String(item?.gloss || "").trim();
  return /[\u3400-\u9fff]/.test(gloss) ? gloss : "";
}

export function wordPosGroups(word) {
  const groups = Array.isArray(word.posGroups) ? word.posGroups.filter((group) => group && group.senses?.length) : [];
  return groups.length ? groups : [{ pos: word.pos || "", senses: word.senses || [] }];
}

export function genMetaText(gen) {
  const parts = [];
  const ms = Number(gen?.ms || 0);
  if (ms > 0) parts.push(`${Math.round(ms)} ms`);
  if (gen?.model) parts.push(String(gen.model));
  if (gen?.tokens != null && Number(gen.tokens) > 0) parts.push(`${Number(gen.tokens).toLocaleString("zh-CN")} tok`);
  return parts.join(" · ");
}

export function genMetaChipHtml(gen) {
  const text = genMetaText(gen);
  if (!text) return "";
  return `<span class="gen-meta" title="本次生成：耗时 · 模型 · token">${esc(text)}<button class="gen-meta-close" type="button" data-action="hide-gen-meta" aria-label="隐藏生成信息" title="关闭生成信息">×</button></span>`;
}

export function createWordView({
  state,
  screen,
  data,
  reduceMotion,
  backTopbar,
  layerTopbar,
  isSavedKey,
  hasModelConfig,
  exampleForTheme,
  themesMissingExamples,
  fillThemeExamples,
  activeWordData,
  getActiveSurface,
  removeWordRecord,
  deleteWordCacheFor,
  hydrateLayerWithModel,
  runSearch,
  scrollScreenTo,
  applyCacheDisplay,
  refreshCacheBorders,
  persistSettings,
  refreshThemedPage,
  closeTopWordLayer,
  goBack,
  toast
}) {
  function wordPosSwitchHtml(groups) {
    return `<div class="pos-switch" role="tablist" aria-label="词性">
      ${groups.map((group, index) => `<button class="pos-tab pos-pill ${index === 0 ? "active" : ""}" type="button" role="tab" aria-selected="${index === 0}" data-action="word-pos" data-index="${index}" title="${attr(posLabel(group.pos))}">${esc(posLabel(group.pos))}</button>`).join("")}
    </div>`;
  }

  function wordSensesPagerHtml(groups) {
    return `<div class="meaning-card meaning-pager" data-word-pos-index="0" data-pos-count="${groups.length}">
      <div class="meaning-track">
        ${groups.map((group, index) => `<section class="meaning-slide" data-pos="${attr(group.pos)}" data-pos-label="${attr(posLabel(group.pos))}" data-sense-count="${group.senses.length}" aria-hidden="${index === 0 ? "false" : "true"}">
          ${group.senses.map((sense, senseIndex) => `
            <div class="sense">
              <span class="sense-num">${String(senseIndex + 1).padStart(2, "0")}</span>
              <div>
                <p class="sense-zh">${esc(sense.zh || sense.en)}</p>
                ${sense.zh && sense.en ? `<p class="sense-en">${esc(sense.en)}</p>` : ""}
                ${sense.tag ? `<span class="micro-tag">${esc(tagLabel(sense.tag))}</span>` : ""}
              </div>
            </div>`).join("")}
        </section>`).join("")}
      </div>
      ${groups.length > 1 ? `<div class="meaning-pager-foot">
        <button class="meaning-pager-arrow" type="button" data-action="word-pos-prev" aria-label="上一组词义">‹</button>
        <span class="meaning-pager-dots" aria-hidden="true">${groups.map((_, index) => `<i class="${index === 0 ? "active" : ""}"></i>`).join("")}</span>
        <span class="meaning-pager-count" data-word-pos-label>1 / ${groups.length}</span>
        <button class="meaning-pager-arrow" type="button" data-action="word-pos-next" aria-label="下一组词义">›</button>
      </div>` : ""}
    </div>`;
  }

  function setWordPos(pager, index) {
    if (!pager) return;
    const slides = $$(".meaning-slide", pager);
    const count = slides.length;
    if (!count) return;
    const next = Math.max(0, Math.min(count - 1, Number(index) || 0));
    pager.dataset.wordPosIndex = String(next);
    const track = $(".meaning-track", pager);
    if (track) track.style.transform = `translateX(-${next * 100}%)`;
    slides.forEach((slide, slideIndex) => {
      slide.setAttribute("aria-hidden", slideIndex === next ? "false" : "true");
    });
    const page = pager.closest(".result-page");
    if (page) {
      $$(".pos-tab", page).forEach((tab) => {
        const active = Number(tab.dataset.index) === next;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
      });
    }
    $$(".meaning-pager-dots i", pager).forEach((dot, dotIndex) => {
      dot.classList.toggle("active", dotIndex === next);
    });
    const label = $("[data-word-pos-label]", pager);
    if (label) label.textContent = `${next + 1} / ${count}`;
  }

  function moveWordPos(pager, delta) {
    if (!pager) return;
    const current = Number(pager.dataset.wordPosIndex) || 0;
    setWordPos(pager, current + Number(delta || 0));
  }

  function wordPagerForTarget(target) {
    const page = target?.closest?.(".result-page");
    return page ? $(".meaning-pager", page) : null;
  }

  function exampleBlockHtml(word, no) {
    const exampleTheme = window.TALK_THEME?.current?.() || { id: "paper", label: "Paper" };
    const themedExamples = exampleForTheme(word, exampleTheme.id);
    if (!themedExamples.length) return "";
    return `
        <section class="block word-example-block reveal" data-block-no="${attr(no)}" style="--d:2.4">
          ${blockHead(no, "例句", `${themedExamples.length} 条`)}
          <div class="example-toolbar">
            <button class="link-btn" type="button" data-action="regen-examples" data-word="${attr(word.word)}">换一批</button>
          </div>
          ${themedExamples.map((example) => `
            <div class="example-card">
              <span class="example-quote">“</span>
              <p class="example-en">${highlightPlain(example.en, word.word)}</p>
              ${example.zh ? `<p class="example-zh">${esc(example.zh)}</p>` : ""}
              <div class="example-foot${example.source ? "" : " is-solo"}">
                ${example.source ? `<span class="example-source">${esc(example.source)}</span>` : ""}
                <div class="example-actions">
                  <button class="example-speak" type="button" data-action="speak" data-text="${attr(example.en)}" aria-label="朗读例句">${icon("volume")}</button>
                  <button class="example-speak example-copy" type="button" data-action="copy-text" data-copy="${attr(`${example.en}${example.zh ? `\n${example.zh}` : ""}`)}" aria-label="复制例句">${icon("copy")}</button>
                </div>
              </div>
            </div>`).join("")}
        </section>`;
  }

  function updateExamplesBlock(word) {
    if (!screen || state.route?.name !== "word") return false;
    // A slow theme-example refill must not overwrite another word's page.
    if (normalizeWord(state.route.word) !== normalizeWord(word.word)) return false;
    const section = $(".word-example-block", screen);
    const no = section?.dataset?.blockNo;
    if (!section || !no) return false;
    const scroll = screen.scrollTop;
    const html = exampleBlockHtml(word, no);
    if (!html) {
      section.remove();
    } else {
      const holder = document.createElement("div");
      holder.innerHTML = html;
      holder.querySelectorAll(".reveal, .reveal-item").forEach((node) => node.classList.add("is-in"));
      const next = holder.firstElementChild;
      if (next) section.replaceWith(next);
      else section.outerHTML = html;
    }
    scrollScreenTo(scroll, true);
    applyCacheDisplay();
    refreshCacheBorders(screen);
    window.TALK_I18N?.apply(screen);
    return true;
  }

  function glossOf(item) {
    return relationGloss(item, data);
  }

  function wordPage(word, layer = null) {
    const showGen = state.settings?.showGenMeta !== false;
    const gen = word.gen || null;
    const genChip = showGen && gen && !word.cached ? genMetaChipHtml(gen) : "";
    const genFooter = showGen && gen && word.cached ? `<p class="page-gen-note">By ${esc(gen.model || "—")}</p>` : "";
    let blockNo = 0;
    const nextNo = () => String(++blockNo).padStart(2, "0");
    const bookmark = `word:${normalizeWord(word.word)}`;
    const heroNote = word.note ? rich(word.note) : "";
    const header = layer
      ? layerTopbar({
          label: "词义探索",
          title: word.word,
          bookmark,
          origin: layer.origin,
          relation: layer.relation,
          depth: layer.depth
        })
      : backTopbar({ label: `单词 · ${word.level}`, title: word.word, bookmark, share: true });
    return `
      ${header}
      <main class="result-page">
        <section class="result-hero">
          ${word.spelling ? spellingBanner(word.spelling) : ""}
          <div class="result-kicker reveal" style="--d:0">
            <span class="kicker-pill accent">单词</span>
            <span class="kicker-pill">${esc(word.level)}</span>
            <span class="kicker-pill">${esc(registerLabel(word.register))}</span>
            <span class="cache-state-pill ${word.source === "demo" ? "is-builtin" : word.cached ? "is-cached" : "is-generated"}">${word.source === "demo" ? "内置词条" : word.cached ? "本机缓存" : "本次生成"}</span>${genChip ? `
            ${genChip}` : ""}
          </div>
          <h1 class="word-title" aria-label="${attr(word.word)}">${letterTitle(word.word)}</h1>
          <div class="word-subrow reveal" style="--d:1">
            <span class="ipa">${esc(word.phonetic || "—")}</span>
            <span class="dot-sep"></span>
            ${wordPosSwitchHtml(wordPosGroups(word))}
            <button class="speak-btn" type="button" data-action="speak" data-text="${attr(word.word)}">${icon("volume")} 发音</button>
            <button class="speak-btn speak-regen" type="button" data-action="regenerate-audio" data-text="${attr(word.word)}" title="跳过语音缓存，重新生成">${icon("refresh")}</button>
            <button class="speak-btn word-copy" type="button" data-action="copy-text" data-copy="${attr(word.word)}" aria-label="复制单词" title="复制单词">${icon("copy")}</button>
          </div>
          <div class="word-gloss-row reveal" style="--d:1.1">
            <p class="word-gloss">${esc(word.translation || word.short)}</p>
            <span class="word-gloss-tag">核心义</span>
          </div>
          ${word.translation && word.short ? `<p class="word-short reveal" style="--d:1.2">${esc(word.short)}</p>` : ""}
          ${heroNote ? `<div class="hero-note reveal" style="--d:1.5">
            ${icon("sparkle")}
            <span>${heroNote}</span>
          </div>` : ""}
          ${word.context ? `<div class="context-note reveal" style="--d:1.7">
            <span class="mono">在本句中</span>
            <p>${esc(word.context.meaningZh || word.context.meaning || "")}</p>
            ${word.context.meaningZh && word.context.meaning ? `<span class="context-note-en">${esc(word.context.meaning)}</span>` : ""}
            ${word.context.why ? `<span class="context-note-why">${esc(word.context.why)}</span>` : ""}
          </div>` : ""}
        </section>

        <section class="block word-meaning-block reveal" style="--d:1.8">
          ${(() => {
            const groups = wordPosGroups(word);
            const totalSenses = groups.reduce((sum, group) => sum + group.senses.length, 0);
            return `${blockHead(nextNo(), "词义", `${totalSenses} 个义项`)}${wordSensesPagerHtml(groups)}`;
          })()}
        </section>

        ${word.family.length ? `
        <section class="block word-family-block reveal" style="--d:2">
          ${blockHead(nextNo(), "同根词", "派生词")}
          <div class="h-scroll">
            ${word.family.map((item) => `
              <button class="family-card" type="button" data-action="word-layer" data-word="${attr(item.word)}" data-cache-word="${attr(item.word)}" data-gloss="${attr(glossOf(item))}" data-pos="${attr(item.pos)}" data-relation="同根词">
                <span class="family-top">
                  <span class="family-pos">${esc(posLabel(item.pos))}</span>
                  ${icon("arrowUpRight", "family-arrow")}
                </span>
                <strong class="family-word">${esc(item.word)}</strong>
                <span class="family-gloss">${esc(glossOf(item))}</span>
              </button>`).join("")}
          </div>
        </section>` : ""}

        ${(word.synonyms.length || word.antonyms.length) ? `
        <section class="block word-relation-block reveal" style="--d:2.2">
          ${blockHead(nextNo(), "近义与反义", "点击继续查")}
          <div class="relation-grid">
            <div class="relation-card syn">
              <div class="relation-head"><h3>近义词</h3><span class="relation-icon">+</span></div>
              <div class="rel-list">
                ${word.synonyms.map((item) => `
                  <button class="rel-chip" type="button" data-action="word-layer" data-word="${attr(item.word)}" data-cache-word="${attr(item.word)}" data-gloss="${attr(glossOf(item))}" data-pos="${attr(item.pos)}" data-relation="近义词">
                    <span class="rel-word">${esc(item.word)}</span>
                    <span class="rel-gloss">${esc(glossOf(item))}</span>
                  </button>`).join("")}
              </div>
            </div>
            <div class="relation-card ant">
              <div class="relation-head"><h3>反义词</h3><span class="relation-icon">−</span></div>
              <div class="rel-list">
                ${word.antonyms.map((item) => `
                  <button class="rel-chip" type="button" data-action="word-layer" data-word="${attr(item.word)}" data-cache-word="${attr(item.word)}" data-gloss="${attr(glossOf(item))}" data-pos="${attr(item.pos)}" data-relation="反义词">
                    <span class="rel-word">${esc(item.word)}</span>
                    <span class="rel-gloss">${esc(glossOf(item))}</span>
                  </button>`).join("")}
              </div>
            </div>
          </div>
        </section>` : ""}

        ${exampleBlockHtml(word, nextNo())}

        ${word.collocations.length ? `
        <section class="block word-collocation-block reveal" style="--d:2.6">
          ${blockHead(nextNo(), "常见搭配", "固定说法")}
          <div class="collocation-row">
            ${word.collocations.map((item) => `<button class="collocation" type="button" data-action="lookup" data-query="${attr(item)}" data-type="word">${esc(item)}</button>`).join("")}
          </div>
        </section>` : ""}

        ${word.memory ? `
        <section class="block word-memory-block reveal" style="--d:2.8">
          ${blockHead(nextNo(), "记法", "一个记忆钩子")}
          <div class="memory-card">
            <span class="memory-label">顺着这根线</span>
            <p class="memory-text">${rich(word.memory)}</p>
          </div>
        </section>` : ""}

        ${word.origin ? `
        <section class="block word-origin-block reveal" style="--d:3">
          ${blockHead(nextNo(), "词源与演变", "从词根看")}
          <div class="origin-card">
            <span class="origin-root">${esc(word.origin.root)}</span>
            <p class="origin-story">${rich(word.origin.story)}</p>
            ${word.origin.original ? `<p class="origin-original"><b>最初的意思</b> ${esc(word.origin.original)}</p>` : ""}
          </div>
          ${word.origin.stages.length ? `
          <div class="origin-timeline">
            ${word.origin.stages.map((stage) => `
              <div class="origin-stage">
                <span class="origin-when">${esc(stage.when)}</span>
                <div>
                  <strong class="origin-label">${esc(stage.label)}</strong>
                  <p class="origin-text">${esc(stage.text)}</p>
                </div>
              </div>`).join("")}
          </div>` : ""}
        </section>` : ""}

        ${word.related.length ? `
        <section class="block word-related-block reveal" style="--d:3.2">
          ${blockHead(word.origin ? "08" : "07", "继续漫游", "下一组词")}
          <div class="related-row">
            ${word.related.map((item) => `
              <button class="related-pill" type="button" data-action="word-layer" data-word="${attr(item)}" data-cache-word="${attr(item)}" data-relation="相关词">
                ${esc(item)} <span>↗</span>
              </button>`).join("")}
          </div>
        </section>` : ""}



        ${reclassifyRow("word")}
        <div class="page-actions reveal" style="--d:3.2">
          <button class="btn btn-primary${isSavedKey(bookmark) ? " is-saved" : ""}" type="button" data-action="save" data-save-label="收藏单词" aria-pressed="${isSavedKey(bookmark)}">${icon("bookmark")} ${isSavedKey(bookmark) ? "已收藏" : "收藏单词"}</button>
          ${hasModelConfig() ? `<button class="btn btn-secondary" type="button" data-action="ask-ai-about" data-kind="word" data-subject="${attr(word.word)}">${icon("sparkle")} 向 AI 提问</button>` : ""}
          <button class="btn btn-secondary" type="button" data-action="copy">${icon("copy")} 复制</button>
          ${hasModelConfig() ? `<button class="btn btn-secondary" type="button" data-action="regenerate-word">${icon("refresh")} 重新生成词条</button>` : ""}
          ${word.source !== "demo" ? `<button class="btn btn-secondary word-delete" type="button" data-action="delete-word-cache" data-word="${attr(word.word)}">${icon("trash")} 删除缓存</button>` : ""}
        </div>
        ${genFooter}
      </main>`;
  }

  const actions = {
    "word-pos"({ event, target }) {
      event.preventDefault();
      const pager = wordPagerForTarget(target);
      if (pager) {
        setWordPos(pager, Number(target.dataset.index) || 0);
        pager.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
      }
    },
    "word-pos-prev"({ event, target }) {
      event.preventDefault();
      moveWordPos(wordPagerForTarget(target), -1);
    },
    "word-pos-next"({ event, target }) {
      event.preventDefault();
      moveWordPos(wordPagerForTarget(target), 1);
    },
    async "regen-examples"({ event }) {
      event.preventDefault();
      const active = activeWordData();
      if (!active) return;
      if (!hasModelConfig()) {
        toast("先连接模型，才能按主题换例句。");
        return;
      }
      const themeId = window.TALK_THEME?.current?.().id || "paper";
      const needed = [themeId, ...themesMissingExamples(active).filter((id) => id !== themeId)];
      await fillThemeExamples(active, needed).catch(() => {});
      toast("已按当前主题换了一批例句");
    },
    async "regenerate-word"({ event }) {
      event.preventDefault();
      const surface = getActiveSurface();
      if (surface.kind !== "word" || !surface.query) return;
      const key = normalizeWord(surface.query);
      if (!key || !hasModelConfig()) return;
      await removeWordRecord(key);
      if (surface.isLayer) {
        surface.record.word = key;
        surface.record.data = null;
        await hydrateLayerWithModel(surface.record);
      } else {
        await runSearch(key, "word");
      }
    },
    async "delete-word-cache"({ event, target }) {
      event.preventDefault();
      const targetWord = target.dataset.word || "";
      if (!targetWord) return;
      if (!window.confirm("删除这个词的本地缓存？相关拼写也会一起删除。")) return;
      const removed = await deleteWordCacheFor(targetWord);
      toast(removed ? "已删除这条缓存" : "没有找到对应缓存");
      if (state.wordLayers.length) closeTopWordLayer();
      else goBack();
    },
    "hide-gen-meta"({ event }) {
      event.preventDefault();
      state.settings = { ...(state.settings || {}), showGenMeta: false };
      persistSettings(state.settings);
      refreshThemedPage();
    }
  };

  return {
    wordPosSwitchHtml,
    wordSensesPagerHtml,
    setWordPos,
    moveWordPos,
    wordPagerForTarget,
    exampleBlockHtml,
    updateExamplesBlock,
    wordPage,
    actions
  };
}
