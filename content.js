/* talk. — interface copy and style metadata. Keep product copy here; prompts live in prompts.js. */
window.TALK_CONTENT = {
  modules: {
    dictionary: "词典",
    translator: "翻译"
  },
  settings: {
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
