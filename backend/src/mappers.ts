import type {
  ActivityLogEntryDTO,
  BoardDetailDTO,
  BoardMemberDTO,
  BoardRole,
  BoardSummary,
  CardDTO,
  ChipDTO,
  ColumnDTO,
  CommentDTO,
  RelatedCardDTO,
  SubtaskDTO,
  SwimlaneDTO,
} from '@kanlite/shared';
import type { ActivityLogRow, BoardRow, CardRow, ChipRow, ColumnRow, CommentRow, SubtaskRow, SwimlaneRow } from './db/types.js';
import { listColumns, listSwimlanes, listBoardMembers, boardStats } from './db/repo/boards.js';
import { listChips } from './db/repo/chips.js';
import { listCardsForBoard, listChipIdsForCard, listLinksForCard, listSubtasks, findCard } from './db/repo/cards.js';
import { findUserById } from './db/repo/users.js';
import { daysSince } from './lib/dates.js';

function usernameOf(userId: string | null): string | null {
  if (!userId) return null;
  return findUserById(userId)?.username ?? null;
}

/**
 * Done card visibility window (design doc, Boards / Decision log #10): a
 * pure live display filter, never a state change or deletion -- the card,
 * its comments, and its activity log are all still fully intact and
 * reachable by direct URL or a related-card link. Only excluded from the
 * board's card list (and, via boardStats' own equivalent SQL condition,
 * every count that would otherwise include it).
 */
export function isDoneCardHidden(card: CardRow, board: BoardRow): boolean {
  if (board.done_card_visibility_days <= 0) return false;
  if (card.column_id !== board.done_column_id) return false;
  if (!card.entered_done_at) return false;
  return daysSince(card.entered_done_at) > board.done_card_visibility_days;
}

export function toCardDTO(row: CardRow): CardDTO {
  const links = listLinksForCard(row.id);
  const relatedCards: RelatedCardDTO[] = links.map((link) => {
    if (link.kind === 'related') {
      const otherId = link.card_a_id === row.id ? link.card_b_id : link.card_a_id;
      return { linkId: link.id, cardId: otherId, title: findCard(otherId)?.title ?? '', direction: 'related' };
    }
    if (link.card_a_id === row.id) {
      return { linkId: link.id, cardId: link.card_b_id, title: findCard(link.card_b_id)?.title ?? '', direction: 'successor' };
    }
    return { linkId: link.id, cardId: link.card_a_id, title: findCard(link.card_a_id)?.title ?? '', direction: 'predecessor' };
  });

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    columnId: row.column_id,
    swimlaneId: row.swimlane_id,
    position: row.position,
    chipIds: listChipIdsForCard(row.id),
    assigneeId: row.assignee_id,
    priority: row.priority,
    subtasks: listSubtasks(row.id).map((s) => ({ id: s.id, text: s.text, done: !!s.done, position: s.position })),
    dueDate: row.due_date,
    recurrenceIntervalDays: row.recurrence_interval_days,
    cycleCount: row.cycle_count,
    enteredDoneAt: row.entered_done_at,
    relatedCards,
  };
}

export function toBoardDetailDTO(board: BoardRow, role: BoardRole): BoardDetailDTO {
  const members: BoardMemberDTO[] = listBoardMembers(board.id).map((m) => ({
    userId: m.user_id,
    username: usernameOf(m.user_id) ?? '',
    boardRole: m.board_role,
  }));

  return {
    id: board.id,
    name: board.name,
    archived: !!board.archived,
    myRole: role,
    backlogColumnId: board.backlog_column_id,
    doneColumnId: board.done_column_id,
    reNotifyIntervalDays: board.re_notify_interval_days,
    dailyNotifyTime: board.daily_notify_time,
    recycleDelayHours: board.recycle_delay_hours,
    doneCardVisibilityDays: board.done_card_visibility_days,
    hidePriority: !!board.hide_priority,
    hideAvatar: !!board.hide_avatar,
    columns: listColumns(board.id).map((c) => ({
      id: c.id,
      name: c.name,
      position: c.position,
      doNotNotify: !!c.do_not_notify,
    })),
    swimlanes: listSwimlanes(board.id).map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      active: !!s.active,
    })),
    chips: listChips(board.id).map((c) => ({ id: c.id, name: c.name, color: c.color })),
    members,
    cards: listCardsForBoard(board.id)
      .filter((card) => !isDoneCardHidden(card, board))
      .map(toCardDTO),
  };
}

export function toBoardSummary(board: BoardRow, userId: string, role: BoardRole): BoardSummary {
  return {
    id: board.id,
    name: board.name,
    archived: !!board.archived,
    myRole: role,
    all: boardStats(board.id),
    mine: boardStats(board.id, userId),
  };
}

export function toColumnDTO(row: ColumnRow): ColumnDTO {
  return { id: row.id, name: row.name, position: row.position, doNotNotify: !!row.do_not_notify };
}

export function toSwimlaneDTO(row: SwimlaneRow): SwimlaneDTO {
  return { id: row.id, name: row.name, position: row.position, active: !!row.active };
}

export function toChipDTO(row: ChipRow): ChipDTO {
  return { id: row.id, name: row.name, color: row.color };
}

export function toSubtaskDTO(row: SubtaskRow): SubtaskDTO {
  return { id: row.id, text: row.text, done: !!row.done, position: row.position };
}

export function toCommentDTO(row: CommentRow): CommentDTO {
  return {
    id: row.id,
    authorId: row.author_id,
    authorUsername: usernameOf(row.author_id) ?? '',
    text: row.text,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}

export function toActivityDTO(row: ActivityLogRow): ActivityLogEntryDTO {
  return {
    id: row.id,
    actorId: row.actor_id,
    actorUsername: usernameOf(row.actor_id),
    timestamp: row.timestamp,
    kind: row.kind as ActivityLogEntryDTO['kind'],
    detail: row.detail,
    cycleCount: row.cycle_count ?? undefined,
  };
}
