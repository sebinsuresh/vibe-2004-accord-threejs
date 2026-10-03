#!/usr/bin/env python3
"""Replace fbm with procedural value noise (no sampler3D) to isolate the bug."""
import asyncio, json, urllib.request, base64, os
import websockets

PORT = 9341
OUT = os.path.expanduser("~/.hermes/cache/scratch")

FRAG = r"""
precision highp float;
in vec3 vWorld;
out vec4 fragColor;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTint;
uniform float uScroll;
uniform vec2 uSlabY;
uniform float uCoverage;

float hash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x),
                mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y);
  float b = mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
                mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y);
  return mix(a, b, f.z);
}
float fbm(vec3 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.03) * 0.30 + vnoise(p * 4.07) * 0.15;
}
float density(vec3 p) {
  vec3 q = p + vec3(uScroll * 0.35, 0.0, uScroll);
  float w = fbm(q * 0.0038);
  float h = (p.y - uSlabY.x) / (uSlabY.y - uSlabY.x);
  float layer = smoothstep(0.0, 0.30, h) * (1.0 - smoothstep(0.55, 1.0, h));
  w = smoothstep(0.40 - uCoverage * 0.22, 0.60 - uCoverage * 0.12, w + layer * 0.12);
  return w * layer * 1.7;
}
void main() {
  vec3 ro = vWorld;
  vec3 rd = normalize(vWorld - cameraPosition);
  float horizonFade = smoothstep(0.006, 0.05, rd.y);
  if (horizonFade <= 0.0) { fragColor = vec4(0.0); return; }
  const float g = 0.42;
  float cosT = dot(rd, uSunDir);
  float hg = (1.0 - g * g) / (12.566 * pow(1.0 + g * g - 2.0 * g * cosT, 1.5));
  float T = 1.0;
  vec3 acc = vec3(0.0);
  vec3 p = ro;
  float dt = 45.0;
  for (int i = 0; i < 16; i++) {
    float d = density(p);
    if (d > 0.001) {
      float ds = density(p + uSunDir * 60.0);
      float lit = exp(-ds * 0.5);
      vec3 col = mix(uSkyTint * 0.5, uSunColor, lit);
      col += uSunColor * hg * 2.4 * lit;
      float a = 1.0 - exp(-d * dt * 0.06);
      acc += T * col * a;
      T *= 1.0 - a;
      if (T < 0.02) break;
    }
    p += rd * dt;
    if (p.y > uSlabY.y) break;
  }
  fragColor = vec4(acc, (1.0 - T) * horizonFade);
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

    frag = json.dumps(FRAG)
    print(await ev(f"""
      (() => {{ let s=null; window.__scene.traverse(o => {{
        if (o.isMesh && o.material && o.material.glslVersion === '300 es') s = o; }});
        if (!s) return 'no slab';
        s.material.fragmentShader = {frag};
        s.material.needsUpdate = true;
        return 'frag=procedural noise'; }})()
    """))
    await ev("window.__sim.renderFrame(45)")
    r = await send("Page.captureScreenshot", format="png")
    open(f"{OUT}/proc_noise.png", "wb").write(base64.b64decode(r["data"]))
    print("wrote proc_noise.png")
    await ws.close()

asyncio.run(main())
