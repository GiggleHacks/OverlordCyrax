import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const publicFile = (name: string) => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");

describe("unified viewer UI", () => {
  test("provides webcam, desktop, split, pip, and dashboard2 modes", async () => {
    const html = await publicFile("viewer.html");
    expect(html).toContain('data-mode="webcam"');
    expect(html).toContain('data-mode="desktop"');
    expect(html).toContain('data-mode="split"');
    expect(html).toContain('data-mode="pip"');
    expect(html).toContain('data-mode="dashboard2"');
    expect(html).toContain("Dashboard 2.0");
    expect(html).not.toContain('data-mode="dock"');
    expect(html).toContain('id="viewerClientId"');
    expect(html).toContain('class="viewer-back"');
    expect(html).toContain('href="/"');
    expect(html).toContain("Back to Clients");
    expect(html).toContain('id="sidePanelCollapse"');
    expect(html).toContain("viewer-toolbar-cam");
    expect(html).toContain('id="viewerDashboard2"');
    expect(html).toContain('id="viewerD2Desktop"');
    expect(html).toContain('id="viewerD2Webcam"');
    expect(html).toContain('id="viewerD2Processes"');
    expect(html).toContain('data-d2-id="desktop"');
    expect(html).toContain('data-d2-id="webcam"');
    expect(html).toContain('data-d2-id="processes"');
    expect(html).toContain('data-d2-id="files"');
    expect(html).toContain('id="viewerD2Files"');
    expect(html).toContain("File Manager 2.0");
    expect(html).not.toContain('data-d2-id="status"');
    expect(html).not.toContain("data-d2-status-id");
    expect(html).toContain("data-d2-reset");
    expect(html).toContain('data-d2-slot="1"');
    expect(html).toContain('data-d2-slot="2"');
    expect(html).not.toContain("data-d2-save");
    expect(html).toContain("data-d2-cam-start");
    expect(html).toContain("data-d2-cam-stop");
    expect(html).toContain('data-mode="dashboard2"');
    expect(html).toContain('data-mode="dashboard2"'); // default shell mode
    expect(html).toMatch(/viewer-panels"[^>]*data-mode="dashboard2"/);
  });

  test("ships Dashboard 2.0 MDI controller and mode wiring", async () => {
    const mdi = await publicFile("assets/dashboard2-mdi.js");
    expect(mdi).toContain("export const DASHBOARD2_MDI_VERSION");
    expect(mdi).toContain("0.4.1");
    expect(mdi).toContain("export function initDashboard2Mdi");
    expect(mdi).toContain("overlord_dashboard2_layout_v2");
    expect(mdi).toContain("overlord_dashboard2_layout_slots_v1");
    expect(mdi).toContain("saveToSlot");
    expect(mdi).toContain("applySlot");
    expect(mdi).toContain("setSlotLocked");
    expect(mdi).toContain("d2-slot-menu");
    expect(mdi).toContain("fa-lock");
    expect(mdi).toContain("is-locked");
    expect(mdi).toContain("factoryReset");
    expect(mdi).toContain("custom slots are never cleared");
    expect(mdi).toContain("setPointerCapture");
    expect(mdi).toContain("pointercancel");
    expect(mdi).toContain("lostpointercapture");
    expect(mdi).toContain('data-d2-edge');
    expect(mdi).toContain("processes");
    expect(mdi).not.toContain("refreshStatus");
    const viewerJs = await publicFile("assets/viewer.js");
    expect(viewerJs).toContain('from "./dashboard2-mdi.js"');
    expect(viewerJs).toContain("VIEWER_JS_VERSION");
    expect(viewerJs).toContain('"dashboard2"');
    expect(viewerJs).toContain("viewer-dashboard2-active");
    expect(viewerJs).toContain("viewerD2Desktop");
    expect(viewerJs).toContain("viewerD2Webcam");
    expect(viewerJs).toContain("viewerD2Processes");
    expect(viewerJs).toContain("d2=1");
    expect(viewerJs).toMatch(/webcamUrlD2[\s\S]*d2=1/);
    // Dashboard 2.0 webcam auto-starts on entry; autostart=0 must not be set.
    expect(viewerJs).not.toMatch(/webcamUrlD2[\s\S]*autostart=0/);
    expect(viewerJs).not.toMatch(/webcamUrlD2[\s\S]*controls=1/);
    expect(viewerJs).toContain("data-d2-cam-settings");
    expect(viewerJs).toContain("is-d2-float");
    expect(viewerJs).toContain("setD2NoCamera");
    const viewerHtml = await publicFile("viewer.html");
    expect(viewerHtml).toContain("data-d2-cam-settings");
    expect(viewerHtml).toContain("data-d2-cam-status");
    expect(viewerHtml).toContain("data-d2-webcam-empty");
    expect(viewerHtml).toContain("No webcam");
    const webcamHtml = await publicFile("webcam.html");
    expect(webcamHtml).toContain('id="webcamEmpty"');
    expect(webcamHtml).toContain("No webcam");
    const webcamJs = await publicFile("assets/webcam.js");
    expect(webcamJs).toContain("webcam-embedded-d2");
    expect(webcamJs).toContain("updateNoCameraUi");
    expect(viewerJs).toContain("overlord_side_panel_d2_collapsed_v1");
    expect(viewerJs).toContain(': "dashboard2"');
    const css = await publicFile("assets/main.css");
    expect(css).toContain('.viewer-panels[data-mode="dashboard2"]');
    expect(css).toContain(".d2-workspace");
    expect(css).toContain(".d2-titlebar");
    expect(css).toContain(".d2-edge-n");
    expect(css).toContain(".d2-edge-se");
    expect(css).not.toContain(".d2-status-tree");
    expect(css).toContain("body.rd-embedded #frameCanvas");
    expect(css).toMatch(/body\.rd-embedded #frameCanvas[\s\S]*?object-fit:\s*contain/);
    expect(css).not.toMatch(/body\.rd-embedded #frameCanvas[\s\S]*?object-fit:\s*fill/);
    expect(css).toContain("body.processes-embedded");
    expect(css).toContain(".d2-cam-status");
  });

  test("supports collapsible rail and desktop-primary split layout", async () => {
    const viewerJs = await publicFile("assets/viewer.js");
    expect(viewerJs).toContain("overlord_side_panel_collapsed_v1");
    expect(viewerJs).toContain("setSideCollapsed");
    expect(viewerJs).toContain("applySplitColumns");
    expect(viewerJs).toContain("webcamNeedsParentBar");
    expect(viewerJs).toContain('nextMode === "dock" ? "split"');
    const css = await publicFile("assets/main.css");
    expect(css).toContain(".side-panel.is-collapsed");
    expect(css).toContain('.viewer-panels[data-mode="split"]');
    expect(css).toContain("viewer-toolbar-cam");
    expect(css).toContain("order: 1");
  });

  test("side panel exposes Clients home link", async () => {
    const js = await publicFile("assets/side-panel.js");
    expect(js).toContain('className = "sp-item sp-home"');
    expect(js).toContain('home.href = "/"');
    expect(js).toContain("Clients");
    expect(js).toContain("mode=dashboard2");
  });

  test("hosts PiP webcam overlay inside the desktop video panel", async () => {
    const html = await publicFile("viewer.html");
    expect(html).toContain('id="viewerDesktopPanel"');
    expect(html).toContain('id="viewerPipOverlay"');
    expect(html).toContain('id="viewerPipWebcam"');
    expect(html).toContain('data-pip-resize');
    expect(html).toContain('data-pip-pin');
    expect(html).toContain('data-pip-snap="tl"');
    expect(html).toContain('data-pip-snap="tr"');
    expect(html).toContain('data-pip-snap="bl"');
    expect(html).toContain('data-pip-snap="br"');
    expect(html).toContain('data-pip-lock-badge');
    expect(html).toContain('data-side-resize');
    expect(html).toContain('data-desktop-resize');
    const desktopIdx = html.indexOf('id="viewerDesktopPanel"');
    const pipIdx = html.indexOf('id="viewerPipOverlay"');
    const desktopClose = html.indexOf("</section>", desktopIdx);
    expect(desktopIdx).toBeGreaterThan(-1);
    expect(pipIdx).toBeGreaterThan(desktopIdx);
    expect(pipIdx).toBeLessThan(desktopClose);
  });

  test("ships shared pip overlay controller hosted on desktop panel", async () => {
    const js = await publicFile("assets/pip-overlay.js");
    expect(js).toContain("export function initPipOverlay");
    expect(js).toContain("pointerdown");
    expect(js).toContain("overlord_pip_layout_v3");
    expect(js).toContain("setMinimized");
    expect(js).toContain("setOpacity");
    expect(js).toContain("edge-bottom");
    expect(js).not.toContain("onDockSpace");
    const viewerJs = await publicFile("assets/viewer.js");
    expect(viewerJs).toContain('from "./pip-overlay.js"');
    expect(viewerJs).toContain("webcamUrlBar");
    expect(viewerJs).toContain("embedded=1");
    expect(viewerJs).toContain('action: "start"');
    expect(viewerJs).toContain("host: desktopPanel");
    expect(viewerJs).toContain("viewer-pip-active");
    expect(viewerJs).toContain("overlord_side_panel_width_v1");
    expect(viewerJs).toContain("overlord_desktop_layout_v1");
    const css = await publicFile("assets/main.css");
    expect(css).toContain("body.viewer-pip-active .viewer-pip-overlay.is-visible");
    expect(css).toContain("is-minimized");
    expect(css).toContain("pip-pill");
    expect(css).toContain("--pip-opacity");
  });

  test("pip toolbar exposes minimize opacity and clear snap controls", async () => {
    const html = await publicFile("viewer.html");
    expect(html).toContain("data-pip-minimize");
    expect(html).toContain("data-pip-opacity");
    expect(html).toContain("data-pip-dock-bottom");
    expect(html).toContain("data-pip-pill");
    expect(html).toContain("data-pip-title");
    expect(html).toContain("Move to top-left corner");
    expect(html).not.toContain(">TL<");
    expect(html).not.toContain("data-pip-dock-space");
  });

  test("exposes parent webcam Start/Stop/Settings bar for split and pip", async () => {
    const html = await publicFile("viewer.html");
    expect(html).toContain('id="viewerWebcamBar"');
    expect(html).toContain('id="viewerCamStart"');
    expect(html).toContain('id="viewerCamStop"');
    expect(html).toContain('id="viewerCamSettingsBtn"');
    expect(html).toContain('id="viewerCamSettingsMenu"');
    expect(html).toContain('value="360" selected');
    const viewerJs = await publicFile("assets/viewer.js");
    expect(viewerJs).toContain("viewer-has-webcam-bar");
    expect(viewerJs).toContain("webcam_cmd");
    expect(viewerJs).toContain("webcamNeedsParentBar");
    expect(viewerJs).toContain('m === "split" || m === "pip"');
    expect(viewerJs).not.toContain('m === "split" || m === "pip" || m === "dashboard2"');
    const webcamJs = await publicFile("assets/webcam.js");
    expect(webcamJs).toContain('data.type !== "webcam_cmd"');
    expect(webcamJs).toContain('action === "start"');
    expect(webcamJs).toContain("postStatusToParent");
    expect(webcamJs).toContain("|| 360");
    expect(webcamJs).toContain('autostartParam !== "0"');
    expect(webcamJs).toContain("allowAutostart");
  });

  test("registers the unified viewer as a protected client page", async () => {
    const routes = await readFile(new URL("./server/routes/page-routes.ts", import.meta.url), "utf8");
    expect(routes).toContain('{ path: "/viewer",        file: "viewer.html" }');
  });

  test("uses capability-driven desktop profiles with safe defaults", async () => {
    const html = await publicFile("remotedesktop.html");
    const js = await publicFile("assets/remotedesktop.js");
    expect(html).toContain('<option value="auto" selected>Auto (best)</option>');
    expect(html).toContain('<option value="480:30">30 FPS - 480p</option>');
    expect(html).toContain('<option value="720:30">30 FPS - 720p</option>');
    expect(html).toContain('<option value="1080:60">60 FPS - 1080p</option>');
    expect(html).toContain('id="streamProfileDetail"');
    expect(js).toContain('sendCmd("desktop_encoder_capabilities"');
    expect(js).toContain('streamProfileSelect?.value || "auto"');
    expect(js).toContain("manualExtraProfiles");
    expect(js).toContain("480");
  });

  test("uses resolution presets instead of webcam quality percentage", async () => {
    const html = await publicFile("webcam.html");
    expect(html).toContain('id="resolutionSelect"');
    expect(html).not.toContain('id="qualitySlider"');
    expect(html).toContain('value="360" selected');
  });

  test("auto-recovers stalled desktop and webcam streams with countdown", async () => {
    const rd = await publicFile("assets/remotedesktop.js");
    expect(rd).toContain("function beginStallRecovery");
    expect(rd).toContain("const MAX_STALL_RESTARTS = 3");
    expect(rd).toContain("Retrying in ${remaining}...");
    expect(rd).toContain("function startDesktopStream");
    expect(rd).toContain("No frames · retries exhausted");

    const cam = await publicFile("assets/webcam.js");
    expect(cam).toContain("function beginStallRecovery");
    expect(cam).toContain("const MAX_STALL_RESTARTS = 3");
    expect(cam).toContain("Retrying in ${remaining}...");
    expect(cam).toContain('offline: "bg-rose-900/40 text-rose-100 border-rose-700/70"');

    const viewer = await publicFile("assets/viewer.js");
    expect(viewer).toContain('offline: "Client offline"');
    expect(viewer).toContain("client.online === false");
    expect(viewer).toContain("Client offline");
    expect(viewer).toContain("is-offline");

    const css = await publicFile("assets/main.css");
    expect(css).toContain(".viewer-capability.is-offline");
  });

  test("process manager supports embedded compact mode", async () => {
    const html = await publicFile("processes.html");
    expect(html).toContain("embedded");
    expect(html).toContain("processes-embedded-check.js");
    expect(html).toContain("processes-bootstrap.js");
    expect(html).toContain("proc-toolbar");
    expect(html).toContain("proc-list-wrap");
    expect(html).toContain("proc-list-placeholder");
    expect(html).toContain("Connecting...");
    // CSP (script-src 'self') forbids inline scripts — bootstraps must be external
    expect(html).not.toMatch(/<script(?![^>]*src=)[^>]*>/);
    const embeddedCheck = await publicFile("assets/processes-embedded-check.js");
    expect(embeddedCheck).toContain("processes-embedded-root");
    expect(embeddedCheck).toContain("processes-embedded");
    const bootstrap = await publicFile("assets/processes-bootstrap.js");
    expect(bootstrap).toContain("/assets/processes.js");
    expect(bootstrap).toContain("/assets/nav.js");
    const js = await publicFile("assets/processes.js");
    expect(js).toContain("PROCESSES_JS_VERSION");
    expect(js).toContain("processes-embedded");
    expect(js).toContain('get("embedded") === "1"');
    expect(js).toContain("setListPlaceholder");
    const css = await publicFile("assets/main.css");
    expect(css).toContain("body.processes-embedded");
    expect(css).toContain("html.processes-embedded-root");
    expect(css).toContain(".proc-list-wrap");
    expect(css).toContain("display: contents !important");
    const mdi = await publicFile("assets/dashboard2-mdi.js");
    expect(mdi).toContain("overlord_dashboard2_layout_v2");
    expect(mdi).toMatch(/processes:\s*\{[^}]*w:\s*0\.24/);
  });

  test("process manager 2.0 ships compact page wired into dashboard2", async () => {
    const html = await publicFile("processes2.html");
    expect(html).toContain("Process Manager 2.0");
    expect(html).toContain("proc2-toolbar");
    expect(html).toContain("proc2-list");
    expect(html).toContain("proc2-search-input");
    expect(html).toContain("proc2-sort-name");
    expect(html).toContain("proc2-sort-cpu");
    expect(html).toContain("proc2-sort-memory");
    expect(html).toContain("/assets/processes2-bootstrap.js");
    expect(html).not.toContain("nav.js");
    // CSP (script-src 'self') forbids inline scripts — bootstraps must be external
    expect(html).not.toMatch(/<script(?![^>]*src=)[^>]*>/);
    const bootstrap2 = await publicFile("assets/processes2-bootstrap.js");
    expect(bootstrap2).toContain("/assets/processes2.js");
    const js = await publicFile("assets/processes2.js");
    expect(js).toContain("PROCESSES2_JS_VERSION");
    expect(js).toContain('"1.3.1"');
    expect(js).toContain("process_kill");
    expect(js).toContain("process_suspend");
    expect(js).toContain("process_resume");
    expect(js).toContain("process_icon");
    expect(js).toContain('checkFeatureAccess("processes", clientId)');
    // multi-select (file-manager behavior)
    expect(js).toContain("selectedPids");
    expect(js).toContain("anchorPid");
    expect(js).toContain("visiblePidOrder");
    expect(js).toContain("shiftKey");
    expect(js).toContain("ctrlKey");
    // sequential kill queue with per-process results
    expect(js).toContain("queueKills");
    expect(js).toContain("killInFlight");
    expect(js).toContain("killResults");
    expect(js).toContain("classifyKillFailure");
    expect(js).toContain("proc2-summary");
    expect(js).toContain("Access denied · admin/SYSTEM required");
    // no confirmation dialogs on kill paths
    expect(js).not.toContain("confirm(`Kill process");
    expect(js).not.toContain("and all child processes?");
    expect(html).toContain("proc2-summary");
    expect(html).toContain("proc2-kb-killed");
    expect(html).toContain("proc2-kb-denied");
    expect(html).toContain("v1.3.1");
    // killbar status text sits in a fixed-width slot so the bar never jitters
    expect(html).toContain("width: min(320px, 45%)");
    // select-all + retro batch kill progress bar
    expect(html).toContain("proc2-selectall");
    expect(html).toContain("fa-check-double");
    expect(html).toContain("proc2-killbar");
    expect(html).toContain("proc2-kb-blocks");
    expect(html).toContain("proc2-kb-pac");
    expect(html).toContain("kbPacTop");
    expect(js).toContain("selectAllVisible");
    expect(js).toContain("CRITICAL_NEVER_KILL");
    expect(js).toContain("KILL_BAR_AUTOHIDE_MS");
    expect(js).toContain("killBarBegin");
    expect(js).toContain("killBarMarkCurrent");
    expect(js).toContain("killBarResolve");
    expect(js).toContain("killBarFinish");
    // hide known-safe filter (suspicious-only view)
    expect(html).toContain("proc2-hidesafe");
    expect(html).toContain("fa-shield-halved");
    expect(js).toContain("hideKnownSafe");
    expect(js).toContain('from "./process-allowlist.js"');
    expect(js).toContain("isKnownSafeProcess");
    const allowlist = await publicFile("assets/process-allowlist.js");
    expect(allowlist).toContain("PROCESS_ALLOWLIST_VERSION");
    expect(allowlist).toContain("KNOWN_SAFE_PROCESSES");
    expect(allowlist).toContain('"svchost.exe"');
    expect(allowlist).toContain('"explorer.exe"');
    expect(allowlist).toContain('"chrome.exe"');
    // the agent (proc.self, yellow highlight) is always treated as trusted
    expect(allowlist).toContain("proc.self");
    // consoles stay visible as potentially suspicious
    expect(allowlist).not.toContain('"powershell.exe"');
    expect(allowlist).not.toContain('"cmd.exe"');
    const viewerJs = await publicFile("assets/viewer.js");
    expect(viewerJs).toContain("/processes2?embedded=1");
    expect(viewerJs).not.toContain("/processes?embedded=1");
    const viewerHtml = await publicFile("viewer.html");
    expect(viewerHtml).toContain("Process Manager 2.0");
    const routes = await readFile(new URL("../src/server/routes/page-routes.ts", import.meta.url), "utf8");
    expect(routes).toContain("processes2.html");
  });

  test("dashboard2 webcam window ships one-click frame copy and save buttons", async () => {
    const html = await publicFile("viewer.html");
    expect(html).toContain('data-d2-cam-copy');
    expect(html).toContain('data-d2-cam-save');
    expect(html).toContain("Copy current frame to clipboard");
    expect(html).toContain("Save current frame as JPG");
    const viewerJs = await publicFile("assets/viewer.js");
    expect(viewerJs).toContain('[data-d2-cam-copy]');
    expect(viewerJs).toContain('[data-d2-cam-save]');
    expect(viewerJs).toContain('"capture_frame"');
    expect(viewerJs).toContain('"webcam_frame"');
    expect(viewerJs).toContain("ClipboardItem");
    expect(viewerJs).toContain("pendingCamCapture");
    // copy/save only enabled with a live (or stalled) frame
    expect(viewerJs).toContain('status === "streaming" || status === "stalled"');
    const webcamJs = await publicFile("assets/webcam.js");
    expect(webcamJs).toContain('action === "capture_frame"');
    expect(webcamJs).toContain('type: "webcam_frame"');
    expect(webcamJs).toContain("captureFrameBlob");
    // WebRTC modes render into <video>, not the canvas — capture must handle both
    expect(webcamJs).toContain("webrtcVideoHasFrame");
  });

  test("dashboard2 MDI keeps drag and 8-way resize handles", async () => {
    const css = await publicFile("assets/main.css");
    const mdi = await publicFile("assets/dashboard2-mdi.js");
    expect(mdi).toContain('["n", "s", "e", "w", "ne", "nw", "se", "sw"]');
    expect(css).toContain(".d2-edge-se");
    expect(css).toContain("cursor: move");
    expect(css).toContain(".d2-slot-menu");
    expect(css).toContain(".d2-slot-lock");
    expect(css).toContain(".d2-chrome-btn.is-locked");
  });

  test("file manager 2.0 ships compact page wired into dashboard2", async () => {
    const html = await publicFile("files2.html");
    expect(html).toContain("File Manager 2.0");
    expect(html).toContain("fm2-toolbar");
    expect(html).toContain("fm2-places");
    expect(html).toContain("fm2-list");
    expect(html).toContain("fm2-path");
    expect(html).toContain("/assets/files2-bootstrap.js");
    expect(html).not.toContain("nav.js");
    expect(html).not.toMatch(/<script(?![^>]*src=)[^>]*>/);
    const bootstrap = await publicFile("assets/files2-bootstrap.js");
    expect(bootstrap).toContain("/assets/files2.js");
    const js = await publicFile("assets/files2.js");
    expect(js).toContain("FILES2_JS_VERSION");
    expect(js).toContain('"1.0.0"');
    expect(js).toContain('checkFeatureAccess("file_browser", clientId)');
    expect(js).toContain("/files/ws");
    expect(js).toContain("file_list");
    expect(js).toContain("file_delete");
    expect(js).toContain("file_mkdir");
    expect(js).toContain("file_upload_http");
    expect(js).toContain("/api/file/download/request");
    expect(js).toContain("updatePlaces");
    expect(js).toContain("/assets/filebrowser-classic");
    expect(js).toContain("sounds/manifest.json");
    expect(js).toContain("playSound");
    const viewerJs = await publicFile("assets/viewer.js");
    expect(viewerJs).toContain("/files2?embedded=1");
    expect(viewerJs).toContain("viewerD2Files");
    const viewerHtml = await publicFile("viewer.html");
    expect(viewerHtml).toContain('data-d2-id="files"');
    expect(viewerHtml).toContain("File Manager 2.0");
    const mdi = await publicFile("assets/dashboard2-mdi.js");
    expect(mdi).toMatch(/files:\s*\{[^}]*x:\s*0\.74/);
    expect(mdi).toMatch(/files:\s*\{[^}]*y:\s*0\.63/);
    expect(mdi).toMatch(/processes:\s*\{[^}]*h:\s*0\.3/);
    expect(mdi).toMatch(/desktop:\s*\{[^}]*h:\s*0\.96/);
    const routes = await readFile(new URL("../src/server/routes/page-routes.ts", import.meta.url), "utf8");
    expect(routes).toContain("files2.html");
  });
});

describe("retro login", () => {
  test("keeps restrained retro styling without fake system messages", async () => {
    const html = await publicFile("login.html");
    expect(html).toContain('id="login-version"');
    expect(html).not.toContain('class="login-boot-log"');
    expect(html).not.toContain("encrypted channel");
    expect(html).not.toContain("AUTHENTICATION TERMINAL");
    expect(html).toContain('<span class="btn-text">Sign in</span>');
  });

  test("plays one-shot MS-DOS brand typewriter after login", async () => {
    const loginJs = await publicFile("assets/login.js");
    expect(loginJs).toContain('sessionStorage.setItem("overlord_brand_typewriter", "1")');
    const navJs = await publicFile("assets/nav.js");
    expect(navJs).toContain("overlord_brand_typewriter");
    expect(navJs).toContain("playBrandTypewriter");
    expect(navJs).toContain("nav-brand-type-cursor");
    expect(navJs).toContain("prefers-reduced-motion");
    const css = await publicFile("assets/main.css");
    expect(css).toContain("nav-brand-type-cursor");
    expect(css).toContain("nav-brand-cursor-blink");
  });
});
