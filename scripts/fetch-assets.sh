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

echo "Static site assets ready in ${DEST}."
