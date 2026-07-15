const PREF_KEY = "overlord_sound_effects_enabled";
const CLIENT_ONLINE_PREF_KEY = "overlord_client_online_sound_enabled";

let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function ensureResumed() {
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
}

document.addEventListener("click", ensureResumed, { once: true });
document.addEventListener("keydown", ensureResumed, { once: true });

export function isSoundEffectsEnabled() {
  const stored = localStorage.getItem(PREF_KEY);
  return stored === null ? true : stored === "1";
}

export function setSoundEffectsEnabled(value) {
  localStorage.setItem(PREF_KEY, value ? "1" : "0");
}

export function isClientOnlineSoundEnabled() {
  const stored = localStorage.getItem(CLIENT_ONLINE_PREF_KEY);
  return stored === null ? true : stored === "1";
}

export function setClientOnlineSoundEnabled(value) {
  localStorage.setItem(CLIENT_ONLINE_PREF_KEY, value ? "1" : "0");
}

const effects = {
  clientOnline(ctx) {
    const now = ctx.currentTime;
    const layers = [
      { type: "sine", start: 0, duration: 0.27, gain: 0.038, freq: 523, endFreq: 587, attack: 0.022, release: 0.16 },
      { type: "sine", start: 0.075, duration: 0.23, gain: 0.034, freq: 784, endFreq: 880, attack: 0.018, release: 0.15 },
      { type: "sine", start: 0.15, duration: 0.16, gain: 0.019, freq: 1760, attack: 0.012, release: 0.12 },
    ];

    for (const layer of layers) {
      const start = now + layer.start;
      const stop = start + layer.duration;
      const sustainUntil = Math.max(start + layer.attack + 0.005, stop - layer.release);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = layer.type;
      osc.frequency.setValueAtTime(layer.freq, start);
      if (layer.endFreq) {
        osc.frequency.exponentialRampToValueAtTime(layer.endFreq, stop);
      }
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(layer.gain, start + layer.attack);
      gain.gain.setValueAtTime(layer.gain, sustainUntil);
      gain.gain.exponentialRampToValueAtTime(0.001, stop);
      osc.start(start);
      osc.stop(stop + 0.025);
    }
  },

  purgatory(ctx) {
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(1047, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.06, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc1.start(now);
    osc1.stop(now + 0.12);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1319, now + 0.08);
    gain2.gain.setValueAtTime(0, now + 0.08);
    gain2.gain.linearRampToValueAtTime(0.06, now + 0.10);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.25);
  },
};

export function playSoundEffect(name, force) {
  if (!force && !isSoundEffectsEnabled()) return;
  const fn = effects[name];
  if (!fn) return;
  try {
    fn(getAudioCtx());
  } catch {}
}
