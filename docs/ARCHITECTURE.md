# talk. 实现说明

给要改代码的人看。README 讲它是什么、能做什么；这里讲它是怎么拼起来的，以及几个关键取舍的原因。

整个应用是纯静态的 HTML/CSS/JS，没有构建、没有后端。浏览器直接读模型 API，数据落在 IndexedDB 和 localStorage。

## 模块结构（原生 ES Modules）

入口 `index.html` 先加载静态配置与基础设施脚本（`data.js`、`theme.js`、`content.js`、`prompts.js`、`llm-client.js`、`i18n.js`、`wordbooks.js`、`doc-parser.js`、`doc-reader.js`、`native-bridge.js`），再以 `<script type="module" src="js/app.js?v=...">` 启动主应用，不需要打包器：

```text
js/
├── app.js                 入口装配、路由、平滑滚动/入场、输入调度与 __TALK_BRIDGE__
├── llm-client.js          统一模型传输层（OpenAI / Anthropic Claude / Gemini 流式 SSE、JSON 重试、模型列表、连通性测试）
├── native-bridge.js       Capacitor Android 原生返回键、状态栏与恢复重绘桥接（普通浏览器 no-op）
├── core/
│   ├── utils.js           DOM 快捷函数、转义、文本归一与语言/颗粒度判定
│   ├── icons.js           内联 SVG 图标集
│   ├── diagnostics.js     脱敏运行日志与全局错误采集
│   └── actions.js         data-action 注册与分发器（取代巨型 click switch）
├── storage/
│   ├── vault.js           WebCrypto AES-GCM 密钥封存与解封（talk.vault.v1）
│   ├── idb-kv.js          通用 IndexedDB 键值库（talk.kv.v1），含无损 localStorage 迁移与内存读镜像
│   ├── settings.js        模型配置/预设、偏好持久化、历史与收藏状态
│   └── word-cache.js      IndexedDB 词条、意群、句子缓存（talk.words.v1）、O(1) 摘要统计与 JSON 导入导出
├── model/
│   ├── stream-preview.js  流式输出渐进字段抽取
│   ├── markdown.js        语境寻词 Markdown 与 [[...]] 锚点解析
│   ├── normalize.js       词条/意群/句子数据归一化与防幻觉校验
│   └── lookup.js          modelLookup 编排、去重、关联词预加载与主题例句补全
├── features/
│   ├── tts.js             系统原生 + Qwen 语音合成与音频缓存（talk.audio.v1）
│   ├── theme-salon.js     首页主题沙龙策展与版本库（talk.themeDecks.v1）
│   └── share.js           分享图段落选择与 1080px PNG 合成
└── views/
    ├── home.js            首页、每日词条与词单
    ├── word.js            词条页、多词性切换与主题例句块
    ├── chunk.js           意群页与颗粒度改判
    ├── sentence.js        句子页、三视角意群切分与信息推进
    ├── reverse.js         语境寻词多轮对话页与持久化
    ├── translator.js      多风格翻译页、工作区与缓存
    ├── status.js          加载 / 离线未收录 / 错误状态页
    ├── layers.js          词/意群/句子多层嵌套探索栈与后台挂起恢复
    ├── sheets.js          通用底部抽屉（支持同壳复用与返回头）、词义速览与缓存仪表盘
    ├── settings-sheet.js  四页签设置（模型 / 阅读 / 外观 / 数据）、幂等保护与渠道编辑器
    └── history-sheet.js   历史记录、寻词记录与词汇书库管理抽屉
```

各功能与视图模块通过工厂函数注入依赖，并导出自己的 `actions` 映射表，在 `js/app.js` 启动时统一注册到 `actions` 分发器。

## 一次查词的完整链路

```text
输入
 └─ normalizeQuery()          小写、去空白、判断单词 / 意群 / 句子 / 寻词
     └─ 缓存查找                 内存 Map → IndexedDB（talk.words.v1）
         ├─ 命中 ─────────────► 直接渲染结果页（不联网）
         └─ 未命中
             └─ 组装 user message：task / detail / query（动态内容永远在末尾）
                 └─ llm-client.js 按协议直连（OpenAI / Anthropic Claude / Gemini），SSE 流式
                     ├─ 字段逐个完整 ──► loading 页上的渐进预览
                     └─ JSON 对象结束 ──► 词条页 + 写缓存（预存 bytes）+ 可选后台预取关联词（≤4 个）
```

句子与意群查词走同一条链路，只是任务换成 `sentence` / `chunk`，输出结构不同。

## 四种颗粒度分流

同一个搜索框按输入自动分流（`detectParadigm()`，启发式，手动 chip 可覆盖）：

| 输入 | 判为 | 任务 | 页面 |
| --- | --- | --- | --- |
| 单个词 | 词 | `word` | 词条页（报刊卡片） |
| 2–5 个词、无句末标点 | 意群 | `chunk` | 意群页：整体意思 / 词眼 / 槽位 / 变形 / 来历 / 例句 |
| 有句末标点或 ≥6 词 | 句子 | `sentence` | 句子页（原句 / 意群切分 / 信息焦点三视角） |
| 中文或「how do you say…」 | 语境寻词 | `reverse` | 多轮对话选词台：Markdown 拆解 + `[[...]]` 行内可点锚点，可继续追问 |

词条、意群（键前缀 `chunk:`）与句子分析全部存进 `talk.words.v1`（IndexedDB），**不设数量或过期上限**，仅在用户手动清空时删除；语境寻词多轮线程与翻译结果存进通用 IndexedDB 键值库 `talk.kv.v1`，刷新后完整恢复。

语境寻词采用**自然 Markdown + `[[...]]` 行内锚点**格式（`js/model/markdown.js`）：流式输出阶段会自动吞掉末尾未闭合的 `[[`，输出完成后正文里的 `[[expression]]` 变为可点击的英文锚点（点开按词/意群/句进入独立词条或抽屉，长按可加入下方追问框）。追问时客户端会携带历史问答上下文（Anthropic / Gemini 自动合并连续同角色轮次），整条对话线程写入 `talk.kv.v1` 持久化。

## 提示词：静态前缀，动态尾巴

`prompts.js` 里的全部系统提示词（单词 / 句子 / 意群 / 语境寻词 / 例句 / 翻译 / 主题沙龙 / 书库提取与归类 / 长文精读概览、分段与速查）都是**完全静态**的字符串：角色、JSON schema、规则、各深度的数量要求与示例全在里面。

用户消息只放会变的东西：

```text
单词   {"task":"word","detail":"fast","query":"serendipity"}
句子   {"task":"sentence","detail":"fast","text":"Hope is not a prediction."}
意群   {"task":"chunk","detail":"standard","query":"take off"}
寻词   {"task":"reverse","detail":"standard","level":"gaokao","text":"怎么礼貌地顺便问一句"}
主题   {"task":"theme","detail":"standard","exclude":["雨夜的天文台","..."]}
```

这样做的原因是**供应商的前缀缓存**：同一个模型连续查词时，系统提示词那一大段永远不变，命中缓存后按缓存价计费、首字也更快。

主题沙龙把 `exclude` 放在用户消息**末尾**，而不是系统提示词里，也是同一个理由——已展出的标题每轮都在变，放进前缀会把缓存打碎。

## JSON 模式与流式

- 普通请求带结构化约束（OpenAI 为 `response_format: {"type":"json_object"}`，Gemini 为 `responseMimeType: "application/json"`；Anthropic 通过静态提示词与严格 JSON 提取保障）。
- 流式请求**故意不带** `response_format`：不少 OpenAI 兼容网关在「流式 + 结构化输出」同时开启时会先把整个响应缓冲下来，流式就失效了。JSON 仍然由静态系统提示词约束。
- 流式时客户端按括号深度扫描增量文本，`word`/`phonetic`/`translation`/`short`/`sentence translation`/`tone`/`structure` 这些字段一旦闭合就先渲染出来。
- 如果供应商拒绝流式（报错或直接返回非流式 JSON），客户端**重试一次**普通的非流式请求。

## 数据模型

词条（与 `js/data.js` 的内置示例保持一致）：

```text
word, phonetic, pos, translation, short, tags[]
origin      { original, story, era }
stages[]    { when, label, text }        when 里的 19th century / Old English 在渲染时归一
posGroups[] { pos, senses[] }            多词性；老缓存没有这个字段就当成单一词性
senses[]    { zh, en, label }
family[]    { word, pos, gloss }
synonyms[], antonyms[], collocations[]
examples[]  { en, zh, tag }
memory                                   记法
```

兼容原则：新字段一律可选。缺 `posGroups` 的老缓存按「一个词性 + 原有 `senses`」渲染，不需要迁移脚本，也不需要清缓存。

## 缓存与本地存储

所有业务数据以 **IndexedDB 为主存储**，不设自动过期淘汰；轻量 UI 偏好留在 `localStorage`：

| 位置 | 库 / 键 | 内容 | 策略 |
| --- | --- | --- | --- |
| IndexedDB | `talk.words.v1`（`entries` + `sentences`） | 完整词条与意群 JSON（意群键前缀 `chunk:`）及句子分析（`sha1(text\|level\|detail\|lang)`） | 永久保留；写入预存 `bytes`，`wordCacheSummary()` `O(1)` 汇总 |
| IndexedDB | `talk.kv.v1` | 语境寻词多轮线程（`talk.reverse.threads.v1` / `talk.reverse.v2`）与翻译结果（`talk.translations.v3`，含 `.en` 键） | 永久保留；启动时自动从旧 `localStorage` 无损迁移 |
| IndexedDB | `talk.wordbooks.v1` | 多词汇书库（默认「密集书库」与自定义分册） | 永久保留；支持 AI 零丢失分册审计 |
| IndexedDB | `talk.docs.v1` | 长文精读本（解析结果与分段精读缓存） | 保留最近 20 篇，支持手动删除 |
| IndexedDB | `talk.audio.v1` | Qwen 语音音频 Blob | 复用单连接 + 内存统计缓存，可一键清空 |
| IndexedDB | `talk.themeDecks.v1` | 主题沙龙版本库 | 全量保留；首页展示队列（`talk.themeDisplay.v1`）最多 8 版 |
| IndexedDB | `talk.vault.v1` | 解封 API key 的 AES-256-GCM `CryptoKey` | 不可导出（`extractable: false`） |
| session / localStorage | `talk.model.v1` | 模型渠道配置与密文 API key | 默认仅会话保存，勾选「记住密钥」才写 `localStorage` |
| localStorage | `talk.prefs.v1` | 生成深度、学习阶段、寻词长度、发音引擎、缓存提示等偏好 | 自动保存 |
| localStorage | `talk.theme.v1` / `talk.lang.v1` | 当前主题 id / 界面语言（`zh` / `en`） | 启动前同步读取 |
| localStorage | `talk.history.v1` / `talk.saved.v1` | 最近查词历史 / 收藏快照 | 与书库保持同步 |
| localStorage | `talk.share.v1` / `talk.exampleStyles.v1` / `talk.diagnostics.v1` | 分享图勾选 / 各主题例句风格 / 脱敏诊断日志 | 轻量配置 |

几条规则：

- **缓存跨深度复用**：fast / standard / deep 共用同一条词条缓存，换深度不会重新请求；想换版本要点词条页的「重新生成词条」。
- **零卡顿统计**：`word-cache.js` 采用无分配 UTF-8 字节计算 + `WeakMap` 缓存 + 增量汇总，`theme-salon.js` 直读内存 `state.themeDecks`，`tts.js` 缓存音频统计，点击「数据」页签与「缓存管理」均在毫秒级响应。
- **数据备份**：设置 → 数据里的「缓存管理」支持查看存储占用、导出/导入 JSON、以及按类清空词条、句子、语音和主题库。

## 渠道与模型发现

模型配置按渠道存：每条渠道支持 **OpenAI 兼容**、**Anthropic (Claude Messages API)** 与 **Google Gemini** 三种原生协议，各自保存 Base URL、密钥、当前模型与思考开关：

- **OpenAI 兼容**：`POST /chat/completions` + `GET /models`，自动处理 `stream_options` 422 与 `json_object` 400 降级。
- **Anthropic (Claude)**：原生 `POST /v1/messages` + `GET /v1/models`，自动注入 `x-api-key`、`anthropic-version: 2023-06-01`、`anthropic-dangerous-direct-browser-access: true`，规范化 `system` 与交替 `user`/`assistant` 轮次，支持原生 SSE 流与 `thinking: { type: "enabled", budget_tokens }` 扩展思考。
- **Google Gemini**：原生 `/v1beta/models/...:streamGenerateContent` 与 `/v1beta/models`，支持 `thinkingBudget`。

渠道表单里的「测试」发一条 16 token 的最小请求并回报耗时与回复；编辑时密钥留空表示保留原密钥。

## API 密钥怎么存

密钥在磁盘上永远是密文：

```text
内存      state.settings.apiKey（明文，只在运行期）
会话/本地 talk.model.v1 里每个 apiKey = "sealed:v1:<base64 iv>.<base64 ciphertext>"
信封密钥  IndexedDB talk.vault.v1 / keys / api-key-wrap，AES-256-GCM，extractable: false
```

- 启动时 `loadSettings()` 同步读出密文，`init()` 第一件事 `await unlockStoredKeys()` 解封到内存，之后渲染和请求才拿得到明文。
- 写盘时 `persistSettings()` 先把快照整体封好再写入；默认只写 `sessionStorage`，勾「记住密钥」才写 `localStorage`，取消勾选会主动删除本地副本。
- 旧版本留下的明文字段在启动时会被识别出来，并立刻重写为密文，不需要用户操作。
- 解封失败（清过 IndexedDB、换了设备）会丢掉该 key 并提示，不会把密文当密钥发出去。
- 降级：非安全上下文（没有 `crypto.subtle`）或 IndexedDB 不可用时退回明文存储，控制台会 warn 一条。

**边界要说清楚**：信封密钥不可导出，所以从存储里偷到的只有密文；但页面自己必须能解密，所以任何能在本 origin 执行 JS 的东西（XSS、恶意扩展、改过的构建）仍然拿得到明文。这是「防翻看」，不是「防使用」——真正的隔离只能把 key 放到服务端代理。

## 生成深度

| | fast | standard | deep |
| --- | --- | --- | --- |
| max_tokens | 1200 | 2200 | 3200 |
| 义项 | 1 | 2 | 3 |
| 同根词 | 2 | 3 | 4 |
| 近义词 / 反义词 | 2 / 1 | 3 / 2 | 4 / 3 |
| 例句 / 搭配 | 1 / 2 | 2 / 4 | 3 / 5 |
| 时间轴 / 重点词 | 2 / 3 | 3 / 4 | 4 / 5 |

数值都在 `js/storage/settings.js` 的 `DETAIL_LEVELS` 里，提示词里另有一份同样的数量要求（`prompts.js`）。改深度要两边一起改，否则模型会收到互相矛盾的指令。

### 按压、排版与复制

- **词头排版 Token**：`css/styles.css` 在 `:root` 统一声明 `--lh-display: 1.18`、`--lh-display-phrase: 1.22`、`--lh-ui-single: 1.38`、`--hero-subrow-gap: 12px`，并由 `.word-subrow` 自己持有与上方标题的间距，防止 Android/桌面字体下 `q / y / g / p / j` 下伸部被音标行或 `overflow: hidden` 遮挡裁切。
- **按压动效**：可点元素统一悬停 `translate: 0 -1px`、按下 `0 1px`（160ms / 120ms，`--ease-out-expo`）；`prefers-reduced-motion` 下不位移。
- **复制入口**：统一走 `data-action="copy-text"` + `data-copy`，复制成功弹「已复制」。

## 主题系统

主题是「基础 token + 覆盖文件」的结构：

```text
css/theme.css        基础 token 契约（Paper 就是它本身）
css/themes/*.css     其余六套主题覆盖（still / constructivist / swiss-lab / topo-acid / archive-grid / retro-stub）
js/theme.js          注册表：id / label / themeColor / accent / accentFill / css / copyKey / description / exampleStyle
js/content.js        基础文案 + themeCopy[<id>] 的主题语气改写
js/prompts.js        与主题无关，主题不影响提示词
```

`theme.js` 的 `apply()` 负责写 `<html data-theme>`、切换 `theme-color`、更新激活样式表；`list()` 直接喂给 **设置 → 外观** 的双列主题网格。完整步骤见 [THEME.md](../THEME.md)。

主题**不参与组件布局**。版式差异（比如横屏间距）走 `styles.css` 里的 `--word-*` 变量，而不是在主题文件里写 `!important` 覆写。

## 滚动与入场

- 页面自己滚 `.screen`，不滚 `body`；平滑滚动用 `vendor/lenis.min.js`（1.1.20，随仓库提交，SW 预缓存），在 `setupSmoothScroll()` 里 `wrapper` 与 `content` 都指向 `.screen`，`lerp 0.09`、`smoothWheel true`、`syncTouch false`（触屏保持原生）。
- 路由切换用 `scrollScreenTo(0, true)` 复位，并在换页后 `lenis.resize()` 重算高度；`reduce-motion` 下完全不创建 Lenis。
- 嵌套滚动区（设置弹层、翻译结果区、精读工作区）标 `data-lenis-prevent`，滚轮/触摸在其中不会被页面接管。
- 入场用 `IntersectionObserver`：`.reveal` 按 section 触发；`html.motion-ready` 由 head 内联脚本在首帧前加上，超时自动摘除，保证 JS 异常时内容仍可见。

## 发音

两个引擎，在 **设置 → 阅读 → 朗读发音** 切换：

- **系统原生**（默认）：`window.speechSynthesis`，离线、零下载，音色取决于设备。
- **Qwen 语音**：复用 Qwen 模型渠道的 API key，浏览器直接请求 `POST /api/v1/services/audio/tts/SpeechSynthesizer`。默认 `qwen-audio-3.1-tts-plus` + `longanhuan_v3.1`；模型名以 `qwen3-tts` 开头时改走多模态生成接口，并把不兼容的音色换成 `Cherry`。

Qwen 音频写入 `talk.audio.v1`，同一个词第二次播放不联网。失败时提示原因并回退到系统语音。

## 分享图

顶栏的分享按钮出现在词条、意群与句子页。客户端先按默认选择生成一张图：把标题区与选中的段落克隆进离屏舞台，套上当前主题样式，再用 `vendor/html-to-image.js` 渲染成 1080 宽的 PNG。底部可以「保存图片 / 系统分享 / 调整内容」；勾选结果写入 `talk.share.v1`，不请求模型也不上传内容。

## 部署与 Android 打包

`.github/workflows/pages.yml` 与 `scripts/build-web.mjs` 把纯静态文件拷进 `dist/`，没有任何构建步骤：

```text
index.html favicon.svg manifest.webmanifest sw.js .nojekyll LICENSE
icons/ css/ js/ vendor/
```

Android APK 通过 Capacitor + `.github/workflows/android-apk.yml` 自动打包，由 `scripts/setup-android-native.mjs` 注入局域网 HTTP 支持、`TalkPrintBridge`（让长文精读本 PDF 导出在 WebView 内调用系统打印服务）与启动图标。

改前端资源或增删 `js/` 下的 ES 子模块后，运行一键脚本同步三处版本号与 `sw.js` 的 ESM 预缓存清单：

```bash
npm run bump                         # 构建号 +1，同步 js/app.js APP_BUILD、index.html ?v=、sw.js SHELL_CACHE 与 ESM 子模块列表
node scripts/bump-build.mjs --sync   # 保持当前构建号，仅重新同步 sw.js 里的 ESM 子模块清单
npm run check:shell                  # 校验三处版本同步、SW 覆盖全部静态资源与 ESM 子模块、以及全量 JS 语法检查
```

- `sw.js` 安装阶段对预缓存清单使用 `{ cache: "reload" }`，确保无 `?v=` 参数的 ES 子模块在递增构建号后不会被浏览器旧 HTTP 缓存污染。
- 新增顶级静态目录时同步检查 `scripts/build-web.mjs` 与 `.github/workflows/pages.yml`（`tests/suites/shell.spec.mjs` 会自动校验）。
- `.github/workflows/test.yml` 会在 PR 及发布前自动跑完整个离线测试套件。

## 本地开发

```bash
python3 -m http.server 8080     # 或任意静态服务器
```

用 `http://127.0.0.1:8080` 或局域网 IP 打开都可以。但注意：非 localhost 的 HTTP 是非安全上下文，没有 `crypto.subtle`，密钥加密封存与 Service Worker 不可用；手机浏览器完整调试请用 HTTPS 或 Android APK。

## 自动化测试

`npm test` 运行 `tests/` 里的完整离线测试套件（单元测试 + Playwright 端到端，共 **15 组 65 例**）：静态站点与假模型同源（`tests/lib/server.mjs`），桩数据在 `tests/fixtures/`。覆盖统一模型传输层（OpenAI / Anthropic Claude / Gemini）、核心工具与数据归一化、SW 外壳与文档同步校验、查词、意群、语境寻词多轮追问与重试、句子三视角切分、长文精读、词汇书库、缓存导入导出、分享图、离线降级、主题覆盖，以及设置四页签/幂等性/500 词条缓存耗时与词头排版几何回归。细节见 [TESTING.md](TESTING.md)。

## 手工验收清单

自动化覆盖不到的部分（视觉观感与真机手感），改完 UI 或提示词后至少过一遍：

- [ ] 切换多套主题（Paper / Still / Constructivist / Topo Acid 等），确认标题文案与视觉细节一致
- [ ] 查一个缓存词（离线可用）和一个新词（走 API），缓存状态标记正确
- [ ] 同一个词切 fast / standard / deep，确认命中缓存不重新请求
- [ ] 词条页横屏：左栏 hero、右栏义项，同根词独占整排
- [ ] 意群页与二级词层抽屉：含 `q / y / g / p` 的词头与音标行间距清晰无遮挡
- [ ] 句子页：原句 / 意群切分 / 信息焦点三视角切换无抖动，重点词按学习阶段筛选正确
- [ ] 翻译：中→英、英→英各一次，勾选项对应输出
- [ ] 精读：导入文章或示例，双版切换、行内速查 Dock、PDF 导出预览正常
- [ ] 设置：模型 / 阅读 / 外观 / 数据四页自动保存、连点设置键无闪烁、刷新后配置不丢
- [ ] 断网后重开，外壳仍能启动（Service Worker 生效）

## 已知限制

- 自动化测试只覆盖行为、性能与关键几何约束，视觉细节仍需结合截图或真机检查。
- 纯前端意味着 API key 暴露在当前浏览器上下文里，建议使用限额 key 或自建服务端代理。
- 流式解析是容错的括号扫描，极端情况下（模型在字符串里输出未转义括号）预览可能短暂错乱，最终结果仍以完整 JSON 为准。
- 宽屏下同根词卡片仍是固定宽度，右侧会留白。
- 隐身模式下 IndexedDB 可能在关闭窗口后被浏览器回收。

## 例句、文化与句子拆解

词条的文化背景写进已有的 `note`（提示词要求优先写典故、地域用法与语域），不另开字段。词条与句子均遵循「模型生成、前端只渲染、新字段可选」的原则，旧缓存不必清空。

| 字段 | 归属 | 说明 |
| --- | --- | --- |
| `examplesByTheme` | word | 每套主题 1–2 条例句；缺失主题在渲染后一次性补齐并写回缓存 |
| `summary` | sentence | 一句话主旨 |
| `segments` | sentence / part | 2–6 个意群，`text` 拼接必须等于原句；`role` 只允许 theme / rheme / focus / modifier |
| `orderNote` | sentence / part | 仅当语序有明显特征（被动、倒装、尾重、强调句）时出现 |
| `contrast` | sentence / part | 「最小内核」或「口语说法」对照 |
| `sentences` | sentence | 多句分别拆解 |
| `level` / `sentenceIndex` / `externalExample` | keyWord | 学习阶段、所在句、本句用法不典型时的补充例句 |

- 主题的例句风格存在 `talk.exampleStyles.v1`，默认值来自 `TALK_THEME` 的 `exampleStyle`，可在 **设置 → 阅读 → 高级生成选项** 按主题改写。
- `SENTENCE_LEVELS` 是唯一的阶段表（中考 3 / 高考 4 / CET4 5 / CET6 6 / 考研 7 / 雅思 7 / 托福 8），设置里选择后写进 `talk.prefs.v1`。
- 单词缓存 `talk.words.v1`（`entries` store）的 `WORD_CACHE_SCHEMA` 为 3，读取时接受 schema ≥ 2，旧记录在下次写入时就地升级。
- 句子缓存存于同一数据库 `talk.words.v1` 的 `sentences` store，`SENTENCE_CACHE_SCHEMA` 为 2，读取时接受 schema ≥ 1：旧记录没有 `segments` 时自动降级渲染，不报错也不重算。

## 句子拆解（意群与信息结构）

句子页采用三视角信息结构阅读（已移除早期的洋葱嵌套折叠）：模型把一句话切成 2–6 个**意群**，每个意群带一个信息结构角色：

| role | 中文标签 | 含义 |
| --- | --- | --- |
| `theme` | 起点 | 句子在讲什么（主语、话题、句首状语） |
| `rheme` | 推进 | 对它说了什么（主要陈述） |
| `focus` | 焦点 | 全句唯一的落点，通常是最后一个非修饰成分 |
| `modifier` | 背景 | 时间、地点、方式、让步、插入语 |

- 校验：`segments.map(s => s.text).join("")` 必须等于原句（允许句末标点落在最后一段内或外）；拼接不上就丢弃这一层，退回纯文本。
- 分隔符固定在每个意群的**非空白文本末尾**（尾随空格另存为 `.seg-space`），换行时不会漂到行尾；三态切换只改伪元素与透明度，所有片段的位置与换行在三种视图下完全一致。
- 三态切换（纯 CSS，无布局位移）：`原句` / `意群切分`（插入虚线与微刻度）/ `信息焦点`（`modifier` 降到 28% 不透明度，`focus` 加底部强调线）。
- 四个编号块：`整句意译`（译文 + 语气/句式）、`信息推进`（编号 + 角色 + 顺译 + 语序说明）、`句中构式`（带 `chunk` 的意群，点开调用 `cacheGetChunk` 或 `runSearch(chunk, "chunk")`）、`结构对照`；有重点词时再追加 `值得注意的词`。
- 多句段落走 `parts[]`，每句各自一套 `segments` 与四个块，外层保留整段意译与主旨。

## 意群与语境寻词的模型侧

意群（`chunk`）不是「词典里的短语」，而是一个**语块**：整体意象释义、语体、1–2 个核心词眼、句法槽位与可替换变形、可选的典故来源、1–4 条地道例句。客户端只保留逐字出现在 `chunk` 里的词眼——模型编出来的词组不会变成可点的按钮。

语境寻词（`reverse`）以自由流式 Markdown 输出，行内用 `[[...]]` 标出推荐英文表达；点击任意 `[[...]]` 锚点时由前端判定其颗粒度并打开对应词条/意群/句子页或抽屉，返回后精准回到对话线程原位。多轮追问的完整历史保存在 `talk.kv.v1`，跨刷新可继续追问。
