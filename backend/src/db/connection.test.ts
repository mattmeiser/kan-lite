import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { closeDb, getDb } from './connection.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };
const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

describe('migration runner', () => {
  let dir: string;

  afterEach(() => {
    closeDb();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('applies a later table-rebuild migration without a FOREIGN KEY constraint failure against a database that already has referencing rows', () => {
    // Simulate a real deployment: a database already migrated up through 002,
    // already holding rows that reference users.id -- the exact situation
    // that crashed migration 003's create/copy/drop/rename of the users
    // table. cards.assignee_id has no ON DELETE clause (unlike, say,
    // sessions.user_id's ON DELETE CASCADE), so it's the one that actually
    // throws "FOREIGN KEY constraint failed" rather than silently cascading.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanlite-migration-runner-'));
    const dbPath = path.join(dir, 'kanlite.sqlite');
    const seedDb = new DatabaseSync(dbPath);
    seedDb.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (const file of ['001_init.sql', '002_done_card_visibility.sql']) {
      seedDb.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      seedDb.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    }
    const now = new Date().toISOString();
    seedDb
      .prepare('INSERT INTO users (id, username, email, password_hash, global_role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('user-1', 'Matt', 'matt@x.com', 'hash', 'app_admin', now);
    seedDb.prepare('INSERT INTO boards (id, name, created_at) VALUES (?, ?, ?)').run('board-1', 'Chores', now);
    seedDb.prepare('INSERT INTO columns (id, board_id, name, position) VALUES (?, ?, ?, ?)').run('col-1', 'board-1', 'Backlog', 0);
    seedDb
      .prepare(
        'INSERT INTO cards (id, board_id, column_id, title, position, assignee_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run('card-1', 'board-1', 'col-1', 'Take out trash', 0, 'user-1', now, now);
    seedDb.close();

    config.dataDir = dir;
    expect(() => getDb()).not.toThrow();

    const db = getDb();
    expect((db.prepare('SELECT username FROM users WHERE id = ?').get('user-1') as { username: string }).username).toBe('Matt'); // as-typed casing preserved
    expect(db.prepare("SELECT * FROM users WHERE username = 'matt'").get()).toBeTruthy(); // COLLATE NOCASE applied
    expect((db.prepare('SELECT assignee_id FROM cards WHERE id = ?').get('card-1') as { assignee_id: string }).assignee_id).toBe(
      'user-1',
    ); // FK-referencing row survived the users table rebuild, untouched
  });
});
