# talk.

A small bilingual English dictionary prototype built as a **pure static site**.
No backend, no build step, no local model.

## What is in the project

```text
index.html
styles.css
theme.css
themes/
  ussr.css
  rhine.css
data.js
app.js
theme.js
content.js
prompts.js
manifest.webmanifest
sw.js
favicon.svg
icons/
vendor/
  idb.js
```

The word cache is stored in IndexedDB (`talk.words.v1`) through the vendored
`idb` library. It is checked before any model request. Cache entries can be
exported/imported as JSON, and the word page shows whether it came from the
local cache, was generated this time, or is a built-in demo entry.

Cache management is available from **settings → cache management**. It shows
word/audio counts, actual bytes, a usage meter, and allows changing the word
limit (10–2000) and retention (1–3650 days). The estimated word footprint is
shown above the recent-word list. Cached Qwen audio has a separate clear action.
The **regenerate** controls bypass the relevant cache: the word button forces a
new model lookup, and the small refresh button beside a speaker regenerates the
audio instead of replaying the cached clip.

The whole site is under **1 MB** (HTML/CSS/JS/icons plus a ~4 KB `idb` helper
that the Pages workflow downloads into `vendor/`). Nothing else is fetched at
runtime except the user-configured model API.

## Preview locally

```bash
bash scripts/fetch-assets.sh .   # once: downloads vendor/idb.js
python3 -m http.server 8080
```

Open <http://127.0.0.1:8080/>.

## Deploy to GitHub Pages

The repository is small enough to deploy directly. The Pages workflow copies the
app shell, downloads the `idb` helper into `vendor/`, and publishes the artifact.

1. Open **Settings → Pages**.
2. Set **Build and deployment → Source** to **GitHub Actions**.
3. Push to `main` / `master`, or run the workflow from the **Actions** tab.
4. After the deployment finishes, open:

   ```text
   https://<user>.github.io/<repo>/
   ```

Only these files are published: `index.html`, the CSS/JS/theme/copy/prompt
modules, `themes/`, `manifest.webmanifest`, `sw.js`, `favicon.svg`, `icons/`,
`LICENSE`, and the downloaded `vendor/idb.js`. There is no model to download and no 100 MB file
limit to work around, so the site also fits a branch-based deploy if preferred.

## Settings UX

Settings is split into three tabs: **模型 / 发音 / 数据**. Only the active tab is
rendered. All preference and model-field changes are autosaved after a short
debounce; the sticky footer reports `正在保存…` / `已自动保存` and provides a
single `完成` action. Clicking the backdrop during the opening animation is
ignored, so a double tap cannot immediately close the sheet.

## Multi-style translator

The top module bar switches between **词典** and **翻译**. The translator accepts
Chinese or English and produces five English versions in one model call:
极简口语, 地道习语, 书面正式, 网络流行, 优雅文句.

Style chips are selectable buttons; only selected styles are sent in the user
message, so choosing 2 of 5 genuinely reduces output tokens. The counter shows
`已选 n / 5`, and submitting with none selected is blocked. The translator has
an explicit `自动 / 中 → 英 / 英 → 英` mode switch. The
translator system prompt is static (styles, schema, and rules), with only the
source text and source language in the final user message, so it benefits from
prefix caching. Results are cached locally by source language + exact input for
30 days (up to 40 entries); use **重新生成** to bypass the cache. It shares the
active model profile and API settings with the dictionary.

Each style result is clickable and opens a sheet with useful phrases and Chinese
language notes. Style cards use distinct pastel tones, local emoji SVGs, 22px
corners, and full-width layout. The style emoji SVGs are from Twemoji
(CC-BY 4.0); attribution is in `icons/style/LICENSE.txt`. Results are cached by
source language + text, so English → English and Chinese → English do not share
the wrong entry.

## Wide-screen layout

In landscape above 720px the phone frame expands to the viewport, the home
hero/search use two columns, word entries put the hero beside the meaning
block, translator input/results use two columns, and sheets are centered at a
readable width. Portrait layout is unchanged.

## Multi-POS word entries

Words can now store multiple parts of speech, each with its own senses in
`posGroups`. The main POS stays first and is shown by default; POS pills in the
word header and a horizontal meaning pager switch between groups. Older cached
entries without `posGroups` are treated as one POS with their existing senses.

## Theme salon

The home page includes an AI-curated word exhibition. It starts with a static
fallback deck. Each press of **再印一版** generates one theme world with five
context-bound words, displays it immediately, and stores it in IndexedDB
(`talk.themeDecks.v1`, `decks` store, keyed by title; the database keeps every
edition). The **home exhibition queue** holds at most the latest eight shown
editions; choosing a cached theme that is not currently in that queue evicts
only the oldest displayed edition, never the database copy. The poster arrows
cycle through the display queue, and **选一版** opens a picker over the full
library. Settings → 数据 shows total theme count, display-queue usage,
approximate bytes, word count, and a clear action. Before a
request, all existing titles are passed as an `exclude` list at the **end** of
the user message so the static prompt prefix remains cache-friendly. No model
call happens on page load.

## Theme and content architecture

`theme.css` holds the base token contract (Paper). Each additional theme is one
file under `themes/` that only overrides what it needs:

```text
theme.css          base palette + shape/motion tokens
themes/ussr.css    constructivist overrides
themes/rhine.css   Rhine Lab overrides
theme.js           registry: label, chrome colour, stylesheet, copy key
content.js         base copy + themeCopy[<id>] voices
prompts.js         static model prompts (theme-independent)
```

The theme selector in **设置 → 数据** is generated from the registry, so a new
theme only needs a CSS file, a `theme.js` entry, and optionally a copy block.
See [THEME.md](THEME.md) for the exact steps and the token list.

The current themes are **Paper**, **USSR**, and **Rhine Lab**. Word-page spacing
in landscape is controlled by `--word-columns-lead` and friends in `styles.css`
instead of per-theme `!important` overrides.

## Model profiles

Settings includes independent model profiles for DeepSeek, OpenAI, Qwen,
Kimi, GLM, OpenRouter, Claude, and a blank custom profile. Each profile stores
its own base URL, model name, API key, and display name; switching profiles no
longer overwrites the previous one. Profiles can be added or deleted, and the
selection is persisted.

Claude's native API is not OpenAI-compatible, so the Claude preset ships with
a blank base URL and a note to use a compatible proxy. Qwen, Kimi, GLM and
OpenRouter are OpenAI-compatible endpoints; browser CORS behavior depends on
the provider.

The Qwen preset uses `qwen3.7-flash` on the QianwenAI compatible endpoint and
ships with **thinking disabled**, because Qwen3.7 Flash defaults to a thinking
mode that can consume most of the output budget and make lookups slow. The
profile also exposes an optional thinking budget; set it to 0 to use the model
default, or a small value such as 256–1024 for a bounded reasoning pass.
Thinking controls are also shown automatically for `deepseek-v4*`, `glm-5*`,
and `kimi-k2/k3` model names.

## PWA

The site includes:

- `manifest.webmanifest` with 192/512 any + maskable icons
- `sw.js` app-shell service worker with offline navigation fallback
- Apple touch icon and standalone meta tags
- An install button in model settings when the browser emits
  `beforeinstallprompt`

The service worker pre-caches the app shell (HTML/CSS/JS/IDB helper/icons) so
the UI launches offline. Dictionary content still needs the model API, and Qwen
audio needs the network; the device's built-in speech synthesis works offline.

The deployment workflow copies `manifest.webmanifest`, `sw.js`, and `icons/`
into the Pages artifact.

## Model prompt/cost optimizations

- Word and sentence system prompts are fully static: role, JSON schema, rules,
  depth counts, and few-shot examples live there.
- The user message only contains `task`, `detail`, and the dynamic query/text,
  with the query/text placed last so provider prefix caches can reuse the
  static system prefix across lookups.
- JSON mode is sent through `response_format`, and output caps are reduced
  (fast 1200 / standard 2200 / deep 3200 tokens).
- Background prefetch is capped at 4 related words per page instead of walking
  the entire relation graph.

## Progressive responses

Model calls use SSE streaming where the provider supports it. The loading page
shows a live preview as soon as `word`, `phonetic`, `translation`, `short`,
`sentence translation`, `tone`, or `structure` fields become complete; the full
word/sentence page replaces it when the JSON object finishes. Streaming
requests intentionally omit `response_format` because several OpenAI-compatible
gateways buffer the response when stream and structured-output flags are
combined; JSON is still enforced by the static system prompt. If a provider
rejects streaming, the client retries once with a normal non-streaming request.

### Spelling filter

The static word prompt now tells the model to treat common misspellings as
corrections rather than rare words, including missing/extra letters, adjacent
keys, repeated letters, and examples such as `recieve`, `definately`,
`enviroment`, and `accomodate`. It still protects real rare words, names,
brands, loanwords, and abbreviations. Existing cached typo entries may need
**重新生成词条**.

### Timeline labels

The word system prompt requires all explanatory etymology fields
(`origin.original`, `origin.story`, and stage label/text) to be Chinese, with a
negative example forbidding English paragraphs. Timeline `when` values such as
`19th century`/`Old English` are also normalized on render. Cached entries that
were generated before this prompt change may still need **重新生成词条**.

## Generation depth and cache

- **快速**: fewer senses/relations/examples; `max_tokens` 1400.
- **标准**: default; `max_tokens` 2600.
- **深入**: more senses/relations/examples; `max_tokens` 3800.

The setting lives in model settings and is stored locally. Word entries are
cached for up to 300 words / 90 days. A cached word is reused across all
generation depths; changing fast/standard/deep does not trigger a new API call.
Use the word page's **重新生成词条** action when a different depth is actually
wanted.

The default model is `deepseek-chat`. This is a normal chat model, not a
reasoning model; there is no hidden chain-of-thought budget to tune.
`deepseek-reasoner` is a separate, slower option and is not recommended for
dictionary lookups.

## Model API

The dictionary is generated through an OpenAI-compatible chat API configured
inside the app (DeepSeek by default). The API key is entered by each user in
the browser and is never stored in the repository.

Because this is a pure frontend app, the key is visible to the browser. Use a
limited-scope/limited-quota key. DeepSeek currently permits browser CORS from
the preview origin; some other providers may not.

## TTS

发音 has two engines, selectable in 设置 → 发音:

- **系统原生** — the device's `speechSynthesis`. Instant, no download, offline;
  voice quality depends on the device. This is the default.
- **Qwen 语音** — uses the active Qwen API profile's key and calls the regional
  `POST /api/v1/services/audio/tts/SpeechSynthesizer` endpoint directly from the
  browser (CORS is supported by the China endpoints). Defaults to
  `qwen-audio-3.1-tts-plus` and `longanhuan_v3.1`; model and voice are editable.
  `qwen3-tts*` model names switch to the multimodal generation route.

Qwen results are cached in IndexedDB (`talk.audio.v1`, versioned keys), so a
repeated playback is instant and offline. Audio cache entries have a dedicated
clear action in cache management; the refresh button beside a speaker forces a
new request instead of replaying the cached clip.

If Qwen fails (missing key, blocked CORS, HTTP error), the app shows the error
and falls back to the device voice, so a word is never left silent.

The bundled local Kokoro model was removed in v122: it cost ~115 MB per visitor,
took 13–17 seconds to load, and its quantized ONNX session was unreliable on
Android WebGPU. There is no local inference path any more, and no `models/`
directory to deploy.

Because this is a static GitHub Pages app, there is no backend that can hide a
key. Keys are held in `sessionStorage` (or `localStorage` when "记住密钥" is
checked) and are visible to anything running in that browser. Never commit a
key; use "记住密钥" off on shared devices, and use a limited quota/key. A
serverless proxy is required if the key must be hidden from the browser.

## Regression status

- Core interaction suite: **32/32 passed**
- Word cache hit/miss markers verified for cached, generated and demo entries

## Notes

- GitHub Pages serves over HTTPS, which matters for the service worker and
  reliable browser storage.
- Multi-word lookups are treated as phrases; spelling correction only runs for
  single-token input. Prompts also require factual restraint: omit uncertain
  IPA/etymology/relations rather than inventing them.
- The LAN HTTP preview (`http://<ip>:8080`) is **not a secure context**. The page
  also ships `<meta http-equiv="Content-Security-Policy"
  content="upgrade-insecure-requests">`, so browsers rewrite its own subresources
  to `https://` on non-localhost origins — open it from `127.0.0.1`, or serve
  HTTPS, when previewing over a LAN address.
- Private/incognito browsing may not retain the word or audio caches.

## License

Talk is released under the [MIT License](LICENSE).

Third-party assets keep their own licenses; see
[`icons/style/LICENSE.txt`](icons/style/LICENSE.txt) for the Twemoji SVG icons
and the model/runtime notices referenced above.
