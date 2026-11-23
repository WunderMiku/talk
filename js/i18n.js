/* talk. — interface language.
 *
 * The product copy lives in Chinese across a lot of hand-written markup, and
 * the model writes in Chinese too. Rather than fork every template, this layer
 * translates the chrome by exact match: only known interface strings are
 * swapped, prose and model output are left alone. English → Chinese uses the
 * same table reversed, so switching back restores the original wording.
 */
(function () {
  const STORAGE_KEY = "talk.lang.v1";
  const DEFAULT_LANG = "zh";

  const DICT = {
    "词典": "Dictionary",
    "翻译": "Translate",
    "设置": "Settings",
    "模型": "Model",
    "音频": "Audio",
    "数据": "Data",
    "完成": "Done",
    "返回": "Back",
    "关闭": "Close",
    "查一查": "Look up",
    "搜索": "Search",
    "清空": "Clear",
    "自动": "Auto",
    "单词": "Word",
    "意群": "Chunk",
    "句子": "Sentence",
    "近期": "Recent",
    "每天一个小仪式": "A small daily ritual",
    "今日一词": "Word of the day",
    "今日词条": "Today’s entry",
    "内置词条": "Built-in",
    "本机缓存": "Cached",
    "本次生成": "Generated",
    "核心义": "Core sense",
    "词义": "Senses",
    "同根词": "Family",
    "近义与反义": "Synonyms & antonyms",
    "例句": "Examples",
    "常见搭配": "Collocations",
    "搭配与知识点": "Usage notes",
    "发音": "Pronounce",
    "朗读": "Read aloud",
    "复制": "Copy",
    "收藏单词": "Bookmark word",
    "收藏意群": "Bookmark chunk",
    "收藏句子": "Bookmark sentence",
    "分享": "Share",
    "重新生成词条": "Regenerate entry",
    "重新生成分析": "Regenerate analysis",
    "重新生成意群": "Regenerate chunk",
    "换个说法": "Try another way",
    "重新生成": "Regenerate",
    "删除缓存": "Delete cache",
    "偏好与连接": "Preferences",
    "可用模型": "Models",
    "添加模型": "Add model",
    "获取模型": "Fetch models",
    "测试当前模型": "Test current model",
    "保存": "Save",
    "删除这个模型": "Delete this model",
    "名称": "Name",
    "协议": "Protocol",
    "外观主题": "Themes",
    "学习阶段": "Study level",
    "从句展开方式": "Clause expansion",
    "语境寻词长度": "Reply budget",
    "生成信息": "Generation info",
    "显示": "Show",
    "隐藏": "Hide",
    "例句风格": "Example voice",
    "恢复默认风格": "Reset example voice",
    "界面语言": "Language",
    "中文": "中文",
    "语境寻词": "Find the wording",
    "多风格翻译": "Multi-style translation",
    "翻译结果": "Results",
    "开始翻译": "Translate",
    "当它是": "Treat as",
    "新对话": "New chat",
    "只给结论": "Verdict only",
    "分块讲解": "Guided blocks",
    "成句拆解": "Full sentences",
    "缩进块": "Indented block",
    "句内插入": "Inline",
    "使用这套主题": "Use this theme",
    "当前正在使用": "In use",
    "使用中": "In use",
    "生成中": "Generating",
    "正在组织语言…": "Drafting…",
    "点画线的片段，看语气判断；↗ 进完整档案。": "Tap an underlined span for the judgement; ↗ opens the full entry.",
    "长按英文可加入下方输入框。": "Long-press English to add it below.",
    "输入英文句子，或继续追问语气、搭配…": "Type a sentence, or ask about tone and collocation…",
    "输入一个单词，或一整句话…": "Type a word, or a whole sentence…",
    "只影响句子模式": "Affects sentence mode only",
    "一本活的词典 · 交互原型 01": "A living dictionary · prototype 01",
    "把词，": "Take a word,",
    "看透。": "see through it.",
    "握紧。": "hold it.",
    "校准。": "calibrate it.",
    "拆开。": "take it apart.",
    "摊开。": "lay it out.",
    "归档。": "file it.",
    "最近": "Recent",
    "近线": "Front line",
    "近次记录": "Recent records",
    "最近检票": "Recent tickets",
    "最近调阅": "Recent files",
    "输入目标": "Target",
    "输入样本": "Sample",
    "检索": "Search",
    "查票": "Check a ticket",
    "输入一个词，或一句要夺回的话…": "A word, or a sentence worth reclaiming…",
    "输入一个词，或一句话…": "A word, or a sentence…",
    "输入词，或一整句话…": "A word, or a whole sentence…",
    "输入一个词，或一整句要查的话…": "A word, or a whole sentence to check…",
    "输入一个词，或一整段记录…": "A word, or a passage to file…",
    "词语就是武器": "Words are weapons",
    "观察 / 记录 / 理解": "Observe / record / understand",
    "现场记录": "Field record",
    "每一张票，都有去处": "Every ticket goes somewhere",
    "每一份记录，都可追溯": "Every record can be traced",
    "词": "Word",
    "句": "Sentence",
    "段": "Passage",
    "侦测": "Detect",
    "派生词": "Derivatives",
    "固定说法": "Set phrases",
    "点击继续查": "Tap to look up",
    "近义词": "Synonyms",
    "反义词": "Antonyms",
    "在设备内滚动": "Scroll inside the device",
    "点击高亮词，继续往里看": "Tap a highlighted word to go deeper",
    "常用": "Common",
    "场景": "Scene",
    "选一版": "Pick a version",
    "再印一版": "Print another",
    "本地版": "Local edition",
    "每日一条": "One a day",
    "每日一词": "Word of the day",
    "每日票根": "Ticket of the day",
    "今日样本": "Today’s sample",
    "词源": "Origin",
    "记忆钩子": "Memory hook",
    "文化背景": "Culture",
    "常见错误": "Common mistakes",
    "变体": "Variants",
    "用法": "Usage",
    "收藏": "Bookmark",
    "已收藏": "Saved",
    "更多": "More",
    "换一批": "Another batch",
    "重试": "Retry",
    "在线": "Online",
    "离线": "Offline",
    "生成失败": "Generation failed",
    "连接模型": "Connect a model",
    "极简口语": "Plain talk",
    "地道习语": "Idiomatic",
    "书面正式": "Formal writing",
    "网络流行": "Internet slang",
    "优雅文句": "Literary",
    "今日": "Today",
    "英语 · 在语境中理解": "ENGLISH · IN CONTEXT",
    "自动 · 单词": "Auto · Word",
    "自动 · 意群": "Auto · Chunk",
    "自动 · 句子": "Auto · Sentence",
    "只影响之后生成的例句": "Affects later examples only",
    "现代海报：米白纸面": "Modern poster: warm paper",
    "构成主义：粗斜切块与几何标语": "Constructivism: diagonal cuts and slogans",
    "安静的实验室：细线、刻度与观察记录": "Quiet lab: hairlines, scales, observation notes",
    "工业终端：纸白底、切角与唯一一种信号黄": "Industrial terminal: paper, cut corners, one signal yellow",
    "实验记录终端：纸白、细线窗口与唯一一种酸性绿": "Lab terminal: paper, hairline windows, one acid green",
    "票根拼贴：米纸、墨线、检票章与一条虚线路线": "Ticket collage: cream, ink rules, stamps, one dashed route"
  };

  const EN_TO_ZH = Object.fromEntries(Object.entries(DICT).map(([zh, en]) => [en, zh]));
  const SKIP = ".reverse-markdown, .sentence-stage, .translation-text, .example-zh, .word-gloss, .word-short, .meaning-card, .example-card, .hero-note, .insight, .summary-card, .word-title, .chunk-title, .model-raw";

  let lang = DEFAULT_LANG;
  let observer = null;
  let timer = 0;

  function table() {
    return lang === "en" ? DICT : EN_TO_ZH;
  }

  const PATTERNS = [
    [/^(\d+) 个义项$/, "$1 senses"],
    [/^(\d+) 条例句$/, "$1 examples"],
    [/^(\d+) 条$/, "$1 entries"],
    [/^(\d+) 个字?$/, "$1 chars"],
    [/^(\d+) 句$/, "$1 sentences"],
    [/^刚刚$/, "just now"],
    [/^(\d+) 分钟前$/, "$1 min ago"],
    [/^(\d+) 小时前$/, "$1 h ago"],
    [/^(\d+) 天前$/, "$1 d ago"],
    [/^(\d+) · 日常$/, "$1 · everyday"],
    [/^主题词展 · No\. (\d+) \/ (\d+)$/, "Theme salon · No. $1 / $2"]
  ];

  function swap(text) {
    const trimmed = text.trim();
    if (!trimmed) return text;
    const hit = table()[trimmed];
    if (hit) return text.replace(trimmed, hit);
    if (lang !== "en") return text;
    for (const [pattern, replacement] of PATTERNS) {
      const match = trimmed.match(pattern);
      if (match) return text.replace(trimmed, trimmed.replace(pattern, replacement));
    }
    return text;
  }

  function translateNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (!parent || parent.closest(SKIP)) return;
      node.nodeValue = swap(node.nodeValue);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.closest("script, style")) return;
    ["placeholder", "title", "aria-label"].forEach((name) => {
      const value = node.getAttribute(name);
      if (!value) return;
      const next = swap(value);
      if (next !== value) node.setAttribute(name, next);
    });
  }

  function walk(root) {
    if (!root || !root.childNodes) return;
    if (root.nodeType === Node.ELEMENT_NODE && root.closest(SKIP)) return;
    translateNode(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      translateNode(node);
      node = walker.nextNode();
    }
  }

  function apply(root = document.body) {
    if (!root) return;
    walk(root);
  }

  function observe() {
    if (observer) observer.disconnect();
    if (lang !== "en") return;
    observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => apply(document.body), 60);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "title", "aria-label"]
    });
  }

  function set(next) {
    lang = next === "en" ? "en" : "zh";
    document.documentElement.lang = lang === "en" ? "en" : "zh-Hans";
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) { /* no-op */ }
    apply(document.body);
    observe();
    return lang;
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh") lang = saved;
  } catch (_) { /* no-op */ }
  document.documentElement.lang = lang === "en" ? "en" : "zh-Hans";

  if (lang === "en") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => { apply(document.body); observe(); });
    } else {
      apply(document.body);
      observe();
    }
  }

  window.TALK_I18N = { get lang() { return lang; }, set, apply, DICT };
})();
