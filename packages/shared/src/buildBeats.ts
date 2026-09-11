/**
 * Assembles the flat beat list for a brief: every selected category's beats in
 * order, plus an optional end card. Ported from the legacy tool's buildBeats().
 */

import type { Beat } from './types.js';
import { CATEGORY_BY_ID, categoryValues } from './categories.js';
import { beatContext, type RenderContext } from './context.js';

export function buildBeats(ctx: RenderContext): Beat[] {
  const beats: Beat[] = [];
  const bctx = beatContext(ctx);

  const omitted = new Set(ctx.brief.omitScenes ?? []);

  for (const id of ctx.brief.categories) {
    const cat = CATEGORY_BY_ID[id];
    if (!cat) continue;
    const values = categoryValues(id, ctx.brief.fieldValues[id]);
    // A beat is known by its use case and its id, or else its place among the beats
    // that have none — so adding a feature row does not shift the key of the scene
    // after the list, and an edit never jumps to a neighbouring scene.
    let place = 0;
    for (const b of cat.beats(values, bctx) ?? []) {
      const key = `${id}:${b.id ?? place++}`;
      if (omitted.has(key)) continue;
      beats.push({ ...b, key, cat: cat.label });
    }
  }

  // The end card is NOT generated any more — it's composited in post as a real
  // text frame (apps/api/src/post.ts), so the dealer details and CTA are always
  // legible and the video never ends on a stray model shot.

  return beats;
}

/**
 * Exact on-screen strings the MODEL must render. The footer bar and logos are no
 * longer in here — they're composited in post, so the model is told to leave the
 * frame clean instead.
 */
export function collectStrings(scenes: { beat: Beat }[], _footer?: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string | undefined): void => {
    const t = String(s ?? '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const sc of scenes) {
    add(sc.beat.card);
    add(sc.beat.cardSub);
    (sc.beat.cardLines ?? []).forEach(add);
  }
  return out;
}
