import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { suite } from "../lib/harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

function loadLlmClient(mockFetch) {
  const code = fs.readFileSync(path.join(ROOT, "js/llm-client.js"), "utf8");
  const sandbox = {
    window: {},
    fetch: mockFetch || (() => { throw new Error("fetch not mocked"); }),
    AbortController,
    DOMException,
    TextDecoder,
    setTimeout,
    clearTimeout,
    URL,
    JSON,
    encodeURIComponent
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.TALK_LLM;
}

function makeStreamBody(chunks) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    getReader() {
      return {
        async read() {
          if (i >= chunks.length) return { done: true, value: undefined };
          const value = encoder.encode(chunks[i++]);
          return { done: false, value };
        }
      };
    }
  };
}

suite("llm-client · unified transport & profile resolution (unit)", { timeout: 10_000 }, (s) => {
  s.test("resolveConfig picks activeProfile over stale root settings and suppresses thinking for JSON tasks", async (_state, t) => {
    const llm = loadLlmClient();
    const settings = {
      apiKey: "stale-root-key",
      baseUrl: "https://old.example.com",
      model: "old-model",
      activeProfileId: "p-qwen",
      profiles: [
        { id: "p-ds", provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "sk-ds", enableThinking: false },
        { id: "p-qwen", provider: "qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3.5-plus", apiKey: "sk-qwen-live", enableThinking: true, thinkingBudget: 2048 }
      ]
    };

    const normal = llm.resolveConfig(settings);
    t.expect(normal.apiKey).toBe("sk-qwen-live");
    t.expect(normal.model).toBe("qwen3.5-plus");
    t.expect(normal.enableThinking).toBe(true);

    const jsonCfg = llm.resolveConfig(settings, { disableThinking: true });
    t.expect(jsonCfg.apiKey).toBe("sk-qwen-live");
    t.expect(jsonCfg.enableThinking).toBe(false);
    t.expect(jsonCfg.thinkingBudget).toBe(0);
    t.expect(llm.thinkingParams(jsonCfg).enable_thinking).toBe(false);
  });

  s.test("requestJson strips fenced JSON and falls back cleanly when gateway rejects json_object with HTTP 400", async (_state, t) => {
    const calls = [];
    const mockFetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      if (body.response_format) {
        return { ok: false, status: 400, text: async () => '{"error":"json_object unsupported"}' };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{ message: { content: '```json\n{"words":["ephemeral","resilient"]}\n```' } }]
        })
      };
    };

    const llm = loadLlmClient(mockFetch);
    const result = await llm.requestJson({
      settings: { baseUrl: "https://api.example.com/v1", model: "test-model", apiKey: "sk-ok" },
      system: "Extract JSON",
      user: { text: "ephemeral and resilient" },
      label: "测试提取"
    });

    t.expect(calls.length).toBe(2);
    t.expect(Boolean(calls[0].response_format)).toBe(true);
    t.expect(calls[1].response_format).toBe(undefined);
    t.expect(result.words.length).toBe(2);
    t.expect(result.words[0]).toBe("ephemeral");
  });

  s.test("requestJson fails fast on HTTP 401 without wasteful retries and rejects sealed ciphertext keys", async (_state, t) => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts += 1;
      return { ok: false, status: 401, text: async () => '{"error":"Invalid API-key"}' };
    };
    const llm = loadLlmClient(mockFetch);

    let errMsg = "";
    try {
      await llm.requestJson({
        settings: { baseUrl: "https://api.example.com/v1", model: "m", apiKey: "sk-bad" },
        system: "sys",
        user: "hi",
        retries: 2
      });
    } catch (e) {
      errMsg = e.message;
    }
    t.expect(attempts).toBe(1);
    t.expect(errMsg.includes("HTTP 401")).toBe(true);

    let sealedErr = "";
    try {
      llm.usableApiKey("talk.sealed.v1:abcdef");
    } catch (e) {
      sealedErr = e.message;
    }
    t.expect(sealedErr.includes("解密")).toBe(true);
  });

  s.test("sendChatStream parses OpenAI SSE deltas, reasoning, usage, and strips stream_options on HTTP 422", async (_state, t) => {
    const payloads = [];
    const mockFetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      payloads.push(body);
      if (body.stream_options) {
        return { ok: false, status: 422, text: async () => "stream_options not allowed" };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body: makeStreamBody([
          'data: {"choices":[{"delta":{"reasoning_content":"step 1"}}]}\n',
          'data: {"choices":[{"delta":{"content":"{\\"word\\":\\""}}]}\n',
          'data: {"choices":[{"delta":{"content":"lucent\\"}"}}],"usage":{"total_tokens":42}}\n',
          "data: [DONE]\n"
        ])
      };
    };

    const llm = loadLlmClient(mockFetch);
    const deltas = [];
    let reasoning = "";
    let usage = null;
    const text = await llm.sendChatStream(
      { baseUrl: "https://api.example.com/v1", model: "m", apiKey: "sk-ok" },
      [{ role: "user", content: "hi" }],
      {
        onDelta: (full) => deltas.push(full),
        onReasoning: (r) => { reasoning += r; },
        onUsage: (u) => { usage = u; }
      }
    );

    t.expect(payloads.length).toBe(2);
    t.expect(Boolean(payloads[0].stream_options)).toBe(true);
    t.expect(payloads[1].stream_options).toBe(undefined);
    t.expect(text).toBe('{"word":"lucent"}');
    t.expect(reasoning).toBe("step 1");
    t.expect(usage?.total_tokens).toBe(42);
    t.expect(deltas.length).toBe(2);
  });

  s.test("sendChatStream handles buffered application/json responses and Gemini SSE streams", async (_state, t) => {
    const bufferedEvents = [];
    const llmBuffered = loadLlmClient(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { total_tokens: 15 }
      })
    }));
    let bufferedUsage = null;
    const bufferedText = await llmBuffered.sendChatStream(
      { baseUrl: "https://gw.example.com/v1", model: "m", apiKey: "sk-ok" },
      [{ role: "user", content: "hi" }],
      {
        onBuffered: (info) => bufferedEvents.push(info),
        onUsage: (u) => { bufferedUsage = u; }
      }
    );
    t.expect(bufferedText).toBe('{"ok":true}');
    t.expect(bufferedEvents.length).toBe(1);
    t.expect(bufferedUsage?.total_tokens).toBe(15);

    // Gemini SSE with trailing event lacking trailing blank line
    const llmGoogle = loadLlmClient(async (url, init) => {
      t.expect(url.includes("streamGenerateContent?alt=sse")).toBe(true);
      const body = JSON.parse(init.body);
      t.expect(body.generationConfig.responseMimeType).toBe("application/json");
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body: makeStreamBody([
          'data: {"candidates":[{"content":{"parts":[{"text":"{\\"word\\":\\""}]}}]}\n\n',
          'data: {"candidates":[{"content":{"parts":[{"text":"vivid\\"}"}]}}],"usageMetadata":{"totalTokenCount":77}}'
        ])
      };
    });
    let gUsage = null;
    const gText = await llmGoogle.sendChatStream(
      { protocol: "google", baseUrl: "https://generativelanguage.googleapis.com", model: "gemini-2.5-flash", apiKey: "gk" },
      [{ role: "user", content: "hi" }],
      { onUsage: (u) => { gUsage = u; } }
    );
    t.expect(gText).toBe('{"word":"vivid"}');
    t.expect(gUsage?.totalTokenCount).toBe(77);
  });

  s.test("listModels and pingModel support OpenAI + Google and surface HTTP errors cleanly", async (_state, t) => {
    const llm = loadLlmClient(async (url) => {
      if (url.includes("/models?")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            models: [
              { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
              { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] }
            ]
          })
        };
      }
      if (url.endsWith("/models")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }] })
        };
      }
      if (url.includes("bad.example.com")) {
        return { ok: false, status: 403, text: async () => '{"error":{"message":"Forbidden key"}}' };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: "pong" } }] })
      };
    });

    const gModels = await llm.listModels({ protocol: "google", baseUrl: "https://generativelanguage.googleapis.com", apiKey: "gk" });
    t.expect(gModels).toEqual(["gemini-2.5-flash"]);

    const oModels = await llm.listModels({ protocol: "openai", baseUrl: "https://api.deepseek.com", apiKey: "sk" });
    t.expect(oModels).toEqual(["deepseek-chat", "deepseek-reasoner"]);

    const okPing = await llm.pingModel({ protocol: "openai", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "sk" });
    t.expect(okPing.ok).toBe(true);
    t.expect(okPing.text).toBe("pong");

    const badPing = await llm.pingModel({ protocol: "openai", baseUrl: "https://bad.example.com/v1", model: "m", apiKey: "sk" });
    t.expect(badPing.ok).toBe(false);
    t.expect(badPing.text.includes("HTTP 403")).toBe(true);
    t.expect(badPing.text.includes("Forbidden key")).toBe(true);
  });

  s.test("supports Anthropic Messages API: headers, system/turn normalization, extended thinking, SSE streaming, models & ping", async (_state, t) => {
    const llmProbe = loadLlmClient();
    t.expect(llmProbe.isAnthropicProvider({ protocol: "anthropic" })).toBe(true);
    t.expect(llmProbe.isAnthropicProvider({ provider: "anthropic" })).toBe(true);
    t.expect(llmProbe.isAnthropicProvider({ baseUrl: "https://api.anthropic.com/v1" })).toBe(true);
    // Explicit OpenAI protocol (e.g. OpenRouter or OpenAI-compatible Claude proxy) must stay OpenAI.
    t.expect(llmProbe.isAnthropicProvider({ protocol: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-4-5" })).toBe(false);
    t.expect(llmProbe.anthropicRoot("https://api.anthropic.com")).toBe("https://api.anthropic.com/v1");
    t.expect(llmProbe.anthropicRoot("https://api.anthropic.com/v1/messages")).toBe("https://api.anthropic.com/v1");
    t.expect(llmProbe.modelsUrlFor({ protocol: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-ant-1" }))
      .toBe("https://api.anthropic.com/v1/models");

    // Payload normalization: extracts top-level system, merges consecutive user messages, handles extended thinking
    const stdPayload = llmProbe.anthropicPayload(
      [
        { role: "system", content: "System A" },
        { role: "system", content: "System B" },
        { role: "user", content: "Part 1" },
        { role: "user", content: "Part 2" },
        { role: "assistant", content: "Ack" },
        { role: "user", content: "Next" }
      ],
      1800,
      { model: "claude-sonnet-4-5", enableThinking: false },
      1.4,
      false
    );
    t.expect(stdPayload.system).toBe("System A\n\nSystem B");
    t.expect(stdPayload.messages.length).toBe(3);
    t.expect(stdPayload.messages[0]).toEqual({ role: "user", content: "Part 1\n\nPart 2" });
    t.expect(stdPayload.temperature).toBe(1);
    t.expect(stdPayload.thinking).toBe(undefined);

    const thinkPayload = llmProbe.anthropicPayload(
      [{ role: "user", content: "Reason deeply" }],
      1200,
      { model: "claude-sonnet-4-5", enableThinking: true, thinkingBudget: 2048 },
      0.3,
      true
    );
    t.expect(thinkPayload.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    t.expect(thinkPayload.temperature).toBe(undefined);
    t.expect(thinkPayload.max_tokens).toBe(3072);

    // Non-streaming requestJson + headers + ignoring thinking block in extractContent
    const captured = [];
    const llm = loadLlmClient(async (url, init) => {
      captured.push({ url, headers: init?.headers || {}, body: init?.body ? JSON.parse(init.body) : null });
      if (url.endsWith("/v1/models")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ data: [{ id: "claude-sonnet-4-5" }, { id: "claude-haiku-4-5" }] })
        };
      }
      if (init?.body && JSON.parse(init.body).stream) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "text/event-stream" }),
          body: makeStreamBody([
            'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":30}}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"weighing nuance"}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"{\\"word\\":\\""}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"liminal\\"}"}}\n\n',
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}}\n\n',
            'event: message_stop\ndata: {"type":"message_stop"}'
          ])
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          content: [
            { type: "thinking", thinking: "internal reasoning" },
            { type: "text", text: '{"ok":true,"word":"liminal"}' }
          ],
          usage: { input_tokens: 20, output_tokens: 10 }
        })
      };
    });

    const anthropicProfile = {
      protocol: "anthropic",
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-5",
      apiKey: "sk-ant-test"
    };

    const jsonRes = await llm.requestJson({
      settings: anthropicProfile,
      system: "Return JSON",
      user: "liminal"
    });
    t.expect(jsonRes).toEqual({ ok: true, word: "liminal" });
    t.expect(captured[0].url).toBe("https://api.anthropic.com/v1/messages");
    t.expect(captured[0].headers["x-api-key"]).toBe("sk-ant-test");
    t.expect(captured[0].headers["anthropic-version"]).toBe("2023-06-01");
    t.expect(captured[0].headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    t.expect(captured[0].body.response_format).toBe(undefined);

    const deltas = [];
    let reasoning = "";
    let usage = null;
    const streamed = await llm.sendChatStream(
      { ...anthropicProfile, enableThinking: true, thinkingBudget: 1024 },
      [{ role: "system", content: "Sys" }, { role: "user", content: "Hi" }],
      {
        onDelta: (full) => deltas.push(full),
        onReasoning: (r) => { reasoning += r; },
        onUsage: (u) => { usage = u; }
      }
    );
    t.expect(streamed).toBe('{"word":"liminal"}');
    t.expect(reasoning).toBe("weighing nuance");
    t.expect(usage).toEqual({ input_tokens: 30, output_tokens: 12, total_tokens: 42 });
    t.expect(deltas.length).toBe(2);

    const models = await llm.listModels(anthropicProfile);
    t.expect(models).toEqual(["claude-sonnet-4-5", "claude-haiku-4-5"]);
    t.expect(captured[2].headers["x-api-key"]).toBe("sk-ant-test");
    t.expect(captured[2].headers["anthropic-dangerous-direct-browser-access"]).toBe("true");

    const ping = await llm.pingModel(anthropicProfile);
    t.expect(ping.ok).toBe(true);
    t.expect(ping.text.includes("liminal")).toBe(true);
  });
});
