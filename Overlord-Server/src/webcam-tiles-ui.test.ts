import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const publicAsset = (name: string) => readFile(new URL(`../public/assets/${name}`, import.meta.url), "utf8");

describe("webcam tile failures", () => {
  test("removes terminal tiles after five seconds and reflows the grid", async () => {
    const js = await publicAsset("webcams.js");
    expect(js).toContain("const TILE_FAILURE_TIMEOUT_MS = 5000");
    expect(js).toContain('"error", "offline", "disconnected", "not-found"');
    expect(js).toContain("setTimeout(() => removeTile(clientId, tile), TILE_FAILURE_TIMEOUT_MS)");
    expect(js).toContain("activeTiles.delete(clientId)");
    expect(js).toContain("tile.remove()");
    expect(js).toContain("syncLayout()");
    expect(js).toContain('setTileState(tile, "not-found")');
  });

  test("expands selected tile without blanking the array permanently", async () => {
    const js = await publicAsset("webcams.js");
    expect(js).toContain("function stopOtherTiles(selectedId)");
    expect(js).toContain("function startTile(tile)");
    expect(js).toContain("function restoreAllTiles()");
    expect(js).toContain("const win = window.open(viewerUrl, \"_blank\")");
    expect(js).toContain("if (!win) return");
    expect(js).toContain("stopOtherTiles(id)");
    expect(js).toContain("watchFocusedViewer(win, session)");
    expect(js).toContain("fromArray=1");
    expect(js).toContain("webcam_array_viewer_closed");
    expect(js).toContain("win.closed");
    const viewerJs = await publicAsset("viewer.js");
    expect(viewerJs).toContain('fromArray = params.get("fromArray") === "1"');
    expect(viewerJs).toContain("webcam_array_viewer_closed");
    expect(viewerJs).toContain("notifyArrayViewerClosed");
  });

  test("reports image decode and render stalls to the tile host", async () => {
    const js = await publicAsset("webcam.js");
    expect(js).toContain('setStreamState("error", "Unable to render camera image")');
    expect(js).toContain('setStreamState("error", "Unable to decode camera image")');
    expect(js).toContain('setStreamState("error", "Camera stopped delivering images")');
    expect(js).toContain("webrtcVideo?.addEventListener(\"timeupdate\", recordWebrtcFrame)");
    expect(js).toContain("postStatusToParent(state)");
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
