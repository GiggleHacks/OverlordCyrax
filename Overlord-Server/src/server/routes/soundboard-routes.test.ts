import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { generateToken } from "../../auth";
import { createUser, deleteUser, getUserById } from "../../users";
import * as clientManager from "../../clientManager";
import { decodeMessage } from "../../protocol";
import { addSound } from "../soundboard-library";
import { getClientSoundPresence, markClientSoundUploaded } from "../soundboard-client-cache";
import { handleSoundboardRoutes } from "./soundboard-routes";

const PASSWORD = "Aa1!SoundboardTestPass_2026";

async function createAdminToken() {
  const username = `sb_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const created = await createUser(username, PASSWORD, "admin", "test");
  expect(created.success).toBe(true);
  const user = getUserById(created.userId!);
  expect(user).toBeTruthy();
  return {
    userId: created.userId!,
    token: await generateToken(user!),
  };
}

function makeServer() {
  return { requestIP: () => ({ address: "127.0.0.1" }) };
}

describe("soundboard routes", () => {
  let dataDir = "";

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "overlord-sb-routes-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  test("lists library", async () => {
    const auth = await createAdminToken();
    try {
      const req = new Request("https://example.test/api/soundboard/sounds", {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      const res = await handleSoundboardRoutes(req, new URL(req.url), makeServer(), {
        DATA_DIR: dataDir,
        pendingCommandReplies: new Map(),
        pendingScripts: new Map(),
      });
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      const body = await res!.json();
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.sounds)).toBe(true);
    } finally {
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("uploads a sound via multipart", async () => {
    const auth = await createAdminToken();
    try {
      const form = new FormData();
      form.append("file", new File([new Uint8Array([1, 2, 3, 4])], "beep.mp3", { type: "audio/mpeg" }));
      form.append("durationSec", "1.2");
      const req = new Request("https://example.test/api/soundboard/sounds", {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}` },
        body: form,
      });
      const res = await handleSoundboardRoutes(req, new URL(req.url), makeServer(), {
        DATA_DIR: dataDir,
        pendingCommandReplies: new Map(),
        pendingScripts: new Map(),
      });
      expect(res!.status).toBe(200);
      const body = await res!.json();
      expect(body.ok).toBe(true);
      expect(body.sound.name).toBe("beep");
      expect(body.sound.ext).toBe("mp3");
    } finally {
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("upload job uses relative pull url and marks presence", async () => {
    const auth = await createAdminToken();
    const clientId = `sb-client-${Date.now().toString(36)}`;
    const pendingCommandReplies = new Map<string, any>();
    const entry = await addSound(dataDir, {
      fileName: "troll.wav",
      bytes: new Uint8Array([10, 20, 30, 40]),
    });
    let seenUploadUrl = "";

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      version: "3.0.6",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          queueMicrotask(() => {
            const pending = pendingCommandReplies.get(msg.id);
            if (!pending) return;
            if (msg.commandType === "file_upload_http") {
              seenUploadUrl = String(msg.payload?.url || "");
              pending.onProgress?.({
                transferred: 40,
                total: 40,
                speedBytesPerSecond: 1000,
                message: "done",
              });
              pending.resolve({ ok: true, message: "uploaded" });
              return;
            }
            pending.resolve({ ok: true, message: "ok" });
          });
        },
      },
    } as any);

    try {
      const req = new Request(`https://example.test/api/clients/${clientId}/soundboard/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ soundId: entry.id }),
      });
      const res = await handleSoundboardRoutes(req, new URL(req.url), makeServer(), {
        DATA_DIR: dataDir,
        pendingCommandReplies,
        pendingScripts: new Map(),
      });
      expect(res!.status).toBe(200);
      const started = await res!.json();
      expect(started.jobId).toBeTruthy();
      expect(started.kind).toBe("upload");

      let final: any = null;
      for (let i = 0; i < 50; i++) {
        await Bun.sleep(20);
        const stReq = new Request(
          `https://example.test/api/clients/${clientId}/soundboard/upload/${started.jobId}`,
          { headers: { Authorization: `Bearer ${auth.token}` } },
        );
        const stRes = await handleSoundboardRoutes(stReq, new URL(stReq.url), makeServer(), {
          DATA_DIR: dataDir,
          pendingCommandReplies,
          pendingScripts: new Map(),
        });
        final = await stRes!.json();
        if (final.status === "succeeded" || final.status === "failed") break;
      }
      expect(final.status).toBe("succeeded");
      expect(final.percent).toBe(100);
      expect(seenUploadUrl.startsWith("/api/file/upload/pull/")).toBe(true);
      expect(seenUploadUrl.startsWith("http")).toBe(false);

      const presence = await getClientSoundPresence(dataDir, clientId, entry.id);
      expect(presence?.sha256).toBe(entry.sha256);

      const statusReq = new Request(`https://example.test/api/clients/${clientId}/soundboard/status`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      const statusRes = await handleSoundboardRoutes(statusReq, new URL(statusReq.url), makeServer(), {
        DATA_DIR: dataDir,
        pendingCommandReplies,
        pendingScripts: new Map(),
      });
      const statusBody = await statusRes!.json();
      expect(statusBody.readySoundIds).toContain(entry.id);
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("play requires prior upload and does not transfer", async () => {
    const auth = await createAdminToken();
    const clientId = `sb-play-${Date.now().toString(36)}`;
    const pendingCommandReplies = new Map<string, any>();
    const entry = await addSound(dataDir, {
      fileName: "honk.mp3",
      bytes: new Uint8Array([1, 2, 3, 4, 5]),
    });
    const seenTypes: string[] = [];

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          queueMicrotask(() => {
            seenTypes.push(msg.commandType);
            pendingCommandReplies.get(msg.id)?.resolve({
              ok: true,
              message: msg.commandType === "play_sound" ? "playing" : "ok",
            });
          });
        },
      },
    } as any);

    try {
      const blockedReq = new Request(`https://example.test/api/clients/${clientId}/soundboard/play`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ soundId: entry.id }),
      });
      const blockedRes = await handleSoundboardRoutes(blockedReq, new URL(blockedReq.url), makeServer(), {
        DATA_DIR: dataDir,
        pendingCommandReplies,
        pendingScripts: new Map(),
      });
      expect(blockedRes!.status).toBe(409);
      const blockedBody = await blockedRes!.json();
      expect(blockedBody.code).toBe("not_uploaded");

      await markClientSoundUploaded(dataDir, clientId, {
        soundId: entry.id,
        sha256: entry.sha256,
        path: `C:\\Users\\Public\\Overlord\\soundboard\\${entry.id}.${entry.ext}`,
        uploadedAt: Date.now(),
      });

      const playReq = new Request(`https://example.test/api/clients/${clientId}/soundboard/play`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ soundId: entry.id }),
      });
      const playRes = await handleSoundboardRoutes(playReq, new URL(playReq.url), makeServer(), {
        DATA_DIR: dataDir,
        pendingCommandReplies,
        pendingScripts: new Map(),
      });
      const started = await playRes!.json();
      expect(started.jobId).toBeTruthy();
      expect(started.kind).toBe("play");

      let final: any = null;
      for (let i = 0; i < 50; i++) {
        await Bun.sleep(20);
        const stReq = new Request(
          `https://example.test/api/clients/${clientId}/soundboard/play/${started.jobId}`,
          { headers: { Authorization: `Bearer ${auth.token}` } },
        );
        const stRes = await handleSoundboardRoutes(stReq, new URL(stReq.url), makeServer(), {
          DATA_DIR: dataDir,
          pendingCommandReplies,
          pendingScripts: new Map(),
        });
        final = await stRes!.json();
        if (final.status === "succeeded" || final.status === "failed") break;
      }
      expect(final.status).toBe("succeeded");
      expect(seenTypes).toContain("play_sound");
      expect(seenTypes).not.toContain("file_upload_http");
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("volume get parses system_volume result", async () => {
    const auth = await createAdminToken();
    const clientId = `sb-vol-${Date.now().toString(36)}`;
    const pendingCommandReplies = new Map<string, any>();

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          queueMicrotask(() => {
            pendingCommandReplies.get(msg.id)?.resolve({
              ok: true,
              message: "level=42 muted=false",
            });
          });
        },
      },
    } as any);

    try {
      const req = new Request(`https://example.test/api/clients/${clientId}/volume`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      const res = await handleSoundboardRoutes(req, new URL(req.url), makeServer(), {
        DATA_DIR: dataDir,
        pendingCommandReplies,
        pendingScripts: new Map(),
      });
      const body = await res!.json();
      expect(body.ok).toBe(true);
      expect(body.level).toBe(42);
      expect(body.muted).toBe(false);
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });
});
