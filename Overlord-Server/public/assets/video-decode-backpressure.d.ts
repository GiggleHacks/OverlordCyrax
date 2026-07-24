export const VIDEO_DECODE_BACKPRESSURE_VERSION: "1.0.0";

export function isVideoDecoderBackpressured(
  decoder: { decodeQueueSize?: number } | null | undefined,
  maxQueuedFrames?: number,
): boolean;
