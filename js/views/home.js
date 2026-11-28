/* ============================================================
   talk. — Home screen view, daily entry, moods & input-mode helper
   ============================================================ */

import { $, esc, attr, shorten, posLabel } from "../core/utils.js";
import { icon } from "../core/icons.js";

export function dayNumber(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

/* Phones pick a keyboard from inputmode. A word search wants a Latin
   keyboard; translating from Chinese wants the Chinese one. Keep this in one
   place so a future language pair only needs a mapping entry. */
export function inputModeFor(lang) {
  if (lang === "zh") return { inputmode: "text", lang: "zh-CN", autocapitalize: "off" };
  return { inputmode: "latin", lang: "en", autocapitalize: "none" };
}

export function applyInputMode(target, lang) {
  if (!target) return;
  const mode = inputModeFor(lang);
  target.setAttribute("inputmode", mode.inputmode);
  target.setAttribute("lang", mode.lang);
  target.setAttribute("autocapitalize", mode.autocapitalize);
}

export function createHomeView({
  state,
  data: DATA,
  copyFor,
  sanitizeHistory,
  homeTopbar,
  themeSalonMarkup,
  currentThemeDeck
}) {
  function dailyEntry() {
    const keys = Array.isArray(DATA.dailyWords) && DATA.dailyWords.length
      ? DATA.dailyWords
      : Object.keys(DATA.words);
    const key = keys[dayNumber() % keys.length];
    return DATA.words[key] || DATA.words[keys[0]] || null;
  }

  function visibleMoods() {
    const pool = Array.isArray(DATA.moods) ? DATA.moods : [];
    if (!pool.length) return [];
    const count = Math.min(3, pool.length);
    const start = (dayNumber() + state.moodOffset) % pool.length;
    return Array.from({ length: count }, (_, index) => pool[(start + index) % pool.length]);
  }

  function moodCardsMarkup(moods) {
    return moods.map((mood) => `
      <button class="mood-card ${mood.tone}" type="button" data-action="word" data-word="${attr(mood.target)}" aria-label="探索${attr(mood.title)}">
        <span class="mood-kicker"><span>${esc(mood.kicker)}</span><span>↗</span></span>
        <strong class="mood-title">${esc(mood.title)}</strong>
        <span class="mood-words">${esc(mood.words)}</span>
      </button>`).join("");
  }

  function renderMoods() {
    const container = $("#mood-scroll");
    if (!container) return;
    const moods = visibleMoods();
    container.innerHTML = moodCardsMarkup(moods);
    const count = $("#mood-count");
    if (count) count.textContent = `${String(moods.length).padStart(2, "0")} 组词单`;
    container.classList.remove("is-swapping");
    void container.offsetWidth;
    container.classList.add("is-swapping");
  }

  function homePage() {
    const dictionaryHistory = state.history.filter((item) => item.type !== "translation");
    const recent = dictionaryHistory.length ? dictionaryHistory.slice(0, 3) : sanitizeHistory(DATA.recent);
    const daily = dailyEntry();
    const copy = copyFor("home");
    const registerLabels = { common: "日常", formal: "正式", literary: "文学", informal: "口语", technical: "技术" };
    const dailyKicker = daily ? `${String(dayNumber()).padStart(3, "0")} · ${registerLabels[daily.register] || "每日"}` : "每日";
    return `
      ${homeTopbar()}
      <section class="home-hero">
        <div class="eyebrow reveal" style="--d:0"><span class="spark"></span>${esc(copy.eyebrow)}</div>
        <h1 class="home-title reveal" style="--d:0.5">${esc(copy.titleLead)}<em>${esc(copy.titleAccent)}</em></h1>
        <p class="home-lede reveal" style="--d:1">${copy.lede}</p>
      </section>
      ${copy.manifesto ? `<div class="theme-manifesto reveal" style="--d:1.2"><span class="manifesto-ru">${esc(copy.manifesto.ru)}</span><span class="manifesto-zh">${esc(copy.manifesto.zh)}</span></div>` : ""}

      <div class="search-wrap reveal" style="--d:1.5">
        <form class="search-card" id="search-form" novalidate>
          <div class="search-top">
            <span class="mono">${esc(copy.searchKicker)}</span>
            <div class="mode-switch" role="group" aria-label="查询模式">
              <button class="mode-btn ${state.mode === "auto" ? "active" : ""}" type="button" data-action="mode" data-mode="auto" aria-pressed="${state.mode === "auto"}">${esc(copy.modes.auto)}</button>
              <button class="mode-btn ${state.mode === "word" ? "active" : ""}" type="button" data-action="mode" data-mode="word" aria-pressed="${state.mode === "word"}">${esc(copy.modes.word)}</button>
              <button class="mode-btn ${state.mode === "chunk" ? "active" : ""}" type="button" data-action="mode" data-mode="chunk" aria-pressed="${state.mode === "chunk"}">${esc(copy.modes.chunk || "意群")}</button>
              <button class="mode-btn ${state.mode === "sentence" ? "active" : ""}" type="button" data-action="mode" data-mode="sentence" aria-pressed="${state.mode === "sentence"}">${esc(copy.modes.sentence)}</button>
            </div>
          </div>
          <div class="search-row">
            <textarea class="search-input" id="search-input" rows="1" placeholder="${attr(copy.searchPlaceholder)}" aria-label="单词或句子" spellcheck="false"></textarea>
            <button class="search-submit" type="submit" aria-label="查询">${icon("arrowUpRight")}</button>
          </div>
          <div class="search-bottom">
            <span class="detected"><i></i><span id="detect-label">自动 · 单词</span></span>
            <span class="search-kbd"><span>↵</span> to search</span>
          </div>
        </form>
        <div class="recent-row" aria-label="最近查询">
          <span class="recent-label">${esc(copy.recentLabel)}</span>
          ${recent.map((item) => `
            <button class="chip" type="button" data-action="lookup" data-query="${attr(item.query)}" data-type="${attr(item.type)}">
              ${item.type === "sentence" ? `<span class="quote-dot"></span>` : ""}
              ${esc(shorten(item.query, 34))}
            </button>`).join("")}
        </div>
      </div>

      <section class="section daily-section reveal" style="--d:2">
        <div class="section-head">
          <div>
            <span class="section-kicker">${esc(copy.dailySectionKicker)}</span>
            <h2>${esc(copy.dailySectionTitle)}</h2>
          </div>
          <span class="side-note">N° ${String(dayNumber()).padStart(3, "0")}</span>
        </div>
        ${daily ? `<button class="daily" type="button" data-action="word" data-word="${attr(daily.word)}" aria-label="打开 ${attr(daily.word)}">
          <div class="daily-top">
            <span class="mono">${esc(dailyKicker)}</span>
            <span class="daily-badge"><i></i>今日词条</span>
          </div>
          <div class="daily-main">
            <p class="daily-word">${esc(daily.word)}</p>
            <div class="daily-phonetic">${esc(daily.phonetic || "")} · ${esc(posLabel(daily.pos))}</div>
          </div>
          <div class="daily-bottom">
            <p class="daily-meaning">${esc(daily.translation || daily.short || "")}</p>
            <span class="daily-arrow">${icon("arrowUpRight")}</span>
          </div>
        </button>` : ""}
      </section>

      <section class="section theme-salon reveal" id="theme-salon" style="--d:2.5">
        ${themeSalonMarkup(currentThemeDeck())}
      </section>

      <footer class="home-footer">
        <span>${esc(copy.footerLeft)}</span><i></i><span>${esc(copy.footerRight)}</span>
      </footer>`;
  }

  return {
    dailyEntry,
    visibleMoods,
    renderMoods,
    homePage
  };
}
