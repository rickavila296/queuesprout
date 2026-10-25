/**
 * Strips secrets from recorded platform responses before they become fixtures,
 * test snapshots or publish_attempts.response_redacted. Keys are matched by name;
 * string values that look like bearer tokens or JWTs are replaced wherever they are.
 */
const SECRET_KEY =
  /(token|secret|password|passwd|authorization|cookie|session|api[-_]?key|jwt|signature|dpop|code_verifier)/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/g;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;

export const REDACTED = '[redacted]';

export function redact<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(BEARER, `Bearer ${REDACTED}`).replace(JWT, REDACTED);
  }
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        SECRET_KEY.test(key) && v !== null && typeof v !== 'object' ? REDACTED : walk(v),
      ]),
    );
  }
  return value;
}
