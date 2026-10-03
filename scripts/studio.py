#!/usr/bin/env python3
"""Render the car in the lightweight studio scene (no road/clouds/particles).

Usage: python3 scripts/studio.py [port] [view ...]
Views: side front rear quarter greenhouse fascia tail cowl
Writes ~/.hermes/cache/scratch/studio_<view>.png
"""
import asyncio, base64, json, os, subprocess, sys, time, urllib.request
import websockets

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9440
VIEWS = sys.argv[2:] or ["side", "front", "rear", "quarter"]
OUT = os.path.expanduser("~/.hermes/cache/scratch")

CHROME = [
    "/usr/bin/google-chrome", "--headless=new", "--disable-gpu",
    "--enable-unsafe-swiftshader", f"--remote-debugging-port={PORT}",
    "--window-size=1280,720", f"--user-data-dir=/tmp/studio{PORT}",
    "--no-sandbox", "--disable-dev-shm-usage",
    "about:blank",
]

async def main():
    proc = subprocess.Popen(CHROME, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                page = next(t for t in tabs if t["type"] == "page")
                break
            except Exception:
                time.sleep(0.5)
        else:
            raise RuntimeError("no chrome tab")
        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=64*1024*1024) as ws:
            mid = 0
            async def send(method, **params):
                nonlocal mid
                mid += 1
                await ws.send(json.dumps({"id": mid, "method": method, "params": params}))
                while True:
                    r = json.loads(await ws.recv())
                    if r.get("id") == mid:
                        return r

            async def ev(expr):
                r = await send("Runtime.evaluate", expression=expr, returnByValue=True)
                if r.get("exceptionDetails"):
                    print("EXC:", str(r["exceptionDetails"])[:300])
                    return None
                return r.get("result", {}).get("result", {}).get("value")

            mode = os.environ.get("STUDIO_MODE", "matte")
            await send("Page.enable")
            await send("Runtime.enable")
            await send("Page.navigate", url=f"http://127.0.0.1:8765/studio.html?mode={mode}")
            for _ in range(60):
                if await ev("!!window.__simReady"):
                    break
                await asyncio.sleep(0.5)
            else:
                raise RuntimeError("studio not ready")
            print("mode:", mode, "views:", VIEWS)
            for name in VIEWS:
                print("view:", await ev(f"window.__studio.setView({name!r})"))
                r = await send("Page.captureScreenshot", format="png")
                data = r.get("result", {}).get("data")
                if not data:
                    print("SHOTERR:", str(r)[:300])
                    continue
                open(f"{OUT}/studio_{name}.png", "wb").write(base64.b64decode(data))
                print(f"wrote studio_{name}.png")
    finally:
        proc.terminate()

asyncio.run(main())
