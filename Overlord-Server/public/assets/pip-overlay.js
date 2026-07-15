const STORAGE_KEY = "overlord_pip_layout_v1";
const DEFAULT_LAYOUT = {
  leftPct: null,
  topPct: null,
  widthPct: 28,
  heightPct: 28,
  pinned: false,
  corner: "tr",
};

const MIN_W = 180;
const MIN_H = 120;
const PAD = 12;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function loadLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_LAYOUT, ...parsed };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

function saveLayout(layout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {}
}

function cornerPosition(hostW, hostH, boxW, boxH, corner) {
  const maxL = Math.max(0, hostW - boxW);
  const maxT = Math.max(0, hostH - boxH);
  switch (corner) {
    case "tl":
      return { left: PAD, top: PAD };
    case "tr":
      return { left: maxL - PAD, top: PAD };
    case "bl":
      return { left: PAD, top: maxT - PAD };
    case "br":
    default:
      return { left: maxL - PAD, top: maxT - PAD };
  }
}

/**
 * @param {{
 *   root: HTMLElement,
 *   host: HTMLElement,
 *   iframe?: HTMLIFrameElement | null,
 *   onClose?: () => void,
 * }} options
 */
export function initPipOverlay(options) {
  const { root, host, iframe = null, onClose = null } = options;
  if (!root || !host) {
    return {
      setPinned() {},
      snap() {},
      show() {},
      hide() {},
      destroy() {},
      isPinned: () => false,
      getLayout: () => ({ ...DEFAULT_LAYOUT }),
    };
  }

  let layout = loadLayout();
  let dragging = false;
  let resizing = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let startW = 0;
  let startH = 0;
  let pointerId = null;

  const toolbar = root.querySelector("[data-pip-toolbar]");
  const pinBtn = root.querySelector("[data-pip-pin]");
  const closeBtn = root.querySelector("[data-pip-close]");
  const resizeHandle = root.querySelector("[data-pip-resize]");
  const lockBadge = root.querySelector("[data-pip-lock-badge]");
  const snapBtns = root.querySelectorAll("[data-pip-snap]");

  function hostRect() {
    return host.getBoundingClientRect();
  }

  function applyPinnedUi() {
    root.classList.toggle("is-pinned", !!layout.pinned);
    if (pinBtn) {
      pinBtn.classList.toggle("is-active", !!layout.pinned);
      pinBtn.title = layout.pinned ? "Unpin / Unlock Position" : "Pin / Lock Position";
      pinBtn.setAttribute("aria-pressed", layout.pinned ? "true" : "false");
    }
    if (lockBadge) lockBadge.hidden = !layout.pinned;
    root.style.cursor = layout.pinned ? "default" : "move";
  }

  function setIframePointerEvents(enabled) {
    if (iframe) iframe.style.pointerEvents = enabled ? "" : "none";
    host.querySelectorAll("iframe").forEach((f) => {
      if (f !== iframe) f.style.pointerEvents = enabled ? "" : "none";
    });
  }

  function applyLayoutFromPixels(left, top, width, height) {
    const hr = hostRect();
    const w = clamp(width, MIN_W, Math.max(MIN_W, hr.width - PAD * 2));
    const h = clamp(height, MIN_H, Math.max(MIN_H, hr.height - PAD * 2));
    const l = clamp(left, 0, Math.max(0, hr.width - w));
    const t = clamp(top, 0, Math.max(0, hr.height - h));

    root.style.left = `${l}px`;
    root.style.top = `${t}px`;
    root.style.width = `${w}px`;
    root.style.height = `${h}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";

    if (hr.width > 0 && hr.height > 0) {
      layout.leftPct = (l / hr.width) * 100;
      layout.topPct = (t / hr.height) * 100;
      layout.widthPct = (w / hr.width) * 100;
      layout.heightPct = (h / hr.height) * 100;
    }
  }

  function restoreLayout() {
    const hr = hostRect();
    if (hr.width < 1 || hr.height < 1) return;

    let w = ((layout.widthPct || DEFAULT_LAYOUT.widthPct) / 100) * hr.width;
    let h = ((layout.heightPct || DEFAULT_LAYOUT.heightPct) / 100) * hr.height;
    w = clamp(w, MIN_W, Math.max(MIN_W, hr.width - PAD * 2));
    h = clamp(h, MIN_H, Math.max(MIN_H, hr.height - PAD * 2));

    let left;
    let top;
    if (layout.leftPct != null && layout.topPct != null) {
      left = (layout.leftPct / 100) * hr.width;
      top = (layout.topPct / 100) * hr.height;
    } else {
      const corner = layout.corner || "tr";
      const pos = cornerPosition(hr.width, hr.height, w, h, corner);
      left = pos.left;
      top = pos.top;
    }

    applyLayoutFromPixels(left, top, w, h);
    applyPinnedUi();
  }

  function persist() {
    saveLayout(layout);
  }

  function setPinned(pinned) {
    layout.pinned = !!pinned;
    applyPinnedUi();
    persist();
  }

  function snap(corner) {
    if (layout.pinned) return;
    layout.corner = corner;
    const hr = hostRect();
    const w = root.offsetWidth || ((layout.widthPct / 100) * hr.width);
    const h = root.offsetHeight || ((layout.heightPct / 100) * hr.height);
    const pos = cornerPosition(hr.width, hr.height, w, h, corner);
    applyLayoutFromPixels(pos.left, pos.top, w, h);
    persist();
  }

  function onDragStart(e) {
    if (layout.pinned) return;
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest("button, [data-pip-resize], a, input, select")) return;

    e.preventDefault();
    dragging = true;
    pointerId = e.pointerId;
    try {
      root.setPointerCapture(pointerId);
    } catch {}

    const rect = root.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left - hostRect().left;
    startTop = rect.top - hostRect().top;
    setIframePointerEvents(false);
    root.classList.add("is-dragging");
  }

  function onResizeStart(e) {
    if (layout.pinned) return;
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    resizing = true;
    pointerId = e.pointerId;
    try {
      root.setPointerCapture(pointerId);
    } catch {}

    const rect = root.getBoundingClientRect();
    const hr = hostRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left - hr.left;
    startTop = rect.top - hr.top;
    startW = rect.width;
    startH = rect.height;
    setIframePointerEvents(false);
    root.classList.add("is-resizing");
  }

  function onPointerMove(e) {
    if (!dragging && !resizing) return;
    if (pointerId != null && e.pointerId !== pointerId) return;

    if (dragging) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      applyLayoutFromPixels(startLeft + dx, startTop + dy, root.offsetWidth, root.offsetHeight);
      layout.corner = null;
      return;
    }

    if (resizing) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      applyLayoutFromPixels(startLeft, startTop, startW + dx, startH + dy);
      layout.corner = null;
    }
  }

  function onPointerEnd(e) {
    if (pointerId != null && e.pointerId !== pointerId) return;
    if (!dragging && !resizing) return;
    dragging = false;
    resizing = false;
    pointerId = null;
    root.classList.remove("is-dragging", "is-resizing");
    setIframePointerEvents(true);
    persist();
  }

  function onPinClick(e) {
    e.preventDefault();
    e.stopPropagation();
    setPinned(!layout.pinned);
  }

  function onCloseClick(e) {
    e.preventDefault();
    e.stopPropagation();
    hide();
    if (typeof onClose === "function") onClose();
  }

  function onSnapClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const corner = e.currentTarget.getAttribute("data-pip-snap");
    if (corner) snap(corner);
  }

  const dragSurface = toolbar || root;
  dragSurface.addEventListener("pointerdown", onDragStart);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", onPointerEnd);
  root.addEventListener("pointercancel", onPointerEnd);
  if (resizeHandle) resizeHandle.addEventListener("pointerdown", onResizeStart);
  if (pinBtn) pinBtn.addEventListener("click", onPinClick);
  if (closeBtn) closeBtn.addEventListener("click", onCloseClick);
  snapBtns.forEach((btn) => btn.addEventListener("click", onSnapClick));

  let ro = null;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => restoreLayout());
    ro.observe(host);
  }
  window.addEventListener("resize", restoreLayout);

  function show() {
    root.hidden = false;
    root.style.display = "";
    root.classList.add("is-visible");
    requestAnimationFrame(restoreLayout);
  }

  function hide() {
    root.hidden = true;
    root.style.display = "none";
    root.classList.remove("is-visible", "is-dragging", "is-resizing");
  }

  function destroy() {
    dragSurface.removeEventListener("pointerdown", onDragStart);
    root.removeEventListener("pointermove", onPointerMove);
    root.removeEventListener("pointerup", onPointerEnd);
    root.removeEventListener("pointercancel", onPointerEnd);
    if (resizeHandle) resizeHandle.removeEventListener("pointerdown", onResizeStart);
    if (pinBtn) pinBtn.removeEventListener("click", onPinClick);
    if (closeBtn) closeBtn.removeEventListener("click", onCloseClick);
    snapBtns.forEach((btn) => btn.removeEventListener("click", onSnapClick));
    window.removeEventListener("resize", restoreLayout);
    if (ro) ro.disconnect();
  }

  applyPinnedUi();
  restoreLayout();

  return {
    setPinned,
    snap,
    show,
    hide,
    destroy,
    restoreLayout,
    isPinned: () => !!layout.pinned,
    getLayout: () => ({ ...layout }),
  };
}
