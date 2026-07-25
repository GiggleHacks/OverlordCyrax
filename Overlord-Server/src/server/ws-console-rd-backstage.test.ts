import { afterEach, describe, expect, test } from "bun:test";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import * as clientManager from "../clientManager";
import { decodeMessage } from "../protocol";
import * as sessionManager from "../sessions/sessionManager";
import type { SocketData } from "../sessions/types";
import type { ClientInfo } from "../types";
import {
  handlebackstageViewerMessage,
  handlebackstageViewerOpen,
  handleRemoteDesktopViewerMessage,
  handleRemoteDesktopViewerOpen,
  handleWebcamViewerMessage,
  handleWebcamViewerOpen,
  notifyRemoteDesktopStatus,
  webcamStreamingState,
  backstageStreamingState,
  rdStreamingState,
  shouldRequestDesktopKeyframe,
  handleDesktopStreamStats,
  handleDesktopCursor,
  handleDesktopEncoderCapabilities,
  requestRemoteDesktopKeyframeAfterScreenshot,
} from "./ws-console-rd-backstage";

type MockWs = {
  data: SocketData;
  sent: unknown[];
  closedCode?: number;
  closedReason?: string;
  send: (msg: unknown) => void;
  close: (code: number, reason: string) => void;
  getBufferedAmount: () => number;
};

const clientIdsToCleanup = new Set<string>();

function createMockWs(data: Partial<SocketData>): MockWs {
  return {
    data: {
      role: "rd_viewer",
      clientId: "rd-test-client",
      ...data,
    } as SocketData,
    sent: [],
    send(msg: unknown) {
      this.sent.push(msg);
    },
    close(code: number, reason: string) {
      this.closedCode = code;
      this.closedReason = reason;
    },
    getBufferedAmount() {
      return 0;
    },
  };
}

function createClient(id: string) {
  const agentWs = createMockWs({ role: "client", clientId: id });
  const info: ClientInfo = {
    id,
    role: "client",
    ws: agentWs,
    lastSeen: Date.now(),
    online: true,
    host: "rd-test-host",
    os: "windows",
    user: "tester",
    monitors: 1,
  };
  clientManager.addClient(id, info);
  clientIdsToCleanup.add(id);
  return { info, agentWs };
}

function agentCommands(ws: MockWs) {
  return ws.sent.map((msg) => decodeMessage(msg as Uint8Array) as any);
}

afterEach(() => {
  for (const clientId of clientIdsToCleanup) {
    for (const session of sessionManager.getRdSessionsForClient(clientId)) {
      sessionManager.deleteRdSession(session.id);
    }
    for (const session of sessionManager.getWebcamSessionsForClient(clientId)) {
      sessionManager.deleteWebcamSession(session.id);
    }
    for (const session of sessionManager.getbackstageSessionsForClient(clientId)) {
      sessionManager.deletebackstageSession(session.id);
    }
    rdStreamingState.delete(clientId);
    webcamStreamingState.delete(clientId);
    backstageStreamingState.delete(clientId);
    clientManager.deleteClient(clientId);
  }
  clientIdsToCleanup.clear();
});

describe("webcam viewer control", () => {
  test("reasserts webcam_start when server stream state has never produced a frame", () => {
    const clientId = `webcam-stale-${Date.now().toString(36)}`;
    const { agentWs } = createClient(clientId);
    const viewer = createMockWs({ role: "webcam_viewer", clientId });
    webcamStreamingState.set(clientId, {
      isStreaming: true,
      deviceIndex: 0,
      fps: 30,
      useMax: false,
      quality: 90,
      codec: "jpeg",
      maxHeight: 720,
      startedAt: Date.now() - 5000,
      lastFrameAt: 0,
    } as any);

    handleWebcamViewerOpen(viewer as any);
    handleWebcamViewerMessage(viewer as any, JSON.stringify({ type: "webcam_start" }));

    const commands = agentCommands(agentWs);
    expect(commands.filter((msg) => msg.commandType === "webcam_start")).toHaveLength(1);
    expect(webcamStreamingState.get(clientId)?.startedAt).toBeGreaterThan(0);
  });
});

describe("remote desktop viewer control", () => {
  test("rate-limits repeated desktop keyframe requests per client", () => {
    const clientId = `rd-keyframe-gate-${Date.now().toString(36)}`;
    const now = Date.now();
    expect(shouldRequestDesktopKeyframe(clientId, now)).toBe(true);
    expect(shouldRequestDesktopKeyframe(clientId, now + 100)).toBe(false);
    expect(shouldRequestDesktopKeyframe(clientId, now + 1100)).toBe(true);
  });

  test("forwards one decoder-backpressure keyframe request per interval", () => {
    const clientId = `rd-keyframe-forward-${Date.now().toString(36)}`;
    const { agentWs } = createClient(clientId);
    const viewer = createMockWs({ clientId });
    handleRemoteDesktopViewerOpen(viewer as any);

    const request = JSON.stringify({
      type: "desktop_request_keyframe",
      reason: "decoder_backpressure",
    });
    handleRemoteDesktopViewerMessage(viewer as any, request);
    handleRemoteDesktopViewerMessage(viewer as any, request);

    const commands = agentCommands(agentWs)
      .filter((msg) => msg.commandType === "desktop_request_keyframe");
    expect(commands).toHaveLength(1);
    expect(commands[0]?.payload?.reason).toBe("decoder_backpressure");
  });

  test("starts once, ignores duplicate starts, and only stops after the last viewer leaves", () => {
    const clientId = `rd-control-${Date.now().toString(36)}`;
    const { agentWs } = createClient(clientId);
    const firstViewer = createMockWs({ clientId });
    const secondViewer = createMockWs({ clientId });

    handleRemoteDesktopViewerOpen(firstViewer as any);
    handleRemoteDesktopViewerOpen(secondViewer as any);

    handleRemoteDesktopViewerMessage(firstViewer as any, JSON.stringify({ type: "desktop_start" }));
    handleRemoteDesktopViewerMessage(secondViewer as any, JSON.stringify({ type: "desktop_start" }));

    let commands = agentCommands(agentWs);
    expect(commands.filter((msg) => msg.commandType === "desktop_start")).toHaveLength(1);
    expect(commands.find((msg) => msg.commandType === "desktop_set_fps")?.payload?.fps).toBe(120);
    expect(rdStreamingState.get(clientId)?.isStreaming).toBe(true);

    handleRemoteDesktopViewerMessage(firstViewer as any, JSON.stringify({ type: "desktop_stop" }));

    commands = agentCommands(agentWs);
    expect(commands.filter((msg) => msg.commandType === "desktop_stop")).toHaveLength(0);
    expect(rdStreamingState.get(clientId)?.isStreaming).toBe(true);

    sessionManager.deleteRdSession(firstViewer.data.sessionId!);
    handleRemoteDesktopViewerMessage(secondViewer as any, JSON.stringify({ type: "desktop_stop" }));

    commands = agentCommands(agentWs);
    expect(commands.filter((msg) => msg.commandType === "desktop_stop")).toHaveLength(1);
    expect(commands.filter((msg) => msg.commandType === "webrtc_stop")).toHaveLength(1);
    expect(rdStreamingState.get(clientId)?.isStreaming).toBe(false);
  });

  test("forwards keyframe requests only while the desktop stream is active", () => {
    const clientId = `rd-keyframe-${Date.now().toString(36)}`;
    const { agentWs } = createClient(clientId);
    const viewer = createMockWs({ clientId });
    const viewerSocket = viewer as unknown as Parameters<typeof handleRemoteDesktopViewerMessage>[0];

    handleRemoteDesktopViewerOpen(viewerSocket);
    handleRemoteDesktopViewerMessage(viewerSocket, JSON.stringify({
      type: "desktop_request_keyframe",
      reason: "manual_viewer",
    }));

    expect(agentCommands(agentWs).filter((msg) => msg.commandType === "desktop_request_keyframe")).toHaveLength(0);

    handleRemoteDesktopViewerMessage(viewerSocket, JSON.stringify({ type: "desktop_start" }));
    handleRemoteDesktopViewerMessage(viewerSocket, JSON.stringify({
      type: "desktop_request_keyframe",
      reason: "manual_viewer",
    }));

    const keyframeCommands = agentCommands(agentWs)
      .filter((msg) => msg.commandType === "desktop_request_keyframe");
    expect(keyframeCommands).toHaveLength(1);
    expect(keyframeCommands[0]?.payload).toEqual({ reason: "manual_viewer" });

    handleRemoteDesktopViewerMessage(viewerSocket, JSON.stringify({
      type: "desktop_request_keyframe",
      reason: "viewer_frame_gap",
    }));
    const automaticCommand = agentCommands(agentWs)
      .filter((msg) => msg.commandType === "desktop_request_keyframe")
      .at(-1);
    expect(automaticCommand?.payload).toEqual({ reason: "viewer_frame_gap" });
  });

  test("requests HEVC recovery after a screenshot only while streaming", () => {
    const clientId = `rd-screenshot-keyframe-${Date.now().toString(36)}`;
    const { agentWs } = createClient(clientId);
    const viewer = createMockWs({ clientId });
    const viewerSocket = viewer as unknown as Parameters<typeof handleRemoteDesktopViewerMessage>[0];

    handleRemoteDesktopViewerOpen(viewerSocket);
    expect(requestRemoteDesktopKeyframeAfterScreenshot(clientId)).toBe(false);

    handleRemoteDesktopViewerMessage(viewerSocket, JSON.stringify({ type: "desktop_start" }));
    const state = rdStreamingState.get(clientId);
    expect(state).toBeDefined();
    if (!state) return;
    state.codec = "hevc";
    agentWs.sent.length = 0;

    expect(requestRemoteDesktopKeyframeAfterScreenshot(clientId)).toBe(true);
    expect(agentCommands(agentWs)
      .filter((msg) => msg.commandType === "desktop_request_keyframe"))
      .toEqual([
        expect.objectContaining({
          payload: { reason: "post_screenshot_hevc_recovery" },
        }),
      ]);

    state.codec = "h264";
    agentWs.sent.length = 0;
    expect(requestRemoteDesktopKeyframeAfterScreenshot(clientId)).toBe(false);
    expect(agentWs.sent).toHaveLength(0);
  });

  test("does not forward desktop_start when a macOS client is missing required permissions", () => {
    const clientId = `rd-mac-perms-${Date.now().toString(36)}`;
    const { info, agentWs } = createClient(clientId);
    info.os = "darwin";
    info.permissions = { screenRecording: false, accessibility: true };
    const viewer = createMockWs({ clientId });

    handleRemoteDesktopViewerOpen(viewer as any);
    handleRemoteDesktopViewerMessage(viewer as any, JSON.stringify({ type: "desktop_start" }));

    expect(agentCommands(agentWs).filter((msg) => msg.commandType === "desktop_start")).toHaveLength(0);
    expect(rdStreamingState.get(clientId)?.isStreaming).not.toBe(true);
    expect(viewer.sent.length).toBeGreaterThan(0);
  });

  test("reasserts desktop_start when server stream state is stale", () => {
    const clientId = `rd-stale-${Date.now().toString(36)}`;
    const { agentWs } = createClient(clientId);
    const viewer = createMockWs({ clientId });
    rdStreamingState.set(clientId, {
      isStreaming: true,
      display: 0,
      quality: 90,
      codec: "h264",
      softwareH264: false,
      duplication: true,
      maxHeight: 1080,
      maxFps: 120,
      bitrateMbps: 0,
      bitrateAdaptive: false,
      lastFps: 1,
      lastFrameAt: 0,
      startedAt: Date.now() - 5000,
    });

    handleRemoteDesktopViewerOpen(viewer as any);
    handleRemoteDesktopViewerMessage(viewer as any, JSON.stringify({ type: "desktop_start" }));

    const commands = agentCommands(agentWs);
    expect(commands.filter((msg) => msg.commandType === "desktop_start")).toHaveLength(1);
    expect(commands.filter((msg) => msg.commandType === "desktop_request_keyframe")).toHaveLength(0);
    expect(rdStreamingState.get(clientId)?.isStreaming).toBe(true);
  });

  test("forwards and clamps the desktop bitrate setting", () => {
    const clientId = `rd-bitrate-${Date.now().toString(36)}`;
    const { agentWs } = createClient(clientId);
    const viewer = createMockWs({ clientId });

    handleRemoteDesktopViewerOpen(viewer as any);
    handleRemoteDesktopViewerMessage(viewer as any, JSON.stringify({
      type: "desktop_set_bitrate",
      bitrateMbps: 75,
    }));

    const command = agentCommands(agentWs).find((msg) => msg.commandType === "desktop_set_bitrate");
    expect(command?.payload?.bitrateMbps).toBe(50);
    expect(rdStreamingState.get(clientId)?.bitrateMbps).toBe(50);
  });

  test("forwards adaptive bitrate mode to the agent", () => {
    const clientId = `rd-adaptive-bitrate-${Date.now().toString(36)}`;
    const { agentWs } = createClient(clientId);
    const viewer = createMockWs({ clientId });

    handleRemoteDesktopViewerOpen(viewer as any);
    handleRemoteDesktopViewerMessage(viewer as any, JSON.stringify({
      type: "desktop_set_bitrate",
      bitrateMbps: 18,
      adaptive: true,
    }));

    const command = agentCommands(agentWs).find((msg) => msg.commandType === "desktop_set_bitrate");
    expect(command?.payload).toMatchObject({ bitrateMbps: 18, adaptive: true });
    expect(rdStreamingState.get(clientId)?.bitrateAdaptive).toBe(true);
  });

  test("forwards agent pipeline telemetry to every remote desktop viewer", () => {
    const clientId = `rd-stats-${Date.now().toString(36)}`;
    createClient(clientId);
    const viewer = createMockWs({ clientId });
    handleRemoteDesktopViewerOpen(viewer as any);

    handleDesktopStreamStats(clientId, {
      type: "desktop_stream_stats",
      fps: 60,
      format: "h264",
      captureMs: 2.25,
      encodeMs: 4.5,
      sendMs: 0.4,
      totalMs: 7.3,
      transport: "webrtc",
    });

    const message = decodeMessage(viewer.sent.at(-1) as Uint8Array) as any;
    expect(message.type).toBe("desktop_stream_stats");
    expect(message.captureMs).toBe(2.25);
    expect(message.encodeMs).toBe(4.5);
    expect(message.transport).toBe("webrtc");
  });

  test("forwards cursor metadata without modifying video frames", () => {
    const clientId = `rd-cursor-${Date.now().toString(36)}`;
    createClient(clientId);
    const viewer = createMockWs({ clientId });
    handleRemoteDesktopViewerOpen(viewer as unknown as Parameters<typeof handleRemoteDesktopViewerOpen>[0]);

    handleDesktopCursor(clientId, {
      type: "desktop_cursor",
      x: 640,
      y: 360,
      width: 1280,
      height: 720,
      visible: true,
      cursorWidth: 32,
      cursorHeight: 32,
      hotspotX: 3,
      hotspotY: 4,
      image: new Uint8Array([137, 80, 78, 71]),
    });

    expect(decodeMessage(viewer.sent.at(-1) as Uint8Array)).toEqual({
      type: "desktop_cursor",
      x: 640,
      y: 360,
      width: 1280,
      height: 720,
      visible: true,
      cursorWidth: 32,
      cursorHeight: 32,
      hotspotX: 3,
      hotspotY: 4,
      image: new Uint8Array([137, 80, 78, 71]),
    });
  });

  test("selects one mutually compatible codec across all viewer transports", () => {
    const clientId = `rd-codecs-${Date.now().toString(36)}`;
    createClient(clientId);
    const canvasViewer = createMockWs({ clientId });
    const webrtcViewer = createMockWs({ clientId });
    handleRemoteDesktopViewerOpen(canvasViewer as any);
    handleRemoteDesktopViewerOpen(webrtcViewer as any);

    canvasViewer.data.rdDecoderCodecs = ["hevc", "h264", "jpeg"];
    canvasViewer.data.rdPreferredCodecs = ["hevc", "h264", "jpeg"];
    canvasViewer.data.rdCodecTransport = "websocket";
    webrtcViewer.data.rdDecoderCodecs = ["hevc", "h264"];
    webrtcViewer.data.rdPreferredCodecs = ["hevc", "h264"];
    webrtcViewer.data.rdCodecTransport = "webrtc";

    handleDesktopEncoderCapabilities(clientId, {
      type: "desktop_encoder_capabilities",
      profiles: [],
      codecs: [
        { codec: "hevc", transports: ["websocket"] },
        { codec: "h264", transports: ["websocket", "webrtc"] },
        { codec: "jpeg", transports: ["websocket"] },
      ],
    });

    const canvasMessage = decodeMessage(canvasViewer.sent.at(-1) as Uint8Array) as any;
    const webrtcMessage = decodeMessage(webrtcViewer.sent.at(-1) as Uint8Array) as any;
    expect(canvasMessage.selectedCodec).toBe("h264");
    expect(canvasMessage.fallbackCodecs).toEqual(["h264"]);
    expect(webrtcMessage.selectedCodec).toBe("h264");
    expect(webrtcMessage.fallbackCodecs).toEqual(["h264"]);
  });

  test("holds Canvas acknowledgements only while the browser decoder is under pressure", () => {
    const clientId = `rd-flow-${Date.now().toString(36)}`;
    const { agentWs } = createClient(clientId);
    const viewer = createMockWs({ clientId });
    handleRemoteDesktopViewerOpen(viewer as any);
    handleRemoteDesktopViewerMessage(viewer as any, JSON.stringify({
      type: "desktop_start",
      canvasFlowControl: true,
    }));

    const healthyAck = (globalThis as any).__rdBroadcast(
      clientId,
      new Uint8Array([1, 2, 3]),
      { format: "h264", fps: 60, width: 2560, height: 1440 },
    );
    expect(healthyAck).toBe(true);
    const frame = viewer.sent.at(-1) as Uint8Array;
    expect(frame[3]).toBe(2);
    expect(frame.byteLength).toBe(15);

    handleRemoteDesktopViewerMessage(viewer as any, JSON.stringify({ type: "desktop_decode_pressure", active: true }));
    const pressuredAck = (globalThis as any).__rdBroadcast(
      clientId,
      new Uint8Array([4, 5, 6]),
      { format: "h264", fps: 60, width: 2560, height: 1440 },
    );
    expect(pressuredAck).toBe(false);

    handleRemoteDesktopViewerMessage(viewer as any, JSON.stringify({ type: "desktop_decode_pressure", active: false }));
    expect(agentCommands(agentWs).filter((msg) => msg.type === "frame_ack")).toHaveLength(1);
  });
});

describe("viewer status fanout", () => {
  test("notifies rd, webcam, and backstage viewers on client offline", () => {
    const clientId = `status-fanout-${Date.now().toString(36)}`;
    createClient(clientId);
    const rdViewer = createMockWs({ role: "rd_viewer", clientId });
    const camViewer = createMockWs({ role: "webcam_viewer", clientId });
    const bsViewer = createMockWs({ role: "backstage_viewer", clientId });
    handleRemoteDesktopViewerOpen(rdViewer as any);
    handleWebcamViewerOpen(camViewer as any);
    handlebackstageViewerOpen(bsViewer as any);

    rdViewer.sent.length = 0;
    camViewer.sent.length = 0;
    bsViewer.sent.length = 0;

    notifyRemoteDesktopStatus(clientId, "offline", "Client offline");

    const parseOffline = (viewer: MockWs) =>
      viewer.sent
        .map((msg) => {
          try {
            if (typeof msg === "string") return JSON.parse(msg);
            if (msg instanceof Uint8Array || ArrayBuffer.isView(msg)) {
              return msgpackDecode(msg as Uint8Array);
            }
            return msg;
          } catch {
            return null;
          }
        })
        .find((msg: any) => msg && msg.type === "status" && msg.status === "offline");

    for (const viewer of [rdViewer, camViewer, bsViewer]) {
      const offline = parseOffline(viewer) as any;
      expect(offline).toBeTruthy();
      expect(offline.reason).toBe("Client offline");
    }
  });
});

describe("backstage viewer control", () => {
  test("forwards backstage_stop even when server stream state is stale", () => {
    const clientId = `backstage-stale-stop-${Date.now().toString(36)}`;
    const { agentWs } = createClient(clientId);
    const viewer = createMockWs({ role: "backstage_viewer", clientId });

    handlebackstageViewerOpen(viewer as any);
    backstageStreamingState.set(clientId, {
      isStreaming: false,
      virtualMode: true,
      display: 0,
      quality: 90,
      codec: "",
      maxFps: 120,
      lastFps: 0,
    });

    handlebackstageViewerMessage(viewer as any, JSON.stringify({ type: "backstage_stop" }));

    const commands = agentCommands(agentWs);
    expect(commands.filter((msg) => msg.commandType === "backstage_stop")).toHaveLength(1);
    expect(commands.filter((msg) => msg.commandType === "webrtc_stop")).toHaveLength(1);
    expect(backstageStreamingState.get(clientId)?.isStreaming).toBe(false);
  });
});
