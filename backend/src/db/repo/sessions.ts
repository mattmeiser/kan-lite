import { getDb } from '../connection.js';
import { newToken } from '../../lib/ids.js';
import type { SessionRow, UserRow } from '../types.js';
import { config } from '../../config.js';

export interface SessionWithUser {
  session: SessionRow;
  user: UserRow;
}

export function createSession(userId: string): SessionRow {
  const db = getDb();
  const id = newToken();
  const csrfToken = newToken();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO sessions (id, user_id, csrf_token, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, userId, csrfToken, now, now);
  return { id, user_id: userId, csrf_token: csrfToken, created_at: now, last_seen_at: now };
}

/** Looks up a session, enforcing the sliding window and the user's active flag; refreshes last_seen_at on success. */
export function touchSession(sessionId: string): SessionWithUser | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT sessions.id as s_id, sessions.user_id as s_user_id, sessions.csrf_token as s_csrf_token,
              sessions.created_at as s_created_at, sessions.last_seen_at as s_last_seen_at,
              users.*
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ?`,
    )
    .get(sessionId) as (Record<string, unknown> & UserRow) | undefined;

  if (!row) return null;

  const lastSeenAt = new Date(row.s_last_seen_at as string).getTime();
  if (Date.now() - lastSeenAt > config.sessionMaxAgeMs) {
    deleteSession(sessionId);
    return null;
  }

  if (!row.active) {
    // A deactivated user's still-valid cookie must be rejected on its very next request.
    deleteSession(sessionId);
    return null;
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, sessionId);

  const session: SessionRow = {
    id: row.s_id as string,
    user_id: row.s_user_id as string,
    csrf_token: row.s_csrf_token as string,
    created_at: row.s_created_at as string,
    last_seen_at: now,
  };
  const user: UserRow = {
    id: row.id,
    username: row.username,
    email: row.email,
    password_hash: row.password_hash,
    global_role: row.global_role,
    active: row.active,
    theme: row.theme,
    failed_login_count: row.failed_login_count,
    lockout_until: row.lockout_until,
    created_at: row.created_at,
  };
  return { session, user };
}

export function deleteSession(sessionId: string) {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function deleteSessionsForUser(userId: string) {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function purgeExpiredSessions() {
  const cutoff = new Date(Date.now() - config.sessionMaxAgeMs).toISOString();
  getDb().prepare('DELETE FROM sessions WHERE last_seen_at < ?').run(cutoff);
}
