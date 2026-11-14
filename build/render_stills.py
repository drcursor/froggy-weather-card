"""Render a still of each frog (the pose held between plays, on a transparent background) into
vendor/stills/, from the animations in dist/. Needs Playwright with Chrome and Pillow:

    uv run --with playwright --with pillow python3 build/render_stills.py
"""
import functools
import http.server
import io
import pathlib
import threading

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "vendor" / "stills"


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main():
    server = serve()
    port = server.server_address[1]
    names = sorted(p.name[: -len("_frog.flr")] for p in (ROOT / "dist").glob("*_frog.flr"))
    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="chrome", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
        )
        for name in names:
            page = browser.new_page(viewport={"width": 1280, "height": 1280})
            page.goto(f"http://127.0.0.1:{port}/build/still.html#{name}")
            page.wait_for_function("window.done !== null", timeout=60000)
            page.wait_for_timeout(200)
            png = page.locator("#c").screenshot(omit_background=True)
            Image.open(io.BytesIO(png)).save(OUT / f"{name}_frog.webp", "WEBP", quality=85, method=6)
            page.close()
            print(name)
        browser.close()
    server.shutdown()


if __name__ == "__main__":
    main()
