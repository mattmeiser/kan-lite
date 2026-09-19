import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { useTestDb } from './test/setupTestDb.js';
import { createUser, findUserByUsername } from './db/repo/users.js';
import { createResetToken, findValidResetToken } from './db/repo/resetTokens.js';
import { createSession, touchSession } from './db/repo/sessions.js';
import { hashPassword } from './auth/password.js';
import { updateCardFields } from './db/repo/cards.js';
import { createCard, findCard } from './db/repo/cards.js';
import { createBoard, createSwimlane, setBoardArchived, setBoardMember } from './db/repo/boards.js';
import { getDb } from './db/connection.js';

useTestDb();

describe('case-insensitive usernames', () => {
  it('treats "Matt" and "matt" as the same account for uniqueness', () => {
    createUser({ username: 'Matt', email: 'a@x.com', passwordHash: 'h', globalRole: 'app_user' });
    expect(() => createUser({ username: 'matt', email: 'b@x.com', passwordHash: 'h', globalRole: 'app_user' })).toThrow();
  });

  it('finds a user by username regardless of casing, preserving the stored casing', () => {
    createUser({ username: 'Matt', email: 'a@x.com', passwordHash: 'h', globalRole: 'app_user' });
    expect(findUserByUsername('matt')?.username).toBe('Matt');
    expect(findUserByUsername('MATT')?.username).toBe('Matt');
    expect(findUserByUsername('Matt')?.username).toBe('Matt');
  });
});

describe('reset tokens stored hashed at rest', () => {
  it('never stores the plaintext token as a row id, but the plaintext still validates', () => {
    const user = createUser({ username: 'matt', email: 'a@x.com', passwordHash: 'h', globalRole: 'app_user' });
    const { plainToken, row } = createResetToken(user.id, 'reset');

    expect(row.id).not.toBe(plainToken);
    const stored = getDb().prepare('SELECT id FROM reset_tokens').all() as { id: string }[];
    expect(stored.every((r) => r.id !== plainToken)).toBe(true);

    expect(findValidResetToken(plainToken)?.user_id).toBe(user.id);
    expect(findValidResetToken('some-wrong-guess')).toBeUndefined();
  });
});

describe('notified_at reset when due date changes', () => {
  it('clears notified_at on a manual due-date edit', () => {
    const admin = createUser({ username: 'admin', email: 'a@x.com', passwordHash: 'h', globalRole: 'app_admin' });
    const board = createBoard('Chores', admin.id);
    const card = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Task' });
    updateCardFields(card.id, { dueDate: '2026-01-01' });
    getDb().prepare('UPDATE cards SET notified_at = ? WHERE id = ?').run('2026-01-01', card.id);
    expect(findCard(card.id)!.notified_at).toBe('2026-01-01');

    updateCardFields(card.id, { dueDate: '2026-02-01' });
    expect(findCard(card.id)!.notified_at).toBeNull();
  });

  it('leaves notified_at untouched when the due date is not part of the patch', () => {
    const admin = createUser({ username: 'admin', email: 'a@x.com', passwordHash: 'h', globalRole: 'app_admin' });
    const board = createBoard('Chores', admin.id);
    const card = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Task' });
    updateCardFields(card.id, { dueDate: '2026-01-01' });
    getDb().prepare('UPDATE cards SET notified_at = ? WHERE id = ?').run('2026-01-01', card.id);

    updateCardFields(card.id, { title: 'Renamed' });
    expect(findCard(card.id)!.notified_at).toBe('2026-01-01');
  });
});

describe('sessions invalidated on password change', () => {
  it('confirm-reset ends every other existing session for the account', async () => {
    const user = createUser({ username: 'matt', email: 'a@x.com', passwordHash: await hashPassword('oldpassword'), globalRole: 'app_user' });
    const oldSession = createSession(user.id);
    expect(touchSession(oldSession.id)).not.toBeNull();

    const { plainToken } = createResetToken(user.id, 'reset');
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/confirm-reset',
      payload: { token: plainToken, password: 'correcthorsebattery' },
    });
    expect(res.statusCode).toBe(200);

    expect(touchSession(oldSession.id)).toBeNull();
    await app.close();
  });
});

describe('archived board access', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  async function loginAs(username: string, password: string) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    const setCookie = res.headers['set-cookie'];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(';')[0];
    return { cookie, csrfToken: res.json().csrfToken };
  }

  it('404s an archived board for an explicit member who is not an App Admin, even via direct URL', async () => {
    const admin = createUser({ username: 'admin', email: 'a@x.com', passwordHash: await hashPassword('correcthorsebattery'), globalRole: 'app_admin' });
    const member = createUser({ username: 'member', email: 'm@x.com', passwordHash: await hashPassword('correcthorsebattery'), globalRole: 'app_user' });
    const board = createBoard('Chores', admin.id);
    setBoardMember(board.id, member.id, 'board_user');
    setBoardArchived(board.id, true);

    const session = await loginAs('member', 'correcthorsebattery');
    const res = await app.inject({ method: 'GET', url: `/api/boards/${board.id}`, headers: { cookie: session.cookie } });
    expect(res.statusCode).toBe(404);
  });

  it('a non-admin cannot see archived boards on their dashboard even by requesting archived=true', async () => {
    const admin = createUser({ username: 'admin', email: 'a@x.com', passwordHash: await hashPassword('correcthorsebattery'), globalRole: 'app_admin' });
    const member = createUser({ username: 'member', email: 'm@x.com', passwordHash: await hashPassword('correcthorsebattery'), globalRole: 'app_user' });
    const board = createBoard('Chores', admin.id);
    setBoardMember(board.id, member.id, 'board_user');
    setBoardArchived(board.id, true);

    const session = await loginAs('member', 'correcthorsebattery');
    const res = await app.inject({ method: 'GET', url: '/api/boards?archived=true', headers: { cookie: session.cookie } });
    expect(res.json().boards).toEqual([]);
  });

  it('an App Admin can still reach an archived board', async () => {
    const admin = createUser({ username: 'admin', email: 'a@x.com', passwordHash: await hashPassword('correcthorsebattery'), globalRole: 'app_admin' });
    const board = createBoard('Chores', admin.id);
    setBoardArchived(board.id, true);

    const session = await loginAs('admin', 'correcthorsebattery');
    const res = await app.inject({ method: 'GET', url: `/api/boards/${board.id}`, headers: { cookie: session.cookie } });
    expect(res.statusCode).toBe(200);
  });
});

describe('swimlane-count transition', () => {
  useTestDb();

  it('buckets existing null-swimlane cards into the first swimlane when crossing from 0 to 2+', () => {
    const admin = createUser({ username: 'admin', email: 'a@x.com', passwordHash: 'h', globalRole: 'app_admin' });
    const board = createBoard('Chores', admin.id);
    const card = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Task' });
    expect(findCard(card.id)!.swimlane_id).toBeNull();

    const first = createSwimlane(board.id, 'Indoor');
    expect(findCard(card.id)!.swimlane_id).toBeNull(); // still <=1 swimlane, no crossing yet

    createSwimlane(board.id, 'Outdoor');
    expect(findCard(card.id)!.swimlane_id).toBe(first.id);
  });

  it('does not touch existing null-swimlane cards once already past the 2+ threshold', () => {
    const admin = createUser({ username: 'admin', email: 'a@x.com', passwordHash: 'h', globalRole: 'app_admin' });
    const board = createBoard('Chores', admin.id);
    createSwimlane(board.id, 'Indoor');
    createSwimlane(board.id, 'Outdoor');
    const card = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Task' });

    createSwimlane(board.id, 'Garage');
    expect(findCard(card.id)!.swimlane_id).toBeNull();
  });
});

describe('IP-based rate limiting on /login', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects with 429 after exceeding the per-minute limit', async () => {
    createUser({ username: 'matt', email: 'a@x.com', passwordHash: await hashPassword('correcthorsebattery'), globalRole: 'app_user' });

    let lastStatus = 0;
    for (let i = 0; i < 21; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'matt', password: 'wrong' },
      });
      lastStatus = res.statusCode;
    }
    expect(lastStatus).toBe(429);
  });
});
