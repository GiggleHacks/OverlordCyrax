const ids = [...new Set((new URLSearchParams(location.search).get("clientIds") || "").split(",").filter(Boolean))].slice(0, 12);
const grid = document.getElementById("webcamTiles");
const count = document.getElementById("tileCount");
const stopAll = document.getElementById("stopAll");
const activeTiles = new Map();
function syncLayout() {
  const active = [...activeTiles.values()].filter((tile) => !tile.classList.contains("is-stopped"));
  grid.dataset.count = String(active.length);
  count.textContent = `${active.length} LIVE`;
  stopAll.disabled = active.length === 0;
}
function stopTile(tile) {
  const frame = tile.querySelector("iframe");
  frame.src = "about:blank";
  tile.classList.add("is-stopped");
  syncLayout();
}
for (const id of ids) {
  const tile = document.createElement("article");
  tile.className = "webcam-tile";
  tile.dataset.clientId = id;
  tile.innerHTML = `<button class="tile-expand" title="Open in viewer" aria-label="Open webcam in viewer"><i class="fa-solid fa-expand"></i></button><span class="tile-client">${id.slice(0, 12)}</span><span class="tile-status"><i class="fa-solid fa-circle-notch fa-spin"></i> Connecting</span><span class="tile-ping"></span><button class="tile-stop" title="Stop webcam" aria-label="Stop webcam"><i class="fa-solid fa-stop"></i></button><iframe title="Webcam ${id}" src="/webcam?clientId=${encodeURIComponent(id)}&embedded=1"></iframe>`;
  tile.querySelector(".tile-stop").onclick = (event) => { event.stopPropagation(); stopTile(tile); };
  tile.querySelector(".tile-expand").onclick = () => {
    for (const t of activeTiles.values()) stopTile(t);
    window.open(`/viewer?clientId=${encodeURIComponent(id)}&mode=webcam&transition=1`, "_blank");
  };
  activeTiles.set(id, tile);
  grid.append(tile);
}
stopAll.onclick = () => { for (const tile of activeTiles.values()) stopTile(tile); grid.classList.remove("is-focused"); };
syncLayout();

function updateTileUi(tile, state) {
  const statusEl = tile.querySelector(".tile-status");
  if (state === "streaming") {
    statusEl.className = "tile-status tile-status--ok";
    statusEl.innerHTML = `<i class="fa-solid fa-circle text-emerald-400" style="font-size:6px"></i> Live`;
  } else if (state === "error") {
    statusEl.className = "tile-status tile-status--error";
    statusEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Error`;
  } else if (state === "offline") {
    statusEl.className = "tile-status tile-status--error";
    statusEl.innerHTML = `<i class="fa-solid fa-plug-circle-xmark"></i> Offline`;
  } else if (state === "disconnected") {
    statusEl.className = "tile-status tile-status--error";
    statusEl.innerHTML = `<i class="fa-solid fa-link-slash"></i> Disconnected`;
  } else if (state === "connecting" || state === "starting") {
    statusEl.className = "tile-status";
    statusEl.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Connecting`;
  } else if (state === "idle") {
    statusEl.className = "tile-status tile-status--warn";
    statusEl.innerHTML = `<i class="fa-solid fa-circle text-slate-400" style="font-size:6px"></i> Stopped`;
  }
}

async function refreshTileStatus() {
  const active = [...activeTiles.entries()].filter(([, tile]) => !tile.classList.contains("is-stopped"));
  if (!active.length) return;
  try {
    const resp = await fetch(`/api/clients?page=1&pageSize=50`, { credentials: "include" });
    const data = await resp.json();
    const clients = new Map((data.items || []).map((c) => [c.id, c]));
    for (const [id, tile] of active) {
      const client = clients.get(id);
      const statusEl = tile.querySelector(".tile-status");
      const pingEl = tile.querySelector(".tile-ping");
      if (!client) {
        statusEl.innerHTML = `<i class="fa-solid fa-plug-circle-xmark"></i> Not found`;
        statusEl.className = "tile-status tile-status--error";
        pingEl.textContent = "";
        tile.dataset.streamState = "offline";
        continue;
      }
      const ping = Number.isFinite(Number(client.pingMs)) ? `${Math.round(Number(client.pingMs))} ms` : "";
      pingEl.textContent = ping;
      if (!client.online) {
        statusEl.className = "tile-status tile-status--error";
        statusEl.innerHTML = `<i class="fa-solid fa-plug-circle-xmark"></i> Offline`;
        tile.dataset.streamState = "offline";
        continue;
      }
      if (tile.dataset.streamState) {
        updateTileUi(tile, tile.dataset.streamState);
      } else {
        const enrollment = client.enrollmentStatus || "pending";
        if (client.webcamAvailable && enrollment === "approved") {
          statusEl.className = "tile-status";
          statusEl.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Connecting`;
        } else if (enrollment === "approved" && client.online) {
          statusEl.className = "tile-status tile-status--ok";
          statusEl.innerHTML = `<i class="fa-solid fa-circle text-sky-400" style="font-size:6px"></i> Connected`;
        } else if (enrollment === "approved") {
          statusEl.innerHTML = `<i class="fa-solid fa-video-slash"></i> No camera`;
          statusEl.className = "tile-status tile-status--warn";
        } else {
          statusEl.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Connecting`;
          statusEl.className = "tile-status";
        }
      }
    }
  } catch {}
}
refreshTileStatus();
setInterval(refreshTileStatus, 8000);

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg && msg.type === "webcam_status" && msg.clientId) {
    const tile = activeTiles.get(msg.clientId);
    if (tile && !tile.classList.contains("is-stopped")) {
      tile.dataset.streamState = msg.status;
      updateTileUi(tile, msg.status);
    }
  }
});
