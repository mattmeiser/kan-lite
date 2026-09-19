import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAppAdmin, requireAuth } from '../plugins/auth.js';
import { effectiveBoardRole } from '../authz.js';
import {
  createBoard,
  createColumn,
  createSwimlane,
  countCardsInColumn,
  countCardsInSwimlane,
  countPurgeableDoneCards,
  deleteBoard,
  deleteColumn,
  deleteSwimlane,
  findBoardById,
  findColumn,
  findSwimlane,
  listAllBoards,
  listBoardsForUser,
  purgeDoneCardsOlderThan,
  removeBoardMember,
  renameBoard,
  renameColumn,
  renameSwimlane,
  reorderColumns,
  reorderSwimlanes,
  setBoardArchived,
  setBoardMember,
  setColumnDoNotNotify,
  setSwimlaneActive,
  updateBoardSettings,
} from '../db/repo/boards.js';
import { createChip, deleteChip, findChip, updateChip } from '../db/repo/chips.js';
import { findUserByUsername, listUsers } from '../db/repo/users.js';
import { unassignCardsForUserOnBoard } from '../db/repo/cards.js';
import { toBoardDetailDTO, toBoardSummary, toChipDTO, toColumnDTO, toSwimlaneDTO } from '../mappers.js';
import type { BoardRole } from '@kanlite/shared';
import type { BoardRow } from '../db/types.js';

function loadBoard(
  req: FastifyRequest,
  reply: FastifyReply,
  boardId: string,
  minRole: 'reader' | 'user' | 'admin',
): BoardRow | null {
  const board = findBoardById(boardId);
  if (!board) {
    reply.code(404).send({ error: 'Board not found.' });
    return null;
  }
  // An archived board disappears entirely for non-admins, even an explicit
  // member with an old bookmarked URL -- only a dedicated "Archived boards"
  // admin view can reach it (design doc, Boards).
  if (board.archived && req.currentUser!.global_role !== 'app_admin') {
    reply.code(404).send({ error: 'Board not found.' });
    return null;
  }
  const role = effectiveBoardRole(req.currentUser!, boardId);
  const ok =
    (minRole === 'reader' && role !== null) ||
    (minRole === 'user' && (role === 'board_admin' || role === 'board_user')) ||
    (minRole === 'admin' && role === 'board_admin');
  if (!ok) {
    // A user with no membership can't even see the board exists (design doc, Users and roles).
    reply.code(role === null ? 404 : 403).send({ error: role === null ? 'Board not found.' : 'Insufficient board role.' });
    return null;
  }
  return board;
}

export async function boardRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    if (!requireAuth(req, reply)) return reply;
  });

  app.get<{ Querystring: { archived?: string } }>('/api/boards', async (req) => {
    const user = req.currentUser!;
    const isAppAdmin = user.global_role === 'app_admin';
    // Archiving fully hides a board from non-admins -- only an App Admin's
    // dedicated "Archived boards" view can ask for archived=true (design
    // doc, Boards); a non-admin's own request param is ignored, not just
    // defaulted.
    const includeArchived = isAppAdmin && req.query.archived === 'true';
    // An App Admin can see every board, not just ones they're an explicit
    // member of (design doc, Users and roles: "unless they're an App Admin").
    const boards = isAppAdmin ? listAllBoards(includeArchived) : listBoardsForUser(user.id, false);
    return { boards: boards.map((b) => toBoardSummary(b, user.id, effectiveBoardRole(user, b.id)!)) };
  });

  app.post<{ Body: { name: string } }>('/api/boards', async (req, reply) => {
    if (!requireAppAdmin(req, reply)) return;
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: 'Board name is required.' });
    const board = createBoard(name, req.currentUser!.id);
    return toBoardDetailDTO(board, 'board_admin');
  });

  app.get<{ Params: { boardId: string } }>('/api/boards/:boardId', async (req, reply) => {
    const board = loadBoard(req, reply, req.params.boardId, 'reader');
    if (!board) return;
    const role = effectiveBoardRole(req.currentUser!, board.id)!;
    return toBoardDetailDTO(board, role);
  });

  app.patch<{
    Params: { boardId: string };
    Body: {
      name?: string;
      backlogColumnId?: string;
      doneColumnId?: string;
      reNotifyIntervalDays?: number;
      dailyNotifyTime?: string;
      recycleDelayHours?: number;
      doneCardVisibilityDays?: number;
      hidePriority?: boolean;
      hideAvatar?: boolean;
    };
  }>('/api/boards/:boardId', async (req, reply) => {
    const board = loadBoard(req, reply, req.params.boardId, 'admin');
    if (!board) return;
    const body = req.body ?? {};

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) return reply.code(400).send({ error: 'Board name cannot be empty.' });
      renameBoard(board.id, name);
    }

    if (body.backlogColumnId !== undefined || body.doneColumnId !== undefined) {
      // A migrated board starts with both unset (design doc, Migration) and
      // may have them assigned one at a time via separate requests, so this
      // only cross-validates once both sides actually have a value.
      const backlogId = body.backlogColumnId ?? board.backlog_column_id;
      const doneId = body.doneColumnId ?? board.done_column_id;
      if (backlogId && doneId && backlogId === doneId) {
        return reply.code(400).send({ error: 'Backlog and Done must be different columns.' });
      }
      for (const colId of [backlogId, doneId]) {
        if (!colId) continue;
        const col = findColumn(colId);
        if (!col || col.board_id !== board.id) {
          return reply.code(400).send({ error: 'Column does not belong to this board.' });
        }
      }
      updateBoardSettings(board.id, {
        backlogColumnId: backlogId ?? undefined,
        doneColumnId: doneId ?? undefined,
      });
    }

    if (
      body.reNotifyIntervalDays !== undefined ||
      body.dailyNotifyTime !== undefined ||
      body.recycleDelayHours !== undefined ||
      body.doneCardVisibilityDays !== undefined ||
      body.hidePriority !== undefined ||
      body.hideAvatar !== undefined
    ) {
      updateBoardSettings(board.id, {
        reNotifyIntervalDays: body.reNotifyIntervalDays,
        dailyNotifyTime: body.dailyNotifyTime,
        recycleDelayHours: body.recycleDelayHours,
        doneCardVisibilityDays: body.doneCardVisibilityDays,
        hidePriority: body.hidePriority,
        hideAvatar: body.hideAvatar,
      });
    }

    const refreshed = findBoardById(board.id)!;
    return toBoardDetailDTO(refreshed, 'board_admin');
  });

  app.post<{ Params: { boardId: string }; Body: { archived: boolean } }>(
    '/api/boards/:boardId/archive',
    async (req, reply) => {
      if (!requireAppAdmin(req, reply)) return;
      const board = findBoardById(req.params.boardId);
      if (!board) return reply.code(404).send({ error: 'Board not found.' });
      setBoardArchived(board.id, !!req.body?.archived);
      return { success: true };
    },
  );

  app.delete<{ Params: { boardId: string } }>('/api/boards/:boardId', async (req, reply) => {
    if (!requireAppAdmin(req, reply)) return;
    const board = findBoardById(req.params.boardId);
    if (!board) return reply.code(404).send({ error: 'Board not found.' });
    deleteBoard(board.id);
    return { success: true };
  });

  app.get<{ Params: { boardId: string }; Querystring: { days: string } }>(
    '/api/boards/:boardId/purge-done-cards/preview',
    async (req, reply) => {
      if (!requireAppAdmin(req, reply)) return;
      const board = findBoardById(req.params.boardId);
      if (!board) return reply.code(404).send({ error: 'Board not found.' });
      const days = Number(req.query?.days);
      if (!Number.isFinite(days) || days < 0) return reply.code(400).send({ error: 'days must be a non-negative number.' });
      return { count: countPurgeableDoneCards(board.id, days) };
    },
  );

  app.post<{ Params: { boardId: string }; Body: { days: number } }>(
    '/api/boards/:boardId/purge-done-cards',
    async (req, reply) => {
      if (!requireAppAdmin(req, reply)) return;
      const board = findBoardById(req.params.boardId);
      if (!board) return reply.code(404).send({ error: 'Board not found.' });
      const days = Number(req.body?.days);
      if (!Number.isFinite(days) || days < 0) return reply.code(400).send({ error: 'days must be a non-negative number.' });
      const deleted = purgeDoneCardsOlderThan(board.id, days);
      return { deleted };
    },
  );

  // -- Membership --

  // Minimal directory (id + username only, no email/role/active-status) for the
  // "add member" searchable picker -- board_admin doesn't otherwise have access to
  // the full user list, which is app_admin-only (GET /api/users).
  app.get<{ Params: { boardId: string } }>('/api/boards/:boardId/user-directory', async (req, reply) => {
    const board = loadBoard(req, reply, req.params.boardId, 'admin');
    if (!board) return;
    return listUsers()
      .filter((u) => u.active)
      .map((u) => ({ id: u.id, username: u.username }));
  });

  app.put<{ Params: { boardId: string }; Body: { username: string; role: BoardRole } }>(
    '/api/boards/:boardId/members',
    async (req, reply) => {
      const board = loadBoard(req, reply, req.params.boardId, 'admin');
      if (!board) return;
      const { username, role } = req.body ?? ({} as never);
      if (!username || !role) return reply.code(400).send({ error: 'username and role are required.' });
      const user = findUserByUsername(username);
      if (!user) return reply.code(404).send({ error: 'No user with that username.' });
      setBoardMember(board.id, user.id, role);
      return { success: true };
    },
  );

  app.delete<{ Params: { boardId: string; userId: string } }>(
    '/api/boards/:boardId/members/:userId',
    async (req, reply) => {
      const board = loadBoard(req, reply, req.params.boardId, 'admin');
      if (!board) return;
      removeBoardMember(board.id, req.params.userId);
      unassignCardsForUserOnBoard(board.id, req.params.userId);
      return { success: true };
    },
  );

  // -- Columns --

  app.post<{ Params: { boardId: string }; Body: { name: string } }>(
    '/api/boards/:boardId/columns',
    async (req, reply) => {
      const board = loadBoard(req, reply, req.params.boardId, 'admin');
      if (!board) return;
      const name = req.body?.name?.trim();
      if (!name) return reply.code(400).send({ error: 'Column name is required.' });
      return toColumnDTO(createColumn(board.id, name));
    },
  );

  app.patch<{ Params: { boardId: string; columnId: string }; Body: { name?: string; doNotNotify?: boolean } }>(
    '/api/boards/:boardId/columns/:columnId',
    async (req, reply) => {
      const board = loadBoard(req, reply, req.params.boardId, 'admin');
      if (!board) return;
      const column = findColumn(req.params.columnId);
      if (!column || column.board_id !== board.id) return reply.code(404).send({ error: 'Column not found.' });
      if (req.body?.name !== undefined) renameColumn(column.id, req.body.name.trim());
      if (req.body?.doNotNotify !== undefined) setColumnDoNotNotify(column.id, req.body.doNotNotify);
      return { success: true };
    },
  );

  app.post<{ Params: { boardId: string }; Body: { orderedIds: string[] } }>(
    '/api/boards/:boardId/columns/reorder',
    async (req, reply) => {
      const board = loadBoard(req, reply, req.params.boardId, 'admin');
      if (!board) return;
      reorderColumns(board.id, req.body?.orderedIds ?? []);
      return { success: true };
    },
  );

  app.delete<{ Params: { boardId: string; columnId: string } }>(
    '/api/boards/:boardId/columns/:columnId',
    async (req, reply) => {
      const board = loadBoard(req, reply, req.params.boardId, 'admin');
      if (!board) return;
      const column = findColumn(req.params.columnId);
      if (!column || column.board_id !== board.id) return reply.code(404).send({ error: 'Column not found.' });
      if (column.id === board.backlog_column_id || column.id === board.done_column_id) {
        return reply.code(400).send({ error: 'Move the Backlog/Done assignment off this column before deleting it.' });
      }
      if (countCardsInColumn(column.id) > 0) {
        return reply.code(400).send({ error: 'This column still has cards in it.' });
      }
      deleteColumn(column.id);
      return { success: true };
    },
  );

  // -- Swimlanes --

  app.post<{ Params: { boardId: string }; Body: { name: string } }>(
    '/api/boards/:boardId/swimlanes',
    async (req, reply) => {
      const board = loadBoard(req, reply, req.params.boardId, 'admin');
      if (!board) return;
      const name = req.body?.name?.trim();
      if (!name) return reply.code(400).send({ error: 'Swimlane name is required.' });
      return toSwimlaneDTO(createSwimlane(board.id, name));
    },
  );

  app.patch<{ Params: { boardId: string; swimlaneId: string }; Body: { name?: string; active?: boolean } }>(
    '/api/boards/:boardId/swimlanes/:swimlaneId',
    async (req, reply) => {
      const board = loadBoard(req, reply, req.params.boardId, 'admin');
      if (!board) return;
      const swimlane = findSwimlane(req.params.swimlaneId);
      if (!swimlane || swimlane.board_id !== board.id) return reply.code(404).send({ error: 'Swimlane not found.' });
      if (req.body?.name !== undefined) renameSwimlane(swimlane.id, req.body.name.trim());
      if (req.body?.active !== undefined) setSwimlaneActive(swimlane.id, req.body.active);
      return { success: true };
    },
  );

  app.post<{ Params: { boardId: string }; Body: { orderedIds: string[] } }>(
    '/api/boards/:boardId/swimlanes/reorder',
    async (req, reply) => {
      const board = loadBoard(req, reply, req.params.boardId, 'admin');
      if (!board) return;
      reorderSwimlanes(board.id, req.body?.orderedIds ?? []);
      return { success: true };
    },
  );

  app.delete<{ Params: { boardId: string; swimlaneId: string } }>(
    '/api/boards/:boardId/swimlanes/:swimlaneId',
    async (req, reply) => {
      const board = loadBoard(req, reply, req.params.boardId, 'admin');
      if (!board) return;
      const swimlane = findSwimlane(req.params.swimlaneId);
      if (!swimlane || swimlane.board_id !== board.id) return reply.code(404).send({ error: 'Swimlane not found.' });
      if (countCardsInSwimlane(swimlane.id) > 0) {
        return reply.code(400).send({ error: 'This swimlane still has cards in it.' });
      }
      deleteSwimlane(swimlane.id);
      return { success: true };
    },
  );

  // -- Category chips --

  app.post<{ Params: { boardId: string }; Body: { name: string; color: string } }>(
    '/api/boards/:boardId/chips',
    async (req, reply) => {
      const board = loadBoard(req, reply, req.params.boardId, 'admin');
      if (!board) return;
      const name = req.body?.name?.trim();
      if (!name || !req.body?.color) return reply.code(400).send({ error: 'name and color are required.' });
      return toChipDTO(createChip(board.id, name, req.body.color));
    },
  );

  app.patch<{ Params: { boardId: string; chipId: string }; Body: { name?: string; color?: string } }>(
    '/api/boards/:boardId/chips/:chipId',
    async (req, reply) => {
      const board = loadBoard(req, reply, req.params.boardId, 'admin');
      if (!board) return;
      const chip = findChip(req.params.chipId);
      if (!chip || chip.board_id !== board.id) return reply.code(404).send({ error: 'Tag not found.' });
      updateChip(chip.id, req.body ?? {});
      return { success: true };
    },
  );

  app.delete<{ Params: { boardId: string; chipId: string } }>(
    '/api/boards/:boardId/chips/:chipId',
    async (req, reply) => {
      const board = loadBoard(req, reply, req.params.boardId, 'admin');
      if (!board) return;
      const chip = findChip(req.params.chipId);
      if (!chip || chip.board_id !== board.id) return reply.code(404).send({ error: 'Tag not found.' });
      deleteChip(chip.id);
      return { success: true };
    },
  );
}
