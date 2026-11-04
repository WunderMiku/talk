# talk.

A small bilingual English dictionary prototype built as a **pure static site**.
No backend, no build step, and no runtime CDN/model download dependency.

## What is in the project

```text
index.html
styles.css
data.js
app.js
favicon.svg
models/
  onnx-community/Kokoro-82M-v1.0-ONNX/
    config.json
    tokenizer.json
    tokenizer_config.json
    onnx/model_quantized.onnx
    voices/*.bin
vendor/
  kokoro.web.js
  ort/ort-wasm-simd-threaded.jsep.{mjs,wasm}
```

The word cache is stored in IndexedDB (`talk.words.v1`) through the vendored
`idb` library. It is checked before any model request. Cache entries can be
exported/imported as JSON, and the word page shows whether it came from the
local cache, was generated this time, or is a built-in demo entry.

Cache management is available from **settings → cache management**. It shows
word/audio counts, actual bytes, a usage meter, and allows changing the word
limit (10–2000) and retention (1–3650 days). The estimated word footprint is
shown above the recent-word list. Audio entries have a separate clear action.
The **regenerate** controls bypass the relevant cache: the word button forces a
new model lookup, and the small refresh button beside a speaker regenerates the
WAV instead of replaying the old cached audio.

Total size is about **115 MB**:

- Kokoro q8 model: ~92 MB
- ONNX Runtime WASM: ~21 MB
- Kokoro JS + six voices: ~5 MB
- app/data/styles/icons: < 1 MB
- `idb` browser bundle: ~4 KB

The model, runtime, voices, CSS and JS are all served from the same static
origin. There are no `fetch` calls to Hugging Face or jsDelivr at runtime.

## Preview locally

```bash
cd talk-web
python3 -m http.server 8080
```

Open <http://127.0.0.1:8080/>.

## Deploy to GitHub Pages

The recommended path uses **GitHub Actions** to fetch the large Kokoro assets
during deployment. The repository stays small, and you can create it from the
GitHub web UI without uploading a 92 MB file.

### A. Recommended: GitHub Actions, small repo

Prepare only these files in the repository:

```text
index.html
styles.css
data.js
app.js
favicon.svg
.nojekyll
.github/workflows/pages.yml
scripts/fetch-assets.sh
.gitignore
```

Do **not** upload `models/` or `vendor/`; the workflow downloads them into the
Pages artifact at deploy time.

1. Create a public GitHub repository.
2. Add the files above. GitHub's **Add file → Create new file** supports paths
   such as `.github/workflows/pages.yml`.
3. Open **Settings → Pages**.
4. Set **Build and deployment → Source** to **GitHub Actions**.
5. Run the workflow from the **Actions** tab (or push to `main` / `master`).
6. After the deployment finishes, open:

   ```text
   https://<user>.github.io/<repo>/
   ```

The workflow also downloads the `idb` browser bundle. The first run downloads
~115 MB of Kokoro assets and publishes them with the static site. Visitors then download them from Pages, not from
Hugging Face or jsDelivr.

Limits: GitHub Pages allows a 1 GB site and 100 MB per file. The q8 model is
~92 MB, so it fits.

### B. Alternative: commit assets and deploy from a branch

Use this only if you have Git/GitHub Desktop and want the model in the repo.
Force-add the ignored asset folders:

```bash
git add -f models vendor
git add .
git commit -m "Talk static site with local Kokoro assets"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

Then choose **Settings → Pages → Deploy from a branch → main / (root)**, and
remove or ignore the Pages workflow if you do not want it to run.

The GitHub web upload form has a 25 MB limit, so the branch route requires Git
for the 92 MB model.

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

## PWA

The site includes:

- `manifest.webmanifest` with 192/512 any + maskable icons
- `sw.js` app-shell service worker with offline navigation fallback
- Apple touch icon and standalone meta tags
- An install button in model settings when the browser emits
  `beforeinstallprompt`

The 115 MB Kokoro model/voices are deliberately **not** pre-cached by the
service worker; the app shell (HTML/CSS/JS/IDB helper/icons) is cached for
offline launch. TTS model loading remains a first-use online download.

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
word/sentence page replaces it when the JSON object finishes. If a provider
rejects streaming, the client retries once with a normal non-streaming request.

## Generation depth and cache

- **快速**: fewer senses/relations/examples; `max_tokens` 1400.
- **标准**: default; `max_tokens` 2600.
- **深入**: more senses/relations/examples; `max_tokens` 3800.

The setting lives in model settings and is stored locally. Word entries are
cached for up to 300 words / 90 days; cached entries are tagged with the depth
that produced them, so switching depth does not reuse the wrong shape of data.

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

## TTS options

The app now exposes a **发音** selector in settings:

- **Kokoro** — local neural TTS; slower first load, better/consistent voice.
- **系统原生** — immediate device `speechSynthesis`; no model download, voice
  depends on the device.

Kokoro audio cache keys are versioned (`v3`), so old generated WAVs are not
replayed after a voice/model fix. Use the refresh button beside a speaker to
force a new WAV, or clear audio cache from cache management.

The default Kokoro backend is now **WASM 兼容**, because some WebGPU runtimes
produce bad audio with the q8 quantized session. Use `自动` only if WebGPU is
known to work on the device. If a voice sounds wrong, press the refresh button
beside the speaker or clear audio cache; the settings panel reports the active
backend.

The choice is stored as a non-secret browser preference.

## Kokoro TTS

- 100% browser-side inference.
- Word lookup is local-first: IndexedDB cache → model API.
- Cache entries are exported/imported from the model settings as JSON.
- WebGPU is probed first and used when functional; it automatically falls back
  to WASM. The settings panel reports the active backend and load/generation
  timings.
- The bundled q8 model is the smallest practical Kokoro ONNX variant and keeps
  the file below GitHub's 100 MB per-file limit. Some WebGPU runtimes reject
  quantized q8 sessions; those devices will correctly report WASM and use the
  CPU path. A WebGPU-compatible fp16/fp32 variant would be larger than the
  single-file GitHub limit.
- q8 model (`model_quantized.onnx`) and the ONNX Runtime WASM are served
  locally.
- All six selectable voices are local.
- The first load is a large download from the Pages origin; after that,
  Transformers.js caches model/voice files in Cache Storage.
- Generated audio is cached in IndexedDB by voice + text.
- If model loading fails, the app silently falls back to the device's
  `speechSynthesis`.

The first TTS load on the local preview took ~17 seconds (WASM, Chromium).
A repeated playback from IndexedDB took about 0.1 seconds.

## Regression status

- Core interaction suite: **32/32 passed**
- Kokoro TTS suite: **7/7 passed**
- Local-only TTS request check: **0 external model/CDN requests**
- Silent TTS fallback verified by blocking the local model load

## Notes

- GitHub Pages serves over HTTPS, required for WebGPU and reliable browser
  storage.
- First visit downloads about 115 MB. Later visits reuse browser caches.
- The LAN HTTP preview (`http://<ip>:8080`) is **not a secure context**, so the
  Cache API is unavailable there. The app includes an IndexedDB/HTTP-cache
  fallback, but GitHub Pages over HTTPS is the intended production path.
- Private/incognito browsing may not retain model or audio caches.
- GitHub Pages has a soft bandwidth limit; 92 MB per first-time visitor is the
  main tradeoff of self-hosting the model.
- On the test machine, first model load was ~13–17s and repeated playback was
  ~1s; a new word on WASM took ~5s. WebGPU-capable devices are faster. The
  remaining per-word cost is Kokoro inference, not a network request.
