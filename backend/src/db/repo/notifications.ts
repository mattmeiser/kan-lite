import { getDb } from '../connection.js';
import type { CardRow } from '../types.js';

export interface DigestCandidateRow {
  id: string;
  title: string;
  due_date: string;
  assignee_id: string;
  notified_at: string | null;
}

/** Cards due today or overdue, not sitting in a do-not-notify column, with an assignee -- see design doc, Due-date notifications. */
export function findDigestCandidates(boardId: string, today: string): DigestCandidateRow[] {
  return getDb()
    .prepare(
      `SELECT cards.id, cards.title, cards.due_date, cards.assignee_id, cards.notified_at
       FROM cards
       JOIN columns ON columns.id = cards.column_id
       WHERE cards.board_id = ?
         AND cards.due_date IS NOT NULL
         AND cards.due_date <= ?
         AND columns.do_not_notify = 0
         AND cards.assignee_id IS NOT NULL`,
    )
    .all(boardId, today) as unknown as DigestCandidateRow[];
}

export function markCardsNotified(cardIds: string[], today: string) {
  if (cardIds.length === 0) return;
  const db = getDb();
  const placeholders = cardIds.map(() => '?').join(',');
  db.prepare(`UPDATE cards SET notified_at = ? WHERE id IN (${placeholders})`).run(today, ...cardIds);
}

/** Cards recurrence-eligible for recycling: sitting in the board's Done column with a recurrence interval and an entered_done_at timestamp. */
export function findRecycleCandidates(boardId: string, doneColumnId: string): CardRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM cards WHERE board_id = ? AND column_id = ? AND recurrence_interval_days IS NOT NULL AND entered_done_at IS NOT NULL`,
    )
    .all(boardId, doneColumnId) as unknown as CardRow[];
}

export function listBacklogCardsOrdered(backlogColumnId: string): CardRow[] {
  return getDb()
    .prepare('SELECT * FROM cards WHERE column_id = ? ORDER BY position')
    .all(backlogColumnId) as unknown as CardRow[];
}

export interface RecycleResult {
  newDueDate: string;
  newCycleCount: number;
}

/** Atomically moves a card from Done to Backlog at `position`, recalculates its due date, increments cycle count, and resets its subtasks -- see design doc, Recurrence. */
export function recycleCard(card: CardRow, backlogColumnId: string, position: number, newDueDate: string): RecycleResult {
  const db = getDb();
  const newCycleCount = card.cycle_count + 1;
  const now = new Date().toISOString();

  db.exec('BEGIN');
  try {
    const siblings = db
      .prepare('SELECT id, position FROM cards WHERE column_id = ? ORDER BY position')
      .all(backlogColumnId) as { id: string; position: number }[];
    siblings.splice(position, 0, { id: card.id, position: 0 });
    const update = db.prepare('UPDATE cards SET position = ? WHERE id = ?');
    siblings.forEach((row, index) => update.run(index, row.id));

    db.prepare(
      `UPDATE cards SET column_id = ?, due_date = ?, cycle_count = ?, entered_done_at = NULL, notified_at = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(backlogColumnId, newDueDate, newCycleCount, now, card.id);
    db.prepare('UPDATE subtasks SET done = 0 WHERE card_id = ?').run(card.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { newDueDate, newCycleCount };
}
