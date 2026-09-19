import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { getDb } from '../db/connection.js';
import { newId } from '../lib/ids.js';
import { dateInAppTimezone } from '../lib/dates.js';
import { createUser, findUserByUsername } from '../db/repo/users.js';
import { createResetToken } from '../db/repo/resetTokens.js';
import { createColumn, createSwimlane, setBoardMember } from '../db/repo/boards.js';
import { mapKanboardColor } from './colorMap.js';
import type {
  KbCategory,
  KbColumn,
  KbComment,
  KbProject,
  KbProjectHasUser,
  KbSubtask,
  KbSwimlane,
  KbTag,
  KbTask,
  KbTaskHasTag,
  KbUser,
} from './kanboardTypes.js';
import type { GlobalRole, BoardRole } from '@kanlite/shared';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

export interface MigrationReport {
  users: { username: string; email: string; inviteLink: string }[];
  usernameCollisions: { original: string; renamedTo: string }[];
  boards: { name: string; cardCount: number; columnCount: number; archived: boolean }[];
  warnings: string[];
}

function mapAppRole(kbRole: string): GlobalRole {
  // "manager becomes App Admin, not App User" -- design doc, Migration, resolved decision #2.
  return kbRole === 'app-admin' || kbRole === 'app-manager' ? 'app_admin' : 'app_user';
}

function mapBoardRole(kbRole: string): BoardRole {
  if (kbRole === 'project-manager') return 'board_admin';
  if (kbRole === 'project-viewer') return 'board_reader';
  return 'board_user';
}

/** Runs a one-time export/import from a Kanboard SQLite database file, read-only against the source (design doc, Migration). */
export function migrateFromKanboard(sourcePath: string, appUrl: string): MigrationReport {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const dest = getDb();
  const report: MigrationReport = { users: [], usernameCollisions: [], boards: [], warnings: [] };

  const kbUsers = source.prepare('SELECT id, username, email, name, role, is_active FROM users').all() as unknown as KbUser[];
  const kbProjects = source
    .prepare('SELECT id, name, is_active, priority_start, priority_end FROM projects')
    .all() as unknown as KbProject[];
  const kbMembers = source.prepare('SELECT project_id, user_id, role FROM project_has_users').all() as unknown as KbProjectHasUser[];
  const kbColumns = source.prepare('SELECT id, title, position, project_id FROM columns ORDER BY position').all() as unknown as KbColumn[];
  const kbSwimlanes = source
    .prepare('SELECT id, name, position, is_active, project_id FROM swimlanes ORDER BY position')
    .all() as unknown as KbSwimlane[];
  const kbTags = source.prepare('SELECT id, name, project_id, color_id FROM tags').all() as unknown as KbTag[];
  const kbTaskTags = source.prepare('SELECT task_id, tag_id FROM task_has_tags').all() as unknown as KbTaskHasTag[];
  const kbCategories = source.prepare('SELECT id, name, project_id, color_id FROM project_has_categories').all() as unknown as KbCategory[];
  const kbTasks = source
    .prepare(
      `SELECT id, title, description, date_creation, date_modification, date_moved, color_id, project_id, column_id, owner_id,
              creator_id, position, is_active, date_due, category_id, swimlane_id, priority
       FROM tasks ORDER BY project_id, column_id, position`,
    )
    .all() as unknown as KbTask[];
  const kbComments = source
    .prepare('SELECT id, task_id, user_id, date_creation, comment FROM comments ORDER BY task_id, date_creation')
    .all() as unknown as KbComment[];
  const kbSubtasks = source
    .prepare('SELECT id, title, status, position, task_id FROM subtasks ORDER BY task_id, position')
    .all() as unknown as KbSubtask[];

  source.close();

  // -- Users: fresh password reset for everyone, no shared/typed temp password (design doc, Migration #1 and Auth). --
  const userIdMap = new Map<number, string>(); // Kanboard user id -> KanLite user id

  for (const kbUser of kbUsers) {
    let username = kbUser.username;
    if (findUserByUsername(username)) {
      const renamed = `${username}-kb`;
      report.usernameCollisions.push({ original: username, renamedTo: renamed });
      username = renamed;
    }
    const email = kbUser.email || `${username}@unknown.invalid`;
    if (!kbUser.email) {
      report.warnings.push(`User "${kbUser.username}" had no email on file; using a placeholder ("${email}") -- update it before inviting.`);
    }

    const created = createUser({ username, email, passwordHash: '', globalRole: mapAppRole(kbUser.role) });
    userIdMap.set(kbUser.id, created.id);

    const { plainToken } = createResetToken(created.id, 'invite');
    report.users.push({ username, email, inviteLink: `${appUrl}/set-password?token=${plainToken}` });
  }

  function mappedUser(kbUserId: number | null | undefined): string | null {
    if (!kbUserId) return null;
    return userIdMap.get(kbUserId) ?? null;
  }

  // -- Boards --
  for (const project of kbProjects) {
    const boardId = newId();
    const now = new Date().toISOString();
    dest
      .prepare(
        `INSERT INTO boards (id, name, archived, backlog_column_id, done_column_id, re_notify_interval_days, daily_notify_time, recycle_delay_hours, created_at)
         VALUES (?, ?, ?, NULL, NULL, 7, '08:00', 24, ?)`,
      )
      .run(boardId, project.name, project.is_active ? 0 : 1, now);

    // Backlog/Done are left unset -- "require manual assignment before use,
    // not a name-matched guess" (design doc, Migration, resolved decision #3).

    const columnIdMap = new Map<number, string>();
    for (const col of kbColumns.filter((c) => c.project_id === project.id)) {
      const created = createColumn(boardId, col.title);
      columnIdMap.set(col.id, created.id);
    }

    const swimlaneIdMap = new Map<number, string>();
    for (const sw of kbSwimlanes.filter((s) => s.project_id === project.id)) {
      const created = createSwimlane(boardId, sw.name);
      if (!sw.is_active) {
        dest.prepare('UPDATE swimlanes SET active = 0 WHERE id = ?').run(created.id);
      }
      swimlaneIdMap.set(sw.id, created.id);
    }

    // Real tags map directly to chips -- the actual source, not the raw
    // per-task color_id (design doc, Migration).
    const chipIdByTagId = new Map<number, string>();
    const chipIdByName = new Map<string, string>(); // dedupe auto-created chips against real tags and each other
    for (const tag of kbTags.filter((t) => t.project_id === project.id)) {
      const chipId = newId();
      dest.prepare('INSERT INTO chips (id, board_id, name, color) VALUES (?, ?, ?, ?)').run(
        chipId,
        boardId,
        tag.name,
        mapKanboardColor(tag.color_id),
      );
      chipIdByTagId.set(tag.id, chipId);
      chipIdByName.set(tag.name.toLowerCase(), chipId);
    }

    function chipForName(name: string, color: string): string {
      const key = name.toLowerCase();
      const existing = chipIdByName.get(key);
      if (existing) return existing;
      const chipId = newId();
      dest.prepare('INSERT INTO chips (id, board_id, name, color) VALUES (?, ?, ?, ?)').run(chipId, boardId, name, color);
      chipIdByName.set(key, chipId);
      return chipId;
    }

    const categoriesById = new Map(kbCategories.filter((c) => c.project_id === project.id).map((c) => [c.id, c]));

    for (const [kbUserId, kbRole] of kbMembers.filter((m) => m.project_id === project.id).map((m) => [m.user_id, m.role] as const)) {
      const userId = mappedUser(kbUserId);
      if (userId) setBoardMember(boardId, userId, mapBoardRole(kbRole));
    }

    const projectTasks = kbTasks.filter((t) => t.project_id === project.id);
    let cardCount = 0;

    for (const task of projectTasks) {
      const columnId = columnIdMap.get(task.column_id);
      if (!columnId) {
        report.warnings.push(`Task "${task.title}" (Kanboard #${task.id}) referenced a column that no longer exists; skipped.`);
        continue;
      }
      const swimlaneId = task.swimlane_id ? (swimlaneIdMap.get(task.swimlane_id) ?? null) : null;
      const assigneeId = mappedUser(task.owner_id);
      const dueDate = task.date_due ? dateInAppTimezone(new Date(task.date_due * 1000)) : null;
      const createdAt = task.date_creation ? new Date(task.date_creation * 1000).toISOString() : new Date().toISOString();
      const updatedAt = task.date_modification ? new Date(task.date_modification * 1000).toISOString() : createdAt;
      // Kanboard's tasks.date_moved tracks the last column change specifically (unlike
      // date_modification, which updates on any edit) -- the direct source for "entered
      // this column," confirmed against Kanboard's own schema. Falls back to
      // updatedAt for any row where it's somehow null, so the visibility window and the
      // done-card purge utility are never permanently inert for migrated data either way.
      const enteredDoneAt = task.date_moved ? new Date(task.date_moved * 1000).toISOString() : updatedAt;
      const priority = bucketPriority(task.priority, project.priority_start, project.priority_end);
      const cardId = newId();

      dest
        .prepare(
          `INSERT INTO cards (id, board_id, column_id, swimlane_id, title, description, position, assignee_id, priority,
                              due_date, recurrence_interval_days, cycle_count, entered_done_at, notified_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, NULL, ?, ?)`,
        )
        .run(
          cardId,
          boardId,
          columnId,
          swimlaneId,
          task.title,
          task.description ?? '',
          cardCount++,
          assigneeId,
          priority,
          dueDate,
          enteredDoneAt,
          createdAt,
          updatedAt,
        );

      // Chips: real tags, plus an auto-created chip for a leftover per-task
      // color_id or legacy category_id that was never turned into a tag
      // (design doc, Migration, resolved decision #5).
      for (const taskTag of kbTaskTags.filter((tt) => tt.task_id === task.id)) {
        const chipId = chipIdByTagId.get(taskTag.tag_id);
        if (chipId) dest.prepare('INSERT OR IGNORE INTO card_chips (card_id, chip_id) VALUES (?, ?)').run(cardId, chipId);
      }
      if (task.color_id) {
        const chipId = chipForName(task.color_id, mapKanboardColor(task.color_id));
        dest.prepare('INSERT OR IGNORE INTO card_chips (card_id, chip_id) VALUES (?, ?)').run(cardId, chipId);
      }
      if (task.category_id) {
        const category = categoriesById.get(task.category_id);
        if (category) {
          const chipId = chipForName(category.name, mapKanboardColor(category.color_id));
          dest.prepare('INSERT OR IGNORE INTO card_chips (card_id, chip_id) VALUES (?, ?)').run(cardId, chipId);
        }
      }

      for (const subtask of kbSubtasks.filter((s) => s.task_id === task.id)) {
        dest
          .prepare('INSERT INTO subtasks (id, card_id, text, done, position) VALUES (?, ?, ?, ?, ?)')
          .run(newId(), cardId, subtask.title, subtask.status === 2 ? 1 : 0, subtask.position);
      }

      for (const comment of kbComments.filter((c) => c.task_id === task.id)) {
        const authorId = mappedUser(comment.user_id);
        if (!authorId) {
          // comments.author_id is NOT NULL -- rather than fabricate an
          // attribution, skip a comment whose author didn't map to a real
          // migrated user (e.g. Kanboard's user_id 0 for a system comment).
          report.warnings.push(`Comment on task "${task.title}" (Kanboard #${task.id}) had no resolvable author; skipped.`);
          continue;
        }
        dest
          .prepare('INSERT INTO comments (id, card_id, author_id, text, created_at, edited_at) VALUES (?, ?, ?, ?, ?, NULL)')
          .run(newId(), cardId, authorId, comment.comment, new Date(comment.date_creation * 1000).toISOString());
      }

      dest
        .prepare('INSERT INTO activity_log (id, card_id, actor_id, timestamp, kind, detail, cycle_count) VALUES (?, ?, ?, ?, ?, ?, NULL)')
        .run(newId(), cardId, mappedUser(task.creator_id), createdAt, 'create', 'imported from Kanboard');
    }

    report.boards.push({ name: project.name, cardCount, columnCount: columnIdMap.size, archived: !project.is_active });
  }

  return report;
}

/**
 * Buckets a task's raw priority into Low/Medium/High by where it falls within
 * its *own project's* priority_start..priority_end range (Kanboard's default
 * is 0..3, but it's per-project configurable) -- the same ratio Kanboard's
 * own UI uses to compute a priority's color, per ProjectTaskPriorityModel.
 * KanLite deliberately doesn't carry over the numeric range itself (see
 * design doc, Cards), only uses it once, here, to place each task.
 */
function bucketPriority(raw: number, start: number, end: number): 'Low' | 'Medium' | 'High' {
  if (end <= start) return 'Medium';
  const ratio = (raw - start) / (end - start);
  if (ratio <= 1 / 3) return 'Low';
  if (ratio <= 2 / 3) return 'Medium';
  return 'High';
}
