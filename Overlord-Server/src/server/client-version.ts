/** Compare dotted semver-ish versions (major.minor.patch). Returns 1 / -1 / 0. */
export function compareClientVersions(left: string | undefined, right: string | undefined): number {
  const parse = (value: string | undefined): number[] | null => {
    const match = String(value || "")
      .trim()
      .match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

/**
 * Agents since 2.3.8 rewrite relative /api/file/upload/pull/* paths onto their
 * live ServerURLs entry. Older agents parse the URL literally and reject
 * host-less paths with "invalid upload url".
 */
export const RELATIVE_UPLOAD_PULL_MIN_VERSION = "2.3.8";

/**
 * Agents since 2.3.8 emit command_progress during file_upload_http pulls.
 * Older agents only reply with a final command_result, so idle-ack watchdogs
 * that require progress must be disabled for them.
 */
export const UPLOAD_PROGRESS_MIN_VERSION = "2.3.8";

/** Historical floor for relative pull rewrite + upload progress (error copy). */
export const REMOTE_EXECUTE_MIN_VERSION = "2.3.8";

function isParsedSemver(version: string | undefined): boolean {
  return /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.test(String(version || "").trim());
}

export function clientSupportsRelativeUploadPull(version: string | undefined): boolean {
  if (!isParsedSemver(version)) return false;
  return compareClientVersions(version, RELATIVE_UPLOAD_PULL_MIN_VERSION) >= 0;
}

/** True when the agent streams command_progress during HTTP pull uploads. */
export function clientSupportsUploadProgress(version: string | undefined): boolean {
  if (!isParsedSemver(version)) return false;
  return compareClientVersions(version, UPLOAD_PROGRESS_MIN_VERSION) >= 0;
}

/**
 * @deprecated Remote execute is no longer hard-gated by version. Prefer
 * clientSupportsRelativeUploadPull / clientSupportsUploadProgress.
 */
export function clientSupportsRemoteExecute(version: string | undefined): boolean {
  return clientSupportsUploadProgress(version);
}

export function selectUploadPullUrl(opts: {
  clientVersion?: string;
  pullPath: string;
  pullOrigin: string;
}): string {
  if (clientSupportsRelativeUploadPull(opts.clientVersion)) {
    return opts.pullPath || opts.pullOrigin;
  }
  return opts.pullOrigin || opts.pullPath;
}
