import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { countUsers, createUser, findUserByUsername, findUserById, setPasswordHash } from '../db/repo/users.js';
import { createSession, deleteSession, deleteSessionsForUser } from '../db/repo/sessions.js';
import { createResetToken, findValidResetToken, markResetTokenUsed } from '../db/repo/resetTokens.js';
import { hashPassword } from '../auth/password.js';
import { login, toCurrentUser, AuthError } from '../auth/service.js';
import { sendMail } from '../email/mailer.js';
import { requireAuth } from '../plugins/auth.js';

function setSessionCookie(reply: import('fastify').FastifyReply, sessionId: string) {
  reply.setCookie(config.sessionCookieName, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge: config.sessionMaxAgeMs / 1000,
  });
}

const USERNAME_RE = /^[a-zA-Z0-9_.-]{2,32}$/;

export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/bootstrap-status', async () => {
    return { needsSetup: countUsers() === 0 };
  });

  app.post<{ Body: { username: string; email: string; password: string } }>(
    '/api/auth/bootstrap',
    async (req, reply) => {
      if (countUsers() > 0) {
        return reply.code(409).send({ error: 'Setup has already been completed.' });
      }
      const { username, email, password } = req.body ?? ({} as never);
      if (!username || !USERNAME_RE.test(username)) {
        return reply.code(400).send({ error: 'Username must be 2-32 characters (letters, numbers, . _ -).' });
      }
      if (!email) {
        return reply.code(400).send({ error: 'Email is required.' });
      }
      if (!password || password.length < 8) {
        return reply.code(400).send({ error: 'Password must be at least 8 characters.' });
      }

      const passwordHash = await hashPassword(password);
      const user = createUser({ username, email, passwordHash, globalRole: 'app_admin' });
      const session = createSession(user.id);
      setSessionCookie(reply, session.id);
      return toCurrentUser(user, session.csrf_token);
    },
  );

  app.post<{ Body: { username: string; password: string } }>(
    '/api/auth/login',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { username, password } = req.body ?? ({} as never);
      if (!username || !password) {
        return reply.code(400).send({ error: 'Username and password are required.' });
      }
      try {
        const { user, sessionId } = await login(username, password);
        setSessionCookie(reply, sessionId);
        return user;
      } catch (err) {
        if (err instanceof AuthError) {
          const status = err.code === 'locked_out' ? 423 : 401;
          return reply.code(status).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.currentSession) {
      deleteSession(req.currentSession.id);
    }
    reply.clearCookie(config.sessionCookieName, { path: '/' });
    return { success: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return toCurrentUser(req.currentUser!, req.currentSession!.csrf_token);
  });

  // Self-service reset is requested by username, not email -- see design doc
  // Auth section (email isn't unique, so an email-keyed lookup is ambiguous).
  app.post<{ Body: { username: string } }>(
    '/api/auth/request-reset',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { username } = req.body ?? ({} as never);
      const genericReply = { message: 'If that account exists, a link was sent.' };
      if (!username) return reply.code(400).send({ error: 'Username is required.' });

      const user = findUserByUsername(username);
      if (user && user.active) {
        const { plainToken } = createResetToken(user.id, 'reset');
        const link = `${config.appUrl}/reset-password?token=${plainToken}`;
        void sendMail(user.email, 'Reset your KanLite password', `Reset your password: ${link}\n\nThis link expires in 30 minutes.`);
      }
      return genericReply;
    },
  );

  app.post<{ Body: { token: string; password: string } }>('/api/auth/confirm-reset', async (req, reply) => {
    const { token, password } = req.body ?? ({} as never);
    if (!token || !password || password.length < 8) {
      return reply.code(400).send({ error: 'A valid token and an 8+ character password are required.' });
    }
    const tokenRow = findValidResetToken(token);
    if (!tokenRow) {
      return reply.code(400).send({ error: 'This link is invalid or has expired. Request a new one.' });
    }
    const passwordHash = await hashPassword(password);
    setPasswordHash(tokenRow.user_id, passwordHash);
    markResetTokenUsed(tokenRow.id);
    // A stolen 30-day session cookie shouldn't survive the password
    // changing (design doc, Auth) -- same mechanism as deactivation.
    deleteSessionsForUser(tokenRow.user_id);

    const user = findUserById(tokenRow.user_id)!;
    const session = createSession(user.id);
    setSessionCookie(reply, session.id);
    return toCurrentUser(user, session.csrf_token);
  });
}
