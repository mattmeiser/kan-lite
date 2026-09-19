import type { CurrentUser, PublicUser } from '@kanlite/shared';
import { config } from '../config.js';
import {
  findUserByUsername,
  recordFailedLogin,
  resetFailedLogins,
} from '../db/repo/users.js';
import { createSession } from '../db/repo/sessions.js';
import { verifyPassword } from './password.js';
import { sendMail } from '../email/mailer.js';
import type { UserRow } from '../db/types.js';

export class AuthError extends Error {
  constructor(
    message: string,
    public code: 'invalid_credentials' | 'locked_out' | 'inactive',
  ) {
    super(message);
  }
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    globalRole: row.global_role,
    active: !!row.active,
    theme: row.theme,
  };
}

export function toCurrentUser(row: UserRow, csrfToken: string): CurrentUser {
  return { ...toPublicUser(row), csrfToken };
}

function minutesRemaining(lockoutUntil: string): number {
  return Math.max(1, Math.ceil((new Date(lockoutUntil).getTime() - Date.now()) / 60000));
}

export async function login(username: string, password: string) {
  const user = findUserByUsername(username);

  if (user?.lockout_until && new Date(user.lockout_until).getTime() > Date.now()) {
    throw new AuthError(
      `This account is temporarily locked. Try again in ${minutesRemaining(user.lockout_until)} minutes.`,
      'locked_out',
    );
  }

  if (!user || !user.password_hash) {
    throw new AuthError('Invalid username or password.', 'invalid_credentials');
  }

  if (!user.active) {
    throw new AuthError('Invalid username or password.', 'invalid_credentials');
  }

  const ok = await verifyPassword(user.password_hash, password);
  if (!ok) {
    const failedCount = user.failed_login_count + 1;
    const lockedNow = failedCount >= config.lockoutThreshold;
    const lockoutUntil = lockedNow ? new Date(Date.now() + config.lockoutMs).toISOString() : null;
    recordFailedLogin(user.id, lockoutUntil, lockedNow ? failedCount : failedCount);
    if (lockedNow) {
      void sendMail(
        user.email,
        'KanLite account locked',
        `Your KanLite account (${user.username}) was locked for 15 minutes after repeated failed login attempts. If this wasn't you, consider resetting your password once it unlocks.`,
      );
    }
    throw new AuthError('Invalid username or password.', 'invalid_credentials');
  }

  resetFailedLogins(user.id);
  const session = createSession(user.id);
  return { user: toCurrentUser(user, session.csrf_token), sessionId: session.id };
}
