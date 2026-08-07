/** File Manager 2.0 — compact D2 panel (PM2 Twin). Classic protocol + sounds. */
import { encodeMsgpack, decodeMsgpack } from "./msgpack-helpers.js";
import { checkFeatureAccess } from "./feature-gate.js";
import {
  escapeHtml,
  formatBytes,
  getFileExt,
  getParentPath,
  shouldShowParentDirectory,
} from "./filebrowser-utils.js";

export const FILES2_JS_VERSION = "1.2.1";

const WS_UPLOAD_MAX_TOTAL = 8 * 1024 * 1024;
const WS_UPLOAD_CHUNK_SIZE = 512 * 1024;
const WS_UPLOAD_CONCURRENCY = 4;
const WS_UPLOAD_ACK_TIMEOUT_MS = 90 * 1000;
const HTTP_AGENT_PULL_TIMEOUT_MS = 90 * 1000;
const DELETE_STEP_TIMEOUT_MS = 120_000;
const DELETE_RESULT_TTL_MS = 20_000;
const DEL_BAR_AUTOHIDE_MS = 20_000;
const DEL_BAR_BLOCK_CAP = 200;

const SOUND_ASSET = "/assets/filebrowser-classic";
const parts = window.location.pathname.split("/").filter(Boolean);
const clientId = parts[0] || "";

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "ico", "heic", "tif", "tiff"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "flac", "ogg", "aac", "m4a", "wma"]);
const VIDEO_EXTS = new Set(["mp4", "avi", "mkv", "mov", "wmv", "webm", "m4v"]);
const ARCHIVE_EXTS = new Set(["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz"]);
const TEXT_EXTS = new Set([
  "txt", "md", "log", "json", "xml", "csv", "ini", "cfg", "yml", "yaml",
  "js", "ts", "css", "html", "htm", "py", "go", "rs", "c", "cpp", "h", "java",
  "sh", "bat", "ps1", "sql",
]);

const els = {
  status: document.getElementById("fm2-status"),
  back: document.getElementById("fm2-back"),
  forward: document.getElementById("fm2-forward"),
  up: document.getElementById("fm2-up"),
  path: document.getElementById("fm2-path"),
  mkdir: document.getElementById("fm2-mkdir"),
  upload: document.getElementById("fm2-upload"),
  download: document.getElementById("fm2-download"),
  delete: document.getElementById("fm2-delete"),
  refresh: document.getElementById("fm2-refresh"),
  selectAll: document.getElementById("fm2-selectall"),
  filter: document.getElementById("fm2-filter"),
  places: document.getElementById("fm2-places"),
  list: document.getElementById("fm2-list"),
  count: document.getElementById("fm2-count"),
  sel: document.getElementById("fm2-sel"),
  msg: document.getElementById("fm2-msg"),
  pathStatus: document.getElementById("fm2-path-status"),
  xfer: document.getElementById("fm2-xfer"),
  xferLabel: document.getElementById("fm2-xfer-label"),
  xferFill: document.getElementById("fm2-xfer-fill"),
  delbar: document.getElementById("fm2-delbar"),
  kbBlocks: document.getElementById("fm2-kb-blocks"),
  kbPac: document.getElementById("fm2-kb-pac"),
  kbText: document.getElementById("fm2-kb-text"),
  kbClose: document.getElementById("fm2-kb-close"),
  summary: document.getElementById("fm2-summary"),
  toast: document.getElementById("fm2-toast"),
  fileInput: document.getElementById("fm2-file-input"),
  ver: document.getElementById("fm2-ver"),
};

if (els.ver) els.ver.textContent = `v${FILES2_JS_VERSION}`;

let ws = null;
let currentPath = ".";
let pathHistory = [];
let pathForward = [];
let directoryEntries = [];
let selected = new Set();
let selectionAnchor = null;
let sortField = "name";
let sortDir = 1;
let filterText = "";
let detectedOS = "";
let detectedHomePath = "";
let lastDriveEntries = [];
let homeBaseOverride = null;
let pendingPlaceFallback = null;
let expectingFallbackPath = null;
let pendingCommands = new Map();
/** @type {Map<string, { resolve: Function, reject: Function, timeoutId: any, transferId?: string }>} */
let pendingUploadAcks = new Map();
let soundsEnabled = true;
let soundManifest = null;
const audioCache = {};
let toastTimer = null;

let deleteBatchActive = false;
let deleteAbort = false;
/** @type {{ path: string, commandId: string } | null} */
let deleteInFlight = null;
/** @type {Map<string, { state: string, category: string, text: string, expiresAt: number, name: string }>} */
const deleteResults = new Map();
/** @type {{ deleted: number, inuse: number, denied: number, notfound: number, failed: number, timeout: number, offline: number } | null} */
let deleteBatchStats = null;
/** @type {string[]} */
let skippedPaths = [];
/** @type {{ selectPaths: string[], summaryHtml: string, msg: string, toast: string, playOk: boolean, playErr: boolean } | null} */
let pendingPostList = null;
let summaryTimer = null;
const delBar = {
  active: false,
  total: 0,
  done: 0,
  ok: 0,
  fail: 0,
  continuous: false,
  /** @type {Map<string, HTMLElement>} */
  blocks: new Map(),
  /** @type {string[]} */
  pathOrder: [],
  currentPath: null,
  hideTimer: null,
  contEl: null,
};

function joinPath(dir, name) {
  if (!dir || dir === ".") return name;
  if (/^[A-Za-z]:\\?$/.test(dir)) {
    const root = dir.endsWith("\\") ? dir : `${dir}\\`;
    return root + name;
  }
  if (dir.includes("\\")) return dir.replace(/\\+$/, "") + "\\" + name;
  if (dir === "/") return `/${name}`;
  return dir.replace(/\/+$/, "") + "/" + name;
}

function setStatusUi(kind, title) {
  if (!els.status) return;
  els.status.className = `fm2-status is-${kind}`;
  els.status.title = title || kind;
  const icon =
    kind === "connecting"
      ? "fa-circle-notch fa-spin"
      : kind === "ok"
        ? "fa-circle"
        : kind === "err"
          ? "fa-triangle-exclamation"
          : "fa-circle";
  els.status.innerHTML = `<i class="fa-solid ${icon}"></i>`;
}

function wsOpen() {
  return !!(ws && ws.readyState === WebSocket.OPEN);
}

function setConnectedUi(ok) {
  if (deleteBatchActive) {
    setBatchUiLocked(true);
    return;
  }
  [els.mkdir, els.upload, els.download, els.delete, els.refresh, els.selectAll].forEach((b) => {
    if (b) b.disabled = !ok;
  });
  updateNavButtons();
  updateSelectionUi();
}

function setBatchUiLocked(on) {
  document.body.classList.toggle("fm2-batch-lock", on);
  const disableNav = on || !wsOpen();
  if (els.back) els.back.disabled = disableNav || pathHistory.length === 0;
  if (els.forward) els.forward.disabled = disableNav || pathForward.length === 0;
  if (els.up) els.up.disabled = disableNav || !shouldShowParentDirectory(currentPath);
  [els.mkdir, els.upload, els.download, els.delete, els.refresh, els.selectAll].forEach((b) => {
    if (b) b.disabled = true;
  });
  if (!on) {
    const ok = wsOpen();
    [els.mkdir, els.upload, els.refresh, els.selectAll].forEach((b) => {
      if (b) b.disabled = !ok;
    });
    updateNavButtons();
    updateSelectionUi();
  }
}

function setMsg(text) {
  if (els.msg) els.msg.textContent = text || "";
}

function showToast(message, isErr = false, durationMs = 3200) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.toggle("is-err", !!isErr);
  els.toast.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("is-on"), durationMs);
}

async function loadSounds() {
  try {
    const res = await fetch(`${SOUND_ASSET}/sounds/manifest.json`);
    if (!res.ok) return;
    soundManifest = await res.json();
  } catch {
    /* ignore */
  }
}

function playSound(action) {
  if (!soundsEnabled || !soundManifest?.actions?.[action]?.length) return;
  const def = soundManifest.defaults?.[action] ?? 0;
  const opt = soundManifest.actions[action][def];
  if (!opt?.file) return;
  const url = opt.file.startsWith("/") ? opt.file : `${SOUND_ASSET}/${opt.file}`;
  try {
    if (!audioCache[url]) audioCache[url] = new Audio(url);
    const a = audioCache[url];
    a.currentTime = 0;
    a.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(encodeMsgpack(msg));
}

function waitCommand(commandId, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const existing = pendingCommands.get(commandId) || {};
    const timeoutId = setTimeout(() => {
      pendingCommands.delete(commandId);
      reject(new Error("timed out"));
    }, timeoutMs);
    pendingCommands.set(commandId, { ...existing, resolve, reject, timeoutId });
  });
}

function handleCommandResult(msg) {
  const tracked = msg.commandId ? pendingCommands.get(msg.commandId) : null;
  if (!tracked) return;
  if (tracked.timeoutId) clearTimeout(tracked.timeoutId);
  pendingCommands.delete(msg.commandId);
  if (tracked.resolve) {
    if (msg.ok) tracked.resolve(msg);
    else tracked.reject(new Error(msg.message || "operation failed"));
  }
}

function handleCommandError(msg) {
  const error = msg?.error || msg?.message || "command error";
  // Server rejects often omit commandId; fail in-flight delete or HTTP upload waiters.
  if (deleteInFlight) {
    rejectInFlightDelete(error);
    return;
  }
  for (const [id, tracked] of [...pendingCommands.entries()]) {
    if (!String(id).startsWith("upload-http-") && !String(id).startsWith("delete-")) continue;
    if (tracked.timeoutId) clearTimeout(tracked.timeoutId);
    pendingCommands.delete(id);
    try {
      tracked.reject?.(new Error(error));
    } catch {}
  }
}

function rejectInFlightDelete(message) {
  if (!deleteInFlight) return;
  const tracked = pendingCommands.get(deleteInFlight.commandId);
  if (!tracked) return;
  if (tracked.timeoutId) clearTimeout(tracked.timeoutId);
  pendingCommands.delete(deleteInFlight.commandId);
  try {
    tracked.reject?.(new Error(message || "operation failed"));
  } catch {}
}

function abortDeleteBatch(category, text) {
  if (!deleteBatchActive) return;
  deleteAbort = true;
  rejectInFlightDelete(text || category || "aborted");
}

function handleFileUploadResult(msg) {
  const key = msg.transferId
    ? `id:${msg.transferId}:${msg.offset ?? 0}`
    : msg.path
      ? `path:${msg.path}:${msg.offset ?? 0}`
      : "";
  const tracked = key ? pendingUploadAcks.get(key) : null;
  if (!tracked) return;
  if (tracked.timeoutId) clearTimeout(tracked.timeoutId);
  pendingUploadAcks.delete(key);
  if (msg.ok) tracked.resolve?.(msg);
  else tracked.reject?.(new Error(msg.error || "upload chunk failed"));
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/api/clients/${clientId}/files/ws`);
  socket.binaryType = "arraybuffer";
  ws = socket;
  setStatusUi("connecting", "Connecting…");
  setConnectedUi(false);
  setMsg("Connecting…");

  socket.onopen = () => {
    setStatusUi("ok", "Connected");
    setConnectedUi(true);
    setMsg("Connected");
    listFiles(currentPath || ".", { resetHistory: true });
  };
  socket.onmessage = (ev) => {
    const msg = decodeMsgpack(ev.data);
    if (msg) handleMessage(msg);
  };
  socket.onerror = () => {
    setStatusUi("err", "Connection error");
    setMsg("Connection error");
  };
  socket.onclose = () => {
    setStatusUi("off", "Disconnected");
    setConnectedUi(false);
    setMsg("Disconnected — retrying…");
    if (deleteBatchActive) abortDeleteBatch("offline", "Disconnected");
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
        setStatusUi("off", "Client offline");
        setConnectedUi(false);
        setMsg("Client offline");
        if (deleteBatchActive) abortDeleteBatch("offline", "Client offline");
      }
      break;
    case "file_list_result":
      handleFileList(msg);
      break;
    case "command_result":
      handleCommandResult(msg);
      break;
    case "command_error":
      handleCommandError(msg);
      break;
    case "file_upload_result":
      handleFileUploadResult(msg);
      break;
    default:
      break;
  }
}

function listFiles(path, options = {}) {
  const { resetHistory = false, skipHistory = false, fromForward = false } = options;
  if (deleteBatchActive && !pendingPostList) return;
  if (resetHistory) {
    pathHistory = [];
    pathForward = [];
  } else if (!skipHistory && currentPath && currentPath !== path) {
    pathHistory.push(currentPath);
    if (!fromForward) pathForward = [];
  }
  currentPath = path || ".";
  if (!pendingPostList) {
    selected.clear();
    selectionAnchor = null;
  }
  send({ type: "file_list", path: currentPath });
  if (els.path) els.path.value = currentPath;
  if (els.pathStatus) els.pathStatus.textContent = currentPath;
  updateNavButtons();
  if (!pendingPostList) setMsg(`Opening ${currentPath}…`);
}

function updateNavButtons() {
  const locked = deleteBatchActive;
  if (els.back) els.back.disabled = locked || pathHistory.length === 0;
  if (els.forward) els.forward.disabled = locked || pathForward.length === 0;
  if (els.up) els.up.disabled = locked || !shouldShowParentDirectory(currentPath);
}

function goBack() {
  if (deleteBatchActive || !pathHistory.length) return;
  const prev = pathHistory.pop();
  pathForward.push(currentPath);
  listFiles(prev, { skipHistory: true });
}

function goForward() {
  if (deleteBatchActive || !pathForward.length) return;
  const next = pathForward.pop();
  listFiles(next, { fromForward: true });
}

function goUp() {
  if (deleteBatchActive || !shouldShowParentDirectory(currentPath)) return;
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

function isPathNotFoundError(msg) {
  if (!msg || !msg.error) return false;
  if (msg.accessDenied) return false;
  return /cannot find|no such file|not exist|does not exist|cannot access the path/i.test(String(msg.error));
}

function pathsLooselyEqual(a, b) {
  const norm = (p) => String(p || "").replace(/[\\/]+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

function openPlace(path, fallbackPath = null) {
  if (deleteBatchActive) return;
  pendingPlaceFallback =
    fallbackPath && !pathsLooselyEqual(path, fallbackPath)
      ? { tried: path, fallback: fallbackPath }
      : null;
  expectingFallbackPath = null;
  listFiles(path);
}

function placeActive(path) {
  if (!path) return false;
  return (
    currentPath === path ||
    currentPath.startsWith(path + "/") ||
    currentPath.startsWith(path + "\\")
  );
}

function placeBtn(label, path, icon, fallbackPath = null) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fm2-place" + (placeActive(path) ? " is-on" : "");
  btn.dataset.path = path;
  btn.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escapeHtml(label)}</span>`;
  btn.onclick = () => openPlace(path, fallbackPath);
  return btn;
}

function updatePlaces() {
  if (!els.places) return;
  const root = els.places;
  root.innerHTML = "";
  const label = (t) => {
    const d = document.createElement("div");
    d.className = "fm2-plabel";
    d.textContent = t;
    return d;
  };

  root.appendChild(label("Places"));
  if (detectedOS === "windows" && detectedHomePath) {
    const home = detectedHomePath;
    const base = homeBaseOverride ? `${home}${homeBaseOverride}` : home;
    const icons = {
      Desktop: "fa-desktop",
      Downloads: "fa-download",
      Documents: "fa-file-lines",
      Pictures: "fa-image",
      Music: "fa-music",
      Videos: "fa-film",
    };
    for (const name of ["Desktop", "Downloads", "Documents", "Pictures", "Music", "Videos"]) {
      const fallback = homeBaseOverride ? null : `${home}\\OneDrive\\${name}`;
      root.appendChild(placeBtn(name, `${base}\\${name}`, icons[name], fallback));
    }
    root.appendChild(placeBtn("AppData", `${home}\\AppData`, "fa-folder"));
    root.appendChild(placeBtn("Program Files", "C:\\Program Files", "fa-folder"));
    root.appendChild(placeBtn("Windows", "C:\\Windows", "fa-folder"));
  } else if (detectedOS === "linux" || detectedOS === "mac") {
    if (detectedHomePath) {
      root.appendChild(placeBtn("Home", detectedHomePath, "fa-house"));
      root.appendChild(placeBtn("Desktop", `${detectedHomePath}/Desktop`, "fa-desktop"));
      root.appendChild(placeBtn("Downloads", `${detectedHomePath}/Downloads`, "fa-download"));
      root.appendChild(placeBtn("Documents", `${detectedHomePath}/Documents`, "fa-file-lines"));
    }
    for (const p of ["/etc", "/var", "/tmp", "/opt"]) {
      root.appendChild(placeBtn(p, p, "fa-folder"));
    }
  } else {
    const hint = document.createElement("div");
    hint.className = "fm2-plabel";
    hint.style.textTransform = "none";
    hint.style.letterSpacing = "0";
    hint.style.padding = "8px 10px";
    hint.textContent = "Navigate to detect places";
    root.appendChild(hint);
  }

  root.appendChild(label("Drives"));
  root.appendChild(
    placeBtn(
      detectedOS === "windows" ? "This PC" : "Root /",
      detectedOS === "windows" ? "." : "/",
      "fa-computer",
    ),
  );
  const drives = (lastDriveEntries || []).filter((e) => e.isDir && /^[A-Za-z]:$/.test(e.name || ""));
  for (const d of drives) {
    root.appendChild(placeBtn(`${d.name}\\`, `${d.name}\\`, "fa-hard-drive"));
  }
}

function updateDrives(entries) {
  lastDriveEntries = entries || [];
  updatePlaces();
}

function handleFileList(msg) {
  if (msg.error) {
    if (
      pendingPlaceFallback &&
      pathsLooselyEqual(msg.path, pendingPlaceFallback.tried) &&
      isPathNotFoundError(msg)
    ) {
      const fallback = pendingPlaceFallback.fallback;
      pendingPlaceFallback = null;
      expectingFallbackPath = fallback;
      setMsg(`Trying ${fallback}…`);
      listFiles(fallback, { skipHistory: true });
      return;
    }
    pendingPlaceFallback = null;
    expectingFallbackPath = null;
    const postErr = pendingPostList;
    pendingPostList = null;
    directoryEntries = [];
    renderList();
    playSound("error");
    showToast(msg.error, true);
    if (postErr) {
      setMsg(postErr.msg || `Error: ${msg.error}`);
      if (postErr.toast) showToast(postErr.toast, true, 6000);
    } else {
      setMsg(`Error: ${msg.error}`);
    }
    setStatusUi("err", msg.error);
    return;
  }
  if (expectingFallbackPath && pathsLooselyEqual(msg.path, expectingFallbackPath)) {
    homeBaseOverride = "\\OneDrive";
  }
  pendingPlaceFallback = null;
  expectingFallbackPath = null;
  setStatusUi("ok", "Connected");
  currentPath = msg.path || currentPath;
  if (els.path) els.path.value = currentPath;
  if (els.pathStatus) els.pathStatus.textContent = currentPath;
  detectOSAndHome(currentPath);
  directoryEntries = Array.isArray(msg.entries) ? msg.entries.slice() : [];
  if (currentPath === "." || currentPath === "/") updateDrives(directoryEntries);
  else updatePlaces();
  const post = pendingPostList;
  pendingPostList = null;
  selected.clear();
  selectionAnchor = null;
  if (post?.selectPaths?.length) {
    for (const p of post.selectPaths) {
      if (directoryEntries.some((e) => e.path === p)) selected.add(p);
    }
    if (selected.size) selectionAnchor = [...selected][selected.size - 1];
  }
  renderList();
  if (post) {
    if (post.playOk) playSound("delete");
    if (post.playErr) playSound("error");
    setMsg(post.msg);
    if (post.toast) showToast(post.toast, post.playErr, 6000);
  } else {
    setMsg("");
  }
  updateNavButtons();
}

function iconClass(entry) {
  if (entry.isDir) return "fo fa-folder";
  const ext = getFileExt(entry.name || "");
  if (ext === "pdf") return "pdf fa-file-pdf";
  if (IMAGE_EXTS.has(ext)) return "img fa-file-image";
  if (VIDEO_EXTS.has(ext)) return "vid fa-file-video";
  if (AUDIO_EXTS.has(ext)) return "aud fa-file-audio";
  if (ARCHIVE_EXTS.has(ext)) return "zip fa-file-zipper";
  if (ext === "xls" || ext === "xlsx" || ext === "csv") return "xls fa-file-excel";
  if (ext === "doc" || ext === "docx") return "doc fa-file-word";
  if (ext === "exe" || ext === "msi" || ext === "dll") return "exe fa-gears";
  if (TEXT_EXTS.has(ext)) return "txt fa-file-lines";
  return "file fa-file";
}

function typeLabel(entry) {
  if (entry.isDir) return "File folder";
  const ext = getFileExt(entry.name || "");
  if (!ext) return "File";
  const map = {
    pdf: "PDF Document",
    zip: "Compressed folder",
    rar: "Compressed folder",
    "7z": "Compressed folder",
    exe: "Application",
    msi: "Application",
    png: "PNG Image",
    jpg: "JPEG Image",
    jpeg: "JPEG Image",
    gif: "GIF Image",
    webp: "WEBP Image",
    mp4: "MP4 Video",
    txt: "Text Document",
    docx: "Microsoft Word",
    doc: "Microsoft Word",
    xlsx: "Microsoft Excel",
    xls: "Microsoft Excel",
  };
  return map[ext] || `${ext.toUpperCase()} File`;
}

function formatModified(entry) {
  const raw = entry.modTime || entry.mtime || entry.modified || entry.modifiedAt;
  if (!raw) return "";
  const d = new Date(typeof raw === "number" ? (raw < 1e12 ? raw * 1000 : raw) : raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function sortedFilteredEntries() {
  let list = directoryEntries.slice();
  if (filterText) {
    const q = filterText.toLowerCase();
    list = list.filter((e) => String(e.name || "").toLowerCase().includes(q));
  }
  list.sort((a, b) => {
    if (!!a.isDir !== !!b.isDir) return a.isDir ? -1 : 1;
    let av;
    let bv;
    if (sortField === "size") {
      av = Number(a.size || 0);
      bv = Number(b.size || 0);
    } else if (sortField === "type") {
      av = typeLabel(a).toLowerCase();
      bv = typeLabel(b).toLowerCase();
    } else if (sortField === "mod") {
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

function deleteBadgeHtml(path) {
  const res = deleteResults.get(path);
  if (!res) return "";
  if (res.state === "done" && res.expiresAt && Date.now() > res.expiresAt) {
    deleteResults.delete(path);
    return "";
  }
  const cat = res.state === "pending" ? "pending" : res.category || "failed";
  const label =
    cat === "pending"
      ? "…"
      : cat === "deleted"
        ? "ok"
        : cat === "inuse"
          ? "in use"
          : cat === "denied"
            ? "denied"
            : cat === "notfound"
              ? "missing"
              : cat === "timeout"
                ? "timeout"
                : cat === "offline"
                  ? "offline"
                  : "fail";
  return `<span class="fm2-db fm2-db-${escapeHtml(cat)}" title="${escapeHtml(res.text || label)}">${escapeHtml(label)}</span>`;
}

function renderList() {
  if (!els.list) return;
  const list = sortedFilteredEntries();
  if (!list.length) {
    els.list.innerHTML = `<div class="fm2-placeholder">${
      directoryEntries.length ? "No matches" : "Empty folder"
    }</div>`;
  } else {
    const frag = document.createDocumentFragment();
    for (const entry of list) {
      const row = document.createElement("div");
      row.className = "fm2-row" + (selected.has(entry.path) ? " is-on" : "");
      row.dataset.path = entry.path;
      const badge = deleteBadgeHtml(entry.path);
      row.innerHTML = `
        <span><span class="fm2-name"><i class="fa-solid ${iconClass(entry)}"></i><span>${escapeHtml(entry.name || "")}</span>${badge}</span></span>
        <span class="fm2-muted fm2-num">${entry.isDir ? "—" : escapeHtml(formatBytes(Number(entry.size || 0)))}</span>
        <span class="fm2-muted">${escapeHtml(typeLabel(entry))}</span>
        <span class="fm2-muted">${escapeHtml(formatModified(entry))}</span>
      `;
      row.addEventListener("click", (e) => onRowClick(e, entry, list));
      row.addEventListener("dblclick", () => {
        if (deleteBatchActive) return;
        if (entry.isDir) listFiles(entry.path);
      });
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (deleteBatchActive) return;
        if (!selected.has(entry.path)) {
          selected.clear();
          selected.add(entry.path);
          selectionAnchor = entry.path;
          renderList();
        }
        showContextMenu(e.clientX, e.clientY, entry);
      });
      frag.appendChild(row);
    }
    els.list.innerHTML = "";
    els.list.appendChild(frag);
  }
  if (els.count) els.count.textContent = `${list.length} item${list.length === 1 ? "" : "s"}`;
  updateSelectionUi();
}

function onRowClick(e, entry, visible) {
  if (deleteBatchActive) return;
  const paths = visible.map((v) => v.path);
  if (e.shiftKey && selectionAnchor) {
    const a = paths.indexOf(selectionAnchor);
    const b = paths.indexOf(entry.path);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      if (!e.ctrlKey && !e.metaKey) selected.clear();
      for (let i = lo; i <= hi; i++) selected.add(paths[i]);
    }
  } else if (e.ctrlKey || e.metaKey) {
    if (selected.has(entry.path)) selected.delete(entry.path);
    else selected.add(entry.path);
    selectionAnchor = entry.path;
  } else {
    selected.clear();
    selected.add(entry.path);
    selectionAnchor = entry.path;
  }
  els.list.querySelectorAll(".fm2-row").forEach((row) => {
    row.classList.toggle("is-on", selected.has(row.dataset.path));
  });
  updateSelectionUi();
}

function updateSelectionUi() {
  const n = selected.size;
  if (els.sel) els.sel.textContent = `${n} selected`;
  const open = wsOpen() && !deleteBatchActive;
  const hasFile = [...selected].some((p) => {
    const e = directoryEntries.find((x) => x.path === p);
    return e && !e.isDir;
  });
  if (els.download) els.download.disabled = !hasFile || !open;
  if (els.delete) els.delete.disabled = n === 0 || !open;
  if (els.selectAll) els.selectAll.disabled = !open || sortedFilteredEntries().length === 0;
}

function selectAllVisible() {
  if (deleteBatchActive) return;
  selected.clear();
  const list = sortedFilteredEntries();
  for (const ent of list) selected.add(ent.path);
  selectionAnchor = list.length ? list[list.length - 1].path : null;
  renderList();
  setMsg(`Selected ${selected.size} item${selected.size === 1 ? "" : "s"}`);
}

function baseName(path) {
  return String(path || "").split(/[/\\]/).pop() || path;
}

function selectedEntries() {
  return directoryEntries.filter((e) => selected.has(e.path));
}

function showXfer(label, pct) {
  if (!els.xfer) return;
  els.xfer.classList.add("is-on");
  if (els.xferLabel) els.xferLabel.textContent = label;
  if (els.xferFill) els.xferFill.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`;
}

function hideXfer() {
  if (!els.xfer) return;
  els.xfer.classList.remove("is-on");
  if (els.xferFill) els.xferFill.style.width = "0%";
}

async function mkdir() {
  if (deleteBatchActive) return;
  const name = window.prompt("New folder name:", "New Folder");
  if (!name || !name.trim()) return;
  const commandId = `mkdir-${Date.now()}`;
  const path = joinPath(currentPath, name.trim());
  send({ type: "file_mkdir", path, commandId });
  try {
    await waitCommand(commandId);
    setMsg("Folder created");
    listFiles(currentPath, { skipHistory: true });
  } catch (err) {
    playSound("error");
    showToast(`New folder failed: ${err.message || err}`, true);
  }
}

/* ── batch delete progress bar (PM2 twin) ── */
function delBarReset() {
  delBar.total = 0;
  delBar.done = 0;
  delBar.ok = 0;
  delBar.fail = 0;
  delBar.continuous = false;
  delBar.currentPath = null;
  delBar.blocks.clear();
  delBar.pathOrder = [];
  delBar.contEl = null;
  if (els.kbBlocks) {
    els.kbBlocks.innerHTML = "";
    els.kbBlocks.classList.remove("is-cont");
  }
}

function delBarRender(currentName) {
  if (!delBar.active || !els.kbText) return;
  const parts = [`${delBar.done}/${delBar.total}`, `<span class="ok">✔ ${delBar.ok}</span>`];
  if (delBar.fail > 0) parts.push(`<span class="bad">⛔ ${delBar.fail}</span>`);
  if (currentName) parts.push(`deleting ${escapeHtml(currentName)}…`);
  els.kbText.innerHTML = parts.join(" · ");
  const pct = delBar.total ? (delBar.done / delBar.total) * 100 : 0;
  if (els.kbPac) {
    els.kbPac.style.left = pct <= 0 ? "0px" : pct >= 100 ? "calc(100% - 14px)" : `calc(${pct}% - 7px)`;
  }
  if (delBar.continuous && delBar.contEl) {
    delBar.contEl.style.width = `${pct}%`;
  }
}

function delBarBegin(paths) {
  if (!els.delbar || !els.kbBlocks) return;
  if (delBar.hideTimer) {
    clearTimeout(delBar.hideTimer);
    delBar.hideTimer = null;
  }
  delBarReset();
  delBar.active = true;
  delBar.total = paths.length;
  delBar.pathOrder = paths.slice();
  els.delbar.hidden = false;
  if (els.kbPac) els.kbPac.classList.remove("kb-pac-idle");
  if (paths.length > DEL_BAR_BLOCK_CAP) {
    delBar.continuous = true;
    els.kbBlocks.classList.add("is-cont");
    const fill = document.createElement("div");
    fill.className = "fm2-kb-cont";
    els.kbBlocks.appendChild(fill);
    delBar.contEl = fill;
  } else {
    for (const path of paths) {
      const block = document.createElement("div");
      block.className = "fm2-kb-b";
      block.title = baseName(path);
      els.kbBlocks.appendChild(block);
      delBar.blocks.set(path, block);
    }
  }
  delBarRender();
}

function delBarMarkCurrent(path) {
  if (!delBar.active) return;
  if (delBar.currentPath && delBar.blocks.has(delBar.currentPath)) {
    delBar.blocks.get(delBar.currentPath).classList.remove("kb-cur");
  }
  delBar.currentPath = path;
  const block = delBar.blocks.get(path);
  if (block) {
    block.classList.remove("kb-ok", "kb-fail");
    block.classList.add("kb-cur");
  }
  delBarRender(baseName(path));
}

function delBarResolve(path, ok) {
  if (!delBar.active) return;
  const block = delBar.blocks.get(path);
  if (block) {
    block.classList.remove("kb-cur");
    block.classList.add(ok ? "kb-ok" : "kb-fail");
  }
  delBar.done += 1;
  if (ok) delBar.ok += 1;
  else delBar.fail += 1;
  if (delBar.currentPath === path) delBar.currentPath = null;
  delBarRender();
}

function delBarFinish() {
  if (!delBar.active) return;
  if (els.kbPac) els.kbPac.classList.add("kb-pac-idle");
  delBarRender();
  delBar.hideTimer = setTimeout(delBarHide, DEL_BAR_AUTOHIDE_MS);
}

function delBarHide() {
  if (delBar.hideTimer) {
    clearTimeout(delBar.hideTimer);
    delBar.hideTimer = null;
  }
  delBar.active = false;
  if (els.delbar) els.delbar.hidden = true;
}

function showDeleteSummary(html) {
  if (!els.summary) return;
  els.summary.innerHTML = `<i class="fa-solid fa-trash"></i>&nbsp;${html}`;
  els.summary.hidden = false;
  if (summaryTimer) clearTimeout(summaryTimer);
  summaryTimer = setTimeout(() => {
    els.summary.hidden = true;
  }, 8000);
}

function classifyDeleteFailure(message) {
  const m = String(message || "");
  if (/being used by another process|sharing violation|locked|in use|EBUSY|resource busy/i.test(m)) {
    return { category: "inuse", text: "In use" };
  }
  if (/access is denied|access denied|permission|EACCES|EPERM|privilege/i.test(m)) {
    return { category: "denied", text: "Access denied" };
  }
  if (/not found|no such|cannot find|does not exist|ENOENT/i.test(m)) {
    return { category: "notfound", text: "Not found" };
  }
  if (/timed out|timeout|no response/i.test(m)) {
    return { category: "timeout", text: "Timed out" };
  }
  if (/offline|disconnect/i.test(m)) {
    return { category: "offline", text: "Offline" };
  }
  return { category: "failed", text: m || "Failed" };
}

function recordDeleteResult(path, ok, category, text) {
  const name = baseName(path);
  const cat = ok ? "deleted" : category || "failed";
  deleteResults.set(path, {
    state: "done",
    category: cat,
    text: text || (ok ? "Deleted" : "Failed"),
    name,
    expiresAt: Date.now() + DELETE_RESULT_TTL_MS,
  });
  if (deleteBatchStats && Object.prototype.hasOwnProperty.call(deleteBatchStats, cat)) {
    deleteBatchStats[cat] += 1;
  } else if (deleteBatchStats && !ok) {
    deleteBatchStats.failed += 1;
  }
  delBarResolve(path, ok);
}

function buildDeleteSummaryHtml(stats) {
  const parts = [];
  if (stats.deleted) parts.push(`<span class="ok">✔ deleted ${stats.deleted}</span>`);
  const skipped =
    (stats.inuse || 0) +
    (stats.denied || 0) +
    (stats.notfound || 0) +
    (stats.failed || 0) +
    (stats.timeout || 0) +
    (stats.offline || 0);
  if (skipped) parts.push(`<span class="bad">⛔ skipped ${skipped}</span>`);
  if (stats.inuse) parts.push(`<span class="bad">in use ${stats.inuse}</span>`);
  if (stats.denied) parts.push(`<span class="bad">denied ${stats.denied}</span>`);
  if (stats.notfound) parts.push(`<span class="warn">? not found ${stats.notfound}</span>`);
  if (stats.failed) parts.push(`<span class="bad">✖ failed ${stats.failed}</span>`);
  if (stats.timeout) parts.push(`<span class="warn">⏱ timeout ${stats.timeout}</span>`);
  if (stats.offline) parts.push(`<span class="bad">⚡ offline ${stats.offline}</span>`);
  return parts.join(" · ") || "No items processed";
}

function buildDeleteSummaryMsg(stats, skippedNames) {
  const skipped = skippedNames.length;
  let msg = `Deleted ${stats.deleted || 0}`;
  if (skipped) msg += `, skipped ${skipped}`;
  if (skippedNames.length) {
    const shown = skippedNames.slice(0, 12);
    const more = skippedNames.length - shown.length;
    msg += ` (${shown.join(", ")}${more > 0 ? ` +${more} more` : ""})`;
  }
  return msg;
}

function buildSkippedToast(skippedNames) {
  if (!skippedNames.length) return "";
  const shown = skippedNames.slice(0, 12);
  const more = skippedNames.length - shown.length;
  return `Skipped ${skippedNames.length}: ${shown.join(", ")}${more > 0 ? ` +${more} more` : ""}`;
}

let contextMenuEl = null;

function createContextMenu() {
  const menu = document.createElement("div");
  menu.id = "fm2-ctx";
  menu.className = "hidden";
  menu.innerHTML = `
    <button type="button" data-action="open" class="fm2-ctx-item"><i class="fa-solid fa-folder-open" style="color:#fbbf24"></i> Open</button>
    <button type="button" data-action="execute" class="fm2-ctx-item"><i class="fa-solid fa-play" style="color:#2ee66b"></i> Open on target</button>
    <div class="fm2-ctx-sep"></div>
    <button type="button" data-action="download" class="fm2-ctx-item"><i class="fa-solid fa-download" style="color:#38bdf8"></i> Download</button>
    <button type="button" data-action="copy-path" class="fm2-ctx-item"><i class="fa-solid fa-copy" style="color:#60a5fa"></i> Copy path</button>
    <div class="fm2-ctx-sep"></div>
    <button type="button" data-action="delete" class="fm2-ctx-item is-danger"><i class="fa-solid fa-trash" style="color:#f87171"></i> Delete</button>
    <div class="fm2-ctx-sep"></div>
    <button type="button" data-action="refresh" class="fm2-ctx-item"><i class="fa-solid fa-rotate" style="color:#94a3b8"></i> Refresh</button>
  `;
  document.body.appendChild(menu);
  return menu;
}

function showContextMenu(x, y, entry) {
  if (!contextMenuEl) contextMenuEl = createContextMenu();
  contextMenuEl.dataset.path = entry.path || "";
  contextMenuEl.dataset.isDir = entry.isDir ? "true" : "false";
  contextMenuEl.dataset.name = entry.name || baseName(entry.path);

  const openBtn = contextMenuEl.querySelector('[data-action="open"]');
  const execBtn = contextMenuEl.querySelector('[data-action="execute"]');
  const dlBtn = contextMenuEl.querySelector('[data-action="download"]');
  const delBtn = contextMenuEl.querySelector('[data-action="delete"]');
  const n = selected.size;
  const connected = wsOpen();

  if (openBtn) {
    openBtn.hidden = !entry.isDir;
    openBtn.disabled = !entry.isDir || !connected;
  }
  if (execBtn) {
    execBtn.hidden = !!entry.isDir;
    execBtn.disabled = !!entry.isDir || !connected;
    execBtn.innerHTML = `<i class="fa-solid fa-play" style="color:#2ee66b"></i> Open on target`;
  }
  if (dlBtn) {
    const hasFile = [...selected].some((p) => {
      const e = directoryEntries.find((x) => x.path === p);
      return e && !e.isDir;
    });
    dlBtn.disabled = !hasFile || !connected;
    dlBtn.innerHTML = `<i class="fa-solid fa-download" style="color:#38bdf8"></i> Download${hasFile && n > 1 ? ` (${n})` : ""}`;
  }
  if (delBtn) {
    delBtn.disabled = n === 0 || !connected;
    delBtn.innerHTML = `<i class="fa-solid fa-trash" style="color:#f87171"></i> Delete${n > 1 ? ` (${n})` : ""}`;
  }

  contextMenuEl.classList.remove("hidden");
  const rect = contextMenuEl.getBoundingClientRect();
  const menuW = rect.width || 168;
  const menuH = rect.height || 180;
  const posX = x + menuW > window.innerWidth ? window.innerWidth - menuW - 6 : x;
  const posY = y + menuH > window.innerHeight ? window.innerHeight - menuH - 6 : y;
  contextMenuEl.style.left = `${posX}px`;
  contextMenuEl.style.top = `${posY}px`;
}

function hideContextMenu() {
  if (contextMenuEl) contextMenuEl.classList.add("hidden");
}

async function executeFileOnTarget(path) {
  if (!path || deleteBatchActive || !wsOpen()) return;
  const name = baseName(path);
  const commandId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  setMsg(`Opening ${name} on target…`);
  send({
    type: "command",
    commandType: "file_execute",
    id: commandId,
    payload: { path },
  });
  try {
    await waitCommand(commandId, 60_000);
    setMsg(`Opened ${name} on target`);
    showToast(`Opened on target: ${name}`);
  } catch (err) {
    playSound("error");
    const text = err?.message || String(err || "failed");
    setMsg(`Open failed: ${name}`);
    showToast(`Open failed: ${name}\n${text}`, true, 5000);
  }
}

async function handleContextAction(action) {
  if (!contextMenuEl) return;
  const path = contextMenuEl.dataset.path || "";
  const isDir = contextMenuEl.dataset.isDir === "true";
  hideContextMenu();
  if (deleteBatchActive && action !== "refresh") return;

  switch (action) {
    case "open":
      if (isDir && path) listFiles(path);
      break;
    case "execute":
      if (!isDir && path) await executeFileOnTarget(path);
      break;
    case "download":
      await downloadSelected();
      break;
    case "copy-path":
      if (path) {
        try {
          await navigator.clipboard.writeText(path);
          setMsg("Path copied");
        } catch {
          showToast("Could not copy path", true);
        }
      }
      break;
    case "delete":
      await requestDelete();
      break;
    case "refresh":
      if (!deleteBatchActive) listFiles(currentPath, { skipHistory: true });
      break;
    default:
      break;
  }
}

async function requestDelete() {
  if (deleteBatchActive) return;
  const paths = [...selected];
  if (!paths.length) return;
  const names = paths.map((p) => baseName(p));
  const msg =
    paths.length === 1
      ? `Delete '${names[0]}' on the remote machine?\n\nThis is permanent on the target.`
      : `Delete ${paths.length} items on the remote machine?\n\nThis is permanent on the target.`;
  if (!window.confirm(msg)) return;
  await runDeleteBatch(paths);
}

async function runDeleteBatch(paths) {
  if (deleteBatchActive || !paths.length) return;
  deleteBatchActive = true;
  deleteAbort = false;
  skippedPaths = [];
  deleteBatchStats = {
    deleted: 0,
    inuse: 0,
    denied: 0,
    notfound: 0,
    failed: 0,
    timeout: 0,
    offline: 0,
  };
  setBatchUiLocked(true);
  delBarBegin(paths);
  setMsg(paths.length === 1 ? `Deleting ${baseName(paths[0])}…` : `Deleting ${paths.length} items…`);

  for (const path of paths) {
    const name = baseName(path);
    if (deleteAbort || !wsOpen()) {
      recordDeleteResult(path, false, "offline", "Offline");
      skippedPaths.push(path);
      continue;
    }
    deleteResults.set(path, {
      state: "pending",
      category: "pending",
      text: "Deleting…",
      name,
      expiresAt: 0,
    });
    delBarMarkCurrent(path);
    renderList();
    const commandId = `delete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    deleteInFlight = { path, commandId };
    send({ type: "file_delete", path, commandId });
    try {
      await waitCommand(commandId, DELETE_STEP_TIMEOUT_MS);
      recordDeleteResult(path, true, "deleted", "Deleted");
      selected.delete(path);
      directoryEntries = directoryEntries.filter((e) => e.path !== path);
    } catch (err) {
      if (deleteAbort) {
        recordDeleteResult(path, false, "offline", "Offline");
      } else {
        const { category, text } = classifyDeleteFailure(err?.message);
        recordDeleteResult(path, false, category, text);
      }
      skippedPaths.push(path);
    }
    deleteInFlight = null;
    renderList();
  }

  finalizeDeleteBatch();
}

function finalizeDeleteBatch() {
  const stats = deleteBatchStats || {
    deleted: 0,
    inuse: 0,
    denied: 0,
    notfound: 0,
    failed: 0,
    timeout: 0,
    offline: 0,
  };
  const selectPaths = [...skippedPaths];
  const skippedNames = selectPaths.map((p) => baseName(p));
  const summaryHtml = buildDeleteSummaryHtml(stats);
  const msg = buildDeleteSummaryMsg(stats, skippedNames);
  const toast = buildSkippedToast(skippedNames);
  pendingPostList = {
    selectPaths,
    summaryHtml,
    msg,
    toast,
    playOk: (stats.deleted || 0) > 0,
    playErr: selectPaths.length > 0,
  };
  showDeleteSummary(summaryHtml);
  delBarFinish();
  deleteBatchActive = false;
  deleteAbort = false;
  deleteBatchStats = null;
  setBatchUiLocked(false);
  listFiles(currentPath, { skipHistory: true });
}

async function downloadSelected() {
  if (deleteBatchActive) return;
  const files = selectedEntries().filter((e) => !e.isDir);
  if (!files.length) {
    showToast("Select one or more files to download (folders not supported here).", true);
    return;
  }
  for (const file of files) {
    setMsg(`Downloading ${file.name}…`);
    showXfer(`Downloading ${file.name}`, 0);
    try {
      const requestRes = await fetch("/api/file/download/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ clientId, path: file.path }),
      });
      if (!requestRes.ok) throw new Error((await requestRes.text()) || "request failed");
      const data = await requestRes.json();
      const downloadUrl =
        typeof data?.downloadUrl === "string"
          ? data.downloadUrl
          : data?.downloadId
            ? `/api/file/download/${encodeURIComponent(data.downloadId)}`
            : "";
      if (!downloadUrl) throw new Error("no download url");
      const res = await fetch(downloadUrl, { credentials: "include" });
      if (!res.ok) throw new Error((await res.text()) || "download failed");
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
        chunks.push(new Uint8Array(await res.arrayBuffer()));
      }
      const blob = new Blob(chunks);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      setMsg(`Downloaded ${file.name}`);
    } catch (err) {
      playSound("error");
      showToast(`Download failed: ${file.name}\n${err.message || err}`, true);
    }
  }
  hideXfer();
}

async function uploadFileViaWsChunks(file, path) {
  const total = file.size;
  const transferId = `ws-up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const localAcks = new Map();

  const cleanupAcks = (err) => {
    for (const [key, pending] of localAcks.entries()) {
      clearTimeout(pending.timeoutId);
      pendingUploadAcks.delete(key);
      try {
        pending.reject(err);
      } catch {}
    }
    localAcks.clear();
  };

  const pumpChunk = async (offset, data) => {
    const key = `id:${transferId}:${offset}`;
    const ackPromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        localAcks.delete(key);
        pendingUploadAcks.delete(key);
        reject(new Error(`upload chunk timeout (offset ${offset})`));
      }, WS_UPLOAD_ACK_TIMEOUT_MS);
      const entry = { resolve, reject, timeoutId, transferId };
      localAcks.set(key, entry);
      pendingUploadAcks.set(key, entry);
    });
    send({
      type: "file_upload",
      path,
      data,
      offset,
      total,
      transferId,
    });
    if (total > 0) {
      showXfer(`Uploading ${file.name}`, Math.round(((offset + data.length) / total) * 100));
    }
    try {
      const result = await ackPromise;
      localAcks.delete(key);
      return result;
    } catch (err) {
      localAcks.delete(key);
      throw err;
    }
  };

  try {
    if (total === 0) {
      await pumpChunk(0, new Uint8Array(0));
      return;
    }

    const inFlight = new Map();
    let nextOffset = 0;
    while (nextOffset < total || inFlight.size > 0) {
      while (inFlight.size < WS_UPLOAD_CONCURRENCY && nextOffset < total) {
        const start = nextOffset;
        const end = Math.min(start + WS_UPLOAD_CHUNK_SIZE, total);
        const buf = new Uint8Array(await file.slice(start, end).arrayBuffer());
        nextOffset = end;
        const tracked = pumpChunk(start, buf).then(() => {
          inFlight.delete(start);
        });
        inFlight.set(start, tracked);
      }
      if (inFlight.size > 0) {
        await Promise.race(inFlight.values());
      }
    }
  } catch (err) {
    cleanupAcks(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}

async function uploadFileViaHttpPull(file, path) {
  const requestRes = await fetch("/api/file/upload/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ clientId, path, fileName: file.name }),
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
      if (ev.lengthComputable) showXfer(`Uploading ${file.name}`, Math.round((ev.loaded / ev.total) * 50));
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
      payload: { path, url: staged.pullUrl, total: file.size },
    });
  }
  showXfer(`Saving ${file.name} on remote…`, 75);
  await waitCommand(commandId, HTTP_AGENT_PULL_TIMEOUT_MS);
}

async function uploadFiles(fileList) {
  if (deleteBatchActive) return;
  const files = Array.from(fileList || []);
  if (!files.length) return;
  for (const file of files) {
    const path = joinPath(currentPath, file.name);
    setMsg(`Uploading ${file.name}…`);
    showXfer(`Uploading ${file.name}`, 0);
    try {
      // Small files: push over the existing viewer/agent WS path. This works on
      // old agents without HTTP pull URL rewrite/reachability.
      if (file.size <= WS_UPLOAD_MAX_TOTAL) {
        await uploadFileViaWsChunks(file, path);
      } else {
        try {
          await uploadFileViaHttpPull(file, path);
        } catch (httpErr) {
          // Large files cannot use WS (server hard limit 8MB). Surface pull errors clearly.
          const msg = httpErr instanceof Error ? httpErr.message : String(httpErr || "upload failed");
          throw new Error(
            `${msg}\n\nLarge file requires HTTP pull. Set OVERLORD_EXTERNAL_URL to an agent-reachable https origin, or rebuild agent ≥ 2.3.8.`,
          );
        }
      }
      showXfer(`Uploaded ${file.name}`, 100);
      playSound("upload");
      setMsg(`Uploaded ${file.name}`);
    } catch (err) {
      playSound("error");
      showToast(`Upload failed: ${file.name}\n${err.message || err}`, true);
    }
  }
  hideXfer();
  listFiles(currentPath, { skipHistory: true });
}

function bindUi() {
  els.back?.addEventListener("click", goBack);
  els.forward?.addEventListener("click", goForward);
  els.up?.addEventListener("click", goUp);
  els.refresh?.addEventListener("click", () => {
    if (!deleteBatchActive) listFiles(currentPath, { skipHistory: true });
  });
  els.mkdir?.addEventListener("click", () => mkdir());
  els.delete?.addEventListener("click", () => requestDelete());
  els.download?.addEventListener("click", () => downloadSelected());
  els.upload?.addEventListener("click", () => {
    if (!deleteBatchActive) els.fileInput?.click();
  });
  els.selectAll?.addEventListener("click", () => selectAllVisible());
  els.kbClose?.addEventListener("click", () => delBarHide());
  els.fileInput?.addEventListener("change", () => {
    uploadFiles(els.fileInput.files);
    els.fileInput.value = "";
  });
  els.path?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!deleteBatchActive) listFiles(els.path.value.trim() || ".");
    }
  });
  els.filter?.addEventListener("input", () => {
    filterText = els.filter.value.trim();
    renderList();
  });
  document.querySelectorAll("[data-sort]").forEach((el) => {
    el.addEventListener("click", () => {
      const field = el.getAttribute("data-sort");
      if (sortField === field) sortDir *= -1;
      else {
        sortField = field;
        sortDir = 1;
      }
      renderList();
    });
  });

  // drag-drop upload
  let depth = 0;
  const body = document.body;
  body.addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (deleteBatchActive) return;
    depth += 1;
    body.classList.add("fm2-drop");
  });
  body.addEventListener("dragleave", (e) => {
    e.preventDefault();
    depth = Math.max(0, depth - 1);
    if (!depth) body.classList.remove("fm2-drop");
  });
  body.addEventListener("dragover", (e) => e.preventDefault());
  body.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    body.classList.remove("fm2-drop");
    if (deleteBatchActive) return;
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideContextMenu();
    if (e.key === "Delete" && selected.size && !deleteBatchActive) {
      e.preventDefault();
      requestDelete();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && document.activeElement?.tagName !== "INPUT") {
      e.preventDefault();
      selectAllVisible();
    }
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest("#fm2-ctx")) return;
    hideContextMenu();
  });
  document.addEventListener("contextmenu", (e) => {
    if (!e.target.closest(".fm2-row") && !e.target.closest("#fm2-ctx")) {
      hideContextMenu();
    }
  });
  document.addEventListener("click", (e) => {
    const item = e.target.closest(".fm2-ctx-item");
    if (!item || item.disabled) return;
    const action = item.dataset.action;
    if (action) handleContextAction(action);
  });
  window.addEventListener("blur", hideContextMenu);
  window.addEventListener("resize", hideContextMenu);
}

async function main() {
  if (!clientId) {
    setStatusUi("err", "Missing client");
    if (els.list) els.list.innerHTML = `<div class="fm2-placeholder">Missing client id</div>`;
    return;
  }
  bindUi();
  await loadSounds();
  const allowed = await checkFeatureAccess("file_browser", clientId);
  if (!allowed) {
    setStatusUi("err", "Access denied");
    if (els.list) {
      els.list.innerHTML = `<div class="fm2-placeholder"><i class="fa-solid fa-lock"></i> File Browser access denied</div>`;
    }
    return;
  }
  connect();
}

main().catch((err) => {
  console.error("files2", err);
  setStatusUi("err", "Failed");
  if (els.list) {
    els.list.innerHTML = `<div class="fm2-placeholder">Failed to start File Manager 2.0</div>`;
  }
});
