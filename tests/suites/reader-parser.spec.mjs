import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { suite } from "../lib/harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

function loadParser() {
  const code = fs.readFileSync(path.join(ROOT, "js/doc-parser.js"), "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.TALK_DOC_PARSER;
}

suite("reader · parser (unit)", { timeout: 10_000 }, (s) => {
  s.test("extracts full plain-text first-line English title without ellipsis truncation", async (_state, t) => {
    const parser = loadParser();
    const raw = [
      "Beyond Human Supervision: The Promise and Peril of Recursive Self-Improvement",
      "In 1965, British mathematician I. J. Good hypothesized a pivotal threshold in artificial intelligence."
    ].join("\n");
    const doc = parser.parseText(raw, { level: "cet6" });
    t.expect(doc.title).toBe("Beyond Human Supervision: The Promise and Peril of Recursive Self-Improvement");
    t.expect(doc.title.includes("…")).toBe(false);
    t.expect(doc.blocks.filter((b) => b.type === "passage").length).toBe(1);
    t.expect(doc.blocks[0].text.startsWith("In 1965")).toBe(true);
  });

  s.test("parses Markdown headings and strips inline syntax cleanly", async (_state, t) => {
    const parser = loadParser();
    const raw = [
      "# The Quiet Architecture",
      "",
      "## Section One",
      "Silicon Valley treats **friction** as an *unalloyed evil* in [modern UX](https://example.com).",
      "",
      "## Section Two",
      "Second paragraph stays separated after heading."
    ].join("\n");
    const doc = parser.parseText(raw, { level: "cet6" });
    t.expect(doc.title).toBe("The Quiet Architecture");
    const headings = doc.blocks.filter((b) => b.type === "heading");
    const passages = doc.blocks.filter((b) => b.type === "passage");
    t.expect(headings.length).toBe(2);
    t.expect(passages.length).toBe(2);
    t.expect(passages[0].text).toMatch("Silicon Valley treats friction as an unalloyed evil in modern UX.");
  });

  s.test("produces deterministic SHA-1 docHash and supports registerParser hook", async (_state, t) => {
    const parser = loadParser();
    const a = parser.parseText("# Title\n\nOne short sentence here.", { level: "cet6" });
    const b = parser.parseText("# Title\n\nOne short sentence here.", { level: "cet6" });
    t.expect(a.docHash).toBe(b.docHash);
    t.expect(a.docHash.length).toBe(40);
    t.expect(typeof parser.registerParser).toBe("function");
  });
});
