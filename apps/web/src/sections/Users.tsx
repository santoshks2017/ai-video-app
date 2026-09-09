import { useEffect, useState } from 'react';
import { ROLE_LABELS, formatInr, type AppUser, type Role } from '@ava/shared';
import { useApp, api } from '../state/appStore.js';
import { Panel, Banner, Confirm } from '../components/ui.js';
import { isApiError, patchReq, get } from '../lib/client.js';

/**
 * Who can do what. Anyone who signs in with Google lands here as a viewer, and
 * an admin decides whether they get to spend money.
 */
export function UsersSection() {
  const users = useApp((s) => s.users);
  const me = useApp((s) => s.me);
  const refresh = useApp((s) => s.refresh);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [activity, setActivity] = useState<
    { uid: string; email: string; name?: string; type: string; at: number; detail?: string; projectName?: string; costInr?: number }[]
  >([]);

  useEffect(() => {
    void get<{ items: typeof activity }>('/api/activity?limit=60').then((r) => {
      if (!isApiError(r)) setActivity(r.items ?? []);
    });
  }, []);

  const setRole = async (u: AppUser, role: Role) => {
    setErr('');
    const r = await patchReq<AppUser>(`/api/users/${u.id}`, { role });
    if (isApiError(r)) {
      setErr(r.message);
      return;
    }
    await refresh();
    setNote(`${u.name || u.email} is now ${role === 'creator' ? 'a creator' : `an ${role}`}.`);
  };

  return (
    <Panel title="People" step={`${users.length}`}>
      <div className="section-desc">
        Everyone signs in with their Google account. A new person starts as a <b>viewer</b> — they can look
        around but cannot generate videos, edit the libraries or see API connections. Give them{' '}
        <b>creator</b> when you want them making videos; generation costs real money, so this is the switch
        that matters.
      </div>
      {note && <Banner kind="ok">{note}</Banner>}
      {err && <Banner kind="bad">{err}</Banner>}

      {users.length === 0 && (
        <div className="hint">
          Nobody has signed in with Google yet. Share the app link — the first sign-in creates the account,
          and you set the role here.
        </div>
      )}

      <div className="people">
        {users.map((u) => {
          const self = u.id === me?.id;
          return (
            <div className="person" key={u.id}>
              {u.photo ? (
                <img src={u.photo} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="person-ph">{(u.name || u.email || '?').slice(0, 1).toUpperCase()}</span>
              )}
              <span className="person-meta">
                <b>
                  {u.name || u.email}
                  {u.isOwner && <span className="chip accent">owner</span>}
                  {self && !u.isOwner && <span className="chip">you</span>}
                </b>
                <span>
                  {[
                    u.email,
                    u.lastSeenAt && `last seen ${new Date(u.lastSeenAt).toLocaleDateString()}`,
                    u.generations ? `${u.generations} generation${u.generations > 1 ? 's' : ''}` : null,
                    u.spendInr ? formatInr(u.spendInr) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <select
                value={u.role}
                disabled={u.isOwner}
                title={u.isOwner ? 'The owner account is always an admin.' : ROLE_LABELS[u.role]}
                onChange={(e) => setRole(u, e.target.value as Role)}
              >
                <option value="viewer">Viewer</option>
                <option value="creator">Creator</option>
                <option value="admin">Admin</option>
              </select>
              {!u.isOwner && !self && (
                <Confirm
                  onConfirm={async () => {
                    await api.users.remove(u.id);
                    await refresh();
                  }}
                >
                  Remove
                </Confirm>
              )}
            </div>
          );
        })}
      </div>

      <div className="divider" />
      <h3 className="sub-head">Recent activity</h3>
      <div className="section-desc" style={{ marginTop: 0 }}>
        Sign-ins and every paid action, newest first. A shared password could tell you something happened; this
        tells you who did it.
      </div>
      {activity.length === 0 ? (
        <div className="hint">Nothing logged yet.</div>
      ) : (
        <div className="activity">
          {activity.map((a, i) => (
            <div className={`act act-${a.type}`} key={i}>
              <span className="act-when">
                {new Date(a.at).toLocaleString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span className="act-who">{a.name || a.email}</span>
              <span className="act-what">
                <b>{a.type}</b>
                {a.projectName ? ` · ${a.projectName}` : ''}
                {a.detail ? ` · ${a.detail}` : ''}
              </span>
              <span className="act-cost">{a.costInr ? formatInr(a.costInr) : ''}</span>
            </div>
          ))}
        </div>
      )}

      <div className="divider" />
      <div className="hint">
        {Object.entries(ROLE_LABELS).map(([k, v]) => (
          <div key={k}>
            <b>{k}</b> — {v.split('— ')[1]}
          </div>
        ))}
      </div>
    </Panel>
  );
}
