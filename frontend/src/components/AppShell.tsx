import { createContext, useContext, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import type { CurrentUser, ThemePreference } from '@kanlite/shared';
import { initialsFor } from '../utils';

interface AppShellProps {
  currentUser: CurrentUser;
  onLogout: () => void;
  onChangeTheme: (theme: ThemePreference) => void;
}

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function navLinkClass({ isActive }: { isActive: boolean }) {
  return `app-nav-link${isActive ? ' active' : ''}`;
}

const OpenNavContext = createContext<() => void>(() => {});

/** Lets any page render a hamburger trigger for the shared overlay nav below. */
export function useOpenNav() {
  return useContext(OpenNavContext);
}

/** Shared hamburger trigger every page renders inline in its own header. */
export function NavTrigger() {
  const openNav = useOpenNav();
  return (
    <button className="icon-btn" aria-label="Open menu" title="Menu" type="button" onClick={openNav}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path d="M2 4.5h12M2 8h12M2 11.5h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/**
 * Wraps every authenticated route. The nav is collapsed by default -- a
 * hamburger (NavTrigger, rendered inline in each page's own header) opens it
 * as an overlay.
 */
export function AppShell({ currentUser, onLogout, onChangeTheme }: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = () => setNavOpen(false);

  return (
    <OpenNavContext.Provider value={() => setNavOpen(true)}>
      <div className="app-shell">
        <div className="app-main">
          <Outlet />
        </div>

        <div className={`nav-scrim${navOpen ? ' open' : ''}`} onClick={closeNav} />
        <nav className={`app-sidebar nav-overlay${navOpen ? ' open' : ''}`}>
          <div className="app-brand">
            KanLite
            <button className="icon-btn" aria-label="Close menu" type="button" onClick={closeNav}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <NavLink className={navLinkClass} to="/" end onClick={closeNav}>
            Dashboard
          </NavLink>
          {currentUser.globalRole === 'app_admin' && (
            <NavLink className={navLinkClass} to="/users" onClick={closeNav}>
              Users
            </NavLink>
          )}
          <div className="theme-switcher">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`theme-option${currentUser.theme === opt.value ? ' active' : ''}`}
                onClick={() => onChangeTheme(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="app-sidebar-footer">
            <button className="icon-btn" aria-label="Log out" title={`Log out (${currentUser.username})`} type="button" onClick={onLogout}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path
                  d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v7A1.5 1.5 0 0 0 3.5 13H6M10.5 11L14 8L10.5 5M14 8H6"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div className="avatar" title={currentUser.username}>
              {initialsFor(currentUser.username)}
            </div>
          </div>
        </nav>
      </div>
    </OpenNavContext.Provider>
  );
}
