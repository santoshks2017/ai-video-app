import { useEffect, useState } from 'react';
import { apiBase, del, get, isApiError, patchReq, post } from '../lib/client.js';
import { Banner, Confirm, Field, Panel, useReadOnly } from '../components/ui.js';

/** A key as the app may see it: everything but the secret, which is shown once and never stored. */
interface ApiKey {
  id: string;
  name: string;
  hint: string;
  enabled: boolean;
  scopes: Array<'images' | 'videos'>;
  dailyCapInr?: number;
  createdAt: number;
  createdBy?: string;
  lastUsedAt?: number;
  calls?: number;
  costInr?: number;
}

const rupees = (n: number | undefined): string => `₹${Math.round(n ?? 0).toLocaleString('en-IN')}`;
const when = (at: number | undefined): string => (at ? new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');

/**
 * The keys other apps call the engine with.
 *
 * A key is the whole of what another team needs from this app: no sign-in, no
 * brief, no library — a key, a prompt and a URL. It is shown once when it is
 * made, because only its hash is kept; a key that is lost is replaced, not read.
 */
export function EngineKeys() {
  const readOnly = useReadOnly();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState('');
  const [images, setImages] = useState(true);
  const [videos, setVideos] = useState(true);
  const [cap, setCap] = useState('');
  const [made, setMade] = useState<{ name: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    const r = await get<{ items: ApiKey[] }>('/api/api-keys');
    if (isApiError(r)) return setError(r.message);
    setKeys(r.items ?? []);
  };
  useEffect(() => {
    void load();
  }, []);

  const create = async (): Promise<void> => {
    if (!name.trim()) return setError('Give the key a name — whose app it is for.');
    setBusy(true);
    setError('');
    const scopes = [...(images ? ['images'] : []), ...(videos ? ['videos'] : [])];
    const r = await post<{ secret: string; key: ApiKey }>('/api/api-keys', { name, scopes, dailyCapInr: Number(cap) || 0 });
    setBusy(false);
    if (isApiError(r)) return setError(r.message);
    setMade({ name: name.trim(), secret: r.secret });
    setName('');
    setCap('');
    await load();
  };

  const change = async (id: string, patch: Partial<ApiKey>): Promise<void> => {
    const r = await patchReq(`/api/api-keys/${id}`, patch);
    if (isApiError(r)) return setError(r.message);
    await load();
  };

  const base = apiBase || window.location.origin;

  return (
    <div className="grid two">
      <Panel title="Keys" step={`${keys.length}`} note="One key per app that calls the engine. Switch a key off and its calls stop at once.">
        {error && <Banner kind="bad">{error}</Banner>}
        {made && (
          <Banner kind="ok">
            <div className="ek-made">
              <b>{made.name} — copy this key now.</b>
              <code>{made.secret}</code>
              <div className="ip-actions">
                <button
                  type="button"
                  className="btn small primary"
                  onClick={() => {
                    void navigator.clipboard.writeText(made.secret).then(
                      () => setCopied(true),
                      () => setError('Could not copy — select the key and copy it by hand.'),
                    );
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button type="button" className="btn small ghost" onClick={() => { setMade(null); setCopied(false); }}>
                  Done
                </button>
              </div>
              <small>It is not shown again: only its hash is kept. Lose it and you make a new one.</small>
            </div>
          </Banner>
        )}

        {!readOnly && (
          <div className="ek-new">
            <Field label="Name" hint="Whose app this is for — “CarDekho social tool”, “Dealer app”.">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="CarDekho social tool" />
            </Field>
            <div className="row2">
              <Field label="May ask for">
                <div className="ek-scopes">
                  <label>
                    <input type="checkbox" checked={images} onChange={(e) => setImages(e.target.checked)} /> Pictures
                  </label>
                  <label>
                    <input type="checkbox" checked={videos} onChange={(e) => setVideos(e.target.checked)} /> Films
                  </label>
                </div>
              </Field>
              <Field label="A day's limit" hint="In rupees. Empty: no limit of its own.">
                <input value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d]/g, ''))} placeholder="2000" inputMode="numeric" />
              </Field>
            </div>
            <button type="button" className="btn primary small" disabled={busy || (!images && !videos)} onClick={() => void create()}>
              {busy ? 'Making…' : 'New key'}
            </button>
          </div>
        )}

        <div className="ek-list">
          {keys.length === 0 && <div className="empty">No keys yet. Make one for the first app that needs the engine.</div>}
          {keys.map((k) => (
            <div key={k.id} className={`ek-key${k.enabled ? '' : ' off'}`}>
              <div className="ek-key-head">
                <b>{k.name}</b>
                <code>{k.hint}</code>
              </div>
              <div className="ek-key-meta">
                {(k.scopes ?? []).map((s) => (
                  <span key={s} className="chip">
                    {s === 'images' ? 'Pictures' : 'Films'}
                  </span>
                ))}
                {k.dailyCapInr ? <span className="chip">{rupees(k.dailyCapInr)} a day</span> : null}
                <span className="hint">
                  {k.calls ?? 0} call{(k.calls ?? 0) === 1 ? '' : 's'} · {rupees(k.costInr)} · last used {when(k.lastUsedAt)}
                </span>
              </div>
              {!readOnly && (
                <div className="ip-actions">
                  <button type="button" className="btn small ghost" onClick={() => void change(k.id, { enabled: !k.enabled })}>
                    {k.enabled ? 'Switch off' : 'Switch on'}
                  </button>
                  <Confirm
                    onConfirm={async () => {
                      const r = await del(`/api/api-keys/${k.id}`);
                      if (isApiError(r)) setError(r.message);
                      await load();
                    }}
                  >
                    Delete
                  </Confirm>
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="How another app calls it" note="A prompt in, a file out. Nothing else of this app is needed.">
        <p className="hint">
          Base: <code>{base}/v1</code> — send the key as <code>Authorization: Bearer ava_live_…</code>
        </p>
        <b className="ip-label">A picture, while you wait</b>
        <pre className="ek-code">{`curl ${base}/v1/images \\
  -H "Authorization: Bearer $AVA_KEY" \\
  -H "content-type: application/json" \\
  -d '{
    "prompt": "A red Renault Kiger outside a lit showroom at dusk",
    "aspect": "4:5",
    "references": [{ "url": "https://…/kiger-front.jpg" }]
  }'
# → { "url": "${base}/v1/files/…/image.png", "cost": { "inr": 9 } }`}</pre>
        <b className="ip-label">A film: ask, then ask again until it is done</b>
        <pre className="ek-code">{`curl ${base}/v1/videos \\
  -H "Authorization: Bearer $AVA_KEY" \\
  -H "content-type: application/json" \\
  -d '{ "prompt": "The car drives past the camera", "seconds": 16, "aspect": "16:9" }'
# → { "id": "vid_…", "status": "queued", "poll": "${base}/v1/videos/vid_…" }

curl ${base}/v1/videos/vid_… -H "Authorization: Bearer $AVA_KEY"
# → { "status": "done", "url": "${base}/v1/files/…/video.mp4" }`}</pre>
        <p className="hint">
          Files stay where they are put, so a link can be saved or handed on. Up to 30 seconds a film, made in parts and joined. The full contract is in
          <code> docs/engine-api.md</code>, and <code>{base}/v1</code> answers with the limits as they stand.
        </p>
      </Panel>
    </div>
  );
}
