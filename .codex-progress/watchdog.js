const fs = require("fs");
const path = require("path");

const WATCHDOG_VERSION = "1.0.0";
const STALE_AFTER_MS = 5 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 1000;
const progressPath = path.join(__dirname, "progress.json");
const statusPath = path.join(__dirname, "watchdog.json");

function inspectProgress() {
  const checkedAt = Date.now();
  let status = "waiting";
  let lastProgressAt = null;
  let staleForMs = null;
  let detail = "Waiting for progress telemetry";

  try {
    const stat = fs.statSync(progressPath);
    lastProgressAt = stat.mtimeMs;
    staleForMs = Math.max(0, checkedAt - lastProgressAt);
    status = staleForMs >= STALE_AFTER_MS ? "stalled" : "healthy";
    detail = status === "stalled"
      ? `No real progress update for ${Math.floor(staleForMs / 1000)} seconds`
      : `Last real progress update ${Math.floor(staleForMs / 1000)} seconds ago`;
  } catch (error) {
    status = "error";
    detail = error instanceof Error ? error.message : String(error);
  }

  const temporaryPath = `${statusPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify({
    version: WATCHDOG_VERSION,
    status,
    detail,
    checkedAt,
    lastProgressAt,
    staleForMs,
    staleAfterMs: STALE_AFTER_MS,
  }));
  fs.renameSync(temporaryPath, statusPath);
}

inspectProgress();
setInterval(inspectProgress, CHECK_INTERVAL_MS).unref();
console.log(`Overlord progress watchdog v${WATCHDOG_VERSION} active; stale threshold=${STALE_AFTER_MS}ms`);
setInterval(() => {}, 60 * 60 * 1000);
