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

  test("reports image decode and render stalls to the tile host", async () => {
    const js = await publicAsset("webcam.js");
    expect(js).toContain('setStreamState("error", "Unable to render camera image")');
    expect(js).toContain('setStreamState("error", "Unable to decode camera image")');
    expect(js).toContain('setStreamState("error", "Camera stopped delivering images")');
    expect(js).toContain("webrtcVideo?.addEventListener(\"timeupdate\", recordWebrtcFrame)");
    expect(js).toContain("postStatusToParent(state)");
  });
});
