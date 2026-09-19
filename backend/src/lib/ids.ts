import { randomUUID, randomBytes } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

/** >= 32 random bytes, url-safe -- used for session ids and reset/invite tokens. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}
