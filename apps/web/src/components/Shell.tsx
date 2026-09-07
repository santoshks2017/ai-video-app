import { useState, type ReactNode } from 'react';
import { useApp, type Section } from '../state/appStore.js';

const NAV: { id: Section; label: string; icon: string }[] = [
  { id: 'projects', label: 'Projects', icon: '🎬' },
  { id: 'clients', label: 'Clients', icon: '🏢' },
  { id: 'cars', label: 'Cars', icon: '🚗' },
  { id: 'actors', label: 'Actors', icon: '🎭' },
  { id: 'instructions', label: 'Instructions', icon: '📐' },
];

export function SignIn() {
  const signIn = useApp((s) => s.signIn);
  const error = useApp((s) => s.signInError);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await signIn(pw);
    setBusy(false);
  };

  return (
    <div className="signin-wrap">
      <form className="card signin" onSubmit={submit}>
        <div className="brand" style={{ marginBottom: 14 }}>
          <div className="mark">AV</div>
          <div>
            <h1>AI Video App</h1>
            <div className="sub">CarDekho design team</div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="pw">Team password</label>
          <input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </div>
        {error && <div className="check bad"><span className="icon">✕</span><span>{error}</span></div>}
        <button className="btn primary" type="submit" disabled={busy || !pw} style={{ width: '100%', marginTop: 6 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { section, go, signOut, authEnabled, loading, openProjectId } = useApp();

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="mark">AV</div>
          <div>
            <h1>AI Video App</h1>
            <div className="sub">CarDekho dealer ad-slot videos</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`nav-item${section === n.id && !(n.id === 'projects' && openProjectId) ? ' on' : ''}`}
              onClick={() => go(n.id, null)}
            >
              <span aria-hidden>{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {loading && <span className="hint">Loading…</span>}
          {authEnabled && (
            <button className="btn ghost small" type="button" onClick={signOut}>
              Sign out
            </button>
          )}
        </div>
      </div>

      {!authEnabled && (
        <div className="check warn" style={{ marginBottom: 14 }}>
          <span className="icon">!</span>
          <span>
            No team password is set, so anyone with this link can generate videos and spend the API budget. Set
            one with <code>gcloud secrets versions add APP_PASSWORD --project ai-video-app-cd --data-file=-</code>{' '}
            then redeploy.
          </span>
        </div>
      )}

      {children}
    </div>
  );
}
