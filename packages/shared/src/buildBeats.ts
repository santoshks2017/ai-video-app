/**
 * Assembles the flat beat list for a brief: every selected category's beats in
 * order, plus an optional end card. Ported from the legacy tool's buildBeats().
 */

import type { Beat } from './types.js';
import { CATEGORY_BY_ID } from './categories.js';
import { beatContext, type RenderContext } from './context.js';

export function buildBeats(ctx: RenderContext): Beat[] {
  const beats: Beat[] = [];
  const bctx = beatContext(ctx);

  for (const id of ctx.brief.categories) {
    const cat = CATEGORY_BY_ID[id];
    if (!cat) continue;
    const values = ctx.brief.fieldValues[id] ?? {};
    for (const b of cat.beats(values, bctx) ?? []) {
      beats.push({ ...b, cat: cat.label });
    }
  }

  if (ctx.endcardOn) {
    const lines = ctx.endcard
      ? ctx.endcard
          .split(/\r?\n|\s*\|\s*/)
          .map((x) => x.trim())
          .filter(Boolean)
      : [ctx.displayDealer, ctx.cta, ctx.brief.dealer.address, ctx.brief.dealer.phone]
          .map((x) => (x ?? '').trim())
          .filter(Boolean);

    beats.push({
      title: 'End card',
      isEndCard: true,
      shot: 'Clean end card — flat background, no camera movement, logo lockup above a stacked contact block.',
      shotAlt: 'Clean end card — flat background, no camera movement, logo lockup above a stacked contact block.',
      dialogue: ctx.mode.speaks
        ? 'Closing voiceover line only: the dealership name and the call to action.'
        : 'No speech.',
      cardLines: lines,
    });
  }

  return beats;
}

export function collectStrings(scenes: { beat: Beat }[], footer: string): string[] {
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
  add(footer);
  return out;
}
