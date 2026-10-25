import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

/** 256-bit url-safe token for links; only its hash is stored. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
