#!/usr/bin/env python3
"""Deeper probe: renderer.info, slab draw state, manual compile test."""
import asyncio, json, urllib.request
import websockets

PORT = 9335

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
            return {"EXC": str(r["exceptionDetails"])[:400]}
        return r.get("result", {}).get("value")

    await send("Page.enable")
    await send("Runtime.enable")
    await send("Page.navigate", url="http://127.0.0.1:8765/index.html?capture=1")
    for _ in range(60):
        if await ev("!!window.__simReady"): break
        await asyncio.sleep(0.5)
    await ev("window.__sim.renderFrame(45)")

    probe = """
    (() => {
      const out = {};
      let slab = null;
      window.__scene.traverse(o => {
        if (o.isMesh && o.material && o.material.glslVersion === '300 es') slab = o;
      });
      if (!slab) return {err: 'no slab'};
      out.frustumCulled = slab.frustumCulled;
      out.renderOrder = slab.renderOrder;
      out.transparent = slab.material.transparent;
      out.side = slab.material.side;
      // is it in the camera frustum?
      const f = new (Object.getPrototypeOf(window.__camera).constructor === Object ? Object : window.__camera.constructor)();
      // simpler: use Frustum via bounding sphere test against camera matrices
      slab.geometry.computeBoundingSphere();
      const sph = slab.geometry.boundingSphere.clone();
      sph.applyMatrix4(slab.matrixWorld);
      out.sphereRadius = sph.radius;
      out.sphereCenter = [sph.center.x, sph.center.y, sph.center.z];
      out.camPos = [window.__camera.position.x, window.__camera.position.y, window.__camera.position.z];
      out.camFar = window.__camera.far;
      // count draw calls
      out.info = window.__rendererInfo ? window.__rendererInfo() : 'n/a';
      return out;
    })()
    """
    print(json.dumps(await ev(probe), indent=1))
    await ws.close()

asyncio.run(main())
