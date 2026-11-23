/* talk. — long-form input parsing.
 *
 * Turns a pasted article or an uploaded .md/.txt into heading blocks and
 * 150–260 word passage batches. Parsers for other formats can be registered
 * later via registerParser(ext, fn); nothing here depends on the network.
 */
(function () {
  const EXTENSIONS = [".md", ".markdown", ".txt"];
  const extraParsers = new Map();

  function normalize(raw) {
    return String(raw)
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ");
  }

  function wordsOf(text) {
    return (String(text).match(/[A-Za-z0-9][A-Za-z0-9'’\-]*/g) || []).length;
  }

  async function sha1Hex(text) {
    const source = String(text);
    try {
      if (window.crypto && crypto.subtle) {
        const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(source));
        return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      }
    } catch (_) {
      /* fall through to the cheap hash */
    }
    let hash = 0x811c9dc5;
    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `fnv${hash.toString(16).padStart(8, "0")}${source.length.toString(16)}`;
  }

  function looksMarkdown(raw) {
    return /^#{1,3}\s/m.test(raw) || /```/.test(raw) || /\]\([^)]+\)/.test(raw) || /\*\*[^*]+\*\*/.test(raw);
  }

  function cleanInline(text) {
    return text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/\*([^*\n]+)\*/g, "$1")
      .replace(/(^|[^A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])/g, "$1$2")
      .replace(/<\/?[a-zA-Z][^>]*>/g, "")
      .trim();
  }

  function parseMarkdown(raw) {
    const text = raw.replace(/```[\s\S]*?```/g, "");
    const paragraphs = [];
    let title = "";
    let buffer = [];

    const flush = () => {
      if (!buffer.length) return;
      const joined = buffer
        .map(cleanInline)
        .filter(Boolean)
        .join(" ");
      buffer = [];
      if (joined && !/^([-*_])\1{2,}$/.test(joined)) paragraphs.push({ type: "text", text: joined });
    };

    text.split("\n").forEach((line) => {
      const value = line.trim();
      if (!value) { flush(); return; }
      const heading = /^(#{1,3})\s+(.+)$/.exec(value);
      if (heading) {
        flush();
        const level = heading[1].length;
        const label = cleanInline(heading[2]);
        if (!label) return;
        if (level === 1 && !title) title = label;
        paragraphs.push({ type: "heading", level, text: label });
        return;
      }
      if (/^([-*_])\1{2,}$/.test(value)) { flush(); return; }
      buffer.push(value);
    });
    flush();
    return { paragraphs, title };
  }

  function parsePlain(raw) {
    const paragraphs = [];
    raw.split(/\n{2,}/).forEach((chunk) => {
      const text = chunk
        .split("\n")
        .map((line) => cleanInline(line))
        .filter((line) => line && !/^([-*_])\1{2,}$/.test(line))
        .join(" ");
      if (text) paragraphs.push({ type: "text", text });
    });
    return { paragraphs, title: "" };
  }

  function splitLongParagraph(text, cap) {
    const sentences = text.split(/(?<=[.!?]["')\]]?)\s+/);
    if (sentences.length < 2) {
      const words = text.split(/\s+/);
      const chunks = [];
      for (let i = 0; i < words.length; i += cap) chunks.push(words.slice(i, i + cap).join(" "));
      return chunks;
    }
    const chunks = [];
    let current = "";
    sentences.forEach((sentence) => {
      const next = current ? `${current} ${sentence}` : sentence;
      if (wordsOf(next) > cap && current) {
        chunks.push(current);
        current = sentence;
      } else {
        current = next;
      }
    });
    if (current) chunks.push(current);
    return chunks;
  }

  function buildBlocks(paragraphs, cap = 320, min = 150) {
    const blocks = [];
    let buffer = [];
    let bufferWords = 0;

    const flush = () => {
      if (!buffer.length) return;
      blocks.push({ type: "passage", text: buffer.join("\n\n"), words: bufferWords });
      buffer = [];
      bufferWords = 0;
    };

    paragraphs.forEach((paragraph) => {
      if (paragraph.type === "heading") {
        flush();
        blocks.push({ type: "heading", level: paragraph.level, text: paragraph.text });
        return;
      }
      const words = wordsOf(paragraph.text);
      if (words > 350) {
        flush();
        splitLongParagraph(paragraph.text, 260).forEach((piece) => {
          const count = wordsOf(piece);
          if (count) blocks.push({ type: "passage", text: piece, words: count });
        });
        return;
      }
      if (buffer.length && (bufferWords >= min || bufferWords + words > cap)) flush();
      buffer.push(paragraph.text);
      bufferWords += words;
      if (bufferWords >= min) flush();
    });
    flush();

    // A short closing paragraph should not become its own block.
    const merged = [];
    blocks.forEach((block) => {
      const previous = merged[merged.length - 1];
      if (
        block.type === "passage" &&
        previous &&
        previous.type === "passage" &&
        block.words < 150 &&
        previous.words + block.words <= cap
      ) {
        previous.text = `${previous.text}\n\n${block.text}`;
        previous.words += block.words;
        return;
      }
      merged.push(block);
    });
    return merged;
  }

  async function parseText(raw, options = {}) {
    const input = normalize(raw);
    const filename = String(options.filename || "");
    const level = String(options.level || "gaokao");
    const markdown = options.markdown !== undefined ? Boolean(options.markdown) : looksMarkdown(input);
    const parsed = markdown ? parseMarkdown(input) : parsePlain(input);
    const clean = parsed.paragraphs.map((paragraph) => paragraph.text).join("\n\n");
    const wordCount = wordsOf(clean);
    const blocks = buildBlocks(parsed.paragraphs);
    const docHash = await sha1Hex(`${clean}\n|${level}`);

    for (const block of blocks) block.hash = await sha1Hex(`${block.text}|${level}`);
    blocks.forEach((block, index) => { block.index = index; });

    let title = parsed.title;
    if (!title) {
      const firstHeading = blocks.find((block) => block.type === "heading");
      if (firstHeading) title = firstHeading.text;
    }
    if (!title && filename) title = filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
    if (!title) {
      const firstPassage = blocks.find((block) => block.type === "passage");
      title = firstPassage ? firstPassage.text.split(/\s+/).slice(0, 8).join(" ") : "Untitled";
    }

    return {
      docHash,
      title,
      wordCount,
      level,
      markdown,
      blocks,
      text: clean,
      excerpt: clean.split(/\s+/).slice(0, 2500).join(" ")
    };
  }

  async function parseFile(file) {
    const name = String(file?.name || "");
    const ext = (name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
    if (extraParsers.has(ext)) return extraParsers.get(ext)(file);
    if (!EXTENSIONS.includes(ext)) {
      throw new Error("当前版本支持 .md / .txt 与直接粘贴；PDF / Word 解析即将接入。");
    }
    if (file.size > 2 * 1024 * 1024) throw new Error("文件超过 2 MB，请先精简或直接粘贴正文。");
    const raw = await file.text();
    return parseText(raw, { filename: name });
  }

  function registerParser(ext, fn) {
    const key = String(ext || "").startsWith(".") ? String(ext).toLowerCase() : `.${String(ext).toLowerCase()}`;
    if (typeof fn !== "function") throw new Error("registerParser 需要解析函数");
    extraParsers.set(key, fn);
  }

  window.TALK_DOC_PARSER = { parseText, parseFile, sha1Hex, wordsOf, registerParser, EXTENSIONS };
})();
