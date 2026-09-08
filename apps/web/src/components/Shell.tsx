import { useState, type ReactNode } from 'react';
import { APP_VERSION, type Role } from '@ava/shared';
import { useApp, type Section } from '../state/appStore.js';

export const SECTION_META: Record<Section, { label: string; icon: string }> = {
  projects: { label: 'Projects', icon: '🎬' },
  clients: { label: 'Clients', icon: '🏢' },
  cars: { label: 'Cars', icon: '🚗' },
  actors: { label: 'Actors', icon: '🎭' },
  instructions: { label: 'Instructions', icon: '📐' },
  languages: { label: 'Languages', icon: '🗣️' },
  models: { label: 'APIs & models', icon: '🔌' },
  users: { label: 'People', icon: '👥' },
  whatsnew: { label: "What's new", icon: '✨' },
};

/** The rail. What's new is reached from the version in the foot instead. */
/** Rail entries, with the role each needs. What's new lives in the foot. */
const NAV: { id: Section; label: string; icon: string; needs?: Role }[] = (
  ['projects', 'clients', 'cars', 'actors', 'instructions', 'languages', 'models', 'users'] as Section[]
).map((id) => ({
  id,
  ...SECTION_META[id],
  needs: id === 'models' || id === 'users' ? ('admin' as Role) : undefined,
}));

export function SignIn() {
  const signIn = useApp((s) => s.signIn);
  const signInGoogle = useApp((s) => s.signInGoogle);
  const error = useApp((s) => s.signInError);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const google = async () => {
    setBusy(true);
    await signInGoogle();
    setBusy(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await signIn(pw);
    setBusy(false);
  };

  return (
    <div className="signin-wrap">
      <div className="card signin">
        <div className="brand" style={{ marginBottom: 14 }}>
          <div className="mark">AV</div>
          <div>
            <h1>AI Video App</h1>
            <div className="sub">CarDekho design team</div>
          </div>
        </div>

        <button className="btn google" type="button" disabled={busy} onClick={google}>
          <span className="g" aria-hidden>
            G
          </span>
          {busy ? 'Signing in…' : 'Continue with Google'}
        </button>
        <div className="hint" style={{ marginTop: 8 }}>
          Sign in with your work Google account. New accounts can look around; an admin grants access to
          generate videos.
        </div>

        {error && (
          <div className="check bad" style={{ marginTop: 12 }}>
            <span className="icon">✕</span>
            <span>{error}</span>
          </div>
        )}

        <div className="divider" />
        {showPassword ? (
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="pw">Team password</label>
              <input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            </div>
            <button className="btn" type="submit" disabled={busy || !pw} style={{ width: '100%', marginTop: 6 }}>
              {busy ? 'Signing in…' : 'Sign in with the password'}
            </button>
          </form>
        ) : (
          <button className="btn ghost small" type="button" onClick={() => setShowPassword(true)}>
            Use the team password instead
          </button>
        )}
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { tabs, activeTabId, go, signOut, authEnabled, loading, me, can } = useApp();
  const active = tabs.find((t) => t.id === activeTabId);
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
          {NAV.filter((n) => !n.needs || can(n.needs)).map((n) => (
            <button
              key={n.id}
              type="button"
              title={n.label}
              className={`rail-item${
                active?.kind === 'section' && active.section === n.id ? ' on' : ''
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
          {me && !collapsed && (
            <div className="rail-me" title={`${me.email} · ${me.role}`}>
              {me.photo ? (
                <img src={me.photo} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="rail-me-ph">{(me.name || me.email || '?').slice(0, 1).toUpperCase()}</span>
              )}
              <span>
                <b>{me.name || me.email || 'Team password'}</b>
                <em>{me.legacy ? 'shared password · admin' : me.role}</em>
              </span>
            </div>
          )}
          <button
            className="rail-item version"
            type="button"
            onClick={() => go('whatsnew', null)}
            title={`Version ${APP_VERSION} — what's new`}
          >
            <span className="rail-icon" aria-hidden>
              ✨
            </span>
            {!collapsed && <span className="rail-label">v{APP_VERSION} · What&rsquo;s new</span>}
          </button>
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
