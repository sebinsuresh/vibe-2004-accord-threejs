#!/usr/bin/env python3
"""Decisive slab test: programs list, draw-call diff with slab hidden, pixel diff."""
import asyncio, json, urllib.request, base64, struct, zlib, os
import websockets

PORT = 9400
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
    await ev("window.__sim.renderFrame(45)")

    # programs compiled
    progs = await ev("""
      window.__renderer.info.programs.map(p => p.name || p.cacheKey.slice(0, 60))
    """)
    print("programs:", json.dumps(progs, indent=1))

    # draw-call diff hiding the slab
    info1 = await ev("JSON.stringify(window.__renderer.info.render)")
    slab_ref = await ev("""
      (() => { let s=null; window.__scene.traverse(o => {
        if (o.isMesh && o.material && o.material.glslVersion === '300 es') s = o; });
        window.__slab = s; return s ? 'found' : 'missing'; })()
    """)
    print("slab:", slab_ref)
    await ev("window.__slab.visible = false; window.__sim.renderFrame(45);")
    info2 = await ev("JSON.stringify(window.__renderer.info.render)")
    print("render with slab:   ", info1)
    print("render without slab:", info2)
    await ev("window.__slab.visible = true; window.__sim.renderFrame(45);")
    r = await send("Page.captureScreenshot", format="png")
    open(f"{OUT}/slab_on.png", "wb").write(base64.b64decode(r["data"]))
    await ev("window.__slab.visible = false; window.__sim.renderFrame(45);")
    r = await send("Page.captureScreenshot", format="png")
    open(f"{OUT}/slab_off.png", "wb").write(base64.b64decode(r["data"]))
    print("wrote slab_on.png / slab_off.png")
    await ws.close()

asyncio.run(main())
