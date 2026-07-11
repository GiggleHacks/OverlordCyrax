const params = new URLSearchParams(location.search);
const clientId = params.get("clientId") || "";
const allowedModes = new Set(["webcam", "desktop", "split"]);
let mode = allowedModes.has(params.get("mode")) ? params.get("mode") : "webcam";
const panels = document.getElementById("viewerPanels");
const webcam = document.getElementById("viewerWebcam");
const desktop = document.getElementById("viewerDesktop");
const idLabel = document.getElementById("viewerClientId");
const capability = document.getElementById("viewerCapability");

idLabel.textContent = clientId.slice(0, 12) || "unknown";
const webcamUrl = `/webcam?clientId=${encodeURIComponent(clientId)}&embedded=1`;
const desktopUrl = `/remotedesktop?clientId=${encodeURIComponent(clientId)}&embedded=1`;

function ensureFrame(frame, url) {
  if (!frame.src) frame.src = url;
}

function setMode(nextMode) {
  mode = allowedModes.has(nextMode) ? nextMode : "webcam";
  panels.dataset.mode = mode;
  document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === mode));
  if (mode === "webcam" || mode === "split") ensureFrame(webcam, webcamUrl);
  if (mode === "desktop" || mode === "split") ensureFrame(desktop, desktopUrl);
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
