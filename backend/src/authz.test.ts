import { describe, expect, it } from 'vitest';
import { useTestDb } from './test/setupTestDb.js';
import { canReadBoard, canWriteBoard, effectiveBoardRole, isBoardAdmin } from './authz.js';
import { createUser } from './db/repo/users.js';
import { createBoard, setBoardMember } from './db/repo/boards.js';

describe('effectiveBoardRole', () => {
  useTestDb();

  it('computes App Admin as board_admin everywhere, without a stored membership row', () => {
    const admin = createUser({ username: 'admin', email: 'a@x.com', passwordHash: 'h', globalRole: 'app_admin' });
    // A board created by someone else entirely -- the admin was never added as a member.
    const otherUser = createUser({ username: 'creator', email: 'c@x.com', passwordHash: 'h', globalRole: 'app_user' });
    const board = createBoard('Chores', otherUser.id);

    expect(effectiveBoardRole(admin, board.id)).toBe('board_admin');
  });

  it('returns the explicit membership role for an App User', () => {
    const user = createUser({ username: 'kid', email: 'k@x.com', passwordHash: 'h', globalRole: 'app_user' });
    const admin = createUser({ username: 'admin', email: 'a@x.com', passwordHash: 'h', globalRole: 'app_admin' });
    const board = createBoard('Chores', admin.id);
    setBoardMember(board.id, user.id, 'board_reader');

    expect(effectiveBoardRole(user, board.id)).toBe('board_reader');
  });

  it('returns null for a user with no membership and no App Admin role', () => {
    const user = createUser({ username: 'outsider', email: 'o@x.com', passwordHash: 'h', globalRole: 'app_user' });
    const admin = createUser({ username: 'admin', email: 'a@x.com', passwordHash: 'h', globalRole: 'app_admin' });
    const board = createBoard('Chores', admin.id);

    expect(effectiveBoardRole(user, board.id)).toBeNull();
  });
});

describe('role predicates', () => {
  it('canReadBoard is true for any non-null role', () => {
    expect(canReadBoard('board_reader')).toBe(true);
    expect(canReadBoard(null)).toBe(false);
  });

  it('canWriteBoard excludes board_reader', () => {
    expect(canWriteBoard('board_admin')).toBe(true);
    expect(canWriteBoard('board_user')).toBe(true);
    expect(canWriteBoard('board_reader')).toBe(false);
    expect(canWriteBoard(null)).toBe(false);
  });

  it('isBoardAdmin is true only for board_admin', () => {
    expect(isBoardAdmin('board_admin')).toBe(true);
    expect(isBoardAdmin('board_user')).toBe(false);
    expect(isBoardAdmin(null)).toBe(false);
  });
});
