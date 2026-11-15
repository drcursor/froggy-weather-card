"""Render each scene (background plus the frog's Hero-Action) as VP9 WebM videos into vendor/videos/,
from the artwork in dist/ (run build/build.sh first). Needs Playwright with Chrome, and ffmpeg:

    uv run --with playwright python3 build/render_videos.py [name prefix, e.g. hill_]

Each scene is drawn at 1920x1920 and 30 fps, then cut three ways, each covering what a card of
that shape shows of the square scene (the card picks one by its own shape):
  _portrait.webm   1200x1920, the middle of the width (a 1200x1920 portrait screen and narrower)
  _landscape.webm  1920x1200, the middle of the height (16:10 and wider)
  _square.webm     1080x1080, the whole scene (anything in between)
"""
import functools
import http.server
import pathlib
import subprocess
import sys
import tempfile
import threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "vendor" / "videos"
CUTS = {
    "portrait": "crop=1200:1920:360:0",
    "landscape": "crop=1920:1200:0:360",
    "square": "scale=1080:1080",
}


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(Quiet, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def encode(frames, bg, cut, out):
    graph = f"[0:v]scale=1920:1920[b];[b][1:v]overlay=shortest=1,{cut},format=yuv420p[v]"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", "30", "-i", str(bg),
         "-framerate", "30", "-i", f"{frames}/f%04d.png", "-filter_complex", graph, "-map", "[v]", "-an",
         "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-row-mt", "1", "-deadline", "good",
         "-cpu-used", "3", "-g", "90", str(out)],
        check=True,
    )


def main():
    prefix = sys.argv[1] if len(sys.argv) > 1 else ""
    OUT.mkdir(exist_ok=True)
    server = serve()
    port = server.server_address[1]
    names = sorted(p.name[: -len("_frog.flr")] for p in (ROOT / "dist").glob(f"{prefix}*_frog.flr"))
    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="chrome", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
        )
        for name in names:
            if all((OUT / f"{name}_{shape}.webm").exists() for shape in CUTS):
                continue
            page = browser.new_page(viewport={"width": 1920, "height": 1920})
            page.goto(f"http://127.0.0.1:{port}/build/frames.html#{name}")
            page.wait_for_function("window.info !== null", timeout=60000)
            info = page.evaluate("window.info")
            with tempfile.TemporaryDirectory() as frames:
                for i in range(info["frames"]):
                    page.evaluate(f"window.frame({i})")
                    page.screenshot(path=f"{frames}/f{i:04d}.png", omit_background=True, timeout=120000)
                page.close()
                for shape, cut in CUTS.items():
                    encode(frames, ROOT / "dist" / f"{name}_bg.webp", cut, OUT / f"{name}_{shape}.webm")
            print(name, f"{info['duration']:.1f} s", flush=True)
        browser.close()
    server.shutdown()


if __name__ == "__main__":
    main()
