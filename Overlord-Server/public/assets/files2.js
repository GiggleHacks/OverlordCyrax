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

export const FILES2_JS_VERSION = "1.0.0";

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
let soundsEnabled = true;
let soundManifest = null;
const audioCache = {};
let toastTimer = null;

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

function setConnectedUi(ok) {
  [els.mkdir, els.upload, els.download, els.delete, els.refresh].forEach((b) => {
    if (b) b.disabled = !ok;
  });
  updateNavButtons();
  updateSelectionUi();
}

function setMsg(text) {
  if (els.msg) els.msg.textContent = text || "";
}

function showToast(message, isErr = false) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.toggle("is-err", !!isErr);
  els.toast.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("is-on"), 3200);
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
      }
      break;
    case "file_list_result":
      handleFileList(msg);
      break;
    case "command_result":
      handleCommandResult(msg);
      break;
    default:
      break;
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
  if (els.path) els.path.value = currentPath;
  if (els.pathStatus) els.pathStatus.textContent = currentPath;
  updateNavButtons();
  setMsg(`Opening ${currentPath}…`);
}

function updateNavButtons() {
  if (els.back) els.back.disabled = pathHistory.length === 0;
  if (els.forward) els.forward.disabled = pathForward.length === 0;
  if (els.up) els.up.disabled = !shouldShowParentDirectory(currentPath);
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
    directoryEntries = [];
    renderList();
    playSound("error");
    showToast(msg.error, true);
    setMsg(`Error: ${msg.error}`);
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
  selected.clear();
  selectionAnchor = null;
  renderList();
  setMsg("");
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
      row.innerHTML = `
        <span><span class="fm2-name"><i class="fa-solid ${iconClass(entry)}"></i><span>${escapeHtml(entry.name || "")}</span></span></span>
        <span class="fm2-muted fm2-num">${entry.isDir ? "—" : escapeHtml(formatBytes(Number(entry.size || 0)))}</span>
        <span class="fm2-muted">${escapeHtml(typeLabel(entry))}</span>
        <span class="fm2-muted">${escapeHtml(formatModified(entry))}</span>
      `;
      row.addEventListener("click", (e) => onRowClick(e, entry, list));
      row.addEventListener("dblclick", () => {
        if (entry.isDir) listFiles(entry.path);
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
  const hasFile = [...selected].some((p) => {
    const e = directoryEntries.find((x) => x.path === p);
    return e && !e.isDir;
  });
  if (els.download) els.download.disabled = !hasFile || !ws || ws.readyState !== WebSocket.OPEN;
  if (els.delete) els.delete.disabled = n === 0 || !ws || ws.readyState !== WebSocket.OPEN;
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

async function requestDelete() {
  const paths = [...selected];
  if (!paths.length) return;
  const names = paths.map((p) => p.split(/[/\\]/).pop());
  const msg =
    paths.length === 1
      ? `Delete '${names[0]}' on the remote machine?\n\nThis is permanent on the target.`
      : `Delete ${paths.length} items on the remote machine?\n\nThis is permanent on the target.`;
  if (!window.confirm(msg)) return;
  setMsg(paths.length === 1 ? `Deleting ${names[0]}…` : `Deleting ${paths.length} items…`);
  let okCount = 0;
  let failCount = 0;
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const commandId = `delete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    send({ type: "file_delete", path, commandId });
    try {
      await waitCommand(commandId);
      okCount += 1;
      selected.delete(path);
    } catch {
      failCount += 1;
    }
  }
  if (okCount) playSound("delete");
  if (failCount) playSound("error");
  setMsg(`Deleted ${okCount}${failCount ? `, failed ${failCount}` : ""}`);
  listFiles(currentPath, { skipHistory: true });
}

async function downloadSelected() {
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

async function uploadFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  for (const file of files) {
    const path = joinPath(currentPath, file.name);
    setMsg(`Uploading ${file.name}…`);
    showXfer(`Uploading ${file.name}`, 0);
    try {
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
      await waitCommand(commandId);
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
  els.refresh?.addEventListener("click", () => listFiles(currentPath, { skipHistory: true }));
  els.mkdir?.addEventListener("click", () => mkdir());
  els.delete?.addEventListener("click", () => requestDelete());
  els.download?.addEventListener("click", () => downloadSelected());
  els.upload?.addEventListener("click", () => els.fileInput?.click());
  els.fileInput?.addEventListener("change", () => {
    uploadFiles(els.fileInput.files);
    els.fileInput.value = "";
  });
  els.path?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      listFiles(els.path.value.trim() || ".");
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
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Delete" && selected.size) {
      e.preventDefault();
      requestDelete();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && document.activeElement?.tagName !== "INPUT") {
      e.preventDefault();
      selected.clear();
      for (const ent of sortedFilteredEntries()) selected.add(ent.path);
      renderList();
    }
  });
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
