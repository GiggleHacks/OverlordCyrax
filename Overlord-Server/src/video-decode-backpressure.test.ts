import { describe, expect, test } from "bun:test";
import {
  VIDEO_DECODE_BACKPRESSURE_VERSION,
  isVideoDecoderBackpressured,
} from "../public/assets/video-decode-backpressure.js";

describe("video decoder backpressure", () => {
  test("has a visible version", () => {
    expect(VIDEO_DECODE_BACKPRESSURE_VERSION).toBe("1.0.0");
  });

  test("detects a full decode queue", () => {
    expect(isVideoDecoderBackpressured(null)).toBe(false);
    expect(isVideoDecoderBackpressured({ decodeQueueSize: 1 }, 2)).toBe(false);
    expect(isVideoDecoderBackpressured({ decodeQueueSize: 2 }, 2)).toBe(true);
    expect(isVideoDecoderBackpressured({ decodeQueueSize: 8 }, 2)).toBe(true);
  });
});
