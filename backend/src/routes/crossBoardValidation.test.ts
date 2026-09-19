import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { useTestDb } from '../test/setupTestDb.js';
import { setPasswordHash } from '../db/repo/users.js';
import { hashPassword } from '../auth/password.js';

useTestDb();

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
});

function extractSessionCookie(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return header!.split(';')[0];
}

async function bootstrapAdmin() {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/bootstrap',
    payload: { username: 'admin', email: 'admin@x.com', password: 'correcthorsebattery' },
  });
  const body = res.json();
  return { cookie: extractSessionCookie(res.headers['set-cookie']), csrfToken: body.csrfToken, userId: body.id };
}

async function createBoard(session: { cookie: string; csrfToken: string }, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/boards',
    headers: { cookie: session.cookie, 'x-csrf-token': session.csrfToken },
    payload: { name },
  });
  return res.json();
}

async function createCard(session: { cookie: string; csrfToken: string }, boardId: string, columnId: string, title: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/boards/${boardId}/cards`,
    headers: { cookie: session.cookie, 'x-csrf-token': session.csrfToken },
    payload: { columnId, title },
  });
  return res.json();
}

describe('cross-board reference validation', () => {
  it('rejects moving a card onto a column that belongs to a different board', async () => {
    const admin = await bootstrapAdmin();
    const boardA = await createBoard(admin, 'Board A');
    const boardB = await createBoard(admin, 'Board B');
    const card = await createCard(admin, boardA.id, boardA.backlogColumnId, 'Task');

    // A member of board A supplying a plausible-looking column id that
    // actually belongs to board B -- exactly the cross-board bug class
    // this validation exists to close off.
    const res = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardA.id}/cards/${card.id}/move`,
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrfToken },
      payload: { columnId: boardB.backlogColumnId, position: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/does not belong to this board/i);
  });

  it('rejects adding a chip from a different board to a card', async () => {
    const admin = await bootstrapAdmin();
    const boardA = await createBoard(admin, 'Board A');
    const boardB = await createBoard(admin, 'Board B');
    const card = await createCard(admin, boardA.id, boardA.backlogColumnId, 'Task');

    const chipRes = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardB.id}/chips`,
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrfToken },
      payload: { name: 'Urgent', color: 'red' },
    });
    const chip = chipRes.json();

    const res = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardA.id}/cards/${card.id}/chips`,
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrfToken },
      payload: { chipId: chip.id },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/does not belong to this board/i);
  });

  it('rejects linking to a related card on a different board', async () => {
    const admin = await bootstrapAdmin();
    const boardA = await createBoard(admin, 'Board A');
    const boardB = await createBoard(admin, 'Board B');
    const cardA = await createCard(admin, boardA.id, boardA.backlogColumnId, 'Task A');
    const cardB = await createCard(admin, boardB.id, boardB.backlogColumnId, 'Task B');

    const res = await app.inject({
      method: 'POST',
      url: `/api/boards/${boardA.id}/cards/${cardA.id}/links`,
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrfToken },
      payload: { otherCardId: cardB.id, relation: 'related' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects assigning a card to a user who is not an explicit member of that board', async () => {
    const admin = await bootstrapAdmin();
    const board = await createBoard(admin, 'Board A');
    const card = await createCard(admin, board.id, board.backlogColumnId, 'Task');

    const inviteRes = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrfToken },
      payload: { username: 'outsider', email: 'o@x.com' },
    });
    const outsider = inviteRes.json();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/boards/${board.id}/cards/${card.id}`,
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrfToken },
      payload: { assigneeId: outsider.id },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/explicit member/i);
  });
});

describe('board visibility', () => {
  it("404s (not 403) for a board a user isn't a member of -- they can't even see it exists", async () => {
    const admin = await bootstrapAdmin();
    const board = await createBoard(admin, 'Private board');

    const inviteRes = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrfToken },
      payload: { username: 'outsider', email: 'o@x.com' },
    });
    const outsider = inviteRes.json();

    // Give the invited account a real password directly (bypassing the
    // email-token flow, which is exercised separately) so it can log in.
    setPasswordHash(outsider.id, await hashPassword('correcthorsebattery'));

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'outsider', password: 'correcthorsebattery' },
    });
    const outsiderSession = {
      cookie: extractSessionCookie(loginRes.headers['set-cookie']),
      csrfToken: loginRes.json().csrfToken,
    };

    const res = await app.inject({
      method: 'GET',
      url: `/api/boards/${board.id}`,
      headers: { cookie: outsiderSession.cookie },
    });

    expect(res.statusCode).toBe(404);
  });

  it('lists every board on an App Admin\'s dashboard even without explicit membership', async () => {
    const admin = await bootstrapAdmin();
    await createBoard(admin, 'Created by admin');

    // A second App Admin, promoted after the fact, was never added as an
    // explicit member of the first board -- they should still see it (design
    // doc, Users and roles: "unless they're an App Admin").
    const inviteRes = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrfToken },
      payload: { username: 'second-admin', email: 's@x.com', globalRole: 'app_admin' },
    });
    const secondAdmin = inviteRes.json();
    setPasswordHash(secondAdmin.id, await hashPassword('correcthorsebattery'));

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'second-admin', password: 'correcthorsebattery' },
    });
    const secondAdminCookie = extractSessionCookie(loginRes.headers['set-cookie']);

    const res = await app.inject({
      method: 'GET',
      url: '/api/boards',
      headers: { cookie: secondAdminCookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().boards.map((b: { name: string }) => b.name)).toContain('Created by admin');
  });
});

describe('CSRF enforcement', () => {
  it('rejects a mutating request with a missing or wrong CSRF token', async () => {
    const admin = await bootstrapAdmin();

    const res = await app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: { cookie: admin.cookie, 'x-csrf-token': 'wrong-token' },
      payload: { name: 'Board' },
    });

    expect(res.statusCode).toBe(403);
  });
});
