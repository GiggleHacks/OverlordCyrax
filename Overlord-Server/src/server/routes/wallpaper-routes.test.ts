import { describe, expect, test } from "bun:test";
import { decodeMessage } from "../../protocol";
import { generateToken } from "../../auth";
import { createUser, deleteUser, getUserById } from "../../users";
import * as clientManager from "../../clientManager";
import { handleWallpaperRoutes } from "./wallpaper-routes";

const PASSWORD = "Aa1!WallpaperRoutePass123";

type PendingCommandReply = {
  resolve: (result: { ok: boolean; message?: string }) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  clientId: string;
  onProgress?: (payload: any) => void;
};

type PendingScript = {
  resolve: (result: { ok: boolean; result?: string; error?: string }) => void;
  reject: (error: any) => void;
  timeout: NodeJS.Timeout;
  clientId: string;
};

const mockServer = {
  requestIP: () => ({ address: "127.0.0.1" }),
};

async function createAdminToken() {
  const username = `wallpaper_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const created = await createUser(username, PASSWORD, "admin", "test");
  expect(created.success).toBe(true);
  const user = getUserById(created.userId!);
  expect(user).not.toBeNull();
  return {
    userId: created.userId!,
    token: await generateToken(user!),
  };
}

function makeWallpaperFile(name = "wallpaper.png") {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: "image/png" });
}

function makeWallpaperRequest(clientId: string, token: string, file = makeWallpaperFile()) {
  const form = new FormData();
  form.append("file", file);
  const url = new URL(`https://operator.example/api/clients/${encodeURIComponent(clientId)}/wallpaper`);
  return {
    url,
    req: new Request(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Host: "operator.example",
        "x-forwarded-proto": "https",
      },
      body: form,
    }),
  };
}

async function waitForStatus(clientId: string, jobId: string, token: string, expected: string, deps: any) {
  const statusUrl = new URL(`https://operator.example/api/clients/${encodeURIComponent(clientId)}/wallpaper/${encodeURIComponent(jobId)}`);
  let last: any = null;
  for (let i = 0; i < 20; i++) {
    const res = await handleWallpaperRoutes(
      new Request(statusUrl, { headers: { Authorization: `Bearer ${token}` } }),
      statusUrl,
      mockServer,
      deps,
    );
    expect(res).not.toBeNull();
    last = await res!.json();
    if (last.status === expected) return last;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`status did not become ${expected}: ${JSON.stringify(last)}`);
}

describe("wallpaper route jobs", () => {
  test("uses the configured external URL for legacy clients behind a reverse proxy", async () => {
    const auth = await createAdminToken();
    const clientId = `client-external-${Date.now().toString(36)}`;
    const pendingCommandReplies = new Map<string, PendingCommandReply>();
    const pendingScripts = new Map<string, PendingScript>();
    const deps = { pendingCommandReplies, pendingScripts };
    const previousExternalUrl = process.env.OVERLORD_EXTERNAL_URL;
    process.env.OVERLORD_EXTERNAL_URL = "https://public.example:2725";

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      version: "2.3.4",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          queueMicrotask(() => {
            pendingCommandReplies.get(msg.id)?.resolve({ ok: false, message: "test complete" });
          });
        },
      },
    });

    try {
      const { req, url } = makeWallpaperRequest(clientId, auth.token);
      const internalRequest = new Request(req, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          Host: "100.95.62.108:5173",
          "x-forwarded-proto": "https",
        },
      });
      const postRes = await handleWallpaperRoutes(internalRequest, url, mockServer, deps);
      expect(postRes).not.toBeNull();
      const started = await postRes!.json() as any;

      expect(started.pullOrigin).toStartWith("https://public.example:2725/api/file/upload/pull/");
      expect(started.endpointSource).toBe("external_config");
      expect(started.clientVersion).toBe("2.3.4");
    } finally {
      if (previousExternalUrl === undefined) delete process.env.OVERLORD_EXTERNAL_URL;
      else process.env.OVERLORD_EXTERNAL_URL = previousExternalUrl;
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("returns a job and exposes transfer details until final success reaches 100 percent", async () => {
    const auth = await createAdminToken();
    const clientId = `client-${Date.now().toString(36)}`;
    const pendingCommandReplies = new Map<string, PendingCommandReply>();
    const pendingScripts = new Map<string, PendingScript>();
    const deps = { pendingCommandReplies, pendingScripts };

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      version: "2.3.4",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          queueMicrotask(() => {
            if (msg.commandType === "file_upload_http") {
              const pending = pendingCommandReplies.get(msg.id);
              pending?.onProgress?.({
                type: "command_progress",
                commandId: msg.id,
                path: msg.payload.path,
                url: msg.payload.url,
                resolvedUrl: "https://agent-visible.example/api/file/upload/pull/test",
                status: "transferring",
                attempt: 1,
                transferred: 4,
                total: 8,
                speedBytesPerSecond: 256,
                message: "Transferred 4 B of 8 B",
              });
              pending?.resolve({ ok: true, message: "upload complete" });
            } else if (msg.commandType === "script_exec") {
              const pending = pendingScripts.get(msg.id);
              const script = String(msg.payload?.script || "");
              if (script.includes("Test-Path")) {
                pending?.resolve({ ok: true, result: "exists:true" });
              } else {
                pending?.resolve({ ok: true, result: "wallpaper_applied:true" });
              }
            }
          });
        },
      },
    });

    try {
      const { req, url } = makeWallpaperRequest(clientId, auth.token);
      const postRes = await handleWallpaperRoutes(req, url, mockServer, deps);
      expect(postRes).not.toBeNull();
      expect(postRes!.status).toBe(200);
      const started = await postRes!.json() as any;
      expect(started.ok).toBe(true);
      expect(typeof started.jobId).toBe("string");
      expect(started.totalBytes).toBe(8);
      expect(started.destinationPath).toBe("C:\\Users\\Public\\overlord_wallpaper.png");

      const finalStatus = await waitForStatus(clientId, started.jobId, auth.token, "succeeded", deps);
      expect(finalStatus.percent).toBe(100);
      expect(finalStatus.bytesTransferred).toBe(8);
      expect(finalStatus.totalBytes).toBe(8);
      expect(finalStatus.destinationPath).toBe("C:\\Users\\Public\\overlord_wallpaper.png");
      expect(finalStatus.pullOrigin).toContain("/api/file/upload/pull/");
      expect(finalStatus.resolvedUrl).toBe("https://agent-visible.example/api/file/upload/pull/test");
      expect(finalStatus.speedBytesPerSecond).toBe(256);
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("reports client transfer timeout with phase, bytes, destination, and pull origin", async () => {
    const auth = await createAdminToken();
    const clientId = `client-timeout-${Date.now().toString(36)}`;
    const pendingCommandReplies = new Map<string, PendingCommandReply>();
    const pendingScripts = new Map<string, PendingScript>();
    const deps = { pendingCommandReplies, pendingScripts, uploadTimeoutMs: 30 };

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      version: "2.3.4",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          queueMicrotask(() => {
            const pending = pendingCommandReplies.get(msg.id);
            pending?.onProgress?.({
              type: "command_progress",
              commandId: msg.id,
              path: msg.payload.path,
              url: msg.payload.url,
              resolvedUrl: "https://agent-visible.example/api/file/upload/pull/slow",
              status: "transferring",
              attempt: 1,
              transferred: 3,
              total: 8,
              speedBytesPerSecond: 12,
              message: "Transferred 3 B of 8 B",
            });
          });
        },
      },
    });

    try {
      const { req, url } = makeWallpaperRequest(clientId, auth.token);
      const postRes = await handleWallpaperRoutes(req, url, mockServer, deps);
      expect(postRes).not.toBeNull();
      const started = await postRes!.json() as any;
      const failed = await waitForStatus(clientId, started.jobId, auth.token, "failed", deps);

      expect(failed.phase).toBe("client_transfer");
      expect(failed.percent).toBeLessThan(100);
      expect(failed.bytesTransferred).toBe(3);
      expect(failed.error.code).toBe("client_transfer_timeout");
      expect(failed.error.destinationPath).toBe("C:\\Users\\Public\\overlord_wallpaper.png");
      expect(failed.error.pullOrigin).toContain("/api/file/upload/pull/");
      expect(failed.error.resolvedUrl).toBe("https://agent-visible.example/api/file/upload/pull/slow");
      expect(failed.error.message).toContain("client did not complete");
      expect(failed.clientVersion).toBe("2.3.4");
      expect(failed.clientAcknowledged).toBe(true);
      expect(failed.transferState).toBe("client_transfer_active");
      expect(failed.error.transferState).toBe("client_transfer_active");
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("reports when a legacy client never acknowledges the transfer command", async () => {
    const auth = await createAdminToken();
    const clientId = `client-no-progress-${Date.now().toString(36)}`;
    const pendingCommandReplies = new Map<string, PendingCommandReply>();
    const pendingScripts = new Map<string, PendingScript>();
    const deps = { pendingCommandReplies, pendingScripts, uploadTimeoutMs: 25 };

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      version: "2.3.4",
      ws: { send() {} },
    });

    try {
      const { req, url } = makeWallpaperRequest(clientId, auth.token);
      const postRes = await handleWallpaperRoutes(req, url, mockServer, deps);
      expect(postRes).not.toBeNull();
      const started = await postRes!.json() as any;
      const failed = await waitForStatus(clientId, started.jobId, auth.token, "failed", deps);

      expect(failed.clientVersion).toBe("2.3.4");
      expect(failed.clientAcknowledged).toBe(false);
      expect(failed.transferState).toBe("command_sent_no_client_progress");
      expect(failed.error.transferState).toBe("command_sent_no_client_progress");
      expect(failed.error.commandSentAt).toBeNumber();
      expect(failed.error.endpointSource).toBe("request_host");
      expect(failed.error.message).toContain("did not acknowledge");
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });
});
