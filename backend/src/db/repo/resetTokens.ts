import { createHash } from 'node:crypto';
import { getDb } from '../connection.js';
import { newToken } from '../../lib/ids.js';
import { config } from '../../config.js';
import type { ResetTokenRow } from '../types.js';

// Stored hashed at rest, same principle as password storage (design doc,
// Auth) -- a database read alone shouldn't hand over a usable token. A
// fast cryptographic hash (not argon2/bcrypt) is appropriate here: the
// token itself is already >=32 random bytes, so there's no low-entropy
// secret to slow-hash against guessing, only a stored-value theft to guard
// against, exactly what SHA-256 is for.
function hashToken(plainToken: string): string {
  return createHash('sha256').update(plainToken).digest('hex');
}

export interface CreatedResetToken {
  /** The plaintext token for the email link -- never stored, only handed back once here. */
  plainToken: string;
  row: ResetTokenRow;
}

export function createResetToken(userId: string, kind: 'invite' | 'reset'): CreatedResetToken {
  const db = getDb();
  const plainToken = newToken();
  const id = hashToken(plainToken);
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + config.resetTokenMaxAgeMs).toISOString();
  db.prepare(
    'INSERT INTO reset_tokens (id, user_id, kind, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, NULL)',
  ).run(id, userId, kind, createdAt, expiresAt);
  return { plainToken, row: { id, user_id: userId, kind, created_at: createdAt, expires_at: expiresAt, used_at: null } };
}

/** `plainToken` is what arrived in the request (from the emailed link); looked up by its hash. */
export function findValidResetToken(plainToken: string): ResetTokenRow | undefined {
  const id = hashToken(plainToken);
  const row = getDb().prepare('SELECT * FROM reset_tokens WHERE id = ?').get(id) as ResetTokenRow | undefined;
  if (!row) return undefined;
  if (row.used_at) return undefined;
  if (new Date(row.expires_at).getTime() < Date.now()) return undefined;
  return row;
}

/** Takes the row's own `id` (already a hash), as returned by findValidResetToken -- not the plaintext. */
export function markResetTokenUsed(id: string) {
  getDb().prepare('UPDATE reset_tokens SET used_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

export function purgeExpiredResetTokens() {
  const now = new Date().toISOString();
  getDb().prepare('DELETE FROM reset_tokens WHERE used_at IS NOT NULL OR expires_at < ?').run(now);
}
