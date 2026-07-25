import { describe, expect, test } from "bun:test";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

const publicAsset = (name: string) => readFile(new URL(`../public/assets/${name}`, import.meta.url), "utf8");
const publicFile = (name: string) => new URL(`../public/assets/${name}`, import.meta.url);

async function exists(name: string) {
  try {
    await access(publicFile(name), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

describe("dashboard sound effects", () => {
  test("ships sample wav assets", async () => {
    for (const name of [
      "sounds/startup.wav",
      "sounds/success.wav",
      "sounds/error.wav",
      "sounds/click.wav",
      "sounds/client-online.wav",
    ]) {
      expect(await exists(name)).toBe(true);
    }
  });

  test("plays sample when a client comes online", async () => {
    const notifyClient = await publicAsset("notify-client.js");
    const sounds = await publicAsset("sounds.js");

    expect(notifyClient).toContain('payload.event === "client_online"');
    expect(notifyClient).toContain("isClientOnlineSoundEnabled()");
    expect(notifyClient).toContain('playSoundEffect("clientOnline")');
    expect(sounds).toContain("clientOnline:");
    expect(sounds).toContain("isClientOnlineSoundEnabled");
    expect(sounds).toContain("client-online.wav");
  });

  test("settings exposes sound category toggles and previews", async () => {
    const settingsHtml = await readFile(new URL("../public/settings.html", import.meta.url), "utf8");
    const settingsJs = await publicAsset("settings.js");
    const sounds = await publicAsset("sounds.js");

    expect(settingsHtml).toContain('id="pref-sound-effects"');
    expect(settingsHtml).toContain('id="pref-sound-startup"');
    expect(settingsHtml).toContain('id="pref-sound-success"');
    expect(settingsHtml).toContain('id="pref-sound-error"');
    expect(settingsHtml).toContain('id="pref-sound-click"');
    expect(settingsHtml).toContain('id="pref-client-online-sound"');
    expect(settingsHtml).toContain('data-sound-test="startup"');
    expect(settingsJs).toContain("setStartupSoundEnabled");
    expect(settingsJs).toContain("setSuccessSoundEnabled");
    expect(settingsJs).toContain("setErrorSoundEnabled");
    expect(settingsJs).toContain("setClickSoundEnabled");
    expect(settingsJs).toContain("setClientOnlineSoundEnabled");
    expect(sounds).toContain("setStartupSoundEnabled");
    expect(sounds).toContain("setSuccessSoundEnabled");
    expect(sounds).toContain("setErrorSoundEnabled");
    expect(sounds).toContain("setClickSoundEnabled");
  });

  test("login marks startup sound and plays error on failure", async () => {
    const loginJs = await publicAsset("login.js");
    const loginHtml = await readFile(new URL("../public/login.html", import.meta.url), "utf8");
    const navJs = await publicAsset("nav.js");
    const sounds = await publicAsset("sounds.js");

    expect(loginHtml).toContain('type="module" src="/assets/login.js"');
    expect(loginJs).toContain("markStartupSoundPending");
    expect(loginJs).toContain("playErrorSound");
    expect(loginJs).toContain("playClickSound");
    expect(navJs).toContain("playStartupSoundIfPending");
    expect(sounds).toContain("overlord_play_startup_sound");
  });

  test("toasts and side panel play success and error samples", async () => {
    const toastJs = await publicAsset("toast.js");
    const sidePanel = await publicAsset("side-panel.js");
    const filebrowser = await publicAsset("filebrowser.js");

    expect(toastJs).toContain("playToastSound");
    expect(toastJs).toContain('type === "success" ? "success" : "error"');
    expect(toastJs).toContain('import("./sounds.js")');
    expect(sidePanel).toContain("playSuccessSound");
    expect(sidePanel).toContain("playErrorSound");
    expect(sidePanel).toContain("playClickSound");
    expect(filebrowser).toContain("./sounds.js");
  });
});
