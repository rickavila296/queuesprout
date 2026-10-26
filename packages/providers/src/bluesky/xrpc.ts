import { isPublicHttpsUrl, retryAfterMs } from '../net';
import { XrpcError } from './errors';

/**
 * A minimal XRPC client: one HTTP call, JSON in and out, errors as XrpcError. Tokens
 * go in the Authorization header only and are never part of an error or a log line.
 */
export interface XrpcCall {
  service: string;
  nsid: string;
  token?: string;
  /** Query parameters (GET). */
  params?: Record<string, string>;
  /** JSON body (POST). */
  body?: unknown;
  /** Raw body (POST), e.g. an image for uploadBlob. Wins over body. */
  blob?: { bytes: Uint8Array; contentType: string };
  signal: AbortSignal;
  /** For Retry-After and ratelimit-reset. */
  now?: () => Date;
}

export async function xrpc<T>(method: 'GET' | 'POST', call: XrpcCall): Promise<T> {
  const url = new URL(`/xrpc/${call.nsid}`, call.service);
  if (!isPublicHttpsUrl(url)) {
    throw new XrpcError(
      400,
      'UnsafeService',
      'The Bluesky server address is not a public https URL.',
    );
  }
  for (const [k, v] of Object.entries(call.params ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (call.token) headers.authorization = `Bearer ${call.token}`;
  let body: Uint8Array<ArrayBuffer> | string | undefined;
  if (call.blob) {
    headers['content-type'] = call.blob.contentType;
    // A copy backed by a plain ArrayBuffer, which is what fetch() is typed to accept.
    body = new Uint8Array(call.blob.bytes);
  } else if (call.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(call.body);
  }

  const res = await fetch(url, {
    method,
    headers,
    body,
    signal: call.signal,
    // XRPC does not redirect; following one could leave the checked host.
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
    const body = (json ?? {}) as { error?: unknown; message?: unknown };
    throw new XrpcError(
      res.status,
      typeof body.error === 'string' ? body.error : undefined,
      typeof body.message === 'string' ? body.message : `HTTP ${res.status}`,
      retryAfterMs(res.headers, (call.now ?? (() => new Date()))()),
    );
  }
  return json as T;
}
