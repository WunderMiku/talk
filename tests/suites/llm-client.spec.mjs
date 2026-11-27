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
});
