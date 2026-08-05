const WEBCAMS_JS_VERSION = "1.6.0";
const MAX_WEBCAM_TILES = 200;
const TILE_GAP_PX = 8;
// Webcam feeds are landscape; score layouts by how the feed fits the cell, not raw cell area.
const TARGET_ASPECT = 16 / 9;
const ids = [...new Set((new URLSearchParams(location.search).get("clientIds") || "").split(",").filter(Boolean))].slice(0, MAX_WEBCAM_TILES);
// Each webcam gets exactly one 30s budget to reach its first frame. The budget
// starts when the connection attempt begins, never resets on internal retries,
// and is cancelled only when the webcam actually streams.
const CONNECT_TIMEOUT_MS = 30000;
// Webcams that can never load are dropped immediately — no retries, no grace period.
const IMMEDIATE_REMOVAL_STATES = new Set(["error", "offline", "not-found", "disconnected"]);
const grid = document.getElementById("webcamTiles");
const count = document.getElementById("tileCount");
const stopAll = document.getElementById("stopAll");
const activeTiles = new Map();
// clientId -> epoch ms when the 30s connect budget expires.
const connectDeadlines = new Map();
// clientId -> data URL of the last visible frame, cached before "Open in Viewer".
const tileSnapshots = new Map();
let focusSession = 0;
let focusPoll = null;
let layoutRaf = 0;
const resumeAfterVisibility = new Set();

function tileWebcamUrl(clientId) {
  return `/webcam?clientId=${encodeURIComponent(clientId)}&embedded=1`;
}

/** Pick cols/rows that maximize visible video area inside the available viewport. */
function bestGrid(n, width, height, gap) {
  if (n <= 0) return { cols: 1, rows: 1 };
  if (n === 1) return { cols: 1, rows: 1 };
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  let best = { cols: 1, rows: n, score: -Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (w - gap * (cols - 1)) / cols;
    const cellH = (h - gap * (rows - 1)) / rows;
    if (cellW <= 0 || cellH <= 0) continue;
    // Feeds letterbox (object-fit: contain), so only the aspect-fitted area is visible.
    // Raw cell area alone favors degenerate n×1 strip layouts on wide screens.
    const videoW = Math.min(cellW, cellH * TARGET_ASPECT);
    const videoH = videoW / TARGET_ASPECT;
    const empty = cols * rows - n;
    const fill = 1 - (empty / (cols * rows)) * 0.12;
    const score = videoW * videoH * fill;
    if (score > best.score) best = { cols, rows, score };
  }
  return best;
}

function applyViewportGrid(activeCount) {
  if (!grid) return;
  if (activeCount <= 0) {
    grid.style.gridTemplateColumns = "";
    grid.style.gridTemplateRows = "";
    return;
  }
  const rect = grid.getBoundingClientRect();
  const width = rect.width || grid.clientWidth || 1;
  const height = rect.height || grid.clientHeight || 1;
  const { cols, rows } = bestGrid(activeCount, width, height, TILE_GAP_PX);
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
}

function syncLayout() {
  const active = [...activeTiles.values()].filter((tile) => !tile.classList.contains("is-stopped"));
  grid.dataset.count = String(active.length);
  grid.classList.toggle("is-focused", active.length === 1 && activeTiles.size > 1);
  count.textContent = `${active.length} LIVE`;
  stopAll.disabled = active.length === 0;
  applyViewportGrid(active.length);
}

function scheduleLayout() {
  if (layoutRaf) cancelAnimationFrame(layoutRaf);
  layoutRaf = requestAnimationFrame(() => {
    layoutRaf = 0;
    const active = [...activeTiles.values()].filter((tile) => !tile.classList.contains("is-stopped"));
    applyViewportGrid(active.length);
  });
}

function armConnectBudget(clientId) {
  connectDeadlines.set(clientId, Date.now() + CONNECT_TIMEOUT_MS);
}

function clearConnectBudget(clientId) {
  connectDeadlines.delete(clientId);
}

function showSnapshot(tile, dataUrl) {
  const img = tile.querySelector(".tile-snapshot");
  if (!img) return;
  img.src = dataUrl;
  img.hidden = false;
  tile.classList.add("is-cached");
}

function hideSnapshot(tile) {
  const img = tile.querySelector(".tile-snapshot");
  if (img) {
    img.hidden = true;
    img.removeAttribute("src");
  }
  tile.classList.remove("is-cached");
}

/** Grab the currently visible frame from a live tile (same-origin iframe). */
function captureTileSnapshot(clientId, tile) {
  try {
    const frame = tile.querySelector("iframe");
    const doc = frame?.contentDocument;
    if (!doc) return;
    const canvas = doc.getElementById("frameCanvas");
    if (canvas && canvas.width > 0 && canvas.height > 0) {
      tileSnapshots.set(clientId, canvas.toDataURL("image/jpeg", 0.72));
      return;
    }
    const video = doc.getElementById("webrtcVideo");
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      const scratch = document.createElement("canvas");
      scratch.width = video.videoWidth;
      scratch.height = video.videoHeight;
      scratch.getContext("2d").drawImage(video, 0, 0);
      tileSnapshots.set(clientId, scratch.toDataURL("image/jpeg", 0.72));
    }
  } catch {
    /* frame not readable yet — nothing to cache */
  }
}

function stopTile(tile) {
  clearConnectBudget(tile.dataset.clientId);
  const frame = tile.querySelector("iframe");
  frame.src = "about:blank";
  tile.classList.add("is-stopped");
  syncLayout();
}

function startTile(tile) {
  const clientId = tile.dataset.clientId;
  if (!clientId) return;
  hideSnapshot(tile);
  const frame = tile.querySelector("iframe");
  tile.classList.remove("is-stopped");
  frame.src = tileWebcamUrl(clientId);
  setTileState(tile, "connecting");
  armConnectBudget(clientId);
  syncLayout();
}

function stopOtherTiles(selectedId) {
  for (const [id, tile] of activeTiles) {
    if (id !== selectedId && !tile.classList.contains("is-stopped")) stopTile(tile);
  }
}

function stopAllTiles() {
  for (const tile of activeTiles.values()) {
    if (!tile.classList.contains("is-stopped")) stopTile(tile);
  }
}

function restoreAllTiles() {
  for (const [id, tile] of activeTiles) {
    if (!tile.classList.contains("is-stopped")) continue;
    const snapshot = tileSnapshots.get(id);
    if (snapshot) {
      // Instant cached frame instead of reconnecting; click the tile to go live again.
      tile.classList.remove("is-stopped");
      showSnapshot(tile, snapshot);
      tile.dataset.streamState = "cached";
      updateTileUi(tile, "cached");
    } else {
      startTile(tile);
    }
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

function removeTile(clientId, tile = activeTiles.get(clientId)) {
  clearConnectBudget(clientId);
  tileSnapshots.delete(clientId);
  if (!tile || activeTiles.get(clientId) !== tile) return;
  const frame = tile.querySelector("iframe");
  if (frame) frame.src = "about:blank";
  activeTiles.delete(clientId);
  tile.remove();
  syncLayout();
}

/** Update countdown labels and drop webcams whose 30s connect budget expired. */
function tickConnectBudgets() {
  const now = Date.now();
  for (const [clientId, deadline] of [...connectDeadlines.entries()]) {
    const tile = activeTiles.get(clientId);
    if (!tile || tile.classList.contains("is-stopped")) {
      connectDeadlines.delete(clientId);
      continue;
    }
    const remainingMs = deadline - now;
    const countdownEl = tile.querySelector(".tile-countdown");
    if (countdownEl) countdownEl.textContent = `${Math.max(0, Math.ceil(remainingMs / 1000))}s`;
    if (remainingMs <= 0) removeTile(clientId, tile);
  }
}
const connectBudgetInterval = setInterval(tickConnectBudgets, 250);

for (const [index, id] of ids.entries()) {
  const tile = document.createElement("article");
  tile.className = "webcam-tile";
  tile.dataset.clientId = id;
  // Stagger iframe load so agents/server are not slammed all at once.
  tile.innerHTML = `<button class="tile-expand" title="Open in viewer" aria-label="Open webcam in viewer"><i class="fa-solid fa-expand"></i></button><span class="tile-client">${id.slice(0, 12)}</span><span class="tile-status"><i class="fa-solid fa-circle-notch fa-spin"></i> Connecting</span><span class="tile-countdown" hidden>30s</span><span class="tile-ping"></span><button class="tile-stop" title="Stop webcam" aria-label="Stop webcam"><i class="fa-solid fa-stop"></i></button><img class="tile-snapshot" alt="" hidden><iframe title="Webcam ${id}" src="about:blank"></iframe>`;
  tile.querySelector(".tile-stop").onclick = (event) => { event.stopPropagation(); stopTile(tile); };
  tile.querySelector(".tile-expand").onclick = () => {
    const viewerUrl = `/viewer?clientId=${encodeURIComponent(id)}&mode=dashboard2&fromArray=1`;
    const win = window.open(viewerUrl, "_blank");
    if (!win) return;
    const session = ++focusSession;
    // Cache the last visible frame of every tile before the array pauses.
    for (const [cid, t] of activeTiles) {
      if (!t.classList.contains("is-stopped")) captureTileSnapshot(cid, t);
    }
    stopAllTiles();
    watchFocusedViewer(win, session);
  };
  // Clicking a cached snapshot resumes that webcam live.
  tile.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    if (!tile.classList.contains("is-cached")) return;
    startTile(tile);
  });
  activeTiles.set(id, tile);
  grid.append(tile);
  setTimeout(() => {
    if (!activeTiles.has(id) || tile.classList.contains("is-stopped")) return;
    const frame = tile.querySelector("iframe");
    if (frame && (!frame.src || frame.src === "about:blank" || frame.getAttribute("src") === "about:blank")) {
      frame.src = tileWebcamUrl(id);
      armConnectBudget(id);
    }
  }, Math.min(index * 180, 4000));
}
stopAll.onclick = () => {
  clearFocusWatch();
  focusSession = 0;
  for (const tile of activeTiles.values()) stopTile(tile);
  grid.classList.remove("is-focused");
};
window.addEventListener("resize", scheduleLayout);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    resumeAfterVisibility.clear();
    for (const [id, tile] of activeTiles) {
      if (tile.classList.contains("is-stopped")) continue;
      resumeAfterVisibility.add(id);
      stopTile(tile);
    }
    return;
  }
  for (const id of resumeAfterVisibility) {
    const tile = activeTiles.get(id);
    if (tile) startTile(tile);
  }
  resumeAfterVisibility.clear();
});
if (typeof ResizeObserver !== "undefined" && grid) {
  new ResizeObserver(scheduleLayout).observe(grid);
}
syncLayout();
// Re-measure after first paint when flex height is final.
requestAnimationFrame(() => requestAnimationFrame(scheduleLayout));

function updateTileUi(tile, state) {
  const statusEl = tile.querySelector(".tile-status");
  const countdownEl = tile.querySelector(".tile-countdown");
  if (countdownEl) countdownEl.hidden = !(state === "connecting" || state === "starting");
  if (state === "streaming") {
    statusEl.className = "tile-status tile-status--ok";
    statusEl.innerHTML = `<i class="fa-solid fa-circle text-emerald-400" style="font-size:6px"></i> Live`;
  } else if (state === "cached") {
    statusEl.className = "tile-status tile-status--warn";
    statusEl.innerHTML = `<i class="fa-solid fa-camera"></i> Cached frame · click to resume`;
  } else if (state === "connecting" || state === "starting") {
    statusEl.className = "tile-status";
    statusEl.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Connecting`;
  } else if (state === "stalled") {
    statusEl.className = "tile-status tile-status--warn";
    statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> No frames`;
  } else if (state === "idle") {
    statusEl.className = "tile-status tile-status--warn";
    statusEl.innerHTML = `<i class="fa-solid fa-circle text-slate-400" style="font-size:6px"></i> Stopped`;
  }
}

function setTileState(tile, state) {
  const clientId = tile.dataset.clientId;
  // Dead webcams are dropped on the spot — no retries, no grace period.
  if (IMMEDIATE_REMOVAL_STATES.has(state)) {
    removeTile(clientId, tile);
    return;
  }
  tile.dataset.streamState = state;
  updateTileUi(tile, state);
  if (state === "streaming") {
    clearConnectBudget(clientId);
    hideSnapshot(tile);
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
        setTileState(tile, "not-found");
        continue;
      }
      const ping = Number.isFinite(Number(client.pingMs)) ? `${Math.round(Number(client.pingMs))} ms` : "";
      pingEl.textContent = ping;
      // Don't kill a live stream on a brief online-flag blip from the clients API.
      if (!client.online && tile.dataset.streamState !== "streaming" && tile.dataset.streamState !== "starting") {
        setTileState(tile, "offline");
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
if (count) count.title = `webcams.js v${WEBCAMS_JS_VERSION}`;
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
  clearInterval(connectBudgetInterval);
  clearFocusWatch();
});
