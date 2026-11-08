/* ============================================================
   talk. — offline demo corpus
   Curated, hand-written entries for the interactive prototype.
   ============================================================ */

window.TALK_DATA = (() => {
  const words = {
    serendipity: {
      word: "serendipity",
      phonetic: "/ˌser.ənˈdɪp.ə.ti/",
      pos: "noun",
      level: "C2",
      register: "literary",
      short: "The happy accident of finding something you weren’t looking for.",
      translation: "意外发现美好事物的运气；机缘巧合",
      note: "1754 年，霍勒斯·沃波尔借斯里兰卡的旧称创造了这个词，专指“意外撞见的美好”。",
      senses: [
        {
          en: "The occurrence of events by chance in a happy or beneficial way.",
          zh: "偶然发生并带来美好结果的事；机缘巧合。",
          tag: "most common"
        },
        {
          en: "The faculty of making fortunate discoveries by accident.",
          zh: "善于在偶然中发现珍贵事物的能力。",
          tag: "formal"
        }
      ],
      family: [
        { word: "serendipitous", pos: "adj.", gloss: "happening by happy chance" },
        { word: "serendipitously", pos: "adv.", gloss: "in a fortunate, accidental way" },
        { word: "serendipitist", pos: "n.", gloss: "a person who finds lucky accidents" }
      ],
      synonyms: [
        { word: "chance", gloss: "the unexpected" },
        { word: "fortune", gloss: "good luck" },
        { word: "fluke", gloss: "a lucky accident" },
        { word: "happy accident", gloss: "幸运的意外" }
      ],
      antonyms: [
        { word: "misfortune", gloss: "bad luck" },
        { word: "design", gloss: "deliberate planning" },
        { word: "inevitability", gloss: "what must happen" }
      ],
      examples: [
        {
          en: "A fortunate stroke of serendipity brought the two old friends together.",
          zh: "一次幸运的巧合让两位老朋友重逢。",
          source: "Talk 示例 · 日常"
        },
        {
          en: "Many scientific breakthroughs are born of serendipity rather than planning.",
          zh: "许多科学突破源于机缘巧合，而非周密计划。",
          source: "Talk 示例 · 科学"
        }
      ],
      collocations: ["pure serendipity", "a moment of serendipity", "by serendipity", "a stroke of serendipity"],
      memory: "想想童话《<em>塞伦迪普三王子</em>》：主人公一路都在发现他们从未出发去寻找的宝藏。",
      related: ["ephemeral", "luminous", "nuance"],
      origin: {
        root: "Serendip（斯里兰卡旧称）+ -ity",
        original: "最初指“善于在偶然中发现珍宝的能力”，而不是“好运”本身。",
        story: "1754 年，Horace Walpole 在信中造了这个词，灵感来自童话《塞伦迪普三王子》：主人公总在无意间找到宝物。",
        stages: [
          { when: "1754", label: "被造出来", text: "Walpole 用它形容一种“意外发现美好事物”的能力。" },
          { when: "19 世纪", label: "进入文学", text: "从书信里的雅词，变成小说与随笔中描写巧合的词。" },
          { when: "今天", label: "日常化", text: "科学、设计与恋爱里都能用，常指“计划之外的好结果”。" }
        ]
      }
    },

    serendipitous: {
      word: "serendipitous",
      phonetic: "/ˌser.ənˈdɪp.ɪ.təs/",
      pos: "adjective",
      level: "C2",
      register: "literary",
      short: "Happening by chance in a happy or beneficial way.",
      translation: "偶然的，却带来好运的",
      note: "serendipity 的形容词形式，几乎总带着“好运”的暖色。",
      senses: [
        {
          en: "Occurring or discovered by chance in a happy or beneficial way.",
          zh: "因偶然发生或被发现，并带来好结果的。",
          tag: "core"
        }
      ],
      family: [
        { word: "serendipity", pos: "n.", gloss: "a happy accident" },
        { word: "serendipitously", pos: "adv.", gloss: "by fortunate chance" }
      ],
      synonyms: [
        { word: "fortunate", gloss: "bringing good luck" },
        { word: "lucky", gloss: "chance-driven and good" },
        { word: "unplanned", gloss: "not designed" }
      ],
      antonyms: [
        { word: "unfortunate", gloss: "bringing bad luck" },
        { word: "planned", gloss: "deliberately arranged" }
      ],
      examples: [
        {
          en: "Their serendipitous meeting at the airport turned into a lifelong friendship.",
          zh: "他们在机场的偶遇，后来变成了一生的友谊。",
          source: "Talk 示例 · 日常"
        }
      ],
      collocations: ["a serendipitous discovery", "a serendipitous encounter", "purely serendipitous"],
      memory: "如果一个巧合是带着礼物蝴蝶结来的，那它就是 <em>serendipitous</em>。",
      related: ["serendipity", "fortune", "ephemeral"],
      origin: {
        root: "serendipity + -ous",
        original: "19 世纪从名词逆构出的形容词，起初只用于文学语境。",
        story: "人们把 serendipity 的结尾换成 -ous，造出“具有意外之喜性质的”这一形容词；它比名词更常修饰 encounter、discovery。",
        stages: [
          { when: "19 世纪", label: "逆构", text: "从 serendipity 去掉 -ity，加上 -ous，形成形容词。" },
          { when: "20 世纪", label: "固定搭配", text: "serendipitous encounter / discovery 成为常见组合。" },
          { when: "今天", label: "更轻的用法", text: "可以形容任何“巧合得刚刚好”的好事。" }
        ]
      }
    },

    ephemeral: {
      word: "ephemeral",
      phonetic: "/ɪˈfem.ər.əl/",
      pos: "adjective",
      level: "C2",
      register: "literary",
      short: "Lasting for a very short time — like a mayfly, a sunset, or a trend.",
      translation: "短暂的；转瞬即逝的",
      note: "常用来写美、情绪、潮流，以及那些阅后即焚的数字内容。",
      senses: [
        {
          en: "Lasting for a very short time.",
          zh: "持续时间极短的；转瞬即逝的。",
          tag: "core"
        },
        {
          en: "Existing or enjoyed for only a fleeting moment.",
          zh: "只在一瞬间存在或被享受的。",
          tag: "literary"
        }
      ],
      family: [
        { word: "ephemera", pos: "n.", gloss: "things that last a short time" },
        { word: "ephemerally", pos: "adv.", gloss: "in a fleeting way" },
        { word: "ephemerality", pos: "n.", gloss: "the quality of being brief" }
      ],
      synonyms: [
        { word: "fleeting", gloss: "passing quickly" },
        { word: "transient", gloss: "not lasting long" },
        { word: "momentary", gloss: "lasting a moment" },
        { word: "short-lived", gloss: "天生短暂" }
      ],
      antonyms: [
        { word: "eternal", gloss: "without end" },
        { word: "enduring", gloss: "lasting a long time" },
        { word: "permanent", gloss: "not temporary" }
      ],
      examples: [
        {
          en: "Fame can be ephemeral, but a good question can last a lifetime.",
          zh: "名声可能转瞬即逝，但一个好问题可以伴随一生。",
          source: "Talk 示例 · 文化"
        },
        {
          en: "The ephemeral beauty of cherry blossoms is part of what makes them precious.",
          zh: "樱花转瞬即逝的美，正是它珍贵的原因之一。",
          source: "Talk 示例 · 自然"
        }
      ],
      collocations: ["ephemeral beauty", "an ephemeral trend", "ephemeral nature", "ephemeral pleasure"],
      memory: "来自希腊语 <em>ephēmeros</em>：“只持续一天”——<em>epi</em>（在……之上）+ <em>hēmera</em>（一天）。",
      related: ["serendipity", "luminous", "solace"],
      origin: {
        root: "希腊语 epi（在……上）+ hēmera（一天）",
        original: "最初形容“只活一天”的昆虫或发热，后来才用于一切短暂之物。",
        story: "希腊语 ephēmeros 经拉丁语进入英语，原本是医学与博物学里的精确描述：一天之内开始，也在一天之内结束。",
        stages: [
          { when: "古希腊", label: "一天的尺度", text: "ephēmeros 用来描述只持续一日的生命与症状。" },
          { when: "16 世纪", label: "进入英语", text: "保留“短暂”的核心义，常见于医学与诗歌。" },
          { when: "今天", label: "数字时代", text: "也用来形容快闪内容、潮流与转瞬即逝的情绪。" }
        ]
      }
    },

    resilient: {
      word: "resilient",
      phonetic: "/rɪˈzɪl.i.ənt/",
      pos: "adjective",
      level: "B2",
      register: "common",
      short: "Able to recover quickly from difficulty; springy enough to bend without breaking.",
      translation: "有韧性的；能迅速恢复的",
      note: "可以写人、社区、材料或系统——那些被压弯后还能弹回来的对象。",
      senses: [
        {
          en: "Able to withstand or recover quickly from difficult conditions.",
          zh: "能够承受困境并迅速恢复的；有韧性的。",
          tag: "core"
        },
        {
          en: "Able to spring back into shape after bending or being compressed.",
          zh: "（材料）受弯或受压后能回弹的。",
          tag: "technical"
        }
      ],
      family: [
        { word: "resilience", pos: "n.", gloss: "the capacity to recover" },
        { word: "resiliently", pos: "adv.", gloss: "in a resilient way" },
        { word: "resiliency", pos: "n.", gloss: "resilience (esp. AmE)" }
      ],
      synonyms: [
        { word: "tough", gloss: "hard to break" },
        { word: "adaptable", gloss: "able to adjust" },
        { word: "buoyant", gloss: "quick to rise again" },
        { word: "hardy", gloss: "耐折腾的" }
      ],
      antonyms: [
        { word: "fragile", gloss: "easily broken" },
        { word: "brittle", gloss: "snaps under pressure" },
        { word: "vulnerable", gloss: "easily harmed" }
      ],
      examples: [
        {
          en: "Children are often more resilient than adults expect them to be.",
          zh: "孩子往往比大人以为的更有韧性。",
          source: "Talk 示例 · 心理"
        },
        {
          en: "The city built a resilient network that could survive a power failure.",
          zh: "这座城市建立了一个能在停电时继续运转的韧性网络。",
          source: "Talk 示例 · 设计"
        }
      ],
      collocations: ["emotionally resilient", "a resilient community", "resilient infrastructure", "build resilience"],
      memory: "想象一根竹子：暴风雨里几乎被压平，风停后又弹回来，没有裂开。",
      related: ["curious", "nuance", "thrive"],
      origin: {
        root: "拉丁语 re-（回）+ salire（跳）",
        original: "最初是物理意义：被压弯后弹回原状。",
        story: "resilire 的字面意思是“跳回来”。19 世纪先用于材料与工程，20 世纪心理学借用它，形容人从逆境中恢复。",
        stages: [
          { when: "拉丁语", label: "弹回来", text: "resilire 描述物体受压后回弹的动作。" },
          { when: "19 世纪", label: "材料与工程", text: "开始形容木材、金属等材料的回弹性。" },
          { when: "20 世纪", label: "心理韧性", text: "心理学把它扩展为“从困难中恢复的能力”。" }
        ]
      }
    },

    curious: {
      word: "curious",
      phonetic: "/ˈkjʊə.ri.əs/",
      pos: "adjective",
      level: "A2",
      register: "common",
      short: "Eager to know or learn something; strange enough to make you look twice.",
      translation: "好奇的；求知欲强的；奇怪的",
      note: "一个高频又温暖的词。它的第二义“奇怪”常被学习者忽略，却很好用。",
      senses: [
        {
          en: "Eager to know or learn something.",
          zh: "好奇的；渴望知道的。",
          tag: "core"
        },
        {
          en: "Strange or unusual in a way that makes you want to know more.",
          zh: "奇怪的；不寻常而引人探究的。",
          tag: "second sense"
        }
      ],
      family: [
        { word: "curiosity", pos: "n.", gloss: "the desire to know" },
        { word: "curiously", pos: "adv.", gloss: "in a curious way" },
        { word: "curiousness", pos: "n.", gloss: "the quality of being curious" }
      ],
      synonyms: [
        { word: "inquisitive", gloss: "asking many questions" },
        { word: "intrigued", gloss: "captured by interest" },
        { word: "questioning", gloss: "seeking answers" }
      ],
      antonyms: [
        { word: "indifferent", gloss: "not interested" },
        { word: "incurious", gloss: "without curiosity" },
        { word: "apathetic", gloss: "emotionally flat" }
      ],
      examples: [
        {
          en: "Stay curious long enough and almost any subject becomes interesting.",
          zh: "只要保持足够久的好奇心，几乎任何主题都会变得有趣。",
          source: "Talk 示例 · 学习"
        },
        {
          en: "There was something curious about the way she avoided the question.",
          zh: "她回避那个问题的方式有些奇怪。",
          source: "Talk 示例 · 小说"
        }
      ],
      collocations: ["curious about", "curious mind", "just curious", "a curious thing"],
      memory: "curious 和 <em>cure</em> 同源于拉丁语 <em>cura</em>（关心）。好奇，就是在意到愿意多问一句。",
      related: ["wander", "resilient", "nuance"],
      origin: {
        root: "拉丁语 cura（关心）+ -osus",
        original: "最初是“仔细、用心”，后来才变成“想知道”，再引申为“奇怪”。",
        story: "curiosus 先指“认真照料”，因为在意，所以想弄明白；17 世纪起，curious 也可以形容“值得探究的怪”。",
        stages: [
          { when: "拉丁语", label: "用心", text: "curiosus 的核心是“care”：在意，所以仔细。" },
          { when: "17 世纪", label: "转向求知", text: "“想弄明白”成为主要义，同时保留“奇怪”的旁支。" },
          { when: "今天", label: "两种 curious", text: "既可以夸人好奇，也可以说一件事“透着古怪”。" }
        ]
      }
    },

    luminous: {
      word: "luminous",
      phonetic: "/ˈluː.mɪ.nəs/",
      pos: "adjective",
      level: "C1",
      register: "literary",
      short: "Giving off light; bright enough to make everything around it feel clearer.",
      translation: "发光的；明亮的；富于感染力的",
      note: "既能写真实的光，也能写一个人、一个想法或一段文字“自带光感”。",
      senses: [
        {
          en: "Giving off light; shining brightly.",
          zh: "发光的；明亮的。",
          tag: "literal"
        },
        {
          en: "Inspiring and clear; seeming to glow with intelligence or warmth.",
          zh: "富有感染力的；闪烁着智慧或温暖的。",
          tag: "figurative"
        }
      ],
      family: [
        { word: "luminosity", pos: "n.", gloss: "the quality of giving light" },
        { word: "luminously", pos: "adv.", gloss: "in a glowing way" },
        { word: "luminary", pos: "n.", gloss: "a person who inspires others" }
      ],
      synonyms: [
        { word: "radiant", gloss: "sending out light" },
        { word: "glowing", gloss: "softly bright" },
        { word: "incandescent", gloss: "glowing with heat" }
      ],
      antonyms: [
        { word: "dim", gloss: "poorly lit" },
        { word: "dull", gloss: "without brightness" },
        { word: "shadowy", gloss: "full of shadow" }
      ],
      examples: [
        {
          en: "The room felt luminous, as if the afternoon had decided to stay.",
          zh: "房间明亮得仿佛午后决定留下来不走了。",
          source: "Talk 示例 · 氛围"
        },
        {
          en: "Her essay is a luminous account of what it means to begin again.",
          zh: "她的文章对“重新开始”作了一种熠熠生辉的诠释。",
          source: "Talk 示例 · 评论"
        }
      ],
      collocations: ["luminous glow", "luminous prose", "a luminous presence", "luminous sky"],
      memory: "<em>Lumen</em> 在拉丁语里是“光”。流明（lumen）也是衡量可见光的单位。",
      related: ["serendipity", "ephemeral", "solace"],
      origin: {
        root: "拉丁语 lumen（光）+ -ous",
        original: "字面就是“发光的”，19 世纪起大量用于比喻。",
        story: "从描述灯、星体与颜料，扩展到形容文字、眼神或想法“自带光感”。",
        stages: [
          { when: "拉丁语", label: "光", text: "lumen 是光，也是衡量可见光的单位名。" },
          { when: "17 世纪", label: "进入英语", text: "先用于物理上的发光体与明亮颜色。" },
          { when: "19 世纪", label: "比喻扩展", text: "开始形容文字、人物与思想“明亮而有感染力”。" }
        ]
      }
    },

    wander: {
      word: "wander",
      phonetic: "/ˈwɒn.dər/",
      pos: "verb",
      level: "A2",
      register: "common",
      short: "To move without a fixed destination; to let your attention drift.",
      translation: "漫步；闲逛；（思绪）走神",
      note: "别把 <em>wander</em>（漫游）和 <em>wonder</em>（想知道）弄混，只差一个字母。",
      senses: [
        {
          en: "To walk or move in a leisurely, casual, or aimless way.",
          zh: "漫步；闲逛；漫无目的地走动。",
          tag: "movement"
        },
        {
          en: "To allow your thoughts or attention to drift away.",
          zh: "（思绪）走神；游离。",
          tag: "mind"
        }
      ],
      family: [
        { word: "wanderer", pos: "n.", gloss: "a person who roams" },
        { word: "wandering", pos: "adj./n.", gloss: "roaming; a journey" },
        { word: "wanderlust", pos: "n.", gloss: "the urge to travel" }
      ],
      synonyms: [
        { word: "roam", gloss: "move freely" },
        { word: "drift", gloss: "be carried along" },
        { word: "meander", gloss: "follow a winding path" },
        { word: "ramble", gloss: "walk without a plan" }
      ],
      antonyms: [
        { word: "settle", gloss: "stay in one place" },
        { word: "stay", gloss: "remain" },
        { word: "beeline", gloss: "go straight to" }
      ],
      examples: [
        {
          en: "Let’s wander through the old town and see where we end up.",
          zh: "我们在老城里随便走走吧，看看最后会走到哪里。",
          source: "Talk 示例 · 旅行"
        },
        {
          en: "My mind began to wander during the third meeting of the day.",
          zh: "开今天第三场会的时候，我开始走神了。",
          source: "Talk 示例 · 工作"
        }
      ],
      collocations: ["wander around", "wander off", "let your mind wander", "a wandering eye"],
      memory: "<em>Wander</em> 和 <em>wonder</em> 只差一个字母：一个是用脚走，一个是用心问。两者都是旅行的好同伴。",
      related: ["curious", "ephemeral", "nuance"],
      origin: {
        root: "古英语 wandrian，与 windan（缠绕、转动）同源",
        original: "最初只指“没有固定路线地走”，后来才用于思绪。",
        story: "脚步先走，心才跟着飘。wander 的“走神”义是 20 世纪才常见的延伸。",
        stages: [
          { when: "古英语", label: "走动", text: "wandrian 描述没有固定方向的移动。" },
          { when: "中世纪", label: "漫游成词", text: "wanderer、wandering 逐渐固定下来。" },
          { when: "20 世纪", label: "思绪漂移", text: "let your mind wander 成为常见说法。" }
        ]
      }
    },

    nuance: {
      word: "nuance",
      phonetic: "/ˈnjuː.ɑːns/",
      pos: "noun",
      level: "C1",
      register: "common",
      short: "A very small difference in meaning, feeling, or appearance — the thing that makes language precise.",
      translation: "细微差别；微妙之处",
      note: "借自法语。常用复数：语气的细微差别、译文的微妙之处、关系里的那些小分寸。",
      senses: [
        {
          en: "A subtle difference in or shade of meaning, expression, or sound.",
          zh: "（意义、表达或声音上的）细微差别。",
          tag: "core"
        },
        {
          en: "Sensitivity to subtle differences; delicacy of expression.",
          zh: "对细微差别的敏感；表达上的细腻。",
          tag: "uncountable"
        }
      ],
      family: [
        { word: "nuanced", pos: "adj.", gloss: "showing subtle differences" },
        { word: "nuance", pos: "v.", gloss: "to give subtle differences to" },
        { word: "nuanceless", pos: "adj.", gloss: "lacking subtlety" }
      ],
      synonyms: [
        { word: "subtlety", gloss: "a fine distinction" },
        { word: "shade", gloss: "a variation of meaning" },
        { word: "gradation", gloss: "a small step in degree" }
      ],
      antonyms: [
        { word: "bluntness", gloss: "plain, unsubtle speech" },
        { word: "generalisation", gloss: "a broad claim" },
        { word: "binary", gloss: "非此即彼" }
      ],
      examples: [
        {
          en: "The translation is accurate, but it loses the nuance of the original.",
          zh: "这篇译文准确，却失去了原文的微妙之处。",
          source: "Talk 示例 · 语言"
        },
        {
          en: "A good editor notices the nuance between “I can” and “I will.”",
          zh: "好编辑能察觉“我能”与“我会”之间的微妙差别。",
          source: "Talk 示例 · 写作"
        }
      ],
      collocations: ["a subtle nuance", "lose the nuance", "nuance of meaning", "a nuanced view"],
      memory: "想想油漆色卡：相邻两格之间那一点点差别，就是 nuance。",
      related: ["curious", "resilient", "serendipity"],
      origin: {
        root: "法语 nuer（给……加阴影）← nue（云）",
        original: "最初是绘画里的“色阶、阴影”，18 世纪进入英语。",
        story: "从颜色的一点点深浅，转用来描述语气、含义与关系里“差之毫厘”的地方。",
        stages: [
          { when: "法语", label: "云的阴影", text: "nue 是云，nuer 是给画面加上细微的阴影。" },
          { when: "18 世纪", label: "进入英语", text: "nuance 先指色彩的层次与过渡。" },
          { when: "19 世纪", label: "转向语义", text: "开始形容措辞、情绪与关系中的细微差别。" }
        ]
      }
    },

    solace: {
      word: "solace",
      phonetic: "/ˈsɒl.əs/",
      pos: "noun",
      level: "C1",
      register: "literary",
      short: "Comfort in a time of sadness or trouble; something that makes the ache a little lighter.",
      translation: "慰藉；安慰",
      note: "比 <em>comfort</em> 更书面、更向内。常和 <em>find</em>、<em>seek</em>、<em>take</em> 搭配。",
      senses: [
        {
          en: "Comfort or consolation in a time of distress or sadness.",
          zh: "悲伤或困境中的安慰；慰藉。",
          tag: "core"
        },
        {
          en: "A source of comfort in a difficult situation.",
          zh: "困境中给人安慰的人或事物。",
          tag: "countable"
        }
      ],
      family: [
        { word: "solace", pos: "v.", gloss: "to comfort someone" },
        { word: "solacing", pos: "adj.", gloss: "comforting" },
        { word: "solaced", pos: "adj.", gloss: "comforted" }
      ],
      synonyms: [
        { word: "comfort", gloss: "ease from pain" },
        { word: "consolation", gloss: "comfort after loss" },
        { word: "relief", gloss: "easing of distress" }
      ],
      antonyms: [
        { word: "distress", gloss: "great suffering" },
        { word: "torment", gloss: "severe pain" },
        { word: "anguish", gloss: "deep emotional pain" }
      ],
      examples: [
        {
          en: "She found solace in the rhythm of the sea.",
          zh: "她在海浪的节奏中找到了慰藉。",
          source: "Talk 示例 · 小说"
        },
        {
          en: "For many, gardening is a quiet solace after a loud day.",
          zh: "对许多人来说，园艺是喧闹一天之后的安静慰藉。",
          source: "Talk 示例 · 生活"
        }
      ],
      collocations: ["find solace", "seek solace", "take solace in", "a source of solace"],
      memory: "来自拉丁语 <em>solacium</em>，与 <em>solari</em>（安慰）同源。这个词本身就像一只手轻轻落在肩上。",
      related: ["ephemeral", "luminous", "resilient"],
      origin: {
        root: "拉丁语 solacium（安慰）← solari（安慰）",
        original: "最初指“减轻悲伤的东西”，比 comfort 更向内。",
        story: "经古法语 solas 进入英语，长期停留在文学与宗教语境；今天仍常与 find / seek / take 连用。",
        stages: [
          { when: "拉丁语", label: "安慰", text: "solari 是“安慰”，solacium 是安慰之物。" },
          { when: "古法语", label: "solas", text: "进入英语后写成 solace，保留“慰藉”的核心。" },
          { when: "今天", label: "文学语域", text: "常见于 find solace in / seek solace，语气比 comfort 更静。" }
        ]
      }
    }
  };

  const sentences = [
    {
      id: "science-serendipity",
      text: "The scientist’s serendipitous discovery changed the course of medicine.",
      translation: "这位科学家的偶然发现改变了医学的发展进程。",
      tone: "克制 · 略带戏剧性",
      structure: "主语 + 所有格 + 形容词 + 名词 + 动词 + 宾语，一个干净的主谓宾长句。",
      source: "Talk 示例语料 · 科学",
      keyWords: [
        {
          word: "serendipitous",
          surface: "serendipitous",
          phonetic: "/ˌser.ənˈdɪp.ɪ.təs/",
          pos: "adjective",
          meaning: "happening by chance in a happy or useful way",
          meaningZh: "偶然发生，却带来好结果的",
          why: "它是整句话的枢纽：这个发现并非计划之中，所以结果更像一份礼物，而不是一场胜利。",
          family: [
            { word: "serendipity", pos: "n.", gloss: "a happy accident" },
            { word: "serendipitously", pos: "adv.", gloss: "by fortunate chance" }
          ],
          synonyms: [
            { word: "fortunate", gloss: "bringing luck" },
            { word: "lucky", gloss: "chance-driven and good" },
            { word: "unplanned", gloss: "not designed" }
          ],
          antonyms: [
            { word: "planned", gloss: "deliberately arranged" },
            { word: "unfortunate", gloss: "bringing bad luck" }
          ],
          example: {
            en: "A serendipitous encounter at the airport led to her first job.",
            zh: "一次在机场的偶遇，为她带来了第一份工作。"
          }
        },
        {
          word: "discovery",
          surface: "discovery",
          phonetic: "/dɪˈskʌv.ər.i/",
          pos: "noun",
          meaning: "the act of finding something for the first time",
          meaningZh: "发现；首次找到某物",
          why: "它点明了事件本身。serendipitous 告诉我们“怎么发生”，discovery 告诉我们“发生了什么”。",
          family: [
            { word: "discover", pos: "v.", gloss: "to find for the first time" },
            { word: "discoverer", pos: "n.", gloss: "a person who discovers" }
          ],
          synonyms: [
            { word: "finding", gloss: "something found" },
            { word: "breakthrough", gloss: "a major advance" }
          ],
          antonyms: [
            { word: "oversight", gloss: "something missed" },
            { word: "loss", gloss: "something no longer held" }
          ],
          example: {
            en: "The discovery took ten years and one very stubborn question.",
            zh: "这项发现花了十年，以及一个非常固执的问题。"
          }
        },
        {
          word: "course",
          surface: "course",
          phonetic: "/kɔːs/",
          pos: "noun",
          meaning: "the direction or path that something takes",
          meaningZh: "方向；事物发展的路径",
          why: "“改变医学的 course”是一种很凝练的说法：它改变的是历史走向，而不只是一次实验。",
          family: [
            { word: "course", pos: "v.", gloss: "to flow or run" },
            { word: "coursing", pos: "adj.", gloss: "running or flowing" }
          ],
          synonyms: [
            { word: "path", gloss: "the way forward" },
            { word: "trajectory", gloss: "the arc of change" }
          ],
          antonyms: [
            { word: "standstill", gloss: "no movement" },
            { word: "stagnation", gloss: "lack of change" }
          ],
          example: {
            en: "One conversation changed the course of the entire project.",
            zh: "一次谈话改变了整个项目的走向。"
          }
        }
      ]
    },

    {
      id: "planet-guests",
      text: "We are all ephemeral guests on a planet that will outlast us.",
      translation: "我们都只是这颗星球上转瞬即逝的过客，而星球将比我们存续得更久。",
      tone: "诗意 · 令人谦卑",
      structure: "主语 + 系动词 + 形容词 + 名词 + 介词短语 + 定语从句。",
      source: "Talk 示例语料 · 随笔",
      keyWords: [
        {
          word: "ephemeral",
          surface: "ephemeral",
          phonetic: "/ɪˈfem.ər.əl/",
          pos: "adjective",
          meaning: "lasting for a very short time",
          meaningZh: "短暂的；转瞬即逝的",
          why: "它把关于生命有限的陈述变成了一幅画面：我们不只是短暂存在，更是来去匆匆的访客。",
          family: [
            { word: "ephemera", pos: "n.", gloss: "brief things" },
            { word: "ephemerality", pos: "n.", gloss: "the quality of being brief" }
          ],
          synonyms: [
            { word: "fleeting", gloss: "passing quickly" },
            { word: "transient", gloss: "not lasting" }
          ],
          antonyms: [
            { word: "eternal", gloss: "without end" },
            { word: "enduring", gloss: "lasting long" }
          ],
          example: {
            en: "The ephemeral glow of the screen faded as the sun came up.",
            zh: "日出时，屏幕那转瞬即逝的光也渐渐消失了。"
          }
        },
        {
          word: "guests",
          surface: "guests",
          phonetic: "/ɡests/",
          pos: "noun",
          meaning: "people invited to stay or visit; here, temporary inhabitants",
          meaningZh: "客人；这里的“暂住者”",
          why: "真正承担情绪的是这个比喻。客人会受到欢迎，但客人终究要离开。",
          family: [
            { word: "guest", pos: "n.", gloss: "a visitor" },
            { word: "guesthouse", pos: "n.", gloss: "a small lodging" }
          ],
          synonyms: [
            { word: "visitor", gloss: "someone who visits" },
            { word: "sojourner", gloss: "a temporary resident" }
          ],
          antonyms: [
            { word: "host", gloss: "the one who receives" },
            { word: "resident", gloss: "a permanent inhabitant" }
          ],
          example: {
            en: "We are guests here, and the house was here long before us.",
            zh: "我们只是这里的客人，而这栋房子早在我们来之前就已存在。"
          }
        },
        {
          word: "outlast",
          surface: "outlast",
          phonetic: "/ˌaʊtˈlɑːst/",
          pos: "verb",
          meaning: "to live or last longer than something else",
          meaningZh: "比……存在得更久",
          why: "一个安静但结实的动词，让星球成为一场无人记得报名参加的赛跑的赢家。",
          family: [
            { word: "outlasted", pos: "v.", gloss: "lasted longer than" },
            { word: "outlasting", pos: "adj.", gloss: "enduring beyond" }
          ],
          synonyms: [
            { word: "survive", gloss: "continue to exist" },
            { word: "outlive", gloss: "live longer than" }
          ],
          antonyms: [
            { word: "precede", gloss: "come before" },
            { word: "yield", gloss: "give way" }
          ],
          example: {
            en: "Good ideas often outlast the people who first said them.",
            zh: "好想法往往比最初说出它的人活得更久。"
          }
        }
      ]
    },

    {
      id: "resilient-hope",
      text: "What we need is not more certainty, but a more resilient kind of hope.",
      translation: "我们需要的不是更多的确定性，而是一种更有韧性的希望。",
      tone: "克制 · 安静地怀抱希望",
      structure: "What 强调句 + 否定对比 + 比较级形容词 + 名词。",
      source: "Talk 示例语料 · 观点",
      keyWords: [
        {
          word: "certainty",
          surface: "certainty",
          phonetic: "/ˈsɜː.tən.ti/",
          pos: "noun",
          meaning: "the state of being completely sure",
          meaningZh: "确定性；完全有把握的状态",
          why: "句子把“确定”和“希望”对举。确定让人舒服，却也脆弱；希望不确定，却更有弹性。",
          family: [
            { word: "certain", pos: "adj.", gloss: "sure" },
            { word: "certainly", pos: "adv.", gloss: "without doubt" }
          ],
          synonyms: [
            { word: "assurance", gloss: "confidence" },
            { word: "conviction", gloss: "strong belief" }
          ],
          antonyms: [
            { word: "doubt", gloss: "uncertainty" },
            { word: "ambiguity", gloss: "open to more than one reading" }
          ],
          example: {
            en: "She wanted certainty, but what she needed was company.",
            zh: "她想要确定，但她真正需要的是陪伴。"
          }
        },
        {
          word: "resilient",
          surface: "resilient",
          phonetic: "/rɪˈzɪl.i.ənt/",
          pos: "adjective",
          meaning: "able to recover quickly from difficulty",
          meaningZh: "有韧性的；能迅速恢复的",
          why: "它把希望从一种脆弱的感觉，变成一种可以练习的能力——会弯、会撑住，也会回来。",
          family: [
            { word: "resilience", pos: "n.", gloss: "the capacity to recover" },
            { word: "resiliently", pos: "adv.", gloss: "in a resilient way" }
          ],
          synonyms: [
            { word: "adaptable", gloss: "able to adjust" },
            { word: "buoyant", gloss: "quick to rise again" }
          ],
          antonyms: [
            { word: "fragile", gloss: "easily broken" },
            { word: "brittle", gloss: "snaps under pressure" }
          ],
          example: {
            en: "A resilient hope does not deny the difficulty; it refuses to be defined by it.",
            zh: "有韧性的希望并不否认困难，只是拒绝被困难定义。"
          }
        },
        {
          word: "hope",
          surface: "hope",
          phonetic: "/həʊp/",
          pos: "noun",
          meaning: "a feeling of expectation and desire for a certain thing to happen",
          meaningZh: "希望；对好结果的期待",
          why: "这是句子的最后一个词，也是它想留给你的词。比较级 more 让 hope 成为一种练习，而不只是一种心情。",
          family: [
            { word: "hopeful", pos: "adj.", gloss: "feeling hope" },
            { word: "hopeless", pos: "adj.", gloss: "without hope" },
            { word: "hopefully", pos: "adv.", gloss: "in a hopeful way" }
          ],
          synonyms: [
            { word: "optimism", gloss: "expectation of good" },
            { word: "expectation", gloss: "belief something will happen" }
          ],
          antonyms: [
            { word: "despair", gloss: "loss of all hope" },
            { word: "despondency", gloss: "deep discouragement" }
          ],
          example: {
            en: "Hope is not a prediction. It is a decision about where to look next.",
            zh: "希望不是预言，而是决定接下来把目光放在哪里。"
          }
        }
      ]
    }
  ];

  const moods = [
    {
      tone: "lime",
      kicker: "01 · 光",
      title: "轻柔而明亮",
      words: "luminous · ephemeral · solace",
      target: "luminous"
    },
    {
      tone: "lavender",
      kicker: "02 · 精确",
      title: "锋利而精确",
      words: "nuance · serendipity · resilient",
      target: "nuance"
    },
    {
      tone: "coral",
      kicker: "03 · 漂移",
      title: "安静地好奇",
      words: "curious · wander · ephemeral",
      target: "curious"
    },
    {
      tone: "lime",
      kicker: "04 · 恢复",
      title: "温柔地恢复",
      words: "resilient · solace · luminous",
      target: "resilient"
    },
    {
      tone: "lavender",
      kicker: "05 · 远行",
      title: "走到很远",
      words: "wander · ephemeral · curious",
      target: "wander"
    },
    {
      tone: "coral",
      kicker: "06 · 留白",
      title: "慢一点说",
      words: "solace · nuance · ephemeral",
      target: "solace"
    },
    {
      tone: "lime",
      kicker: "07 · 清醒",
      title: "锋利而温柔",
      words: "nuance · resilient · serendipity",
      target: "nuance"
    },
    {
      tone: "lavender",
      kicker: "08 · 微光",
      title: "把光留住",
      words: "luminous · serendipitous · solace",
      target: "luminous"
    }
  ];

  const dailyWords = [
    "serendipity",
    "ephemeral",
    "resilient",
    "curious",
    "luminous",
    "wander",
    "nuance",
    "solace",
    "serendipitous"
  ];

  const lexicon = {
    chance: { phonetic: "/tʃɑːns/", pos: "noun", gloss: "a possibility of something happening; an unexpected occurrence" },
    fortune: { phonetic: "/ˈfɔː.tʃuːn/", pos: "noun", gloss: "luck, especially good luck, and the things it brings" },
    fluke: { phonetic: "/fluːk/", pos: "noun", gloss: "a surprising success caused by luck rather than skill" },
    misfortune: { phonetic: "/ˌmɪsˈfɔː.tʃuːn/", pos: "noun", gloss: "bad luck, or an unlucky event" },
    design: { phonetic: "/dɪˈzaɪn/", pos: "noun", gloss: "a plan or intention behind something" },
    inevitability: { phonetic: "/ɪˌnev.ɪ.təˈbɪl.ə.ti/", pos: "noun", gloss: "the quality of being certain to happen" },
    fortunate: { phonetic: "/ˈfɔː.tʃən.ət/", pos: "adjective", gloss: "lucky; bringing a good result" },
    lucky: { phonetic: "/ˈlʌk.i/", pos: "adjective", gloss: "having good things happen by chance" },
    unplanned: { phonetic: "/ʌnˈplænd/", pos: "adjective", gloss: "not arranged or intended in advance" },
    unfortunate: { phonetic: "/ʌnˈfɔː.tʃən.ət/", pos: "adjective", gloss: "bringing bad luck; regrettable" },
    planned: { phonetic: "/plænd/", pos: "adjective", gloss: "arranged in advance" },
    fleeting: { phonetic: "/ˈfliː.tɪŋ/", pos: "adjective", gloss: "lasting only a very short time" },
    transient: { phonetic: "/ˈtræn.zi.ənt/", pos: "adjective", gloss: "lasting only for a short time" },
    momentary: { phonetic: "/ˈməʊ.mən.tər.i/", pos: "adjective", gloss: "lasting for only a moment" },
    eternal: { phonetic: "/ɪˈtɜː.nəl/", pos: "adjective", gloss: "lasting forever" },
    enduring: { phonetic: "/ɪnˈdjʊə.rɪŋ/", pos: "adjective", gloss: "lasting a long time" },
    permanent: { phonetic: "/ˈpɜː.mə.nənt/", pos: "adjective", gloss: "not temporary" },
    tough: { phonetic: "/tʌf/", pos: "adjective", gloss: "strong and difficult to break or harm" },
    adaptable: { phonetic: "/əˈdæp.tə.bəl/", pos: "adjective", gloss: "able to change to suit new conditions" },
    buoyant: { phonetic: "/ˈbɔɪ.ənt/", pos: "adjective", gloss: "able to float; quick to recover" },
    fragile: { phonetic: "/ˈfrædʒ.aɪl/", pos: "adjective", gloss: "easily broken or harmed" },
    brittle: { phonetic: "/ˈbrɪt.əl/", pos: "adjective", gloss: "hard but easily broken under pressure" },
    vulnerable: { phonetic: "/ˈvʌl.nər.ə.bəl/", pos: "adjective", gloss: "easily hurt or harmed" },
    inquisitive: { phonetic: "/ɪnˈkwɪz.ə.tɪv/", pos: "adjective", gloss: "eager to ask questions and learn" },
    intrigued: { phonetic: "/ɪnˈtriːɡd/", pos: "adjective", gloss: "very interested and curious" },
    questioning: { phonetic: "/ˈkwes.tʃə.nɪŋ/", pos: "adjective", gloss: "showing doubt or a desire to know" },
    indifferent: { phonetic: "/ɪnˈdɪf.ər.ənt/", pos: "adjective", gloss: "not interested or concerned" },
    incurious: { phonetic: "/ɪnˈkjʊə.ri.əs/", pos: "adjective", gloss: "not curious; without interest" },
    apathetic: { phonetic: "/ˌæp.əˈθet.ɪk/", pos: "adjective", gloss: "showing no interest or energy" },
    radiant: { phonetic: "/ˈreɪ.di.ənt/", pos: "adjective", gloss: "sending out light or joy" },
    glowing: { phonetic: "/ˈɡləʊ.ɪŋ/", pos: "adjective", gloss: "giving out a soft, steady light" },
    incandescent: { phonetic: "/ˌɪn.kænˈdes.ənt/", pos: "adjective", gloss: "glowing with heat; intensely bright" },
    dim: { phonetic: "/dɪm/", pos: "adjective", gloss: "not bright" },
    dull: { phonetic: "/dʌl/", pos: "adjective", gloss: "not bright, sharp, or interesting" },
    shadowy: { phonetic: "/ˈʃæd.əʊ.i/", pos: "adjective", gloss: "full of shadows; hard to see clearly" },
    roam: { phonetic: "/rəʊm/", pos: "verb", gloss: "to move around freely without a fixed purpose" },
    drift: { phonetic: "/drɪft/", pos: "verb", gloss: "to be carried slowly along" },
    meander: { phonetic: "/miˈæn.dər/", pos: "verb", gloss: "to follow a winding path" },
    ramble: { phonetic: "/ˈræm.bəl/", pos: "verb", gloss: "to walk or talk without a clear plan" },
    settle: { phonetic: "/ˈset.əl/", pos: "verb", gloss: "to stay in one place" },
    stay: { phonetic: "/steɪ/", pos: "verb", gloss: "to remain in a place" },
    beeline: { phonetic: "/ˈbiː.laɪn/", pos: "noun", gloss: "a straight, direct route" },
    subtlety: { phonetic: "/ˈsʌt.əl.ti/", pos: "noun", gloss: "a fine distinction that is easy to miss" },
    shade: { phonetic: "/ʃeɪd/", pos: "noun", gloss: "a slight variation of a colour or meaning" },
    gradation: { phonetic: "/ɡrəˈdeɪ.ʃən/", pos: "noun", gloss: "a small step in a series of changes" },
    bluntness: { phonetic: "/ˈblʌnt.nəs/", pos: "noun", gloss: "the quality of being direct, sometimes harshly so" },
    generalisation: { phonetic: "/ˌdʒen.ər.ə.laɪˈzeɪ.ʃən/", pos: "noun", gloss: "a broad statement covering many cases" },
    comfort: { phonetic: "/ˈkʌm.fət/", pos: "noun", gloss: "a state of ease or relief from pain" },
    consolation: { phonetic: "/ˌkɒn.səˈleɪ.ʃən/", pos: "noun", gloss: "comfort given after a loss or disappointment" },
    relief: { phonetic: "/rɪˈliːf/", pos: "noun", gloss: "the easing of pain, worry, or distress" },
    distress: { phonetic: "/dɪˈstres/", pos: "noun", gloss: "extreme worry, sadness, or pain" },
    torment: { phonetic: "/ˈtɔː.ment/", pos: "noun", gloss: "severe physical or mental suffering" },
    anguish: { phonetic: "/ˈæŋ.ɡwɪʃ/", pos: "noun", gloss: "very deep emotional pain" },
    discovery: { phonetic: "/dɪˈskʌv.ər.i/", pos: "noun", gloss: "the act of finding something for the first time" },
    course: { phonetic: "/kɔːs/", pos: "noun", gloss: "the direction or path something takes" },
    guest: { phonetic: "/ɡest/", pos: "noun", gloss: "a person invited to visit or stay" },
    outlast: { phonetic: "/ˌaʊtˈlɑːst/", pos: "verb", gloss: "to last longer than something else" },
    certainty: { phonetic: "/ˈsɜː.tən.ti/", pos: "noun", gloss: "the state of being completely sure" },
    hope: { phonetic: "/həʊp/", pos: "noun", gloss: "the feeling that something good may happen" }
  };

  const lexiconExtra = {
    serendipitously: { phonetic: "/ˌser.ənˈdɪp.ɪ.təs.li/", pos: "adverb", gloss: "by fortunate chance", zh: "偶然地；幸运地" },
    serendipitist: { phonetic: "", pos: "noun", gloss: "a person who makes fortunate discoveries by accident", zh: "善于发现意外之喜的人" },
    ephemera: { phonetic: "/ɪˈfem.ər.ə/", pos: "noun", gloss: "things that exist or are enjoyed for only a short time", zh: "短暂存在的事物" },
    ephemerally: { phonetic: "/ɪˈfem.ər.əl.i/", pos: "adverb", gloss: "in a brief, fleeting way", zh: "短暂地；转瞬即逝地" },
    ephemerality: { phonetic: "/ɪˌfem.ərˈæl.ə.ti/", pos: "noun", gloss: "the quality of lasting only a short time", zh: "短暂性" },
    resilience: { phonetic: "/rɪˈzɪl.i.əns/", pos: "noun", gloss: "the capacity to recover quickly from difficulty", zh: "韧性；恢复力" },
    resiliently: { phonetic: "/rɪˈzɪl.i.ənt.li/", pos: "adverb", gloss: "in a way that recovers quickly", zh: "有韧性地；迅速地恢复" },
    resiliency: { phonetic: "/rɪˈzɪl.i.ən.si/", pos: "noun", gloss: "resilience; the ability to bounce back", zh: "韧性；回弹力" },
    curiosity: { phonetic: "/ˌkjʊə.riˈɒs.ə.ti/", pos: "noun", gloss: "a strong desire to know or learn something", zh: "好奇心" },
    curiously: { phonetic: "/ˈkjʊə.ri.əs.li/", pos: "adverb", gloss: "in an inquisitive or strange way", zh: "好奇地；奇怪地" },
    curiousness: { phonetic: "/ˈkjʊə.ri.əs.nəs/", pos: "noun", gloss: "the quality of being curious", zh: "好奇；求知欲" },
    luminosity: { phonetic: "/ˌluː.mɪˈnɒs.ə.ti/", pos: "noun", gloss: "the quality of giving off light; brightness", zh: "光度；光辉" },
    luminously: { phonetic: "/ˈluː.mɪ.nəs.li/", pos: "adverb", gloss: "in a bright or glowing way", zh: "明亮地；发光地" },
    luminary: { phonetic: "/ˈluː.mɪ.nər.i/", pos: "noun", gloss: "a person who inspires or influences others", zh: "杰出人物；发光体" },
    wanderer: { phonetic: "/ˈwɒn.dər.ər/", pos: "noun", gloss: "a person who travels without a fixed destination", zh: "漫游者；漂泊者" },
    wandering: { phonetic: "/ˈwɒn.dər.ɪŋ/", pos: "adjective / noun", gloss: "roaming; the act of travelling without a fixed route", zh: "漫游的；漂泊" },
    wanderlust: { phonetic: "/ˈwɒn.də.lʌst/", pos: "noun", gloss: "a strong desire to travel", zh: "旅行癖；漫游欲" },
    nuanced: { phonetic: "/ˈnjuː.ɑːnst/", pos: "adjective", gloss: "showing or noticing subtle differences", zh: "细腻的；有细微差别的" },
    nuanceless: { phonetic: "", pos: "adjective", gloss: "lacking subtle differences", zh: "缺乏细微差别的" },
    solacing: { phonetic: "/ˈsɒl.əs.ɪŋ/", pos: "adjective", gloss: "giving comfort in distress", zh: "给人安慰的" },
    solaced: { phonetic: "/ˈsɒl.əst/", pos: "adjective", gloss: "comforted in a time of distress", zh: "得到安慰的" },
    discover: { phonetic: "/dɪˈskʌv.ər/", pos: "verb", gloss: "to find something for the first time", zh: "发现；找到" },
    discoverer: { phonetic: "/dɪˈskʌv.ər.ər/", pos: "noun", gloss: "a person who discovers something", zh: "发现者" },
    finding: { phonetic: "/ˈfaɪn.dɪŋ/", pos: "noun", gloss: "a discovery or result of research", zh: "发现；研究结果" },
    breakthrough: { phonetic: "/ˈbreɪk.θruː/", pos: "noun", gloss: "a major advance or discovery", zh: "突破；重大进展" },
    path: { phonetic: "/pɑːθ/", pos: "noun", gloss: "the way forward; a route", zh: "路径；道路" },
    trajectory: { phonetic: "/trəˈdʒek.tər.i/", pos: "noun", gloss: "the path or arc of change", zh: "轨迹；发展路径" },
    standstill: { phonetic: "/ˈstænd.stɪl/", pos: "noun", gloss: "a state of no movement or progress", zh: "停滞；停顿" },
    stagnation: { phonetic: "/stæɡˈneɪ.ʃən/", pos: "noun", gloss: "a lack of movement, growth, or change", zh: "停滞；不发展" },
    oversight: { phonetic: "/ˈəʊ.və.saɪt/", pos: "noun", gloss: "a failure to notice something", zh: "疏忽；遗漏" },
    loss: { phonetic: "/lɒs/", pos: "noun", gloss: "the fact of no longer having something", zh: "失去；损失" },
    visitor: { phonetic: "/ˈvɪz.ɪ.tər/", pos: "noun", gloss: "a person who visits a place or person", zh: "访客；游客" },
    sojourner: { phonetic: "/ˈsɒdʒ.ɜː.nər/", pos: "noun", gloss: "a person who stays somewhere temporarily", zh: "旅居者；暂住者" },
    host: { phonetic: "/həʊst/", pos: "noun", gloss: "a person who receives or entertains guests", zh: "主人；东道主" },
    resident: { phonetic: "/ˈrez.ɪ.dənt/", pos: "noun", gloss: "a person who lives in a place permanently", zh: "居民；住户" },
    survive: { phonetic: "/səˈvaɪv/", pos: "verb", gloss: "to continue to exist despite difficulty", zh: "幸存；继续存在" },
    outlive: { phonetic: "/ˌaʊtˈlɪv/", pos: "verb", gloss: "to live longer than something else", zh: "比……活得久" },
    precede: { phonetic: "/prɪˈsiːd/", pos: "verb", gloss: "to come before something in time or order", zh: "先于；在……之前" },
    yield: { phonetic: "/jiːld/", pos: "verb", gloss: "to give way or produce something", zh: "屈服；让步；产出" },
    assurance: { phonetic: "/əˈʃɔː.rəns/", pos: "noun", gloss: "confidence or a promise that something is true", zh: "保证；信心" },
    conviction: { phonetic: "/kənˈvɪk.ʃən/", pos: "noun", gloss: "a strong belief", zh: "坚定信念" },
    doubt: { phonetic: "/daʊt/", pos: "noun", gloss: "a feeling of uncertainty", zh: "怀疑；不确定" },
    ambiguity: { phonetic: "/ˌæm.bɪˈɡjuː.ə.ti/", pos: "noun", gloss: "the quality of being open to more than one meaning", zh: "歧义；模糊性" },
    optimism: { phonetic: "/ˈɒp.tɪ.mɪ.zəm/", pos: "noun", gloss: "the expectation that good things will happen", zh: "乐观；乐观主义" },
    expectation: { phonetic: "/ˌek.spekˈteɪ.ʃən/", pos: "noun", gloss: "a belief that something will happen", zh: "期待；预期" },
    despair: { phonetic: "/dɪˈspeər/", pos: "noun", gloss: "the complete loss of hope", zh: "绝望" },
    despondency: { phonetic: "/dɪˈspɒn.dən.si/", pos: "noun", gloss: "a state of low spirits and discouragement", zh: "沮丧；消沉" },
    course: { phonetic: "/kɔːs/", pos: "noun", gloss: "the direction or path something takes", zh: "方向；进程" },
    coursing: { phonetic: "/ˈkɔː.sɪŋ/", pos: "adjective", gloss: "running or flowing", zh: "奔流的" },
    guesthouse: { phonetic: "/ˈɡest.haʊs/", pos: "noun", gloss: "a small hotel or lodging", zh: "客栈；小旅馆" },
    outlasted: { phonetic: "/ˌaʊtˈlɑː.stɪd/", pos: "verb", gloss: "lasted longer than something else", zh: "比……存在得更久" },
    outlasting: { phonetic: "/ˌaʊtˈlɑː.stɪŋ/", pos: "adjective", gloss: "enduring beyond something else", zh: "更持久的" },
    certain: { phonetic: "/ˈsɜː.tən/", pos: "adjective", gloss: "completely sure", zh: "确定的；肯定的" },
    certainly: { phonetic: "/ˈsɜː.tən.li/", pos: "adverb", gloss: "without doubt", zh: "当然；无疑" },
    hopeful: { phonetic: "/ˈhəʊp.fəl/", pos: "adjective", gloss: "feeling or giving hope", zh: "抱有希望的" },
    hopeless: { phonetic: "/ˈhəʊp.ləs/", pos: "adjective", gloss: "without hope", zh: "绝望的；无望的" },
    hopefully: { phonetic: "/ˈhəʊp.fəl.i/", pos: "adverb", gloss: "in a hopeful way", zh: "希望如此；抱有希望地" }
  };

  Object.assign(lexicon, lexiconExtra);

  const lexiconZh = {
    chance: "机会；偶然", fortune: "运气；财富", fluke: "侥幸；偶然的成功",
    misfortune: "不幸；厄运", design: "设计；意图", inevitability: "必然性",
    fortunate: "幸运的；带来好运的", lucky: "幸运的", unplanned: "未计划的",
    unfortunate: "不幸的；遗憾的", planned: "计划好的", fleeting: "飞逝的；短暂的",
    transient: "短暂的；过渡的", momentary: "片刻的；瞬间的", eternal: "永恒的",
    enduring: "持久的", permanent: "永久的", tough: "坚韧的；艰难的",
    adaptable: "适应力强的", buoyant: "有浮力的；乐观的", fragile: "脆弱的",
    brittle: "易碎的；脆弱的", vulnerable: "易受伤的", inquisitive: "好奇的；爱追问的",
    intrigued: "被勾起兴趣的", questioning: "质疑的；探寻的", indifferent: "漠不关心的",
    incurious: "不好奇的", apathetic: "冷漠的", radiant: "发光的；容光焕发的",
    glowing: "发光的；洋溢的", incandescent: "白炽的；极亮的", dim: "昏暗的；暗淡的",
    dull: "暗淡的；乏味的", shadowy: "多阴影的；模糊的", roam: "漫游；闲逛",
    drift: "漂流；漂移", meander: "蜿蜒；漫步", ramble: "漫步；漫谈",
    settle: "定居；安定", stay: "停留", beeline: "直线；直奔",
    subtlety: "微妙之处", shade: "色差；细微变化", gradation: "渐变；层次",
    bluntness: "直率；生硬", generalisation: "概括；泛化", comfort: "安慰；舒适",
    consolation: "慰藉", relief: "宽慰；缓解", distress: "痛苦；困境",
    torment: "折磨", anguish: "极度痛苦", discovery: "发现",
    guest: "客人", outlast: "比……长久", certainty: "确定性", hope: "希望"
  };

  for (const [word, zh] of Object.entries(lexiconZh)) {
    if (lexicon[word]) lexicon[word].zh = zh;
  }

  const recent = [
    { type: "word", query: "serendipity" },
    { type: "word", query: "ephemeral" },
    { type: "sentence", query: "We are all ephemeral guests on a planet that will outlast us." }
  ];

  return { words, sentences, moods, dailyWords, lexicon, recent };
})();
