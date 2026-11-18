#!/usr/bin/env bash
# talk. — download the vendored runtime helpers (idb, Lenis, html-to-image).
# vendor/ is committed to the repo, so this script is only needed to refresh
# the files when bumping versions. Every download is verified against a
# pinned SHA-256; a mismatch aborts the script.
set -euo pipefail

DEST="${1:-.}"
VENDOR_DIR="${DEST}/vendor"

mkdir -p "${VENDOR_DIR}"

fetch() {
  local url="$1"
  local out="$2"
  local sha256="$3"
  curl -L --fail --retry 5 --retry-delay 2 --connect-timeout 30 --max-time 120 \
    -o "${out}" "${url}"
  if ! echo "${sha256}  ${out}" | sha256sum --check --status; then
    echo "ERROR: SHA-256 mismatch for ${out} (expected ${sha256})" >&2
    rm -f "${out}"
    exit 1
  fi
}

echo "Downloading idb browser bundle..."
fetch "https://cdn.jsdelivr.net/npm/idb@8.0.0/build/umd.js" "${VENDOR_DIR}/idb.js" \
  "ff4b3763d5b8e7981f606cb3d46df37ac5b7fc1d4b4eca34da129b47219edd59"

# Lenis smooths the .screen scroller; vendored so the PWA works offline.
echo "Downloading Lenis..."
fetch "https://cdn.jsdelivr.net/npm/lenis@1.1.20/dist/lenis.min.js" "${VENDOR_DIR}/lenis.min.js" \
  "978450a5e7638047c692941acdac7bc25e507289069d033f485569c42c4c7be3"

# html-to-image rasterises the composed share card.
echo "Downloading html-to-image..."
fetch "https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.js" "${VENDOR_DIR}/html-to-image.js" \
  "a90b42909d80964269ef6d5f3d1e4a5a7e2a4c263a5d2a76a9e7151901343262"

echo "Static site assets ready in ${DEST}."