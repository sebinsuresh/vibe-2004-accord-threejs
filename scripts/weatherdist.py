#!/usr/bin/env python3
"""Replicate weather2 in-page, sample 40k columns, print the distribution
and the threshold that yields a target coverage fraction."""
import asyncio, json, urllib.request, os
import websockets

PORT = 9367

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

    out = await ev("""
      (() => {
        function hash3(x,y,z){
          x=x-Math.floor(x); y=y-Math.floor(y); z=z-Math.floor(z);
          x=(x*0.1031)%1; y=(y*0.1030)%1; z=(z*0.0973)%1;
          const d=x*(y+33.33)+y*(x+z+33.33)+z*(x+y+33.33);
          let p=(x+y)*z+d; return p-Math.floor(p);
        }
        function vnoise(x,y,z){
          const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
          let fx=x-ix,fy=y-iy,fz=z-iz;
          fx=fx*fx*(3-2*fx); fy=fy*fy*(3-2*fy); fz=fz*fz*(3-2*fz);
          const a=hash3(ix,iy,iz), b=hash3(ix+1,iy,iz),
                c=hash3(ix,iy+1,iz), d=hash3(ix+1,iy+1,iz),
                e=hash3(ix,iy,iz+1), f=hash3(ix+1,iy,iz+1),
                g=hash3(ix,iy+1,iz+1), h=hash3(ix+1,iy+1,iz+1);
          const x0=a+(b-a)*fx, x1=c+(d-c)*fx, x2=e+(f-e)*fx, x3=g+(h-g)*fx;
          const y0=x0+(x1-x0)*fy, y1=x2+(x3-x2)*fy;
          return y0+(y1-y0)*fz;
        }
        function weather2(qx,qz){
          return vnoise(qx*0.0017,qz*0.0017,7.3)*0.60
               + vnoise(qx*0.0034,qz*0.0034,11.7)*0.28
               + vnoise(qx*0.0068,qz*0.0068,31.3)*0.12;
        }
        const vals=[];
        for(let i=0;i<200;i++)for(let j=0;j<200;j++){
          vals.push(weather2(i*30-3000, j*30-3000));
        }
        vals.sort((a,b)=>a-b);
        const n=vals.length;
        const q=p=>vals[Math.floor(p*n)];
        const mean=vals.reduce((s,v)=>s+v,0)/n;
        const sd=Math.sqrt(vals.reduce((s,v)=>s+(v-mean)*(v-mean),0)/n);
        const pct=t=>Math.round(100*vals.filter(v=>v>t).length/n);
        return {mean:mean.toFixed(3), sd:sd.toFixed(3),
          p50:q(0.5).toFixed(3), p75:q(0.75).toFixed(3),
          p85:q(0.85).toFixed(3), p90:q(0.90).toFixed(3),
          p95:q(0.95).toFixed(3), p99:q(0.99).toFixed(3),
          cov0_60:pct(0.60), cov0_65:pct(0.65), cov0_70:pct(0.70),
          cov0_72:pct(0.72), cov0_75:pct(0.75), cov0_78:pct(0.78)};
      })()
    """)
    print(json.dumps(out, indent=1))
    await ws.close()

asyncio.run(main())
