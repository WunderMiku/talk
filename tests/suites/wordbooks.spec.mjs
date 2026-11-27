import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { suite } from "../lib/harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

function loadWordbooks() {
  const code = fs.readFileSync(path.join(ROOT, "js/wordbooks.js"), "utf8");
  const mem = new Map();
  const localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k)
  };
  const sandbox = { window: {}, localStorage, Date, Set, Map, JSON, Math };
  sandbox.window.localStorage = localStorage;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { wb: sandbox.window.TALK_WORDBOOKS, mem };
}

suite("wordbooks · engine & zero-loss audit (unit)", { timeout: 10_000 }, (s) => {
  s.test("auto-migrates legacy saved terms into default 密集书库 (dense-stacks)", async (_state, t) => {
    const { wb } = loadWordbooks();
    wb.loadStore(["ephemeral", "ubiquitous", "Ephemeral", "resilient"]);
    const books = wb.listBooks();
    t.expect(books.length).toBe(1);
    t.expect(books[0].id).toBe("dense-stacks");
    t.expect(books[0].name).toBe("密集书库");
    t.expect(books[0].items.length).toBe(3);
    t.expect(wb.stats().uniqueWords).toBe(3);
    t.expect(wb.hasTerm("ubiquitous")).toBe(true);
  });

  s.test("imports .txt, CSV, and JSON backups with accurate before/after audit counts", async (_state, t) => {
    const { wb } = loadWordbooks();
    wb.loadStore(["alpha"]);

    // Plain text + CSV with Chinese gloss + duplicate
    const raw = [
      "beta, 贝塔测试",
      "gamma\t伽马",
      "alpha",
      "delta",
      "1. epsilon - 极小量"
    ].join("\n");
    const r1 = wb.importData(raw, "dense-stacks");
    t.expect(r1.before.uniqueWords).toBe(1);
    t.expect(r1.after.uniqueWords).toBe(5);
    t.expect(r1.added).toBe(4);
    t.expect(r1.skipped).toBe(1);

    // Export full JSON backup, reload fresh store, and restore
    const backupJson = wb.exportAllJson();
    const { wb: wb2 } = loadWordbooks();
    wb2.loadStore([]);
    const r2 = wb2.importData(backupJson, "dense-stacks");
    t.expect(r2.before.uniqueWords).toBe(0);
    t.expect(r2.after.uniqueWords).toBe(5);
    t.expect(r2.added).toBe(5);
    t.expect(wb2.exportBookTxt("dense-stacks").trim().split("\n").length).toBe(5);
  });

  s.test("applyAiClassification enforces zero-loss invariant even when AI omits or hallucinates words", async (_state, t) => {
    const { wb } = loadWordbooks();
    wb.loadStore(["inflation", "tariff", "subsidy", "synapse", "cortex", "ephemeral", "melancholy"]);

    // Simulate AI response that:
    // 1. Classifies economics & neuroscience words
    // 2. Completely omits "ephemeral" and "melancholy"
    // 3. Hallucinates a non-existent word "phantom_word"
    const audit = wb.applyAiClassification("dense-stacks", [
      { book: "财经政策", words: ["inflation", "tariff", "subsidy", "phantom_word"] },
      { book: "神经科学", words: ["synapse", "cortex"] }
    ]);

    t.expect(audit.before.uniqueWords).toBe(7);
    t.expect(audit.after.uniqueWords).toBe(7);
    t.expect(audit.lost).toBe(0);
    t.expect(audit.moved).toBe(5);
    t.expect(audit.retained).toBe(2);
    t.expect(audit.createdBooks.length).toBe(2);

    // Omitted words remain safely in 密集书库
    const dense = wb.getBook("dense-stacks");
    const denseTerms = dense.items.map((it) => it.term);
    t.expect(denseTerms.includes("ephemeral")).toBe(true);
    t.expect(denseTerms.includes("melancholy")).toBe(true);
    // Hallucinated word was NOT injected
    t.expect(wb.hasTerm("phantom_word")).toBe(false);
  });

  s.test("deleting a custom book rescues all its words back into 密集书库 without loss", async (_state, t) => {
    const { wb } = loadWordbooks();
    wb.loadStore(["anchor"]);
    const custom = wb.createBook("科技专题");
    wb.addTerm("algorithm", custom.id);
    wb.addTerm("latency", custom.id);
    t.expect(wb.stats().uniqueWords).toBe(3);

    // Cannot delete default book
    const deny = wb.deleteBook("dense-stacks");
    t.expect(deny.ok).toBe(false);

    // Delete custom book -> words rescued into 密集书库
    const res = wb.deleteBook(custom.id, { rescueToDense: true });
    t.expect(res.ok).toBe(true);
    t.expect(res.rescued).toBe(2);
    t.expect(wb.stats().uniqueWords).toBe(3);
    t.expect(wb.getBook("dense-stacks").items.length).toBe(3);
  });
});
