# AGENTS.md — Repository Guidelines for `talk.`

This file defines mandatory workflow rules and invariants for any agent or contributor modifying this repository.

## 1. Architecture & Build Rules
- **Zero-build static app**: plain HTML, CSS, and native ES Modules (`js/app.js` + `js/*/*.js`). Never introduce a bundler or runtime npm dependency.
- **Sync build numbers & SW precache**: after changing frontend assets or adding/removing any ESM file under `js/`, run:
  ```bash
  npm run bump          # bumps APP_BUILD and syncs index.html ?v= and sw.js SHELL
  npm run check:shell   # verifies build sync, SW precache coverage, JS syntax, and doc drift
  npm test              # runs all unit + Playwright offline E2E suites
  ```

## 2. Mandatory Documentation & Comment Sync (Every Change)
Before committing any feature, UI, protocol, storage, theme, or test change, review and update every affected document so descriptions never drift from code:

1. **`README.md`**: feature table, 3 workspaces (词典 / 翻译 / 精读), 4-tab settings, 7 themes, 3 native LLM protocols (OpenAI-compatible / Anthropic Claude / Google Gemini), deployment/APK instructions, and `docs/screenshots/*.jpg` when UI changes visibly.
2. **`docs/ARCHITECTURE.md`**: module directory tree, request/streaming pipeline, IndexedDB/localStorage table, protocol details, test counts, and manual QA checklist.
3. **`docs/TESTING.md`**: fixture inventory and complete `tests/suites/*.spec.mjs` list.
4. **`THEME.md`**: asset load order, theme registry list, settings navigation path (`设置 → 外观`), and design token contract.
5. **Code comments & metadata**: file-top JSDoc/header comments on modified JS/CSS files and `package.json` description/scripts.

> `tests/suites/shell.spec.mjs` automatically fails CI if `README.md` links/images break or if themes, ESM submodules, or test suites drift out of `README.md`, `THEME.md`, `docs/ARCHITECTURE.md`, or `docs/TESTING.md`.

## 3. Core Engineering Invariants
- **LLM protocols**: preserve native OpenAI-compatible, Anthropic Messages API (`/v1/messages` + browser CORS header + extended thinking), and Google Gemini support in `js/llm-client.js`.
- **Settings & cache performance**: keep Settings button & active tab clicks strictly idempotent, reuse the existing `.sheet` shell for sub-sheets, and never run per-entry `JSON.stringify` / `new Blob` loops on UI clicks (use `wordCacheSummary()` / memoized sizes).
- **Typography rhythm**: all display headwords and single-line ellipsis headers must use `--lh-display`, `--lh-display-phrase`, `--lh-ui-single`, and `--hero-subrow-gap` tokens in `css/styles.css` so descenders (`g/j/p/q/y`) never collide with phonetic rows or get clipped.
- **Theme boundary**: themes (`css/themes/*.css`) override visual tokens/surfaces only — never re-declare core page layout grids.
- **Storage safety**: keep API keys sealed via `js/storage/vault.js` (AES-GCM), keep wordbook AI classification lossless, and keep IndexedDB caches unlimited with zero-loss migration.
