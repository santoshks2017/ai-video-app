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

export interface EditFilterDef {
  id: string;
  name: string;
  group: 'Daily' | 'Stylize';
  /** The look in the browser, at a strength from 0 to 1. */
  css: (strength: number) => string;
  /** The same look in ffmpeg, at full strength; the server blends it back by the strength. */
  ffmpeg: string;
}

const mix = (s: number, from: number, to: number): string => (from + (to - from) * s).toFixed(3);

export const EDIT_FILTERS: EditFilterDef[] = [
  { id: 'bright', name: 'Bright', group: 'Daily', css: (s) => `brightness(${mix(s, 1, 1.12)}) saturate(${mix(s, 1, 1.05)})`, ffmpeg: 'eq=brightness=0.06:saturation=1.05' },
  { id: 'clear', name: 'Clear', group: 'Daily', css: (s) => `contrast(${mix(s, 1, 1.1)}) saturate(${mix(s, 1, 1.1)})`, ffmpeg: 'eq=contrast=1.1:saturation=1.1' },
  { id: 'warm', name: 'Warm', group: 'Daily', css: (s) => `sepia(${mix(s, 0, 0.18)}) saturate(${mix(s, 1, 1.12)})`, ffmpeg: 'colorbalance=rs=0.07:gs=0.02:bs=-0.07' },
  { id: 'cool', name: 'Cool', group: 'Daily', css: (s) => `hue-rotate(${mix(s, 0, -10)}deg) saturate(${mix(s, 1, 1.05)})`, ffmpeg: 'colorbalance=rs=-0.06:gs=0:bs=0.08' },
  { id: 'vivid', name: 'Vivid', group: 'Daily', css: (s) => `saturate(${mix(s, 1, 1.4)}) contrast(${mix(s, 1, 1.06)})`, ffmpeg: 'eq=saturation=1.4:contrast=1.06' },
  { id: 'soft', name: 'Soft', group: 'Daily', css: (s) => `contrast(${mix(s, 1, 0.9)}) brightness(${mix(s, 1, 1.05)})`, ffmpeg: 'eq=contrast=0.9:brightness=0.03' },
  { id: 'mono', name: 'Mono', group: 'Stylize', css: (s) => `grayscale(${mix(s, 0, 1)})`, ffmpeg: 'hue=s=0' },
  { id: 'vintage', name: 'Vintage', group: 'Stylize', css: (s) => `sepia(${mix(s, 0, 0.5)}) contrast(${mix(s, 1, 0.95)})`, ffmpeg: 'curves=preset=vintage' },
  { id: 'film', name: 'Film', group: 'Stylize', css: (s) => `contrast(${mix(s, 1, 1.15)}) saturate(${mix(s, 1, 0.85)})`, ffmpeg: 'curves=preset=strong_contrast,eq=saturation=0.85' },
  { id: 'faded', name: 'Faded', group: 'Stylize', css: (s) => `contrast(${mix(s, 1, 0.85)}) brightness(${mix(s, 1, 1.08)}) saturate(${mix(s, 1, 0.8)})`, ffmpeg: 'curves=preset=lighter,eq=contrast=0.85:saturation=0.8' },
  { id: 'dramatic', name: 'Dramatic', group: 'Stylize', css: (s) => `contrast(${mix(s, 1, 1.3)}) saturate(${mix(s, 1, 1.1)}) brightness(${mix(s, 1, 0.95)})`, ffmpeg: 'eq=contrast=1.3:saturation=1.1:brightness=-0.03' },
];

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
