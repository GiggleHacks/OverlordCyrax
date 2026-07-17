const MAX_WEBCAM_TILES = 200;
const ids = [...new Set((new URLSearchParams(location.search).get("clientIds") || "").split(",").filter(Boolean))].slice(0, MAX_WEBCAM_TILES);
const TILE_FAILURE_TIMEOUT_MS = 5000;
const terminalTileStates = new Set(["error", "offline", "disconnected", "not-found"]);
const grid = document.getElementById("webcamTiles");
const count = document.getElementById("tileCount");
const stopAll = document.getElementById("stopAll");
const activeTiles = new Map();
const removalTimers = new Map();
let focusSession = 0;
let focusPoll = null;

function tileWebcamUrl(clientId) {
  return `/webcam?clientId=${encodeURIComponent(clientId)}&embedded=1`;
}

function syncLayout() {
  const active = [...activeTiles.values()].filter((tile) => !tile.classList.contains("is-stopped"));
  grid.dataset.count = String(active.length);
  grid.classList.toggle("webcam-tiles--many", active.length > 12);
  grid.classList.toggle("is-focused", active.length === 1 && activeTiles.size > 1);
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

function startTile(tile) {
  const clientId = tile.dataset.clientId;
  if (!clientId) return;
  clearTileRemoval(clientId);
  const frame = tile.querySelector("iframe");
  tile.classList.remove("is-stopped");
  frame.src = tileWebcamUrl(clientId);
  setTileState(tile, "connecting");
  syncLayout();
}

function stopOtherTiles(selectedId) {
  for (const [id, tile] of activeTiles) {
    if (id !== selectedId && !tile.classList.contains("is-stopped")) stopTile(tile);
  }
}

function restoreAllTiles() {
  for (const tile of activeTiles.values()) {
    if (tile.classList.contains("is-stopped")) startTile(tile);
  }
  grid.classList.remove("is-focused");
  syncLayout();
}

function clearFocusWatch() {
  if (focusPoll) {
    clearInterval(focusPoll);
    focusPoll = null;
  }
}

function watchFocusedViewer(win, session) {
  clearFocusWatch();
  focusPoll = setInterval(() => {
    if (session !== focusSession) {
      clearFocusWatch();
      return;
    }
    if (!win || win.closed) {
      clearFocusWatch();
      if (session === focusSession) {
        restoreAllTiles();
        focusSession = 0;
      }
    }
  }, 700);
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
  tile.innerHTML = `<button class="tile-expand" title="Open in viewer" aria-label="Open webcam in viewer"><i class="fa-solid fa-expand"></i></button><span class="tile-client">${id.slice(0, 12)}</span><span class="tile-status"><i class="fa-solid fa-circle-notch fa-spin"></i> Connecting</span><span class="tile-ping"></span><button class="tile-stop" title="Stop webcam" aria-label="Stop webcam"><i class="fa-solid fa-stop"></i></button><iframe title="Webcam ${id}" src="${tileWebcamUrl(id)}"></iframe>`;
  tile.querySelector(".tile-stop").onclick = (event) => { event.stopPropagation(); stopTile(tile); };
  tile.querySelector(".tile-expand").onclick = () => {
    const viewerUrl = `/viewer?clientId=${encodeURIComponent(id)}&mode=webcam&transition=1&fromArray=1`;
    const win = window.open(viewerUrl, "_blank");
    if (!win) return;
    const session = ++focusSession;
    stopOtherTiles(id);
    watchFocusedViewer(win, session);
  };
  activeTiles.set(id, tile);
  grid.append(tile);
}
stopAll.onclick = () => {
  clearFocusWatch();
  focusSession = 0;
  for (const tile of activeTiles.values()) stopTile(tile);
  grid.classList.remove("is-focused");
};
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
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "webcam_status" && msg.clientId) {
    const tile = activeTiles.get(msg.clientId);
    if (tile && !tile.classList.contains("is-stopped")) {
      setTileState(tile, msg.status);
    }
  }
  if (msg.type === "webcam_array_viewer_closed" && focusSession) {
    clearFocusWatch();
    restoreAllTiles();
    focusSession = 0;
  }
});

window.addEventListener("pagehide", () => {
  clearInterval(tileStatusInterval);
  clearFocusWatch();
  for (const clientId of [...removalTimers.keys()]) clearTileRemoval(clientId);
});
