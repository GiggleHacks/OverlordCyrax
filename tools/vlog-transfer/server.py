import asyncio
import json
import os
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse, StreamingResponse

from transfer import TransferState, load_manifest, run_transfer


ROOT = Path(__file__).resolve().parent
DESTINATION = Path(r"D:\Local\Unsorted")
MANIFEST = load_manifest(ROOT / "manifest.json")
VERSION = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))["version"]
state = TransferState(sum(item["bytes"] for item in MANIFEST), len(MANIFEST))
events: list[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = []
events_lock = threading.Lock()


def broadcast(payload):
    with events_lock:
        listeners = list(events)
    for loop, queue in listeners:
        loop.call_soon_threadsafe(queue.put_nowait, payload)


state.subscribe(broadcast)


def send_telegram(snapshot):
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        state.error("Telegram skipped: TELEGRAM_BOT_TOKEN is not set")
        return
    elapsed = snapshot.get("elapsed_seconds", 0)
    minutes, seconds = divmod(int(elapsed), 60)
    text = (
        f"✅ Vlog transfer complete\n\n"
        f"📦 Copied {snapshot['files_completed']}/{snapshot['total_files']} videos\n"
        f"💾 {snapshot['total_bytes'] / 1e9:.2f} GB\n"
        f"⏱️ Duration: {minutes}m {seconds}s\n"
        f"🛠️ Working on: vlog transfer tracker v{VERSION}\n"
        f"⚠️ Errors: {len(snapshot['errors'])}"
    )
    payload = urllib.parse.urlencode({
        "chat_id": "7908632266",
        "text": text,
    }).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=payload,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            if response.status != 200:
                state.error(f"Telegram returned HTTP {response.status}")
    except Exception as exc:
        state.error(f"Telegram delivery failed: {type(exc).__name__}")


app = FastAPI(title="Vlog Transfer Tracker")


@app.get("/")
def index():
    return FileResponse(ROOT / "index.html")


@app.get("/app.js")
def javascript():
    return FileResponse(ROOT / "app.js", media_type="text/javascript")


@app.get("/style.css")
def stylesheet():
    return FileResponse(ROOT / "style.css", media_type="text/css")


@app.get("/manifest.json")
def manifest():
    return FileResponse(ROOT / "manifest.json", media_type="application/json")


@app.get("/api/status")
def status():
    payload = state.snapshot()
    payload["version"] = VERSION
    return payload


@app.get("/events")
async def event_stream():
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    with events_lock:
        events.append((loop, queue))

    async def generator():
        try:
            yield f"data: {json.dumps(status())}\n\n"
            while True:
                payload = await queue.get()
                payload["version"] = VERSION
                yield f"data: {json.dumps(payload)}\n\n"
        finally:
            with events_lock:
                if (loop, queue) in events:
                    events.remove((loop, queue))

    return StreamingResponse(generator(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


def start_worker():
    threading.Thread(target=run_transfer, args=(MANIFEST, DESTINATION, state), kwargs={"on_complete": send_telegram}, daemon=True).start()


if __name__ == "__main__":
    start_worker()
    threading.Timer(1.0, lambda: webbrowser.open("http://127.0.0.1:8787/")).start()
    uvicorn.run(app, host="127.0.0.1", port=8787, log_level="warning")
