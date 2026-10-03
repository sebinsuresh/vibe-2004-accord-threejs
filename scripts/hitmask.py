#!/usr/bin/env python3
"""Decisive hit-mask: fragColor = white, alpha = hit. Measures the raw
raymarch hit mask with zero color/alpha interference."""
import asyncio, json, urllib.request, base64, os
import websockets

PORT = 9370
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

    print(await ev("""
      (() => { let s=null; window.__scene.traverse(o => {
        if (o.isMesh && o.material && o.material.glslVersion === '300 es') s = o; });
        if (!s) return 'no slab';
        s.material.fragmentShader = s.material.fragmentShader
          .replace('float alpha = hit * horizonFade;',
                   'float alpha = hit;')
          .replace('fragColor = vec4(cloudCol, alpha);',
                   'fragColor = vec4(1.0, 1.0, 1.0, alpha);');
        s.material.needsUpdate = true;
        return 'hit mask white'; })()
    """))
    await ev("window.__sim.renderFrame(35)")
    r = await send("Page.captureScreenshot", format="png")
    open(f"{OUT}/hitmask.png", "wb").write(base64.b64decode(r["data"]))
    print("wrote hitmask.png")
    await ws.close()

asyncio.run(main())
