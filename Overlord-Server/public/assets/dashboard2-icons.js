/**
 * Dashboard 2.0 desktop shortcut icons — v1.0.0
 * Renders side-panel shortcut pins as draggable icons on the D2 workspace,
 * so empty "dead space" becomes usable desktop area.
 *
 * Data:
 *   pins      ← localStorage "overlord_side_panel_pins_v1" (shared with side panel)
 *   positions → localStorage "overlord_dashboard2_icons_v1" ({ pinId: {x, y} })
 */
import { SIDE_PINS_KEY, loadPins, runPinnedCommand } from "./side-panel.js";

export const DASHBOARD2_ICONS_VERSION = "1.0.0";

const POS_KEY = "overlord_dashboard2_icons_v1";
const ICON_W = 78;
const ICON_H = 76;
const GAP = 10;
const MARGIN = 12;
const DRAG_THRESHOLD = 5;

function loadPositions() {
  try {
    const raw = localStorage.getItem(POS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePositions(map) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : String(str);
  return d.innerHTML;
}

/**
 * @param {{ root: HTMLElement, clientId: string }} opts
 */
export function initDashboard2Icons(opts) {
  const root = opts?.root;
  const clientId = opts?.clientId;
  const workspace = root?.querySelector("[data-d2-workspace]");
  if (!root || !workspace || !clientId) {
    return {
      version: DASHBOARD2_ICONS_VERSION,
      activate() {},
      deactivate() {},
      refresh() {},
    };
  }

  let active = false;
  let positions = loadPositions();

  function hostSize() {
    const r = workspace.getBoundingClientRect();
    return { w: Math.floor(r.width), h: Math.floor(r.height) };
  }

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  function defaultSlot(index, hostW, hostH) {
    // Cascade upward from the bottom-right dead space, wrapping left in columns
    const perCol = Math.max(1, Math.floor((hostH - MARGIN * 2 + GAP) / (ICON_H + GAP)));
    const col = Math.floor(index / perCol);
    const row = index % perCol;
    return {
      x: hostW - MARGIN - ICON_W - col * (ICON_W + GAP),
      y: hostH - MARGIN - ICON_H - row * (ICON_H + GAP),
    };
  }

  function clampAll() {
    const { w: hw, h: hh } = hostSize();
    let changed = false;
    for (const id of Object.keys(positions)) {
      const p = positions[id];
      if (!p) continue;
      const nx = clamp(Number(p.x) || 0, 0, Math.max(0, hw - ICON_W));
      const ny = clamp(Number(p.y) || 0, 0, Math.max(0, hh - ICON_H));
      if (nx !== p.x || ny !== p.y) {
        positions[id] = { x: nx, y: ny };
        changed = true;
      }
    }
    if (changed) savePositions(positions);
  }

  function setIframePointerEvents(enabled) {
    workspace.querySelectorAll("iframe").forEach((frame) => {
      frame.style.pointerEvents = enabled ? "" : "none";
    });
  }

  function bindIcon(el, pin) {
    el.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      const { w: hw, h: hh } = hostSize();
      const startX = e.clientX;
      const startY = e.clientY;
      const pos = positions[pin.id] || { x: el.offsetLeft, y: el.offsetTop };
      const ox = pos.x;
      const oy = pos.y;
      let dragging = false;

      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }

      const move = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (!dragging) {
          dragging = true;
          el.classList.add("is-dragging");
          setIframePointerEvents(false);
          document.body.style.userSelect = "none";
        }
        const nx = clamp(ox + dx, 0, Math.max(0, hw - ICON_W));
        const ny = clamp(oy + dy, 0, Math.max(0, hh - ICON_H));
        positions[pin.id] = { x: nx, y: ny };
        el.style.left = `${nx}px`;
        el.style.top = `${ny}px`;
      };
      const up = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        if (dragging) {
          el.classList.remove("is-dragging");
          setIframePointerEvents(true);
          document.body.style.userSelect = "";
          savePositions(positions);
        } else {
          runPinnedCommand(clientId, pin);
        }
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      e.preventDefault();
    });

    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        runPinnedCommand(clientId, pin);
      }
    });
  }

  function renderIcons() {
    workspace.querySelectorAll(".d2-icon").forEach((el) => el.remove());
    if (!active) return;

    clampAll();
    const pins = loadPins();
    // drop positions of removed pins
    const pinIds = new Set(pins.map((p) => p.id));
    let pruned = false;
    for (const id of Object.keys(positions)) {
      if (!pinIds.has(id)) {
        delete positions[id];
        pruned = true;
      }
    }
    if (pruned) savePositions(positions);

    const { w: hw, h: hh } = hostSize();
    let autoIndex = 0;
    for (const pin of pins) {
      if (!positions[pin.id]) {
        positions[pin.id] = defaultSlot(autoIndex, hw, hh);
        savePositions(positions);
      }
      autoIndex += 1;
      const p = positions[pin.id];
      const el = document.createElement("div");
      el.className = "d2-icon";
      el.dataset.d2Icon = pin.id;
      el.tabIndex = 0;
      el.title = `${pin.label} — click to open, drag to move`;
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.innerHTML = `
        <span class="d2-icon-img"><i class="${escapeHtml(pin.icon || "fa-solid fa-bolt")}" style="color:${escapeHtml(pin.color || "#94a3b8")}"></i></span>
        <span class="d2-icon-label">${escapeHtml(pin.label)}</span>
      `;
      bindIcon(el, pin);
      workspace.appendChild(el);
    }
  }

  function onPinsChanged() {
    renderIcons();
  }
  function onStorage(e) {
    if (e.key === SIDE_PINS_KEY || e.key === POS_KEY) {
      positions = loadPositions();
      renderIcons();
    }
  }
  function onWindowResize() {
    if (!active) return;
    clampAll();
    renderIcons();
  }

  window.addEventListener("overlord:pins-changed", onPinsChanged);
  window.addEventListener("storage", onStorage);
  window.addEventListener("resize", onWindowResize);

  return {
    version: DASHBOARD2_ICONS_VERSION,
    activate() {
      active = true;
      positions = loadPositions();
      renderIcons();
    },
    deactivate() {
      active = false;
      workspace.querySelectorAll(".d2-icon").forEach((el) => el.remove());
    },
    refresh: renderIcons,
    destroy() {
      deactivate();
      window.removeEventListener("overlord:pins-changed", onPinsChanged);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("resize", onWindowResize);
    },
  };
}
