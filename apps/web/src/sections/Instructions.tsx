import { useState } from 'react';
import type { GlobalInstruction } from '@ava/shared';
import { rulebookText } from '@ava/shared';
import { useApp, api } from '../state/appStore.js';
import { Field, Panel, Confirm, Banner } from '../components/ui.js';
import { isApiError } from '../lib/client.js';

function blank(order: number): GlobalInstruction {
  const now = Date.now();
  return { id: '', title: '', body: '', enabled: true, order, createdAt: now, updatedAt: now };
}

/**
 * Universal Settings from the workflow diagram: house rules appended to every
 * master prompt. The pronunciation rulebook is built in and always injected by
 * the prompt engine — it's shown here read-only for reference.
 */
export function InstructionsSection() {
  const instructions = useApp((s) => s.instructions);
  const refresh = useApp((s) => s.refresh);
  const [draft, setDraft] = useState<GlobalInstruction | null>(null);
  const [err, setErr] = useState('');

  const sorted = [...instructions].sort((a, b) => a.order - b.order);
  const set = (p: Partial<GlobalInstruction>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const save = async () => {
    if (!draft?.title.trim() || !draft.body.trim()) {
      setErr('Title and instruction text are both required.');
      return;
    }
    setErr('');
    const r = await api.instructions.save(draft);
    if (isApiError(r)) {
      setErr(r.message);
      return;
    }
    await refresh();
    setDraft(null);
  };

  const toggle = async (gi: GlobalInstruction) => {
    await api.instructions.patch(gi.id, { enabled: !gi.enabled });
    await refresh();
  };

  return (
    <div className="grid two">
      <Panel
        title="Global instructions"
        step={`${sorted.filter((i) => i.enabled).length} active`}
        actions={
          <button className="btn small" type="button" onClick={() => setDraft(blank(sorted.length))}>
            New instruction
          </button>
        }
      >
        <div className="section-desc">
          Applied to every video the team generates, on top of the built-in pronunciation rulebook. Use these for
          house style — framing preferences, things to always avoid, brand-safety rules.
        </div>

        {sorted.length === 0 && <div className="hint">No custom instructions yet.</div>}
        {sorted.map((gi) => (
          <div className="attach-item" key={gi.id}>
            <input type="checkbox" checked={gi.enabled} onChange={() => toggle(gi)} style={{ width: 'auto' }} />
            <div className="a-meta" style={{ flex: 1, minWidth: 0 }}>
              <b>{gi.title}</b>
              <span>{gi.body.slice(0, 90)}{gi.body.length > 90 ? '…' : ''}</span>
            </div>
            <button className="btn ghost small" type="button" onClick={() => setDraft(gi)}>
              Edit
            </button>
          </div>
        ))}

        <div className="divider" />
        <details>
          <summary className="hint" style={{ cursor: 'pointer' }}>
            Built-in: pronunciation &amp; delivery rulebook (always on, read-only)
          </summary>
          <pre className="rulebook">{rulebookText('female')}</pre>
        </details>
      </Panel>

      {draft ? (
        <Panel
          title={draft.id ? 'Edit instruction' : 'New instruction'}
          actions={
            draft.id ? (
              <Confirm
                onConfirm={async () => {
                  await api.instructions.remove(draft.id);
                  setDraft(null);
                  await refresh();
                }}
              >
                Delete
              </Confirm>
            ) : undefined
          }
        >
          {err && <Banner kind="bad">{err}</Banner>}
          <Field label="Title">
            <input
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="e.g. Never show competitor vehicles"
            />
          </Field>
          <Field label="Instruction" hint="Written as direction to the video model. Plain sentences work best.">
            <textarea
              style={{ minHeight: 160 }}
              value={draft.body}
              onChange={(e) => set({ body: e.target.value })}
              placeholder="e.g. Never show another manufacturer's vehicle in frame, even parked in the background."
            />
          </Field>
          <div className="row2">
            <Field label="Order" hint="Lower runs first.">
              <input
                type="number"
                value={draft.order}
                onChange={(e) => set({ order: Number(e.target.value) })}
              />
            </Field>
            <Field label="Active">
              <select
                value={draft.enabled ? 'yes' : 'no'}
                onChange={(e) => set({ enabled: e.target.value === 'yes' })}
              >
                <option value="yes">Enabled</option>
                <option value="no">Disabled</option>
              </select>
            </Field>
          </div>
          <div className="toolbar">
            <button className="btn primary" type="button" onClick={save}>
              Save
            </button>
            <button className="btn ghost" type="button" onClick={() => setDraft(null)}>
              Close
            </button>
          </div>
        </Panel>
      ) : (
        <Panel title="Instruction">
          <div className="hint">Pick an instruction to edit, or create a new one.</div>
        </Panel>
      )}
    </div>
  );
}
