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
  sceneOverrides?: Record<string, { dialogue?: string; phonetic?: string; shot?: string }>;
  /** The model this brief will actually run on, for capability checks. */
  model?: { name?: string; speechLanguages?: string[]; maxClipSec?: number } | null;
  /** Every model available to pick, so a better fit for this duration can be named. */
  models?: { name?: string; maxClipSec?: number; enabled?: boolean }[];
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

  // A model-agnostic brief with nothing to anchor it is how an outdated car
  // ends up on screen.
  if (!brief.modelSpecific) {
    if (brief.lineup?.models.length) {
      checks.push({
        level: 'ok',
        code: 'lineup-named',
        text: `No single model picked, so the prompt names the ${brief.lineup.brand} range it may show: ${brief.lineup.models.slice(0, 6).join(', ')}${brief.lineup.models.length > 6 ? `, +${brief.lineup.models.length - 6} more` : ''}.`,
      });
    } else {
      checks.push({
        level: 'warn',
        code: 'no-lineup',
        text: 'No car is selected and no line-up could be found for this client\u2019s brand, so nothing stops the model inventing a vehicle — usually an older generation. Pick a car, or sync the client\u2019s brand in Vehicles.',
      });
    }
  }

  // Prompt budget. Global instructions and the project's own steer are pasted
  // verbatim into the video prompt, and a video model reads all of it as
  // direction for the film. A pronunciation document left switched on here once
  // reached 54% of a 25,000-character prompt, and the footage collapsed into
  // disconnected stock shots with garbled floating text. Nothing in the app said
  // a word about it, so this is the check that would have caught it on day one.
  const directionChars = (brief.extraDirection ?? []).join('\n').trim().length;
  if (directionChars > 5000) {
    checks.push({
      level: 'bad',
      code: 'direction-overwhelms-prompt',
      text: `Your extra direction is ${directionChars.toLocaleString()} characters — far longer than the shot description, so it is most of what the video model reads. Long reference documents belong in Languages (spoken and on-screen rules) or in the storyboard, not here: the video model treats every line of this as an instruction for the film. Switch the long instruction off in Instructions, or cut it back.`,
    });
  } else if (directionChars > 1200) {
    checks.push({
      level: 'warn',
      code: 'direction-long',
      text: `Extra direction is ${directionChars.toLocaleString()} characters. Keep house rules short and visual — anything long competes with the shot description for the model's attention.`,
    });
  }

  // A duration that needs splitting on this model but would fit one take on
  // another. Every extra segment is another paid call and another chance for the
  // presenter, car or lighting to drift across the cut.
  if (plan.parts > 1) {
    const better = (opts.models ?? [])
      .filter((m) => m.enabled !== false && (m.maxClipSec ?? 0) >= ctx.totalDuration)
      .sort((a, b) => (a.maxClipSec ?? 0) - (b.maxClipSec ?? 0))[0];
    if (better?.name) {
      checks.push({
        level: 'warn',
        code: 'model-forces-split',
        text: `${opts.model?.name ?? 'This model'} caps at ${
          opts.model?.maxClipSec ?? ctx.maxChunk
        }s, so this ${ctx.totalDuration}s video is split into ${plan.parts} separate generations and stitched. ${better.name} renders all ${ctx.totalDuration}s in one take — no cuts to drift across. Worth switching before you pay for ${plan.parts} calls.`,
      });
    }
  }

  // Spoken script (the Hindi-pronunciation failure). The beats carry stage
  // directions, not lines — so with nothing written the model has to invent the
  // Hindi, pronounce it and lip-sync to it from an English brief, which is where
  // the delivery falls apart. Written lines turn that into reading aloud.
  if (mode.speaks && plan.scenes.length) {
    const overrides = opts.sceneOverrides ?? {};
    // What counts is the pronunciation spelling — that is what the model performs.
    const unscripted = plan.scenes.filter((sc, i) => {
      const o = overrides[String(i)];
      return !(o?.phonetic ?? o?.dialogue ?? '').trim() && sc.beat.dialogue;
    }).length;
    // English needs no respelling, so only ask for one where the language says so.
    const needsPhonetics = brief.language?.needsPhonetics !== false;
    const unspelled = needsPhonetics
      ? plan.scenes.filter((sc, i) => {
          const o = overrides[String(i)];
          return (o?.dialogue ?? '').trim() && !(o?.phonetic ?? '').trim() && sc.beat.dialogue;
        }).length
      : 0;
    const langName = brief.language?.name ?? 'Hindi';
    if (unscripted) {
      const spoken = plan.scenes.filter((sc) => sc.beat.dialogue).length;
      checks.push({
        level: 'warn',
        code: 'no-spoken-script',
        text: `${
          unscripted >= spoken
            ? 'No scene has a written line'
            : `${unscripted} of ${spoken} scenes have no written line`
        }, so the model has to invent the ${langName} wording itself — the usual cause of mangled pronunciation. Open the storyboard below and press "Write the script": it fills every line and its pronunciation, costs a fraction of a rupee, and you can edit both before generating.`,
      });
    } else if (unspelled) {
      checks.push({
        level: 'warn',
        code: 'no-pronunciation-spelling',
        text: `${unspelled} scene${unspelled > 1 ? 's have' : ' has'} a written line but no pronunciation spelling. Plain ${langName} tells the model which words to say, not where the stress falls or how long the vowels are — which is what makes the delivery sound wrong. Press "Redo pronunciation" in the storyboard to fill them in without rewriting the copy.`,
      });
    } else {
      checks.push({
        level: 'ok',
        code: 'script-written',
        text: 'Every spoken scene has a line and a pronunciation spelling, so the model performs a fixed reading rather than improvising one.',
      });
    }

    const langs = opts.model?.speechLanguages ?? [];
    const code = brief.language?.code ?? 'hi';
    if (langs.length && !langs.some((l) => l.toLowerCase().startsWith(code.toLowerCase().slice(0, 2)))) {
      checks.push({
        level: 'warn',
        code: 'speech-language-unsupported',
        text: `${opts.model?.name ?? 'This model'} does not list ${langName} among the languages it can speak (${langs.join(', ')}). A pronunciation spelling helps, but the delivery may still be wrong — judge it on a short run before committing to a long one.`,
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
