import { describe, expect, it } from 'vitest';
import { useTestDb } from '../test/setupTestDb.js';
import { createUser } from '../db/repo/users.js';
import { createBoard, findBoardById, setBoardMember, updateBoardSettings } from '../db/repo/boards.js';
import {
  addSubtask,
  createCard,
  findCard,
  listCardsForBoard,
  listSubtasks,
  moveCard,
  toggleSubtask,
  updateCardFields,
} from '../db/repo/cards.js';
import { listActivity } from '../db/repo/activityLog.js';
import { markCardsNotified } from '../db/repo/notifications.js';
import { runDueDateDigestForBoard, runRecurrenceRecycleForBoard, runTick } from './scheduler.js';
import { addDays, todayInAppTimezone } from '../lib/dates.js';

function setupBoard() {
  const admin = createUser({ username: 'admin', email: 'admin@x.com', passwordHash: 'h', globalRole: 'app_admin' });
  const board = createBoard('Chores', admin.id);
  return { admin, board: findBoardById(board.id)! };
}

/** Puts a card in Done with entered_done_at backdated far enough to always clear the recycle delay. */
function completeCardLongAgo(cardId: string, doneColumnId: string) {
  moveCard(cardId, doneColumnId, null, 0, new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString());
}

describe('runRecurrenceRecycleForBoard', () => {
  useTestDb();

  it('recalculates due date as completion time + interval, increments cycle count, resets subtasks', () => {
    const { board } = setupBoard();
    const card = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Water plants' });
    updateCardFields(card.id, { recurrenceIntervalDays: 7 });
    addSubtask(card.id, 'Check soil');
    const subtask = addSubtask(card.id, 'Refill can');
    toggleSubtask(subtask.id);

    const completedAt = '2026-06-01T12:00:00.000Z';
    moveCard(card.id, board.done_column_id!, null, 0, completedAt);

    runRecurrenceRecycleForBoard(findBoardById(board.id)!);

    const recycled = findCard(card.id)!;
    expect(recycled.column_id).toBe(board.backlog_column_id);
    expect(recycled.due_date).toBe('2026-06-08');
    expect(recycled.cycle_count).toBe(1);
    expect(recycled.entered_done_at).toBeNull();
    expect(listSubtasks(card.id).every((s) => !s.done)).toBe(true);
  });

  it('does not touch a card still within the recycle delay window', () => {
    const { board } = setupBoard();
    const card = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Water plants' });
    updateCardFields(card.id, { recurrenceIntervalDays: 7 });
    moveCard(card.id, board.done_column_id!, null, 0, new Date().toISOString());

    runRecurrenceRecycleForBoard(findBoardById(board.id)!);

    const untouched = findCard(card.id)!;
    expect(untouched.column_id).toBe(board.done_column_id);
    expect(untouched.cycle_count).toBe(0);
  });

  it('leaves a Done card with no recurrence interval alone', () => {
    const { board } = setupBoard();
    const card = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'One-off task' });
    completeCardLongAgo(card.id, board.done_column_id!);

    runRecurrenceRecycleForBoard(findBoardById(board.id)!);

    expect(findCard(card.id)!.column_id).toBe(board.done_column_id);
  });

  it('logs a distinct "recycle" activity entry with the new cycle count', () => {
    const { board } = setupBoard();
    const card = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Water plants' });
    updateCardFields(card.id, { recurrenceIntervalDays: 3 });
    completeCardLongAgo(card.id, board.done_column_id!);

    runRecurrenceRecycleForBoard(findBoardById(board.id)!);

    const entries = listActivity(card.id, 5);
    expect(entries[0].kind).toBe('recycle');
    expect(entries[0].cycle_count).toBe(1);
  });

  it('inserts after the last Backlog card (in position order) due on or before the new due date, sorting undated cards last', () => {
    const { board } = setupBoard();

    // Existing Backlog cards, in position order: dated (early), dated (late), undated.
    const early = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Early' });
    updateCardFields(early.id, { dueDate: '2026-06-01' });
    const late = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Late' });
    updateCardFields(late.id, { dueDate: '2026-06-10' });
    const undated = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Undated' });

    const recurring = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Recurring' });
    updateCardFields(recurring.id, { recurrenceIntervalDays: 7 });
    // Completion date 2026-06-01 + 7 days = 2026-06-08 -- lands between "Early" (06-01) and "Late" (06-10).
    moveCard(recurring.id, board.done_column_id!, null, 0, '2026-06-01T00:00:00.000Z');
    // Backdate far enough to clear any recycle delay regardless of board default.
    updateBoardSettings(board.id, { recycleDelayHours: 0 });

    runRecurrenceRecycleForBoard(findBoardById(board.id)!);

    const backlogOrder = listCardsForBoard(board.id)
      .filter((c) => c.column_id === board.backlog_column_id)
      .sort((a, b) => a.position - b.position)
      .map((c) => c.title);

    expect(backlogOrder).toEqual(['Early', 'Recurring', 'Late', 'Undated']);
  });
});

describe('runDueDateDigestForBoard', () => {
  useTestDb();

  it('only includes cards due today or overdue, not sitting in a do-not-notify column, with an assignee', async () => {
    const { board } = setupBoard();
    const user = createUser({ username: 'kid', email: 'kid@x.com', passwordHash: 'h', globalRole: 'app_user' });
    setBoardMember(board.id, user.id, 'board_user');
    const today = todayInAppTimezone();

    const dueToday = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Due today' });
    updateCardFields(dueToday.id, { dueDate: today, assigneeId: user.id });

    const futureDue = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Future' });
    updateCardFields(futureDue.id, { dueDate: addDays(today, 5), assigneeId: user.id });

    const unassigned = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Unassigned overdue' });
    updateCardFields(unassigned.id, { dueDate: addDays(today, -3) });

    const inDoneOverdue = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Already done' });
    updateCardFields(inDoneOverdue.id, { dueDate: addDays(today, -1), assigneeId: user.id });
    moveCard(inDoneOverdue.id, board.done_column_id!, null, 0, new Date().toISOString());

    await runDueDateDigestForBoard(findBoardById(board.id)!, today);

    expect(findCard(dueToday.id)!.notified_at).toBe(today);
    expect(findCard(futureDue.id)!.notified_at).toBeNull();
    expect(findCard(unassigned.id)!.notified_at).toBeNull();
    expect(findCard(inDoneOverdue.id)!.notified_at).toBeNull();
  });

  it('does not re-notify a card until the board\'s re-notify interval has elapsed', async () => {
    const { board } = setupBoard();
    const user = createUser({ username: 'kid', email: 'kid@x.com', passwordHash: 'h', globalRole: 'app_user' });
    setBoardMember(board.id, user.id, 'board_user');
    updateBoardSettings(board.id, { reNotifyIntervalDays: 7 });

    const today = todayInAppTimezone();
    const card = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Overdue' });
    updateCardFields(card.id, { dueDate: addDays(today, -10), assigneeId: user.id });

    await runDueDateDigestForBoard(findBoardById(board.id)!, today);
    expect(findCard(card.id)!.notified_at).toBe(today);

    // Simulate "yesterday" by resetting notified_at to a date within the interval.
    markCardsNotified([card.id], addDays(today, -2));

    await runDueDateDigestForBoard(findBoardById(board.id)!, today);
    // Still within the 7-day window since the 2-days-ago mark -- should not have been touched again to `today`.
    expect(findCard(card.id)!.notified_at).toBe(addDays(today, -2));
  });
});

describe('runTick scheduling', () => {
  useTestDb();

  function setupOverdueCardBoard(dailyNotifyTime: string) {
    const { board } = setupBoard();
    const user = createUser({ username: 'kid', email: 'kid@x.com', passwordHash: 'h', globalRole: 'app_user' });
    setBoardMember(board.id, user.id, 'board_user');
    updateBoardSettings(board.id, { dailyNotifyTime });
    const card = createCard({ boardId: board.id, columnId: board.backlog_column_id!, swimlaneId: null, title: 'Overdue' });
    updateCardFields(card.id, { dueDate: '2020-01-01', assigneeId: user.id });
    return { board: findBoardById(board.id)!, card };
  }

  it("does not send the digest before the board's daily notify time", async () => {
    const { card } = setupOverdueCardBoard('16:00');

    await runTick(new Date('2026-06-15T15:55:00.000Z'));

    expect(findCard(card.id)!.notified_at).toBeNull();
  });

  it('sends the digest once the clock passes the notify time, even without landing exactly on it', async () => {
    // Regression test: runTick's interval isn't aligned to wall-clock boundaries, so after a
    // server restart its tick can land on e.g. 15:58 then 16:03, skipping straight over an
    // exact "16:00" match and silently never sending that day's digest at all.
    const { card } = setupOverdueCardBoard('16:00');

    await runTick(new Date('2026-06-15T15:58:00.000Z'));
    expect(findCard(card.id)!.notified_at).toBeNull();

    await runTick(new Date('2026-06-15T16:03:00.000Z'));
    expect(findCard(card.id)!.notified_at).toBe('2026-06-15');
  });

  it('only sends once per board per day even across multiple ticks past the notify time', async () => {
    const { card } = setupOverdueCardBoard('16:00');

    await runTick(new Date('2026-06-15T16:03:00.000Z'));
    expect(findCard(card.id)!.notified_at).toBe('2026-06-15');

    // Reset notified_at directly so a second, unwanted send within the same day would be visible.
    markCardsNotified([card.id], '2000-01-01');
    await runTick(new Date('2026-06-15T16:08:00.000Z'));
    expect(findCard(card.id)!.notified_at).toBe('2000-01-01');
  });
});
