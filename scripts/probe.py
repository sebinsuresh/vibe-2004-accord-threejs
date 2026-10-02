#!/usr/bin/env python3
"""One-shot CDP probe: load ?capture=1, render a frame, dump scene stats."""
import asyncio, json, sys, urllib.request, time
import websockets

PORT = 9334

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
        return r.get("result", {}).get("value")

    await send("Page.enable")
    await send("Page.navigate", url="http://127.0.0.1:8765/index.html?capture=1")
    for _ in range(60):
        if await ev("!!window.__simReady"): break
        await asyncio.sleep(0.5)
    await ev("window.__sim.renderFrame(60)")

    probe = """
    (() => {
      const out = {};
      let sprites = 0, instanced = [], lines = 0;
      window.__scene.traverse(o => {
        if (o.isSprite) sprites++;
        if (o.isInstancedMesh) instanced.push({count: o.count, visible: o.visible,
          pos: o.parent ? [o.parent.position.x, o.parent.position.y, o.parent.position.z] : null});
        if (o.isLineSegments) lines++;
      });
      out.sprites = sprites;
      out.instanced = instanced;
      out.lineSegments = lines;
      // where are the cloud sprites in camera space?
      const cam = window.__camera;
      const cloudPositions = [];
      window.__scene.traverse(o => {
        if (o.isSprite) {
          const p = o.position.clone().project(cam);
          cloudPositions.push({ndc: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
            scale: [o.scale.x, o.scale.y], opacity: o.material.opacity});
        }
      });
      out.clouds = cloudPositions.slice(0, 8);
      out.cloudTotal = cloudPositions.length;
      out.cloudsInFront = cloudPositions.filter(c => c.z < 1 && c.z > -1 && Math.abs(c.x) < 1 && Math.abs(c.y) < 1).length;
      return out;
    })()
    """
    print(json.dumps(await ev(probe), indent=1))
    await ws.close()

asyncio.run(main())
