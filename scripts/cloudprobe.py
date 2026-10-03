#!/usr/bin/env python3
"""Load ?capture=1, collect console errors + check cloud slab program state."""
import asyncio, json, urllib.request
import websockets

PORT = 9335

async def main():
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json") as r:
        targets = json.load(r)
    page = next(t for t in targets if t.get("type") == "page")
    ws = await websockets.connect(page["webSocketDebuggerUrl"], max_size=64*1024*1024)
    _id = {"n": 0}
    events = []
    async def send(method, **params):
        _id["n"] += 1
        mid = _id["n"]
        await ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("id") == mid:
                return msg.get("result", {})
            if msg.get("method") in ("Runtime.consoleAPICalled", "Runtime.exceptionThrown"):
                events.append(msg["method"])
    async def ev(expr):
        r = await send("Runtime.evaluate", expression=expr, returnByValue=True)
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
      const out = {slabFound: false, gl2: false, errors: []};
      // WebGL2 + 3D texture support
      const canvas = document.querySelector('canvas');
      const gl = canvas.getContext('webgl2');
      out.gl2 = !!gl;
      window.__scene.traverse(o => {
        if (o.isMesh && o.material && o.material.glslVersion === '300 es') {
          out.slabFound = true;
          out.program = o.material.program ? 'compiled' : 'no-program';
          out.visible = o.visible;
          out.pos = [o.position.x, o.position.y, o.position.z];
        }
      });
      return out;
    })()
    """
    print(json.dumps(await ev(probe), indent=1))
    # drain a few events
    await asyncio.sleep(0.5)
    try:
        while True:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=1))
            if msg.get("method") in ("Runtime.consoleAPICalled", "Runtime.exceptionThrown"):
                events.append(msg["method"])
    except Exception:
        pass
    print("console events:", events[:10])
    await ws.close()

asyncio.run(main())
