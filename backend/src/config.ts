import path from 'node:path';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: envInt('PORT', 4000),
  isProduction: process.env.NODE_ENV === 'production',
  dataDir: process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'),
  get dbPath() {
    return path.join(this.dataDir, 'kanlite.sqlite');
  },
  sessionCookieName: 'kanlite_session',
  sessionMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
  lockoutThreshold: 10,
  lockoutMs: 15 * 60 * 1000,
  resetTokenMaxAgeMs: 30 * 60 * 1000,
  appTimezone: process.env.APP_TIMEZONE ?? 'UTC',
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  smtp: {
    host: process.env.MAIL_SMTP_HOST ?? '',
    port: envInt('MAIL_SMTP_PORT', 587),
    secure: process.env.MAIL_SMTP_SECURE === 'true',
    user: process.env.MAIL_SMTP_USER ?? '',
    pass: process.env.MAIL_SMTP_PASS ?? '',
    from: process.env.MAIL_FROM ?? 'KanLite <no-reply@kanlite.local>',
  },
};
