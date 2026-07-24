import os from "os";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { authenticateRequest } from "../../auth";
import { AuditAction, logAudit } from "../../auditLog";
import * as clientManager from "../../clientManager";
import { metrics } from "../../metrics";
import { encodeMessage } from "../../protocol";
import { requireClientAccess, requirePermission } from "../../rbac";
import { createUploadPull, uploadPulls } from "../file-transfer-state";
import { sanitizeUploadFilename } from "../upload-security";
import { normalizeClientOs } from "../deploy-utils";
import { logger } from "../../logger";

type RequestIpProvider = {
  requestIP: (req: Request) => { address?: string } | null | undefined;
};

type CommandReplyResult = {
  ok: boolean;
  message?: string;
  code?: string;
};

type PendingCommandReply = {
  resolve: (result: CommandReplyResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  clientId: string;
  onProgress?: (payload: any) => void;
};

type RemoteExecuteRouteDeps = {
  pendingCommandReplies: Map<string, PendingCommandReply>;
  uploadTimeoutMs?: number;
  execTimeoutMs?: number;
};

type RemoteExecutePhase =
  | "queued"
  | "staging"
  | "client_transfer"
  | "chmod"
  | "execute"
  | "succeeded"
  | "failed";

type RemoteExecuteStatus = "queued" | "running" | "succeeded" | "failed";
type EndpointSource = "external_config" | "forwarded_host" | "request_host";
type TransferState =
  | "command_not_sent"
  | "command_sent_no_client_progress"
  | "client_transfer_active"
  | "client_transfer_complete";

type RemoteExecuteJobError = {
  code: string;
  message: string;
  phase: RemoteExecutePhase;
  bytesTransferred: number;
  totalBytes: number;
  destinationPath: string;
  pullOrigin?: string;
  clientMessage?: string;
  serverMessage?: string;
  endpointSource: EndpointSource;
  clientVersion?: string;
  clientAcknowledged: boolean;
  transferState: TransferState;
};

type RemoteExecuteJob = {
  id: string;
  clientId: string;
  originalName: string;
  safeName: string;
  args: string[];
  hideWindow: boolean;
  tmpFilePath: string;
  pullId: string;
  pullOrigin: string;
  endpointSource: EndpointSource;
  clientVersion?: string;
  clientOs: string;
  clientAcknowledged: boolean;
  transferComplete: boolean;
  commandSentAt?: number;
  destinationPath: string;
  totalBytes: number;
  bytesTransferred: number;
  speedBytesPerSecond: number;
  percent: number;
  phase: RemoteExecutePhase;
  status: RemoteExecuteStatus;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  expiresAt: number;
  timeout: NodeJS.Timeout;
  lastClientMessage?: string;
  lastProgressAt?: number;
  error?: RemoteExecuteJobError;
};

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200 MB
const UPLOAD_TIMEOUT_MS = 30 * 60_000;
const EXEC_TIMEOUT_MS = 60_000;
const JOB_TTL_MS = 30 * 60_000;

const remoteExecuteJobs = new Map<string, RemoteExecuteJob>();

function now() {
  return Date.now();
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function cleanupPull(pullId: string) {
  const pull = uploadPulls.get(pullId);
  if (pull) {
    clearTimeout(pull.timeout);
    uploadPulls.delete(pullId);
  }
}

function cleanupJob(job: RemoteExecuteJob) {
  cleanupPull(job.pullId);
  fs.unlink(job.tmpFilePath).catch(() => {});
}

function scheduleJobCleanup(job: RemoteExecuteJob) {
  return setTimeout(() => {
    const current = remoteExecuteJobs.get(job.id);
    if (current === job) {
      remoteExecuteJobs.delete(job.id);
      cleanupJob(job);
    }
  }, JOB_TTL_MS);
}

function transferState(job: RemoteExecuteJob): TransferState {
  if (job.transferComplete) return "client_transfer_complete";
  if (job.clientAcknowledged) return "client_transfer_active";
  if (job.commandSentAt) return "command_sent_no_client_progress";
  return "command_not_sent";
}

function serializeJob(job: RemoteExecuteJob) {
  return {
    ok: job.status !== "failed",
    jobId: job.id,
    clientId: job.clientId,
    phase: job.phase,
    status: job.status,
    percent: job.percent,
    bytesTransferred: job.bytesTransferred,
    totalBytes: job.totalBytes,
    speedBytesPerSecond: job.speedBytesPerSecond,
    destinationPath: job.destinationPath,
    pullOrigin: job.pullOrigin,
    endpointSource: job.endpointSource,
    clientVersion: job.clientVersion,
    clientOs: job.clientOs,
    clientAcknowledged: job.clientAcknowledged,
    transferState: transferState(job),
    commandSentAt: job.commandSentAt,
    lastClientMessage: job.lastClientMessage,
    lastProgressAt: job.lastProgressAt,
    originalName: job.originalName,
    args: job.args,
    hideWindow: job.hideWindow,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    error: job.error,
    message:
      job.status === "failed"
        ? job.error?.message
        : job.status === "succeeded"
          ? `Executed ${job.originalName}`
          : undefined,
  };
}

function setJobPhase(job: RemoteExecuteJob, phase: RemoteExecutePhase, percent?: number) {
  job.phase = phase;
  job.status = phase === "succeeded" ? "succeeded" : phase === "failed" ? "failed" : "running";
  if (percent !== undefined) job.percent = clampPercent(percent);
  job.updatedAt = now();
}

function failJob(job: RemoteExecuteJob, code: string, message: string, extra: Partial<RemoteExecuteJobError> = {}) {
  job.phase = extra.phase || job.phase || "failed";
  job.status = "failed";
  job.percent = Math.min(job.percent, 99);
  job.completedAt = now();
  job.updatedAt = job.completedAt;
  job.error = {
    code,
    message,
    phase: job.phase,
    bytesTransferred: job.bytesTransferred,
    totalBytes: job.totalBytes,
    destinationPath: job.destinationPath,
    pullOrigin: job.pullOrigin,
    endpointSource: job.endpointSource,
    clientVersion: job.clientVersion,
    clientAcknowledged: job.clientAcknowledged,
    transferState: transferState(job),
    ...extra,
  };
  cleanupJob(job);
}

function succeedJob(job: RemoteExecuteJob) {
  job.phase = "succeeded";
  job.status = "succeeded";
  job.bytesTransferred = job.totalBytes;
  job.percent = 100;
  job.completedAt = now();
  job.updatedAt = job.completedAt;
  cleanupJob(job);
}

function firstHeaderValue(value: string | null): string {
  return String(value || "").split(",", 1)[0].trim();
}

function buildPullUrl(req: Request, pullId: string): { url: string; source: EndpointSource } {
  const pathName = `/api/file/upload/pull/${encodeURIComponent(pullId)}`;
  const configured = String(process.env.OVERLORD_EXTERNAL_URL || "").trim();
  if (configured) {
    try {
      const external = new URL(configured);
      if (external.protocol === "https:" || external.protocol === "http:") {
        return { url: new URL(pathName, external.origin).toString(), source: "external_config" };
      }
    } catch {
      /* fall through */
    }
  }

  const requestUrl = new URL(req.url);
  const forwardedHost = firstHeaderValue(req.headers.get("x-forwarded-host"));
  const host = forwardedHost || firstHeaderValue(req.headers.get("host")) || requestUrl.host;
  const forwardedProtocol = firstHeaderValue(req.headers.get("x-forwarded-proto")).toLowerCase();
  const protocol =
    forwardedProtocol === "https" || forwardedProtocol === "http"
      ? forwardedProtocol
      : requestUrl.protocol === "https:"
        ? "https"
        : "http";
  return {
    url: `${protocol}://${host}${pathName}`,
    source: forwardedHost ? "forwarded_host" : "request_host",
  };
}

function parseArgs(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v)).filter(Boolean);
  }
  const text = String(raw || "").trim();
  if (!text) return [];
  // Simple whitespace split with quoted segments.
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return out.filter(Boolean);
}

function parseHideWindow(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function updateJobFromProgress(job: RemoteExecuteJob, payload: any) {
  job.clientAcknowledged = true;
  const transferred = Number(payload?.transferred);
  const total = Number(payload?.total);
  if (Number.isFinite(transferred) && transferred >= 0) {
    job.bytesTransferred = Math.min(transferred, job.totalBytes);
  }
  if (Number.isFinite(total) && total > 0 && total !== job.totalBytes) {
    job.totalBytes = total;
  }
  const speed = Number(payload?.speedBytesPerSecond);
  if (Number.isFinite(speed) && speed >= 0) {
    job.speedBytesPerSecond = speed;
  }
  if (typeof payload?.message === "string") {
    job.lastClientMessage = payload.message;
  }
  job.lastProgressAt = now();
  job.updatedAt = job.lastProgressAt;
  if (job.phase === "queued" || job.phase === "staging") {
    setJobPhase(job, "client_transfer");
  }
  if (job.totalBytes > 0) {
    // Transfer maps to 5–90% of overall progress.
    job.percent = clampPercent(5 + (job.bytesTransferred / job.totalBytes) * 85);
  }
}

function waitForCommandReply(
  deps: RemoteExecuteRouteDeps,
  clientId: string,
  command: any,
  timeout: { code: string; message: string },
  timeoutMs: number,
  onProgress?: (payload: any) => void,
): Promise<CommandReplyResult> {
  const cmdId = command.id || uuidv4();
  command.id = cmdId;

  const replyPromise = new Promise<CommandReplyResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      deps.pendingCommandReplies.delete(cmdId);
      resolve({ ok: false, code: timeout.code, message: timeout.message });
    }, timeoutMs);
    deps.pendingCommandReplies.set(cmdId, { resolve, reject, timeout: timer, clientId, onProgress });
  });

  try {
    const currentTarget = clientManager.getClient(clientId);
    if (!currentTarget?.ws) throw new Error("Client is offline");
    currentTarget.ws.send(encodeMessage(command));
  } catch (error) {
    const pending = deps.pendingCommandReplies.get(cmdId);
    if (pending) {
      clearTimeout(pending.timeout);
      deps.pendingCommandReplies.delete(cmdId);
    }
    return Promise.resolve({
      ok: false,
      code: "send_command_failed",
      message: (error as Error)?.message || "Failed to send command",
    });
  }

  return replyPromise.catch((error) => ({
    ok: false,
    code: "send_command_failed",
    message: (error as Error)?.message || timeout.message,
  }));
}

function destinationForClient(clientOs: string, jobId: string, safeName: string): string {
  if (clientOs === "windows") {
    return `C:\\Windows\\Temp\\Overlord\\rex-${jobId}\\${safeName}`;
  }
  return `/tmp/overlord/rex-${jobId}/${safeName}`;
}

async function runRemoteExecuteJob(
  job: RemoteExecuteJob,
  deps: RemoteExecuteRouteDeps,
  user: { username: string },
  ip: string,
) {
  try {
    setJobPhase(job, "client_transfer", 5);
    job.commandSentAt = now();
    logger.info(
      `[remote-execute] upload ${job.originalName} → ${job.destinationPath} via ${job.pullOrigin} (${job.totalBytes} bytes)`,
    );

    const uploadResult = await waitForCommandReply(
      deps,
      job.clientId,
      {
        type: "command",
        commandType: "file_upload_http",
        id: uuidv4(),
        payload: { path: job.destinationPath, url: job.pullOrigin, total: job.totalBytes },
      },
      {
        code: "client_transfer_timeout",
        message: "client did not complete pulling the file before the transfer timeout",
      },
      deps.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS,
      (payload) => updateJobFromProgress(job, payload),
    );

    if (uploadResult.code !== "client_transfer_timeout" && uploadResult.code !== "send_command_failed") {
      job.clientAcknowledged = true;
    }

    if (!uploadResult.ok) {
      const failureMessage =
        uploadResult.code === "client_transfer_timeout" && !job.clientAcknowledged
          ? "client did not acknowledge the transfer command before timeout; the file transfer never started"
          : uploadResult.message || "Failed to upload file to client";
      failJob(job, uploadResult.code || "client_transfer_failed", failureMessage, {
        phase: "client_transfer",
        clientMessage: uploadResult.message,
      });
      return;
    }

    job.transferComplete = true;
    job.bytesTransferred = job.totalBytes;
    job.percent = 90;

    if (job.clientOs !== "windows") {
      setJobPhase(job, "chmod", 92);
      const chmodResult = await waitForCommandReply(
        deps,
        job.clientId,
        {
          type: "command",
          commandType: "file_chmod",
          id: uuidv4(),
          payload: { path: job.destinationPath, mode: "0755" },
        },
        {
          code: "chmod_timeout",
          message: "chmod timed out on the client",
        },
        60_000,
      );
      if (!chmodResult.ok) {
        failJob(job, chmodResult.code || "chmod_failed", chmodResult.message || "Failed to set execute permissions", {
          phase: "chmod",
          clientMessage: chmodResult.message,
        });
        return;
      }
    }

    setJobPhase(job, "execute", 96);
    const execResult = await waitForCommandReply(
      deps,
      job.clientId,
      {
        type: "command",
        commandType: "silent_exec",
        id: uuidv4(),
        payload: {
          command: job.destinationPath,
          args: job.args,
          hideWindow: job.hideWindow,
        },
      },
      {
        code: "execute_timeout",
        message: "execution start timed out on the client",
      },
      deps.execTimeoutMs ?? EXEC_TIMEOUT_MS,
    );

    if (!execResult.ok) {
      failJob(job, execResult.code || "execute_failed", execResult.message || "Failed to start remote execution", {
        phase: "execute",
        clientMessage: execResult.message,
      });
      return;
    }

    logAudit({
      timestamp: Date.now(),
      username: user.username,
      ip,
      action: AuditAction.SILENT_EXECUTE,
      targetClientId: job.clientId,
      success: true,
      details: JSON.stringify({
        remoteExecute: true,
        file: job.originalName,
        path: job.destinationPath,
        args: job.args,
        hideWindow: job.hideWindow,
        bytes: job.totalBytes,
      }),
    });
    metrics.recordCommand("silent_exec");
    succeedJob(job);
  } catch (error) {
    failJob(job, "remote_execute_job_failed", (error as Error)?.message || "Remote execute job failed", {
      serverMessage: (error as Error)?.stack || String(error),
    });
  }
}

export async function handleRemoteExecuteRoutes(
  req: Request,
  url: URL,
  server: RequestIpProvider,
  deps: RemoteExecuteRouteDeps,
): Promise<Response | null> {
  const statusMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/remote-execute\/([^/]+)$/);
  const postMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/remote-execute$/);
  if (req.method === "GET" && !statusMatch) return null;
  if (req.method === "POST" && !postMatch) return null;
  if (req.method !== "GET" && req.method !== "POST") return null;

  const user = await authenticateRequest(req);
  if (!user) return new Response("Unauthorized", { status: 401 });

  try {
    requirePermission(user, "clients:silent-exec");
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method === "GET" && statusMatch) {
    const targetId = decodeURIComponent(statusMatch[1]);
    const jobId = decodeURIComponent(statusMatch[2]);
    try {
      requireClientAccess(user, targetId);
    } catch (error) {
      if (error instanceof Response) return error;
      return new Response("Forbidden", { status: 403 });
    }
    const job = remoteExecuteJobs.get(jobId);
    if (!job || job.clientId !== targetId) {
      return Response.json({ ok: false, message: "Job not found" }, { status: 404 });
    }
    return Response.json(serializeJob(job));
  }

  if (req.method !== "POST" || !postMatch) return null;

  const targetId = decodeURIComponent(postMatch[1]);
  try {
    requireClientAccess(user, targetId);
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response("Forbidden", { status: 403 });
  }

  const target = clientManager.getClient(targetId);
  if (!target?.ws) {
    return Response.json({ ok: false, message: "Client is offline" }, { status: 409 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, message: "Invalid multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ ok: false, message: "Missing file" }, { status: 400 });
  }
  if (file.size <= 0) {
    return Response.json({ ok: false, message: "File is empty" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return Response.json(
      {
        ok: false,
        message: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
      },
      { status: 413 },
    );
  }

  const safeName = sanitizeUploadFilename(file.name, "payload.bin");
  const args = parseArgs(form.get("args"));
  const hideWindow = parseHideWindow(form.get("hideWindow"));
  const clientOs = normalizeClientOs(target.os);
  const jobId = uuidv4();
  const destinationPath = destinationForClient(clientOs, jobId, safeName);

  const tmpDir = os.tmpdir();
  const tmpFilePath = path.join(tmpDir, `overlord_rex_${jobId}_${safeName}`);
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    await fs.writeFile(tmpFilePath, bytes);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "upload_staging_failed",
        message: "Failed to stage file on server",
        serverMessage: (error as Error)?.message,
      },
      { status: 500 },
    );
  }

  const pullId = createUploadPull({
    clientId: targetId,
    filePath: tmpFilePath,
    fileName: safeName,
    size: bytes.length,
    ttlMs: UPLOAD_TIMEOUT_MS,
  });
  const pullEndpoint = buildPullUrl(req, pullId);
  const startedAt = now();
  const job: RemoteExecuteJob = {
    id: jobId,
    clientId: targetId,
    originalName: file.name || safeName,
    safeName,
    args,
    hideWindow,
    tmpFilePath,
    pullId,
    pullOrigin: pullEndpoint.url,
    endpointSource: pullEndpoint.source,
    clientVersion: target.version,
    clientOs,
    clientAcknowledged: false,
    transferComplete: false,
    destinationPath,
    totalBytes: bytes.length,
    bytesTransferred: 0,
    speedBytesPerSecond: 0,
    percent: 2,
    phase: "staging",
    status: "running",
    startedAt,
    updatedAt: startedAt,
    expiresAt: startedAt + JOB_TTL_MS,
    timeout: null as any,
  };
  job.timeout = scheduleJobCleanup(job);
  remoteExecuteJobs.set(job.id, job);

  const ip = server.requestIP(req)?.address || "unknown";
  void runRemoteExecuteJob(job, deps, user, ip);

  return Response.json({
    ok: true,
    jobId: job.id,
    destinationPath: job.destinationPath,
    totalBytes: job.totalBytes,
    phase: job.phase,
    status: job.status,
    percent: job.percent,
    pullOrigin: job.pullOrigin,
    endpointSource: job.endpointSource,
    clientVersion: job.clientVersion,
    originalName: job.originalName,
  });
}
