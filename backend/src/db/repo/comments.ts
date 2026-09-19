import { getDb } from '../connection.js';
import { newId } from '../../lib/ids.js';
import type { CommentRow } from '../types.js';

export function findComment(commentId: string): CommentRow | undefined {
  return getDb().prepare('SELECT * FROM comments WHERE id = ?').get(commentId) as CommentRow | undefined;
}

export function listComments(cardId: string, limit: number, beforeCreatedAt?: string): CommentRow[] {
  const db = getDb();
  // Oldest-first within a page so a thread reads top-to-bottom; "Show more"
  // pages backward from the oldest entry currently shown.
  if (beforeCreatedAt) {
    return db
      .prepare('SELECT * FROM comments WHERE card_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?')
      .all(cardId, beforeCreatedAt, limit)
      .reverse() as unknown as CommentRow[];
  }
  return db
    .prepare('SELECT * FROM comments WHERE card_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(cardId, limit)
    .reverse() as unknown as CommentRow[];
}

export function createComment(cardId: string, authorId: string, text: string): CommentRow {
  const db = getDb();
  const id = newId();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO comments (id, card_id, author_id, text, created_at, edited_at) VALUES (?, ?, ?, ?, ?, NULL)').run(
    id,
    cardId,
    authorId,
    text,
    now,
  );
  return findComment(id)!;
}

export function updateComment(commentId: string, text: string) {
  getDb()
    .prepare('UPDATE comments SET text = ?, edited_at = ? WHERE id = ?')
    .run(text, new Date().toISOString(), commentId);
}

export function deleteComment(commentId: string) {
  getDb().prepare('DELETE FROM comments WHERE id = ?').run(commentId);
}
