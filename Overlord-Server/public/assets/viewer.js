const params = new URLSearchParams(location.search);
const clientId = params.get("clientId") || "";
const allowedModes = new Set(["webcam", "desktop", "split", "split-v", "pip"]);
let mode = allowedModes.has(params.get("mode")) ? params.get("mode") : "webcam";
let pipCorner = "br";
const panels = document.getElementById("viewerPanels");
const webcam = document.getElementById("viewerWebcam");
const desktop = document.getElementById("viewerDesktop");
const idLabel = document.getElementById("viewerClientId");
const capability = document.getElementById("viewerCapability");
const pipPicker = document.getElementById("pipCornerPicker");

idLabel.textContent = clientId.slice(0, 12) || "unknown";
const transition = params.get("transition") || "";
const webcamUrl = `/webcam?clientId=${encodeURIComponent(clientId)}&embedded=1&controls=1${transition ? "&transition=1" : ""}`;
const desktopUrl = `/remotedesktop?clientId=${encodeURIComponent(clientId)}&embedded=1`;

function ensureFrame(frame, url) {
  if (!frame.src || frame.src === "about:blank" || frame.contentWindow?.location?.href === "about:blank") {
    frame.src = url;
  }
}

function unloadFrame(frame) {
  if (frame.src && frame.src !== "about:blank") {
    frame.src = "about:blank";
  }
}

function setMode(nextMode) {
  const prev = mode;
  mode = allowedModes.has(nextMode) ? nextMode : "webcam";
  panels.dataset.mode = mode;
  if (prev !== mode) {
    panels.style.gridTemplateColumns = "";
    panels.style.gridTemplateRows = "";
  }
  document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === mode));

  const needsWebcam = (mode === "webcam" || mode === "split" || mode === "split-v" || mode === "pip");
  const needsDesktop = (mode === "desktop" || mode === "split" || mode === "split-v" || mode === "pip");

  if (needsWebcam) {
    ensureFrame(webcam, webcamUrl);
  } else {
    unloadFrame(webcam);
  }

  if (needsDesktop) {
    ensureFrame(desktop, desktopUrl);
  } else {
    unloadFrame(desktop);
  }

  pipPicker.style.display = mode === "pip" ? "flex" : "none";
  if (mode === "pip") panels.dataset.pip = pipCorner;
  history.replaceState(null, "", `/viewer?clientId=${encodeURIComponent(clientId)}&mode=${mode}`);
}

document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));

document.querySelectorAll("[data-corner]").forEach((btn) => {
  btn.addEventListener("click", () => {
    pipCorner = btn.dataset.corner;
    panels.dataset.pip = pipCorner;
    document.querySelectorAll("[data-corner]").forEach((b) => b.classList.toggle("is-active", b.dataset.corner === pipCorner));
  });
});

async function refreshCapability() {
  try {
    const response = await fetch(`/api/clients?page=1&pageSize=1&q=${encodeURIComponent(clientId)}`, { credentials: "include" });
    const data = await response.json();
    const client = (data.items || []).find((item) => item.id === clientId) || data.items?.[0];
    const available = !!client?.webcamAvailable;
    const ping = Number.isFinite(Number(client?.pingMs)) ? ` · ${Math.round(Number(client.pingMs))} ms` : "";
    capability.innerHTML = available ? `<i class="fa-solid fa-video"></i> camera available${ping}` : `<i class="fa-solid fa-video-slash"></i> no camera${ping}`;
    capability.classList.toggle("is-available", available);
  } catch {
    capability.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> camera status unavailable';
  }
}

setMode(mode);
refreshCapability();
setInterval(refreshCapability, 10000);

const divider = document.getElementById("viewerDivider");
let isDragging = false;
let startPos = 0;
let startSize = 0;

divider.addEventListener("mousedown", (e) => {
  if (mode !== "split" && mode !== "split-v") return;
  e.preventDefault();
  isDragging = true;
  const isVertical = mode === "split-v";
  startPos = isVertical ? e.clientY : e.clientX;
  startSize = panels.querySelector(".viewer-panel-webcam").getBoundingClientRect()[isVertical ? "height" : "width"];
  divider.classList.add("is-dragging");
  document.body.style.cursor = isVertical ? "row-resize" : "col-resize";
  document.body.style.userSelect = "none";
  panels.querySelectorAll("iframe").forEach((f) => (f.style.pointerEvents = "none"));
});

document.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const isVertical = mode === "split-v";
  const totalSize = panels.getBoundingClientRect()[isVertical ? "height" : "width"];
  const dividerSize = 6;
  const minSize = isVertical ? 120 : 200;
  const pos = isVertical ? e.clientY : e.clientX;
  let newFirst = startSize + (pos - startPos);
  newFirst = Math.max(minSize, Math.min(newFirst, totalSize - dividerSize - minSize));
  const second = totalSize - newFirst - dividerSize;
  if (isVertical) {
    panels.style.gridTemplateRows = `${newFirst}px ${dividerSize}px ${second}px`;
  } else {
    panels.style.gridTemplateColumns = `${newFirst}px ${dividerSize}px ${second}px`;
  }
});

document.addEventListener("mouseup", () => {
  if (!isDragging) return;
  isDragging = false;
  divider.classList.remove("is-dragging");
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  panels.querySelectorAll("iframe").forEach((f) => (f.style.pointerEvents = ""));
});
