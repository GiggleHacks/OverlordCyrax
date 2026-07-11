const ids = [...new Set((new URLSearchParams(location.search).get("clientIds") || "").split(",").filter(Boolean))].slice(0, 6);
const grid = document.getElementById("webcamTiles");
document.getElementById("tileCount").textContent = `${ids.length} LIVE`;
for (const id of ids) {
  const tile = document.createElement("article");
  tile.className = "webcam-tile";
  tile.innerHTML = `<button class="tile-focus" aria-label="Focus webcam ${id}"></button><button class="tile-stop" title="Stop webcam"><i class="fa-solid fa-stop"></i></button><iframe title="Webcam ${id}" src="/webcam?clientId=${encodeURIComponent(id)}"></iframe>`;
  tile.querySelector(".tile-stop").onclick = (event) => { event.stopPropagation(); tile.querySelector("iframe").src = "about:blank"; tile.classList.add("is-stopped"); };
  tile.querySelector(".tile-focus").onclick = () => { grid.querySelectorAll("iframe").forEach((frame) => { frame.src = "about:blank"; }); window.open(`/webcam?clientId=${encodeURIComponent(id)}`, "_blank", "noopener,width=960,height=700"); };
  grid.append(tile);
}
