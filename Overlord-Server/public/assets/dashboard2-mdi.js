/** Dashboard 2.0 MDI window manager — v0.2.1 */
export const DASHBOARD2_MDI_VERSION = "0.2.1";

const LAYOUT_KEY = "overlord_dashboard2_layout_v2";
const LAYOUT_SAVED_KEY = "overlord_dashboard2_layout_saved_v2";
const MIN_W = 220;
const MIN_H = 140;
const TITLE_H = 28;
const EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const DEFAULTS = {
  desktop: { x: 12, y: 12, w: 0.7, h: 0.9, z: 3, minimized: false, maximized: false },
  webcam: { x: 0.74, y: 12, w: 0.24, h: 0.32, z: 4, minimized: false, maximized: false },
  processes: { x: 0.74, y: 0.38, w: 0.24, h: 0.42, z: 5, minimized: false, maximized: false },
};

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function loadJson(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveJson(key, state) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function cloneDefaults() {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = { ...DEFAULTS[k] };
  return out;
}

function resolveRect(spec, hostW, hostH) {
  const px = (v, axis) => {
    if (typeof v === "number" && v > 0 && v <= 1) {
      return Math.round(v * (axis === "x" || axis === "w" ? hostW : hostH));
    }
    return Math.round(Number(v) || 0);
  };
  let x = px(spec.x, "x");
  let y = px(spec.y, "y");
  let w = px(spec.w, "w");
  let h = px(spec.h, "h");
  w = clamp(w, MIN_W, hostW);
  h = clamp(h, MIN_H, hostH);
  x = clamp(x, 0, Math.max(0, hostW - MIN_W));
  y = clamp(y, 0, Math.max(0, hostH - TITLE_H));
  if (x + w > hostW) w = Math.max(MIN_W, hostW - x);
  if (y + h > hostH) h = Math.max(MIN_H, hostH - y);
  return { x, y, w, h, z: spec.z || 1, minimized: !!spec.minimized, maximized: !!spec.maximized };
}

function ensureEdgeHandles(win) {
  let wrap = win.querySelector("[data-d2-edges]");
  if (wrap) return wrap;
  wrap = document.createElement("div");
  wrap.className = "d2-edges";
  wrap.setAttribute("data-d2-edges", "");
  for (const edge of EDGES) {
    const h = document.createElement("div");
    h.className = `d2-edge d2-edge-${edge}`;
    h.dataset.d2Edge = edge;
    h.title = "Resize";
    wrap.appendChild(h);
  }
  win.appendChild(wrap);
  return wrap;
}

/**
 * @param {{ root: HTMLElement }} opts
 */
export function initDashboard2Mdi(opts) {
  const root = opts.root;
  if (!root) {
    return {
      version: DASHBOARD2_MDI_VERSION,
      activate() {},
      deactivate() {},
      resetLayout() {},
      savePreferredLayout() {},
      destroy() {},
    };
  }

  const workspace = root.querySelector("[data-d2-workspace]") || root;
  const windows = [...workspace.querySelectorAll("[data-d2-id]")];
  let layout = loadJson(LAYOUT_KEY);
  if (!layout || !Object.keys(layout).length) {
    layout = loadJson(LAYOUT_SAVED_KEY) || cloneDefaults();
  }
  let topZ = 10;
  let active = false;
  let ro = null;
  let interacting = false;
  let activePointerId = null;

  const versionEl = root.querySelector("[data-d2-version]");
  if (versionEl) versionEl.textContent = `v${DASHBOARD2_MDI_VERSION}`;

  function hostSize() {
    const r = workspace.getBoundingClientRect();
    return { w: Math.max(320, Math.floor(r.width)), h: Math.max(240, Math.floor(r.height)) };
  }

  function ensureSpec(id) {
    if (!layout[id]) {
      const d = DEFAULTS[id] || DEFAULTS.desktop;
      layout[id] = { ...d };
    }
    return layout[id];
  }

  function setIframePointerEvents(enabled) {
    workspace.querySelectorAll("iframe").forEach((frame) => {
      frame.style.pointerEvents = enabled ? "" : "none";
    });
  }

  function setInteracting(on) {
    interacting = on;
    document.body.classList.toggle("d2-interacting", on);
    root.classList.toggle("is-interacting", on);
    setIframePointerEvents(!on);
    if (on) document.body.style.userSelect = "none";
    else document.body.style.userSelect = "";
  }

  function applyWindow(win) {
    const id = win.dataset.d2Id;
    if (!id) return;
    const { w: hw, h: hh } = hostSize();
    const spec = ensureSpec(id);
    const rect = resolveRect(spec, hw, hh);
    win.classList.toggle("is-minimized", rect.minimized);
    win.classList.toggle("is-maximized", rect.maximized && !rect.minimized);
    if (rect.maximized && !rect.minimized) {
      win.style.left = "0px";
      win.style.top = "0px";
      win.style.width = `${hw}px`;
      win.style.height = `${hh}px`;
    } else if (rect.minimized) {
      win.style.left = `${rect.x}px`;
      win.style.top = `${rect.y}px`;
      win.style.width = `${Math.max(160, Math.min(rect.w, 240))}px`;
      win.style.height = `${TITLE_H}px`;
    } else {
      win.style.left = `${rect.x}px`;
      win.style.top = `${rect.y}px`;
      win.style.width = `${rect.w}px`;
      win.style.height = `${rect.h}px`;
    }
    win.style.zIndex = String(rect.z || 1);
    topZ = Math.max(topZ, rect.z || 1);
  }

  function applyAll() {
    windows.forEach(applyWindow);
  }

  function persist() {
    saveJson(LAYOUT_KEY, layout);
  }

  function focusWin(win) {
    const id = win.dataset.d2Id;
    if (!id) return;
    topZ += 1;
    ensureSpec(id).z = topZ;
    windows.forEach((w) => w.classList.toggle("is-focused", w === win));
    applyWindow(win);
    persist();
  }

  function beginGesture(e, targetEl) {
    activePointerId = e.pointerId;
    setInteracting(true);
    try {
      targetEl.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function endGesture(win, targetEl) {
    if (win) {
      win.classList.remove("is-dragging", "is-resizing");
    }
    setInteracting(false);
    if (targetEl && activePointerId != null) {
      try {
        if (targetEl.hasPointerCapture?.(activePointerId)) {
          targetEl.releasePointerCapture(activePointerId);
        }
      } catch {
        /* ignore */
      }
    }
    activePointerId = null;
    persist();
  }

  function onPointerDownTitle(e, win) {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest("button, a, input, select, textarea, [data-d2-edge], [data-d2-cam-start], [data-d2-cam-stop]")) return;
    const id = win.dataset.d2Id;
    const spec = ensureSpec(id);
    if (spec.maximized) {
      focusWin(win);
      return;
    }
    focusWin(win);
    const startX = e.clientX;
    const startY = e.clientY;
    const { w: hw, h: hh } = hostSize();
    const rect = resolveRect(spec, hw, hh);
    const ox = rect.x;
    const oy = rect.y;
    const title = win.querySelector("[data-d2-drag]") || win;
    win.classList.add("is-dragging");
    beginGesture(e, title);

    const move = (ev) => {
      if (activePointerId != null && ev.pointerId !== activePointerId) return;
      const nx = clamp(ox + (ev.clientX - startX), 0, Math.max(0, hw - MIN_W));
      const ny = clamp(oy + (ev.clientY - startY), 0, Math.max(0, hh - TITLE_H));
      spec.x = nx;
      spec.y = ny;
      // keep pixel sizes while dragging so fraction keys don't re-expand oddly
      spec.w = rect.w;
      spec.h = rect.h;
      applyWindow(win);
    };
    const up = (ev) => {
      if (activePointerId != null && ev.pointerId !== activePointerId) return;
      title.removeEventListener("pointermove", move);
      title.removeEventListener("pointerup", up);
      title.removeEventListener("pointercancel", up);
      title.removeEventListener("lostpointercapture", up);
      endGesture(win, title);
    };
    title.addEventListener("pointermove", move);
    title.addEventListener("pointerup", up);
    title.addEventListener("pointercancel", up);
    title.addEventListener("lostpointercapture", up);
    e.preventDefault();
  }

  function onPointerDownEdge(e, win, edge) {
    if (e.button != null && e.button !== 0) return;
    const id = win.dataset.d2Id;
    const spec = ensureSpec(id);
    if (spec.maximized || spec.minimized) return;
    focusWin(win);
    const startX = e.clientX;
    const startY = e.clientY;
    const { w: hw, h: hh } = hostSize();
    const rect = resolveRect(spec, hw, hh);
    const ox = rect.x;
    const oy = rect.y;
    const ow = rect.w;
    const oh = rect.h;
    const handle = e.currentTarget;
    win.classList.add("is-resizing");
    beginGesture(e, handle);

    const move = (ev) => {
      if (activePointerId != null && ev.pointerId !== activePointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let x = ox;
      let y = oy;
      let w = ow;
      let h = oh;

      if (edge.includes("e")) {
        w = clamp(ow + dx, MIN_W, hw - ox);
      }
      if (edge.includes("s")) {
        h = clamp(oh + dy, MIN_H, hh - oy);
      }
      if (edge.includes("w")) {
        const nextW = clamp(ow - dx, MIN_W, ow + ox);
        x = ox + (ow - nextW);
        w = nextW;
      }
      if (edge.includes("n")) {
        const nextH = clamp(oh - dy, MIN_H, oh + oy);
        y = oy + (oh - nextH);
        h = nextH;
      }

      x = clamp(x, 0, Math.max(0, hw - MIN_W));
      y = clamp(y, 0, Math.max(0, hh - TITLE_H));
      if (x + w > hw) w = Math.max(MIN_W, hw - x);
      if (y + h > hh) h = Math.max(MIN_H, hh - y);

      spec.x = x;
      spec.y = y;
      spec.w = w;
      spec.h = h;
      applyWindow(win);
    };
    const up = (ev) => {
      if (activePointerId != null && ev.pointerId !== activePointerId) return;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      handle.removeEventListener("lostpointercapture", up);
      endGesture(win, handle);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
    handle.addEventListener("lostpointercapture", up);
    e.preventDefault();
    e.stopPropagation();
  }

  function bindWindow(win) {
    ensureEdgeHandles(win);
    const title = win.querySelector("[data-d2-drag]");
    const minBtn = win.querySelector("[data-d2-min]");
    const maxBtn = win.querySelector("[data-d2-max]");
    // remove legacy single SE handle if present
    win.querySelectorAll("[data-d2-resize]:not([data-d2-edge])").forEach((el) => el.remove());

    title?.addEventListener("pointerdown", (e) => onPointerDownTitle(e, win));
    win.querySelectorAll("[data-d2-edge]").forEach((handle) => {
      handle.addEventListener("pointerdown", (e) => onPointerDownEdge(e, win, handle.dataset.d2Edge || "se"));
    });
    win.addEventListener("pointerdown", (e) => {
      if (interacting) return;
      if (e.target.closest("[data-d2-edge]")) return;
      focusWin(win);
    });
    minBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const spec = ensureSpec(win.dataset.d2Id);
      spec.minimized = !spec.minimized;
      if (spec.minimized) spec.maximized = false;
      applyWindow(win);
      persist();
    });
    maxBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const spec = ensureSpec(win.dataset.d2Id);
      if (spec.minimized) {
        spec.minimized = false;
      } else {
        spec.maximized = !spec.maximized;
      }
      applyWindow(win);
      persist();
    });
  }

  windows.forEach(bindWindow);

  function factoryReset() {
    layout = cloneDefaults();
    applyAll();
    persist();
  }

  function savePreferredLayout() {
    // snapshot current working layout
    const snap = {};
    for (const k of Object.keys(layout)) {
      snap[k] = { ...layout[k] };
    }
    // ensure all known windows present
    for (const k of Object.keys(DEFAULTS)) {
      if (!snap[k]) snap[k] = { ...DEFAULTS[k] };
    }
    saveJson(LAYOUT_SAVED_KEY, snap);
    persist();
    return true;
  }

  const resetBtn = root.querySelector("[data-d2-reset]");
  resetBtn?.addEventListener("click", () => factoryReset());

  const saveBtn = root.querySelector("[data-d2-save]");
  saveBtn?.addEventListener("click", () => {
    savePreferredLayout();
    saveBtn.classList.add("is-saved");
    saveBtn.textContent = "Saved";
    setTimeout(() => {
      saveBtn.classList.remove("is-saved");
      saveBtn.textContent = "Save layout";
    }, 1200);
  });

  function activate() {
    active = true;
    root.hidden = false;
    if (layout.status) {
      delete layout.status;
      persist();
    }
    // seed missing windows (e.g. processes after upgrade)
    for (const k of Object.keys(DEFAULTS)) ensureSpec(k);
    applyAll();
    if (typeof ResizeObserver !== "undefined") {
      ro?.disconnect();
      ro = new ResizeObserver(() => {
        if (active && !interacting) applyAll();
      });
      ro.observe(workspace);
    }
  }

  function deactivate() {
    active = false;
    root.hidden = true;
    setInteracting(false);
    ro?.disconnect();
    ro = null;
  }

  // seed defaults into empty layout keys
  Object.keys(DEFAULTS).forEach((k) => ensureSpec(k));

  return {
    version: DASHBOARD2_MDI_VERSION,
    activate,
    deactivate,
    resetLayout: factoryReset,
    savePreferredLayout,
    destroy() {
      deactivate();
    },
  };
}
