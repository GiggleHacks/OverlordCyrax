import { describe, expect, test } from "bun:test";
import {
  clientSupportsRelativeUploadPull,
  clientSupportsRemoteExecute,
  clientSupportsUploadProgress,
  compareClientVersions,
  selectUploadPullUrl,
} from "./client-version";
import { buildAbsolutePullOrigin, buildPullEndpoints } from "./upload-pull-url";

describe("client version helpers", () => {
  test("compareClientVersions orders dotted triples", () => {
    expect(compareClientVersions("2.3.8", "2.3.7")).toBe(1);
    expect(compareClientVersions("2.3.8", "2.3.8")).toBe(0);
    expect(compareClientVersions("2.3.7", "2.3.8")).toBe(-1);
    expect(compareClientVersions("3.0.10", "2.9.99")).toBe(1);
  });

  test("relative upload pull support starts at 2.3.8", () => {
    expect(clientSupportsRelativeUploadPull("2.3.7")).toBe(false);
    expect(clientSupportsRelativeUploadPull("2.3.8")).toBe(true);
    expect(clientSupportsRelativeUploadPull("3.0.5")).toBe(true);
    expect(clientSupportsRelativeUploadPull(undefined)).toBe(false);
    expect(clientSupportsRelativeUploadPull("dev")).toBe(false);
  });

  test("upload progress support starts at 2.3.8", () => {
    expect(clientSupportsUploadProgress("2.3.7")).toBe(false);
    expect(clientSupportsUploadProgress("2.3.8")).toBe(true);
    expect(clientSupportsUploadProgress("3.0.10")).toBe(true);
    expect(clientSupportsUploadProgress(undefined)).toBe(false);
    expect(clientSupportsUploadProgress("dev")).toBe(false);
  });

  test("legacy clientSupportsRemoteExecute tracks upload progress floor", () => {
    expect(clientSupportsRemoteExecute("2.3.7")).toBe(false);
    expect(clientSupportsRemoteExecute("2.3.8")).toBe(true);
  });

  test("selectUploadPullUrl prefers relative for modern agents", () => {
    const path = "/api/file/upload/pull/id";
    const origin = "https://public.example/api/file/upload/pull/id";
    expect(selectUploadPullUrl({ clientVersion: "2.3.8", pullPath: path, pullOrigin: origin })).toBe(path);
    expect(selectUploadPullUrl({ clientVersion: "2.3.7", pullPath: path, pullOrigin: origin })).toBe(origin);
    expect(selectUploadPullUrl({ clientVersion: undefined, pullPath: path, pullOrigin: origin })).toBe(origin);
  });
});

describe("upload pull url builder", () => {
  test("prefers OVERLORD_EXTERNAL_URL origin", () => {
    const previous = process.env.OVERLORD_EXTERNAL_URL;
    process.env.OVERLORD_EXTERNAL_URL = "https://public.example:2725/ignored/path";
    try {
      const req = new Request("https://operator.local/api/file/upload/x", {
        headers: { Host: "operator.local" },
      });
      const built = buildAbsolutePullOrigin(req);
      expect(built.origin).toBe("https://public.example:2725");
      expect(built.source).toBe("external_config");
      const endpoints = buildPullEndpoints(req, "123e4567-e89b-42d3-a456-426614174000");
      expect(endpoints.path).toBe("/api/file/upload/pull/123e4567-e89b-42d3-a456-426614174000");
      expect(endpoints.originUrl).toBe(
        "https://public.example:2725/api/file/upload/pull/123e4567-e89b-42d3-a456-426614174000",
      );
    } finally {
      if (previous === undefined) delete process.env.OVERLORD_EXTERNAL_URL;
      else process.env.OVERLORD_EXTERNAL_URL = previous;
    }
  });

  test("falls back to forwarded host", () => {
    const previous = process.env.OVERLORD_EXTERNAL_URL;
    delete process.env.OVERLORD_EXTERNAL_URL;
    try {
      const req = new Request("http://127.0.0.1:5173/api/file/upload/x", {
        headers: {
          Host: "127.0.0.1:5173",
          "x-forwarded-host": "edge.example",
          "x-forwarded-proto": "https",
        },
      });
      const built = buildAbsolutePullOrigin(req);
      expect(built.origin).toBe("https://edge.example");
      expect(built.source).toBe("forwarded_host");
    } finally {
      if (previous === undefined) delete process.env.OVERLORD_EXTERNAL_URL;
      else process.env.OVERLORD_EXTERNAL_URL = previous;
    }
  });
});
