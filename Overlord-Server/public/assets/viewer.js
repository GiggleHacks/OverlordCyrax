import { initSidePanel } from "./side-panel.js";
import { initPipOverlay } from "./pip-overlay.js";
import { initDashboard2Mdi, DASHBOARD2_MDI_VERSION } from "./dashboard2-mdi.js";
import { initDashboard2Icons, DASHBOARD2_ICONS_VERSION } from "./dashboard2-icons.js";

/** viewer.js — unified remote viewer shell */
export const VIEWER_JS_VERSION = "1.4.0";

const params = new URLSearchParams(location.search);
const clientId = params.get("clientId") || "";
const allowedModes = new Set(["webcam", "desktop", "split", "pip", "dashboard2"]);
// Legacy "dock" / "space" URLs map to split (one clear side-by-side layout).
const rawMode = params.get("mode") === "dock" ? "split" : params.get("mode");
let mode = allowedModes.has(rawMode) ? rawMode : "dashboard2";

/* Side action panel */
const sidePanelRoot = document.getElementById("sidePanel");
initSidePanel(clientId, sidePanelRoot);
const panels = document.getElementById("viewerPanels");
const webcam = document.getElementById("viewerWebcam");
const desktop = document.getElementById("viewerDesktop");
const pipWebcam = document.getElementById("viewerPipWebcam");
const pipOverlayEl = document.getElementById("viewerPipOverlay");
const desktopPanel = document.getElementById("viewerDesktopPanel");
const webcamPanel = document.getElementById("viewerWebcamPanel");
const dashboard2Root = document.getElementById("viewerDashboard2");
const d2Desktop = document.getElementById("viewerD2Desktop");
const d2Webcam = document.getElementById("viewerD2Webcam");
const d2Processes = document.getElementById("viewerD2Processes");
const d2CamStart = document.querySelector("[data-d2-cam-start]");
const d2CamStop = document.querySelector("[data-d2-cam-stop]");
const d2CamSettings = document.querySelector("[data-d2-cam-settings]");
const d2WebcamEmpty = document.querySelector("[data-d2-webcam-empty]");
const idLabel = document.getElementById("viewerClientId");
const capability = document.getElementById("viewerCapability");
const webcamBar = document.getElementById("viewerWebcamBar");
const camStart = document.getElementById("viewerCamStart");
const camStop = document.getElementById("viewerCamStop");
const camStatus = document.getElementById("viewerCamStatus");
const camFps = document.getElementById("viewerCamFps");
const camSettingsBtn = document.getElementById("viewerCamSettingsBtn");
const camSettingsMenu = document.getElementById("viewerCamSettingsMenu");
const camDevice = document.getElementById("viewerCamDevice");
const camRefresh = document.getElementById("viewerCamRefresh");
const camResolution = document.getElementById("viewerCamResolution");
const camMode = document.getElementById("viewerCamMode");
const camMaxFps = document.getElementById("viewerCamMaxFps");
const camH264 = document.getElementById("viewerCamH264");

idLabel.textContent = clientId.slice(0, 12) || "unknown";
idLabel.title = `viewer.js v${VIEWER_JS_VERSION} · dashboard2-mdi v${DASHBOARD2_MDI_VERSION} · d2-icons v${DASHBOARD2_ICONS_VERSION}`;

const dashboard2 = initDashboard2Mdi({
  root: dashboard2Root,
});
const dashboard2Icons = initDashboard2Icons({
  root: dashboard2Root,
  clientId,
});
const transition = params.get("transition") || "";
const fromArray = params.get("fromArray") === "1";
// Webcam-only mode keeps in-frame controls; split/pip use the parent bar (no embedded chrome).
const webcamUrlFull = `/webcam?clientId=${encodeURIComponent(clientId)}&embedded=1&controls=1${transition ? "&transition=1" : ""}`;
const webcamUrlBar = `/webcam?clientId=${encodeURIComponent(clientId)}&embedded=1${transition ? "&transition=1" : ""}`;
// D2: full-bleed video; Start/Stop/Settings live on the MDI titlebar (not over the feed).
const webcamUrlD2 = `/webcam?clientId=${encodeURIComponent(clientId)}&embedded=1&autostart=0&d2=1`;
const desktopUrl = `/remotedesktop?clientId=${encodeURIComponent(clientId)}&embedded=1`;
const processesUrlD2 = clientId ? `/${encodeURIComponent(clientId)}/processes2?embedded=1` : "about:blank";

function notifyArrayViewerClosed() {
  if (!fromArray || !clientId) return;
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: "webcam_array_viewer_closed", clientId }, location.origin);
    }
  } catch {
    /* ignore cross-origin / closed opener */
  }
}

window.addEventListener("pagehide", notifyArrayViewerClosed);
window.addEventListener("beforeunload", notifyArrayViewerClosed);

function ensureFrame(frame, url) {
  if (!frame) return;
  if (!frame.src || frame.src === "about:blank" || frame.contentWindow?.location?.href === "about:blank") {
    frame.src = url;
  } else if (frame.dataset.desiredUrl && frame.dataset.desiredUrl !== url) {
    frame.src = url;
  }
  frame.dataset.desiredUrl = url;
}

function unloadFrame(frame) {
  if (!frame) return;
  if (frame.src && frame.src !== "about:blank") {
    frame.src = "about:blank";
  }
  delete frame.dataset.desiredUrl;
}

function activeWebcamFrame() {
  if (mode === "pip") return pipWebcam;
  if (mode === "dashboard2") return d2Webcam;
  if (mode === "split" || mode === "webcam") return webcam;
  return null;
}

function postToWebcam(payload) {
  const frame = activeWebcamFrame();
  if (!frame?.contentWindow) return false;
  try {
    frame.contentWindow.postMessage({ ...payload, type: payload.type || "webcam_cmd", clientId }, "*");
    return true;
  } catch {
    return false;
  }
}

function setWebcamBarVisible(visible) {
  if (!webcamBar) return;
  webcamBar.hidden = !visible;
  document.body.classList.toggle("viewer-has-webcam-bar", !!visible);
  if (!visible && camSettingsMenu) {
    camSettingsMenu.hidden = true;
    camSettingsBtn?.setAttribute("aria-expanded", "false");
  }
}

function webcamNeedsParentBar(m) {
  return m === "split" || m === "pip";
}

let d2HasCamera = null;

function setD2NoCamera(noCam) {
  if (d2WebcamEmpty) d2WebcamEmpty.hidden = !noCam;
  document.body.classList.toggle("d2-webcam-missing", !!noCam);
  if (noCam) {
    if (d2CamStart) d2CamStart.disabled = true;
    if (d2CamStop) d2CamStop.disabled = true;
  }
}

function syncD2CamButtons(status) {
  const streaming = status === "streaming" || status === "starting" || status === "stalled" || status === "connecting";
  const noCam = d2HasCamera === false;
  if (d2CamStart) d2CamStart.disabled = noCam || streaming;
  if (d2CamStop) d2CamStop.disabled = noCam || (!streaming && status !== "stopping");
  if (d2CamSettings) d2CamSettings.disabled = false;
}

const SPLIT_RATIO_KEY = "overlord_viewer_split_ratio";
const SPLIT_DIVIDER_PX = 6;
const SPLIT_MIN_PX = 200;
let splitDesktopRatio = 0.7;
try {
  const saved = Number(localStorage.getItem(SPLIT_RATIO_KEY));
  if (Number.isFinite(saved) && saved > 0.15 && saved < 0.9) splitDesktopRatio = saved;
} catch {}

function clampSplitRatio(ratio) {
  return Math.max(0.18, Math.min(0.82, ratio));
}

function applySplitColumns() {
  if (!panels || mode !== "split") return;
  // Desktop left (primary), webcam right. Use fr from saved ratio so free resize sticks.
  const ratio = clampSplitRatio(splitDesktopRatio);
  const left = Math.max(1, Math.round(ratio * 1000));
  const right = Math.max(1, Math.round((1 - ratio) * 1000));
  panels.style.gridTemplateColumns = `minmax(${SPLIT_MIN_PX}px, ${left}fr) ${SPLIT_DIVIDER_PX}px minmax(${SPLIT_MIN_PX}px, ${right}fr)`;
  panels.style.gridTemplateRows = "";
}

function persistSplitRatioFromLayout() {
  if (!panels || mode !== "split") return;
  const total = panels.getBoundingClientRect().width;
  const desk = panels.querySelector(".viewer-panel-desktop")?.getBoundingClientRect().width;
  if (!total || !Number.isFinite(desk)) return;
  const usable = Math.max(1, total - SPLIT_DIVIDER_PX);
  splitDesktopRatio = clampSplitRatio(desk / usable);
  try {
    localStorage.setItem(SPLIT_RATIO_KEY, String(splitDesktopRatio));
  } catch {}
  applySplitColumns();
}

function updateCamStatusUi(status, fps, label) {
  if (camStatus) {
    const icons = {
      connecting: '<i class="fa-solid fa-circle-notch fa-spin"></i>',
      starting: '<i class="fa-solid fa-circle-notch fa-spin"></i>',
      stopping: '<i class="fa-solid fa-circle-notch fa-spin"></i>',
      streaming: '<i class="fa-solid fa-circle viewer-cam-dot-live"></i>',
      idle: '<i class="fa-solid fa-circle viewer-cam-dot-idle"></i>',
      stalled: '<i class="fa-solid fa-triangle-exclamation"></i>',
      offline: '<i class="fa-solid fa-plug-circle-xmark"></i>',
      disconnected: '<i class="fa-solid fa-link-slash"></i>',
      error: '<i class="fa-solid fa-circle-exclamation"></i>',
    };
    const labels = {
      connecting: "Connecting",
      starting: "Starting",
      stopping: "Stopping",
      streaming: "Streaming",
      idle: "Idle",
      stalled: "No frames",
      offline: "Client offline",
      disconnected: "Disconnected",
      error: "Error",
    };
    const key = status || "idle";
    const text = (typeof label === "string" && label.trim()) ? label.trim() : (labels[key] || key);
    camStatus.innerHTML = `${icons[key] || icons.idle} <span>${text}</span>`;
    camStatus.dataset.status = key;
  }
  if (camFps && fps != null) camFps.textContent = fps === "" || fps == null ? "--" : String(fps);
  syncD2CamButtons(status || "idle");

  const streaming = status === "streaming" || status === "starting" || status === "stalled";
  if (camStart) camStart.disabled = streaming;
  if (camStop) camStop.disabled = !streaming && status !== "stopping";
}

function applyDevicesToSelect(devices) {
  if (!camDevice || !Array.isArray(devices)) return;
  const prev = camDevice.value;
  camDevice.innerHTML = "";
  if (devices.length === 0) {
    const opt = document.createElement("option");
    opt.value = "0";
    opt.textContent = "No cameras";
    camDevice.appendChild(opt);
    return;
  }
  for (const dev of devices) {
    const opt = document.createElement("option");
    opt.value = String(dev.index ?? 0);
    opt.textContent = dev.name || `Camera ${dev.index ?? 0}`;
    camDevice.appendChild(opt);
  }
  if (prev && [...camDevice.options].some((o) => o.value === prev)) {
    camDevice.value = prev;
  }
}

function applySettingsFromChild(settings) {
  if (!settings || typeof settings !== "object") return;
  if (camDevice && settings.camera != null) {
    const val = String(settings.camera);
    if ([...camDevice.options].some((o) => o.value === val)) camDevice.value = val;
  }
  if (camResolution && settings.resolution != null) camResolution.value = String(settings.resolution);
  if (camMode && settings.webrtcMode != null) camMode.value = String(settings.webrtcMode);
  if (camMaxFps && settings.fps != null) camMaxFps.value = String(settings.fps);
  if (camH264 && typeof settings.preferH264 === "boolean") camH264.checked = settings.preferH264;
}

const sidePanelEl = sidePanelRoot;
const sideCollapseBtn = document.getElementById("sidePanelCollapse");
const SIDE_WIDTH_KEY = "overlord_side_panel_width_v1";
const SIDE_COLLAPSED_KEY = "overlord_side_panel_collapsed_v1";
const SIDE_D2_COLLAPSED_KEY = "overlord_side_panel_d2_collapsed_v1";
const DESKTOP_LAYOUT_KEY = "overlord_desktop_layout_v1";
const SIDE_MIN = 140;
const SIDE_MAX = 420;
const SIDE_DEFAULT = 230;
const SIDE_RAIL = 52;
let sideCollapsed = false;
let sideExpandedWidth = SIDE_DEFAULT;

function applySidePanelWidth(px) {
  if (sideCollapsed) {
    document.documentElement.style.setProperty("--side-panel-width", `${SIDE_RAIL}px`);
    if (sidePanelEl) {
      sidePanelEl.style.width = `${SIDE_RAIL}px`;
      sidePanelEl.style.minWidth = `${SIDE_RAIL}px`;
    }
    return SIDE_RAIL;
  }
  const w = Math.max(SIDE_MIN, Math.min(SIDE_MAX, Math.round(px)));
  document.documentElement.style.setProperty("--side-panel-width", `${w}px`);
  if (sidePanelEl) {
    sidePanelEl.style.width = `${w}px`;
    sidePanelEl.style.minWidth = `${w}px`;
  }
  return w;
}

function setSideCollapsed(collapsed) {
  sideCollapsed = !!collapsed;
  document.body.classList.toggle("viewer-side-collapsed", sideCollapsed);
  sidePanelEl?.classList.toggle("is-collapsed", sideCollapsed);
  if (sideCollapseBtn) {
    sideCollapseBtn.setAttribute("aria-expanded", sideCollapsed ? "false" : "true");
    sideCollapseBtn.title = sideCollapsed ? "Expand sidebar" : "Collapse sidebar";
    sideCollapseBtn.setAttribute("aria-label", sideCollapseBtn.title);
    const icon = sideCollapseBtn.querySelector("i");
    if (icon) icon.className = sideCollapsed ? "fa-solid fa-angles-right" : "fa-solid fa-angles-left";
  }
  if (sideCollapsed) {
    applySidePanelWidth(SIDE_RAIL);
  } else {
    applySidePanelWidth(sideExpandedWidth);
  }
  try {
    if (mode === "dashboard2") {
      localStorage.setItem(SIDE_D2_COLLAPSED_KEY, sideCollapsed ? "1" : "0");
    } else {
      localStorage.setItem(SIDE_COLLAPSED_KEY, sideCollapsed ? "1" : "0");
    }
  } catch {}
  if (typeof pip !== "undefined" && mode === "pip") {
    requestAnimationFrame(() => pip.restoreLayout());
  }
}

function applySideCollapseForMode(m) {
  let collapsed = false;
  try {
    if (m === "dashboard2") {
      const d2 = localStorage.getItem(SIDE_D2_COLLAPSED_KEY);
      collapsed = d2 === null ? true : d2 === "1";
    } else {
      collapsed = localStorage.getItem(SIDE_COLLAPSED_KEY) === "1";
    }
  } catch {
    collapsed = m === "dashboard2";
  }
  setSideCollapsed(collapsed);
}

function loadSidePanelWidth() {
  try {
    const raw = localStorage.getItem(SIDE_WIDTH_KEY);
    const n = raw ? Number(raw) : SIDE_DEFAULT;
    sideExpandedWidth = Number.isFinite(n) ? Math.max(SIDE_MIN, Math.min(SIDE_MAX, n)) : SIDE_DEFAULT;
  } catch {
    sideExpandedWidth = SIDE_DEFAULT;
  }
  applySideCollapseForMode(mode);
  return sideCollapsed ? SIDE_RAIL : sideExpandedWidth;
}

const pip = initPipOverlay({
  root: pipOverlayEl,
  host: desktopPanel,
  iframe: pipWebcam,
  onClose: () => {
    unloadFrame(pipWebcam);
    document.body.classList.remove("viewer-pip-active");
    updateCamStatusUi("idle", "--");
    // Stay on desktop when floating cam is closed — never jump to split.
    if (mode === "pip") setMode("desktop");
  },
});

sideCollapseBtn?.addEventListener("click", () => setSideCollapsed(!sideCollapsed));
loadSidePanelWidth();

function setMode(nextMode) {
  const prev = mode;
  const requested = nextMode === "dock" ? "split" : nextMode;
  mode = allowedModes.has(requested) ? requested : "dashboard2";
  panels.dataset.mode = mode;
  document.body.classList.toggle("viewer-dashboard2-active", mode === "dashboard2");
  if (prev !== mode) {
    // Keep a custom split ratio when re-entering split; only clear other modes.
    if (mode !== "split") {
      panels.style.gridTemplateColumns = "";
      panels.style.gridTemplateRows = "";
    }
    if (mode !== "desktop") clearDesktopInset();
    applySideCollapseForMode(mode);
  }

  if (webcamPanel) {
    webcamPanel.style.display = "";
    webcamPanel.style.left = "";
    webcamPanel.style.top = "";
    webcamPanel.style.right = "";
    webcamPanel.style.bottom = "";
    webcamPanel.style.width = "";
    webcamPanel.style.height = "";
  }

  document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === mode));

  const needsDashboard2 = mode === "dashboard2";
  const needsWebcam = mode === "webcam" || mode === "split";
  const needsDesktop = mode === "desktop" || mode === "split" || mode === "pip";
  const needsPip = mode === "pip";
  const showBar = webcamNeedsParentBar(mode);

  if (needsDashboard2) {
    ensureFrame(d2Desktop, desktopUrl);
    ensureFrame(d2Webcam, webcamUrlD2);
    ensureFrame(d2Processes, processesUrlD2);
    dashboard2.activate();
    dashboard2Icons.activate();
    syncD2CamButtons("idle");
    setTimeout(() => postToWebcam({ type: "webcam_cmd", action: "ping" }), 600);
  } else {
    dashboard2.deactivate();
    dashboard2Icons.deactivate();
    unloadFrame(d2Desktop);
    unloadFrame(d2Webcam);
    unloadFrame(d2Processes);
  }

  if (needsWebcam) {
    ensureFrame(webcam, mode === "split" ? webcamUrlBar : webcamUrlFull);
  } else {
    unloadFrame(webcam);
  }

  if (needsDesktop) {
    ensureFrame(desktop, desktopUrl);
  } else {
    unloadFrame(desktop);
  }

  document.body.classList.toggle("viewer-pip-active", needsPip);

  if (needsPip) {
    ensureFrame(pipWebcam, webcamUrlBar);
    pip.show();
    // Desktop panel is the host — keep it full-size (no inset) so PiP can float over RD.
    clearDesktopInset();
    requestAnimationFrame(() => {
      pip.restoreLayout();
      requestAnimationFrame(() => pip.restoreLayout());
    });
  } else {
    pip.hide();
    unloadFrame(pipWebcam);
    if (mode === "desktop") restoreDesktopInset();
    else clearDesktopInset();
  }

  if (mode === "split") {
    applySplitColumns();
  }

  setWebcamBarVisible(showBar);
  if (showBar) {
    updateCamStatusUi("connecting", "--");
    // Ask child for current state once frame may be ready
    setTimeout(() => postToWebcam({ type: "webcam_cmd", action: "ping" }), 600);
    setTimeout(() => postToWebcam({ type: "webcam_cmd", action: "ping" }), 1500);
  }

  const next = new URLSearchParams({ clientId, mode });
  if (fromArray) next.set("fromArray", "1");
  history.replaceState(null, "", `/viewer?${next}`);
}

document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));

camStart?.addEventListener("click", () => postToWebcam({ type: "webcam_cmd", action: "start" }));
camStop?.addEventListener("click", () => postToWebcam({ type: "webcam_cmd", action: "stop" }));
d2CamStart?.addEventListener("click", (e) => {
  e.stopPropagation();
  postToWebcam({ type: "webcam_cmd", action: "start" });
  syncD2CamButtons("starting");
});
d2CamStop?.addEventListener("click", (e) => {
  e.stopPropagation();
  postToWebcam({ type: "webcam_cmd", action: "stop" });
  syncD2CamButtons("stopping");
});
camRefresh?.addEventListener("click", () => postToWebcam({ type: "webcam_cmd", action: "refresh_cameras" }));

function positionCamSettingsMenu(anchorEl, fromD2) {
  if (!camSettingsMenu || !anchorEl) return;
  const r = anchorEl.getBoundingClientRect();
  const menuW = fromD2 ? 260 : 300;
  const pad = 8;
  const maxH = Math.min(fromD2 ? 320 : window.innerHeight * 0.7, window.innerHeight - pad * 2);
  // Prefer opening left of the gear so it sits over chrome, not the video center.
  let left = Math.max(pad, r.right - menuW);
  left = Math.min(left, window.innerWidth - menuW - pad);
  let top = r.bottom + 6;
  if (top + maxH > window.innerHeight - pad) {
    top = Math.max(pad, r.top - maxH - 6);
  }
  camSettingsMenu.classList.toggle("is-d2-float", !!fromD2);
  camSettingsMenu.style.position = "fixed";
  camSettingsMenu.style.left = `${left}px`;
  camSettingsMenu.style.right = "auto";
  camSettingsMenu.style.top = `${top}px`;
  camSettingsMenu.style.width = `${menuW}px`;
  camSettingsMenu.style.maxHeight = `${maxH}px`;
  camSettingsMenu.style.zIndex = "12000";
}

function setCamSettingsOpen(open, anchorEl, fromD2 = false) {
  if (!camSettingsMenu) return;
  camSettingsMenu.hidden = !open;
  camSettingsBtn?.setAttribute("aria-expanded", open ? "true" : "false");
  d2CamSettings?.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    // Detach from hidden parent bar so D2 can open settings while bar is hidden.
    if (camSettingsMenu.parentElement !== document.body) {
      document.body.appendChild(camSettingsMenu);
    }
    positionCamSettingsMenu(anchorEl || camSettingsBtn || d2CamSettings, fromD2);
    postToWebcam({ type: "webcam_cmd", action: "ping" });
    postToWebcam({ type: "webcam_cmd", action: "refresh_cameras" });
  } else {
    camSettingsMenu.classList.remove("is-d2-float");
    camSettingsMenu.style.position = "";
    camSettingsMenu.style.left = "";
    camSettingsMenu.style.right = "";
    camSettingsMenu.style.top = "";
    camSettingsMenu.style.width = "";
    camSettingsMenu.style.maxHeight = "";
    camSettingsMenu.style.zIndex = "";
  }
}

camSettingsBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = !!camSettingsMenu?.hidden;
  setCamSettingsOpen(open, camSettingsBtn, false);
});

d2CamSettings?.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = !camSettingsMenu || camSettingsMenu.hidden;
  setCamSettingsOpen(open, d2CamSettings, true);
});

document.addEventListener("click", (e) => {
  if (!camSettingsMenu || camSettingsMenu.hidden) return;
  if (e.target.closest(".viewer-cam-settings-wrap")) return;
  if (e.target.closest("[data-d2-cam-settings]")) return;
  if (e.target.closest("#viewerCamSettingsMenu")) return;
  setCamSettingsOpen(false);
});

function pushSettings(partial = {}) {
  postToWebcam({
    type: "webcam_cmd",
    action: "set",
    payload: {
      camera: camDevice ? Number(camDevice.value) : undefined,
      resolution: camResolution ? Number(camResolution.value) : undefined,
      webrtcMode: camMode?.value,
      fps: camMaxFps ? Number(camMaxFps.value) : undefined,
      preferH264: camH264 ? !!camH264.checked : undefined,
      ...partial,
    },
  });
}

camDevice?.addEventListener("change", () => pushSettings());
camResolution?.addEventListener("change", () => pushSettings());
camMode?.addEventListener("change", () => pushSettings());
camMaxFps?.addEventListener("change", () => pushSettings());
camH264?.addEventListener("change", () => pushSettings());

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.clientId && data.clientId !== clientId) return;

  if (data.type === "webcam_status") {
    updateCamStatusUi(data.status, data.fps != null ? data.fps : undefined, data.label);
    if (data.devices) applyDevicesToSelect(data.devices);
    if (data.settings) applySettingsFromChild(data.settings);
    if (data.devicesLoaded || data.hasCamera != null) {
      d2HasCamera = data.hasCamera === true || (Array.isArray(data.devices) && data.devices.length > 0);
      if (data.devicesLoaded && Array.isArray(data.devices) && data.devices.length === 0) {
        d2HasCamera = false;
      }
      setD2NoCamera(d2HasCamera === false);
      syncD2CamButtons(data.status || "idle");
    }
    if (data.status === "offline" || data.status === "disconnected") {
      refreshCapability();
    }
  }
});

async function refreshCapability() {
  try {
    const response = await fetch(`/api/clients?page=1&pageSize=1&id=${encodeURIComponent(clientId)}`, { credentials: "include" });
    const data = await response.json();
    const client = (data.items || []).find((item) => item.id === clientId);
    if (!client || client.online === false) {
      capability.innerHTML = '<i class="fa-solid fa-plug-circle-xmark"></i> Client offline';
      capability.classList.remove("is-available");
      capability.classList.add("is-offline");
      return;
    }
    const available = !!client?.webcamAvailable;
    const pingMs = Number(client?.pingMs);
    const ping = Number.isFinite(pingMs) && pingMs >= 0 && pingMs < 15000
      ? ` · ${Math.round(pingMs)} ms`
      : "";
    capability.innerHTML = available
      ? `<i class="fa-solid fa-video"></i> camera available${ping}`
      : `<i class="fa-solid fa-video-slash"></i> no camera${ping}`;
    capability.classList.toggle("is-available", available);
    capability.classList.remove("is-offline");
    // Prefer live device list from the webcam pane; fall back to client capability.
    if (d2HasCamera == null) {
      d2HasCamera = available;
      setD2NoCamera(!available);
      syncD2CamButtons("idle");
    }
  } catch {
    capability.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> camera status unavailable';
    capability.classList.remove("is-available", "is-offline");
  }
}

setMode(mode);
refreshCapability();
setInterval(refreshCapability, 10000);

const divider = document.getElementById("viewerDivider");
const sideResize = document.querySelector("[data-side-resize]");
const desktopResize = document.querySelector("[data-desktop-resize]");
let isDragging = false;
let sideDragging = false;
let desktopDragging = false;
let startPos = 0;
let startSize = 0;

function clearDesktopInset() {
  if (!panels) return;
  panels.style.removeProperty("--desktop-left");
  panels.style.removeProperty("--desktop-width");
}

function restoreDesktopInset() {
  if (!desktopPanel || (mode !== "pip" && mode !== "desktop")) {
    clearDesktopInset();
    return;
  }
  try {
    const raw = localStorage.getItem(DESKTOP_LAYOUT_KEY);
    if (!raw) {
      clearDesktopInset();
      return;
    }
    const parsed = JSON.parse(raw);
    const insetPct = Number(parsed.insetPct) || 0;
    const widthPct = Number(parsed.widthPct);
    applyDesktopLayout(insetPct, Number.isFinite(widthPct) ? widthPct : 100 - insetPct);
  } catch {
    clearDesktopInset();
  }
}

function applyDesktopLayout(insetPct, widthPct) {
  if (!panels) return;
  const pr = panels.getBoundingClientRect();
  if (pr.width < 1) return;
  const minW = 240;
  const maxInset = Math.max(0, pr.width - minW);
  const inset = Math.max(0, Math.min(maxInset, (insetPct / 100) * pr.width));
  let w = Number.isFinite(widthPct) ? (widthPct / 100) * pr.width : pr.width - inset;
  w = Math.max(minW, Math.min(pr.width - inset, w));
  panels.style.setProperty("--desktop-left", `${inset}px`);
  panels.style.setProperty("--desktop-width", `${w}px`);
  try {
    localStorage.setItem(
      DESKTOP_LAYOUT_KEY,
      JSON.stringify({
        insetPct: (inset / pr.width) * 100,
        widthPct: (w / pr.width) * 100,
      }),
    );
  } catch {}
}

function beginSplitDrag(clientX) {
  if (mode !== "split" || !panels) return false;
  isDragging = true;
  startPos = clientX;
  // Split: desktop is the left (primary) column (via CSS order).
  startSize = panels.querySelector(".viewer-panel-desktop")?.getBoundingClientRect().width || 0;
  divider?.classList.add("is-dragging");
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  panels.querySelectorAll("iframe").forEach((f) => (f.style.pointerEvents = "none"));
  return true;
}

function moveSplitDrag(clientX) {
  if (!isDragging || !panels) return;
  const totalSize = panels.getBoundingClientRect().width;
  const minSize = SPLIT_MIN_PX;
  const dividerSize = SPLIT_DIVIDER_PX;
  let newFirst = startSize + (clientX - startPos);
  newFirst = Math.max(minSize, Math.min(newFirst, totalSize - dividerSize - minSize));
  const second = Math.max(minSize, totalSize - newFirst - dividerSize);
  panels.style.gridTemplateColumns = `${newFirst}px ${dividerSize}px ${second}px`;
}

divider?.addEventListener("pointerdown", (e) => {
  if (mode !== "split") return;
  if (e.button != null && e.button !== 0) return;
  e.preventDefault();
  if (!beginSplitDrag(e.clientX)) return;
  try {
    divider.setPointerCapture(e.pointerId);
  } catch {}
});

sideResize?.addEventListener("pointerdown", (e) => {
  if (e.button != null && e.button !== 0) return;
  if (sideCollapsed) return;
  e.preventDefault();
  sideDragging = true;
  startPos = e.clientX;
  startSize = sidePanelEl?.getBoundingClientRect().width || SIDE_DEFAULT;
  sideResize.classList.add("is-dragging");
  document.body.style.cursor = "ew-resize";
  document.body.style.userSelect = "none";
  document.querySelectorAll("iframe").forEach((f) => (f.style.pointerEvents = "none"));
  try {
    sideResize.setPointerCapture(e.pointerId);
  } catch {}
});

desktopResize?.addEventListener("pointerdown", (e) => {
  if (mode !== "desktop") return;
  if (e.button != null && e.button !== 0) return;
  e.preventDefault();
  desktopDragging = true;
  startPos = e.clientX;
  const rect = desktopPanel.getBoundingClientRect();
  const pref = panels.getBoundingClientRect();
  startSize = rect.left - pref.left;
  desktopResize.classList.add("is-dragging");
  document.body.style.cursor = "ew-resize";
  document.body.style.userSelect = "none";
  panels.querySelectorAll("iframe").forEach((f) => (f.style.pointerEvents = "none"));
  try {
    desktopResize.setPointerCapture(e.pointerId);
  } catch {}
});

document.addEventListener("pointermove", (e) => {
  if (isDragging) {
    moveSplitDrag(e.clientX);
    return;
  }
  if (sideDragging) {
    const next = applySidePanelWidth(startSize + (e.clientX - startPos));
    sideExpandedWidth = next;
    try {
      localStorage.setItem(SIDE_WIDTH_KEY, String(next));
    } catch {}
    if (mode === "pip") requestAnimationFrame(() => pip.restoreLayout());
    return;
  }
  if (desktopDragging) {
    const pref = panels.getBoundingClientRect();
    const inset = Math.max(0, startSize + (e.clientX - startPos));
    const width = Math.max(280, pref.width - inset);
    applyDesktopLayout((inset / pref.width) * 100, (width / pref.width) * 100);
    return;
  }
});

function endPanelDrags() {
  if (isDragging) {
    isDragging = false;
    divider?.classList.remove("is-dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    panels.querySelectorAll("iframe").forEach((f) => (f.style.pointerEvents = ""));
    persistSplitRatioFromLayout();
  }
  if (sideDragging) {
    sideDragging = false;
    sideResize?.classList.remove("is-dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.querySelectorAll("iframe").forEach((f) => (f.style.pointerEvents = ""));
  }
  if (desktopDragging) {
    desktopDragging = false;
    desktopResize?.classList.remove("is-dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    panels.querySelectorAll("iframe").forEach((f) => (f.style.pointerEvents = ""));
  }
}

document.addEventListener("pointerup", endPanelDrags);
document.addEventListener("pointercancel", endPanelDrags);
document.addEventListener("mouseup", endPanelDrags);
window.addEventListener("resize", () => {
  if (mode === "split") applySplitColumns();
  if (mode === "desktop") restoreDesktopInset();
  if (mode === "pip") requestAnimationFrame(() => pip.restoreLayout());
});
