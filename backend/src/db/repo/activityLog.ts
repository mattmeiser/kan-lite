import { getDb } from '../connection.js';
import { newId } from '../../lib/ids.js';
import type { ActivityKind } from '@kanlite/shared';
import type { ActivityLogRow } from '../types.js';

export function logActivity(
  cardId: string,
  actorId: string | null,
  kind: ActivityKind,
  detail: string,
  cycleCount?: number,
) {
  getDb()
    .prepare(
      'INSERT INTO activity_log (id, card_id, actor_id, timestamp, kind, detail, cycle_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(newId(), cardId, actorId, new Date().toISOString(), kind, detail, cycleCount ?? null);
}

export function listActivity(cardId: string, limit: number, beforeTimestamp?: string): ActivityLogRow[] {
  const db = getDb();
  if (beforeTimestamp) {
    return db
      .prepare('SELECT * FROM activity_log WHERE card_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?')
      .all(cardId, beforeTimestamp, limit) as unknown as ActivityLogRow[];
  }
  return db
    .prepare('SELECT * FROM activity_log WHERE card_id = ? ORDER BY timestamp DESC LIMIT ?')
    .all(cardId, limit) as unknown as ActivityLogRow[];
}
