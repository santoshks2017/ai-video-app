/**
 * Pre-flight validation gate (PRD P0.6). Ported from the legacy tool's
 * runChecks() and hardened: any `bad`-level check BLOCKS generation, because a
 * paid API call is at stake. Extended with:
 *  - dangling attachment-reference check (P0.4)
 *  - missing car-model reference check (P0.2 fallback to manual upload)
 *
 * Every check carries a `code` so the app can track pre-flight block rate as a
 * metric (PRD success metrics).
 */

import type { Brief, Check } from './types.js';
import { LONG_STRING_CHARS, cardCap } from './constants.js';
import { buildContext } from './context.js';
import { buildBeats, collectStrings } from './buildBeats.js';
import { planScenes } from './planScenes.js';
import { CATEGORY_BY_ID, isPromptOnly } from './categories.js';

export interface PreflightResult {
  checks: Check[];
  /** True when no `bad` check is present — generation may proceed. */
  canGenerate: boolean;
  /** True when the selection is prompt-only (presenter category present). */
  promptOnly: boolean;
}

export interface RunChecksOptions {
  /** Storyboard edits, keyed by global scene index — where written lines live. */
  sceneOverrides?: Record<string, { dialogue?: string; shot?: string }>;
  /** The model this brief will actually run on, for capability checks. */
  model?: { name?: string; speechLanguages?: string[] } | null;
}

export function runChecks(brief: Brief, opts: RunChecksOptions = {}): PreflightResult {
  const checks: Check[] = [];

  if (brief.categories.length === 0) {
    checks.push({ level: 'bad', code: 'no-category', text: 'Pick at least one video category.' });
    return { checks, canGenerate: false, promptOnly: false };
  }

  const promptOnly = isPromptOnly(brief.categories);
  const ctx = buildContext(brief);
  const beats = buildBeats(ctx);
  const plan = planScenes(beats, ctx.totalDuration, ctx.maxChunk, { speaks: ctx.mode.speaks });
  const mode = ctx.mode;

  // Mandatory category fields — blocking.
  const missing: string[] = [];
  for (const id of brief.categories) {
    const cat = CATEGORY_BY_ID[id];
    if (!cat) continue;
    const v = brief.fieldValues[id] ?? {};
    for (const m of cat.mandatory ?? []) {
      if (!String(v[m.id] ?? '').trim()) missing.push(`${cat.label} — ${m.label}`);
    }
  }
  if (missing.length) {
    checks.push({
      level: 'bad',
      code: 'missing-mandatory',
      text:
        'Fill these in before generating — the prompt ships vague placeholder direction without them: ' +
        missing.join('; ') +
        '.',
    });
  }

  // Dealer identity — blocking for a paid call (was a warning in the legacy tool).
  if (!ctx.brief.dealer.dealerName) {
    checks.push({
      level: promptOnly ? 'warn' : 'bad',
      code: 'no-dealer-name',
      text: 'No dealer name — the footer and end card will be incomplete, and the branding overlays have nothing to show.',
    });
  }

  if (ctx.useFake && (!ctx.brief.dealer.fakeBrandModel || !ctx.brief.dealer.fakeDealer)) {
    checks.push({
      level: 'bad',
      code: 'fictional-placeholders-empty',
      text: 'Fictional branding is on but the placeholder names are empty, so the prompt would contain literal [Placeholder] text.',
    });
  }

  // The old footer/on-screen identity mismatch check is gone: the footer bar is
  // composited in post from the client record, so it can no longer disagree with
  // the branding shown on screen.

  // Car-model reference (P0.2): model-specific brief with no car-model image in scope.
  if (brief.modelSpecific) {
    const hasCarModelRef = (brief.attachments ?? []).some(
      (a) => a.kind === 'car-model' && (a.storagePath || a.refId),
    );
    if (!brief.carModel?.trim()) {
      checks.push({
        level: 'bad',
        code: 'model-specific-no-name',
        text: 'Model Specific is on but no car model is named — name the model so its reference set can be fetched or uploaded.',
      });
    } else if (!hasCarModelRef) {
      checks.push({
        level: promptOnly ? 'warn' : 'bad',
        code: 'no-car-model-reference',
        text: `No reference images in scope for "${brief.carModel}". Run the scraper or upload a front/side/rear/interior set — generating without a reference lets the model invent an outdated design.`,
      });
    }
  }

  // Dangling attachment reference (P0.4): a filename cited but not present.
  // (In this build attachments are always in scope by construction; this guards
  //  against a future edited-storyboard path that hand-references a filename.)
  const attachmentNames = new Set((brief.attachments ?? []).map((a) => a.filename));
  const citedInStyle = [...brief.visualStyle.matchAll(/([\w-]+\.(?:jpg|jpeg|png|webp))/gi)].map((m) => m[1]!);
  const dangling = citedInStyle.filter((name) => !attachmentNames.has(name));
  if (dangling.length) {
    checks.push({
      level: 'bad',
      code: 'dangling-attachment',
      text: `The brief references ${dangling.join(', ')} but no attachment with that filename is in scope. Add the file or remove the reference.`,
    });
  }

  // Pacing. The planner now fits the scene count to the duration, so a rushed
  // read is prevented rather than warned about — but say what it left out.
  if (plan.scenes.length) {
    const per = Math.round((ctx.totalDuration / plan.scenes.length) * 10) / 10;
    checks.push({
      level: 'ok',
      code: 'pacing-ok',
      text: `${plan.scenes.length} scenes across ${ctx.totalDuration}s — about ${per}s each${
        mode.speaks ? ', which holds a natural spoken line' : ''
      }.`,
    });
  }
  if (plan.droppedBeats > 0) {
    checks.push({
      level: 'warn',
      code: 'beats-trimmed',
      text: `${plan.droppedBeats} beat${plan.droppedBeats > 1 ? 's were' : ' was'} left out so the rest have room at ${ctx.totalDuration}s. Lengthen the video or pick fewer use cases to keep them all.`,
    });
  }

  // Spoken script (the Hindi-pronunciation failure). The beats carry stage
  // directions, not lines — so with nothing written the model has to invent the
  // Hindi, pronounce it and lip-sync to it from an English brief, which is where
  // the delivery falls apart. Written lines turn that into reading aloud.
  if (mode.speaks && plan.scenes.length) {
    const overrides = opts.sceneOverrides ?? {};
    const unscripted = plan.scenes.filter(
      (sc, i) => !(overrides[String(i)]?.dialogue ?? '').trim() && sc.beat.dialogue,
    ).length;
    if (unscripted) {
      checks.push({
        level: 'warn',
        code: 'no-spoken-script',
        text: `${unscripted} of ${plan.scenes.length} scenes have no written line, so the model composes the Hindi itself — the usual cause of mangled pronunciation. Write the script in the storyboard and it speaks the words instead of inventing them.`,
      });
    } else {
      checks.push({
        level: 'ok',
        code: 'script-written',
        text: 'Every spoken scene has a written line, so the model reads rather than improvises.',
      });
    }

    const langs = opts.model?.speechLanguages ?? [];
    if (langs.length && !langs.some((l) => /^hi/i.test(l))) {
      checks.push({
        level: 'warn',
        code: 'speech-language-unsupported',
        text: `${opts.model?.name ?? 'This model'} does not list Hindi among the languages it can speak (${langs.join(', ')}). A written Devanagari script helps, but the delivery may still be mispronounced — judge it on a short run before committing to a long one.`,
      });
    }
  }

  // On-screen card load (Premier Motors reference dropped a card when overloaded).
  const cardMoments = plan.scenes.filter(
    (s) => !s.beat.isEndCard && (s.beat.card || (s.beat.cardLines ?? []).length),
  ).length;
  const cap = cardCap(ctx.totalDuration);
  if (cardMoments > cap) {
    checks.push({
      level: 'warn',
      code: 'card-overload',
      text: `${cardMoments} on-screen cards in ${ctx.totalDuration}s. Models reliably render about ${cap} at this length — in the Premier Motors reference the extra offer card was dropped entirely. Cut a card or lengthen the video.`,
    });
  }

  const longCards = collectStrings(plan.scenes).filter((c) => c.length > LONG_STRING_CHARS);
  if (longCards.length) {
    checks.push({
      level: 'warn',
      code: 'long-onscreen-string',
      text: `${longCards.length} on-screen string(s) run past ${LONG_STRING_CHARS} characters and are likely to render garbled. Shorten: "${longCards[0]!.slice(0, 50)}…".`,
    });
  }

  if (plan.parts > 1) {
    checks.push({
      level: 'ok',
      code: 'multipart',
      text: `Splits into ${plan.parts} clips of ${plan.partDuration}s, each under your ${ctx.maxChunk}s cap.`,
    });
  }

  const canGenerate = !checks.some((c) => c.level === 'bad');
  return { checks, canGenerate, promptOnly };
}
