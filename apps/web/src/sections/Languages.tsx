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

  /**
   * Pull the shipped guide back over a saved one. Needed whenever the built-in
   * rules improve: a language already in the database never re-reads its seed.
   */
  const seed = LANGUAGE_SEEDS.find((l) => l.code === draft?.code.trim().toLowerCase());
  const resetToBuiltIn = () => {
    if (!seed) return;
    set({
      spokenGuide: seed.spokenGuide,
      writtenGuide: seed.writtenGuide,
      glossary: seed.glossary,
      needsPhonetics: seed.needsPhonetics,
    });
    setNote(`Loaded the built-in ${seed.name} guide — review it, then Save.`);
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
          picked on a project. The spoken guide is sent to the models — this is where delivery gets fixed, not in
          the code.
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
          {note && <Banner kind="ok">{note}</Banner>}
          {seed && (
            <div className="toolbar" style={{ marginTop: 0 }}>
              <button className="btn ghost small" type="button" onClick={resetToBuiltIn}>
                Load the built-in {seed.name} guide
              </button>
              <span className="hint">
                Replaces the rules and glossary below with the ones that ship with this version. Your edits are
                overwritten, and nothing is saved until you press Save.
              </span>
            </div>
          )}
          <div className="field-grid">
            <Field label="Name">
              <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Hindi" />
            </Field>
            <Field label="Code" hint="Matched against what a model says it can speak.">
              <input value={draft.code} onChange={(e) => set({ code: e.target.value })} placeholder="hi" />
            </Field>
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
            <div className="check-row">
              <input
                type="checkbox"
                id="lang_on"
                checked={draft.enabled}
                onChange={(e) => set({ enabled: e.target.checked })}
              />
              <label htmlFor="lang_on">Available on projects</label>
              <input
                type="checkbox"
                id="lang_def"
                checked={Boolean(draft.isDefault)}
                onChange={(e) => set({ isDefault: e.target.checked })}
                style={{ marginLeft: 14 }}
              />
              <label htmlFor="lang_def">Default for new projects</label>
            </div>
          </div>

          <div className="seg" style={{ margin: '12px 0 10px' }}>
            {(['spoken', 'written', 'glossary'] as const).map((t) => (
              <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'spoken'
                  ? 'Spoken rules'
                  : t === 'written'
                    ? 'On-screen text'
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
              hint="How cards, the footer and the end card are worded in this language. Read by whoever writes the text — the video model no longer draws any."
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
                Two lists in one. <b>Leave in English</b> is the safe default for anything the model already
                says correctly — respelling those is what makes a line sound wrong. <b>Respell</b> is for the few
                words you have actually heard come out badly, and for prices. Add a word here the moment you hear
                it mispronounced, and it is fixed the same way in every video from then on.
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
                    <select
                      value={g.mode === 'english' ? 'english' : 'respell'}
                      onChange={(e) => editRow(i, { mode: e.target.value as GlossaryEntry['mode'] })}
                      title="English: leave it exactly as written. Respell: force this spoken spelling."
                    >
                      <option value="english">leave in English</option>
                      <option value="respell">respell</option>
                    </select>
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
              <b>Spoken rules</b> shape how <i>Write the script</i> writes the lines: how numbers and prices are
              said, which English words stay in English, how the language is spelled when it is spoken aloud. There
              is one line per scene now and the video model says it exactly as written, so what this guide changes
              is the copy itself rather than a second respelling of it.
            </p>
            <p>
              <b>On-screen text rules</b> are the written standard for this language. Every word the viewer reads —
              the captions, the footer strip, the end card — is composited after generation rather than drawn by the
              video model, so spelling and legibility are no longer at risk; what these rules govern is wording,
              length and which script the text is set in.
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
