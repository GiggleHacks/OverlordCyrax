import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const publicFile = (name: string) => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");

describe("unified viewer UI", () => {
  test("provides webcam, desktop, split, and pip modes", async () => {
    const html = await publicFile("viewer.html");
    expect(html).toContain('data-mode="webcam"');
    expect(html).toContain('data-mode="desktop"');
    expect(html).toContain('data-mode="split"');
    expect(html).toContain('data-mode="pip"');
    expect(html).toContain('id="viewerClientId"');
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
    const desktopIdx = html.indexOf('id="viewerDesktopPanel"');
    const pipIdx = html.indexOf('id="viewerPipOverlay"');
    const webcamPanelIdx = html.indexOf('id="viewerWebcamPanel"');
    expect(desktopIdx).toBeGreaterThan(-1);
    expect(pipIdx).toBeGreaterThan(desktopIdx);
    expect(webcamPanelIdx).toBeGreaterThan(-1);
    expect(pipIdx).toBeGreaterThan(webcamPanelIdx);
  });

  test("ships shared pip overlay controller", async () => {
    const js = await publicFile("assets/pip-overlay.js");
    expect(js).toContain("export function initPipOverlay");
    expect(js).toContain("pointerdown");
    expect(js).toContain("overlord_pip_layout_v1");
    const viewerJs = await publicFile("assets/viewer.js");
    expect(viewerJs).toContain('from "./pip-overlay.js"');
    expect(viewerJs).toContain("webcamUrlBar");
    expect(viewerJs).toContain("embedded=1");
    expect(viewerJs).toContain('action: "start"');
  });

  test("exposes parent webcam Start/Stop/Settings bar for split and pip", async () => {
    const html = await publicFile("viewer.html");
    expect(html).toContain('id="viewerWebcamBar"');
    expect(html).toContain('id="viewerCamStart"');
    expect(html).toContain('id="viewerCamStop"');
    expect(html).toContain('id="viewerCamSettingsBtn"');
    expect(html).toContain('id="viewerCamSettingsMenu"');
    const viewerJs = await publicFile("assets/viewer.js");
    expect(viewerJs).toContain("viewer-has-webcam-bar");
    expect(viewerJs).toContain("webcam_cmd");
    expect(viewerJs).toContain('mode === "split" || mode === "pip"');
    const webcamJs = await publicFile("assets/webcam.js");
    expect(webcamJs).toContain('data.type !== "webcam_cmd"');
    expect(webcamJs).toContain('action === "start"');
    expect(webcamJs).toContain("postStatusToParent");
  });

  test("registers the unified viewer as a protected client page", async () => {
    const routes = await readFile(new URL("./server/routes/page-routes.ts", import.meta.url), "utf8");
    expect(routes).toContain('{ path: "/viewer",        file: "viewer.html" }');
  });

  test("uses capability-driven desktop profiles with safe defaults", async () => {
    const html = await publicFile("remotedesktop.html");
    const js = await publicFile("assets/remotedesktop.js");
    expect(html).toContain('<option value="720:30">30 FPS - 720p</option>');
    expect(html).toContain('<option value="1080:60" selected>60 FPS - 1080p</option>');
    expect(html).toContain('id="streamProfileDetail"');
    expect(js).toContain('sendCmd("desktop_encoder_capabilities"');
    expect(js).toContain('streamProfileSelect?.value || "1080:60"');
  });

  test("uses resolution presets instead of webcam quality percentage", async () => {
    const html = await publicFile("webcam.html");
    expect(html).toContain('id="resolutionSelect"');
    expect(html).not.toContain('id="qualitySlider"');
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
