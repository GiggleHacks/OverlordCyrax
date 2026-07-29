/** Progress tracker updater — real milestone/elapsed updates. v1.0.0 */
const fs = require("fs");
const path = require("path");

const UPDATER_VERSION = "1.0.0";
const progressPath = path.join(__dirname, "progress.json");

const [, , taskName, status, detail, event] = process.argv;
if (!taskName || !status) {
  console.error(`update.js v${UPDATER_VERSION} usage: node update.js <taskName> <status> [detail] [event]`);
  process.exit(1);
}

const raw = fs.readFileSync(progressPath, "utf8");
const progress = JSON.parse(raw);

const now = Date.now();
if (!progress.startedAt) progress.startedAt = now;
const elapsedSec = Math.max(0, Math.floor((now - progress.startedAt) / 1000));
const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
const ss = String(elapsedSec % 60).padStart(2, "0");
progress.elapsed = `${mm}:${ss}`;
progress.updaterVersion = UPDATER_VERSION;

const task = progress.tasks.find((t) => t.name === taskName);
if (task) {
  task.status = status;
  if (detail) task.detail = detail;
} else {
  progress.tasks.push({ name: taskName, status, detail: detail || "" });
}
if (event) progress.event = event;

const tmpPath = `${progressPath}.tmp`;
fs.writeFileSync(tmpPath, JSON.stringify(progress));
fs.renameSync(tmpPath, progressPath);
console.log(`update.js v${UPDATER_VERSION}: ${taskName} -> ${status} (${progress.elapsed})`);
