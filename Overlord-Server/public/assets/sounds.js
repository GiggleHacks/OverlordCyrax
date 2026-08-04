const PREF_KEY = "overlord_sound_effects_enabled";
const CLIENT_ONLINE_PREF_KEY = "overlord_client_online_sound_enabled";
const STARTUP_PREF_KEY = "overlord_sound_startup_enabled";
const SUCCESS_PREF_KEY = "overlord_sound_success_enabled";
const ERROR_PREF_KEY = "overlord_sound_error_enabled";
const CLICK_PREF_KEY = "overlord_sound_click_enabled";
const STARTUP_FLAG_KEY = "overlord_play_startup_sound";

const SAMPLE_BASE = "/assets/sounds";
const DEBOUNCE_MS = 120;

const SAMPLE_URLS = {
  startup: `${SAMPLE_BASE}/startup.wav`,
  success: `${SAMPLE_BASE}/success.wav`,
  error: `${SAMPLE_BASE}/error.wav`,
  click: `${SAMPLE_BASE}/click.wav`,
  clientOnline: `${SAMPLE_BASE}/client-online.wav`,
};

const CATEGORY_BY_EFFECT = {
  startup: "startup",
  success: "success",
  error: "error",
  click: "click",
  clientOnline: "clientOnline",
  purgatory: "master",
};

let audioCtx = null;
const audioCache = new Map();
const lastPlayedAt = new Map();

function prefEnabled(key, defaultOn = true) {
  const stored = localStorage.getItem(key);
  return stored === null ? defaultOn : stored === "1";
}

function setPref(key, value) {
  localStorage.setItem(key, value ? "1" : "0");
}

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
  return prefEnabled(PREF_KEY, true);
}

export function setSoundEffectsEnabled(value) {
  setPref(PREF_KEY, value);
}

export function isClientOnlineSoundEnabled() {
  return prefEnabled(CLIENT_ONLINE_PREF_KEY, false);
}

export function setClientOnlineSoundEnabled(value) {
  setPref(CLIENT_ONLINE_PREF_KEY, value);
}

export function isStartupSoundEnabled() {
  return prefEnabled(STARTUP_PREF_KEY, true);
}

export function setStartupSoundEnabled(value) {
  setPref(STARTUP_PREF_KEY, value);
}

export function isSuccessSoundEnabled() {
  return prefEnabled(SUCCESS_PREF_KEY, true);
}

export function setSuccessSoundEnabled(value) {
  setPref(SUCCESS_PREF_KEY, value);
}

export function isErrorSoundEnabled() {
  return prefEnabled(ERROR_PREF_KEY, true);
}

export function setErrorSoundEnabled(value) {
  setPref(ERROR_PREF_KEY, value);
}

export function isClickSoundEnabled() {
  return prefEnabled(CLICK_PREF_KEY, true);
}

export function setClickSoundEnabled(value) {
  setPref(CLICK_PREF_KEY, value);
}

export function markStartupSoundPending() {
  try {
    sessionStorage.setItem(STARTUP_FLAG_KEY, "1");
  } catch {}
}

export function consumeStartupSoundFlag() {
  try {
    if (sessionStorage.getItem(STARTUP_FLAG_KEY) !== "1") return false;
    sessionStorage.removeItem(STARTUP_FLAG_KEY);
    return true;
  } catch {
    return false;
  }
}

function categoryAllows(name) {
  const category = CATEGORY_BY_EFFECT[name] || "master";
  if (category === "startup") return isStartupSoundEnabled();
  if (category === "success") return isSuccessSoundEnabled();
  if (category === "error") return isErrorSoundEnabled();
  if (category === "click") return isClickSoundEnabled();
  if (category === "clientOnline") return isClientOnlineSoundEnabled();
  return true;
}

function shouldDebounce(name) {
  const now = Date.now();
  const last = lastPlayedAt.get(name) || 0;
  if (now - last < DEBOUNCE_MS) return true;
  lastPlayedAt.set(name, now);
  return false;
}

function getCachedAudio(url) {
  let audio = audioCache.get(url);
  if (!audio) {
    audio = new Audio(url);
    audio.preload = "auto";
    audioCache.set(url, audio);
  }
  return audio;
}

function playSample(url) {
  const audio = getCachedAudio(url);
  try {
    audio.pause();
    audio.currentTime = 0;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  } catch {}
}

const synthEffects = {
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
    gain2.gain.linearRampToValueAtTime(0.06, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.25);
  },
};

export function playSoundEffect(name, force) {
  if (!force && !isSoundEffectsEnabled()) return;
  if (!force && !categoryAllows(name)) return;
  if (!force && shouldDebounce(name)) return;

  const sampleUrl = SAMPLE_URLS[name];
  if (sampleUrl) {
    playSample(sampleUrl);
    return;
  }

  const synth = synthEffects[name];
  if (!synth) return;
  try {
    synth(getAudioCtx());
  } catch {}
}

export function playClickSound(force) {
  playSoundEffect("click", force);
}

export function playSuccessSound(force) {
  playSoundEffect("success", force);
}

export function playErrorSound(force) {
  playSoundEffect("error", force);
}

export function playStartupSoundIfPending() {
  if (!consumeStartupSoundFlag()) return false;
  playSoundEffect("startup");
  return true;
}

const api = {
  isSoundEffectsEnabled,
  setSoundEffectsEnabled,
  isClientOnlineSoundEnabled,
  setClientOnlineSoundEnabled,
  isStartupSoundEnabled,
  setStartupSoundEnabled,
  isSuccessSoundEnabled,
  setSuccessSoundEnabled,
  isErrorSoundEnabled,
  setErrorSoundEnabled,
  isClickSoundEnabled,
  setClickSoundEnabled,
  playSoundEffect,
  playClickSound,
  playSuccessSound,
  playErrorSound,
  markStartupSoundPending,
  consumeStartupSoundFlag,
  playStartupSoundIfPending,
};

if (typeof window !== "undefined") {
  window.OverlordSounds = api;
}

export default api;
