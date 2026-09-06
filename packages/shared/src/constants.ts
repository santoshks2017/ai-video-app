/**
 * Tunable constants carried over from the legacy tool. Several are estimates
 * flagged in HANDOFF-BRIEF-legacy-tool.md for real-world calibration (P1.3).
 */

/**
 * Spoken pace: Hindi/Hinglish ad delivery sits near 2.2 words/second once
 * natural pauses are allowed for. NOT measured from real audio — recalibrate
 * against real generated outputs (PRD P1.3).
 */
export const WORDS_PER_SECOND = 2.2;

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
