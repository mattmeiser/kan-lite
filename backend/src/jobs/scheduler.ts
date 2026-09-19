import { config } from '../config.js';
import { addDays, dateInAppTimezone, timeOfDayInAppTimezone } from '../lib/dates.js';
import { listAllBoards } from '../db/repo/boards.js';
import { findUserById } from '../db/repo/users.js';
import {
  findDigestCandidates,
  findRecycleCandidates,
  listBacklogCardsOrdered,
  markCardsNotified,
  recycleCard,
} from '../db/repo/notifications.js';
import { logActivity } from '../db/repo/activityLog.js';
import { purgeExpiredResetTokens } from '../db/repo/resetTokens.js';
import { purgeExpiredSessions } from '../db/repo/sessions.js';
import { sendMail } from '../email/mailer.js';
import type { BoardRow } from '../db/types.js';

// 1 minute, not 5: daily_notify_time has minute granularity, and the tick isn't
// aligned to wall-clock boundaries (it runs every TICK_MS from container-start
// time), so a coarser interval means "how late can a digest be" depends on
// restart phase -- confirmed live, a board set to notify at 19:34 didn't fire
// until 19:36 because the container happened to start at :31:14. A 1-minute
// tick bounds that worst case to under a minute instead of under five.
const TICK_MS = 60 * 1000;

// In-memory only: a missed run right at a restart is an acceptable edge case
// at this app's scale (see design doc, Non-obvious issues -- long-lived
// "remember me" sessions and other tradeoffs made in the same spirit).
const lastDigestDateByBoard = new Map<string, string>();

export function startScheduler() {
  const tick = () => runTick().catch((err) => console.error('[scheduler] tick failed', err));
  tick();
  setInterval(tick, TICK_MS);
}

/** `now` is injectable for tests; production always uses the real clock (startScheduler's default). */
export async function runTick(now: Date = new Date()) {
  // Archived boards are excluded entirely -- no reminders, no recycling (design doc, Boards).
  const boards = listAllBoards(false);
  const currentTime = timeOfDayInAppTimezone(now);
  const today = dateInAppTimezone(now);

  for (const board of boards) {
    // >= rather than === : the tick isn't aligned to wall-clock boundaries, so an exact-equality
    // check can skip straight over the target minute after a restart shifts its phase (confirmed
    // live: a board set to notify at 16:00 got no digest at all because the process's tick landed
    // on 15:57 then 16:02, never exactly 16:00). lastDigestDateByBoard still guarantees at most
    // one send per board per day.
    if (currentTime >= board.daily_notify_time && lastDigestDateByBoard.get(board.id) !== today) {
      lastDigestDateByBoard.set(board.id, today);
      await runDueDateDigestForBoard(board, today);
    }
    runRecurrenceRecycleForBoard(board);
  }

  purgeExpiredResetTokens();
  purgeExpiredSessions();
}

export async function runDueDateDigestForBoard(board: BoardRow, today: string) {
  const candidates = findDigestCandidates(board.id, today);
  const byAssignee = new Map<string, typeof candidates>();
  for (const card of candidates) {
    // Re-notify interval gates repeat reminders; the first reminder on a
    // card's due date always fires since notified_at starts null.
    if (card.notified_at && addDays(card.notified_at, board.re_notify_interval_days) > today) continue;
    const list = byAssignee.get(card.assignee_id) ?? [];
    list.push(card);
    byAssignee.set(card.assignee_id, list);
  }

  for (const [assigneeId, cards] of byAssignee) {
    const user = findUserById(assigneeId);
    if (!user || !user.active) continue;

    const lines = cards
      .map((c) => `- ${c.title} (due ${c.due_date})\n  ${config.appUrl}/boards/${board.id}?card=${c.id}`)
      .join('\n');
    const subject = `KanLite: ${cards.length} card${cards.length === 1 ? '' : 's'} due on ${board.name}`;
    const body = `The following cards on "${board.name}" are due or overdue:\n\n${lines}\n\nOpen KanLite: ${config.appUrl}`;

    try {
      await sendMail(user.email, subject, body);
      // Marked only after the send succeeds -- see design doc, Due-date
      // notifications: a failed send must not drop tomorrow's retry.
      markCardsNotified(cards.map((c) => c.id), today);
    } catch (err) {
      console.error(`[scheduler] failed to send digest to ${user.username}`, err);
    }
  }
}

export function runRecurrenceRecycleForBoard(board: BoardRow) {
  if (!board.done_column_id || !board.backlog_column_id) return;
  const candidates = findRecycleCandidates(board.id, board.done_column_id);
  const delayMs = board.recycle_delay_hours * 60 * 60 * 1000;
  const now = Date.now();

  for (const card of candidates) {
    const enteredDoneMs = new Date(card.entered_done_at!).getTime();
    if (now - enteredDoneMs < delayMs) continue;

    const completionDate = card.entered_done_at!.slice(0, 10);
    const newDueDate = addDays(completionDate, card.recurrence_interval_days!);

    // Insert immediately after the last Backlog card (in current position
    // order) whose due date is on or before the new due date; undated cards
    // never satisfy this, so they always sort after -- see design doc, Cards.
    const backlogCards = listBacklogCardsOrdered(board.backlog_column_id);
    let insertIndex = 0;
    backlogCards.forEach((c, i) => {
      if (c.due_date && c.due_date <= newDueDate) insertIndex = i + 1;
    });

    const result = recycleCard(card, board.backlog_column_id, insertIndex, newDueDate);
    logActivity(
      card.id,
      null,
      'recycle',
      `Recycled to Backlog -- cycle ${result.newCycleCount} -- due ${result.newDueDate}`,
      result.newCycleCount,
    );
  }
}
