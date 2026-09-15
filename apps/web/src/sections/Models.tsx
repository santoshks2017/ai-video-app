import { useEffect, useState } from 'react';
import {
  PROVIDER_LABELS,
  OMNI_FLASH_DEFAULTS,
  type ApiCredential,
  type ProviderKind,
  type VideoModelProfile,
  type Resolution,
  type AspectRatio,
} from '@ava/shared';
import { useApp, api } from '../state/appStore.js';
import { Field, Panel, PickList, Confirm, Banner, Empty } from '../components/ui.js';
import { isApiError, post, del } from '../lib/client.js';

function blankCred(): ApiCredential {
  const now = Date.now();
  return {
    id: '',
    name: '',
    provider: 'google-gemini',
    hasKey: false,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

function blankModel(credentialId: string): VideoModelProfile {
  const now = Date.now();
  return {
    ...OMNI_FLASH_DEFAULTS,
    id: '',
    credentialId,
    name: '',
    modelId: '',
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function ModelsSection() {
  const { credentials, models, refresh } = useApp();
  const [tab, setTab] = useState<'models' | 'apis'>('models');
  const [cred, setCred] = useState<ApiCredential | null>(null);
  const [model, setModel] = useState<VideoModelProfile | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [note, setNote] = useState('');
  const [seeding, setSeeding] = useState(false);
  const [testing, setTesting] = useState(false);

  // First run: create the built-in credentials + models.
  useEffect(() => {
    if (models.length || credentials.length || seeding) return;
    setSeeding(true);
    post('/api/models/seed', {}).then(() => refresh());
  }, [models.length, credentials.length, seeding, refresh]);

  const testKey = async () => {
    if (!cred?.id) return;
    setTesting(true);
    const r = (await post(`/api/credentials/${cred.id}/test`, {})) as { ok?: boolean; detail?: string };
    setTesting(false);
    setNote(r?.detail ?? (r?.ok ? 'Key accepted.' : 'Test failed.'));
  };

  // Seeding is additive, so this also picks up models added after your install.
  const addBuiltIns = async () => {
    setSeeding(true);
    const r = (await post('/api/models/seed', {})) as { added?: string[] };
    await refresh();
    setSeeding(false);
    const added = Array.isArray(r?.added) ? r.added : [];
    setNote(added.length ? `Added ${added.join(', ')}.` : 'Every built-in model is already registered.');
  };

  const saveCred = async () => {
    if (!cred?.name.trim()) return setNote('Name the API connection first.');
    const r = await api.credentials.save(cred);
    if (isApiError(r)) return setNote(r.message);
    setCred(r);
    setNote('Saved.');
    await refresh();
  };

  const saveKey = async () => {
    if (!cred?.id || !keyInput.trim()) return;
    const r = await post<{ hasKey: boolean }>(`/api/credentials/${cred.id}/key`, { key: keyInput.trim() });
    if (isApiError(r)) return setNote(r.message);
    const gemini = cred.provider === 'google-gemini';
    setKeyInput('');
    setNote(
      gemini
        ? 'Key saved. Every Gemini call now uses it, on live and preview alike. Press Test to check it.'
        : 'Key saved. It is stored server-side and never sent back to the browser.',
    );
    await refresh();
    setCred({ ...cred, hasKey: true, ...(gemini ? { usesEnvKey: false } : {}) });
  };

  const clearKey = async () => {
    if (!cred?.id) return;
    const gemini = cred.provider === 'google-gemini';
    if (gemini && !window.confirm('Remove this key? Gemini goes back to the GOOGLE_API_KEY set on the service, on live and preview alike.')) return;
    await del(`/api/credentials/${cred.id}/key`);
    setNote(gemini ? 'Key removed. Gemini is back on the service’s GOOGLE_API_KEY.' : 'Key removed.');
    await refresh();
    setCred({ ...cred, hasKey: false, ...(gemini ? { usesEnvKey: true } : {}) });
  };

  const saveModel = async () => {
    if (!model?.name.trim() || !model.modelId.trim())
      return setNote('Both a display name and the provider model id are required.');
    if (model.isDefault) {
      for (const m of models.filter((x) => x.isDefault && x.id !== model.id)) {
        await api.models.patch(m.id, { isDefault: false });
      }
    }
    const r = await api.models.save(model);
    if (isApiError(r)) return setNote(r.message);
    setModel(r);
    setNote('Saved.');
    await refresh();
  };

  const credName = (id: string) => credentials.find((c) => c.id === id)?.name ?? '— missing —';

  return (
    <>
      <div className="toolbar" style={{ marginTop: 0, marginBottom: 12 }}>
        <button className={`btn small${tab === 'models' ? ' primary' : ''}`} onClick={() => setTab('models')}>
          Models
        </button>
        <button className={`btn small${tab === 'apis' ? ' primary' : ''}`} onClick={() => setTab('apis')}>
          API connections
        </button>
      </div>

      {note && <Banner kind="ok">{note}</Banner>}

      {tab === 'apis' ? (
        <div className="grid two">
          <Panel
            title="API connections"
            step={`${credentials.length}`}
            actions={
              <button className="btn small" type="button" onClick={() => { setCred(blankCred()); setNote(''); }}>
                Add API
              </button>
            }
          >
            <div className="section-desc">
              Each connection is one platform account. Keys are written server-side only — the app can tell you
              whether a key is saved, but never shows it again.
            </div>
            <PickList
              items={credentials}
              activeId={cred?.id ?? null}
              onPick={(id) => { setCred(credentials.find((c) => c.id === id) ?? null); setNote(''); }}
              emptyText="No API connections yet."
              render={(c) => (
                <>
                  <b>{c.name}</b>
                  <span>
                    {PROVIDER_LABELS[c.provider]} ·{' '}
                    <span className={`key-state ${c.hasKey ? 'set' : 'unset'}`}>
                      {c.usesEnvKey ? 'deploy key' : c.hasKey ? 'key saved' : 'no key'}
                    </span>
                  </span>
                </>
              )}
            />
          </Panel>

          {cred ? (
            <Panel
              title={cred.id ? 'Edit API connection' : 'New API connection'}
              actions={
                cred.id && !(cred.provider === 'google-gemini' && models.some((m) => m.credentialId === cred.id)) ? (
                  <Confirm
                    onConfirm={async () => {
                      await api.credentials.remove(cred.id);
                      setCred(null);
                      await refresh();
                    }}
                  >
                    Delete
                  </Confirm>
                ) : undefined
              }
            >
              <div className="row2">
                <Field label="Name">
                  <input
                    value={cred.name}
                    onChange={(e) => setCred({ ...cred, name: e.target.value })}
                    placeholder="e.g. Gemini (CarDekho)"
                  />
                </Field>
                <Field label="Platform">
                  <select
                    value={cred.provider}
                    onChange={(e) => setCred({ ...cred, provider: e.target.value as ProviderKind })}
                  >
                    {Object.entries(PROVIDER_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {cred.provider !== 'google-gemini' && (
                <>
                  <Field label="Base URL" hint="The endpoint root for this platform.">
                    <input
                      value={cred.baseUrl ?? ''}
                      onChange={(e) => setCred({ ...cred, baseUrl: e.target.value })}
                      placeholder="https://api.example.com/v1"
                    />
                  </Field>
                  {cred.provider === 'byteplus-ark' ? (
                    <Banner kind="ok">
                      Dreamina Seedance runs through this connection. Paste your ModelArk key below, then pick
                      Seedance as the model on a project.
                    </Banner>
                  ) : (
                    <Banner kind="warn">
                      Google Gemini and BytePlus ModelArk have video adapters today. You can register other
                      platforms and their models now, but generating with them returns a clear "not implemented"
                      until an adapter is added.
                    </Banner>
                  )}
                </>
              )}

              {cred.provider === 'google-gemini' && cred.id && (
                <Banner kind="ok">
                  {cred.usesEnvKey ? (
                    <>
                      Using the <code>GOOGLE_API_KEY</code> set on the Cloud Run service. Save a key below to use it
                      instead — for scripts, storyboard drawings, photo checks and every Gemini video model.
                    </>
                  ) : (
                    <>
                      Using the key saved here — for scripts, storyboard drawings, photo checks and every Gemini video
                      model. Remove it to go back to the service’s <code>GOOGLE_API_KEY</code>.
                    </>
                  )}
                </Banner>
              )}
              <Field
                label={cred.hasKey && !cred.usesEnvKey ? 'Replace API key' : 'API key'}
                hint="Stored server-side. It is never returned to the browser or written into the frontend bundle. Live and preview share one database, so a key saved here is used by both straight away."
              >
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="password"
                    autoComplete="off"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder={cred.hasKey && !cred.usesEnvKey ? '•••••••• (a key is saved)' : 'Paste the key'}
                    disabled={!cred.id}
                  />
                  <button className="btn small" type="button" disabled={!cred.id || !keyInput.trim()} onClick={saveKey}>
                    Save key
                  </button>
                  {(cred.hasKey || cred.usesEnvKey) && (
                    <button className="btn ghost small" type="button" disabled={testing} onClick={testKey}>
                      {testing ? 'Testing…' : 'Test'}
                    </button>
                  )}
                  {cred.hasKey && !cred.usesEnvKey && (
                    <button className="btn ghost small" type="button" onClick={clearKey}>
                      Remove
                    </button>
                  )}
                </div>
                {!cred.id && <div className="hint">Save the connection first, then add its key.</div>}
                {(cred.hasKey || cred.usesEnvKey) && (
                  <div className="hint">Test is a free read — it checks the key without generating anything.</div>
                )}
              </Field>

              <Field label="Notes">
                <textarea value={cred.notes ?? ''} onChange={(e) => setCred({ ...cred, notes: e.target.value })} />
              </Field>

              <div className="toolbar">
                <button className="btn primary" type="button" onClick={saveCred}>
                  Save connection
                </button>
                <button className="btn ghost" type="button" onClick={() => setCred(null)}>
                  Close
                </button>
              </div>
            </Panel>
          ) : (
            <Panel title="API connection">
              <Empty icon="🔑">Pick a connection, or add one.</Empty>
            </Panel>
          )}
        </div>
      ) : (
        <div className="grid two">
          <Panel
            title="Video models"
            step={`${models.length}`}
            actions={
              <>
                <button className="btn small" type="button" disabled={seeding} onClick={addBuiltIns}>
                  Add built-ins
                </button>
                <button
                  className="btn small"
                  type="button"
                  disabled={!credentials.length}
                  onClick={() => { setModel(blankModel(credentials[0]!.id)); setNote(''); }}
                >
                  Add model
                </button>
              </>
            }
          >
            <div className="section-desc">
              Models you can pick when generating. Their limits drive the pipeline — max clip length sets how a
              long video is split, and the reference-image cap sets how many stills each call receives.
            </div>
            <PickList
              items={models}
              activeId={model?.id ?? null}
              onPick={(id) => { setModel(models.find((m) => m.id === id) ?? null); setNote(''); }}
              emptyText="No models yet."
              render={(m) => (
                <>
                  <b>
                    {m.name} {m.isDefault && <span className="chip accent">default</span>}
                  </b>
                  <span>
                    {credName(m.credentialId)} · {m.minClipSec}–{m.maxClipSec}s · ${m.usdPerSecond}/s
                    {m.dailyRequestLimit ? ` · ${m.dailyRequestLimit}/day` : ''}
                    {m.enabled === false ? ' · disabled' : ''}
                  </span>
                </>
              )}
            />
          </Panel>

          {model ? (
            <Panel
              title={model.id ? 'Edit model' : 'New model'}
              actions={
                model.id ? (
                  <Confirm
                    onConfirm={async () => {
                      await api.models.remove(model.id);
                      setModel(null);
                      await refresh();
                    }}
                  >
                    Delete
                  </Confirm>
                ) : undefined
              }
            >
              <div className="row2">
                <Field label="Display name">
                  <input
                    value={model.name}
                    onChange={(e) => setModel({ ...model, name: e.target.value })}
                    placeholder="e.g. Gemini Omni Flash"
                  />
                </Field>
                <Field label="Provider model id" hint="Exactly as the platform expects it.">
                  <input
                    value={model.modelId}
                    onChange={(e) => setModel({ ...model, modelId: e.target.value })}
                    placeholder="gemini-omni-1.1-flash"
                  />
                </Field>
              </div>
              <Field label="API connection">
                <select
                  value={model.credentialId}
                  onChange={(e) => setModel({ ...model, credentialId: e.target.value })}
                >
                  {credentials.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {PROVIDER_LABELS[c.provider]}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="row3">
                <Field label="Min clip (s)">
                  <input
                    type="number"
                    value={model.minClipSec}
                    onChange={(e) => setModel({ ...model, minClipSec: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Max clip (s)" hint="Drives multi-segment splitting.">
                  <input
                    type="number"
                    value={model.maxClipSec}
                    onChange={(e) => setModel({ ...model, maxClipSec: Number(e.target.value) })}
                  />
                </Field>
                <Field label="USD per second">
                  <input
                    type="number"
                    step="0.01"
                    value={model.usdPerSecond}
                    onChange={(e) => setModel({ ...model, usdPerSecond: Number(e.target.value) })}
                  />
                </Field>
              </div>
              <div className="row2">
                <Field label="Resolutions" hint="Comma separated.">
                  <input
                    value={model.resolutions.join(', ')}
                    onChange={(e) =>
                      setModel({
                        ...model,
                        resolutions: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) as Resolution[],
                      })
                    }
                  />
                </Field>
                <Field label="Aspect ratios" hint="Comma separated.">
                  <input
                    value={model.aspects.join(', ')}
                    onChange={(e) =>
                      setModel({
                        ...model,
                        aspects: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) as AspectRatio[],
                      })
                    }
                  />
                </Field>
              </div>
              <div className="row2">
                <Field label="Max reference images per call" hint="Omni 1.1 Flash takes 10. A set the provider refuses is retried with one fewer — and each retry is a request counted against the day.">
                  <input
                    type="number"
                    value={model.maxReferenceImages}
                    onChange={(e) => setModel({ ...model, maxReferenceImages: Number(e.target.value) })}
                  />
                </Field>
                <Field
                  label="Daily request limit"
                  hint="Requests a day the provider allows this model on your account — read it off Google's rate-limit page (RPD). Each part of a film is one request. Leave empty if you do not know it; usage is still counted."
                >
                  <input
                    type="number"
                    min={0}
                    placeholder="Not set"
                    value={model.dailyRequestLimit ?? ''}
                    onChange={(e) =>
                      setModel({
                        ...model,
                        dailyRequestLimit: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)),
                      })
                    }
                  />
                </Field>
              </div>
              <div className="check-row">
                <input
                  type="checkbox"
                  id="m_i2v"
                  checked={model.supportsImageToVideo}
                  onChange={(e) => setModel({ ...model, supportsImageToVideo: e.target.checked })}
                />
                <label htmlFor="m_i2v">Supports image-to-video (needed for seamless multi-segment cuts)</label>
              </div>
              <div className="check-row">
                <input
                  type="checkbox"
                  id="m_ref"
                  checked={model.supportsReferenceImages}
                  onChange={(e) => setModel({ ...model, supportsReferenceImages: e.target.checked })}
                />
                <label htmlFor="m_ref">Supports reference images</label>
              </div>
              <div className="check-row">
                <input
                  type="checkbox"
                  id="m_def"
                  checked={model.isDefault}
                  onChange={(e) => setModel({ ...model, isDefault: e.target.checked })}
                />
                <label htmlFor="m_def">Default model for new projects</label>
              </div>
              <div className="check-row">
                <input
                  type="checkbox"
                  id="m_en"
                  checked={model.enabled}
                  onChange={(e) => setModel({ ...model, enabled: e.target.checked })}
                />
                <label htmlFor="m_en">Available for selection</label>
              </div>

              <div className="toolbar">
                <button className="btn primary" type="button" onClick={saveModel}>
                  Save model
                </button>
                <button className="btn ghost" type="button" onClick={() => setModel(null)}>
                  Close
                </button>
              </div>
            </Panel>
          ) : (
            <Panel title="Model">
              <Empty icon="🔌">Pick a model, or add one.</Empty>
            </Panel>
          )}
        </div>
      )}
    </>
  );
}
