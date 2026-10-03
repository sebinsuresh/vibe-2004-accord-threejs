#!/usr/bin/env python3
"""Capture ALL console output during page load — a shader compile error
from three.js would show here."""
import asyncio, json, urllib.request
import websockets

PORT = 9377

async def main():
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json") as r:
        targets = json.load(r)
    page = next(t for t in targets if t.get("type") == "page")
    ws = await websockets.connect(page["webSocketDebuggerUrl"], max_size=64*1024*1024)
    _id = {"n": 0}
    msgs = []
    async def send(method, **params):
        _id["n"] += 1
        mid = _id["n"]
        await ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(await ws.recv())
            m = msg.get("method")
            if m in ("Runtime.consoleAPICalled", "Runtime.exceptionThrown",
                     "Log.entryAdded"):
                msgs.append(msg)
            if msg.get("id") == mid:
                return msg.get("result", {})

    await send("Page.enable")
    await send("Runtime.enable")
    await send("Log.enable")
    await send("Page.navigate", url="http://127.0.0.1:8765/index.html?capture=1")
    for _ in range(60):
        r = await send("Runtime.evaluate", expression="!!window.__simReady",
                       returnByValue=True)
        if r.get("result", {}).get("value"):
            break
        await asyncio.sleep(0.5)
    await asyncio.sleep(2)  # let first frames render (lazy shader compile)
    await send("Runtime.evaluate", expression="window.__sim.renderFrame(5)",
               returnByValue=True)
    await asyncio.sleep(1)

    for m in msgs:
        meth = m.get("method")
        if meth == "Runtime.consoleAPICalled":
            p = m["params"]
            txt = " ".join(str(a.get("value", a.get("description", "")))
                           for a in p.get("args", []))
            print(f"[console.{p['type']}] {txt[:400]}")
        elif meth == "Runtime.exceptionThrown":
            d = m["params"]["exceptionDetails"]
            print(f"[EXCEPTION] {d.get('text','')} {str(d.get('exception',{}).get('description',''))[:300]}")
        elif meth == "Log.entryAdded":
            e = m["params"]["entry"]
            print(f"[log.{e.get('level')}] {e.get('text','')[:400]}")
    if not msgs:
        print("(no console output at all)")
    await ws.close()

asyncio.run(main())
