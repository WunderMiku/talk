/* ============================================================
   talk. — Nested exploration layers (word / chunk / sentence stack)
   ============================================================ */

import {
  $,
  $$,
  esc,
  shorten,
  normalizeWord,
  chunkSlug,
  tapFeedback
} from "../core/utils.js";
import { icon } from "../core/icons.js";
import { ensureWord, ensureChunk } from "../model/normalize.js";

export function uniqueWords(items, exclude = "") {
  const skip = normalizeWord(exclude);
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const word = typeof item === "string" ? item : item?.word;
    const key = normalizeWord(word);
    if (!key || key === skip || seen.has(key)) continue;
    seen.add(key);
    out.push(String(word));
  }
  return out;
}

function siblingsFor(data, exclude = "") {
  if (!data) return [];
  return uniqueWords([
    ...(data.family || []),
    ...(data.synonyms || []),
    ...(data.antonyms || []),
    ...(data.related || [])
  ], exclude).slice(0, 8);
}

export function createLayerController({
  state,
  layerRoot,
  data: DATA,
  reduceMotion,
  modelTimeoutText,
  layerTopbar,
  loadingBody,
  wordPage,
  chunkPage,
  sentencePage,
  getWord,
  getSentence,
  cacheGetWord,
  cacheGetChunk,
  cacheGetSentence,
  sentenceLevelOf,
  sentenceKey,
  activeProfile,
  applyProfileToSettings,
  hasModelConfig,
  lookupWordDeduped,
  modelLookup,
  addHistory,
  closeSheet,
  enhanceWordColumns,
  applyCacheDisplay,
  refreshCacheBorders,
  schedulePrefetch,
  updateCacheCorner,
  hideCacheCorner,
  updateScrollLock
}) {
  function currentLayerData() {
    if (state.wordLayers.length) return state.wordLayers[state.wordLayers.length - 1].data;
    if (state.route.name === "word") return getWord(state.route);
    return null;
  }

  function currentLayerOrigin() {
    if (state.wordLayers.length) return state.wordLayers[state.wordLayers.length - 1].word;
    if (state.route.name === "word") return getWord(state.route)?.word || "当前词条";
    if (state.route.name === "sentence") return "句子";
    return "Talk";
  }

  function sentenceSiblings(exclude = "") {
    const sentence = getSentence(state.route);
    return uniqueWords(sentence?.keyWords?.map((item) => item.word) || [], exclude).slice(0, 8);
  }

  function makeMiniWord(word, options, origin, relation) {
    const key = normalizeWord(word);
    const stub = DATA.lexicon[key] || {};
    const gloss = options.gloss || stub.gloss || "";
    const zh = options.zh || stub.zh || "";
    const context = options.context || null;
    const siblings = options.siblings || [];
    const shortMeaning = context?.meaning || gloss || "";
    const chineseMeaning = context?.meaningZh || zh || "";
    if (!shortMeaning && !chineseMeaning) return null;
    return ensureWord({
      word,
      phonetic: options.ipa || stub.phonetic || "",
      pos: options.pos || stub.pos || "",
      level: "—",
      register: "common",
      short: shortMeaning,
      translation: chineseMeaning || shortMeaning,
      note: context?.why || `来自 ${origin} 的${relation}。`,
      senses: [{
        zh: chineseMeaning || shortMeaning,
        en: shortMeaning,
        tag: "关联词"
      }],
      family: [],
      synonyms: [],
      antonyms: [],
      examples: [],
      collocations: [],
      related: siblings,
      origin: null,
      context
    });
  }

  function layerLoadingPage(word, origin, relation, depth) {
    return `
      ${layerTopbar({ title: word, origin, relation, depth })}
      ${loadingBody(word, "word", { statusText: "正在生成完整词条" })}`;
  }

  function layerConnectPage(word, origin, relation, depth) {
    return `
      ${layerTopbar({ title: word, origin, relation, depth })}
      <main class="result-page state-page layer-state">
        <div class="state-orb lavender reveal" style="--d:0">✦</div>
        <h1 class="state-title reveal" style="--d:0.3">还没生成过这个词。</h1>
        <p class="state-copy reveal" style="--d:0.5">Talk 的词义由模型实时生成。连接模型后，<b>${esc(word)}</b> 会补全中文释义、音标、同根词、近反义词和词源。</p>
        <span class="state-query reveal" style="--d:0.7">${esc(shorten(origin ? `来自 ${origin} · ${relation}` : relation, 70))}</span>
        <div class="state-actions reveal" style="--d:0.9">
          <button class="btn btn-primary" type="button" data-action="settings">${icon("wand")} 连接模型</button>
          <button class="btn btn-secondary" type="button" data-action="layer-back">返回</button>
        </div>
      </main>`;
  }

  function layerErrorPage(word, origin, relation, depth, message) {
    return `
      ${layerTopbar({ title: word, origin, relation, depth })}
      <main class="result-page state-page layer-state">
        <div class="state-orb coral reveal" style="--d:0">!</div>
        <h1 class="state-title reveal" style="--d:0.3">这一层没生成出来。</h1>
        <p class="state-copy reveal" style="--d:0.5">模型没有完成这个子词条。可以重试，或检查模型设置。</p>
        ${message ? `<div class="error-detail reveal" style="--d:0.7">${esc(shorten(message, 260))}</div>` : ""}
        <div class="state-actions reveal" style="--d:0.8">
          <button class="btn btn-primary" type="button" data-action="retry-layer">${icon("refresh")} 重试这一层</button>
          <button class="btn btn-secondary" type="button" data-action="settings">${icon("settings")} 模型设置</button>
        </div>
      </main>`;
  }

  let scrimRemoveTimer = 0;
  let clearAllLayersTimer = 0;

  function cancelLayerCleanupTimers() {
    if (scrimRemoveTimer) {
      window.clearTimeout(scrimRemoveTimer);
      scrimRemoveTimer = 0;
    }
    if (clearAllLayersTimer) {
      window.clearTimeout(clearAllLayersTimer);
      clearAllLayersTimer = 0;
    }
  }

  function ensureLayerScrim() {
    cancelLayerCleanupTimers();
    let scrim = $(".layer-scrim", layerRoot);
    if (!scrim) {
      scrim = document.createElement("div");
      scrim.className = "layer-scrim";
      layerRoot.appendChild(scrim);
      requestAnimationFrame(() => scrim.classList.add("show"));
    } else if (!scrim.classList.contains("show")) {
      requestAnimationFrame(() => scrim.classList.add("show"));
    }
    return scrim;
  }

  /**
   * Unified surface renderer shared by initial layer mount and async hydration.
   * Ensures data-page, reveal state, widescreen word columns, and cache borders
   * are always applied through one single code path.
   */
  function mountResultSurface(container, { kind = "word", content = "", animate = false } = {}) {
    if (!container) return;
    const holder = document.createElement("div");
    holder.innerHTML = content;
    holder.querySelectorAll(".reveal, .reveal-item").forEach((node) => node.classList.add("is-in"));
    container.replaceChildren(...holder.childNodes);
    if (kind === "word") enhanceWordColumns(container);
    applyCacheDisplay();
    refreshCacheBorders(container);
    container.scrollTop = 0;
    if (animate && !reduceMotion) {
      const first = $(".sheet-content, .result-page", container);
      if (first) {
        first.animate(
          [
            { opacity: 0, transform: "translateY(8px)" },
            { opacity: 1, transform: "translateY(0)" }
          ],
          { duration: 320, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
        );
      }
    }
  }

  /* Only the top layer is on screen; everything below it is a 14px strip of
     background. Emptying those pages keeps long "word chains" from piling up
     full entries in the document. The markup is kept on the record and put
     back when the user walks back up the stack. */
  function shelveLayersBelow() {
    if (!state.wordLayers.length) return;
    const top = state.wordLayers[state.wordLayers.length - 1];
    state.wordLayers.forEach((layer) => {
      if (layer === top || layer.shelved || layer.loading || !layer.data) return;
      const scroll = $(".layer-scroll", layer.el);
      if (!scroll) return;
      layer.scrollTop = scroll.scrollTop;
      scroll.replaceChildren();
      layer.shelved = true;
    });
  }

  function restoreLayerContent(record) {
    if (!record?.shelved) return;
    const scroll = $(".layer-scroll", record.el);
    if (!scroll) return;
    record.shelved = false;
    scroll.innerHTML = record.content || "";
    // The layer already played its entrance once; restoring it should not
    // replay a cascade the reader has already seen.
    scroll.querySelectorAll(".reveal, .reveal-item").forEach((element) => element.classList.add("is-in"));
    enhanceWordColumns(scroll);
    applyCacheDisplay();
    refreshCacheBorders(scroll);
    const offset = record.scrollTop || 0;
    scroll.scrollTop = offset;
    requestAnimationFrame(() => {
      scroll.scrollTop = offset;
    });
  }

  function mountWordLayer({ word, query, data, origin, relation, depth, content, options = {}, kind = "word" }) {
    cancelLayerCleanupTimers();
    const layerKind = kind || "word";
    const layer = document.createElement("section");
    layer.className = "word-layer";
    layer.dataset.page = layerKind;
    layer.dataset.layerKind = layerKind;
    layer.style.setProperty("--depth", String(depth));
    layer.style.zIndex = String(2 + depth);
    layer.tabIndex = -1;
    layer.setAttribute("role", "region");
    layer.setAttribute("aria-label", `${word} 词条，第 ${depth} 层`);
    const scroll = document.createElement("div");
    scroll.className = "layer-scroll";
    layer.appendChild(scroll);
    mountResultSurface(scroll, { kind: layerKind, content, animate: false });

    ensureLayerScrim();
    const previous = state.wordLayers[state.wordLayers.length - 1];
    if (previous) {
      previous.el.classList.add("is-behind");
      previous.el.setAttribute("aria-hidden", "true");
    }

    layerRoot.appendChild(layer);
    const record = {
      el: layer,
      kind: layerKind,
      word,
      query: query || word,
      content,
      data: data || null,
      origin,
      relation,
      depth,
      options,
      loading: !data,
      error: null
    };
    state.wordLayers.push(record);
    shelveLayersBelow();
    updateScrollLock();
    if (data && layerKind === "word") schedulePrefetch(data);
    else if (!data) updateCacheCorner(false, "正在生成本层词条");

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        layer.classList.add("is-open");
        layer.focus({ preventScroll: true });
      });
    });
    return record;
  }

  function replaceLayerContent(record, content) {
    if (!record?.el?.isConnected) return;
    const scroll = $(".layer-scroll", record.el);
    if (!scroll) return;
    record.content = content;
    record.shelved = false;
    mountResultSurface(scroll, { kind: record.kind || "word", content, animate: true });
  }

  async function hydrateLayerWithModel(record) {
    if (!record || !record.el.isConnected) return;
    if (!hasModelConfig()) {
      replaceLayerContent(record, layerConnectPage(record.word, record.origin, record.relation, record.depth));
      return;
    }
    record.loading = true;
    record.error = null;
    replaceLayerContent(record, layerLoadingPage(record.word, record.origin, record.relation, record.depth));
    try {
      const result = await lookupWordDeduped(record.word);
      if (!record.el.isConnected) return;
      let data = ensureWord(result.data);
      if (!data) throw new Error("模型返回的词条为空。");
      if (record.options?.context) data = { ...data, context: record.options.context };
      if (!data.related?.length && record.options?.siblings?.length) {
        data.related = record.options.siblings.slice(0, 6);
      }
      record.data = data;
      record.word = data.word;
      record.loading = false;
      record.el.setAttribute("aria-label", `${data.word} 词条，第 ${record.depth} 层`);
      addHistory("word", data.word);
      replaceLayerContent(record, wordPage(data, {
        origin: record.origin,
        relation: record.relation,
        depth: record.depth
      }));
      schedulePrefetch(data);
    } catch (error) {
      if (!record.el.isConnected) return;
      const message = error?.name === "AbortError"
        ? `${modelTimeoutText}，已中断。`
        : String(error?.message || "模型请求失败。");
      record.loading = false;
      record.error = message;
      updateCacheCorner(false, "本层词条未缓存");
      replaceLayerContent(record, layerErrorPage(record.word, record.origin, record.relation, record.depth, message));
    }
  }

  async function openWordLayer(word, options = {}) {
    const key = normalizeWord(word);
    if (!key) return;
    if (state.sheetOpen) closeSheet({ immediate: true });

    const depth = state.wordLayers.length + 1;
    const origin = options.origin || currentLayerOrigin();
    const relation = options.relation || "相关词";
    const entry = DATA.words[key];
    const siblings = options.siblings !== undefined
      ? options.siblings
      : (state.route.name === "sentence" && !state.wordLayers.length
          ? sentenceSiblings(key)
          : siblingsFor(currentLayerData(), key));
    const layerOptions = { ...options, siblings };

    let data = entry ? ensureWord(entry) : null;
    if (!data) {
      const cached = cacheGetWord(key);
      if (cached) data = ensureWord(cached);
    }
    if (data) {
      if (options.context) data = { ...data, context: options.context };
      if (!data.related?.length && siblings.length) data.related = siblings.slice(0, 6);
      addHistory("word", data.word);
      mountWordLayer({
        word: data.word,
        data,
        origin,
        relation,
        depth,
        options: layerOptions,
        content: wordPage(data, { origin, relation, depth })
      });
      return;
    }

    const hasLocalMini = Boolean(DATA.lexicon[key] || options.gloss || options.context?.meaning);
    if (!hasModelConfig()) {
      if (hasLocalMini) {
        const mini = makeMiniWord(word, { ...options, siblings }, origin, relation);
        if (mini) {
          mountWordLayer({
            word: mini.word,
            data: mini,
            origin,
            relation,
            depth,
            options: layerOptions,
            content: wordPage(mini, { origin, relation, depth })
          });
          return;
        }
      }
      mountWordLayer({
        word: key,
        data: null,
        origin,
        relation,
        depth,
        options: layerOptions,
        content: layerConnectPage(key, origin, relation, depth)
      });
      return;
    }

    const record = mountWordLayer({
      word: key,
      data: null,
      origin,
      relation,
      depth,
      options: layerOptions,
      content: layerLoadingPage(key, origin, relation, depth)
    });
    await hydrateLayerWithModel(record);
  }

  async function hydrateChunkLayer(record, phrase) {
    if (!record || !record.el?.isConnected) return;
    const cfg = applyProfileToSettings(state.settings, activeProfile(state.settings));
    if (!hasModelConfig(cfg)) {
      replaceLayerContent(record, layerConnectPage(phrase, record.origin, record.relation, record.depth));
      return;
    }
    record.loading = true;
    replaceLayerContent(record, layerLoadingPage(phrase, record.origin, record.relation, record.depth));
    try {
      const result = await modelLookup(phrase, "chunk", cfg);
      if (!state.wordLayers.includes(record)) return;
      const chunkData = ensureChunk(result.data);
      if (!chunkData) throw new Error("模型返回的意群为空");
      record.data = chunkData;
      record.word = chunkData.chunk;
      record.loading = false;
      addHistory("chunk", chunkData.chunk);
      replaceLayerContent(record, chunkPage(chunkData, { origin: record.origin, relation: record.relation, depth: record.depth }));
    } catch (error) {
      if (!state.wordLayers.includes(record)) return;
      record.loading = false;
      replaceLayerContent(record, layerErrorPage(phrase, record.origin, record.relation, record.depth, error?.message || "意群加载失败"));
    }
  }

  async function openChunkLayer(phrase, options = {}) {
    const clean = String(phrase || "").trim();
    if (!clean) return;
    if (state.sheetOpen) closeSheet({ immediate: true });
    const depth = state.wordLayers.length + 1;
    const origin = options.origin || currentLayerOrigin();
    const relation = options.relation || "意群";
    const slug = chunkSlug(clean);
    let data = !options.skipCache && DATA.chunks?.[slug] ? ensureChunk(DATA.chunks[slug]) : null;
    if (!data && !options.skipCache) {
      const cached = cacheGetChunk(clean);
      if (cached) data = ensureChunk(cached);
    }
    if (data) {
      addHistory("chunk", data.chunk);
      mountWordLayer({
        word: data.chunk,
        kind: "chunk",
        data,
        origin,
        relation,
        depth,
        options,
        content: chunkPage(data, { origin, relation, depth })
      });
      return;
    }
    const cfg = applyProfileToSettings(state.settings, activeProfile(state.settings));
    if (!hasModelConfig(cfg)) {
      mountWordLayer({
        word: clean,
        kind: "chunk",
        data: null,
        origin,
        relation,
        depth,
        options,
        content: layerConnectPage(clean, origin, relation, depth)
      });
      return;
    }
    const record = mountWordLayer({
      word: clean,
      kind: "chunk",
      data: null,
      origin,
      relation,
      depth,
      options,
      content: layerLoadingPage(clean, origin, relation, depth)
    });
    await hydrateChunkLayer(record, clean);
  }

  async function hydrateSentenceLayer(record, clean) {
    if (!record || !record.el?.isConnected) return;
    const titleShort = shorten(clean, 26);
    const cfg = applyProfileToSettings(state.settings, activeProfile(state.settings));
    if (!hasModelConfig(cfg)) {
      replaceLayerContent(record, layerConnectPage(titleShort, record.origin, record.relation, record.depth));
      return;
    }
    record.loading = true;
    replaceLayerContent(record, layerLoadingPage(titleShort, record.origin, record.relation, record.depth));
    try {
      const result = await modelLookup(clean, "sentence", cfg);
      if (!state.wordLayers.includes(record)) return;
      const sentData = result.data;
      if (!sentData) throw new Error("模型返回的拆句为空");
      record.data = sentData;
      record.word = shorten(sentData?.text || clean, 26);
      record.loading = false;
      addHistory("sentence", sentData?.text || clean);
      replaceLayerContent(record, sentencePage(sentData, { origin: record.origin, relation: record.relation, depth: record.depth }));
    } catch (error) {
      if (!state.wordLayers.includes(record)) return;
      record.loading = false;
      replaceLayerContent(record, layerErrorPage(titleShort, record.origin, record.relation, record.depth, error?.message || "拆句加载失败"));
    }
  }

  async function openSentenceLayer(text, options = {}) {
    const clean = String(text || "").trim();
    if (!clean) return;
    if (state.sheetOpen) closeSheet({ immediate: true });
    const depth = state.wordLayers.length + 1;
    const origin = options.origin || currentLayerOrigin();
    const relation = options.relation || "拆句";
    const titleShort = shorten(clean, 26);

    const localHit = !options.skipCache
      ? DATA.sentences?.find((item) => String(item.text || "").trim().toLowerCase() === clean.toLowerCase())
      : null;
    if (localHit) {
      addHistory("sentence", localHit.text || clean);
      mountWordLayer({
        word: titleShort,
        query: clean,
        kind: "sentence",
        data: localHit,
        origin,
        relation,
        depth,
        options,
        content: sentencePage(localHit, { origin, relation, depth })
      });
      return;
    }

    const detail = state.settings?.detailLevel || "standard";
    const sKey = await sentenceKey(clean, sentenceLevelOf(state.settings?.sentenceLevel).id, detail);
    const cached = !options.skipCache && sKey ? cacheGetSentence(sKey) : null;
    if (cached) {
      addHistory("sentence", cached.text || clean);
      mountWordLayer({
        word: titleShort,
        query: clean,
        kind: "sentence",
        data: cached,
        origin,
        relation,
        depth,
        options,
        content: sentencePage(cached, { origin, relation, depth })
      });
      return;
    }

    const cfg = applyProfileToSettings(state.settings, activeProfile(state.settings));
    if (!hasModelConfig(cfg)) {
      mountWordLayer({
        word: titleShort,
        query: clean,
        kind: "sentence",
        data: null,
        origin,
        relation,
        depth,
        options,
        content: layerConnectPage(titleShort, origin, relation, depth)
      });
      return;
    }

    const record = mountWordLayer({
      word: titleShort,
      query: clean,
      kind: "sentence",
      data: null,
      origin,
      relation,
      depth,
      options,
      content: layerLoadingPage(titleShort, origin, relation, depth)
    });
    await hydrateSentenceLayer(record, clean);
  }

  function hydrateLayer(record) {
    if (!record) return Promise.resolve();
    if (record.kind === "chunk") {
      return hydrateChunkLayer(record, record.query || record.word);
    }
    if (record.kind === "sentence") {
      return hydrateSentenceLayer(record, record.query || record.word);
    }
    return hydrateLayerWithModel(record);
  }

  function openWordLayerFromButton(button) {
    const word = button.dataset.word || "";
    if (!word) return;
    const relation = button.dataset.relation || "相关词";
    const origin = currentLayerOrigin();
    const contextLayer = state.wordLayers[state.wordLayers.length - 1];
    const siblings = state.route.name === "sentence" && !contextLayer
      ? sentenceSiblings(word)
      : siblingsFor(contextLayer?.data || (state.route.name === "word" ? getWord(state.route) : null), word);
    openWordLayer(word, {
      gloss: button.dataset.gloss || "",
      pos: button.dataset.pos || "",
      relation,
      origin,
      siblings
    });
  }

  function openKeyLayer(index) {
    const sentence = getSentence(state.route);
    const keyWord = sentence?.keyWords?.[index];
    if (!keyWord) return;
    openWordLayer(keyWord.word, {
      context: keyWord,
      gloss: keyWord.meaning,
      zh: keyWord.meaningZh,
      ipa: keyWord.phonetic,
      pos: keyWord.pos,
      relation: "重点词",
      origin: "句子",
      siblings: uniqueWords(sentence.keyWords.map((item) => item.word), keyWord.word)
    });
  }

  function popWordLayer() {
    const item = state.wordLayers.pop();
    if (!item) return;
    item.el.classList.remove("is-open");
    item.el.classList.add("is-closing");
    item.el.setAttribute("aria-hidden", "true");
    window.setTimeout(() => item.el.remove(), 540);

    const previous = state.wordLayers[state.wordLayers.length - 1];
    if (previous) {
      previous.el.classList.remove("is-behind");
      previous.el.removeAttribute("aria-hidden");
      restoreLayerContent(previous);
      previous.el.focus({ preventScroll: true });
      refreshCacheBorders(previous.el);
      if (previous.data && previous.kind === "word") schedulePrefetch(previous.data);
    } else {
      const scrim = $(".layer-scrim", layerRoot);
      if (scrim) {
        scrim.classList.remove("show");
        if (scrimRemoveTimer) window.clearTimeout(scrimRemoveTimer);
        scrimRemoveTimer = window.setTimeout(() => {
          scrimRemoveTimer = 0;
          if (!state.wordLayers.length && scrim.isConnected) scrim.remove();
        }, 420);
      }
      if (state.route.name === "word") {
        const mainWord = getWord(state.route);
        if (mainWord) schedulePrefetch(mainWord);
        else hideCacheCorner();
      } else {
        hideCacheCorner();
      }
    }
    updateScrollLock();
  }

  function closeAllWordLayers({ immediate = false } = {}) {
    cancelLayerCleanupTimers();
    if (!state.wordLayers.length && !layerRoot.firstElementChild) return;
    state.wordLayers = [];
    if (immediate) {
      layerRoot.innerHTML = "";
    } else {
      const closingLayers = $$(".word-layer", layerRoot);
      closingLayers.forEach((layer) => {
        layer.classList.remove("is-open");
        layer.classList.add("is-closing");
      });
      const scrim = $(".layer-scrim", layerRoot);
      if (scrim) scrim.classList.remove("show");
      clearAllLayersTimer = window.setTimeout(() => {
        clearAllLayersTimer = 0;
        if (!state.wordLayers.length) {
          layerRoot.innerHTML = "";
        } else {
          closingLayers.forEach((layer) => {
            if (layer.isConnected && layer.classList.contains("is-closing")) layer.remove();
          });
        }
      }, 540);
    }
    updateScrollLock();
  }

  const actions = {
    "layer-back"({ event }) {
      event.preventDefault();
      popWordLayer();
    },
    "retry-layer"({ event }) {
      event.preventDefault();
      tapFeedback();
      if (state.wordLayers.length) void hydrateLayer(state.wordLayers[state.wordLayers.length - 1]);
    },
    "open-key"({ event, target }) {
      event.preventDefault();
      tapFeedback();
      openKeyLayer(Number(target.dataset.index || 0));
    },
    "word-layer"({ event, target }) {
      event.preventDefault();
      tapFeedback();
      openWordLayerFromButton(target);
    },
    "sheet-word"({ event, target }) {
      event.preventDefault();
      tapFeedback();
      openWordLayerFromButton(target);
    },
    "full-entry"({ event, target }) {
      event.preventDefault();
      openWordLayerFromButton(target);
    }
  };

  return {
    mountResultSurface,
    hydrateLayer,
    hydrateLayerWithModel,
    openWordLayer,
    hydrateChunkLayer,
    openChunkLayer,
    hydrateSentenceLayer,
    openSentenceLayer,
    openWordLayerFromButton,
    openKeyLayer,
    popWordLayer,
    closeAllWordLayers,
    actions
  };
}
