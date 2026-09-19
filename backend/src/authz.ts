import type { BoardRole } from '@kanlite/shared';
import type { UserRow } from './db/types.js';
import { findBoardMembership } from './db/repo/boards.js';

/**
 * An App Admin's board rights are computed at request time, never a stored
 * membership row -- see design doc "Users and roles": a board's member list
 * must reflect only explicit members.
 */
export function effectiveBoardRole(user: UserRow, boardId: string): BoardRole | null {
  if (user.global_role === 'app_admin') return 'board_admin';
  const membership = findBoardMembership(boardId, user.id);
  return membership?.board_role ?? null;
}

export function canReadBoard(role: BoardRole | null): boolean {
  return role !== null;
}

export function canWriteBoard(role: BoardRole | null): boolean {
  return role === 'board_admin' || role === 'board_user';
}

export function isBoardAdmin(role: BoardRole | null): boolean {
  return role === 'board_admin';
}
