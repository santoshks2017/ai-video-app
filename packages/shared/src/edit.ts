/**
 * The video editor's timeline, as data.
 *
 * Everything the editor does — split, trim, move, duplicate, delete, close the
 * gaps — is a pure function from one project to the next. The editor keeps the
 * list of projects as its undo history, the preview reads a project, and the
 * server renders the same project, so what is seen and what is exported are held
 * to one description of the film.
 *
 * Three tracks: text above, the main track of video and stills in the middle,
 * sound below. A clip on the main track may carry a transition, which overlaps it
 * onto the clip before; the exported film is shorter by that overlap, and the
 * timeline already shows it so.
 */

export type EditAspect = '16:9' | '9:16' | '1:1';
export type EditTrackKind = 'video' | 'text' | 'audio';

export interface EditTrack {
  id: string;
  kind: EditTrackKind;
  muted?: boolean;
  hidden?: boolean;
}

export type EditSource =
  | { type: 'video'; label: string; url: string; duration: number; jobId?: string; storagePath?: string; poster?: string }
  | { type: 'image'; label: string; url: string; storagePath?: string }
  | { type: 'audio'; label: string; url: string; duration: number; storagePath?: string };

export interface EditTextStyle {
  font: string;
  /** Fraction of the frame's short side. */
  size: number;
  color: string;
  bold: boolean;
  /** A colour behind the text — hex or rgba() — or none. */
  background: string | null;
  align: 'left' | 'center' | 'right';
  /** Centre of the text, as fractions of the frame. */
  x: number;
  y: number;
}

export interface EditClip {
  id: string;
  trackId: string;
  /** Where it sits on the timeline, in seconds. */
  start: number;
  /** The stretch of the source it plays. Stills and text run from 0 to their length. */
  in: number;
  out: number;
  source?: EditSource;
  text?: string;
  style?: EditTextStyle;
  speed: number;
  /** 0 is silent, 1 as recorded, 2 twice as loud. */
  volume: number;
  fadeIn: number;
  fadeOut: number;
  filter?: { id: string; strength: number };
  /** Into this clip from the one before it on the main track. */
  transition?: { id: string; duration: number };
}

export interface EditProject {
  version: 1;
  aspect: EditAspect;
  tracks: EditTrack[];
  clips: EditClip[];
}

export const EDIT_MAIN_TRACK = 'v1';
export const EDIT_TEXT_TRACK = 't1';
export const EDIT_AUDIO_TRACK = 'a1';
/** Nothing is cut shorter than this — a sliver of a clip is a flash, never an edit. */
export const EDIT_MIN_CLIP = 0.2;
/** How long a still or a line of text lasts when it is first put down. */
export const EDIT_STILL_SECONDS = 3;

export const editUid = (): string => Math.random().toString(36).slice(2, 10);

export const editClipLength = (c: Pick<EditClip, 'in' | 'out' | 'speed'>): number =>
  Math.max(0, (c.out - c.in) / (c.speed || 1));
export const editClipEnd = (c: EditClip): number => c.start + editClipLength(c);

export function newEditProject(aspect: EditAspect = '16:9'): EditProject {
  return {
    version: 1,
    aspect,
    tracks: [
      { id: EDIT_TEXT_TRACK, kind: 'text' },
      { id: EDIT_MAIN_TRACK, kind: 'video' },
      { id: EDIT_AUDIO_TRACK, kind: 'audio' },
    ],
    clips: [],
  };
}

export function editProjectLength(p: EditProject): number {
  return p.clips.reduce((m, c) => Math.max(m, editClipEnd(c)), 0);
}

const onTrack = (p: EditProject, trackId: string): EditClip[] =>
  p.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);

/**
 * Close the gaps on a track, keeping the order the clips are in.
 *
 * This is the main-track magnet: remove a clip and the rest close up behind it,
 * drop one between two and they part to let it in. A clip with a transition
 * overlaps the one before it by the transition's length.
 */
export function packEditTrack(p: EditProject, trackId: string): EditProject {
  const ordered = onTrack(p, trackId);
  const placed = new Map<string, number>();
  let cursor = 0;
  ordered.forEach((c, i) => {
    const prev = ordered[i - 1];
    const overlap =
      i > 0 && c.transition && prev
        ? Math.max(0, Math.min(c.transition.duration, editClipLength(c) - EDIT_MIN_CLIP, editClipLength(prev) - EDIT_MIN_CLIP))
        : 0;
    const start = Math.max(0, cursor - overlap);
    placed.set(c.id, start);
    cursor = start + editClipLength(c);
  });
  return { ...p, clips: p.clips.map((c) => (placed.has(c.id) ? { ...c, start: placed.get(c.id)! } : c)) };
}

const settle = (p: EditProject, trackId: string, magnet: boolean): EditProject =>
  magnet && trackId === EDIT_MAIN_TRACK ? packEditTrack(p, trackId) : p;

export function addEditClip(
  p: EditProject,
  clip: Omit<EditClip, 'id'> & { id?: string },
  opts: { magnet: boolean },
): { project: EditProject; id: string } {
  const id = clip.id ?? editUid();
  const next = { ...p, clips: [...p.clips, { ...clip, id } as EditClip] };
  return { project: settle(next, clip.trackId, opts.magnet), id };
}

/** Cut a clip in two at a moment on the timeline. The second half is returned selected. */
export function splitEditClip(p: EditProject, clipId: string, t: number): { project: EditProject; id?: string } {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return { project: p };
  const local = t - c.start;
  if (local < EDIT_MIN_CLIP || editClipLength(c) - local < EDIT_MIN_CLIP) return { project: p };
  const cut = c.in + local * c.speed;
  const left: EditClip = { ...c, out: cut, fadeOut: 0 };
  const right: EditClip = { ...c, id: editUid(), start: t, in: cut, fadeIn: 0, transition: undefined };
  return { project: { ...p, clips: p.clips.flatMap((x) => (x.id === clipId ? [left, right] : [x])) }, id: right.id };
}

export function removeEditClip(p: EditProject, clipId: string, opts: { magnet: boolean }): EditProject {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return p;
  return settle({ ...p, clips: p.clips.filter((x) => x.id !== clipId) }, c.trackId, opts.magnet);
}

/** A copy straight after the original; what followed on that track moves along to make room. */
export function duplicateEditClip(p: EditProject, clipId: string, opts: { magnet: boolean }): { project: EditProject; id?: string } {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return { project: p };
  const end = editClipEnd(c);
  const len = editClipLength(c);
  const copy: EditClip = { ...c, id: editUid(), start: end, transition: undefined };
  const clips = p.clips.map((x) =>
    x.trackId === c.trackId && x.id !== c.id && x.start >= end - 0.001 ? { ...x, start: x.start + len } : x,
  );
  return { project: settle({ ...p, clips: [...clips, copy] }, c.trackId, opts.magnet), id: copy.id };
}

/** Move a clip along its track. A clip only ever moves to a track of its own kind. */
export function moveEditClip(p: EditProject, clipId: string, start: number, opts: { magnet: boolean; trackId?: string }): EditProject {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return p;
  const kindOf = (id: string) => p.tracks.find((t) => t.id === id)?.kind;
  const target = opts.trackId && kindOf(opts.trackId) === kindOf(c.trackId) ? opts.trackId : c.trackId;
  const next = {
    ...p,
    clips: p.clips.map((x) => (x.id === clipId ? { ...x, start: Math.max(0, start), trackId: target } : x)),
  };
  return settle(next, target, opts.magnet);
}

/**
 * Drag one edge of a clip to a moment on the timeline.
 *
 * A video or a sound can only be trimmed within what was recorded; a still or a
 * line of text has no end to run out of, so its edges simply set how long it lasts.
 */
export function trimEditClip(
  p: EditProject,
  clipId: string,
  edge: 'in' | 'out',
  t: number,
  opts: { magnet: boolean },
): EditProject {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return p;
  const recorded = c.source && c.source.type !== 'image' ? c.source.duration : Infinity;
  let u: EditClip;
  if (edge === 'in') {
    const end = editClipEnd(c);
    const newStart = Math.max(0, Math.min(t, end - EDIT_MIN_CLIP));
    if (c.source && c.source.type !== 'image') {
      const nextIn = Math.max(0, Math.min(c.in + (newStart - c.start) * c.speed, c.out - EDIT_MIN_CLIP * c.speed));
      u = { ...c, in: nextIn, start: end - (c.out - nextIn) / c.speed };
    } else {
      const len = Math.max(EDIT_MIN_CLIP, end - newStart);
      u = { ...c, start: end - len, in: 0, out: len };
    }
  } else {
    const len = Math.max(EDIT_MIN_CLIP, t - c.start);
    u = { ...c, out: Math.min(c.in + len * c.speed, recorded) };
  }
  return settle({ ...p, clips: p.clips.map((x) => (x.id === clipId ? u : x)) }, c.trackId, opts.magnet);
}

export function updateEditClip(p: EditProject, clipId: string, patch: Partial<EditClip>): EditProject {
  return { ...p, clips: p.clips.map((x) => (x.id === clipId ? { ...x, ...patch, id: x.id } : x)) };
}

/** The nearest point within reach, or the time itself. */
export function editSnap(t: number, points: number[], threshold: number): number {
  let best = t;
  let dist = threshold;
  for (const pt of points) {
    const d = Math.abs(pt - t);
    if (d <= dist) {
      dist = d;
      best = pt;
    }
  }
  return best;
}

/** What a dragged edge can catch on: the start, the playhead, and the edges of every other clip. */
export function editSnapPoints(p: EditProject, exceptId: string | null, playhead: number): number[] {
  const pts = [0, playhead];
  for (const c of p.clips) if (c.id !== exceptId) pts.push(c.start, editClipEnd(c));
  return pts;
}

/** The clip playing on a track at a moment — the later-starting one, where two overlap. */
export function editClipAt(p: EditProject, trackId: string, t: number): EditClip | undefined {
  return p.clips
    .filter((c) => c.trackId === trackId && t >= c.start - 1e-6 && t < editClipEnd(c) - 1e-6)
    .sort((a, b) => a.start - b.start)
    .at(-1);
}

/** 29.7 seconds as "00:00:29:70" — hours, minutes, seconds, hundredths. */
export function editTimecode(sec: number): string {
  const cs = Math.round(Math.max(0, sec) * 100);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(Math.floor(cs / 360000))}:${two(Math.floor(cs / 6000) % 60)}:${two(Math.floor(cs / 100) % 60)}:${two(cs % 100)}`;
}

export function editAspectSize(aspect: EditAspect, shortSide = 720): { width: number; height: number } {
  const long = Math.round((shortSide * 16) / 9 / 2) * 2;
  if (aspect === '9:16') return { width: shortSide, height: long };
  if (aspect === '1:1') return { width: shortSide, height: shortSide };
  return { width: long, height: shortSide };
}

/** Why a project cannot be rendered, or null when it can. Checked on the server before any work. */
export function validateEditProject(p: unknown): string | null {
  if (!p || typeof p !== 'object') return 'No edit was sent.';
  const x = p as Partial<EditProject>;
  if (x.version !== 1) return 'This edit was made by a different version of the editor.';
  if (!['16:9', '9:16', '1:1'].includes(String(x.aspect))) return 'Unknown aspect ratio.';
  if (!Array.isArray(x.tracks) || !Array.isArray(x.clips)) return 'The edit has no tracks.';
  if (x.clips.length > 200) return 'Too many clips — 200 is the most one export takes.';
  for (const c of x.clips) {
    if (!c || typeof c !== 'object') return 'A clip is malformed.';
    const nums = [c.start, c.in, c.out, c.speed, c.volume, c.fadeIn, c.fadeOut];
    if (nums.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return 'A clip has a position or length that is not a number.';
    if (c.out - c.in <= 0 || c.speed <= 0) return 'A clip has no length.';
  }
  return null;
}

/* ---- what the panels offer ---- */

/**
 * One colour operation in a filter: five of the browser's CSS filter functions,
 * with the weights the CSS specification gives them, plus a per-channel tint,
 * which CSS has no function for and a warm or cool look cannot do without.
 */
export type EditFilterOp =
  | { kind: 'brightness' | 'contrast' | 'saturate' | 'sepia' | 'grayscale'; amount: number }
  | { kind: 'tint'; r: number; g: number; b: number };

export interface EditFilterDef {
  id: string;
  name: string;
  group: 'Daily' | 'Stylize';
  /**
   * The look at full strength, applied in order. The editor previews it as one
   * colour matrix and the render server applies the same operations in ffmpeg, so
   * the export is graded the way the preview was.
   */
  ops: EditFilterOp[];
}

/*
 * Strong enough to tell apart at a glance. The first set was so gentle — a 12%
 * brightness lift, a 10% contrast bump — that every thumbnail in the panel looked
 * the same and picking one looked like it had done nothing.
 */
export const EDIT_FILTERS: EditFilterDef[] = [
  { id: 'bright', name: 'Bright', group: 'Daily', ops: [{ kind: 'brightness', amount: 1.16 }, { kind: 'contrast', amount: 1.06 }, { kind: 'saturate', amount: 1.12 }] },
  { id: 'clear', name: 'Clear', group: 'Daily', ops: [{ kind: 'contrast', amount: 1.22 }, { kind: 'saturate', amount: 1.15 }] },
  { id: 'warm', name: 'Warm', group: 'Daily', ops: [{ kind: 'tint', r: 1.08, g: 1, b: 0.84 }, { kind: 'saturate', amount: 1.12 }] },
  { id: 'cool', name: 'Cool', group: 'Daily', ops: [{ kind: 'tint', r: 0.88, g: 1, b: 1.12 }, { kind: 'contrast', amount: 1.04 }] },
  { id: 'vivid', name: 'Vivid', group: 'Daily', ops: [{ kind: 'saturate', amount: 1.6 }, { kind: 'contrast', amount: 1.1 }] },
  { id: 'soft', name: 'Soft', group: 'Daily', ops: [{ kind: 'contrast', amount: 0.84 }, { kind: 'brightness', amount: 1.07 }, { kind: 'saturate', amount: 0.9 }] },
  { id: 'mono', name: 'Mono', group: 'Stylize', ops: [{ kind: 'grayscale', amount: 1 }, { kind: 'contrast', amount: 1.12 }] },
  { id: 'vintage', name: 'Vintage', group: 'Stylize', ops: [{ kind: 'sepia', amount: 0.5 }, { kind: 'contrast', amount: 0.88 }, { kind: 'brightness', amount: 1.06 }] },
  { id: 'film', name: 'Film', group: 'Stylize', ops: [{ kind: 'contrast', amount: 1.2 }, { kind: 'saturate', amount: 0.78 }, { kind: 'tint', r: 1.03, g: 1, b: 0.92 }] },
  { id: 'faded', name: 'Faded', group: 'Stylize', ops: [{ kind: 'contrast', amount: 0.76 }, { kind: 'brightness', amount: 1.1 }, { kind: 'saturate', amount: 0.72 }] },
  { id: 'dramatic', name: 'Dramatic', group: 'Stylize', ops: [{ kind: 'contrast', amount: 1.4 }, { kind: 'saturate', amount: 1.15 }, { kind: 'brightness', amount: 0.92 }] },
];

/** A colour transform on 0–1 values: three rows of red, green and blue weights, each followed by an offset. */
type ColourAffine = number[];

const NEUTRAL_AFFINE: ColourAffine = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** An operation dialled back towards doing nothing, by a strength from 0 to 1. */
function opAtStrength(op: EditFilterOp, strength: number): EditFilterOp {
  const k = Math.max(0, Math.min(1, strength));
  const lerp = (from: number, to: number): number => from + (to - from) * k;
  if (op.kind === 'tint') return { kind: 'tint', r: lerp(1, op.r), g: lerp(1, op.g), b: lerp(1, op.b) };
  return { kind: op.kind, amount: lerp(op.kind === 'sepia' || op.kind === 'grayscale' ? 0 : 1, op.amount) };
}

function opAffine(op: EditFilterOp): ColourAffine {
  if (op.kind === 'tint') return [op.r, 0, 0, 0, 0, op.g, 0, 0, 0, 0, op.b, 0];
  const a = op.amount;
  const k = 1 - a;
  switch (op.kind) {
    case 'brightness':
      return [a, 0, 0, 0, 0, a, 0, 0, 0, 0, a, 0];
    case 'contrast': {
      const o = 0.5 - 0.5 * a;
      return [a, 0, 0, o, 0, a, 0, o, 0, 0, a, o];
    }
    case 'saturate':
      return [
        0.213 + 0.787 * a, 0.715 - 0.715 * a, 0.072 - 0.072 * a, 0,
        0.213 - 0.213 * a, 0.715 + 0.285 * a, 0.072 - 0.072 * a, 0,
        0.213 - 0.213 * a, 0.715 - 0.715 * a, 0.072 + 0.928 * a, 0,
      ];
    case 'sepia':
      return [
        0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k, 0,
        0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k, 0,
        0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k, 0,
      ];
    default:
      return [
        0.2126 + 0.7874 * k, 0.7152 - 0.7152 * k, 0.0722 - 0.0722 * k, 0,
        0.2126 - 0.2126 * k, 0.7152 + 0.2848 * k, 0.0722 - 0.0722 * k, 0,
        0.2126 - 0.2126 * k, 0.7152 - 0.7152 * k, 0.0722 + 0.9278 * k, 0,
      ];
  }
}

/**
 * Each operation of the look as the `values` of an SVG feColorMatrix, in order — how
 * the editor previews it. One primitive per operation rather than one merged matrix,
 * so the preview clips a colour between steps exactly where ffmpeg does: merged, a
 * strong contrast followed by a darkening showed a bright yellow 19 levels off the export.
 */
export function editFilterMatrices(def: EditFilterDef, strength: number): string[] {
  return def.ops.map((op) => {
    const m = opAffine(opAtStrength(op, strength));
    const row = (r: number): number[] => [m[r * 4]!, m[r * 4 + 1]!, m[r * 4 + 2]!, 0, m[r * 4 + 3]!];
    return [...row(0), ...row(1), ...row(2), 0, 0, 0, 1, 0].map((v) => +v.toFixed(4)).join(' ');
  });
}

/** One colour, as 0–1 red, green and blue, graded the way the preview and the export both grade it. */
export function editFilterColour(def: EditFilterDef, strength: number, rgb: readonly number[]): number[] {
  return def.ops.reduce<number[]>((c, op) => {
    const m = opAffine(opAtStrength(op, strength));
    return [0, 1, 2].map((r) =>
      Math.max(0, Math.min(1, m[r * 4]! * c[0]! + m[r * 4 + 1]! * c[1]! + m[r * 4 + 2]! * c[2]! + m[r * 4 + 3]!)),
    );
  }, [...rgb]);
}

/**
 * The same look as an ffmpeg filter chain, at a strength from 0 to 1. Each operation
 * is its own step in RGB: colorchannelmixer for the weights, and colorlevels for
 * contrast, whose offset colorchannelmixer has no way to express.
 */
export function editFilterFfmpeg(def: EditFilterDef, strength: number): string {
  const f = (v: number): string => String(+v.toFixed(5));
  const steps: string[] = [];
  for (const raw of def.ops) {
    const op = opAtStrength(raw, strength);
    if (op.kind === 'contrast') {
      const a = op.amount;
      if (Math.abs(a - 1) < 1e-4) continue;
      const lo = f(a > 1 ? 0.5 - 0.5 / a : 0.5 - 0.5 * a);
      const hi = f(a > 1 ? 0.5 + 0.5 / a : 0.5 + 0.5 * a);
      const side = a > 1 ? 'i' : 'o';
      steps.push(`colorlevels=${['r', 'g', 'b'].map((c) => `${c}${side}min=${lo}:${c}${side}max=${hi}`).join(':')}`);
      continue;
    }
    const m = opAffine(op);
    if (m.every((v, i) => Math.abs(v - NEUTRAL_AFFINE[i]!) < 1e-4)) continue;
    const names = ['rr', 'rg', 'rb', '', 'gr', 'gg', 'gb', '', 'br', 'bg', 'bb', ''];
    steps.push(`colorchannelmixer=${names.flatMap((n, i) => (n ? [`${n}=${f(m[i]!)}`] : [])).join(':')}`);
  }
  return steps.length ? ['format=gbrp', ...steps].join(',') : 'null';
}

export interface EditTransitionDef {
  id: string;
  name: string;
  group: 'Foundation' | 'Erase';
  /** ffmpeg's xfade transition name. */
  xfade: string;
}

export const EDIT_TRANSITIONS: EditTransitionDef[] = [
  { id: 'superposition', name: 'Superposition', group: 'Foundation', xfade: 'fade' },
  { id: 'dissolve', name: 'Dissolve', group: 'Foundation', xfade: 'dissolve' },
  { id: 'blurry', name: 'Blurry', group: 'Foundation', xfade: 'hblur' },
  { id: 'dip-black', name: 'Dip to black', group: 'Foundation', xfade: 'fadeblack' },
  { id: 'dip-white', name: 'Dip to white', group: 'Foundation', xfade: 'fadewhite' },
  { id: 'circle-open', name: 'Circle open', group: 'Foundation', xfade: 'circleopen' },
  { id: 'wipe-left', name: 'Wipe left', group: 'Erase', xfade: 'wipeleft' },
  { id: 'wipe-right', name: 'Wipe right', group: 'Erase', xfade: 'wiperight' },
  { id: 'wipe-up', name: 'Wipe up', group: 'Erase', xfade: 'wipeup' },
  { id: 'wipe-down', name: 'Wipe down', group: 'Erase', xfade: 'wipedown' },
  { id: 'slide-left', name: 'Slide left', group: 'Erase', xfade: 'slideleft' },
  { id: 'slide-right', name: 'Slide right', group: 'Erase', xfade: 'slideright' },
];

/**
 * The faces text is set in. Only the fonts the render server has installed, so
 * a title looks in the export the way it looked in the preview.
 */
export const EDIT_FONTS: { id: string; name: string; css: string; server: string }[] = [
  { id: 'sans', name: 'Default', css: "'DejaVu Sans', 'Noto Sans', system-ui, sans-serif", server: 'DejaVu Sans' },
  { id: 'noto-sans', name: 'Noto Sans', css: "'Noto Sans', 'DejaVu Sans', system-ui, sans-serif", server: 'Noto Sans' },
  { id: 'serif', name: 'Noto Serif', css: "'Noto Serif', Georgia, serif", server: 'Noto Serif' },
  { id: 'mono', name: 'Mono', css: "'DejaVu Sans Mono', ui-monospace, monospace", server: 'DejaVu Sans Mono' },
];

export const EDIT_TEXT_PRESETS: { id: string; name: string; text: string; style: EditTextStyle }[] = [
  { id: 'title', name: 'Title', text: 'Your title', style: { font: 'sans', size: 0.09, color: '#ffffff', bold: true, background: null, align: 'center', x: 0.5, y: 0.45 } },
  { id: 'subtitle', name: 'Subtitle', text: 'A line under it', style: { font: 'noto-sans', size: 0.05, color: '#ffffff', bold: false, background: null, align: 'center', x: 0.5, y: 0.58 } },
  { id: 'caption', name: 'Caption', text: 'Caption text', style: { font: 'sans', size: 0.045, color: '#ffffff', bold: true, background: 'rgba(0,0,0,0.6)', align: 'center', x: 0.5, y: 0.85 } },
  { id: 'lower-third', name: 'Lower third', text: 'Name · Dealership', style: { font: 'sans', size: 0.045, color: '#ffffff', bold: true, background: '#c2564f', align: 'left', x: 0.32, y: 0.8 } },
  { id: 'elegant', name: 'Default Text', text: 'Default Text', style: { font: 'serif', size: 0.07, color: '#ffffff', bold: false, background: null, align: 'center', x: 0.5, y: 0.5 } },
  { id: 'mono', name: 'Default Text', text: 'Default Text', style: { font: 'mono', size: 0.05, color: '#ffffff', bold: false, background: null, align: 'center', x: 0.5, y: 0.5 } },
];
