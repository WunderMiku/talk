/* ============================================================
   talk. — Multi-style Translator view, cache, and workspace
   ============================================================ */

import { $, $$, esc, attr, shorten, detectSourceLanguage, copyText } from "../core/utils.js";
import { icon } from "../core/icons.js";
import { diagLog } from "../core/diagnostics.js";

const TRANSLATION_CACHE_MAX = 40;
const TRANSLATION_CACHE_TTL = 30 * 86400000;

function styleEmoji(style, className = "") {
  return `<img class="${className}" src="${esc(style.emoji)}" alt="" loading="eager" decoding="async" draggable="false" />`;
}

export function normalizeTranslation(raw, sourceText, cfg, sourceLanguage, selectedStyles, translatorStyles) {
  const base = raw && typeof raw === "object" ? raw : {};
  const sourceVariants = Array.isArray(base.variants) ? base.variants : [];
  const wanted = translatorStyles.filter((style) => selectedStyles.includes(style.id));
  const variants = wanted.map((style, index) => {
    const found = sourceVariants.find((item) => String(item?.style || "").toLowerCase() === style.id)
      || sourceVariants[index]
      || {};
    const phrases = Array.isArray(found.phrases)
      ? found.phrases.map((item) => ({
          phrase: String(item?.phrase || item?.text || "").trim(),
          zh: String(item?.zh || item?.meaning || "").trim(),
          note: String(item?.note || "").trim()
        })).filter((item) => item.phrase)
      : [];
    const examples = Array.isArray(found.examples)
      ? found.examples.map((item) => ({
          en: String(item?.en || item?.text || "").trim(),
          zh: String(item?.zh || item?.translation || "").trim()
        })).filter((item) => item.en)
      : [];
    return {
      style: style.id,
      text: String(found.text || found.translation || "").trim(),
      nuance: String(found.nuance || found.note || "").trim(),
      examples,
      phrases,
      points: Array.isArray(found.points)
        ? found.points.map((item) => String(item || "").trim()).filter(Boolean)
        : []
    };
  }).filter((variant) => variant.text);
  if (!variants.length) throw new Error("模型没有返回可用的英文版本。");
  return {
    sourceText,
    sourceLanguage: sourceLanguage || (base.sourceLanguage === "en" ? "en" : "zh"),
    variants,
    model: cfg.model,
    cached: false,
    at: Date.now()
  };
}

export function createTranslatorView({
  state,
  workspaceRoot,
  overlayRoot,
  llm,
  styles,
  systemPrompt,
  modelTimeoutMs,
  modelTimeoutText,
  copyFor,
  uiLang,
  englishDirective,
  hasModelConfig,
  homeTopbar,
  applyInputMode,
  updateScrollLock,
  queueReveal,
  openSheetShell,
  addHistory,
  toast
}) {
  function translationCacheKey() {
    return "talk.translations.v3" + (uiLang() === "en" ? ".en" : "");
  }

  function translationCacheAll() {
    try {
      const parsed = JSON.parse(localStorage.getItem(translationCacheKey()) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function translationCacheGet(text) {
    const entry = translationCacheAll()[text];
    if (!entry?.result || Date.now() - Number(entry.at || 0) > TRANSLATION_CACHE_TTL) return null;
    return { ...entry.result, cached: true };
  }

  function translationCachePut(text, result) {
    const all = translationCacheAll();
    all[text] = { at: Date.now(), result };
    const entries = Object.entries(all)
      .sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0))
      .slice(0, TRANSLATION_CACHE_MAX);
    try { localStorage.setItem(translationCacheKey(), JSON.stringify(Object.fromEntries(entries))); } catch (_) { /* no-op */ }
  }

  function translatorEmptyHtml() {
    const copy = copyFor("translator");
    return `<div class="translator-empty">
      <span class="translator-empty-mark">Aa</span>
      <p>${esc(copy.empty)}</p>
      <div class="translator-examples">
        ${copy.samples.map(([text, label]) => `<button class="translator-example" type="button" data-action="translator-sample" data-text="${attr(text)}">${esc(label)} <span>↗</span></button>`).join("")}
      </div>
    </div>`;
  }

  function translatorStylesHtml() {
    return styles.map((style) => {
      const selected = state.translatorStyles.includes(style.id);
      return `<button class="translator-style-chip tone-${style.tone} ${selected ? "selected" : ""}" type="button" data-action="translator-style" data-style="${style.id}" aria-pressed="${selected}">
        ${styleEmoji(style, "translator-style-emoji")}
        <strong>${esc(style.name)}</strong>
        <span class="translator-style-check" aria-hidden="true">${selected ? "✓" : ""}</span>
      </button>`;
    }).join("");
  }

  function translatorModeHtml() {
    return copyFor("translator").modes.map(([mode, label]) => `<button class="translator-mode-btn ${state.translatorMode === mode ? "active" : ""}" type="button" data-action="translator-mode" data-mode="${mode}" aria-pressed="${state.translatorMode === mode}">${esc(label)}</button>`).join("");
  }

  function updateTranslatorStyleControls() {
    $$(".translator-style-chip").forEach((button) => {
      const selected = state.translatorStyles.includes(button.dataset.style);
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
      const check = button.querySelector(".translator-style-check");
      if (check) check.textContent = selected ? "✓" : "";
    });
    $$(".translator-style-count").forEach((count) => {
      count.textContent = `已选 ${state.translatorStyles.length} / ${styles.length}`;
    });
  }

  function translatorPage() {
    const copy = copyFor("translator");
    return `
      ${homeTopbar()}
      <main class="result-page translator-page">
        <section class="translator-hero reveal" style="--d:0">
          <div class="eyebrow translator-eyebrow">
            <span class="spark"></span>${esc(copy.kicker)}
          </div>
          <h1 class="translator-title">${esc(copy.titleLead)}<em>${esc(copy.titleAccent)}</em></h1>
          <p class="translator-lede">${esc(copy.lede)}</p>
        </section>
        <form class="translator-form reveal" id="translator-form" style="--d:0.4" novalidate>
          <div class="translator-input-shell">
            <div class="translator-input-head">
              <span class="mono">原文</span>
              <div class="translator-mode-switch" role="group" aria-label="翻译方向">${translatorModeHtml()}</div>
            </div>
            <textarea id="translator-input" rows="3" placeholder="${attr(copy.inputPlaceholder)}" spellcheck="false" aria-label="待翻译文本"></textarea>
            <div class="translator-input-foot">
              <span class="translator-input-meta"><span class="translator-language">自动识别</span><span class="translator-style-count">已选 ${state.translatorStyles.length} / ${styles.length}</span><span class="translator-char-count">0 字</span></span>
              <button class="search-submit" type="submit" aria-label="生成选中的风格">${icon("arrowUpRight")}</button>
            </div>
          </div>
        </form>
        <div class="translator-styles reveal" style="--d:0.8">${translatorStylesHtml()}</div>
        <div class="translator-landing-hint reveal" style="--d:1">${translatorEmptyHtml()}</div>
      </main>`;
  }

  function translatorSourceLanguage() {
    if (state.translatorMode === "zh" || state.translatorMode === "en") return state.translatorMode;
    const input = $("#translator-input");
    return detectSourceLanguage(input?.value || "");
  }

  function translatorTargetIsChinese() {
    return state.translatorMode === "zh";
  }

  function updateTranslatorLanguage() {
    const input = $("#translator-input");
    const value = input?.value.trim() || "";
    const text = state.translatorMode === "zh"
      ? "中 → 英"
      : state.translatorMode === "en"
        ? "英 → 英"
        : value
          ? detectSourceLanguage(value) === "zh" ? "自动 · 中 → 英" : "自动 · 英 → 英"
          : "自动识别";
    $$(".translator-language").forEach((label) => { label.textContent = text; });
    const typingLang = translatorTargetIsChinese() ? "zh" : "en";
    applyInputMode(input, typingLang);
    applyInputMode($("#workspace-translator-input"), typingLang);
    const workspaceValue = $("#workspace-translator-input")?.value ?? value;
    const shown = $("#workspace-translator-input") ? workspaceValue : value;
    $$(".translator-char-count").forEach((label) => {
      label.textContent = `${shown.length} 字`;
    });
  }

  function syncTranslatorInputsFromWorkspace() {
    const workspaceInput = $("#workspace-translator-input");
    const landingInput = $("#translator-input");
    if (workspaceInput && landingInput) landingInput.value = workspaceInput.value;
    updateTranslatorLanguage();
  }

  function renderTranslatorLoading(selectedIds = state.translatorStyles) {
    const host = $("#translation-workspace-results");
    if (!host) return;
    const selected = styles.filter((style) => selectedIds.includes(style.id));
    host.innerHTML = `<div class="translation-loading">
      <div class="translation-loading-head"><span class="loading-dots"><i></i><i></i><i></i></span><span>正在写成 ${selected.length} 个英文版本…</span></div>
      ${selected.map((style) => `<div class="translation-loading-card tone-${style.tone}"><span>${esc(style.name)}</span><i></i><i></i></div>`).join("")}
    </div>`;
  }

  function renderTranslatorNoModel() {
    const host = $("#translation-workspace-results");
    if (!host) return;
    host.innerHTML = `<div class="translator-empty">
      <span class="translator-empty-mark">!</span>
      <p>翻译需要模型。先连接一个 OpenAI 兼容服务，再回来输入。</p>
      <div class="translator-empty-actions">
        <button class="btn btn-primary" type="button" data-action="settings">${icon("settings")} 连接模型</button>
        <button class="btn btn-secondary" type="button" data-action="demo-translation">先看一段示例</button>
      </div>
    </div>`;
  }

  function renderTranslatorError(message) {
    const host = $("#translation-workspace-results");
    if (!host) return;
    host.innerHTML = `<div class="translator-empty error">
      <span class="translator-empty-mark">!</span>
      <p>这次没有翻完：${esc(shorten(message || "未知错误", 160))}</p>
      <button class="btn btn-secondary" type="button" data-action="regenerate-translation">${icon("refresh")} 重试</button>
    </div>`;
  }

  function demoTranslationResult(text) {
    const source = String(text || "").trim() || "今天有点累，但我还是想出去走走。";
    const bodies = [
      "Tired, but I still want to get out for a bit.",
      "Beat, but I could still use some fresh air.",
      "I am somewhat fatigued; nevertheless, I would like to take a walk.",
      "Low-key wiped, but still down for a walk.",
      "Weary as I am, a stroll would do me good."
    ];
    return {
      sourceText: source,
      sourceLanguage: state.translatorMode === "en" ? "en" : "zh",
      variants: styles.map((style, index) => ({
        style: style.id,
        text: bodies[index] || bodies[0],
        nuance: "",
        phrases: [],
        points: []
      })),
      model: "示例",
      cached: false,
      demo: true,
      at: Date.now()
    };
  }

  function renderTranslatorResult(result) {
    const host = $("#translation-workspace-results");
    if (!host || !result?.variants?.length) return;
    const source = result.sourceLanguage === "zh" ? "中 → 英" : "英 → 英";
    const styleMap = new Map(styles.map((style) => [style.id, style]));
    host.innerHTML = `<div class="translation-result">
      <div class="translation-result-head">
        <div><span class="mono">${esc(source)}</span><span class="translation-cache-label">${result.cached ? "本机缓存" : "本次生成"}</span></div>
        <button class="link-btn" type="button" data-action="regenerate-translation">重新生成</button>
      </div>
      <div class="translation-list">
        ${result.variants.map((variant, index) => {
          const style = styleMap.get(variant.style) || styles[index] || styles[0];
          return `<article class="translation-card reveal-item tone-${style.tone}" style="--i:${Math.min(index, 4)}" data-action="translation-detail" data-index="${index}" tabindex="0" role="button" aria-label="查看${attr(style.name)}版本的搭配与知识点">
            <div class="translation-card-head">
              <span class="translation-emoji" aria-hidden="true">${styleEmoji(style)}</span>
              <div><h2>${esc(style.name)}</h2><p>${esc(style.hint)}</p></div>
              <button class="icon-btn translation-copy" type="button" data-action="copy-translation" data-text="${attr(variant.text)}" aria-label="复制这个版本">${icon("copy")}</button>
            </div>
            <p class="translation-text">${esc(variant.text)}</p>
            ${variant.nuance ? `<p class="translation-nuance">${esc(variant.nuance)}</p>` : ""}
            ${(variant.examples || []).length ? `<div class="translation-examples">${variant.examples.map((item) => `<button class="translation-example" type="button" data-action="example-lookup" data-text="${attr(item.en)}">${esc(item.en)}<span>${esc(item.zh)}</span></button>`).join("")}</div>` : ""}
            <span class="translation-open">搭配与知识点 <span aria-hidden="true">↗</span></span>
          </article>`;
        }).join("")}
      </div>
    </div>`;
    queueReveal(host);
  }

  function translationDetailHtml(variant, style) {
    const phrases = variant?.phrases || [];
    const points = variant?.points || [];
    return `<div class="sheet-content translation-detail tone-${style.tone}">
      <div class="translation-detail-head">
        <span class="translation-emoji" aria-hidden="true">${styleEmoji(style)}</span>
        <div><span class="mono">${esc(style.name)}</span><h2>搭配与知识点</h2></div>
      </div>
      <p class="translation-detail-text">${esc(variant.text)}</p>
      ${variant.nuance ? `<p class="translation-detail-nuance">${esc(variant.nuance)}</p>` : ""}
      <div class="translation-detail-section">
        <h3>常见搭配</h3>
        ${phrases.length ? phrases.map((item) => `<div class="translation-phrase">
          <strong>${esc(item.phrase)}</strong>
          <span>${esc(item.zh || "")}${item.note ? ` · ${esc(item.note)}` : ""}</span>
        </div>`).join("") : `<p class="translation-detail-empty">这次没返回，重新生成试试。</p>`}
      </div>
      ${(variant.examples || []).length ? `<div class="translation-detail-section">
        <h3>例句</h3>
        ${variant.examples.map((item) => `<button class="translation-example" type="button" data-action="example-lookup" data-text="${attr(item.en)}">${esc(item.en)}<span>${esc(item.zh)}</span></button>`).join("")}
      </div>` : ""}
      <div class="translation-detail-section">
        <h3>知识点</h3>
        ${points.length ? `<ul class="translation-points">${points.map((point) => `<li>${esc(point)}</li>`).join("")}</ul>` : `<p class="translation-detail-empty">这次没返回，重新生成试试。</p>`}
      </div>
      <button class="btn btn-secondary translation-detail-copy" type="button" data-action="copy-translation" data-text="${attr(variant.text)}">${icon("copy")} 复制这个版本</button>
    </div>`;
  }

  function openTranslationDetail(index) {
    const result = state.lastTranslationResult;
    const variant = result?.variants?.[Number(index)];
    if (!variant) return;
    const style = styles.find((item) => item.id === variant.style) || styles[0];
    openSheetShell({ kicker: "风格拆解", title: style.name });
    const sheet = $(".sheet", overlayRoot);
    if (sheet) {
      styles.forEach((item) => sheet.classList.remove(`tone-${item.tone}`));
      sheet.classList.add("translation-detail-sheet", `tone-${style.tone}`);
    }
    const holder = $("#sheet-scroll");
    if (holder) holder.innerHTML = translationDetailHtml(variant, style);
  }

  async function requestTranslation(text, cfg, sourceLanguage, selectedStyles) {
    const resolvedCfg = llm.resolveConfig(cfg);
    llm.endpointFor(resolvedCfg.baseUrl, resolvedCfg);
    const messages = [
      { role: "system", content: systemPrompt + englishDirective() },
      { role: "user", content: JSON.stringify({ sourceLanguage, styles: selectedStyles, text }) }
    ];
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), modelTimeoutMs);
    diagLog("info", "model.start", `translation · ${state.settings?.detailLevel || "standard"}`, { chars: text.length });
    try {
      let content = "";
      try {
        content = await llm.sendChatStream(resolvedCfg, messages, {
          signal: controller.signal,
          allowJsonMode: false,
          googleJsonMode: true,
          maxTokens: 1600,
          temperature: 0.3
        });
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        const response = await llm.sendChat(resolvedCfg, messages, {
          signal: controller.signal,
          allowJsonMode: false,
          maxTokens: 1600,
          temperature: 0.3
        });
        if (!response.ok) {
          throw new Error(await llm.readHttpError(response, 220));
        }
        const json = await llm.readJsonResponse(response, "翻译接口");
        content = llm.extractContent(json, resolvedCfg);
      }
      if (!content) throw new Error("模型返回了空内容。");
      return normalizeTranslation(llm.parseJsonObject(content), text, resolvedCfg, sourceLanguage, selectedStyles, styles);
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function runTranslation(raw, { bypassCache = false } = {}) {
    const text = String(raw || "").trim();
    if (!text) {
      toast("先输入一句中文或英文");
      return;
    }
    const selectedStyles = styles
      .filter((style) => state.translatorStyles.includes(style.id))
      .map((style) => style.id);
    if (!selectedStyles.length) {
      toast("至少选择一个风格");
      return;
    }
    const token = ++state.translatorSeq;
    const sourceLanguage = translatorSourceLanguage();
    state.lastTranslationInput = text;
    updateTranslatorLanguage();
    const cacheKey = `${sourceLanguage}|${selectedStyles.join(",")}|${text}`;
    const cached = bypassCache ? null : translationCacheGet(cacheKey);
    if (cached) {
      state.lastTranslationResult = cached;
      renderTranslatorResult(cached);
      addHistory("translation", text);
      return;
    }
    if (!hasModelConfig()) {
      renderTranslatorNoModel();
      return;
    }
    renderTranslatorLoading(selectedStyles);
    try {
      const result = await requestTranslation(text, state.settings, sourceLanguage, selectedStyles);
      if (token !== state.translatorSeq) return;
      state.lastTranslationResult = result;
      translationCachePut(cacheKey, result);
      renderTranslatorResult(result);
      addHistory("translation", text);
    } catch (error) {
      if (token !== state.translatorSeq) return;
      renderTranslatorError(error?.name === "AbortError" ? modelTimeoutText : String(error?.message || error));
    }
  }

  function openTranslationWorkspace(text) {
    const value = String(text || "").trim();
    if (!value) {
      toast("先输入一句中文或英文");
      return;
    }
    state.workspaceOpen = true;
    state.lastTranslationInput = value;
    workspaceRoot.innerHTML = `<section class="translation-workspace" aria-label="翻译结果">
      <header class="translation-workspace-head">
        <div>
          <span class="mono">${esc(copyFor("translator").workspaceKicker || "MULTI-STYLE")}</span>
          <h2>${esc(copyFor("translator").workspaceTitle || "翻译结果")}</h2>
        </div>
        <button class="icon-btn" type="button" data-action="close-workspace" aria-label="关闭翻译结果">${icon("close")}</button>
      </header>
      <div class="translation-workspace-body" data-lenis-prevent>
        <form class="workspace-translator-form" id="workspace-translator-form" novalidate>
          <div class="workspace-input-shell">
            <textarea id="workspace-translator-input" rows="2"  spellcheck="false" aria-label="待翻译文本">${esc(value)}</textarea>
            <div class="workspace-input-foot">
              <div class="translator-mode-switch" role="group" aria-label="翻译方向">${translatorModeHtml()}</div>
              <span class="translator-language">自动识别</span>
              <span class="translator-char-count">0 字</span>
              <button class="search-submit" type="submit" aria-label="重新翻译">${icon("arrowUpRight")}</button>
            </div>
          </div>
        </form>
        <div class="workspace-style-row">
          <div class="translator-styles">${translatorStylesHtml()}</div>
          <span class="translator-style-count">已选 ${state.translatorStyles.length} / ${styles.length}</span>
        </div>
        <div class="translation-workspace-results" id="translation-workspace-results"></div>
      </div>
    </section>`;
    updateScrollLock();
    requestAnimationFrame(() => {
      const panel = $(".translation-workspace", workspaceRoot);
      panel?.classList.add("show");
      // Do not auto-focus the textarea: opening the result view should not
      // summon the on-screen keyboard every time.
      updateTranslatorLanguage();
      updateTranslatorStyleControls();
    });
    runTranslation(value);
  }

  function closeTranslationWorkspace({ immediate = false } = {}) {
    if (!state.workspaceOpen && !workspaceRoot.firstElementChild) return;
    state.workspaceOpen = false;
    state.translatorSeq += 1;
    updateScrollLock();
    const panel = $(".translation-workspace", workspaceRoot);
    if (immediate || !panel) {
      workspaceRoot.innerHTML = "";
      return;
    }
    panel.classList.remove("show");
    window.setTimeout(() => {
      if (!state.workspaceOpen) workspaceRoot.innerHTML = "";
    }, 300);
  }

  const actions = {
    "translator-style": ({ event, target }) => {
      event.preventDefault();
      const styleId = target.dataset.style;
      if (!styles.some((style) => style.id === styleId)) return;
      state.translatorStyles = state.translatorStyles.includes(styleId)
        ? state.translatorStyles.filter((id) => id !== styleId)
        : [...state.translatorStyles, styleId];
      updateTranslatorStyleControls();
    },
    "translator-mode": ({ event, target }) => {
      event.preventDefault();
      state.translatorMode = target.dataset.mode === "zh" || target.dataset.mode === "en" ? target.dataset.mode : "auto";
      $$(".translator-mode-btn").forEach((button) => {
        const active = button.dataset.mode === state.translatorMode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      updateTranslatorLanguage();
    },
    "close-workspace": ({ event }) => {
      event.preventDefault();
      closeTranslationWorkspace();
    },
    "translation-detail": ({ event, target }) => {
      event.preventDefault();
      openTranslationDetail(Number(target.dataset.index));
    },
    "copy-translation": ({ event, target }) => {
      event.preventDefault();
      const text = target.dataset.text || "";
      if (!text) return;
      void copyText(text).then((copied) => {
        toast(copied ? "已复制这个版本" : "复制失败");
      });
    },
    "translator-sample": ({ event, target }) => {
      event.preventDefault();
      const input = $("#translator-input");
      if (!input) return;
      input.value = target.dataset.text || "";
      updateTranslatorLanguage();
      openTranslationWorkspace(input.value);
    },
    "regenerate-translation": ({ event }) => {
      event.preventDefault();
      if (state.lastTranslationInput) runTranslation(state.lastTranslationInput, { bypassCache: true });
    },
    "demo-translation": ({ event }) => {
      event.preventDefault();
      renderTranslatorResult(demoTranslationResult($("#translator-input")?.value || $("#workspace-translator-input")?.value));
    }
  };

  return {
    translatorPage,
    openTranslationWorkspace,
    closeTranslationWorkspace,
    syncTranslatorInputsFromWorkspace,
    updateTranslatorLanguage,
    updateTranslatorStyleControls,
    runTranslation,
    actions
  };
}
