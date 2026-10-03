#!/usr/bin/env python3
"""Decisive: replace cloud dome fragment with minimal constant white.
If sky band doesn't go ~white, the dome itself isn't rasterizing."""
import asyncio, json, urllib.request
import websockets

PORT = 9375

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
    logs = []
    def drain():
        pass
    await send("Page.navigate", url="http://127.0.0.1:8765/index.html?capture=1")
    for _ in range(60):
        if await ev("!!window.__simReady"): break
        await asyncio.sleep(0.5)

    print(await ev("""
      (() => { let s=null; window.__scene.traverse(o => {
        if (o.isMesh && o.material && o.material.glslVersion === '300 es') s = o; });
        if (!s) return 'no slab';
        window.__slab = s;
        s.material.fragmentShader = `
          precision highp float;
          in vec3 vWorld;
          out vec4 fragColor;
          void main() { fragColor = vec4(1.0, 0.0, 1.0, 1.0); }`;
        s.material.needsUpdate = true;
        return 'constant magenta'; })()
    """))
    await ev("window.__sim.renderFrame(35)")
    # count magenta pixels in sky band
    print(await ev("""
      (() => {
        const src = window.__renderer.domElement;
        let c = document.getElementById('__probe2d');
        if (!c) { c = document.createElement('canvas'); c.id='__probe2d';
          c.width = src.width; c.height = src.height;
          c.style.display='none'; document.body.appendChild(c); }
        const ctx = c.getContext('2d');
        ctx.drawImage(src, 0, 0);
        const img = ctx.getImageData(0, 40, c.width, 260).data;
        let n=0, tot=0;
        for (let i=0;i<img.length;i+=4){ tot++;
          if (img[i]>180 && img[i+2]>180 && img[i+1]<120) n++; }
        return {magenta_pct: Math.round(100*n/tot), canvas: c.width+'x'+c.height};
      })()
    """))
    # renderer info: is the dome in the draw list?
    print(await ev("""
      (() => { const i = window.__renderer.info.render;
        return {calls: i.calls, tris: i.triangles}; })()
    """))
    await ws.close()

asyncio.run(main())
