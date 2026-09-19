import { getDb } from '../connection.js';
import { newId } from '../../lib/ids.js';
import type { BoardMemberRow, BoardRow, ColumnRow, SwimlaneRow } from '../types.js';
import type { BoardRole, BoardStats } from '@kanlite/shared';
import { addDays, DUE_SOON_WINDOW_DAYS, todayInAppTimezone } from '../../lib/dates.js';

export function findBoardById(id: string): BoardRow | undefined {
  return getDb().prepare('SELECT * FROM boards WHERE id = ?').get(id) as BoardRow | undefined;
}

export function listAllBoards(includeArchived: boolean): BoardRow[] {
  const sql = includeArchived
    ? 'SELECT * FROM boards ORDER BY name COLLATE NOCASE'
    : 'SELECT * FROM boards WHERE archived = 0 ORDER BY name COLLATE NOCASE';
  return getDb().prepare(sql).all() as unknown as BoardRow[];
}

export function listBoardsForUser(userId: string, includeArchived: boolean): BoardRow[] {
  const sql = `
    SELECT boards.* FROM boards
    JOIN board_members ON board_members.board_id = boards.id
    WHERE board_members.user_id = ? ${includeArchived ? '' : 'AND boards.archived = 0'}
    ORDER BY boards.name COLLATE NOCASE
  `;
  return getDb().prepare(sql).all(userId) as unknown as BoardRow[];
}

export function findBoardMembership(boardId: string, userId: string): BoardMemberRow | undefined {
  return getDb()
    .prepare('SELECT * FROM board_members WHERE board_id = ? AND user_id = ?')
    .get(boardId, userId) as BoardMemberRow | undefined;
}

export function listBoardMembers(boardId: string): BoardMemberRow[] {
  return getDb().prepare('SELECT * FROM board_members WHERE board_id = ?').all(boardId) as unknown as BoardMemberRow[];
}

export function setBoardMember(boardId: string, userId: string, role: BoardRole) {
  getDb()
    .prepare(
      `INSERT INTO board_members (board_id, user_id, board_role) VALUES (?, ?, ?)
       ON CONFLICT (board_id, user_id) DO UPDATE SET board_role = excluded.board_role`,
    )
    .run(boardId, userId, role);
}

export function removeBoardMember(boardId: string, userId: string) {
  getDb().prepare('DELETE FROM board_members WHERE board_id = ? AND user_id = ?').run(boardId, userId);
}

export function countBoardAdmins(boardId: string, excludingUserId?: string): number {
  const db = getDb();
  const row = excludingUserId
    ? (db
        .prepare(
          "SELECT COUNT(*) as n FROM board_members WHERE board_id = ? AND board_role = 'board_admin' AND user_id != ?",
        )
        .get(boardId, excludingUserId) as { n: number })
    : (db
        .prepare("SELECT COUNT(*) as n FROM board_members WHERE board_id = ? AND board_role = 'board_admin'")
        .get(boardId) as { n: number });
  return row.n;
}

/** Creates a board pre-seeded with Backlog/In Progress/Done columns and adds `creatorUserId` as an explicit Board Admin. */
export function createBoard(name: string, creatorUserId: string): BoardRow {
  const db = getDb();
  const boardId = newId();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO boards (id, name, archived, backlog_column_id, done_column_id, re_notify_interval_days, daily_notify_time, recycle_delay_hours, created_at)
     VALUES (?, ?, 0, NULL, NULL, 7, '08:00', 24, ?)`,
  ).run(boardId, name, now);

  const backlogId = newId();
  const inProgressId = newId();
  const doneId = newId();
  const insertColumn = db.prepare(
    'INSERT INTO columns (id, board_id, name, position, do_not_notify) VALUES (?, ?, ?, ?, ?)',
  );
  insertColumn.run(backlogId, boardId, 'Backlog', 0, 0);
  insertColumn.run(inProgressId, boardId, 'In Progress', 1, 0);
  insertColumn.run(doneId, boardId, 'Done', 2, 1);

  db.prepare('UPDATE boards SET backlog_column_id = ?, done_column_id = ? WHERE id = ?').run(
    backlogId,
    doneId,
    boardId,
  );

  setBoardMember(boardId, creatorUserId, 'board_admin');

  return findBoardById(boardId)!;
}

export function renameBoard(boardId: string, name: string) {
  getDb().prepare('UPDATE boards SET name = ? WHERE id = ?').run(name, boardId);
}

export function setBoardArchived(boardId: string, archived: boolean) {
  getDb().prepare('UPDATE boards SET archived = ? WHERE id = ?').run(archived ? 1 : 0, boardId);
}

export function deleteBoard(boardId: string) {
  // ON DELETE CASCADE on every child table (columns, swimlanes, chips, cards,
  // board_members, and everything cascading further from cards) handles the
  // "delete cascades to genuinely everything scoped to that board" rule.
  getDb().prepare('DELETE FROM boards WHERE id = ?').run(boardId);
}

export interface BoardSettingsPatch {
  backlogColumnId?: string;
  doneColumnId?: string;
  reNotifyIntervalDays?: number;
  dailyNotifyTime?: string;
  recycleDelayHours?: number;
  doneCardVisibilityDays?: number;
  hidePriority?: boolean;
  hideAvatar?: boolean;
}

export function updateBoardSettings(boardId: string, patch: BoardSettingsPatch) {
  const db = getDb();
  const current = findBoardById(boardId)!;
  db.prepare(
    `UPDATE boards SET backlog_column_id = ?, done_column_id = ?, re_notify_interval_days = ?, daily_notify_time = ?, recycle_delay_hours = ?, done_card_visibility_days = ?, hide_priority = ?, hide_avatar = ?
     WHERE id = ?`,
  ).run(
    patch.backlogColumnId ?? current.backlog_column_id,
    patch.doneColumnId ?? current.done_column_id,
    patch.reNotifyIntervalDays ?? current.re_notify_interval_days,
    patch.dailyNotifyTime ?? current.daily_notify_time,
    patch.recycleDelayHours ?? current.recycle_delay_hours,
    patch.doneCardVisibilityDays ?? current.done_card_visibility_days,
    (patch.hidePriority ?? !!current.hide_priority) ? 1 : 0,
    (patch.hideAvatar ?? !!current.hide_avatar) ? 1 : 0,
    boardId,
  );
}

export function listColumns(boardId: string): ColumnRow[] {
  return getDb().prepare('SELECT * FROM columns WHERE board_id = ? ORDER BY position').all(boardId) as unknown as ColumnRow[];
}

export function findColumn(columnId: string): ColumnRow | undefined {
  return getDb().prepare('SELECT * FROM columns WHERE id = ?').get(columnId) as ColumnRow | undefined;
}

export function createColumn(boardId: string, name: string): ColumnRow {
  const db = getDb();
  const id = newId();
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) as p FROM columns WHERE board_id = ?').get(boardId) as {
    p: number;
  };
  db.prepare('INSERT INTO columns (id, board_id, name, position, do_not_notify) VALUES (?, ?, ?, ?, 0)').run(
    id,
    boardId,
    name,
    maxPos.p + 1,
  );
  return findColumn(id)!;
}

export function renameColumn(columnId: string, name: string) {
  getDb().prepare('UPDATE columns SET name = ? WHERE id = ?').run(name, columnId);
}

export function setColumnDoNotNotify(columnId: string, doNotNotify: boolean) {
  getDb().prepare('UPDATE columns SET do_not_notify = ? WHERE id = ?').run(doNotNotify ? 1 : 0, columnId);
}

export function reorderColumns(boardId: string, orderedIds: string[]) {
  const db = getDb();
  const update = db.prepare('UPDATE columns SET position = ? WHERE id = ? AND board_id = ?');
  orderedIds.forEach((id, index) => update.run(index, id, boardId));
}

export function deleteColumn(columnId: string) {
  getDb().prepare('DELETE FROM columns WHERE id = ?').run(columnId);
}

export function countCardsInColumn(columnId: string): number {
  const row = getDb().prepare('SELECT COUNT(*) as n FROM cards WHERE column_id = ?').get(columnId) as { n: number };
  return row.n;
}

export function listSwimlanes(boardId: string): SwimlaneRow[] {
  return getDb().prepare('SELECT * FROM swimlanes WHERE board_id = ? ORDER BY position').all(boardId) as unknown as SwimlaneRow[];
}

export function findSwimlane(swimlaneId: string): SwimlaneRow | undefined {
  return getDb().prepare('SELECT * FROM swimlanes WHERE id = ?').get(swimlaneId) as SwimlaneRow | undefined;
}

export function createSwimlane(boardId: string, name: string): SwimlaneRow {
  const db = getDb();
  const activeCountBefore = (
    db.prepare('SELECT COUNT(*) as n FROM swimlanes WHERE board_id = ? AND active = 1').get(boardId) as { n: number }
  ).n;
  const id = newId();
  const maxPos = db
    .prepare('SELECT COALESCE(MAX(position), -1) as p FROM swimlanes WHERE board_id = ?')
    .get(boardId) as { p: number };
  db.prepare('INSERT INTO swimlanes (id, board_id, name, position, active) VALUES (?, ?, ?, ?, 1)').run(
    id,
    boardId,
    name,
    maxPos.p + 1,
  );

  // Crossing from <=1 to 2+ active swimlanes: existing null-swimlane cards
  // land in the first (lowest-position) swimlane automatically rather than
  // needing manual reassignment (design doc, Boards). Only the exact 1->2
  // transition qualifies -- going from 0 to 1 doesn't cross the threshold
  // (a board with exactly one swimlane still behaves like it has none).
  if (activeCountBefore === 1) {
    const first = listSwimlanes(boardId).find((s) => s.active);
    if (first) {
      db.prepare('UPDATE cards SET swimlane_id = ? WHERE board_id = ? AND swimlane_id IS NULL').run(first.id, boardId);
    }
  }

  return findSwimlane(id)!;
}

export function renameSwimlane(swimlaneId: string, name: string) {
  getDb().prepare('UPDATE swimlanes SET name = ? WHERE id = ?').run(name, swimlaneId);
}

export function setSwimlaneActive(swimlaneId: string, active: boolean) {
  getDb().prepare('UPDATE swimlanes SET active = ? WHERE id = ?').run(active ? 1 : 0, swimlaneId);
}

export function reorderSwimlanes(boardId: string, orderedIds: string[]) {
  const db = getDb();
  const update = db.prepare('UPDATE swimlanes SET position = ? WHERE id = ? AND board_id = ?');
  orderedIds.forEach((id, index) => update.run(index, id, boardId));
}

export function deleteSwimlane(swimlaneId: string) {
  getDb().prepare('DELETE FROM swimlanes WHERE id = ?').run(swimlaneId);
}

/** Overdue/due-soon counts are a literal count regardless of do-not-notify flags (design doc, Decision log #8). */
export function boardStats(boardId: string, assigneeId?: string): BoardStats {
  const db = getDb();
  const board = findBoardById(boardId)!;
  const today = todayInAppTimezone();
  const dueSoonEnd = addDays(today, DUE_SOON_WINDOW_DAYS);
  const params: (string | number)[] = [today, today, dueSoonEnd, boardId];
  // Cards hidden by the board's done-card visibility window are excluded
  // from every count, not just the card list (design doc, Boards / Decision
  // log #10), via the same rule as isDoneCardHidden() in mappers.ts.
  let sql = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN due_date IS NOT NULL AND due_date <= ? THEN 1 ELSE 0 END) as overdue,
      SUM(CASE WHEN due_date IS NOT NULL AND due_date > ? AND due_date <= ? THEN 1 ELSE 0 END) as dueSoon
    FROM cards
    WHERE board_id = ?
      AND NOT (
        ? > 0 AND column_id = ? AND entered_done_at IS NOT NULL
        AND (julianday('now') - julianday(entered_done_at)) > ?
      )
  `;
  params.push(board.done_card_visibility_days, board.done_column_id ?? '', board.done_card_visibility_days);
  if (assigneeId) {
    sql += ' AND assignee_id = ?';
    params.push(assigneeId);
  }
  const row = db.prepare(sql).get(...params) as { total: number; overdue: number | null; dueSoon: number | null };
  return { total: row.total, overdue: row.overdue ?? 0, dueSoon: row.dueSoon ?? 0 };
}

/**
 * A recurring card reuses the same row to keep accumulating cycle history and to recycle again
 * later, unlike an ordinary finished card that has nothing left to do after Done -- purging one
 * would destroy both, so recurring cards are always excluded (design doc, REVIEW.md #25).
 */
const PURGEABLE_DONE_CARDS_WHERE = `
  board_id = ? AND column_id = ? AND entered_done_at IS NOT NULL AND recurrence_interval_days IS NULL
    AND (julianday('now') - julianday(entered_done_at)) > ?
`;

/** Preview count for the purge-done-cards action, shown before the confirm click (design doc, REVIEW.md #26). */
export function countPurgeableDoneCards(boardId: string, days: number): number {
  const board = findBoardById(boardId)!;
  if (!board.done_column_id) return 0;
  const row = getDb().prepare(`SELECT COUNT(*) as n FROM cards WHERE ${PURGEABLE_DONE_CARDS_WHERE}`).get(
    boardId,
    board.done_column_id,
    days,
  ) as { n: number };
  return row.n;
}

/**
 * Permanently deletes every Done card older than `days` (by the same "entered Done" timestamp the
 * visibility window and recycle job already use), excluding recurring cards -- a deliberate,
 * explicit action distinct from the done-card visibility window, which only ever hides cards,
 * never deletes them (design doc, Decision log #10). Cascades to the card's own chips/subtasks/
 * comments/activity log via ON DELETE CASCADE. Requires the board to have a Done column assigned;
 * returns 0 without touching anything otherwise.
 */
export function purgeDoneCardsOlderThan(boardId: string, days: number): number {
  const db = getDb();
  const board = findBoardById(boardId)!;
  if (!board.done_column_id) return 0;
  const result = db.prepare(`DELETE FROM cards WHERE ${PURGEABLE_DONE_CARDS_WHERE}`).run(boardId, board.done_column_id, days);
  return Number(result.changes);
}

export function countCardsInSwimlane(swimlaneId: string): number {
  const row = getDb().prepare('SELECT COUNT(*) as n FROM cards WHERE swimlane_id = ?').get(swimlaneId) as {
    n: number;
  };
  return row.n;
}
