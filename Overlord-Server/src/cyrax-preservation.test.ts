import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { COMMAND_TYPES } from "./generated/wire-contract";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFile(join(root, path), "utf8");

describe("Cyrax feature preservation", () => {
  test("server registers custom command routes", async () => {
    const source = await read("src/main-server.ts");
    for (const handler of [
      "handleWallpaperRoutes",
      "handleSoundboardRoutes",
      "handleRemoteExecuteRoutes",
      "handleDeployRoutes",
      "handleWinRERoutes",
      "createHonoRouteHandler",
    ]) {
      expect(source).toContain(handler);
    }
  });

  test("custom viewer and media pages remain routed", async () => {
    const routes = await read("src/server/routes/page-routes.ts");
    for (const page of [
      "viewer.html",
      "webcams.html",
      "soundboard.html",
      "soundboard-remote.html",
      "files2.html",
      "processes2.html",
      "filebrowser-classic.html",
    ]) {
      expect(routes).toContain(page);
    }
  });

  test("custom browser assets remain available", async () => {
    for (const asset of [
      "side-panel.js",
      "viewer.js",
      "webcams.js",
      "sounds.js",
      "soundboard-remote.js",
      "dashboard2-mdi.js",
      "processes2.js",
    ]) {
      expect((await read(`public/assets/${asset}`)).length).toBeGreaterThan(100);
    }
    const sidePanel = await read("public/assets/side-panel.js");
    expect(sidePanel).toContain("Sound Board");
    expect(sidePanel).toContain("soundboard-remote");
  });

  test("wire catalog keeps Cyrax and upstream commands", () => {
    const commands = new Set<string>(COMMAND_TYPES);
    for (const command of [
      "set_wallpaper",
      "play_sound",
      "stop_sound",
      "system_volume",
      "file_upload_desktop",
      "silent_exec",
    ]) {
      expect(commands.has(command)).toBe(true);
    }
  });

  test("upstream privacy, virtual, drop, and shared-ui paths remain present", async () => {
    const remoteDesktop = `${await read("public/remotedesktop.html")}\n${await read("public/assets/remotedesktop.js")}`;
    const backstage = await read("public/assets/backstage.js");
    expect(remoteDesktop.toLowerCase()).toContain("privacy");
    expect(backstage.toLowerCase()).toContain("virtual_mode");
    expect(remoteDesktop).toContain("generated/shared-ui-settings.js");
    expect(remoteDesktop).toMatch(/file_upload_desktop|desktop-file-drop|drop/i);
  });
});
