#!/usr/bin/env node
/**
 * Test runner for talk.
 *
 *   node tests/run.mjs                 # everything
 *   node tests/run.mjs chunk           # suites whose title/file matches
 *   node tests/run.mjs --list          # just list the suites and tests
 *   node tests/run.mjs --filter "cache"  # only tests matching a regex
 *   node tests/run.mjs --headed        # watch it in a window
 *
 * The site and the fake model share one local origin (tests/lib/server.mjs), so
 * these run fully offline — no API key, no network, no service worker.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registeredSuites, runSuite, formatError } from "./lib/harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITES = path.join(HERE, "suites");

function parseArgs(argv) {
  const args = { filters: [], filter: null, list: false, headed: false };
  for (const arg of argv) {
    if (arg === "--list") args.list = true;
    else if (arg === "--headed") args.headed = true;
    else if (arg.startsWith("--filter=")) args.filter = arg.slice(9);
    else if (!arg.startsWith("-")) args.filters.push(arg);
  }
  return args;
}

async function loadSuites() {
  const files = (await readdir(SUITES)).filter((name) => name.endsWith(".mjs")).sort();
  const all = registeredSuites();
  for (const file of files) {
    const before = registeredSuites().length;
    await import(path.join(SUITES, file));
    for (const suite of registeredSuites().slice(before)) suite.file = file;
  }
  return all;
}

const color = (code, text) => (process.stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text);
const green = (text) => color("32", text);
const red = (text) => color("31", text);
const dim = (text) => color("2", text);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const suites = await loadSuites();
  const wanted = suites.filter((suite) =>
    args.filters.length
      ? args.filters.some((needle) => `${suite.file} ${suite.title}`.toLowerCase().includes(needle.toLowerCase()))
      : true
  );

  if (args.list) {
    for (const suite of wanted) {
      console.log(`${suite.title} (${suite.tests.length})`);
      for (const test of suite.tests) console.log(`  - ${test.name}${test.skip ? " (skip)" : ""}`);
    }
    return 0;
  }
  if (!wanted.length) {
    console.error(`no suites matched ${args.filters.join(" ")}`);
    return 1;
  }

  const filter = args.filter ? (name) => new RegExp(args.filter, "i").test(name) : null;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures = [];

  for (const suite of wanted) {
    const reporter = {
      onPass: (_suite, test, ms) => console.log(`  ${green("✓")} ${test.name} ${dim(`${ms}ms`)}`),
      onSkip: (_suite, test, reason) => console.log(`  ${dim("○")} ${test.name} ${dim(`skipped: ${reason || ""}`)}`),
      onFail: (suiteEntry, test, error, ms) => console.log(`  ${red("✗")} ${test.name} ${dim(`${ms}ms`)}\n${indent(formatError(error), 4)}`),
    };
    console.log(`\n${suite.title}`);
    const summary = await runSuite(suite, { reporter, filter });
    passed += summary.passed;
    failed += summary.failed;
    skipped += summary.skipped;
    if (summary.failed) {
      failures.push(...summary.tests.filter((test) => test.status === "failed").map((test) => ({ ...test, suite: suite.title })));
    }
  }

  console.log("");
  const bits = [`${passed} passed`];
  if (failed) bits.push(red(`${failed} failed`));
  if (skipped) bits.push(dim(`${skipped} skipped`));
  console.log(bits.join(", "));

  if (failed) {
    console.log("");
    for (const failure of failures) console.log(`${failure.suite} › ${failure.name}`);
  }
  return failed ? 1 : 0;
}

function indent(text, spaces) {
  const pad = " ".repeat(spaces);
  return String(text)
    .split("\n")
    .map((line) => pad + line)
    .join("\n");
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
