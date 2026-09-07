/**
 * Assembles the flat beat list for a brief: every selected category's beats in
 * order, plus an optional end card. Ported from the legacy tool's buildBeats().
 */

import type { Beat } from './types.js';
import { CATEGORY_BY_ID } from './categories.js';
import { beatContext, type RenderContext } from './context.js';

/**
 * The end card is TEXT ONLY. Left looser ("logo lockup"), the model invents a
 * stock car photo and a real manufacturer logo on it — both wrong, and the logo
 * breaks the fictionalise rule. Spelled out explicitly here.
 */
const END_CARD_SHOT =
  'Static end card, text only. A flat solid-colour background — absolutely NO vehicle, NO car, NO photograph, NO product shot, NO stock imagery and NO manufacturer logo, badge or wordmark of any kind. Only the stacked lines of text listed below, centred, in a clean sans-serif, on the plain background. No camera movement, no parallax, no animated graphics.';

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
      shot: END_CARD_SHOT,
      shotAlt: END_CARD_SHOT,
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
