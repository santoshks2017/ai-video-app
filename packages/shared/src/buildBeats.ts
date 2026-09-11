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

  for (const id of ctx.brief.categories) {
    const cat = CATEGORY_BY_ID[id];
    if (!cat) continue;
    const values = categoryValues(id, ctx.brief.fieldValues[id]);
    for (const b of cat.beats(values, bctx) ?? []) {
      beats.push({ ...b, cat: cat.label });
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
