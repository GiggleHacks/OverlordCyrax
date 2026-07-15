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

type PendingScript = {
  resolve: (result: any) => void;
  reject: (error: any) => void;
  timeout: NodeJS.Timeout;
  clientId: string;
};

type WallpaperRouteDeps = {
  pendingCommandReplies: Map<string, PendingCommandReply>;
  pendingScripts: Map<string, PendingScript>;
  uploadTimeoutMs?: number;
  scriptTimeoutMs?: number;
  scriptRetryDelayMs?: number;
};

type WallpaperPhase =
  | "queued"
  | "client_transfer"
  | "verify_remote_file"
  | "apply_wallpaper"
  | "succeeded"
  | "failed";

type WallpaperStatus = "queued" | "running" | "succeeded" | "failed";
type WallpaperEndpointSource = "external_config" | "forwarded_host" | "request_host";
type WallpaperTransferState =
  | "command_not_sent"
  | "command_sent_no_client_progress"
  | "client_transfer_active"
  | "client_transfer_complete";

type WallpaperJobError = {
  code: string;
  message: string;
  phase: WallpaperPhase;
  bytesTransferred: number;
  totalBytes: number;
  destinationPath: string;
  pullOrigin?: string;
  resolvedUrl?: string;
  lastClientMessage?: string;
  lastProgressAt?: number;
  clientMessage?: string;
  serverMessage?: string;
  endpointSource: WallpaperEndpointSource;
  clientVersion?: string;
  clientAcknowledged: boolean;
  transferState: WallpaperTransferState;
  commandSentAt?: number;
};

type WallpaperJob = {
  id: string;
  clientId: string;
  originalName: string;
  tmpFilePath: string;
  pullId: string;
  pullOrigin: string;
  endpointSource: WallpaperEndpointSource;
  clientVersion?: string;
  clientAcknowledged: boolean;
  transferComplete: boolean;
  commandSentAt?: number;
  destinationPath: string;
  totalBytes: number;
  bytesTransferred: number;
  speedBytesPerSecond: number;
  percent: number;
  phase: WallpaperPhase;
  status: WallpaperStatus;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  expiresAt: number;
  timeout: NodeJS.Timeout;
  resolvedUrl?: string;
  transferAttempt?: number;
  lastClientMessage?: string;
  lastProgressAt?: number;
  error?: WallpaperJobError;
};

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "bmp"]);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const UPLOAD_TIMEOUT_MS = 5 * 60_000;
const SCRIPT_TIMEOUT_MS = 30_000; // 30 seconds
const JOB_TTL_MS = 10 * 60_000;

const wallpaperJobs = new Map<string, WallpaperJob>();

function getExtension(filename: string): string {
  return (filename.split(".").pop() || "").toLowerCase();
}

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

function cleanupJob(job: WallpaperJob) {
  cleanupPull(job.pullId);
  fs.unlink(job.tmpFilePath).catch(() => {});
}

function scheduleJobCleanup(job: WallpaperJob) {
  return setTimeout(() => {
    const current = wallpaperJobs.get(job.id);
    if (current === job) {
      wallpaperJobs.delete(job.id);
      cleanupJob(job);
    }
  }, JOB_TTL_MS);
}

function transferState(job: WallpaperJob): WallpaperTransferState {
  if (job.transferComplete) return "client_transfer_complete";
  if (job.clientAcknowledged) return "client_transfer_active";
  if (job.commandSentAt) return "command_sent_no_client_progress";
  return "command_not_sent";
}

function serializeJob(job: WallpaperJob) {
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
    clientAcknowledged: job.clientAcknowledged,
    transferState: transferState(job),
    commandSentAt: job.commandSentAt,
    resolvedUrl: job.resolvedUrl,
    transferAttempt: job.transferAttempt,
    lastClientMessage: job.lastClientMessage,
    lastProgressAt: job.lastProgressAt,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    error: job.error,
  };
}

function setJobPhase(job: WallpaperJob, phase: WallpaperPhase, percent?: number) {
  job.phase = phase;
  job.status = phase === "succeeded" ? "succeeded" : phase === "failed" ? "failed" : "running";
  if (percent !== undefined) {
    job.percent = clampPercent(percent);
  }
  job.updatedAt = now();
}

function failJob(job: WallpaperJob, code: string, message: string, extra: Partial<WallpaperJobError> = {}) {
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
    resolvedUrl: job.resolvedUrl,
    lastClientMessage: job.lastClientMessage,
    lastProgressAt: job.lastProgressAt,
    endpointSource: job.endpointSource,
    clientVersion: job.clientVersion,
    clientAcknowledged: job.clientAcknowledged,
    transferState: transferState(job),
    commandSentAt: job.commandSentAt,
    ...extra,
  };
  cleanupJob(job);
}

function succeedJob(job: WallpaperJob) {
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

function buildPullUrl(req: Request, pullId: string): { url: string; source: WallpaperEndpointSource } {
  const pathName = `/api/file/upload/pull/${encodeURIComponent(pullId)}`;
  const configured = String(process.env.OVERLORD_EXTERNAL_URL || "").trim();
  if (configured) {
    try {
      const external = new URL(configured);
      if (external.protocol === "https:" || external.protocol === "http:") {
        return { url: new URL(pathName, external.origin).toString(), source: "external_config" };
      }
      logger.warn(`[wallpaper] ignoring unsupported OVERLORD_EXTERNAL_URL protocol: ${external.protocol}`);
    } catch (error) {
      logger.warn(`[wallpaper] ignoring invalid OVERLORD_EXTERNAL_URL: ${(error as Error)?.message || error}`);
    }
  }

  const requestUrl = new URL(req.url);
  const forwardedHost = firstHeaderValue(req.headers.get("x-forwarded-host"));
  const host = forwardedHost || firstHeaderValue(req.headers.get("host")) || requestUrl.host;
  const forwardedProtocol = firstHeaderValue(req.headers.get("x-forwarded-proto")).toLowerCase();
  const protocol = forwardedProtocol === "https" || forwardedProtocol === "http"
    ? forwardedProtocol
    : requestUrl.protocol === "https:" ? "https" : "http";
  return {
    url: `${protocol}://${host}${pathName}`,
    source: forwardedHost ? "forwarded_host" : "request_host",
  };
}

function updateJobFromProgress(job: WallpaperJob, payload: any) {
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
  const attempt = Number(payload?.attempt);
  if (Number.isFinite(attempt) && attempt > 0) {
    job.transferAttempt = Math.floor(attempt);
  }
  if (typeof payload?.resolvedUrl === "string" && payload.resolvedUrl) {
    job.resolvedUrl = payload.resolvedUrl;
  }
  if (typeof payload?.message === "string") {
    job.lastClientMessage = payload.message;
  }
  job.lastProgressAt = now();
  job.updatedAt = job.lastProgressAt;
  if (job.phase === "queued") {
    setJobPhase(job, "client_transfer");
  }
  if (job.totalBytes > 0) {
    job.percent = clampPercent(Math.min(95, (job.bytesTransferred / job.totalBytes) * 95));
  }
}

function waitForCommandReply(
  deps: WallpaperRouteDeps,
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

function waitForScriptResult(
  deps: WallpaperRouteDeps,
  clientId: string,
  script: string,
  scriptType: string,
  timeoutMs: number,
): Promise<{ ok: boolean; result?: string; error?: string }> {
  const cmdId = uuidv4();

  const resultPromise = new Promise<{ ok: boolean; result?: string; error?: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      deps.pendingScripts.delete(cmdId);
      resolve({ ok: false, error: "Script execution timed out" });
    }, timeoutMs);
    deps.pendingScripts.set(cmdId, { resolve, reject, timeout, clientId });
  });

  try {
    const currentTarget = clientManager.getClient(clientId);
    if (!currentTarget?.ws) throw new Error("Client is offline");
    currentTarget.ws.send(
      encodeMessage({
        type: "command",
        commandType: "script_exec",
        id: cmdId,
        payload: { script, type: scriptType },
      }),
    );
  } catch (error) {
    const pending = deps.pendingScripts.get(cmdId);
    if (pending) {
      clearTimeout(pending.timeout);
      deps.pendingScripts.delete(cmdId);
    }
    return Promise.resolve({
      ok: false,
      error: (error as Error)?.message || "Failed to send script command",
    });
  }

  return resultPromise.catch((error) => ({
    ok: false,
    error: (error as Error)?.message || "Script execution failed",
  }));
}

function isTransientClientConnectionError(error: unknown): boolean {
  return /client (?:is offline|disconnected|reconnected \(superseded\))/i.test(String(error || ""));
}

async function waitForScriptResultWithReconnectRetry(
  deps: WallpaperRouteDeps,
  clientId: string,
  script: string,
  scriptType: string,
  timeoutMs: number,
): Promise<{ ok: boolean; result?: string; error?: string }> {
  const maxAttempts = 3;
  let lastResult: { ok: boolean; result?: string; error?: string } = {
    ok: false,
    error: "Script execution did not start",
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResult = await waitForScriptResult(deps, clientId, script, scriptType, timeoutMs);
    if (lastResult.ok || !isTransientClientConnectionError(lastResult.error)) {
      return lastResult;
    }
    if (attempt < maxAttempts) {
      logger.warn(`[wallpaper] client ${clientId} connection changed during script; retrying on current socket (${attempt + 1}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, deps.scriptRetryDelayMs ?? 250));
    }
  }

  return {
    ...lastResult,
    error: `${lastResult.error || "Client connection changed"} after ${maxAttempts} attempts`,
  };
}

function verificationScript(remotePath: string): string {
  const escapedPath = remotePath.replace(/'/g, "''");
  return `
$path = '${escapedPath}'
if (Test-Path -LiteralPath $path -PathType Leaf) {
  Write-Output 'exists:true'
  exit 0
}
Write-Output 'exists:false'
exit 2
`.trim();
}

function applyWallpaperScript(remotePath: string): string {
  const escapedPath = remotePath.replace(/'/g, "''");
  return `
$path = '${escapedPath}'
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name WallpaperStyle -Value '6' -ErrorAction SilentlyContinue
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name TileWallpaper -Value '0' -ErrorAction SilentlyContinue

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WallpaperSetter {
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
"@
$ok = [WallpaperSetter]::SystemParametersInfo(0x0014, 0, $path, 3)
if ($ok -eq 0) {
  Write-Output 'wallpaper_applied:false'
  exit 3
}
Write-Output 'wallpaper_applied:true'
exit 0
`.trim();
}

async function runWallpaperJob(job: WallpaperJob, deps: WallpaperRouteDeps, user: any, ip: string) {
  try {
    setJobPhase(job, "client_transfer", 0);
    job.commandSentAt = now();
    logger.info(`[wallpaper] uploading to ${job.destinationPath} via pull URL: ${job.pullOrigin} (source=${job.endpointSource}, clientVersion=${job.clientVersion || "unknown"}, size=${job.totalBytes})`);

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
        message: "client did not complete pulling the wallpaper file before the transfer timeout",
      },
      deps.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS,
      (payload) => updateJobFromProgress(job, payload),
    );

    if (uploadResult.code !== "client_transfer_timeout" && uploadResult.code !== "send_command_failed") {
      job.clientAcknowledged = true;
    }

    if (!uploadResult.ok) {
      const failureMessage = uploadResult.code === "client_transfer_timeout" && !job.clientAcknowledged
        ? "client did not acknowledge the wallpaper transfer command before timeout; the file transfer never started"
        : uploadResult.message || "Failed to upload wallpaper to client";
      logger.warn(`[wallpaper] upload failed for ${job.clientId}: ${failureMessage}`);
      failJob(job, uploadResult.code || "client_transfer_failed", failureMessage, {
        phase: "client_transfer",
        clientMessage: uploadResult.message,
      });
      return;
    }

    job.transferComplete = true;
    job.bytesTransferred = job.totalBytes;
    job.percent = 95;
    setJobPhase(job, "verify_remote_file", 96);

    const verifyResult = await waitForScriptResultWithReconnectRetry(
      deps,
      job.clientId,
      verificationScript(job.destinationPath),
      "powershell",
      deps.scriptTimeoutMs ?? SCRIPT_TIMEOUT_MS,
    );
    const verifyOutput = String(verifyResult.result || "");
    if (!verifyResult.ok || !verifyOutput.toLowerCase().includes("exists:true")) {
      failJob(job, "verify_remote_file_failed", "upload command completed but destination file was not found on the client", {
        phase: "verify_remote_file",
        clientMessage: verifyResult.error || verifyOutput,
      });
      return;
    }

    setJobPhase(job, "apply_wallpaper", 98);
    const applyResult = await waitForScriptResultWithReconnectRetry(
      deps,
      job.clientId,
      applyWallpaperScript(job.destinationPath),
      "powershell",
      deps.scriptTimeoutMs ?? SCRIPT_TIMEOUT_MS,
    );
    const applyOutput = String(applyResult.result || "");
    if (!applyResult.ok || !applyOutput.toLowerCase().includes("wallpaper_applied:true")) {
      const connectionFailed = isTransientClientConnectionError(applyResult.error);
      failJob(
        job,
        connectionFailed ? "apply_wallpaper_connection_failed" : "apply_wallpaper_failed",
        connectionFailed
          ? "file exists on the client, but repeated client reconnects interrupted the wallpaper apply command"
          : "file exists on the client but Windows did not apply it as wallpaper",
        {
          phase: "apply_wallpaper",
          clientMessage: applyResult.error || applyOutput,
        },
      );
      return;
    }

    logAudit({
      timestamp: Date.now(),
      username: user.username,
      ip,
      action: AuditAction.SCRIPT_EXECUTE,
      targetClientId: job.clientId,
      success: true,
      details: `wallpaper_change (${job.originalName}, ${job.totalBytes} bytes)`,
    });
    metrics.recordCommand("wallpaper_change");
    succeedJob(job);
  } catch (error) {
    failJob(job, "wallpaper_job_failed", (error as Error)?.message || "Wallpaper job failed", {
      serverMessage: (error as Error)?.stack || String(error),
    });
  }
}

export async function handleWallpaperRoutes(
  req: Request,
  url: URL,
  server: RequestIpProvider,
  deps: WallpaperRouteDeps,
): Promise<Response | null> {
  const statusMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/wallpaper\/([^/]+)$/);
  const postMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/wallpaper$/);
  if (req.method === "GET" && !statusMatch) return null;
  if (req.method === "POST" && !postMatch) return null;
  if (req.method !== "GET" && req.method !== "POST") return null;

  const user = await authenticateRequest(req);
  if (!user) return new Response("Unauthorized", { status: 401 });

  try {
    requirePermission(user, "clients:control");
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response("Forbidden", { status: 403 });
  }

  const targetId = (statusMatch || postMatch)![1];
  try {
    requireClientAccess(user, targetId);
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method === "GET" && statusMatch) {
    const jobId = statusMatch[2];
    const job = wallpaperJobs.get(jobId);
    if (!job || job.clientId !== targetId || job.expiresAt < Date.now()) {
      return Response.json({ ok: false, message: "Wallpaper job not found" }, { status: 404 });
    }
    return Response.json(serializeJob(job));
  }

  const target = clientManager.getClient(targetId);
  if (!target) return Response.json({ ok: false, code: "client_offline", message: "Client not found" }, { status: 404 });
  if (!target.ws) return Response.json({ ok: false, code: "client_offline", message: "Client is offline" }, { status: 400 });

  const ip = server.requestIP(req)?.address || "unknown";

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, code: "upload_staging_failed", message: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ ok: false, code: "invalid_file", message: "Missing file" }, { status: 400 });
  }

  const ext = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return Response.json(
      { ok: false, code: "invalid_file", message: `Unsupported format: .${ext}. Use JPG, PNG, or BMP.` },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return Response.json(
      { ok: false, code: "invalid_file", message: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 10 MB.` },
      { status: 400 },
    );
  }

  const tmpDir = os.tmpdir();
  const tmpFileName = `overlord_wp_${uuidv4()}.${ext}`;
  const tmpFilePath = path.join(tmpDir, tmpFileName);
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    await fs.writeFile(tmpFilePath, bytes);
  } catch (error) {
    return Response.json({
      ok: false,
      code: "upload_staging_failed",
      message: "Failed to save temp file",
      serverMessage: (error as Error)?.message,
    }, { status: 500 });
  }

  const pullId = createUploadPull({
    clientId: targetId,
    filePath: tmpFilePath,
    fileName: tmpFileName,
    size: bytes.length,
    ttlMs: 5 * 60_000,
  });
  const pullEndpoint = buildPullUrl(req, pullId);
  const destinationPath = `C:\\Users\\Public\\overlord_wallpaper.${ext}`;
  const startedAt = now();
  const job: WallpaperJob = {
    id: uuidv4(),
    clientId: targetId,
    originalName: file.name,
    tmpFilePath,
    pullId,
    pullOrigin: pullEndpoint.url,
    endpointSource: pullEndpoint.source,
    clientVersion: target.version,
    clientAcknowledged: false,
    transferComplete: false,
    destinationPath,
    totalBytes: bytes.length,
    bytesTransferred: 0,
    speedBytesPerSecond: 0,
    percent: 0,
    phase: "queued",
    status: "queued",
    startedAt,
    updatedAt: startedAt,
    expiresAt: startedAt + JOB_TTL_MS,
    timeout: null as any,
  };
  job.timeout = scheduleJobCleanup(job);
  wallpaperJobs.set(job.id, job);

  void runWallpaperJob(job, deps, user, ip);

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
    clientAcknowledged: job.clientAcknowledged,
    transferState: transferState(job),
  });
}
