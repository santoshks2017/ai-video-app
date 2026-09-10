import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  fmtTime,
  wordBudget,
  narrationMode,
  sceneCard,
  type Beat,
  type DealerPhoto,
  type ScenePlan,
} from '@ava/shared';
import type { NarrationKey } from '@ava/shared';

type SceneEdit = {
  dialogue?: string;
  phonetic?: string;
  shot?: string;
  ref?: string;
  card?: string;
  cardSub?: string;
};

/**
 * A textarea that is always exactly as tall as its contents.
 *
 * Fixed-height boxes in a storyboard hide the end of every line — you cannot
 * judge a script you can only see the first half of, and the designer was
 * scrolling inside a 40px box to read a sentence. Growing to fit costs a layout
 * pass per keystroke and makes the whole table readable at a glance.
 */
function AutoTextarea({
  value,
  onChange,
  className,
  placeholder,
  minRows = 2,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const fit = (): void => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    // scrollHeight is the content; the box is border-box, so the borders have to
    // be added back or every field ends up exactly one border short and clips
    // its last line.
    const borders = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + borders}px`;
  };

  useEffect(fit, [value]);

  // The text is not the only thing that changes how many lines it takes. The
  // column narrows when a panel opens beside it, and the web font arrives after
  // the first measure with different glyph widths — either one rewraps the text
  // without touching the value, and the field clips again.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      // Only a width change rewraps; reacting to our own height change would loop.
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      fit();
    });
    ro.observe(el);
    void document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, []);
  return (
    <textarea
      ref={ref}
      className={className}
      rows={minRows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * The caption composited over a scene, edited in place.
 *
 * It is drawn in post rather than by the model, so exactly what is typed here is
 * what the viewer reads — no respelling, no model to garble it. Clearing the
 * headline removes the caption; Reset brings back the template's.
 */
function CaptionEditor({
  beat,
  ov,
  onChange,
}: {
  beat: Beat;
  ov: SceneEdit;
  onChange: (patch: SceneEdit) => void;
}) {
  const card = sceneCard(beat, ov);
  const edited = ov.card !== undefined || ov.cardSub !== undefined;
  return (
    <div className="sb-caption">
      <AutoTextarea
        minRows={1}
        value={card?.text ?? ''}
        placeholder="No caption on this scene"
        onChange={(v) => onChange({ card: v })}
      />
      {card && (
        <AutoTextarea
          minRows={1}
          className="sb-caption-sub"
          value={card.sub ?? ''}
          placeholder="Small line under it (optional)"
          onChange={(v) => onChange({ cardSub: v })}
        />
      )}
      {(card || edited) && (
        <div className="sb-caption-actions">
          {card && (
            <button type="button" className="btn ghost small" onClick={() => onChange({ card: '', cardSub: '' })}>
              Remove
            </button>
          )}
          {edited && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => onChange({ card: undefined, cardSub: undefined })}
              title="Back to the caption the template wrote"
            >
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The reference image a shot is built on, with the option to change it. */
function RefPicker({
  chosen,
  options,
  onPick,
}: {
  chosen?: string;
  options: DealerPhoto[];
  onPick: (filename: string | undefined) => void;
}) {
  const pick = options.find((o) => o.filename === chosen);
  if (!options.length) {
    return <span className="hint">No reference images on this project yet.</span>;
  }
  return (
    <div className="sb-ref">
      <div className="sb-ref-thumb">
        {pick?.src ? (
          <img src={pick.src} alt={pick.label} loading="lazy" />
        ) : (
          <div className="sb-ref-auto" title="The model picks from all supplied references">
            auto
          </div>
        )}
      </div>
      <select
        value={chosen ?? ''}
        onChange={(e) => onPick(e.target.value || undefined)}
        title="Which supplied image this shot is built on"
      >
        <option value="">Auto — any reference</option>
        {options.map((o) => (
          <option key={o.filename} value={o.filename}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Editable storyboard (PRD P0.5): scene by scene, with timing, the reference
 * image the shot is built on, the shot direction and the spoken line. Edits are
 * saved and fed back into the master prompt (buildPrompt sceneOverrides).
 */
export function Storyboard({
  scenePlan,
  sceneEdits,
  narration,
  attachments = [],
  angle,
  onEditScene,
  onClearEdits,
  onWriteScript,
  onRedoPhonetics,
  languageName,
}: {
  scenePlan: ScenePlan | null;
  sceneEdits: Record<string, SceneEdit>;
  narration: NarrationKey;
  /** Every image supplied with this brief — the pool a shot can be built on. */
  attachments?: DealerPhoto[];
  /** What the last written script is arguing, so the idea can be judged first. */
  angle?: { viewer: string; idea: string; throughline: string; proof: string[] };
  onEditScene: (key: string, patch: SceneEdit) => void;
  onClearEdits: () => void;
  /** Fills every spoken scene with a real line. Resolves to a status message. */
  onWriteScript?: () => Promise<string>;
  /** Re-applies the language's pronunciation guide to the existing copy. */
  onRedoPhonetics?: () => Promise<string>;
  languageName?: string;
}) {
  const [writing, setWriting] = useState(false);
  const [scriptNote, setScriptNote] = useState('');
  const mode = narrationMode(narration);
  const editScene = onEditScene;
  const clearSceneEdits = onClearEdits;

  if (!scenePlan || scenePlan.scenes.length === 0) {
    return null;
  }

  // Logos are overlay furniture, never something a shot is framed on.
  const refOptions = attachments.filter((a) => a.kind !== 'logo' && a.kind !== 'brand-logo');

  const editCount = Object.keys(sceneEdits).length;
  const spokenScenes = mode.speaks ? scenePlan.scenes.filter((sc) => sc.beat.dialogue).length : 0;
  const scripted = mode.speaks
    ? scenePlan.scenes.filter((_, i) => {
        const o = sceneEdits[String(i)];
        return (o?.phonetic ?? o?.dialogue ?? '').trim();
      }).length
    : 0;

  const runScriptAction = async (fn: () => Promise<string>) => {
    setWriting(true);
    setScriptNote('');
    setScriptNote(await fn());
    setWriting(false);
  };

  let lastPart = -1;

  return (
    <div className="card">
      <div className="head">
        <h2>Storyboard</h2>
        <span className="step">
          {scenePlan.scenes.length} scenes · {scenePlan.parts} part{scenePlan.parts > 1 ? 's' : ''}
        </span>
      </div>
      <div className="body tight">
        {mode.speaks && onWriteScript && (
          <div className={`script-bar${scripted >= spokenScenes && spokenScenes > 0 ? ' done' : ''}`}>
            <div>
              <b>
                {scripted}/{spokenScenes} scenes have a written line
              </b>
              <span>
                {scripted >= spokenScenes && spokenScenes > 0
                  ? `The model performs the pronunciation line, not the ${languageName ?? 'plain'} one above it. Most of it should look untouched — respelling is only for words that come out wrong.`
                  : `Written in three passes: the angle, the draft, then an edit that cuts anything generic. Each line then gets a pronunciation pass.`}
              </span>
              {scriptNote && <span className="script-note">{scriptNote}</span>}
            </div>
            <div className="script-bar-actions">
              {onRedoPhonetics && scripted > 0 && (
                <button
                  className="btn small"
                  type="button"
                  disabled={writing}
                  onClick={() => runScriptAction(onRedoPhonetics)}
                  title="Re-applies the language guide to the copy you already have"
                >
                  Redo pronunciation
                </button>
              )}
              <button
                className="btn primary small"
                type="button"
                disabled={writing}
                onClick={() => runScriptAction(onWriteScript)}
              >
                {writing ? 'Working…' : scripted ? 'Rewrite script' : 'Write the script'}
              </button>
            </div>
          </div>
        )}

        {/* The idea the copy is arguing. Judge this before judging the lines —
            a good line serving a weak idea is still a weak film. */}
        {angle?.idea && (
          <div className="sb-angle">
            <div className="sb-angle-head">The angle this script is written to</div>
            <dl>
              <dt>Idea</dt>
              <dd>{angle.idea}</dd>
              {angle.viewer && (
                <>
                  <dt>Viewer</dt>
                  <dd>{angle.viewer}</dd>
                </>
              )}
              {angle.throughline && (
                <>
                  <dt>Builds</dt>
                  <dd>{angle.throughline}</dd>
                </>
              )}
              {angle.proof?.length > 0 && (
                <>
                  <dt>Proof</dt>
                  <dd>{angle.proof.join(' · ')}</dd>
                </>
              )}
            </dl>
          </div>
        )}

        <div className="section-desc">
          Edit any scene’s script, shot or reference image below — changes flow straight into the master prompt on
          the right, no full rebuild of the brief. On-screen text is deliberately absent from that prompt: it is
          composited over the finished video in post, like the logos and the end card, so a price is never
          misspelled by the model.
          {editCount > 0 && (
            <>
              {' '}
              <button className="btn ghost small" onClick={clearSceneEdits}>
                Reset {editCount} edit{editCount > 1 ? 's' : ''}
              </button>
            </>
          )}
        </div>
        <div className="sb-scroll">
          <table className="sb-table">
            <colgroup>
              <col className="c-scene" />
              <col className="c-ref" />
              <col className="c-shot" />
              <col className="c-vo" />
              <col className="c-card" />
            </colgroup>
            <thead>
              <tr>
                <th>Scene</th>
                <th>Visual reference</th>
                <th>Shot direction</th>
                <th>{mode.speaks ? 'Voiceover / script' : 'Story beat (no speech)'}</th>
                <th>On-screen text</th>
              </tr>
            </thead>
            <tbody>
              {scenePlan.scenes.map((sc, gi) => {
                const rows: ReactElement[] = [];
                if (sc.part !== lastPart && scenePlan.parts > 1) {
                  lastPart = sc.part;
                  rows.push(
                    <tr className="sb-part-row" key={`p${sc.part}`}>
                      <td colSpan={5}>
                        Part {sc.part + 1} of {scenePlan.parts}
                        {sc.part === 0 ? ' — create' : ' — extend'}
                      </td>
                    </tr>,
                  );
                }
                const ov = sceneEdits[String(gi)] ?? {};
                const baseShot = !mode.onCameraPerson && sc.beat.shotAlt ? sc.beat.shotAlt : sc.beat.shot;
                rows.push(
                  <tr key={gi}>
                    <td className="sb-scene">
                      <div className="sb-scene-no">{gi + 1}</div>
                      <div className="sb-scene-title">{sc.beat.title}</div>
                      <div className="hint">{sc.beat.cat}</div>
                      <div className="sb-scene-time">
                        {fmtTime(sc.start)}–{fmtTime(sc.end)}
                        <br />
                        {sc.duration}s
                      </div>
                    </td>
                    <td>
                      <RefPicker
                        chosen={ov.ref}
                        options={refOptions}
                        onPick={(ref) => editScene(String(gi), { ref })}
                      />
                    </td>
                    <td>
                      <AutoTextarea
                        value={ov.shot ?? baseShot ?? ''}
                        onChange={(v) => editScene(String(gi), { shot: v })}
                      />
                    </td>
                    <td>
                      <AutoTextarea
                        value={ov.dialogue ?? sc.beat.dialogue ?? ''}
                        onChange={(v) => editScene(String(gi), { dialogue: v })}
                      />
                      {mode.speaks && (
                        <>
                          <div className="hint">~{wordBudget(sc.duration)} words max</div>
                          {/* The respelling is what the video model performs — the
                              line above is only here so a human can read it. */}
                          <div className="sb-say">
                            <label>Pronunciation — what the model actually says</label>
                            <AutoTextarea
                              className={ov.phonetic?.trim() ? '' : 'unset'}
                              value={ov.phonetic ?? ''}
                              placeholder="आज ही अपनी test drive book KEE-ji-ye"
                              onChange={(v) => editScene(String(gi), { phonetic: v })}
                            />
                          </div>
                        </>
                      )}
                    </td>
                    <td>
                      <CaptionEditor beat={sc.beat} ov={ov} onChange={(patch) => editScene(String(gi), patch)} />
                    </td>
                  </tr>,
                );
                return rows;
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
