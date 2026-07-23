/**
 * Overlord Classic File Explorer (Win95/98) — v2.5.27
 * Second skin; shares WS/HTTP protocol with modern filebrowser.js
 */
import { encodeMsgpack, decodeMsgpack } from "./msgpack-helpers.js";
import { checkFeatureAccess } from "./feature-gate.js";
import {
  PREVIEW_MAX_BYTES,
  escapeHtml,
  formatBytes,
  getFileExt,
  getParentPath,
  getPreviewMimeType,
  isPreviewable,
  shouldShowParentDirectory,
} from "./filebrowser-utils.js";

const ASSET = "/assets/filebrowser-classic";
const SKIN_KEY = "overlord.filebrowser.skin";
const VIEW_KEY = "overlord.filebrowser.classic.view";
const VERSION = "2.5.27";

const parts = window.location.pathname.split("/").filter(Boolean);
const clientId = parts[0] || "";

const ICONS = {
  folder: `${ASSET}/icons/folder.png`,
  image: `${ASSET}/icons/image.png`,
  archive: `${ASSET}/icons/winzip.png`,
  text: `${ASSET}/icons/text.png`,
  audio: `${ASSET}/icons/audio.png`,
  video: `${ASSET}/icons/video.png`,
  generic: `${ASSET}/icons/generic.png`,
};

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "ico"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "flac", "ogg", "aac", "m4a", "wma"]);
const VIDEO_EXTS = new Set(["mp4", "avi", "mkv", "mov", "wmv", "webm", "m4v"]);
const ARCHIVE_EXTS = new Set(["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz"]);
const TEXT_EXTS = new Set([
  "txt", "md", "log", "json", "xml", "csv", "ini", "cfg", "yml", "yaml",
  "js", "ts", "css", "html", "htm", "py", "go", "rs", "c", "cpp", "h", "java",
  "sh", "bat", "ps1", "sql",
]);
const THUMBNAIL_EXTS = new Set([
  "jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff", "heic", "heif", "ico",
  "mp4", "mkv", "mov", "avi", "webm", "m4v",
  "pdf",
]);
const THUMB_EDGE = 128;
const THUMB_BATCH_SIZE = 8;
const THUMB_BATCH_DELAY_MS = 80;
const MAX_THUMB_INFLIGHT = 2;
const MAX_THUMB_CACHE = 160;

let ws = null;
let currentPath = ".";
let pathHistory = [];
let pathForward = [];
let directoryEntries = [];
let selected = new Set();
let selectionAnchor = null;
let sortField = "name";
let sortDir = 1;
let viewMode = loadViewMode();
let detectedOS = "";
let detectedHomePath = "";
let lastDriveEntries = [];
let pendingDeletes = new Map();
let pendingCommands = new Map();
let soundsEnabled = true;
let soundManifest = null;
const audioCache = {};
let marqueeState = null;
let dragDepth = 0;
const thumbCache = new Map();
const thumbQueue = [];
const thumbInFlight = new Set();
let thumbFlushScheduled = false;
let hoverTimer = null;
let hoverEntry = null;
let previewBlobUrl = null;
let previewPath = null;
let previewAbort = null;
const HOVER_DELAY_MS = 280;
const HOVER_THUMB_EDGE = 256;

function loadViewMode() {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "thumbs" || v === "details") return v;
  } catch {}
  return "details";
}

function saveViewMode(mode) {
  try {
    localStorage.setItem(VIEW_KEY, mode);
  } catch {}
}

const els = {
  titleLabel: document.getElementById("titleLabel"),
  backBtn: document.getElementById("backBtn"),
  forwardBtn: document.getElementById("forwardBtn"),
  upBtn: document.getElementById("upBtn"),
  mkdirBtn: document.getElementById("mkdirBtn"),
  deleteBtn: document.getElementById("deleteBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  uploadBtn: document.getElementById("uploadBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  viewDetailsBtn: document.getElementById("viewDetailsBtn"),
  viewThumbsBtn: document.getElementById("viewThumbsBtn"),
  modernBtn: document.getElementById("modernBtn"),
  fileInput: document.getElementById("fileInput"),
  pathInput: document.getElementById("pathInput"),
  goBtn: document.getElementById("goBtn"),
  placesList: document.getElementById("placesList"),
  drivesList: document.getElementById("drivesList"),
  listPane: document.getElementById("listPane"),
  fileList: document.getElementById("fileList"),
  marquee: document.getElementById("marquee"),
  countField: document.getElementById("countField"),
  selField: document.getElementById("selField"),
  statusField: document.getElementById("statusField"),
  xferBar: document.getElementById("xferBar"),
  xferLabel: document.getElementById("xferLabel"),
  xferBarFill: document.getElementById("xferBarFill"),
  fileMenu: document.getElementById("fileMenu"),
  bgMenu: document.getElementById("bgMenu"),
  viewMenu: document.getElementById("viewMenu"),
  detailsHeader: document.getElementById("detailsHeader"),
  menuBar: document.getElementById("menuBar"),
  winClose: document.getElementById("winClose"),
  winMin: document.getElementById("winMin"),
  winMax: document.getElementById("winMax"),
  errorModal: document.getElementById("errorModal"),
  errorText: document.getElementById("errorText"),
  errorOk: document.getElementById("errorOk"),
  errorClose: document.getElementById("errorClose"),
  confirmModal: document.getElementById("confirmModal"),
  confirmText: document.getElementById("confirmText"),
  qlPopover: document.getElementById("qlPopover"),
  qlTitle: document.getElementById("qlTitle"),
  qlBody: document.getElementById("qlBody"),
  qlMeta: document.getElementById("qlMeta"),
  previewModal: document.getElementById("previewModal"),
  previewTitleText: document.getElementById("previewTitleText"),
  previewBody: document.getElementById("previewBody"),
  previewLoading: document.getElementById("previewLoading"),
  previewClose: document.getElementById("previewClose"),
  previewOk: document.getElementById("previewOk"),
  previewDownload: document.getElementById("previewDownload"),
  confirmYes: document.getElementById("confirmYes"),
  confirmNo: document.getElementById("confirmNo"),
  confirmClose: document.getElementById("confirmClose"),
  promptModal: document.getElementById("promptModal"),
  promptTitle: document.getElementById("promptTitle"),
  promptLabel: document.getElementById("promptLabel"),
  promptInput: document.getElementById("promptInput"),
  promptOk: document.getElementById("promptOk"),
  promptCancel: document.getElementById("promptCancel"),
  promptClose: document.getElementById("promptClose"),
};

try {
  localStorage.setItem(SKIN_KEY, "classic");
} catch {}

function setStatus(text) {
  els.statusField.textContent = text || "";
}

function setConnectedUi(ok) {
  [els.mkdirBtn, els.deleteBtn, els.refreshBtn, els.uploadBtn, els.downloadBtn, els.goBtn].forEach((b) => {
    if (b) b.disabled = !ok;
  });
}

function joinPath(dir, name) {
  if (!dir || dir === "." ) return name;
  if (/^[A-Za-z]:\\?$/.test(dir)) {
    const root = dir.endsWith("\\") ? dir : `${dir}\\`;
    return root + name;
  }
  if (dir.includes("\\")) {
    return dir.replace(/\\+$/, "") + "\\" + name;
  }
  if (dir === "/") return `/${name}`;
  return dir.replace(/\/+$/, "") + "/" + name;
}

function iconFor(entry) {
  if (entry.isDir) return ICONS.folder;
  const ext = getFileExt(entry.name || "");
  if (IMAGE_EXTS.has(ext)) return ICONS.image;
  if (AUDIO_EXTS.has(ext)) return ICONS.audio;
  if (VIDEO_EXTS.has(ext)) return ICONS.video;
  if (ARCHIVE_EXTS.has(ext)) return ICONS.archive;
  if (TEXT_EXTS.has(ext)) return ICONS.text;
  return ICONS.generic;
}

function typeLabel(entry) {
  if (entry.isDir) return "File Folder";
  const ext = getFileExt(entry.name || "");
  if (!ext) return "File";
  return `${ext.toUpperCase()} File`;
}

function formatModified(entry) {
  const raw = entry.modTime || entry.mtime || entry.modified || entry.modifiedAt;
  if (!raw) return "";
  const d = new Date(typeof raw === "number" ? (raw < 1e12 ? raw * 1000 : raw) : raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

async function loadSounds() {
  try {
    const res = await fetch(`${ASSET}/sounds/manifest.json`);
    if (!res.ok) return;
    soundManifest = await res.json();
  } catch {}
}

function playSound(action) {
  if (!soundsEnabled || !soundManifest?.actions?.[action]?.length) return;
  const def = soundManifest.defaults?.[action] ?? 0;
  const opt = soundManifest.actions[action][def];
  if (!opt?.file) return;
  const url = opt.file.startsWith("/") ? opt.file : `${ASSET}/${opt.file}`;
  try {
    if (!audioCache[url]) audioCache[url] = new Audio(url);
    const a = audioCache[url];
    a.currentTime = 0;
    a.play().catch(() => {});
  } catch {}
}

function showError(message) {
  playSound("error");
  els.errorText.textContent = message;
  els.errorModal.hidden = false;
  els.errorOk.focus();
}

function hideError() {
  els.errorModal.hidden = true;
}

function showConfirm(message) {
  return new Promise((resolve) => {
    els.confirmText.textContent = message;
    els.confirmModal.hidden = false;
    const done = (v) => {
      els.confirmModal.hidden = true;
      els.confirmYes.onclick = null;
      els.confirmNo.onclick = null;
      els.confirmClose.onclick = null;
      resolve(v);
    };
    els.confirmYes.onclick = () => done(true);
    els.confirmNo.onclick = () => done(false);
    els.confirmClose.onclick = () => done(false);
    els.confirmYes.focus();
  });
}

function showPrompt(title, label, initial = "") {
  return new Promise((resolve) => {
    els.promptTitle.textContent = title;
    els.promptLabel.textContent = label;
    els.promptInput.value = initial;
    els.promptModal.hidden = false;
    els.promptInput.focus();
    els.promptInput.select();
    const done = (v) => {
      els.promptModal.hidden = true;
      els.promptOk.onclick = null;
      els.promptCancel.onclick = null;
      els.promptClose.onclick = null;
      els.promptInput.onkeydown = null;
      resolve(v);
    };
    els.promptOk.onclick = () => done(els.promptInput.value);
    els.promptCancel.onclick = () => done(null);
    els.promptClose.onclick = () => done(null);
    els.promptInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        done(els.promptInput.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        done(null);
      }
    };
  });
}

function hideMenus() {
  els.fileMenu.hidden = true;
  els.bgMenu.hidden = true;
  els.viewMenu.hidden = true;
  els.menuBar.querySelectorAll("span").forEach((s) => s.classList.remove("open"));
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(encodeMsgpack(msg));
  }
}

function trackCommand(commandId, meta) {
  pendingCommands.set(commandId, meta);
}

function waitCommand(commandId, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const existing = pendingCommands.get(commandId) || {};
    const timeoutId = setTimeout(() => {
      pendingCommands.delete(commandId);
      reject(new Error("timed out"));
    }, timeoutMs);
    pendingCommands.set(commandId, {
      ...existing,
      resolve,
      reject,
      timeoutId,
    });
  });
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/api/clients/${clientId}/files/ws`);
  socket.binaryType = "arraybuffer";
  ws = socket;
  setStatus("Connecting…");
  setConnectedUi(false);

  socket.onopen = () => {
    setStatus("Connected");
    setConnectedUi(true);
    listFiles(currentPath || ".", { resetHistory: true });
  };
  socket.onmessage = (ev) => {
    const msg = decodeMsgpack(ev.data);
    if (msg) handleMessage(msg);
  };
  socket.onerror = () => setStatus("Connection error");
  socket.onclose = () => {
    setStatus("Disconnected — retrying…");
    setConnectedUi(false);
    if (ws === socket) setTimeout(connect, 3000);
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case "ready":
      if (msg.clientUser && msg.clientOs) applyClientInfo(msg.clientOs, msg.clientUser);
      break;
    case "status":
      if (msg.status === "offline") {
        setStatus("Client offline");
        setConnectedUi(false);
      }
      break;
    case "file_list_result":
      handleFileList(msg);
      break;
    case "file_thumb_result":
      handleFileThumbResult(msg);
      break;
    case "command_result":
      handleCommandResult(msg);
      break;
    case "file_upload_result":
      break;
    default:
      break;
  }
}

function thumbCacheKey(entry) {
  if (!entry || entry.isDir) return null;
  const ext = getFileExt(entry.name || "");
  if (!THUMBNAIL_EXTS.has(ext)) return null;
  if (Number(entry.size || 0) > 256 * 1024 * 1024) return null;
  return `thumb:${entry.path}|${entry.size}|${entry.modTime || entry.mtime || 0}|${THUMB_EDGE}`;
}

function trimThumbCache() {
  while (thumbCache.size > MAX_THUMB_CACHE) {
    const oldest = thumbCache.keys().next().value;
    const ent = thumbCache.get(oldest);
    if (ent?.blobUrl) URL.revokeObjectURL(ent.blobUrl);
    thumbCache.delete(oldest);
  }
}

function scheduleThumbFlush() {
  if (thumbFlushScheduled) return;
  if (thumbInFlight.size >= MAX_THUMB_INFLIGHT) return;
  thumbFlushScheduled = true;
  setTimeout(flushThumbQueue, THUMB_BATCH_DELAY_MS);
}

function flushThumbQueue() {
  thumbFlushScheduled = false;
  if (!thumbQueue.length) return;
  if (thumbInFlight.size >= MAX_THUMB_INFLIGHT) return;
  const batch = thumbQueue.splice(0, THUMB_BATCH_SIZE);
  const commandId = `thumb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  thumbInFlight.add(commandId);
  send({
    type: "command",
    commandType: "file_thumb",
    id: commandId,
    payload: { items: batch },
  });
  if (thumbQueue.length) scheduleThumbFlush();
}

function requestThumbFor(entry) {
  const key = thumbCacheKey(entry);
  if (!key) return null;
  if (thumbCache.has(key)) {
    const cached = thumbCache.get(key);
    thumbCache.delete(key);
    thumbCache.set(key, cached);
    return key;
  }
  thumbCache.set(key, { pending: true });
  trimThumbCache();
  thumbQueue.push({ key, path: entry.path, size: THUMB_EDGE });
  scheduleThumbFlush();
  return key;
}

function handleFileThumbResult(msg) {
  if (msg.commandId) thumbInFlight.delete(msg.commandId);
  if (thumbQueue.length) scheduleThumbFlush();
  const items = Array.isArray(msg.thumbs) ? msg.thumbs : [];
  for (const item of items) {
    if (!item?.key) continue;
    const entry = thumbCache.get(item.key) || {};
    entry.pending = false;
    if (item.jpeg && item.jpeg.length > 0) {
      if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl);
      entry.blobUrl = URL.createObjectURL(new Blob([item.jpeg], { type: "image/jpeg" }));
      if (String(item.key).endsWith(`|${HOVER_THUMB_EDGE}`)) entry.large = true;
    } else {
      entry.failed = true;
    }
    thumbCache.delete(item.key);
    thumbCache.set(item.key, entry);
    trimThumbCache();
    applyThumbToDom(item.key, entry);
    // Large hover thumbs use a different key — refresh popover if same file
    if (hoverEntry && entry.blobUrl && String(item.key).startsWith(`thumb:${hoverEntry.path}|`)) {
      els.qlBody.innerHTML = `<img src="${entry.blobUrl}" alt="" />`;
      const anchor = Array.from(els.fileList.querySelectorAll(".file-row")).find((r) => r.dataset.path === hoverEntry.path);
      positionQuickLook(anchor);
    }
  }
}

function applyThumbToDom(key, entry) {
  if (!entry?.blobUrl) return;
  const nodes = els.fileList.querySelectorAll(`[data-thumb-key]`);
  nodes.forEach((el) => {
    if (el.dataset.thumbKey !== key) return;
    const img = el.querySelector("img");
    if (!img) return;
    img.src = entry.blobUrl;
    img.classList.remove("icon-fallback");
  });
  // Refresh hover popover if it's showing this file
  if (hoverEntry && thumbCacheKey(hoverEntry) === key) {
    showQuickLook(hoverEntry, null);
  }
}

function hideQuickLook() {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  hoverEntry = null;
  if (els.qlPopover) els.qlPopover.hidden = true;
}

function showQuickLook(entry, anchorEl) {
  if (!els.qlPopover || !entry || entry.isDir) return;
  const ext = getFileExt(entry.name || "");
  const canThumb = THUMBNAIL_EXTS.has(ext) || isPreviewable(entry.name || "");
  if (!canThumb) return;

  hoverEntry = entry;
  els.qlTitle.textContent = entry.name || "";
  els.qlMeta.textContent = [
    typeLabel(entry),
    entry.isDir ? "" : formatBytes(entry.size || 0),
    formatModified(entry),
  ].filter(Boolean).join(" · ");

  const tKey = thumbCacheKey(entry);
  const cached = tKey ? thumbCache.get(tKey) : null;
  const src = cached?.blobUrl || iconFor(entry);
  els.qlBody.innerHTML = cached?.blobUrl
    ? `<img src="${src}" alt="" />`
    : `<div class="ql-placeholder"><img src="${iconFor(entry)}" alt="" style="width:48px;height:48px;margin:0 auto 8px;display:block" />Loading preview…</div>`;

  // Request a larger hover thumb if we only have icon/small thumb
  if (tKey && (!cached?.blobUrl || (cached && !cached.large))) {
    // Prefer larger edge for popover; still uses same cache key family with HOVER edge
    const largeKey = `thumb:${entry.path}|${entry.size}|${entry.modTime || entry.mtime || 0}|${HOVER_THUMB_EDGE}`;
    const largeCached = thumbCache.get(largeKey);
    if (largeCached?.blobUrl) {
      els.qlBody.innerHTML = `<img src="${largeCached.blobUrl}" alt="" />`;
    } else if (!largeCached?.pending && !largeCached?.failed) {
      thumbCache.set(largeKey, { pending: true, large: true });
      thumbQueue.push({ key: largeKey, path: entry.path, size: HOVER_THUMB_EDGE });
      scheduleThumbFlush();
    }
  }

  els.qlPopover.hidden = false;
  positionQuickLook(anchorEl);
}

function positionQuickLook(anchorEl) {
  if (!els.qlPopover || els.qlPopover.hidden) return;
  const pad = 12;
  const rect = anchorEl?.getBoundingClientRect?.();
  const popW = els.qlPopover.offsetWidth || 280;
  const popH = els.qlPopover.offsetHeight || 240;
  let left = rect ? rect.right + 8 : window.innerWidth / 2 - popW / 2;
  let top = rect ? rect.top : 40;
  if (left + popW > window.innerWidth - pad) {
    left = (rect ? rect.left - popW - 8 : pad);
  }
  if (left < pad) left = pad;
  if (top + popH > window.innerHeight - pad) {
    top = Math.max(pad, window.innerHeight - popH - pad);
  }
  if (top < pad) top = pad;
  els.qlPopover.style.left = `${left}px`;
  els.qlPopover.style.top = `${top}px`;
}

function scheduleQuickLook(entry, anchorEl) {
  if (hoverTimer) clearTimeout(hoverTimer);
  hoverEntry = entry;
  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    if (hoverEntry === entry) showQuickLook(entry, anchorEl);
  }, HOVER_DELAY_MS);
}

function closePreview() {
  previewAbort?.abort();
  previewAbort = null;
  if (previewBlobUrl) {
    URL.revokeObjectURL(previewBlobUrl);
    previewBlobUrl = null;
  }
  previewPath = null;
  if (els.previewModal) els.previewModal.hidden = true;
  if (els.previewBody) {
    els.previewBody.innerHTML = `<div class="preview-loading" id="previewLoading">Loading preview…</div>`;
  }
}

async function openPreview(entry) {
  if (!entry || entry.isDir) return;
  if (!isPreviewable(entry.name || "")) {
    // Non-previewable: fall back to download
    downloadPaths([entry.path]);
    return;
  }
  const path = entry.path;
  const fileName = entry.name || path.split(/[/\\]/).pop() || "file";
  const mime = getPreviewMimeType(fileName);
  const knownSize = Number(entry.size || 0);
  if (knownSize > PREVIEW_MAX_BYTES) {
    showError(`File too large to preview (${formatBytes(knownSize)}).\nUse Download instead.`);
    return;
  }

  hideQuickLook();
  previewAbort?.abort();
  const abort = new AbortController();
  previewAbort = abort;
  previewPath = path;
  if (previewBlobUrl) {
    URL.revokeObjectURL(previewBlobUrl);
    previewBlobUrl = null;
  }

  if (els.previewTitleText) els.previewTitleText.textContent = fileName;
  if (els.previewBody) {
    els.previewBody.innerHTML = `<div class="preview-loading">Loading preview…</div>`;
  }
  if (els.previewModal) els.previewModal.hidden = false;
  setStatus(`Previewing ${fileName}…`);

  try {
    // Prefer already-loaded thumbnail for instant image preview while full loads
    const tKey = thumbCacheKey(entry);
    const cached = tKey ? thumbCache.get(tKey) : null;
    if (cached?.blobUrl && mime?.startsWith("image/")) {
      els.previewBody.innerHTML = `<img src="${cached.blobUrl}" alt="" />`;
    }

    const requestRes = await fetch("/api/file/download/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal: abort.signal,
      body: JSON.stringify({ clientId, path, preview: true }),
    });
    if (!requestRes.ok) throw new Error((await requestRes.text()) || "preview request failed");
    const data = await requestRes.json();
    const downloadUrl =
      typeof data?.downloadUrl === "string"
        ? data.downloadUrl
        : data?.downloadId
          ? `/api/file/download/${encodeURIComponent(data.downloadId)}`
          : "";
    if (!downloadUrl) throw new Error("no preview url");

    const res = await fetch(downloadUrl, {
      method: "GET",
      credentials: "include",
      signal: abort.signal,
    });
    if (!res.ok) throw new Error((await res.text()) || "preview failed");

    const contentLength = Number(res.headers.get("Content-Length") || 0);
    if (contentLength > PREVIEW_MAX_BYTES) {
      await res.body?.cancel?.("preview size limit");
      throw new Error(`File too large to preview (${formatBytes(contentLength)})`);
    }

    const reader = res.body?.getReader();
    const chunks = [];
    let received = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        if (received > PREVIEW_MAX_BYTES) {
          await reader.cancel("preview size limit");
          throw new Error(`File too large to preview (${formatBytes(received)})`);
        }
      }
    } else {
      chunks.push(new Uint8Array(await res.arrayBuffer()));
    }

    if (previewPath !== path) return;
    const blob = new Blob(chunks, { type: mime || "application/octet-stream" });
    if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
    previewBlobUrl = URL.createObjectURL(blob);

    if (mime?.startsWith("image/")) {
      els.previewBody.innerHTML = `<img src="${previewBlobUrl}" alt="" />`;
    } else if (mime === "application/pdf") {
      els.previewBody.innerHTML = `<iframe src="${previewBlobUrl}" title="${escapeHtml(fileName)}"></iframe>`;
    } else {
      els.previewBody.innerHTML = `<div class="preview-error">Cannot preview this file type.</div>`;
    }
    setStatus(`Preview: ${fileName}`);
  } catch (err) {
    if (err?.name === "AbortError") return;
    if (previewPath !== path) return;
    els.previewBody.innerHTML = `<div class="preview-error">${escapeHtml(err.message || "Preview failed")}</div>`;
    playSound("error");
    setStatus("Preview failed");
  }
}

function setViewMode(mode) {
  if (mode !== "details" && mode !== "thumbs") return;
  viewMode = mode;
  saveViewMode(mode);
  els.listPane.classList.toggle("view-thumbs", mode === "thumbs");
  els.listPane.classList.toggle("view-details", mode === "details");
  if (els.viewDetailsBtn) els.viewDetailsBtn.disabled = mode === "details";
  if (els.viewThumbsBtn) els.viewThumbsBtn.disabled = mode === "thumbs";
  updateViewMenuChecks();
  renderList();
  if (mode === "thumbs") setStatus("Thumbnail view");
  else setStatus("Details view");
}

function updateViewMenuChecks() {
  for (const menu of [els.viewMenu, els.bgMenu]) {
    if (!menu) continue;
    menu.querySelectorAll("[data-action='view-details'],[data-action='view-thumbs']").forEach((li) => {
      const isDetails = li.dataset.action === "view-details";
      li.classList.toggle("checked", isDetails ? viewMode === "details" : viewMode === "thumbs");
    });
  }
}

function listFiles(path, options = {}) {
  const { resetHistory = false, skipHistory = false, fromForward = false } = options;
  if (resetHistory) {
    pathHistory = [];
    pathForward = [];
  } else if (!skipHistory && currentPath && currentPath !== path) {
    pathHistory.push(currentPath);
    if (!fromForward) pathForward = [];
  }
  currentPath = path || ".";
  selected.clear();
  selectionAnchor = null;
  send({ type: "file_list", path: currentPath });
  els.pathInput.value = currentPath;
  updateNavButtons();
  setStatus(`Opening ${currentPath}…`);
}

function updateNavButtons() {
  els.backBtn.disabled = pathHistory.length === 0;
  els.forwardBtn.disabled = pathForward.length === 0;
  els.upBtn.disabled = !shouldShowParentDirectory(currentPath);
}

function goBack() {
  if (!pathHistory.length) return;
  const prev = pathHistory.pop();
  pathForward.push(currentPath);
  listFiles(prev, { skipHistory: true });
}

function goForward() {
  if (!pathForward.length) return;
  const next = pathForward.pop();
  listFiles(next, { fromForward: true });
}

function goUp() {
  if (!shouldShowParentDirectory(currentPath)) return;
  listFiles(getParentPath(currentPath));
}

function detectOSAndHome(path) {
  if (!path || path === ".") return;
  const winMatch = path.match(/^([A-Za-z]:\\Users\\[^\\]+)/i);
  if (winMatch) {
    detectedOS = "windows";
    detectedHomePath = winMatch[1];
    updatePlaces();
    return;
  }
  if (path.match(/^[A-Za-z]:\\/)) {
    detectedOS = "windows";
    updatePlaces();
    return;
  }
  const macMatch = path.match(/^(\/Users\/[^/]+)/);
  if (macMatch) {
    detectedOS = "mac";
    detectedHomePath = macMatch[1];
    updatePlaces();
    return;
  }
  const linuxMatch = path.match(/^(\/home\/[^/]+)/);
  if (linuxMatch) {
    detectedOS = "linux";
    detectedHomePath = linuxMatch[1];
    updatePlaces();
    return;
  }
  if (path.startsWith("/root")) {
    detectedOS = "linux";
    detectedHomePath = "/root";
    updatePlaces();
    return;
  }
  if (path.startsWith("/")) {
    detectedOS = "linux";
    updatePlaces();
  }
}

function applyClientInfo(osStr, userName) {
  if (detectedOS && detectedHomePath) return;
  const os = (osStr || "").toLowerCase();
  const user = (userName || "").trim();
  if (!user) return;
  if (os.includes("windows")) {
    detectedOS = "windows";
    detectedHomePath = `C:\\Users\\${user}`;
  } else if (os.includes("darwin") || os.includes("mac")) {
    detectedOS = "mac";
    detectedHomePath = `/Users/${user}`;
  } else {
    detectedOS = "linux";
    detectedHomePath = user === "root" ? "/root" : `/home/${user}`;
  }
  updatePlaces();
  updateDrives(lastDriveEntries);
}

function placeBtn(label, path, icon) {
  const active =
    currentPath === path ||
    currentPath.startsWith(path + "/") ||
    currentPath.startsWith(path + "\\");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "places-item" + (active ? " active" : "");
  btn.dataset.path = path;
  btn.innerHTML = `<img src="${icon}" alt="" /><span>${escapeHtml(label)}</span>`;
  btn.onclick = () => listFiles(path);
  return btn;
}

function updatePlaces() {
  const root = els.placesList;
  root.innerHTML = "";
  if (detectedOS === "windows" && detectedHomePath) {
    const h = detectedHomePath;
    [
      ["Desktop", `${h}\\Desktop`],
      ["Downloads", `${h}\\Downloads`],
      ["Documents", `${h}\\Documents`],
      ["Pictures", `${h}\\Pictures`],
      ["Music", `${h}\\Music`],
      ["Videos", `${h}\\Videos`],
      ["AppData", `${h}\\AppData`],
      ["Program Files", "C:\\Program Files"],
      ["Windows", "C:\\Windows"],
    ].forEach(([label, path]) => root.appendChild(placeBtn(label, path, ICONS.folder)));
  } else if (detectedOS === "linux" || detectedOS === "mac") {
    if (detectedHomePath) {
      [
        ["Home", detectedHomePath],
        ["Desktop", `${detectedHomePath}/Desktop`],
        ["Downloads", `${detectedHomePath}/Downloads`],
        ["Documents", `${detectedHomePath}/Documents`],
      ].forEach(([label, path]) => root.appendChild(placeBtn(label, path, ICONS.folder)));
    }
    [
      ["/etc", "/etc"],
      ["/var", "/var"],
      ["/tmp", "/tmp"],
      ["/opt", "/opt"],
    ].forEach(([label, path]) => root.appendChild(placeBtn(label, path, ICONS.folder)));
  } else {
    root.innerHTML = `<div class="places-heading" style="font-weight:400;text-transform:none">Navigate to detect</div>`;
  }
}

function updateDrives(entries) {
  const root = els.drivesList;
  root.innerHTML = "";
  const thisPc = placeBtn(
    detectedOS === "windows" ? "This PC" : "Root /",
    detectedOS === "windows" ? "." : "/",
    ICONS.generic,
  );
  root.appendChild(thisPc);
  const drives = (entries || []).filter((e) => e.isDir && /^[A-Za-z]:$/.test(e.name || ""));
  for (const d of drives) {
    const path = `${d.name}\\`;
    root.appendChild(placeBtn(`${d.name}\\`, path, ICONS.generic));
  }
}

function handleFileList(msg) {
  if (msg.error) {
    directoryEntries = [];
    renderList();
    showError(msg.error);
    setStatus(`Error: ${msg.error}`);
    return;
  }
  currentPath = msg.path || currentPath;
  els.pathInput.value = currentPath;
  directoryEntries = Array.isArray(msg.entries) ? msg.entries : [];
  const short = clientId.length > 12 ? clientId.slice(0, 10) + "…" : clientId;
  els.titleLabel.textContent = `Exploring — ${currentPath} — ${short}`;
  document.title = `${currentPath} — Classic Explorer`;

  if (!detectedOS) detectOSAndHome(currentPath);
  else if (!detectedHomePath) detectOSAndHome(currentPath);

  if (!msg.path || msg.path === ".") {
    lastDriveEntries = directoryEntries;
    updateDrives(directoryEntries);
  } else if (!lastDriveEntries.length) {
    updateDrives([]);
  }
  updatePlaces();
  updateNavButtons();
  selected.clear();
  selectionAnchor = null;
  setStatus("Ready");
  setConnectedUi(true);
  renderList();
}

function sortedEntries() {
  const list = directoryEntries.slice();
  list.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    let av;
    let bv;
    if (sortField === "size") {
      av = Number(a.size || 0);
      bv = Number(b.size || 0);
    } else if (sortField === "type") {
      av = typeLabel(a).toLowerCase();
      bv = typeLabel(b).toLowerCase();
    } else if (sortField === "modified") {
      av = new Date(a.modTime || a.mtime || 0).getTime() || 0;
      bv = new Date(b.modTime || b.mtime || 0).getTime() || 0;
    } else {
      av = String(a.name || "").toLowerCase();
      bv = String(b.name || "").toLowerCase();
    }
    if (av < bv) return -1 * sortDir;
    if (av > bv) return 1 * sortDir;
    return 0;
  });
  return list;
}

function bindRowEvents(row, entry, list) {
  row.onclick = (e) => onRowClick(e, entry, list);
  row.ondblclick = () => onRowDblClick(entry);
  row.onmouseenter = () => {
    if (entry.isDir) return;
    if (!isPreviewable(entry.name || "") && !THUMBNAIL_EXTS.has(getFileExt(entry.name || ""))) return;
    scheduleQuickLook(entry, row);
  };
  row.onmouseleave = () => {
    if (hoverEntry?.path === entry.path) hideQuickLook();
  };
  row.oncontextmenu = (e) => {
    e.preventDefault();
    hideQuickLook();
    if (!selected.has(entry.path)) {
      selected.clear();
      selected.add(entry.path);
      selectionAnchor = entry.path;
      updateSelectionClasses();
    }
    showFileMenu(e.clientX, e.clientY);
  };
}

function renderList() {
  const list = sortedEntries();
  const frag = document.createDocumentFragment();
  const marquee = els.marquee;
  els.fileList.innerHTML = "";
  els.fileList.appendChild(marquee);
  els.listPane.classList.toggle("view-thumbs", viewMode === "thumbs");
  els.listPane.classList.toggle("view-details", viewMode === "details");

  if (shouldShowParentDirectory(currentPath)) {
    const parent = getParentPath(currentPath);
    const row = document.createElement("div");
    row.className = "file-row";
    row.dataset.path = parent;
    row.dataset.isDir = "true";
    row.dataset.parent = "1";
    if (viewMode === "thumbs") {
      row.innerHTML = `
        <div class="col-name">
          <div class="thumb-frame"><img class="icon-fallback" src="${ICONS.folder}" alt="" /></div>
          <span class="label">..</span>
        </div>`;
    } else {
      row.innerHTML = `
        <div class="col-name"><img src="${ICONS.folder}" alt="" /><span class="label">..</span></div>
        <div class="col-size"></div>
        <div class="col-type">File Folder</div>
        <div class="col-date"></div>`;
    }
    row.ondblclick = () => listFiles(parent);
    row.onclick = () => listFiles(parent);
    frag.appendChild(row);
  }

  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "file-list-empty";
    empty.textContent = "This folder is empty.";
    frag.appendChild(empty);
  }

  const thumbsToRequest = [];
  for (const entry of list) {
    const row = document.createElement("div");
    const isSel = selected.has(entry.path);
    const pending = pendingDeletes.has(entry.path);
    row.className = "file-row" + (isSel ? " selected" : "") + (pending ? " pending-delete" : "");
    row.dataset.path = entry.path;
    row.dataset.isDir = entry.isDir ? "true" : "false";
    row.dataset.name = entry.name || "";

    const fallback = iconFor(entry);
    if (viewMode === "thumbs") {
      const tKey = thumbCacheKey(entry);
      const cached = tKey ? thumbCache.get(tKey) : null;
      const src = cached?.blobUrl || fallback;
      const isReal = !!(cached?.blobUrl);
      if (tKey) row.dataset.thumbKey = tKey;
      row.innerHTML = `
        <div class="col-name">
          <div class="thumb-frame" ${tKey ? `data-thumb-key="${escapeHtml(tKey)}"` : ""}>
            <img src="${src}" alt="" class="${isReal ? "" : "icon-fallback"}" draggable="false" />
          </div>
          <span class="label">${escapeHtml(entry.name || "")}</span>
        </div>`;
      if (tKey && !cached?.blobUrl && !cached?.failed) thumbsToRequest.push(entry);
    } else {
      row.innerHTML = `
        <div class="col-name"><img src="${fallback}" alt="" /><span class="label">${escapeHtml(entry.name || "")}</span></div>
        <div class="col-size">${entry.isDir ? "" : formatBytes(entry.size || 0)}</div>
        <div class="col-type">${escapeHtml(typeLabel(entry))}</div>
        <div class="col-date">${escapeHtml(formatModified(entry))}</div>`;
    }

    bindRowEvents(row, entry, list);
    frag.appendChild(row);
  }

  els.fileList.appendChild(frag);
  updateSelectionUi();

  if (viewMode === "thumbs") {
    for (const entry of thumbsToRequest) requestThumbFor(entry);
  }
}

function onRowClick(e, entry, list) {
  if (e.target.closest("[data-parent]")) return;
  const paths = list.map((x) => x.path);
  if (e.ctrlKey || e.metaKey) {
    if (selected.has(entry.path)) selected.delete(entry.path);
    else selected.add(entry.path);
    selectionAnchor = entry.path;
  } else if (e.shiftKey && selectionAnchor) {
    const a = paths.indexOf(selectionAnchor);
    const b = paths.indexOf(entry.path);
    if (a >= 0 && b >= 0) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      selected.clear();
      for (let i = lo; i <= hi; i++) selected.add(paths[i]);
    }
  } else {
    selected.clear();
    selected.add(entry.path);
    selectionAnchor = entry.path;
  }
  updateSelectionClasses();
  updateSelectionUi();
}

function onRowDblClick(entry) {
  if (entry.isDir) listFiles(entry.path);
  else if (isPreviewable(entry.name || "")) openPreview(entry);
  else downloadPaths([entry.path]);
}

function updateSelectionClasses() {
  els.fileList.querySelectorAll(".file-row[data-path]").forEach((row) => {
    if (row.dataset.parent === "1") return;
    row.classList.toggle("selected", selected.has(row.dataset.path));
  });
}

window.addEventListener("pagehide", () => {
  for (const ent of thumbCache.values()) {
    if (ent?.blobUrl) URL.revokeObjectURL(ent.blobUrl);
  }
  thumbCache.clear();
}, { once: true });

function updateSelectionUi() {
  const n = directoryEntries.length;
  els.countField.textContent = `${n} object(s)`;
  els.selField.textContent = selected.size ? `${selected.size} selected` : "";
  els.deleteBtn.disabled = selected.size === 0 || !ws || ws.readyState !== WebSocket.OPEN;
  els.downloadBtn.disabled = selected.size === 0 || !ws || ws.readyState !== WebSocket.OPEN;
}

function selectedEntries() {
  return directoryEntries.filter((e) => selected.has(e.path));
}

function showFileMenu(x, y) {
  hideMenus();
  const menu = els.fileMenu;
  const entries = selectedEntries();
  const previewItem = menu.querySelector('[data-action="preview"]');
  if (previewItem) {
    const canPreview = entries.length === 1 && !entries[0].isDir && isPreviewable(entries[0].name || "");
    previewItem.style.display = canPreview ? "" : "none";
  }
  menu.hidden = false;
  menu.style.left = `${Math.min(x, window.innerWidth - 160)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 200)}px`;
}

function showBgMenu(x, y) {
  hideMenus();
  const menu = els.bgMenu;
  menu.hidden = false;
  menu.style.left = `${Math.min(x, window.innerWidth - 160)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 160)}px`;
}

async function requestDelete(paths) {
  if (!paths.length) return;
  const names = paths.map((p) => p.split(/[/\\]/).pop());
  const msg =
    paths.length === 1
      ? `Are you sure you want to send '${names[0]}' to the Recycle Bin?\n\n(Remote delete is permanent on the target.)`
      : `Are you sure you want to delete these ${paths.length} items?\n\n(Remote delete is permanent on the target.)`;
  const ok = await showConfirm(msg);
  if (!ok) return;

  setStatus(paths.length === 1 ? `Deleting ${names[0]}…` : `Deleting ${paths.length} items…`);
  let okCount = 0;
  let failCount = 0;

  for (const path of paths) {
    const commandId = `delete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pendingDeletes.set(path, commandId);
    const row = Array.from(els.fileList.querySelectorAll(".file-row")).find((r) => r.dataset.path === path);
    if (row) row.classList.add("pending-delete");
    send({ type: "file_delete", path, commandId });
    try {
      await waitCommand(commandId);
      okCount += 1;
      pendingDeletes.delete(path);
      selected.delete(path);
    } catch (err) {
      failCount += 1;
      pendingDeletes.delete(path);
      if (row) row.classList.remove("pending-delete");
      showError(`Delete failed: ${path}\n${err.message || err}`);
    }
  }

  if (okCount) playSound("delete");
  if (failCount === 0) {
    setStatus(okCount === 1 ? "Deleted successfully" : `Deleted ${okCount} item(s)`);
  } else {
    setStatus(`Deleted ${okCount}, failed ${failCount}`);
  }
  listFiles(currentPath, { skipHistory: true });
}

function handleCommandResult(msg) {
  const tracked = msg.commandId ? pendingCommands.get(msg.commandId) : null;
  if (!tracked) return;
  if (tracked.timeoutId) clearTimeout(tracked.timeoutId);
  pendingCommands.delete(msg.commandId);

  if (tracked.resolve) {
    if (msg.ok) tracked.resolve(msg);
    else tracked.reject(new Error(msg.message || "operation failed"));
    return;
  }

  if (!msg.ok) {
    showError(`${tracked.errorPrefix || "Failed"}: ${msg.message || "unknown error"}`);
    setStatus(tracked.errorPrefix || "Failed");
  } else {
    setStatus(tracked.successMessage || "Done");
    if (tracked.refreshOnSuccess) listFiles(currentPath, { skipHistory: true });
  }
}

async function mkdir() {
  const name = await showPrompt("New Folder", "Name of new folder:", "New Folder");
  if (!name || !name.trim()) return;
  const commandId = `mkdir-${Date.now()}`;
  const path = joinPath(currentPath, name.trim());
  send({ type: "file_mkdir", path, commandId });
  try {
    await waitCommand(commandId);
    setStatus("Folder created");
    listFiles(currentPath, { skipHistory: true });
  } catch (err) {
    showError(`New folder failed: ${err.message || err}`);
  }
}

async function renameSelected() {
  const entries = selectedEntries();
  if (entries.length !== 1) return;
  const entry = entries[0];
  const name = await showPrompt("Rename", "New name:", entry.name);
  if (!name || !name.trim() || name.trim() === entry.name) return;
  const dest = joinPath(currentPath, name.trim());
  const commandId = `move-${Date.now()}`;
  send({
    type: "command",
    commandType: "file_move",
    id: commandId,
    payload: { source: entry.path, dest },
  });
  try {
    await waitCommand(commandId);
    setStatus("Renamed");
    listFiles(currentPath, { skipHistory: true });
  } catch (err) {
    showError(`Rename failed: ${err.message || err}`);
  }
}

async function copyOrMove(kind) {
  const entries = selectedEntries();
  if (!entries.length) return;
  const label = kind === "copy" ? "Copy to path:" : "Move to path:";
  const destBase = await showPrompt(kind === "copy" ? "Copy" : "Move", label, currentPath);
  if (!destBase) return;
  for (const entry of entries) {
    const dest = joinPath(destBase, entry.name);
    const commandId = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    send({
      type: "command",
      commandType: kind === "copy" ? "file_copy" : "file_move",
      id: commandId,
      payload: { source: entry.path, dest },
    });
    try {
      await waitCommand(commandId);
    } catch (err) {
      showError(`${kind} failed: ${entry.name}\n${err.message || err}`);
      return;
    }
  }
  setStatus(kind === "copy" ? "Copy completed" : "Move completed");
  listFiles(currentPath, { skipHistory: true });
}

function showXfer(label, pct) {
  els.xferBar.classList.add("show");
  els.xferLabel.textContent = label;
  els.xferBarFill.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`;
}

function hideXfer() {
  els.xferBar.classList.remove("show");
  els.xferBarFill.style.width = "0%";
}

async function downloadPaths(paths) {
  const files = paths
    .map((p) => directoryEntries.find((e) => e.path === p))
    .filter((e) => e && !e.isDir);
  if (!files.length) {
    showError("Select one or more files to download (folders not supported in classic yet).");
    return;
  }
  for (const file of files) {
    setStatus(`Downloading ${file.name}…`);
    showXfer(`Downloading ${file.name}`, 0);
    try {
      const requestRes = await fetch("/api/file/download/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ clientId, path: file.path }),
      });
      if (!requestRes.ok) throw new Error(await requestRes.text() || "request failed");
      const data = await requestRes.json();
      const downloadUrl =
        typeof data?.downloadUrl === "string"
          ? data.downloadUrl
          : data?.downloadId
            ? `/api/file/download/${encodeURIComponent(data.downloadId)}`
            : "";
      if (!downloadUrl) throw new Error("no download url");
      const res = await fetch(downloadUrl, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text() || "download failed");
      const total = Number(res.headers.get("Content-Length") || 0);
      const reader = res.body?.getReader();
      const chunks = [];
      let received = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          if (total > 0) showXfer(`Downloading ${file.name}`, Math.round((received / total) * 100));
        }
      } else {
        const buf = new Uint8Array(await res.arrayBuffer());
        chunks.push(buf);
      }
      const blob = new Blob(chunks);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      setStatus(`Downloaded ${file.name}`);
    } catch (err) {
      showError(`Download failed: ${file.name}\n${err.message || err}`);
    }
  }
  hideXfer();
}

async function uploadFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  for (const file of files) {
    const path = joinPath(currentPath, file.name);
    setStatus(`Uploading ${file.name}…`);
    showXfer(`Uploading ${file.name}`, 0);
    try {
      const requestRes = await fetch("/api/file/upload/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          clientId,
          path,
          fileName: file.name,
        }),
      });
      if (!requestRes.ok) throw new Error((await requestRes.text()) || "upload request failed");
      const data = await requestRes.json();
      const uploadUrl =
        typeof data?.uploadUrl === "string"
          ? data.uploadUrl
          : data?.uploadId
            ? `/api/file/upload/${encodeURIComponent(data.uploadId)}`
            : "";
      if (!uploadUrl) throw new Error("no upload url");

      const staged = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", uploadUrl, true);
        xhr.withCredentials = true;
        xhr.responseType = "text";
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            showXfer(`Uploading ${file.name}`, Math.round((ev.loaded / ev.total) * 50));
          }
        };
        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
            return;
          }
          try {
            resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {});
          } catch {
            reject(new Error("bad staging response"));
          }
        };
        xhr.onerror = () => reject(new Error("network error"));
        xhr.send(file);
      });

      if (!staged?.pullUrl && !(staged?.agentNotified && staged?.agentCommandId)) {
        throw new Error("upload staging failed");
      }

      let commandId;
      if (staged.agentNotified && typeof staged.agentCommandId === "string") {
        commandId = staged.agentCommandId;
      } else {
        commandId = `upload-http-${Date.now()}`;
        send({
          type: "command",
          commandType: "file_upload_http",
          id: commandId,
          payload: {
            path,
            url: staged.pullUrl,
            total: file.size,
          },
        });
      }
      showXfer(`Saving ${file.name} on remote…`, 75);
      await waitCommand(commandId);
      showXfer(`Uploaded ${file.name}`, 100);
      playSound("upload");
      setStatus(`Uploaded ${file.name}`);
    } catch (err) {
      showError(`Upload failed: ${file.name}\n${err.message || err}`);
    }
  }
  hideXfer();
  listFiles(currentPath, { skipHistory: true });
}

function openModern() {
  try {
    localStorage.setItem(SKIN_KEY, "modern");
  } catch {}
  window.open(`/${clientId}/files`, "_blank", "noopener");
}

function selectAll() {
  selected.clear();
  for (const e of directoryEntries) selected.add(e.path);
  if (directoryEntries[0]) selectionAnchor = directoryEntries[0].path;
  updateSelectionClasses();
  updateSelectionUi();
}

function bindUi() {
  els.backBtn.onclick = goBack;
  els.forwardBtn.onclick = goForward;
  els.upBtn.onclick = goUp;
  els.refreshBtn.onclick = () => listFiles(currentPath, { skipHistory: true });
  els.mkdirBtn.onclick = () => mkdir();
  els.deleteBtn.onclick = () => requestDelete([...selected]);
  els.uploadBtn.onclick = () => els.fileInput.click();
  els.downloadBtn.onclick = () => downloadPaths([...selected]);
  if (els.viewDetailsBtn) els.viewDetailsBtn.onclick = () => setViewMode("details");
  if (els.viewThumbsBtn) els.viewThumbsBtn.onclick = () => setViewMode("thumbs");
  els.modernBtn.onclick = openModern;
  els.fileInput.onchange = () => {
    uploadFiles(els.fileInput.files);
    els.fileInput.value = "";
  };
  els.goBtn.onclick = () => listFiles(els.pathInput.value.trim() || ".");
  els.pathInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      listFiles(els.pathInput.value.trim() || ".");
    }
  });

  els.detailsHeader.querySelectorAll("[data-sort]").forEach((el) => {
    el.addEventListener("click", () => {
      const field = el.dataset.sort;
      if (sortField === field) sortDir *= -1;
      else {
        sortField = field;
        sortDir = 1;
      }
      els.detailsHeader.querySelectorAll("[data-sort]").forEach((h) => h.classList.toggle("active", h.dataset.sort === sortField));
      renderList();
    });
  });

  els.fileList.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".file-row[data-path]:not([data-parent])")) return;
    e.preventDefault();
    showBgMenu(e.clientX, e.clientY);
  });

  els.fileMenu.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-action]");
    if (!li) return;
    const action = li.dataset.action;
    hideMenus();
    if (action === "open") {
      const entries = selectedEntries();
      if (entries[0]?.isDir) listFiles(entries[0].path);
      else if (entries[0] && isPreviewable(entries[0].name || "")) openPreview(entries[0]);
      else if (entries[0]) downloadPaths([entries[0].path]);
    } else if (action === "preview") {
      const entries = selectedEntries();
      if (entries[0]) openPreview(entries[0]);
    } else if (action === "download") downloadPaths([...selected]);
    else if (action === "rename") renameSelected();
    else if (action === "copy") copyOrMove("copy");
    else if (action === "move") copyOrMove("move");
    else if (action === "delete") requestDelete([...selected]);
    else if (action === "refresh") listFiles(currentPath, { skipHistory: true });
  });

  els.bgMenu.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-action]");
    if (!li) return;
    const action = li.dataset.action;
    hideMenus();
    if (action === "newfolder") mkdir();
    else if (action === "upload") els.fileInput.click();
    else if (action === "view-details") setViewMode("details");
    else if (action === "view-thumbs") setViewMode("thumbs");
    else if (action === "refresh") listFiles(currentPath, { skipHistory: true });
    else if (action === "selectall") selectAll();
  });

  els.viewMenu.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-action]");
    if (!li) return;
    hideMenus();
    if (li.dataset.action === "view-details") setViewMode("details");
    else if (li.dataset.action === "view-thumbs") setViewMode("thumbs");
    else if (li.dataset.action === "modern") openModern();
    else if (li.dataset.action === "refresh") listFiles(currentPath, { skipHistory: true });
  });

  els.menuBar.addEventListener("click", (e) => {
    const span = e.target.closest("span[data-menu]");
    if (!span) return;
    e.stopPropagation();
    const kind = span.dataset.menu;
    hideMenus();
    span.classList.add("open");
    const rect = span.getBoundingClientRect();
    if (kind === "view" || kind === "file" || kind === "edit" || kind === "help") {
      const menu = kind === "view" ? els.viewMenu : els.bgMenu;
      if (kind === "file") {
        els.bgMenu.hidden = false;
        els.bgMenu.style.left = `${rect.left}px`;
        els.bgMenu.style.top = `${rect.bottom}px`;
      } else if (kind === "edit") {
        els.fileMenu.hidden = false;
        els.fileMenu.style.left = `${rect.left}px`;
        els.fileMenu.style.top = `${rect.bottom}px`;
      } else if (kind === "view") {
        els.viewMenu.hidden = false;
        els.viewMenu.style.left = `${rect.left}px`;
        els.viewMenu.style.top = `${rect.bottom}px`;
      } else {
        showError(`Overlord Classic Explorer ${VERSION}\nClient: ${clientId}`);
        span.classList.remove("open");
      }
    }
  });

  document.addEventListener("click", () => hideMenus());
  document.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      selectAll();
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      requestDelete([...selected]);
      return;
    }
    if (e.key === "F5") {
      e.preventDefault();
      listFiles(currentPath, { skipHistory: true });
      return;
    }
    if (e.key === "F2") {
      e.preventDefault();
      renameSelected();
      return;
    }
    if (e.key === "Backspace" && !e.ctrlKey) {
      e.preventDefault();
      goUp();
      return;
    }
    if (e.key === " " || e.code === "Space") {
      const entries = selectedEntries();
      if (entries[0] && !entries[0].isDir && isPreviewable(entries[0].name || "")) {
        e.preventDefault();
        openPreview(entries[0]);
        return;
      }
    }
    if (e.key === "Escape") {
      hideMenus();
      hideError();
      hideQuickLook();
      if (els.previewModal && !els.previewModal.hidden) {
        closePreview();
        return;
      }
      els.confirmModal.hidden = true;
      els.promptModal.hidden = true;
    }
  });

  // When large hover thumbs arrive, refresh popover
  const _applyThumb = applyThumbToDom;
  // already handled inside applyThumbToDom via hoverEntry

  els.errorOk.onclick = hideError;
  els.errorClose.onclick = hideError;
  els.winClose.onclick = () => window.close();
  els.winMin.onclick = () => window.blur();
  els.winMax.onclick = () => {
    /* popup chrome handles maximize; no-op in browser */
  };

  if (els.previewClose) els.previewClose.onclick = closePreview;
  if (els.previewOk) els.previewOk.onclick = closePreview;
  if (els.previewDownload) {
    els.previewDownload.onclick = () => {
      if (previewPath) downloadPaths([previewPath]);
    };
  }
  if (els.previewModal) {
    els.previewModal.addEventListener("click", (e) => {
      if (e.target === els.previewModal) closePreview();
    });
  }

  // Marquee selection
  els.fileList.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".file-row[data-path]:not([data-parent])")) return;
    const rect = els.fileList.getBoundingClientRect();
    marqueeState = {
      startX: e.clientX,
      startY: e.clientY,
      rect,
      additive: e.ctrlKey || e.metaKey,
      moved: false,
    };
    if (!marqueeState.additive) {
      selected.clear();
      updateSelectionClasses();
      updateSelectionUi();
    }
  });
  window.addEventListener("mousemove", (e) => {
    if (!marqueeState) return;
    const dx = Math.abs(e.clientX - marqueeState.startX);
    const dy = Math.abs(e.clientY - marqueeState.startY);
    if (dx < 3 && dy < 3) return;
    marqueeState.moved = true;
    const { startX, startY, rect } = marqueeState;
    const x1 = Math.min(startX, e.clientX);
    const y1 = Math.min(startY, e.clientY);
    const x2 = Math.max(startX, e.clientX);
    const y2 = Math.max(startY, e.clientY);
    els.marquee.hidden = false;
    els.marquee.style.left = `${x1 - rect.left + els.fileList.scrollLeft}px`;
    els.marquee.style.top = `${y1 - rect.top + els.fileList.scrollTop}px`;
    els.marquee.style.width = `${x2 - x1}px`;
    els.marquee.style.height = `${y2 - y1}px`;
    const selBox = { left: x1, top: y1, right: x2, bottom: y2 };
    els.fileList.querySelectorAll(".file-row[data-path]:not([data-parent])").forEach((row) => {
      const r = row.getBoundingClientRect();
      const hit = !(r.right < selBox.left || r.left > selBox.right || r.bottom < selBox.top || r.top > selBox.bottom);
      if (hit) selected.add(row.dataset.path);
      else if (!marqueeState.additive) selected.delete(row.dataset.path);
    });
    updateSelectionClasses();
    updateSelectionUi();
  });
  window.addEventListener("mouseup", () => {
    if (!marqueeState) return;
    els.marquee.hidden = true;
    els.marquee.style.width = "0px";
    els.marquee.style.height = "0px";
    marqueeState = null;
  });

  // Drag-drop upload
  els.listPane.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragDepth += 1;
    els.listPane.classList.add("dragging");
  });
  els.listPane.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) els.listPane.classList.remove("dragging");
  });
  els.listPane.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  els.listPane.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    els.listPane.classList.remove("dragging");
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
  });
}

async function main() {
  if (!clientId) {
    showError("Missing client id in URL");
    return;
  }
  document.title = `Classic Explorer — ${clientId.slice(0, 12)}`;
  els.titleLabel.textContent = `Exploring — ${clientId.slice(0, 12)}…`;
  updatePlaces();
  updateDrives([]);
  bindUi();
  setViewMode(viewMode);
  await loadSounds();

  const allowed = await checkFeatureAccess("file_browser");
  if (!allowed) {
    showError("File Browser access denied");
    setStatus("Access denied");
    return;
  }
  connect();
}

main();
