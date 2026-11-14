/**
 * Browser side of the harness.
 *
 * Every suite gets the static site and the scripted model on ONE origin, so the
 * page can talk to `__mock` without CORS or the `upgrade-insecure-requests`
 * rewrite. Service workers are blocked: tests must never fight a cached shell.
 */

import { startServer } from "./server.mjs";

const VIEWPORT = { width: 390, height: 844 };

/** Settings blob the app reads at boot; baseUrl points at the mock endpoint. */
export function modelSettings(origin, overrides = {}) {
  const baseUrl = `${origin}/__mock`;
  return {
    provider: "custom",
    protocol: "openai",
    baseUrl,
    model: "mock-model",
    apiKey: "test-key",
    remember: true,
    detailLevel: "standard",
    profiles: [
      {
        id: "mock",
        name: "Mock",
        provider: "custom",
        protocol: "openai",
        baseUrl,
        model: "mock-model",
        apiKey: "test-key",
      },
    ],
    activeProfileId: "mock",
    ...overrides,
  };
}

export async function startEnv({ headless = true } = {}) {
  const server = await startServer();
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const contexts = new Set();

  /**
   * Opens a fresh page. Pass `config: null` for the offline/no-key scenario,
   * or a settings object to override parts of the default mock config.
   */
  async function newPage({ config = true, theme = "paper" } = {}) {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      serviceWorkers: "block",
      reducedMotion: "reduce",
    });
    contexts.add(context);
    if (config) {
      const settings = config === true ? modelSettings(server.origin) : modelSettings(server.origin, config);
      await context.addInitScript(
        ([cfg, th]) => {
          localStorage.setItem("talk.model.v1", JSON.stringify(cfg));
          localStorage.setItem("talk.theme.v1", th);
        },
        [settings, theme]
      );
    } else if (theme) {
      await context.addInitScript((th) => localStorage.setItem("talk.theme.v1", th), theme);
    }

    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error?.message || error)));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      // View transitions can abort when a route changes mid-animation.
      if (/Transition was skipped|ViewTransition/.test(text)) return;
      errors.push(text);
    });

    page.errors = errors;

    /** Navigate and wait for the app shell to mount. */
    page.open = async (hash = "/") => {
      await page.goto(`${server.origin}${hash}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".screen", { timeout: 10_000 });
      return page;
    };

    /** Wait until a specific route has painted. */
    page.waitForPage = (name, options = {}) =>
      page.waitForFunction(
        (route) => document.querySelector(".screen")?.dataset.page === route,
        name,
        { timeout: options.timeout ?? 10_000 }
      );

    return page;
  }

  async function close() {
    for (const context of contexts) await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.stop().catch(() => {});
  }

  return { server, browser, origin: server.origin, newPage, close };
}
