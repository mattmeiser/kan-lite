import { describe, expect, it } from 'vitest';
import { useTestDb } from './test/setupTestDb.js';
import { createUser } from './db/repo/users.js';
import { boardStats, findBoardById, updateBoardSettings } from './db/repo/boards.js';
import { createCard, findCard, moveCard, updateCardFields } from './db/repo/cards.js';
import { isDoneCardHidden, toBoardDetailDTO } from './mappers.js';
import { createBoard as createBoardRepo } from './db/repo/boards.js';

function setupBoard() {
  const admin = createUser({ username: 'admin', email: 'a@x.com', passwordHash: 'h', globalRole: 'app_admin' });
  const board = createBoardRepo('Chores', admin.id);
  return findBoardById(board.id)!;
}

function longAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('isDoneCardHidden', () => {
  useTestDb();

  it('is false when the board window is 0 (never hide)', () => {
    const board = setupBoard();
    const card = createCard({ boardId: board.id, columnId: board.done_column_id!, swimlaneId: null, title: 'Task' });
    moveCard(card.id, board.done_column_id!, null, 0, longAgoIso(999));
    expect(isDoneCardHidden(findCard(card.id)!, board)).toBe(false);
  });

  it('is false for a card not sitting in the Done column', () => {
    const board = setupBoard();
    updateBoardSettings(board.id, { doneCardVisibilityDays: 1 });
    const card = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Task' });
    expect(isDoneCardHidden(findCard(card.id)!, findBoardById(board.id)!)).toBe(false);
  });

  it('is false for a Done card with no entered_done_at (defensive -- should not happen in practice)', () => {
    const board = setupBoard();
    updateBoardSettings(board.id, { doneCardVisibilityDays: 1 });
    const card = createCard({ boardId: board.id, columnId: board.done_column_id!, swimlaneId: null, title: 'Task' });
    expect(isDoneCardHidden(findCard(card.id)!, findBoardById(board.id)!)).toBe(false);
  });

  it('is false while still within the window', () => {
    const board = setupBoard();
    updateBoardSettings(board.id, { doneCardVisibilityDays: 7 });
    const card = createCard({ boardId: board.id, columnId: board.done_column_id!, swimlaneId: null, title: 'Task' });
    moveCard(card.id, board.done_column_id!, null, 0, longAgoIso(3));
    expect(isDoneCardHidden(findCard(card.id)!, findBoardById(board.id)!)).toBe(false);
  });

  it('is true once the card has been Done longer than the window', () => {
    const board = setupBoard();
    updateBoardSettings(board.id, { doneCardVisibilityDays: 7 });
    const card = createCard({ boardId: board.id, columnId: board.done_column_id!, swimlaneId: null, title: 'Task' });
    moveCard(card.id, board.done_column_id!, null, 0, longAgoIso(10));
    expect(isDoneCardHidden(findCard(card.id)!, findBoardById(board.id)!)).toBe(true);
  });
});

describe('done card visibility window -- board detail and stats', () => {
  useTestDb();

  it('excludes an aged-out Done card from the board detail card list but leaves it directly fetchable', () => {
    const board = setupBoard();
    updateBoardSettings(board.id, { doneCardVisibilityDays: 7 });
    const visible = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Still visible' });
    const aged = createCard({ boardId: board.id, columnId: board.done_column_id!, swimlaneId: null, title: 'Aged out' });
    moveCard(aged.id, board.done_column_id!, null, 0, longAgoIso(30));

    const detail = toBoardDetailDTO(findBoardById(board.id)!, 'board_admin');
    expect(detail.cards.map((c) => c.title)).toEqual([visible.title]);

    // Not deleted -- the row, and a direct fetch, are untouched.
    expect(findCard(aged.id)?.title).toBe('Aged out');
  });

  it('excludes an aged-out Done card from board stats (both All and Mine)', () => {
    const board = setupBoard();
    updateBoardSettings(board.id, { doneCardVisibilityDays: 7 });
    const user = createUser({ username: 'kid', email: 'k@x.com', passwordHash: 'h', globalRole: 'app_user' });

    const aged = createCard({ boardId: board.id, columnId: board.done_column_id!, swimlaneId: null, title: 'Aged out' });
    updateCardFields(aged.id, { assigneeId: user.id });
    moveCard(aged.id, board.done_column_id!, null, 0, longAgoIso(30));

    const refreshed = findBoardById(board.id)!;
    expect(boardStats(refreshed.id).total).toBe(0);
    expect(boardStats(refreshed.id, user.id).total).toBe(0);
  });

  it('raising the window back up makes the card reappear immediately (live filter, never snapshotted)', () => {
    const board = setupBoard();
    updateBoardSettings(board.id, { doneCardVisibilityDays: 7 });
    const aged = createCard({ boardId: board.id, columnId: board.done_column_id!, swimlaneId: null, title: 'Aged out' });
    moveCard(aged.id, board.done_column_id!, null, 0, longAgoIso(30));

    expect(toBoardDetailDTO(findBoardById(board.id)!, 'board_admin').cards).toHaveLength(0);

    updateBoardSettings(board.id, { doneCardVisibilityDays: 0 });
    expect(toBoardDetailDTO(findBoardById(board.id)!, 'board_admin').cards).toHaveLength(1);
  });
});
