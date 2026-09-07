import { useState, type ReactNode } from 'react';
import { useApp, type Section } from '../state/appStore.js';

const NAV: { id: Section; label: string; icon: string }[] = [
  { id: 'projects', label: 'Projects', icon: '🎬' },
  { id: 'clients', label: 'Clients', icon: '🏢' },
  { id: 'cars', label: 'Cars', icon: '🚗' },
  { id: 'actors', label: 'Actors', icon: '🎭' },
  { id: 'instructions', label: 'Instructions', icon: '📐' },
  { id: 'models', label: 'APIs & models', icon: '🔌' },
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
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`layout${collapsed ? ' collapsed' : ''}`}>
      <aside className="rail">
        <div className="rail-brand">
          <div className="mark">AV</div>
          {!collapsed && (
            <div>
              <h1>AI Video App</h1>
              <div className="sub">CarDekho dealer ad-slots</div>
            </div>
          )}
        </div>

        <nav className="rail-nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              title={n.label}
              className={`rail-item${
                section === n.id && !(n.id === 'projects' && openProjectId) ? ' on' : ''
              }`}
              onClick={() => go(n.id, null)}
            >
              <span className="rail-icon" aria-hidden>
                {n.icon}
              </span>
              {!collapsed && <span className="rail-label">{n.label}</span>}
            </button>
          ))}
        </nav>

        <div className="rail-foot">
          {loading && !collapsed && <div className="hint">Loading…</div>}
          {authEnabled && (
            <button className="rail-item" type="button" onClick={signOut} title="Sign out">
              <span className="rail-icon" aria-hidden>
                ⏻
              </span>
              {!collapsed && <span className="rail-label">Sign out</span>}
            </button>
          )}
          <button
            className="rail-item"
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <span className="rail-icon" aria-hidden>
              {collapsed ? '▶' : '◀'}
            </span>
            {!collapsed && <span className="rail-label">Collapse</span>}
          </button>
        </div>
      </aside>

      <main className="main">
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
      </main>
    </div>
  );
}
