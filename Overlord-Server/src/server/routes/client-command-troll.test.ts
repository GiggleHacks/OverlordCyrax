import { describe, expect, test } from "bun:test";
import {
  buildCursorBigScript,
  buildMessageBoxScript,
  buildOpenUrlScript,
  normalizeCursorBig,
  normalizeMessageBox,
  normalizeOpenUrl,
  psSingleQuote,
} from "./client-command-routes";

describe("normalizeOpenUrl", () => {
  test("accepts https urls", () => {
    const result = normalizeOpenUrl("https://example.com/path?q=1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://example.com/path?q=1");
  });

  test("adds https when scheme is missing", () => {
    const result = normalizeOpenUrl("example.com");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://example.com/");
  });

  test("adds https for www hosts", () => {
    const result = normalizeOpenUrl("www.example.com");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://www.example.com/");
  });

  test("repairs http: and https: without slashes", () => {
    const httpResult = normalizeOpenUrl("http:example.com/path");
    expect(httpResult.ok).toBe(true);
    if (httpResult.ok) expect(httpResult.url).toBe("http://example.com/path");

    const httpsResult = normalizeOpenUrl("https:www.example.com");
    expect(httpsResult.ok).toBe(true);
    if (httpsResult.ok) expect(httpsResult.url).toBe("https://www.example.com/");
  });

  test("handles protocol-relative urls", () => {
    const result = normalizeOpenUrl("//example.com/x");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://example.com/x");
  });

  test("rejects non-http schemes", () => {
    expect(normalizeOpenUrl("ftp://example.com").ok).toBe(false);
    expect(normalizeOpenUrl("file:///etc/passwd").ok).toBe(false);
  });

  test("rejects empty url", () => {
    const result = normalizeOpenUrl("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("required");
  });
});

describe("normalizeMessageBox", () => {
  test("defaults title and icon", () => {
    const result = normalizeMessageBox({ text: "hello" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.title).toBe("Windows");
      expect(result.icon).toBe("info");
      expect(result.text).toBe("hello");
    }
  });

  test("maps alert to warning", () => {
    const result = normalizeMessageBox({ text: "careful", icon: "alert", title: "Heads up" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.icon).toBe("warning");
      expect(result.title).toBe("Heads up");
    }
  });

  test("rejects missing text", () => {
    const result = normalizeMessageBox({ title: "x" });
    expect(result.ok).toBe(false);
  });

  test("rejects invalid icon", () => {
    const result = normalizeMessageBox({ text: "x", icon: "skull" });
    expect(result.ok).toBe(false);
  });
});

describe("normalizeCursorBig", () => {
  test("defaults duration to 30 seconds", () => {
    const result = normalizeCursorBig({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.durationSec).toBe(30);
  });

  test("accepts duration within range", () => {
    const result = normalizeCursorBig({ durationSec: 60 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.durationSec).toBe(60);
  });

  test("rejects duration below minimum", () => {
    const result = normalizeCursorBig({ durationSec: 2 });
    expect(result.ok).toBe(false);
  });

  test("rejects duration above maximum", () => {
    const result = normalizeCursorBig({ durationSec: 999 });
    expect(result.ok).toBe(false);
  });

  test("buildCursorBigScript embeds duration and SPI_SETCURSORS", () => {
    const script = buildCursorBigScript(30);
    expect(script).toContain("$duration = 30");
    expect(script).toContain("CursorBaseSize");
    expect(script).toContain("0x57");
    expect(script).toContain("Start-Process");
  });

  test("buildOpenUrlScript uses Start-Process with escaped url", () => {
    const script = buildOpenUrlScript("https://example.com/a'b");
    expect(script).toContain("Start-Process");
    expect(script).toContain("https://example.com/a''b");
    expect(script).toContain("Write-Output 'opened'");
  });

  test("buildMessageBoxScript launches detached WinForms dialog", () => {
    const script = buildMessageBoxScript("Win'dows", "Hello", "warning");
    expect(script).toContain("System.Windows.Forms.MessageBox");
    expect(script).toContain("MessageBoxIcon]::Warning");
    expect(script).toContain("Win''dows");
    expect(script).toContain("Write-Output 'shown'");
    expect(script).toContain("Start-Process");
  });

  test("psSingleQuote doubles apostrophes", () => {
    expect(psSingleQuote("it's")).toBe("'it''s'");
  });
});
