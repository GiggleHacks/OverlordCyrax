import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const publicFile = (name: string) => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");

describe("unified viewer UI", () => {
  test("provides webcam, desktop, and split modes", async () => {
    const html = await publicFile("viewer.html");
    expect(html).toContain('data-mode="webcam"');
    expect(html).toContain('data-mode="desktop"');
    expect(html).toContain('data-mode="split"');
    expect(html).toContain('id="viewerClientId"');
  });

  test("registers the unified viewer as a protected client page", async () => {
    const routes = await readFile(new URL("./server/routes/page-routes.ts", import.meta.url), "utf8");
    expect(routes).toContain('{ path: "/viewer",        file: "viewer.html" }');
  });

  test("uses simplified desktop defaults", async () => {
    const html = await publicFile("remotedesktop.html");
    expect(html).toContain('<option value="360">360p</option>');
    expect(html).toContain('<option value="720" selected>720p</option>');
    expect(html).toContain('<option value="30" selected>30 fps</option>');
    expect(html).not.toContain('<option value="120"');
  });

  test("uses resolution presets instead of webcam quality percentage", async () => {
    const html = await publicFile("webcam.html");
    expect(html).toContain('id="resolutionSelect"');
    expect(html).not.toContain('id="qualitySlider"');
  });
});

describe("retro login", () => {
  test("renders boot console framing and a tiny runtime version", async () => {
    const html = await publicFile("login.html");
    expect(html).toContain('class="login-boot-log"');
    expect(html).toContain('id="login-version"');
    expect(html).toContain("AUTHENTICATION TERMINAL");
  });
});
