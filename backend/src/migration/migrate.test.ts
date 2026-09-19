import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTestDb } from '../test/setupTestDb.js';
import { migrateFromKanboard } from './migrate.js';
import { getDb } from '../db/connection.js';
import { findUserByUsername } from '../db/repo/users.js';
import { findBoardMembership } from '../db/repo/boards.js';
import type { BoardRow, CardRow } from '../db/types.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

useTestDb();

let sourceDir: string;
let sourcePath: string;

beforeEach(() => {
  sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanboard-fixture-'));
  sourcePath = path.join(sourceDir, 'db.sqlite');
});

afterEach(() => {
  fs.rmSync(sourceDir, { recursive: true, force: true });
});

/** Builds a minimal Kanboard-shaped SQLite fixture matching the real schema (see kanboardTypes.ts). */
function buildFixture() {
  const db = new DatabaseSync(sourcePath);
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, email TEXT, name TEXT, role TEXT, is_active INTEGER);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER, priority_start INTEGER, priority_end INTEGER);
    CREATE TABLE project_has_users (project_id INTEGER, user_id INTEGER, role TEXT);
    CREATE TABLE columns (id INTEGER PRIMARY KEY, title TEXT, position INTEGER, project_id INTEGER);
    CREATE TABLE swimlanes (id INTEGER PRIMARY KEY, name TEXT, position INTEGER, is_active INTEGER, project_id INTEGER);
    CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT, project_id INTEGER, color_id TEXT);
    CREATE TABLE task_has_tags (task_id INTEGER, tag_id INTEGER);
    CREATE TABLE project_has_categories (id INTEGER PRIMARY KEY, name TEXT, project_id INTEGER, color_id TEXT);
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY, title TEXT, description TEXT, date_creation INTEGER, date_modification INTEGER,
      date_moved INTEGER, color_id TEXT, project_id INTEGER, column_id INTEGER, owner_id INTEGER, creator_id INTEGER,
      position INTEGER, is_active INTEGER, date_due INTEGER, category_id INTEGER, swimlane_id INTEGER, priority INTEGER
    );
    CREATE TABLE comments (id INTEGER PRIMARY KEY, task_id INTEGER, user_id INTEGER, date_creation INTEGER, comment TEXT);
    CREATE TABLE subtasks (id INTEGER PRIMARY KEY, title TEXT, status INTEGER, position INTEGER, task_id INTEGER);
  `);

  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run(1, 'admin', 'admin@x.com', 'Admin', 'app-admin', 1);
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run(2, 'kiddo', 'kiddo@x.com', 'Kiddo', 'app-user', 1);
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run(3, 'sarah', null, 'Sarah', 'app-manager', 1);

  db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?)').run(1, 'Home projects', 1, 0, 3);
  db.prepare('INSERT INTO project_has_users VALUES (?, ?, ?)').run(1, 2, 'project-member');
  db.prepare('INSERT INTO project_has_users VALUES (?, ?, ?)').run(1, 3, 'project-manager');

  db.prepare('INSERT INTO columns VALUES (?, ?, ?, ?)').run(10, 'Backlog', 1, 1);
  db.prepare('INSERT INTO columns VALUES (?, ?, ?, ?)').run(11, 'In Progress', 2, 1);
  db.prepare('INSERT INTO columns VALUES (?, ?, ?, ?)').run(12, 'Done', 3, 1);

  db.prepare('INSERT INTO swimlanes VALUES (?, ?, ?, ?, ?)').run(20, 'Default swimlane', 1, 1, 1);

  db.prepare('INSERT INTO tags VALUES (?, ?, ?, ?)').run(30, 'Urgent', 1, 'red');

  db.prepare('INSERT INTO project_has_categories VALUES (?, ?, ?, ?)').run(40, 'Yardwork', 1, 'green');

  const now = Math.floor(Date.now() / 1000);
  // High priority (3 of 0..3 range), assigned to kiddo, one tag, due date set. date_moved is
  // deliberately different from date_modification, so tests can tell entered_done_at came from
  // the former (the last column-move timestamp), not the latter (last-edited-at-all).
  db.prepare(
    `INSERT INTO tasks (id, title, description, date_creation, date_modification, date_moved, color_id, project_id,
       column_id, owner_id, creator_id, position, is_active, date_due, category_id, swimlane_id, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(100, 'Replace HVAC filter', 'Filter size 16x25x1', now - 86400, now, now - 3600, null, 1, 10, 2, 3, 1, 1, now + 86400, 0, 20, 3);
  db.prepare('INSERT INTO task_has_tags VALUES (?, ?)').run(100, 30);
  db.prepare('INSERT INTO comments VALUES (?, ?, ?, ?, ?)').run(200, 100, 3, now - 3600, 'Spare filter is 20x25 not 16x25.');
  db.prepare('INSERT INTO subtasks VALUES (?, ?, ?, ?, ?)').run(300, 'Buy new filter', 2, 1, 100);
  db.prepare('INSERT INTO subtasks VALUES (?, ?, ?, ?, ?)').run(301, 'Install filter', 0, 2, 100);

  // A second task with a leftover raw color and a legacy category, no tags -- exercises auto-created chips.
  // No date_moved (legacy row) -- exercises the fallback to date_modification.
  db.prepare(
    `INSERT INTO tasks (id, title, description, date_creation, date_modification, date_moved, color_id, project_id,
       column_id, owner_id, creator_id, position, is_active, date_due, category_id, swimlane_id, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(101, 'Mow lawn', '', now, now, null, 'yellow', 1, 10, 0, 1, 2, 1, null, 40, 20, 0);

  db.close();
}

describe('migrateFromKanboard', () => {
  it('migrates users with fresh invite tokens, mapping manager to App Admin', () => {
    buildFixture();
    const report = migrateFromKanboard(sourcePath, 'https://kanlite.example.com');

    const admin = findUserByUsername('admin')!;
    const kiddo = findUserByUsername('kiddo')!;
    const sarah = findUserByUsername('sarah')!;

    expect(admin.global_role).toBe('app_admin');
    expect(kiddo.global_role).toBe('app_user');
    expect(sarah.global_role).toBe('app_admin'); // "manager becomes App Admin, not App User"
    expect(admin.password_hash).toBe(''); // no shared/typed temp password
    expect(sarah.email).toBe('sarah@unknown.invalid'); // sarah had no email on file
    expect(report.users).toHaveLength(3);
    expect(report.users.every((u) => u.inviteLink.startsWith('https://kanlite.example.com'))).toBe(true);
  });

  it('creates a board with columns/swimlanes imported and Backlog/Done left unset', () => {
    buildFixture();
    migrateFromKanboard(sourcePath, 'https://x.com');

    // App Admin has no explicit membership row on a migrated board (computed
    // rights only), so fetch via the raw table rather than listBoardsForUser.
    const board = getDb().prepare('SELECT * FROM boards').get() as unknown as BoardRow;

    expect(board.name).toBe('Home projects');
    expect(board.backlog_column_id).toBeNull();
    expect(board.done_column_id).toBeNull();
    expect(board.archived).toBe(0);

    const columns = getDb().prepare('SELECT * FROM columns WHERE board_id = ? ORDER BY position').all(board.id) as { name: string }[];
    expect(columns.map((c) => c.name)).toEqual(['Backlog', 'In Progress', 'Done']);

    const swimlanes = getDb().prepare('SELECT * FROM swimlanes WHERE board_id = ?').all(board.id) as { name: string }[];
    expect(swimlanes.map((s) => s.name)).toEqual(['Default swimlane']);
  });

  it('maps project roles to board roles for explicit members only', () => {
    buildFixture();
    migrateFromKanboard(sourcePath, 'https://x.com');

    const board = getDb().prepare('SELECT * FROM boards').get() as unknown as BoardRow;
    const kiddo = findUserByUsername('kiddo')!;
    const sarah = findUserByUsername('sarah')!;

    expect(findBoardMembership(board.id, kiddo.id)?.board_role).toBe('board_user');
    expect(findBoardMembership(board.id, sarah.id)?.board_role).toBe('board_admin');
  });

  it('migrates a card with due date, priority bucketed from the project range, assignee, tag chip, subtasks, and comment', () => {
    buildFixture();
    migrateFromKanboard(sourcePath, 'https://x.com');

    const card = getDb().prepare('SELECT * FROM cards WHERE title = ?').get('Replace HVAC filter') as unknown as CardRow;
    const kiddo = findUserByUsername('kiddo')!;

    expect(card.assignee_id).toBe(kiddo.id);
    expect(card.priority).toBe('High'); // raw 3 of range 0..3 -> ratio 1.0
    expect(card.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(card.recurrence_interval_days).toBeNull(); // Kanboard recurrence deliberately not carried over
    // entered_done_at comes from Kanboard's date_moved (last column-move timestamp), not
    // date_modification (last-edited-at-all, used for updated_at) -- the fixture sets them an
    // hour apart specifically so this distinction is actually exercised, not coincidentally equal.
    expect(card.entered_done_at).not.toBe(card.updated_at);
    expect(new Date(card.updated_at).getTime() - new Date(card.entered_done_at!).getTime()).toBe(3600_000);

    const chips = getDb()
      .prepare('SELECT chips.name FROM card_chips JOIN chips ON chips.id = card_chips.chip_id WHERE card_chips.card_id = ?')
      .all(card.id) as { name: string }[];
    expect(chips.map((c) => c.name)).toEqual(['Urgent']);

    const subtasks = getDb().prepare('SELECT text, done FROM subtasks WHERE card_id = ? ORDER BY position').all(card.id) as {
      text: string;
      done: number;
    }[];
    expect(subtasks).toEqual([
      { text: 'Buy new filter', done: 1 },
      { text: 'Install filter', done: 0 },
    ]);

    const comments = getDb().prepare('SELECT text, author_id FROM comments WHERE card_id = ?').all(card.id) as {
      text: string;
      author_id: string;
    }[];
    const sarah = findUserByUsername('sarah')!;
    expect(comments).toEqual([{ text: 'Spare filter is 20x25 not 16x25.', author_id: sarah.id }]);

    const activity = getDb().prepare('SELECT kind, detail FROM activity_log WHERE card_id = ?').all(card.id);
    expect(activity).toEqual([{ kind: 'create', detail: 'imported from Kanboard' }]);
  });

  it('auto-creates a chip for a leftover raw color_id and a legacy category, deduped by name', () => {
    buildFixture();
    migrateFromKanboard(sourcePath, 'https://x.com');

    const mowCard = getDb().prepare('SELECT * FROM cards WHERE title = ?').get('Mow lawn') as unknown as CardRow;
    const chips = getDb()
      .prepare('SELECT chips.name, chips.color FROM card_chips JOIN chips ON chips.id = card_chips.chip_id WHERE card_chips.card_id = ?')
      .all(mowCard.id) as { name: string; color: string }[];

    expect(chips.map((c) => c.name).sort()).toEqual(['Yardwork', 'yellow']);
    expect(mowCard.assignee_id).toBeNull(); // Kanboard owner_id 0 means unassigned
    expect(mowCard.priority).toBe('Low'); // raw 0 of range 0..3 -> ratio 0
    // No date_moved on this row (legacy data) -- entered_done_at falls back to updated_at.
    expect(mowCard.entered_done_at).toBe(mowCard.updated_at);
  });
});
