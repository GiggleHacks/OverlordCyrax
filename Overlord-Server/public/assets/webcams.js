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
  tile.innerHTML = `<button class="tile-expand" title="Open in viewer" aria-label="Open webcam in viewer"><i class="fa-solid fa-expand"></i></button><span class="tile-client">${id.slice(0, 12)}</span><button class="tile-stop" title="Stop webcam" aria-label="Stop webcam"><i class="fa-solid fa-stop"></i></button><iframe title="Webcam ${id}" src="/webcam?clientId=${encodeURIComponent(id)}&embedded=1"></iframe>`;
  tile.querySelector(".tile-stop").onclick = (event) => { event.stopPropagation(); stopTile(tile); };
  tile.querySelector(".tile-expand").onclick = () => { window.open(`/viewer?clientId=${encodeURIComponent(id)}&mode=webcam`, "_blank"); };
  activeTiles.set(id, tile);
  grid.append(tile);
}
stopAll.onclick = () => { for (const tile of activeTiles.values()) stopTile(tile); grid.classList.remove("is-focused"); };
syncLayout();
