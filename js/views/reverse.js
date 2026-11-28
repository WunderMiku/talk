/* ============================================================
   talk. — Reverse search (context → candidates) thread view & store
   ============================================================ */

import { $, esc, attr, shorten, tapFeedback, copyText } from "../core/utils.js";
import { icon } from "../core/icons.js";
import {
  REVERSE_ANCHOR_RE,
  reverseAnchorWords,
  stripReverseAnchors,
  markdownLite
} from "../model/markdown.js";

function readLocalJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeLocalJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* storage can be full */ }
}

function reverseThreadTitle(thread) {
  const first = (thread || []).find((turn) => turn.role === "user" && turn.content);
  return String(first?.content || "语境寻词").replace(/\s+/g, " ").trim().slice(0, 60);
}

export function createReverseView({
  state,
  copyFor,
  uiLang,
  kvGet = readLocalJson,
  kvSet = writeLocalJson,
  reverseIdFor,
  reverseBudget,
  reverseStyleName,
  modelLookup,
  closeAllWordLayers,
  closeSheet,
  navigate,
  runSearch,
  openHistorySheet,
  renderHistoryContent,
  toast
}) {
  function reverseThreadsKey() {
    return "talk.reverse.threads.v1" + (uiLang() === "en" ? ".en" : "");
  }

  function reverseFirstKey() {
    return "talk.reverse.v2" + (uiLang() === "en" ? ".en" : "");
  }

  function readStoreMap(key) {
    const raw = kvGet(key, {});
    return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
  }

  function loadReverseThreads() {
    return readStoreMap(reverseThreadsKey());
  }

  function saveReverseThreads(map) {
    const entries = Object.values(map).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    const kept = {};
    entries.forEach((entry) => { if (entry?.id) kept[entry.id] = entry; });
    kvSet(reverseThreadsKey(), kept);
  }

  function persistReverseThread() {
    const id = state.reverseThreadId;
    const thread = Array.isArray(state.reverseThread) ? state.reverseThread : [];
    if (!id || !thread.length) return;
    const messages = thread
      .filter((turn) => turn && !turn.pending)
      .map((turn) => ({
        role: turn.role === "assistant" ? "assistant" : "user",
        content: String(turn.content || ""),
        ...(turn.reasoning ? { reasoning: String(turn.reasoning) } : {})
      }))
      .filter((turn) => turn.content);
    if (!messages.length) return;
    const map = loadReverseThreads();
    map[id] = {
      id,
      title: reverseThreadTitle(thread),
      updatedAt: Date.now(),
      budget: Number(state.reverseBudget) || null,
      style: state.reverseStyle || "",
      messages
    };
    saveReverseThreads(map);
  }

  function loadReverseThread(id) {
    if (!id) return null;
    return loadReverseThreads()[id] || null;
  }

  function listReverseThreads() {
    return Object.values(loadReverseThreads())
      .filter((entry) => entry && entry.id && Array.isArray(entry.messages) && entry.messages.length)
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }

  function deleteReverseThread(id) {
    if (!id) return;
    const map = loadReverseThreads();
    delete map[id];
    saveReverseThreads(map);
  }

  function clearReverseThreads() {
    kvSet(reverseThreadsKey(), {});
  }

  function currentReverseThread() {
    return Array.isArray(state.reverseThread) ? state.reverseThread : [];
  }

  function cacheGetReverseFirst(text) {
    return readStoreMap(reverseFirstKey())[reverseIdFor(text)] || null;
  }

  function cachePutReverseFirst(text, data) {
    const map = readStoreMap(reverseFirstKey());
    map[reverseIdFor(text)] = { ...data, at: Date.now() };
    kvSet(reverseFirstKey(), map);
  }

  let activeAbort = null;

  function isReverseBusy() {
    return currentReverseThread().some((turn) => turn && turn.pending);
  }

  function abortActiveReverse() {
    if (activeAbort) {
      try { activeAbort.abort(); } catch (_) { /* no-op */ }
      activeAbort = null;
    }
  }

  function reverseSuggestions() {
    const thread = currentReverseThread();
    const sent = new Set(thread.filter((turn) => turn.role === "user").map((turn) => String(turn.content || "").trim()));
    const last = [...thread].reverse().find((turn) => turn.role === "assistant" && turn.content && !turn.error);
    const anchors = [...new Set(
      [...String(last?.content || "").matchAll(REVERSE_ANCHOR_RE)]
        .map((hit) => hit[1].replace(/\s+/g, " ").trim())
        .filter(Boolean)
    )];
    // Never chop phrases mid-word: separate clean short terms/idioms from full sentences.
    const cleanTerms = anchors.filter((text) => {
      const words = reverseAnchorWords(text);
      return words >= 1 && words <= 5 && text.length <= 30 && !/[.!?]$/.test(text);
    });
    const hasSentence = anchors.some((text) => reverseAnchorWords(text) >= 6 || /[.!?]$/.test(text));
    const first = cleanTerms[0] || "";
    const second = cleanTerms[1] || "";
    const pool = [];
    if (first && second) pool.push(`对比「${first}」和「${second}」的语气差别`);
    if (first) pool.push(`「${first}」更口语怎么说`);
    if (first) pool.push(`用「${first}」造 2 个真实场景例句`);
    if (hasSentence) {
      pool.push("把这句改得更自然口语");
      pool.push("换成书面/邮件语气怎么写");
    }
    pool.push("再地道/简短一点怎么说", "换成正式写作语气怎么改");
    return [...new Set(pool)].filter((text) => !sent.has(text)).slice(0, 2);
  }

  function reverseTurnHtml(turn) {
    if (turn.role === "user") {
      return `<div class="reverse-turn-mine"><div class="reverse-bubble">${esc(turn.content)}</div></div>`;
    }
    if (turn.pending) {
      return `<article class="reverse-turn is-pending" data-surface="elevated">
        <div class="reverse-turn-head"><span class="reverse-turn-dot" aria-hidden="true"></span><span>talk.</span></div>
        <div class="reverse-typing" aria-label="正在组织语言"><i></i><i></i><i></i></div>
        <div class="typing-skeleton"><span></span><span></span><span></span></div>
        <div class="reverse-stream-body" id="reverse-stream"></div>
      </article>`;
    }
    if (turn.error) {
      return `<article class="reverse-turn is-error" data-surface="stamp">
        <p class="reverse-error">${esc(turn.error)}</p>
        <div class="reverse-actions">
          <button class="reverse-chip" type="button" data-action="reverse-regen">${icon("refresh")} 重试</button>
        </div>
      </article>`;
    }
    return `<article class="reverse-turn" data-surface="elevated">
      <div class="reverse-turn-head"><span class="reverse-turn-dot" aria-hidden="true"></span><span>talk.</span></div>
      <div class="reverse-markdown">${markdownLite(turn.content, true)}</div>
      ${turn.reasoning ? `<details class="rev-reasoning"><summary>模型思考</summary><p>${esc(String(turn.reasoning).slice(0, 4000))}</p></details>` : ""}
    </article>`;
  }

  function reverseScrollInnerHtml() {
    const thread = currentReverseThread();
    const chips = reverseSuggestions();
    const last = thread[thread.length - 1];
    const showActions = last && last.role === "assistant" && !last.pending && !last.error && last.content;
    return `
          ${thread.map(reverseTurnHtml).join("")}
          ${showActions ? `<div class="reverse-actions">
            ${chips.map((chip) => `<button class="reverse-chip" type="button" data-action="reverse-follow" data-prompt="${attr(chip)}">${esc(chip)}</button>`).join("")}
            <button class="reverse-chip" type="button" data-action="reverse-regen">${icon("refresh")} 重新生成</button>
            <button class="reverse-chip is-icon" type="button" data-action="reverse-copy" aria-label="复制">${icon("copy")}</button>
          </div>
          <p class="reverse-hint">点击高亮表达看完整词条，长按可填入下方追问框。</p>` : ""}`;
  }

  function syncComposerState(root = document) {
    const sendBtn = $(".reverse-send", root);
    if (!sendBtn) return;
    const busy = isReverseBusy();
    sendBtn.classList.toggle("is-stop", busy);
    sendBtn.type = busy ? "button" : "submit";
    if (busy) {
      sendBtn.dataset.action = "reverse-stop";
      sendBtn.setAttribute("aria-label", "停止生成");
      sendBtn.title = "停止生成";
      sendBtn.innerHTML = `<span class="stop-square" aria-hidden="true"></span>`;
    } else {
      delete sendBtn.dataset.action;
      sendBtn.setAttribute("aria-label", "发送");
      sendBtn.title = "发送";
      sendBtn.innerHTML = icon("arrowRight");
    }
  }

  function reverseThreadHtml() {
    const copy = copyFor("reverse");
    const thread = currentReverseThread();
    const heading = shorten(state.reverseTitle || reverseThreadTitle(thread) || copy.title || "语境寻词", 26);
    const busy = isReverseBusy();
    return `
      <header class="reverse-topbar">
        <button class="icon-btn" type="button" data-action="back" aria-label="返回">${icon("arrowLeft")}</button>
        <div class="reverse-topbar-copy">
          <span class="reverse-kicker">${esc(copy.label || "语境寻词")}</span>
          <strong>${esc(heading)}</strong>
        </div>
        <div class="reverse-topbar-actions">
          <button class="icon-btn reverse-hist-btn" type="button" data-action="reverse-history" aria-label="历史对话" title="历史对话">${icon("clock")}${(() => { const n = listReverseThreads().length; return n ? `<span class="reverse-hist-badge">${n}</span>` : ""; })()}</button>
          <button class="icon-btn reverse-new" type="button" data-action="reverse-new" aria-label="新对话" title="新对话"><span aria-hidden="true">+</span></button>
        </div>
      </header>
      <main class="reverse-page reverse-thread">
        <div class="reverse-scroll">${reverseScrollInnerHtml()}
        </div>
        <form class="reverse-composer" autocomplete="off">
          <input id="reverse-input" type="text" name="q" placeholder="继续追问：换语气、辨析差异、造句，或贴入英文让我润色…" />
          <button class="reverse-send${busy ? " is-stop" : ""}" type="${busy ? "button" : "submit"}" ${busy ? 'data-action="reverse-stop" aria-label="停止生成" title="停止生成"' : 'aria-label="发送" title="发送"'}>${busy ? '<span class="stop-square" aria-hidden="true"></span>' : icon("arrowRight")}</button>
        </form>
      </main>`;
  }

  function reverseScrollToEnd() {
    const scroller = document.querySelector(".reverse-page");
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  function redrawReverse({ scrollToEnd = false } = {}) {
    const screenEl = document.querySelector('.screen[data-page="reverse"]');
    if (!screenEl) return;
    const scroller = $(".reverse-page", screenEl);
    const prevScroll = scroller ? scroller.scrollTop : 0;
    const scrollBox = $(".reverse-scroll", screenEl);
    if (scrollBox) {
      scrollBox.innerHTML = reverseScrollInnerHtml();
      const histBtn = $(".reverse-hist-btn", screenEl);
      if (histBtn) {
        const count = listReverseThreads().length;
        const existingBadge = $(".reverse-hist-badge", histBtn);
        if (count) {
          if (existingBadge) existingBadge.textContent = String(count);
          else histBtn.insertAdjacentHTML("beforeend", `<span class="reverse-hist-badge">${count}</span>`);
        } else if (existingBadge) {
          existingBadge.remove();
        }
      }
      syncComposerState(screenEl);
      if (window.TALK_I18N?.lang === "en") window.TALK_I18N.apply(scrollBox);
    } else {
      screenEl.innerHTML = reverseThreadHtml();
      if (window.TALK_I18N?.lang === "en") window.TALK_I18N.apply(screenEl);
    }
    if (scrollToEnd) {
      reverseScrollToEnd();
    } else {
      const nextScroller = $(".reverse-page", screenEl);
      if (nextScroller) nextScroller.scrollTop = prevScroll;
    }
  }

  function reversePage(result = {}) {
    if (!currentReverseThread().length) {
      const stored = loadReverseThread(result.id || state.reverseThreadId);
      if (stored) {
        state.reverseThreadId = stored.id;
        state.reverseThread = stored.messages.map((turn) => ({ ...turn }));
        state.reverseTitle = stored.title || reverseThreadTitle(stored.messages);
        if (stored.budget) state.reverseBudget = Number(stored.budget);
        if (stored.style) state.reverseStyle = stored.style;
      }
    }
    state.reverse = null;
    return reverseThreadHtml();
  }

  function updateReverseStream(text) {
    const body = document.querySelector(".reverse-turn.is-pending .reverse-stream-body");
    if (!body) return;
    const scroller = document.querySelector(".reverse-page");
    const prevScroll = scroller ? scroller.scrollTop : 0;
    body.innerHTML = markdownLite(String(text || ""), false);
    body.classList.add("has-text");
    const pending = body.closest(".is-pending");
    if (pending) pending.classList.add("has-text");
    if (scroller && scroller.scrollTop !== prevScroll) scroller.scrollTop = prevScroll;
  }

  function openReverseForSubject(kind, rawSubject) {
    const subject = String(rawSubject || "").trim();
    if (!subject) return;
    abortActiveReverse();
    const id = `rv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    state.reverseBudget = reverseBudget();
    state.reverseStyle = reverseStyleName(state.reverseBudget);
    state.reverseThreadId = id;

    const kindLabel = kind === "chunk" ? "意群" : kind === "sentence" ? "句子" : "单词";
    const seedUser = kind === "sentence"
      ? `我想围绕这句英文向你提问：\n"${subject}"`
      : `我想围绕英文${kindLabel}「${subject}」向你提问。`;
    const seedAssistant = kind === "sentence"
      ? `已载入这句英文语境。你可以直接问我它的语气潜台词、长难句逻辑，或让我给出更地道的改写方案。`
      : `已载入${kindLabel} [[${subject}]]。你可以直接追问它的近义词区别、真实外刊造句、搭配限制或常见误用。`;

    state.reverseTitle = shorten(subject, 28);
    state.reverseThread = [
      { role: "user", content: seedUser },
      { role: "assistant", content: seedAssistant }
    ];
    persistReverseThread();
    closeAllWordLayers({ immediate: true });
    navigate({ name: "reverse", id });
    window.requestAnimationFrame(() => {
      const inp = document.querySelector("#reverse-input");
      if (inp) {
        inp.placeholder = kind === "sentence"
          ? "追问这句的语法、语气或更地道改写…"
          : `追问「${shorten(subject, 18)}」的用法、近义词或造句…`;
        inp.focus();
      }
    });
  }

  async function startReverse(query) {
    const text = String(query || "").trim();
    if (!text) return;
    abortActiveReverse();
    const cached = cacheGetReverseFirst(text);
    const id = `rv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    state.reverseBudget = reverseBudget();
    state.reverseStyle = reverseStyleName(state.reverseBudget);
    state.reverseThreadId = id;
    state.reverseTitle = reverseThreadTitle([{ role: "user", content: text }]);
    state.reverseThread = [{ role: "user", content: text }];
    if (cached?.content) {
      state.reverseThread.push({ role: "assistant", content: String(cached.content), reasoning: String(cached.reasoning || "") });
      persistReverseThread();
      navigate({ name: "reverse", id });
      return;
    }
    const placeholder = { role: "assistant", content: "", pending: true };
    state.reverseThread.push(placeholder);
    navigate({ name: "reverse", id });
    const owner = state.reverseThread;
    const alive = () => state.reverseThread === owner;
    const abort = new AbortController();
    activeAbort = abort;
    let partialStream = "";
    try {
      const result = await modelLookup(text, "reverse", state.settings, {
        signal: abort.signal,
        reverseStyle: state.reverseStyle,
        reverseBudget: state.reverseBudget,
        onPreview: (preview) => {
          if (!alive() || !preview?.narrative) return;
          partialStream = String(preview.narrative);
          updateReverseStream(partialStream);
        }
      });
      placeholder.pending = false;
      placeholder.content = String(result?.data?.narrative || "");
      placeholder.reasoning = String(result?.data?.reasoning || "");
      if (placeholder.content) cachePutReverseFirst(text, { content: placeholder.content, reasoning: placeholder.reasoning });
      persistReverseThread();
      if (alive()) redrawReverse();
    } catch (error) {
      placeholder.pending = false;
      if (error?.userCancelled && partialStream.trim()) {
        placeholder.content = partialStream.trim();
        persistReverseThread();
      } else {
        placeholder.error = error?.userCancelled ? "已停止生成，可点击重试继续。" : (error?.message || "这次没有写完，再试一次。");
      }
      if (alive()) redrawReverse();
    } finally {
      if (activeAbort === abort) activeAbort = null;
      if (alive()) syncComposerState();
    }
  }

  /**
   * Build clean alternating multi-turn history up to `endIndex` (exclusive).
   * - Preserves `[[...]]` markers in assistant messages so the model keeps
   *   emitting clickable inline anchors across follow-up turns!
   * - Drops pending, errored, and orphaned user turns whose reply failed.
   * - Caps to the latest 12 turns (6 full rounds) to stay within token budget.
   */
  function reverseHistory(endIndex = currentReverseThread().length) {
    const thread = currentReverseThread();
    const limit = Math.max(0, Math.min(Number(endIndex), thread.length));
    const pairs = [];
    for (let i = 0; i < limit; i++) {
      const turn = thread[i];
      if (!turn || turn.pending || turn.error || !turn.content) continue;
      const role = turn.role === "assistant" ? "assistant" : "user";
      const content = String(turn.content).trim();
      if (!content) continue;
      // Avoid dangling duplicate-role entries (e.g. an earlier user turn whose reply errored).
      if (pairs.length && pairs[pairs.length - 1].role === role) {
        pairs[pairs.length - 1] = { role, content };
      } else {
        pairs.push({ role, content });
      }
    }
    // Never end history on a dangling `user` message before we append the new `user` prompt.
    while (pairs.length && pairs[pairs.length - 1].role === "user") {
      pairs.pop();
    }
    return pairs.slice(-12);
  }

  async function askReverseFollowUp(text) {
    const query = String(text || "").trim();
    if (!query) return;
    if (isReverseBusy()) {
      toast("上一条还在生成中，点右侧方块可停止");
      return;
    }
    const thread = currentReverseThread();
    // If the previous turn ended in an error, remove the stale error bubble so the thread stays clean.
    if (thread.length && thread[thread.length - 1]?.error) {
      thread.pop();
    }
    const history = reverseHistory(thread.length);
    const placeholder = { role: "assistant", content: "", pending: true };
    state.reverseThread.push({ role: "user", content: query }, placeholder);
    persistReverseThread();
    redrawReverse({ scrollToEnd: true });
    const owner = state.reverseThread;
    const alive = () => state.reverseThread === owner;
    const abort = new AbortController();
    activeAbort = abort;
    let partialStream = "";
    try {
      const result = await modelLookup(query, "reverse", state.settings, {
        signal: abort.signal,
        history,
        skipCache: true,
        reverseStyle: state.reverseStyle || reverseStyleName(),
        reverseBudget: state.reverseBudget || reverseBudget(),
        onPreview: (preview) => {
          if (!alive() || !preview?.narrative) return;
          partialStream = String(preview.narrative);
          updateReverseStream(partialStream);
        }
      });
      placeholder.pending = false;
      placeholder.content = String(result?.data?.narrative || "");
      placeholder.reasoning = String(result?.data?.reasoning || "");
      persistReverseThread();
      if (alive()) redrawReverse();
    } catch (error) {
      placeholder.pending = false;
      if (error?.userCancelled && partialStream.trim()) {
        placeholder.content = partialStream.trim();
        persistReverseThread();
      } else {
        placeholder.error = error?.userCancelled ? "已停止生成，可点击重试继续。" : (error?.message || "这次没有写完，再试一次。");
      }
      if (alive()) redrawReverse();
    } finally {
      if (activeAbort === abort) activeAbort = null;
      if (alive()) syncComposerState();
    }
  }

  async function regenerateReverse() {
    const thread = currentReverseThread();
    if (isReverseBusy()) return;
    const last = thread[thread.length - 1];
    if (!last || last.role !== "assistant" || last.pending) return;
    // Find the user turn directly preceding this assistant reply so we don't duplicate it in history!
    let lastUserIndex = -1;
    for (let i = thread.length - 2; i >= 0; i--) {
      if (thread[i]?.role === "user" && thread[i]?.content) {
        lastUserIndex = i;
        break;
      }
    }
    if (lastUserIndex < 0) return;
    const prompt = String(thread[lastUserIndex].content).trim();
    if (!prompt) return;
    const history = reverseHistory(lastUserIndex);
    thread.pop();
    const placeholder = { role: "assistant", content: "", pending: true };
    thread.push(placeholder);
    redrawReverse({ scrollToEnd: true });
    const owner = thread;
    const alive = () => state.reverseThread === owner;
    const abort = new AbortController();
    activeAbort = abort;
    let partialStream = "";
    try {
      const result = await modelLookup(prompt, "reverse", state.settings, {
        signal: abort.signal,
        history,
        skipCache: true,
        reverseStyle: state.reverseStyle || reverseStyleName(),
        reverseBudget: state.reverseBudget || reverseBudget(),
        onPreview: (preview) => {
          if (!alive() || !preview?.narrative) return;
          partialStream = String(preview.narrative);
          updateReverseStream(partialStream);
        }
      });
      placeholder.pending = false;
      placeholder.content = String(result?.data?.narrative || "");
      placeholder.reasoning = String(result?.data?.reasoning || "");
      persistReverseThread();
      if (alive()) redrawReverse();
    } catch (error) {
      placeholder.pending = false;
      if (error?.userCancelled && partialStream.trim()) {
        placeholder.content = partialStream.trim();
        persistReverseThread();
      } else {
        placeholder.error = error?.userCancelled ? "已停止生成，可点击重试继续。" : (error?.message || "这次没有写完，再试一次。");
      }
      if (alive()) redrawReverse();
    } finally {
      if (activeAbort === abort) activeAbort = null;
      if (alive()) syncComposerState();
    }
  }

  function submitReverseComposer() {
    if (isReverseBusy()) {
      toast("上一条还在生成中，点右侧方块可停止");
      return;
    }
    const field = $("#reverse-input");
    const text = String(field?.value || "").trim();
    if (!text) return;
    field.value = "";
    void askReverseFollowUp(text);
  }

  function gotoReverseAnchor(expression) {
    const text = String(expression || "").trim();
    if (!text) return;
    persistReverseThread();
    state.restoreScroll = document.querySelector(".reverse-page")?.scrollTop
      || document.querySelector(".screen")?.scrollTop
      || 0;
    const type = reverseAnchorWords(text) <= 2 ? "word" : "chunk";
    runSearch(text, type);
  }

  function startNewReverseSession({ event }) {
    event.preventDefault();
    abortActiveReverse();
    state.reverseThread = [];
    state.reverseThreadId = "";
    state.reverseTitle = "";
    navigate({ name: "home" });
    const field = $("#search-input");
    if (field) requestAnimationFrame(() => field.focus());
  }

  const actions = {
    "reverse-anchor"({ event, target }) {
      event.preventDefault();
      gotoReverseAnchor(target.dataset.text || "");
    },
    "reverse-again": startNewReverseSession,
    "reverse-new": startNewReverseSession,
    "reverse-stop"({ event }) {
      event.preventDefault();
      abortActiveReverse();
    },
    "reverse-regen"() {
      void regenerateReverse();
    },
    "ask-ai-about"({ event, target }) {
      event.preventDefault();
      tapFeedback();
      openReverseForSubject(target.dataset.kind || "word", target.dataset.subject || "");
    },
    "reverse-follow"({ event, target }) {
      event.preventDefault();
      void askReverseFollowUp(target.dataset.prompt || "");
    },
    "reverse-copy"({ event }) {
      event.preventDefault();
      const thread = currentReverseThread();
      const last = [...thread].reverse().find((turn) => turn.role === "assistant" && turn.content);
      if (!last) return;
      void copyText(stripReverseAnchors(String(last.content)).trim()).then((copied) => {
        toast(copied ? "正文已复制" : "这个浏览器不允许复制");
      });
    },
    "reverse-history"({ event }) {
      event.preventDefault();
      tapFeedback();
      openHistorySheet("reverse");
    },
    "reverse-open-thread"({ event, target }) {
      event.preventDefault();
      const id = target.dataset.id || "";
      const stored = loadReverseThread(id);
      if (!stored) return;
      abortActiveReverse();
      tapFeedback();
      closeSheet({ immediate: true });
      state.reverseThreadId = stored.id;
      state.reverseThread = stored.messages.map((turn) => ({ ...turn }));
      state.reverseTitle = stored.title || reverseThreadTitle(stored.messages);
      state.reverseBudget = Number(stored.budget) || state.reverseBudget;
      state.reverseStyle = stored.style || state.reverseStyle;
      navigate({ name: "reverse", id: stored.id });
    },
    "reverse-delete-thread"({ event, target }) {
      event.preventDefault();
      const id = target.dataset.id || "";
      if (!id) return;
      deleteReverseThread(id);
      if (state.reverseThreadId === id) {
        abortActiveReverse();
        state.reverseThread = [];
        state.reverseThreadId = "";
        state.reverseTitle = "";
      }
      renderHistoryContent();
      toast("已删除这条寻词记录");
    },
    "clear-reverse-threads"({ event }) {
      event.preventDefault();
      abortActiveReverse();
      clearReverseThreads();
      state.reverseThread = [];
      state.reverseThreadId = "";
      state.reverseTitle = "";
      renderHistoryContent();
      toast("已清空寻词记录");
    }
  };

  return {
    reverseThreadsKey,
    loadReverseThreads,
    saveReverseThreads,
    persistReverseThread,
    loadReverseThread,
    listReverseThreads,
    deleteReverseThread,
    clearReverseThreads,
    currentReverseThread,
    cacheGetReverseFirst,
    cachePutReverseFirst,
    reversePage,
    redrawReverse,
    updateReverseStream,
    openReverseForSubject,
    startReverse,
    askReverseFollowUp,
    regenerateReverse,
    submitReverseComposer,
    gotoReverseAnchor,
    actions
  };
}
