import { describe, expect, test } from "bun:test";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import {
  handleFileBrowserMessage,
  handleProcessMessage,
  trackProcessCommand,
} from "./ws-file-process-proxy-keylogger";
import * as sessionManager from "../sessions/sessionManager";

describe("file browser agent download routing", () => {
  test("only consumes pending HTTP downloads for the matching client", () => {
    let consumed = 0;
    const payload = { type: "file_download", commandId: "download-1", data: new Uint8Array([1]) };
    const deps = {
      pendingHttpDownloads: new Map([["download-1", { clientId: "client-a" }]]),
      consumeHttpDownloadPayload: () => { consumed += 1; },
    };

    handleFileBrowserMessage("client-b", payload, deps);
    expect(consumed).toBe(0);

    handleFileBrowserMessage("client-a", payload, deps);
    expect(consumed).toBe(1);
  });

  test("drops unsolicited download payloads", () => {
    let consumed = 0;
    handleFileBrowserMessage(
      "client-a",
      { type: "file_download", commandId: "unknown", data: new Uint8Array([1]) },
      {
        pendingHttpDownloads: new Map(),
        consumeHttpDownloadPayload: () => { consumed += 1; },
      },
    );
    expect(consumed).toBe(0);
  });
});

describe("process viewer kill result routing", () => {
  function makeSession(id: string, clientId: string) {
    const received: any[] = [];
    const viewer = {
      send(data: Uint8Array) {
        received.push(msgpackDecode(data));
      },
    } as any;
    const session = { id, clientId, viewer, createdAt: Date.now() };
    sessionManager.addProcessSession(session as any);
    return { session, received };
  }

  test("forwards command_result to the owning session enriched with pid and action", () => {
    const owner = makeSession("sess-owner", "client-a");
    const other = makeSession("sess-other", "client-a");
    try {
      trackProcessCommand("cmd-kill-1", "sess-owner", "client-a", "kill", 4242);
      handleProcessMessage("client-a", { type: "command_result", commandId: "cmd-kill-1", ok: false, message: "Access is denied." });

      expect(owner.received).toHaveLength(1);
      expect(owner.received[0].type).toBe("command_result");
      expect(owner.received[0].pid).toBe(4242);
      expect(owner.received[0].action).toBe("kill");
      expect(owner.received[0].ok).toBe(false);
      expect(owner.received[0].message).toBe("Access is denied.");
      expect(other.received).toHaveLength(0);

      // Pending entry consumed — a duplicate result is dropped.
      handleProcessMessage("client-a", { type: "command_result", commandId: "cmd-kill-1", ok: true, message: "" });
      expect(owner.received).toHaveLength(1);
    } finally {
      sessionManager.deleteProcessSession("sess-owner");
      sessionManager.deleteProcessSession("sess-other");
    }
  });

  test("ignores results for other clients and unknown commandIds", () => {
    const owner = makeSession("sess-cb", "client-a");
    try {
      trackProcessCommand("cmd-kill-2", "sess-cb", "client-a", "kill", 7);
      handleProcessMessage("client-b", { type: "command_result", commandId: "cmd-kill-2", ok: true, message: "" });
      expect(owner.received).toHaveLength(0);
      handleProcessMessage("client-a", { type: "command_result", commandId: "cmd-unknown", ok: true, message: "" });
      expect(owner.received).toHaveLength(0);
      // Still pending for client-a — real result now arrives and resolves.
      handleProcessMessage("client-a", { type: "command_result", commandId: "cmd-kill-2", ok: true, message: "" });
      expect(owner.received).toHaveLength(1);
      expect(owner.received[0].ok).toBe(true);
      expect(owner.received[0].pid).toBe(7);
    } finally {
      sessionManager.deleteProcessSession("sess-cb");
    }
  });

  test("broadcasts to client sessions when the owning session is gone", () => {
    const remaining = makeSession("sess-remain", "client-a");
    const gone = makeSession("sess-gone", "client-a");
    sessionManager.deleteProcessSession("sess-gone");
    try {
      trackProcessCommand("cmd-kill-3", "sess-gone", "client-a", "kill", 99);
      handleProcessMessage("client-a", { type: "command_result", commandId: "cmd-kill-3", ok: true, message: "" });
      expect(remaining.received).toHaveLength(1);
      expect(remaining.received[0].pid).toBe(99);
    } finally {
      sessionManager.deleteProcessSession("sess-remain");
    }
  });
});
