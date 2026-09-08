/**
 * Ports the load-bearing assertions from the legacy tool's 15 QA scenarios
 * (see docs/HANDOFF-BRIEF-legacy-tool.md) plus the new PRD gates.
 * Run: npm test --workspace @ava/shared
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyBrief,
  buildPrompt,
  runChecks,
  estimateCost,
  planScenes,
  buildBeats,
  buildContext,
  isPromptOnly,
  CATEGORY_BY_ID,
  filenameFromLabel,
  dedupeFilenames,
  applyFeedback,
  estimateSegmentsCost,
  LANGUAGE_SEEDS,
  type Brief,
} from '@ava/shared';

function base(overrides: Partial<Brief> = {}): Brief {
  const b = emptyBrief();
  b.dealer.dealerName = 'Jasper Tata';
  b.dealer.brandModel = 'Tata Safari';
  b.dealer.fictionalize = false;
  b.categories = ['walkaround'];
  b.fieldValues = { walkaround: { zonesToHighlight: 'glass facade, delivery bay, accessories wall' } };
  return { ...b, ...overrides };
}

test('no category selected blocks generation', () => {
  const r = runChecks(emptyBrief());
  assert.equal(r.canGenerate, false);
  assert.ok(r.checks.some((c) => c.code === 'no-category'));
});

test('missing mandatory field is a blocking check', () => {
  const b = base({ fieldValues: { walkaround: {} } });
  const r = runChecks(b);
  assert.equal(r.canGenerate, false);
  assert.ok(r.checks.some((c) => c.code === 'missing-mandatory' && c.level === 'bad'));
});

test('valid walkaround brief can generate', () => {
  const r = runChecks(base());
  assert.equal(r.canGenerate, true);
});

test('multi-part chunking splits evenly and stays under the cap', () => {
  const b = base({ durationSec: 40, maxChunkSec: 10 });
  const ctx = buildContext(b);
  const plan = planScenes(buildBeats(ctx), ctx.totalDuration, ctx.maxChunk);
  assert.ok(plan.parts >= 4);
  assert.ok(plan.partDuration <= 10 + 1e-9);
  // every scene assigned to exactly one part, parts contiguous
  const partIndexes = new Set(plan.scenes.map((s) => s.part));
  assert.equal(partIndexes.size, plan.parts);
});

test('rulebook is injected into every spoken part', () => {
  const b = base({ durationSec: 40, maxChunkSec: 10, narration: 'presenter' });
  const res = buildPrompt(b)!;
  assert.ok(res.parts.length >= 4);
  for (const p of res.parts) {
    assert.match(p.text, /PRONUNCIATION & DELIVERY RULES/);
    assert.match(p.text, /Never invent a price, EMI, mileage/);
  }
});

test('silent mode contains no speech instructions and no rulebook', () => {
  const b = base({ narration: 'silent' });
  const res = buildPrompt(b)!;
  const text = res.parts.map((p) => p.text).join('\n');
  assert.match(text, /NO speech anywhere in this clip/);
  assert.doesNotMatch(text, /PRONUNCIATION & DELIVERY RULES/);
});

test('gender locks the correct Hindi verb forms', () => {
  const male = buildPrompt(base({ actor: { ...emptyBrief().actor, gender: 'male' } }))!;
  assert.match(male.parts[0]!.text, /masculine Hindi verb forms/);
  const female = buildPrompt(base())!;
  assert.match(female.parts[0]!.text, /feminine Hindi verb forms/);
});

test('on-screen strings are emitted as an exact-spelling lock', () => {
  const res = buildPrompt(base())!;
  assert.match(res.parts[0]!.text, /ON-SCREEN TEXT — EXACT STRINGS/);
  assert.match(res.parts[0]!.text, /Render these strings EXACTLY as written/);
});

test('every use case is automated — the prompt-only split was dropped', () => {
  // Omni Flash does generate a lip-synced presenter, which the original PRD
  // assumed impossible. See decisions.md 2026-09-07.
  for (const c of Object.values(CATEGORY_BY_ID)) {
    assert.equal(c.mode, 'automated', `${c.id} should be automated`);
  }
  assert.equal(isPromptOnly(['offer']), false);
  assert.equal(isPromptOnly(['walkaround', 'testimonial']), false);
});

test('offer prompt still carries the full rulebook', () => {
  const b = base({ categories: ['offer'], fieldValues: { offer: { cashDiscount: '₹2,25,000' } } });
  const res = buildPrompt(b)!;
  assert.match(res.parts[0]!.text, /PRONUNCIATION & DELIVERY RULES/);
});

test('the model is told to leave branding furniture out of the frame', () => {
  // Footer, corner logos and the end card are composited in post, so the prompt
  // must not ask the model to draw them.
  const res = buildPrompt(base())!;
  const text = res.parts.map((p) => p.text).join('\n');
  assert.match(text, /CLEAN FRAME/);
  assert.match(text, /no bottom footer bar/);
  assert.doesNotMatch(text, /PERSISTENT BRANDING/);
});

test('no end-card beat is generated — the outro is post-production', () => {
  const b = base({ endCardOn: true, endCard: 'Jasper Tata | Book now' });
  const ctx = buildContext(b);
  assert.equal(buildBeats(ctx).some((x) => x.isEndCard), false);
});

test('model-specific with no reference set blocks an automated generation (P0.2 fallback)', () => {
  const b = base({ modelSpecific: true, carModel: 'Hyundai Creta' });
  const r = runChecks(b);
  assert.equal(r.canGenerate, false);
  assert.ok(r.checks.some((c) => c.code === 'no-car-model-reference'));
});

test('cost estimate: 27s single clip is below the Rs 500 gate', () => {
  const e = estimateCost(base(), { usdToInr: 88 });
  assert.equal(e.needsConfirmation, false);
  assert.ok(e.inr > 0);
});

test('cost estimate: a long multi-part video trips the confirmation gate', () => {
  const e = estimateCost(base({ durationSec: 60, maxChunkSec: 8 }), { usdToInr: 88 });
  assert.equal(e.needsConfirmation, true); // 60 * 0.10 * 88 = 528 > 500
});

test('attachment filenames are derived from labels and deduped', () => {
  assert.equal(filenameFromLabel('Showroom front exterior', 'dealer'), 'showroom_front_exterior.jpg');
  const out = dedupeFilenames([
    { label: 'Front', filename: '', kind: 'car-model' },
    { label: 'Front', filename: '', kind: 'car-model' },
  ]);
  assert.notEqual(out[0]!.filename, out[1]!.filename);
});


test('a retake prompt pins everything the note does not mention', () => {
  const out = applyFeedback('SHOT: presenter beside the car.', 'she should not point at the camera\nbrighten the sky');
  assert.ok(out.startsWith('SHOT: presenter beside the car.'), 'the original prompt is kept intact');
  assert.match(out, /1\. she should not point at the camera/);
  assert.match(out, /2\. brighten the sky/);
  assert.match(out, /same person|same car|same location/);
  // Bullet characters and numbering the reviewer types are stripped, not doubled.
  assert.ok(!applyFeedback('X', '- fix the sky').includes('1. - fix'));
  // No note means no retake block — an unchanged prompt, so nothing to re-read.
  assert.equal(applyFeedback('X', '   '), 'X');
});

test('a retake is billed only for the seconds it regenerates', () => {
  const full = estimateSegmentsCost(30, 4, { usdPerSecond: 0.15, usdToInr: 88 });
  const one = estimateSegmentsCost(7.5, 1, { usdPerSecond: 0.15, usdToInr: 88 });
  assert.equal(one.totalSeconds, 7.5);
  assert.equal(one.clipCount, 1);
  // Cost is linear in seconds, which is what lets the UI show the exact share.
  assert.equal(Math.round(full.inr / 4), one.inr);
  // A free restitch: no seconds, no calls, no spend, no confirmation gate.
  const none = estimateSegmentsCost(0, 0, { usdPerSecond: 0.15, usdToInr: 88 });
  assert.equal(none.inr, 0);
  assert.equal(none.needsConfirmation, false);
});


test('the pronunciation spelling is what the model is told to say', () => {
  const brief = base({ categories: ['offer'], narration: 'presenter', durationSec: 15, maxChunkSec: 15 });
  const overrides = {
    '0': {
      dialogue: 'अब Byte Premier Motors पर मिल रहे हैं शानदार फायदे।',
      phonetic: 'aur ab BAAIT pre-MEER MO-tarz par mil ra-HE hain sha-aan-DAAR FAA-y-de',
    },
  };
  const out = buildPrompt(brief, { sceneOverrides: overrides })!;
  const text = out.parts[0]!.text;

  // The respelling goes in the braces; the readable Devanagari stays out of the
  // prompt entirely, so the model can't perform the unstressed version.
  assert.match(text, /Says, word for word: \{aur ab BAAIT pre-MEER MO-tarz/);
  assert.ok(!text.includes('शानदार फायदे'), 'the readable line is for humans, not the model');

  // Hyphens and capitals are a pronunciation guide — the model must not voice
  // them as punctuation or burn them on screen as a caption.
  assert.match(text, /## SPOKEN LINES — SAY THESE EXACTLY/);
  assert.match(text, /hyphen splits syllables/i);
  assert.match(text, /Never render any of it as on-screen text/i);

  // With no respelling the readable line is still better than nothing.
  const fallback = buildPrompt(brief, { sceneOverrides: { '0': { dialogue: 'नमस्ते' } } })!;
  assert.match(fallback.parts[0]!.text, /Says, word for word: \{नमस्ते\}/);

  // And with nothing at all, the prompt says so rather than passing off the
  // stage direction as a line.
  assert.match(buildPrompt(brief)!.parts[0]!.text, /NO SCRIPT WAS WRITTEN/);
});

test('pre-flight separates "no line" from "line but no pronunciation"', () => {
  const brief = base({ categories: ['offer'], narration: 'presenter', durationSec: 15, maxChunkSec: 15 });
  const codes = (o: Record<string, { dialogue?: string; phonetic?: string }>) =>
    runChecks(brief, { sceneOverrides: o }).checks.map((c) => c.code);

  assert.ok(codes({}).includes('no-spoken-script'));
  // A model that publishes its speech languages and omits Hindi gets flagged;
  // one that publishes nothing never does.
  const withModel = (speechLanguages?: string[]) =>
    runChecks(brief, { model: { name: 'M', speechLanguages } }).checks.map((c) => c.code);
  assert.ok(withModel(['en', 'ja']).includes('speech-language-unsupported'));
  assert.ok(!withModel(undefined).includes('speech-language-unsupported'));
  assert.ok(!withModel(['en', 'hi']).includes('speech-language-unsupported'));
});


test('language rules drive the prompt, not hard-coded Hindi', () => {
  const hindi = LANGUAGE_SEEDS.find((l) => l.code === 'hi')!;
  const english = LANGUAGE_SEEDS.find((l) => l.code === 'en')!;
  const brief = (l: typeof hindi): Brief => ({
    ...base({ categories: ['offer'], narration: 'presenter', durationSec: 15, maxChunkSec: 15 }),
    language: { code: l.code, name: l.name, needsPhonetics: l.needsPhonetics, writtenGuide: l.writtenGuide },
  });
  const overrides = { '0': { dialogue: 'अब शानदार फायदे।', phonetic: 'ab sha-aan-DAAR FAA-y-de' } };

  const hi = buildPrompt(brief(hindi), { sceneOverrides: overrides })!.parts[0]!.text;
  const en = buildPrompt(brief(english), { sceneOverrides: overrides })!.parts[0]!.text;

  // The language names itself, and its on-screen rules travel with the prompt.
  assert.match(hi, /Spoken language: Hindi/);
  assert.match(en, /Spoken language: English/);
  assert.match(hi, /Hindi on-screen text rules/);
  assert.match(en, /English on-screen text rules/);

  // A language written the way it is said gets no respelling explainer, and
  // pre-flight never nags it for a pronunciation spelling it does not need.
  assert.match(hi, /HOW TO READ THE BRACES/);
  assert.ok(!en.includes('HOW TO READ THE BRACES'));
  // Every scene scripted but none respelled — the state that looks finished and
  // is not. It only surfaces once nothing is entirely unwritten.
  const sceneCount = buildPrompt(brief(hindi))!.scenePlan.scenes.length;
  const written = Object.fromEntries(
    Array.from({ length: sceneCount }, (_, i) => [String(i), { dialogue: 'a line, no respelling' }]),
  );
  const codes = (l: typeof hindi) =>
    runChecks(brief(l), { sceneOverrides: written }).checks.map((c) => c.code);
  assert.ok(codes(hindi).includes('no-pronunciation-spelling'));
  assert.ok(!codes(english).includes('no-pronunciation-spelling'));

  // The model-language warning follows the brief's language, not a fixed code.
  const speech = (l: typeof hindi, speechLanguages: string[]) =>
    runChecks(brief(l), { model: { name: 'M', speechLanguages } }).checks.map((c) => c.code);
  assert.ok(speech(hindi, ['en', 'ja']).includes('speech-language-unsupported'));
  assert.ok(!speech(english, ['en', 'ja']).includes('speech-language-unsupported'));
});
