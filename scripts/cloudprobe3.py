#!/usr/bin/env python3
"""Compile the cloud shader sources manually in-page and print the info log."""
import asyncio, json, urllib.request
import websockets

PORT = 9336

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
            return {"EXC": str(r["exceptionDetails"])[:500]}
        return r.get("result", {}).get("value")

    await send("Page.enable")
    await send("Runtime.enable")
    await send("Page.navigate", url="http://127.0.0.1:8765/index.html?capture=1")
    for _ in range(60):
        if await ev("!!window.__simReady"): break
        await asyncio.sleep(0.5)

    probe = """
    (() => {
      let slab = null;
      window.__scene.traverse(o => {
        if (o.isMesh && o.material && o.material.glslVersion === '300 es') slab = o;
      });
      if (!slab) return {err: 'no slab'};
      const canvas = document.querySelector('canvas');
      const gl = canvas.getContext('webgl2');
      if (!gl) return {err: 'no webgl2 ctx'};
      const V3 = '#version 300 es\n';
      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, V3 + slab.material.vertexShader);
      gl.compileShader(vs);
      const vsOK = gl.getShaderParameter(vs, gl.COMPILE_STATUS);
      const vsLog = gl.getShaderInfoLog(vs);
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, V3 + slab.material.fragmentShader);
      gl.compileShader(fs);
      const fsOK = gl.getShaderParameter(fs, gl.COMPILE_STATUS);
      const fsLog = gl.getShaderInfoLog(fs);
      return {vsOK, vsLog, fsOK, fsLog};
    })()
    """
    print(json.dumps(await ev(probe), indent=1))
    await ws.close()

asyncio.run(main())
