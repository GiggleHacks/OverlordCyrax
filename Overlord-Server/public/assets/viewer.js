import { initSidePanel } from "./side-panel.js";

const params = new URLSearchParams(location.search);
const clientId = params.get("clientId") || "";
const allowedModes = new Set(["webcam", "desktop", "split"]);
let mode = allowedModes.has(params.get("mode")) ? params.get("mode") : "webcam";

/* Side action panel */
initSidePanel(clientId, document.getElementById("sidePanel"));
const panels = document.getElementById("viewerPanels");
const webcam = document.getElementById("viewerWebcam");
const desktop = document.getElementById("viewerDesktop");
const idLabel = document.getElementById("viewerClientId");
const capability = document.getElementById("viewerCapability");

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

  const needsWebcam = (mode === "webcam" || mode === "split");
  const needsDesktop = (mode === "desktop" || mode === "split");

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

  history.replaceState(null, "", `/viewer?clientId=${encodeURIComponent(clientId)}&mode=${mode}`);
}

document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));

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
  if (mode !== "split") return;
  e.preventDefault();
  isDragging = true;
  startPos = e.clientX;
  startSize = panels.querySelector(".viewer-panel-webcam").getBoundingClientRect().width;
  divider.classList.add("is-dragging");
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  panels.querySelectorAll("iframe").forEach((f) => (f.style.pointerEvents = "none"));
});

document.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const totalSize = panels.getBoundingClientRect().width;
  const dividerSize = 6;
  const minSize = 200;
  const pos = e.clientX;
  let newFirst = startSize + (pos - startPos);
  newFirst = Math.max(minSize, Math.min(newFirst, totalSize - dividerSize - minSize));
  const second = totalSize - newFirst - dividerSize;
  panels.style.gridTemplateColumns = `${newFirst}px ${dividerSize}px ${second}px`;
});

document.addEventListener("mouseup", () => {
  if (!isDragging) return;
  isDragging = false;
  divider.classList.remove("is-dragging");
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  panels.querySelectorAll("iframe").forEach((f) => (f.style.pointerEvents = ""));
});
