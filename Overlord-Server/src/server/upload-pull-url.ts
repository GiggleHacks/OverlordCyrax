export type PullEndpointSource = "external_config" | "forwarded_host" | "request_host";

export type AbsolutePullOrigin = {
  origin: string;
  source: PullEndpointSource;
};

function firstHeaderValue(value: string | null): string {
  return String(value || "").split(",", 1)[0].trim();
}

/** Build an absolute http(s) origin agents can pull staged uploads from. */
export function buildAbsolutePullOrigin(req: Request): AbsolutePullOrigin {
  const configured = String(process.env.OVERLORD_EXTERNAL_URL || "").trim();
  if (configured) {
    try {
      const external = new URL(configured);
      if (external.protocol === "https:" || external.protocol === "http:") {
        return { origin: external.origin, source: "external_config" };
      }
    } catch {
      /* fall through */
    }
  }

  const requestUrl = new URL(req.url);
  const forwardedHost = firstHeaderValue(req.headers.get("x-forwarded-host"));
  const host = forwardedHost || firstHeaderValue(req.headers.get("host")) || requestUrl.host;
  const forwardedProtocol = firstHeaderValue(req.headers.get("x-forwarded-proto")).toLowerCase();
  const protocol =
    forwardedProtocol === "https" || forwardedProtocol === "http"
      ? forwardedProtocol
      : requestUrl.protocol === "https:"
        ? "https"
        : "http";
  return {
    origin: `${protocol}://${host}`,
    source: forwardedHost ? "forwarded_host" : "request_host",
  };
}

export function buildPullEndpoints(req: Request, pullId: string): {
  path: string;
  originUrl: string;
  source: PullEndpointSource;
} {
  const pathName = `/api/file/upload/pull/${encodeURIComponent(pullId)}`;
  const absolute = buildAbsolutePullOrigin(req);
  return {
    path: pathName,
    originUrl: new URL(pathName, `${absolute.origin}/`).toString(),
    source: absolute.source,
  };
}
