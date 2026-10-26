import { retryAfterMs } from '../net';
import { SlackError } from './errors';
import { API_URL } from './limits';

interface WebApiResponse {
  ok: boolean;
  error?: string;
}

/**
 * Calls one Web API method with the bot token as a Bearer header. The token never goes
 * into an error or a log line. Arguments go form-encoded: the read methods
 * (conversations.info, conversations.list) do not accept JSON bodies.
 */
export async function slack<T>(
  token: string,
  method: string,
  options: {
    body?: Record<string, string | number | boolean>;
    signal: AbortSignal;
    now?: () => Date;
  },
): Promise<T> {
  const res = await fetch(`${API_URL}/${method}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: new URLSearchParams(
      Object.entries(options.body ?? {}).map(([key, value]): [string, string] => [
        key,
        String(value),
      ]),
    ),
    signal: options.signal,
    redirect: 'error',
  });
  const text = await res.text();
  let json: (WebApiResponse & T) | null = null;
  try {
    json = text ? (JSON.parse(text) as WebApiResponse & T) : null;
  } catch {
    // Non-JSON body (a gateway error page); keep the status.
  }
  if (!res.ok || !json?.ok) {
    const now = (options.now ?? (() => new Date()))();
    throw new SlackError(
      res.status,
      typeof json?.error === 'string' ? json.error : `http_${res.status}`,
      retryAfterMs(res.headers, now),
    );
  }
  return json;
}
