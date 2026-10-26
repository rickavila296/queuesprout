import { isPublicHttpsUrl, retryAfterMs } from '../net';
import { MastodonError } from './errors';

/**
 * A minimal Mastodon REST client: one HTTP call, JSON or form in, JSON out, errors as
 * MastodonError. Tokens go in the Authorization header only, never in an error or a log.
 */
export interface MastodonCall {
  instanceUrl: string;
  path: string;
  token?: string;
  /** JSON body (POST). */
  body?: unknown;
  /** Multipart body (media uploads); fetch sets the boundary header. */
  form?: FormData;
  headers?: Record<string, string>;
  signal: AbortSignal;
  now?: () => Date;
}

export async function mastodon<T>(method: 'GET' | 'POST', call: MastodonCall): Promise<T> {
  const url = new URL(call.path, call.instanceUrl);
  if (!isPublicHttpsUrl(url)) {
    throw new MastodonError(400, 'The Mastodon server address is not a public https URL.');
  }
  const headers: Record<string, string> = { accept: 'application/json', ...call.headers };
  if (call.token) headers.authorization = `Bearer ${call.token}`;
  if (call.body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: call.form ?? (call.body === undefined ? undefined : JSON.stringify(call.body)),
    signal: call.signal,
    // The API does not redirect; following one could leave the checked host.
    redirect: 'error',
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body (proxy error page); keep the status.
  }
  if (!res.ok) {
    const body = (json ?? {}) as { error?: unknown; error_description?: unknown };
    const message =
      typeof body.error_description === 'string'
        ? body.error_description
        : typeof body.error === 'string'
          ? body.error
          : `HTTP ${res.status}`;
    throw new MastodonError(
      res.status,
      message,
      retryAfterMs(res.headers, (call.now ?? (() => new Date()))()),
    );
  }
  return json as T;
}

/** https://Mastodon.Social/@me → https://mastodon.social, or null if it is not a server address. */
export function normalizeInstance(input: string): string | null {
  // A handle (@me@server or me@server) names its server after the last @.
  const trimmed = input.trim().replace(/^@?[^@\s/]+@(?=[^@\s/]+$)/, '');
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const origin = `https://${url.host.toLowerCase()}`;
    return isPublicHttpsUrl(origin) && url.protocol === 'https:' ? origin : null;
  } catch {
    return null;
  }
}
