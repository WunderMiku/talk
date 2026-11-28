/**
 * talk. Unified LLM Client (js/llm-client.js)
 * Single source of truth for:
 *  - Active profile resolution (never reads stale root settings when profiles exist)
 *  - Provider protocol detection (OpenAI-compatible, Anthropic Claude Messages API, and Google Gemini)
 *  - Automatic thinking suppression on structured JSON tasks so reasoning tokens never truncate JSON
 *  - Unified streaming (SSE + buffered fallback), non-streaming chat, model discovery, and connectivity ping
 *  - Unified timeout, retry, json_object/stream_options 400/422 fallback, and strict JSON extraction
 */
(function () {
  // app.js seals keys as "sealed:v1:<iv>.<ct>"; accept the older
  // "talk.sealed.v1:" spelling too so a stale value can never be sent as a Bearer token.
  const SEAL_PREFIX = "sealed:v1:";
  const LEGACY_SEAL_PREFIX = "talk.sealed.v1:";
  const ANTHROPIC_VERSION = "2023-06-01";
  const DEFAULT_ANTHROPIC_BASE = "https://api.anthropic.com/v1";

  function isSealedKey(value) {
    const key = String(value || "");
    return key.startsWith(SEAL_PREFIX) || key.startsWith(LEGACY_SEAL_PREFIX);
  }

  function usableApiKey(value) {
    const key = String(value || "").trim();
    if (isSealedKey(key)) {
      throw new Error("当前环境无法解密已保存的密钥，请在模型设置里重新输入密钥。");
    }
    return key;
  }

  function activeProfile(settings) {
    if (!settings?.profiles?.length) return null;
    return settings.profiles.find((p) => p.id === settings.activeProfileId) || settings.profiles[0];
  }

  function profileSupportsThinking(profile) {
    if (!profile) return false;
    if (profile.thinkingCapable) return true;
    return /(?:qwen(?:3\.[5-9]|[4-9]\.\d)|deepseek-v4|glm-5|kimi-k[2-9]|claude-(?:3[-.]7|sonnet-4|opus-4|haiku-4|4))/i.test(String(profile.model || ""));
  }

  function outputCeiling(cfg) {
    const provider = String(cfg?.provider || "").toLowerCase();
    if (provider === "google" || isGoogleProvider(cfg)) return 32000;
    if (isAnthropicProvider(cfg)) return 16384;
    if (provider === "openai") return 16000;
    if (provider === "deepseek") return 8192;
    return 20000;
  }

  function resolveConfig(settings, { disableThinking = false } = {}) {
    const base = settings || {};
    const profile = activeProfile(base);
    const merged = profile
      ? {
          ...base,
          provider: profile.provider || base.provider || "custom",
          protocol: profile.protocol || base.protocol || "",
          baseUrl: profile.baseUrl || "",
          model: profile.model || "",
          apiKey: profile.apiKey || "",
          thinkingCapable: Boolean(profile.thinkingCapable),
          enableThinking: Boolean(profile.enableThinking),
          thinkingBudget: Number(profile.thinkingBudget) || 0,
          activeProfileId: profile.id
        }
      : { ...base };
    if (disableThinking) {
      merged.enableThinking = false;
      merged.thinkingBudget = 0;
    }
    return merged;
  }

  function hasConfig(settings) {
    const cfg = resolveConfig(settings);
    const key = String(cfg.apiKey || "").trim();
    const base = String(cfg.baseUrl || "").trim();
    const model = String(cfg.model || "").trim();
    if (!model || isSealedKey(key)) return false;
    if (isGoogleProvider(cfg)) return Boolean(key);
    if (isAnthropicProvider(cfg)) return Boolean(key);
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(base);
    return Boolean(base) && (Boolean(key) || isLocal);
  }

  function isGoogleProvider(cfg) {
    if (cfg?.protocol) return String(cfg.protocol).toLowerCase() === "google";
    if (String(cfg?.provider || "").toLowerCase() === "google") return true;
    return /generativelanguage\.googleapis\.com/i.test(String(cfg?.baseUrl || ""));
  }

  function isAnthropicProvider(cfg) {
    if (cfg?.protocol) {
      const proto = String(cfg.protocol).toLowerCase();
      return proto === "anthropic" || proto === "claude";
    }
    const provider = String(cfg?.provider || "").toLowerCase();
    if (provider === "anthropic" || provider === "claude") return true;
    return /api\.anthropic\.com/i.test(String(cfg?.baseUrl || ""));
  }

  function googleRoot(baseUrl) {
    const base = String(baseUrl || "https://generativelanguage.googleapis.com/v1beta").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(base)) throw new Error("API 地址需要以 http:// 或 https:// 开头。");
    return /\/v\d+(?:beta|alpha)?(?:\/|$)/i.test(base) ? base : `${base}/v1beta`;
  }

  function googleModelUrl(cfg, stream = false) {
    const model = String(cfg?.model || "gemini-3.6-flash").trim().replace(/^models\//, "") || "gemini-3.6-flash";
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    const sep = action.includes("?") ? "&" : "?";
    return `${googleRoot(cfg?.baseUrl)}/models/${encodeURIComponent(model)}:${action}${sep}key=${encodeURIComponent(usableApiKey(cfg?.apiKey))}`;
  }

  function anthropicRoot(baseUrl) {
    const raw = String(baseUrl || DEFAULT_ANTHROPIC_BASE).trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(raw)) throw new Error("API 地址需要以 http:// 或 https:// 开头。");
    const stripped = raw.replace(/\/messages$/i, "");
    return /\/v\d+(?:\/|$)/i.test(stripped) ? stripped : `${stripped}/v1`;
  }

  function anthropicMessagesUrl(cfg) {
    return `${anthropicRoot(cfg?.baseUrl)}/messages`;
  }

  function anthropicHeaders(cfg, accept = "application/json") {
    return {
      "Content-Type": "application/json",
      "Accept": accept,
      "x-api-key": usableApiKey(cfg?.apiKey),
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true"
    };
  }

  function endpointFor(baseUrl, cfg) {
    if (isGoogleProvider(cfg)) return googleModelUrl(cfg, false).replace(/:generateContent\?.*$/, "");
    if (isAnthropicProvider(cfg)) return anthropicMessagesUrl(cfg || { baseUrl });
    let base = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!base) throw new Error("请先在模型设置里填写 API 地址。");
    if (!/^https?:\/\//i.test(base)) throw new Error("API 地址需要以 http:// 或 https:// 开头。");
    if (!/\/chat\/completions$/i.test(base)) base += "/chat/completions";
    return base;
  }

  function modelsUrlFor(profile) {
    if (isGoogleProvider(profile)) {
      return `${googleRoot(profile?.baseUrl)}/models?key=${encodeURIComponent(usableApiKey(profile?.apiKey))}`;
    }
    if (isAnthropicProvider(profile)) {
      return `${anthropicRoot(profile?.baseUrl)}/models`;
    }
    const base = String(profile?.baseUrl || "").trim().replace(/\/+$/, "");
    if (!base) throw new Error("请先在模型设置里填写 API 地址。");
    if (!/^https?:\/\//i.test(base)) throw new Error("API 地址需要以 http:// 或 https:// 开头。");
    return `${base.replace(/\/chat\/completions$/i, "")}/models`;
  }

  function thinkingParams(cfg) {
    const profile = activeProfile(cfg) || cfg;
    if (!profileSupportsThinking(profile) && !cfg?.enableThinking) return {};
    const params = { enable_thinking: Boolean(cfg?.enableThinking) };
    const budget = Number(cfg?.thinkingBudget) || 0;
    if (params.enable_thinking && budget > 0) params.thinking_budget = budget;
    return params;
  }

  function anthropicPayload(messages, maxTokens, cfg = {}, temperature = 0.3, stream = false) {
    const list = Array.isArray(messages) ? messages : [];
    const system = list
      .filter((m) => m?.role === "system")
      .map((m) => String(m?.content || "").trim())
      .filter(Boolean)
      .join("\n\n");
    const turns = [];
    for (const m of list) {
      if (!m || m.role === "system") continue;
      const role = m.role === "assistant" ? "assistant" : "user";
      const text = String(m.content || "");
      const prev = turns[turns.length - 1];
      if (prev && prev.role === role) {
        prev.content = prev.content ? `${prev.content}\n\n${text}` : text;
      } else {
        turns.push({ role, content: text });
      }
    }
    if (!turns.length) turns.push({ role: "user", content: "" });
    else if (turns[0].role !== "user") turns.unshift({ role: "user", content: "Continue." });

    const payload = {
      model: cfg.model,
      max_tokens: Math.max(1, Number(maxTokens) || 2600),
      messages: turns,
      stream: Boolean(stream)
    };
    if (system) payload.system = system;

    if (cfg?.enableThinking) {
      const budget = Math.max(1024, Number(cfg.thinkingBudget) || 2048);
      payload.thinking = { type: "enabled", budget_tokens: budget };
      // Anthropic requires max_tokens > budget_tokens and disallows custom temperature when thinking is enabled.
      payload.max_tokens = Math.max(payload.max_tokens, budget + 1024);
    } else if (typeof temperature === "number" && Number.isFinite(temperature)) {
      payload.temperature = Math.min(1, Math.max(0, temperature));
    }
    return payload;
  }

  function googlePayload(messages, maxTokens, jsonMode, cfg = {}, temperature = 0.3) {
    const system = messages.filter((m) => m.role === "system").map((m) => String(m.content || "")).join("\n\n");
    const turns = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content || "") }] }));
    const payload = {
      contents: turns.length ? turns : [{ role: "user", parts: [{ text: "" }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens
      }
    };
    if (jsonMode) payload.generationConfig.responseMimeType = "application/json";
    // Gemini 2.5/3 spend output tokens on thinking unless told otherwise; a
    // long JSON answer then gets cut mid-object even with a generous ceiling.
    const model = String(cfg.model || "").toLowerCase();
    if (/gemini-3/.test(model)) payload.generationConfig.thinkingConfig = { thinkingLevel: "LOW" };
    else if (/gemini-2\.5/.test(model)) payload.generationConfig.thinkingConfig = { thinkingBudget: 0 };
    if (system) payload.systemInstruction = { parts: [{ text: system }] };
    return payload;
  }

  function streamDeltaText(delta) {
    const value = delta?.content;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
    }
    return "";
  }

  function extractContent(json, cfg = {}) {
    if (isGoogleProvider(cfg)) {
      const parts = json?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        const gText = parts.map((p) => String(p?.text || "")).join("");
        if (gText) return gText;
      }
    }
    if (isAnthropicProvider(cfg) || Array.isArray(json?.content)) {
      const blocks = json?.content;
      if (Array.isArray(blocks)) {
        const aText = blocks
          .filter((b) => b && (b.type === "text" || (!b.type && typeof b.text === "string")))
          .map((b) => String(b.text || ""))
          .join("");
        if (aText) return aText;
      }
    }
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
    }
    const fallbackGoogle = json?.candidates?.[0]?.content?.parts;
    if (Array.isArray(fallbackGoogle)) {
      return fallbackGoogle.map((p) => String(p?.text || "")).join("");
    }
    return "";
  }

  async function readHttpError(response, maxLen = 260) {
    const raw = await response.text().catch(() => "");
    let msg = raw;
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.error?.message) msg = String(parsed.error.message);
    } catch (_) { /* keep raw */ }
    msg = String(msg || "").trim();
    return `HTTP ${response.status}${msg ? ` · ${msg.slice(0, maxLen)}` : ""}`;
  }

  async function readJsonResponse(response, label = "接口") {
    const raw = await response.text().catch(() => "");
    if (!raw) throw new Error(`${label}返回了空响应（HTTP ${response.status}），可能是网关超时，请重试。`);
    try {
      return JSON.parse(raw);
    } catch (_) {
      throw new Error(`${label}返回的不是 JSON（HTTP ${response.status}）：${raw.slice(0, 160)}`);
    }
  }

  function parseJsonObject(content) {
    let text = String(content || "").trim();
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) throw new Error("模型没有返回 JSON 对象。");
    const slice = text.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch (error) {
      throw new Error(`模型 JSON 解析失败：${error.message}`);
    }
  }

  async function sendChat(
    cfg,
    messages,
    { signal, allowJsonMode = true, maxTokens = 2600, temperature = 0.3, googleBusyDelayMs = 1200 } = {}
  ) {
    if (isGoogleProvider(cfg)) {
      const url = googleModelUrl(cfg, false);
      const post = () => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(googlePayload(messages, maxTokens, allowJsonMode, cfg, temperature)),
        signal
      });
      let response = await post();
      if ((response.status === 503 || response.status === 429) && googleBusyDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, googleBusyDelayMs));
        response = await post();
      }
      return response;
    }

    if (isAnthropicProvider(cfg)) {
      const url = anthropicMessagesUrl(cfg);
      const post = () => fetch(url, {
        method: "POST",
        headers: anthropicHeaders(cfg, "application/json"),
        body: JSON.stringify(anthropicPayload(messages, maxTokens, cfg, temperature, false)),
        signal
      });
      let response = await post();
      if ((response.status === 529 || response.status === 429) && googleBusyDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, googleBusyDelayMs));
        response = await post();
      }
      return response;
    }

    const endpoint = endpointFor(cfg.baseUrl, cfg);
    const body = {
      model: cfg.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
      ...thinkingParams(cfg)
    };
    if (allowJsonMode) body.response_format = { type: "json_object" };

    const send = async (withJsonMode) => {
      const payload = { ...body };
      if (!withJsonMode) delete payload.response_format;
      return fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${usableApiKey(cfg.apiKey)}`
        },
        body: JSON.stringify(payload),
        signal
      });
    };

    let response = await send(allowJsonMode);
    if (!response.ok && allowJsonMode && [400, 422].includes(response.status)) {
      response = await send(false);
    }
    return response;
  }

  async function sendAnthropicChatStream(
    cfg,
    messages,
    { signal, maxTokens = 2600, temperature = 0.3, googleBusyDelayMs = 1200, onDelta, onReasoning, onUsage, onBuffered } = {}
  ) {
    const url = anthropicMessagesUrl(cfg);
    const post = () => fetch(url, {
      method: "POST",
      headers: anthropicHeaders(cfg, "text/event-stream"),
      body: JSON.stringify(anthropicPayload(messages, maxTokens, cfg, temperature, true)),
      signal
    });
    let response = await post();
    if ((response.status === 529 || response.status === 429) && googleBusyDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, googleBusyDelayMs));
      response = await post();
    }
    if (!response.ok) {
      throw new Error(await readHttpError(response, 260));
    }

    const type = response.headers?.get?.("content-type") || "";
    if (type.includes("application/json")) {
      const host = (() => { try { return new URL(url).host; } catch (_) { return url; } })();
      onBuffered?.({ host, contentType: type });
      const json = await readJsonResponse(response, "Anthropic 流式接口");
      if (json?.usage) onUsage?.(json.usage);
      const text = extractContent(json, cfg);
      if (text) onDelta?.(text);
      return text || "";
    }
    if (!response.body?.getReader) {
      const json = await readJsonResponse(response, "Anthropic 流式接口");
      if (json?.usage) onUsage?.(json.usage);
      const text = extractContent(json, cfg);
      if (text) onDelta?.(text);
      return text || "";
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let inputTokens = 0;
    let streamError = null;

    const consumeFrame = (frame) => {
      const dataLines = frame
        .split(/\r?\n/)
        .filter((row) => row.startsWith("data:"))
        .map((row) => row.slice(5).trim());
      if (!dataLines.length) return;
      const data = dataLines.join("\n");
      if (!data || data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        if (parsed?.type === "error") {
          streamError = new Error(String(parsed?.error?.message || "Anthropic 流式返回错误"));
          return;
        }
        if (parsed?.type === "message_start" && parsed?.message?.usage) {
          inputTokens = Number(parsed.message.usage.input_tokens || 0) || 0;
          return;
        }
        if (parsed?.type === "content_block_delta" && parsed?.delta) {
          if (parsed.delta.type === "thinking_delta" && parsed.delta.thinking) {
            onReasoning?.(String(parsed.delta.thinking));
          } else if (parsed.delta.type === "text_delta" && parsed.delta.text) {
            content += String(parsed.delta.text);
            onDelta?.(content);
          }
          return;
        }
        if (parsed?.type === "message_delta" && parsed?.usage) {
          const out = Number(parsed.usage.output_tokens || 0) || 0;
          const inp = Number(parsed.usage.input_tokens ?? inputTokens) || inputTokens;
          onUsage?.({
            input_tokens: inp,
            output_tokens: out,
            total_tokens: inp + out
          });
        }
      } catch (_) { /* ignore partial/ping frames */ }
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\n\n");
        consumeFrame(frame);
        if (streamError) throw streamError;
      }
    }
    buffer += decoder.decode().replace(/\r\n/g, "\n");
    if (buffer.trim()) consumeFrame(buffer);
    if (streamError) throw streamError;
    return content;
  }

  async function sendGoogleChatStream(
    cfg,
    messages,
    { signal, googleJsonMode = true, maxTokens = 2600, temperature = 0.3, googleBusyDelayMs = 1200, onDelta, onUsage } = {}
  ) {
    const url = googleModelUrl(cfg, true);
    const post = () => fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
      body: JSON.stringify(googlePayload(messages, maxTokens, googleJsonMode, cfg, temperature)),
      signal
    });
    let response = await post();
    if ((response.status === 503 || response.status === 429) && googleBusyDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, googleBusyDelayMs));
      response = await post();
    }
    if (!response.ok) {
      throw new Error(await readHttpError(response, 260));
    }
    if (!response.body?.getReader) {
      const json = await readJsonResponse(response, "Gemini 流式接口");
      if (json?.usageMetadata) onUsage?.(json.usageMetadata);
      const text = extractContent(json, cfg);
      if (text) onDelta?.(text);
      return text;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const consumeFrame = (frame) => {
      const line = frame.split(/\r?\n/).find((row) => row.startsWith("data:"));
      if (!line) return;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        if (parsed?.usageMetadata) onUsage?.(parsed.usageMetadata);
        const text = extractContent(parsed, cfg);
        if (text) {
          content += text;
          if (typeof onDelta === "function") onDelta(content);
        }
      } catch (_) { /* partial frames are skipped */ }
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\n\n");
        consumeFrame(frame);
      }
    }
    // The final event often arrives without the trailing blank line; dropping
    // it cuts the closing braces off the JSON, which looks like model failure.
    buffer += decoder.decode().replace(/\r\n/g, "\n");
    if (buffer.trim()) consumeFrame(buffer);
    return content;
  }

  async function sendChatStream(
    cfg,
    messages,
    {
      signal,
      allowJsonMode = false,
      googleJsonMode = true,
      maxTokens = 2600,
      temperature = 0.3,
      googleBusyDelayMs = 1200,
      onDelta,
      onReasoning,
      onUsage,
      onBuffered
    } = {}
  ) {
    if (isGoogleProvider(cfg)) {
      return sendGoogleChatStream(cfg, messages, {
        signal,
        googleJsonMode,
        maxTokens,
        temperature,
        googleBusyDelayMs,
        onDelta,
        onUsage
      });
    }
    if (isAnthropicProvider(cfg)) {
      return sendAnthropicChatStream(cfg, messages, {
        signal,
        maxTokens,
        temperature,
        googleBusyDelayMs,
        onDelta,
        onReasoning,
        onUsage,
        onBuffered
      });
    }

    const endpoint = endpointFor(cfg.baseUrl, cfg);
    const body = {
      model: cfg.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      ...thinkingParams(cfg)
    };
    if (allowJsonMode) body.response_format = { type: "json_object" };

    const send = async (withJsonMode, withUsage = true) => {
      const payload = { ...body };
      if (!withJsonMode) delete payload.response_format;
      if (!withUsage) delete payload.stream_options;
      return fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
          "Authorization": `Bearer ${usableApiKey(cfg.apiKey)}`
        },
        body: JSON.stringify(payload),
        signal
      });
    };

    let response = await send(allowJsonMode, true);
    if (!response.ok && allowJsonMode && [400, 422].includes(response.status)) {
      response = await send(false, true);
    }
    if (!response.ok && [400, 422].includes(response.status)) {
      // Gateways that do not know stream_options reject the whole request.
      response = await send(false, false);
    }
    if (!response.ok) {
      throw new Error(await readHttpError(response, 260));
    }

    const type = response.headers?.get?.("content-type") || "";
    if (type.includes("application/json")) {
      const host = (() => { try { return new URL(endpoint).host; } catch (_) { return endpoint; } })();
      onBuffered?.({ host, contentType: type });
      const json = await readJsonResponse(response, "流式接口");
      if (json?.usage) onUsage?.(json.usage);
      const content = extractContent(json, cfg);
      if (content) onDelta?.(content);
      return content || "";
    }

    if (!response.body?.getReader) {
      return await response.text();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const consumeLine = (rawLine) => {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload);
        if (json?.usage) onUsage?.(json.usage);
        const choice = json?.choices?.[0];
        const reasoning = choice?.delta?.reasoning_content || choice?.delta?.reasoning || choice?.message?.reasoning_content;
        if (reasoning) onReasoning?.(String(reasoning));
        const piece = streamDeltaText(choice?.delta) || (typeof choice?.message?.content === "string" ? choice.message.content : "");
        if (piece) {
          content += piece;
          onDelta?.(content);
        }
      } catch (_) {
        // Ignore keep-alive/partial SSE lines.
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        consumeLine(line);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeLine(buffer);
    return content;
  }

  /**
   * Unified structured JSON completion call.
   * Automatically resolves active profile, disables thinking mode by default,
   * enforces timeout, retries once on transient failure, and parses JSON cleanly.
   */
  async function requestJson({
    settings,
    system,
    user,
    maxTokens = 2600,
    timeoutMs = 90_000,
    signal = null,
    label = "模型接口",
    disableThinking = true,
    temperature = 0.3,
    retries = 1
  }) {
    const cfg = resolveConfig(settings, { disableThinking });
    if (!hasConfig(cfg)) throw new Error("请先在设置中配置模型 API。");
    const messages = [
      ...(system ? [{ role: "system", content: String(system) }] : []),
      { role: "user", content: typeof user === "string" ? user : JSON.stringify(user) }
    ];

    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const onExternalAbort = () => controller.abort();
      if (signal) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        signal.addEventListener("abort", onExternalAbort, { once: true });
      }
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await sendChat(cfg, messages, {
          signal: controller.signal,
          allowJsonMode: true,
          maxTokens,
          temperature
        });
        if (!res.ok) {
          const err = new Error(await readHttpError(res, 180));
          // Do not retry auth/bad-request client errors
          if ([400, 401, 403, 404].includes(res.status)) {
            err.noRetry = true;
          }
          throw err;
        }
        const json = await readJsonResponse(res, label);
        const content = extractContent(json, cfg);
        if (!content || !String(content).trim()) {
          throw new Error("模型返回了空内容（可能是输出上限不足或网关波动）。");
        }
        return parseJsonObject(content);
      } catch (err) {
        if (err?.name === "AbortError" || err?.noRetry || attempt >= retries) {
          throw err;
        }
        lastErr = err;
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onExternalAbort);
      }
    }
    throw lastErr;
  }

  async function listModels(profile, { signal = null, timeoutMs = 15_000 } = {}) {
    const cfg = resolveConfig(profile);
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      signal.addEventListener("abort", onExternalAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const isGoogle = isGoogleProvider(cfg);
      const isAnthropic = isAnthropicProvider(cfg);
      const headers = isGoogle
        ? { Accept: "application/json" }
        : isAnthropic
          ? {
              Accept: "application/json",
              "x-api-key": usableApiKey(cfg.apiKey),
              "anthropic-version": ANTHROPIC_VERSION,
              "anthropic-dangerous-direct-browser-access": "true"
            }
          : { Accept: "application/json", Authorization: `Bearer ${usableApiKey(cfg.apiKey)}` };
      const response = await fetch(modelsUrlFor(cfg), { headers, signal: controller.signal });
      if (!response.ok) throw new Error(await readHttpError(response, 160));
      const json = await readJsonResponse(response, "模型列表");
      if (isGoogle) {
        return (json.models || [])
          .filter((item) => !item.supportedGenerationMethods || item.supportedGenerationMethods.includes("generateContent"))
          .map((item) => String(item.name || "").replace(/^models\//, ""))
          .filter((id) => id && !/embedding|aqa/i.test(id));
      }
      return (json.data || []).map((item) => String(item.id || "")).filter(Boolean);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onExternalAbort);
    }
  }

  async function pingModel(
    profile,
    { signal = null, timeoutMs = 20_000, prompt = "Reply with the single word: pong", maxTokens = 16 } = {}
  ) {
    const cfg = resolveConfig(profile);
    const started = Date.now();
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      signal.addEventListener("abort", onExternalAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await sendChat(
        cfg,
        [{ role: "user", content: prompt }],
        { signal: controller.signal, allowJsonMode: false, maxTokens, temperature: 0 }
      );
      if (!response.ok) {
        throw new Error(await readHttpError(response, 140));
      }
      const json = await readJsonResponse(response, "测试请求");
      const text = extractContent(json, cfg);
      const reply = String(text || "").trim().slice(0, 40);
      return { ok: true, ms: Math.max(0, Date.now() - started), text: reply || "(空回复)" };
    } catch (error) {
      const message = error?.name === "AbortError" ? "请求超时。" : String(error?.message || "无法连接。");
      return { ok: false, ms: Math.max(0, Date.now() - started), text: message };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onExternalAbort);
    }
  }

  window.TALK_LLM = {
    SEAL_PREFIX,
    ANTHROPIC_VERSION,
    isSealedKey,
    usableApiKey,
    activeProfile,
    profileSupportsThinking,
    outputCeiling,
    resolveConfig,
    hasConfig,
    isGoogleProvider,
    isAnthropicProvider,
    googleRoot,
    googleModelUrl,
    googlePayload,
    anthropicRoot,
    anthropicMessagesUrl,
    anthropicHeaders,
    anthropicPayload,
    endpointFor,
    modelsUrlFor,
    thinkingParams,
    streamDeltaText,
    extractContent,
    readHttpError,
    readJsonResponse,
    parseJsonObject,
    sendChat,
    sendChatStream,
    requestJson,
    listModels,
    pingModel
  };
})();
