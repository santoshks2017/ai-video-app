/**
 * How long a film should be.
 *
 * Picking a length first and fitting the story into it is backwards: too short and
 * scenes are dropped or rushed, too long and the model pads. The app sizes the film
 * to what the brief asks it to say, and the storyboard can take that over.
 */

import type { Brief } from './types.js';
import { buildContext, clampPace } from './context.js';
import { buildBeats } from './buildBeats.js';

/** The paces the storyboard offers. The finished film is played at this speed; 1 leaves it as generated. */
export const PACES = [0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5] as const;

/** Room for one clear spoken line, or a readable shot when nobody speaks. */
const SPOKEN_SCENE_SECONDS = 4.8;
const SILENT_SCENE_SECONDS = 3.4;

/**
 * The length, at 1x, that gives every scene the brief produces room to land: a line
 * each, a little more for the opening to establish, a little more where a caption
 * has to be read. Deleted scenes are already gone from the beats, so deleting one
 * shortens the suggestion.
 */
export function suggestDuration(brief: Brief): number {
  const ctx = buildContext(brief);
  const beats = buildBeats(ctx);
  if (!beats.length) return 0;
  let total = 0;
  beats.forEach((b, i) => {
    total += ctx.mode.speaks && b.dialogue ? SPOKEN_SCENE_SECONDS : SILENT_SCENE_SECONDS;
    if (i === 0) total += 0.8;
    if (b.card || b.cardLines?.length) total += 0.4;
  });
  return Math.max(10, Math.min(90, Math.round(total)));
}

/** The length a film comes out at when its 1x length is played at a pace. */
export const pacedDuration = (seconds: number, pace: number | undefined): number =>
  Math.max(6, Math.round(seconds / clampPace(pace)));
