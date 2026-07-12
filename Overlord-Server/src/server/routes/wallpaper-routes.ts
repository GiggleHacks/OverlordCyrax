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
import { createUploadPull } from "../file-transfer-state";

type RequestIpProvider = {
  requestIP: (req: Request) => { address?: string } | null | undefined;
};

type PendingCommandReply = {
  resolve: (result: { ok: boolean; message?: string }) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  clientId: string;
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
};

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "bmp"]);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const UPLOAD_TIMEOUT_MS = 60_000; // 60 seconds
const SCRIPT_TIMEOUT_MS = 30_000; // 30 seconds

function getExtension(filename: string): string {
  return (filename.split(".").pop() || "").toLowerCase();
}

function waitForCommandReply(
  deps: WallpaperRouteDeps,
  target: any,
  clientId: string,
  command: any,
  timeoutMessage: string,
  timeoutMs: number,
): Promise<{ ok: boolean; message?: string }> {
  const cmdId = command.id || uuidv4();
  command.id = cmdId;

  const replyPromise = new Promise<{ ok: boolean; message?: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      deps.pendingCommandReplies.delete(cmdId);
      resolve({ ok: false, message: timeoutMessage });
    }, timeoutMs);
    deps.pendingCommandReplies.set(cmdId, { resolve, reject, timeout, clientId });
  });

  try {
    target.ws.send(encodeMessage(command));
  } catch (error) {
    const pending = deps.pendingCommandReplies.get(cmdId);
    if (pending) {
      clearTimeout(pending.timeout);
      deps.pendingCommandReplies.delete(cmdId);
    }
    return Promise.resolve({
      ok: false,
      message: (error as Error)?.message || "Failed to send command",
    });
  }

  return replyPromise.catch((error) => ({
    ok: false,
    message: (error as Error)?.message || timeoutMessage,
  }));
}

function waitForScriptResult(
  deps: WallpaperRouteDeps,
  target: any,
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
    target.ws.send(
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

export async function handleWallpaperRoutes(
  req: Request,
  url: URL,
  server: RequestIpProvider,
  deps: WallpaperRouteDeps,
): Promise<Response | null> {
  /* Only handle POST /api/clients/{clientId}/wallpaper */
  if (req.method !== "POST") return null;
  const match = url.pathname.match(/^\/api\/clients\/(.+)\/wallpaper$/);
  if (!match) return null;

  const user = await authenticateRequest(req);
  if (!user) return new Response("Unauthorized", { status: 401 });

  try {
    requirePermission(user, "clients:control");
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response("Forbidden", { status: 403 });
  }

  const targetId = match[1];
  try {
    requireClientAccess(user, targetId);
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response("Forbidden", { status: 403 });
  }

  const target = clientManager.getClient(targetId);
  if (!target) return Response.json({ ok: false, message: "Client not found" }, { status: 404 });
  if (!target.ws) return Response.json({ ok: false, message: "Client is offline" }, { status: 400 });

  const ip = server.requestIP(req)?.address || "unknown";

  /* Parse multipart form data */
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, message: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ ok: false, message: "Missing file" }, { status: 400 });
  }

  /* Validate file extension */
  const ext = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return Response.json(
      { ok: false, message: `Unsupported format: .${ext}. Use JPG, PNG, or BMP.` },
      { status: 400 },
    );
  }

  /* Validate file size */
  if (file.size > MAX_FILE_SIZE) {
    return Response.json(
      { ok: false, message: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 10 MB.` },
      { status: 400 },
    );
  }

  /* Save to temp directory */
  const tmpDir = os.tmpdir();
  const tmpFileName = `overlord_wp_${uuidv4()}.${ext}`;
  const tmpFilePath = path.join(tmpDir, tmpFileName);
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    await fs.writeFile(tmpFilePath, bytes);
  } catch (error) {
    return Response.json({ ok: false, message: "Failed to save temp file" }, { status: 500 });
  }

  try {
    /* Step 1: Create pull URL and upload to agent */
    const pullId = createUploadPull({
      clientId: targetId,
      filePath: tmpFilePath,
      fileName: tmpFileName,
      size: bytes.length,
      ttlMs: 5 * 60_000, // 5 minutes
    });
    const pullUrl = `/api/file/upload/pull/${encodeURIComponent(pullId)}`;
    const remotePath = `C:\\Users\\Public\\overlord_wallpaper.${ext}`;

    const uploadResult = await waitForCommandReply(
      deps,
      target,
      targetId,
      {
        type: "command",
        commandType: "file_upload_http",
        id: uuidv4(),
        payload: { path: remotePath, url: pullUrl, total: bytes.length },
      },
      "Wallpaper upload to client timed out",
      UPLOAD_TIMEOUT_MS,
    );

    if (!uploadResult.ok) {
      return Response.json(
        { ok: false, message: uploadResult.message || "Failed to upload wallpaper to client" },
        { status: 500 },
      );
    }

    /* Step 2: Run PowerShell to set wallpaper */
    const escapedPath = remotePath.replace(/'/g, "''");
    const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WallpaperSetter {
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
"@
[WallpaperSetter]::SystemParametersInfo(0x0014, 0, '${escapedPath}', 3)
`.trim();

    const scriptResult = await waitForScriptResult(
      deps,
      target,
      targetId,
      psScript,
      "powershell",
      SCRIPT_TIMEOUT_MS,
    );

    if (!scriptResult.ok) {
      return Response.json(
        { ok: false, message: scriptResult.error || "Failed to set wallpaper" },
        { status: 500 },
      );
    }

    /* Audit */
    logAudit({
      timestamp: Date.now(),
      username: user.username,
      ip,
      action: AuditAction.SCRIPT_EXECUTE,
      targetClientId: targetId,
      success: true,
      details: `wallpaper_change (${file.name}, ${bytes.length} bytes)`,
    });
    metrics.recordCommand("wallpaper_change");

    return Response.json({ ok: true, message: "Wallpaper changed successfully" });
  } finally {
    /* Cleanup temp file */
    fs.unlink(tmpFilePath).catch(() => {});
  }
}
