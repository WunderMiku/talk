#!/usr/bin/env bash
# talk. — assemble the static site's runtime helper.
# The site has no backend, no build step and no local model: TTS uses the
# device's speech synthesis or the Qwen API, so the only vendored dependency
# is the small IndexedDB helper.
set -euo pipefail

DEST="${1:-.}"
VENDOR_DIR="${DEST}/vendor"

mkdir -p "${VENDOR_DIR}"

fetch() {
  local url="$1"
  local out="$2"
  curl -L --fail --retry 5 --retry-delay 2 --connect-timeout 30 --max-time 120 \
    -o "${out}" "${url}"
}

echo "Downloading idb browser bundle..."
fetch "https://cdn.jsdelivr.net/npm/idb@8.0.0/build/umd.js" "${VENDOR_DIR}/idb.js"

# Lenis smooths the .screen scroller; vendored so the PWA works offline.
echo "Downloading Lenis..."
fetch "https://cdn.jsdelivr.net/npm/lenis@1.1.20/dist/lenis.min.js" "${VENDOR_DIR}/lenis.min.js"

# html-to-image rasterises the composed share card.
echo "Downloading html-to-image..."
fetch "https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.js" "${VENDOR_DIR}/html-to-image.js"

echo "Static site assets ready in ${DEST}."
