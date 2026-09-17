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

import { LAYER_COLOUR_KEYS, type FilmLayers, type FilmMusicLayer, type LayerBox, type LayerColours } from './filmLayers.js';
import { autoMusicGain, gainAt, musicFadeAt, musicPreviewLevel, validateGainPoints, type GainPoint } from './musicGain.js';
import { CAPTION_SPOTS, captionSpotXY, overlayMargins, type CaptionSpot } from './captionSpot.js';

export type EditAspect = '16:9' | '9:16' | '1:1';
export type EditTrackKind = 'video' | 'text' | 'audio' | 'layer';

export interface EditTrack {
  id: string;
  kind: EditTrackKind;
  muted?: boolean;
  hidden?: boolean;
}

export type EditSource =
  | { type: 'video'; label: string; url: string; duration: number; jobId?: string; storagePath?: string; poster?: string; variant?: 'clean' }
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

/** Something drawn over the film after it was made: a caption, the footer, a logo, or the end card. */
export type EditLayer =
  | { kind: 'caption'; text: string; sub?: string }
  | { kind: 'footer'; text: string }
  | { kind: 'logo'; which: 'dealer' | 'brand'; colourPath: string; whitePath?: string; whiteOnEndCard: boolean; w: number; h: number }
  | { kind: 'endcard'; lines: string[] };
/** A layer's top-left corner as fractions of the frame, and its size where 1 is as designed. */
export interface EditPlacement {
  x: number;
  y: number;
  scale: number;
}
/** The film's frame and the colours its layers are drawn in. */
export interface EditLook {
  colours: LayerColours;
  width: number;
  height: number;
  captionHeadSize?: number;
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
  layer?: EditLayer;
  place?: EditPlacement;
  /**
   * A sound clip that is the film's music: levelled to `loudness` at export, faded in and out.
   * `measured` is the track's own loudness, so the preview plays it at that level too.
   */
  bed?: { loudness: number; duckDb: number; measured?: number | null };
  /**
   * A sound clip's volume line: key points on its source's timeline, in dB against `volume`.
   * The film's music gets the film's dips as its first points. Unset on the music of an
   * edit made before lines existed, which export still dips under the voice by ear.
   */
  gain?: GainPoint[];
  /** The layer, or the music's line, as the film first had it, for Reset. */
  original?: { start: number; in: number; out: number; layer?: EditLayer; place?: EditPlacement; gain?: GainPoint[] };
}

export interface EditProject {
  version: 1 | 2;
  aspect: EditAspect;
  tracks: EditTrack[];
  clips: EditClip[];
  /** Set when the edit holds a film's layers. */
  look?: EditLook;
}

export const EDIT_MAIN_TRACK = 'v1';
export const EDIT_TEXT_TRACK = 't1';
export const EDIT_AUDIO_TRACK = 'a1';
export const EDIT_CAPTION_TRACK = 'c1';
export const EDIT_DEALER_LOGO_TRACK = 'l1';
export const EDIT_BRAND_LOGO_TRACK = 'l2';
export const EDIT_FOOTER_TRACK = 'f1';
/** How a caption fades in and out, and how the end card eases in — as the film draws them. */
export const EDIT_LAYER_FADE = 0.28;
export const EDIT_END_CARD_FADE = 0.35;
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
    version: 2,
    aspect,
    tracks: [
      { id: EDIT_TEXT_TRACK, kind: 'text' },
      { id: EDIT_MAIN_TRACK, kind: 'video' },
      { id: EDIT_AUDIO_TRACK, kind: 'audio' },
    ],
    clips: [],
  };
}

export const editClipKind = (c: EditClip): 'layer' | 'text' | 'image' | 'audio' | 'video' =>
  c.layer ? 'layer' : c.text !== undefined ? 'text' : (c.source?.type ?? 'video');

/**
 * A composed film as an edit: its clean footage on the main track, the end card after it,
 * and every caption, logo and the footer as a layer where the film drew it.
 */
export function editProjectFromLayers(input: {
  aspect: EditAspect;
  layers: FilmLayers;
  clean: Extract<EditSource, { type: 'video' }>;
  music?: Extract<EditSource, { type: 'audio' }>;
}): EditProject {
  const L = input.layers;
  const total = L.bodySeconds + (L.endCard?.seconds ?? 0);
  const base = { speed: 1, volume: 1, fadeIn: 0, fadeOut: 0 };
  const at = (b: LayerBox): EditPlacement => ({ x: b.x / L.width, y: b.y / L.height, scale: 1 });
  const kept = (c: EditClip): EditClip => ({ ...c, original: { start: c.start, in: c.in, out: c.out, layer: c.layer, place: c.place } });
  const clips: EditClip[] = [kept({ id: 'clean', trackId: EDIT_MAIN_TRACK, start: 0, in: 0, out: L.bodySeconds, source: input.clean, ...base })];
  if (L.endCard) {
    clips.push(
      kept({ id: 'endcard', trackId: EDIT_MAIN_TRACK, start: L.bodySeconds, in: 0, out: L.endCard.seconds, layer: { kind: 'endcard', lines: [...L.endCard.lines] }, ...base, fadeIn: EDIT_END_CARD_FADE }),
    );
  }
  for (const c of L.captions) {
    clips.push(
      kept({
        id: c.id,
        trackId: EDIT_CAPTION_TRACK,
        start: c.from,
        in: 0,
        out: c.to - c.from,
        layer: { kind: 'caption', text: c.text, ...(c.sub ? { sub: c.sub } : {}) },
        place: at(c),
        ...base,
        fadeIn: EDIT_LAYER_FADE,
        fadeOut: EDIT_LAYER_FADE,
      }),
    );
  }
  for (const g of L.logos) {
    clips.push(
      kept({
        id: `logo-${g.which}`,
        trackId: g.which === 'dealer' ? EDIT_DEALER_LOGO_TRACK : EDIT_BRAND_LOGO_TRACK,
        start: 0,
        in: 0,
        out: total,
        layer: { kind: 'logo', which: g.which, colourPath: g.colourPath, ...(g.whitePath ? { whitePath: g.whitePath } : {}), whiteOnEndCard: g.whiteOnEndCard, w: g.w, h: g.h },
        place: at(g),
        ...base,
      }),
    );
  }
  if (L.footer) {
    clips.push(
      kept({ id: 'footer', trackId: EDIT_FOOTER_TRACK, start: 0, in: 0, out: total, layer: { kind: 'footer', text: L.footer.text }, place: { x: 0, y: L.footer.y / L.height, scale: 1 }, ...base }),
    );
  }
  if (input.music && L.music) {
    const out = Math.min(total, input.music.duration);
    clips.push({ id: 'music', trackId: EDIT_AUDIO_TRACK, start: 0, in: 0, out, source: input.music, ...filmMusicLine(L.music, L, out), ...base });
  }
  const tracks: EditTrack[] = [
    { id: EDIT_CAPTION_TRACK, kind: 'layer' },
    { id: EDIT_DEALER_LOGO_TRACK, kind: 'layer' },
    { id: EDIT_BRAND_LOGO_TRACK, kind: 'layer' },
    { id: EDIT_FOOTER_TRACK, kind: 'layer' },
    { id: EDIT_TEXT_TRACK, kind: 'text' },
    { id: EDIT_MAIN_TRACK, kind: 'video' },
    { id: EDIT_AUDIO_TRACK, kind: 'audio' },
  ];
  return {
    version: 2,
    aspect: input.aspect,
    tracks: tracks.filter((t) => t.kind !== 'layer' || clips.some((c) => c.trackId === t.id)),
    clips,
    look: { colours: { ...L.colours }, width: L.width, height: L.height, ...(L.captionHeadSize ? { captionHeadSize: L.captionHeadSize } : {}) },
  };
}

/** Whether the film's dips can be laid out: it knows where its voice is, or its music never dipped. */
const musicLineKnown = (music: FilmMusicLayer): boolean => Boolean(music.speech) || !(music.duckDb < 0);

/**
 * The film's music as a clip's settings: its level, and its dips as the first points on its
 * volume line — a level line, ready for points, when the music never dipped. No line when
 * the film dipped its music but never kept where its voice is.
 */
function filmMusicLine(
  music: FilmMusicLayer,
  film: Pick<FilmLayers, 'bodySeconds' | 'endCard'>,
  out: number,
): Pick<EditClip, 'bed' | 'gain' | 'original'> {
  const bed = { loudness: music.loudness, duckDb: music.duckDb, ...(music.measured !== undefined ? { measured: music.measured } : {}) };
  if (!musicLineKnown(music)) return { bed };
  const gain = autoMusicGain(music.speech ?? [], music.duckDb, film.bodySeconds, Boolean(film.endCard));
  return { bed, gain, original: { start: 0, in: 0, out, gain } };
}

/**
 * An edit whose music has no volume line yet — saved before lines existed — given the
 * film's dips as its line, and the preview level. Anything with a line is left as it is.
 */
export function editWithFilmMusicLine(p: EditProject, film: Pick<FilmLayers, 'bodySeconds' | 'endCard' | 'music'>): EditProject {
  const music = film.music;
  if (!music || !musicLineKnown(music) || !p.clips.some((c) => c.bed && !c.gain)) return p;
  return {
    ...p,
    clips: p.clips.map((c) => {
      if (!c.bed || c.gain) return c;
      const line = filmMusicLine(music, film, c.out);
      // The film's dips are on the film's timeline; the line is on the music's own.
      const onSource = (points: GainPoint[] | undefined) =>
        points?.map((pt) => ({ t: Math.max(0, Math.round((c.in + (pt.t - c.start) * (c.speed || 1)) * 1000) / 1000), db: pt.db }));
      const gain = onSource(line.gain);
      return {
        ...c,
        bed: { ...c.bed, ...(line.bed?.measured !== undefined ? { measured: line.bed.measured } : {}) },
        ...(gain ? { gain, original: { start: c.start, in: c.in, out: c.out, gain } } : {}),
      };
    }),
  };
}

/**
 * How loud a sound clip plays at `t` on the timeline, as the multiplier export applies:
 * its volume, its line, and the film music's level and fades (or the clip's own fades).
 */
export function editSoundLevel(c: EditClip, t: number): number {
  const local = t - c.start;
  const len = editClipLength(c);
  let level = c.volume * gainAt(c.gain ?? [], c.in + local * (c.speed || 1));
  if (c.bed) {
    level *= musicPreviewLevel(c.bed.loudness, c.bed.measured) * musicFadeAt(local, len);
  } else {
    if (c.fadeIn > 0) level *= Math.max(0, Math.min(1, local / c.fadeIn));
    if (c.fadeOut > 0) level *= Math.max(0, Math.min(1, (len - local) / c.fadeOut));
  }
  return Math.max(0, level);
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

/** A longer or shorter end card, with every layer and the music that ran to the end of the film still running to its end. */
export function editSetEndCardSeconds(p: EditProject, clipId: string, seconds: number): EditProject {
  const card = p.clips.find((c) => c.id === clipId && c.layer?.kind === 'endcard');
  if (!card) return p;
  const oldEnd = editProjectLength(p);
  const len = Math.max(1, Math.min(8, seconds));
  const next = packEditTrack(updateEditClip(p, clipId, { out: card.in + len * card.speed }), EDIT_MAIN_TRACK);
  const newEnd = next.clips.filter((c) => c.trackId === EDIT_MAIN_TRACK).reduce((m, c) => Math.max(m, editClipEnd(c)), 0);
  return {
    ...next,
    clips: next.clips.map((c) => {
      if (c.trackId === EDIT_MAIN_TRACK || !(c.layer || c.bed) || Math.abs(editClipEnd(c) - oldEnd) > 0.05) return c;
      const recorded = c.source && c.source.type !== 'image' ? c.source.duration : Infinity;
      return { ...c, out: Math.min(c.in + (newEnd - c.start) * c.speed, recorded) };
    }),
  };
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

const REF_PATH = /^refs\/[\w-]+\/[^/]+$/;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isText = (v: unknown, max: number, min = 0): v is string => typeof v === 'string' && v.length >= min && v.length <= max;

export function validateEditLook(look: unknown): string | null {
  const l = look as Partial<EditLook> | undefined;
  if (!l || typeof l !== 'object') return 'The edit has no frame or look for its layers.';
  const size = (n: unknown): boolean => Number.isInteger(n) && (n as number) >= 16 && (n as number) <= 4096;
  if (!size(l.width) || !size(l.height)) return 'The edit has an impossible frame size.';
  const colours = l.colours as unknown as Record<string, unknown> | undefined;
  if (!colours || LAYER_COLOUR_KEYS.some((k) => !/^#[0-9a-f]{3,8}$/i.test(String(colours[k])))) return 'The edit has a look that cannot be read.';
  if (l.captionHeadSize !== undefined && (!isNum(l.captionHeadSize) || l.captionHeadSize <= 0 || l.captionHeadSize > 400)) {
    return 'The edit has a caption size that cannot be read.';
  }
  return null;
}

export function validateEditLayer(layer: unknown): string | null {
  const x = layer as Record<string, unknown> | undefined;
  if (!x || typeof x !== 'object') return 'A layer is malformed.';
  if (x.kind === 'caption') {
    if (!isText(x.text, 200, 1) || !x.text.trim()) return 'A caption needs words, up to 200 characters.';
    return x.sub === undefined || isText(x.sub, 200) ? null : 'A caption’s second line is too long.';
  }
  if (x.kind === 'footer') return isText(x.text, 300) ? null : 'The footer text is too long.';
  if (x.kind === 'logo') {
    if (x.which !== 'dealer' && x.which !== 'brand') return 'A logo layer must be the dealer or the brand logo.';
    if (!isText(x.colourPath, 300) || !REF_PATH.test(x.colourPath)) return 'A logo layer has no image.';
    if (x.whitePath !== undefined && (!isText(x.whitePath, 300) || !REF_PATH.test(x.whitePath))) return 'A logo layer has a white version that cannot be read.';
    if (!isNum(x.w) || !isNum(x.h) || x.w <= 0 || x.h <= 0 || x.w > 4096 || x.h > 4096) return 'A logo layer has an impossible size.';
    return typeof x.whiteOnEndCard === 'boolean' ? null : 'A logo layer is malformed.';
  }
  if (x.kind === 'endcard') {
    const lines = x.lines as unknown[];
    return Array.isArray(lines) && lines.length <= 6 && lines.every((l) => isText(l, 160))
      ? null
      : 'An end card takes up to six lines of up to 160 characters.';
  }
  return 'A layer is of a kind this editor does not know.';
}

/** Why a project cannot be rendered, or null when it can. Checked on the server before any work. */
export function validateEditProject(p: unknown): string | null {
  if (!p || typeof p !== 'object') return 'No edit was sent.';
  const x = p as Partial<EditProject>;
  if (x.version !== 1 && x.version !== 2) return 'This edit was made by a different version of the editor.';
  if (!['16:9', '9:16', '1:1'].includes(String(x.aspect))) return 'Unknown aspect ratio.';
  if (!Array.isArray(x.tracks) || !Array.isArray(x.clips)) return 'The edit has no tracks.';
  if (x.clips.length > 200) return 'Too many clips — 200 is the most one export takes.';
  const hasLayers = x.clips.some((c) => c && typeof c === 'object' && (c as EditClip).layer !== undefined);
  if (hasLayers || x.look !== undefined) {
    if (x.version !== 2) return 'This edit was made by a different version of the editor.';
    const bad = validateEditLook(x.look);
    if (bad) return bad;
  }
  for (const c of x.clips) {
    if (!c || typeof c !== 'object') return 'A clip is malformed.';
    const nums = [c.start, c.in, c.out, c.speed, c.volume, c.fadeIn, c.fadeOut];
    if (nums.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return 'A clip has a position or length that is not a number.';
    if (c.out - c.in <= 0 || c.speed <= 0) return 'A clip has no length.';
    if (c.gain !== undefined) {
      if (c.source?.type !== 'audio') return 'Only a sound clip has a volume line.';
      const badLine = validateGainPoints(c.gain);
      if (badLine) return badLine;
    }
    if (c.layer === undefined) continue;
    const bad = validateEditLayer(c.layer);
    if (bad) return bad;
    if (c.layer.kind === 'endcard') {
      if (c.trackId !== EDIT_MAIN_TRACK) return 'The end card belongs on the main track.';
      continue;
    }
    const pl = c.place;
    if (!pl || !isNum(pl.x) || !isNum(pl.y) || !isNum(pl.scale) || pl.x < -1 || pl.x > 2 || pl.y < -1 || pl.y > 2 || pl.scale < 0.25 || pl.scale > 4) {
      return 'A layer has a position or size that cannot be read.';
    }
  }
  return null;
}

/** Lines a dragged layer catches on: the safe margin and the centre, as fractions of the frame. */
export function editLayerGuides(look: EditLook): { x: number[]; y: number[] } {
  const { margin } = overlayMargins(look.width, look.height);
  return { x: [margin / look.width, 0.5, 1 - margin / look.width], y: [margin / look.height, 0.5, 1 - margin / look.height] };
}

/** A dragged box, snapped by an edge or its centre to the nearest guide within reach. Fractions of the frame. */
export function editSnapBox(
  pos: { x: number; y: number },
  size: { w: number; h: number },
  guides: { x: number[]; y: number[] },
  reach: { x: number; y: number },
): { x: number; y: number; caught: { x?: number; y?: number } } {
  const axis = (p: number, s: number, lines: number[], r: number): { v: number; line?: number } => {
    let best: { v: number; d: number; line?: number } = { v: p, d: r };
    for (const line of lines) {
      for (const off of [0, s / 2, s]) {
        const d = Math.abs(p + off - line);
        if (d <= best.d) best = { v: line - off, d, line };
      }
    }
    return { v: best.v, line: best.line };
  };
  const ax = axis(pos.x, size.w, guides.x, reach.x);
  const ay = axis(pos.y, size.h, guides.y, reach.y);
  return { x: ax.v, y: ay.v, caught: { x: ax.line, y: ay.line } };
}

/** Where a caption of this size (pixels) would sit at each Auto spot, as fractions of the frame. */
export function editCaptionSpots(look: EditLook, size: { w: number; h: number }, footerH: number): { spot: CaptionSpot; x: number; y: number }[] {
  const { margin, logoBand } = overlayMargins(look.width, look.height);
  return CAPTION_SPOTS.map((spot) => {
    const at = captionSpotXY(spot, look.width, look.height, size.w, size.h, margin, footerH, logoBand);
    return { spot, x: at.x / look.width, y: at.y / look.height };
  });
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
