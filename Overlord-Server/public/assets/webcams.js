const MAX_WEBCAM_TILES = 200;
const ids = [...new Set((new URLSearchParams(location.search).get("clientIds") || "").split(",").filter(Boolean))].slice(0, MAX_WEBCAM_TILES);
const TILE_FAILURE_TIMEOUT_MS = 5000;
const terminalTileStates = new Set(["error", "offline", "disconnected", "not-found"]);
const grid = document.getElementById("webcamTiles");
const count = document.getElementById("tileCount");
const stopAll = document.getElementById("stopAll");
const activeTiles = new Map();
const removalTimers = new Map();
function syncLayout() {
  const active = [...activeTiles.values()].filter((tile) => !tile.classList.contains("is-stopped"));
  grid.dataset.count = String(active.length);
  grid.classList.toggle("webcam-tiles--many", active.length > 12);
  count.textContent = `${active.length} LIVE`;
  stopAll.disabled = active.length === 0;
}
function stopTile(tile) {
  clearTileRemoval(tile.dataset.clientId);
  const frame = tile.querySelector("iframe");
  frame.src = "about:blank";
  tile.classList.add("is-stopped");
  syncLayout();
}

function clearTileRemoval(clientId) {
  const timer = removalTimers.get(clientId);
  if (timer) clearTimeout(timer);
  removalTimers.delete(clientId);
}

function removeTile(clientId, tile = activeTiles.get(clientId)) {
  clearTileRemoval(clientId);
  if (!tile || activeTiles.get(clientId) !== tile) return;
  const frame = tile.querySelector("iframe");
  if (frame) frame.src = "about:blank";
  activeTiles.delete(clientId);
  tile.remove();
  syncLayout();
}

function scheduleTileRemoval(tile) {
  const clientId = tile.dataset.clientId;
  if (!clientId || removalTimers.has(clientId)) return;
  removalTimers.set(clientId, setTimeout(() => removeTile(clientId, tile), TILE_FAILURE_TIMEOUT_MS));
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
  } else if (state === "not-found") {
    statusEl.className = "tile-status tile-status--error";
    statusEl.innerHTML = `<i class="fa-solid fa-plug-circle-xmark"></i> Not found`;
  } else if (state === "connecting" || state === "starting") {
    statusEl.className = "tile-status";
    statusEl.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Connecting`;
  } else if (state === "idle") {
    statusEl.className = "tile-status tile-status--warn";
    statusEl.innerHTML = `<i class="fa-solid fa-circle text-slate-400" style="font-size:6px"></i> Stopped`;
  }
}

function setTileState(tile, state) {
  tile.dataset.streamState = state;
  updateTileUi(tile, state);
  if (terminalTileStates.has(state)) {
    scheduleTileRemoval(tile);
  } else {
    clearTileRemoval(tile.dataset.clientId);
  }
}

async function refreshTileStatus() {
  const active = [...activeTiles.entries()].filter(([, tile]) => !tile.classList.contains("is-stopped"));
  if (!active.length) return;
  try {
    const params = new URLSearchParams({ page: "1", pageSize: String(MAX_WEBCAM_TILES), sort: "stable" });
    for (const [id] of active) params.append("id", id);
    const resp = await fetch(`/api/clients?${params}`, { credentials: "include" });
    if (!resp.ok) return;
    const data = await resp.json();
    const clients = new Map((data.items || []).map((c) => [c.id, c]));
    for (const [id, tile] of active) {
      const client = clients.get(id);
      const statusEl = tile.querySelector(".tile-status");
      const pingEl = tile.querySelector(".tile-ping");
      if (!client) {
        pingEl.textContent = "";
        setTileState(tile, "not-found");
        continue;
      }
      const ping = Number.isFinite(Number(client.pingMs)) ? `${Math.round(Number(client.pingMs))} ms` : "";
      pingEl.textContent = ping;
      if (!client.online) {
        setTileState(tile, "offline");
        continue;
      }
      if (tile.dataset.streamState === "not-found" || tile.dataset.streamState === "offline") {
        setTileState(tile, "connecting");
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
const tileStatusInterval = setInterval(refreshTileStatus, 8000);

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg && msg.type === "webcam_status" && msg.clientId) {
    const tile = activeTiles.get(msg.clientId);
    if (tile && !tile.classList.contains("is-stopped")) {
      setTileState(tile, msg.status);
    }
  }
});

window.addEventListener("pagehide", () => {
  clearInterval(tileStatusInterval);
  for (const clientId of [...removalTimers.keys()]) clearTileRemoval(clientId);
});
