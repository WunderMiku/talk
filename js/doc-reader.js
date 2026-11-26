/* ============================================================
   talk. — Intensive Reader & Vector PDF Booklet Module
   Bridges cleanly with app.js via window.__TALK_BRIDGE__
   ============================================================ */
(function () {
  const DB_NAME = "talk.docs.v1";
  const DB_VERSION = 1;
  const MAX_DOCS = 20;
  const MAX_CONCURRENCY = 3;

  let dbPromise = null;
  const memDocs = new Map();
  const memBlocks = new Map();

  const readerState = {
    view: "input", // "input" | "doc"
    doc: null,
    overview: null,
    overviewState: "idle", // "idle" | "loading" | "done" | "error"
    overviewError: "",
    blockResults: new Map(), // blockIndex -> { status, data, error }
    recentDocs: [],
    focusEn: false,
    simplifyOnInput: false,
    showSimplified: true,
    modalOpen: false,
    opts: {
      cover: true,
      translation: true,
      focus: true,
      notes: true,
      appendix: true,
      bindingMargin: false
    },
    runSeq: 0,
    abortController: null
  };

  /* ---------- Built-in Offline Demo Sample ---------- */
  const BUILTIN_SAMPLE_RAW = `# The Quiet Architecture of Frictionless Convenience

## Why the tools built to save us time are subtly reshaping how we think

For the past decade, Silicon Valley has treated friction as an *unalloyed evil*. Every tap removed from a checkout flow, every paragraph condensed into three bullet points, and every awkward pause smoothed over by an autocomplete prompt has been celebrated as an unambiguous triumph of design. Yet what seemed like a modest concession to speed at first glance has quietly hollowed out the very cognitive guardrails that deep judgment relies upon.

Consider how an ordinary reader now encounters a difficult text. Not long ago, stumbling over an unfamiliar idiom or a dense policy clause forced a brief, productive halt. You had to re-read the preceding sentence, weigh the author's tone, and piece together the implied argument before moving on. Today, a single hover summons an instant summary that papers over ambiguity before you even notice it was there. The result is a deceptive sense of fluency: readers glide effortlessly across the surface of an argument while missing the undercurrents entirely.

## The paradox of borrowed certainty

Corporate leaders have embraced this shift with telling enthusiasm. When a major software firm recently unveiled its latest "instant comprehension" suite, its chief executive hedged his endorsement so carefully that you could almost hear the legal team's exit strategy warming up in the background. Productivity gains, he assured investors, were "directionally encouraging"—a phrase that, in boardroom English, reliably translates to "do not ask for audited numbers."

The deeper problem is not that automated summaries are occasionally wrong, though hallucinations still surface in the most inconvenient places. It is that they flatten register and erase hesitation. In diplomacy, law, and serious journalism, the gap between *suggests* and *demonstrates*, or between a *measured rebuke* and a *blunt refusal*, is where the real news lives. Strip away those subtle qualifiers in the name of efficiency, and you are left with prose that sounds authoritative precisely because it has been scrubbed clean of nuance.

## Designing for productive pause

None of this is a plea to return to paper ledgers or dusty reference shelves. Speed has its rightful place: no one wants to spend ten minutes decoding a train timetable or a routine customs form. The mistake lies in assuming that every reading task belongs on the same conveyor belt. Beneath the brisk civility of our productivity dashboards lingers a quiet reckoning that software makers have barely begun to name.

A more mature generation of tools will learn when to get out of the way—and when to slow the reader down on purpose. Instead of burying a thorny sentence under a generic paraphrase, good design should illuminate its load-bearing joints: why a writer inverted a clause, how a single metaphor tilts the moral weight of a paragraph, and where a familiar word quietly shifts its allegiance. Convenience is easy to engineer; clarity that actually sticks requires a little well-placed resistance.`;

  const BUILTIN_SAMPLE_OVERVIEW = {
    kind: "docOverview",
    titleZh: "无摩擦便利的静默架构",
    subtitle: "当效率抹平认知阻力，深度判断力正悄然流失",
    genre: "科技评论",
    tone: "克制冷峻、暗含讽刺",
    summary: "文章剖析了硅谷将「消除摩擦」奉为圭臬的设计哲学，指出即时摘要、一键压缩与自动补全虽然换来了表面流畅，却悄然掏空了深度判断赖以运转的认知护栏。作者认为，真正的清晰并非来自抹平一切复杂性，而是学会在关键节点为读者保留「生产性停顿」。",
    readingTips: [
      "留意作者如何用「动作极轻 + 后果极重」的搭配（如 quietly hollowed out、papers over）制造典型外刊式的英式冷讽。",
      "阅读第 2 节时，重点观察作者对职场黑话（directionally encouraging）与语域差异（suggests vs. demonstrates）的拆解。"
    ],
    glossary: [
      { term: "frictionless convenience", zh: "无摩擦便利", note: "指科技产品消除一切操作与思考阻力的设计执念" },
      { term: "cognitive guardrails", zh: "认知护栏", note: "借用道路护栏比喻防止思维失控的慢思考机制" },
      { term: "productive halt", zh: "生产性停顿", note: "阅读受阻时迫使大脑回看、反思的必要停留" },
      { term: "load-bearing joints", zh: "承重关节", note: "隐喻长难句中撑起逻辑与修辞重心的关键节点" }
    ]
  };

  const BUILTIN_SAMPLE_BLOCKS = [
    {
      kind: "docBlock",
      translation: "过去十年间，硅谷一直把「摩擦」视作彻头彻尾的恶。结账流程里省掉的每一次点击、长段文字压成的三个要点、自动补全抹平的每一处尴尬停顿，全都被奉为设计史上的绝对胜利。然而，这步初看温和的妥协，却在不动声色间掏空了深度判断赖以立身的认知护栏。\n\n看看普通读者如今如何面对晦涩文本就知道了。不久之前，撞上一个生僻习语或密不透风的政策条款，会逼着人来一次短暂却有益的「生产性停顿」：你得回读前句、掂量语气，拼出弦外之音再往下走。如今鼠标轻轻一悬停，即时摘要便在你察觉歧义之前将其粉饰平整。由此换来的是一种极具欺骗性的流畅感：读者在论点表面滑行自如，却彻底错过了底下的暗流。",
      focusSentence: {
        en: "Yet what seemed like a modest concession to speed at first glance has quietly hollowed out the very cognitive guardrails that deep judgment relies upon.",
        why: "用 What seemed like... 主语从句刻意压低前半句预期，再以 quietly hollowed out + 尾重定语从句完成冷峻反转，是典型的外刊「先抑后扬」句式。"
      },
      notes: [
        { term: "unalloyed evil", pos: "phr.", inContextZh: "纯粹的恶", nuance: "alloy 本指合金掺杂，unalloyed 即「不掺杂质的」。比 pure evil 多了一层对硅谷零容忍态度的冷峻反讽。", chunk: "treat <X> as an unalloyed evil" },
        { term: "hollowed out", pos: "v.", inContextZh: "掏空；名存实亡", nuance: "与 quietly 连用，描绘出「外壳依然光鲜完整，内部支撑已被悄悄抽空」的画面，呼应标题 Architecture。", chunk: "quietly hollow out <guardrails>" },
        { term: "cognitive guardrails", pos: "n.", inContextZh: "认知护栏", nuance: "借用高速路护栏隐喻那些迫使大脑慢下来、防止盲目下判断的思维防线。" },
        { term: "productive halt", pos: "n.", inContextZh: "生产性停顿", nuance: "刻意制造的矛盾修辞：效率主义把停顿视为浪费，作者却指出卡顿恰恰是深度理解诞生的时刻。" },
        { term: "papers over", pos: "phr.", inContextZh: "掩盖；粉饰", nuance: "源自 paper over the cracks（用壁纸糊住墙缝），暗讽即时摘要只是把歧义糊平。", chunk: "paper over <ambiguity / cracks>" }
      ],
      simplifiedText: "For the past decade, Silicon Valley has treated friction as an unalloyed evil. Every tap removed from a checkout flow, every paragraph shortened into three bullet points, and every awkward pause smoothed over by an autocomplete prompt has been celebrated as a clear victory of design. Yet what seemed like a small give-in to speed at first glance has quietly hollowed out the very cognitive guardrails that deep judgment relies upon.\n\nConsider how an ordinary reader now encounters a difficult text. Not long ago, running into an unfamiliar idiom or a hard-to-read policy clause forced a brief, productive halt. You had to re-read the earlier sentence, weigh the author's tone, and piece together the hidden argument before moving on. Today, a single hover brings up an instant summary that papers over confusion before you even notice it was there. The result is a misleading sense of fluency: readers glide easily across the surface of an argument while missing the deeper currents entirely.",
      replacements: [
        { simplified: "a clear victory", original: "an unambiguous triumph", note: "原词 unambiguous triumph 语气更庄重宏大，带反讽味" },
        { simplified: "small give-in", original: "modest concession", note: "原词 modest concession 是标准外交/政经书面语" },
        { simplified: "brings up", original: "summons", note: "原词 summons（召唤）把算法弹窗写得像施法" },
        { simplified: "misleading", original: "deceptive", note: "原词 deceptive 比 misleading 更强调表面诱人" }
      ]
    },
    {
      kind: "docBlock",
      translation: "企业高管们对这一转向展现出的热情耐人寻味。某大型软件公司最近发布最新「即时理解」套件时，首席执行官站台背书却字字设防，谨慎得让人几乎能听见幕后法务团队的撤退引擎正在嗡嗡预热。他向投资者保证，生产力提升「方向上令人鼓舞」——在董事会黑话里，这话翻成大白话就是「别追问审计数字」。\n\n更深层的问题并不在于自动摘要偶尔出错，而在于它们抹平了语域层级、擦掉了犹豫的痕迹。在外交、法律与严肃新闻里，真正的新闻就藏在「暗示」与「证实」、或「克制斥责」与「直白拒绝」之间的毫厘之差里。以效率之名剥掉这些微妙限定词，文字之所以听起来掷地有声，恰恰是因为它被彻底清洗得只剩扁平结论。",
      focusSentence: {
        en: "Strip away those subtle qualifiers in the name of efficiency, and you are left with prose that sounds authoritative precisely because it has been scrubbed clean of nuance.",
        why: "祈使句 + and 构成隐性因果，scrubbed clean of nuance 与前文 authoritative 形成辛辣反讽，揭示「伪权威」的本质。"
      },
      notes: [
        { term: "telling enthusiasm", pos: "phr.", inContextZh: "耐人寻味的热情", nuance: "telling 此处不是「讲述」，而是「泄露真相的、颇具说明性的」，暗指高管热捧背后另有盘算。", chunk: "a telling <detail / reaction>" },
        { term: "hedged his endorsement", pos: "phr.", inContextZh: "背书时留足后手", nuance: "hedge 由「树篱 → 金融对冲」转义为「说话留退路」，与正式站台（endorsement）拼出强烈荒诞感。", chunk: "hedge one's <endorsement / bets>" },
        { term: "directionally encouraging", pos: "adj.", inContextZh: "趋势向好但缺实据", nuance: "经典华尔街/硅谷委婉语，用模糊的「方向不错」遮掩拿不出硬数据的窘境。" },
        { term: "flatten register", pos: "v.", inContextZh: "抹平语域层级", nuance: "register 指语言随场合变化的正式度与分寸感；flatten 描绘出 AI 把一切语气压成同一高度的失真。", chunk: "flatten <register / nuance>" },
        { term: "scrubbed clean", pos: "phr.", inContextZh: "彻底擦洗干净", nuance: "scrub 带用力刷洗的机械粗暴感，反讽「过度净化的文字反而显出伪权威」。", chunk: "scrub <prose> clean of nuance" }
      ]
    },
    {
      kind: "docBlock",
      translation: "这并非呼吁大家回归纸质账本或积灰的参考书架。速度自有其正当位置：没人愿意花十分钟破译列车时刻表或常规海关表格。错就错在想当然地认为所有阅读任务都该放在同一条流水线上处理。在我们那些利落克制的效率仪表盘之下，潜藏着一场软件制造商几乎尚未命名的无声清算。\n\n更成熟的一代工具将学会何时退居幕后——以及何时刻意放慢读者的节奏。好的设计不应把棘手的句子掩埋在泛泛改写之下，而应照亮其「承重关节」：作者为何倒装从句、单个隐喻如何倾斜段落的道德分量、熟悉词汇又在哪里悄然改变立场。制造便利轻而易举，但真正能沉淀下来的清晰度，需要一点恰到好处的阻力。",
      focusSentence: {
        en: "Beneath the brisk civility of our productivity dashboards lingers a quiet reckoning that software makers have barely begun to name.",
        why: "介词短语前置 + 主谓倒装，先铺开表面礼貌高效的仪表盘，最后才缓缓推出悬而未决的「无声清算」，余韵极强。"
      },
      notes: [
        { term: "conveyor belt", pos: "n.", inContextZh: "同一条流水线", nuance: "批评软件把查时刻表和读深度长文塞进同一种流水线式速读处理。" },
        { term: "brisk civility", pos: "phr.", inContextZh: "利落克制的表面礼貌", nuance: "brisk 是干脆利落、不拖泥带水；civility 是维持距离的体面，精准刻画效率工具冷冰冰的顺滑。" },
        { term: "quiet reckoning", pos: "n.", inContextZh: "无声的隐性清算", nuance: "reckoning 本指「结清旧账」，与 quiet 构成张力，指代迟早要面对的认知退化代价。" },
        { term: "load-bearing joints", pos: "n.", inContextZh: "承重关节", nuance: "借用建筑结构术语，指一句话里撑起全部语气与逻辑的关键词眼与从句枢纽。" },
        { term: "shifts its allegiance", pos: "phr.", inContextZh: "悄然改变语境立场", nuance: "拟人修辞：形容熟词在特定语境中背离原本常规含义、转向全新语义阵营的「熟词僻义」。" }
      ]
    }
  ];

  /* ---------- Utilities ---------- */
  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeRegex(str) {
    return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isValidEnglishSimplified(text) {
    const s = String(text || "").trim();
    if (!s) return false;
    const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
    const latin = (s.match(/[A-Za-z]/g) || []).length;
    return latin >= 20 && cjk <= Math.max(2, Math.floor(latin * 0.05));
  }

  function isValidEnglishTerm(text) {
    const s = String(text || "").trim();
    return /[A-Za-z]/.test(s) && !/[\u4e00-\u9fff]/.test(s);
  }

  function sanitizeBlockData(data) {
    if (!data || typeof data !== "object") return data;
    if (data.simplifiedText && !isValidEnglishSimplified(data.simplifiedText)) {
      delete data.simplifiedText;
      delete data.replacements;
    } else if (Array.isArray(data.replacements)) {
      data.replacements = data.replacements.filter(
        (r) => r && isValidEnglishTerm(r.simplified) && isValidEnglishTerm(r.original)
      );
      if (!data.replacements.length) delete data.replacements;
    }
    return data;
  }

  function wrapClickableWords(paraHtml) {
    let wi = 0;
    const parts = String(paraHtml || "").split(/(<[^>]+>|&[a-zA-Z0-9#]+;)/g);
    let insideSup = false;
    return parts.map((seg) => {
      if (!seg) return "";
      if (seg.startsWith("<")) {
        if (/^<sup\b/i.test(seg)) insideSup = true;
        else if (/^<\/sup>/i.test(seg)) insideSup = false;
        return seg;
      }
      if (seg.startsWith("&") && seg.endsWith(";")) return seg;
      if (insideSup) return seg;
      return seg.replace(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g, (w) => {
        const idx = wi++;
        return `<span class="pdf-w" data-wi="${idx}">${w}</span>`;
      });
    }).join("");
  }

  function extractSentenceForWord(paraEl, targetWord, anchorEl = null) {
    if (!paraEl) return String(targetWord || "").trim();
    // Collect clean paragraph text while skipping <sup> footnote numbers and tracking anchorEl's exact offset
    let text = "";
    let anchorPos = -1;
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === 1) {
        if (node.tagName === "SUP") return;
        if (anchorEl && node === anchorEl && anchorPos === -1) {
          anchorPos = text.length;
        }
        for (const child of node.childNodes) walk(child);
      } else if (node.nodeType === 3) {
        text += node.nodeValue || "";
      }
    };
    walk(paraEl);
    if (!text.trim()) return String(targetWord || "").trim();

    if (anchorPos === -1 && targetWord) {
      const idx = text.toLowerCase().indexOf(String(targetWord).trim().toLowerCase());
      anchorPos = idx >= 0 ? idx : 0;
    }

    const isAbbrev = (str, dotIdx) => {
      const before = str.slice(Math.max(0, dotIdx - 8), dotIdx + 1);
      return /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|U\.S|U\.K|Inc|Ltd|Co|Fig|No|[A-Z])\.$/i.test(before);
    };

    // Scan backward to sentence start
    let start = 0;
    for (let i = Math.min(anchorPos - 1, text.length - 1); i >= 0; i--) {
      const ch = text[i];
      if ((ch === "." || ch === "!" || ch === "?" || ch === "。" || ch === "！" || ch === "？") && !isAbbrev(text, i)) {
        let j = i + 1;
        while (j < text.length && /["”'’)\]]/.test(text[j])) j++;
        if (j <= anchorPos && (j >= text.length || /\s/.test(text[j]))) {
          start = j;
          break;
        }
      }
    }

    // Scan forward to sentence end
    let end = text.length;
    const scanFrom = Math.max(anchorPos, start);
    for (let i = scanFrom; i < text.length; i++) {
      const ch = text[i];
      if ((ch === "." || ch === "!" || ch === "?" || ch === "。" || ch === "！" || ch === "？") && !isAbbrev(text, i)) {
        let j = i + 1;
        while (j < text.length && /["”'’)\]]/.test(text[j])) j++;
        if (j >= text.length || /\s/.test(text[j])) {
          end = j;
          break;
        }
      }
    }

    return text.slice(start, end).replace(/\s+/g, " ").trim() || String(targetWord || "").trim();
  }

  function cleanChunkForLookup(raw) {
    return String(raw || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function bridge() {
    return window.__TALK_BRIDGE__ || null;
  }

  function currentThemeTag() {
    const id = document.documentElement.getAttribute("data-theme") || "paper";
    const map = {
      "paper": "PAPER",
      "constructivist": "CONSTRUCTIVIST",
      "swiss-lab": "SWISS LAB",
      "topo-acid": "TOPO ACID",
      "archive-grid": "ARCHIVE GRID",
      "retro-stub": "RETRO STUB"
    };
    return `${map[id] || id.toUpperCase()} · 精读本`;
  }

  /* ---------- IndexedDB (talk.docs.v1) ---------- */
  function openDb() {
    if (dbPromise) return dbPromise;
    if (!window.idb || !window.indexedDB) return Promise.resolve(null);
    dbPromise = window.idb.openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("docs")) {
          db.createObjectStore("docs", { keyPath: "docHash" });
        }
        if (!db.objectStoreNames.contains("blocks")) {
          db.createObjectStore("blocks", { keyPath: "cacheKey" });
        }
      }
    }).catch(() => null);
    return dbPromise;
  }

  async function dbGetDoc(docHash) {
    const db = await openDb();
    if (!db) return memDocs.get(docHash) || null;
    try { return (await db.get("docs", docHash)) || null; } catch (_) { return memDocs.get(docHash) || null; }
  }

  async function dbPutDoc(record) {
    memDocs.set(record.docHash, record);
    const db = await openDb();
    if (!db) return;
    try {
      await db.put("docs", record);
      const all = await db.getAll("docs");
      if (all.length > MAX_DOCS) {
        all.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
        for (const old of all.slice(0, all.length - MAX_DOCS)) {
          await db.delete("docs", old.docHash);
        }
      }
    } catch (_) {}
  }

  async function dbListDocs() {
    const db = await openDb();
    if (!db) return [...memDocs.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    try {
      const all = await db.getAll("docs");
      return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch (_) {
      return [...memDocs.values()];
    }
  }

  async function dbDeleteDoc(docHash) {
    if (!docHash) return;
    memDocs.delete(docHash);
    for (const k of [...memBlocks.keys()]) {
      if (k.startsWith(`${docHash}:`)) memBlocks.delete(k);
    }
    const db = await openDb();
    if (!db) return;
    try {
      await db.delete("docs", docHash);
      const allBlocks = await db.getAll("blocks");
      for (const blk of allBlocks) {
        if (blk && (blk.docHash === docHash || String(blk.cacheKey || "").startsWith(`${docHash}:`))) {
          await db.delete("blocks", blk.cacheKey);
        }
      }
    } catch (_) {}
  }

  async function dbClearDocs() {
    memDocs.clear();
    memBlocks.clear();
    const db = await openDb();
    if (!db) return;
    try {
      await db.clear("docs");
      await db.clear("blocks");
    } catch (_) {}
  }

  async function dbGetBlock(docHash, blockHash) {
    const key = `${docHash}:${blockHash}`;
    const db = await openDb();
    if (!db) return memBlocks.get(key) || null;
    try { return (await db.get("blocks", key)) || null; } catch (_) { return memBlocks.get(key) || null; }
  }

  async function dbPutBlock(docHash, blockHash, blockIndex, data) {
    const rec = { cacheKey: `${docHash}:${blockHash}`, docHash, blockIndex, status: "done", data, updatedAt: Date.now() };
    memBlocks.set(rec.cacheKey, rec);
    const db = await openDb();
    if (!db) return;
    try { await db.put("blocks", rec); } catch (_) {}
  }

  /* ---------- Strict Ascending Offset Footnote Annotator ---------- */
  function annotatePassageText(text, rawNotes) {
    const notes = Array.isArray(rawNotes) ? rawNotes : [];
    const matched = [];

    for (const note of notes) {
      const term = String(note?.term || "").trim();
      if (!term) continue;
      const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegex(term)}(?![A-Za-z0-9])`, "i");
      const m = re.exec(text);
      if (m) {
        matched.push({
          start: m.index,
          end: m.index + m[0].length,
          matchedText: m[0],
          note
        });
      }
    }

    // Sort strictly by character position ascending
    matched.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

    // Filter out overlapping spans and assign sequential 1..N numbers
    const clean = [];
    let cursor = 0;
    for (const item of matched) {
      if (item.start < cursor) continue;
      item.num = clean.length + 1;
      clean.push(item);
      cursor = item.end;
    }

    // Build HTML paragraph by paragraph without breaking \n\n structure
    let html = "";
    let pos = 0;
    for (const item of clean) {
      html += esc(text.slice(pos, item.start));
      html += `<span class="pdf-term" data-note-ref="n-${item.note._sec}-${item.num}">${esc(item.matchedText)}<sup class="pdf-sup">${item.num}</sup></span>`;
      pos = item.end;
    }
    html += esc(text.slice(pos));

    const paraHtml = html
      .split(/\n{2,}/)
      .map((p) => `<p>${wrapClickableWords(p.trim())}</p>`)
      .join("");

    return { paraHtml, orderedNotes: clean };
  }

  /* ---------- Rendering ---------- */
  function renderInputPage() {
    const recentHtml = readerState.recentDocs.length
      ? `<div class="reader-recent">
          <div class="pdf-sec-bar" style="margin-top:0;">
            <span class="pdf-sec-num">库</span>
            <span class="pdf-sec-title">本地已精读</span>
            <span class="pdf-sec-rule"></span>
            <span class="pdf-sec-sub">${readerState.recentDocs.length} 篇缓存</span>
            ${readerState.recentDocs.length > 1 ? `<button type="button" class="reader-recent-clear" data-reader-action="clear-recent">清空</button>` : ""}
          </div>
          <div class="reader-recent-list">
            ${readerState.recentDocs.slice(0, 12).map((d) => `
              <div class="reader-recent-row">
                <button type="button" class="reader-recent-item" data-reader-action="open-recent" data-doc-hash="${esc(d.docHash)}">
                  <span class="reader-recent-title">${esc(d.overview?.titleZh || d.title)}</span>
                  <span class="reader-recent-meta">${d.wordCount} 词 · ${d.passageCount} 节</span>
                </button>
                <button type="button" class="reader-recent-del" title="删除这篇缓存" aria-label="删除" data-reader-action="delete-recent" data-doc-hash="${esc(d.docHash)}">×</button>
              </div>
            `).join("")}
          </div>
        </div>`
      : "";

    return `
      ${bridge()?.homeTopbar?.() || ""}
      <section class="reader-page">
        <div class="reader-hero">
          <div class="reader-eyebrow">INTENSIVE READER · 精读本</div>
          <h1 class="reader-title">长文进，<em>精读本</em>出。</h1>
          <p class="reader-lede">导入 .md / .txt 或直接粘贴整篇英文，按自然段并发精读并导出当前主题风格的满出血 A4 矢量 PDF。</p>
        </div>

        <div class="reader-input-shell">
          <div class="reader-input-head">
            <label class="reader-upload-btn">
              <span>+ 选择 .md / .txt 文件</span>
              <input type="file" id="reader-file-input" accept=".md,.markdown,.txt,text/plain,text/markdown" hidden />
            </label>
            <div style="display:inline-flex; align-items:center; gap:8px;">
              <button type="button" class="reader-simplify-toggle ${readerState.simplifyOnInput ? "active" : ""}" data-reader-action="toggle-simplify-input" title="文章过难时将多余超纲词降阶为低阶表达，文末附原词对照表">${readerState.simplifyOnInput ? "✓ 自动降阶替换" : "自动降阶替换"}</button>
              <span class="reader-word-stat" id="reader-word-stat">0 词</span>
            </div>
          </div>
          <textarea id="reader-textarea" class="reader-textarea" placeholder="粘贴整篇英文外刊、论文节选或标准文档（支持 Markdown # / ## 标题）…"></textarea>
          <div class="reader-input-foot">
            <button type="button" class="reader-ghost-btn" data-reader-action="load-sample">载入外刊示例（免 Key）</button>
            <button type="button" class="reader-primary-btn" data-reader-action="start-read">开始精读</button>
          </div>
        </div>
        ${recentHtml}
      </section>
    `;
  }

  function renderDocView() {
    const doc = readerState.doc;
    if (!doc) return renderInputPage();

    const passages = doc.blocks.filter((b) => b.type === "passage");
    let doneCount = 0;
    for (const p of passages) {
      if (readerState.blockResults.get(p.index)?.status === "done") doneCount++;
    }
    const pct = passages.length ? Math.round((doneCount / passages.length) * 100) : 0;
    const themeTag = currentThemeTag();
    const levelLabel = bridge()?.getSentenceLevelLabel?.() || "CET-6";

    // Pair headings with their following passage blocks into clean sheets
    const sections = [];
    let pendingHeading = null;
    for (const b of doc.blocks) {
      if (b.type === "heading") {
        pendingHeading = b.text;
      } else if (b.type === "passage") {
        sections.push({
          secNum: sections.length + 1,
          heading: pendingHeading,
          block: b
        });
        pendingHeading = null;
      }
    }

    // Collect all ordered notes across sections for Appendix + Active Recall Cloze
    const allIndexTerms = [];
    const seenTerms = new Set();
    const clozeBySec = new Map();
    const allReplacements = [];

    const sectionSheetsHtml = sections.map((sec) => {
      const res = readerState.blockResults.get(sec.block.index) || { status: "loading" };
      let spreadHtml = "";
      let studySheetHtml = "";

      if (res.status === "done" && res.data) {
        const useSimp = readerState.showSimplified && isValidEnglishSimplified(res.data.simplifiedText);
        const displaySourceText = useSimp ? res.data.simplifiedText : sec.block.text;
        const notesWithSec = (res.data.notes || []).slice(0, 6).map((n) => ({ ...n, _sec: sec.secNum }));
        let { paraHtml, orderedNotes } = annotatePassageText(displaySourceText, notesWithSec);
        if (useSimp && Array.isArray(res.data.replacements)) {
          for (const rep of res.data.replacements) {
            if (isValidEnglishTerm(rep.simplified) && isValidEnglishTerm(rep.original)) {
              allReplacements.push({ sec: sec.secNum, ...rep });
              const safeSimp = esc(rep.simplified);
              const repRe = new RegExp(`(?<!<[^>]*)\\b${escapeRegex(safeSimp)}\\b`, "i");
              paraHtml = paraHtml.replace(repRe, `<span class="pdf-simplified" title="原文：${esc(rep.original)}">${safeSimp}</span>`);
            }
          }
        }

        for (const item of orderedNotes) {
          const key = item.note.term.toLowerCase();
          if (!seenTerms.has(key)) {
            seenTerms.add(key);
            allIndexTerms.push({ sec: sec.secNum, ...item.note });
          }
          if (item.note.inContextZh) {
            const sentenceMatch = sec.block.text
              .split(/(?<=[.!?]["”']?)\s+/)
              .find((s) => s.toLowerCase().includes(item.matchedText.toLowerCase()));
            if (sentenceMatch && sentenceMatch.length <= 210) {
              if (!clozeBySec.has(sec.secNum)) clozeBySec.set(sec.secNum, []);
              clozeBySec.get(sec.secNum).push({
                sentence: sentenceMatch,
                answer: item.matchedText,
                hint: item.note.inContextZh
              });
            }
          }
        }

        const transParas = String(res.data.translation || "")
          .split(/\n+/)
          .filter(Boolean)
          .map((p) => `<p>${esc(p.trim())}</p>`)
          .join("");

        const transHtml = readerState.opts.translation && transParas
          ? `<div class="pdf-zh-card" data-reader-action="toggle-reveal">
              <span class="pdf-card-kicker">“ 整段意译</span>
              <div class="pdf-zh-body">${transParas}</div>
            </div>`
          : "";

        const focusHtml = readerState.opts.focus && res.data.focusSentence?.en
          ? `<div class="pdf-focus-card">
              <span class="pdf-card-kicker">焦点难句 · 信息结构</span>
              <p class="pdf-focus-en notranslate" translate="no" lang="en">${esc(res.data.focusSentence.en)}</p>
              <p class="pdf-focus-why">${esc(res.data.focusSentence.why || "")}</p>
              <div class="pdf-focus-actions">
                <button type="button" class="pdf-link-chip" data-reader-action="lookup-sentence" data-sentence="${esc(res.data.focusSentence.en)}">句子深拆 ↗</button>
                <button type="button" class="pdf-link-chip" data-reader-action="lookup-translate" data-sentence="${esc(res.data.focusSentence.en)}">多风格精翻 ↗</button>
              </div>
            </div>`
          : "";

        const sidenotesHtml = readerState.opts.notes && orderedNotes.length
          ? `<aside class="pdf-sidenotes">
              ${orderedNotes.map((item) => {
                const isSaved = bridge()?.isWordSaved?.(item.note.term);
                return `
                <div class="pdf-note-item" data-note-ref="n-${sec.secNum}-${item.num}" data-reader-action="toggle-note-reveal">
                  <span class="pdf-note-num">${item.num}</span>
                  <div class="pdf-note-head">
                    <button type="button" class="pdf-note-term pdf-note-term-btn" data-reader-action="lookup-note-term" data-term="${esc(item.note.term)}" title="在 talk. 中深入解析">${esc(item.note.term)}</button>
                    ${item.note.pos ? `<span class="pdf-note-pos">${esc(item.note.pos)}</span>` : ""}
                    <span class="pdf-note-zh">${esc(item.note.inContextZh || "")}</span>
                    <button type="button" class="pdf-note-save ${isSaved ? "saved" : ""}" data-reader-action="save-term" data-term="${esc(item.note.term)}" title="${isSaved ? "移出词册" : "收入 talk. 词册"}">${isSaved ? "✓ 已收" : "+ 词册"}</button>
                  </div>
                  ${item.note.nuance ? `<p class="pdf-note-nuance">${esc(item.note.nuance)}</p>` : ""}
                  ${item.note.chunk ? `<button type="button" class="pdf-note-chunk pdf-note-chunk-btn" data-reader-action="lookup-chunk" data-chunk="${esc(item.note.chunk)}" title="打开意群解析">${esc(item.note.chunk)}</button>` : ""}
                </div>
              `;
              }).join("")}
            </aside>`
          : "";

        spreadHtml = `
          <div class="pdf-spread">
            <div>
              ${sec.heading ? `<h2 class="pdf-heading">${esc(sec.heading)}</h2>` : ""}
              <div class="pdf-en-prose notranslate" translate="no" lang="en">${paraHtml}</div>
            </div>
            ${sidenotesHtml}
          </div>
        `;
        if (transHtml || focusHtml) {
          studySheetHtml = `
            <article class="pdf-sheet pdf-sheet--study" data-study-sheet="${sec.block.index}">
              <header class="pdf-masthead">
                <span class="pdf-brand">talk.</span>
                <span class="pdf-masthead-tag">${esc(themeTag)}</span>
              </header>
              <div class="pdf-sec-bar" style="margin-top:0;">
                <span class="pdf-sec-num">§${sec.secNum} 精析</span>
                <span class="pdf-sec-title">${esc(sec.heading || `第 ${sec.secNum} 节`)}</span>
                <span class="pdf-sec-rule"></span>
                <span class="pdf-sec-sub">TRANSLATION &amp; FOCUS</span>
              </div>
              <div class="pdf-study-stack">
                ${transHtml}
                ${focusHtml}
              </div>
              <footer class="pdf-foot">
                <span>把词，看透。</span>
                <span class="pdf-foot-right">
                  <button type="button" class="pdf-jump-btn" data-reader-action="jump-sheet" data-jump-target="text-${sec.block.index}">回正文 ↑</button>
                  <span class="pdf-foot-mono">WUNDERMIKU.GITHUB.IO/TALK · §${sec.secNum} 精析</span>
                </span>
              </footer>
            </article>
          `;
        }
      } else if (res.status === "error") {
        spreadHtml = `
          ${sec.heading ? `<h2 class="pdf-heading">${esc(sec.heading)}</h2>` : ""}
          <div class="pdf-en-prose notranslate" translate="no" lang="en">${sec.block.text.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("")}</div>
          <div class="pdf-block-state" style="margin-top:12px;">
            <span>本段精读失败：${esc(res.error || "网络或模型错误")}</span>
            <button type="button" class="reader-mini-btn reader-retry-btn" data-reader-action="retry-block" data-block-index="${sec.block.index}">重试本段</button>
          </div>
        `;
      } else {
        spreadHtml = `
          ${sec.heading ? `<h2 class="pdf-heading">${esc(sec.heading)}</h2>` : ""}
          <div class="pdf-en-prose notranslate" translate="no" lang="en">${sec.block.text.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("")}</div>
          <div class="pdf-block-state" style="margin-top:12px;">
            <span>正在结合全文语境精读本段…</span>
          </div>
        `;
      }

      const textSheetHtml = `
        <article class="pdf-sheet pdf-sheet--text" data-block-sheet="${sec.block.index}">
          <header class="pdf-masthead">
            <span class="pdf-brand">talk.</span>
            <span class="pdf-masthead-tag">${esc(themeTag)}</span>
          </header>
          <div class="pdf-sec-bar" style="margin-top:0;">
            <span class="pdf-sec-num">§${sec.secNum}</span>
            <span class="pdf-sec-title">${esc(sec.heading || `第 ${sec.secNum} 节`)}</span>
            <span class="pdf-sec-rule"></span>
            <button type="button" class="pdf-speak-btn" data-reader-action="speak-section" data-block-index="${sec.block.index}" aria-label="朗读本段英文" title="朗读本段英文">🔊 朗读</button>
            <span class="pdf-sec-sub">${sec.block.wordCount} WORDS</span>
          </div>
          ${spreadHtml}
          <footer class="pdf-foot">
            <span>把词，看透。</span>
            <span class="pdf-foot-right">
              ${studySheetHtml ? `<button type="button" class="pdf-jump-btn" data-reader-action="jump-sheet" data-jump-target="study-${sec.block.index}">本段精析 ↓</button>` : ""}
              <span class="pdf-foot-mono">WUNDERMIKU.GITHUB.IO/TALK · §${sec.secNum} 正文</span>
            </span>
          </footer>
        </article>
      `;
      return `${textSheetHtml}${studySheetHtml}`;
    }).join("");

    // Round-robin pick up to 3 cloze questions across sections for balanced recall
    const clozeCandidates = [];
    const secBuckets = [...clozeBySec.keys()].sort((a, b) => a - b).map((k) => clozeBySec.get(k));
    const usedSentences = new Set();
    let round = 0;
    while (clozeCandidates.length < 3 && secBuckets.some((b) => round < b.length)) {
      for (const bucket of secBuckets) {
        if (clozeCandidates.length >= 3) break;
        if (round < bucket.length) {
          const cand = bucket[round];
          if (!usedSentences.has(cand.sentence)) {
            usedSentences.add(cand.sentence);
            clozeCandidates.push(cand);
          }
        }
      }
      round += 1;
    }

    // Cover Sheet
    const ov = readerState.overview;
    const LEVEL_SWPM = {
      zhongkao: 38,
      gaokao: 44,
      cet4: 48,
      cet6: 55,
      kaoyan: 58,
      ielts: 68,
      toefl: 74
    };
    const levelId = bridge()?.getSentenceLevel?.() || doc.level || "cet6";
    const swpm = LEVEL_SWPM[levelId] || 55;
    const totalChars = passages.reduce((sum, p) => sum + String(p.text || "").length, 0);
    const stdWords = totalChars > 0 ? totalChars / 6 : doc.wordCount;
    const noteCount = readerState.opts.notes ? (allIndexTerms.length || sections.length * 4) : 0;
    const studyMin = (readerState.opts.translation || readerState.opts.focus) ? sections.length * 1.0 : 0;
    const recallMin = readerState.opts.appendix ? 1.5 : 0;
    const estMin = Math.max(4, Math.round(stdWords / swpm + noteCount * 0.35 + studyMin + recallMin));
    const coverHtml = readerState.opts.cover
      ? `<article class="pdf-sheet pdf-cover">
          <header class="pdf-masthead">
            <span class="pdf-brand">talk.</span>
            <span class="pdf-masthead-tag">${esc(themeTag)}</span>
          </header>
          <div class="pdf-cover-genre">${esc(ov ? `${ov.genre || "外刊精读"} · ${ov.tone || ""}` : "全文导读生成中…")}</div>
          <h1 class="pdf-cover-title-zh">${esc(ov?.titleZh || doc.title)}</h1>
          <p class="pdf-cover-title-en notranslate" translate="no" lang="en">${esc(doc.title)}</p>
          ${ov?.subtitle ? `<p class="pdf-cover-subtitle">${esc(ov.subtitle)}</p>` : ""}
          <p class="pdf-cover-meta">${doc.wordCount} 词 · ${sections.length} 节 · 约 ${estMin} 分钟精读 · 按 ${esc(levelLabel)} 取词</p>

          <div class="pdf-sec-bar">
            <span class="pdf-sec-num">01</span>
            <span class="pdf-sec-title">导读概览</span>
            <span class="pdf-sec-rule"></span>
            <span class="pdf-sec-sub">PRE-READING</span>
          </div>
          <div class="pdf-card">
            <span class="pdf-card-kicker">“ 整篇主旨</span>
            ${readerState.overviewState === "error" ? `<div class="pdf-block-state"><span>导读生成失败：${esc(readerState.overviewError)}</span><button type="button" class="reader-mini-btn reader-retry-btn" data-reader-action="retry-overview">重试导读</button></div>` : `<p class="pdf-summary-text">${esc(ov?.summary || "正在提炼全文主旨与跨段术语表…")}</p>`}
          </div>

          ${ov?.readingTips?.length ? `
            <div class="pdf-sec-bar">
              <span class="pdf-sec-num">02</span>
              <span class="pdf-sec-title">精读前提示</span>
              <span class="pdf-sec-rule"></span>
              <span class="pdf-sec-sub">NOTICING CUES</span>
            </div>
            <ul class="pdf-tips">${ov.readingTips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
          ` : ""}

          ${ov?.glossary?.length ? `
            <div class="pdf-sec-bar">
              <span class="pdf-sec-num">03</span>
              <span class="pdf-sec-title">全篇统一术语</span>
              <span class="pdf-sec-rule"></span>
              <span class="pdf-sec-sub">GLOBAL GLOSSARY</span>
            </div>
            <div class="pdf-glossary-grid">
              ${ov.glossary.slice(0, 6).map((g) => `
                <div class="pdf-glossary-item">
                  <div class="pdf-glossary-head">
                    <span class="pdf-glossary-en">${esc(g.term)}</span>
                    <span class="pdf-glossary-zh">${esc(g.zh)}</span>
                  </div>
                  ${g.note ? `<p class="pdf-glossary-note">${esc(g.note)}</p>` : ""}
                </div>
              `).join("")}
            </div>
          ` : ""}

          <footer class="pdf-foot">
            <span>把词，看透。</span>
            <span class="pdf-foot-mono">WUNDERMIKU.GITHUB.IO/TALK · 导读</span>
          </footer>
        </article>`
      : "";

    // Post-Reading Sheets: (1) Lexical Index + Simplification Map, (2) Active Recall + Cornell Summary
    const appendixHtml = readerState.opts.appendix && allIndexTerms.length
      ? `<article class="pdf-sheet pdf-appendix pdf-appendix--index">
          <header class="pdf-masthead">
            <span class="pdf-brand">talk.</span>
            <span class="pdf-masthead-tag">${esc(themeTag)}</span>
          </header>

          <div class="pdf-sec-bar" style="margin-top:0;">
            <span class="pdf-sec-num">04</span>
            <span class="pdf-sec-title">全篇语块与词眼总表</span>
            <span class="pdf-sec-rule"></span>
            <span class="pdf-sec-sub">LEXICAL INDEX</span>
          </div>
          <div class="pdf-appendix-list">
            ${allIndexTerms.map((item) => `
              <div class="pdf-appendix-item">
                <div class="pdf-appendix-top">
                  <span class="pdf-appendix-term">${esc(item.term)}</span>
                  <span class="pdf-appendix-sec">§${item.sec}</span>
                </div>
                <div class="pdf-appendix-zh">${esc(item.inContextZh || "")}</div>
                ${item.chunk ? `<div class="pdf-appendix-chunk">${esc(item.chunk)}</div>` : ""}
              </div>
            `).join("")}
          </div>

          ${allReplacements.length ? `
            <div class="pdf-sec-bar">
              <span class="pdf-sec-num">原</span>
              <span class="pdf-sec-title">降阶原词还原表</span>
              <span class="pdf-sec-rule"></span>
              <span class="pdf-sec-sub">SIMPLIFICATION MAP</span>
            </div>
            <div class="pdf-appendix-list">
              ${allReplacements.map((rep) => `
                <div class="pdf-appendix-item">
                  <div class="pdf-appendix-top">
                    <span class="pdf-appendix-term">${esc(rep.simplified)}<span class="pdf-replace-arrow">→</span>${esc(rep.original)}</span>
                    <span class="pdf-appendix-sec">§${rep.sec}</span>
                  </div>
                  ${rep.note ? `<div class="pdf-appendix-chunk">${esc(rep.note)}</div>` : ""}
                </div>
              `).join("")}
            </div>
          ` : ""}

          <footer class="pdf-foot">
            <span>把词，看透。</span>
            <span class="pdf-foot-mono">WUNDERMIKU.GITHUB.IO/TALK · 词表</span>
          </footer>
        </article>
        <article class="pdf-sheet pdf-appendix pdf-appendix--recall">
          <header class="pdf-masthead">
            <span class="pdf-brand">talk.</span>
            <span class="pdf-masthead-tag">${esc(themeTag)}</span>
          </header>

          ${clozeCandidates.length ? `
            <div class="pdf-sec-bar" style="margin-top:0;">
              <span class="pdf-sec-num">05</span>
              <span class="pdf-sec-title">30 秒语块回放自测</span>
              <span class="pdf-sec-rule"></span>
              <span class="pdf-sec-sub">ACTIVE RECALL</span>
            </div>
            <div class="pdf-cloze-list">
              ${clozeCandidates.map((c, idx) => {
                const blanked = esc(c.sentence).replace(
                  new RegExp(escapeRegex(esc(c.answer)), "i"),
                  `<span class="pdf-cloze-blank" data-reader-action="toggle-cloze" data-answer="${esc(c.answer)}" data-open="0">________</span>`
                );
                return `
                  <div class="pdf-cloze-item">
                    <p class="pdf-cloze-en">${idx + 1}. ${blanked}</p>
                    <div class="pdf-cloze-foot">
                      <span>提示：${esc(c.hint)}</span>
                      <button type="button" class="reader-mini-btn pdf-cloze-reveal" data-reader-action="toggle-cloze-btn" data-answer="${esc(c.answer)}">核对答案</button>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          ` : ""}

          <div class="pdf-sec-bar" ${clozeCandidates.length ? "" : 'style="margin-top:0;"'}>
            <span class="pdf-sec-num">06</span>
            <span class="pdf-sec-title">我的一句话笔记</span>
            <span class="pdf-sec-rule"></span>
            <span class="pdf-sec-sub">CORNELL SUMMARY</span>
          </div>
          ${allIndexTerms.length >= 2 ? `<p class="pdf-cornell-prompt">微型仿写：试着用本篇任意 2 个词眼（如 <strong>${allIndexTerms.slice(0, 3).map((t) => esc(t.term)).join("</strong> · <strong>")}</strong>）用英文写一句总结或造句。</p>` : ""}
          <div class="pdf-cornell-lines" aria-hidden="true">
            <div class="pdf-cornell-line"></div>
            <div class="pdf-cornell-line"></div>
            <div class="pdf-cornell-line"></div>
          </div>
          ${clozeCandidates.length ? `<div class="pdf-print-key">KEY: ${clozeCandidates.map((c, i) => `${i + 1}. ${esc(c.answer)}`).join(" · ")}</div>` : ""}

          <footer class="pdf-foot">
            <span>把词，看透。</span>
            <span class="pdf-foot-mono">WUNDERMIKU.GITHUB.IO/TALK · 自测与笔记</span>
          </footer>
        </article>`
      : "";

    const hasAnySimplified = [...readerState.blockResults.values()].some((v) => isValidEnglishSimplified(v?.data?.simplifiedText));
    const modalHtml = `
      <div class="reader-modal-backdrop" id="reader-export-modal" ${readerState.modalOpen ? "" : "hidden"}>
        <div class="reader-modal-sheet" role="dialog" aria-modal="true" aria-label="导出精读本选项">
          <div class="reader-modal-head">
            <span class="reader-modal-title">导出精读本（A4 矢量 PDF）</span>
            <button type="button" class="reader-back-btn" data-reader-action="close-modal">关闭</button>
          </div>
          <div class="reader-pill-grid">
            <button type="button" class="reader-opt-pill ${readerState.opts.cover ? "active" : ""}" data-reader-action="toggle-opt" data-opt="cover">封面导读</button>
            <button type="button" class="reader-opt-pill ${readerState.opts.translation ? "active" : ""}" data-reader-action="toggle-opt" data-opt="translation">整段意译</button>
            <button type="button" class="reader-opt-pill ${readerState.opts.focus ? "active" : ""}" data-reader-action="toggle-opt" data-opt="focus">焦点难句</button>
            <button type="button" class="reader-opt-pill ${readerState.opts.notes ? "active" : ""}" data-reader-action="toggle-opt" data-opt="notes">侧边词注</button>
            <button type="button" class="reader-opt-pill ${readerState.opts.appendix ? "active" : ""}" data-reader-action="toggle-opt" data-opt="appendix">自测与总表</button>
            <button type="button" class="reader-opt-pill ${readerState.opts.bindingMargin ? "active" : ""}" data-reader-action="toggle-opt" data-opt="bindingMargin">左侧装订边</button>
          </div>
          <p class="reader-modal-hint">打印弹窗中请勾选「背景图形」，即可完整保留当前主题（${esc(themeTag.split(" · ")[0])}）的纸底与高亮。</p>
          <div class="reader-modal-actions">
            <button type="button" class="reader-ghost-btn" data-reader-action="rerun-doc">重新精读</button>
            <button type="button" class="reader-primary-btn" data-reader-action="do-print">打印 / 存为 PDF</button>
          </div>
        </div>
      </div>
    `;

    return `
      <div class="reader-chrome">
        ${bridge()?.homeTopbar?.() || ""}
        <div class="reader-topbar">
          <div class="reader-topbar-left">
            <button type="button" class="reader-back-btn" data-reader-action="back-input">← 换一篇</button>
            <span class="reader-progress-chip">${doneCount} / ${passages.length}</span>
          </div>
          <div class="reader-topbar-right">
            ${hasAnySimplified ? `<button type="button" class="reader-mini-btn ${readerState.showSimplified ? "active" : ""}" data-reader-action="toggle-show-simplified">${readerState.showSimplified ? "降阶版" : "原文版"}</button>` : ""}
            <button type="button" class="reader-mini-btn ${readerState.focusEn ? "active" : ""}" data-reader-action="toggle-focus-en">${readerState.focusEn ? "已遮译文" : "专注英文"}</button>
            <button type="button" class="reader-export-btn" data-reader-action="open-modal">导出 PDF</button>
          </div>
        </div>
        ${pct < 100 ? `<div class="reader-progress-bar"><div class="reader-progress-fill" style="width:${pct}%"></div></div>` : ""}
      </div>
      <section class="reader-doc-wrap ${readerState.focusEn ? "reader-focus-en" : ""} ${readerState.opts.bindingMargin ? "reader-binding-margin" : ""}">
        <div class="pdf-root">
          ${coverHtml}
          ${sectionSheetsHtml}
          ${appendixHtml}
        </div>
        <footer class="pdf-print-running-foot" aria-hidden="true">
          <span>把词，看透。</span>
          <span class="pdf-foot-mono">WUNDERMIKU.GITHUB.IO/TALK · ${esc(themeTag)}</span>
        </footer>
        ${modalHtml}
      </section>
      <div class="reader-lookup-dock" id="reader-lookup-dock" hidden role="region" aria-label="划词与点词联动栏" data-detent="compact">
        <div class="reader-dock-handle" id="reader-dock-handle" role="separator" aria-orientation="horizontal" aria-label="上下拖动缩放查询栏高度" title="上拉展开完整词条，下拉收起">
          <span class="reader-dock-grip" aria-hidden="true"></span>
        </div>
        <div class="reader-dock-body" id="reader-dock-body">
          <div class="reader-dock-gloss" id="reader-dock-gloss" hidden></div>
          <div class="reader-dock-expanded" id="reader-dock-expanded" hidden></div>
        </div>
        <div class="reader-dock-bar">
          <div class="reader-dock-left">
            <button type="button" class="reader-dock-step" data-reader-action="dock-expand-left" title="向左扩选一个词">←</button>
            <span class="reader-dock-phrase notranslate" id="reader-dock-phrase" translate="no" lang="en"></span>
            <button type="button" class="reader-dock-step" data-reader-action="dock-expand-right" title="向右扩选一个词">→</button>
          </div>
          <div class="reader-dock-actions">
            <button type="button" class="reader-dock-btn" data-reader-action="dock-word">查词</button>
            <button type="button" class="reader-dock-btn" data-reader-action="dock-chunk">意群</button>
            <button type="button" class="reader-dock-btn" data-reader-action="dock-sentence">拆这句</button>
            <button type="button" class="reader-dock-close" data-reader-action="dock-close" aria-label="关闭">×</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderIntoScreen() {
    const screen = document.getElementById("screen");
    if (!screen || screen.dataset.page !== "reader") return;
    screen.innerHTML = readerState.view === "doc" ? renderDocView() : renderInputPage();
    bindReaderDom(screen);
  }

  /* ---------- Two-Stage Pipeline & Concurrency Pool ---------- */
  async function runDocPipeline(doc, { force = false } = {}) {
    const b = bridge();
    if (!b || !b.hasModelConfig()) {
      b?.toast?.("请先在设置中配置模型 API Key，或点「载入外刊示例」离线体验");
      return;
    }

    readerState.abortController?.abort();
    const ac = new AbortController();
    readerState.abortController = ac;
    const seq = ++readerState.runSeq;
    const level = b.getSentenceLevel?.() || "cet6";

    readerState.doc = doc;
    readerState.view = "doc";
    readerState.overview = null;
    readerState.overviewState = "loading";
    readerState.overviewError = "";
    readerState.blockResults = new Map();

    // Stage A: Overview (check cache first)
    const cachedDoc = force ? null : await dbGetDoc(doc.docHash);
    if (cachedDoc?.overview) {
      readerState.overview = cachedDoc.overview;
      readerState.overviewState = "done";
    }

    const passages = doc.blocks.filter((blk) => blk.type === "passage");
    for (const p of passages) {
      const cachedBlk = force ? null : await dbGetBlock(doc.docHash, p.hash);
      if (cachedBlk?.data) {
        readerState.blockResults.set(p.index, { status: "done", data: cachedBlk.data });
      } else {
        readerState.blockResults.set(p.index, { status: "loading" });
      }
    }
    renderIntoScreen();

    if (readerState.overviewState !== "done") {
      try {
        const allText = passages.map((p) => p.text).join("\n\n");
        const words = allText.split(/\s+/);
        const excerpt = words.length > 2400
          ? `${words.slice(0, 1700).join(" ")}\n\n[...]\n\n${words.slice(-700).join(" ")}`
          : allText;

        const ov = await b.callModelJSON(
          window.TALK_PROMPTS.docOverview,
          { task: "docOverview", title: doc.title, excerpt },
          { signal: ac.signal, maxTokens: 2600 }
        );
        if (seq !== readerState.runSeq) return;
        readerState.overview = ov;
        readerState.overviewState = "done";
        await dbPutDoc({ ...doc, level, overview: ov, updatedAt: Date.now() });
        readerState.recentDocs = await dbListDocs();
        renderIntoScreen();
      } catch (err) {
        if (err?.name === "AbortError" || seq !== readerState.runSeq) return;
        readerState.overviewState = "error";
        readerState.overviewError = err?.message || "请求失败";
        renderIntoScreen();
      }
    } else {
      await dbPutDoc({ ...doc, level, overview: readerState.overview, updatedAt: Date.now() });
      readerState.recentDocs = await dbListDocs();
    }

    // Stage B: Concurrent block processing (MAX_CONCURRENCY = 3)
    const pending = passages.filter((p) => readerState.blockResults.get(p.index)?.status !== "done");
    let cursor = 0;

    const worker = async () => {
      while (cursor < pending.length) {
        if (seq !== readerState.runSeq || ac.signal.aborted) return;
        const blk = pending[cursor++];
        await processSingleBlock(doc, blk, level, seq, ac.signal);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENCY, pending.length) }, () => worker())
    );
  }

  async function processSingleBlock(doc, blk, level, seq, signal) {
    const b = bridge();
    const globalContext = {
      tone: readerState.overview?.tone || "",
      glossary: (readerState.overview?.glossary || []).map((g) => ({ term: g.term, zh: g.zh }))
    };
    try {
      const payload = {
        task: "docBlock",
        level,
        simplify: readerState.simplifyOnInput,
        ...(readerState.simplifyOnInput ? { simplifyLanguageRule: "simplifiedText MUST stay strictly in English (never translate to Chinese); only replace a few hard English words with simpler English equivalents." } : {}),
        globalContext,
        text: blk.text
      };
      const rawData = await b.callModelJSON(
        window.TALK_PROMPTS.docBlock,
        payload,
        { signal, maxTokens: 4096 }
      );
      if (seq !== readerState.runSeq) return;
      const data = sanitizeBlockData(rawData);
      readerState.blockResults.set(blk.index, { status: "done", data });
      await dbPutBlock(doc.docHash, blk.hash, blk.index, data);
      renderIntoScreen();
    } catch (err) {
      if (err?.name === "AbortError" || seq !== readerState.runSeq) return;
      readerState.blockResults.set(blk.index, { status: "error", error: err?.message || "请求失败" });
      renderIntoScreen();
    }
  }

  async function loadBuiltinSample() {
    const level = bridge()?.getSentenceLevel?.() || "cet6";
    const doc = window.TALK_DOC_PARSER.parseText(BUILTIN_SAMPLE_RAW, { titleHint: "The Quiet Architecture of Frictionless Convenience", level });
    readerState.abortController?.abort();
    readerState.runSeq += 1;
    readerState.doc = doc;
    readerState.overview = BUILTIN_SAMPLE_OVERVIEW;
    readerState.overviewState = "done";
    readerState.blockResults = new Map();
    const passages = doc.blocks.filter((b) => b.type === "passage");
    passages.forEach((p, idx) => {
      const sampleData = BUILTIN_SAMPLE_BLOCKS[idx];
      if (sampleData) readerState.blockResults.set(p.index, { status: "done", data: sampleData });
    });
    readerState.view = "doc";
    renderIntoScreen();
    bridge()?.toast?.("已载入外刊精读示例（免 API Key）");
  }

  async function openRecentDoc(docHash) {
    const stored = await dbGetDoc(docHash);
    if (!stored) return;
    readerState.abortController?.abort();
    readerState.runSeq += 1;
    readerState.doc = stored;
    readerState.overview = stored.overview || null;
    readerState.overviewState = stored.overview ? "done" : "idle";
    readerState.blockResults = new Map();
    const passages = (stored.blocks || []).filter((b) => b.type === "passage");
    for (const p of passages) {
      const blk = await dbGetBlock(stored.docHash, p.hash);
      if (blk?.data) readerState.blockResults.set(p.index, { status: "done", data: blk.data });
      else readerState.blockResults.set(p.index, { status: "error", error: "尚未生成，点击重试" });
    }
    readerState.view = "doc";
    renderIntoScreen();
  }

  /* ---------- DOM Binding inside #screen ---------- */
  const quickGlossCache = new Map();
  const dockState = {
    paraEl: null,
    startIdx: -1,
    endIdx: -1,
    phrase: "",
    sentence: "",
    glossMode: "word",
    glossSeq: 0,
    glossAbort: null
  };

  function clearPickedWords(root) {
    root.querySelectorAll(".pdf-w.is-picked").forEach((el) => el.classList.remove("is-picked"));
  }

  function hideLookupDock(root) {
    clearPickedWords(root);
    dockState.glossAbort?.abort();
    dockState.glossAbort = null;
    dockState.paraEl = null;
    dockState.startIdx = -1;
    dockState.endIdx = -1;
    dockState.phrase = "";
    dockState.sentence = "";
    const dock = root.querySelector("#reader-lookup-dock");
    const gloss = root.querySelector("#reader-dock-gloss");
    if (gloss) { gloss.hidden = true; gloss.innerHTML = ""; }
    const exp = root.querySelector("#reader-dock-expanded");
    if (exp) { exp.hidden = true; exp.innerHTML = ""; exp.dataset.loadedKey = ""; }
    dock.dataset.detent = "compact";
    dock.style.height = "";
    if (dock) {
      dock.hidden = true;
      dock.dataset.detent = "compact";
      dock.style.height = "";
      dock.classList.remove("is-dragging");
      const exp = root.querySelector("#reader-dock-expanded");
      if (exp) { exp.hidden = true; exp.innerHTML = ""; exp.dataset.loadedKey = ""; }
    }
  }

  function findLocalContextualGloss(phrase) {
    const target = String(phrase || "").trim().toLowerCase();
    if (!target) return null;
    for (const res of readerState.blockResults.values()) {
      for (const n of (res?.data?.notes || [])) {
        const nt = String(n.term || "").trim().toLowerCase();
        if (nt === target || nt.includes(target) || target.includes(nt)) {
          return { pos: n.pos || "", inContextZh: n.inContextZh || "", nuance: n.nuance || "", chunk: n.chunk || "" };
        }
      }
    }
    for (const g of (readerState.overview?.glossary || [])) {
      const gt = String(g.term || "").trim().toLowerCase();
      if (gt === target || gt.includes(target)) {
        return { pos: "term", inContextZh: g.zh || "", nuance: g.note || "", chunk: "" };
      }
    }
    return null;
  }

  function renderDockGlossCard(root, { phrase, mode, status, data, error }) {
    const box = root.querySelector("#reader-dock-gloss");
    if (!box) return;
    if (status === "loading") {
      box.hidden = false;
    const dockEl = root.querySelector("#reader-lookup-dock");
    if (dockEl && dockEl.dataset.detent === "compact") {
      dockEl.dataset.detent = "half";
      dockEl.style.height = "";
    }
      box.innerHTML = `<div class="reader-dock-gloss-loading">正在结合本句语境速查「${esc(phrase)}」…</div>`;
      syncDockGeometry(root);
      return;
    }
    if (status === "error") {
      box.hidden = false;
      box.innerHTML = `
        <div class="reader-dock-gloss-head">
          <span class="reader-dock-gloss-err">${esc(error || "语境速查失败")}</span>
          <button type="button" class="reader-dock-deep" data-reader-action="dock-deep">深入解析 ↗</button>
        </div>
      `;
      syncDockGeometry(root);
      return;
    }
    const isSaved = bridge()?.isWordSaved?.(phrase);
    box.hidden = false;
    box.innerHTML = `
      <div class="reader-dock-gloss-head">
        <div class="reader-dock-gloss-main">
          <span class="reader-dock-gloss-term notranslate" translate="no" lang="en">${esc(phrase)}</span>
          ${data.pos ? `<span class="pdf-note-pos">${esc(data.pos)}</span>` : ""}
          <span class="reader-dock-gloss-zh">${esc(data.inContextZh || "")}</span>
        </div>
        <div class="reader-dock-gloss-tools">
          <button type="button" class="pdf-note-save ${isSaved ? "saved" : ""}" data-reader-action="save-term" data-term="${esc(phrase)}">${isSaved ? "✓ 已收" : "+ 词册"}</button>
          <button type="button" class="reader-dock-deep" data-reader-action="dock-deep">${mode === "chunk" || phrase.includes(" ") ? "完整意群 ↗" : "完整词条 ↗"}</button>
        </div>
      </div>
      ${(data.nuance || data.chunk) ? `
        <div class="reader-dock-gloss-sub">
          ${data.nuance ? `<span class="reader-dock-gloss-nuance">${esc(data.nuance)}</span>` : ""}
          ${data.chunk ? `<span class="reader-dock-gloss-chunk notranslate" translate="no" lang="en">${esc(data.chunk)}</span>` : ""}
        </div>
      ` : ""}
    `;
    syncDockGeometry(root);
  }

  async function runDockQuickGloss(root, mode) {
    const phrase = dockState.phrase;
    const sentence = dockState.sentence || phrase;
    if (!phrase) return;
    dockState.glossMode = mode;
    const cacheKey = `${mode}|${phrase.toLowerCase()}|${sentence.slice(0, 120)}`;
    if (quickGlossCache.has(cacheKey)) {
      renderDockGlossCard(root, { phrase, mode, status: "done", data: quickGlossCache.get(cacheKey) });
      return;
    }
    const b = bridge();
    if (!b?.hasModelConfig?.()) {
      const localHit = findLocalContextualGloss(phrase);
      if (localHit) {
        quickGlossCache.set(cacheKey, localHit);
        renderDockGlossCard(root, { phrase, mode, status: "done", data: localHit });
      } else {
        renderDockGlossCard(root, { phrase, mode, status: "error", error: "尚未配置模型 API，可点右侧打开内置词库" });
      }
      return;
    }
    dockState.glossAbort?.abort();
    const ac = new AbortController();
    dockState.glossAbort = ac;
    const seq = ++dockState.glossSeq;
    renderDockGlossCard(root, { phrase, mode, status: "loading" });
    try {
      const data = await b.callModelJSON(
        window.TALK_PROMPTS.docQuickGloss,
        { task: "docQuickGloss", mode, term: phrase, sentence },
        { signal: ac.signal, maxTokens: 360 }
      );
      if (seq !== dockState.glossSeq) return;
      quickGlossCache.set(cacheKey, data);
      renderDockGlossCard(root, { phrase, mode, status: "done", data });
    } catch (err) {
      if (err?.name === "AbortError" || seq !== dockState.glossSeq) return;
      const raw = String(err?.message || "");
      const friendly = /HTTP\s*\d{3}/.test(raw)
        ? "语境速查暂时失败，可点「深入解析」查看完整词条。"
        : (raw || "速查请求失败");
      renderDockGlossCard(root, { phrase, mode, status: "error", error: friendly });
    }
  }

  function syncDockGeometry(root) {
    const dock = root?.querySelector("#reader-lookup-dock");
    if (!dock || dock.hidden) return;
    const rect = root.getBoundingClientRect();
    dock.style.left = `${Math.max(0, Math.round(rect.left))}px`;
    dock.style.width = `${Math.round(rect.width)}px`;
  }

  function updateLookupDock(root, { phrase, sentence, anchorEl } = {}) {
    const dock = root.querySelector("#reader-lookup-dock");
    const label = root.querySelector("#reader-dock-phrase");
    if (!dock || !label || !phrase) return;
    dockState.phrase = phrase;
    dockState.sentence = sentence || phrase;
    label.textContent = phrase;
    const gloss = root.querySelector("#reader-dock-gloss");
    if (gloss) { gloss.hidden = true; gloss.innerHTML = ""; }
    dock.hidden = false;
    syncDockGeometry(root);

    if (anchorEl && typeof anchorEl.getBoundingClientRect === "function") {
      const rect = anchorEl.getBoundingClientRect();
      const safeBottom = window.innerHeight - 78;
      if (rect.bottom > safeBottom) {
        const delta = rect.bottom - (window.innerHeight - 104);
        if (typeof root.scrollBy === "function") {
          root.scrollBy({ top: delta, behavior: "smooth" });
        }
      }
    }
  }

  function applyWordRangeSelection(root) {
    clearPickedWords(root);
    if (!dockState.paraEl || dockState.startIdx < 0) return;
    const words = [...dockState.paraEl.querySelectorAll(".pdf-w")];
    const picked = [];
    let anchor = null;
    for (const w of words) {
      const idx = Number(w.dataset.wi);
      if (idx >= dockState.startIdx && idx <= dockState.endIdx) {
        w.classList.add("is-picked");
        picked.push(w.textContent.trim());
        anchor = w;
      }
    }
    const phrase = picked.join(" ").trim();
    if (!phrase) return;
    const sentence = extractSentenceForWord(dockState.paraEl, phrase, anchor);
    updateLookupDock(root, { phrase, sentence, anchorEl: anchor });
  }

  function bindReaderDom(root) {
    const ta = root.querySelector("#reader-textarea");
    const stat = root.querySelector("#reader-word-stat");
    if (ta && stat) {
      ta.addEventListener("input", () => {
        stat.textContent = `${window.TALK_DOC_PARSER.countWords(ta.value)} 词`;
      });
    }

    const fileInput = root.querySelector("#reader-file-input");
    if (fileInput) {
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        try {
          const level = bridge()?.getSentenceLevel?.() || "cet6";
          const doc = await window.TALK_DOC_PARSER.parseFile(file, { level });
          await runDocPipeline(doc);
        } catch (err) {
          bridge()?.toast?.(err?.message || "文件读取失败");
        }
      });
    }

    // Cross-highlighting between English term & right-column sidenote
    const setLinked = (ref) => {
      root.querySelectorAll(".linked").forEach((el) => el.classList.remove("linked"));
      if (!ref) return;
      root.querySelectorAll(`[data-note-ref="${ref}"]`).forEach((el) => el.classList.add("linked"));
    };
    root.querySelectorAll("[data-note-ref]").forEach((el) => {
      el.addEventListener("mouseenter", () => setLinked(el.dataset.noteRef));
      el.addEventListener("mouseleave", () => setLinked(null));
      el.addEventListener("click", () => {
        const already = el.classList.contains("linked");
        setLinked(already ? null : el.dataset.noteRef);
      });
    });

    if (root.dataset.readerClickBound === "1") return;
    root.dataset.readerClickBound = "1";

    /* --- 1. Long-press (220ms) + Slide-to-Select across .pdf-en-prose .pdf-w --- */
    let swipeTimer = 0;
    let swiping = false;
    let swipeAnchorEl = null;
    let swipeParaEl = null;
    let swipeAnchorIdx = -1;
    let swipeStartX = 0;
    let swipeStartY = 0;
    let lastSwipeEndAt = 0;

    function cancelSwipeTimer() {
      if (swipeTimer) {
        window.clearTimeout(swipeTimer);
        swipeTimer = 0;
      }
    }

    function updateSwipeAtPoint(clientX, clientY) {
      if (!swiping || !swipeParaEl) return;
      const el = document.elementFromPoint(clientX, clientY);
      const wordEl = el?.closest?.(".pdf-en-prose .pdf-w");
      if (!wordEl || wordEl.closest("p") !== swipeParaEl) return;
      const wi = Number(wordEl.dataset.wi);
      if (!Number.isFinite(wi)) return;
      const nextStart = Math.min(swipeAnchorIdx, wi);
      const nextEnd = Math.max(swipeAnchorIdx, wi);
      if (nextStart !== dockState.startIdx || nextEnd !== dockState.endIdx) {
        dockState.paraEl = swipeParaEl;
        dockState.startIdx = nextStart;
        dockState.endIdx = nextEnd;
        applyWordRangeSelection(root);
      }
    }

    function finishSwipe() {
      cancelSwipeTimer();
      if (!swiping) return;
      swiping = false;
      lastSwipeEndAt = Date.now();
      root.classList.remove("is-swipe-selecting");
      const phrase = dockState.phrase;
      swipeAnchorEl = null;
      swipeParaEl = null;
      swipeAnchorIdx = -1;
      if (phrase) {
        const mode = phrase.includes(" ") ? "chunk" : "word";
        void runDockQuickGloss(root, mode);
      }
    }

    root.addEventListener("touchstart", (e) => {
      if (root.dataset.page !== "reader" || e.touches.length !== 1) return;
      const wordEl = e.target.closest(".pdf-en-prose .pdf-w");
      if (!wordEl) return;
      const paraEl = wordEl.closest("p");
      const wi = Number(wordEl.dataset.wi);
      if (!paraEl || !Number.isFinite(wi)) return;
      const t = e.touches[0];
      swipeStartX = t.clientX;
      swipeStartY = t.clientY;
      swipeAnchorEl = wordEl;
      swipeParaEl = paraEl;
      swipeAnchorIdx = wi;
      cancelSwipeTimer();
      swipeTimer = window.setTimeout(() => {
        swiping = true;
        root.classList.add("is-swipe-selecting");
        try { navigator.vibrate?.(12); } catch (_) { /* ignore */ }
        dockState.paraEl = swipeParaEl;
        dockState.startIdx = swipeAnchorIdx;
        dockState.endIdx = swipeAnchorIdx;
        applyWordRangeSelection(root);
      }, 220);
    }, { passive: true });

    root.addEventListener("touchmove", (e) => {
      if (root.dataset.page !== "reader" || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (!swiping) {
        if (swipeTimer && (Math.hypot(t.clientX - swipeStartX, t.clientY - swipeStartY) > 10)) {
          cancelSwipeTimer();
        }
        return;
      }
      e.preventDefault();
      updateSwipeAtPoint(t.clientX, t.clientY);
    }, { passive: false });

    root.addEventListener("touchend", finishSwipe, { passive: true });
    root.addEventListener("touchcancel", () => {
      cancelSwipeTimer();
      swiping = false;
      root.classList.remove("is-swipe-selecting");
    }, { passive: true });

    root.addEventListener("contextmenu", (e) => {
      if (swiping || Date.now() - lastSwipeEndAt < 450) {
        if (e.target.closest(".pdf-en-prose")) e.preventDefault();
      }
    });

    /* --- 2. Resizable 3-Detent Bottom Sheet (#reader-lookup-dock) --- */
    let draggingDock = false;
    let dragStartY = 0;
    let dragStartH = 0;
    let lastHandleTap = 0;

    function renderExpandedEntryHtml(kind, data) {
      if (!data) return '<p class="reader-exp-empty">未配置模型且本地无此词条缓存。</p>';
      if (kind === "chunk") {
        const senses = (data.senses || []).slice(0, 3);
        const examples = (data.examples || []).slice(0, 2);
        const kws = (data.keyWords || []).slice(0, 3);
        return `
          <div class="reader-exp-sec">
            <div class="reader-exp-head">
              <strong class="notranslate" translate="no" lang="en">${esc(data.chunk || "")}</strong>
              ${data.phonetic ? `<span class="reader-exp-ipa">${esc(data.phonetic)}</span>` : ""}
            </div>
            ${data.translation ? `<p class="reader-exp-zh">${esc(data.translation)}</p>` : ""}
            ${data.short ? `<p class="reader-exp-en">${esc(data.short)}</p>` : ""}
          </div>
          ${senses.length ? `<div class="reader-exp-sec"><span class="reader-exp-lbl">释义</span><ul class="reader-exp-list">${senses.map((x) => `<li><strong>${esc(x.zh || "")}</strong>${x.when ? ` <span>· ${esc(x.when)}</span>` : ""}${x.en ? `<div class="reader-exp-sub">${esc(x.en)}</div>` : ""}</li>`).join("")}</ul></div>` : ""}
          ${kws.length ? `<div class="reader-exp-sec"><span class="reader-exp-lbl">词眼</span><ul class="reader-exp-list">${kws.map((k) => `<li><strong class="notranslate" translate="no" lang="en">${esc(k.word || "")}</strong> <span>${esc(k.gloss || "")}${k.why ? ` · ${esc(k.why)}` : ""}</span></li>`).join("")}</ul></div>` : ""}
          ${examples.length ? `<div class="reader-exp-sec"><span class="reader-exp-lbl">例句</span>${examples.map((ex) => `<div class="reader-exp-ex"><p class="notranslate" translate="no" lang="en">${esc(ex.en || "")}</p><p class="reader-exp-ex-zh">${esc(ex.zh || "")}</p></div>`).join("")}</div>` : ""}
          ${data.note ? `<div class="reader-exp-sec"><span class="reader-exp-lbl">提示</span><p class="reader-exp-note">${esc(data.note)}</p></div>` : ""}`;
      }
      const groups = (data.posGroups || []).slice(0, 3);
      const examples = (data.examples || []).slice(0, 2);
      const collocs = (data.collocations || []).slice(0, 5);
      const family = (data.family || []).slice(0, 4);
      return `
        <div class="reader-exp-sec">
          <div class="reader-exp-head">
            <strong class="notranslate" translate="no" lang="en">${esc(data.word || "")}</strong>
            ${data.phonetic ? `<span class="reader-exp-ipa">${esc(data.phonetic)}</span>` : ""}
            ${data.level && data.level !== "—" ? `<span class="reader-exp-tag">${esc(data.level)}</span>` : ""}
          </div>
          ${data.translation ? `<p class="reader-exp-zh">${esc(data.translation)}</p>` : ""}
          ${data.short ? `<p class="reader-exp-en">${esc(data.short)}</p>` : ""}
        </div>
        ${groups.length ? `<div class="reader-exp-sec"><span class="reader-exp-lbl">词义</span><ul class="reader-exp-list">${groups.map((g) => (g.senses || []).slice(0, 2).map((x) => `<li>${g.pos ? `<code class="reader-exp-pos">${esc(g.pos)}</code> ` : ""}<strong>${esc(x.zh || "")}</strong>${x.en ? `<div class="reader-exp-sub">${esc(x.en)}</div>` : ""}</li>`).join("")).join("")}</ul></div>` : ""}
        ${collocs.length ? `<div class="reader-exp-sec"><span class="reader-exp-lbl">常见搭配</span><div class="reader-exp-chips">${collocs.map((c) => `<span class="reader-exp-chip notranslate" translate="no" lang="en">${esc(c)}</span>`).join("")}</div></div>` : ""}
        ${examples.length ? `<div class="reader-exp-sec"><span class="reader-exp-lbl">例句</span>${examples.map((ex) => `<div class="reader-exp-ex"><p class="notranslate" translate="no" lang="en">${esc(ex.en || "")}</p><p class="reader-exp-ex-zh">${esc(ex.zh || "")}</p></div>`).join("")}</div>` : ""}
        ${family.length ? `<div class="reader-exp-sec"><span class="reader-exp-lbl">同根词</span><div class="reader-exp-chips">${family.map((f) => `<span class="reader-exp-chip"><b class="notranslate" translate="no" lang="en">${esc(f.word)}</b> ${esc(f.gloss || "")}</span>`).join("")}</div></div>` : ""}
        ${data.origin?.story ? `<div class="reader-exp-sec"><span class="reader-exp-lbl">词源</span><p class="reader-exp-note">${esc(data.origin.story)}</p></div>` : ""}
        ${data.note ? `<div class="reader-exp-sec"><span class="reader-exp-lbl">附注</span><p class="reader-exp-note">${esc(data.note)}</p></div>` : ""}`;
    }

    async function loadExpandedDockDetail(dock) {
      const exp = root.querySelector("#reader-dock-expanded");
      const phrase = dockState.phrase;
      if (!exp || !phrase) return;
      const mode = phrase.includes(" ") ? "chunk" : "word";
      const loadKey = `${mode}:${phrase.toLowerCase()}`;
      exp.hidden = false;
      if (exp.dataset.loadedKey === loadKey && exp.innerHTML.trim()) return;
      exp.dataset.loadedKey = loadKey;
      exp.innerHTML = `<div class="reader-dock-gloss-loading">正在展开「${esc(phrase)}」完整词条…</div>`;
      try {
        const res = await bridge()?.lookupFullEntry?.(phrase, mode);
        if (exp.dataset.loadedKey !== loadKey) return;
        exp.innerHTML = renderExpandedEntryHtml(res?.kind || mode, res?.data || null);
      } catch (err) {
        if (exp.dataset.loadedKey !== loadKey) return;
        exp.innerHTML = `<p class="reader-exp-empty">${esc(err?.message || "完整词条加载失败")}</p>`;
      }
    }

    function applyDockDetent(dock, detent) {
      dock.dataset.detent = detent;
      dock.style.height = "";
      const exp = root.querySelector("#reader-dock-expanded");
      const gloss = root.querySelector("#reader-dock-gloss");
      if (detent === "expanded") {
        if (gloss && gloss.hidden && dockState.phrase) {
          void runDockQuickGloss(root, dockState.phrase.includes(" ") ? "chunk" : "word");
        }
        void loadExpandedDockDetail(dock);
      } else if (exp) {
        exp.hidden = true;
      }
    }

    function snapDockDetent(dock, targetHeight, deltaY) {
      const vh = window.innerHeight || 760;
      const startDetent = dock.dataset.detent || "compact";
      dock.classList.remove("is-dragging");
      // Strong downward drag closes or steps down
      if (targetHeight < 58 || (deltaY > 85 && startDetent !== "expanded")) {
        hideLookupDock(root);
        return;
      }
      if (deltaY < -55) {
        applyDockDetent(dock, "expanded");
        return;
      }
      if (deltaY > 55 && startDetent === "expanded") {
        const hasGloss = Boolean(root.querySelector("#reader-dock-gloss:not([hidden])"));
        applyDockDetent(dock, hasGloss ? "half" : "compact");
        return;
      }
      const halfThreshold = Math.round(vh * 0.44);
      if (targetHeight >= halfThreshold) applyDockDetent(dock, "expanded");
      else if (targetHeight <= 110) applyDockDetent(dock, "compact");
      else applyDockDetent(dock, "half");
    }

    root.addEventListener("pointerdown", (e) => {
      if (root.dataset.page !== "reader") return;
      const handle = e.target.closest("#reader-dock-handle");
      if (!handle) return;
      const dock = root.querySelector("#reader-lookup-dock");
      if (!dock || dock.hidden) return;
      const now = Date.now();
      if (now - lastHandleTap < 300) {
        lastHandleTap = 0;
        applyDockDetent(dock, dock.dataset.detent === "expanded" ? "half" : "expanded");
        return;
      }
      lastHandleTap = now;
      draggingDock = true;
      dragStartY = e.clientY;
      dragStartH = dock.getBoundingClientRect().height;
      dock.classList.add("is-dragging");
      try { handle.setPointerCapture?.(e.pointerId); } catch (_) { /* ignore */ }
      e.preventDefault();
    });

    root.addEventListener("pointermove", (e) => {
      if (!draggingDock) return;
      const dock = root.querySelector("#reader-lookup-dock");
      if (!dock) return;
      const vh = window.innerHeight || 760;
      const dy = e.clientY - dragStartY;
      const nextH = Math.max(44, Math.min(Math.round(vh * 0.82), Math.round(dragStartH - dy)));
      dock.style.height = `${nextH}px`;
      e.preventDefault();
    });

    const endDockDrag = (e) => {
      if (!draggingDock) return;
      draggingDock = false;
      const dock = root.querySelector("#reader-lookup-dock");
      if (!dock) return;
      const curH = dock.getBoundingClientRect().height;
      const dy = (e?.clientY ?? dragStartY) - dragStartY;
      snapDockDetent(dock, curH, dy);
    };
    root.addEventListener("pointerup", endDockDrag);
    root.addEventListener("pointercancel", endDockDrag);
    let printingLock = false;
    root.addEventListener("click", async (e) => {
      if (root.dataset.page !== "reader") return;
      const target = e.target.closest("[data-reader-action]");
      if (!target) {
        if (e.target.id === "reader-export-modal") {
          readerState.modalOpen = false;
          renderIntoScreen();
          return;
        }
        const wordEl = e.target.closest(".pdf-en-prose .pdf-w");
        if (wordEl) {
          if (Date.now() - lastSwipeEndAt < 380) return;
          const paraEl = wordEl.closest("p");
          const wi = Number(wordEl.dataset.wi);
          if (paraEl && Number.isFinite(wi)) {
            dockState.paraEl = paraEl;
            dockState.startIdx = wi;
            dockState.endIdx = wi;
            applyWordRangeSelection(root);
          }
          return;
        }
        if (!e.target.closest("#reader-lookup-dock")) {
          hideLookupDock(root);
        }
        return;
      }
      const act = target.dataset.readerAction;
      if (act === "load-sample") {
        await loadBuiltinSample();
      } else if (act === "start-read") {
        const field = root.querySelector("#reader-textarea");
        const raw = field ? field.value.trim() : "";
        if (!raw) {
          bridge()?.toast?.("先粘贴英文文章，或点「载入外刊示例」");
          return;
        }
        try {
          const level = bridge()?.getSentenceLevel?.() || "cet6";
          const doc = window.TALK_DOC_PARSER.parseText(raw, { level });
          await runDocPipeline(doc);
        } catch (err) {
          bridge()?.toast?.(err?.message || "解析失败");
        }
      } else if (act === "open-recent") {
        await openRecentDoc(target.dataset.docHash);
      } else if (act === "delete-recent") {
        const hash = target.dataset.docHash;
        await dbDeleteDoc(hash);
        if (readerState.doc?.docHash === hash) {
          readerState.doc = null;
          readerState.overview = null;
          readerState.blockResults.clear();
        }
        readerState.recentDocs = await dbListDocs();
        renderIntoScreen();
        bridge()?.toast?.("已删除该篇精读缓存");
      } else if (act === "clear-recent") {
        await dbClearDocs();
        readerState.doc = null;
        readerState.overview = null;
        readerState.blockResults.clear();
        readerState.recentDocs = [];
        renderIntoScreen();
        bridge()?.toast?.("已清空本地精读库");
      } else if (act === "back-input") {
        readerState.abortController?.abort();
        readerState.view = "input";
        readerState.modalOpen = false;
        readerState.recentDocs = await dbListDocs();
        renderIntoScreen();
      } else if (act === "toggle-simplify-input") {
        readerState.simplifyOnInput = !readerState.simplifyOnInput;
        renderIntoScreen();
      } else if (act === "toggle-show-simplified") {
        readerState.showSimplified = !readerState.showSimplified;
        renderIntoScreen();
      } else if (act === "toggle-focus-en") {
        readerState.focusEn = !readerState.focusEn;
        renderIntoScreen();
      } else if (act === "toggle-reveal" || act === "toggle-note-reveal") {
        if (readerState.focusEn) target.classList.toggle("revealed");
      } else if (act === "save-term") {
        e.stopPropagation();
        const term = target.dataset.term || "";
        const saved = bridge()?.toggleSaveWord?.(term);
        target.classList.toggle("saved", Boolean(saved));
        target.textContent = saved ? "✓ 已收" : "+ 词册";
        target.title = saved ? "移出词册" : "收入 talk. 词册";
        bridge()?.toast?.(saved ? `已收入词册：${term}` : `已移出词册：${term}`);
      } else if (act === "speak-section") {
        const idx = Number(target.dataset.blockIndex);
        const blk = readerState.doc?.blocks?.find((x) => x.index === idx);
        if (blk) {
          const res = readerState.blockResults.get(idx);
          const useSimp = readerState.showSimplified && isValidEnglishSimplified(res?.data?.simplifiedText);
          const speakContent = (useSimp ? res.data.simplifiedText : blk.text || "").replace(/\s+/g, " ").trim();
          if (speakContent) {
            bridge()?.speakText?.(speakContent, target);
          }
        }
      } else if (act === "jump-sheet") {
        const key = target.dataset.jumpTarget || "";
        const [kind, idx] = key.split("-");
        const sel = kind === "study" ? `[data-study-sheet="${idx}"]` : `[data-block-sheet="${idx}"]`;
        const el = root.querySelector(sel);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (act === "lookup-note-term") {
        e.stopPropagation();
        const t = (target.dataset.term || "").trim();
        if (!t) return;
        if (t.includes(" ")) bridge()?.openChunk?.(t);
        else bridge()?.openWord?.(t);
      } else if (act === "lookup-chunk") {
        e.stopPropagation();
        const c = cleanChunkForLookup(target.dataset.chunk || "");
        if (c) bridge()?.openChunk?.(c);
      } else if (act === "lookup-sentence") {
        const s = (target.dataset.sentence || "").trim();
        if (s) bridge()?.openSentence?.(s);
      } else if (act === "lookup-translate") {
        const s = (target.dataset.sentence || "").trim();
        if (s) bridge()?.openTranslator?.(s);
      } else if (act === "dock-expand-left") {
        if (dockState.paraEl && dockState.startIdx > 0 && (dockState.endIdx - dockState.startIdx) < 6) {
          dockState.startIdx -= 1;
          applyWordRangeSelection(root);
        }
      } else if (act === "dock-expand-right") {
        if (dockState.paraEl && (dockState.endIdx - dockState.startIdx) < 6) {
          const allW = dockState.paraEl.querySelectorAll(".pdf-w");
          const maxIdx = allW.length ? Number(allW[allW.length - 1].dataset.wi) : dockState.endIdx;
          if (dockState.endIdx < maxIdx) {
            dockState.endIdx += 1;
            applyWordRangeSelection(root);
          }
        }
      } else if (act === "dock-word") {
        await runDockQuickGloss(root, "word");
      } else if (act === "dock-chunk") {
        await runDockQuickGloss(root, "chunk");
      } else if (act === "dock-deep") {
        if (dockState.phrase) {
          const phrase = dockState.phrase;
          const mode = dockState.glossMode;
          hideLookupDock(root);
          if (mode === "chunk" || phrase.includes(" ")) bridge()?.openChunk?.(phrase);
          else bridge()?.openWord?.(phrase);
        }
      } else if (act === "dock-sentence") {
        if (dockState.sentence) {
          const sentence = dockState.sentence;
          hideLookupDock(root);
          bridge()?.openSentence?.(sentence);
        }
      } else if (act === "dock-close") {
        hideLookupDock(root);
      } else if (act === "open-modal") {
        readerState.modalOpen = true;
        renderIntoScreen();
      } else if (act === "close-modal") {
        readerState.modalOpen = false;
        renderIntoScreen();
      } else if (act === "toggle-opt") {
        const opt = target.dataset.opt;
        if (opt in readerState.opts) {
          readerState.opts[opt] = !readerState.opts[opt];
          renderIntoScreen();
        }
      } else if (act === "rerun-doc") {
        readerState.modalOpen = false;
        if (readerState.doc) await runDocPipeline(readerState.doc, { force: true });
      } else if (act === "do-print") {
        if (printingLock) return;
        printingLock = true;
        readerState.modalOpen = false;
        renderIntoScreen();
        const prevTitle = document.title;
        const rawDocTitle = (readerState.doc?.title || readerState.overview?.titleZh || "长文").trim();
        const cleanedTitle = rawDocTitle.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
        const safePdfTitle = cleanedTitle.length <= 120
          ? cleanedTitle
          : cleanedTitle.slice(0, 120).replace(/\s+\S*$/, "").trim() || cleanedTitle.slice(0, 120);
        document.title = `${safePdfTitle}-精读`;
        const restoreTitle = () => {
          if (document.title === `${safePdfTitle}-精读`) document.title = prevTitle;
        };
        window.addEventListener("afterprint", restoreTitle, { once: true });
        window.setTimeout(() => {
          try { if (!window.TALK_NATIVE_PRINT?.(safePdfTitle)) window.print(); } finally {
            window.setTimeout(() => {
              printingLock = false;
              restoreTitle();
            }, 2500);
          }
        }, 120);
      } else if (act === "retry-overview") {
        if (readerState.doc) await runDocPipeline(readerState.doc, { force: false });
      } else if (act === "retry-block") {
        const idx = Number(target.dataset.blockIndex);
        const blk = readerState.doc?.blocks?.find((x) => x.index === idx);
        if (blk) {
          const level = bridge()?.getSentenceLevel?.() || "cet6";
          readerState.blockResults.set(idx, { status: "loading" });
          renderIntoScreen();
          const ac = new AbortController();
          await processSingleBlock(readerState.doc, blk, level, readerState.runSeq, ac.signal);
        }
      } else if (act === "toggle-cloze") {
        const open = target.dataset.open === "1";
        target.dataset.open = open ? "0" : "1";
        target.textContent = open ? "________" : target.dataset.answer;
      } else if (act === "toggle-cloze-btn") {
        const item = target.closest(".pdf-cloze-item");
        const slot = item?.querySelector(".pdf-cloze-blank");
        if (slot) {
          const open = slot.dataset.open === "1";
          slot.dataset.open = open ? "0" : "1";
          slot.textContent = open ? "________" : slot.dataset.answer;
          target.textContent = open ? "核对答案" : "隐藏答案";
        }
      }
    });

    root.addEventListener("mouseup", (e) => {
      if (!e.target.closest(".pdf-en-prose")) return;
      const sel = window.getSelection?.();
      const text = sel ? sel.toString().replace(/\s+/g, " ").trim() : "";
      if (!text || text.length < 2 || !/[A-Za-z]/.test(text)) return;
      const paraEl = e.target.closest(".pdf-en-prose p");
      if (!paraEl) return;
      const sentence = extractSentenceForWord(paraEl, text);
      dockState.paraEl = paraEl;
      dockState.startIdx = -1;
      dockState.endIdx = -1;
      updateLookupDock(root, { phrase: text.slice(0, 80), sentence });
    });

    window.addEventListener("resize", () => syncDockGeometry(root));
  }

  /* ---------- Public Hooks for app.js ---------- */
  window.TALK_READER = {
    pageHtml() {
      return readerState.view === "doc" ? renderDocView() : renderInputPage();
    },
    async onMount(screen) {
      readerState.recentDocs = await dbListDocs();
      if (readerState.view === "input") {
        screen.innerHTML = renderInputPage();
      }
      bindReaderDom(screen);
    },
    refreshTheme() {
      renderIntoScreen();
    }
  };
})();
