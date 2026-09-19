import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { Board } from './components/Board';
import { BoardSettingsPage } from './components/BoardSettingsPage';
import { UsersPage } from './components/UsersPage';
import * as api from './api/client';
import type { CurrentUser, ThemePreference } from '@kanlite/shared';

export function App() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api
      .fetchCurrentUser()
      .then(setCurrentUser)
      .catch(() => setCurrentUser(null))
      .finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    if (currentUser?.theme === 'light' || currentUser?.theme === 'dark') {
      document.documentElement.setAttribute('data-theme', currentUser.theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [currentUser?.theme]);

  function logout() {
    api.logout().finally(() => setCurrentUser(null));
  }

  function changeTheme(theme: ThemePreference) {
    setCurrentUser((prev) => (prev ? { ...prev, theme } : prev));
    api.setTheme(theme).catch((err) => console.error('Failed to save theme', err));
  }

  if (!checked) {
    return <div className="app-status">Loading…</div>;
  }

  if (!currentUser) {
    return <Login onAuthenticated={setCurrentUser} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell currentUser={currentUser} onLogout={logout} onChangeTheme={changeTheme} />}>
          <Route path="/" element={<Dashboard currentUser={currentUser} />} />
          <Route path="/boards/:boardId" element={<Board currentUserId={currentUser.id} />} />
          <Route path="/boards/:boardId/settings" element={<BoardSettingsPage currentUser={currentUser} />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
