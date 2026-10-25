interface PgLikeError {
  code?: string;
  message?: string;
  cause?: unknown;
}

/** Drizzle wraps driver errors; walk the cause chain to find the Postgres error. */
export function findPgError(error: unknown): { code: string | undefined; message: string } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const e = current as PgLikeError;
    if (typeof e.code === 'string') return { code: e.code, message: e.message ?? '' };
    current = e.cause;
  }
  return null;
}

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_INSUFFICIENT_PRIVILEGE = '42501';
export const PG_RAISE_EXCEPTION = 'P0001';
