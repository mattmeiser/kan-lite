import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Loaded via createRequire rather than a static `import` -- vite-node (used
// by vitest) doesn't yet recognize this very new builtin and mis-resolves a
// static `import ... from 'node:sqlite'`, stripping the prefix and trying to
// load an npm package called "sqlite". A runtime require() sidesteps that
// resolution path entirely; only the type import above is static.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

let db: DatabaseSyncType | null = null;

function runMigrations(database: DatabaseSyncType) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    database.prepare('SELECT name FROM schema_migrations').all().map((row) => (row as { name: string }).name),
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    // foreign_keys can't be toggled while a transaction is open, so it has to
    // bracket BEGIN/COMMIT rather than sit inside it -- needed for migrations
    // that rebuild a table (create-copy-drop-rename) referenced by FKs
    // elsewhere; without this, dropping the old table fails on any database
    // that already has rows referencing it.
    database.exec('PRAGMA foreign_keys = OFF');
    database.exec('BEGIN');
    try {
      database.exec(sql);
      database
        .prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')
        .run(file, new Date().toISOString());
      database.exec('COMMIT');
    } catch (err) {
      database.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
    } finally {
      database.exec('PRAGMA foreign_keys = ON');
    }
  }
}

export function getDb(): DatabaseSyncType {
  if (db) return db;

  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  runMigrations(db);
  return db;
}

export function closeDb() {
  db?.close();
  db = null;
}
