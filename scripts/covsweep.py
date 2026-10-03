#!/usr/bin/env python3
"""Sweep uCoverage in the REAL shader; count hit pixels in-page via canvas."""
import asyncio, json, urllib.request
import websockets

PORT = 9371

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
        window.__slab = s;
        s.material.fragmentShader = s.material.fragmentShader
          .replace('float alpha = hit * horizonFade;', 'float alpha = hit;')
          .replace('fragColor = vec4(cloudCol, alpha);',
                   'fragColor = vec4(1.0, 1.0, 1.0, alpha);');
        s.material.needsUpdate = true;
        return 'hit mask'; })()
    """))

    # count white pixels in sky band rows 40..300 via 2D canvas copy
    counter = """
      (() => {
        const src = window.__renderer.domElement;
        let c = document.getElementById('__probe2d');
        if (!c) { c = document.createElement('canvas'); c.id='__probe2d';
          c.width = src.width; c.height = src.height;
          c.style.display='none'; document.body.appendChild(c); }
        const ctx = c.getContext('2d');
        ctx.drawImage(src, 0, 0);
        const y0=40, y1=300;
        const img = ctx.getImageData(0, y0, c.width, y1-y0).data;
        let n=0, tot=0;
        for (let i=0;i<img.length;i+=4){ tot++;
          if (img[i]>200 && img[i+1]>200 && img[i+2]>200) n++; }
        return Math.round(100*n/tot);
      })()
    """

    for cov in (0.0, 0.3, 0.62, 1.0, 1.5, 2.0, 3.0):
        await ev(f"window.__slab.material.uniforms.uCoverage.value = {cov}")
        await ev("window.__sim.renderFrame(35)")
        pct = await ev(counter)
        print(f"uCoverage={cov:4.2f} -> sky band hit coverage: {pct}%")
    await ws.close()

asyncio.run(main())
