import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import {
  clearClientSoundPresence,
  clearSoundPresenceEverywhere,
  getClientSoundPresence,
  listClientPresence,
  markClientSoundUploaded,
  presenceMatches,
} from "./soundboard-client-cache";

describe("soundboard client presence cache", () => {
  let dataDir = "";

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "overlord-sb-presence-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  test("marks and lists presence per client", async () => {
    await markClientSoundUploaded(dataDir, "c1", {
      soundId: "s1",
      sha256: "abc",
      path: "C:\\Users\\Public\\Overlord\\soundboard\\s1.mp3",
      uploadedAt: 100,
    });
    await markClientSoundUploaded(dataDir, "c1", {
      soundId: "s2",
      sha256: "def",
      path: "C:\\Users\\Public\\Overlord\\soundboard\\s2.wav",
      uploadedAt: 200,
    });
    await markClientSoundUploaded(dataDir, "c2", {
      soundId: "s1",
      sha256: "abc",
      path: "C:\\Users\\Public\\Overlord\\soundboard\\s1.mp3",
      uploadedAt: 300,
    });

    const c1 = await listClientPresence(dataDir, "c1");
    expect(c1.map((p) => p.soundId).sort()).toEqual(["s1", "s2"]);
    const one = await getClientSoundPresence(dataDir, "c1", "s1");
    expect(one?.sha256).toBe("abc");
    expect(
      presenceMatches(one, "s1", "abc", "C:\\Users\\Public\\Overlord\\soundboard\\s1.mp3"),
    ).toBe(true);
    expect(
      presenceMatches(one, "s1", "zzz", "C:\\Users\\Public\\Overlord\\soundboard\\s1.mp3"),
    ).toBe(false);
  });

  test("clears one sound and clears everywhere", async () => {
    await markClientSoundUploaded(dataDir, "c1", {
      soundId: "s1",
      sha256: "abc",
      path: "p",
      uploadedAt: 1,
    });
    await markClientSoundUploaded(dataDir, "c2", {
      soundId: "s1",
      sha256: "abc",
      path: "p",
      uploadedAt: 1,
    });
    await clearClientSoundPresence(dataDir, "c1", "s1");
    expect(await getClientSoundPresence(dataDir, "c1", "s1")).toBeNull();
    expect(await getClientSoundPresence(dataDir, "c2", "s1")).not.toBeNull();

    await clearSoundPresenceEverywhere(dataDir, "s1");
    expect(await getClientSoundPresence(dataDir, "c2", "s1")).toBeNull();
  });
});
