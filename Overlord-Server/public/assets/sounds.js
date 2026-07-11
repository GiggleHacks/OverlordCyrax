const PREF_KEY = "overlord_sound_effects_enabled";

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

const effects = {
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

export function playSoundEffect(name) {
  if (!isSoundEffectsEnabled()) return;
  const fn = effects[name];
  if (!fn) return;
  try {
    fn(getAudioCtx());
  } catch {}
}
