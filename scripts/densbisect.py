#!/usr/bin/env python3
"""Bisect density(): (A) layer only, no fbm; (B) fbm w/ coverage=5."""
import asyncio, json, urllib.request, base64, os
import websockets

PORT = 9343
OUT = os.path.expanduser("~/.hermes/cache/scratch")

DENS_LAYER = r"""
float density(vec3 p) {
  float h = (p.y - uSlabY.x) / (uSlabY.y - uSlabY.x);
  float layer = smoothstep(0.02, 0.28, h) * (1.0 - smoothstep(0.5, 1.0, h));
  return layer * 1.7;
}
"""

DENS_FBM = r"""
float density(vec3 p) {
  vec3 q = p + vec3(uScroll * 0.35, 0.0, uScroll);
  float w = fbm(q * 0.0038);
  float h = (p.y - uSlabY.x) / (uSlabY.y - uSlabY.x);
  float layer = smoothstep(0.02, 0.28, h) * (1.0 - smoothstep(0.5, 1.0, h));
  w = smoothstep(0.40 - uCoverage * 0.22, 0.60 - uCoverage * 0.12, w + layer * 0.12);
  return w * layer * 1.7;
}
"""

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

    # A: layer only (drop fbm entirely)
    print("A:", await ev(f"""
      (() => {{ let s=null; window.__scene.traverse(o => {{
        if (o.isMesh && o.material && o.material.glslVersion === '300 es') s = o; }});
        if (!s) return 'no slab';
        window.__src = s.material.fragmentShader;
        const start = s.material.fragmentShader.indexOf('float density');
        const end = s.material.fragmentShader.indexOf('void main');
        s.material.fragmentShader = s.material.fragmentShader.slice(0, start)
          + {json.dumps(DENS_LAYER)} + s.material.fragmentShader.slice(end);
        s.material.needsUpdate = true;
        return 'density=layer only'; }})()
    """))
    await ev("window.__sim.renderFrame(45)")
    r = await send("Page.captureScreenshot", format="png")
    open(f"{OUT}/dens_layer.png", "wb").write(base64.b64decode(r["data"]))

    # B: restore fbm density, coverage=5
    print("B:", await ev("""
      (() => { let s=null; window.__scene.traverse(o => {
        if (o.isMesh && o.material && o.material.glslVersion === '300 es') s = o; });
        s.material.fragmentShader = window.__src;
        s.material.needsUpdate = true;
        s.material.uniforms.uCoverage.value = 5.0;
        return 'fbm density, coverage=5'; })()
    """))
    await ev("window.__sim.renderFrame(45)")
    r = await send("Page.captureScreenshot", format="png")
    open(f"{OUT}/dens_fbm5.png", "wb").write(base64.b64decode(r["data"]))
    print("wrote dens_layer.png / dens_fbm5.png")
    await ws.close()

asyncio.run(main())
