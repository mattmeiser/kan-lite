import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { NavTrigger } from './AppShell';
import * as api from '../api/client';
import { CHIP_COLORS } from '../constants';
import { SearchableSelect } from './SearchableSelect';
import type { BoardDetailDTO, ChipDTO, ColumnDTO, CurrentUser, SwimlaneDTO } from '@kanlite/shared';

function reorder<T extends { id: string }>(items: T[], index: number, direction: -1 | 1): string[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items.map((i) => i.id);
  const ids = items.map((i) => i.id);
  [ids[index], ids[target]] = [ids[target], ids[index]];
  return ids;
}

interface BoardSettingsPageProps {
  currentUser: CurrentUser;
}

export function BoardSettingsPage({ currentUser }: BoardSettingsPageProps) {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const [board, setBoard] = useState<BoardDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newColumnName, setNewColumnName] = useState('');
  const [newSwimlaneName, setNewSwimlaneName] = useState('');
  const [newChipName, setNewChipName] = useState('');
  const [newChipColor, setNewChipColor] = useState<string>(CHIP_COLORS[0]);
  const [editingChipId, setEditingChipId] = useState<string | null>(null);
  const [editingChipName, setEditingChipName] = useState('');
  const [editingChipColor, setEditingChipColor] = useState<string>(CHIP_COLORS[0]);
  const [memberUsername, setMemberUsername] = useState('');
  const [memberRole, setMemberRole] = useState<'board_admin' | 'board_user' | 'board_reader'>('board_user');
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [purgeDays, setPurgeDays] = useState(30);
  const [confirmingPurge, setConfirmingPurge] = useState(false);
  const [purgePreviewCount, setPurgePreviewCount] = useState<number | null>(null);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);
  const [userDirectory, setUserDirectory] = useState<{ id: string; username: string }[]>([]);

  function load() {
    if (!boardId) return;
    api.fetchBoard(boardId).then(setBoard).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load board.'));
  }

  useEffect(load, [boardId]);
  useEffect(() => {
    if (!boardId) return;
    api.fetchUserDirectory(boardId).then(setUserDirectory).catch(() => setUserDirectory([]));
  }, [boardId]);

  if (!board) return <div className="app-status">{error ?? 'Loading…'}</div>;

  function renameBoard(name: string) {
    api.updateBoardSettings(board!.id, { name }).then(setBoard);
  }

  function saveNotifySettings(
    patch: Partial<{
      reNotifyIntervalDays: number;
      dailyNotifyTime: string;
      recycleDelayHours: number;
      doneCardVisibilityDays: number;
      hidePriority: boolean;
      hideAvatar: boolean;
    }>,
  ) {
    api.updateBoardSettings(board!.id, patch).then(setBoard).catch((err) => setError(err instanceof Error ? err.message : 'Save failed.'));
  }

  function addColumn() {
    const name = newColumnName.trim();
    if (!name) return;
    api.createColumn(board!.id, name).then(() => { setNewColumnName(''); load(); });
  }

  function renameColumn(columnId: string, name: string) {
    api.updateColumn(board!.id, columnId, { name }).then(load);
  }

  function toggleDoNotNotify(columnId: string, doNotNotify: boolean) {
    api.updateColumn(board!.id, columnId, { doNotNotify }).then(load);
  }

  function moveColumn(columns: ColumnDTO[], index: number, direction: -1 | 1) {
    api.reorderColumns(board!.id, reorder(columns, index, direction)).then(load);
  }

  function removeColumn(columnId: string) {
    api.deleteColumn(board!.id, columnId).then(load).catch((err) => setError(err instanceof Error ? err.message : 'Cannot delete this column.'));
  }

  function addSwimlane() {
    const name = newSwimlaneName.trim();
    if (!name) return;
    api.createSwimlane(board!.id, name).then(() => { setNewSwimlaneName(''); load(); });
  }

  function toggleSwimlaneActive(swimlaneId: string, active: boolean) {
    api.updateSwimlane(board!.id, swimlaneId, { active }).then(load);
  }

  function moveSwimlane(swimlanes: SwimlaneDTO[], index: number, direction: -1 | 1) {
    api.reorderSwimlanes(board!.id, reorder(swimlanes, index, direction)).then(load);
  }

  function removeSwimlane(swimlaneId: string) {
    api.deleteSwimlane(board!.id, swimlaneId).then(load).catch((err) => setError(err instanceof Error ? err.message : 'Cannot delete this swimlane.'));
  }

  function addChip() {
    const name = newChipName.trim();
    if (!name) return;
    api.createChip(board!.id, name, newChipColor).then(() => { setNewChipName(''); load(); });
  }

  function startEditChip(chip: ChipDTO) {
    setEditingChipId(chip.id);
    setEditingChipName(chip.name);
    setEditingChipColor(chip.color);
  }

  function saveEditChip() {
    const name = editingChipName.trim();
    if (!name || !editingChipId) {
      setEditingChipId(null);
      return;
    }
    api
      .updateChip(board!.id, editingChipId, { name, color: editingChipColor })
      .then(() => {
        setEditingChipId(null);
        load();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to save tag.'));
  }

  function removeChip(chipId: string) {
    api.deleteChip(board!.id, chipId).then(load);
  }

  function addMember() {
    const username = memberUsername.trim();
    if (!username) return;
    api
      .setBoardMember(board!.id, username, memberRole)
      .then(() => { setMemberUsername(''); load(); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to add member.'));
  }

  function removeMember(userId: string) {
    api.removeBoardMember(board!.id, userId).then(load);
  }

  function archiveBoard() {
    api
      .archiveBoard(board!.id, !board!.archived)
      .then(() => {
        setConfirmingArchive(false);
        load();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to archive board.'));
  }

  function deleteBoard() {
    if (deleteConfirmText !== board!.name) return;
    api
      .deleteBoard(board!.id)
      .then(() => navigate('/'))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to delete board.'));
  }

  function startConfirmingPurge() {
    api
      .previewPurgeDoneCards(board!.id, purgeDays)
      .then(({ count }) => {
        setPurgePreviewCount(count);
        setConfirmingPurge(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to preview done cards.'));
  }

  function cancelPurge() {
    setConfirmingPurge(false);
    setPurgePreviewCount(null);
  }

  function purgeDoneCards() {
    api
      .purgeDoneCards(board!.id, purgeDays)
      .then(({ deleted }) => {
        setConfirmingPurge(false);
        setPurgePreviewCount(null);
        setPurgeResult(`Deleted ${deleted} card${deleted === 1 ? '' : 's'}.`);
        load();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to delete done cards.'));
  }

  return (
    <div className="app-page">
      <div className="topbar">
        <div className="topbar-left">
          <NavTrigger />
          <div className="crumb">
            <Link to={`/boards/${board.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
              {board.name}
            </Link>{' '}
            / <b>Settings</b>
          </div>
        </div>
      </div>
      <div className="page" style={{ maxWidth: 640 }}>
        <div className="page-header">
          <h1 className="page-title">{board.name} settings</h1>
        </div>

        {error && (
          <div className="error-banner" style={{ position: 'sticky', top: 0, zIndex: 5 }}>
            {error}
          </div>
        )}

        {(!board.backlogColumnId || !board.doneColumnId) && (
          <div className="error-banner" style={{ background: 'var(--sem-warning-soft)', color: 'var(--sem-warning)' }}>
            This board (likely migrated) needs a Backlog and Done column assigned below before recurrence and
            notifications can work.
          </div>
        )}

        <div className="settings-section">
          <h2>General</h2>
          <div className="field-row">
            <span className="k">Board name</span>
            <input className="field-input" style={{ width: 'auto' }} defaultValue={board.name} onBlur={(e) => renameBoard(e.target.value)} />
          </div>
        </div>

        <div className="settings-section">
          <h2>Columns</h2>
          <div className="field-row">
            <span className="k">Backlog column</span>
            <select
              className="field-select"
              style={{ width: 'auto' }}
              value={board.backlogColumnId ?? ''}
              onChange={(e) => api.updateBoardSettings(board.id, { backlogColumnId: e.target.value }).then(setBoard)}
            >
              {!board.backlogColumnId && <option value="">-- choose a column --</option>}
              {board.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <span className="k">Done column</span>
            <select
              className="field-select"
              style={{ width: 'auto' }}
              value={board.doneColumnId ?? ''}
              onChange={(e) => api.updateBoardSettings(board.id, { doneColumnId: e.target.value }).then(setBoard)}
            >
              {!board.doneColumnId && <option value="">-- choose a column --</option>}
              {board.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text)', margin: '2px 0 8px' }}>
            Always assigned to some column -- moving one just reassigns it, there's no "none."
          </p>
          {board.columns.map((c, i) => (
            <div className="settings-row" key={c.id}>
              <input className="field-input name" style={{ width: 'auto' }} defaultValue={c.name} onBlur={(e) => renameColumn(c.id, e.target.value)} />
              {c.id === board.backlogColumnId && <span className="flag-tag backlog">Backlog</span>}
              {c.id === board.doneColumnId && <span className="flag-tag done">Done</span>}
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--text)' }}>
                <input type="checkbox" checked={c.doNotNotify} onChange={(e) => toggleDoNotNotify(c.id, e.target.checked)} /> Do not notify
              </label>
              <div className="reorder-btns">
                <button className="icon-btn" type="button" aria-label="Move up" disabled={i === 0} onClick={() => moveColumn(board.columns, i, -1)}>
                  ↑
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="Move down"
                  disabled={i === board.columns.length - 1}
                  onClick={() => moveColumn(board.columns, i, 1)}
                >
                  ↓
                </button>
              </div>
              <button className="btn-secondary" type="button" onClick={() => removeColumn(c.id)}>
                Delete
              </button>
            </div>
          ))}
          <div className="field-row">
            <input className="field-input" placeholder="New column name" value={newColumnName} onChange={(e) => setNewColumnName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addColumn()} />
            <button className="btn-secondary" type="button" onClick={addColumn}>
              + Add column
            </button>
          </div>
        </div>

        <div className="settings-section">
          <h2>Swimlanes</h2>
          {board.swimlanes.map((s, i) => (
            <div className="settings-row" key={s.id}>
              <span className="name">{s.name}</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--text)' }}>
                <input type="checkbox" checked={s.active} onChange={(e) => toggleSwimlaneActive(s.id, e.target.checked)} /> Active
              </label>
              <div className="reorder-btns">
                <button className="icon-btn" type="button" aria-label="Move up" disabled={i === 0} onClick={() => moveSwimlane(board.swimlanes, i, -1)}>
                  ↑
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="Move down"
                  disabled={i === board.swimlanes.length - 1}
                  onClick={() => moveSwimlane(board.swimlanes, i, 1)}
                >
                  ↓
                </button>
              </div>
              <button className="btn-secondary" type="button" onClick={() => removeSwimlane(s.id)}>
                Delete
              </button>
            </div>
          ))}
          <div className="field-row">
            <input className="field-input" placeholder="New swimlane name" value={newSwimlaneName} onChange={(e) => setNewSwimlaneName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSwimlane()} />
            <button className="btn-secondary" type="button" onClick={addSwimlane}>
              + Add swimlane
            </button>
          </div>
        </div>

        <div className="settings-section">
          <h2>Category tags</h2>
          {board.chips.map((c) =>
            editingChipId === c.id ? (
              <div className="field-row" key={c.id} style={{ flexWrap: 'wrap', justifyContent: 'flex-start' }}>
                <input
                  className="field-input"
                  style={{ width: 'auto', flex: '1 1 120px' }}
                  autoFocus
                  value={editingChipName}
                  onChange={(e) => setEditingChipName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveEditChip()}
                />
                {CHIP_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`swatch${editingChipColor === color ? ' selected' : ''}`}
                    style={{ background: `var(--lbl-${color})` }}
                    onClick={() => setEditingChipColor(color)}
                  />
                ))}
                <button className="btn-primary" type="button" onClick={saveEditChip}>
                  Save
                </button>
                <button className="btn-secondary" type="button" onClick={() => setEditingChipId(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="settings-row" key={c.id}>
                <span className="swatch" style={{ background: `var(--lbl-${c.color})` }} />
                <span className="name">{c.name}</span>
                <button className="btn-secondary" type="button" onClick={() => startEditChip(c)}>
                  Edit
                </button>
                <button className="btn-secondary" type="button" onClick={() => removeChip(c.id)}>
                  Delete
                </button>
              </div>
            ),
          )}
          <div className="field-row" style={{ flexWrap: 'wrap', justifyContent: 'flex-start' }}>
            <input className="field-input" style={{ width: 'auto', flex: '1 1 120px' }} placeholder="New tag name" value={newChipName} onChange={(e) => setNewChipName(e.target.value)} />
            {CHIP_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`swatch${newChipColor === color ? ' selected' : ''}`}
                style={{ background: `var(--lbl-${color})` }}
                onClick={() => setNewChipColor(color)}
              />
            ))}
            <button className="btn-secondary" type="button" onClick={addChip}>
              + Add tag
            </button>
          </div>
        </div>

        <div className="settings-section">
          <h2>Members</h2>
          {board.members.map((m) => (
            <div className="member-row" key={m.userId}>
              <span className="member-name">{m.username}</span>
              <select
                className="field-select"
                style={{ width: 'auto' }}
                value={m.boardRole}
                onChange={(e) => api.setBoardMember(board.id, m.username, e.target.value as typeof memberRole).then(load)}
              >
                <option value="board_admin">Board Admin</option>
                <option value="board_user">Board User</option>
                <option value="board_reader">Board Reader</option>
              </select>
              <button className="btn-secondary" type="button" onClick={() => removeMember(m.userId)}>
                Remove
              </button>
            </div>
          ))}
          <div className="field-row" style={{ flexWrap: 'wrap', justifyContent: 'flex-start' }}>
            <SearchableSelect
              options={userDirectory
                .filter((u) => !board.members.some((m) => m.userId === u.id))
                .map((u) => ({ value: u.username, label: u.username }))}
              value={memberUsername}
              onChange={setMemberUsername}
              placeholder="Pick a user…"
            />
            <select className="field-select" style={{ width: 'auto' }} value={memberRole} onChange={(e) => setMemberRole(e.target.value as typeof memberRole)}>
              <option value="board_admin">Board Admin</option>
              <option value="board_user">Board User</option>
              <option value="board_reader">Board Reader</option>
            </select>
            <button className="btn-secondary" type="button" onClick={addMember}>
              + Add member
            </button>
          </div>
        </div>

        <div className="settings-section">
          <h2>Notifications</h2>
          <div className="field-row">
            <span className="k">Check due dates daily at</span>
            <input className="field-input" style={{ width: 'auto' }} type="time" defaultValue={board.dailyNotifyTime} onBlur={(e) => saveNotifySettings({ dailyNotifyTime: e.target.value })} />
          </div>
          <div className="field-row">
            <span className="k">Remind again every</span>
            <input className="field-input" style={{ width: 70 }} type="number" min={1} defaultValue={board.reNotifyIntervalDays} onBlur={(e) => saveNotifySettings({ reNotifyIntervalDays: Number(e.target.value) })} />
            <span className="k">days, until resolved</span>
          </div>
        </div>

        <div className="settings-section">
          <h2>Cards</h2>

          <div className="field-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={!board.hidePriority}
                onChange={(e) => saveNotifySettings({ hidePriority: !e.target.checked })}
              />
              <span className="k">Show priority on cards</span>
            </label>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text)', margin: '2px 0 0' }}>
            Off hides the priority badge and its control everywhere on this board. Existing priority values aren't
            cleared -- turn it back on to see them again.
          </p>

          <div className="field-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={!board.hideAvatar}
                onChange={(e) => saveNotifySettings({ hideAvatar: !e.target.checked })}
              />
              <span className="k">Show assignee avatar on cards</span>
            </label>
          </div>

          <div className="field-row">
            <span className="k">Recycle a done recurring card to Backlog after</span>
            <input className="field-input" style={{ width: 70 }} type="number" min={1} defaultValue={board.recycleDelayHours} onBlur={(e) => saveNotifySettings({ recycleDelayHours: Number(e.target.value) })} />
            <span className="k">hours</span>
          </div>

          <div className="field-row">
            <span className="k">Hide a done card from the board after</span>
            <input
              className="field-input"
              style={{ width: 70 }}
              type="number"
              min={0}
              defaultValue={board.doneCardVisibilityDays}
              onBlur={(e) => saveNotifySettings({ doneCardVisibilityDays: Number(e.target.value) })}
            />
            <span className="k">days</span>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text)', margin: '2px 0 0' }}>
            0 = never hide -- done cards stay visible forever. Hidden cards aren't deleted; raise or zero this to bring them back.
          </p>
        </div>

        {currentUser.globalRole === 'app_admin' && (
          <div className="settings-section" style={{ borderColor: 'var(--danger)' }}>
            <h2 style={{ color: 'var(--danger)' }}>Danger zone</h2>
            <div className="field-row">
              <span className="k">{board.archived ? 'Unarchive this board' : 'Archive this board'}</span>
              {confirmingArchive ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" type="button" onClick={archiveBoard}>
                    Confirm {board.archived ? 'unarchive' : 'archive'}
                  </button>
                  <button className="btn-secondary" type="button" onClick={() => setConfirmingArchive(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button className="btn-secondary" type="button" onClick={() => setConfirmingArchive(true)}>
                  {board.archived ? 'Unarchive' : 'Archive'}
                </button>
              )}
            </div>
            <div className="field-row">
              <span className="k">Delete done cards older than</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number"
                  min={0}
                  style={{ width: 70 }}
                  value={purgeDays}
                  disabled={confirmingPurge}
                  onChange={(e) => setPurgeDays(Number(e.target.value))}
                />
                <span className="k">days</span>
                {confirmingPurge ? (
                  <>
                    <button className="btn-danger" type="button" onClick={purgeDoneCards}>
                      Confirm delete
                    </button>
                    <button className="btn-secondary" type="button" onClick={cancelPurge}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button className="btn-danger" type="button" onClick={startConfirmingPurge}>
                    Delete
                  </button>
                )}
              </div>
            </div>
            {confirmingPurge && purgePreviewCount !== null && (
              <p style={{ fontSize: 11, color: 'var(--danger)', margin: '2px 0 0' }}>
                This will permanently delete {purgePreviewCount} card{purgePreviewCount === 1 ? '' : 's'}. Recurring cards are
                never included.
              </p>
            )}
            {purgeResult && (
              <p style={{ fontSize: 11, color: 'var(--text)', margin: '2px 0 0' }}>{purgeResult}</p>
            )}
            <div className="field-row">
              <span className="k">Permanently delete this board</span>
              {confirmingDelete ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                  <span style={{ fontSize: 11, color: 'var(--text)' }}>
                    Type <strong>{board.name}</strong> to confirm.
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={board.name}
                      autoFocus
                    />
                    <button className="btn-danger" type="button" disabled={deleteConfirmText !== board.name} onClick={deleteBoard}>
                      Confirm delete
                    </button>
                    <button
                      className="btn-secondary"
                      type="button"
                      onClick={() => {
                        setConfirmingDelete(false);
                        setDeleteConfirmText('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button className="btn-danger" type="button" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
