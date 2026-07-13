const $ = (id) => document.getElementById(id);
const history = [];
let manifest = [];

const formatBytes = (n) => {
  if (!Number.isFinite(n)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n, i = 0;
  while (value >= 1000 && i < units.length - 1) { value /= 1000; i++; }
  return `${value.toFixed(i ? 2 : 0)} ${units[i]}`;
};
const clock = (seconds) => {
  if (!Number.isFinite(seconds)) return "--:--";
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const shortClock = (seconds) => Number.isFinite(seconds) ? clock(seconds).slice(3) : "--:--";

function drawSparkline() {
  const canvas = $("sparkline"), ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h); ctx.strokeStyle = "#69f59d"; ctx.lineWidth = 2; ctx.beginPath();
  const max = Math.max(...history, 1);
  history.forEach((value, i) => {
    const x = history.length === 1 ? 0 : i / (history.length - 1) * w;
    const y = h - (value / max) * (h - 8) - 4;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function renderQueue(snapshot) {
  const queue = $("queue");
  if (!manifest.length) return;
  queue.innerHTML = manifest.map((item) => {
    const current = item.name === snapshot.current_file;
    const done = manifest.findIndex((x) => x.name === item.name) < snapshot.files_completed;
    const error = snapshot.errors.some((x) => x.includes(item.name));
    const cls = error ? "error" : current ? "active" : done ? "done" : "";
    return `<li class="${cls}" title="${item.source}">${item.name}</li>`;
  }).join("");
  $("queue-state").textContent = `${manifest.length} ITEMS`;
}

function render(s) {
  const percent = s.current_expected ? s.current_bytes / s.current_expected * 100 : 0;
  const totalPercent = s.total_bytes ? s.bytes_copied / s.total_bytes * 100 : 0;
  const status = $("status");
  status.textContent = s.status;
  status.className = `status status-${String(s.status).toLowerCase()}`;
  $("current-file").textContent = s.current_file || "Awaiting worker…";
  $("current-bar").style.width = `${Math.min(100, percent)}%`;
  $("total-bar").style.width = `${Math.min(100, totalPercent)}%`;
  $("current-bytes").textContent = `${formatBytes(s.current_bytes)} / ${formatBytes(s.current_expected)}`;
  $("current-percent").textContent = `${Math.round(percent)}%`;
  $("total-bytes").textContent = `${formatBytes(s.bytes_copied)} / ${formatBytes(s.total_bytes)}`;
  $("files").textContent = `${s.files_completed} / ${s.total_files} files`;
  $("eta").textContent = `ETA ${shortClock(s.eta_seconds)}`;
  $("speed").textContent = formatBytes(s.bytes_per_second) + "/s";
  $("elapsed").textContent = clock(s.elapsed_seconds);
  $("errors").textContent = s.errors.length;
  if (s.bytes_per_second > 0) { history.push(s.bytes_per_second); if (history.length > 80) history.shift(); drawSparkline(); }
  renderQueue(s);
  $("footer-message").textContent = s.status === "DONE" ? "ALL FILES VERIFIED // TELEGRAM NOTIFIED" : s.status === "ERROR" ? "TRANSFER HALTED WITH ERRORS // REVIEW QUEUE" : "SCP PROGRESS METER // SIZE VERIFY ON";
}

async function boot() {
  manifest = await fetch("/manifest.json").then((r) => r.json());
  const update = (event) => render(JSON.parse(event.data));
  const source = new EventSource("/events"); source.onmessage = update;
  const initial = await fetch("/api/status").then((r) => r.json()); render(initial);
}
boot().catch((error) => { $("footer-message").textContent = `TRACKER ERROR // ${error.message}`; });
