import { suite } from "../lib/harness.mjs";
import {
  esc,
  sanitizeQuery,
  normalizeWord,
  detectParadigm,
  detectSourceLanguage,
  posAbbr,
  chunkSlug,
  chunkFromSlug
} from "../../js/core/utils.js";
import { redact } from "../../js/core/diagnostics.js";
import { createActionRegistry } from "../../js/core/actions.js";
import { partialJsonString, streamPreviewFromJson } from "../../js/model/stream-preview.js";
import { stripReverseAnchors, markdownLite } from "../../js/model/markdown.js";
import {
  isHallucinatedWord,
  normalizeSpelling,
  localizeTimelineWhen,
  normalizeSegments,
  splitSentences,
  ensureChunk,
  normalizeModelWord
} from "../../js/model/normalize.js";

suite("core & normalize · extracted ES modules (unit)", { timeout: 10_000 }, (s) => {
  s.test("detectParadigm, sanitizeQuery, posAbbr and slug helpers handle edge inputs", async (_state, t) => {
    t.expect(sanitizeQuery('  "ephemeral..."  ')).toBe("ephemeral");
    t.expect(detectParadigm("ephemeral")).toBe("word");
    t.expect(detectParadigm("take off")).toBe("chunk");
    t.expect(detectParadigm("Hope is not a prediction.")).toBe("sentence");
    t.expect(detectParadigm("怎么礼貌地顺便问一句")).toBe("reverse");
    t.expect(detectParadigm("how do you say awkward pause")).toBe("reverse");
    t.expect(detectSourceLanguage("你好世界 ok")).toBe("zh");
    t.expect(detectSourceLanguage("hello world")).toBe("en");
    t.expect(posAbbr("noun / 动词")).toBe("n. / v.");
    t.expect(chunkFromSlug(chunkSlug("by the way"))).toBe("by the way");
    t.expect(esc('<script>"&\'</script>')).toBe("&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;");
  });

  s.test("diagnostics redact strips API keys, Bearer headers, and long tokens", async (_state, t) => {
    const out = redact('Authorization: Bearer secret_token_12345 sk-abcdefgh123456 {"apiKey":"my-super-key"}');
    t.expect(out.includes("secret_token_12345")).toBe(false);
    t.expect(out.includes("sk-abcdefgh123456")).toBe(false);
    t.expect(out.includes("my-super-key")).toBe(false);
    t.expect(out.includes("Bearer ***")).toBe(true);
    t.expect(out.includes("sk-***")).toBe(true);
  });

  s.test("action registry dispatches registered actions and returns false for unknown ones", async (_state, t) => {
    const reg = createActionRegistry();
    const calls = [];
    reg.register({
      ping: (ctx) => calls.push(ctx.value)
    });
    t.expect(reg.has("ping")).toBe(true);
    t.expect(reg.has("missing")).toBe(false);
    t.expect(await reg.dispatch("ping", { value: 42 })).toBe(true);
    t.expect(await reg.dispatch("missing", {})).toBe(false);
    t.expect(calls).toEqual([42]);
  });

  s.test("streamPreviewFromJson extracts partial word/sentence fields and trims trailing [[ in reverse mode", async (_state, t) => {
    t.expect(partialJsonString('{"word":"lucent","translation":"透亮的"', "translation")).toBe("透亮的");
    const wordPrev = streamPreviewFromJson('{"word":"lucent","phonetic":"/ˈluːsnt/","senses":[{"zh":"透亮的"}]}', "word", "lucent");
    t.expect(wordPrev.word).toBe("lucent");
    t.expect(wordPrev.senses).toEqual(["透亮的"]);

    const revPrev = streamPreviewFromJson("可以试试 [[by the way]] 或 [[half open", "reverse", "顺便");
    t.expect(revPrev.narrative).toBe("可以试试 [[by the way]] 或");
    t.expect(stripReverseAnchors("Try [[take off]] now")).toBe("Try take off now");
    t.expect(markdownLite("Try [[take off]] now", true).includes('data-action="reverse-anchor"')).toBe(true);
  });

  s.test("normalize enforces hallucination guard, protected spelling, copula folding, and chunk keyword grounding", async (_state, t) => {
    t.expect(isHallucinatedWord("standard", "obfuscate")).toBe(true);
    t.expect(isHallucinatedWord("standard", "standard")).toBe(false);
    t.expect(isHallucinatedWord("go", "went")).toBe(false);

    // Brand / protected words must never be "corrected"
    t.expect(normalizeSpelling({ input: "google", corrected: "standard", changed: true, confidence: 0.99 })).toBe(null);
    t.expect(normalizeSpelling({ input: "take off", corrected: "take", changed: true, confidence: 0.99 })).toBe(null);
    const sp = normalizeSpelling({ input: "accomodate", corrected: "accommodate", changed: true, confidence: 0.95 });
    t.expect(sp?.corrected).toBe("accommodate");

    // Timeline localization
    t.expect(localizeTimelineWhen("Old English")).toBe("古英语时期");
    t.expect(localizeTimelineWhen("late 19th century")).toBe("19 世纪晚期");

    // Lone copula folding in sentence segments
    const segs = normalizeSegments(
      [
        { text: "Hope ", role: "theme" },
        { text: "is ", role: "rheme" },
        { text: "not a prediction.", role: "focus" }
      ],
      "Hope is not a prediction."
    );
    t.expect(segs.length).toBe(2);
    t.expect(segs[0].text).toBe("Hope is ");

    // Sentence splitting preserves abbreviations
    t.expect(splitSentences("Dr. Smith arrived early. He waited outside.")).toEqual([
      "Dr. Smith arrived early.",
      "He waited outside."
    ]);

    // ensureChunk drops hallucinated keyWords not actually inside the chunk
    const chunk = ensureChunk({
      chunk: "take off",
      form: "phrasal-verb",
      keyWords: [
        { word: "take", pos: "verb", gloss: "拿" },
        { word: "phantom", pos: "noun", gloss: "幻觉" }
      ]
    });
    t.expect(chunk.keyWords.map((k) => k.word)).toEqual(["take"]);
    t.expect(chunk.keyWords[0].pos).toBe("v.");

    const normalizedWord = normalizeModelWord({
      word: "Lucent",
      pos: "adj.",
      senses: [{ en: "glowing", zh: "透亮的" }],
      spelling: { input: "lucent", corrected: "lucent", changed: false }
    }, "lucent");
    t.expect(normalizeWord(normalizedWord.word)).toBe("lucent");
    t.expect(normalizedWord.translation).toBe("透亮的");
  });
});
