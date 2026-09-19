import { describe, expect, it } from 'vitest';
import { useTestDb } from './test/setupTestDb.js';
import { createUser } from './db/repo/users.js';
import { createBoard } from './db/repo/boards.js';
import { createCard, createLink, deleteCard, findCard } from './db/repo/cards.js';
import { toCardDTO } from './mappers.js';

function setupBoard() {
  const admin = createUser({ username: 'admin', email: 'a@x.com', passwordHash: 'h', globalRole: 'app_admin' });
  const board = createBoard('Chores', admin.id);
  return board;
}

describe('toCardDTO relatedCards direction', () => {
  useTestDb();

  it('shows a symmetric "related" link the same way from either side', () => {
    const board = setupBoard();
    const a = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'A' });
    const b = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'B' });
    createLink(a.id, b.id, 'related');

    const fromA = toCardDTO(findCard(a.id)!);
    const fromB = toCardDTO(findCard(b.id)!);

    expect(fromA.relatedCards).toEqual([{ linkId: expect.any(String), cardId: b.id, title: 'B', direction: 'related' }]);
    expect(fromB.relatedCards).toEqual([{ linkId: expect.any(String), cardId: a.id, title: 'A', direction: 'related' }]);
  });

  it('derives successor/predecessor as two readings of one stored row, never two rows', () => {
    const board = setupBoard();
    const predecessor = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Order thermostat' });
    const successor = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Install thermostat' });

    // "predecessor precedes successor" -- card_a is the predecessor.
    createLink(predecessor.id, successor.id, 'predecessor');

    const fromPredecessor = toCardDTO(findCard(predecessor.id)!);
    const fromSuccessor = toCardDTO(findCard(successor.id)!);

    expect(fromPredecessor.relatedCards).toEqual([
      { linkId: expect.any(String), cardId: successor.id, title: 'Install thermostat', direction: 'successor' },
    ]);
    expect(fromSuccessor.relatedCards).toEqual([
      { linkId: expect.any(String), cardId: predecessor.id, title: 'Order thermostat', direction: 'predecessor' },
    ]);

    // Exactly one row backs both readings.
    expect(fromPredecessor.relatedCards[0].linkId).toBe(fromSuccessor.relatedCards[0].linkId);
  });

  it('deleting a card removes any related-card link pointing at it', () => {
    const board = setupBoard();
    const a = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'A' });
    const b = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'B' });
    createLink(a.id, b.id, 'related');

    deleteCard(b.id);

    expect(toCardDTO(findCard(a.id)!).relatedCards).toEqual([]);
  });
});
