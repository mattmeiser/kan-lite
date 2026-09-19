import { getDb } from '../connection.js';
import { newId } from '../../lib/ids.js';
import type { CardLinkRow, CardRow, SubtaskRow } from '../types.js';
import type { Priority } from '@kanlite/shared';

export function findCard(cardId: string): CardRow | undefined {
  return getDb().prepare('SELECT * FROM cards WHERE id = ?').get(cardId) as CardRow | undefined;
}

export function listCardsForBoard(boardId: string): CardRow[] {
  return getDb().prepare('SELECT * FROM cards WHERE board_id = ? ORDER BY position').all(boardId) as unknown as CardRow[];
}

export interface CreateCardInput {
  boardId: string;
  columnId: string;
  swimlaneId: string | null;
  title: string;
  assigneeId?: string | null;
}

export function createCard(input: CreateCardInput): CardRow {
  const db = getDb();
  const id = newId();
  const now = new Date().toISOString();
  const maxPos = db
    .prepare('SELECT COALESCE(MAX(position), -1) as p FROM cards WHERE column_id = ?')
    .get(input.columnId) as { p: number };

  db.prepare(
    `INSERT INTO cards (id, board_id, column_id, swimlane_id, title, description, position, assignee_id, priority,
                         due_date, recurrence_interval_days, cycle_count, entered_done_at, notified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '', ?, ?, 'Medium', NULL, NULL, 0, NULL, NULL, ?, ?)`,
  ).run(id, input.boardId, input.columnId, input.swimlaneId, input.title, maxPos.p + 1, input.assigneeId ?? null, now, now);

  return findCard(id)!;
}

export interface CardFieldPatch {
  title?: string;
  description?: string;
  assigneeId?: string | null;
  priority?: Priority;
  dueDate?: string | null;
  recurrenceIntervalDays?: number | null;
}

export function updateCardFields(cardId: string, patch: CardFieldPatch) {
  const current = findCard(cardId)!;
  const newDueDate = patch.dueDate === undefined ? current.due_date : patch.dueDate;
  // A due-date change (manual edit here; recycling clears it separately in
  // notifications.ts) must reset notified_at, or the new date could look
  // "already handled" and silently skip its first reminder (design doc,
  // Due-date notifications).
  const notifiedAt = newDueDate === current.due_date ? current.notified_at : null;
  getDb()
    .prepare(
      `UPDATE cards SET title = ?, description = ?, assignee_id = ?, priority = ?, due_date = ?, recurrence_interval_days = ?, notified_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.title ?? current.title,
      patch.description ?? current.description,
      patch.assigneeId === undefined ? current.assignee_id : patch.assigneeId,
      patch.priority ?? current.priority,
      newDueDate,
      patch.recurrenceIntervalDays === undefined ? current.recurrence_interval_days : patch.recurrenceIntervalDays,
      notifiedAt,
      new Date().toISOString(),
      cardId,
    );
}

/** Moves a card to a column/swimlane/position; stamps entered_done_at when it crosses into the board's Done column, clears it otherwise. */
export function moveCard(
  cardId: string,
  columnId: string,
  swimlaneId: string | null,
  position: number,
  enteredDoneAt: string | null,
) {
  const db = getDb();
  const targets = db
    .prepare('SELECT id, position FROM cards WHERE column_id = ? AND id != ? ORDER BY position')
    .all(columnId, cardId) as { id: string; position: number }[];

  db.exec('BEGIN');
  try {
    targets.splice(position, 0, { id: cardId, position: 0 });
    const update = db.prepare('UPDATE cards SET position = ? WHERE id = ?');
    targets.forEach((row, index) => update.run(index, row.id));
    db.prepare(
      'UPDATE cards SET column_id = ?, swimlane_id = ?, entered_done_at = ?, updated_at = ? WHERE id = ?',
    ).run(columnId, swimlaneId, enteredDoneAt, new Date().toISOString(), cardId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function deleteCard(cardId: string) {
  getDb().prepare('DELETE FROM cards WHERE id = ?').run(cardId);
}

export function listChipIdsForCard(cardId: string): string[] {
  return (getDb().prepare('SELECT chip_id FROM card_chips WHERE card_id = ?').all(cardId) as { chip_id: string }[]).map(
    (r) => r.chip_id,
  );
}

export function setCardChip(cardId: string, chipId: string, on: boolean) {
  const db = getDb();
  if (on) {
    db.prepare('INSERT OR IGNORE INTO card_chips (card_id, chip_id) VALUES (?, ?)').run(cardId, chipId);
  } else {
    db.prepare('DELETE FROM card_chips WHERE card_id = ? AND chip_id = ?').run(cardId, chipId);
  }
}

export function listSubtasks(cardId: string): SubtaskRow[] {
  return getDb().prepare('SELECT * FROM subtasks WHERE card_id = ? ORDER BY position').all(cardId) as unknown as SubtaskRow[];
}

export function findSubtask(subtaskId: string): SubtaskRow | undefined {
  return getDb().prepare('SELECT * FROM subtasks WHERE id = ?').get(subtaskId) as SubtaskRow | undefined;
}

export function addSubtask(cardId: string, text: string): SubtaskRow {
  const db = getDb();
  const id = newId();
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) as p FROM subtasks WHERE card_id = ?').get(cardId) as {
    p: number;
  };
  db.prepare('INSERT INTO subtasks (id, card_id, text, done, position) VALUES (?, ?, ?, 0, ?)').run(
    id,
    cardId,
    text,
    maxPos.p + 1,
  );
  return findSubtask(id)!;
}

export function updateSubtaskText(subtaskId: string, text: string) {
  getDb().prepare('UPDATE subtasks SET text = ? WHERE id = ?').run(text, subtaskId);
}

export function toggleSubtask(subtaskId: string): SubtaskRow {
  const db = getDb();
  const current = findSubtask(subtaskId)!;
  db.prepare('UPDATE subtasks SET done = ? WHERE id = ?').run(current.done ? 0 : 1, subtaskId);
  return findSubtask(subtaskId)!;
}

export function removeSubtask(subtaskId: string) {
  getDb().prepare('DELETE FROM subtasks WHERE id = ?').run(subtaskId);
}

export function resetSubtasksForRecycle(cardId: string) {
  getDb().prepare('UPDATE subtasks SET done = 0 WHERE card_id = ?').run(cardId);
}

export function listLinksForCard(cardId: string): CardLinkRow[] {
  return getDb()
    .prepare('SELECT * FROM card_links WHERE card_a_id = ? OR card_b_id = ?')
    .all(cardId, cardId) as unknown as CardLinkRow[];
}

export function createLink(cardAId: string, cardBId: string, kind: 'related' | 'predecessor'): CardLinkRow {
  const db = getDb();
  const id = newId();
  db.prepare('INSERT INTO card_links (id, card_a_id, card_b_id, kind) VALUES (?, ?, ?, ?)').run(
    id,
    cardAId,
    cardBId,
    kind,
  );
  return db.prepare('SELECT * FROM card_links WHERE id = ?').get(id) as unknown as CardLinkRow;
}

export function deleteLink(linkId: string) {
  getDb().prepare('DELETE FROM card_links WHERE id = ?').run(linkId);
}

export function findLink(linkId: string): CardLinkRow | undefined {
  return getDb().prepare('SELECT * FROM card_links WHERE id = ?').get(linkId) as CardLinkRow | undefined;
}

/** Cards whose assignee is being removed from a board (or deactivated) fall back to unassigned rather than dangling. */
export function unassignCardsForUserOnBoard(boardId: string, userId: string) {
  getDb()
    .prepare('UPDATE cards SET assignee_id = NULL, updated_at = ? WHERE board_id = ? AND assignee_id = ?')
    .run(new Date().toISOString(), boardId, userId);
}

export function unassignCardsForUserEverywhere(userId: string) {
  getDb().prepare('UPDATE cards SET assignee_id = NULL, updated_at = ? WHERE assignee_id = ?').run(
    new Date().toISOString(),
    userId,
  );
}
