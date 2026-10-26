import { fetchFresh, retryAfterMs } from '../net';
import { TelegramError } from './errors';
import { API_URL } from './limits';

interface BotApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

/**
 * Calls one Bot API method. The bot token is part of the URL, so the URL is never put
 * in an error or a log line.
 */
export async function telegram<T>(
  token: string,
  method: string,
  options: {
    body?: Record<string, unknown>;
    /** Multipart body (photo uploads); fetch sets the boundary header. */
    form?: FormData;
    signal: AbortSignal;
    now?: () => Date;
  },
): Promise<T> {
  const { res, text } = await fetchFresh(`${API_URL}/bot${token}/${method}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      ...(!options.form && { 'content-type': 'application/json' }),
    },
    body: options.form ?? JSON.stringify(options.body ?? {}),
    signal: options.signal,
    redirect: 'error',
  });
  let json: BotApiResponse<T> | null = null;
  try {
    json = text ? (JSON.parse(text) as BotApiResponse<T>) : null;
  } catch {
    // Non-JSON body (a proxy error page); keep the status.
  }
  if (!res.ok || !json?.ok) {
    const status = json?.error_code ?? (res.ok ? 500 : res.status);
    const params = json?.parameters;
    const now = (options.now ?? (() => new Date()))();
    throw new TelegramError(
      status,
      typeof json?.description === 'string' ? json.description : `HTTP ${res.status}`,
      typeof params?.retry_after === 'number'
        ? params.retry_after * 1000
        : retryAfterMs(res.headers, now),
      params?.migrate_to_chat_id,
    );
  }
  return json.result as T;
}
