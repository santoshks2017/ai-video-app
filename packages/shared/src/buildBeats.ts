/**
 * Assembles the flat beat list for a brief: every selected category's beats in
 * order, plus an optional end card. Ported from the legacy tool's buildBeats().
 */

import type { Beat, Brief, CategoryDef, CategoryId } from './types.js';
import { CATEGORY_BY_ID, categoryValues } from './categories.js';
import { beatContext, type RenderContext } from './context.js';

/** Value comes after desire: an offer means more once the car is wanted. */
const STAGE: Partial<Record<CategoryId, number>> = { offer: 2 };

/**
 * The beat list for a brief.
 *
 * One use case plays its own arc. Several make ONE ad, not several played back to back:
 * features, offers and a festival picked together used to greet the viewer three times
 * and ask for the booking twice. So the use cases share one opening and one close; their
 * points run as one story in between — what makes the car wanted first, then what makes
 * now the moment to buy — and a theme such as a festival adds no scenes of its own. It is
 * the look of every shot, the greeting that opens the film and the wish near its end.
 */
export function buildBeats(ctx: RenderContext): Beat[] {
  const bctx = beatContext(ctx);
  const groups = ctx.brief.categories
    .map((id) => CATEGORY_BY_ID[id])
    .filter((cat): cat is CategoryDef => Boolean(cat))
    .map((cat) => {
      const values = categoryValues(cat.id, ctx.brief.fieldValues[cat.id]);
      // A beat is known by its use case and its id, or else its place among the beats
      // that have none — so adding a feature row does not shift the key of the scene
      // after the list, and an edit never jumps to a neighbouring scene.
      let place = 0;
      const beats = (cat.beats(values, bctx) ?? []).map((b) => ({ ...b, key: `${cat.id}:${b.id ?? place++}`, cat: cat.label }));
      return { cat, beats };
    });

  // The end card is NOT generated any more — it's composited in post as a real
  // text frame (apps/api/src/post.ts), so the dealer details and CTA are always
  // legible and the video never ends on a stray model shot.
  const omitted = new Set(ctx.brief.omitScenes ?? []);
  return (groups.length > 1 ? composeStory(groups, ctx) : groups.flatMap((g) => g.beats)).filter(
    (b) => !b.key || !omitted.has(b.key),
  );
}

function composeStory(groups: { cat: CategoryDef; beats: Beat[] }[], ctx: RenderContext): Beat[] {
  const stories = groups.filter((g) => g.cat.layer !== 'theme');
  // Only themes picked: there is nothing to set them in, so they play as written.
  if (!stories.length) return groups.flatMap((g) => g.beats);
  const themeGroup = groups.find((g) => g.cat.layer === 'theme');
  const ordered = [...stories].sort((a, b) => (STAGE[a.cat.id] ?? 1) - (STAGE[b.cat.id] ?? 1));

  const opening = oneMoment('open', [
    themeGroup?.beats.find((b) => b.role === 'open'),
    ...ordered.flatMap((g) => g.beats.filter((b) => b.role === 'open')),
  ], ctx);
  const closing = oneMoment('close', [
    ...ordered.flatMap((g) => g.beats.filter((b) => b.role === 'close')),
    themeGroup?.beats.find((b) => b.role === 'close'),
  ], ctx);
  const middle = ordered.flatMap((g) => g.beats.filter((b) => b.role !== 'open' && b.role !== 'close'));
  const film = [opening, ...middle, closing].filter((b): b is Beat => Boolean(b));

  const theme = storyTheme(ctx.brief);
  if (!theme) return film;
  const look = `Wherever the showroom is in frame, it is dressed for ${theme.occasion}${
    theme.dressing ? ` — ${theme.dressing}` : ''
  }; in close-ups the decor glows softly out of focus behind.`;
  return film.map((b) =>
    /dressed for/i.test(b.shot) ? b : { ...b, shot: `${b.shot} ${look}`, ...(b.shotAlt ? { shotAlt: `${b.shotAlt} ${look}` } : {}) },
  );
}

/** Several use cases' openings, or closes, as one moment: the first one's shot, every intent. */
function oneMoment(kind: 'open' | 'close', candidates: (Beat | undefined)[], ctx: RenderContext): Beat | undefined {
  const moments = candidates.filter((b): b is Beat => Boolean(b));
  if (moments.length <= 1) return moments[0];
  const lead = moments[0]!;
  const intents = moments.map((b) => b.dialogue?.trim()).filter((d): d is string => Boolean(d));
  return {
    key: `story:${kind}`,
    title: kind === 'open' ? 'Opening' : 'Close',
    role: kind,
    cat: [...new Set(moments.map((b) => b.cat).filter(Boolean))].join(' + '),
    shot: lead.shot,
    shotAlt: lead.shotAlt,
    dialogue:
      `The one ${kind === 'open' ? 'opening' : 'close'} of the whole film, not one per use case. In a single flowing line: ` +
      intents.map((d, i) => `(${i + 1}) ${d}`).join(' ') +
      (kind === 'close' ? ' End on the call to action.' : ''),
    card: kind === 'open' ? moments.find((b) => b.card)?.card : ctx.cta,
  };
}

export interface StoryTheme {
  occasion: string;
  dressing: string;
  tone: string;
  music: string;
}

/** The theme a film is set in, when a theme use case is picked alongside a topic. */
export function storyTheme(brief: Brief): StoryTheme | null {
  const cats = brief.categories.map((id) => CATEGORY_BY_ID[id]).filter((c): c is CategoryDef => Boolean(c));
  const theme = cats.find((c) => c.layer === 'theme');
  if (!theme || !cats.some((c) => c.layer !== 'theme')) return null;
  const v = categoryValues(theme.id, brief.fieldValues[theme.id]);
  return {
    occasion: String(v.occasionName ?? '').trim() || 'the occasion',
    dressing: String(v.festiveDressing ?? '').trim(),
    tone: String(v.occasionType ?? '').trim(),
    music: theme.music,
  };
}

/** The theme, said once for the model and for the writer. */
export function themeDirection(theme: StoryTheme): string {
  return `This is a ${theme.occasion} film. The showroom is dressed for ${theme.occasion}${
    theme.dressing ? ` — ${theme.dressing}` : ' with tasteful, authentic decorations for the occasion'
  }, and that decor is visible in every shot. The theme is the look and the warmth${
    theme.tone ? ` (${theme.tone})` : ''
  }; the car and what the dealer is offering are what the film is about.`;
}

/**
 * What the film is for and how it goes wrong, for the whole brief rather than for the
 * first use case picked — the script writer used to be briefed on that one alone.
 */
export function storyGuidance(brief: Brief): { useCase: string; purpose?: string; avoid: string[] } {
  const cats = brief.categories.map((id) => CATEGORY_BY_ID[id]).filter((c): c is CategoryDef => Boolean(c));
  if (cats.length <= 1) return { useCase: cats[0]?.label ?? '', purpose: cats[0]?.purpose, avoid: cats[0]?.avoid ?? [] };
  const stories = cats.filter((c) => c.layer !== 'theme');
  if (!stories.length) {
    return { useCase: cats.map((c) => c.label).join(' + '), purpose: cats.map((c) => c.purpose).join(' '), avoid: cats.flatMap((c) => c.avoid) };
  }
  const theme = storyTheme(brief);
  const selling = stories.some((c) => c.id === 'offer');
  const topics = stories.map((c) => c.label).join(' and ');
  const avoid = [
    'Playing the use cases one after another like separate ads — a second greeting, a second hook or a second call to action',
    // An emotional format's "no prices" rule cannot stand beside an offer the dealer asked to say.
    ...stories.flatMap((c) => c.avoid).filter((a) => !(selling && /price or discount mentions/i.test(a))),
    ...(theme
      ? ['Leading with price or discount language in the opening greeting', `A generic "happy ${theme.occasion}" with no dealer voice`]
      : []),
  ];
  return {
    useCase: stories.map((c) => c.label).join(' + ') + (theme ? `, set during ${theme.occasion}` : ''),
    purpose:
      `One ad that says all of it in one continuous story, not ${cats.length} ads back to back. ${stories.map((c) => c.purpose).join(' ')}` +
      (theme
        ? ` ${theme.occasion} is the setting and the warmth — the look of every shot, the greeting that opens the film and the wish near its end — while ${topics} ${stories.length > 1 ? 'are' : 'is'} what the film says.`
        : ''),
    avoid: [...new Set(avoid)],
  };
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
