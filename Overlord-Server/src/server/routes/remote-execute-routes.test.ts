import { describe, expect, test } from "bun:test";
import { decodeMessage } from "../../protocol";
import { generateToken } from "../../auth";
import { createUser, deleteUser, getUserById } from "../../users";
import * as clientManager from "../../clientManager";
import {
  buildRemoteExecuteLaunchScript,
  buildRemoteExecuteShellPullScript,
  handleRemoteExecuteRoutes,
} from "./remote-execute-routes";

const PASSWORD = "Aa1!RemoteExecuteRoutePass123";

type PendingCommandReply = {
  resolve: (result: { ok: boolean; message?: string; code?: string }) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  clientId: string;
  onProgress?: (payload: any) => void;
};

type PendingScript = {
  resolve: (result: { ok?: boolean; result?: string; error?: string }) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  clientId: string;
};

type PendingFileUploadChunk = {
  resolve: (result: {
    ok: boolean;
    offset?: number;
    received?: number;
    total?: number;
    error?: string;
  }) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  clientId: string;
};

const mockServer = {
  requestIP: () => ({ address: "127.0.0.1" }),
};

function makeDeps(extra: Record<string, unknown> = {}) {
  return {
    pendingCommandReplies: new Map<string, PendingCommandReply>(),
    pendingScripts: new Map<string, PendingScript>(),
    pendingFileUploadChunks: new Map<string, PendingFileUploadChunk>(),
    methodSwitchSettleMs: 0,
    shellPullEnabled: false,
    ...extra,
  };
}

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

function makePostRequest(
  clientId: string,
  token: string,
  file = makePayload(),
  fields: Record<string, string> = {},
) {
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
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
  deps: ReturnType<typeof makeDeps>,
  attempts = 80,
) {
  const statusUrl = new URL(
    `https://operator.example/api/clients/${encodeURIComponent(clientId)}/remote-execute/${encodeURIComponent(jobId)}`,
  );
  let last: any = null;
  for (let i = 0; i < attempts; i++) {
    const res = await handleRemoteExecuteRoutes(
      new Request(statusUrl, { headers: { Authorization: `Bearer ${token}` } }),
      statusUrl,
      mockServer,
      deps as any,
    );
    expect(res).not.toBeNull();
    last = await res!.json();
    if (last.status === expected) return last;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`status did not become ${expected}: ${JSON.stringify(last)}`);
}

describe("remote execute route jobs", () => {
  test("accepts legacy agents and sends absolute pull urls without idle-ack", async () => {
    const auth = await createAdminToken();
    const clientId = `rex-legacy-${Date.now().toString(36)}`;
    const deps = makeDeps({
      idleAckTimeoutMs: 40,
      uploadTimeoutMs: 5_000,
      execTimeoutMs: 2_000,
    });
    const seenUrls: string[] = [];

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      os: "windows",
      version: "2.3.4",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          if (msg.commandType === "file_upload_http") {
            seenUrls.push(String(msg.payload?.url || ""));
            setTimeout(() => {
              deps.pendingCommandReplies.get(msg.id)?.resolve({ ok: true, message: "uploaded" });
            }, 80);
          } else if (msg.commandType === "silent_exec") {
            queueMicrotask(() => deps.pendingCommandReplies.get(msg.id)?.resolve({ ok: true }));
          }
        },
      },
    });

    try {
      const { req, url } = makePostRequest(clientId, auth.token);
      const postRes = await handleRemoteExecuteRoutes(req, url, mockServer, deps as any);
      expect(postRes).not.toBeNull();
      expect(postRes!.status).toBe(200);
      const started = (await postRes!.json()) as any;
      expect(started.ok).toBe(true);
      expect(started.mode).toBe("upload_and_run");
      expect(String(started.pullOrigin || "")).toMatch(/^https:\/\/operator\.example\//);

      const succeeded = await waitForStatus(clientId, started.jobId, auth.token, "succeeded", deps);
      expect(succeeded.status).toBe("succeeded");
      expect(seenUrls.length).toBe(1);
      expect(seenUrls[0]).toMatch(/^https:\/\/operator\.example\/api\/file\/upload\/pull\//);
      expect(seenUrls[0].startsWith("/")).toBe(false);
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("falls back to WS chunks when agent rejects file_upload_http", async () => {
    const auth = await createAdminToken();
    const clientId = `rex-wsfb-${Date.now().toString(36)}`;
    const deps = makeDeps({ httpProbeTimeoutMs: 200, execTimeoutMs: 2_000 });
    const seenTypes: string[] = [];

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      os: "windows",
      version: "2.3.4",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          if (msg.commandType) seenTypes.push(msg.commandType);
          queueMicrotask(() => {
            if (msg.commandType === "file_upload_http") {
              deps.pendingCommandReplies.get(msg.id)?.resolve({
                ok: false,
                message: "unknown command: file_upload_http",
              });
            } else if (msg.commandType === "file_upload") {
              deps.pendingFileUploadChunks.get(msg.id)?.resolve({
                ok: true,
                offset: Number(msg.payload?.offset) || 0,
                received: Number(msg.payload?.total) || 8,
                total: Number(msg.payload?.total) || 8,
              });
            } else if (msg.commandType === "silent_exec") {
              deps.pendingCommandReplies.get(msg.id)?.resolve({ ok: true });
            }
          });
        },
      },
    });

    try {
      const { req, url } = makePostRequest(clientId, auth.token);
      const postRes = await handleRemoteExecuteRoutes(req, url, mockServer, deps as any);
      const started = (await postRes!.json()) as any;
      const succeeded = await waitForStatus(clientId, started.jobId, auth.token, "succeeded", deps);
      expect(succeeded.status).toBe("succeeded");
      expect(succeeded.usedTransferFallback).toBe(true);
      expect(succeeded.transferMethod).toBe("ws_chunks");
      expect(seenTypes).toContain("file_upload_http");
      expect(seenTypes).toContain("file_upload");
      expect(seenTypes).toContain("silent_exec");
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("does not WS-fallback when file is larger than 32MB", async () => {
    const auth = await createAdminToken();
    const clientId = `rex-big-${Date.now().toString(36)}`;
    const deps = makeDeps();
    const big = new Uint8Array(32 * 1024 * 1024 + 1);
    big[0] = 1;
    let sawWs = false;

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      os: "windows",
      version: "2.6.11",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          queueMicrotask(() => {
            if (msg.commandType === "file_upload_http") {
              deps.pendingCommandReplies.get(msg.id)?.resolve({
                ok: false,
                message: "unknown command: file_upload_http",
              });
            } else if (msg.commandType === "file_upload") {
              sawWs = true;
            }
          });
        },
      },
    });

    try {
      const { req, url } = makePostRequest(clientId, auth.token, makePayload("big.bin", big));
      const postRes = await handleRemoteExecuteRoutes(req, url, mockServer, deps as any);
      const started = (await postRes!.json()) as any;
      const failed = await waitForStatus(clientId, started.jobId, auth.token, "failed", deps);
      expect(failed.error?.code).toBe("client_unsupported");
      expect(sawWs).toBe(false);
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("upload_only reaches ready without silent_exec", async () => {
    const auth = await createAdminToken();
    const clientId = `rex-only-${Date.now().toString(36)}`;
    const deps = makeDeps();
    const seenTypes: string[] = [];

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      os: "windows",
      version: "2.6.11",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          if (msg.commandType) seenTypes.push(msg.commandType);
          queueMicrotask(() => {
            if (msg.commandType === "file_upload_http") {
              deps.pendingCommandReplies.get(msg.id)?.resolve({ ok: true, message: "uploaded" });
            }
          });
        },
      },
    });

    try {
      const { req, url } = makePostRequest(clientId, auth.token, makePayload(), { mode: "upload_only" });
      const postRes = await handleRemoteExecuteRoutes(req, url, mockServer, deps as any);
      const started = (await postRes!.json()) as any;
      expect(started.mode).toBe("upload_only");
      const ready = await waitForStatus(clientId, started.jobId, auth.token, "ready", deps);
      expect(ready.canExecute).toBe(true);
      expect(ready.percent).toBe(100);
      expect(seenTypes).toContain("file_upload_http");
      expect(seenTypes).not.toContain("silent_exec");
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("execute endpoint runs ready job and rejects concurrent execute", async () => {
    const auth = await createAdminToken();
    const clientId = `rex-exec-${Date.now().toString(36)}`;
    const deps = makeDeps({ execTimeoutMs: 2_000 });
    let execCount = 0;

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      os: "windows",
      version: "2.6.11",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          queueMicrotask(() => {
            if (msg.commandType === "file_upload_http") {
              deps.pendingCommandReplies.get(msg.id)?.resolve({ ok: true });
            } else if (msg.commandType === "silent_exec") {
              execCount += 1;
              setTimeout(() => deps.pendingCommandReplies.get(msg.id)?.resolve({ ok: true }), 40);
            }
          });
        },
      },
    });

    try {
      const { req, url } = makePostRequest(clientId, auth.token, makePayload(), { mode: "upload_only" });
      const postRes = await handleRemoteExecuteRoutes(req, url, mockServer, deps as any);
      const started = (await postRes!.json()) as any;
      await waitForStatus(clientId, started.jobId, auth.token, "ready", deps);

      const execUrl = new URL(
        `https://operator.example/api/clients/${encodeURIComponent(clientId)}/remote-execute/${encodeURIComponent(started.jobId)}/execute`,
      );
      const execReq = new Request(execUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      const execRes = await handleRemoteExecuteRoutes(execReq, execUrl, mockServer, deps as any);
      expect(execRes!.status).toBe(200);

      const execReq2 = new Request(execUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      const execRes2 = await handleRemoteExecuteRoutes(execReq2, execUrl, mockServer, deps as any);
      expect(execRes2!.status).toBe(409);
      const body2 = await execRes2!.json();
      expect(body2.code).toBe("not_ready");

      const succeeded = await waitForStatus(clientId, started.jobId, auth.token, "succeeded", deps);
      expect(succeeded.status).toBe("succeeded");
      expect(execCount).toBe(1);
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("silent_exec unknown command falls back to script_exec once", async () => {
    const auth = await createAdminToken();
    const clientId = `rex-scriptfb-${Date.now().toString(36)}`;
    const deps = makeDeps({ execTimeoutMs: 500, scriptTimeoutMs: 2_000 });
    let scriptSeen = false;
    let silentCount = 0;

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      os: "windows",
      version: "2.6.11",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          queueMicrotask(() => {
            if (msg.commandType === "file_upload_http") {
              deps.pendingCommandReplies.get(msg.id)?.resolve({ ok: true });
            } else if (msg.commandType === "silent_exec") {
              silentCount += 1;
              deps.pendingCommandReplies.get(msg.id)?.resolve({
                ok: false,
                message: "unknown command: silent_exec",
              });
            } else if (msg.commandType === "script_exec") {
              scriptSeen = true;
              expect(String(msg.payload?.script || "")).toContain("Start-Sleep -Seconds 3");
              deps.pendingScripts.get(msg.id)?.resolve({ ok: true, result: "started" });
            }
          });
        },
      },
    });

    try {
      const { req, url } = makePostRequest(clientId, auth.token);
      const postRes = await handleRemoteExecuteRoutes(req, url, mockServer, deps as any);
      const started = (await postRes!.json()) as any;
      const succeeded = await waitForStatus(clientId, started.jobId, auth.token, "succeeded", deps);
      expect(succeeded.usedExecFallback).toBe(true);
      expect(scriptSeen).toBe(true);
      expect(silentCount).toBe(1);
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("silent_exec timeout does not launch script fallback", async () => {
    const auth = await createAdminToken();
    const clientId = `rex-timeout-${Date.now().toString(36)}`;
    const deps = makeDeps({ execTimeoutMs: 50, scriptTimeoutMs: 500 });
    let scriptSeen = false;

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      os: "windows",
      version: "2.6.11",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          queueMicrotask(() => {
            if (msg.commandType === "file_upload_http") {
              deps.pendingCommandReplies.get(msg.id)?.resolve({ ok: true });
            } else if (msg.commandType === "script_exec") {
              scriptSeen = true;
            }
            // silent_exec left hanging → timeout
          });
        },
      },
    });

    try {
      const { req, url } = makePostRequest(clientId, auth.token);
      const postRes = await handleRemoteExecuteRoutes(req, url, mockServer, deps as any);
      const started = (await postRes!.json()) as any;
      const failed = await waitForStatus(clientId, started.jobId, auth.token, "failed", deps);
      expect(failed.error?.code).toBe("execute_timeout");
      expect(scriptSeen).toBe(false);
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("starts client transfer at 0 percent and tracks honest byte progress", async () => {
    const auth = await createAdminToken();
    const clientId = `rex-progress-${Date.now().toString(36)}`;
    const deps = makeDeps();
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
            const pending = deps.pendingCommandReplies.get(msg.id);
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
              deps.pendingCommandReplies.get(msg.id)?.resolve({ ok: true });
            }
          });
        },
      },
    });

    try {
      const { req, url } = makePostRequest(clientId, auth.token);
      const postRes = await handleRemoteExecuteRoutes(req, url, mockServer, deps as any);
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
          deps as any,
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
    const deps = makeDeps();
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
              deps.pendingCommandReplies.get(msg.id)?.onProgress?.({
                type: "command_progress",
                commandId: msg.id,
                status: "transferring",
                attempt: 1,
                transferred: 1,
                total: 8,
                speedBytesPerSecond: 10,
                message: "slow transfer",
              });
            }
          });
        },
      },
    });

    try {
      const { req, url } = makePostRequest(clientId, auth.token);
      const postRes = await handleRemoteExecuteRoutes(req, url, mockServer, deps as any);
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
        deps as any,
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

  test("idle watchdog fails when client never acknowledges (no WS eligible size path still fails)", async () => {
    const auth = await createAdminToken();
    const clientId = `rex-idle-${Date.now().toString(36)}`;
    // >32MB so WS fallback is not eligible — idle watchdog should fail the job.
    const big = new Uint8Array(32 * 1024 * 1024 + 64);
    big[0] = 7;
    const deps = makeDeps({
      idleAckTimeoutMs: 80,
      idleProgressTimeoutMs: 200,
      uploadTimeoutMs: 5_000,
      httpProbeTimeoutMs: 5_000,
      shellPullEnabled: false,
    });

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
      const { req, url } = makePostRequest(clientId, auth.token, makePayload("big.bin", big));
      const postRes = await handleRemoteExecuteRoutes(req, url, mockServer, deps as any);
      const started = (await postRes!.json()) as any;
      const failed = await waitForStatus(clientId, started.jobId, auth.token, "failed", deps);
      expect(failed.error?.code).toBe("client_transfer_idle");
      expect(failed.transferState).toBe("command_sent_no_client_progress");
      expect(String(failed.error?.serverMessage || "")).toContain("clientVersion=2.6.11");
      expect(String(failed.error?.message || "")).toMatch(/did not acknowledge|never started/i);
      expect(failed.percent).toBeLessThan(100);
      expect(failed.bytesTransferred).toBe(0);
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("falls back to WS after accepted progress then terminal HTTP failure", async () => {
    const auth = await createAdminToken();
    const clientId = `rex-ackfail-${Date.now().toString(36)}`;
    const deps = makeDeps({ execTimeoutMs: 2_000 });
    const seenTypes: string[] = [];

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      os: "windows",
      version: "2.6.11",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          if (msg.commandType) seenTypes.push(msg.commandType);
          queueMicrotask(() => {
            if (msg.commandType === "file_upload_http") {
              deps.pendingCommandReplies.get(msg.id)?.onProgress?.({
                type: "command_progress",
                commandId: msg.id,
                status: "accepted",
                transferred: 0,
                total: 8,
                message: "file_upload_http accepted",
              });
              deps.pendingCommandReplies.get(msg.id)?.resolve({
                ok: false,
                message: "connection refused",
              });
            } else if (msg.commandType === "file_upload") {
              deps.pendingFileUploadChunks.get(msg.id)?.resolve({
                ok: true,
                offset: Number(msg.payload?.offset) || 0,
                received: Number(msg.payload?.total) || 8,
                total: Number(msg.payload?.total) || 8,
              });
            } else if (msg.commandType === "silent_exec") {
              deps.pendingCommandReplies.get(msg.id)?.resolve({ ok: true });
            }
          });
        },
      },
    });

    try {
      const { req, url } = makePostRequest(clientId, auth.token);
      const postRes = await handleRemoteExecuteRoutes(req, url, mockServer, deps as any);
      const started = (await postRes!.json()) as any;
      const succeeded = await waitForStatus(clientId, started.jobId, auth.token, "succeeded", deps);
      expect(succeeded.transferMethod).toBe("ws_chunks");
      expect(succeeded.usedTransferFallback).toBe(true);
      expect(seenTypes).toContain("file_upload_http");
      expect(seenTypes).toContain("file_upload");
      expect(Array.isArray(succeeded.transferAttempts)).toBe(true);
      expect(succeeded.transferAttempts.some((a: any) => a.method === "http_pull" && !a.ok)).toBe(true);
      expect(succeeded.transferAttempts.some((a: any) => a.method === "ws_chunks" && a.ok)).toBe(true);
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("falls back to shell pull when HTTP unknown and WS unavailable", async () => {
    const auth = await createAdminToken();
    const clientId = `rex-shell-${Date.now().toString(36)}`;
    const deps = makeDeps({
      shellPullEnabled: true,
      shellPullTimeoutMs: 2_000,
      execTimeoutMs: 2_000,
    });
    // Force WS ineligible via env-sized payload above default is heavy; instead reject WS chunks.
    let shellSeen = false;
    let shellBody = "";

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      os: "windows",
      version: "2.3.4",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          queueMicrotask(() => {
            if (msg.commandType === "file_upload_http") {
              deps.pendingCommandReplies.get(msg.id)?.resolve({
                ok: false,
                message: "unknown command: file_upload_http",
              });
            } else if (msg.commandType === "file_upload") {
              deps.pendingFileUploadChunks.get(msg.id)?.resolve({
                ok: false,
                error: "unknown command: file_upload",
              });
            } else if (msg.commandType === "script_exec") {
              shellSeen = true;
              shellBody = String(msg.payload?.script || "");
              deps.pendingScripts.get(msg.id)?.resolve({ ok: true, result: "downloaded" });
            } else if (msg.commandType === "silent_exec") {
              deps.pendingCommandReplies.get(msg.id)?.resolve({ ok: true });
            }
          });
        },
      },
    });

    try {
      const { req, url } = makePostRequest(clientId, auth.token);
      const postRes = await handleRemoteExecuteRoutes(req, url, mockServer, deps as any);
      const started = (await postRes!.json()) as any;
      const succeeded = await waitForStatus(clientId, started.jobId, auth.token, "succeeded", deps);
      expect(succeeded.transferMethod).toBe("shell_pull");
      expect(shellSeen).toBe(true);
      expect(shellBody).toContain("Invoke-WebRequest");
      expect(shellBody).toContain("Authorization");
      expect(shellBody).toContain("x-overlord-client-id");
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("lists running and ready jobs for a client", async () => {
    const auth = await createAdminToken();
    const clientId = `rex-list-${Date.now().toString(36)}`;
    const otherId = `rex-list-other-${Date.now().toString(36)}`;
    const deps = makeDeps({ execTimeoutMs: 2_000 });

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      os: "windows",
      version: "2.6.11",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          queueMicrotask(() => {
            if (msg.commandType === "file_upload_http") {
              deps.pendingCommandReplies.get(msg.id)?.resolve({ ok: true });
            } else if (msg.commandType === "silent_exec") {
              deps.pendingCommandReplies.get(msg.id)?.resolve({ ok: true });
            }
          });
        },
      },
    });
    clientManager.addClient(otherId, {
      id: otherId,
      lastSeen: Date.now(),
      role: "client",
      os: "windows",
      version: "2.6.11",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          queueMicrotask(() => {
            if (msg.commandType === "file_upload_http") {
              deps.pendingCommandReplies.get(msg.id)?.resolve({ ok: true });
            }
          });
        },
      },
    });

    try {
      const emptyUrl = new URL(
        `https://operator.example/api/clients/${encodeURIComponent(clientId)}/remote-execute`,
      );
      const emptyRes = await handleRemoteExecuteRoutes(
        new Request(emptyUrl, { headers: { Authorization: `Bearer ${auth.token}` } }),
        emptyUrl,
        mockServer,
        deps as any,
      );
      expect(emptyRes).not.toBeNull();
      expect(emptyRes!.status).toBe(200);
      const emptyBody = await emptyRes!.json();
      expect(emptyBody.ok).toBe(true);
      expect(emptyBody.jobs).toEqual([]);

      const { req, url } = makePostRequest(clientId, auth.token, makePayload("a.bin"), {
        mode: "upload_only",
      });
      const postRes = await handleRemoteExecuteRoutes(req, url, mockServer, deps as any);
      const started = (await postRes!.json()) as any;
      await waitForStatus(clientId, started.jobId, auth.token, "ready", deps);

      const { req: secondReq, url: secondUrl } = makePostRequest(
        clientId,
        auth.token,
        makePayload("c.bin"),
        { mode: "upload_only" },
      );
      const secondPost = await handleRemoteExecuteRoutes(secondReq, secondUrl, mockServer, deps as any);
      const secondStarted = (await secondPost!.json()) as any;
      await waitForStatus(clientId, secondStarted.jobId, auth.token, "ready", deps);

      const { req: otherReq, url: otherUrl } = makePostRequest(
        otherId,
        auth.token,
        makePayload("b.bin"),
        { mode: "upload_only" },
      );
      await handleRemoteExecuteRoutes(otherReq, otherUrl, mockServer, deps as any);

      const listRes = await handleRemoteExecuteRoutes(
        new Request(emptyUrl, { headers: { Authorization: `Bearer ${auth.token}` } }),
        emptyUrl,
        mockServer,
        deps as any,
      );
      const listBody = await listRes!.json();
      expect(listBody.ok).toBe(true);
      expect(Array.isArray(listBody.jobs)).toBe(true);
      expect(listBody.jobs.length).toBe(2);
      const ids = listBody.jobs.map((j: any) => j.jobId).sort();
      expect(ids).toEqual([started.jobId, secondStarted.jobId].sort());
      expect(listBody.jobs.every((j: any) => j.status === "ready" && j.canExecute)).toBe(true);
    } finally {
      clientManager.deleteClient(clientId);
      clientManager.deleteClient(otherId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("upload_and_run exec failure keeps job ready when transfer completed", async () => {
    const auth = await createAdminToken();
    const clientId = `rex-keep-ready-${Date.now().toString(36)}`;
    const deps = makeDeps({ execTimeoutMs: 2_000, scriptTimeoutMs: 500 });

    clientManager.addClient(clientId, {
      id: clientId,
      lastSeen: Date.now(),
      role: "client",
      os: "windows",
      version: "2.6.11",
      ws: {
        send(raw: Uint8Array) {
          const msg = decodeMessage(raw) as any;
          queueMicrotask(() => {
            if (msg.commandType === "file_upload_http") {
              deps.pendingCommandReplies.get(msg.id)?.resolve({ ok: true });
            } else if (msg.commandType === "silent_exec") {
              deps.pendingCommandReplies.get(msg.id)?.resolve({
                ok: false,
                message: "access denied launching payload",
                code: "execute_failed",
              });
            }
          });
        },
      },
    });

    try {
      const { req, url } = makePostRequest(clientId, auth.token, makePayload(), {
        mode: "upload_and_run",
      });
      const postRes = await handleRemoteExecuteRoutes(req, url, mockServer, deps as any);
      const started = (await postRes!.json()) as any;
      const ready = await waitForStatus(clientId, started.jobId, auth.token, "ready", deps);
      expect(ready.canExecute).toBe(true);
      expect(ready.lastError?.code).toBe("execute_failed");
      expect(String(ready.lastError?.message || "")).toMatch(/access denied/i);

      const listUrl = new URL(
        `https://operator.example/api/clients/${encodeURIComponent(clientId)}/remote-execute`,
      );
      const listRes = await handleRemoteExecuteRoutes(
        new Request(listUrl, { headers: { Authorization: `Bearer ${auth.token}` } }),
        listUrl,
        mockServer,
        deps as any,
      );
      const listBody = await listRes!.json();
      expect(listBody.jobs.some((j: any) => j.jobId === started.jobId && j.status === "ready")).toBe(
        true,
      );
    } finally {
      clientManager.deleteClient(clientId);
      expect(deleteUser(auth.userId).success).toBe(true);
    }
  });

  test("launch script includes delay and path checks", () => {
    const win = buildRemoteExecuteLaunchScript("C:\\Temp\\a.exe", ["--x"], true, "windows");
    expect(win.type).toBe("powershell");
    expect(win.script).toContain("Start-Sleep -Seconds 3");
    expect(win.script).toContain("Test-Path");
    expect(win.script).toContain("WindowStyle Hidden");

    const unix = buildRemoteExecuteLaunchScript("/tmp/a.sh", [], false, "linux");
    expect(unix.type).toBe("bash");
    expect(unix.script).toContain("sleep 3");

    const shell = buildRemoteExecuteShellPullScript(
      "C:\\Temp\\a.exe",
      "https://example/api/file/upload/pull/x",
      "secret",
      "client-1",
      12,
      "windows",
    );
    expect(shell.type).toBe("powershell");
    expect(shell.script).toContain("Invoke-WebRequest");
    expect(shell.script).toContain("size_mismatch");
  });
});
