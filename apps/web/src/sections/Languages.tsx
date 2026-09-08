import { useEffect, useState } from 'react';
import { LANGUAGE_SEEDS, type GlossaryEntry, type LanguageProfile } from '@ava/shared';
import { useApp, api } from '../state/appStore.js';
import { Field, Panel, PickList, Confirm, Banner } from '../components/ui.js';
import { isApiError, post } from '../lib/client.js';

function blank(): LanguageProfile {
  const now = Date.now();
  return {
    id: '',
    code: '',
    name: '',
    nativeName: '',
    enabled: true,
    isDefault: false,
    needsPhonetics: true,
    spokenGuide: '',
    writtenGuide: '',
    glossary: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The Languages library: everything about how a language is spoken and written
 * in a video, in one place.
 *
 * These guides are not documentation — they are shipped to the models. The
 * spoken guide is the instruction for the pass that converts a script into its
 * pronunciation spelling; the written guide goes into the video prompt beside
 * the on-screen text. Editing here changes every future video in that language.
 */
export function LanguagesSection() {
  const languages = useApp((s) => s.languages);
  const refresh = useApp((s) => s.refresh);
  const [draft, setDraft] = useState<LanguageProfile | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'spoken' | 'written' | 'glossary'>('spoken');
  const [seeding, setSeeding] = useState(false);

  // First run: install the guides that ship with the app.
  useEffect(() => {
    if (languages.length || seeding) return;
    setSeeding(true);
    void post('/api/models/seed', {}).then(() => refresh());
  }, [languages.length, seeding, refresh]);

  const set = (p: Partial<LanguageProfile>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim() || !draft.code.trim()) {
      setErr('A language needs both a name and a code.');
      return;
    }
    setErr('');
    // Only one default; the picker falls back to it when a project names none.
    if (draft.isDefault) {
      for (const other of languages) {
        if (other.id !== draft.id && other.isDefault) await api.languages.patch(other.id, { isDefault: false });
      }
    }
    const r = await api.languages.save(draft);
    if (isApiError(r)) {
      setErr(r.message);
      return;
    }
    await refresh();
    setDraft(null);
    setNote(`Saved ${draft.name}.`);
  };

  const addBuiltIns = async () => {
    setSeeding(true);
    const r = (await post('/api/models/seed', {})) as { added?: string[] };
    await refresh();
    setSeeding(false);
    const added = (r?.added ?? []).filter((a) => /language guide/i.test(a));
    setNote(added.length ? `Added ${added.join(', ')}.` : 'Every built-in guide is already installed.');
  };

  const setGlossary = (rows: GlossaryEntry[]) => set({ glossary: rows });
  const editRow = (i: number, p: Partial<GlossaryEntry>) =>
    setGlossary((draft?.glossary ?? []).map((g, gi) => (gi === i ? { ...g, ...p } : g)));

  return (
    <div className="grid two">
      <Panel
        title="Languages"
        step={`${languages.filter((l) => l.enabled).length} available`}
        actions={
          <>
            <button className="btn small" type="button" disabled={seeding} onClick={addBuiltIns}>
              Add built-ins
            </button>
            <button className="btn small" type="button" onClick={() => { setDraft(blank()); setErr(''); }}>
              New language
            </button>
          </>
        }
      >
        <div className="section-desc">
          The rules for how each language is spoken and written in a video. Only languages switched on here can be
          picked on a project, and the guides below are sent to the models — this is where delivery gets fixed,
          not in the code.
        </div>
        {note && <Banner kind="ok">{note}</Banner>}
        <PickList
          items={languages}
          activeId={draft?.id ?? null}
          onPick={(id) => { setDraft(languages.find((l) => l.id === id) ?? null); setErr(''); setNote(''); }}
          emptyText="No languages yet."
          render={(l) => (
            <>
              <b>
                {l.name} {l.isDefault && <span className="chip accent">default</span>}
                {!l.enabled && <span className="chip">off</span>}
              </b>
              <span>
                {[
                  l.code,
                  l.needsPhonetics ? 'needs pronunciation spelling' : 'spelled as spoken',
                  `${l.glossary?.length ?? 0} locked terms`,
                ].join(' · ')}
              </span>
            </>
          )}
        />
      </Panel>

      {draft ? (
        <Panel
          title={draft.id ? `Edit ${draft.name || 'language'}` : 'New language'}
          actions={
            draft.id ? (
              <Confirm
                onConfirm={async () => {
                  await api.languages.remove(draft.id);
                  await refresh();
                  setDraft(null);
                }}
              >
                Delete
              </Confirm>
            ) : null
          }
        >
          {err && <Banner kind="bad">{err}</Banner>}
          <div className="row2">
            <Field label="Name">
              <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Hindi" />
            </Field>
            <Field label="Code" hint="Matched against what a model says it can speak.">
              <input value={draft.code} onChange={(e) => set({ code: e.target.value })} placeholder="hi" />
            </Field>
          </div>
          <div className="row2">
            <Field label="Native name">
              <input
                value={draft.nativeName ?? ''}
                onChange={(e) => set({ nativeName: e.target.value })}
                placeholder="हिन्दी"
              />
            </Field>
            <Field label="Written the way it is said?">
              <select
                value={draft.needsPhonetics ? 'no' : 'yes'}
                onChange={(e) => set({ needsPhonetics: e.target.value === 'no' })}
              >
                <option value="no">No — needs a pronunciation spelling</option>
                <option value="yes">Yes — send the line as written</option>
              </select>
            </Field>
          </div>
          <div className="check-row">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => set({ enabled: e.target.checked })}
            />
            <span>Available on projects</span>
          </div>
          <div className="check-row">
            <input
              type="checkbox"
              checked={Boolean(draft.isDefault)}
              onChange={(e) => set({ isDefault: e.target.checked })}
            />
            <span>Default for new projects</span>
          </div>

          <div className="toolbar" style={{ marginTop: 12, marginBottom: 8 }}>
            {(['spoken', 'written', 'glossary'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`btn small${tab === t ? ' primary' : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'spoken'
                  ? 'Spoken rules'
                  : t === 'written'
                    ? 'On-screen text rules'
                    : `Glossary (${draft.glossary?.length ?? 0})`}
              </button>
            ))}
          </div>

          {tab === 'spoken' && (
            <Field
              label="Pronunciation guide"
              hint="Sent verbatim as the instruction for the pass that converts a script into its spoken spelling."
            >
              <textarea
                className="guide"
                value={draft.spokenGuide}
                onChange={(e) => set({ spokenGuide: e.target.value })}
                placeholder="How this language must be pronounced: vowel length, stress, what the model gets wrong…"
              />
            </Field>
          )}

          {tab === 'written' && (
            <Field
              label="On-screen text rules"
              hint="Goes into the video prompt beside the exact strings — how cards, the footer and the end card must be set in this language."
            >
              <textarea
                className="guide"
                value={draft.writtenGuide}
                onChange={(e) => set({ writtenGuide: e.target.value })}
                placeholder="Which script to set text in, length limits, what garbles, what to do instead…"
              />
            </Field>
          )}

          {tab === 'glossary' && (
            <>
              <div className="section-desc" style={{ marginTop: 0 }}>
                Locked spellings, checked before any rule is applied — consistency across videos matters more than
                deriving a fresh spelling each time. Brand and dealership names belong here, so your own product
                never gets said two ways.
              </div>
              <div className="gloss">
                {(draft.glossary ?? []).map((g, i) => (
                  <div className="gloss-row" key={i}>
                    <input
                      value={g.term}
                      placeholder="Test Drive"
                      onChange={(e) => editRow(i, { term: e.target.value })}
                    />
                    <input
                      className="mono"
                      value={g.say}
                      placeholder="TEST DRAAIV"
                      onChange={(e) => editRow(i, { say: e.target.value })}
                    />
                    <input
                      value={g.group ?? ''}
                      placeholder="group"
                      onChange={(e) => editRow(i, { group: e.target.value })}
                    />
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => setGlossary((draft.glossary ?? []).filter((_, gi) => gi !== i))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="btn small"
                type="button"
                style={{ marginTop: 8 }}
                onClick={() => setGlossary([...(draft.glossary ?? []), { term: '', say: '' }])}
              >
                Add term
              </button>
            </>
          )}

          <div className="toolbar">
            <button className="btn primary" type="button" onClick={save}>
              Save language
            </button>
            <button className="btn ghost" type="button" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </Panel>
      ) : (
        <Panel title="How these are used">
          <div className="section-desc" style={{ marginTop: 0 }}>
            <p>
              <b>Spoken rules</b> drive the second pass of <i>Write the script</i>. The first pass writes the ad
              copy for meaning; the second converts it to the spelling the video model performs, using this guide
              as its instruction. Tuning the guide and re-running <i>Redo pronunciation</i> costs one cheap text
              call and leaves approved copy untouched.
            </p>
            <p>
              <b>On-screen text rules</b> are injected into the video prompt next to the exact card strings, so a
              language that garbles at length or in a particular script can say so once, here.
            </p>
            <p>
              <b>Glossary</b> entries are applied before any rule is derived. This is what stops the same brand
              name being pronounced two different ways across a campaign.
            </p>
            <p className="hint">
              {LANGUAGE_SEEDS.length} guides ship with the app ({LANGUAGE_SEEDS.map((l) => l.name).join(', ')}).
              &ldquo;Add built-ins&rdquo; installs any that are missing without touching ones you have edited.
            </p>
          </div>
        </Panel>
      )}
    </div>
  );
}
