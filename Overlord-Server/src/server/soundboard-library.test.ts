import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import {
  addSound,
  deleteSound,
  listSounds,
  SOUNDBOARD_MAX_FILE_SIZE,
} from "./soundboard-library";

describe("soundboard library", () => {
  let dataDir = "";

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "overlord-sb-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  test("adds and lists mp3 sounds", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const entry = await addSound(dataDir, { fileName: "ahlarry.mp3", bytes, durationSec: 2.5 });
    expect(entry.name).toBe("ahlarry");
    expect(entry.ext).toBe("mp3");
    expect(entry.size).toBe(5);
    expect(entry.sha256).toHaveLength(64);

    const list = await listSounds(dataDir);
    expect(list.some((s) => s.id === entry.id)).toBe(true);
  });

  test("rejects oversized files", async () => {
    const bytes = new Uint8Array(SOUNDBOARD_MAX_FILE_SIZE + 1);
    await expect(addSound(dataDir, { fileName: "big.wav", bytes })).rejects.toThrow(/too large/i);
  });

  test("rejects bad extensions", async () => {
    await expect(addSound(dataDir, { fileName: "x.exe", bytes: new Uint8Array([1]) })).rejects.toThrow(
      /unsupported/i,
    );
  });

  test("deletes sounds", async () => {
    const entry = await addSound(dataDir, { fileName: "bye.wav", bytes: new Uint8Array([9, 9]) });
    expect(await deleteSound(dataDir, entry.id)).toBe(true);
    expect(await deleteSound(dataDir, entry.id)).toBe(false);
    const list = await listSounds(dataDir);
    expect(list.find((s) => s.id === entry.id)).toBeUndefined();
  });
});
