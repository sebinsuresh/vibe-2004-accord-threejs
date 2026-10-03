#!/usr/bin/env python3
"""Verify hit-mask replacement applied; count hits with particles hidden."""
import asyncio, json, urllib.request
import websockets

PORT = 9373

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
        const before = s.material.fragmentShader;
        s.material.fragmentShader = before
          .replace('float alpha = hit * horizonFade;', 'float alpha = hit;')
          .replace('fragColor = vec4(cloudCol, alpha);',
                   'fragColor = vec4(1.0, 1.0, 1.0, alpha);');
        const applied = s.material.fragmentShader !== before;
        s.material.needsUpdate = true;
        // hide particles + petals so only cloud hits can be white
        let hidden = 0;
        window.__scene.traverse(o => {
          if (o.isInstancedMesh) { o.visible = false; hidden++; }
        });
        return {applied, hasHitVar: s.material.fragmentShader.includes('float alpha = hit;'),
                hiddenInstanced: hidden};
      })()
    """))

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
    await ev("window.__sim.renderFrame(35)")
    print("sky band hit coverage (particles hidden):", await ev(counter), "%")

    # also: is the dome even rasterized in the sky band? force alpha=1 always
    print(await ev("""
      (() => { const s=window.__slab;
        s.material.fragmentShader = s.material.fragmentShader
          .replace('float alpha = hit;', 'float alpha = 1.0;');
        s.material.needsUpdate = true; return 'alpha=1 forced'; })()
    """))
    await ev("window.__sim.renderFrame(35)")
    print("sky band white with alpha forced to 1:", await ev(counter), "%")
    await ws.close()

asyncio.run(main())
