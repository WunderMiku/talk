/* ============================================================
   talk. — Model Lookup Orchestration, Streaming Previews, Prefetch & Theme Examples
   ============================================================ */

import { $, esc, shorten, normalizeWord, wait, posLabel } from "../core/utils.js";
import { diagLog } from "../core/diagnostics.js";
import { streamPreviewFromJson } from "./stream-preview.js";
import {
  isHallucinatedWord,
  normalizeExamplesByTheme,
  splitSentences,
  alignSentenceParts,
  normalizeModelWord,
  normalizeModelSentence,
  ensureChunk
} from "./normalize.js";
import { DETAIL_LEVELS } from "../storage/settings.js";
import { PREFETCH_LIMIT } from "../storage/word-cache.js";
import { uniqueWords } from "../views/layers.js";

// Sentences now carry a summary, a parse tree and level-tagged key words,
// which no longer fits in the old per-detail ceiling.
export const SENTENCE_MAX_TOKENS = { fast: 6000, standard: 12000, deep: 20000 };
// The depth option shapes the prompt; these ceilings only stop a runaway reply.
export const SENTENCE_DEPTH_BRIEF = {
  fast: "需要多少写多少即可，但偏向精简：tree 一般 3–5 个节点，重点词 2–4 个，每层解释一句话。",
  standard: "按内容需要完整展开：tree 一般 6–9 个节点，重点词按等级上限，解释具体但不铺陈。",
  deep: "尽量讲透：tree 可到 12–14 个节点，重点词到上限，补语域、易错点与阅读提示，但不要重复。"
};
// Single source for the model-request deadline; error copy derives from it.
export const MODEL_TIMEOUT_MS = 180_000;
export const MODEL_TIMEOUT_TEXT = `请求超过 ${MODEL_TIMEOUT_MS / 1000} 秒`;

const THEME_EXAMPLE_LIMIT = 8;

export function createLookupService({
  state,
  data: DATA,
  llm: LLM,
  englishDirective,
  reverseIdFor,
  sentenceLevelOf,
  exampleStyleFor,
  themesMissingExamples,
  hasModelConfig,
  cacheGetWord,
  cachePutWord,
  cacheGetChunk,
  cachePutChunk,
  cacheGetSentence,
  cachePutSentence,
  sentenceKey,
  cacheGetReverseFirst,
  updateReverseStream,
  updateExamplesBlock,
  refreshCacheBorders,
  updateCacheCorner,
  hideCacheCorner
}) {
  const wordRequests = new Map();
  const wordPreviewListeners = new Map();
  const examplesInFlight = new Set();
  let prefetchToken = 0;

  function reverseBudget() {
    return Math.max(600, Math.min(3000, Number(state.settings?.reverseMaxTokens) || 1500));
  }

  function reverseZoneName(budget = reverseBudget()) {
    if (budget < 1000) return "只给结论";
    if (budget < 2000) return "分块讲解";
    return "成句拆解";
  }

  function reverseStyleName(budget = reverseBudget()) {
    if (window.TALK_PROMPTS.reverseFor) return window.TALK_PROMPTS.reverseFor(budget);
    return "editor";
  }

  function systemPrompt(type, reverseStyle = "") {
    let base = window.TALK_PROMPTS.word;
    if (type === "sentence") base = window.TALK_PROMPTS.sentence;
    else if (type === "chunk") base = window.TALK_PROMPTS.chunk;
    else if (type === "reverse") {
      const prompts = window.TALK_PROMPTS.reversePrompts;
      base = (reverseStyle && prompts?.[reverseStyle]) || window.TALK_PROMPTS.reverse;
    }
    return base + englishDirective();
  }

  function themeBriefs() {
    return (window.TALK_THEME?.list?.() || []).map((theme) => ({
      id: theme.id,
      style: exampleStyleFor(theme.id)
    }));
  }

  function wordPrompt(query) {
    // Dynamic query is deliberately last so the static system prefix and the
    // task/detail prefix can be reused by provider prompt caches.
    return JSON.stringify({
      task: "word",
      query: String(query),
      themes: themeBriefs().filter((theme) => {
        const active = window.TALK_THEME?.current?.();
        return !active || theme.id === active.id;
      })
    });
  }

  function chunkPrompt(query, detail = "standard") {
    return JSON.stringify({ task: "chunk", detail, query: String(query) });
  }

  function reversePrompt(text) {
    return String(text || "").trim();
  }

  function sentencePrompt(query, detail = "standard", pieces = []) {
    const level = sentenceLevelOf(state.settings?.sentenceLevel);
    const sentences = pieces.length ? pieces.map((text, index) => ({ index, text })) : undefined;
    return JSON.stringify({
      task: "sentence",
      detail,
      level: level.id,
      maxKeyWords: level.maxKeyWords,
      levelHint: level.hint,
      length: SENTENCE_DEPTH_BRIEF[detail] || SENTENCE_DEPTH_BRIEF.standard,
      text: String(query),
      ...(sentences ? { sentences } : {})
    });
  }

  async function modelLookup(query, type, cfg, options = {}) {
    const resolvedCfg = LLM.resolveConfig(cfg);
    const detail = resolvedCfg.detailLevel || "standard";
    if (type === "word") {
      const cached = cacheGetWord(query, detail);
      if (cached) return { type: "word", data: cached };
    }
    if (type === "chunk" && !options.skipCache) {
      const cached = cacheGetChunk(query);
      if (cached) return { type: "chunk", data: cached };
    }
    if (type === "reverse" && !options.skipCache && !(options.history || []).length) {
      const cached = cacheGetReverseFirst(query);
      if (cached?.content) {
        return { type: "reverse", data: { id: reverseIdFor(query), text: query, narrative: cached.content, reasoning: cached.reasoning || "" } };
      }
    }
    const pieces = type === "sentence" ? splitSentences(query) : [];
    const sentenceCacheKey = type === "sentence"
      ? await sentenceKey(query, sentenceLevelOf(resolvedCfg.sentenceLevel).id, detail)
      : "";
    if (type === "sentence" && !options.skipCache) {
      const cached = cacheGetSentence(sentenceCacheKey);
      if (cached) {
        diagLog("info", "sentence.cache", "hit", { chars: String(query).length });
        return { type: "sentence", data: cached };
      }
    }
    // Validate base URL / key upfront before arming timers.
    LLM.endpointFor(resolvedCfg.baseUrl, resolvedCfg);
    const prompt = type === "sentence"
      ? sentencePrompt(query, detail, pieces)
      : type === "chunk"
        ? chunkPrompt(query, detail)
        : type === "reverse"
          ? reversePrompt(query)
          : wordPrompt(query);
    const history = Array.isArray(options?.history)
      ? options.history
        .filter((turn) => turn && turn.content)
        .map((turn) => ({ role: turn.role === "assistant" ? "assistant" : "user", content: String(turn.content) }))
      : [];
    const messages = [
      { role: "system", content: systemPrompt(type, options.reverseStyle) },
      ...history,
      { role: "user", content: prompt }
    ];
    const externalSignal = options?.signal || null;
    const isUserAborted = () => Boolean(externalSignal?.aborted);
    let controller = new AbortController();
    let timedOut = false;
    let timer = 0;
    const onExternalAbort = () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    if (externalSignal) {
      if (externalSignal.aborted) {
        const abortErr = new Error("已停止生成");
        abortErr.name = "AbortError";
        abortErr.userCancelled = true;
        throw abortErr;
      }
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
    const armDeadline = () => {
      window.clearTimeout(timer);
      controller = new AbortController();
      if (externalSignal?.aborted) controller.abort();
      timedOut = false;
      timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, MODEL_TIMEOUT_MS);
    };
    armDeadline();
    const detailTokens = (DETAIL_LEVELS[detail] || DETAIL_LEVELS.standard).maxTokens;
    const wanted = type === "sentence"
      ? Math.max(detailTokens, SENTENCE_MAX_TOKENS[detail] || SENTENCE_MAX_TOKENS.standard)
      : type === "chunk"
        ? Math.max(detailTokens, 2400)
        : type === "reverse"
          ? (Number(options.reverseBudget) || reverseBudget())
          : detailTokens;
    const maxTokens = Math.min(wanted, LLM.outputCeiling(resolvedCfg));
    const temperature = type === "reverse" ? 0.7 : 0.3;
    const isJsonTask = type !== "reverse";
    let content = "";
    let usage = null;
    const addUsage = (u) => {
      if (!u || typeof u !== "object") return;
      const next = {
        prompt: Number(u.prompt_tokens ?? u.input_tokens ?? u.promptTokenCount ?? 0) || 0,
        completion: Number(u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount ?? 0) || 0,
        total: Number(u.total_tokens ?? u.totalTokenCount ?? 0) || 0
      };
      if (!next.total) next.total = next.prompt + next.completion;
      if (!next.total) return;
      usage = usage
        ? { prompt: usage.prompt + next.prompt, completion: usage.completion + next.completion, total: usage.total + next.total }
        : next;
    };
    const startedAt = Date.now();
    state.lastReasoning = "";
    diagLog("info", "model.start", `${type} · ${detail}`, { chars: String(query).length });
    const onBuffered = ({ host, contentType }) => {
      diagLog("info", "stream.buffered", "网关把流式响应缓冲成了整段 JSON", { host, contentType });
      if (!window.__talkStreamWarned) {
        window.__talkStreamWarned = true;
        console.info("Provider returned a buffered JSON response despite stream=true.");
      }
    };
    const streamOnce = (msgs = messages) => LLM.sendChatStream(resolvedCfg, msgs, {
      signal: controller.signal,
      allowJsonMode: false,
      googleJsonMode: isJsonTask,
      maxTokens,
      temperature,
      onDelta: (partial) => {
        if (typeof options.onPreview === "function") {
          try { options.onPreview(streamPreviewFromJson(partial, type, query)); } catch (_) { /* best-effort */ }
        }
      },
      onReasoning: (chunk) => {
        state.lastReasoning = String(state.lastReasoning || "") + chunk;
      },
      onUsage: addUsage,
      onBuffered
    });
    try {
      // Do not combine streaming with response_format by default: some
      // OpenAI-compatible gateways silently return one buffered JSON response
      // when both are present. The static prompt already requires JSON.
      content = await streamOnce();
    } catch (error) {
      if (isUserAborted()) {
        const abortErr = new Error("已停止生成");
        abortErr.name = "AbortError";
        abortErr.userCancelled = true;
        throw abortErr;
      }
      diagLog("error", "model.fail", timedOut ? `请求超时（${MODEL_TIMEOUT_MS / 1000} 秒）` : (error?.message || String(error)), { type, detail, ms: Date.now() - startedAt, chars: String(query).length });
      // Mobile networks drop long streams and gateways sometimes cut our
      // deadline. Both are worth one silent retry with a fresh signal.
      const retriable = timedOut || error?.name !== "AbortError" || /不是 JSON|空响应|Failed to fetch|network error/i.test(String(error?.message || ""));
      if (!content && retriable && !isUserAborted()) {
        await wait(timedOut ? 300 : 900);
        if (!isUserAborted()) {
          armDeadline();
          try {
            content = await streamOnce();
          } catch (retryError) {
            diagLog("error", "model.fail", retryError?.message || String(retryError), { type, detail, ms: Date.now() - startedAt, chars: String(query).length, attempt: 2 });
          }
        }
      }
      // Older/limited gateways may reject streaming. Retry once non-streaming
      // only when no content has been received.
      if (!content && retriable && !isUserAborted()) {
        armDeadline();
        const response = await LLM.sendChat(resolvedCfg, messages, {
          signal: controller.signal,
          allowJsonMode: isJsonTask,
          maxTokens,
          temperature
        });
        if (!response.ok) {
          throw new Error(await LLM.readHttpError(response, 260));
        }
        const json = await LLM.readJsonResponse(response);
        addUsage(json?.usage || json?.usageMetadata);
        content = LLM.extractContent(json, resolvedCfg);
      }
      if (isUserAborted()) {
        const abortErr = new Error("已停止生成");
        abortErr.name = "AbortError";
        abortErr.userCancelled = true;
        throw abortErr;
      }
      if (!content) throw timedOut ? new Error(`请求超时（${MODEL_TIMEOUT_MS / 1000} 秒），网关没有返回内容，可以重试或换一个模型。`) : error;
    } finally {
      window.clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
    }
    if (!content && !isUserAborted()) {
      diagLog("error", "model.empty", "网关返回了空内容", { type, detail, chars: 0 });
      armDeadline();
      try {
        content = await streamOnce();
      } catch (emptyRetryError) {
        diagLog("error", "model.fail", emptyRetryError?.message || String(emptyRetryError), { type, detail, attempt: 2 });
      } finally {
        window.clearTimeout(timer);
      }
    }
    if (!content) throw new Error("模型返回了空消息。");
    diagLog("info", "model.content", `${type} · ${detail}`, { chars: content.length, ms: Date.now() - startedAt });
    state.lastModelRaw = {
      type,
      detail,
      chars: content.length,
      cut: content.length > 2400,
      text: String(content).slice(0, 2400)
    };

    if (type === "reverse") {
      return { type: "reverse", data: { id: reverseIdFor(query), text: query, narrative: String(content).trim(), reasoning: String(state.lastReasoning || "") } };
    }
    let parsed;
    let retryLength = null;
    const emptyish = content.trim().length < 12;
    try {
      if (emptyish) throw new Error("模型返回的内容过短，可能被网关截断了。");
      parsed = LLM.parseJsonObject(content);
    } catch (parseError) {
      diagLog("error", emptyish ? "model.empty" : "model.parse", parseError?.message || String(parseError), { type, detail, chars: content.length });
      // A truncated answer is the most common cause here: retry once with a
      // larger ceiling instead of showing a raw JSON error to the reader.
      if (!emptyish && !/JSON|Unexpected|Expected|Unterminated/i.test(String(parseError?.message || ""))) throw parseError;
      armDeadline();
      const retryTokens = Math.min(LLM.outputCeiling(resolvedCfg), Math.round(maxTokens * 1.5));
      const retryMessages = messages.concat([{
        role: "user",
        content: '上一次输出不是合法 JSON（常见原因：字符串里出现未转义的双引号或真实换行，或者中途被截断）。请重写：所有字符串内的双引号必须转义，不要输出换行符；保持同样的详细程度，但务必输出完整闭合的 JSON；如果确实太长，只省略 family/synonyms/antonyms 里的嵌套细节，不要删掉义项、句子分析或重点词。'
      }]);
      let retryContent = "";
      try {
        const retry = await LLM.sendChat(resolvedCfg, retryMessages, {
          signal: controller.signal,
          allowJsonMode: true,
          maxTokens: retryTokens,
          temperature
        });
        if (!retry.ok) throw parseError;
        const retryJson = await LLM.readJsonResponse(retry);
        addUsage(retryJson?.usage || retryJson?.usageMetadata);
        retryContent = LLM.extractContent(retryJson, resolvedCfg);
      } finally {
        window.clearTimeout(timer);
      }
      if (!retryContent) throw parseError;
      try {
        parsed = LLM.parseJsonObject(retryContent);
        retryLength = retryContent.length;
        content = retryContent;
      } catch (_) {
        diagLog("error", "model.truncated", "json truncated", { type, detail, chars: retryContent.length, tokens: retryTokens });
        throw new Error(`模型返回的 JSON 被截断（约 ${retryContent.length} 字符），可以重试或把生成深度调到「深入」。`);
      }
    }
    diagLog("info", "model.ok", `${type} · ${detail}`, { chars: content.length, ms: Date.now() - startedAt, retried: retryLength !== null });
    if (type === "chunk") {
      const data = ensureChunk({ ...parsed, chunk: parsed?.chunk || query });
      data.source = "model";
      data.model = resolvedCfg.model;
      cachePutChunk(query, data, detail);
      return { type: "chunk", data };
    }
    if (type === "word") {
      let data = normalizeModelWord(parsed, query);
      if (isHallucinatedWord(data.word, query)) {
        diagLog("warn", "model.wrong-word", `returned "${data.word}" for "${query}", retrying`, { query, got: data.word });
        if (typeof options.onPreview === "function") {
          try { options.onPreview({ kind: "discard", wrongWord: data.word, targetWord: String(query) }); } catch (_) { /* best-effort */ }
        }
        armDeadline();
        try {
          const fixMessages = [
            { role: "system", content: systemPrompt("word") },
            { role: "user", content: `请解释英文词 "${String(query)}"（详细度：${detail}）。注意：JSON 的 word 字段必须是 "${String(query)}"，绝不要把 detail 参数值（如 standard）当成要查的词。` }
          ];
          let fixText = "";
          try {
            fixText = await streamOnce(fixMessages);
          } catch (_) { /* fall back to non-streaming below */ }
          if (!fixText) {
            const fixRes = await LLM.sendChat(resolvedCfg, fixMessages, {
              signal: controller.signal,
              allowJsonMode: true,
              maxTokens,
              temperature
            });
            if (fixRes.ok) {
              const fixJson = await LLM.readJsonResponse(fixRes, "词头纠偏重试");
              addUsage(fixJson?.usage || fixJson?.usageMetadata);
              fixText = LLM.extractContent(fixJson, resolvedCfg);
            }
          }
          if (fixText) {
            const reparsed = LLM.parseJsonObject(fixText);
            const retried = normalizeModelWord(reparsed, query);
            if (!isHallucinatedWord(retried.word, query)) data = retried;
          }
        } catch (_) { /* checked below */ }
        finally { window.clearTimeout(timer); }
        if (isHallucinatedWord(data.word, query)) {
          throw new Error(`模型误返回了无关词条「${data.word}」，请重试查「${query}」。`);
        }
      }
      data.source = "model";
      data.model = resolvedCfg.model;
      data.gen = { ms: Math.max(0, Date.now() - startedAt), model: resolvedCfg.model || "", tokens: usage?.total ?? null, at: Date.now() };
      cachePutWord(normalizeWord(data.word), data, detail, data.gen);
      if (normalizeWord(query) !== normalizeWord(data.word)) cachePutWord(query, data, detail, data.gen);
      return { type: "word", data };
    }
    const data = normalizeModelSentence(parsed, query);
    if (pieces.length > 1 && data.sentences.length) {
      data.sentences = alignSentenceParts(data.sentences, pieces);
    }
    data.sourceType = "model";
    data.model = resolvedCfg.model;
    data.source = "语境分析";
    if (sentenceCacheKey) {
      data.id = `model-${sentenceCacheKey}`;
      cachePutSentence(sentenceCacheKey, data, sentenceLevelOf(resolvedCfg.sentenceLevel).id, detail);
    }
    return { type: "sentence", data };
  }

  function lookupWordDeduped(word, options = {}) {
    const key = normalizeWord(word);
    const cached = cacheGetWord(key);
    if (cached) return Promise.resolve({ type: "word", data: cached });
    if (options.onPreview) {
      const listeners = wordPreviewListeners.get(key) || new Set();
      listeners.add(options.onPreview);
      wordPreviewListeners.set(key, listeners);
    }
    if (wordRequests.has(key)) return wordRequests.get(key);
    const listeners = wordPreviewListeners.get(key) || new Set();
    const request = modelLookup(key, "word", state.settings, {
      onPreview: (preview) => listeners.forEach((listener) => {
        try { listener(preview); } catch (_) { /* preview is best-effort */ }
      })
    }).finally(() => {
      wordRequests.delete(key);
      wordPreviewListeners.delete(key);
    });
    wordRequests.set(key, request);
    return request;
  }

  function prefetchPlan(data) {
    if (!data) return { all: [], fresh: [] };
    const all = uniqueWords([
      ...(data.family || []),
      ...(data.synonyms || []),
      ...(data.antonyms || []),
      ...(data.related || [])
    ], data.word);
    const fresh = all.filter((word) => {
      const key = normalizeWord(word);
      return Boolean(key) && !DATA.words[key] && !cacheGetWord(key);
    });
    return { all, fresh };
  }

  function cachedRelatedCount(plan) {
    return plan.all.filter((word) => {
      const key = normalizeWord(word);
      return Boolean(key) && (Boolean(DATA.words[key]) || Boolean(cacheGetWord(key)));
    }).length;
  }

  async function runPrefetch(plan, token) {
    const queue = [...plan.fresh].slice(0, PREFETCH_LIMIT);
    const worker = async () => {
      while (queue.length) {
        if (token !== prefetchToken || !state.settings.prefetch) return;
        const word = queue.shift();
        const key = normalizeWord(word);
        if (!key || DATA.words[key] || cacheGetWord(key)) continue;
        try {
          await lookupWordDeduped(key);
        } catch (_) {
          // Prefetch is best-effort; never interrupt the reading flow.
        }
        refreshCacheBorders();
        if (token === prefetchToken) {
          const cached = cachedRelatedCount(plan);
          const total = plan.all.length;
          if (cached >= total) {
            updateCacheCorner(true, `本页 ${total} 个相关词已缓存`);
          } else {
            updateCacheCorner(false, `正在预加载 ${cached}/${total} 个相关词`);
          }
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (token !== prefetchToken) return;
    const cached = cachedRelatedCount(plan);
    const total = plan.all.length;
    if (cached >= total) {
      updateCacheCorner(true, `本页 ${total} 个相关词已缓存`);
    } else {
      updateCacheCorner(false, `预加载未完成 · ${cached}/${total} 个相关词已缓存`);
    }
  }

  function schedulePrefetch(data) {
    if (!data) {
      hideCacheCorner();
      return;
    }
    const plan = prefetchPlan(data);
    const total = plan.all.length;
    if (!total) {
      hideCacheCorner();
      return;
    }
    const cached = cachedRelatedCount(plan);
    const token = ++prefetchToken;

    if (!plan.fresh.length) {
      updateCacheCorner(true, `本页 ${total} 个相关词已缓存`);
      return;
    }

    if (!hasModelConfig() || !state.settings.prefetch) {
      updateCacheCorner(
        false,
        !hasModelConfig()
          ? "连接模型后可预加载相关词"
          : `预加载已关闭 · ${cached}/${total} 个相关词已缓存`
      );
      return;
    }

    updateCacheCorner(false, `正在预加载 ${cached}/${total} 个相关词`);
    window.setTimeout(() => {
      if (token === prefetchToken) void runPrefetch(plan, token);
    }, 900);
  }

  function cancelPrefetch() {
    prefetchToken += 1;
    hideCacheCorner();
  }

  async function fillThemeExamples(word, missing) {
    const themes = missing.slice(0, THEME_EXAMPLE_LIMIT).map((id) => ({ id, style: exampleStyleFor(id) }));
    if (!themes.length) return;
    const payload = {
      task: "themes",
      word: word.word,
      pos: word.pos,
      short: word.short,
      senses: (word.senses || []).slice(0, 3).map((sense) => sense.zh || sense.en).filter(Boolean),
      existing: (word.examples || []).map((item) => item.en).filter(Boolean).slice(0, 6),
      themes
    };
    const data = await LLM.requestJson({
      settings: state.settings,
      system: window.TALK_PROMPTS.examples,
      user: payload,
      maxTokens: 900,
      timeoutMs: 45_000,
      label: "主题例句补全",
      disableThinking: true,
      temperature: 0.3,
      retries: 0
    });
    const fresh = normalizeExamplesByTheme(data.examplesByTheme || data.examples_by_theme || data);
    if (!fresh) return;
    const merged = normalizeExamplesByTheme({ ...(word.examplesByTheme || {}), ...fresh });
    if (!merged) return;
    word.examplesByTheme = merged;
    const cached = cacheGetWord(word.word);
    if (cached) {
      cached.examplesByTheme = merged;
      // Keep the original receipt: refilling examples must not erase when,
      // by which model, or for how many tokens the entry was written.
      cachePutWord(normalizeWord(word.word), cached, state.settings.detailLevel || "standard", cached.gen || null);
    }
    updateExamplesBlock(word);
  }

  function scheduleThemeExamples(word) {
    if (!word || !hasModelConfig()) return;
    const activeTheme = window.TALK_THEME?.current?.();
    const missing = themesMissingExamples(word).filter((id) => !activeTheme || id === activeTheme.id);
    if (!missing.length) return;
    const key = normalizeWord(word.word);
    if (!key || examplesInFlight.has(key)) return;
    examplesInFlight.add(key);
    fillThemeExamples(word, missing)
      .catch(() => { /* keep the old examples; try again on a later visit */ })
      .finally(() => examplesInFlight.delete(key));
  }

  function tossWrongPreview(host, wrongWord, targetWord) {
    if (!host) return;
    const skeleton = $(".skeleton-stack");
    const hasCard = !host.hidden && host.innerHTML.trim().length > 0;
    const finishReset = () => {
      host.classList.remove("is-tossing", "has-content");
      host.dataset.signature = "";
      host.dataset.tossing = "";
      host.innerHTML = `<span class="live-preview-kicker is-retry"><i></i>${wrongWord ? `已丢弃跑偏词条「${esc(wrongWord)}」，` : ""}正在重查「${esc(targetWord || "")}」…</span>`;
      host.hidden = false;
      host.classList.add("is-arriving");
      window.setTimeout(() => host.classList.remove("is-arriving"), 280);
      if (skeleton) skeleton.classList.remove("is-streaming");
    };
    if (!hasCard) {
      finishReset();
      return;
    }
    host.dataset.tossing = "1";
    host.classList.remove("is-arriving");
    host.classList.add("is-tossing");
    window.setTimeout(finishReset, 420);
  }

  function updateStreamPreview(preview, type) {
    if (!preview) return;
    if (preview.kind === "reverse") {
      updateReverseStream(preview.narrative || "");
      return;
    }
    const host = $("#live-preview");
    if (!host) return;
    if (preview.kind === "discard") {
      tossWrongPreview(host, preview.wrongWord || "", preview.targetWord || "");
      return;
    }
    if (host.dataset.tossing === "1") return;
    const signature = JSON.stringify(preview);
    if (host.dataset.signature === signature) return;
    host.dataset.signature = signature;
    host.hidden = false;
    host.classList.add("has-content");
    const skeleton = $(".skeleton-stack");
    if (skeleton) skeleton.classList.add("is-streaming");
    if (type === "sentence") {
      host.innerHTML = `
        <span class="live-preview-kicker"><i></i>正在分段返回${preview.received ? ` · 模型已返回 ${preview.received.toLocaleString("en-US")} 字` : ""}</span>
        <h2 class="live-preview-word">${esc(shorten(preview.text || "", 80))}</h2>
        ${preview.tone ? `<span class="live-preview-meta">${esc(preview.tone)}</span>` : ""}
        ${preview.translation ? `<p class="live-preview-translation">${esc(preview.translation)}</p>` : `<p class="live-preview-pending">正在整理译文…</p>`}
        ${preview.structure ? `<p class="live-preview-note">${esc(preview.structure)}</p>` : ""}`;
      return;
    }
    host.innerHTML = `
      <span class="live-preview-kicker"><i></i>正在分段返回${preview.received ? ` · 模型已返回 ${preview.received.toLocaleString("en-US")} 字` : ""}</span>
      <h2 class="live-preview-word">${esc(preview.word || "")}</h2>
      <div class="live-preview-meta">${esc(preview.phonetic || "")}${preview.pos ? ` · ${esc(posLabel(preview.pos))}` : ""}</div>
      ${preview.translation ? `<p class="live-preview-translation">${esc(preview.translation)}</p>` : `<p class="live-preview-pending">正在整理第一段…</p>`}
      ${preview.short ? `<p class="live-preview-note">${esc(preview.short)}</p>` : ""}
      ${(preview.senses || []).length ? `<ul class="live-preview-senses">${preview.senses.map((sense) => `<li>${esc(shorten(sense, 42))}</li>`).join("")}</ul>` : ""}`;
  }

  async function callWordbookAi(task, payload) {
    const sys = task === "classify"
      ? window.TALK_PROMPTS.wordbookClassify
      : task === "extract"
        ? window.TALK_PROMPTS.wordbookExtract
        : window.TALK_PROMPTS.wordbookArticle;
    const label = task === "classify" ? "主题分册" : task === "extract" ? "AI 提取词条" : "生成精读文章";
    const maxTokens = task === "extract" ? 2400 : 3200;
    return LLM.requestJson({
      settings: state.settings,
      system: sys,
      user: payload,
      maxTokens,
      timeoutMs: Math.max(MODEL_TIMEOUT_MS, 90_000),
      label,
      disableThinking: true,
      temperature: 0.3,
      retries: 1
    });
  }

  return {
    reverseBudget,
    reverseZoneName,
    reverseStyleName,
    modelLookup,
    lookupWordDeduped,
    schedulePrefetch,
    cancelPrefetch,
    scheduleThemeExamples,
    fillThemeExamples,
    updateStreamPreview,
    callWordbookAi
  };
}
