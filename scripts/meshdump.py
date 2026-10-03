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
            rows = await ev("""(() => {
              const out = [];
              window.__scene.traverse(o => {
                if (!o.isMesh) return;
                const p = o.getWorldPosition(new window.__THREE.Vector3());
                if (Math.abs(p.x) < 1.3 && p.y > 0.85 && p.y < 1.65 && Math.abs(p.z) < 2.6) {
                  const c = o.material && o.material.color ? o.material.color.getHexString() : '?';
                  const par = o.geometry && o.geometry.parameters ? JSON.stringify(o.geometry.parameters).slice(0,70) : '';
                  out.push([+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), c, o.geometry.type, par]);
                }
              });
              return JSON.stringify(out);
            })()""")
            import json as _j
            for row in sorted(_j.loads(rows), key=lambda r: (r[2], r[0])):
                print(row)
            print("count:", len(_j.loads(rows)))
    finally:
        proc.terminate()

asyncio.run(main())
