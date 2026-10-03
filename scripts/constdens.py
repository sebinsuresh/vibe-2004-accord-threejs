#!/usr/bin/env python3
"""Decisive: (A) density=1.0 constant + alpha as color; capture console errors."""
import asyncio, json, urllib.request, base64, os
import websockets

PORT = 9342
OUT = os.path.expanduser("~/.hermes/cache/scratch")

FRAG = r"""
precision highp float;
in vec3 vWorld;
out vec4 fragColor;
uniform vec2 uSlabY;
void main() {
  vec3 ro = vWorld;
  vec3 rd = normalize(vWorld - cameraPosition);
  float T = 1.0;
  vec3 p = ro;
  float dt = 50.0;
  for (int i = 0; i < 16; i++) {
    float d = 1.0;                       // constant density
    float a = 1.0 - exp(-d * dt * 0.02);
    T *= 1.0 - a;
    p += rd * dt;
    if (p.y > uSlabY.y) break;
  }
  float alpha = 1.0 - T;
  fragColor = vec4(alpha, 0.0, 0.0, alpha);  // alpha as red
}
"""

async def main():
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json") as r:
        targets = json.load(r)
    page = next(t for t in targets if t.get("type") == "page")
    ws = await websockets.connect(page["webSocketDebuggerUrl"], max_size=64*1024*1024)
    _id = {"n": 0}
    logs = []
    async def send(method, **params):
        _id["n"] += 1
        mid = _id["n"]
        await ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("id") == mid:
                return msg.get("result", {})
            if msg.get("method") == "Runtime.consoleAPICalled":
                logs.append(" ".join(str(a.get("value", a.get("description", "")))[:200]
                                     for a in msg["params"].get("args", [])))
            if msg.get("method") == "Runtime.exceptionThrown":
                logs.append("EXC " + str(msg["params"])[:300])
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

    print(await ev(f"""
      (() => {{ let s=null; window.__scene.traverse(o => {{
        if (o.isMesh && o.material && o.material.glslVersion === '300 es') s = o; }});
        if (!s) return 'no slab';
        s.material.fragmentShader = {json.dumps(FRAG)};
        s.material.needsUpdate = true;
        return 'frag=const density'; }})()
    """))
    await ev("window.__sim.renderFrame(45)")
    r = await send("Page.captureScreenshot", format="png")
    open(f"{OUT}/const_density.png", "wb").write(base64.b64decode(r["data"]))
    print("wrote const_density.png")
    print("console logs:", json.dumps(logs[:8], indent=1))
    await ws.close()

asyncio.run(main())
