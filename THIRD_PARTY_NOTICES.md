# Third-party notices

Froggy Weather Card's own code is under the MIT License (see `LICENSE`). The files in `dist/`
also contain the following work by others.

| Component | Files in `dist/` | Source | License |
|---|---|---|---|
| Weather frog artwork | `*_bg.webp`, `*_frog.flr` | [R0rt1z2/Froggy](https://github.com/R0rt1z2/Froggy) at commit `87376cc` | Copyright Google LLC, see below |
| Frog stills | `*_frog.webp` | Rendered from the frog animations above by `build/render_stills.py` | Copyright Google LLC, see below |
| Flare-JS 1.0.0, patched | `Flare.min.js` | [2d-inc/Flare-JS](https://github.com/2d-inc/Flare-JS) | MIT, `vendor/flare-js/LICENSE` |
| gl-matrix 2.8.1 | bundled in `Flare.min.js` | [toji/gl-matrix](https://github.com/toji/gl-matrix) | MIT, `vendor/gl-matrix/LICENSE` |
| bezier-easing 2.1.0 | bundled in `Flare.min.js` | [gre/bezier-easing](https://github.com/gre/bezier-easing) | MIT, `vendor/bezier-easing/LICENSE` |
| CanvasKit (Skia), as shipped with Flare-JS 1.0.0 | `canvaskit.js`, `canvaskit.wasm` | [google/skia](https://skia.org) | BSD 3-Clause, `vendor/canvaskit/LICENSE` |
| Meteocons, fill style | `meteocons-*.svg` | [basmilius/meteocons](https://github.com/basmilius/meteocons) | MIT, `vendor/meteocons/LICENSE` |

## Changes to Flare-JS

`vendor/flare-js/flare-js.patch` changes Flare-JS 1.0.0 so that it:

- reads Flare format 24 files: blocks 116 to 120 are layer effects (effect renderer, mask, blur,
  drop shadow, inner shadow), and images carry an `isDynamic` flag with optional UVs. The effects
  are parsed but not drawn;
- skips empty component slots when initialising and disposing an artboard;
- draws in software, into a 2D canvas with CanvasKit's `MakeSWCanvasSurface`, when the browser
  has no WebGL;
- loads CanvasKit from a path instead of embedding it.

## Weather frog artwork

The weather frog artwork was made by Google for its weather experience on Android and the Nest
Hub. Copyright belongs to Google LLC. It is reproduced here, as in the Froggy project, for
non-commercial personal use under the fair use doctrine. This project is not affiliated with,
sponsored by or endorsed by Google. Rights holders who want the artwork removed can open an issue
and it will be taken down.
