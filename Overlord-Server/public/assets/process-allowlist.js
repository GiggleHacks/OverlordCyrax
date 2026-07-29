/** Known-safe process allowlist for Process Manager 2.0. v1.0.0 */
const PROCESS_ALLOWLIST_VERSION = "1.0.0";

/**
 * Lowercased executable names considered well-known and trusted.
 * Used by the "hide known-safe" filter; deliberately conservative —
 * borderline or commonly abused hosts (cmd.exe, powershell.exe, wt.exe,
 * rundll32.exe, wscript.exe, ...) stay OFF the list so they remain visible.
 */
const KNOWN_SAFE_PROCESSES = new Set([
  /* ── Windows kernel / core OS ─────────────────────────── */
  "system",
  "registry",
  "secure system",
  "memory compression",
  "idle",
  "smss.exe",
  "csrss.exe",
  "wininit.exe",
  "winlogon.exe",
  "userinit.exe",
  "logonui.exe",
  "services.exe",
  "lsass.exe",
  "lsaiso.exe",
  "lsm.exe",
  "svchost.exe",
  "spoolsv.exe",
  "dwm.exe",
  "explorer.exe",
  "taskhostw.exe",
  "sihost.exe",
  "runtimebroker.exe",
  "dllhost.exe",
  "conhost.exe",
  "ctfmon.exe",
  "fontdrvhost.exe",
  "audiodg.exe",
  "wmiprvse.exe",
  "dashost.exe",
  "wudfhost.exe",
  "unsecapp.exe",
  "sgrmbroker.exe",
  "mscorsvw.exe",
  "trustedinstaller.exe",
  "tiworker.exe",
  "vssvc.exe",
  "sppsvc.exe",
  "msdtc.exe",
  "smartscreen.exe",
  /* ── Windows shell / inbox apps ───────────────────────── */
  "searchindexer.exe",
  "searchapp.exe",
  "searchhost.exe",
  "searchprotocolhost.exe",
  "searchfilterhost.exe",
  "startmenuexperiencehost.exe",
  "shellexperiencehost.exe",
  "textinputhost.exe",
  "backgroundtaskhost.exe",
  "applicationframehost.exe",
  "systemsettings.exe",
  "widgets.exe",
  "widgetservice.exe",
  "phoneexperiencehost.exe",
  "snippingtool.exe",
  "calculatorapp.exe",
  "notepad.exe",
  "mspaint.exe",
  /* ── Microsoft Defender ───────────────────────────────── */
  "msmpeng.exe",
  "nissrv.exe",
  "mpdefendercoreservice.exe",
  "securityhealthservice.exe",
  "securityhealthsystray.exe",
  "mssense.exe",
  /* ── Browsers ─────────────────────────────────────────── */
  "chrome.exe",
  "msedge.exe",
  "firefox.exe",
  "brave.exe",
  "opera.exe",
  "vivaldi.exe",
  "iexplore.exe",
  /* ── Communication / office / cloud ───────────────────── */
  "msteams.exe",
  "ms-teams.exe",
  "teams.exe",
  "slack.exe",
  "discord.exe",
  "zoom.exe",
  "webex.exe",
  "winword.exe",
  "excel.exe",
  "powerpnt.exe",
  "outlook.exe",
  "onenote.exe",
  "msaccess.exe",
  "mspub.exe",
  "officeclicktorun.exe",
  "onedrive.exe",
  "dropbox.exe",
  "googledrivefs.exe",
  "googledrivesync.exe",
  /* ── Utilities / media / gaming ───────────────────────── */
  "code.exe",
  "vlc.exe",
  "acrord32.exe",
  "7zfm.exe",
  "winrar.exe",
  "spotify.exe",
  "notion.exe",
  "obs64.exe",
  "steam.exe",
  "steamservice.exe",
  "epicgameslauncher.exe",
  /* ── GPU / audio vendor helpers ───────────────────────── */
  "nvcontainer.exe",
  "nvdisplay.container.exe",
  "nvidia share.exe",
  "nvidia web helper.exe",
  "radeonsoftware.exe",
  "amdrsserv.exe",
  "cnext.exe",
  "igfxtray.exe",
  "igfxem.exe",
  "igfxhk.exe",
  "rtkauduservice64.exe",
  "ravbg64.exe",
]);

/**
 * Returns true when a process is trusted and must be hidden by the
 * "hide known-safe" filter. The Overlord agent process (flagged `self`,
 * highlighted yellow) is implicitly trusted and must NEVER appear in the
 * suspicious-only view, regardless of its executable name.
 */
function isKnownSafeProcess(proc) {
  if (!proc || typeof proc !== "object") return false;
  if (proc.self) return true;
  const name = typeof proc.name === "string" ? proc.name.toLowerCase() : "";
  return KNOWN_SAFE_PROCESSES.has(name);
}

export { PROCESS_ALLOWLIST_VERSION, KNOWN_SAFE_PROCESSES, isKnownSafeProcess };
