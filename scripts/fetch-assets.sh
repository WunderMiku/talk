#!/usr/bin/env bash
set -euo pipefail

DEST="${1:-.}"
MODEL_ID="onnx-community/Kokoro-82M-v1.0-ONNX"
HF="https://huggingface.co/${MODEL_ID}/resolve/main"
TRANSFORMERS_VERSION="3.5.1"

MODEL_DIR="${DEST}/models/${MODEL_ID}"
VOICE_DIR="${MODEL_DIR}/voices"
VENDOR_DIR="${DEST}/vendor"
ORT_DIR="${VENDOR_DIR}/ort"

mkdir -p "${MODEL_DIR}/onnx" "${VOICE_DIR}" "${ORT_DIR}"

fetch() {
  local url="$1"
  local out="$2"
  curl -L --fail --retry 5 --retry-delay 2 --connect-timeout 30 --max-time 600 \
    -o "${out}" "${url}"
}

echo "Downloading Kokoro model metadata..."
fetch "${HF}/config.json" "${MODEL_DIR}/config.json"
fetch "${HF}/tokenizer.json" "${MODEL_DIR}/tokenizer.json"
fetch "${HF}/tokenizer_config.json" "${MODEL_DIR}/tokenizer_config.json"

echo "Downloading Kokoro q8 model (~92 MB)..."
fetch "${HF}/onnx/model_quantized.onnx" "${MODEL_DIR}/onnx/model_quantized.onnx"
echo "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478  ${MODEL_DIR}/onnx/model_quantized.onnx" | sha256sum -c -

echo "Downloading local voices..."
for voice in af_heart af_bella af_nicole am_michael bf_emma bm_george; do
  fetch "${HF}/voices/${voice}.bin" "${VOICE_DIR}/${voice}.bin"
done

echo "Downloading Kokoro JS and ONNX runtime..."
fetch "https://cdn.jsdelivr.net/npm/idb@8.0.0/build/umd.js" "${VENDOR_DIR}/idb.js"
fetch "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js" "${VENDOR_DIR}/kokoro.web.js"
fetch "https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}/dist/ort-wasm-simd-threaded.jsep.wasm" "${ORT_DIR}/ort-wasm-simd-threaded.jsep.wasm"
fetch "https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}/dist/ort-wasm-simd-threaded.jsep.mjs" "${ORT_DIR}/ort-wasm-simd-threaded.jsep.mjs"

echo "Kokoro assets ready in ${DEST}."
