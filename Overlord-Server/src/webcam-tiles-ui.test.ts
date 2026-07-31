import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const publicAsset = (name: string) => readFile(new URL(`../public/assets/${name}`, import.meta.url), "utf8");

describe("webcam tile failures", () => {
  test("gives each webcam one 30s connect budget with a visible countdown, then removes it", async () => {
    const js = await publicAsset("webcams.js");
    expect(js).toContain("const CONNECT_TIMEOUT_MS = 30000");
    expect(js).toContain("function armConnectBudget(clientId)");
    expect(js).toContain("function tickConnectBudgets()");
    expect(js).toContain("tile-countdown");
    expect(js).toContain("connectDeadlines.set(clientId, Date.now() + CONNECT_TIMEOUT_MS)");
    expect(js).toContain("if (remainingMs <= 0) removeTile(clientId, tile)");
    // The budget is cancelled only when the webcam actually streams.
    expect(js).toContain('if (state === "streaming") {\n    clearConnectBudget(clientId);');
    expect(js).toContain("activeTiles.delete(clientId)");
    expect(js).toContain("tile.remove()");
    expect(js).toContain("syncLayout()");
    expect(js).toContain("Math.min(index * 180, 4000)");
    // No retry/grace machinery: dead webcams never get a second budget.
    expect(js).not.toContain("MAX_TILE_RETRIES");
    expect(js).not.toContain("scheduleTileRetry");
    expect(js).not.toContain("TILE_FAILURE_TIMEOUT_MS");
  });

  test("removes tiles immediately on error, offline, not-found, or disconnected", async () => {
    const js = await publicAsset("webcams.js");
    expect(js).toContain('const IMMEDIATE_REMOVAL_STATES = new Set(["error", "offline", "not-found", "disconnected"])');
    expect(js).toContain("if (IMMEDIATE_REMOVAL_STATES.has(state)) {");
    expect(js).toContain("removeTile(clientId, tile);");
    expect(js).not.toContain("recoverableTileStates");
  });

  test("expands selected tile via popup only without competing array stream", async () => {
    const js = await publicAsset("webcams.js");
    expect(js).toContain('const WEBCAMS_JS_VERSION = "1.5.0"');
    expect(js).toContain("function stopAllTiles()");
    expect(js).toContain("function startTile(tile)");
    expect(js).toContain("function restoreAllTiles()");
    expect(js).toContain("const win = window.open(viewerUrl, \"_blank\")");
    expect(js).toContain("if (!win) return");
    expect(js).toContain("stopAllTiles()");
    expect(js).toContain("watchFocusedViewer(win, session)");
    expect(js).toContain("fromArray=1");
    expect(js).toContain("webcam_array_viewer_closed");
    expect(js).toContain("win.closed");
    // Expand must not leave the selected tile live in the array while the popup streams.
    expect(js).not.toMatch(/tile-expand[\s\S]{0,400}stopOtherTiles\(id\)/);
    const viewerJs = await publicAsset("viewer.js");
    expect(viewerJs).toContain('fromArray = params.get("fromArray") === "1"');
    expect(viewerJs).toContain("webcam_array_viewer_closed");
    expect(viewerJs).toContain("notifyArrayViewerClosed");
  });

  test("caches the last visible frame per tile and restores snapshots without reconnecting", async () => {
    const js = await publicAsset("webcams.js");
    expect(js).toContain("function captureTileSnapshot(clientId, tile)");
    expect(js).toContain("tileSnapshots.set(clientId, canvas.toDataURL(\"image/jpeg\"");
    expect(js).toContain("getElementById(\"frameCanvas\")");
    expect(js).toContain("function showSnapshot(tile, dataUrl)");
    expect(js).toContain("function hideSnapshot(tile)");
    expect(js).toContain("is-cached");
    // Snapshots are captured before the array pauses for the focused viewer.
    expect(js).toMatch(/captureTileSnapshot\(cid, t\)[\s\S]{0,200}stopAllTiles\(\)/);
    // Cached tiles stay on the snapshot until the operator clicks to resume.
    expect(js).toContain("Cached frame · click to resume");
    expect(js).toContain('if (!tile.classList.contains("is-cached")) return;');
    const css = await publicAsset("main.css");
    expect(css).toContain(".tile-snapshot{");
    expect(css).toContain(".tile-countdown{");
    expect(css).toContain(".webcam-tile.is-cached iframe{display:none}");
  });

  test("recovers from stalls and prefers jpeg in embedded array tiles", async () => {
    const js = await publicAsset("webcam.js");
    expect(js).toContain("function fallbackToJpeg");
    expect(js).toContain("let prefersH264 = !embedded && typeof VideoDecoder === \"function\"");
    expect(js).toContain("Retrying in ${remaining}...");
    expect(js).toContain("beginStallRecovery");
    expect(js).toContain("const MAX_STALL_RESTARTS = 3");
    expect(js).toContain("intentionalRestart");
    expect(js).toContain('setStreamState("error", "Camera stopped delivering images")');
    expect(js).toContain("webrtcVideo?.addEventListener(\"timeupdate\", recordWebrtcFrame)");
    expect(js).toContain("postStatusToParent(state");
    expect(js).toContain("noteFrameReceived");
    expect(js).toContain("const arrayTile = embedded && !showControls");
    expect(js).toContain("const requestedFps = arrayTile ? 15");
    expect(js).toContain("const maxHeight = arrayTile ? 360");
    expect(js).toContain('fallbackToJpeg("decoder_backpressure")');
  });

  test("grid layout scores fitted video area so wide screens never get strip layouts", async () => {
    const js = await publicAsset("webcams.js");
    expect(js).toContain("const TARGET_ASPECT = 16 / 9");
    expect(js).toContain("function bestGrid(n, width, height, gap)");
    expect(js).toContain("const videoW = Math.min(cellW, cellH * TARGET_ASPECT)");
    expect(js).toContain("const videoH = videoW / TARGET_ASPECT");
    expect(js).toContain("const score = videoW * videoH * fill");
    // Raw cell area scoring favored degenerate n×1 strip layouts on wide screens.
    expect(js).not.toContain("const score = cellW * cellH * fill");
  });

  test("pauses array streams while the page is hidden", async () => {
    const js = await publicAsset("webcams.js");
    expect(js).toContain('document.addEventListener("visibilitychange"');
    expect(js).toContain("resumeAfterVisibility.add(id)");
    expect(js).toContain("stopTile(tile)");
    expect(js).toContain("startTile(tile)");
  });

  test("array tiles fill the iframe stage without covering canvas", async () => {
    const js = await publicAsset("webcam.js");
    expect(js).toContain("function applyMediaAspect");
    expect(js).toContain('classList.toggle("is-active"');
    expect(js).toContain('classList.toggle("is-hidden"');
    const css = await publicAsset("main.css");
    expect(css).toContain("body.webcam-embedded");
    expect(css).toContain("object-fit:contain!important");
    expect(css).toContain("position:absolute!important");
    expect(css).toContain(".webcam-embedded #webrtcVideo{display:none}");
    expect(css).toContain(".webcam-embedded #webrtcVideo.is-active{display:block!important}");
    expect(css).toContain("width:100%!important");
    expect(css).toContain("height:100%!important");
    // Base video rule must stay hidden; only .is-active may show the element
    expect(css).toMatch(/\.webcam-embedded #webrtcVideo\{display:none\}/);
    expect(css).not.toMatch(/\.webcam-embedded #webrtcVideo,[\s\S]{0,200}display:block!important/);
  });
});
