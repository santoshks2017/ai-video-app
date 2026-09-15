import { useEffect, useMemo, useState } from 'react';
import { AGE_BANDS, ageBandOf, type ActorProfile, type AgeBand } from '@ava/shared';
import { useApp, api } from '../state/appStore.js';
import { Field, Panel, Section, ImageUpload, Thumb, Confirm, Empty, Lock, useReadOnly } from '../components/ui.js';
import { drawActorProfile, fillActorProfile, isApiError } from '../lib/client.js';

/** Common enough to be worth offering; anything else can still be typed. */
const ATTIRE = ['Saree', 'Kurta', 'Salwar kameez', 'Formal shirt', 'Polo shirt', 'Blazer', 'Dress', 'Casual'];

function blank(): ActorProfile {
  const now = Date.now();
  return { id: '', name: '', gender: 'female', createdAt: now, updatedAt: now };
}

export function ActorsSection() {
  const actors = useApp((s) => s.actors);
  const readOnly = useReadOnly();
  const refresh = useApp((s) => s.refresh);
  const projects = useApp((s) => s.projects);
  const clients = useApp((s) => s.clients);
  const [draft, setDraft] = useState<ActorProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [fGender, setFGender] = useState('');
  const [fBand, setFBand] = useState('');
  const [fAttire, setFAttire] = useState('');
  // Made from a description: what was typed, what the models are doing, and the way back.
  const [describe, setDescribe] = useState('');
  const [busy, setBusy] = useState<'' | 'fill' | 'draw'>('');
  const [aiNote, setAiNote] = useState('');
  const [aiErr, setAiErr] = useState('');
  const [undo, setUndo] = useState<ActorProfile | null>(null);
  const [keepFace, setKeepFace] = useState(true);
  const [setting, setSetting] = useState('');

  /** Attire values actually in the library, so the filter offers only real ones. */
  const attireFacets = useMemo(
    () =>
      [...new Set(actors.map((a) => (a.attire ?? '').trim()).filter(Boolean))].sort((x, y) =>
        x.localeCompare(y),
      ),
    [actors],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return actors
      .filter((a) => !fGender || a.gender === fGender)
      .filter((a) => !fBand || ageBandOf(a) === fBand)
      .filter((a) => !fAttire || (a.attire ?? '').toLowerCase() === fAttire.toLowerCase())
      .filter((a) => {
        if (!needle) return true;
        return [a.name, a.age, a.attire, a.style, a.voice, a.notes]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [actors, q, fGender, fBand, fAttire]);

  /** Where this actor has already been seen, so a face is not split across dealers. */
  const appearances = useMemo(() => {
    if (!draft?.id) return [] as { client: string; count: number }[];
    const map = new Map<string, number>();
    for (const p of projects.filter((x) => x.actorId === draft.id)) {
      const name = clients.find((c) => c.id === p.clientId)?.name ?? 'No client';
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([client, count]) => ({ client, count }))
      .sort((a, b) => b.count - a.count);
  }, [projects, clients, draft?.id]);

  const set = (p: Partial<ActorProfile>) => setDraft((d) => (d ? { ...d, ...p } : d));

  // A different actor opened: its own description, and nothing to undo.
  useEffect(() => {
    setDescribe(draft?.profilePrompt ?? '');
    setUndo(null);
    setAiNote('');
    setAiErr('');
    setSetting('');
  }, [draft?.id]);

  const drawSheet = async (from: ActorProfile, where: string, keep: boolean): Promise<void> => {
    setBusy('draw');
    setAiErr('');
    const r = await drawActorProfile(from, { setting: where || undefined, keepFace: keep && Boolean(from.photo?.storagePath) });
    setBusy('');
    if (isApiError(r)) {
      setAiErr(`The profile sheet could not be drawn: ${r.message}`);
      return;
    }
    setDraft((d) => (d ? { ...d, photo: r.photo, photoModel: r.model } : d));
    setAiNote(`Profile sheet drawn with ${r.model}. Save actor to keep it.`);
  };

  const fillFromDescription = async (andDraw: boolean): Promise<void> => {
    if (!draft || !describe.trim()) return;
    setBusy('fill');
    setAiErr('');
    setAiNote('');
    const before = draft;
    const r = await fillActorProfile(describe, draft);
    if (isApiError(r)) {
      setBusy('');
      setAiErr(r.message);
      return;
    }
    const { setting: where = '', ...fields } = r.fill;
    const next: ActorProfile = { ...draft, ...fields, profilePrompt: describe.trim() };
    setUndo(before);
    setDraft(next);
    setSetting(where);
    if (!andDraw) {
      setBusy('');
      setAiNote('Filled in from the description. Check the fields, then Save actor.');
      return;
    }
    await drawSheet(next, where, keepFace);
  };

  const save = async () => {
    if (!draft?.name.trim()) {
      setErr('Name is required.');
      return;
    }
    setSaving(true);
    setErr('');
    const r = await api.actors.save({ ...draft, traits: draft.traits?.map((t) => t.trim()).filter(Boolean) });
    setSaving(false);
    if (isApiError(r)) {
      setErr(r.message);
      return;
    }
    await refresh();
    setDraft(r);
  };

  const del = async (id: string) => {
    await api.actors.remove(id);
    setDraft(null);
    await refresh();
  };

  return (
    <div className="browse">
      <datalist id="ava-attire">
        {ATTIRE.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>

      <div className="card">
        <div className="head">
          <div className="head-left">
            <h2>Actors</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="step">
              {shown.length === actors.length ? `${actors.length} saved` : `${shown.length} of ${actors.length}`}
            </span>
            <button
              className="btn small primary"
              type="button"
              data-tour="actors-new"
              disabled={readOnly}
              title={readOnly ? 'Not available for viewer access' : undefined}
              onClick={() => setDraft(blank())}
            >
              New actor
            </button>
          </div>
        </div>
        <div className="body tight">
          <div className="browse-bar" data-tour="actors-filters">
            <input
              className="browse-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search a name, look or delivery…"
              aria-label="Search actors"
            />
            <select value={fGender} onChange={(e) => setFGender(e.target.value)} aria-label="Filter by gender">
              <option value="">Any gender</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
            <select value={fBand} onChange={(e) => setFBand(e.target.value)} aria-label="Filter by age range">
              <option value="">Any age</option>
              {AGE_BANDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <select value={fAttire} onChange={(e) => setFAttire(e.target.value)} aria-label="Filter by attire">
              <option value="">Any attire</option>
              {attireFacets.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            {(q || fGender || fBand || fAttire) && (
              <button
                className="btn ghost small"
                type="button"
                onClick={() => { setQ(''); setFGender(''); setFBand(''); setFAttire(''); }}
              >
                Clear
              </button>
            )}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            Presenters and customers who appear on camera. Gender locks the Hindi verb forms; the styling text goes
            into every prompt as written.
          </div>
        </div>
      </div>

      <div className={`browse-cols${draft?.id ? ' three' : ' two'}`}>
        <div className="browse-col" data-tour="actors-list">
          <div className="browse-col-head">
            <span>People</span>
            <span>{shown.length}</span>
          </div>
          <div className="browse-list">
            {shown.length === 0 && (
              <div className="hint" style={{ padding: 8 }}>
                {actors.length ? 'Nothing matches those filters.' : 'No actors yet — create one to reuse.'}
              </div>
            )}
            {shown.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`browse-item${a.id === draft?.id ? ' on' : ''}`}
                onClick={() => setDraft(actors.find((x) => x.id === a.id) ?? null)}
              >
                <b>{a.name}</b>
                <span>{[a.gender, ageBandOf(a), a.attire, a.voice].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
        </div>

      <div className="browse-detail">
      {draft ? (
        <Panel
          title={draft.id ? 'Edit actor' : 'New actor'}
          actions={draft.id ? <Confirm onConfirm={() => del(draft.id)}>Delete</Confirm> : undefined}
        >
          <Lock>
          {err && <div className="hint" style={{ color: 'var(--bad)', marginBottom: 8 }}>{err}</div>}
          <div className="actor-ai">
            <Field
              label="Describe the presenter"
              hint="A sentence or two is enough. The fields below are filled in from it, and Google’s image model (Nano Banana 2 where the key has it) draws a profile sheet — a hero shot, five expressions and four full views of the same person — as the reference photo. Every field can still be edited by hand, and your own photo uploaded instead."
            >
              <textarea
                value={describe}
                onChange={(e) => setDescribe(e.target.value)}
                placeholder="e.g. A warm, confident Marathi woman in her late 20s in a maroon polo dress, for premium showroom walkarounds"
              />
            </Field>
            <div className="toolbar" style={{ marginTop: 6 }}>
              <button
                className="btn primary small"
                type="button"
                disabled={!describe.trim() || Boolean(busy)}
                onClick={() => void fillFromDescription(true)}
              >
                {busy === 'fill' ? 'Writing the profile…' : busy === 'draw' ? 'Drawing the sheet…' : 'Fill profile & draw'}
              </button>
              <button
                className="btn ghost small"
                type="button"
                disabled={!describe.trim() || Boolean(busy)}
                onClick={() => void fillFromDescription(false)}
              >
                Fill fields only
              </button>
              {undo && !busy && (
                <button
                  className="btn ghost small"
                  type="button"
                  onClick={() => {
                    setDraft(undo);
                    setUndo(null);
                    setAiNote('Put back as it was.');
                  }}
                >
                  Undo
                </button>
              )}
            </div>
            {busy === 'draw' && <div className="hint">Drawing the profile sheet — usually 20 to 60 seconds.</div>}
            {aiNote && !busy && <div className="hint">{aiNote}</div>}
            {aiErr && <div className="hint" style={{ color: 'var(--bad)' }}>{aiErr}</div>}
          </div>
          <div className="field-grid">
            <Field label="Name / label">
              <input
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. Meera — Metro Premium promoter"
              />
            </Field>
            <Field label="Gender" hint="Locks the Hindi verb forms.">
              <select
                value={draft.gender}
                onChange={(e) => set({ gender: e.target.value as ActorProfile['gender'] })}
              >
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </Field>
            <Field label="Age, as you would describe it">
              <input value={draft.age ?? ''} onChange={(e) => set({ age: e.target.value })} placeholder="e.g. late 20s" />
            </Field>
            <Field label="Age range" hint={draft.ageBand ? undefined : `Read as ${ageBandOf(draft) ?? 'unset'}.`}>
              <select
                value={draft.ageBand ?? ''}
                onChange={(e) => set({ ageBand: (e.target.value || undefined) as AgeBand | undefined })}
              >
                <option value="">From the age above</option>
                {AGE_BANDS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Attire" hint="One or two words — what the filter narrows on.">
              <input
                value={draft.attire ?? ''}
                onChange={(e) => set({ attire: e.target.value })}
                placeholder="e.g. Saree"
                list="ava-attire"
              />
            </Field>
            <Field label="Voice / delivery">
              <input
                value={draft.voice ?? ''}
                onChange={(e) => set({ voice: e.target.value })}
                placeholder="e.g. warm, energetic, confident ad pace"
              />
            </Field>
            <div className="span">
              <Field label="Styling / look" hint="Wardrobe, hair, jewellery — copied straight into the prompt.">
                <textarea
                  value={draft.style ?? ''}
                  onChange={(e) => set({ style: e.target.value })}
                  placeholder="e.g. fitted maroon polo dress, nude heels, subtle jewellery, hair tied back"
                />
              </Field>
            </div>
            <div className="span">
              <Field label="Personality" hint="Who they are on camera, in a sentence or two. Written on the profile sheet.">
                <textarea
                  value={draft.personality ?? ''}
                  onChange={(e) => set({ personality: e.target.value })}
                  placeholder="e.g. Confident, friendly and relatable — makes complex information feel simple"
                />
              </Field>
            </div>
            <div className="span">
              <Field label="Key traits" hint="A few single words, separated by commas. Written on the profile sheet.">
                <input
                  value={(draft.traits ?? []).join(', ')}
                  onChange={(e) =>
                    set({
                      traits: e.target.value
                        .split(',')
                        .map((t) => t.trimStart())
                        .filter((t, i, all) => t || i === all.length - 1),
                    })
                  }
                  placeholder="e.g. Confident, Friendly, Relatable, Energetic"
                />
              </Field>
            </div>
          </div>

          <Field label="Reference photo" hint="The visual reference used when this actor is on camera.">
            <div className="thumbs">
              {draft.photo && <Thumb img={draft.photo} onRemove={() => set({ photo: undefined, photoModel: undefined })} />}
              <ImageUpload
                label={`${draft.name || 'Actor'} — reference photo`}
                kind="dealer"
                buttonText={draft.photo ? 'Replace photo' : 'Upload photo'}
                onUploaded={(img) => set({ photo: img, photoModel: undefined })}
              />
              <button
                className="btn ghost small"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => {
                  setUndo(draft);
                  void drawSheet(draft, setting, keepFace);
                }}
                title="Draw a profile sheet from the fields above"
              >
                {busy === 'draw' ? 'Drawing…' : draft.photo ? 'Redraw profile sheet' : 'Draw profile sheet'}
              </button>
            </div>
            {draft.photo && (
              <label className="actor-keep">
                <input type="checkbox" checked={keepFace} onChange={(e) => setKeepFace(e.target.checked)} />
                Keep the face in this photo when drawing
              </label>
            )}
            {draft.photo?.url && (
              <a className="actor-sheet" href={draft.photo.url} target="_blank" rel="noreferrer" title="Open full size">
                <img src={draft.photo.url} alt={draft.photo.label} />
              </a>
            )}
            {draft.photoModel && <div className="hint">Drawn by {draft.photoModel}.</div>}
          </Field>

          <div className="sec-stack">
            <Section sub title="Notes & file location" step={draft.notes?.trim() ? 'Has notes' : undefined}>
              <Field label="Full-res file location">
                <input
                  value={draft.sourceNote ?? ''}
                  onChange={(e) => set({ sourceNote: e.target.value })}
                  placeholder="e.g. Drive: AI Video / Actors / Meera.jpg"
                />
              </Field>
              <Field label="Notes">
                <textarea value={draft.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
              </Field>
            </Section>
          </div>

          </Lock>
          <div className="toolbar">
            <button className="btn primary" type="button" disabled={saving || readOnly} onClick={save}>
              {saving ? 'Saving…' : 'Save actor'}
            </button>
            <button className="btn ghost" type="button" onClick={() => setDraft(null)}>
              Close
            </button>
          </div>
        </Panel>
      ) : (
        <Panel title="Actor details">
          <Empty icon="🎭">Pick an actor on the left, or create a new one.</Empty>
        </Panel>
      )}
      </div>

      {/* Which dealerships this face already belongs to. A presenter seen at one
          showroom and then another belongs to neither. */}
      {draft?.id && (
        <div className="browse-side">
          <Panel
            title="Seen at"
            step={
              appearances.length
                ? `${appearances.reduce((n, a) => n + a.count, 0)} film${
                    appearances.reduce((n, a) => n + a.count, 0) === 1 ? '' : 's'
                  }`
                : 'None yet'
            }
          >
            {appearances.length === 0 ? (
              <div className="hint">Not cast in anything yet.</div>
            ) : (
              <>
                <div className="section-desc">
                  The dealerships {draft.name || 'this actor'} fronts. A dealership's audience learns one face —
                  using the same person again is what makes that work.
                </div>
                <div className="campaigns">
                  {appearances.map((a) => (
                    <div className="campaign-row" key={a.client}>
                      <b>{a.client}</b>
                      <span>
                        {a.count} film{a.count === 1 ? '' : 's'}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Panel>
        </div>
      )}
      </div>
    </div>
  );
}
