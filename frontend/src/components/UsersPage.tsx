import { useEffect, useState } from 'react';
import { NavTrigger } from './AppShell';
import * as api from '../api/client';
import type { GlobalRole, PublicUser } from '@kanlite/shared';

export function UsersPage() {
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [globalRole, setGlobalRole] = useState<GlobalRole>('app_user');

  function load() {
    api.fetchUsers().then(({ users }) => setUsers(users)).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load users.'));
  }

  useEffect(load, []);

  function invite() {
    if (!username.trim() || !email.trim()) return;
    api
      .createUserInvite({ username: username.trim(), email: email.trim(), globalRole })
      .then(() => {
        setUsername('');
        setEmail('');
        load();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to invite user.'));
  }

  function toggleActive(user: PublicUser) {
    api.setUserActive(user.id, !user.active).then(load).catch((err) => setError(err instanceof Error ? err.message : 'Action failed.'));
  }

  function toggleRole(user: PublicUser) {
    const next: GlobalRole = user.globalRole === 'app_admin' ? 'app_user' : 'app_admin';
    api.setUserRole(user.id, next).then(load).catch((err) => setError(err instanceof Error ? err.message : 'Action failed.'));
  }

  function resetPassword(user: PublicUser) {
    api.adminResetPassword(user.id).catch((err) => setError(err instanceof Error ? err.message : 'Action failed.'));
  }

  const activeAdminCount = users?.filter((u) => u.active && u.globalRole === 'app_admin').length ?? 0;

  return (
    <div className="app-page">
      <div className="topbar">
        <div className="topbar-left">
          <NavTrigger />
          <div className="crumb">
            <b>User management</b>
          </div>
        </div>
      </div>
      <div className="page" style={{ maxWidth: 640 }}>
        <div className="page-header">
          <h1 className="page-title">Users</h1>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="settings-section">
          <h2>Invite a new user</h2>
          <div className="field-row" style={{ flexWrap: 'wrap' }}>
            <input className="field-input" style={{ width: 'auto', flex: '1 1 120px' }} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
            <input className="field-input" style={{ width: 'auto', flex: '1 1 160px' }} placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select className="field-select" style={{ width: 'auto' }} value={globalRole} onChange={(e) => setGlobalRole(e.target.value as GlobalRole)}>
              <option value="app_user">App User</option>
              <option value="app_admin">App Admin</option>
            </select>
            <button className="btn-primary" type="button" onClick={invite}>
              + Add user
            </button>
          </div>
        </div>

        <div className="settings-section">
          {users === null ? (
            <div className="app-status">Loading…</div>
          ) : (
            users.map((user) => {
              const isLastActiveAdmin = user.active && user.globalRole === 'app_admin' && activeAdminCount <= 1;
              return (
                <div className="user-row" key={user.id}>
                  <div className="user-name-col">
                    <div className="n">{user.username}</div>
                    <div className="u">{user.email}</div>
                  </div>
                  <span className={`pill ${user.globalRole === 'app_admin' ? 'role-admin' : 'role-user'}`}>
                    {user.globalRole === 'app_admin' ? 'App admin' : 'App user'}
                  </span>
                  <span>
                    <span className={`status-dot ${user.active ? 'active' : 'inactive'}`} />
                    {user.active ? 'Active' : 'Deactivated'}
                  </span>
                  {user.active && (
                    <button
                      className="btn-secondary"
                      type="button"
                      disabled={isLastActiveAdmin}
                      title={isLastActiveAdmin ? 'Blocked: last remaining App Admin' : undefined}
                      onClick={() => toggleRole(user)}
                    >
                      {user.globalRole === 'app_admin' ? 'Remove admin' : 'Make admin'}
                    </button>
                  )}
                  {user.active && (
                    <button className="btn-secondary" type="button" onClick={() => resetPassword(user)}>
                      Reset PW
                    </button>
                  )}
                  <button
                    className="btn-secondary"
                    type="button"
                    disabled={user.active && isLastActiveAdmin}
                    title={user.active && isLastActiveAdmin ? 'Blocked: last remaining App Admin' : undefined}
                    onClick={() => toggleActive(user)}
                  >
                    {user.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
