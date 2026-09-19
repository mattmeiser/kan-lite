import type { FastifyInstance } from 'fastify';
import { requireAppAdmin, requireAuth } from '../plugins/auth.js';
import {
  countActiveAdmins,
  createUser,
  findUserById,
  findUserByUsername,
  listUsers,
  setActive,
  setGlobalRole,
  setTheme,
} from '../db/repo/users.js';
import { deleteSessionsForUser } from '../db/repo/sessions.js';
import { createResetToken } from '../db/repo/resetTokens.js';
import { setBoardMember, findBoardById } from '../db/repo/boards.js';
import { unassignCardsForUserEverywhere } from '../db/repo/cards.js';
import { sendMail } from '../email/mailer.js';
import { config } from '../config.js';
import { toPublicUser } from '../auth/service.js';
import type { BoardRole, GlobalRole, ThemePreference } from '@kanlite/shared';

const USERNAME_RE = /^[a-zA-Z0-9_.-]{2,32}$/;

export async function userRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    if (!requireAuth(req, reply)) return reply;
  });

  app.get('/api/users', async (req, reply) => {
    if (!requireAppAdmin(req, reply)) return;
    return { users: listUsers().map(toPublicUser) };
  });

  app.post<{
    Body: { username: string; email: string; globalRole?: GlobalRole; boardId?: string; boardRole?: BoardRole };
  }>('/api/users', async (req, reply) => {
    if (!requireAppAdmin(req, reply)) return;
    const { username, email, globalRole, boardId, boardRole } = req.body ?? ({} as never);
    if (!username || !USERNAME_RE.test(username)) {
      return reply.code(400).send({ error: 'Username must be 2-32 characters (letters, numbers, . _ -).' });
    }
    if (!email) return reply.code(400).send({ error: 'Email is required.' });
    if (findUserByUsername(username)) return reply.code(409).send({ error: 'That username is already taken.' });
    if (boardId && !boardRole) return reply.code(400).send({ error: 'boardRole is required when boardId is given.' });
    if (boardId && !findBoardById(boardId)) return reply.code(400).send({ error: 'No such board.' });

    // No shared/typed temp password ever exists -- the account starts with an
    // unusable password hash and the invite link is the only way to set one.
    const user = createUser({ username, email, passwordHash: '', globalRole: globalRole ?? 'app_user' });
    if (boardId && boardRole) setBoardMember(boardId, user.id, boardRole);

    const { plainToken } = createResetToken(user.id, 'invite');
    const link = `${config.appUrl}/set-password?token=${plainToken}`;
    void sendMail(email, 'You have been invited to KanLite', `Set your password to finish creating your account: ${link}\n\nThis link expires in 30 minutes.`);

    return toPublicUser(user);
  });

  app.post<{ Params: { userId: string }; Body: { active: boolean } }>(
    '/api/users/:userId/active',
    async (req, reply) => {
      if (!requireAppAdmin(req, reply)) return;
      const user = findUserById(req.params.userId);
      if (!user) return reply.code(404).send({ error: 'User not found.' });

      if (!req.body?.active && user.global_role === 'app_admin' && countActiveAdmins(user.id) === 0) {
        return reply.code(400).send({ error: 'Cannot deactivate the last App Admin.' });
      }

      setActive(user.id, req.body.active);
      if (!req.body.active) {
        // Belt-and-suspenders: the session lookup itself also rejects a
        // deactivated user's cookie on their very next request either way.
        deleteSessionsForUser(user.id);
        unassignCardsForUserEverywhere(user.id);
      }
      return toPublicUser(findUserById(user.id)!);
    },
  );

  app.post<{ Params: { userId: string }; Body: { globalRole: GlobalRole } }>(
    '/api/users/:userId/role',
    async (req, reply) => {
      if (!requireAppAdmin(req, reply)) return;
      const user = findUserById(req.params.userId);
      if (!user) return reply.code(404).send({ error: 'User not found.' });

      if (req.body?.globalRole === 'app_user' && user.global_role === 'app_admin' && countActiveAdmins(user.id) === 0) {
        return reply.code(400).send({ error: 'Cannot demote the last App Admin.' });
      }

      setGlobalRole(user.id, req.body.globalRole);
      return toPublicUser(findUserById(user.id)!);
    },
  );

  app.post<{ Params: { userId: string } }>('/api/users/:userId/reset-password', async (req, reply) => {
    if (!requireAppAdmin(req, reply)) return;
    const user = findUserById(req.params.userId);
    if (!user) return reply.code(404).send({ error: 'User not found.' });
    const { plainToken } = createResetToken(user.id, 'reset');
    const link = `${config.appUrl}/reset-password?token=${plainToken}`;
    void sendMail(user.email, 'Your KanLite password was reset by an admin', `Set a new password: ${link}\n\nThis link expires in 30 minutes.`);
    return { success: true };
  });

  app.patch<{ Body: { theme: ThemePreference } }>('/api/me/theme', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    setTheme(req.currentUser!.id, req.body.theme);
    return { success: true };
  });
}
