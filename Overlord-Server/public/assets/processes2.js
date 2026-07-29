/** Process Manager 2.0 — compact process list for Dashboard 2.0 panes. v1.3.1 */
import { encodeMsgpack, decodeMsgpack } from "./msgpack-helpers.js";
import { checkFeatureAccess } from "./feature-gate.js";
import { isKnownSafeProcess } from "./process-allowlist.js";

const PROCESSES2_JS_VERSION = "1.3.1";
const clientId = window.location.pathname.split("/")[1];

let ws = null;
let processes = [];
let processMap = new Map();
let processTree = [];
let collapsedPids = new Set();
let selectedPids = new Set();
let anchorPid = null;
let visiblePidOrder = [];
let rowsByPid = new Map();
let sortField = "cpu";
let sortDirection = "desc";
let searchTerm = "";
let hideKnownSafe = false;

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
const hideSafeBtn = document.getElementById("proc2-hidesafe");
const selectAllBtn = document.getElementById("proc2-selectall");
const killBarEl = document.getElementById("proc2-killbar");
const killBarBlocksEl = document.getElementById("proc2-kb-blocks");
const killBarPacEl = document.getElementById("proc2-kb-pac");
const killBarTextEl = document.getElementById("proc2-kb-text");
const killBarCloseBtn = document.getElementById("proc2-kb-close");

/* Processes that must never be mass-selected: killing any of these can
   blue-screen or hard-lock the remote machine. Manual single-selection is
   still possible — this guard only applies to Select All. */
const CRITICAL_NEVER_KILL = new Set([
  "system",
  "registry",
  "secure system",
  "memory compression",
  "idle",
  "smss.exe",
  "csrss.exe",
  "wininit.exe",
  "winlogon.exe",
  "services.exe",
  "lsass.exe",
  "lsaiso.exe",
]);
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
  const n = selectedPids.size;
  if (killBtn) {
    killBtn.disabled = n === 0 || !ws || ws.readyState !== WebSocket.OPEN;
    killBtn.title = n > 0 ? `Kill ${n} selected process${n > 1 ? "es" : ""}` : "Kill selected";
  }
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
        failKillQueue("offline", "Client went offline");
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
  pruneKillResults();
  const filtered = [];

  function collectMatches(proc, depth = 0) {
    // Known-safe filter: when enabled, trusted executables are hidden and only
    // unknown/suspicious processes remain. The agent (proc.self) is treated as
    // trusted by isKnownSafeProcess and can never appear in the filtered view.
    const matches =
      (!hideKnownSafe || !isKnownSafeProcess(proc)) &&
      (!searchTerm ||
        proc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        proc.pid.toString().includes(searchTerm) ||
        (proc.username && proc.username.toLowerCase().includes(searchTerm.toLowerCase())));

    if (matches) {
      filtered.push({ ...proc, depth });
    }

    if (proc.children && proc.children.length > 0 && !collapsedPids.has(proc.pid)) {
      proc.children.forEach((child) => collectMatches(child, depth + 1));
    }
  }

  processTree.forEach((proc) => collectMatches(proc, 0));
  visiblePidOrder = filtered.map((proc) => proc.pid);

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
  if (selectedPids.has(proc.pid)) cls += " selected";
  if (proc.self) cls += " self-process";
  return cls;
}

function killBadgeHtml(pid) {
  const res = killResults.get(pid);
  if (!res) return "";
  if (res.state === "pending") {
    return '<span class="proc2-kb proc2-kb-pending" title="Kill in progress..."><i class="fa-solid fa-circle-notch fa-spin"></i> killing</span>';
  }
  const labels = {
    killed: "killed",
    denied: "access denied",
    notfound: "not found",
    failed: "failed",
    timeout: "timeout",
    offline: "offline",
  };
  const cat = res.category || "failed";
  return `<span class="proc2-kb proc2-kb-${cat}" title="${escapeHtml(res.text || "")}">${labels[cat] || "failed"}</span>`;
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
  const killBadge = killBadgeHtml(proc.pid);

  return `
    <div class="proc2-cell proc2-name-cell">
      ${indent}${tw}${ico}
      <span class="proc2-nm ${nameClass}">${escapeHtml(proc.name)}</span>${badge}${killBadge}
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
    handleRowSelect(pid, e);
  };

  row.oncontextmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pid = Number(row.dataset.pid);
    // File-manager behavior: right-clicking inside an existing selection keeps
    // it; right-clicking outside selects just that row.
    if (!selectedPids.has(pid)) selectOnly(pid);
    else anchorPid = pid;
    showContextMenu(e.clientX, e.clientY, pid);
  };

  return row;
}

function toggleCollapse(pid) {
  if (collapsedPids.has(pid)) collapsedPids.delete(pid);
  else collapsedPids.add(pid);
  renderProcesses();
}

function handleRowSelect(pid, e) {
  if (
    e.shiftKey &&
    anchorPid != null &&
    visiblePidOrder.includes(anchorPid) &&
    visiblePidOrder.includes(pid)
  ) {
    // Shift+click: select the whole visible range between anchor and click.
    const a = visiblePidOrder.indexOf(anchorPid);
    const b = visiblePidOrder.indexOf(pid);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    selectedPids = new Set(visiblePidOrder.slice(lo, hi + 1));
  } else if (e.ctrlKey || e.metaKey) {
    // Ctrl+click: toggle a single row in the selection.
    if (selectedPids.has(pid)) selectedPids.delete(pid);
    else selectedPids.add(pid);
    anchorPid = pid;
  } else {
    selectedPids = new Set([pid]);
    anchorPid = pid;
  }
  updateKillButton();
  renderProcesses();
}

function selectOnly(pid) {
  selectedPids = new Set([pid]);
  anchorPid = pid;
  updateKillButton();
  renderProcesses();
}

function selectAllVisible() {
  // Selects every visible row (search/hide-safe filters already applied to
  // visiblePidOrder) except the agent and BSOD-critical system processes.
  const pids = [];
  for (const pid of visiblePidOrder) {
    const proc = processMap.get(pid);
    if (!proc || proc.self) continue;
    const name = typeof proc.name === "string" ? proc.name.toLowerCase() : "";
    if (CRITICAL_NEVER_KILL.has(name)) continue;
    pids.push(pid);
  }
  selectedPids = new Set(pids);
  anchorPid = pids.length ? pids[pids.length - 1] : null;
  updateKillButton();
  renderProcesses();
  updateStatus("ok", `Selected ${pids.length} process${pids.length === 1 ? "" : "es"}`);
}

/* ── sequential kill engine with per-process results ── */
const KILL_RESULT_TTL_MS = 20000;
const KILL_STEP_TIMEOUT_MS = 10000;
const killResults = new Map(); // pid -> { state: "pending"|"done", category, text, expiresAt }
let killQueue = [];
let killInFlight = null; // { pid, timeout }
let killBatchStats = null; // { killed, denied, notfound, failed, timeout, offline }
let summaryEl = document.getElementById("proc2-summary");
let summaryTimer = null;

/* ── batch kill progress bar (Win98 segmented blocks + pac-man) ── */
const KILL_BAR_AUTOHIDE_MS = 20000;
const killBar = {
  active: false,
  total: 0,
  done: 0,
  ok: 0,
  fail: 0,
  blocks: new Map(), // pid -> block element
  currentPid: null,
  hideTimer: null,
};

function killBarReset() {
  killBar.total = 0;
  killBar.done = 0;
  killBar.ok = 0;
  killBar.fail = 0;
  killBar.currentPid = null;
  killBar.blocks.clear();
  if (killBarBlocksEl) killBarBlocksEl.innerHTML = "";
}

function killBarRender(currentProc) {
  if (!killBar.active || !killBarTextEl || !killBarPacEl) return;
  const parts = [`${killBar.done}/${killBar.total}`, `<span class="ok">✔ ${killBar.ok}</span>`];
  if (killBar.fail > 0) parts.push(`<span class="bad">⛔ ${killBar.fail}</span>`);
  if (currentProc) parts.push(`killing ${escapeHtml(currentProc.name)} (PID ${currentProc.pid})…`);
  killBarTextEl.innerHTML = parts.join(" · ");
  const pct = killBar.total ? (killBar.done / killBar.total) * 100 : 0;
  killBarPacEl.style.left = pct <= 0 ? "0px" : pct >= 100 ? "calc(100% - 14px)" : `calc(${pct}% - 7px)`;
}

function killBarBegin(pids) {
  if (!killBarEl || !killBarBlocksEl) return;
  if (killBar.hideTimer) {
    clearTimeout(killBar.hideTimer);
    killBar.hideTimer = null;
  }
  if (!killBar.active) {
    killBarReset();
    killBar.active = true;
    killBarEl.hidden = false;
    if (killBarPacEl) killBarPacEl.classList.remove("kb-pac-idle");
  }
  for (const pid of pids) {
    if (killBar.blocks.has(pid)) continue;
    const block = document.createElement("div");
    block.className = "kb-b";
    block.title = `PID ${pid} — queued`;
    killBarBlocksEl.appendChild(block);
    killBar.blocks.set(pid, block);
    killBar.total += 1;
  }
  killBarRender();
}

function killBarMarkCurrent(pid) {
  if (!killBar.active) return;
  if (killBar.currentPid != null && killBar.blocks.has(killBar.currentPid)) {
    killBar.blocks.get(killBar.currentPid).classList.remove("kb-cur");
  }
  killBar.currentPid = pid;
  const block = killBar.blocks.get(pid);
  if (block) {
    block.classList.add("kb-cur");
    block.title = `PID ${pid} — killing...`;
  }
  const proc = processMap.get(pid);
  killBarRender(proc ? { name: proc.name, pid } : null);
}

function killBarResolve(pid, ok) {
  if (!killBar.active) return;
  const block = killBar.blocks.get(pid);
  if (!block) return;
  block.classList.remove("kb-cur");
  block.classList.add(ok ? "kb-ok" : "kb-fail");
  block.title = `PID ${pid} — ${ok ? "killed" : "failed"}`;
  killBar.done += 1;
  if (ok) killBar.ok += 1;
  else killBar.fail += 1;
  if (killBar.currentPid === pid) killBar.currentPid = null;
  killBarRender();
}

function killBarFinish() {
  if (!killBar.active) return;
  if (killBarPacEl) killBarPacEl.classList.add("kb-pac-idle");
  killBarRender();
  killBar.hideTimer = setTimeout(killBarHide, KILL_BAR_AUTOHIDE_MS);
}

function killBarHide() {
  if (killBar.hideTimer) {
    clearTimeout(killBar.hideTimer);
    killBar.hideTimer = null;
  }
  killBar.active = false;
  if (killBarEl) killBarEl.hidden = true;
}

function pruneKillResults() {
  const now = Date.now();
  for (const [pid, res] of killResults) {
    if (res.expiresAt && res.expiresAt <= now) killResults.delete(pid);
    else if (res.state !== "pending" && !processMap.has(pid)) killResults.delete(pid);
  }
}

function queueKills(pids) {
  // Hard guard: the agent (proc.self) maintains the connection and can never
  // be killed from the UI, regardless of the kill path taken.
  const valid = [...new Set(pids)].filter((pid) => {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    const proc = processMap.get(pid);
    return !proc || !proc.self;
  });
  if (!valid.length) return;
  if (!killBatchStats) {
    killBatchStats = { killed: 0, denied: 0, notfound: 0, failed: 0, timeout: 0, offline: 0 };
  }
  for (const pid of valid) {
    killResults.set(pid, { state: "pending", category: "", text: "Kill queued...", expiresAt: 0 });
    killQueue.push(pid);
  }
  killBarBegin(valid);
  updateStatus("ok", `Killing ${valid.length} process${valid.length > 1 ? "es" : ""}...`);
  renderProcesses();
  pumpKillQueue();
}

function pumpKillQueue() {
  if (killInFlight) return;
  if (killQueue.length === 0) {
    finalizeKillBatch();
    return;
  }
  const pid = killQueue.shift();
  if (!processMap.has(pid)) {
    recordKillResult(pid, false, "notfound", "Process already exited");
    pumpKillQueue();
    return;
  }
  killInFlight = {
    pid,
    timeout: setTimeout(() => {
      if (!killInFlight || killInFlight.pid !== pid) return;
      killInFlight = null;
      recordKillResult(pid, false, "timeout", "No response from agent (timeout)");
      pumpKillQueue();
    }, KILL_STEP_TIMEOUT_MS),
  };
  killResults.set(pid, { state: "pending", category: "", text: "Killing...", expiresAt: 0 });
  killBarMarkCurrent(pid);
  renderProcesses();
  send({ type: "process_kill", pid });
}

function classifyKillFailure(message) {
  const m = String(message || "");
  if (/access is denied|access denied|privilege|elevation|permission/i.test(m)) {
    return { category: "denied", text: "Access denied · admin/SYSTEM required" };
  }
  if (/parameter is incorrect|not found|no such process|does not exist|invalid pid/i.test(m)) {
    return { category: "notfound", text: m || "Process not found" };
  }
  if (/timeout|no response/i.test(m)) return { category: "timeout", text: m };
  return { category: "failed", text: m || "Unknown error" };
}

function recordKillResult(pid, ok, category, text) {
  let cat = category;
  let label = text;
  if (ok) {
    cat = "killed";
    label = "Killed";
  }
  killResults.set(pid, { state: "done", category: cat, text: label, expiresAt: Date.now() + KILL_RESULT_TTL_MS });
  if (killBatchStats && Object.prototype.hasOwnProperty.call(killBatchStats, cat)) {
    killBatchStats[cat] += 1;
  } else if (killBatchStats) {
    killBatchStats.failed += 1;
  }
  killBarResolve(pid, ok);
  renderProcesses();
}

function handleCommandResult(msg) {
  const pid = Number(msg?.pid);
  const action = typeof msg?.action === "string" ? msg.action : "kill";
  if (action !== "kill") {
    updateStatus(
      msg.ok ? "ok" : "err",
      msg.ok ? `${action} OK (PID ${pid})` : `${action} failed (PID ${pid}): ${msg.message || "error"}`,
    );
    setTimeout(() => requestProcessList(), 400);
    return;
  }
  // Only attribute results to our own in-flight kill; anything else is foreign/stale.
  if (!killInFlight || killInFlight.pid !== pid) return;
  clearTimeout(killInFlight.timeout);
  killInFlight = null;
  if (msg.ok) {
    recordKillResult(pid, true);
  } else {
    const { category, text } = classifyKillFailure(msg.message);
    recordKillResult(pid, false, category, text);
  }
  setTimeout(() => requestProcessList(), 500);
  pumpKillQueue();
}

function finalizeKillBatch() {
  if (!killBatchStats) return;
  const s = killBatchStats;
  killBatchStats = null;
  const total = s.killed + s.denied + s.notfound + s.failed + s.timeout + s.offline;
  killBarFinish();
  if (!total) return;
  const parts = [];
  if (s.killed) parts.push(`<span class="ok">✔ killed ${s.killed}</span>`);
  if (s.denied) parts.push(`<span class="bad">⛔ access denied ${s.denied}</span>`);
  if (s.notfound) parts.push(`<span class="warn">? not found ${s.notfound}</span>`);
  if (s.failed) parts.push(`<span class="bad">✖ failed ${s.failed}</span>`);
  if (s.timeout) parts.push(`<span class="warn">⏱ timeout ${s.timeout}</span>`);
  if (s.offline) parts.push(`<span class="bad">⚡ offline ${s.offline}</span>`);
  showKillSummary(parts.join(" · "));
  updateStatus(s.failed || s.denied || s.timeout || s.offline ? "err" : "ok", "Kill batch complete");
}

function showKillSummary(html) {
  if (!summaryEl) summaryEl = document.getElementById("proc2-summary");
  if (!summaryEl) return;
  summaryEl.innerHTML = `<i class="fa-solid fa-skull-crossbones"></i>&nbsp;${html}`;
  summaryEl.hidden = false;
  if (summaryTimer) clearTimeout(summaryTimer);
  summaryTimer = setTimeout(() => {
    summaryEl.hidden = true;
  }, 8000);
}

function failKillQueue(category, text) {
  if (killInFlight) {
    clearTimeout(killInFlight.timeout);
    const pid = killInFlight.pid;
    killInFlight = null;
    recordKillResult(pid, false, category, text);
  }
  while (killQueue.length) {
    recordKillResult(killQueue.shift(), false, category, text);
  }
  finalizeKillBatch();
}

function killSelected() {
  queueKills([...selectedPids]);
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
  const n = selectedPids.size;
  const killItem = contextMenuEl.querySelector('[data-action="kill"]');
  if (killItem) {
    killItem.innerHTML = `<i class="fa-solid fa-skull-crossbones" style="color:#f87171"></i> Kill${n > 1 ? ` (${n})` : ""}`;
  }
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
    case "kill": {
      // No confirmation: kill the whole selection immediately, one by one.
      const targets = selectedPids.size ? [...selectedPids] : [pid];
      queueKills(targets);
      break;
    }
    case "kill-tree":
      if (!proc) break;
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
  queueKills(toKill);
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
if (killBtn) killBtn.onclick = () => killSelected();
if (selectAllBtn) selectAllBtn.onclick = () => selectAllVisible();
if (killBarCloseBtn) killBarCloseBtn.onclick = () => killBarHide();

if (searchInput) {
  searchInput.oninput = (e) => {
    searchTerm = e.target.value;
    renderProcesses();
  };
}

if (hideSafeBtn) {
  hideSafeBtn.onclick = () => {
    hideKnownSafe = !hideKnownSafe;
    hideSafeBtn.classList.toggle("active", hideKnownSafe);
    hideSafeBtn.title = hideKnownSafe
      ? "Showing only unknown/suspicious processes — click to show all"
      : "Hide known-safe processes (show only unknown/suspicious; the agent is never shown)";
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
