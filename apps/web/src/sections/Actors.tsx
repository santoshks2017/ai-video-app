import { useState } from 'react';
import type { ActorProfile } from '@ava/shared';
import { useApp, api } from '../state/appStore.js';
import { Field, Panel, PickList, ImageUpload, Thumb, Confirm, Empty } from '../components/ui.js';
import { isApiError } from '../lib/client.js';

function blank(): ActorProfile {
  const now = Date.now();
  return { id: '', name: '', gender: 'female', createdAt: now, updatedAt: now };
}

export function ActorsSection() {
  const actors = useApp((s) => s.actors);
  const refresh = useApp((s) => s.refresh);
  const [draft, setDraft] = useState<ActorProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (p: Partial<ActorProfile>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const save = async () => {
    if (!draft?.name.trim()) {
      setErr('Name is required.');
      return;
    }
    setSaving(true);
    setErr('');
    const r = await api.actors.save(draft);
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
    <div className="grid two">
      <Panel
        title="Actors"
        step={`${actors.length} saved`}
        actions={
          <button className="btn small" type="button" onClick={() => setDraft(blank())}>
            New actor
          </button>
        }
      >
        <div className="section-desc">
          Presenters and customers who appear on camera. The gender here locks the Hindi verb forms in the
          pronunciation rulebook; the styling text is injected verbatim into every prompt.
        </div>
        <PickList
          items={actors}
          activeId={draft?.id ?? null}
          onPick={(id) => setDraft(actors.find((a) => a.id === id) ?? null)}
          emptyText="No actors yet — create one to reuse across projects."
          render={(a) => (
            <>
              <b>{a.name}</b>
              <span>
                {a.gender}
                {a.age ? ` · ${a.age}` : ''}
                {a.voice ? ` · ${a.voice}` : ''}
              </span>
            </>
          )}
        />
      </Panel>

      {draft ? (
        <Panel
          title={draft.id ? 'Edit actor' : 'New actor'}
          actions={draft.id ? <Confirm onConfirm={() => del(draft.id)}>Delete</Confirm> : undefined}
        >
          {err && <div className="hint" style={{ color: 'var(--bad)', marginBottom: 8 }}>{err}</div>}
          <div className="row2">
            <Field label="Name / label">
              <input
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. Meera — Metro Premium promoter"
              />
            </Field>
            <Field label="Gender" hint="Locks the Hindi verb forms in the rulebook.">
              <select
                value={draft.gender}
                onChange={(e) => set({ gender: e.target.value as ActorProfile['gender'] })}
              >
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </Field>
          </div>
          <div className="row2">
            <Field label="Age range">
              <input value={draft.age ?? ''} onChange={(e) => set({ age: e.target.value })} placeholder="e.g. late 20s" />
            </Field>
            <Field label="Voice / delivery">
              <input
                value={draft.voice ?? ''}
                onChange={(e) => set({ voice: e.target.value })}
                placeholder="e.g. warm, energetic, confident ad pace"
              />
            </Field>
          </div>
          <Field label="Styling / look" hint="Wardrobe, hair, jewellery — copied straight into the prompt.">
            <textarea
              value={draft.style ?? ''}
              onChange={(e) => set({ style: e.target.value })}
              placeholder="e.g. fitted maroon polo dress, nude heels, subtle jewellery, hair tied back"
            />
          </Field>
          <Field label="Full-res file location (optional)">
            <input
              value={draft.sourceNote ?? ''}
              onChange={(e) => set({ sourceNote: e.target.value })}
              placeholder="e.g. Drive: AI Video / Actors / Meera.jpg"
            />
          </Field>

          <Field label="Reference photo" hint="Used as a visual reference when this actor is on camera.">
            <div className="thumbs">
              {draft.photo && <Thumb img={draft.photo} onRemove={() => set({ photo: undefined })} />}
              <ImageUpload
                label={`${draft.name || 'Actor'} — reference photo`}
                kind="dealer"
                buttonText={draft.photo ? 'Replace photo' : 'Upload photo'}
                onUploaded={(img) => set({ photo: img })}
              />
            </div>
          </Field>

          <Field label="Notes">
            <textarea value={draft.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
          </Field>

          <div className="toolbar">
            <button className="btn primary" type="button" disabled={saving} onClick={save}>
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
  );
}
