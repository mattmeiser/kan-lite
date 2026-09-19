import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { authPlugin } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { boardRoutes } from './routes/boards.js';
import { cardRoutes } from './routes/cards.js';
import { userRoutes } from './routes/users.js';

/** Assembles the Fastify app without starting the DB, scheduler, or listener -- shared by index.ts and tests (via app.inject()). */
export async function buildApp() {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: config.corsOrigin, credentials: true });
  await app.register(cookie);
  // Global no-op default; only /login and /reset-request opt in via their
  // own route config (design doc, Architecture: 20 req/min per IP, a
  // second layer alongside -- not instead of -- per-account lockout).
  await app.register(rateLimit, { global: false });
  await app.register(authPlugin);
  await app.register(authRoutes);
  await app.register(boardRoutes);
  await app.register(cardRoutes);
  await app.register(userRoutes);

  app.get('/api/health', async () => ({ ok: true }));

  return app;
}
