import { describe, expect, test } from "bun:test";
import type { ClientInfo } from "./types";
import { decodeMessage } from "./protocol";
import { metrics } from "./metrics";
import { handleFrame, handlePing, handlePong, sendPingRequest, shouldRelayFrameToViewers } from "./wsHandlers";

type MockWs = { sent: Uint8Array[]; send: (msg: Uint8Array) => void };

describe("wsHandlers ping/pong", () => {
  test("sendPingRequest sends a ping once per outstanding nonce", () => {
    const ws: MockWs = {
      sent: [],
      send(msg) {
        this.sent.push(msg);
      },
    };
    const info = {
      id: "client-1",
      role: "client",
      ws,
      lastSeen: Date.now(),
    } as any;

    sendPingRequest(info, ws, "test");
    expect(ws.sent.length).toBe(1);
    const payload = decodeMessage(ws.sent[0]) as any;
    expect(payload.type).toBe("ping");
    expect(typeof payload.ts).toBe("number");

    sendPingRequest(info, ws, "test");
    expect(ws.sent.length).toBe(1);
  });

  test("sendPingRequest can bypass the interval for manual pings", () => {
    const ws: MockWs = {
      sent: [],
      send(msg) {
        this.sent.push(msg);
      },
    };
    const info = {
      id: "client-manual-ping",
      role: "client",
      ws,
      lastSeen: Date.now(),
    } as any;

    expect(sendPingRequest(info, ws, "test")).toBe(true);
    expect(sendPingRequest(info, ws, "manual", 0)).toBe(true);
    expect(ws.sent.length).toBe(2);
  });

  test("handlePing responds with pong without starting another server ping", () => {
    const ws: MockWs = {
      sent: [],
      send(msg) {
        this.sent.push(msg);
      },
    };
    const info = {
      id: "client-ping",
      role: "client",
      ws,
      lastSeen: Date.now(),
    } as any;

    handlePing(info, { type: "ping", ts: 9876 } as any, ws);

    expect(ws.sent.length).toBe(1);
    const payload = decodeMessage(ws.sent[0]) as any;
    expect(payload.type).toBe("pong");
    expect(payload.ts).toBe(9876);
    expect(info.lastPingNonce).toBeUndefined();
  });

  test("handlePing preserves zero timestamps", () => {
    const ws: MockWs = {
      sent: [],
      send(msg) {
        this.sent.push(msg);
      },
    };
    const info = {
      id: "client-zero-ping",
      role: "client",
      ws,
      lastSeen: Date.now(),
    } as any;

    handlePing(info, { type: "ping", ts: 0 } as any, ws);

    const payload = decodeMessage(ws.sent[0]) as any;
    expect(payload.type).toBe("pong");
    expect(payload.ts).toBe(0);
  });

  test("handlePing falls back for invalid timestamps", () => {
    const ws: MockWs = {
      sent: [],
      send(msg) {
        this.sent.push(msg);
      },
    };
    const info = {
      id: "client-invalid-ping",
      role: "client",
      ws,
      lastSeen: Date.now(),
    } as any;
    const before = Date.now();

    handlePing(info, { type: "ping", ts: "bad" } as any, ws);

    const payload = decodeMessage(ws.sent[0]) as any;
    expect(payload.type).toBe("pong");
    expect(payload.ts).toBeGreaterThanOrEqual(before);
    expect(payload.ts).toBeLessThanOrEqual(Date.now());
  });

  test("handlePong clears nonce and records ping", () => {
    metrics.reset();
    const ws: MockWs = {
      sent: [],
      send(msg) {
        this.sent.push(msg);
      },
    };
    const now = Date.now();
    const info = {
      id: "client-2",
      role: "client",
      ws,
      lastSeen: now,
      lastPingSent: now - 10,
      lastPingNonce: 1234,
    } as any;

    handlePong(info, { type: "pong", ts: 1234 } as any);
    expect(info.lastPingNonce).toBeUndefined();
    expect(typeof info.pingMs).toBe("number");
    const snapshot = metrics.getSnapshot();
    expect(snapshot.ping.count).toBeGreaterThan(0);
  });

  test("handlePong ignores mismatched nonces", () => {
    const now = Date.now();
    const info = {
      id: "client-3",
      role: "client",
      ws: { sent: [], send() {} },
      lastSeen: now,
      lastPingSent: now - 10,
      lastPingNonce: 2222,
      pendingPings: new Map([[2222, now - 10]]),
    } as any;

    handlePong(info, { type: "pong", ts: 3333 } as any);
    expect(info.lastPingNonce).toBe(2222);
    expect(info.pendingPings.has(2222)).toBe(true);
  });

  test("handlePong matches multi-inflight nonces and smooths rtt", () => {
    metrics.reset();
    const now = Date.now();
    const info = {
      id: "client-3b",
      role: "client",
      ws: { sent: [], send() {} },
      lastSeen: now,
      lastPingSent: now - 5,
      lastPingNonce: 9002,
      pendingPings: new Map([
        [9001, now - 40],
        [9002, now - 5],
      ]),
    } as any;

    handlePong(info, { type: "pong", ts: 9001 } as any);
    expect(info.pendingPings.has(9001)).toBe(false);
    expect(info.pendingPings.has(9002)).toBe(true);
    expect(info.pingMs).toBeGreaterThanOrEqual(0);
    expect(info.pingMs).toBeLessThan(1000);
  });

  test("handlePong clears matching nonce even when pong is late", () => {
    metrics.reset();
    const now = Date.now();
    const info = {
      id: "client-4",
      role: "client",
      ws: { sent: [], send() {} },
      lastSeen: now - 60_000,
      online: false,
      lastPingSent: now - 20_000,
      lastPingNonce: 4444,
    } as any;

    handlePong(info, { type: "pong", ts: 4444 } as any);

    expect(info.lastPingNonce).toBeUndefined();
    expect(info.online).toBe(true);
    expect(info.lastSeen).toBeGreaterThan(now - 5_000);
    const snapshot = metrics.getSnapshot();
    expect(snapshot.ping.count).toBe(0);
  });
});

describe("wsHandlers frame routing", () => {
  test("keeps screenshot frames out of remote desktop viewers", () => {
    const broadcasts: unknown[] = [];
    const runtime = globalThis as unknown as {
      __rdBroadcast?: (clientId: string, bytes: Uint8Array, header: unknown) => boolean;
    };
    runtime.__rdBroadcast = (clientId, bytes, header) => {
      broadcasts.push({ clientId, bytes, header });
      return true;
    };
    const client = {
      id: "screenshot-client",
      lastSeen: Date.now(),
      online: true,
      isAdmin: false,
    } as unknown as ClientInfo;
    const screenshotFrame = {
      type: "frame",
      header: { fps: 0, format: "h264", width: 1920, height: 1080 },
      data: new Uint8Array([1, 2, 3]),
    };

    try {
      expect(shouldRelayFrameToViewers(screenshotFrame)).toBe(false);
      handleFrame(client, screenshotFrame, shouldRelayFrameToViewers(screenshotFrame));
      expect(broadcasts).toHaveLength(0);

      const liveFrame = { ...screenshotFrame, header: { ...screenshotFrame.header, fps: 60 } };
      expect(shouldRelayFrameToViewers(liveFrame)).toBe(true);
      handleFrame(client, liveFrame, shouldRelayFrameToViewers(liveFrame));
      expect(broadcasts).toHaveLength(1);
    } finally {
      delete runtime.__rdBroadcast;
    }
  });

  test("live jpeg frame_ack follows viewer relay result (not safeFormat alone)", () => {
    const runtime = globalThis as unknown as {
      __rdBroadcast?: (clientId: string, bytes: Uint8Array, header: unknown) => boolean;
    };
    let relayOk = false;
    runtime.__rdBroadcast = () => relayOk;
    const client = {
      id: "jpeg-flow",
      lastSeen: Date.now() - 60_000,
      online: true,
      isAdmin: false,
    } as unknown as ClientInfo;
    const liveJpeg = {
      type: "frame",
      header: { fps: 15, format: "jpeg", width: 1280, height: 720 },
      data: new Uint8Array([1, 2, 3]),
    };
    try {
      expect(shouldRelayFrameToViewers(liveJpeg)).toBe(true);
      expect(handleFrame(client, liveJpeg, true)).toBe(false);

      relayOk = true;
      expect(handleFrame(client, liveJpeg, true)).toBe(true);

      // Screenshots still succeed without relay so callers can ack storage paths.
      const screenshot = {
        type: "frame",
        header: { fps: 0, format: "jpeg", width: 1280, height: 720 },
        data: new Uint8Array([9, 9, 9]),
      };
      expect(shouldRelayFrameToViewers(screenshot)).toBe(false);
      expect(handleFrame(client, screenshot, false)).toBe(true);
    } finally {
      delete runtime.__rdBroadcast;
    }
  });

  test("relays webcam and backstage frames even when fps is 0 (legacy agents)", () => {
    const webcamBroadcasts: unknown[] = [];
    const backstageBroadcasts: unknown[] = [];
    const runtime = globalThis as unknown as {
      __webcamBroadcast?: (clientId: string, bytes: Uint8Array, header: unknown) => boolean;
      __backstageBroadcast?: (clientId: string, bytes: Uint8Array, header: unknown) => boolean;
    };
    runtime.__webcamBroadcast = (clientId, bytes, header) => {
      webcamBroadcasts.push({ clientId, bytes, header });
      return true;
    };
    runtime.__backstageBroadcast = (clientId, bytes, header) => {
      backstageBroadcasts.push({ clientId, bytes, header });
      return true;
    };
    const client = {
      id: "legacy-agent",
      lastSeen: Date.now(),
      online: true,
      isAdmin: false,
    } as unknown as ClientInfo;

    try {
      const webcamFrame = {
        type: "frame",
        header: { fps: 0, format: "jpeg", webcam: true },
        data: new Uint8Array([1, 2, 3]),
      };
      expect(shouldRelayFrameToViewers(webcamFrame)).toBe(true);
      handleFrame(client, webcamFrame, shouldRelayFrameToViewers(webcamFrame));
      expect(webcamBroadcasts).toHaveLength(1);

      const backstageFrame = {
        type: "frame",
        header: { fps: 0, format: "jpeg", backstage: true },
        data: new Uint8Array([1, 2, 3]),
      };
      expect(shouldRelayFrameToViewers(backstageFrame)).toBe(true);
      handleFrame(client, backstageFrame, shouldRelayFrameToViewers(backstageFrame));
      expect(backstageBroadcasts).toHaveLength(1);

      // Webcam frames with no fps field at all must also relay.
      const noFpsWebcamFrame = {
        type: "frame",
        header: { format: "jpeg", webcam: true },
        data: new Uint8Array([1, 2, 3]),
      };
      expect(shouldRelayFrameToViewers(noFpsWebcamFrame)).toBe(true);
    } finally {
      delete runtime.__webcamBroadcast;
      delete runtime.__backstageBroadcast;
    }
  });
});
