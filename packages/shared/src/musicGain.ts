/**
 * A sound clip's volume line, and the film's music dipping under the voice.
 *
 * composeFinal plays the music at its full level in the pauses and dips it wherever
 * someone speaks. The editor keeps those dips as key points on the music clip's volume
 * line, worked out the first time a film opens, so they can be dragged, added and
 * removed. The preview plays the same line export draws: what plays while editing is
 * what the saved film sounds like.
 */

/** Someone speaking, in seconds of the finished film (after its pace). */
export interface SpeechSpan {
  from: number;
  to: number;
}

/** A key point on a volume line: `t` seconds into the clip's source, `db` against the clip's own level. */
export interface GainPoint {
  t: number;
  db: number;
}

/** The music starts dipping this long before a line begins… */
export const MUSIC_DUCK_ATTACK = 0.3;
/** …and takes this long to come back up after the line ends. */
export const MUSIC_DUCK_RELEASE = 0.8;
/** A pause shorter than this keeps the music down: it would only swell and dip again. */
export const MIN_MUSIC_PAUSE = 1.2;
/** The film's music fades in over its first 0.8 s and out over its last 1.5 s. */
export const MUSIC_FADE_IN = 0.8;
export const MUSIC_FADE_OUT = 1.5;

/** How far down and up a key point goes. -40 dB is all but silent under a voice. */
export const GAIN_FLOOR_DB = -40;
export const GAIN_CEILING_DB = 6;
/** A line with more points than this is a mistake, not a mix. */
export const GAIN_MAX_POINTS = 120;

export const gainFromDb = (db: number): number => Math.pow(10, db / 20);
export const dbFromGain = (g: number): number => 20 * Math.log10(g);
const ms = (n: number): number => Math.round(n * 1000) / 1000;
const cents = (n: number): number => Math.round(n * 100) / 100;
const clampDb = (db: number): number => Math.max(GAIN_FLOOR_DB, Math.min(GAIN_CEILING_DB, db));

/**
 * The line's level at `t`, as a multiplier. Between two key points the level moves in a
 * straight line in amplitude, the way the film's dips ramp; before the first point and
 * after the last it holds.
 */
export function gainAt(points: readonly GainPoint[], t: number): number {
  const n = points.length;
  if (!n) return 1;
  if (t <= points[0]!.t) return gainFromDb(points[0]!.db);
  if (t >= points[n - 1]!.t) return gainFromDb(points[n - 1]!.db);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const p = points[lo]!;
  const q = points[hi]!;
  const a = gainFromDb(p.db);
  return a + ((gainFromDb(q.db) - a) * (t - p.t)) / (q.t - p.t);
}

/** The line's level at `t`, in dB. */
export const dbAt = (points: readonly GainPoint[], t: number): number => dbFromGain(gainAt(points, t));

/**
 * The film's own dips as key points: down under every line and across the end card, back
 * up in the pauses. `speech` is where the film heard a voice, `bodySeconds` where its end
 * card begins. Gives exactly the level composeFinal gave the music.
 *
 * The dip that runs into the end card has no point after it: the line holds to the end,
 * so a longer or shorter end card keeps the music down across all of it.
 */
export function autoMusicGain(speech: readonly SpeechSpan[], duckDb: number, bodySeconds: number, endCard: boolean): GainPoint[] {
  if (!(duckDb < 0) || !speech.length) return [];
  const duck = clampDb(duckDb);
  const spans = speech.map((s): [number, number] => [s.from, s.to]).sort((a, b) => a[0] - b[0]);
  if (endCard) {
    const from = Math.max(0, bodySeconds - MUSIC_DUCK_ATTACK);
    const last = spans[spans.length - 1]!;
    if (from - last[1] < MIN_MUSIC_PAUSE) last[1] = Infinity;
    else spans.push([from, Infinity]);
  }
  const raw: GainPoint[] = [];
  for (const [a, b] of spans) {
    raw.push({ t: a - MUSIC_DUCK_ATTACK, db: 0 }, { t: a, db: duck });
    if (Number.isFinite(b)) raw.push({ t: b, db: duck }, { t: b + MUSIC_DUCK_RELEASE, db: 0 });
  }
  // A line that starts within a moment of the film begins part-way down its ramp.
  const atZero = dbAt(raw, 0);
  const out = raw.filter((p) => p.t > 0).map((p) => ({ t: ms(p.t), db: cents(p.db) }));
  if (raw[0]!.t <= 0) out.unshift({ t: 0, db: cents(atZero) });
  return out;
}

/** A key point added on the line at `t`, at the level the line already has there. */
export function addGainPoint(points: readonly GainPoint[], t: number, db?: number): { points: GainPoint[]; index: number } {
  if (points.length >= GAIN_MAX_POINTS) return { points: [...points], index: -1 };
  const at = Math.max(0, ms(t));
  const point = { t: at, db: cents(clampDb(db ?? dbAt(points, at))) };
  let index = points.findIndex((p) => p.t > at);
  if (index < 0) index = points.length;
  return { points: [...points.slice(0, index), point, ...points.slice(index)], index };
}

/** A key point moved to `t` and `db`, kept between its neighbours so the line never folds back. */
export function moveGainPoint(points: readonly GainPoint[], index: number, t: number, db: number): GainPoint[] {
  if (!points[index]) return [...points];
  const lo = index > 0 ? points[index - 1]!.t : 0;
  const hi = index < points.length - 1 ? points[index + 1]!.t : Infinity;
  const next = [...points];
  next[index] = { t: ms(Math.max(lo, Math.min(hi, t))), db: cents(clampDb(db)) };
  return next;
}

export function removeGainPoint(points: readonly GainPoint[], index: number): GainPoint[] {
  return points.filter((_, i) => i !== index);
}

export function validateGainPoints(points: unknown): string | null {
  if (!Array.isArray(points)) return 'A volume line is malformed.';
  if (points.length > GAIN_MAX_POINTS) return `A volume line has more than ${GAIN_MAX_POINTS} key points.`;
  let prev = 0;
  for (const p of points as Array<Partial<GainPoint> | null>) {
    if (!p || typeof p.t !== 'number' || typeof p.db !== 'number' || !Number.isFinite(p.t) || !Number.isFinite(p.db)) {
      return 'A key point on a volume line cannot be read.';
    }
    if (p.t < 0 || p.t > 3600) return 'A key point on a volume line is outside the sound.';
    if (p.t < prev) return 'The key points on a volume line are out of order.';
    if (p.db < GAIN_FLOOR_DB - 0.01 || p.db > GAIN_CEILING_DB + 0.01) return `A key point is set lower than ${GAIN_FLOOR_DB} dB or higher than +${GAIN_CEILING_DB} dB.`;
    prev = p.t;
  }
  return null;
}

/**
 * How loud the film's music plays in the preview before its line: the level export
 * brings it to. `measured` is the track's own loudness, `loudness` the level it is
 * levelled to (both LUFS). A browser cannot play louder than the file, so it tops out at 1.
 */
export function musicPreviewLevel(loudness: number, measured: number | null | undefined): number {
  if (typeof measured !== 'number' || !Number.isFinite(measured)) return 1;
  const open = Math.max(-40, Math.min(-14, loudness));
  return Math.min(1, gainFromDb(open - measured));
}

/** The film's music fading in at its start and out at its end, `local` seconds into a clip `len` long. */
export function musicFadeAt(local: number, len: number): number {
  const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
  return clamp01(local / MUSIC_FADE_IN) * clamp01((len - local) / MUSIC_FADE_OUT);
}
