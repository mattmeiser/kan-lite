import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { touchSession } from '../db/repo/sessions.js';
import type { SessionRow, UserRow } from '../db/types.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: UserRow | null;
    currentSession: SessionRow | null;
  }
}

const CSRF_EXEMPT_ROUTES = new Set([
  '/api/auth/login',
  '/api/auth/bootstrap',
  '/api/auth/request-reset',
  '/api/auth/confirm-reset',
]);

export const authPlugin: FastifyPluginAsync = fp(async (app) => {
  app.decorateRequest('currentUser', null);
  app.decorateRequest('currentSession', null);

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const sessionId = req.cookies[config.sessionCookieName];
    if (!sessionId) return;

    const result = touchSession(sessionId);
    if (!result) {
      reply.clearCookie(config.sessionCookieName, { path: '/' });
      return;
    }

    req.currentUser = result.user;
    req.currentSession = result.session;

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      if (!CSRF_EXEMPT_ROUTES.has(req.routeOptions?.url ?? req.url.split('?')[0])) {
        const header = req.headers['x-csrf-token'];
        if (header !== result.session.csrf_token) {
          reply.code(403).send({ error: 'Invalid or missing CSRF token.' });
        }
      }
    }
  });
});

export function requireAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!req.currentUser) {
    reply.code(401).send({ error: 'Authentication required.' });
    return false;
  }
  return true;
}

export function requireAppAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!requireAuth(req, reply)) return false;
  if (req.currentUser!.global_role !== 'app_admin') {
    reply.code(403).send({ error: 'App Admin role required.' });
    return false;
  }
  return true;
}
