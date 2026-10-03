#!/usr/bin/env python3
"""Render orthographic-style side and front views of the car for
proportion comparison against reference photos."""
import asyncio, base64, json, os, subprocess, sys, time, urllib.request
import websockets

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9410
OUT = os.path.expanduser("~/.hermes/cache/scratch")

CHROME = [
    "/usr/bin/google-chrome", "--headless=new", "--disable-gpu",
    "--enable-unsafe-swiftshader", f"--remote-debugging-port={PORT}",
    "--window-size=1280,720", f"--user-data-dir=/tmp/sideview{PORT}",
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
            await send("Page.enable")
            await send("Runtime.enable")
            await send("Page.navigate", url="http://127.0.0.1:8765/index.html?capture=1")

            async def ev(expr):
                r = await send("Runtime.evaluate", expression=expr, returnByValue=True)
                if r.get("exceptionDetails"):
                    print("EXC:", str(r["exceptionDetails"])[:300])
                    return None
                return r.get("result", {}).get("result", {}).get("value")

            print("title:", await ev("document.title"))
            print("ready:", await ev("String(window.__simReady)"), "sim:", await ev("String(typeof window.__sim)"))
            for _ in range(60):
                if await ev("!!window.__simReady"):
                    break
                await asyncio.sleep(0.5)
            else:
                raise RuntimeError("sim not ready")
            # park the car, hide particles/clouds, aim camera at the car
            setup = """
              (() => {
                const cam = window.__camera;
                window.__sim.renderFrame(0);
                // hide particles + clouds for a clean model view
                window.__scene.traverse(o => {
                  if (o.material && (o.material.glslVersion === '300 es')) o.visible = false;
                  if (o.isInstancedMesh || o.isLineSegments) o.visible = false;
                });
                return 'ok';
              })()
            """
            print(await ev(setup))
            views = {
                "hideA": "(() => { for (const o of window.__sim.carGroup.children[0].children) { if (o.isMesh && Math.abs(o.position.x) > 0.8 && o.position.z > 0.6 && o.position.y > 1.0) o.visible = false; } window.__sim.renderFrame(0); return 1; })()",
                "side":  "(() => { const c=window.__camera; c.position.set(-11, 1.0, 0); c.lookAt(0, 0.72, 0); c.fov=22; c.updateProjectionMatrix(); window.__sim.renderFrame(0); return 'side'; })()",
                "front": "(() => { const c=window.__camera; c.position.set(0, 1.1, 12); c.lookAt(0, 0.7, 0); c.fov=22; c.updateProjectionMatrix(); window.__sim.renderFrame(0); return 'front'; })()",
                "rear":  "(() => { const c=window.__camera; c.position.set(0, 1.1, -12); c.lookAt(0, 0.7, 0); c.fov=22; c.updateProjectionMatrix(); window.__sim.renderFrame(0); return 'rear'; })()",
                "quarter": "(() => { const c=window.__camera; c.position.set(-8, 1.5, -8); c.lookAt(0, 0.7, 0); c.fov=26; c.updateProjectionMatrix(); window.__sim.renderFrame(0); return 'quarter'; })()",
            }
            for name, expr in views.items():
                await ev(expr)
                r = await send("Page.captureScreenshot", format="png")
                data = r.get("result", {}).get("data")
                if not data:
                    print("SHOTERR:", str(r)[:400])
                    continue
                open(f"{OUT}/car_{name}.png", "wb").write(base64.b64decode(data))
                print(f"wrote car_{name}.png")
    finally:
        proc.terminate()

asyncio.run(main())
