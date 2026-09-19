import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavTrigger } from './AppShell';
import * as api from '../api/client';
import type { BoardSummary, CurrentUser } from '@kanlite/shared';
import { BOARD_ROLE_LABELS } from '@kanlite/shared';
import { initialsFor } from '../utils';

interface DashboardProps {
  currentUser: CurrentUser;
}

export function Dashboard({ currentUser }: DashboardProps) {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  function load() {
    api
      .fetchBoards()
      .then(({ boards }) => setBoards(boards))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load boards.'));
  }

  useEffect(load, []);

  function submitCreate() {
    const name = newName.trim();
    if (!name) return;
    api
      .createBoard(name)
      .then((board) => {
        setNewName('');
        setCreating(false);
        navigate(`/boards/${board.id}`);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to create board.'));
  }

  function roleClass(role: string) {
    if (role === 'board_admin') return 'role-admin';
    if (role === 'board_user') return 'role-user';
    return 'role-reader';
  }

  return (
    <div className="app-page">
      <div className="topbar">
        <div className="topbar-left">
          <NavTrigger />
          <span className="brand-word">KanLite</span>
        </div>
        <div className="topbar-right">
          <div className="avatar" title={currentUser.username}>
            {initialsFor(currentUser.username)}
          </div>
        </div>
      </div>
      <div className="page" style={{ maxWidth: 1400 }}>
        <div className="page-header">
          <div className="page-header-left">
            <h1 className="page-title">Your boards</h1>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {boards === null ? (
          <div className="app-status">Loading…</div>
        ) : boards.length === 0 && currentUser.globalRole !== 'app_admin' ? (
          <div className="empty-state">No boards yet -- ask an App Admin to add you to one.</div>
        ) : (
          <div className="board-grid">
            {boards.map((board) => (
              <button key={board.id} className="board-card" type="button" onClick={() => navigate(`/boards/${board.id}`)}>
                <div className="board-card-top">
                  <div className="board-card-name">{board.name}</div>
                  <span className={`pill ${roleClass(board.myRole)}`}>{BOARD_ROLE_LABELS[board.myRole]}</span>
                </div>
                <div className="board-stats">
                  <div className="board-stat-group">
                    <span className="board-stat-group-label">All</span>
                    <div className="board-stat-row">
                      <div className="board-stat">
                        <b>{board.all.total}</b>
                        <span>total</span>
                      </div>
                      <div className={`board-stat${board.all.overdue > 0 ? ' crit' : ''}`}>
                        <b>{board.all.overdue}</b>
                        <span>overdue</span>
                      </div>
                      <div className={`board-stat${board.all.dueSoon > 0 ? ' warn' : ''}`}>
                        <b>{board.all.dueSoon}</b>
                        <span>due soon</span>
                      </div>
                    </div>
                  </div>
                  <div className="board-stat-group">
                    <span className="board-stat-group-label">Mine</span>
                    <div className="board-stat-row">
                      <div className="board-stat">
                        <b>{board.mine.total}</b>
                        <span>total</span>
                      </div>
                      <div className={`board-stat${board.mine.overdue > 0 ? ' crit' : ''}`}>
                        <b>{board.mine.overdue}</b>
                        <span>overdue</span>
                      </div>
                      <div className={`board-stat${board.mine.dueSoon > 0 ? ' warn' : ''}`}>
                        <b>{board.mine.dueSoon}</b>
                        <span>due soon</span>
                      </div>
                    </div>
                  </div>
                </div>
              </button>
            ))}
            {currentUser.globalRole === 'app_admin' &&
              (creating ? (
                <div className="board-card">
                  <input
                    className="field-input"
                    autoFocus
                    placeholder="Board name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitCreate()}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-primary" type="button" onClick={submitCreate}>
                      Create
                    </button>
                    <button className="btn-secondary" type="button" onClick={() => setCreating(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button className="new-board-card" type="button" onClick={() => setCreating(true)}>
                  + New board
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
