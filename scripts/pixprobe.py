#!/usr/bin/env python3
"""Render one frame, screenshot, scan for red-dominant pixels (tail streaks)
and bright-white sky pixels (clouds). Prints counts + sample coords."""
import asyncio, base64, json, urllib.request
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
        if r.get("exceptionDetails"):
            return {"EXC": r["exceptionDetails"].get("exception", {}).get("description", "")}
        return r.get("result", {}).get("value")

    await send("Page.enable")
    await send("Page.navigate", url="http://127.0.0.1:8765/index.html?capture=1")
    for _ in range(60):
        if await ev("!!window.__simReady"): break
        await asyncio.sleep(0.5)
    await ev("window.__sim.renderFrame(60)")

    # in-page pixel scan via a 2D copy of the canvas
    scan = """
    (() => {
      const canvas = document.querySelector('canvas');
      const c2 = document.createElement('canvas');
      c2.width = canvas.width; c2.height = canvas.height;
      const ctx = c2.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      const img = ctx.getImageData(0, 0, c2.width, c2.height).data;
      let red = 0, redSamples = [];
      for (let i = 0; i < img.length; i += 4) {
        const r = img[i], g = img[i+1], b = img[i+2];
        if (r > 140 && r - g > 60 && r - b > 60) {
          red++;
          if (redSamples.length < 6) {
            const px = (i/4) % c2.width, py = Math.floor((i/4) / c2.width);
            redSamples.push([px, py, r, g, b]);
          }
        }
      }
      // tail mesh instance sanity: first instance matrix from raw array
      let tailInfo = null;
      window.__scene.traverse(o => {
        if (o.isInstancedMesh && o.count === 48) {
          tailInfo = {count: o.count, visible: o.visible,
                      mat0: Array.from(o.instanceMatrix.array.slice(0, 16)),
                      renderOrder: o.renderOrder};
        }
      });
      return {red, redSamples, tailInfo, canvasSize: [canvas.width, canvas.height]};
    })()
    """
    print(json.dumps(await ev(scan), indent=1))
    await ws.close()

asyncio.run(main())
