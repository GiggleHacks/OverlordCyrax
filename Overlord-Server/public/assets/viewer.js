import { initSidePanel } from "./side-panel.js";
import { initPipOverlay } from "./pip-overlay.js";

const params = new URLSearchParams(location.search);
const clientId = params.get("clientId") || "";
const allowedModes = new Set(["webcam", "desktop", "split", "pip"]);
// Legacy "dock" / "space" URLs map to split (one clear side-by-side layout).
const rawMode = params.get("mode") === "dock" ? "split" : params.get("mode");
let mode = allowedModes.has(rawMode) ? rawMode : "webcam";

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
const transition = params.get("transition") || "";
const fromArray = params.get("fromArray") === "1";
// Webcam-only mode keeps in-frame controls; split/pip use the parent bar (no embedded chrome).
const webcamUrlFull = `/webcam?clientId=${encodeURIComponent(clientId)}&embedded=1&controls=1${transition ? "&transition=1" : ""}`;
const webcamUrlBar = `/webcam?clientId=${encodeURIComponent(clientId)}&embedded=1${transition ? "&transition=1" : ""}`;
const desktopUrl = `/remotedesktop?clientId=${encodeURIComponent(clientId)}&embedded=1`;

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

function applySplitColumns() {
  if (!panels || mode !== "split") return;
  // Desktop left (primary), webcam right — one clear side-by-side layout.
  panels.style.gridTemplateColumns = "minmax(280px, 7fr) 6px minmax(220px, 3fr)";
  panels.style.gridTemplateRows = "";
}

function updateCamStatusUi(status, fps) {
  if (camStatus) {
    const icons = {
      connecting: '<i class="fa-solid fa-circle-notch fa-spin"></i>',
      starting: '<i class="fa-solid fa-circle-notch fa-spin"></i>',
      stopping: '<i class="fa-solid fa-circle-notch fa-spin"></i>',
      streaming: '<i class="fa-solid fa-circle viewer-cam-dot-live"></i>',
      idle: '<i class="fa-solid fa-circle viewer-cam-dot-idle"></i>',
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
      offline: "Offline",
      disconnected: "Disconnected",
      error: "Error",
    };
    const key = status || "idle";
    camStatus.innerHTML = `${icons[key] || icons.idle} <span>${labels[key] || key}</span>`;
    camStatus.dataset.status = key;
  }
  if (camFps && fps != null) camFps.textContent = fps === "" || fps == null ? "--" : String(fps);

  const streaming = status === "streaming" || status === "starting";
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
    localStorage.setItem(SIDE_COLLAPSED_KEY, sideCollapsed ? "1" : "0");
  } catch {}
  if (typeof pip !== "undefined" && mode === "pip") {
    requestAnimationFrame(() => pip.restoreLayout());
  }
}

function loadSidePanelWidth() {
  try {
    const raw = localStorage.getItem(SIDE_WIDTH_KEY);
    const n = raw ? Number(raw) : SIDE_DEFAULT;
    sideExpandedWidth = Number.isFinite(n) ? Math.max(SIDE_MIN, Math.min(SIDE_MAX, n)) : SIDE_DEFAULT;
  } catch {
    sideExpandedWidth = SIDE_DEFAULT;
  }
  let collapsed = false;
  try {
    collapsed = localStorage.getItem(SIDE_COLLAPSED_KEY) === "1";
  } catch {}
  setSideCollapsed(collapsed);
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
  mode = allowedModes.has(requested) ? requested : "webcam";
  panels.dataset.mode = mode;
  if (prev !== mode) {
    panels.style.gridTemplateColumns = "";
    panels.style.gridTemplateRows = "";
    if (mode !== "desktop") clearDesktopInset();
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

  const needsWebcam = mode === "webcam" || mode === "split";
  const needsDesktop = mode === "desktop" || mode === "split" || mode === "pip";
  const needsPip = mode === "pip";
  const showBar = webcamNeedsParentBar(mode);

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
camRefresh?.addEventListener("click", () => postToWebcam({ type: "webcam_cmd", action: "refresh_cameras" }));

camSettingsBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!camSettingsMenu) return;
  const open = camSettingsMenu.hidden;
  camSettingsMenu.hidden = !open;
  camSettingsBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) postToWebcam({ type: "webcam_cmd", action: "ping" });
});

document.addEventListener("click", (e) => {
  if (!camSettingsMenu || camSettingsMenu.hidden) return;
  if (e.target.closest(".viewer-cam-settings-wrap")) return;
  camSettingsMenu.hidden = true;
  camSettingsBtn?.setAttribute("aria-expanded", "false");
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
    updateCamStatusUi(data.status, data.fps != null ? data.fps : undefined);
    if (data.devices) applyDevicesToSelect(data.devices);
    if (data.settings) applySettingsFromChild(data.settings);
  }
});

async function refreshCapability() {
  try {
    const response = await fetch(`/api/clients?page=1&pageSize=1&id=${encodeURIComponent(clientId)}`, { credentials: "include" });
    const data = await response.json();
    const client = (data.items || []).find((item) => item.id === clientId);
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

divider?.addEventListener("mousedown", (e) => {
  if (mode !== "split") return;
  e.preventDefault();
  isDragging = true;
  startPos = e.clientX;
  // Split: desktop is the left (primary) column.
  startSize = panels.querySelector(".viewer-panel-desktop").getBoundingClientRect().width;
  divider.classList.add("is-dragging");
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  panels.querySelectorAll("iframe").forEach((f) => (f.style.pointerEvents = "none"));
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

document.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const totalSize = panels.getBoundingClientRect().width;
  const dividerSize = 6;
  const minSize = 200;
  const pos = e.clientX;
  let newFirst = startSize + (pos - startPos);
  newFirst = Math.max(minSize, Math.min(newFirst, totalSize - dividerSize - minSize));
  const second = totalSize - newFirst - dividerSize;
  // Split: left column is desktop, right is webcam.
  panels.style.gridTemplateColumns = `${newFirst}px ${dividerSize}px ${second}px`;
});

function endPanelDrags() {
  if (isDragging) {
    isDragging = false;
    divider?.classList.remove("is-dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    panels.querySelectorAll("iframe").forEach((f) => (f.style.pointerEvents = ""));
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

document.addEventListener("mouseup", endPanelDrags);
document.addEventListener("pointerup", endPanelDrags);
document.addEventListener("pointercancel", endPanelDrags);
window.addEventListener("resize", () => {
  if (mode === "desktop") restoreDesktopInset();
  if (mode === "pip") requestAnimationFrame(() => pip.restoreLayout());
});
