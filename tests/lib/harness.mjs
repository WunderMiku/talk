/**
 * Tiny zero-dependency test harness.
 *
 * Why not Vitest/Jest?  talk. ships as a static folder with no build step and
 * no runtime dependencies. Tests are the only thing that needs Node, so we keep
 * the harness in ~200 lines instead of pulling a toolchain into the repo.
 *
 * A suite module looks like this:
 *
 *   import { suite } from "../lib/harness.mjs";
 *
 *   suite("my feature", { timeout: 30_000 }, (s) => {
 *     s.beforeAll(async (state) => { state.thing = await setup(); });
 *     s.afterAll(async (state) => { await teardown(state.thing); });
 *     s.test("does the thing", async (state, t) => {
 *       t.expect(state.thing.ok).toBe(true);
 *     });
 *   });
 *
 * `state` is one object per suite, shared by hooks and tests. `t` carries the
 * per-test helpers (`expect`, `log`, `skip`, `signal`).
 */

import { inspect } from "node:util";

const suites = [];
let current = null;

/* ------------------------------------------------------------------ errors */

export class AssertionError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "AssertionError";
    this.detail = detail;
  }
}

export class SkipError extends Error {
  constructor(reason) {
    super(reason || "skipped");
    this.name = "SkipError";
  }
}

const show = (value) => {
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof RegExp) return String(value);
  if (value && value.nodeType === 1) return `<${value.tagName?.toLowerCase()}> ${value.textContent?.trim().slice(0, 80)}`;
  return inspect(value, { depth: 4, breakLength: 100, colors: false });
};

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
}

function subsetOf(actual, expected, path = "") {
  if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof RegExp)) {
    if (!actual || typeof actual !== "object") {
      throw new AssertionError(`toMatchObject: ${path || "<root>"} is not an object`, { actual, expected });
    }
    for (const key of Object.keys(expected)) subsetOf(actual[key], expected[key], path ? `${path}.${key}` : key);
    return true;
  }
  if (expected instanceof RegExp) return expect(actual).toMatch(expected);
  if (!deepEqual(actual, expected)) {
    throw new AssertionError(
      `toMatchObject: ${path || "<root>"} mismatch\n  expected: ${show(expected)}\n  received: ${show(actual)}`
    );
  }
  return true;
}

/* --------------------------------------------------------------- assertions */

export function expect(actual) {
  const fail = (message, detail) => {
    throw new AssertionError(message, detail);
  };
  return {
    toBe(expected, label = "") {
      if (!Object.is(actual, expected)) {
        fail(`${label ? label + ": " : ""}expected ${show(expected)}, received ${show(actual)}`);
      }
      return true;
    },
    toEqual(expected, label = "") {
      if (!deepEqual(actual, expected)) {
        fail(`${label ? label + ": " : ""}not deep-equal\n  expected: ${show(expected)}\n  received: ${show(actual)}`);
      }
      return true;
    },
    toMatchObject(expected) {
      return subsetOf(actual, expected);
    },
    toBeTruthy(label = "") {
      if (!actual) fail(`${label ? label + ": " : ""}expected a truthy value, received ${show(actual)}`);
      return true;
    },
    toBeFalsy(label = "") {
      if (actual) fail(`${label ? label + ": " : ""}expected a falsy value, received ${show(actual)}`);
      return true;
    },
    toBeDefined(label = "") {
      if (actual === undefined) fail(`${label ? label + ": " : ""}expected a value, received undefined`);
      return true;
    },
    toBeNull(label = "") {
      if (actual !== null) fail(`${label ? label + ": " : ""}expected null, received ${show(actual)}`);
      return true;
    },
    toMatch(pattern, label = "") {
      const text = String(actual);
      const ok = pattern instanceof RegExp ? pattern.test(text) : text.includes(String(pattern));
      if (!ok) fail(`${label ? label + ": " : ""}expected match ${show(pattern)}\n  received: ${show(text.slice(0, 400))}`);
      return true;
    },
    toContain(needle, label = "") {
      if (Array.isArray(actual) ? !actual.some((item) => deepEqual(item, needle)) : !String(actual).includes(String(needle))) {
        fail(`${label ? label + ": " : ""}expected to contain ${show(needle)}\n  received: ${show(actual)}`);
      }
      return true;
    },
    toHaveLength(length) {
      const got = actual?.length ?? -1;
      if (got !== length) fail(`expected length ${length}, received ${got} (${show(actual)})`);
      return true;
    },
    toBeGreaterThan(number) {
      if (!(actual > number)) fail(`expected > ${number}, received ${show(actual)}`);
      return true;
    },
    toBeGreaterThanOrEqual(number) {
      if (!(actual >= number)) fail(`expected >= ${number}, received ${show(actual)}`);
      return true;
    },
    toBeLessThan(number) {
      if (!(actual < number)) fail(`expected < ${number}, received ${show(actual)}`);
      return true;
    },
    toBeLessThanOrEqual(number) {
      if (!(actual <= number)) fail(`expected <= ${number}, received ${show(actual)}`);
      return true;
    },
    toBeOneOf(values) {
      if (!values.some((value) => deepEqual(actual, value))) fail(`expected one of ${show(values)}, received ${show(actual)}`);
      return true;
    },
    toBeCloseTo(expected, tolerance = 0) {
      if (Math.abs(actual - expected) > tolerance) fail(`expected ≈${expected} (±${tolerance}), received ${show(actual)}`);
      return true;
    },
    async toThrow(pattern) {
      let thrown = null;
      try {
        await actual();
      } catch (error) {
        thrown = error;
      }
      if (!thrown) fail("expected the function to throw, it returned normally");
      if (pattern) {
        const text = `${thrown.message || thrown}`;
        const ok = pattern instanceof RegExp ? pattern.test(text) : text.includes(String(pattern));
        if (!ok) fail(`expected thrown message to match ${show(pattern)}, received ${show(text)}`);
      }
      return thrown;
    },
    async toResolve() {
      try {
        return await actual;
      } catch (error) {
        fail(`expected the promise to resolve, it rejected with: ${error?.message || error}`);
      }
    },
  };
}

/* ------------------------------------------------------------------ registry */

const noop = async () => {};

export function suite(title, options, define) {
  if (typeof options === "function") {
    define = options;
    options = {};
  }
  const entry = {
    title,
    file: "",
    tags: options.tags || [],
    skip: Boolean(options.skip),
    skipReason: options.skipReason || "",
    timeout: options.timeout || 20_000,
    beforeAll: noop,
    afterAll: noop,
    beforeEach: noop,
    afterEach: noop,
    tests: [],
    state: {},
  };
  current = entry;
  define({
    beforeAll: (fn) => (entry.beforeAll = fn),
    afterAll: (fn) => (entry.afterAll = fn),
    beforeEach: (fn) => (entry.beforeEach = fn),
    afterEach: (fn) => (entry.afterEach = fn),
    test: (name, fn, testOptions = {}) => {
      entry.tests.push({
        name,
        fn,
        tags: testOptions.tags || [],
        skip: Boolean(testOptions.skip),
        skipReason: testOptions.skipReason || "",
        timeout: testOptions.timeout || 0,
      });
    },
    skip: (name, reason) => entry.tests.push({ name, fn: noop, skip: true, skipReason: reason, tags: [] }),
  });
  current = null;
  suites.push(entry);
  return entry;
}

export function test(name, fn, options) {
  if (!current) throw new Error("test() called outside of suite()");
  current.tests.push({ name, fn, tags: options?.tags || [], skip: Boolean(options?.skip), timeout: options?.timeout || 0, skipReason: "" });
}

export function registeredSuites() {
  return suites;
}

export function resetRegistry() {
  suites.length = 0;
}

/* -------------------------------------------------------------------- runner */

function withTimeout(promise, ms, label) {
  let timer = 0;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms (${label})`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/**
 * Runs one suite. Returns { title, tests: [{name, status, ms, error}], ms }.
 * Status is "passed" | "failed" | "skipped".
 */
export async function runSuite(entry, { reporter, filter } = {}) {
  const started = Date.now();
  const results = [];
  const state = entry.state;
  const only = filter ? entry.tests.filter((t) => filter(t.name)) : entry.tests;
  const suiteSkipped = entry.skip;
  let setupError = null;

  if (!suiteSkipped && only.length) {
    try {
      await withTimeout(Promise.resolve(entry.beforeAll(state)), entry.timeout, `${entry.title} beforeAll`);
    } catch (error) {
      setupError = error;
    }
  }

  for (const item of only) {
    const testStart = Date.now();
    if (suiteSkipped || setupError) {
      results.push({ name: item.name, status: "skipped", ms: 0, reason: entry.skipReason || "suite setup failed" });
      continue;
    }
    if (item.skip) {
      results.push({ name: item.name, status: "skipped", ms: 0, reason: item.skipReason });
      reporter?.onSkip?.(entry, item, item.skipReason);
      continue;
    }
    const helpers = {
      expect,
      AssertionError,
      log: (message) => reporter?.onLog?.(message),
      skip: (reason) => {
        throw new SkipError(reason);
      },
      meta: state,
    };
    try {
      if (entry.beforeEach !== noop) await withTimeout(Promise.resolve(entry.beforeEach(state)), entry.timeout, `${item.name} beforeEach`);
      await withTimeout(Promise.resolve(item.fn(state, helpers)), item.timeout || entry.timeout, item.name);
      if (entry.afterEach !== noop) await withTimeout(Promise.resolve(entry.afterEach(state)), entry.timeout, `${item.name} afterEach`);
      const ms = Date.now() - testStart;
      results.push({ name: item.name, status: "passed", ms });
      reporter?.onPass?.(entry, item, ms);
    } catch (error) {
      const ms = Date.now() - testStart;
      const skipped = error instanceof SkipError;
      results.push({ name: item.name, status: skipped ? "skipped" : "failed", ms, error: skipped ? undefined : error, reason: skipped ? error.message : "" });
      if (skipped) reporter?.onSkip?.(entry, item, error.message);
      else reporter?.onFail?.(entry, item, error, ms);
      // Keep the suite's shared state usable after a failed assertion.
      try {
        if (entry.afterEach !== noop) await entry.afterEach(state);
      } catch (_) {
        /* ignore */
      }
    }
  }

  if (!suiteSkipped && only.length) {
    try {
      await withTimeout(Promise.resolve(entry.afterAll(state)), entry.timeout, `${entry.title} afterAll`);
    } catch (error) {
      results.push({ name: "(afterAll)", status: "failed", ms: 0, error });
      reporter?.onFail?.(entry, { name: "(afterAll)" }, error, 0);
    }
  }

  const summary = {
    title: entry.title,
    ms: Date.now() - started,
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    tests: results,
  };
  reporter?.onSuite?.(summary);
  return summary;
}

export function formatError(error) {
  if (!error) return "";
  if (error instanceof AssertionError) {
    const stack = String(error.stack || "")
      .split("\n")
      .slice(1)
      .filter((line) => line.includes("/tests/"))
      .slice(0, 3)
      .map((line) => line.trim());
    return [error.message, ...stack.map((line) => `    ${line}`)].join("\n");
  }
  return String(error.stack || error.message || error);
}
