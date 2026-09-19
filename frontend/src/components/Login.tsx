import { useEffect, useState } from 'react';
import * as api from '../api/client';
import { ApiError } from '../api/client';
import type { CurrentUser } from '@kanlite/shared';

interface LoginProps {
  onAuthenticated: (user: CurrentUser) => void;
}

type Mode = 'loading' | 'setup' | 'login' | 'forgot' | 'forgot-sent' | 'set-password';

/** True for an invite link (new account, no password yet) vs a forgot-password/admin-reset link -- same backend flow, different wording. */
function isInviteLink() {
  return window.location.pathname === '/set-password';
}

export function Login({ onAuthenticated }: LoginProps) {
  const [mode, setMode] = useState<Mode>('loading');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Captured once, synchronously, at construction -- not re-read inside the effect below, since
  // StrictMode double-invokes effects in dev and the effect itself strips the token from the URL;
  // a second read after that would see an already-cleared URL and silently lose the token.
  const [resetToken] = useState(() => new URLSearchParams(window.location.search).get('token'));

  useEffect(() => {
    if (resetToken && (window.location.pathname === '/set-password' || window.location.pathname === '/reset-password')) {
      setMode('set-password');
      // The token is single-use and sensitive -- don't leave it sitting in the address bar/history.
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }
    api
      .bootstrapStatus()
      .then(({ needsSetup }) => setMode(needsSetup ? 'setup' : 'login'))
      .catch(() => setMode('login'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitSetPassword() {
    if (!resetToken) return;
    setError(null);
    setBusy(true);
    api
      .confirmPasswordReset(resetToken, password)
      .then(onAuthenticated)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'That link is invalid or has expired.'))
      .finally(() => setBusy(false));
  }

  function submitSetup() {
    setError(null);
    setBusy(true);
    api
      .bootstrap(username, email, password)
      .then(onAuthenticated)
      .catch((err) => setError(err instanceof Error ? err.message : 'Setup failed.'))
      .finally(() => setBusy(false));
  }

  function submitLogin() {
    setError(null);
    setBusy(true);
    api
      .login(username, password)
      .then(onAuthenticated)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Login failed.'))
      .finally(() => setBusy(false));
  }

  function submitForgot() {
    setError(null);
    setBusy(true);
    api
      .requestPasswordReset(username)
      .then(() => setMode('forgot-sent'))
      .catch((err) => setError(err instanceof Error ? err.message : 'Something went wrong.'))
      .finally(() => setBusy(false));
  }

  if (mode === 'loading') {
    return <div className="app-status">Loading…</div>;
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        {mode === 'setup' && (
          <>
            <div className="login-brand">Welcome to KanLite</div>
            <div className="login-sub">No accounts exist yet -- set up the first one. It'll be an App Admin.</div>
            {error && <div className="error-banner login-field">{error}</div>}
            <div className="login-field">
              <div className="field-label">Username</div>
              <input
                className="field-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="login-field">
              <div className="field-label">Email</div>
              <input className="field-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="login-field">
              <div className="field-label">Password</div>
              <input
                className="field-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitSetup()}
              />
            </div>
            <button className="btn-primary" type="button" style={{ width: '100%' }} disabled={busy} onClick={submitSetup}>
              Create admin account
            </button>
          </>
        )}

        {mode === 'login' && (
          <>
            <div className="login-brand">KanLite</div>
            <div className="login-sub">Sign in to see your boards.</div>
            {error && <div className="error-banner login-field">{error}</div>}
            <div className="login-field">
              <div className="field-label">Username</div>
              <input
                className="field-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="login-field">
              <div className="field-label">Password</div>
              <input
                className="field-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitLogin()}
              />
            </div>
            <button className="btn-primary" type="button" style={{ width: '100%' }} disabled={busy} onClick={submitLogin}>
              Sign in
            </button>
            <div className="login-foot">
              <button className="login-link" type="button" onClick={() => { setError(null); setMode('forgot'); }}>
                Forgot password?
              </button>
            </div>
          </>
        )}

        {mode === 'forgot' && (
          <>
            <div className="login-brand">Reset password</div>
            <div className="login-sub">We'll email a reset link to the address on file for this username.</div>
            {error && <div className="error-banner login-field">{error}</div>}
            <div className="login-field">
              <div className="field-label">Username</div>
              <input
                className="field-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <button className="btn-primary" type="button" style={{ width: '100%' }} disabled={busy} onClick={submitForgot}>
              Send reset link
            </button>
            <div className="login-foot">
              <button className="login-link" type="button" onClick={() => setMode('login')}>
                Back to sign in
              </button>
            </div>
          </>
        )}

        {mode === 'forgot-sent' && (
          <>
            <div className="login-brand">Check your email</div>
            <div className="login-sub" style={{ marginBottom: 0 }}>
              If "{username}" is a real account, a reset link was just emailed to the address on file for it. Links expire after 30 minutes.
            </div>
            <div className="login-foot" style={{ marginTop: 16 }}>
              <button className="login-link" type="button" onClick={() => setMode('login')}>
                Back to sign in
              </button>
            </div>
          </>
        )}

        {mode === 'set-password' && (
          <>
            <div className="login-brand">{isInviteLink() ? 'Welcome to KanLite' : 'Set a new password'}</div>
            <div className="login-sub">
              {isInviteLink() ? "Choose a password to finish creating your account." : 'Choose a new password for your account.'}
            </div>
            {error && <div className="error-banner login-field">{error}</div>}
            <div className="login-field">
              <div className="field-label">New password</div>
              <input
                className="field-input"
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitSetPassword()}
              />
            </div>
            <button className="btn-primary" type="button" style={{ width: '100%' }} disabled={busy} onClick={submitSetPassword}>
              {isInviteLink() ? 'Create account' : 'Set password'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
