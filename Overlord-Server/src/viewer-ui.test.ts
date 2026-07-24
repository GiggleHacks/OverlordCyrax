import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const publicFile = (name: string) => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");

describe("unified viewer UI", () => {
  test("provides webcam, desktop, split, and pip modes only", async () => {
    const html = await publicFile("viewer.html");
    expect(html).toContain('data-mode="webcam"');
    expect(html).toContain('data-mode="desktop"');
    expect(html).toContain('data-mode="split"');
    expect(html).toContain('data-mode="pip"');
    expect(html).not.toContain('data-mode="dock"');
    expect(html).toContain('id="viewerClientId"');
    expect(html).toContain('class="viewer-back"');
    expect(html).toContain('href="/"');
    expect(html).toContain("Back to Clients");
    expect(html).toContain('id="sidePanelCollapse"');
    expect(html).toContain("viewer-toolbar-cam");
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
    const webcamJs = await publicFile("assets/webcam.js");
    expect(webcamJs).toContain('data.type !== "webcam_cmd"');
    expect(webcamJs).toContain('action === "start"');
    expect(webcamJs).toContain("postStatusToParent");
    expect(webcamJs).toContain("|| 360");
  });

  test("registers the unified viewer as a protected client page", async () => {
    const routes = await readFile(new URL("./server/routes/page-routes.ts", import.meta.url), "utf8");
    expect(routes).toContain('{ path: "/viewer",        file: "viewer.html" }');
  });

  test("uses capability-driven desktop profiles with safe defaults", async () => {
    const html = await publicFile("remotedesktop.html");
    const js = await publicFile("assets/remotedesktop.js");
    expect(html).toContain('<option value="720:30" selected>30 FPS - 720p</option>');
    expect(html).toContain('<option value="1080:60">60 FPS - 1080p</option>');
    expect(html).toContain('id="streamProfileDetail"');
    expect(js).toContain('sendCmd("desktop_encoder_capabilities"');
    expect(js).toContain('streamProfileSelect?.value || "720:30"');
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
