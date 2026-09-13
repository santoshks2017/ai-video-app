import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  fmtTime,
  wordBudget,
  narrationMode,
  sceneCard,
  type Beat,
  type DealerPhoto,
  type ScenePlan,
  speakingSeconds,
  sceneEditFor,
  sceneVisual,
  PACES,
  type SceneVisual,
} from '@ava/shared';
import type { NarrationKey } from '@ava/shared';

/** The still a scene is framed on, drawn by the image model. */
export type SceneFrame = {
  refId: string;
  storagePath: string;
  url?: string;
  filename: string;
  label: string;
};

type SceneEdit = {
  dialogue?: string;
  /** Legacy: the pronunciation respelling, on projects written before Omni said the copy correctly. */
  phonetic?: string;
  frame?: SceneFrame;
  shot?: string;
  ref?: string;
  card?: string;
  cardSub?: string;
  deleted?: boolean;
  skipped?: boolean;
};

/** A scene held out of this cut, and where in the running order it sits. */
export type SkippedScene = { key: string; title: string; cat: string; afterKey?: string };

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
  const template = sceneCard(beat, undefined);
  const edited = ov.card !== undefined || ov.cardSub !== undefined;
  // Show exactly what was typed. sceneCard() trims — right for what gets
  // composited, wrong for an input: trimming on every keystroke deleted a space
  // the instant it was typed, so a caption could never grow past one word.
  const headline = ov.card !== undefined ? ov.card : (template?.text ?? '');
  const subline = ov.cardSub !== undefined ? ov.cardSub : (template?.sub ?? '');
  return (
    <div className="sb-caption">
      <AutoTextarea
        minRows={1}
        value={headline}
        placeholder="No caption on this scene"
        onChange={(v) => onChange({ card: v })}
      />
      {headline.trim().length > 32 && (
        <span className="hint">Long captions are set smaller to fit — under about 30 characters reads best.</span>
      )}
      {card && (
        <AutoTextarea
          minRows={1}
          className="sb-caption-sub"
          value={subline}
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

/**
 * The scene, drawn before it is filmed.
 *
 * A shot direction is a sentence, and a sentence leaves the camera, the distance,
 * the light and where everyone stands to the video model — which is most of what
 * drifts between one part of a film and the next. A still settles all of it for a
 * fraction of a paisa, is there to be looked at and rejected before any video is
 * paid for, and then travels to the renderer as the first reference for its part.
 */
function SceneFrameCell({
  frame,
  busy,
  title,
  onDraw,
  onClear,
}: {
  frame?: SceneFrame;
  busy: boolean;
  title: string;
  onDraw?: () => void;
  onClear: () => void;
}) {
  if (!onDraw && !frame) return null;
  return (
    <div className="sb-frame">
      {frame?.url ? (
        <a
          className="sb-frame-shot"
          href={frame.url}
          target="_blank"
          rel="noreferrer"
          title="Open the full-size frame"
        >
          <img src={frame.url} alt={`How ${title} is framed`} loading="lazy" />
        </a>
      ) : (
        <div className={`sb-frame-shot empty${busy ? ' busy' : ''}`}>
          {busy ? 'Drawing…' : 'Not drawn'}
        </div>
      )}
      <div className="sb-frame-actions">
        {onDraw && (
          <button type="button" className="btn ghost small" disabled={busy} onClick={onDraw}>
            {busy ? 'Drawing…' : frame ? 'Draw again' : 'Draw it'}
          </button>
        )}
        {frame && !busy && (
          <button type="button" className="btn ghost small" onClick={onClear} title="Film this scene without a frame">
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The photo a shot is built on, with the option to change it. When the shot frames a
 * part of the vehicle that no supplied photo shows, it says so: the model will make a
 * generic one, and the designer decides whether that will do.
 */
function RefPicker({
  chosen,
  options,
  visual,
  onPick,
}: {
  chosen?: string;
  options: DealerPhoto[];
  visual: SceneVisual;
  onPick: (filename: string | undefined) => void;
}) {
  const shown = visual.kind === 'picked' || visual.kind === 'matched' ? visual.photo : undefined;
  return (
    <div className="sb-ref">
      <div className={`sb-ref-thumb${visual.kind === 'generic' ? ' generic' : ''}`}>
        {shown?.src ? (
          <img src={shown.src} alt={shown.label} loading="lazy" />
        ) : visual.kind === 'generic' ? (
          <div className="sb-ref-auto" title="No supplied photo shows this">
            generic
          </div>
        ) : (
          <div className="sb-ref-auto" title="The model picks from all supplied references">
            auto
          </div>
        )}
      </div>
      {options.length > 0 ? (
        <select
          value={chosen ?? ''}
          onChange={(e) => onPick(e.target.value || undefined)}
          title="Which supplied image this shot is built on"
        >
          <option value="">{visual.kind === 'matched' ? `Auto — ${visual.topic} photo` : 'Auto — any reference'}</option>
          {options.map((o) => (
            <option key={o.filename} value={o.filename}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="hint">No reference images on this project yet.</span>
      )}
      {visual.kind === 'generic' && (
        <span className="sb-ref-generic">
          No photo of the {visual.topic} — a generic visual will be used. Pick a photo if that won’t do.
        </span>
      )}
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
  languageName,
  onDrawScenes,
  vehicle = 'car',
  length,
  onLength,
  deletedScenes = [],
  onDeleteScene,
  onMoveScene,
  onAddScene,
  onRestoreScene,
  skippedScenes = [],
  onSkipScene,
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
  languageName?: string;
  /**
   * Draw a still for these scenes. Resolves to a status message. Batched, because
   * the references are read once for the whole storyboard rather than per scene.
   */
  onDrawScenes?: (keys: string[]) => Promise<string>;
  /** Cars and bikes name their parts differently. */
  vehicle?: 'car' | 'bike';
  /** The film's length — auto, or set by hand at 1x — and the pace it is played at. */
  length?: { auto: boolean; seconds: number; suggested: number; pace: number; endCard: number };
  onLength?: (patch: { durationAuto?: boolean; durationSec?: number; pace?: number }) => void;
  /** Scenes taken out of the film, so they can be put back. */
  deletedScenes?: { key: string; title: string; cat: string }[];
  onDeleteScene?: (key: string) => void;
  onRestoreScene?: (key: string) => void;
  /**
   * Scenes held out of this cut but left where they are. Shown in place, greyed,
   * with everything typed into them intact — the switch you flick twice while
   * deciding, which is most of them.
   */
  skippedScenes?: SkippedScene[];
  onSkipScene?: (key: string, skip: boolean) => void;
  /** Move a scene one place earlier or later in the film. */
  onMoveScene?: (key: string, by: -1 | 1) => void;
  /** Write a scene of your own, straight after this one. */
  onAddScene?: (afterKey?: string) => void;
}) {
  const [writing, setWriting] = useState(false);
  const [scriptNote, setScriptNote] = useState('');
  /** Scenes the image model is drawing right now, by key. */
  const [drawing, setDrawing] = useState<string[]>([]);
  const [drawNote, setDrawNote] = useState('');
  const mode = narrationMode(narration);
  const editScene = onEditScene;
  const clearSceneEdits = onClearEdits;

  if (!scenePlan || scenePlan.scenes.length === 0) {
    return null;
  }

  // What a shot can be framed on. Logos are composited furniture, the presenter is
  // a person rather than a shot, and a reference video is not a still to build on.
  const refOptions = attachments.filter(
    (a) =>
      a.kind !== 'logo' &&
      a.kind !== 'brand-logo' &&
      a.kind !== 'actor' &&
      a.kind !== 'reference-video',
  );

  // Every scene's photo, worked out once: the table shows it per row, and the scenes
  // that will get a generic visual are called out together above it.
  const visuals = scenePlan.scenes.map((sc) => {
    const ov = sceneEditFor(sceneEdits, scenePlan, sc) ?? {};
    const baseShot = !mode.onCameraPerson && sc.beat.shotAlt ? sc.beat.shotAlt : sc.beat.shot;
    return sceneVisual(ov.shot?.trim() || baseShot || '', ov.ref, refOptions, vehicle);
  });
  const generic = scenePlan.scenes
    .map((sc, i) => ({ sc, i, visual: visuals[i]! }))
    .filter((x) => x.visual.kind === 'generic');
  // The pace speeds the finished film up after generation.
  const filmSeconds = Math.round((scenePlan.scenes.at(-1)?.end ?? 0) / (length?.pace ?? 1));

  const editCount = Object.keys(sceneEdits).length;
  const spokenScenes = mode.speaks ? scenePlan.scenes.filter((sc) => sc.beat.dialogue).length : 0;
  const scripted = mode.speaks
    ? scenePlan.scenes.filter((sc) => {
        const o = sceneEditFor(sceneEdits, scenePlan, sc);
        return (o?.phonetic ?? o?.dialogue ?? '').trim();
      }).length
    : 0;

  /** Scenes whose frame has been drawn, and the ones still waiting. */
  const framed = scenePlan.scenes.filter((sc) => sceneEditFor(sceneEdits, scenePlan, sc)?.frame);
  const unframed = scenePlan.scenes
    .filter((sc) => !sceneEditFor(sceneEdits, scenePlan, sc)?.frame)
    .map((sc, i) => sc.beat.key ?? String(i));

  const draw = async (keys: string[]): Promise<void> => {
    if (!onDrawScenes || !keys.length) return;
    setDrawing((d) => [...new Set([...d, ...keys])]);
    setDrawNote('');
    const note = await onDrawScenes(keys);
    setDrawing((d) => d.filter((k) => !keys.includes(k)));
    setDrawNote(note);
  };

  const runScriptAction = async (fn: () => Promise<string>) => {
    setWriting(true);
    setScriptNote('');
    setScriptNote(await fn());
    setWriting(false);
  };

  let lastPart = -1;
  // Where each skipped scene sits: after the last scene that is still in the film,
  // or at the top when nothing precedes it.
  const skippedAfter = new Map<string, SkippedScene[]>();
  for (const sk of skippedScenes) {
    const at = sk.afterKey ?? '';
    skippedAfter.set(at, [...(skippedAfter.get(at) ?? []), sk]);
  }
  const skippedRow = (sk: SkippedScene): ReactElement => (
    <tr className="sb-skipped-row" key={`skip-${sk.key}`}>
      <td colSpan={5}>
        <span className="sb-skipped-tag">Skipped</span>
        <b>{sk.title}</b>
        {sk.cat ? <span className="hint"> · {sk.cat}</span> : null}
        <span className="hint"> — not generated, not timed, and everything written in it is kept.</span>
        {onSkipScene && (
          <button type="button" className="btn small" onClick={() => onSkipScene(sk.key, false)}>
            Put it back
          </button>
        )}
      </td>
    </tr>
  );

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
                  ? `The model says each line exactly as it is written here, in ${languageName ?? 'the chosen language'}. Edit any of them.`
                  : 'Written in three passes: the angle, the draft, then an edit that cuts anything generic.'}
              </span>
              {scriptNote && <span className="script-note">{scriptNote}</span>}
            </div>
            <div className="script-bar-actions">
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

        {onDrawScenes && (
          <div className={`script-bar${framed.length >= scenePlan.scenes.length ? ' done' : ''}`}>
            <div>
              <b>
                {framed.length}/{scenePlan.scenes.length} scenes have been drawn
              </b>
              <span>
                A still of each scene, drawn from the same photographs the film is built on. It settles the camera,
                the framing and where everyone stands before any video is paid for — and it is sent as the first
                reference for the part its scene falls in.
              </span>
              {drawNote && <span className="script-note">{drawNote}</span>}
            </div>
            <div className="script-bar-actions">
              <button
                className="btn small"
                type="button"
                disabled={drawing.length > 0 || !unframed.length}
                onClick={() => void draw(unframed)}
                title={unframed.length ? 'Draw the scenes that have no frame yet' : 'Every scene has a frame'}
              >
                {drawing.length
                  ? `Drawing ${drawing.length}…`
                  : !unframed.length
                    ? 'All drawn'
                    : framed.length
                      ? `Draw the remaining ${unframed.length}`
                      : `Draw all ${unframed.length}`}
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

        {length && onLength && (
          <div className="sb-length">
            <div className="sb-length-group">
              <label>Length at 1x</label>
              <div className="seg">
                <button type="button" className={length.auto ? 'on' : ''} onClick={() => onLength({ durationAuto: true })}>
                  Auto · {length.suggested}s
                </button>
                <button
                  type="button"
                  className={length.auto ? '' : 'on'}
                  onClick={() =>
                    onLength({ durationAuto: false, durationSec: length.auto ? length.suggested : length.seconds })
                  }
                >
                  Set by hand
                </button>
              </div>
              {!length.auto && (
                <input
                  type="number"
                  min={6}
                  max={120}
                  value={length.seconds}
                  onChange={(e) => onLength({ durationSec: Number(e.target.value) })}
                />
              )}
            </div>
            <div className="sb-length-group">
              <label>Pace</label>
              <div className="seg">
                {PACES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={Math.abs(length.pace - p) < 0.001 ? 'on' : ''}
                    onClick={() => onLength({ pace: p })}
                  >
                    {p}x
                  </button>
                ))}
              </div>
            </div>
            <div className="sb-length-result">
              <b>
                ≈ {filmSeconds}s video{length.endCard ? ` + ${length.endCard}s end card` : ''}
              </b>
              <span className="hint">
                {length.pace > 1.001
                  ? 'Same script, played faster after generation — a shorter film.'
                  : length.pace < 0.999
                    ? 'Same script, played slower after generation — a longer film.'
                    : length.auto
                      ? 'Sized to the scenes below at a natural read.'
                      : 'Set by hand. Deleting a scene takes its seconds off.'}
              </span>
            </div>
          </div>
        )}

        {generic.length > 0 && (
          <div className="sb-generic-note">
            <b>
              {generic.length} scene{generic.length > 1 ? 's have' : ' has'} no matching photo, so a generic visual
              will be used:
            </b>{' '}
            {generic
              .map((x) => `scene ${x.i + 1} (${x.visual.kind === 'generic' ? x.visual.topic : ''})`)
              .join(', ')}
            . Pick a photo for {generic.length > 1 ? 'those scenes' : 'it'}, change the shot, or delete the scene if a
            generic look won’t do.
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
              <col className="c-shot" />
              <col className="c-vo" />
              <col className="c-card" />
              <col className="c-frame" />
            </colgroup>
            <thead>
              <tr>
                <th>Scene</th>
                <th>Shot direction</th>
                <th>{mode.speaks ? 'Voiceover' : 'Story beat (no speech)'}</th>
                <th>On-screen text</th>
                <th>Scene image</th>
              </tr>
            </thead>
            <tbody>
              {(skippedAfter.get('') ?? []).map(skippedRow)}
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
                const key = sc.beat.key ?? String(gi);
                const ov = sceneEditFor(sceneEdits, scenePlan, sc) ?? {};
                const baseShot = !mode.onCameraPerson && sc.beat.shotAlt ? sc.beat.shotAlt : sc.beat.shot;
                rows.push(
                  <tr key={key}>
                    <td className="sb-scene">
                      <div className="sb-scene-no">{gi + 1}</div>
                      <div className="sb-scene-title">{sc.beat.title}</div>
                      <div className="hint">{sc.beat.cat}</div>
                      <div className="sb-scene-time">
                        {fmtTime(sc.start)}–{fmtTime(sc.end)}
                        <br />
                        {sc.duration}s
                      </div>
                      {/* Where this scene sits in the film. Moving one re-times the
                          scenes and re-packs the parts: a scene that no longer fits
                          in a part pushes the rest into the next one. */}
                      {onMoveScene && (
                        <div className="sb-move">
                          <button
                            type="button"
                            className="btn ghost small"
                            disabled={gi === 0}
                            aria-label={`Move ${sc.beat.title} earlier`}
                            title="Move earlier"
                            onClick={() => onMoveScene(key, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn ghost small"
                            disabled={gi === scenePlan.scenes.filter((x) => !x.beat.isEndCard).length - 1}
                            aria-label={`Move ${sc.beat.title} later`}
                            title="Move later"
                            onClick={() => onMoveScene(key, 1)}
                          >
                            ↓
                          </button>
                        </div>
                      )}
                      {onSkipScene && (
                        <label className="sb-skip" title="Leave this scene out of the film without losing it">
                          <input type="checkbox" checked={false} onChange={() => onSkipScene(key, true)} />
                          Skip
                        </label>
                      )}
                      {onDeleteScene && (
                        <button
                          type="button"
                          className="btn ghost small sb-del"
                          disabled={scenePlan.scenes.length <= 2}
                          title={
                            scenePlan.scenes.length <= 2
                              ? 'A film needs at least two scenes'
                              : 'Take this scene out of the film — it can be restored below'
                          }
                          onClick={() => onDeleteScene(key)}
                        >
                          Delete scene
                        </button>
                      )}
                      {onAddScene && (
                        <button
                          type="button"
                          className="btn ghost small sb-del"
                          title="Write a scene of your own, straight after this one"
                          onClick={() => onAddScene(key)}
                        >
                          + Scene below
                        </button>
                      )}
                    </td>
                    <td>
                      <AutoTextarea
                        value={ov.shot ?? baseShot ?? ''}
                        onChange={(v) => editScene(key, { shot: v })}
                      />
                    </td>
                    <td>
                      {/* One line, and the model says it as written. A project from
                          before that was true carries a respelling; it is shown here
                          because it is what has been performed, and editing replaces it. */}
                      <AutoTextarea
                        value={ov.phonetic ?? ov.dialogue ?? sc.beat.dialogue ?? ''}
                        onChange={(v) => editScene(key, { dialogue: v, phonetic: undefined })}
                      />
                      {mode.speaks && (
                        <div className="hint">~{wordBudget(speakingSeconds(scenePlan, sc))} words max</div>
                      )}
                    </td>
                    <td>
                      <CaptionEditor beat={sc.beat} ov={ov} onChange={(patch) => editScene(key, patch)} />
                    </td>
                    <td>
                      <SceneFrameCell
                        frame={ov.frame}
                        busy={drawing.includes(key)}
                        title={sc.beat.title}
                        onDraw={onDrawScenes ? () => void draw([key]) : undefined}
                        onClear={() => editScene(key, { frame: undefined })}
                      />
                      {/* What the frame is drawn from, and what the shot falls back
                          to when nothing has been drawn. */}
                      <RefPicker
                        chosen={ov.ref}
                        options={refOptions}
                        visual={visuals[gi]!}
                        onPick={(ref) => editScene(key, { ref })}
                      />
                    </td>
                  </tr>,
                );
                for (const sk of skippedAfter.get(key) ?? []) rows.push(skippedRow(sk));
                return rows;
              })}
            </tbody>
          </table>
        </div>
        {onAddScene && (
          <div className="toolbar">
            <button type="button" className="btn small" onClick={() => onAddScene()}>
              + Add a scene at the end
            </button>
            <span className="hint" style={{ marginTop: 0 }}>
              A scene you write is never one of the ones dropped to make the film fit.
            </span>
          </div>
        )}
        {deletedScenes.length > 0 && onRestoreScene && (
          <div className="sb-deleted">
            <span className="hint">Deleted scenes:</span>
            {deletedScenes.map((d) => (
              <span className="sb-deleted-chip" key={d.key}>
                {d.title}
                {d.cat ? <span className="hint"> · {d.cat}</span> : null}
                <button type="button" className="btn ghost small" onClick={() => onRestoreScene(d.key)}>
                  Restore
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
