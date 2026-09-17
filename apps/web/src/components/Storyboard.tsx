import { useEffect, useRef, useState, type ReactElement } from 'react';
import type React from 'react';
import { CARD_POSITIONS, type CardPosition,
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
import { Section, Info } from './ui.js';

/** A field a rewrite must leave alone. */
export type LockField = 'dialogue' | 'shot' | 'card';

/**
 * The padlock beside a field.
 *
 * Locked means a rewrite leaves it exactly as it is. Typing in a field locks it
 * on its own — a line you wrote yourself is by definition one you meant — and
 * this is how you take the lock off again when you do want it rewritten.
 */
function Lock({ on, what, onToggle }: { on: boolean; what: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`sb-lock${on ? ' on' : ''}`}
      aria-pressed={on}
      title={
        on
          ? `Locked — this ${what} cannot be typed in, and a rewrite leaves it alone. Click to unlock and edit it.`
          : `Open — this ${what} can be edited, and a rewrite may replace it. Click to lock it shut.`
      }
      aria-label={on ? `Unlock this ${what}` : `Lock this ${what}`}
      onClick={onToggle}
    >
      {/*
       * A shut padlock, and an open one — drawn far enough apart to tell at 13px.
       *
       * Shut: the shackle sits squarely over a filled body, in the accent. Open: the
       * body is a grey outline and the shackle is lifted clear of it and swung to
       * the side, so the silhouette differs as well as the colour. The state is also
       * on the field itself, which is tinted when it is locked.
       */}
      <svg viewBox="0 0 18 16" width="14" height="13" aria-hidden focusable="false">
        <rect x="3" y="7" width="10" height="7" rx="1.6" />
        {on ? (
          <path d="M5.4 7V4.9a2.6 2.6 0 0 1 5.2 0V7" />
        ) : (
          <path d="M10.6 7V4.2a2.6 2.6 0 0 1 5.2 0v1" />
        )}
      </svg>
    </button>
  );
}

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
  locked?: LockField[];
  shot?: string;
  ref?: string;
  card?: string;
  cardSub?: string;
  cardPos?: CardPosition | 'auto';
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
  locked = false,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  minRows?: number;
  /** Shut: no caret, no typing, until the padlock beside it is opened. */
  locked?: boolean;
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
      className={`${className ?? ''}${locked ? ' locked' : ''}`.trim() || undefined}
      rows={minRows}
      value={value}
      placeholder={placeholder}
      readOnly={locked}
      tabIndex={locked ? -1 : undefined}
      aria-readonly={locked || undefined}
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
  locked = false,
  onChange,
}: {
  beat: Beat;
  ov: SceneEdit;
  locked?: boolean;
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
        locked={locked}
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
          locked={locked}
          className="sb-caption-sub"
          value={subline}
          placeholder="Small line under it (optional)"
          onChange={(v) => onChange({ cardSub: v })}
        />
      )}
      {!locked && (card || edited) && (
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
      {card && (
        <label className="sb-caption-pos" title="Where this caption sits on the film">
          <span>Placement</span>
          <select
            value={ov.cardPos ?? 'auto'}
            onChange={(e) => onChange({ cardPos: e.target.value === 'auto' ? undefined : (e.target.value as CardPosition) })}
          >
            <option value="auto">Auto — clear of people and the action</option>
            {CARD_POSITIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
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

/** The columns, and the share of the table each takes by default. */
const COLUMNS = ['shot', 'vo', 'card', 'frame'] as const;
const DEFAULT_WIDTHS = [30, 24, 17, 29];
const MIN_WIDTH = 10;

/**
 * Column widths a designer can drag, that always add up to the same table.
 *
 * A storyboard is read across, so the table has to fit the screen — but which
 * column needs the room changes by the hour: the shot direction while blocking it,
 * the line while writing it. So a drag moves width from one column to the one
 * beside it and the total never changes, which means it never starts scrolling
 * sideways. Remembered on this device.
 */
function useColumnWidths(): [number[], (i: number, e: React.PointerEvent) => void, () => void] {
  const [widths, setWidths] = useState<number[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ava.sbcols') ?? 'null') as number[] | null;
      return saved?.length === COLUMNS.length ? saved : DEFAULT_WIDTHS;
    } catch {
      return DEFAULT_WIDTHS;
    }
  });
  const live = useRef(widths);
  live.current = widths;

  const save = (next: number[]): void => {
    setWidths(next);
    try {
      localStorage.setItem('ava.sbcols', JSON.stringify(next));
    } catch {
      /* storage unavailable — the choice lasts this session */
    }
  };

  const startDrag = (i: number, e: React.PointerEvent): void => {
    e.preventDefault();
    const table = (e.currentTarget as HTMLElement).closest('table');
    const total = table?.clientWidth ?? 1000;
    const from = [...live.current];
    const startX = e.clientX;

    const move = (ev: PointerEvent): void => {
      // Whatever one column gains, the one beside it gives up.
      const delta = ((ev.clientX - startX) / total) * 100;
      const room = from[i]! + from[i + 1]!;
      const left = Math.min(room - MIN_WIDTH, Math.max(MIN_WIDTH, from[i]! + delta));
      const next = [...from];
      next[i] = Math.round(left * 10) / 10;
      next[i + 1] = Math.round((room - left) * 10) / 10;
      setWidths(next);
      live.current = next;
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      save(live.current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return [widths, startDrag, () => save(DEFAULT_WIDTHS)];
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
  onLockScene,
  onLockAll,
  onUndo,
  undoLabel,
  vehicle = 'car',
  speechWpm,
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
  /** Lock or unlock one field on one scene, so a rewrite leaves it alone. */
  onLockScene?: (key: string, field: LockField, lock: boolean) => void;
  /** Take every lock off, or put one on every written field. */
  onLockAll?: (lock: boolean) => void;
  /**
   * Put the storyboard back as it was before the last rewrite or redraw.
   *
   * Both buttons replace work that took thought, and the second one costs money.
   * A misclick should be one click to undo, not a rewrite to get back to.
   */
  onUndo?: () => void;
  /** What the undo would put back — "the script", "6 scene images". */
  undoLabel?: string;
  /** Cars and bikes name their parts differently. */
  vehicle?: 'car' | 'bike';
  /** How fast this film speaks — the rate every scene's word budget is worked out at. */
  speechWpm?: number;
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
  const [widths, startDrag, resetWidths] = useColumnWidths();
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
  const allKeys = scenePlan.scenes.map((sc, i) => sc.beat.key ?? String(i));

  const draw = async (keys: string[]): Promise<void> => {
    if (!onDrawScenes || !keys.length) return;
    setDrawing((d) => [...new Set([...d, ...keys])]);
    setDrawNote('');
    const note = await onDrawScenes(keys);
    setDrawing((d) => d.filter((k) => !keys.includes(k)));
    setDrawNote(note);
  };

  /** Lines a rewrite would leave alone, and the ones it would actually write. */
  const lockedLines = scenePlan.scenes.filter((sc) =>
    sceneEditFor(sceneEdits, scenePlan, sc)?.locked?.includes('dialogue'),
  ).length;
  const anyLock = scenePlan.scenes.some((sc) => (sceneEditFor(sceneEdits, scenePlan, sc)?.locked ?? []).length);
  const toRewrite = Math.max(0, spokenScenes - lockedLines);

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
      <td colSpan={4}>
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
        {/*
          * One bar, not three.
          *
          * Writing the script, drawing the scenes, and how long the film runs were
          * three stacked panels of prose, and between them they pushed the actual
          * storyboard off the screen. They are four controls; they fit on a line.
          * What each one does is behind its mark, a hover away.
          */}
        <div className="sb-bar">
          {mode.speaks && onWriteScript && (
            <div className="sb-bar-group script">
              <label>
                Script
                <Info>
                  {scripted}/{spokenScenes} scenes have a line. Written in three passes — the angle, the draft,
                  then an edit that cuts anything generic. The model says each line exactly as written, in{' '}
                  {languageName ?? 'the chosen language'}. Close the padlock on anything you want kept: a shut
                  field cannot be typed in and a rewrite leaves it alone. Open it again to edit it, or to let a
                  rewrite have it.
                </Info>
              </label>
              <div className="sb-bar-row">
                <span className={`sb-tally${scripted >= spokenScenes && spokenScenes > 0 ? ' done' : ''}`}>
                  {scripted}/{spokenScenes}
                </span>
                <button
                  className="btn primary small"
                  type="button"
                  disabled={writing || (scripted > 0 && toRewrite === 0)}
                  title={
                    scripted > 0 && toRewrite === 0
                      ? 'Every line is locked — unlock the ones you want rewritten'
                      : 'Write every unlocked line'
                  }
                  onClick={() => runScriptAction(onWriteScript)}
                >
                  {writing
                    ? 'Working…'
                    : !scripted
                      ? 'Write script'
                      : toRewrite === 0
                        ? 'All locked'
                        : lockedLines
                          ? `Rewrite ${toRewrite}`
                          : 'Rewrite script'}
                </button>
                {onLockAll && scripted > 0 && (
                  <button
                    className="btn ghost small"
                    type="button"
                    disabled={writing}
                    onClick={() => onLockAll(!anyLock)}
                    title={
                      anyLock
                        ? 'Open every field, so they can be edited and a rewrite may replace them'
                        : 'Lock every written field shut — nothing can be typed in, and a rewrite changes nothing'
                    }
                  >
                    {anyLock ? 'Unlock all' : 'Lock all'}
                  </button>
                )}
              </div>
            </div>
          )}

          {onDrawScenes && (
            <div className="sb-bar-group drawn">
              <label>
                Scenes drawn
                <Info>
                  A still of each scene, drawn from the same photographs the film is built on. It settles the
                  camera, the framing and where everyone stands before any video is paid for — and it is sent as
                  the first reference for the part its scene falls in.
                </Info>
              </label>
              <div className="sb-bar-row">
                <span className={`sb-tally${!unframed.length ? ' done' : ''}`}>
                  {framed.length}/{scenePlan.scenes.length}
                </span>
                {unframed.length > 0 && (
                  <button
                    className="btn small"
                    type="button"
                    disabled={drawing.length > 0}
                    onClick={() => void draw(unframed)}
                    title="Draw only the scenes that have no frame yet"
                  >
                    {drawing.length ? `Drawing ${drawing.length}…` : `Draw ${unframed.length} pending`}
                  </button>
                )}
                {framed.length > 0 && (
                  <button
                    className="btn ghost small"
                    type="button"
                    disabled={drawing.length > 0}
                    onClick={() => void draw(allKeys)}
                    title="Draw every scene again, including the ones that already have a frame"
                  >
                    {drawing.length && !unframed.length ? `Drawing ${drawing.length}…` : `Redraw all ${allKeys.length}`}
                  </button>
                )}
              </div>
            </div>
          )}

          {length && onLength && (
            <>
              <div className="sb-bar-group length">
                <label>
                  Length at 1x
                  <Info>
                    Auto sizes the film to the scenes at a natural read. Set by hand and deleting a scene takes
                    its seconds off instead.
                  </Info>
                </label>
                <div className="sb-bar-row">
                  <div className="seg">
                    <button
                      type="button"
                      className={length.auto ? 'on' : ''}
                      onClick={() => onLength({ durationAuto: true })}
                    >
                      Auto · {length.suggested}s
                    </button>
                    <button
                      type="button"
                      className={length.auto ? '' : 'on'}
                      onClick={() =>
                        onLength({ durationAuto: false, durationSec: length.auto ? length.suggested : length.seconds })
                      }
                    >
                      By hand
                    </button>
                  </div>
                  {!length.auto && (
                    <input
                      className="sb-bar-num"
                      type="number"
                      min={6}
                      max={120}
                      value={length.seconds}
                      onChange={(e) => onLength({ durationSec: Number(e.target.value) })}
                    />
                  )}
                </div>
              </div>

              <div className="sb-bar-group pace">
                <label>
                  Pace
                  <Info>
                    The finished film is played at this speed after generation — the same script in a shorter or
                    longer film. It is not how fast the voice speaks; that is Speaking pace, in Video.
                  </Info>
                </label>
                <div className="sb-bar-row">
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
              </div>

              <div className="sb-bar-result">
                ≈ {filmSeconds}s{length.endCard ? ` + ${length.endCard}s card` : ''}
              </div>
            </>
          )}
        </div>

        {(scriptNote || drawNote || onUndo) && (
          <div className="sb-bar-note">
            {[scriptNote, drawNote].filter(Boolean).join(' · ')}
            {onUndo && undoLabel && (
              <button
                type="button"
                className="btn ghost small"
                style={{ marginLeft: 8 }}
                onClick={onUndo}
                title={`Put ${undoLabel} back as it was before`}
              >
                Undo — restore {undoLabel}
              </button>
            )}
          </div>
        )}

        {/* The idea the copy is arguing. Judge this before judging the lines — a
            good line serving a weak idea is still a weak film — but it is read
            once and then in the way, so it folds. */}
        {angle?.idea && (
          <Section sub title="The angle this script is written to" step={angle.idea.slice(0, 72)}>
            <dl className="sb-angle-dl">
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
          </Section>
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

        {editCount > 0 && (
          <div className="sb-bar-note">
            <button className="btn ghost small" onClick={clearSceneEdits}>
              Reset {editCount} edit{editCount > 1 ? 's' : ''}
            </button>
          </div>
        )}
        <div className="sb-scroll">
          <table className="sb-table">
            <colgroup>
              {COLUMNS.map((c, i) => (
                <col key={c} style={{ width: `${widths[i]}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {[
                  'Shot direction',
                  mode.speaks ? 'Voiceover' : 'Story beat (no speech)',
                  'On-screen text',
                  'Scene image',
                ].map((label, i) => (
                  <th key={label}>
                    {label}
                    {/* Drag to give this column room; the one beside it gives it up,
                        so the table never grows past the screen. */}
                    {i < COLUMNS.length - 1 && (
                      <span
                        className="sb-grip"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${label}`}
                        onPointerDown={(e) => startDrag(i, e)}
                        onDoubleClick={resetWidths}
                        title="Drag to resize · double-click to reset"
                      />
                    )}
                  </th>
                ))}
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
                      <td colSpan={4}>
                        Part {sc.part + 1} of {scenePlan.parts}
                        {sc.part === 0 ? ' — create' : ' — extend'}
                      </td>
                    </tr>,
                  );
                }
                const key = sc.beat.key ?? String(gi);
                const ov = sceneEditFor(sceneEdits, scenePlan, sc) ?? {};
                const locked = ov.locked ?? [];
                const baseShot = !mode.onCameraPerson && sc.beat.shotAlt ? sc.beat.shotAlt : sc.beat.shot;
                /*
                 * The scene's own header strip, across the whole table.
                 *
                 * All of this used to be stacked down a narrow first column, where
                 * "Skip" wrapped to three letters on three lines and the buttons ate
                 * more height than the writing beside them. It is one line now — who
                 * the scene is on the left, when it runs and what you can do to it on
                 * the right — and the column it used to occupy went to the writing.
                 */
                const lastMovable = scenePlan.scenes.filter((x) => !x.beat.isEndCard).length - 1;
                rows.push(
                  <tr className="sb-scene-row" key={`h-${key}`}>
                    <td colSpan={4}>
                      <div className="sb-scene-head">
                        <span className="sb-scene-no">{gi + 1}</span>
                        <b className="sb-scene-title" title={sc.beat.title}>
                          {sc.beat.title}
                        </b>
                        {sc.beat.cat && (
                          <span className="sb-scene-cat" title={sc.beat.cat}>
                            {sc.beat.cat}
                          </span>
                        )}
                        <span className="sb-scene-time">
                          {fmtTime(sc.start)}–{fmtTime(sc.end)} · {sc.duration}s
                        </span>
                        <span className="sb-scene-acts">
                          {/* Moving a scene re-times the film and re-packs the parts:
                              one that no longer fits pushes the rest along. */}
                          {onMoveScene && (
                            <>
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
                                disabled={gi === lastMovable}
                                aria-label={`Move ${sc.beat.title} later`}
                                title="Move later"
                                onClick={() => onMoveScene(key, 1)}
                              >
                                ↓
                              </button>
                            </>
                          )}
                          {onSkipScene && (
                            <label className="sb-skip" title="Leave this scene out of the film without losing it">
                              <input type="checkbox" checked={false} onChange={() => onSkipScene(key, true)} />
                              Skip
                            </label>
                          )}
                          {onAddScene && (
                            <button
                              type="button"
                              className="btn ghost small"
                              title="Write a scene of your own, straight after this one"
                              onClick={() => onAddScene(key)}
                            >
                              + Scene below
                            </button>
                          )}
                          {onDeleteScene && (
                            <button
                              type="button"
                              className="btn ghost small"
                              disabled={scenePlan.scenes.length <= 2}
                              title={
                                scenePlan.scenes.length <= 2
                                  ? 'A film needs at least two scenes'
                                  : 'Take this scene out of the film — it can be restored below'
                              }
                              onClick={() => onDeleteScene(key)}
                            >
                              Delete
                            </button>
                          )}
                        </span>
                      </div>
                    </td>
                  </tr>,
                );
                rows.push(
                  <tr key={key}>
                    <td>
                      <div className="sb-field">
                        <AutoTextarea
                          locked={locked.includes('shot')}
                          value={ov.shot ?? baseShot ?? ''}
                          onChange={(v) => editScene(key, { shot: v })}
                        />
                        {onLockScene && (
                          <Lock
                            on={locked.includes('shot')}
                            what="shot direction"
                            onToggle={() => onLockScene(key, 'shot', !locked.includes('shot'))}
                          />
                        )}
                      </div>
                    </td>
                    <td>
                      {/* One line, and the model says it as written. A project from
                          before that was true carries a respelling; it is shown here
                          because it is what has been performed, and editing replaces it. */}
                      <div className="sb-field">
                        <AutoTextarea
                          locked={locked.includes('dialogue')}
                          value={ov.phonetic ?? ov.dialogue ?? sc.beat.dialogue ?? ''}
                          onChange={(v) => editScene(key, { dialogue: v, phonetic: undefined })}
                        />
                        {onLockScene && (
                          <Lock
                            on={locked.includes('dialogue')}
                            what="line"
                            onToggle={() => onLockScene(key, 'dialogue', !locked.includes('dialogue'))}
                          />
                        )}
                      </div>
                      {mode.speaks && (
                        <div className="hint">
                          ~{wordBudget(speakingSeconds(scenePlan, sc), 1, speechWpm)} words max
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="sb-field">
                        <CaptionEditor
                          beat={sc.beat}
                          ov={ov}
                          locked={locked.includes('card')}
                          onChange={(patch) => editScene(key, patch)}
                        />
                        {onLockScene && (
                          <Lock
                            on={locked.includes('card')}
                            what="on-screen text"
                            onToggle={() => onLockScene(key, 'card', !locked.includes('card'))}
                          />
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="sb-visual">
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
                      </div>
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
