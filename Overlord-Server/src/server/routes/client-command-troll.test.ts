import { describe, expect, test } from "bun:test";
import { normalizeMessageBox, normalizeOpenUrl } from "./client-command-routes";

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
