/* ============================================================
   talk. — Long-document parser & batch chunker (zero deps)
   Supports .md, .txt, and pasted long text.
   Exposes registerParser(ext, fn) for future .pdf / .docx hooks.
   ============================================================ */
(function () {
  const customParsers = new Map();

  function registerParser(ext, fn) {
    const key = String(ext || "").replace(/^\./, "").toLowerCase();
    if (key && typeof fn === "function") customParsers.set(key, fn);
  }

  /* Pure-JS SHA-1 (works on non-HTTPS LAN where crypto.subtle is unavailable) */
  function sha1Hex(str) {
    const utf8 = unescape(encodeURIComponent(String(str || "")));
    const words = [];
    for (let i = 0; i < utf8.length; i++) {
      words[i >> 2] = (words[i >> 2] || 0) | (utf8.charCodeAt(i) << (24 - (i % 4) * 8));
    }
    const bitLen = utf8.length * 8;
    words[bitLen >> 5] = (words[bitLen >> 5] || 0) | (0x80 << (24 - (bitLen % 32)));
    words[((bitLen + 64 >> 9) << 4) + 15] = bitLen;

    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const w = new Array(80);
    const rol = (n, c) => (n << c) | (n >>> (32 - c));

    for (let i = 0; i < words.length; i += 16) {
      for (let j = 0; j < 16; j++) w[j] = words[i + j] || 0;
      for (let j = 16; j < 80; j++) w[j] = rol(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let j = 0; j < 80; j++) {
        let f, k;
        if (j < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
        else if (j < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; k = 0xca62c1d6; }
        const temp = (rol(a, 5) + f + e + k + w[j]) | 0;
        e = d; d = c; c = rol(b, 30); b = a; a = temp;
      }
      h0 = (h0 + a) | 0;
      h1 = (h1 + b) | 0;
      h2 = (h2 + c) | 0;
      h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0;
    }
    return [h0, h1, h2, h3, h4].map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
  }

  function countWords(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).filter(Boolean).length;
  }

  function cleanInlineMd(str) {
    return String(str || "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/__([^_\n]+)__/g, "$1")
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
      .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1")
      .replace(/`([^`\n]+)`/g, "$1")
      .replace(/^\s*>\s?/gm, "")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  function splitLongParagraph(text, maxWords = 260) {
    const sentences = text.split(/(?<=[.!?]["”']?)\s+/).filter(Boolean);
    if (sentences.length <= 1) return [text];
    const parts = [];
    let buf = [];
    let bufWords = 0;
    for (const s of sentences) {
      const wc = countWords(s);
      if (buf.length && bufWords + wc > maxWords) {
        parts.push(buf.join(" "));
        buf = [s];
        bufWords = wc;
      } else {
        buf.push(s);
        bufWords += wc;
      }
    }
    if (buf.length) parts.push(buf.join(" "));
    return parts;
  }

  function parseText(rawText, { titleHint = "", level = "cet6" } = {}) {
    const normalized = String(rawText || "")
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .replace(/```[\s\S]*?```/g, "\n")
      .trim();

    if (!normalized) {
      throw new Error("文本为空，请先输入或导入英文文章。");
    }

    const lines = normalized.split("\n");
    const rawItems = [];
    let paraLines = [];
    let extractedTitle = "";
    let firstHeadingConsumed = false;

    const flushPara = () => {
      if (!paraLines.length) return;
      const joined = cleanInlineMd(paraLines.join(" "));
      paraLines = [];
      if (joined && !/^[-*_]{3,}$/.test(joined)) {
        rawItems.push({ type: "para", text: joined });
      }
    };

    let seenNonEmpty = false;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li].trim();
      if (!line) {
        flushPara();
        continue;
      }
      if (!seenNonEmpty) {
        seenNonEmpty = true;
        // Detect plain-text title on the very first non-empty line (no leading #, <= 24 words, no trailing period)
        if (!/^#{1,3}\s+/.test(line) && !/^[-*_]{3,}$/.test(line)) {
          const cleanFirst = cleanInlineMd(line);
          const firstWc = countWords(cleanFirst);
          const hasMoreLines = lines.slice(li + 1).some((l) => l.trim().length > 0);
          if (hasMoreLines && firstWc >= 2 && firstWc <= 24 && !/[.!?。！？]$/.test(cleanFirst)) {
            extractedTitle = cleanFirst;
            firstHeadingConsumed = true;
            continue;
          }
        }
      }
      if (/^[-*_]{3,}$/.test(line)) {
        flushPara();
        continue;
      }
      const hMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (hMatch) {
        flushPara();
        const hLevel = hMatch[1].length;
        const hText = cleanInlineMd(hMatch[2]);
        if (!extractedTitle && hLevel === 1) {
          extractedTitle = hText;
          firstHeadingConsumed = true;
          continue;
        }
        rawItems.push({ type: "heading", level: hLevel, text: hText });
        continue;
      }
      paraLines.push(line);
    }
    flushPara();

    // Build merged passage batches (target 150–260 words, hard break on heading)
    const blocks = [];
    let pendingParas = [];
    let pendingWords = 0;

    const flushBatch = () => {
      if (!pendingParas.length) return;
      const text = pendingParas.join("\n\n");
      const wc = countWords(text);
      blocks.push({
        index: blocks.length,
        type: "passage",
        text,
        wordCount: wc,
        hash: sha1Hex(`${text}|${level}`)
      });
      pendingParas = [];
      pendingWords = 0;
    };

    for (const item of rawItems) {
      if (item.type === "heading") {
        flushBatch();
        blocks.push({
          index: blocks.length,
          type: "heading",
          level: item.level,
          text: item.text
        });
        continue;
      }
      const wc = countWords(item.text);
      if (wc > 340) {
        flushBatch();
        for (const sub of splitLongParagraph(item.text, 240)) {
          const swc = countWords(sub);
          blocks.push({
            index: blocks.length,
            type: "passage",
            text: sub,
            wordCount: swc,
            hash: sha1Hex(`${sub}|${level}`)
          });
        }
        continue;
      }
      if (pendingParas.length && pendingWords + wc > 260) {
        flushBatch();
      }
      pendingParas.push(item.text);
      pendingWords += wc;
      if (pendingWords >= 150) {
        flushBatch();
      }
    }
    flushBatch();

    const passageBlocks = blocks.filter((b) => b.type === "passage");
    if (!passageBlocks.length) {
      throw new Error("未检测到可精读的正文段落。");
    }

    const cleanHint = String(titleHint || "").replace(/\.(md|markdown|txt)$/i, "").trim();
    const firstSentence = passageBlocks[0].text.split(/(?<=[.!?])\s+/)[0] || passageBlocks[0].text;
    const fallbackTitle = countWords(firstSentence) <= 22
      ? firstSentence.trim()
      : firstSentence.split(/\s+/).slice(0, 18).join(" ");
    const title = extractedTitle || cleanHint || fallbackTitle;
    const totalWords = passageBlocks.reduce((sum, b) => sum + b.wordCount, 0);
    const fullForHash = passageBlocks.map((b) => b.text).join("\n\n");

    return {
      docHash: sha1Hex(`${title}|${fullForHash}`),
      title,
      wordCount: totalWords,
      passageCount: passageBlocks.length,
      firstHeadingConsumed,
      blocks
    };
  }

  async function parseFile(file, options = {}) {
    if (!file) throw new Error("未选择文件。");
    const name = String(file.name || "");
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (customParsers.has(ext)) {
      const text = await customParsers.get(ext)(file);
      return parseText(text, { ...options, titleHint: name });
    }
    if (ext === "md" || ext === "markdown" || ext === "txt") {
      const text = await file.text();
      return parseText(text, { ...options, titleHint: name });
    }
    throw new Error(`当前暂支持 .md / .txt 文件与直接粘贴（.${ext || "未知"} 解析模块预留待接入）。`);
  }

  window.TALK_DOC_PARSER = {
    parseText,
    parseFile,
    cleanInlineMd,
    countWords,
    sha1Hex,
    registerParser
  };
})();
