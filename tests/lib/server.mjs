/**
 * Static file server + scriptable model endpoint on ONE origin.
 *
 * Why one origin is the whole trick: talk. calls the model straight from the
 * page with `fetch`, so a real end-to-end test needs the fake model to answer
 * on the same origin as the app (no CORS preflight, no mixed-content rewrite
 * from index.html's `upgrade-insecure-requests`). Each browser test seeds
 * `baseUrl` = `${origin}/__mock`, which lands on the handler below.
 *
 * Mock control surface (in-process, used by suites):
 *   server.mock.on({ task: "word" }, { fixture: "word-serendipity" });
 *   server.mock.queue({ task: "word" }, [{ status: 500 }, { fixture: "word-serendipity" }]);
 *   server.mock.setFallback("word", { fixture: "word-min" });
 *   server.mock.requestsOf("word");           // captured wire traffic
 *   server.mock.reset();
 *
 * HTTP control surface (for debugging by hand):
 *   GET  /__mock/requests  -> captured requests as JSON
 *   POST /__mock/reset     -> clear capture + rules
 */

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");
const FIXTURE_DIR = path.join(ROOT, "tests/fixtures");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Deterministic PRNG so "random" chunking is reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Loads tests/fixtures/<name>.json (cached). */
export function fixture(name) {
  const file = path.join(FIXTURE_DIR, `${name}.json`);
  if (!fixtureCache.has(file)) {
    fixtureCache.set(file, JSON.parse(fs.readFileSync(file, "utf8")));
  }
  return fixtureCache.get(file);
}
const fixtureCache = new Map();

export function listFixtures() {
  return fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)).sort();
}

/* ------------------------------------------------------------- chunk plans */

function planChunks(text, plan, { size = 24, seed = 7 } = {}) {
  if (plan === "whole" || !plan) return [text];
  if (plan === "half") {
    const cut = Math.max(1, Math.floor(text.length / 2));
    return [text.slice(0, cut), text.slice(cut)];
  }
  if (plan === "chars") {
    const chars = [...text];
    return chars.length > 6000 ? [text] : chars;
  }
  if (plan === "lines") {
    const parts = text.split("\n").map((line, index, all) => (index < all.length - 1 ? `${line}\n` : line));
    return parts.filter((part) => part.length);
  }
  if (plan === "random") {
    const rng = mulberry32(seed);
    const chunks = [];
    let index = 0;
    while (index < text.length) {
      const take = 1 + Math.floor(rng() * size);
      chunks.push(text.slice(index, index + take));
      index += take;
    }
    return chunks;
  }
  // default: word-ish chunks of about `size` characters
  const chunks = [];
  let index = 0;
  while (index < text.length) {
    let end = Math.min(text.length, index + size);
    if (end < text.length) {
      const space = text.indexOf(" ", end);
      if (space !== -1 && space - end < size) end = space + 1;
    }
    chunks.push(text.slice(index, end));
    index = end;
  }
  return chunks;
}

/* ------------------------------------------------------------------ request */

function classify(body, url) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const user = [...messages].reverse().find((message) => message?.role === "user");
  let payload = null;
  if (user && typeof user.content === "string") {
    try {
      payload = JSON.parse(user.content);
    } catch (_) {
      payload = { text: user.content };
    }
  }
  let task = payload?.task;
  if (!task && payload && Array.isArray(payload.styles)) task = "translator";
  if (!task && payload && payload.word && Array.isArray(payload.themes)) task = "themes";
  return {
    task: task || "unknown",
    payload,
    messages,
    system: messages.find((message) => message?.role === "system")?.content || "",
    model: body?.model || "",
    stream: Boolean(body?.stream),
    path: url.pathname,
    google: /\/__mock\/google\//.test(url.pathname) || /:streamGenerateContent|:generateContent/.test(url.pathname),
  };
}

function matchRule(rule, info) {
  const match = rule.match || {};
  if (match.task && match.task !== info.task) return false;
  if (match.model && match.model !== info.model) return false;
  if (match.path && !new RegExp(match.path).test(info.path)) return false;
  const payload = info.payload || {};
  if (match.query && String(payload.query ?? "") !== String(match.query)) return false;
  if (match.text && String(payload.text ?? "") !== String(match.text)) return false;
  if (match.word && String(payload.word ?? "") !== String(match.word)) return false;
  if (match.styles && !match.styles.every((style) => (payload.styles || []).includes(style))) return false;
  if (match.body && !JSON.stringify(info.payload ?? null).includes(JSON.stringify(match.body).slice(1, -1))) return false;
  if (typeof match.predicate === "function" && !match.predicate(info)) return false;
  return true;
}

function contentOf(respond) {
  if (respond.content !== undefined) {
    return typeof respond.content === "string" ? respond.content : JSON.stringify(respond.content);
  }
  if (respond.fixture) return JSON.stringify(fixture(respond.fixture));
  if (respond.raw !== undefined) return String(respond.raw);
  return "";
}

/* ------------------------------------------------------------------- server */

export class MockServer {
  constructor({ root = ROOT, latency = 0 } = {}) {
    this.root = root;
    this.rules = [];
    this.fallback = {};
    this.requests = [];
    this.cors = true;
    this.latency = latency;
    this.server = null;
    this.port = 0;
    this.requestCount = {};
  }

  /** The doc-comment control surface (`server.mock.on(...)`) is the server itself. */
  get mock() {
    return this;
  }

  get origin() {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Also reachable, but a *different* origin — handy for CORS/offline tests. */
  get aliasOrigin() {
    return `http://localhost:${this.port}`;
  }

  async start() {
    if (this.server) return this;
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        if (!res.headersSent) this.send(res, 500, { error: String(error?.message || error) });
        else res.end();
      });
    });
    this.server.keepAliveTimeout = 5_000;
    await new Promise((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.port = this.server.address().port;
    return this;
  }

  async stop() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  }

  /* ---------------------------------------------------------- mock control */

  on(match, respond, { times = Infinity } = {}) {
    const rule = { match, respond, times };
    this.rules.push(rule);
    return rule;
  }

  /** Response queue: consumed one per matching request, then rule disappears. */
  queue(match, responds) {
    responds.forEach((respond) => this.on(match, respond, { times: 1 }));
    return this;
  }

  setFallback(task, respond) {
    this.fallback[task] = respond;
    return this;
  }

  reset() {
    this.rules = [];
    this.requests = [];
    this.requestCount = {};
    return this;
  }

  requestsOf(task) {
    return this.requests.filter((request) => request.task === task);
  }

  requestsFor(match) {
    return this.requests.filter((request) => matchRule({ match }, request));
  }

  lastRequest(task) {
    const pool = task ? this.requestsOf(task) : this.requests;
    return pool[pool.length - 1] || null;
  }

  async waitForRequests(count, { task, timeout = 8000 } = {}) {
    const started = Date.now();
    for (;;) {
      const pool = task ? this.requestsOf(task) : this.requests;
      if (pool.length >= count) return pool;
      if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${count} ${task || ""} request(s), saw ${pool.length}`);
      await sleep(25);
    }
  }

  /* ------------------------------------------------------------- handling */

  send(res, status, json, headers = {}) {
    const body = typeof json === "string" ? json : JSON.stringify(json);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(this.cors ? { "access-control-allow-origin": "*" } : {}),
      ...headers,
    });
    res.end(body);
  }

  async handle(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...(this.cors ? { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } : {}),
      });
      res.end();
      return;
    }
    if (url.pathname.startsWith("/__mock")) {
      await this.handleMock(req, res, url);
      return;
    }
    await this.handleStatic(req, res, url);
  }

  async handleStatic(req, res, url) {
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const target = path.join(this.root, pathname);
    if (!target.startsWith(this.root)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    let stat;
    try {
      stat = await fsp.stat(target);
      if (stat.isDirectory()) throw new Error("dir");
    } catch (_) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end(`not found: ${pathname}`);
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": "no-store",
      "content-length": stat.size,
    });
    fs.createReadStream(target).pipe(res);
  }

  async handleMock(req, res, url) {
    if (url.pathname === "/__mock/requests") {
      this.send(res, 200, this.requests.map((request) => ({
        task: request.task,
        model: request.model,
        stream: request.stream,
        payload: request.payload,
        body: request.body,
      })));
      return;
    }
    if (url.pathname === "/__mock/reset") {
      this.reset();
      this.send(res, 200, { ok: true });
      return;
    }

    const raw = await readBody(req);
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch (_) {
      body = null;
    }
    const info = classify(body, url);
    const record = {
      at: Date.now(),
      method: req.method,
      url: req.url,
      path: url.pathname,
      headers: req.headers,
      body,
      raw,
      ...info,
    };
    this.requests.push(record);
    this.requestCount[info.task] = (this.requestCount[info.task] || 0) + 1;

    // Pick the response: first live rule, else task fallback, else a per-task stub.
    let respond = null;
    for (const rule of this.rules) {
      if (rule.times <= 0) continue;
      if (!matchRule(rule, info)) continue;
      respond = rule.respond;
      if (rule.times !== Infinity) rule.times -= 1;
      break;
    }
    if (!respond) respond = this.fallback[info.task] || this.fallback["*"] || DEFAULT_FALLBACK[info.task] || { status: 500, content: { error: { message: "no mock rule" } } };
    record.respond = summarizeRespond(respond);

    await this.writeMock(res, respond, record);
  }

  async writeMock(res, respond, record) {
    const status = respond.status ?? 200;
    const delay = respond.delayMs ?? this.latency;
    const mode = respond.mode || (record.google ? "google" : record.stream ? "sse" : "json");
    const corsHeaders = this.cors ? { "access-control-allow-origin": "*" } : {};

    if (delay) await sleep(delay);
    if (respond.hang) {
      // Never answer: exercises the client's 60s abort path. The socket is left
      // open on purpose; the browser test aborts before it matters.
      record.hung = true;
      return;
    }

    if (respond.status && respond.status >= 400 && respond.content === undefined && !respond.fixture && !respond.raw) {
      const message = respond.message || `mock status ${status}`;
      this.send(res, status, respond.body || { error: { message, type: "mock_error" } }, { ...corsHeaders, ...(respond.headers || {}) });
      return;
    }

    let content = contentOf(respond);
    if (typeof respond.truncate === "number") content = content.slice(0, respond.truncate);
    if (respond.prefix) content = respond.prefix + content;
    if (respond.suffix) content = content + respond.suffix;

    if (mode === "json") {
      const payload = respond.google
        ? { candidates: [{ content: { parts: [{ text: content }], role: "model" }, finishReason: "STOP" }] }
        : {
            id: "chatcmpl-mock",
            object: "chat.completion",
            created: 1_700_000_000,
            model: record.model || "mock",
            choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: content.length, total_tokens: 10 + content.length },
          };
      this.send(res, status, payload, { ...corsHeaders, ...(respond.headers || {}) });
      return;
    }

    if (mode === "text") {
      res.writeHead(status, { "content-type": respond.contentType || "text/plain; charset=utf-8", "cache-control": "no-store", ...corsHeaders, ...(respond.headers || {}) });
      res.end(content);
      return;
    }

    // Streaming (OpenAI `chat.completion.chunk` or Google `:streamGenerateContent`).
    const frameSep = respond.frameStyle === "crlf" ? "\r\n\r\n" : "\n\n";
    const lineSep = respond.frameStyle === "crlf" ? "\r\n" : "\n";
    const chunkSize = respond.chunkSize || 24;
    const plan = respond.chunkPlan || "words";
    const google = respond.google ?? record.google;
    const chunks = planChunks(content, plan, { size: chunkSize, seed: respond.seed || 7 });
    const frameFor = (text) => {
      if (google) {
        return `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }], role: "model" }, index: 0 }] })}`;
      }
      return `data: ${JSON.stringify({
        id: "chatcmpl-mock",
        object: "chat.completion.chunk",
        created: 1_700_000_000,
        model: record.model || "mock",
        choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
      })}`;
    };

    res.writeHead(status, {
      "content-type": respond.contentType || "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      ...corsHeaders,
      ...(respond.headers || {}),
    });

    const write = (value) => {
      res.write(value);
    };

    if (respond.splitBytes) {
      // Build the whole body, then slice at raw byte offsets. This is the only
      // way to prove the client's TextDecoder handles a multi-byte UTF-8
      // character split across two network chunks (SSE text is already UTF-8
      // decoded by fetch, so we have to split before the decoder sees it).
      let body = "";
      for (const chunk of chunks) body += `${frameFor(chunk)}${frameSep}`;
      if (!respond.omitDone) body += `${respond.google ? "" : "data: [DONE]"}${frameSep}`;
      const bytes = Buffer.from(body, "utf8");
      const step = respond.splitBytes === true ? 3 : Number(respond.splitBytes);
      for (let offset = 0; offset < bytes.length; offset += step) {
        if (res.writableEnded) return;
        write(bytes.subarray(offset, Math.min(bytes.length, offset + step)));
        if (respond.frameDelayMs) await sleep(respond.frameDelayMs);
      }
      res.end();
      return;
    }

    for (let index = 0; index < chunks.length; index += 1) {
      if (res.writableEnded) return;
      if (respond.keepAlive && index > 0 && index % 8 === 0) write(`: keep-alive${lineSep}${lineSep}`);
      write(`${frameFor(chunks[index])}${frameSep}`);
      if (respond.frameDelayMs) await sleep(respond.frameDelayMs);
    }
    if (!respond.omitDone && !google) write(`data: [DONE]${frameSep}`);
    res.end();
  }
}

function summarizeRespond(respond) {
  const copy = { ...respond };
  if (copy.match) delete copy.match;
  return copy;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Fallbacks so an unexpected request (e.g. the post-render theme backfill) never
 * turns a test into a random failure. Tests that assert on a task still script
 * it explicitly.
 */
const DEFAULT_FALLBACK = {
  word: { fixture: "word-min" },
  sentence: { fixture: "sentence-min" },
  themes: { content: { examplesByTheme: {} } },
  theme: { fixture: "theme-min" },
  translator: { fixture: "translator-min" },
  unknown: { status: 404, content: { error: { message: "unscripted request" } } },
};

export async function startServer(options) {
  const server = new MockServer(options);
  await server.start();
  return server;
}
