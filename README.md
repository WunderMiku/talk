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

Total size is about **115 MB**:

- Kokoro q8 model: ~92 MB
- ONNX Runtime WASM: ~21 MB
- Kokoro JS + six voices: ~5 MB
- app/data/styles/icons: < 1 MB

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
5. Run the workflow from the **Actions** tab (or push to `main`).
6. After the deployment finishes, open:

   ```text
   https://<user>.github.io/<repo>/
   ```

The first workflow run downloads ~115 MB of Kokoro assets and publishes them
with the static site. Visitors then download them from Pages, not from
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

The choice is stored as a non-secret browser preference.

## Kokoro TTS

- 100% browser-side inference.
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
