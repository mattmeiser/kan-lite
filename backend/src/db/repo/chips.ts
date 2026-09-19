import { getDb } from '../connection.js';
import { newId } from '../../lib/ids.js';
import type { ChipRow } from '../types.js';

export function listChips(boardId: string): ChipRow[] {
  return getDb().prepare('SELECT * FROM chips WHERE board_id = ? ORDER BY name COLLATE NOCASE').all(boardId) as unknown as ChipRow[];
}

export function findChip(chipId: string): ChipRow | undefined {
  return getDb().prepare('SELECT * FROM chips WHERE id = ?').get(chipId) as ChipRow | undefined;
}

export function createChip(boardId: string, name: string, color: string): ChipRow {
  const db = getDb();
  const id = newId();
  db.prepare('INSERT INTO chips (id, board_id, name, color) VALUES (?, ?, ?, ?)').run(id, boardId, name, color);
  return findChip(id)!;
}

export function updateChip(chipId: string, patch: { name?: string; color?: string }) {
  const current = findChip(chipId)!;
  getDb()
    .prepare('UPDATE chips SET name = ?, color = ? WHERE id = ?')
    .run(patch.name ?? current.name, patch.color ?? current.color, chipId);
}

export function deleteChip(chipId: string) {
  getDb().prepare('DELETE FROM chips WHERE id = ?').run(chipId);
}
