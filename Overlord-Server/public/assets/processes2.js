/** Process Manager 2.0 — compact process list for Dashboard 2.0 panes. v1.0.0 */
import { encodeMsgpack, decodeMsgpack } from "./msgpack-helpers.js";
import { checkFeatureAccess } from "./feature-gate.js";

const PROCESSES2_JS_VERSION = "1.0.0";
const clientId = window.location.pathname.split("/")[1];

let ws = null;
let processes = [];
let processMap = new Map();
let processTree = [];
let collapsedPids = new Set();
let selectedPid = null;
let rowsByPid = new Map();
let sortField = "cpu";
let sortDirection = "desc";
let searchTerm = "";

const procIconCache = new Map();
const procIconQueue = [];
let procIconFlushScheduled = false;
const PROC_ICON_BATCH_SIZE = 32;
const PROC_ICON_BATCH_DELAY_MS = 60;

const statusEl = document.getElementById("proc2-status");
const countEl = document.getElementById("proc2-count");
const listEl = document.getElementById("proc2-list");
const refreshBtn = document.getElementById("proc2-refresh");
const killBtn = document.getElementById("proc2-kill");
const searchInput = document.getElementById("proc2-search-input");
const verEl = document.getElementById("proc2-ver");

if (verEl) {
  verEl.textContent = `v${PROCESSES2_JS_VERSION}`;
  verEl.title = `processes2.js v${PROCESSES2_JS_VERSION}`;
}

function setPlaceholder(html, isErr = false) {
  if (!listEl) return;
  listEl.innerHTML = `<div class="proc2-placeholder${isErr ? " err" : ""}">${html}</div>`;
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/api/clients/${clientId}/processes/ws`;

  ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    updateStatus("ok", "Connected");
    enableControls(true);
    setPlaceholder('<i class="fa-solid fa-circle-notch fa-spin"></i> Loading processes...');
    requestProcessList();
  };

  ws.onmessage = (event) => {
    const msg = decodeMsgpack(event.data);
    if (!msg) return;
    handleMessage(msg);
  };

  ws.onerror = () => updateStatus("err", "Connection error");

  ws.onclose = () => {
    updateStatus("off", "Disconnected — retrying...");
    enableControls(false);
    setTimeout(() => connect(), 3000);
  };
}

function updateStatus(state, text) {
  if (!statusEl) return;
  statusEl.className = `proc2-status is-${state}`;
  statusEl.innerHTML =
    state === "connecting"
      ? '<i class="fa-solid fa-circle-notch fa-spin"></i>'
      : '<i class="fa-solid fa-circle"></i>';
  statusEl.title = `${text} · processes2.js v${PROCESSES2_JS_VERSION}`;
}

function enableControls(enabled) {
  if (refreshBtn) refreshBtn.disabled = !enabled;
  updateKillButton();
}

function updateKillButton() {
  if (killBtn) killBtn.disabled = !selectedPid || !ws || ws.readyState !== WebSocket.OPEN;
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(encodeMsgpack(msg));
  }
}

function handleMessage(msg) {
  switch (msg.type) {
    case "ready":
      break;
    case "status":
      if (msg.status === "offline") {
        updateStatus("err", "Client offline");
        enableControls(false);
        setPlaceholder('<i class="fa-solid fa-plug-circle-xmark"></i> Client offline', true);
      }
      break;
    case "process_list_result":
      handleProcessList(msg);
      break;
    case "process_icon_result":
      handleProcessIconResult(msg);
      break;
    case "command_result":
      handleCommandResult(msg);
      break;
  }
}

function requestProcessList() {
  send({ type: "process_list" });
}

function normalizeId(value) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return Number.isFinite(value) ? value : 0;
}

function handleProcessList(msg) {
  if (msg.error) {
    setPlaceholder(`<i class="fa-solid fa-exclamation-triangle"></i> ${escapeHtml(msg.error)}`, true);
    updateStatus("err", "Error loading processes");
    return;
  }

  processes = (msg.processes || []).map((proc) => ({
    ...proc,
    pid: normalizeId(proc.pid),
    ppid: normalizeId(proc.ppid),
  }));
  if (countEl) {
    countEl.textContent = String(processes.length);
    countEl.title = `${processes.length} processes`;
  }
  updateStatus("ok", "Connected");
  buildProcessTree();
  renderProcesses();
  requestProcessIcons(processes);
}

function buildProcessTree() {
  processMap.clear();
  processes.forEach((proc) => {
    processMap.set(proc.pid, { ...proc, children: [] });
  });

  const isShellParent = (proc) =>
    proc && typeof proc.name === "string" && proc.name.toLowerCase() === "explorer.exe";

  const roots = [];
  processMap.forEach((proc) => {
    const parent = proc.ppid ? processMap.get(proc.ppid) : null;
    if (parent && proc.ppid !== proc.pid && !isShellParent(parent)) {
      parent.children.push(proc);
    } else {
      roots.push(proc);
    }
  });

  function computeAggregates(proc) {
    let cpuTotal = proc.cpu || 0;
    let memTotal = Number(proc.memory || 0);
    for (const child of proc.children) {
      const [childCpu, childMem] = computeAggregates(child);
      cpuTotal += childCpu;
      memTotal += childMem;
    }
    proc.aggregatedCpu = Math.min(cpuTotal, 100);
    proc.aggregatedMemory = memTotal;
    return [cpuTotal, memTotal];
  }
  roots.forEach(computeAggregates);

  const sortValue = (proc) => {
    if (sortField === "cpu") return proc.aggregatedCpu;
    if (sortField === "memory") return proc.aggregatedMemory;
    if (sortField === "name") return proc.name.toLowerCase();
    return proc[sortField];
  };
  const cmp = (a, b) => {
    const aVal = sortValue(a);
    const bVal = sortValue(b);
    if (sortDirection === "asc") return aVal > bVal ? 1 : -1;
    return aVal < bVal ? 1 : -1;
  };

  function sortChildren(proc) {
    if (proc.children.length > 0) {
      proc.children.sort(cmp);
      proc.children.forEach(sortChildren);
    }
  }
  roots.forEach(sortChildren);
  roots.sort(cmp);

  processTree = roots;
}

function renderProcesses() {
  const filtered = [];

  function collectMatches(proc, depth = 0) {
    const matches =
      !searchTerm ||
      proc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      proc.pid.toString().includes(searchTerm) ||
      (proc.username && proc.username.toLowerCase().includes(searchTerm.toLowerCase()));

    if (matches) {
      filtered.push({ ...proc, depth });
    }

    if (proc.children && proc.children.length > 0 && !collapsedPids.has(proc.pid)) {
      proc.children.forEach((child) => collectMatches(child, depth + 1));
    }
  }

  processTree.forEach((proc) => collectMatches(proc, 0));

  if (filtered.length === 0) {
    listEl.innerHTML =
      '<div class="proc2-placeholder"><i class="fa-solid fa-inbox"></i> No processes found</div>';
    rowsByPid.clear();
    return;
  }

  for (const child of [...listEl.children]) {
    if (!child.classList.contains("proc2-row")) child.remove();
  }

  const seen = new Set();
  filtered.forEach((proc, index) => {
    seen.add(proc.pid);
    let row = rowsByPid.get(proc.pid);
    if (!row) {
      row = createProcessRow(proc, proc.depth);
      rowsByPid.set(proc.pid, row);
    } else {
      updateProcessRow(row, proc, proc.depth);
    }
    if (listEl.children[index] !== row) {
      listEl.insertBefore(row, listEl.children[index] || null);
    }
  });

  for (const [pid, row] of rowsByPid) {
    if (!seen.has(pid)) {
      row.remove();
      rowsByPid.delete(pid);
    }
  }
}

function cpuHeatClass(cpu) {
  if (cpu > 50) return "proc2-h-4";
  if (cpu > 25) return "proc2-h-3";
  if (cpu > 10) return "proc2-h-2";
  if (cpu > 1) return "proc2-h-1";
  return "proc2-h-0";
}

function memHeatClass(bytes) {
  const MB = 1024 * 1024;
  if (bytes > 2048 * MB) return "proc2-h-4";
  if (bytes > 1024 * MB) return "proc2-h-3";
  if (bytes > 256 * MB) return "proc2-h-2";
  if (bytes > 32 * MB) return "proc2-h-1";
  return "proc2-h-0";
}

function formatMem(bytes) {
  bytes = Number(bytes) || 0;
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (bytes >= GB) return (bytes / GB).toFixed(1) + "G";
  if (bytes >= MB) return Math.round(bytes / MB) + "M";
  if (bytes >= KB) return Math.round(bytes / KB) + "K";
  return Math.round(bytes) + "B";
}

function rowClassName(proc) {
  let cls = "proc2-row";
  if (selectedPid === proc.pid) cls += " selected";
  if (proc.self) cls += " self-process";
  return cls;
}

function rowInnerHtml(proc, depth) {
  const displayCpu = proc.aggregatedCpu ?? proc.cpu ?? 0;
  const displayMemory = proc.aggregatedMemory ?? Number(proc.memory || 0);

  const hasChildren = proc.children && proc.children.length > 0;
  const isCollapsed = collapsedPids.has(proc.pid);
  const indent = '<span class="proc2-guide"></span>'.repeat(depth);

  const tw = hasChildren
    ? `<span class="proc2-tw${isCollapsed ? " collapsed" : ""}" data-pid="${escapeHtml(String(proc.pid))}"><i class="fa-solid fa-chevron-down"></i></span>`
    : '<span class="proc2-tw-spacer"></span>';

  let nameClass = "proc2-t-other";
  let fallbackIcon = "fa-microchip";
  if (proc.type === "system") nameClass = "proc2-t-system";
  else if (proc.type === "service") nameClass = "proc2-t-service";
  else if (proc.type === "own") nameClass = "proc2-t-own";
  if (proc.self) {
    nameClass = "proc2-t-agent";
    fallbackIcon = "fa-crosshairs";
  }

  const iconKey = procIconKey(proc);
  const cached = iconKey ? procIconCache.get(iconKey) : null;
  const ico =
    cached && cached.blobUrl
      ? `<span class="proc2-ico"${iconKey ? ` data-proc-icon-key="${escapeHtml(iconKey)}"` : ""}><img src="${cached.blobUrl}" alt="" draggable="false"></span>`
      : `<span class="proc2-ico ${nameClass}"${iconKey ? ` data-proc-icon-key="${escapeHtml(iconKey)}"` : ""}><i class="fa-solid ${fallbackIcon}"></i></span>`;

  const badge = proc.self ? '<span class="proc2-agent-badge">agent</span>' : "";

  return `
    <div class="proc2-cell proc2-name-cell">
      ${indent}${tw}${ico}
      <span class="proc2-nm ${nameClass}">${escapeHtml(proc.name)}</span>${badge}
      <span class="proc2-pid">${proc.pid}</span>
    </div>
    <div class="proc2-cell proc2-cell-num ${cpuHeatClass(displayCpu)}">${displayCpu.toFixed(1)}</div>
    <div class="proc2-cell proc2-cell-num ${memHeatClass(displayMemory)}">${formatMem(displayMemory)}</div>
  `;
}

function updateProcessRow(row, proc, depth) {
  const nextClass = rowClassName(proc);
  if (row.className !== nextClass) row.className = nextClass;
  const tip = `${proc.name}\nPID ${proc.pid}${proc.username ? `\n${proc.username}` : ""}`;
  if (row.title !== tip) row.title = tip;
  row.innerHTML = rowInnerHtml(proc, depth);
}

function createProcessRow(proc, depth = 0) {
  const row = document.createElement("div");
  row.dataset.pid = proc.pid;
  row.className = rowClassName(proc);
  row.title = `${proc.name}\nPID ${proc.pid}${proc.username ? `\n${proc.username}` : ""}`;
  row.innerHTML = rowInnerHtml(proc, depth);

  row.onclick = (e) => {
    const pid = Number(row.dataset.pid);
    if (e.target.closest(".proc2-tw")) {
      toggleCollapse(pid);
      return;
    }
    selectProcess(pid);
  };

  row.oncontextmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pid = Number(row.dataset.pid);
    selectProcess(pid);
    showContextMenu(e.clientX, e.clientY, pid);
  };

  return row;
}

function toggleCollapse(pid) {
  if (collapsedPids.has(pid)) collapsedPids.delete(pid);
  else collapsedPids.add(pid);
  renderProcesses();
}

function selectProcess(pid) {
  selectedPid = pid;
  updateKillButton();
  renderProcesses();
}

function killProcess() {
  if (!selectedPid) return;
  const proc = processes.find((p) => p.pid === selectedPid);
  if (!proc) return;
  if (!confirm(`Kill process "${proc.name}" (PID: ${proc.pid})?`)) return;
  const pid = Number(selectedPid);
  if (!Number.isFinite(pid) || pid <= 0) {
    alert("Invalid PID selected.");
    return;
  }
  send({ type: "process_kill", pid });
  updateStatus("ok", "Killing process...");
}

function handleCommandResult(msg) {
  if (!msg.ok) {
    alert(`Operation failed: ${msg.message || "Unknown error"}`);
    updateStatus("ok", "Connected");
  } else {
    setTimeout(() => requestProcessList(), 500);
  }
}

function setSortField(field) {
  if (sortField === field) {
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
  } else {
    sortField = field;
    sortDirection = field === "name" ? "asc" : "desc";
  }
  buildProcessTree();
  renderProcesses();
  updateSortIndicators();
}

function updateSortIndicators() {
  document.querySelectorAll('[id^="proc2-sort-"]').forEach((el) => {
    const field = el.id.replace("proc2-sort-", "");
    const icon = el.querySelector("i");
    if (!icon) return;
    if (field === sortField) {
      icon.className = sortDirection === "asc" ? "fa-solid fa-sort-up" : "fa-solid fa-sort-down";
    } else {
      icon.className = "fa-solid fa-sort";
    }
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

/* ── context menu ─────────────────────────────────────── */
let contextMenuEl = null;

function createContextMenu() {
  const menu = document.createElement("div");
  menu.id = "proc2-ctx";
  menu.className = "hidden";
  menu.innerHTML = `
    <button data-action="suspend" class="proc2-ctx-item"><i class="fa-solid fa-pause" style="color:#facc15"></i> Suspend</button>
    <button data-action="resume" class="proc2-ctx-item"><i class="fa-solid fa-play" style="color:#2ee66b"></i> Resume</button>
    <div class="proc2-ctx-sep"></div>
    <button data-action="kill" class="proc2-ctx-item"><i class="fa-solid fa-skull-crossbones" style="color:#f87171"></i> Kill</button>
    <button data-action="kill-tree" class="proc2-ctx-item"><i class="fa-solid fa-diagram-project" style="color:#f87171"></i> Kill Tree</button>
    <div class="proc2-ctx-sep"></div>
    <button data-action="copy-pid" class="proc2-ctx-item"><i class="fa-solid fa-copy" style="color:#60a5fa"></i> Copy PID</button>
    <button data-action="copy-name" class="proc2-ctx-item"><i class="fa-solid fa-tag" style="color:#60a5fa"></i> Copy Name</button>
    <div class="proc2-ctx-sep"></div>
    <button data-action="refresh" class="proc2-ctx-item"><i class="fa-solid fa-rotate" style="color:#94a3b8"></i> Refresh</button>
  `;
  document.body.appendChild(menu);
  return menu;
}

function showContextMenu(x, y, pid) {
  if (!contextMenuEl) contextMenuEl = createContextMenu();
  contextMenuEl.dataset.pid = pid;
  contextMenuEl.classList.remove("hidden");

  const rect = contextMenuEl.getBoundingClientRect();
  const menuW = rect.width || 148;
  const menuH = rect.height || 200;
  const posX = x + menuW > window.innerWidth ? window.innerWidth - menuW - 6 : x;
  const posY = y + menuH > window.innerHeight ? window.innerHeight - menuH - 6 : y;

  contextMenuEl.style.left = posX + "px";
  contextMenuEl.style.top = posY + "px";
}

function hideContextMenu() {
  if (contextMenuEl) contextMenuEl.classList.add("hidden");
}

document.addEventListener("click", hideContextMenu);
document.addEventListener("contextmenu", (e) => {
  if (!e.target.closest(".proc2-row") && !e.target.closest("#proc2-ctx")) {
    hideContextMenu();
  }
});

document.addEventListener("click", (e) => {
  const item = e.target.closest(".proc2-ctx-item");
  if (!item || !contextMenuEl) return;
  const action = item.dataset.action;
  const pid = Number(contextMenuEl.dataset.pid);
  const proc = processes.find((p) => p.pid === pid);
  hideContextMenu();

  switch (action) {
    case "suspend":
      if (!proc) break;
      if (!confirm(`Suspend process "${proc.name}" (PID: ${pid})?`)) break;
      send({ type: "process_suspend", pid });
      updateStatus("ok", "Suspending process...");
      break;
    case "resume":
      if (!proc) break;
      send({ type: "process_resume", pid });
      updateStatus("ok", "Resuming process...");
      break;
    case "kill":
      if (!proc) break;
      if (!confirm(`Kill process "${proc.name}" (PID: ${pid})?`)) break;
      send({ type: "process_kill", pid });
      updateStatus("ok", "Killing process...");
      break;
    case "kill-tree":
      if (!proc) break;
      if (!confirm(`Kill process "${proc.name}" (PID: ${pid}) and all child processes?`)) break;
      killProcessTree(pid);
      break;
    case "copy-pid":
      navigator.clipboard.writeText(String(pid));
      break;
    case "copy-name":
      if (proc) navigator.clipboard.writeText(proc.name);
      break;
    case "refresh":
      requestProcessList();
      break;
  }
});

function killProcessTree(pid) {
  const toKill = [];
  function collectChildren(parentPid) {
    for (const proc of processes) {
      if (proc.ppid === parentPid && proc.pid !== parentPid) {
        collectChildren(proc.pid);
        toKill.push(proc.pid);
      }
    }
  }
  collectChildren(pid);
  toKill.push(pid);
  for (const p of toKill) {
    send({ type: "process_kill", pid: p });
  }
  updateStatus("ok", `Killing ${toKill.length} processes...`);
}

/* ── icons ────────────────────────────────────────────── */
function procIconKey(proc) {
  if (!proc.exePath) return null;
  return proc.exePath.toLowerCase();
}

function requestProcessIcons(procs) {
  for (const proc of procs) {
    const key = procIconKey(proc);
    if (!key) continue;
    if (procIconCache.has(key)) continue;
    procIconCache.set(key, { pending: true });
    procIconQueue.push({ key, path: proc.exePath });
  }
  if (procIconQueue.length > 0) scheduleProcIconFlush();
}

function scheduleProcIconFlush() {
  if (procIconFlushScheduled) return;
  procIconFlushScheduled = true;
  setTimeout(flushProcIconQueue, PROC_ICON_BATCH_DELAY_MS);
}

function flushProcIconQueue() {
  procIconFlushScheduled = false;
  if (procIconQueue.length === 0) return;
  const batch = procIconQueue.splice(0, PROC_ICON_BATCH_SIZE);
  send({ type: "process_icon", items: batch });
  if (procIconQueue.length > 0) scheduleProcIconFlush();
}

function handleProcessIconResult(msg) {
  const items = Array.isArray(msg.icons) ? msg.icons : [];
  for (const item of items) {
    if (!item || !item.key) continue;
    const entry = procIconCache.get(item.key) || {};
    entry.pending = false;
    if (item.png && item.png.length > 0) {
      const blob = new Blob([item.png], { type: "image/png" });
      entry.blobUrl = URL.createObjectURL(blob);
    } else {
      entry.failed = true;
    }
    procIconCache.set(item.key, entry);
    applyProcIconToDom(item.key, entry);
  }
}

function applyProcIconToDom(key, entry) {
  if (!entry || !entry.blobUrl) return;
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(key) : key.replace(/"/g, '\\"');
  document.querySelectorAll(`[data-proc-icon-key="${escaped}"]`).forEach((el) => {
    el.innerHTML = `<img src="${entry.blobUrl}" alt="" draggable="false">`;
  });
}

/* ── wiring ───────────────────────────────────────────── */
if (refreshBtn) refreshBtn.onclick = () => requestProcessList();
if (killBtn) killBtn.onclick = () => killProcess();

if (searchInput) {
  searchInput.oninput = (e) => {
    searchTerm = e.target.value;
    renderProcesses();
  };
}

document.getElementById("proc2-sort-name").onclick = () => setSortField("name");
document.getElementById("proc2-sort-cpu").onclick = () => setSortField("cpu");
document.getElementById("proc2-sort-memory").onclick = () => setSortField("memory");

setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    requestProcessList();
  }
}, 3000);

updateStatus("connecting", "Connecting...");
if (!clientId) {
  updateStatus("err", "Missing client ID");
  setPlaceholder('<i class="fa-solid fa-exclamation-triangle"></i> Missing client ID', true);
} else {
  checkFeatureAccess("processes", clientId).then((ok) => {
    if (ok) connect();
    else {
      updateStatus("err", "Access denied");
      setPlaceholder('<i class="fa-solid fa-lock"></i> Access denied', true);
    }
  });
}
updateSortIndicators();
