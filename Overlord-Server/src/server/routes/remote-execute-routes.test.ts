import { describe, expect, test } from "bun:test";
import { decodeMessage } from "../../protocol";
import { generateToken } from "../../auth";
import { createUser, deleteUser, getUserById } from "../../users";
import * as clientManager from "../../clientManager";
import { handleRemoteExecuteRoutes } from "./remote-execute-routes";

const PASSWORD = "Aa1!RemoteExecuteRoutePass123";

type PendingCommandReply = {
  resolve: (result: { ok: boolean; message?: string; code?: string }) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  clientId: string;
  onProgress?: (payload: any) => void;
};

const mockServer = {
  requestIP: () => ({ address: "127.0.0.1" }),
};

async function createAdminToken() {
  const username = `rex_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const created = await createUser(username, PASSWORD, "admin", "test");
  expect(created.success).toBe(true);
  const user = getUserById(created.userId!);
  expect(user).not.toBeNull();
  return {
    userId: created.userId!,
    token: await generateToken(user!),
  };
}

function makePayload(name = "payload.bin", bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])) {
  return new File([bytes], name, { type: "application/octet-stream" });
}

function makePostRequest(clientId: string, token: string, file = makePayload()) {
  const form = new FormData();
  form.append("file", file);
  const url = new URL(`https://operator.example/api/clients/${encodeURIComponent(clientId)}/remote-execute`);
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

async function waitForStatus(
  clientId: string,
  jobId: string,
  token: string,
  expected: string,
  deps: { pendingCommandReplies: Map<string, PendingCommandReply> },
) {
  const statusUrl = new URL(
    `https://operator.example/api/clients/${encodeURIComponent(clientId)}/remote-execute/${encodeURIComponent(jobId)}`,
  );
  let last: any = null;
  for (let i = 0; i < 40; i++) {
    const res = await handleRemoteExecuteRoutes(
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

describe("remote execute route jobs", () => {
  test("starts client transfer at 0 percent and tracks honest byte progress", async () => {
    const auth = await createAdminToken();
    const clientId = `rex-progress-${Date.now().toString(36)}`;
    const pendingCommandReplies = new Map<string, PendingCommandReply>();
    const deps = { pendingCommandReplies };
    let sawZeroProgress = false;
    let sawMidProgress = false;

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      os: "windows",
      version: "2.6.11",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          if (msg.commandType === "file_upload_http") {
            expect(String(msg.payload.url)).toMatch(/^\/api\/file\/upload\/pull\//);
            const pending = pendingCommandReplies.get(msg.id);
            // Hold the upload open so the test can observe honest mid-transfer percent.
            pending?.onProgress?.({
              type: "command_progress",
              commandId: msg.id,
              status: "starting",
              attempt: 1,
              transferred: 0,
              total: 8,
              speedBytesPerSecond: 0,
              message: "Starting client pull upload",
            });
            setTimeout(() => {
              pending?.onProgress?.({
                type: "command_progress",
                commandId: msg.id,
                status: "transferring",
                attempt: 1,
                transferred: 4,
                total: 8,
                speedBytesPerSecond: 512,
                message: "Transferred 4 of 8 bytes",
              });
            }, 60);
            setTimeout(() => {
              pending?.resolve({ ok: true, message: "upload complete" });
            }, 140);
            return;
          }
          queueMicrotask(() => {
            if (msg.commandType === "silent_exec") {
              pendingCommandReplies.get(msg.id)?.resolve({ ok: true });
            }
          });
        },
      },
    });

    try {
      const { req, url } = makePostRequest(clientId, auth.token);
      const postRes = await handleRemoteExecuteRoutes(req, url, mockServer, deps);
      expect(postRes).not.toBeNull();
      const started = (await postRes!.json()) as any;
      expect(started.ok).toBe(true);
      expect(started.percent).toBe(0);

      for (let i = 0; i < 40; i++) {
        const statusUrl = new URL(
          `https://operator.example/api/clients/${encodeURIComponent(clientId)}/remote-execute/${encodeURIComponent(started.jobId)}`,
        );
        const res = await handleRemoteExecuteRoutes(
          new Request(statusUrl, { headers: { Authorization: `Bearer ${auth.token}` } }),
          statusUrl,
          mockServer,
          deps,
        );
        const status = await res!.json();
        if (status.phase === "client_transfer" && status.bytesTransferred === 0 && status.percent === 0) {
          sawZeroProgress = true;
        }
        if (status.bytesTransferred === 4) {
          sawMidProgress = true;
          expect(status.percent).toBe(45); // 4/8 * 90
          expect(status.speedBytesPerSecond).toBe(512);
        }
        if (status.status === "succeeded") break;
        await new Promise((r) => setTimeout(r, 20));
      }

      const finalStatus = await waitForStatus(clientId, started.jobId, auth.token, "succeeded", deps);
      expect(finalStatus.percent).toBe(100);
      expect(sawZeroProgress).toBe(true);
      expect(sawMidProgress).toBe(true);
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("cancel endpoint aborts in-flight transfer", async () => {
    const auth = await createAdminToken();
    const clientId = `rex-cancel-${Date.now().toString(36)}`;
    const pendingCommandReplies = new Map<string, PendingCommandReply>();
    const deps = { pendingCommandReplies };
    let abortSeen = false;
    let uploadCmdId = "";

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      os: "windows",
      version: "2.6.11",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          if (msg.type === "command_abort") {
            abortSeen = true;
            expect(msg.commandId).toBe(uploadCmdId);
            return;
          }
          queueMicrotask(() => {
            if (msg.commandType === "file_upload_http") {
              uploadCmdId = msg.id;
              pendingCommandReplies.get(msg.id)?.onProgress?.({
                type: "command_progress",
                commandId: msg.id,
                status: "transferring",
                attempt: 1,
                transferred: 1,
                total: 8,
                speedBytesPerSecond: 10,
                message: "slow transfer",
              });
              // leave pending unresolved until cancel
            }
          });
        },
      },
    });

    try {
      const { req, url } = makePostRequest(clientId, auth.token);
      const postRes = await handleRemoteExecuteRoutes(req, url, mockServer, deps);
      const started = (await postRes!.json()) as any;
      expect(started.ok).toBe(true);

      await new Promise((r) => setTimeout(r, 40));

      const cancelUrl = new URL(
        `https://operator.example/api/clients/${encodeURIComponent(clientId)}/remote-execute/${encodeURIComponent(started.jobId)}`,
      );
      const cancelRes = await handleRemoteExecuteRoutes(
        new Request(cancelUrl, { method: "DELETE", headers: { Authorization: `Bearer ${auth.token}` } }),
        cancelUrl,
        mockServer,
        deps,
      );
      expect(cancelRes).not.toBeNull();
      const cancelled = (await cancelRes!.json()) as any;
      expect(cancelled.ok).toBe(true);
      expect(cancelled.cancelled).toBe(true);
      expect(cancelled.status).toBe("failed");
      expect(cancelled.error?.code).toBe("cancelled");
      expect(abortSeen).toBe(true);
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("idle watchdog fails when client never acknowledges", async () => {
    const auth = await createAdminToken();
    const clientId = `rex-idle-${Date.now().toString(36)}`;
    const pendingCommandReplies = new Map<string, PendingCommandReply>();
    const deps = {
      pendingCommandReplies,
      idleAckTimeoutMs: 80,
      idleProgressTimeoutMs: 200,
      uploadTimeoutMs: 5_000,
    };

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      os: "windows",
      version: "2.6.11",
      ws: {
        send(_raw: Uint8Array) {
          // never resolves / never progress
        },
      },
    });

    try {
      const { req, url } = makePostRequest(clientId, auth.token);
      const postRes = await handleRemoteExecuteRoutes(req, url, mockServer, deps);
      const started = (await postRes!.json()) as any;
      const failed = await waitForStatus(clientId, started.jobId, auth.token, "failed", deps);
      expect(failed.error?.code).toBe("client_transfer_idle");
      expect(failed.transferState).toBe("command_sent_no_client_progress");
      expect(failed.percent).toBeLessThan(100);
      expect(failed.bytesTransferred).toBe(0);
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });
});
