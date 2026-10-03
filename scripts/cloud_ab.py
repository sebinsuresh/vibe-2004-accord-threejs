#!/usr/bin/env python3
"""A/B: swap cloud slab to constant red, screenshot; then restore shader."""
import asyncio, json, urllib.request, subprocess, os
import websockets

PORT = 9337
OUT = os.path.expanduser("~/.hermes/cache/scratch")

async def main():
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json") as r:
        targets = json.load(r)
    page = next(t for t in targets if t.get("type") == "page")
    ws = await websockets.connect(page["webSocketDebuggerUrl"], max_size=64*1024*1024)
    _id = {"n": 0}
    async def send(method, **params):
        _id["n"] += 1
        mid = _id["n"]
        await ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("id") == mid:
                return msg.get("result", {})
    async def ev(expr):
        r = await send("Runtime.evaluate", expression=expr, returnByValue=True)
        if r.get("exceptionDetails"):
            return {"EXC": str(r["exceptionDetails"])[:300]}
        return r.get("result", {}).get("value")

    await send("Page.enable")
    await send("Runtime.enable")
    await send("Page.navigate", url="http://127.0.0.1:8765/index.html?capture=1")
    for _ in range(60):
        if await ev("!!window.__simReady"): break
        await asyncio.sleep(0.5)

    # A: shader as-is
    await ev("window.__sim.renderFrame(45)")
    r = await send("Page.captureScreenshot", format="png")
    open(f"{OUT}/cloud_ab_shader.png", "wb").write(__import__("base64").b64decode(r["data"]))

    # B: constant red basic material on the slab
    print(await ev("""
    (() => {
      let slab = null;
      window.__scene.traverse(o => {
        if (o.isMesh && o.material && o.material.glslVersion === '300 es') slab = o;
      });
      if (!slab) return 'no slab';
      slab.material = new window.__THREE.MeshBasicMaterial({ color: 0xff0000 });
      return 'replaced with basic red';
    })()
    """))
    await ev("window.__sim.renderFrame(45)")
    r = await send("Page.captureScreenshot", format="png")
    open(f"{OUT}/cloud_ab_red.png", "wb").write(__import__("base64").b64decode(r["data"]))
    print("wrote cloud_ab_shader.png / cloud_ab_red.png")
    await ws.close()

asyncio.run(main())
