#!/usr/bin/env python3
"""
Automated frame capture for the Accord sim.

Launches a headless Chrome with remote debugging, loads the page in
?capture=1 mode (deterministic fixed-timestep renderer), steps the sim
frame-by-frame over CDP, screenshots each frame, then encodes MP4 + GIF
with ffmpeg. No manual inspection loop needed.

Usage:
  python3 scripts/capture.py                 # 90 frames @30fps -> out/
  python3 scripts/capture.py --frames 120 --fps 30 --out out
Prereq: a static server on :8765 (python3 -m http.server 8765 from repo root)
"""
import argparse
import asyncio
import base64
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.request

import websockets

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

CHROME_CANDIDATES = [
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    os.path.expanduser(
        "~/.cache/ms-playwright/chromium_headless_shell-1217/"
        "chrome-headless-shell-linux64/chrome-headless-shell"),
]
FFMPEG_CANDIDATES = [
    shutil.which("ffmpeg"),
    os.path.expanduser("~/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"),
]


def first_existing(paths):
    for p in paths:
        if p and os.path.exists(p):
            return p
    return None


def wait_for_devtools(port, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json") as r:
                targets = json.load(r)
            page = next((t for t in targets if t.get("type") == "page"), None)
            if page and page.get("webSocketDebuggerUrl"):
                return page["webSocketDebuggerUrl"]
        except Exception:
            pass
        time.sleep(0.3)
    raise RuntimeError("Chrome devtools endpoint never came up")


class CDP:
    def __init__(self, ws_url):
        self.ws_url = ws_url
        self.ws = None
        self._id = 0
        self._pending = {}

    async def connect(self):
        self.ws = await websockets.connect(self.ws_url, max_size=64 * 1024 * 1024)

    async def send(self, method, **params):
        self._id += 1
        mid = self._id
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
            # ignore events while waiting for our reply

    async def evaluate(self, expr, await_promise=False):
        r = await self.send("Runtime.evaluate", expression=expr,
                            awaitPromise=await_promise, returnByValue=True)
        if r.get("exceptionDetails"):
            raise RuntimeError(f"JS exception: {r['exceptionDetails']}")
        return r.get("result", {}).get("value")


async def capture(args):
    chrome = first_existing(CHROME_CANDIDATES)
    ffmpeg = first_existing(FFMPEG_CANDIDATES)
    if not chrome:
        sys.exit("no chrome found")
    if not ffmpeg:
        sys.exit("no ffmpeg found")

    out_dir = os.path.join(ROOT, args.out)
    frames_dir = os.path.join(out_dir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    proc = subprocess.Popen(
        [chrome, "--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader",
         f"--remote-debugging-port={args.port}", "--hide-scrollbars",
         f"--window-size={args.width},{args.height}",
         "--disable-features=Translate", "--no-first-run",
         "--user-data-dir=" + os.path.join(out_dir, ".chrome-profile"),
         "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ws_url = wait_for_devtools(args.port)
        cdp = CDP(ws_url)
        await cdp.connect()
        await cdp.send("Page.enable")
        await cdp.send("Runtime.enable")
        await cdp.send("Emulation.setDeviceMetricsOverride",
                       width=args.width, height=args.height,
                       deviceScaleFactor=1, mobile=False)
        await cdp.send("Page.navigate", url=f"{args.url}?capture=1")

        # wait for the sim to boot
        deadline = time.time() + 30
        while not await cdp.evaluate("!!window.__simReady"):
            if time.time() > deadline:
                raise RuntimeError("window.__simReady never became true")
            await asyncio.sleep(0.5)

        print(f"capturing {args.frames} frames @ {args.fps} fps...")
        t0 = time.time()
        for i in range(args.frames):
            await cdp.evaluate(f"window.__sim.renderFrame({i})")
            shot = await cdp.send("Page.captureScreenshot", format="png")
            with open(os.path.join(frames_dir, f"frame_{i:04d}.png"), "wb") as f:
                f.write(base64.b64decode(shot["data"]))
            if (i + 1) % 15 == 0:
                print(f"  {i + 1}/{args.frames} ({time.time() - t0:.1f}s)")

        mp4 = os.path.join(out_dir, "accord_sim.mp4")
        gif = os.path.join(out_dir, "accord_sim.gif")
        pattern = os.path.join(frames_dir, "frame_%04d.png")

        print("encoding mp4...")
        subprocess.run([ffmpeg, "-y", "-framerate", str(args.fps), "-i", pattern,
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
                        "-movflags", "+faststart", mp4], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        print("encoding gif (2-pass palette)...")
        palette = os.path.join(out_dir, "palette.png")
        scale = "640:-1" if args.gif_width <= 0 else f"{args.gif_width}:-1"
        subprocess.run([ffmpeg, "-y", "-framerate", str(args.fps), "-i", pattern,
                        "-vf", f"fps={min(args.fps, 15)},scale={scale}:flags=lanczos,palettegen",
                        "-frames:v", "1", "-update", "1",
                        palette], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run([ffmpeg, "-y", "-framerate", str(args.fps), "-i", pattern, "-i", palette,
                        "-lavfi", f"fps={min(args.fps, 15)},scale={scale}:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4",
                        gif], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        print("done:")
        print(" ", mp4)
        print(" ", gif)
    finally:
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", type=int, default=90)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--out", default="out")
    ap.add_argument("--port", type=int, default=9333)
    ap.add_argument("--url", default="http://127.0.0.1:8765/index.html")
    ap.add_argument("--gif-width", type=int, default=640)
    asyncio.run(capture(ap.parse_args()))


if __name__ == "__main__":
    main()
