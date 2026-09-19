import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '../plugins/auth.js';
import { effectiveBoardRole, canWriteBoard, isBoardAdmin } from '../authz.js';
import { findBoardById, findColumn, findSwimlane, findBoardMembership } from '../db/repo/boards.js';
import { findChip } from '../db/repo/chips.js';
import {
  addSubtask,
  createCard,
  createLink,
  deleteCard,
  deleteLink,
  findCard,
  findLink,
  findSubtask,
  moveCard,
  removeSubtask,
  setCardChip,
  toggleSubtask,
  updateCardFields,
  updateSubtaskText,
  type CardFieldPatch,
} from '../db/repo/cards.js';
import {
  createComment,
  deleteComment,
  findComment,
  listComments,
  updateComment,
} from '../db/repo/comments.js';
import { listActivity, logActivity } from '../db/repo/activityLog.js';
import { toActivityDTO, toCardDTO, toCommentDTO, toSubtaskDTO } from '../mappers.js';
import type { BoardRow, CardRow } from '../db/types.js';
import type { Priority } from '@kanlite/shared';

const PAGE_SIZE = 15;

interface Loaded {
  board: BoardRow;
  card: CardRow;
  role: 'board_admin' | 'board_user' | 'board_reader';
}

function loadCard(req: FastifyRequest, reply: FastifyReply, boardId: string, cardId: string): Loaded | null {
  const board = findBoardById(boardId);
  if (board?.archived && req.currentUser!.global_role !== 'app_admin') {
    reply.code(404).send({ error: 'Board not found.' });
    return null;
  }
  const role = board ? effectiveBoardRole(req.currentUser!, boardId) : null;
  if (!board || !role) {
    reply.code(404).send({ error: 'Board not found.' });
    return null;
  }
  const card = findCard(cardId);
  if (!card || card.board_id !== boardId) {
    reply.code(404).send({ error: 'Card not found.' });
    return null;
  }
  return { board, card, role };
}

function requireWrite(role: string, reply: FastifyReply): boolean {
  if (!canWriteBoard(role as 'board_admin' | 'board_user' | 'board_reader')) {
    reply.code(403).send({ error: 'Board Reader cannot make changes.' });
    return false;
  }
  return true;
}

export async function cardRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    if (!requireAuth(req, reply)) return reply;
  });

  app.post<{ Params: { boardId: string }; Body: { columnId: string; swimlaneId?: string | null; title: string } }>(
    '/api/boards/:boardId/cards',
    async (req, reply) => {
      const board = findBoardById(req.params.boardId);
      if (board?.archived && req.currentUser!.global_role !== 'app_admin') {
        return reply.code(404).send({ error: 'Board not found.' });
      }
      const role = board ? effectiveBoardRole(req.currentUser!, board.id) : null;
      if (!board || !role) return reply.code(404).send({ error: 'Board not found.' });
      if (!requireWrite(role, reply)) return;

      const title = req.body?.title?.trim();
      if (!title) return reply.code(400).send({ error: 'Title is required.' });
      const column = findColumn(req.body.columnId);
      if (!column || column.board_id !== board.id) {
        return reply.code(400).send({ error: 'Column does not belong to this board.' });
      }
      if (req.body.swimlaneId) {
        const swimlane = findSwimlane(req.body.swimlaneId);
        if (!swimlane || swimlane.board_id !== board.id) {
          return reply.code(400).send({ error: 'Swimlane does not belong to this board.' });
        }
      }

      const card = createCard({
        boardId: board.id,
        columnId: column.id,
        swimlaneId: req.body.swimlaneId ?? null,
        title,
        assigneeId: req.currentUser!.id,
      });
      logActivity(card.id, req.currentUser!.id, 'create', `created the card`);
      return toCardDTO(card);
    },
  );

  app.get<{ Params: { boardId: string; cardId: string } }>(
    '/api/boards/:boardId/cards/:cardId',
    async (req, reply) => {
      const loaded = loadCard(req, reply, req.params.boardId, req.params.cardId);
      if (!loaded) return;
      return toCardDTO(loaded.card);
    },
  );

  app.patch<{
    Params: { boardId: string; cardId: string };
    Body: {
      title?: string;
      description?: string;
      assigneeId?: string | null;
      priority?: Priority;
      dueDate?: string | null;
      recurrenceIntervalDays?: number | null;
    };
  }>('/api/boards/:boardId/cards/:cardId', async (req, reply) => {
    const loaded = loadCard(req, reply, req.params.boardId, req.params.cardId);
    if (!loaded) return;
    if (!requireWrite(loaded.role, reply)) return;
    const { board, card } = loaded;
    const body = req.body ?? {};

    if (body.assigneeId) {
      const membership = findBoardMembership(board.id, body.assigneeId);
      if (!membership) {
        return reply.code(400).send({ error: 'Assignee must be an explicit member of this board.' });
      }
    }

    const patch: CardFieldPatch = body;
    updateCardFields(card.id, patch);

    const actorId = req.currentUser!.id;
    if (body.title !== undefined && body.title !== card.title) {
      logActivity(card.id, actorId, 'field_edit', `changed title to "${body.title}"`);
    }
    if (body.description !== undefined && body.description !== card.description) {
      logActivity(card.id, actorId, 'field_edit', 'edited the description');
    }
    if (body.assigneeId !== undefined && body.assigneeId !== card.assignee_id) {
      logActivity(card.id, actorId, 'field_edit', body.assigneeId ? 'changed the assignee' : 'unassigned the card');
    }
    if (body.priority !== undefined && body.priority !== card.priority) {
      logActivity(card.id, actorId, 'field_edit', `changed priority to ${body.priority}`);
    }
    if (body.dueDate !== undefined && body.dueDate !== card.due_date) {
      logActivity(card.id, actorId, 'field_edit', body.dueDate ? `changed due date to ${body.dueDate}` : 'cleared the due date');
    }
    if (body.recurrenceIntervalDays !== undefined && body.recurrenceIntervalDays !== card.recurrence_interval_days) {
      logActivity(
        card.id,
        actorId,
        'field_edit',
        body.recurrenceIntervalDays ? `set recurrence to every ${body.recurrenceIntervalDays} day(s)` : 'turned off recurrence',
      );
    }

    return toCardDTO(findCard(card.id)!);
  });

  app.post<{
    Params: { boardId: string; cardId: string };
    Body: { columnId: string; swimlaneId?: string | null; position: number };
  }>('/api/boards/:boardId/cards/:cardId/move', async (req, reply) => {
    const loaded = loadCard(req, reply, req.params.boardId, req.params.cardId);
    if (!loaded) return;
    if (!requireWrite(loaded.role, reply)) return;
    const { board, card } = loaded;

    const column = findColumn(req.body.columnId);
    if (!column || column.board_id !== board.id) {
      return reply.code(400).send({ error: 'Column does not belong to this board.' });
    }
    if (req.body.swimlaneId) {
      const swimlane = findSwimlane(req.body.swimlaneId);
      if (!swimlane || swimlane.board_id !== board.id) {
        return reply.code(400).send({ error: 'Swimlane does not belong to this board.' });
      }
    }

    const enteringDone = column.id === board.done_column_id && card.column_id !== board.done_column_id;
    const leavingDone = column.id !== board.done_column_id && card.column_id === board.done_column_id;
    const enteredDoneAt = enteringDone ? new Date().toISOString() : leavingDone ? null : card.entered_done_at;

    moveCard(card.id, column.id, req.body.swimlaneId ?? null, req.body.position, enteredDoneAt);

    const actorId = req.currentUser!.id;
    if (enteringDone) {
      logActivity(card.id, actorId, 'completion', `completed (cycle ${card.cycle_count})`, card.cycle_count);
    } else {
      logActivity(card.id, actorId, 'move', `moved to ${column.name}`);
    }

    return toCardDTO(findCard(card.id)!);
  });

  app.delete<{ Params: { boardId: string; cardId: string } }>(
    '/api/boards/:boardId/cards/:cardId',
    async (req, reply) => {
      const loaded = loadCard(req, reply, req.params.boardId, req.params.cardId);
      if (!loaded) return;
      if (!requireWrite(loaded.role, reply)) return;
      deleteCard(loaded.card.id);
      return { success: true };
    },
  );

  // -- Chips --

  app.post<{ Params: { boardId: string; cardId: string }; Body: { chipId: string } }>(
    '/api/boards/:boardId/cards/:cardId/chips',
    async (req, reply) => {
      const loaded = loadCard(req, reply, req.params.boardId, req.params.cardId);
      if (!loaded) return;
      if (!requireWrite(loaded.role, reply)) return;
      const chip = findChip(req.body.chipId);
      if (!chip || chip.board_id !== loaded.board.id) {
        return reply.code(400).send({ error: 'Tag does not belong to this board.' });
      }
      setCardChip(loaded.card.id, chip.id, true);
      logActivity(loaded.card.id, req.currentUser!.id, 'field_edit', `added the "${chip.name}" tag`);
      return toCardDTO(findCard(loaded.card.id)!);
    },
  );

  app.delete<{ Params: { boardId: string; cardId: string; chipId: string } }>(
    '/api/boards/:boardId/cards/:cardId/chips/:chipId',
    async (req, reply) => {
      const loaded = loadCard(req, reply, req.params.boardId, req.params.cardId);
      if (!loaded) return;
      if (!requireWrite(loaded.role, reply)) return;
      const chip = findChip(req.params.chipId);
      setCardChip(loaded.card.id, req.params.chipId, false);
      if (chip) logActivity(loaded.card.id, req.currentUser!.id, 'field_edit', `removed the "${chip.name}" tag`);
      return toCardDTO(findCard(loaded.card.id)!);
    },
  );

  // -- Subtasks --

  app.post<{ Params: { boardId: string; cardId: string }; Body: { text: string } }>(
    '/api/boards/:boardId/cards/:cardId/subtasks',
    async (req, reply) => {
      const loaded = loadCard(req, reply, req.params.boardId, req.params.cardId);
      if (!loaded) return;
      if (!requireWrite(loaded.role, reply)) return;
      const text = req.body?.text?.trim();
      if (!text) return reply.code(400).send({ error: 'Subtask text is required.' });
      const subtask = addSubtask(loaded.card.id, text);
      logActivity(loaded.card.id, req.currentUser!.id, 'field_edit', `added subtask "${text}"`);
      return toSubtaskDTO(subtask);
    },
  );

  app.patch<{ Params: { boardId: string; cardId: string; subtaskId: string }; Body: { text: string } }>(
    '/api/boards/:boardId/cards/:cardId/subtasks/:subtaskId',
    async (req, reply) => {
      const loaded = loadCard(req, reply, req.params.boardId, req.params.cardId);
      if (!loaded) return;
      if (!requireWrite(loaded.role, reply)) return;
      const subtask = findSubtask(req.params.subtaskId);
      if (!subtask || subtask.card_id !== loaded.card.id) return reply.code(404).send({ error: 'Subtask not found.' });
      const text = req.body?.text?.trim();
      if (!text) return reply.code(400).send({ error: 'Subtask text is required.' });
      updateSubtaskText(subtask.id, text);
      logActivity(loaded.card.id, req.currentUser!.id, 'field_edit', `edited subtask to "${text}"`);
      return { success: true };
    },
  );

  app.post<{ Params: { boardId: string; cardId: string; subtaskId: string } }>(
    '/api/boards/:boardId/cards/:cardId/subtasks/:subtaskId/toggle',
    async (req, reply) => {
      const loaded = loadCard(req, reply, req.params.boardId, req.params.cardId);
      if (!loaded) return;
      if (!requireWrite(loaded.role, reply)) return;
      const subtask = findSubtask(req.params.subtaskId);
      if (!subtask || subtask.card_id !== loaded.card.id) return reply.code(404).send({ error: 'Subtask not found.' });
      const updated = toggleSubtask(subtask.id);
      logActivity(
        loaded.card.id,
        req.currentUser!.id,
        'field_edit',
        `${updated.done ? 'checked' : 'unchecked'} subtask "${updated.text}"`,
      );
      return toSubtaskDTO(updated);
    },
  );

  app.delete<{ Params: { boardId: string; cardId: string; subtaskId: string } }>(
    '/api/boards/:boardId/cards/:cardId/subtasks/:subtaskId',
    async (req, reply) => {
      const loaded = loadCard(req, reply, req.params.boardId, req.params.cardId);
      if (!loaded) return;
      if (!requireWrite(loaded.role, reply)) return;
      const subtask = findSubtask(req.params.subtaskId);
      if (!subtask || subtask.card_id !== loaded.card.id) return reply.code(404).send({ error: 'Subtask not found.' });
      removeSubtask(subtask.id);
      logActivity(loaded.card.id, req.currentUser!.id, 'field_edit', `removed subtask "${subtask.text}"`);
      return { success: true };
    },
  );

  // -- Related cards --
  // `relation` describes the link from the *current* card's point of view:
  // symmetric 'related', or this card preceding/following the other one.
  app.post<{
    Params: { boardId: string; cardId: string };
    Body: { otherCardId: string; relation: 'related' | 'this_precedes_that' | 'this_follows_that' };
  }>('/api/boards/:boardId/cards/:cardId/links', async (req, reply) => {
    const loaded = loadCard(req, reply, req.params.boardId, req.params.cardId);
    if (!loaded) return;
    if (!requireWrite(loaded.role, reply)) return;
    const other = findCard(req.body.otherCardId);
    if (!other || other.board_id !== loaded.board.id || other.id === loaded.card.id) {
      return reply.code(400).send({ error: 'Related card must be a different card on the same board.' });
    }

    const link =
      req.body.relation === 'related'
        ? createLink(loaded.card.id, other.id, 'related')
        : req.body.relation === 'this_precedes_that'
          ? createLink(loaded.card.id, other.id, 'predecessor')
          : createLink(other.id, loaded.card.id, 'predecessor');

    logActivity(loaded.card.id, req.currentUser!.id, 'field_edit', `linked to "${other.title}"`);
    return { success: true, linkId: link.id };
  });

  app.delete<{ Params: { boardId: string; cardId: string; linkId: string } }>(
    '/api/boards/:boardId/cards/:cardId/links/:linkId',
    async (req, reply) => {
      const loaded = loadCard(req, reply, req.params.boardId, req.params.cardId);
      if (!loaded) return;
      if (!requireWrite(loaded.role, reply)) return;
      const link = findLink(req.params.linkId);
      if (!link || (link.card_a_id !== loaded.card.id && link.card_b_id !== loaded.card.id)) {
        return reply.code(404).send({ error: 'Link not found.' });
      }
      deleteLink(link.id);
      logActivity(loaded.card.id, req.currentUser!.id, 'field_edit', 'removed a related-card link');
      return { success: true };
    },
  );

  // -- Comments --

  app.get<{ Params: { boardId: string; cardId: string }; Querystring: { before?: string } }>(
    '/api/boards/:boardId/cards/:cardId/comments',
    async (req, reply) => {
      const loaded = loadCard(req, reply, req.params.boardId, req.params.cardId);
      if (!loaded) return;
      return { comments: listComments(loaded.card.id, PAGE_SIZE, req.query.before).map(toCommentDTO) };
    },
  );

  app.post<{ Params: { boardId: string; cardId: string }; Body: { text: string } }>(
    '/api/boards/:boardId/cards/:cardId/comments',
    async (req, reply) => {
      const loaded = loadCard(req, reply, req.params.boardId, req.params.cardId);
      if (!loaded) return;
      if (!requireWrite(loaded.role, reply)) return;
      const text = req.body?.text?.trim();
      if (!text) return reply.code(400).send({ error: 'Comment text is required.' });
      const comment = createComment(loaded.card.id, req.currentUser!.id, text);
      logActivity(loaded.card.id, req.currentUser!.id, 'comment_posted', 'posted a comment');
      return toCommentDTO(comment);
    },
  );

  app.patch<{ Params: { boardId: string; cardId: string; commentId: string }; Body: { text: string } }>(
    '/api/boards/:boardId/cards/:cardId/comments/:commentId',
    async (req, reply) => {
      const loaded = loadCard(req, reply, req.params.boardId, req.params.cardId);
      if (!loaded) return;
      const comment = findComment(req.params.commentId);
      if (!comment || comment.card_id !== loaded.card.id) return reply.code(404).send({ error: 'Comment not found.' });
      if (comment.author_id !== req.currentUser!.id) {
        return reply.code(403).send({ error: 'You can only edit your own comments.' });
      }
      const text = req.body?.text?.trim();
      if (!text) return reply.code(400).send({ error: 'Comment text is required.' });
      updateComment(comment.id, text);
      logActivity(loaded.card.id, req.currentUser!.id, 'comment_edited', 'edited a comment');
      return toCommentDTO(findComment(comment.id)!);
    },
  );

  app.delete<{ Params: { boardId: string; cardId: string; commentId: string } }>(
    '/api/boards/:boardId/cards/:cardId/comments/:commentId',
    async (req, reply) => {
      const loaded = loadCard(req, reply, req.params.boardId, req.params.cardId);
      if (!loaded) return;
      const comment = findComment(req.params.commentId);
      if (!comment || comment.card_id !== loaded.card.id) return reply.code(404).send({ error: 'Comment not found.' });
      const isOwn = comment.author_id === req.currentUser!.id;
      if (!isOwn && !isBoardAdmin(loaded.role)) {
        return reply.code(403).send({ error: 'Only the author or a Board Admin can delete this comment.' });
      }
      deleteComment(comment.id);
      logActivity(loaded.card.id, req.currentUser!.id, 'comment_deleted', 'deleted a comment');
      return { success: true };
    },
  );

  // -- Activity log --

  app.get<{ Params: { boardId: string; cardId: string }; Querystring: { before?: string } }>(
    '/api/boards/:boardId/cards/:cardId/activity',
    async (req, reply) => {
      const loaded = loadCard(req, reply, req.params.boardId, req.params.cardId);
      if (!loaded) return;
      return { entries: listActivity(loaded.card.id, PAGE_SIZE, req.query.before).map(toActivityDTO) };
    },
  );
}
