import { getDb } from '../connection.js';
import { newId } from '../../lib/ids.js';
import type { UserRow } from '../types.js';
import type { GlobalRole, ThemePreference } from '@kanlite/shared';

export function countUsers(): number {
  const row = getDb().prepare('SELECT COUNT(*) as n FROM users').get() as { n: number };
  return row.n;
}

export function countActiveAdmins(excludingUserId?: string): number {
  const db = getDb();
  const row = excludingUserId
    ? (db
        .prepare(
          "SELECT COUNT(*) as n FROM users WHERE global_role = 'app_admin' AND active = 1 AND id != ?",
        )
        .get(excludingUserId) as { n: number })
    : (db.prepare("SELECT COUNT(*) as n FROM users WHERE global_role = 'app_admin' AND active = 1").get() as {
        n: number;
      });
  return row.n;
}

export function findUserByUsername(username: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
}

export function findUserById(id: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function listUsers(): UserRow[] {
  return getDb().prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE').all() as unknown as UserRow[];
}

export interface CreateUserInput {
  username: string;
  email: string;
  passwordHash: string;
  globalRole: GlobalRole;
}

export function createUser(input: CreateUserInput): UserRow {
  const db = getDb();
  const id = newId();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, global_role, active, theme, failed_login_count, lockout_until, created_at)
     VALUES (?, ?, ?, ?, ?, 1, 'system', 0, NULL, ?)`,
  ).run(id, input.username, input.email, input.passwordHash, input.globalRole, now);
  return findUserById(id)!;
}

export function setPasswordHash(userId: string, passwordHash: string) {
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

export function recordFailedLogin(userId: string, lockoutUntil: string | null, failedCount: number) {
  getDb()
    .prepare('UPDATE users SET failed_login_count = ?, lockout_until = ? WHERE id = ?')
    .run(failedCount, lockoutUntil, userId);
}

export function resetFailedLogins(userId: string) {
  getDb().prepare('UPDATE users SET failed_login_count = 0, lockout_until = NULL WHERE id = ?').run(userId);
}

export function setActive(userId: string, active: boolean) {
  getDb().prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, userId);
}

export function setGlobalRole(userId: string, role: GlobalRole) {
  getDb().prepare('UPDATE users SET global_role = ? WHERE id = ?').run(role, userId);
}

export function setTheme(userId: string, theme: ThemePreference) {
  getDb().prepare('UPDATE users SET theme = ? WHERE id = ?').run(theme, userId);
}
