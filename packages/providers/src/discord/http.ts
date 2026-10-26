import { retryAfterMs } from '../net';
import { DiscordError } from './errors';
import { API_URL } from './limits';

/**
 * A minimal Discord REST client for webhook calls. The webhook token is part of the
 * path, so the URL is never put in an error or a log line.
 */
export async function discord<T>(
  method: 'GET' | 'POST',
  path: string,
  options: { body?: unknown; signal: AbortSignal; now?: () => Date },
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(options.body !== undefined && { 'content-type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    redirect: 'error',
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body (Cloudflare error page); keep the status.
  }
  if (!res.ok) {
    const body = (json ?? {}) as { message?: unknown; code?: unknown; retry_after?: unknown };
    const now = (options.now ?? (() => new Date()))();
    // 429 bodies carry retry_after in seconds, more precise than the header.
    const retryAfter =
      typeof body.retry_after === 'number'
        ? Math.ceil(body.retry_after * 1000)
        : retryAfterMs(res.headers, now);
    throw new DiscordError(
      res.status,
      typeof body.code === 'number' ? body.code : undefined,
      typeof body.message === 'string' ? body.message : `HTTP ${res.status}`,
      retryAfter,
    );
  }
  return json as T;
}
