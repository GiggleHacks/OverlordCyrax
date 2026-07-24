export const VIDEO_DECODE_BACKPRESSURE_VERSION = "1.0.0";

export function isVideoDecoderBackpressured(decoder, maxQueuedFrames = 2) {
  if (!decoder) return false;
  const queued = Number(decoder.decodeQueueSize);
  return Number.isFinite(queued) && queued >= Math.max(1, maxQueuedFrames);
}
