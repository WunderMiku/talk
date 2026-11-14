# talk. 实现说明

给要改代码的人看。README 讲它是什么、能做什么；这里讲它是怎么拼起来的，以及几个关键取舍的原因。

整个应用是纯静态的 HTML/CSS/JS，没有构建、没有后端。浏览器直接读模型 API，数据落在 IndexedDB 和 localStorage。

## 一次查词的完整链路

```text
输入
 └─ normalizeQuery()          小写、去空白、判断单词 / 短语
     └─ 缓存查找                 内存 Map → IndexedDB（talk.words.v1）
         ├─ 命中 ─────────────► 直接渲染词条页（不联网）
         └─ 未命中
             └─ 组装 user message：task / detail / query（动态内容永远在末尾）
                 └─ POST {baseUrl}/chat/completions，SSE 流式
                     ├─ 字段逐个完整 ──► loading 页上的渐进预览
                     └─ JSON 对象结束 ──► 词条页 + 写缓存 + 后台预取同根词（≤4 个）
```

句子查词走同一条链路，只是任务换成 `sentence`，输出结构不同。

## 三种颗粒度

同一个搜索框按输入自动分流（`detectParadigm()`，启发式，手动 chip 可覆盖）：

| 输入 | 判为 | 任务 | 页面 |
| --- | --- | --- | --- |
| 单个词 | 词 | `word` | 词条页（报刊卡片） |
| 2–5 个词、无句末标点 | 意群 | `chunk` | 意群页：整体意思 / 词眼 / 槽位 / 变形 / 来历 / 例句 |
| 有句末标点或 ≥6 词 | 句子 | `sentence` | 句子页（洋葱式折叠） |
| 中文或「how do you say…」 | 语境寻词 | `reverse` | 选词手记：一句概述 + 3–5 个候选，按 `paradigm` 精确跳转 |

意群缓存与词条共用 `talk.words.v1`，键前缀 `chunk:`，单独限 **60 条**，不挤占 300 条词条额度；`talk.reverse.v1` 只存最近 20 次手记、7 天过期。

## 提示词：静态前缀，动态尾巴

`prompts.js` 里七个系统提示词（单词 / 句子 / 意群 / 语境寻词 / 例句 / 翻译 / 主题沙龙）都是**完全静态**的字符串：角色、JSON schema、规则、各深度的数量要求、few-shot 示例全在里面。

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

- 普通请求带 `response_format: {"type":"json_object"}`，模型必须回 JSON。
- 流式请求**故意不带** `response_format`：不少 OpenAI 兼容网关在「流式 + 结构化输出」同时开启时会先把整个响应缓冲下来，流式就失效了。JSON 仍然由静态系统提示词约束。
- 流式时客户端按括号深度扫描增量文本，`word`/`phonetic`/`translation`/`short`/`sentence translation`/`tone`/`structure` 这些字段一旦闭合就先渲染出来。
- 如果供应商拒绝流式（报错或直接返回非流式 JSON），客户端**重试一次**普通的非流式请求。

## 数据模型

词条（`app.js` 顶部的注释与 `data.js` 的示例一致）：

```text
word, phonetic, pos, translation, short, tags[]
origin      { original, story, era }
stages[]    { when, label, text }        when 里的 19th century / Old English 在渲染时归一
posGroups[] { pos, senses[] }            多词性；老缓存没有这个字段就当成单一词性
senses[]    { zh, en, label }
family[]    { word, pos, gloss }
synonyms[], antonyms[], collocations[]
examples[]  { en, zh, tag }
memory                                记法
```

兼容原则：新字段一律可选。缺 `posGroups` 的老缓存按「一个词性 + 原有 `senses`」渲染，不需要迁移脚本，也不需要清缓存。

## 缓存与本地存储

| 位置 | 键 | 内容 | 上限 |
| --- | --- | --- | --- |
| IndexedDB | `talk.words.v1` | 完整词条与意群 JSON（意群键前缀 `chunk:`） | 词条 300 条 / 90 天；意群单独 60 条 |
| IndexedDB | `talk.audio.v1` | Qwen 语音音频 | 键里带版本，可一键清空 |
| IndexedDB | `talk.themeDecks.v1` | 主题沙龙版本库 | 全量保留；首页展示队列最多 8 版 |
| localStorage | `talk.model.v1` | 模型配置与 API key | — |
| localStorage | `talk.translations.v3` | 翻译结果（按源语言 + 原文分键） | 40 条 / 30 天 |
| localStorage | `talk.prefs.v1` | 深度、缓存上限、发音引擎等偏好 | — |
| localStorage | `talk.theme.v1` | 当前主题 id | — |
| IndexedDB | `talk.vault.v1` | 用于解封密钥的 AES-GCM `CryptoKey` | 不可导出（`extractable: false`） |
| localStorage | `talk.history.v1` / `talk.saved.v1` | 最近查词（含意群）/ 收藏 | — |
| localStorage | `talk.reverse.v1` | 语境寻词手记（按下文短哈希） | 20 条 / 7 天 |

几条规则：

- **缓存跨深度复用**。fast / standard / deep 共用同一条缓存，换深度不会重新请求；想换版本要点词条页的「重新生成词条」。
- **翻译缓存按源语言 + 文本分键**（`talk.translations.v3`），所以中→英和英→英不会串味。
- 键名里的版本号（`v1`/`v3`）就是数据结构版本，改结构时手动 bump，老数据自然失效，不用写迁移。
- 设置 → 数据里的「缓存管理」可以查看占用、导出 JSON、导入 JSON、单独清音频缓存或主题库。

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

**边界要说清楚**：信封密钥不可导出，所以从存储里偷到的只有密文；但页面自己必须能解密，所以任何能在本 origin 执行 JS 的东西（XSS、恶意扩展、改过的构建）仍然拿得到明文。这是"防翻看"，不是"防使用"——真正的隔离只能把 key 放到服务端代理。

## 生成深度

| | fast | standard | deep |
| --- | --- | --- | --- |
| max_tokens | 1200 | 2200 | 3200 |
| 义项 | 1 | 2 | 3 |
| 同根词 | 2 | 3 | 4 |
| 近义词 / 反义词 | 2 / 1 | 3 / 2 | 4 / 3 |
| 例句 / 搭配 | 1 / 2 | 2 / 4 | 3 / 5 |
| 时间轴 / 重点词 | 2 / 3 | 3 / 4 | 4 / 5 |

数值都在 `app.js` 的 `DETAIL_LEVELS` 里，提示词里另有一份同样的数量要求（`prompts.js`）。改深度要两边一起改，否则模型会收到互相矛盾的指令。


### 按压与复制

- 所有可点元素共用一套动作：悬停 `translate: 0 -1px`、按下 `0 1px`，时长 160ms / 120ms，缓动 `--ease-out-expo`；触摸设备只有按下态；`prefers-reduced-motion` 下不位移。
- 禁用长按菜单：`.app`/`.screen` 设 `user-select: none` 与 `-webkit-touch-callout: none`，输入框与文本域例外。
- 复制入口只有三处：词头操作行的「复制释义」（中文释义 + 英文简义）、每条例句动作组的「复制」（英文 + 中文）、句子页与翻译结果卡原有的复制。统一走 `data-action="copy-text"` + `data-copy`，复制成功弹「已复制」。

## 主题系统

主题是「基础 token + 覆盖文件」的结构：

```text
theme.css            基础 token 契约（Paper 就是它本身）
themes/ussr.css      constructivist 覆盖
themes/rhine.css     Rhine Lab 覆盖
theme.js             注册表：id / label / themeColor / accent / css / copyKey / description
content.js           基础文案 + themeCopy[<id>] 的主题语气改写
prompts.js           与主题无关，主题不影响提示词
```

`theme.js` 的 `apply()` 负责写 `<html data-theme>`、切换 `theme-color`、懒加载对应样式表；`list()` 直接喂给设置面板，所以加一个主题只需要：一个 CSS 文件、一条注册表项、可选的文案块。完整步骤见 [THEME.md](../THEME.md)。

主题**不参与组件布局**。版式差异（比如横屏间距）走 `styles.css` 里的 `--word-*` 变量，而不是在主题文件里写 `!important` 覆写——这是 2026 年 11 月那次重构的核心约束。

## 滚动与入场

- 页面自己滚 `.screen`，不滚 `body`；平滑滚动用 `vendor/lenis.min.js`（1.1.20，随仓库提交，SW 预缓存），在 `setupSmoothScroll()` 里 `wrapper` 与 `content` 都指向 `.screen`，`lerp 0.09`、`smoothWheel true`、`syncTouch false`（触屏保持原生）。
- 路由切换用 `scrollScreenTo(0, true)` 复位，并在换页后 `lenis.resize()` 重算高度；`reduce-motion` 下完全不创建 Lenis。
- 嵌套滚动区（设置弹层、翻译结果区）标 `data-lenis-prevent`，滚轮/触摸在其中不会被页面接管。
- 入场用 `IntersectionObserver`：`.reveal` 按 section 触发，初始上浮 6px、时长 0.28s、无透明度变化；`rootMargin` 底部提前 120px；滚到离底 40px 内时兜底全部 `is-in`。`html.motion-ready` 由 head 里的内联脚本在首帧前加上，3 秒未初始化则摘除，保证 JS 失败时内容仍可见。

## 发音

两个引擎，设置 → 发音里切换：

- **系统原生**（默认）：`window.speechSynthesis`，离线、零下载，音色取决于设备。
- **Qwen 语音**：用当前 Qwen 模型配置里的 key，浏览器直接请求 `POST /api/v1/services/audio/tts/SpeechSynthesizer`。默认 `qwen-audio-3.1-tts-plus` + `longanhuan_v3.1`；模型名以 `qwen3-tts` 开头时改走多模态生成接口，并把不兼容的音色换成 `Cherry`。

Qwen 的结果写进 `talk.audio.v1`，同一个词第二次点播放不联网。失败（没 key、CORS 被拦、HTTP 错误）时提示错误并回退到系统语音，不会静默无声。

v122 之前打包过一个本地 Kokoro 模型，每个访客要多下约 115 MB、加载 13–17 秒，量化后的 ONNX 在 Android WebGPU 上不稳定，已经整体移除。

## 部署

`.github/workflows/pages.yml` 把静态文件拷进 `dist/` 再发布到 GitHub Pages，没有任何构建步骤：

```text
cp index.html styles.css theme.css theme.js content.js prompts.js data.js app.js \
   favicon.svg manifest.webmanifest sw.js .nojekyll LICENSE dist/
cp -r icons themes dist/
bash scripts/fetch-assets.sh dist      # 只下载 vendor/idb.js
```

改前端资源后有三处版本号要一起动，否则老用户会拿到新旧混杂的缓存：

1. `app.js` 里的 `APP_VERSION`
2. `index.html` 里所有 `?v=` 查询参数（含 `themes/*.css`）
3. `sw.js` 的缓存名（`talk-shell-vNNN`）和 `?v=`

新增静态目录时记得同步 `pages.yml` 的拷贝清单——`themes/` 最初就是因为漏了这一步而 404。

## 本地开发

```bash
python3 -m http.server 8080     # 或任意静态服务器
```

请用 `http://127.0.0.1:8080` 打开，**不要用局域网 IP**：页面带 `upgrade-insecure-requests`，非 localhost 的 HTTP 源会被浏览器改写成 HTTPS，子资源全部失败，表现为白屏。要在手机上调试就起一个 HTTPS 服务，或者接受 localhost 的信任例外。

截图脚本 `scripts/screenshots.mjs` 用 Playwright 生成 README 图片，需要先 `npm i -D playwright && npx playwright install chromium`。脚本以 `SHOT_OUT` 指定输出目录。

## 手工验收清单

改完 UI 或提示词后至少过一遍：

- [ ] 首页三种主题各切一次，标题文案与语气对得上
- [ ] 查一个缓存词（离线可用）和一个新词（走 API），标记正确
- [ ] 同一个词切 fast/standard/deep，确认命中缓存不重新请求
- [ ] 词条页横屏：左栏 hero、右栏义项，同根词独占整排
- [ ] 句子查词：重点词高亮、整句意思、值得注意的词
- [ ] 翻译：中→英、英→英各一次，五个风格都出结果
- [ ] 主题沙龙：再印一版、选一版、翻页都正常
- [ ] 设置：模型 / 发音 / 数据三页保存后刷新不丢
- [ ] 断网后重开，外壳仍能启动（service worker 生效）

## 已知限制

- 没有自动化测试套件。上面那份清单是目前唯一的回归手段，改动依赖手测。
- 纯前端意味着 API key 一定暴露在浏览器里，只能用限额 key；要藏 key 就得加一层服务端代理。
- 流式解析是容错的括号扫描，不是完整的增量 JSON parser；极端情况下（模型在字符串里输出未转义的括号）预览可能短暂错乱，最终结果仍以完整 JSON 为准。
- 宽屏下同根词卡片仍是固定宽度，右侧会留白。
- 吸顶栏是半透明 + 模糊，滚动时下面的内容会透出来，视觉上偶尔显得脏。
- 隐身模式下 IndexedDB 可能被立即回收，缓存自然失效。

## 例句、文化与句子拆解

词条的文化背景写进已有的 `note`（提示词要求优先写典故、地域用法与语域），不另开字段。

词条与句子都遵循「模型生成、前端只渲染」的原则，新增内容一律是可选字段，旧缓存不必清空。

| 字段 | 归属 | 说明 |
| --- | --- | --- |
| `examplesByTheme` | word | 每套主题 1–2 条例句；缺失主题在渲染后一次性补齐并写回缓存 |
| `summary` | sentence | 一句话主旨 |
| `tree` | sentence | 句法树，节点 `kind` 只允许 main / clause / phrase / modifier，默认只展开主干 |
| `sentences` | sentence | 多句分别拆解 |
| `level` / `sentenceIndex` / `externalExample` | keyWord | 学习阶段、所在句、本句用法不典型时的补充例句 |

- 主题的例句风格存在 `talk.exampleStyles.v1`，默认值来自 `TALK_THEME` 的 `exampleStyle`，设置里可按主题改写。
- `SENTENCE_LEVELS` 是唯一的阶段表（中考 3 / 高考 4 / CET4 5 / CET6 6 / 考研 7 / 雅思 7 / 托福 8），设置里选择后写进 `talk.prefs.v1`。
- 单词缓存 `talk.words.v1` 的 `WORD_CACHE_SCHEMA` 升到 3，但读取时接受 schema ≥ 2，旧记录在下次写入时就地升级；句子不落 IndexedDB，只在内存中缓存。


## 句子拆解（洋葱式折叠）

句子页不在正文里堆语法标签，而是把整句渲染成一行连续文字：主干直接显示，每层修饰在锚点词后留一个 `[+]`。点开后，该层以 `onion-clause` 内联插回原句（字号小一档、颜色更淡、虚线框），再点这一层就打开知识点卡片（作用 / 大意 / 阅读提示）。

- 数据：`sentence.tree` 的每个非 main 节点带 `anchor`（父级 text 里的词），前端按锚点把子节点插回父级文本，再递归渲染。
- 结构：`onionCompose()` 组合文本与插槽，`onionSlot()` 生成 `[+]` 与可展开片段，`openInsightSheet()` 渲染卡片。
- 动效：纯 CSS。展开时 `onion-clause` 做透明度 + 字距过渡，避免 `clip-path` 影响行盒；折叠为即时隐藏，不阻塞布局。

## 意群与语境寻词的模型侧

意群（`chunk`）不是「词典里的短语」，而是一个**语块**：整体意象释义、语体、1–2 个核心词眼、句法槽位与可替换变形、可选的典故来源、1–4 条地道例句。客户端只保留逐字出现在 `chunk` 里的词眼——模型编出来的词组不会变成可点的按钮。

语境寻词（`reverse`）先给一句 `overview`，再给 3–5 个候选，每个候选带 `paradigm`。服务端强制三条降级：单 token 不能标 `sentence`；多 token 不能标 `word`；候选句超过 20 词时降为 `chunk`（单 token 降为 `word`），避免手记卡里出现读不完的长句。点候选时用它的 `paradigm` 直接路由，而不是再跑一次分流。

两条路径都沿用同一套请求与重试：`response_format` 只用于非流式；流式时不做渐进预览（结构是嵌套的，解析成本高于收益）。
