/**
 * Tunable constants carried over from the legacy tool. Several are estimates
 * flagged in HANDOFF-BRIEF-legacy-tool.md for real-world calibration (P1.3).
 */

/**
 * Spoken pace: Hindi/Hinglish ad delivery sits near 2.2 words/second once
 * natural pauses are allowed for. NOT measured from real audio — recalibrate
 * against real generated outputs (PRD P1.3).
 *
 * Kept as the fallback for a brief that names no rate of its own; the rate is a
 * decision the designer makes per film now — see SPEECH_RATES.
 */
export const WORDS_PER_SECOND = 2.2;

/**
 * How fast the voice speaks, chosen per film.
 *
 * It used to be one hard-coded instruction — "a natural, unhurried pace" — which
 * is the right read for a walkaround and the wrong one for a three-day offer. The
 * rate settles two things at once: how the model is told to deliver the line, and
 * how many words a scene's seconds are worth, so picking a faster read genuinely
 * buys more to say rather than just asking for hurry.
 */
export interface SpeechRate {
  id: string;
  label: string;
  /** Words a minute. */
  wpm: number;
  /** What it is for, in the picker. */
  hint: string;
  /** How the delivery is described to the video model. */
  delivery: string;
}

export const SPEECH_RATES: SpeechRate[] = [
  {
    id: 'measured',
    label: 'Measured',
    wpm: 110,
    hint: 'Room to breathe — premium, considered',
    delivery: 'an unhurried, measured read with real pauses between thoughts',
  },
  {
    id: 'natural',
    label: 'Natural',
    wpm: 130,
    hint: 'How a showroom presenter talks',
    delivery: 'a natural speaking pace with real pauses',
  },
  {
    id: 'brisk',
    label: 'Brisk',
    wpm: 150,
    hint: 'More said in the same seconds',
    delivery: 'a brisk, warm read that still lands every word',
  },
  {
    id: 'urgent',
    label: 'Urgent',
    wpm: 170,
    hint: 'Offers and deadlines — high energy',
    delivery: 'a fast, high-energy read — urgent, but every word still clearly separated',
  },
];

/** What a film speaks at when nobody has said otherwise. */
export const DEFAULT_WPM = 130;

/** The named rate a number falls on — the nearest one, so an old value still reads. */
export const speechRate = (wpm: number | undefined): SpeechRate => {
  const want = Number(wpm) || DEFAULT_WPM;
  return SPEECH_RATES.reduce((best, r) =>
    Math.abs(r.wpm - want) < Math.abs(best.wpm - want) ? r : best,
  );
};

/** Floor for a scene that has to hold a spoken line. */
export const MIN_SPOKEN_SCENE = 2.0;

/** On-screen string length past which a video model tends to garble it. */
export const LONG_STRING_CHARS = 42;

/** Footer bar length past which it renders unreliably in a small bar. */
export const LONG_FOOTER_CHARS = 70;

/** Omni Flash pricing anchor (PRD P0.5 / decisions.md): ~$0.10 / second at 720p. */
export const USD_PER_SECOND_720P = 0.1;

/** Default INR conversion rate — surfaced in the estimate so it is never silent. */
export const DEFAULT_USD_TO_INR = 88;

/** Cost-confirmation threshold in INR (PRD P0.9, decisions.md — fixed at Rs 500). */
export const COST_CONFIRM_INR = 500;

/** Omni Flash per-call clip length bounds, in seconds. */
export const OMNI_FLASH_MIN_CLIP_SEC = 3;
export const OMNI_FLASH_MAX_CLIP_SEC = 10;

/**
 * Flag briefs that fan out into an unusually high number of sequential API
 * calls (PRD P0.9 — "warn if a request will trigger an unusually high number
 * of API calls").
 */
export const HIGH_CALL_COUNT = 6;

/** On-screen card cap for a given duration: max(2, floor(duration / 5)). */
export function cardCap(totalDuration: number): number {
  return Math.max(2, Math.floor(totalDuration / 5));
}
