# 测试

仓库里的 `tests/` 是一套**离线**的端到端测试：静态页面 + 一个可编排的假模型，跑在同一个本地源上。不需要 API key，也不访问外网。

```bash
npm install          # 只为测试装 playwright；站点本身没有构建步骤
npx playwright install chromium
npm test             # 全部套件
npm test -- chunk    # 只跑文件名/标题匹配的套件
npm test -- --list   # 列出套件与用例
npm test -- --filter cache   # 只跑名字匹配的用例
npm test -- --headed         # 开窗口看过程
```

## 为什么是一个自定义 harness

站点是纯静态的：没有 bundler、没有运行时依赖，也不该为了测试把 Vitest/Jest 拉进来。`tests/lib/harness.mjs` 实现了一个约 300 行的 runner（`suite` / `test` / `expect` / `runSuite`），断言覆盖常用形状；错误输出会指回 `tests/` 里的行。

## 一个源上的假模型

`tests/lib/server.mjs` 同时提供：

- 静态文件服务（就是仓库根目录，带 `cache-control: no-store`）；
- `POST /__mock/*` 的模型端点，按请求体里的 `task` 分派。

页面把 `baseUrl` 指到 `${origin}/__mock`，于是请求天然同源：没有 CORS 预检，也没有跨协议改写。响应可以按 task 排队、按 query 精确匹配，也可以模拟截断、500、挂起和 SSE 分块。

```js
server.mock.setFallback("word", { fixture: "word-min" });   // 该 task 的默认响应
server.mock.on({ task: "word", query: "take" }, { fixture: "word-take" });
server.mock.queue({ task: "word" }, [{ status: 500 }, { fixture: "word-min" }]);
server.mock.requestsOf("word");   // 抓到的请求，用来断言"没有重复请求"
```

`tests/lib/browser.mjs` 负责浏览器：每个用例一个 context（`serviceWorkers: "block"`，避免 SW 缓存干扰），预置 `talk.model.v1` 指向 `__mock`，并收集 `pageerror` / console error。`config: null` 就是"没连模型"的离线场景。

## 桩数据

`tests/fixtures/*.json` 是模型会返回的 JSON 本体，不是包裹层：

| 文件 | 用途 |
| --- | --- |
| `word-min` / `word-take` / `word-obfuscate` | 单词页响应、嵌套词层点开的 `take`、防幻觉/缓存校验样本 |
| `chunk-takeoff` / `chunk-bytheway` | 意群页完整响应（多义、词眼、槽位、变形、来历、例句） |
| `sentence-min` / `sentence-two` / `sentence-copula` / `sentence-legacy` | 单句 / 多句意群切分、孤立系动词合并与旧版无 `segments` 降级 |
| `reverse-arrive` | 语境寻词兜底响应 |
| `reader-overview` / `reader-block` / `reader-quick-gloss` | 长文精读概览、分段解析与行内速查响应 |
| `theme-min` / `translator-min` | 主题例句补全与多风格翻译兜底 |

加一个场景 = 加一个 fixture，或在套件里用 `{ content: "..." }` 直接给字符串。

## 套件（共 15 组 63 例）

| 套件 | 类型 | 覆盖 |
| --- | --- | --- |
| `core-and-normalize.spec.mjs` | 单元 | 工具函数、日志脱敏、action 分发、流式预览与数据归一化防幻觉 |
| `llm-client.spec.mjs` | 单元 | OpenAI 兼容 / Anthropic (Claude) / Google Gemini 协议、SSE 流式、重试与扩展思考 |
| `reader-parser.spec.mjs` | 单元 | 长文解析、标题提取、SHA-1 hash 与 `registerParser` 扩展点 |
| `wordbooks.spec.mjs` | 单元 | 多书库迁移、导入导出与 AI 零丢失分册不变式 |
| `shell.spec.mjs` | 单元 | 构建号同步、`sw.js` 预缓存覆盖完整性、全量 JS 语法校验与文档同步防漂移校验 |
| `word.spec.mjs` | E2E | 查词、义项与例句渲染、刷新命中缓存、嵌套词层、生成脚注 |
| `chunk.spec.mjs` | E2E | 多词短语判为意群、全部区块渲染、刷新命中缓存 |
| `sentence.spec.mjs` | E2E | 三视角切换（原句 / 意群切分 / 信息焦点）、行几何不变、点击意群与旧缓存降级 |
| `reverse.spec.mjs` | E2E | Markdown + `[[...]]` 行内锚点、多轮追问、刷新完整恢复线程 |
| `reader.spec.mjs` | E2E | 内置离线示例精读、AI 导读与分段管线、底部速查 Dock 与 PDF 装订边距 |
| `cache.spec.mjs` | E2E | 词条缓存 JSON 导出、清空、导入与重新命中校验 |
| `share.spec.mjs` | E2E | 1080px 宽分享图合成 |
| `offline.spec.mjs` | E2E | 无 key 时的离线未收录页与改判行（不发请求） |
| `theme.spec.mjs` | E2E | Retro Stub 主题 token 生效与直角卡片 |
| `ui-stability.spec.mjs` | E2E | 设置四页签与死设置清除、设置按钮幂等性、500 词条缓存性能、词头下伸间距、嵌套抽屉、Android 返回键、三模式切换与 IDB 迁移 |

## 加用例

```js
import { suite } from "../lib/harness.mjs";
import { startEnv } from "../lib/browser.mjs";

suite("my feature", { timeout: 45_000 }, (s) => {
  s.beforeAll(async (state) => {
    state.env = await startEnv();
    state.env.server.mock.setFallback("word", { fixture: "word-min" });
  });
  s.afterAll((state) => state.env.close());

  s.test("does the thing", async (state, t) => {
    const page = await state.env.newPage();
    await page.open("/");
    t.expect(state.env.server.mock.requestsOf("word").length).toBe(0);
  });
});
```

约定：断言页面行为，别断言实现细节；优先用 `page.waitForPage("word")` 等路由稳定，而不是 `waitForTimeout`。

## 排错

- **Chromium 起不来**：`npx playwright install --with-deps chromium`（Debian/Ubuntu）。
- **想看不发请求的断言**：`server.mock.reset()` 只清规则与请求记录，不清 fallback；需要重放规则就在 `beforeEach` 里重新 `on(...)`。
- **页面一直显示旧代码**：测试会屏蔽 Service Worker；手动打开预览时用 `127.0.0.1`（本地不注册 SW）。
