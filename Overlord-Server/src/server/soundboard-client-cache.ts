import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export type ClientSoundPresence = {
  soundId: string;
  sha256: string;
  path: string;
  uploadedAt: number;
};

type PresenceStore = {
  version: 1;
  clients: Record<string, Record<string, ClientSoundPresence>>;
};

function presencePath(dataDir: string): string {
  return path.join(dataDir, "soundboard", "client-presence.json");
}

async function readStore(dataDir: string): Promise<PresenceStore> {
  try {
    const raw = await fs.readFile(presencePath(dataDir), "utf8");
    const parsed = JSON.parse(raw) as PresenceStore;
    if (!parsed || parsed.version !== 1 || typeof parsed.clients !== "object" || !parsed.clients) {
      return { version: 1, clients: {} };
    }
    return parsed;
  } catch {
    return { version: 1, clients: {} };
  }
}

async function writeStore(dataDir: string, store: PresenceStore): Promise<void> {
  const root = path.join(dataDir, "soundboard");
  await fs.mkdir(root, { recursive: true });
  const tmp = path.join(root, `client-presence.${randomUUID()}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tmp, presencePath(dataDir));
}

export async function listClientPresence(
  dataDir: string,
  clientId: string,
): Promise<ClientSoundPresence[]> {
  const store = await readStore(dataDir);
  const map = store.clients[clientId] || {};
  return Object.values(map).sort((a, b) => a.uploadedAt - b.uploadedAt);
}

export async function getClientSoundPresence(
  dataDir: string,
  clientId: string,
  soundId: string,
): Promise<ClientSoundPresence | null> {
  const store = await readStore(dataDir);
  return store.clients[clientId]?.[soundId] || null;
}

export async function markClientSoundUploaded(
  dataDir: string,
  clientId: string,
  entry: ClientSoundPresence,
): Promise<void> {
  const store = await readStore(dataDir);
  if (!store.clients[clientId]) store.clients[clientId] = {};
  store.clients[clientId][entry.soundId] = {
    soundId: entry.soundId,
    sha256: entry.sha256,
    path: entry.path,
    uploadedAt: entry.uploadedAt,
  };
  await writeStore(dataDir, store);
}

export async function clearClientSoundPresence(
  dataDir: string,
  clientId: string,
  soundId: string,
): Promise<void> {
  const store = await readStore(dataDir);
  const map = store.clients[clientId];
  if (!map || !map[soundId]) return;
  delete map[soundId];
  if (Object.keys(map).length === 0) delete store.clients[clientId];
  await writeStore(dataDir, store);
}

export async function clearSoundPresenceEverywhere(dataDir: string, soundId: string): Promise<void> {
  const store = await readStore(dataDir);
  let changed = false;
  for (const clientId of Object.keys(store.clients)) {
    if (store.clients[clientId]?.[soundId]) {
      delete store.clients[clientId][soundId];
      changed = true;
      if (Object.keys(store.clients[clientId]).length === 0) {
        delete store.clients[clientId];
      }
    }
  }
  if (changed) await writeStore(dataDir, store);
}

export function presenceMatches(
  presence: ClientSoundPresence | null | undefined,
  soundId: string,
  sha256: string,
  destPath: string,
): boolean {
  if (!presence) return false;
  return (
    presence.soundId === soundId &&
    presence.sha256.toLowerCase() === String(sha256 || "").toLowerCase() &&
    presence.path === destPath
  );
}
