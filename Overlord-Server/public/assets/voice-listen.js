/**
 * Listen-only remote microphone stream (voice uplink playback, no operator mic).
 *
 * Quality presets trade latency vs smoothness. Agent defaults to 16 kHz mono PCM;
 * rebuilt agents may honor quality (e.g. 8 kHz for Fast) and announce via a
 * `format` control message.
 */

const DEFAULT_UPLINK_SAMPLE_RATE = 16000;
const QUALITY_STORAGE_KEY = "overlord.voice.quality";
const SKIP_CONFIRM_KEY = "overlord.voice.mic_confirm_skip";
const DEFAULT_VOICE_QUALITY = "fast";

/** @typedef {"fast" | "balanced" | "smooth"} VoiceQuality */

/**
 * @type {Record<VoiceQuality, {
 *   label: string,
 *   description: string,
 *   sampleRate: number,
 *   minStartMs: number,
 *   maxBufferMs: number,
 *   rebufferMs: number,
 *   frameSize: number,
 *   latencyHint: AudioContextLatencyCategory | string,
 * }>}
 */
export const VOICE_QUALITY_PRESETS = {
  fast: {
    label: "Fast",
    description: "Low quality, lowest latency — default for snappy listen-in",
    sampleRate: 8000,
    minStartMs: 35,
    maxBufferMs: 100,
    rebufferMs: 45,
    frameSize: 256,
    latencyHint: "interactive",
  },
  balanced: {
    label: "Balanced",
    description: "Mix of clarity and delay",
    sampleRate: 16000,
    minStartMs: 200,
    maxBufferMs: 600,
    rebufferMs: 160,
    frameSize: 1024,
    latencyHint: "interactive",
  },
  smooth: {
    label: "Smooth",
    description: "Higher buffer, fewer skips on weak links",
    sampleRate: 16000,
    minStartMs: 350,
    maxBufferMs: 1200,
    rebufferMs: 280,
    frameSize: 2048,
    latencyHint: "playback",
  },
};

/**
 * @param {string} [raw]
 * @returns {VoiceQuality}
 */
export function normalizeVoiceQuality(raw) {
  const q = String(raw || "").trim().toLowerCase();
  if (q === "fast" || q === "low" || q === "lq") return "fast";
  if (q === "smooth" || q === "high" || q === "hq") return "smooth";
  if (q === "balanced" || q === "normal" || q === "medium") return "balanced";
  return DEFAULT_VOICE_QUALITY;
}

/**
 * @returns {VoiceQuality}
 */
export function loadSavedVoiceQuality() {
  try {
    const raw = localStorage.getItem(QUALITY_STORAGE_KEY);
    if (!raw) return DEFAULT_VOICE_QUALITY;
    return normalizeVoiceQuality(raw);
  } catch {
    return DEFAULT_VOICE_QUALITY;
  }
}

/**
 * @returns {boolean}
 */
export function shouldSkipMicConfirm() {
  try {
    return localStorage.getItem(SKIP_CONFIRM_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * @param {boolean} skip
 */
export function setSkipMicConfirm(skip) {
  try {
    if (skip) localStorage.setItem(SKIP_CONFIRM_KEY, "1");
    else localStorage.removeItem(SKIP_CONFIRM_KEY);
  } catch {}
}

/**
 * @param {VoiceQuality | string} quality
 */
export function saveVoiceQuality(quality) {
  try {
    localStorage.setItem(QUALITY_STORAGE_KEY, normalizeVoiceQuality(quality));
  } catch {}
}

/**
 * @param {VoiceQuality | string} [quality]
 */
export function getVoiceQualityPreset(quality) {
  return VOICE_QUALITY_PRESETS[normalizeVoiceQuality(quality)];
}

function resampleInt16ToFloat32(srcInt16, srcRate, dstRate) {
  if (!srcInt16 || srcInt16.length === 0) return new Float32Array(0);
  if (srcRate === dstRate) {
    const out = new Float32Array(srcInt16.length);
    for (let i = 0; i < srcInt16.length; i++) out[i] = srcInt16[i] / 0x8000;
    return out;
  }
  const outLength = Math.max(1, Math.round((srcInt16.length * dstRate) / srcRate));
  const out = new Float32Array(outLength);
  const step = srcRate / dstRate;
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * step;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, srcInt16.length - 1);
    const frac = srcPos - i0;
    out[i] = (srcInt16[i0] * (1 - frac) + srcInt16[i1] * frac) / 0x8000;
  }
  return out;
}

/**
 * @param {string} clientId
 * @param {{ onStatus?: (status: string, detail?: string) => void }} [opts]
 */
export function createVoiceListenSession(clientId, opts = {}) {
  const onStatus = typeof opts.onStatus === "function" ? opts.onStatus : () => {};

  let ws = null;
  let playAudioCtx = null;
  let playProcessorNode = null;
  let playAnalyserNode = null;
  let playGainNode = null;
  let playbackChunks = [];
  let playbackChunkReadOffset = 0;
  let active = false;
  let starting = false;
  let primed = false;
  let quality = loadSavedVoiceQuality();
  let preset = getVoiceQualityPreset(quality);
  /** Actual PCM rate from agent (or default until format msg). */
  let uplinkSampleRate = DEFAULT_UPLINK_SAMPLE_RATE;
  /** @type {Float32Array | null} */
  let waveScratch = null;

  function clearPlaybackQueue() {
    playbackChunks = [];
    playbackChunkReadOffset = 0;
    primed = false;
  }

  function bufferedSampleCount() {
    let n = -playbackChunkReadOffset;
    for (const c of playbackChunks) n += c.length;
    return Math.max(0, n);
  }

  function appendPlaybackPcm(binary) {
    if (!playAudioCtx) initPlaybackEngine();
    const samples = Math.floor(binary.byteLength / 2);
    if (samples <= 0) return;
    const src = new Int16Array(samples);
    const view = new DataView(binary.buffer, binary.byteOffset, samples * 2);
    for (let i = 0; i < samples; i++) src[i] = view.getInt16(i * 2, true);
    const chunk = resampleInt16ToFloat32(
      src,
      uplinkSampleRate,
      playAudioCtx?.sampleRate || uplinkSampleRate,
    );
    if (chunk.length === 0) return;
    playbackChunks.push(chunk);

    const sampleRate = playAudioCtx?.sampleRate || uplinkSampleRate;
    const maxSamples = Math.max(preset.frameSize, Math.round(sampleRate * (preset.maxBufferMs / 1000)));
    let bufferedSamples = bufferedSampleCount();
    while (bufferedSamples > maxSamples && playbackChunks.length > 0) {
      const dropped = playbackChunks.shift();
      const droppedUsable = Math.max(0, (dropped?.length || 0) - playbackChunkReadOffset);
      bufferedSamples -= droppedUsable;
      playbackChunkReadOffset = 0;
    }

    if (!primed) {
      const need = Math.round(sampleRate * (preset.minStartMs / 1000));
      if (bufferedSampleCount() >= need) primed = true;
    }
  }

  function initPlaybackEngine() {
    if (!playAudioCtx) {
      // Prefer device default rate; we resample from uplink into it.
      try {
        playAudioCtx = new AudioContext({ latencyHint: preset.latencyHint });
      } catch {
        playAudioCtx = new AudioContext({ sampleRate: 16000, latencyHint: preset.latencyHint });
      }
    }
    if (!playGainNode) {
      playGainNode = playAudioCtx.createGain();
      playGainNode.gain.value = 1;
      playGainNode.connect(playAudioCtx.destination);
    }
    if (!playAnalyserNode) {
      playAnalyserNode = playAudioCtx.createAnalyser();
      playAnalyserNode.fftSize = 1024;
      playAnalyserNode.smoothingTimeConstant = 0.55;
      playAnalyserNode.minDecibels = -90;
      playAnalyserNode.maxDecibels = -10;
      playAnalyserNode.connect(playGainNode);
    }
    if (!playProcessorNode) {
      const frameSize = preset.frameSize;
      playProcessorNode = playAudioCtx.createScriptProcessor(frameSize, 1, 1);
      playProcessorNode.onaudioprocess = (event) => {
        const out = event.outputBuffer.getChannelData(0);
        out.fill(0);
        if (!active || !primed) return;

        let writeIndex = 0;
        while (writeIndex < out.length && playbackChunks.length > 0) {
          const head = playbackChunks[0];
          const remaining = head.length - playbackChunkReadOffset;
          if (remaining <= 0) {
            playbackChunks.shift();
            playbackChunkReadOffset = 0;
            continue;
          }
          const take = Math.min(out.length - writeIndex, remaining);
          out.set(head.subarray(playbackChunkReadOffset, playbackChunkReadOffset + take), writeIndex);
          writeIndex += take;
          playbackChunkReadOffset += take;
          if (playbackChunkReadOffset >= head.length) {
            playbackChunks.shift();
            playbackChunkReadOffset = 0;
          }
        }

        if (writeIndex < out.length) {
          primed = false;
          const sampleRate = playAudioCtx?.sampleRate || uplinkSampleRate;
          const need = Math.round(sampleRate * (preset.rebufferMs / 1000));
          if (bufferedSampleCount() >= need) primed = true;
        }
      };
      playProcessorNode.connect(playAnalyserNode);
    }
  }

  function teardownPlayback() {
    clearPlaybackQueue();
    try { playProcessorNode?.disconnect(); } catch {}
    try { playAnalyserNode?.disconnect(); } catch {}
    try { playGainNode?.disconnect(); } catch {}
    playProcessorNode = null;
    playAnalyserNode = null;
    playGainNode = null;
    waveScratch = null;
    if (playAudioCtx) {
      try { playAudioCtx.close(); } catch {}
      playAudioCtx = null;
    }
  }

  /**
   * Fill `out` with time-domain samples of the live remote mic stream (−1..1).
   * Returns false when inactive / no analyser.
   * @param {Float32Array} out
   * @returns {boolean}
   */
  function getWaveform(out) {
    if (!active || !playAnalyserNode || !out || out.length === 0) return false;
    if (!waveScratch || waveScratch.length !== playAnalyserNode.fftSize) {
      waveScratch = new Float32Array(playAnalyserNode.fftSize);
    }
    playAnalyserNode.getFloatTimeDomainData(waveScratch);
    const src = waveScratch;
    const n = out.length;
    if (src.length === n) {
      out.set(src);
      return true;
    }
    for (let i = 0; i < n; i++) {
      const idx = Math.min(src.length - 1, Math.floor((i / n) * src.length));
      out[i] = src[idx];
    }
    return true;
  }

  /**
   * RMS level 0..1 of the current remote mic window.
   * @returns {number}
   */
  function getLevel() {
    if (!active || !playAnalyserNode) return 0;
    if (!waveScratch || waveScratch.length !== playAnalyserNode.fftSize) {
      waveScratch = new Float32Array(playAnalyserNode.fftSize);
    }
    playAnalyserNode.getFloatTimeDomainData(waveScratch);
    let sum = 0;
    for (let i = 0; i < waveScratch.length; i++) {
      const s = waveScratch[i];
      sum += s * s;
    }
    return Math.min(1, Math.sqrt(sum / waveScratch.length) * 3.2);
  }

  function isActive() {
    return active;
  }

  function isStarting() {
    return starting;
  }

  function getQuality() {
    return quality;
  }

  /**
   * @param {VoiceQuality | string} next
   */
  function setQuality(next) {
    quality = normalizeVoiceQuality(next);
    preset = getVoiceQualityPreset(quality);
    saveVoiceQuality(quality);
  }

  /**
   * @param {string} [source]
   * @param {VoiceQuality | string} [qualityOverride]
   * @returns {Promise<boolean>}
   */
  function start(source = "default", qualityOverride) {
    if (active || starting) return Promise.resolve(active);
    if (!clientId) {
      onStatus("error", "Missing clientId");
      return Promise.resolve(false);
    }

    if (qualityOverride != null) setQuality(qualityOverride);
    else {
      quality = loadSavedVoiceQuality();
      preset = getVoiceQualityPreset(quality);
    }

    // Assume legacy 16 kHz until agent announces format (avoids pitch errors on old agents).
    uplinkSampleRate = DEFAULT_UPLINK_SAMPLE_RATE;
    starting = true;
    onStatus("connecting");

    return new Promise((resolve) => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${proto}://${location.host}/api/clients/${encodeURIComponent(clientId)}/voice/ws`);
      ws = socket;
      socket.binaryType = "arraybuffer";

      let settled = false;
      const settle = (ok) => {
        if (settled) return;
        settled = true;
        starting = false;
        resolve(ok);
      };

      socket.onopen = async () => {
        try {
          initPlaybackEngine();
          if (playAudioCtx?.state === "suspended") await playAudioCtx.resume();
          socket.send(JSON.stringify({
            type: "start",
            source: source || "default",
            quality,
            sampleRate: preset.sampleRate,
          }));
          active = true;
          onStatus("connected");
          settle(true);
        } catch (err) {
          onStatus("error", err?.message || "Playback failed");
          stop();
          settle(false);
        }
      };

      socket.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          try {
            const msg = JSON.parse(ev.data);
            if (msg?.type === "format" && typeof msg.sampleRate === "number" && msg.sampleRate > 0) {
              uplinkSampleRate = msg.sampleRate | 0;
              return;
            }
            if (msg?.type === "status") {
              // Ignore sampleRate on status — only agent `format` frames are authoritative
              // (legacy agents always send 16 kHz even if quality requested 8 kHz).
              if (msg.status === "offline") onStatus("offline", msg.reason);
              else if (msg.status === "error") onStatus("error");
              else if (msg.status === "connected") onStatus("connected");
            }
          } catch {}
          return;
        }
        const bytes = new Uint8Array(ev.data);
        if (bytes.byteLength > 1) appendPlaybackPcm(bytes);
      };

      socket.onclose = () => {
        const wasActive = active || starting;
        active = false;
        starting = false;
        if (ws === socket) ws = null;
        teardownPlayback();
        if (wasActive) onStatus("disconnected");
        settle(false);
      };

      socket.onerror = () => {
        onStatus("error", "Voice connection failed");
        settle(false);
      };
    });
  }

  function stop() {
    starting = false;
    active = false;
    clearPlaybackQueue();
    if (ws) {
      try { ws.send(JSON.stringify({ type: "stop" })); } catch {}
      try { ws.close(); } catch {}
      ws = null;
    }
    teardownPlayback();
    onStatus("disconnected");
  }

  return { start, stop, isActive, isStarting, getQuality, setQuality, getWaveform, getLevel };
}

/**
 * Styled Yes/No confirm dialog matching the app UI kit.
 * @param {{
 *   title?: string,
 *   message?: string,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   quality?: VoiceQuality | string,
 *   showQuality?: boolean,
 *   force?: boolean,
 * }} [opts]
 * @returns {Promise<{ confirmed: boolean, quality: VoiceQuality, skipFuture?: boolean }>}
 */
export function showMicConfirmDialog(opts = {}) {
  const initialQuality = normalizeVoiceQuality(opts.quality ?? loadSavedVoiceQuality() ?? DEFAULT_VOICE_QUALITY);

  if (!opts.force && shouldSkipMicConfirm()) {
    return Promise.resolve({ confirmed: true, quality: initialQuality, skipFuture: true });
  }

  return new Promise((resolve) => {
    document.querySelector(".rd-mic-confirm")?.remove();

    const showQuality = opts.showQuality !== false;

    const qualityOptions = Object.entries(VOICE_QUALITY_PRESETS)
      .map(([id, p]) => {
        const sel = id === initialQuality ? " selected" : "";
        return `<option value="${id}"${sel}>${p.label} — ${p.description}</option>`;
      })
      .join("");

    const qualityBlock = showQuality
      ? `<label class="rd-mic-quality">
          <span>Audio quality</span>
          <select data-quality>${qualityOptions}</select>
        </label>`
      : "";

    const overlay = document.createElement("div");
    overlay.className = "rd-mic-confirm";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <section>
        <div class="rd-mic-confirm-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <h2>${opts.title || "Enable remote microphone?"}</h2>
        <p>${opts.message || "This will enable the remote client's microphone so you can hear them. <strong>The person may be alerted that their microphone has been turned on.</strong>"}</p>
        ${qualityBlock}
        <label class="rd-mic-dont-show">
          <input type="checkbox" data-dont-show />
          <span>Don't show me this again</span>
        </label>
        <div class="rd-mic-confirm-actions">
          <button type="button" data-cancel>${opts.cancelLabel || "No"}</button>
          <button type="button" data-confirm>${opts.confirmLabel || "Yes"}</button>
        </div>
      </section>
    `;

    const qualitySelect = overlay.querySelector("[data-quality]");
    const dontShow = overlay.querySelector("[data-dont-show]");

    const finish = (confirmed) => {
      const quality = normalizeVoiceQuality(qualitySelect?.value || initialQuality);
      const skipFuture = !!(confirmed && dontShow?.checked);
      if (confirmed) {
        saveVoiceQuality(quality);
        if (skipFuture) setSkipMicConfirm(true);
      }
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve({ confirmed, quality, skipFuture });
    };

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    };

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(false);
    });
    overlay.querySelector("[data-cancel]")?.addEventListener("click", () => finish(false));
    overlay.querySelector("[data-confirm]")?.addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onKey);
    document.body.append(overlay);
    if (qualitySelect) qualitySelect.value = initialQuality;
    overlay.querySelector("[data-confirm]")?.focus();
  });
}
