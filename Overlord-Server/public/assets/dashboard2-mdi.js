/** Dashboard 2.0 MDI window manager — v0.4.1 */
export const DASHBOARD2_MDI_VERSION = "0.4.1";

const LAYOUT_KEY = "overlord_dashboard2_layout_v2";
const LAYOUT_SAVED_LEGACY_KEY = "overlord_dashboard2_layout_saved_v2";
const SLOTS_KEY = "overlord_dashboard2_layout_slots_v1";
const ACTIVE_SLOT_KEY = "overlord_dashboard2_layout_active_slot_v1";
const SLOT_IDS = ["1", "2"];
const MIN_W = 220;
const MIN_H = 140;
const TITLE_H = 28;
const EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

// Default geometry: RD full-left; right stack Webcam → shorter PM → FM under PM.
const DEFAULTS = {
  desktop: { x: 12, y: 12, w: 0.7, h: 0.96, z: 3, minimized: false, maximized: false },
  webcam: { x: 0.74, y: 12, w: 0.24, h: 0.28, z: 4, minimized: false, maximized: false },
  processes: { x: 0.74, y: 0.31, w: 0.24, h: 0.3, z: 5, minimized: false, maximized: false },
  files: { x: 0.74, y: 0.63, w: 0.24, h: 0.33, z: 6, minimized: false, maximized: false },
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

function removeJson(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function cloneDefaults() {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = { ...DEFAULTS[k] };
  return out;
}

function cloneLayout(src) {
  const snap = {};
  const base = src && typeof src === "object" ? src : {};
  for (const k of Object.keys(base)) {
    if (base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) snap[k] = { ...base[k] };
  }
  for (const k of Object.keys(DEFAULTS)) {
    if (!snap[k]) snap[k] = { ...DEFAULTS[k] };
  }
  return snap;
}

function emptySlots() {
  return { "1": null, "2": null };
}

function isBareLayoutMap(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(entry, "layout")) return false;
  return Object.keys(DEFAULTS).some((k) => entry[k] && typeof entry[k] === "object");
}

function normalizeSlotEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (isBareLayoutMap(entry)) {
    return { layout: cloneLayout(entry), locked: false };
  }
  const layoutSrc = entry.layout && typeof entry.layout === "object" ? entry.layout : null;
  if (!layoutSrc || !Object.keys(layoutSrc).length) return null;
  return { layout: cloneLayout(layoutSrc), locked: !!entry.locked };
}

function normalizeSlots(raw) {
  const slots = emptySlots();
  if (!raw || typeof raw !== "object") return slots;
  for (const id of SLOT_IDS) {
    slots[id] = normalizeSlotEntry(raw[id]);
  }
  return slots;
}

function serializeSlots(slots) {
  const out = emptySlots();
  for (const id of SLOT_IDS) {
    const entry = slots[id];
    if (!entry || !entry.layout) {
      out[id] = null;
      continue;
    }
    out[id] = { layout: cloneLayout(entry.layout), locked: !!entry.locked };
  }
  return out;
}

function loadSlots() {
  return normalizeSlots(loadJson(SLOTS_KEY));
}

function saveSlots(slots) {
  saveJson(SLOTS_KEY, serializeSlots(slots));
}

function migrateLegacySavedLayout(slots) {
  if (slots["1"]) return slots;
  const legacy = loadJson(LAYOUT_SAVED_LEGACY_KEY);
  if (!legacy || !Object.keys(legacy).length) return slots;
  slots["1"] = { layout: cloneLayout(legacy), locked: false };
  saveSlots(slots);
  removeJson(LAYOUT_SAVED_LEGACY_KEY);
  return slots;
}

function getSlotLayout(slots, id) {
  const entry = slots[id];
  return entry && entry.layout ? entry.layout : null;
}

function isSlotLocked(slots, id) {
  return !!(slots[id] && slots[id].locked);
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
      saveToSlot() {},
      applySlot() {},
      setSlotLocked() {},
      destroy() {},
    };
  }

  const workspace = root.querySelector("[data-d2-workspace]") || root;
  const windows = [...workspace.querySelectorAll("[data-d2-id]")];
  let slots = migrateLegacySavedLayout(loadSlots());
  let activeSlot = (() => {
    try {
      const v = localStorage.getItem(ACTIVE_SLOT_KEY);
      return SLOT_IDS.includes(v) ? v : null;
    } catch {
      return null;
    }
  })();
  let layout = loadJson(LAYOUT_KEY);
  if (!layout || !Object.keys(layout).length) {
    layout = cloneDefaults();
  }
  let topZ = 10;
  let active = false;
  let ro = null;
  let interacting = false;
  let activePointerId = null;

  const versionEl = root.querySelector("[data-d2-version]");
  if (versionEl) versionEl.textContent = `v${DASHBOARD2_MDI_VERSION}`;
  const slotButtons = SLOT_IDS.map((id) => root.querySelector(`[data-d2-slot="${id}"]`)).filter(Boolean);

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

  let slotMenuEl = null;
  let slotMenuCleanup = null;

  function setActiveSlot(id) {
    activeSlot = SLOT_IDS.includes(id) ? id : null;
    try {
      if (activeSlot) localStorage.setItem(ACTIVE_SLOT_KEY, activeSlot);
      else localStorage.removeItem(ACTIVE_SLOT_KEY);
    } catch {
      /* ignore */
    }
    syncSlotButtons();
  }

  function slotLabel(id) {
    return `Layout ${id}`;
  }

  function closeSlotMenu() {
    if (slotMenuCleanup) {
      slotMenuCleanup();
      slotMenuCleanup = null;
    }
    if (slotMenuEl) {
      slotMenuEl.remove();
      slotMenuEl = null;
    }
  }

  function syncSlotButtons() {
    for (const btn of slotButtons) {
      const id = btn.getAttribute("data-d2-slot");
      if (!SLOT_IDS.includes(id)) continue;
      const filled = !!getSlotLayout(slots, id);
      const locked = isSlotLocked(slots, id);
      const label = slotLabel(id);
      btn.classList.toggle("is-empty", !filled);
      btn.classList.toggle("is-active-slot", activeSlot === id);
      btn.classList.toggle("is-locked", locked);
      btn.innerHTML = locked
        ? `<span class="d2-slot-label">${label}</span><i class="fa-solid fa-lock d2-slot-lock" aria-hidden="true"></i>`
        : `<span class="d2-slot-label">${label}</span>`;
      if (!filled) {
        btn.title = `${label} — Click: apply · Right-click: save / lock`;
      } else if (locked) {
        btn.title = `${label} — Locked · Click: apply · Right-click: unlock`;
      } else {
        btn.title = `${label} — Click: apply · Right-click: save / lock`;
      }
    }
  }

  function flashSlotButton(btn, text) {
    if (!btn) return;
    btn.classList.add("is-saved");
    btn.classList.remove("is-empty");
    btn.textContent = text;
    setTimeout(() => {
      btn.classList.remove("is-saved");
      syncSlotButtons();
    }, 1200);
  }

  function factoryReset() {
    // Factory working layout only — custom slots are never cleared or rewritten.
    layout = cloneDefaults();
    setActiveSlot(null);
    applyAll();
    persist();
  }

  function saveToSlot(id) {
    if (!SLOT_IDS.includes(id)) return false;
    if (isSlotLocked(slots, id)) return false;
    const prevLocked = !!(slots[id] && slots[id].locked);
    slots[id] = { layout: cloneLayout(layout), locked: prevLocked };
    saveSlots(slots);
    setActiveSlot(id);
    persist();
    return true;
  }

  function setSlotLocked(id, locked) {
    if (!SLOT_IDS.includes(id)) return false;
    const existing = getSlotLayout(slots, id);
    if (!existing) return false;
    slots[id] = { layout: cloneLayout(existing), locked: !!locked };
    saveSlots(slots);
    syncSlotButtons();
    return true;
  }

  function applySlot(id) {
    if (!SLOT_IDS.includes(id)) return false;
    const snap = getSlotLayout(slots, id);
    if (!snap || !Object.keys(snap).length) return false;
    layout = cloneLayout(snap);
    setActiveSlot(id);
    applyAll();
    persist();
    return true;
  }

  function openSlotMenu(btn, id, clientX, clientY) {
    closeSlotMenu();
    const filled = !!getSlotLayout(slots, id);
    const locked = isSlotLocked(slots, id);
    const menu = document.createElement("div");
    menu.className = "d2-slot-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button type="button" class="d2-slot-menu-item" data-d2-slot-action="save" role="menuitem" ${locked ? "disabled" : ""}>
        <i class="fa-solid fa-floppy-disk"></i><span>Save layout</span>
      </button>
      <button type="button" class="d2-slot-menu-item" data-d2-slot-action="toggle-lock" role="menuitem" ${!filled && !locked ? "disabled" : ""}>
        <i class="fa-solid ${locked ? "fa-lock-open" : "fa-lock"}"></i><span>${locked ? "Unlock" : "Lock"}</span>
      </button>
    `;
    document.body.appendChild(menu);
    slotMenuEl = menu;

    const pad = 6;
    const rect = menu.getBoundingClientRect();
    let left = clientX;
    let top = clientY;
    if (left + rect.width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - rect.width - pad);
    if (top + rect.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - rect.height - pad);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;

    menu.addEventListener("click", (e) => {
      const item = e.target.closest("[data-d2-slot-action]");
      if (!item || item.disabled) return;
      const action = item.getAttribute("data-d2-slot-action");
      closeSlotMenu();
      if (action === "save") {
        if (saveToSlot(id)) flashSlotButton(btn, "Saved");
        else flashSlotButton(btn, locked ? "Locked" : "Empty");
        return;
      }
      if (action === "toggle-lock") {
        if (locked) {
          setSlotLocked(id, false);
          return;
        }
        if (setSlotLocked(id, true)) return;
        flashSlotButton(btn, "Empty");
      }
    });

    const onDocPointer = (e) => {
      if (menu.contains(e.target) || btn.contains(e.target)) return;
      closeSlotMenu();
    };
    const onKey = (e) => {
      if (e.key === "Escape") closeSlotMenu();
    };
    setTimeout(() => {
      document.addEventListener("pointerdown", onDocPointer, true);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("blur", closeSlotMenu);
      window.addEventListener("resize", closeSlotMenu);
    }, 0);
    slotMenuCleanup = () => {
      document.removeEventListener("pointerdown", onDocPointer, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", closeSlotMenu);
      window.removeEventListener("resize", closeSlotMenu);
    };
  }

  const resetBtn = root.querySelector("[data-d2-reset]");
  resetBtn?.addEventListener("click", () => factoryReset());

  for (const btn of slotButtons) {
    const id = btn.getAttribute("data-d2-slot");
    if (!SLOT_IDS.includes(id)) continue;
    btn.addEventListener("click", (e) => {
      closeSlotMenu();
      if (e.shiftKey) {
        if (saveToSlot(id)) flashSlotButton(btn, "Saved");
        else flashSlotButton(btn, isSlotLocked(slots, id) ? "Locked" : "Empty");
        return;
      }
      if (applySlot(id)) return;
      flashSlotButton(btn, "Empty");
    });
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openSlotMenu(btn, id, e.clientX, e.clientY);
    });
  }
  syncSlotButtons();

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
    saveToSlot,
    applySlot,
    setSlotLocked,
    destroy() {
      closeSlotMenu();
      deactivate();
    },
  };
}
