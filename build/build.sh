#!/usr/bin/env bash
# Builds dist/: the card, the patched Flare-JS runtime, CanvasKit, the weather frog artwork, the
# frog stills and the Meteocons icons, all in one flat folder (HACS serves a card's files flat).
set -euo pipefail
cd "$(dirname "$0")/.."

FROGGY_REPO="R0rt1z2/Froggy"
FROGGY_COMMIT="87376cc913fba46ad8c581950ccf7dc5c6f376df"
FLARE_JS="@2dimensions/flare-js@1.0.0"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Flare-JS 1.0.0 with the patch that reads Flare format 24 and draws without WebGL.
(cd "$work" && npm pack "$FLARE_JS" --silent >/dev/null && tar xzf ./*.tgz)
patch -s -d "$work/package" -p1 < vendor/flare-js/flare-js.patch
(cd "$work" && npm init -y >/dev/null \
  && npm install --silent --no-audit --no-fund gl-matrix@2.8.1 bezier-easing@2.1.0 esbuild@0.24.0)
(cd "$work/package" && ../node_modules/.bin/esbuild source/Flare.js --bundle --minify \
  --format=iife --global-name=Flare --log-level=warning --outfile="$work/Flare.min.js")

rm -rf dist
mkdir dist
cp "$work/Flare.min.js" "$work/package/canvaskit/canvaskit.js" "$work/package/canvaskit/canvaskit.wasm" dist/

# The artwork: a background and a frog animation per scene, time of day and weather.
for scene in fields hill mushroom; do
  for part in morning day sunset night; do
    for weather in sunny cloudy hazy rainy snowy; do
      for kind in bg.webp frog.flr; do
        name="${scene}_${part}_${weather}_${kind}"
        curl -sfL -o "dist/$name" "https://raw.githubusercontent.com/$FROGGY_REPO/$FROGGY_COMMIT/assets/$name"
      done
    done
  done
done

# Frog stills (rendered by build/render_stills.py) and the Meteocons icons.
cp vendor/stills/*_frog.webp vendor/meteocons/*.svg dist/
cp src/froggy-weather-card.js dist/

echo "dist: $(ls dist | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1)"
