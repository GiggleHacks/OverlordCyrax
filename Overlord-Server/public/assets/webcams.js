const ids = [...new Set((new URLSearchParams(location.search).get("clientIds") || "").split(",").filter(Boolean))].slice(0, 6);
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
  tile.querySelector(".tile-expand").onclick = () => { window.open(`/viewer?clientId=${encodeURIComponent(id)}&mode=webcam`, "_blank"); };
  activeTiles.set(id, tile);
  grid.append(tile);
}
stopAll.onclick = () => { for (const tile of activeTiles.values()) stopTile(tile); grid.classList.remove("is-focused"); };
syncLayout();

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
        continue;
      }
      const ping = Number.isFinite(Number(client.pingMs)) ? `${Math.round(Number(client.pingMs))} ms` : "";
      pingEl.textContent = ping;
      if (client.webcamAvailable && client.status === "approved") {
        statusEl.className = "tile-status tile-status--ok";
        statusEl.innerHTML = `<i class="fa-solid fa-circle text-emerald-400" style="font-size:6px"></i> Live`;
      } else if (client.status === "approved") {
        statusEl.innerHTML = `<i class="fa-solid fa-video-slash"></i> No camera`;
        statusEl.className = "tile-status tile-status--warn";
      } else {
        statusEl.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Connecting`;
        statusEl.className = "tile-status";
      }
    }
  } catch {}
}
refreshTileStatus();
setInterval(refreshTileStatus, 8000);
