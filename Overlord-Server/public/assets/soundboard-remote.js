/**
 * soundboard-remote.js — Dashboard 2.0 style remote sound board
 * Version: 1.3.0
 * Workflow: Add to library → Upload to PC → Play (unlocked after upload)
 */
const SOUNDBOARD_REMOTE_JS_VERSION = "1.3.0";

const params = new URLSearchParams(location.search);
const clientId = params.get("clientId") || "";

const els = {
  clientId: document.getElementById("client-id"),
  linkDot: document.getElementById("link-dot"),
  linkLabel: document.getElementById("link-label"),
  linkDetail: document.getElementById("link-detail"),
  linkRefresh: document.getElementById("link-refresh"),
  volumeSlider: document.getElementById("volume-slider"),
  volumeValue: document.getElementById("volume-value"),
  volumeMuted: document.getElementById("volume-muted"),
  volumeRefresh: document.getElementById("volume-refresh"),
  volumeMax: document.getElementById("volume-max"),
  activityPhase: document.getElementById("activity-phase"),
  activityDetail: document.getElementById("activity-detail"),
  progressBar: document.getElementById("progress-bar"),
  progressLabel: document.getElementById("progress-label"),
  progressPct: document.getElementById("progress-pct"),
  soundGrid: document.getElementById("sound-grid"),
  emptyHint: document.getElementById("empty-hint"),
  uploadInput: document.getElementById("upload-input"),
  stopClient: document.getElementById("stop-client"),
};

let sounds = [];
/** @type {Set<string>} */
let readyOnClient = new Set();
let volumeBusy = false;
let rowBusyId = null;
let previewAudio = null;
let previewId = null;
let activePlayId = null;
let volumeDebounce = null;
let linkState = { kind: "off", label: "Unknown", detail: "", pingMs: null };

function setActivity(phase, detail = "", kind = "", percent = null, barLabel = null) {
  if (els.activityPhase) {
    els.activityPhase.textContent = phase;
    els.activityPhase.className = "activity-phase" + (kind ? ` ${kind}` : "");
  }
  if (els.activityDetail) els.activityDetail.textContent = detail || "";
  if (percent != null) {
    const pct = Math.max(0, Math.min(100, Math.round(percent)));
    if (els.progressBar) els.progressBar.style.width = `${pct}%`;
    if (els.progressPct) els.progressPct.textContent = `${pct}%`;
  }
  if (barLabel != null && els.progressLabel) els.progressLabel.textContent = barLabel;
}

function setLink(kind, label, detail, pingMs = null) {
  linkState = { kind, label, detail, pingMs };
  if (els.linkDot) els.linkDot.className = `link-dot ${kind}`;
  if (els.linkLabel) els.linkLabel.textContent = label;
  if (els.linkDetail) els.linkDetail.textContent = detail;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    ...opts,
    headers: {
      ...(opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function stopPreview() {
  if (previewAudio) {
    try {
      previewAudio.pause();
      previewAudio.src = "";
    } catch {}
  }
  previewAudio = null;
  previewId = null;
  renderGrid();
}

function playPreview(sound) {
  if (previewId === sound.id && previewAudio && !previewAudio.paused) {
    stopPreview();
    setActivity("Idle", "Preview stopped.");
    return;
  }
  stopPreview();
  previewId = sound.id;
  setActivity("Previewing", `Local preview: ${sound.name}`, "busy", 0, "local only");
  previewAudio = new Audio(`/api/soundboard/sounds/${encodeURIComponent(sound.id)}/file`);
  previewAudio.addEventListener("ended", () => {
    previewId = null;
    previewAudio = null;
    setActivity("Idle", "Preview finished.");
    renderGrid();
  });
  previewAudio.addEventListener("error", () => {
    setActivity("Preview failed", "Could not play local preview.", "err", 0, "error");
    stopPreview();
  });
  void previewAudio.play().catch((err) => {
    setActivity("Preview failed", err.message || "Browser blocked audio", "err", 0, "error");
    stopPreview();
  });
  renderGrid();
}

function applyVolumeUI(level, muted) {
  if (typeof level === "number" && Number.isFinite(level)) {
    els.volumeSlider.disabled = false;
    els.volumeSlider.value = String(level);
    els.volumeValue.textContent = `${level}%`;
  }
  if (els.volumeMuted) els.volumeMuted.classList.toggle("on", !!muted);
}

async function checkConnection() {
  if (!clientId) {
    setLink("off", "No client", "Missing clientId in URL");
    return;
  }
  setLink("off", "Checking…", "Sending ping");
  const t0 = performance.now();
  try {
    const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/command`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ping", waitForResult: true }),
    });
    const data = await res.json().catch(() => ({}));
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);

    let kind = "strong";
    let label = "Strong";
    if (ms > 400) {
      kind = "weak";
      label = "Weak";
    } else if (ms > 150) {
      kind = "ok";
      label = "Good";
    }
    setLink(kind, `${label} link`, `Ping ${ms} ms · client online`, ms);
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    setLink("bad", "No response", err.message || "Client offline or unreachable", ms);
  }
}

async function refreshVolume() {
  if (!clientId) return;
  try {
    if (!rowBusyId) setActivity("Reading volume", "Asking client for system volume…", "busy");
    const data = await api(`/api/clients/${encodeURIComponent(clientId)}/volume`);
    applyVolumeUI(data.level, data.muted);
    if (!rowBusyId) {
      setActivity(
        "Idle",
        data.muted
          ? `Volume ${data.level}% (muted). Upload a sound, then Play.`
          : `Volume ${data.level}%. Upload a sound, then Play.`,
        "ok",
        0,
        "ready",
      );
    }
  } catch (err) {
    if (!rowBusyId) {
      setActivity("Volume unavailable", err.message || "Could not read volume", "err", 0, "error");
    }
  }
}

async function setVolume(level, max = false) {
  if (!clientId || volumeBusy) return;
  volumeBusy = true;
  try {
    setActivity(max ? "Setting max volume" : "Setting volume", max ? "Unmuting and setting 100%…" : `Setting ${level}%…`, "busy");
    const data = await api(`/api/clients/${encodeURIComponent(clientId)}/volume`, {
      method: "PUT",
      body: JSON.stringify(max ? { max: true } : { level }),
    });
    applyVolumeUI(data.level ?? (max ? 100 : level), data.muted);
    setActivity("Volume updated", `Client volume is now ${data.level ?? level}%`, "ok", 100, "done");
  } catch (err) {
    setActivity("Volume failed", err.message || "Could not set volume", "err", 0, "error");
  } finally {
    volumeBusy = false;
  }
}

async function loadClientStatus() {
  if (!clientId) {
    readyOnClient = new Set();
    return;
  }
  try {
    const data = await api(`/api/clients/${encodeURIComponent(clientId)}/soundboard/status`);
    const ids = Array.isArray(data.readySoundIds) ? data.readySoundIds : [];
    readyOnClient = new Set(ids.map(String));
  } catch {
    readyOnClient = new Set();
  }
}

async function loadSounds() {
  const data = await api("/api/soundboard/sounds");
  sounds = Array.isArray(data.sounds) ? data.sounds : [];
  await loadClientStatus();
  renderGrid();
}

function renderGrid() {
  if (!els.soundGrid) return;
  els.soundGrid.innerHTML = "";
  if (!sounds.length) {
    if (els.emptyHint) els.emptyHint.style.display = "block";
    return;
  }
  if (els.emptyHint) els.emptyHint.style.display = "none";

  for (const sound of sounds) {
    const row = document.createElement("div");
    const isPreview = previewId === sound.id;
    const isPlaying = activePlayId === sound.id;
    const onClient = readyOnClient.has(sound.id);
    const busy = rowBusyId === sound.id;
    const anyBusy = !!rowBusyId;
    row.className =
      "sound-row" +
      (isPlaying || isPreview ? " is-active" : "") +
      (onClient ? " is-on-client" : "");
    row.innerHTML = `
      <div>
        <div class="sound-name" title="${escapeAttr(sound.name)}">${escapeHtml(sound.name)}</div>
        <div class="sound-meta">${escapeHtml((sound.ext || "").toUpperCase())} · ${formatBytes(sound.size)}${
          sound.durationSec ? ` · ${sound.durationSec}s` : ""
        } · ${onClient ? "on PC" : "library only"}</div>
      </div>
      <div class="sound-acts">
        <button type="button" class="btn btn-preview" data-act="preview" ${anyBusy && !busy ? "disabled" : ""}>${
          isPreview ? "Stop" : "Preview"
        }</button>
        <button type="button" class="btn btn-upload" data-act="upload" ${
          anyBusy || onClient ? "disabled" : ""
        } title="${onClient ? "Already on this PC" : "Copy sound onto the remote PC"}">${
          onClient ? "On PC" : busy && !isPlaying ? "Uploading…" : "Upload to PC"
        }</button>
        <button type="button" class="btn btn-play" data-act="play" ${
          anyBusy || !onClient ? "disabled" : ""
        } title="${onClient ? "Play on remote speakers" : "Upload to PC first"}">${
          isPlaying ? "Playing…" : "Play"
        }</button>
        <button type="button" class="btn btn-del" data-act="delete" title="Delete from library" ${
          anyBusy ? "disabled" : ""
        }>✕</button>
      </div>
    `;
    row.querySelector('[data-act="preview"]')?.addEventListener("click", () => playPreview(sound));
    row.querySelector('[data-act="upload"]')?.addEventListener("click", () => uploadToClient(sound));
    row.querySelector('[data-act="play"]')?.addEventListener("click", () => playOnClient(sound));
    row.querySelector('[data-act="delete"]')?.addEventListener("click", () => deleteSound(sound));
    els.soundGrid.appendChild(row);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollJob(statusPath, soundName, mode) {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await sleep(300);
    const st = await api(statusPath);
    const pct = Number(st.percent) || 0;
    const phase = st.phase || st.status || "working";
    const transferred = Number(st.bytesTransferred) || 0;
    const total = Number(st.totalBytes) || 0;

    if (mode === "upload") {
      let title = "Uploading to PC";
      let detail = `Copying “${soundName}” onto the remote PC…`;
      let barLabel = phase;
      if (phase === "queued") {
        title = "Queued";
        detail = `Waiting to send “${soundName}”…`;
      } else if (phase === "client_transfer" && total > 0) {
        barLabel = `${formatBytes(transferred)} / ${formatBytes(total)}`;
        detail = `Uploading “${soundName}” — ${formatBytes(transferred)} of ${formatBytes(total)}`;
      } else if (phase === "succeeded") {
        title = "On PC";
        detail = `“${soundName}” is ready. Press Play anytime.`;
        barLabel = "ready";
      }
      setActivity(title, detail, st.status === "failed" ? "err" : "busy", pct, barLabel);
    } else {
      let title = "Starting playback";
      let detail = `Playing “${soundName}” on client speakers…`;
      if (phase === "succeeded") {
        title = "Playing";
        detail = `“${soundName}” is playing on the client speakers.`;
      }
      setActivity(title, detail, st.status === "failed" ? "err" : "busy", pct, phase);
    }

    if (st.status === "succeeded") return st;
    if (st.status === "failed") {
      throw new Error(st.error?.message || (mode === "upload" ? "Upload failed" : "Play failed"));
    }
  }
  throw new Error("Timed out waiting for client");
}

async function uploadToClient(sound) {
  if (!clientId || rowBusyId) return;
  if (readyOnClient.has(sound.id)) {
    setActivity("Already on PC", `“${sound.name}” is already uploaded. Press Play.`, "ok", 100, "ready");
    return;
  }
  rowBusyId = sound.id;
  renderGrid();
  try {
    setActivity("Starting upload", `Preparing “${sound.name}”…`, "busy", 2, "starting");
    const started = await api(`/api/clients/${encodeURIComponent(clientId)}/soundboard/upload`, {
      method: "POST",
      body: JSON.stringify({ soundId: sound.id }),
    });

    if (started.alreadyUploaded) {
      readyOnClient.add(sound.id);
      setActivity("Already on PC", `“${sound.name}” is ready. Press Play.`, "ok", 100, "ready");
      return;
    }

    const jobId = started.jobId;
    if (!jobId) throw new Error("Server did not return an upload job");

    await pollJob(
      `/api/clients/${encodeURIComponent(clientId)}/soundboard/upload/${encodeURIComponent(jobId)}`,
      sound.name,
      "upload",
    );
    readyOnClient.add(sound.id);
    setActivity("On PC", `“${sound.name}” uploaded. Play is unlocked.`, "ok", 100, "ready");
  } catch (err) {
    setActivity("Upload failed", err.message || "Unknown error", "err", 0, "error");
  } finally {
    rowBusyId = null;
    renderGrid();
  }
}

async function playOnClient(sound) {
  if (!clientId || rowBusyId) return;
  if (!readyOnClient.has(sound.id)) {
    setActivity("Upload first", `Upload “${sound.name}” to the PC before playing.`, "err", 0, "locked");
    return;
  }
  rowBusyId = sound.id;
  activePlayId = sound.id;
  renderGrid();
  try {
    setActivity("Starting", `Playing “${sound.name}”…`, "busy", 5, "play");
    const started = await api(`/api/clients/${encodeURIComponent(clientId)}/soundboard/play`, {
      method: "POST",
      body: JSON.stringify({ soundId: sound.id }),
    });
    const jobId = started.jobId;
    if (!jobId) throw new Error("Server did not return a play job");

    await pollJob(
      `/api/clients/${encodeURIComponent(clientId)}/soundboard/play/${encodeURIComponent(jobId)}`,
      sound.name,
      "play",
    );
    setActivity(
      "Playing on client",
      `Success — “${sound.name}” is playing on their speakers.`,
      "ok",
      100,
      "playing",
    );
  } catch (err) {
    const msg = err.message || "Unknown error";
    if (/not on the client|upload to pc first|not_uploaded|not found|hash mismatch/i.test(msg)) {
      readyOnClient.delete(sound.id);
    }
    setActivity("Play failed", msg, "err", 0, "error");
  } finally {
    rowBusyId = null;
    activePlayId = null;
    renderGrid();
  }
}

async function stopOnClient() {
  if (!clientId) return;
  try {
    setActivity("Stopping", "Sending stop to client…", "busy", 50, "stop");
    await api(`/api/clients/${encodeURIComponent(clientId)}/soundboard/stop`, {
      method: "POST",
      body: "{}",
    });
    setActivity("Stopped", "Playback stopped on client.", "ok", 100, "stopped");
  } catch (err) {
    setActivity("Stop failed", err.message || "Could not stop", "err", 0, "error");
  }
}

async function deleteSound(sound) {
  if (!confirm(`Delete “${sound.name}” from the library?`)) return;
  try {
    await api(`/api/soundboard/sounds/${encodeURIComponent(sound.id)}`, { method: "DELETE" });
    if (previewId === sound.id) stopPreview();
    readyOnClient.delete(sound.id);
    await loadSounds();
    setActivity("Deleted", `Removed “${sound.name}” from library.`, "ok");
  } catch (err) {
    setActivity("Delete failed", err.message || "Could not delete", "err");
  }
}

function probeDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (sec) => {
      URL.revokeObjectURL(url);
      resolve(sec);
    };
    audio.addEventListener("loadedmetadata", () => {
      const d = audio.duration;
      done(Number.isFinite(d) ? d : undefined);
    });
    audio.addEventListener("error", () => done(undefined));
    setTimeout(() => done(undefined), 4000);
    audio.src = url;
  });
}

async function onUpload(file) {
  if (!file) return;
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".mp3") && !lower.endsWith(".wav")) {
    setActivity("Upload rejected", "Only MP3 or WAV files.", "err");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    setActivity("Upload rejected", "Max file size is 5 MB.", "err");
    return;
  }
  setActivity("Adding to library", `Adding “${file.name}”…`, "busy", 10, "library");
  const durationSec = await probeDuration(file);
  if (typeof durationSec === "number" && durationSec > 30.5) {
    setActivity("Upload rejected", `Too long (${durationSec.toFixed(1)}s). Max 30 seconds.`, "err");
    return;
  }
  const form = new FormData();
  form.append("file", file);
  if (typeof durationSec === "number") form.append("durationSec", String(durationSec));
  try {
    await api("/api/soundboard/sounds", { method: "POST", body: form });
    await loadSounds();
    setActivity("In library", `“${file.name}” added. Upload to PC, then Play.`, "ok", 100, "done");
  } catch (err) {
    setActivity("Library add failed", err.message || "Could not upload", "err", 0, "error");
  }
}

function bind() {
  els.linkRefresh?.addEventListener("click", () => void checkConnection());
  els.volumeRefresh?.addEventListener("click", () => void refreshVolume());
  els.volumeMax?.addEventListener("click", () => void setVolume(100, true));
  els.volumeSlider?.addEventListener("input", () => {
    const v = Number(els.volumeSlider.value);
    els.volumeValue.textContent = `${v}%`;
    clearTimeout(volumeDebounce);
    volumeDebounce = setTimeout(() => void setVolume(v), 280);
  });
  els.stopClient?.addEventListener("click", () => void stopOnClient());
  els.uploadInput?.addEventListener("change", () => {
    const file = els.uploadInput.files?.[0];
    els.uploadInput.value = "";
    void onUpload(file);
  });
}

async function main() {
  if (els.clientId) els.clientId.textContent = clientId ? clientId.slice(0, 16) : "no client";
  if (!clientId) {
    setLink("off", "No client", "Open Sound Board from a client side panel");
    setActivity("Not connected", "Missing clientId.", "err");
    return;
  }
  bind();
  setActivity("Loading", "Loading sound library…", "busy", 5, "load");
  try {
    await loadSounds();
    setActivity("Idle", "Ready. Upload a sound to the PC, then press Play.", "ok", 0, "ready");
  } catch (err) {
    setActivity("Load failed", err.message || "Could not load library", "err");
  }
  void checkConnection();
  void refreshVolume();
  setInterval(() => {
    if (!rowBusyId) void checkConnection();
  }, 15000);
}

void main();

export { SOUNDBOARD_REMOTE_JS_VERSION };
