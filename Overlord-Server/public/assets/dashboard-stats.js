let initialized = false;
let metricsTimer = null;
let onlineChart = null;
let osChart = null;
const STATS_COLLAPSED_KEY = "overlord_dashboard_stats_collapsed";

const palette = {
  text: "#cbd5e1",
  muted: "#94a3b8",
  border: "rgba(100, 116, 139, 0.18)",
  panel: "rgba(15, 23, 42, 0.96)",
  cyan: "#22d3ee",
  emerald: "#34d399",
  sky: "#38bdf8",
  indigo: "#818cf8",
  amber: "#fbbf24",
  rose: "#fb7185",
  violet: "#a78bfa",
  slate: "#64748b",
};

const osColors = [
  palette.sky,
  palette.emerald,
  palette.violet,
  palette.amber,
  palette.rose,
  palette.cyan,
  palette.indigo,
  palette.slate,
];

function $(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function formatNumber(value) {
  const n = Number(value) || 0;
  return n.toLocaleString();
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, idx)).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatTime(timestamp) {
  return new Date(timestamp || Date.now()).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatWeekLabel(timestamp) {
  const date = new Date(timestamp || Date.now());
  return date.toLocaleDateString([], {
    weekday: "short",
    hour: "2-digit",
  });
}

function aggregateOnlineHistory(history, snapshot) {
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const source = Array.isArray(history)
    ? history.filter((row) => Number(row?.timestamp) >= weekAgo)
    : [];
  const rows = source.length
    ? source
    : [{ timestamp: now, clientsOnline: snapshot?.clients?.online || 0 }];
  const maxPoints = 84;
  if (rows.length <= maxPoints) return rows;

  const bucketMs = Math.max(
    60 * 60 * 1000,
    Math.ceil((now - weekAgo) / maxPoints),
  );
  const buckets = new Map();
  for (const row of rows) {
    const ts = Number(row.timestamp) || now;
    const key = Math.floor(ts / bucketMs) * bucketMs;
    const bucket = buckets.get(key) || { timestamp: key, total: 0, count: 0, peak: 0 };
    const online = Number(row.clientsOnline) || 0;
    bucket.total += online;
    bucket.count += 1;
    bucket.peak = Math.max(bucket.peak, online);
    buckets.set(key, bucket);
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((bucket) => ({
      timestamp: bucket.timestamp,
      clientsOnline: Math.round(bucket.total / Math.max(1, bucket.count)),
      clientsPeak: bucket.peak,
    }));
}

function setDotTone(id, tone) {
  const el = $(id);
  if (!el) return;
  el.classList.toggle("is-live", tone === "live");
  el.classList.toggle("is-warn", tone === "warn");
  el.classList.toggle("is-bad", tone === "bad");
  el.classList.toggle("is-muted", tone === "muted");
}

function topEntries(record, limit = 6) {
  return Object.entries(record || {})
    .map(([key, value]) => [key || "Unknown", Number(value) || 0])
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function compactOsLabel(os) {
  const text = String(os || "Unknown");
  const lower = text.toLowerCase();
  if (lower.includes("windows 11")) return "Win 11";
  if (lower.includes("windows 10")) return "Win 10";
  if (lower.includes("windows")) return "Windows";
  if (lower.includes("darwin") || lower.includes("mac")) return "macOS";
  if (lower.includes("ubuntu")) return "Ubuntu";
  if (lower.includes("debian")) return "Debian";
  if (lower.includes("kali")) return "Kali";
  if (lower.includes("fedora")) return "Fedora";
  if (lower.includes("linux")) return "Linux";
  return text.length > 16 ? `${text.slice(0, 15)}...` : text;
}

function configureChartDefaults() {
  if (typeof Chart === "undefined") return false;
  Chart.defaults.color = palette.text;
  Chart.defaults.borderColor = palette.border;
  Chart.defaults.font.family = "Inter, Segoe UI, system-ui, sans-serif";
  return true;
}

function createGradient(ctx, color) {
  const gradient = ctx.createLinearGradient(0, 0, 0, 150);
  gradient.addColorStop(0, `${color}55`);
  gradient.addColorStop(0.72, `${color}12`);
  gradient.addColorStop(1, `${color}00`);
  return gradient;
}

function makeCharts() {
  if (!configureChartDefaults()) return false;
  const onlineCanvas = $("dash-online-chart");
  const osCanvas = $("dash-os-chart");
  if (!onlineCanvas || !osCanvas) return false;

  const onlineCtx = onlineCanvas.getContext("2d");
  onlineChart = new Chart(onlineCtx, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label: "Online",
        data: [],
        borderColor: palette.cyan,
        backgroundColor: createGradient(onlineCtx, palette.cyan),
        borderWidth: 2,
        fill: true,
        tension: 0.38,
        pointRadius: 0,
        pointHoverRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 260 },
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: palette.panel,
          borderColor: "rgba(56, 189, 248, 0.32)",
          borderWidth: 1,
          titleColor: "#e2e8f0",
          bodyColor: palette.text,
          displayColors: false,
          callbacks: {
            label: (ctx) => `Avg online: ${ctx.parsed.y}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: palette.muted, maxRotation: 0, maxTicksLimit: 5 },
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(100, 116, 139, 0.1)" },
          ticks: { color: palette.muted, precision: 0, maxTicksLimit: 4 },
        },
      },
    },
  });

  osChart = new Chart(osCanvas, {
    type: "doughnut",
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: osColors,
        borderColor: "rgba(2, 6, 23, 0.9)",
        borderWidth: 3,
        hoverOffset: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 260 },
      cutout: "66%",
      plugins: {
        legend: {
          position: "right",
          labels: {
            boxWidth: 9,
            boxHeight: 9,
            color: palette.text,
            padding: 10,
            font: { size: 11 },
          },
        },
        tooltip: {
          backgroundColor: palette.panel,
          borderColor: "rgba(129, 140, 248, 0.32)",
          borderWidth: 1,
          titleColor: "#e2e8f0",
          bodyColor: palette.text,
        },
      },
    },
  });
  return true;
}

function updateOnlineChart(history, snapshot) {
  if (!onlineChart) return;
  const rows = aggregateOnlineHistory(history, snapshot);

  onlineChart.data.labels = rows.map((row) => formatWeekLabel(row.timestamp));
  onlineChart.data.datasets[0].data = rows.map((row) => Number(row.clientsOnline) || 0);
  onlineChart.update("none");
}

function updateOsChart(byOS) {
  if (!osChart) return;
  const entries = topEntries(byOS, 7);
  if (!entries.length) {
    osChart.data.labels = ["No clients"];
    osChart.data.datasets[0].data = [1];
    osChart.data.datasets[0].backgroundColor = ["rgba(100, 116, 139, 0.35)"];
    setText("dash-os-leader", "None");
    osChart.update("none");
    return;
  }

  osChart.data.labels = entries.map(([label]) => compactOsLabel(label));
  osChart.data.datasets[0].data = entries.map(([, count]) => count);
  osChart.data.datasets[0].backgroundColor = entries.map((_, index) => osColors[index % osColors.length]);
  setText("dash-os-leader", `${compactOsLabel(entries[0][0])} ${entries[0][1]}`);
  osChart.update("none");
}

function updateSummary(snapshot) {
  const clients = snapshot?.clients || {};
  const online = Number(clients.online) || 0;
  const total = Number(clients.total) || 0;
  const ratio = total > 0 ? Math.round((online / total) * 100) : 0;
  const sessions = snapshot?.sessions || {};
  const activeSessions =
    (Number(sessions.console) || 0) +
    (Number(sessions.remoteDesktop) || 0) +
    (Number(sessions.fileBrowser) || 0) +
    (Number(sessions.process) || 0);

  setText("dash-online-count", formatNumber(online));
  setText("dash-total-count", `${formatNumber(total)} total`);
  setText("dash-online-ratio", `${ratio}%`);
  setText("dash-session-count", formatNumber(activeSessions));
  setText("dash-command-minute", `${formatNumber(snapshot?.commands?.lastMinute)} cmd/min`);
  setText("dash-http-errors", `${formatNumber(snapshot?.http?.lastMinuteErrors)} errors`);

  const mem = Number(snapshot?.server?.systemMemory?.usedPercent) || 0;
  setText("dash-memory-status", `${Math.round(mem)}%`);
  setDotTone("dash-memory-dot", mem >= 90 ? "bad" : mem >= 75 ? "warn" : "live");

  const avgPing = snapshot?.ping?.avg;
  if (Number.isFinite(avgPing)) {
    const rounded = Math.round(avgPing);
    setText("dash-ping-status", `${rounded} ms`);
    setDotTone("dash-ping-dot", rounded >= 150 ? "bad" : rounded >= 80 ? "warn" : "live");
  } else {
    setText("dash-ping-status", "-");
    setDotTone("dash-ping-dot", "muted");
  }

  setText("dash-trend-status", `${formatBytes(snapshot?.bandwidth?.sentPerSecond || 0)}/s out`);
  setText("dash-last-refresh", formatTime(Date.now()));
}

export function updateDashboardStatsFromClients(data) {
  if (!data) return;
  const online = Number(data.online) || 0;
  const total = Number(data.total) || 0;
  const ratio = total > 0 ? Math.round((online / total) * 100) : 0;
  setText("dash-online-count", formatNumber(online));
  setText("dash-total-count", `${formatNumber(total)} total`);
  setText("dash-online-ratio", `${ratio}%`);
}

async function fetchDashboardMetrics() {
  try {
    const res = await fetch("/api/metrics", { credentials: "include" });
    if (!res.ok) throw new Error(`metrics ${res.status}`);
    const data = await res.json();
    const snapshot = data?.snapshot || {};
    updateSummary(snapshot);
    updateOnlineChart(data?.history || [], snapshot);
    updateOsChart(snapshot?.clients?.byOS || {});
    setText("dash-api-status", "Live");
  } catch (err) {
    console.warn("dashboard stats failed", err);
    setText("dash-api-status", "Error");
    setText("dash-last-refresh", "Error");
  }
}

export function initDashboardStats() {
  if (initialized) return;
  initialized = true;
  if (!makeCharts()) {
    setTimeout(makeCharts, 150);
  }
  initStatsToggle();
  fetchDashboardMetrics();
  metricsTimer = setInterval(fetchDashboardMetrics, 5000);
}

function initStatsToggle() {
  const shell = $("dashboard-stats");
  const button = $("dashboard-stats-toggle");
  if (!shell || !button) return;

  const setCollapsed = (collapsed) => {
    shell.classList.toggle("is-collapsed", collapsed);
    button.setAttribute("aria-expanded", collapsed ? "false" : "true");
    button.title = collapsed ? "Show status overview" : "Hide status overview";
    button.innerHTML = collapsed
      ? '<i class="fa-solid fa-eye"></i>'
      : '<i class="fa-solid fa-eye-slash"></i>';
    localStorage.setItem(STATS_COLLAPSED_KEY, collapsed ? "true" : "false");
  };

  setCollapsed(localStorage.getItem(STATS_COLLAPSED_KEY) === "true");
  button.addEventListener("click", () => {
    const nextCollapsed = !shell.classList.contains("is-collapsed");
    setCollapsed(nextCollapsed);
    if (!nextCollapsed) {
      requestAnimationFrame(() => {
        onlineChart?.resize();
        osChart?.resize();
      });
    }
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (metricsTimer) clearInterval(metricsTimer);
  });
}
