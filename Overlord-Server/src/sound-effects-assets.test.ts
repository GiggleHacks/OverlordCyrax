import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const publicAsset = (name: string) => readFile(new URL(`../public/assets/${name}`, import.meta.url), "utf8");

describe("dashboard sound effects", () => {
  test("plays Air Resolve when a client comes online", async () => {
    const notifyClient = await publicAsset("notify-client.js");
    const sounds = await publicAsset("sounds.js");

    expect(notifyClient).toContain('payload.event === "client_online"');
    expect(notifyClient).toContain("isClientOnlineSoundEnabled()");
    expect(notifyClient).toContain('playSoundEffect("clientOnline")');
    expect(sounds).toContain("clientOnline(ctx)");
    expect(sounds).toContain("isClientOnlineSoundEnabled");
    expect(sounds).toContain("523");
    expect(sounds).toContain("1760");
  });

  test("settings exposes a client online sound toggle", async () => {
    const settingsHtml = await readFile(new URL("../public/settings.html", import.meta.url), "utf8");
    const settingsJs = await publicAsset("settings.js");
    const sounds = await publicAsset("sounds.js");

    expect(settingsHtml).toContain('id="pref-client-online-sound"');
    expect(settingsHtml).toContain("Play sound when clients come online");
    expect(settingsJs).toContain("setClientOnlineSoundEnabled");
    expect(settingsJs).toContain("prefClientOnlineSoundInput.checked");
    expect(sounds).toContain("setClientOnlineSoundEnabled");
  });
});
