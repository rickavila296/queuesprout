/**
 * Adapters call servers whose address comes from users or from the platform (a Bluesky
 * PDS, a Mastodon instance). Only public https hosts are allowed, so a crafted address
 * cannot point the worker or the web app at localhost or the private network. Names
 * that resolve to private addresses are not caught here; the egress network must block them.
 */
export function isPublicHttpsUrl(value: string | URL): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.startsWith('[')) return false;
  if (/(^|\.)(localhost|local|internal|lan|home\.arpa)$/.test(host)) return false;
  const ip = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Retry-After (seconds or an HTTP date), else a rate-limit reset time: ratelimit-reset
 * (epoch seconds, Bluesky) or x-ratelimit-reset (an ISO date, Mastodon).
 */
export function retryAfterMs(headers: Headers, now: Date): number | undefined {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const at = Date.parse(retryAfter);
    if (!Number.isNaN(at)) return Math.max(0, at - now.getTime());
  }
  const reset = headers.get('ratelimit-reset') ?? headers.get('x-ratelimit-reset');
  if (!reset) return undefined;
  const epoch = Number(reset);
  const at = Number.isFinite(epoch) ? epoch * 1000 : Date.parse(reset);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now.getTime());
}

/** Errors fetch raises before a request leaves the machine, so a retry cannot double-post. */
const NOT_SENT = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT']);

/** The system error code behind a failed fetch (ECONNRESET, ENOTFOUND…), if any. */
export function networkErrorCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === 'string' ? cause.code : undefined;
}

/** True when the request never reached the platform, so retrying cannot post twice. */
export function wasNeverSent(error: unknown): boolean {
  const code = networkErrorCode(error);
  return code !== undefined && NOT_SENT.has(code);
}
