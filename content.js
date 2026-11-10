/* talk. — interface copy and style metadata. Keep product copy here; prompts live in prompts.js. */
window.TALK_CONTENT = {
  modules: {
    dictionary: "词典",
    translator: "翻译"
  },
  home: {
    eyebrow: "英语 · 在语境中理解",
    titleLead: "把词，",
    titleAccent: "看透。",
    lede: "不只告诉你词义，更让你看见一个词<strong>怎么活</strong>。查一个单词，或读懂一整句话。",
    searchKicker: "查一查",
    searchPlaceholder: "输入一个单词，或一整句话…",
    recentLabel: "最近",
    modes: {
      auto: "自动",
      word: "单词",
      sentence: "句子"
    },
    dailySectionKicker: "每天一个小仪式",
    dailySectionTitle: "今日一词",
    moodSectionKicker: "跟着感觉走",
    moodSectionTitle: "按心情漫游",
    footerLeft: "为好奇的人而做",
    footerRight: "随时接入模型"
  },
  settings: {
    kicker: "偏好与连接",
    title: "设置",
    tabs: [
      ["model", "模型"],
      ["tts", "发音"],
      ["data", "数据"]
    ]
  },
  translator: {
    kicker: "多风格翻译 · 中文 / English",
    titleLead: "一句话，",
    titleAccent: "五种说法。",
    lede: "中文翻译成英文，或把英文换一种说法。原意不变，只换语气、场合和锋芒。",
    inputPlaceholder: "输入中文或英文…",
    empty: "输入中文或英文。保留原意，换成不同语气的英文。",
    samples: [
      ["今天有点累，但我还是想出去走走。", "中文示例"],
      ["I’m not upset. I’m just tired of explaining myself.", "English 示例"]
    ],
    modes: [
      ["auto", "自动"],
      ["zh", "中 → 英"],
      ["en", "英 → 英"]
    ],
    styles: [
      { id: "minimal", name: "极简口语", emoji: "icons/style/minimal.svg", tone: "yellow", hint: "短、直接，像日常对话" },
      { id: "idiom", name: "地道习语", emoji: "icons/style/idiom.svg", tone: "sage", hint: "像母语者会脱口而出的说法" },
      { id: "formal", name: "书面正式", emoji: "icons/style/formal.svg", tone: "sky", hint: "邮件、报告、正式场合" },
      { id: "slang", name: "网络流行", emoji: "icons/style/slang.svg", tone: "coral", hint: "社交媒体、轻松俚语" },
      { id: "elegant", name: "优雅文句", emoji: "icons/style/elegant.svg", tone: "lavender", hint: "有节奏和文学感" }
    ]
  }
};

/* Per-theme voice. Missing keys fall back to the base copy above. */
window.TALK_CONTENT.themeCopy = {
  constructivist: {
    modules: {
      dictionary: "词库",
      translator: "译场"
    },
    home: {
      eyebrow: "ЯЗЫК · 语言前线",
      titleLead: "把词，",
      titleAccent: "握紧。",
      lede: "语言不是装饰。它是武器，是旗帜，是把人聚在一起的声音。查一个词，<strong>夺回它的含义</strong>。",
      manifesto: {
        ru: "СЛОВО — ЭТО ОРУЖИЕ",
        zh: "词语就是武器"
      },
      searchKicker: "输入目标",
      searchPlaceholder: "输入一个词，或一句要夺回的话…",
      recentLabel: "近线",
      modes: {
        auto: "侦测",
        word: "词",
        sentence: "句"
      },
      dailySectionKicker: "每天一次点名",
      dailySectionTitle: "今日一词",
      moodSectionKicker: "按情绪编队",
      moodSectionTitle: "按心情漫游",
      footerLeft: "语言属于每一个人",
      footerRight: "把词握在手里"
    },
    translator: {
      kicker: "语言前线 · 中 / EN",
      titleLead: "一句，",
      titleAccent: "五种火力。",
      lede: "同一句话，五种语气。不是修饰，是选择站在哪个位置说话。",
      inputPlaceholder: "把你要说的话，放进来…",
      empty: "写下你的话。它会锻成五种说法。",
      workspaceKicker: "语言前线",
      workspaceTitle: "译场"
    },
    themeSalon: {
      kicker: "主题展 · 语言前线",
      brand: "СЛОВО",
      masthead: "ТЕМАТИЧЕСКИЙ ВЫПУСК",
      editionLabel: "主题词展",
      leadLabel: "ПЕРЕДОВАЯ",
      cta: "换一张",
      singleCta: "再印一版",
      pickerCta: "选一版",
      pickerKicker: "主题档案",
      pickerTitle: "从主题库里挑一版",
      printing: "正在印",
      cacheUnit: "版在展览",
      libraryLabel: "库中",
      libraryUnit: "版",
      noCache: "常设版",
      loading: "正在排版…",
      local: "常设展",
      sceneLabel: "现场",
      footerRight: "点击词语，继续读"
    },
    settings: {
      kicker: "指挥台",
      title: "指挥台",
      tabs: [
        ["model", "配置"],
        ["tts", "声音"],
        ["data", "档案"]
      ]
    }
  }
};

/* Curated fallback decks for the theme salon. The model can generate more. */
window.TALK_CONTENT.themeSalon = {
  kicker: "主题策展",
  brand: "TALK",
  masthead: "THEME SALON",
  editionLabel: "主题词展",
  leadLabel: "LEAD",
  cta: "换一张海报",
  singleCta: "再印一版",
  pickerCta: "选一版",
  pickerKicker: "主题档案",
  pickerTitle: "从主题库里挑一版",
  printing: "正在印",
  cacheUnit: "版在展览",
  libraryLabel: "库中",
  libraryUnit: "版",
  noCache: "本地版",
  loading: "正在布展…",
  local: "本地主题",
  sceneLabel: "场景",
  footerRight: "点击词，继续展开"
};

window.TALK_CONTENT.themeDecks = [
  {
    id: "midnight-observatory",
    title: "雨夜的天文台",
    subtitle: "云层很低，望远镜仍然睁着眼。",
    scene: "山顶只剩雨声、齿轮和一小圈暖光。有人守着穹顶，等一颗不该出现的星。",
    words: [
      { word: "observatory", pos: "noun", gloss: "天文台；观测站", why: "整座建筑和它的职责，都在这一个词里。" },
      { word: "nebula", pos: "noun", gloss: "星云", why: "不是星星，是星星诞生与消散的雾。" },
      { word: "luminous", pos: "adj.", gloss: "发光的；明亮的", why: "比 bright 更安静，像光从内部透出来。" },
      { word: "solitude", pos: "noun", gloss: "独处；孤寂", why: "不是 loneliness，它更像主动留下的空间。" },
      { word: "orbit", pos: "verb / noun", gloss: "环绕；轨道", why: "雨夜里的等待也有自己的轨道。" }
    ]
  },
  {
    id: "last-letter-bookshop",
    title: "旧书店的最后一封信",
    subtitle: "纸页发黄，句子还热。",
    scene: "书店要关门了。柜台下压着一封没有寄出的信，收信人只在页边留下过一个铅笔问号。",
    words: [
      { word: "ephemeral", pos: "adj.", gloss: "短暂的；转瞬即逝的", why: "纸会旧，句子却想多活一会儿。" },
      { word: "marginalia", pos: "noun", gloss: "页边批注", why: "读书人留在空白处的第二本书。" },
      { word: "inkling", pos: "noun", gloss: "隐约的念头；暗示", why: "还没有说出口，但已经开始发光。" },
      { word: "brittle", pos: "adj.", gloss: "脆的；易碎的", why: "形容纸，也形容一句撑太久的话。" },
      { word: "postscript", pos: "noun", gloss: "附言；后记", why: "信写完了，真正想说的才刚开始。" }
    ]
  },
  {
    id: "steam-train-wasteland",
    title: "蒸汽列车穿过荒原",
    subtitle: "铁轨把地平线缝起来。",
    scene: "车窗上全是煤灰，远处没有站台。列车不停，荒原也不肯结束，只有汽笛替所有人报时。",
    words: [
      { word: "locomotive", pos: "noun", gloss: "机车；火车头", why: "工业时代最有力量感的名词之一。" },
      { word: "soot", pos: "noun", gloss: "煤烟；烟灰", why: "落在衣领上，也落在整段旅程里。" },
      { word: "horizon", pos: "noun", gloss: "地平线；视野", why: "看得见却到不了的边界。" },
      { word: "transient", pos: "adj.", gloss: "短暂的；路过的", why: "车窗外的风景和乘客都算。" },
      { word: "whistle", pos: "noun / verb", gloss: "汽笛；呼啸", why: "一声就把空旷填满。" }
    ]
  }
];

/* Rhine Lab voice: technical, quiet, observational. */
window.TALK_CONTENT.themeCopy.rhine = {
  modules: {
    dictionary: "索引",
    translator: "转译"
  },
  home: {
    eyebrow: "RHINE LAB · 语言观察站",
    titleLead: "把词，",
    titleAccent: "校准。",
    lede: "语言是信息。拆开它的结构，记录它的温度，再把它放回<strong>真实语境</strong>里。",
    manifesto: {
      ru: "OBSERVE / RECORD / UNDERSTAND",
      zh: "观察 / 记录 / 理解"
    },
    searchKicker: "输入样本",
    searchPlaceholder: "输入一个词，或一句话…",
    recentLabel: "近次记录",
    modes: {
      auto: "自动",
      word: "词",
      sentence: "句"
    },
    dailySectionKicker: "每日样本",
    dailySectionTitle: "今日记录",
    moodSectionKicker: "主题档案",
    moodSectionTitle: "主题索引",
    footerLeft: "为观察语言的人而做",
    footerRight: "记录每一次理解"
  },
  translator: {
    kicker: "RHINE LAB · 语言转译站",
    titleLead: "一句，",
    titleAccent: "多种输出。",
    lede: "保留原意，只改变语气、场合与力度。让同一句话在不同语境里成立。",
    inputPlaceholder: "把要转译的句子放进来…",
    empty: "写下样本。系统会给出几种可用的英文输出。",
    workspaceKicker: "RHINE LAB / OUTPUT",
    workspaceTitle: "转译结果"
  },
  themeSalon: {
    kicker: "主题档案 · 语言观察",
    brand: "RHINE",
    masthead: "LANGUAGE INDEX",
    editionLabel: "主题索引",
    leadLabel: "SAMPLE",
    cta: "换一张",
    singleCta: "再采样一版",
    pickerCta: "档案",
    pickerKicker: "语言档案",
    pickerTitle: "从主题索引里挑一版",
    printing: "正在采样",
    cacheUnit: "版在索引",
    libraryLabel: "档案",
    libraryUnit: "版",
    noCache: "本地样本",
    loading: "正在采样…",
    local: "常设样本",
    sceneLabel: "记录",
    footerRight: "点击词语，继续分析"
  },
  settings: {
    kicker: "RHINE LAB / TERMINAL",
    title: "控制台",
    tabs: [
      ["model", "接口"],
      ["tts", "声音"],
      ["data", "数据"]
    ]
  }
};

/* Endfield voice: an industrial field terminal. Labelled, numbered, terse. */
window.TALK_CONTENT.themeCopy.endfield = {
  modules: {
    dictionary: "词条",
    translator: "转译"
  },
  home: {
    eyebrow: "FIELD TERMINAL · 语言终端",
    titleLead: "把词，",
    titleAccent: "拆开。",
    lede: "每个词都是一份现场记录。查一个词，读它的结构、它的来路、它在别处的用法。",
    manifesto: {
      ru: "FIELD RECORD",
      zh: "现场记录"
    },
    searchKicker: "检索",
    searchPlaceholder: "输入词，或一整句话…",
    recentLabel: "近期",
    modes: {
      auto: "自动",
      word: "词",
      sentence: "句"
    },
    dailySectionKicker: "每日一条",
    dailySectionTitle: "今日记录",
    moodSectionKicker: "按主题归档",
    moodSectionTitle: "主题巡览",
    footerLeft: "语言是工具，也是现场",
    footerRight: "逐条记录，逐条拆解"
  },
  translator: {
    kicker: "转译台 · 中 / EN",
    titleLead: "一句，",
    titleAccent: "五种语气。",
    lede: "同一句话，五种说法。语气不是修饰，是选择站在哪个位置说话。",
    inputPlaceholder: "把要转译的句子放进来…",
    empty: "写下你的句子。它会转译成五种说法。",
    workspaceKicker: "转译台",
    workspaceTitle: "转译"
  },
  themeSalon: {
    kicker: "主题档案 · 现场记录",
    brand: "TERMINAL",
    masthead: "THEME ARCHIVE",
    editionLabel: "主题档案",
    leadLabel: "LEAD",
    cta: "换一份",
    singleCta: "再记一版",
    pickerCta: "调档",
    pickerKicker: "主题档案库",
    pickerTitle: "从档案库里调一版",
    printing: "正在归档",
    cacheUnit: "份在档",
    libraryLabel: "库存",
    libraryUnit: "份",
    noCache: "本地档案",
    loading: "正在归档…",
    local: "常设档案",
    sceneLabel: "现场",
    footerRight: "点一条记录，继续展开"
  },
  settings: {
    kicker: "TERMINAL / CONFIG",
    title: "控制台",
    tabs: [
      ["model", "接口"],
      ["tts", "音频"],
      ["data", "存档"]
    ]
  }
};

window.TALK_CONTENT.themeCopy.bitterworld = {
  modules: {
    dictionary: "词册",
    translator: "译站"
  },
  home: {
    eyebrow: "BITTERWORLD · 未许之地",
    titleLead: "把词，",
    titleAccent: "摊开。",
    lede: "每个词都是一张票根：从哪来、经过谁、能换到什么。查一个词，就是读完这张票。",
    manifesto: {
      ru: "BITTERWORLD BITTER 44",
      zh: "每一张票，都有去处"
    },
    searchKicker: "查票",
    searchPlaceholder: "输入一个词，或一整句要查的话…",
    recentLabel: "最近检票",
    modes: {
      auto: "自动",
      word: "词",
      sentence: "句"
    },
    dailySectionKicker: "每日一张",
    dailySectionTitle: "今日票根",
    moodSectionKicker: "按主题装订",
    moodSectionTitle: "票册巡览",
    footerLeft: "语言是一张票，不是一堵墙",
    footerRight: "逐张检票，逐页归档"
  },
  translator: {
    kicker: "译站 · 中 / EN",
    titleLead: "一句，",
    titleAccent: "五种口吻。",
    lede: "同一句话，五种说法。语气不是装饰，是你选择站在哪个检票口说话。",
    inputPlaceholder: "把要换一种说法的句子放进来…",
    empty: "写下你的句子。它会换到五种口吻。",
    workspaceKicker: "译站",
    workspaceTitle: "译站"
  },
  themeSalon: {
    kicker: "主题档案 · 票册",
    brand: "BITTERWORLD",
    masthead: "TICKET ARCHIVE",
    editionLabel: "票册",
    leadLabel: "LEAD",
    cta: "换一张",
    singleCta: "再印一版",
    pickerCta: "翻册",
    pickerKicker: "票册库",
    pickerTitle: "从票册里挑一张",
    printing: "正在印刷",
    cacheUnit: "张在册",
    libraryLabel: "库存",
    libraryUnit: "张",
    noCache: "本地票根",
    loading: "正在印刷…",
    local: "常设票册",
    sceneLabel: "现场",
    footerRight: "点一张票根，继续读下去"
  },
  settings: {
    kicker: "BITTERWORLD / DESK",
    title: "登记处",
    tabs: [
      ["model", "接口"],
      ["tts", "音频"],
      ["data", "票册"]
    ]
  }
};
