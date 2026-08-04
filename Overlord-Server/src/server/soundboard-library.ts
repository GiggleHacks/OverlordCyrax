import { createHash, randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { existsSync } from "fs";

export type SoundboardEntry = {
  id: string;
  name: string;
  ext: "mp3" | "wav";
  size: number;
  sha256: string;
  durationSec?: number;
  createdAt: number;
};

export type SoundboardManifest = {
  version: 1;
  sounds: SoundboardEntry[];
};

const ALLOWED_EXTENSIONS = new Set(["mp3", "wav"]);
export const SOUNDBOARD_MAX_FILE_SIZE = 5 * 1024 * 1024;
export const SOUNDBOARD_MAX_DURATION_SEC = 30;
export const SOUNDBOARD_MAX_ENTRIES = 50;

function libraryRoot(dataDir: string): string {
  return path.join(dataDir, "soundboard");
}

function libraryDir(dataDir: string): string {
  return path.join(libraryRoot(dataDir), "library");
}

function manifestPath(dataDir: string): string {
  return path.join(libraryRoot(dataDir), "manifest.json");
}

function sha256Hex(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sanitizeDisplayName(name: string): string {
  const base = path.basename(String(name || "sound")).replace(/\.[^.]+$/, "");
  const cleaned = base.replace(/[^\w\s.-]+/g, "").trim().slice(0, 64);
  return cleaned || "sound";
}

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx < 0) return "";
  return fileName.slice(idx + 1).toLowerCase();
}

async function readManifest(dataDir: string): Promise<SoundboardManifest> {
  const mp = manifestPath(dataDir);
  try {
    const raw = await fs.readFile(mp, "utf8");
    const parsed = JSON.parse(raw) as SoundboardManifest;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.sounds)) {
      return { version: 1, sounds: [] };
    }
    return parsed;
  } catch {
    return { version: 1, sounds: [] };
  }
}

async function writeManifest(dataDir: string, manifest: SoundboardManifest): Promise<void> {
  const root = libraryRoot(dataDir);
  await fs.mkdir(libraryDir(dataDir), { recursive: true });
  const tmp = path.join(root, `manifest.${randomUUID()}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2), "utf8");
  await fs.rename(tmp, manifestPath(dataDir));
}

export function soundFilePath(dataDir: string, entry: SoundboardEntry): string {
  return path.join(libraryDir(dataDir), `${entry.id}.${entry.ext}`);
}

export async function listSounds(dataDir: string): Promise<SoundboardEntry[]> {
  await ensureSeeded(dataDir);
  const manifest = await readManifest(dataDir);
  return [...manifest.sounds].sort((a, b) => a.createdAt - b.createdAt);
}

export async function getSound(dataDir: string, id: string): Promise<SoundboardEntry | null> {
  await ensureSeeded(dataDir);
  const manifest = await readManifest(dataDir);
  return manifest.sounds.find((s) => s.id === id) || null;
}

export async function addSound(
  dataDir: string,
  opts: { fileName: string; bytes: Uint8Array; durationSec?: number },
): Promise<SoundboardEntry> {
  await ensureSeeded(dataDir);
  const ext = getExtension(opts.fileName);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw Object.assign(new Error(`Unsupported format: .${ext}. Use MP3 or WAV.`), { code: "invalid_file", status: 400 });
  }
  if (opts.bytes.byteLength <= 0) {
    throw Object.assign(new Error("Empty file"), { code: "invalid_file", status: 400 });
  }
  if (opts.bytes.byteLength > SOUNDBOARD_MAX_FILE_SIZE) {
    throw Object.assign(
      new Error(`File too large (${(opts.bytes.byteLength / 1024 / 1024).toFixed(1)} MB). Max is 5 MB.`),
      { code: "invalid_file", status: 400 },
    );
  }
  if (
    typeof opts.durationSec === "number" &&
    Number.isFinite(opts.durationSec) &&
    opts.durationSec > SOUNDBOARD_MAX_DURATION_SEC
  ) {
    throw Object.assign(
      new Error(`Sound too long (${opts.durationSec.toFixed(1)}s). Max is ${SOUNDBOARD_MAX_DURATION_SEC}s.`),
      { code: "invalid_file", status: 400 },
    );
  }

  const manifest = await readManifest(dataDir);
  if (manifest.sounds.length >= SOUNDBOARD_MAX_ENTRIES) {
    throw Object.assign(
      new Error(`Library full (max ${SOUNDBOARD_MAX_ENTRIES} sounds). Delete one first.`),
      { code: "library_full", status: 400 },
    );
  }

  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  const entry: SoundboardEntry = {
    id,
    name: sanitizeDisplayName(opts.fileName),
    ext: ext as "mp3" | "wav",
    size: opts.bytes.byteLength,
    sha256: sha256Hex(opts.bytes),
    durationSec:
      typeof opts.durationSec === "number" && Number.isFinite(opts.durationSec) && opts.durationSec > 0
        ? Math.round(opts.durationSec * 10) / 10
        : undefined,
    createdAt: Date.now(),
  };

  await fs.mkdir(libraryDir(dataDir), { recursive: true });
  const dest = soundFilePath(dataDir, entry);
  await fs.writeFile(dest, opts.bytes);
  manifest.sounds.push(entry);
  await writeManifest(dataDir, manifest);
  return entry;
}

export async function deleteSound(dataDir: string, id: string): Promise<boolean> {
  const manifest = await readManifest(dataDir);
  const idx = manifest.sounds.findIndex((s) => s.id === id);
  if (idx < 0) return false;
  const [entry] = manifest.sounds.splice(idx, 1);
  await writeManifest(dataDir, manifest);
  await fs.rm(soundFilePath(dataDir, entry), { force: true }).catch(() => {});
  return true;
}

function resolveDefaultsDir(): string | null {
  const candidates = [
    path.join(process.cwd(), "public", "assets", "soundboard-defaults"),
    path.join(process.cwd(), "Overlord-Server", "public", "assets", "soundboard-defaults"),
    path.resolve(import.meta.dir, "../../public/assets/soundboard-defaults"),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

let seedPromise: Promise<void> | null = null;

export async function ensureSeeded(dataDir: string): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      await fs.mkdir(libraryDir(dataDir), { recursive: true });
      const manifest = await readManifest(dataDir);
      if (manifest.sounds.length > 0) return;

      const defaultsDir = resolveDefaultsDir();
      if (!defaultsDir) return;
      let files: string[] = [];
      try {
        files = await fs.readdir(defaultsDir);
      } catch {
        return;
      }
      for (const file of files) {
        const ext = getExtension(file);
        if (!ALLOWED_EXTENSIONS.has(ext)) continue;
        const full = path.join(defaultsDir, file);
        try {
          const bytes = new Uint8Array(await fs.readFile(full));
          if (bytes.byteLength === 0 || bytes.byteLength > SOUNDBOARD_MAX_FILE_SIZE) continue;
          const id = randomUUID().replace(/-/g, "").slice(0, 16);
          const entry: SoundboardEntry = {
            id,
            name: sanitizeDisplayName(file),
            ext: ext as "mp3" | "wav",
            size: bytes.byteLength,
            sha256: sha256Hex(bytes),
            createdAt: Date.now(),
          };
          await fs.writeFile(soundFilePath(dataDir, entry), bytes);
          manifest.sounds.push(entry);
        } catch {
          // skip broken default
        }
      }
      if (manifest.sounds.length > 0) {
        await writeManifest(dataDir, manifest);
      }
    })().finally(() => {
      // allow retry if first seed raced empty data dir before defaults existed
    });
  }
  await seedPromise;
}
