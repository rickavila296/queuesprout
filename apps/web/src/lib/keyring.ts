import 'server-only';
import { parseKeyring, type Keyring } from '@queuesprout/core/credentials';
import { env } from '@/env';

let cached: Keyring | undefined;

/** The token encryption keyring, or null when TOKEN_ENCRYPTION_KEY is not set. */
export function keyring(): Keyring | null {
  if (cached) return cached;
  const value = env().TOKEN_ENCRYPTION_KEY;
  if (!value) return null;
  cached = parseKeyring(value);
  return cached;
}
