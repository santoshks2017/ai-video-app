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
  overlayCards,
  sceneCard,
  composeBrief,
  emptyProject,
  colourName,
  renderResolution,
  priceFor,
  OMNI_FLASH_DEFAULTS,
  SEEDANCE_25_DEFAULTS,
  VEO_31_FAST_DEFAULTS,
  runChecks,
  estimateCost,
  buildBeats,
  buildContext,
  isPromptOnly,
  CATEGORY_BY_ID,
  categoryValues,
  fieldLabel,
  filenameFromLabel,
  dedupeFilenames,
  applyFeedback,
  estimateSegmentsCost,
  LANGUAGE_SEEDS,
  plainSpoken,
  applyBriefPlan,
  projectStage,
  PROJECT_STAGES,
  referencePlan,
  speechRate,
  DEFAULT_WPM,
  pacificDay,
  nextPacificMidnight,
  resetTimeLabel,
  isDailyQuotaError,
  requestsForRun,
  remainingLabel,
  OMNI_FLASH_LEGACY_DEFAULTS,
  VEO_31_LITE_DEFAULTS,
  DAILY_LIMITS,
  EDIT_MAIN_TRACK,
  EDIT_FILTERS,
  editFilterColour,
  editFilterFfmpeg,
  editFilterMatrices,
  spokenWords,
  campaignFacts,
  filterCampaigns,
  analyticsTotals,
  groupCampaigns,
  attemptsDistribution,
  modelReport,
  teamReport,
  presetRange,
  trendBuckets,
  parseRupees,
  revenueMissing,
  normalizeActorFill,
  actorSheetPrompt,
  actorFillPrompt,
  logoLayout,
  logosOn,
  type RunFact,
  newEditProject,
  addEditClip,
  removeEditClip,
  splitEditClip,
  updateEditClip,
  packEditTrack,
  trimEditClip,
  duplicateEditClip,
  editClipLength,
  editProjectLength,
  editTimecode,
  editSnap,
  validateEditProject,
  type EditProject,
  type EditSource,
  type CarModelProfile,
  type ActorProfile,
  type DealerPhoto,
  type ClientProfile,
  ageBandOf,
  usualActorFor,
  inOrder,
  planScenes,
  type BriefPlan,
  type CarModelProfile,
  type ActorProfile,
  type CategoryId,
  storyGuidance,
  adaptTrial,
  overlayCopy,
  suggestDuration,
  pacedDuration,
  sceneVisual,
  sceneEditFor,
  speakingSeconds,
  wordBudget,
  PART_TAIL_SILENCE,
  PART_HEAD_SILENCE,
  type Brief,
  type CarModelProfile,
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

test('on-screen text is composited, never handed to the video model', () => {
  const b = base({
    categories: ['offer'],
    narration: 'presenter',
    durationSec: 24,
    maxChunkSec: 30,
    fieldValues: { offer: { offer1: 'Rs 40,000 cash discount', offer2: 'Free 5-year service pack' } },
  });
  const res = buildPrompt(b)!;
  const text = res.parts.map((p) => `${p.text}\n${p.continuationText}`).join('\n');
  const cards = overlayCards(res.scenePlan);

  // Every card is still written — it just goes to post, not to the model.
  assert.ok(cards.length >= 2, 'offer brief should produce cards');
  assert.ok(cards.some((c) => c.text === 'Rs 40,000 cash discount'));
  assert.ok(cards.some((c) => c.text === 'Free 5-year service pack'));
  assert.doesNotMatch(text, /ON-SCREEN TEXT — EXACT STRINGS/);
  for (const c of cards) {
    assert.ok(!text.includes(c.text), `"${c.text}" leaked into the prompt`);
    if (c.sub) assert.ok(!text.includes(c.sub), `"${c.sub}" leaked into the prompt`);
  }

  // Timings are per-part and inside their part, because the parts are rendered
  // separately and crossfaded together afterwards.
  for (const c of cards) {
    assert.ok(c.part >= 1 && c.part <= res.parts.length, 'card names a real part');
    assert.ok(c.start >= 0 && c.end > c.start && c.end <= c.partSeconds + 0.05, 'card sits inside its part');
  }
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
  assert.match(text, /Leave the frame CLEAN/);
  assert.match(text, /no footer bar/);
  assert.match(text, /NO text of any kind anywhere/);
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
  assert.match(text, /Says, word for word: \{aur ab baait premeer motarz par mil rahe hain shaandaar faayde\}/);
  assert.ok(!text.includes('शानदार फायदे'), 'the readable line is for humans, not the model');

  // No stress capitals or syllable hyphens reach the model: it spelled capitals out
  // letter by letter. Only acronyms are said as letters.
  assert.match(text, /## SPOKEN LINES — SAY THESE EXACTLY/);
  assert.doesNotMatch(text, /hyphen splits syllables|CAPITALS mark the stressed syllable/i);
  assert.match(text, /Only acronyms are said letter by letter: EMI, SUV, ABS/);
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

  // The language names itself. Its ON-SCREEN rules deliberately do not travel
  // with the prompt any more: the model draws no text at all, so shipping it
  // typography rules is pure prompt weight.
  assert.match(hi, /Spoken language: Hindi/);
  assert.match(en, /Spoken language: English/);
  assert.doesNotMatch(hi, /Hindi on-screen text rules/);
  assert.doesNotMatch(en, /English on-screen text rules/);

  // A language written the way it is said gets no respelling explainer.
  assert.match(hi, /HOW TO READ THE BRACES/);
  assert.ok(!en.includes('HOW TO READ THE BRACES'));

  // There is one line now, and the model says it as written — so a scripted scene
  // is a finished scene in either language, and neither is nagged for a spelling.
  const sceneCount = buildPrompt(brief(hindi))!.scenePlan.scenes.length;
  const written = Object.fromEntries(
    Array.from({ length: sceneCount }, (_, i) => [String(i), { dialogue: 'a line, plainly written' }]),
  );
  const codes = (l: typeof hindi) =>
    runChecks(brief(l), { sceneOverrides: written }).checks.map((c) => c.code);
  for (const l of [hindi, english]) {
    assert.ok(!codes(l).includes('no-pronunciation-spelling'), 'the respelling nag is gone');
    assert.ok(codes(l).includes('script-written'));
  }

  // The model-language warning follows the brief's language, not a fixed code.
  const speech = (l: typeof hindi, speechLanguages: string[]) =>
    runChecks(brief(l), { model: { name: 'M', speechLanguages } }).checks.map((c) => c.code);
  assert.ok(speech(hindi, ['en', 'ja']).includes('speech-language-unsupported'));
  assert.ok(!speech(english, ['en', 'ja']).includes('speech-language-unsupported'));
});

test('a scene can name the reference image its shot is built on', () => {
  const b = base({ categories: ['offer'], narration: 'presenter', durationSec: 24, maxChunkSec: 10,
    fieldValues: { offer: { cashDiscount: 'Rs 40,000 Cash Discount' } } });
  b.attachments = [
    { label: 'Headlamp detail', filename: 'lamp.jpg', kind: 'car-model' },
    { label: 'Showroom facade', filename: 'showroom.jpg', kind: 'dealer' },
  ];
  const plain = buildPrompt(b)!;
  const all = (r: typeof plain) => r.parts.map((p) => `${p.text}\n${p.continuationText}`).join('\n');
  assert.doesNotMatch(all(plain), /Build this shot on/);

  // Pick a reference for the first scene AND for a scene in a later part, so
  // both the opening prompt and the continuation path are exercised.
  const lastIdx = plain.scenePlan.scenes.length - 1;
  assert.ok(plain.scenePlan.scenes[lastIdx]!.part > 0, 'brief should span more than one part');
  const picked = buildPrompt(b, { sceneOverrides: { '0': { ref: 'lamp.jpg' }, [String(lastIdx)]: { ref: 'showroom.jpg' } } })!;
  assert.match(picked.parts[0]!.text, /Build this shot on the supplied reference image lamp\.jpg \(Headlamp detail\)/);
  const later = picked.parts.find((p) => p.partNum === plain.scenePlan.scenes[lastIdx]!.part + 1)!;
  assert.match(later.continuationText, /showroom\.jpg \(Showroom facade\)/);

  // A name that is not one of the supplied files is ignored, not invented.
  const ghost = buildPrompt(b, { sceneOverrides: { '0': { ref: 'nope.jpg' } } })!;
  assert.doesNotMatch(all(ghost), /nope\.jpg/);
});

test('on-screen text edited in the storyboard is what gets composited', () => {
  const b = base({ categories: ['feature'], narration: 'presenter', durationSec: 20, maxChunkSec: 30,
    fieldValues: { feature: { feature1: '6 airbags' } } });
  const plain = buildPrompt(b)!;
  const hook = plain.scenePlan.scenes.findIndex((s) => s.beat.title === 'Desire hook');
  const feat = plain.scenePlan.scenes.findIndex((s) => s.beat.card === '6 airbags');
  assert.ok(hook >= 0 && feat >= 0);
  assert.equal(sceneCard(plain.scenePlan.scenes[hook]!.beat), null, 'the hook has no template caption');

  // Add a caption where there was none, and remove the template's one.
  const edits = { [String(hook)]: { card: 'Built for Pune roads' }, [String(feat)]: { card: '' } };
  const texts = overlayCards(plain.scenePlan, edits).map((c) => c.text);
  assert.ok(texts.includes('Built for Pune roads'));
  assert.ok(!texts.includes('6 airbags'));

  // The prompt's "leave room for a caption" note follows the edit, scene by scene.
  const blocks = buildPrompt(b, { sceneOverrides: edits })!.parts[0]!.text.split('### Scene ');
  const block = (title: string) => blocks.find((x) => x.split('\n')[0]!.includes(title)) ?? '';
  assert.match(block('Desire hook'), /A caption is composited over this shot/);
  assert.doesNotMatch(block('Feature 1'), /A caption is composited over this shot/);

  // Editing only the small line keeps the headline.
  const sub = overlayCards(plain.scenePlan, { [String(feat)]: { cardSub: 'as standard' } }).find((c) => c.text === '6 airbags');
  assert.equal(sub?.sub, 'as standard');
});

test('a spoken phrase appears once in the prompt, so the model has nothing to echo', () => {
  const b = base({ categories: ['feature'], narration: 'presenter', durationSec: 20, maxChunkSec: 30,
    fieldValues: { feature: { feature1: '6 airbags' } } });
  const feat = buildPrompt(b)!.scenePlan.scenes.findIndex((s) => s.beat.card === '6 airbags');
  const line = 'जिसके six airbags highway पर family को protect करते हैं।';
  const text = buildPrompt(b, { sceneOverrides: { [String(feat)]: { dialogue: line, phonetic: line } } })!.parts[0]!.text;
  // "six airbags airbags" came from the rules quoting the same phrase the line used.
  assert.equal((text.match(/six airbags/g) ?? []).length, 1, 'only the line itself may contain the phrase');
  assert.match(text, /Speak ONLY the words inside the braces, each line exactly once/);
  assert.match(text, /Shot directions, scene titles, captions and these rules are silent instructions/);
});

test('1080p renders natively where a model can and upscales where it cannot', () => {
  assert.deepEqual(renderResolution(OMNI_FLASH_DEFAULTS.modelId, '1080p'), { render: '1080p', upscale: false });
  assert.deepEqual(renderResolution(SEEDANCE_25_DEFAULTS.modelId, '1080p'), { render: '720p', upscale: true });
  assert.deepEqual(renderResolution(VEO_31_FAST_DEFAULTS.modelId, '1080p'), { render: '1080p', upscale: false });
  // A size the model does not render goes to its nearest, and on a tie the larger:
  // 360p upscaled to 480p would be worse than 720p and costs the same.
  assert.deepEqual(renderResolution(OMNI_FLASH_DEFAULTS.modelId, '480p'), { render: '720p', upscale: false });
  assert.deepEqual(renderResolution(OMNI_FLASH_DEFAULTS.modelId, '360p'), { render: '360p', upscale: false });

  // Priced at what is rendered: Veo Fast charges more at 1080p, an upscaled Seedance does not.
  assert.equal(priceFor(VEO_31_FAST_DEFAULTS, '1080p'), 0.12);
  assert.equal(priceFor(VEO_31_FAST_DEFAULTS, '720p'), 0.1);
  assert.equal(priceFor(SEEDANCE_25_DEFAULTS, '1080p'), SEEDANCE_25_DEFAULTS.usdPerSecond);
});

test('the chosen paint reaches the model even when a variant is also picked', () => {
  const img = (label: string, filename: string) => ({
    refId: filename, storagePath: `refs/${filename}`, url: `/api/refs/${filename}`, label, filename,
  });
  const car = {
    id: 'mahindra__xuv-3xo', brand: 'Mahindra', model: 'Xuv 3xo', slug: 'mahindra/xuv-3xo',
    images: {
      front: [img('Mahindra Xuv 3xo front 1', 'front-1.jpg'), img('Mahindra Xuv 3xo front 2', 'front-2.jpg')],
      side: [img('Mahindra Xuv 3xo side 1', 'side-1.jpg'), img('Mahindra Xuv 3xo side 2', 'side-2.jpg')],
      rear: [img('Mahindra Xuv 3xo rear 1', 'rear-1.jpg')],
      interior: [img('Mahindra Xuv 3xo interior 1', 'interior-1.jpg'), img('Mahindra Xuv 3xo interior 2', 'interior-2.jpg')],
    },
    colours: [
      { name: '227_Everest White', image: img('Mahindra Xuv 3xo — 227_Everest White', 'colour-227.jpg') },
      { name: '226_Stealth Black', image: img('Mahindra Xuv 3xo — 226_Stealth Black', 'colour-226.jpg') },
    ],
    // Synced variants carry no colour list of their own — the case that dropped the paint.
    variants: [{ name: 'AX5 Turbo', images: {}, colours: [] }],
  } as unknown as CarModelProfile;
  const project = {
    ...emptyProject(),
    useCases: ['walkaround'],
    carId: car.id,
    carIds: [car.id],
    carVariant: 'AX5 Turbo',
    carColour: '226_Stealth Black',
  };

  const brief = composeBrief(project as never, { car });
  assert.equal(brief.carColour, 'Stealth Black');
  const carRefs = brief.attachments.filter((a) => a.kind === 'car-model');
  // The colour image leads, then ONE photo per angle — not every yellow photo in the library.
  assert.deepEqual(carRefs.map((a) => a.filename), ['colour-226.jpg', 'front-1.jpg', 'side-1.jpg', 'rear-1.jpg', 'interior-1.jpg']);
  assert.match(carRefs[0]!.label, /^Colour reference — Stealth Black: paint the car exactly this colour$/);
  assert.ok(carRefs.slice(1).every((a) => /shape reference; its paint may differ$/.test(a.label)));

  const text = buildPrompt(brief)!.parts[0]!.text;
  assert.match(text, /Paint colour: Stealth Black\. The car is Stealth Black in every shot/);
  assert.doesNotMatch(text, /226_/);

  // No colour picked: every photo goes, and nothing tells the model a paint.
  const plain = composeBrief({ ...project, carColour: undefined } as never, { car });
  assert.equal(plain.carColour, undefined);
  assert.equal(plain.attachments.filter((a) => a.kind === 'car-model').length, 7);
  assert.doesNotMatch(buildPrompt(plain)!.parts[0]!.text, /Paint colour:/);

  assert.equal(colourName('226_Stealth Black'), 'Stealth Black');
  assert.equal(colourName('Atlas White with Titanium Black'), 'Atlas White with Titanium Black');
});

test('offers and features are repeatable rows — as many as the dealer has', () => {
  const offerList = ['Benefits up to ₹1.5 lakh', 'Free 5-year service pack', 'Exchange bonus ₹25,000'];
  const offers = base({
    categories: ['offer'], narration: 'presenter', durationSec: 30, maxChunkSec: 30,
    fieldValues: { offer: { offer1: offerList[0]!, offer2: offerList[1]!, offer3: offerList[2]! } },
  });
  const res = buildPrompt(offers)!;
  assert.deepEqual(res.scenePlan.scenes.map((s) => s.beat.title).filter((t) => t.startsWith('Offer ')), ['Offer 1', 'Offer 2', 'Offer 3']);
  const captions = overlayCards(res.scenePlan).map((c) => c.text);
  for (const o of offerList) assert.ok(captions.includes(o), `caption for "${o}"`);
  const prompt = res.parts.map((p) => `${p.text}\n${p.continuationText}`).join('\n');
  for (const o of offerList) assert.ok(!prompt.includes(o), `"${o}" stays out of the video prompt`);
  assert.ok(runChecks(offers).checks.every((c) => c.code !== 'missing-mandatory'));
  assert.ok(runChecks(base({ categories: ['offer'], fieldValues: { offer: {} } })).checks.some((c) => c.code === 'missing-mandatory'));

  const features = base({
    categories: ['feature'], narration: 'presenter', durationSec: 30, maxChunkSec: 30,
    fieldValues: { feature: { feature1: 'Sunroof', feature2: '26.03 cm touchscreen', feature3: '5-star safety rating', benefit3: 'your family is protected' } },
  });
  const fres = buildPrompt(features)!;
  assert.deepEqual(fres.scenePlan.scenes.map((s) => s.beat.title).filter((t) => t.startsWith('Feature ')), ['Feature 1', 'Feature 2', 'Feature 3']);
  // One feature is enough — the benefit line is optional now.
  assert.ok(runChecks(base({ categories: ['feature'], fieldValues: { feature: { feature1: 'Sunroof' } } })).checks.every((c) => c.code !== 'missing-mandatory'));
});

test('offers saved in the old fixed boxes open as free-text offers', () => {
  const legacy = { cashDiscount: 'Discount up to ₹1.15 Lacs*', warrantyYears: '7', warrantyKm: 'Unlimited', downPayment: '₹0' };
  const v = categoryValues('offer', legacy);
  assert.deepEqual([v.offer1, v.offer2, v.offer3], ['Discount up to ₹1.15 Lacs*', '7-year warranty, Unlimited km', '₹0 down payment']);
  // Once a free-text offer exists the old boxes are ignored, never merged in.
  assert.equal(categoryValues('offer', { ...legacy, offer1: 'New offer' }).offer2, undefined);

  const b = base({ categories: ['offer'], durationSec: 30, maxChunkSec: 30, fieldValues: { offer: legacy } });
  assert.ok(runChecks(b).checks.every((c) => c.code !== 'missing-mandatory'), 'an old project is not suddenly blocked');
  assert.ok(overlayCards(buildPrompt(b)!.scenePlan).some((c) => c.text === 'Discount up to ₹1.15 Lacs*'));

  assert.equal(fieldLabel(CATEGORY_BY_ID.offer, 'offer3'), 'Offer 3');
  assert.equal(fieldLabel(CATEGORY_BY_ID.feature, 'benefit2'), 'Why feature 2 matters');
  assert.equal(fieldLabel(CATEGORY_BY_ID.offer, 'offerRows'), 'offerRows');
});

test('two-wheelers are ridden: test ride in the CTA, the end card and the scenes', () => {
  const bike = base({
    vehicleKind: 'bike',
    categories: ['testdrive'],
    narration: 'presenter',
    cta: 'Book your test drive today',
    fieldValues: { testdrive: { location: 'the showroom' } },
  });
  const res = buildPrompt(bike)!;
  assert.equal(res.context.cta, 'Book your test ride today');
  const titles = res.scenePlan.scenes.map((s) => s.beat.title);
  assert.ok(titles.includes('The ride') && !titles.includes('The drive'), titles.join(' | '));
  for (const s of res.scenePlan.scenes) {
    assert.ok(!/test drive/i.test(`${s.beat.dialogue ?? ''} ${s.beat.card ?? ''} ${s.beat.shot}`), s.beat.title);
  }
  const lines = overlayCopy({ ...bike, endCardOn: true, endCard: 'Sahyadri Honda | Book your Test Drive now' }).endCardLines;
  assert.ok(lines.includes('Book your Test Ride now'), lines.join(' | '));
  // Cars keep driving.
  assert.equal(adaptTrial('Book your test drive today', 'car'), 'Book your test drive today');
  assert.equal(buildPrompt(base({ categories: ['testdrive'], fieldValues: { testdrive: { location: 'x' } } }))!.context.cta, 'Book your test drive today');
});

test('storyboard edits stay on their scene when another scene is deleted', () => {
  const b = base({
    categories: ['feature'],
    narration: 'presenter',
    durationSec: 40,
    maxChunkSec: 10,
    fieldValues: { feature: { feature1: 'Sunroof', feature2: '26.03 cm touchscreen', feature3: '6 airbags' } },
  });
  const plan = buildPrompt(b)!.scenePlan;
  const keys = plan.scenes.map((s) => s.beat.key);
  assert.ok(keys.includes('feature:feature-2') && keys.includes('feature:feature-3'), keys.join(' | '));
  assert.equal(new Set(keys).size, keys.length, 'every scene has its own key');

  const edits = { 'feature:feature-3': { card: 'Six airbags, standard' } };
  const res = buildPrompt({ ...b, omitScenes: ['feature:feature-2'] }, { sceneOverrides: edits })!;
  const titles = res.scenePlan.scenes.map((s) => s.beat.title);
  assert.ok(!titles.includes('Feature 2') && titles.includes('Feature 3'), titles.join(' | '));
  assert.ok(overlayCards(res.scenePlan, edits).some((c) => c.text === 'Six airbags, standard'), 'the edit stays on Feature 3');

  // Projects edited before scenes had keys are still read by position.
  assert.equal(sceneEditFor({ '0': { card: 'Old caption' } }, plan, plan.scenes[0]!)?.card, 'Old caption');
});

test('the app sizes the film, and pace speeds up the finished film rather than the model', () => {
  const b = base({
    categories: ['feature'],
    narration: 'presenter',
    maxChunkSec: 10,
    fieldValues: { feature: { feature1: 'Sunroof', feature2: 'Touchscreen', feature3: '6 airbags' } },
  });
  const auto = suggestDuration(b);
  const scenes = buildBeats(buildContext(b)).length;
  assert.ok(auto >= scenes * 4 && auto <= 90, `${auto}s for ${scenes} scenes`);
  assert.ok(suggestDuration({ ...b, omitScenes: ['feature:feature-2'] }) < auto, 'deleting a scene shortens the suggestion');
  assert.equal(pacedDuration(44, 1.1), 40);
  assert.equal(pacedDuration(44, 1), 44);

  const project = { ...emptyProject(), useCases: b.categories, fieldValues: b.fieldValues };
  project.spec = { ...project.spec, narration: 'presenter', durationAuto: true, pace: 1.3 };
  const composed = composeBrief(project);
  // Generated at a natural read; the pace speeds the finished film up afterwards.
  assert.equal(composed.durationSec, suggestDuration(composed));
  assert.equal(composed.pace, 1.3);

  const fast = buildPrompt({ ...b, durationSec: 44, pace: 1.5 })!;
  const natural = buildPrompt({ ...b, durationSec: 44, pace: 1 })!;
  assert.deepEqual(
    fast.scenePlan.scenes.map((s) => s.duration),
    natural.scenePlan.scenes.map((s) => s.duration),
    'the model gets the same room to speak at any pace',
  );
  assert.ok(!/faster than a relaxed read/.test(fast.parts.map((p) => p.text).join('\n')), 'the model is never asked to talk faster');
  assert.ok(wordBudget(5, 1.1) > wordBudget(5));
});

test('a part stops talking before its cut, and the model makes no music of its own', () => {
  const b = base({
    categories: ['feature'],
    narration: 'presenter',
    durationSec: 40,
    maxChunkSec: 10,
    fieldValues: { feature: { feature1: 'Sunroof', feature2: 'Touchscreen', feature3: '6 airbags' } },
  });
  const res = buildPrompt(b)!;
  const plan = res.scenePlan;
  assert.ok(plan.parts > 1);
  const first = plan.scenes.filter((s) => s.part === 0);
  const lastOfFirst = first[first.length - 1]!;
  assert.equal(speakingSeconds(plan, lastOfFirst), Math.max(1.5, Math.round((lastOfFirst.duration - PART_TAIL_SILENCE) * 10) / 10));
  const final = plan.scenes[plan.scenes.length - 1]!;
  assert.ok(
    speakingSeconds(plan, final) <= Math.max(1.5, final.duration - PART_TAIL_SILENCE + 0.05),
    'the film\'s last scene leaves a closing beat too — its last words were cut when it did not',
  );
  for (const p of res.parts.filter((x) => !x.isLast)) {
    assert.match(`${p.text}\n${p.continuationText ?? ''}`, /stop speaking and hold a natural silent beat/);
  }
  const all = res.parts.map((p) => `${p.text}\n${p.continuationText ?? ''}`).join('\n');
  assert.match(all, /No background music/);
  assert.ok(!/^Music:/m.test(all), 'one track goes under the whole film instead');
});

test('a shot is built on a photo of what it frames, or called out as generic — never force-fitted', () => {
  const front = { label: 'Front', filename: 'front.jpg', kind: 'car-model' as const, angle: 'front' as const };
  const cabin = { label: 'Dashboard', filename: 'cabin.jpg', kind: 'car-model' as const, angle: 'interior' as const };
  assert.deepEqual(sceneVisual('Macro of the touchscreen on the dashboard', undefined, [front]), { kind: 'generic', topic: 'interior' });
  assert.equal(sceneVisual('Macro of the touchscreen on the dashboard', undefined, [front, cabin]).kind, 'matched');
  assert.equal(sceneVisual('Presenter greets the viewer at the showroom door', undefined, [front]).kind, 'open');
  assert.equal(sceneVisual('Anything at all', 'front.jpg', [front, cabin]).kind, 'picked');
  assert.deepEqual(sceneVisual('Close on the handlebar and console', undefined, [front], 'bike'), {
    kind: 'generic',
    topic: 'handlebar and console',
  });

  const b = base({
    categories: ['feature'],
    narration: 'presenter',
    durationSec: 30,
    maxChunkSec: 30,
    attachments: [front],
    fieldValues: { feature: { feature1: 'Sunroof' } },
  });
  const scene = buildPrompt(b)!.scenePlan.scenes[0]!;
  const res = buildPrompt(b, { sceneOverrides: { [scene.beat.key!]: { shot: 'Slow push-in on the dashboard touchscreen' } } })!;
  assert.match(res.parts[0]!.text, /No supplied photo shows the interior/);
});

test('every part locks the presenter look, one voice, smooth presence and a real car', () => {
  const b = base({
    categories: ['feature'],
    narration: 'presenter',
    durationSec: 40,
    maxChunkSec: 10,
    fieldValues: { feature: { feature1: 'Sunroof', feature2: 'Touchscreen', feature3: '6 airbags' } },
  });
  b.actor = { ...b.actor, name: 'Meera', gender: 'female', style: 'maroon polo t-shirt, hair worn open' };
  const res = buildPrompt(b)!;
  assert.ok(res.parts.length > 1);
  const prompts = [res.parts[0]!.text, ...res.parts.slice(1).map((p) => p.continuationText ?? '')];
  for (const text of prompts) {
    assert.match(text, /CONTINUITY LOCK/);
    assert.match(text, /hair worn open stays open; never tied up/);
    assert.match(text, /ONE voice for the whole video: the same female voice/);
    assert.match(text, /no male voice/);
    assert.match(text, /never appears or disappears abruptly/);
    assert.match(text, /Never show it as a photo, poster/);
    assert.match(text, /Exactly ONE person in the whole video/);
    assert.match(text, /Never standing inside the cabin/);
    assert.match(text, /never a studio product shot/);
  }
  assert.match(res.parts[1]!.continuationText ?? '', /same female voice as the earlier parts, feminine verb forms/);
  const all = res.parts.map((p) => `${p.text}\n${p.continuationText ?? ''}`).join('\n');
  assert.ok(!/used as-is|exactly as provided/.test(all), 'no wording that invites pasting a reference photo into the scene');
});

test('several use cases make one ad: one opening, one close, the festival as the setting', () => {
  const b = base({
    categories: ['feature', 'festival', 'offer'],
    narration: 'presenter',
    durationSec: 60,
    maxChunkSec: 10,
    fieldValues: {
      feature: { feature1: 'Sunroof', feature2: '26.03 cm touchscreen' },
      festival: { occasionName: 'Diwali', festiveDressing: 'marigold garlands and diyas' },
      offer: { offer1: 'Benefits up to ₹1.5 lakh', offer2: 'Free 5-year service' },
    },
  });
  const res = buildPrompt(b)!;
  const beats = res.scenePlan.scenes.map((s) => s.beat);
  const titles = beats.map((x) => x.title);
  assert.equal(titles[0], 'Opening', titles.join(' | '));
  assert.equal(titles[titles.length - 1], 'Close', titles.join(' | '));
  assert.equal(beats.filter((x) => x.role === 'open').length, 1, 'one opening');
  assert.equal(beats.filter((x) => x.role === 'close').length, 1, 'one close');
  assert.ok(
    !titles.some((t) => /Occasion greeting|Warm closing wish|Attention hook|Desire hook|Emotional connection|Dealer tie-in/.test(t)),
    titles.join(' | '),
  );
  // What makes the car wanted comes first, then what makes now the moment to buy.
  const lastFeature = titles.reduce((a, t, i) => (t.startsWith('Feature') ? i : a), -1);
  const firstOffer = titles.findIndex((t) => t.startsWith('Offer'));
  assert.ok(lastFeature > 0 && firstOffer > lastFeature, titles.join(' | '));
  assert.equal(beats[0]!.card, 'Happy Diwali');
  // The festival is the look of every shot, not scenes of its own.
  for (const x of beats) assert.match(x.shot, /dressed for (Diwali|the occasion)/, x.title);
  const all = res.parts.map((p) => `${p.text}\n${p.continuationText ?? ''}`).join('\n');
  assert.match(all, /THEME — THE SETTING OF THE WHOLE FILM/);
  const story = storyGuidance(b);
  assert.match(story.useCase, /Product Feature \+ Offer \/ Deal, set during Diwali/);
  assert.ok(story.avoid.some((a) => /one after another/.test(a)));
  // A single use case still plays its own arc.
  assert.equal(buildPrompt(base({ categories: ['offer'], fieldValues: { offer: { offer1: 'x' } } }))!.scenePlan.scenes[0]!.beat.title, 'Attention hook');
});

test('spoken lines reach the model as plain words — no stress capitals, no syllable hyphens, no doubled words', () => {
  assert.equal(
    plainSpoken('AAJ hi Sahyadri Motors Pune में test drive book करें।', 'आज ही Sahyadri Motors Pune में test drive book करें।'),
    'aaj hi Sahyadri Motors Pune में test drive book करें।',
  );
  assert.equal(plainSpoken('seven lakh seventy nine thousand se sha-ROO, यानी आसान upgrade।'), 'seven lakh seventy nine thousand se shuru, यानी आसान upgrade।');
  assert.equal(plainSpoken('six airbags airbags aur ABS', 'छह airbags और ABS'), 'six airbags aur ABS');
  assert.equal(plainSpoken('XUV 3XO पर EMI', 'XUV 3XO पर EMI'), 'XUV 3XO पर EMI');
  assert.equal(plainSpoken('bahut bahut dhanyavaad', 'बहुत बहुत धन्यवाद'), 'bahut bahut dhanyavaad');
  assert.equal(plainSpoken('buk KEE-ji-ye'), 'book kijiye');
  // The seeded guide no longer teaches capitals or hyphens.
  const hindi = LANGUAGE_SEEDS.find((l) => l.code === 'hi')!;
  assert.ok(!/CAPS on the stressed syllable/.test(hindi.spokenGuide));
  for (const g of hindi.glossary) {
    assert.ok(!/[A-Z]{2,}/.test(g.say.replace(/\b(SUV|EV|EMI)\b/g, '')), g.say);
    assert.ok(!/[A-Za-z]-[A-Za-z]/.test(g.say), g.say);
  }
});

test('every part names the car and rules out an earlier generation of it', () => {
  const b = base({
    categories: ['feature'],
    narration: 'presenter',
    durationSec: 40,
    maxChunkSec: 10,
    modelSpecific: true,
    carModel: 'Mahindra XUV 3XO',
    fieldValues: { feature: { feature1: 'Sunroof', feature2: '6 airbags' } },
  });
  const res = buildPrompt(b)!;
  assert.ok(res.parts.length > 1);
  for (const text of [res.parts[0]!.text, ...res.parts.slice(1).map((p) => p.continuationText ?? '')]) {
    assert.match(text, /The car is the Mahindra XUV 3XO and nothing else/);
    assert.match(text, /Never an earlier generation/);
  }
});

test('a brief fills the blanks, checks what it is told, and never overwrites an answer', () => {
  const car: CarModelProfile = {
    id: 'x3xo',
    brand: 'Mahindra',
    model: 'XUV 3XO',
    slug: 'mahindra/xuv-3xo',
    images: {},
    colours: [{ name: 'Stealth Black' }, { name: 'Tango Red' }],
    variants: [],
    syncStatus: 'ok',
    createdAt: 0,
    updatedAt: 0,
  };
  const actor: ActorProfile = { id: 'meera', name: 'Meera', gender: 'female', createdAt: 0, updatedAt: 0 };
  const project = { ...emptyProject(), id: 'p1', prompt: 'Ganesh Chaturthi post inviting customers to buy a bike' };
  const plan: BriefPlan = {
    useCases: ['festival', 'offer', 'not-a-use-case' as CategoryId],
    fieldValues: {
      festival: { occasionName: 'Ganesh Chaturthi', occasionType: 'Not one of the options', festiveDressing: 'marigold garlands' },
      offer: { offer1: 'Festive benefits', nonsense: 'made up field' },
    },
    spec: { narration: 'presenter', aspect: '9:16', cta: 'Visit us this Ganesh Chaturthi', captionStyle: 'Short Punchy' },
    vehicle: { model: 'XUV 3XO', colour: 'Stealth Black' },
    actor: 'Meera',
    why: 'A festive invitation to the showroom.',
  };

  const patch = applyBriefPlan(project, plan, { cars: [car], actors: [actor] });
  assert.deepEqual(patch.useCases, ['festival', 'offer'], 'a use case the library does not have is dropped');
  assert.equal(patch.fieldValues?.festival?.occasionName, 'Ganesh Chaturthi');
  assert.equal(patch.fieldValues?.festival?.occasionType, undefined, 'a select only takes one of its own options');
  assert.equal(patch.fieldValues?.offer?.offer1, 'Festive benefits');
  assert.equal(patch.fieldValues?.offer?.nonsense, undefined, 'a field the use case does not have is dropped');
  assert.deepEqual(patch.carIds, ['x3xo']);
  assert.equal(patch.carColour, 'Stealth Black');
  assert.equal(patch.actorId, 'meera');
  assert.equal(patch.spec?.cta, 'Visit us this Ganesh Chaturthi');

  // What the designer has already answered stays as it is.
  const chosen = {
    ...project,
    useCases: ['feature'] as CategoryId[],
    carColour: 'Tango Red',
    carIds: ['x3xo'],
    spec: { ...project.spec, cta: 'Book now' },
  };
  const second = applyBriefPlan(chosen, plan, { cars: [car], actors: [actor] });
  assert.equal(second.useCases, undefined, 'use cases already picked are left alone');
  assert.equal(second.carColour, undefined);
  assert.equal((second.spec ?? chosen.spec).cta, 'Book now');

  // Asked for a fresh fill, it replaces them.
  const forced = applyBriefPlan(chosen, plan, { cars: [car], actors: [actor], force: true });
  assert.deepEqual(forced.useCases, ['festival', 'offer']);
  assert.equal(forced.carColour, 'Stealth Black');
  assert.equal(forced.spec?.cta, 'Visit us this Ganesh Chaturthi');
});

/* ---------------------------------------------------------------------------
 * The board: where a project stands, for projects that were never moved.
 * ------------------------------------------------------------------------ */

test('a project sits on the board where its history puts it', () => {
  assert.deepEqual(
    PROJECT_STAGES.map((s) => s.id),
    ['open', 'wip', 'review', 'delivered'],
    'the columns read left to right, the way the work moves',
  );

  const p = emptyProject();
  assert.equal(projectStage({ ...p, stage: undefined }), 'open', 'nothing has happened to it yet');
  assert.equal(projectStage({ ...p, stage: undefined, status: 'generating' }), 'wip');
  assert.equal(
    projectStage({ ...p, stage: undefined, status: 'generated' }),
    'review',
    'a film that exists is waiting on someone to watch it',
  );
  assert.equal(projectStage({ ...p, stage: undefined, status: 'draft', generationCount: 2 }), 'review');

  // Moved by hand, it stays where it was put.
  assert.equal(projectStage({ ...p, stage: 'delivered', status: 'generating' }), 'delivered');
  assert.equal(projectStage({ ...p, stage: 'open', status: 'generated', generationCount: 4 }), 'open');
});

/* ---------------------------------------------------------------------------
 * Reading a library of people.
 * ------------------------------------------------------------------------ */

test('an actor falls in the age band their age text implies', () => {
  assert.equal(ageBandOf({ ageBand: '46+', age: 'late 20s' }), '46+', 'a band chosen by hand wins');
  assert.equal(ageBandOf({ age: '24' }), '18–25');
  assert.equal(ageBandOf({ age: 'early 20s' }), '18–25');
  assert.equal(ageBandOf({ age: 'late 20s' }), '26–35');
  assert.equal(ageBandOf({ age: 'mid 30s' }), '26–35', 'mid thirties is 35');
  assert.equal(ageBandOf({ age: 'late 30s' }), '36–45');
  assert.equal(ageBandOf({ age: '52' }), '46+');
  assert.equal(ageBandOf({ age: 'young' }), undefined, 'no number, no band');
  assert.equal(ageBandOf({}), undefined);
});

test('a client has a usual actor, and ties go to the one seen last', () => {
  const p = (clientId: string, actorId: string, updatedAt: number) => ({ clientId, actorId, updatedAt });
  assert.equal(usualActorFor([], 'c1'), null);
  assert.equal(usualActorFor([p('c1', 'meera', 1)], undefined), null);

  const runs = [p('c1', 'meera', 3), p('c1', 'meera', 5), p('c1', 'riya', 9), p('c2', 'neha', 4)];
  const usual = usualActorFor(runs, 'c1');
  assert.deepEqual(usual, { actorId: 'meera', count: 2, total: 3 });

  const tied = usualActorFor([p('c1', 'meera', 3), p('c1', 'riya', 9)], 'c1');
  assert.equal(tied?.actorId, 'riya', 'the dealership was last seen with Riya');
});

/* ---------------------------------------------------------------------------
 * A storyboard the designer has rearranged.
 * ------------------------------------------------------------------------ */

test('scenes take the order they were put in, and new ones keep their place', () => {
  const beat = (key: string): Beat => ({ key, title: key, shot: `a shot of ${key}` });
  const film = [beat('a'), beat('b'), beat('c'), beat('d')];

  assert.deepEqual(inOrder(film, undefined).map((b) => b.key), ['a', 'b', 'c', 'd'], 'no order, no change');
  assert.deepEqual(inOrder(film, ['c', 'a', 'b', 'd']).map((b) => b.key), ['c', 'a', 'b', 'd']);

  // A use case picked after the film was arranged is not in the saved order.
  assert.deepEqual(
    inOrder([...film, beat('new')], ['c', 'a']).map((b) => b.key),
    ['c', 'a', 'b', 'd', 'new'],
    'what was placed comes first, the rest keep their natural order',
  );
});

test('moving a scene re-packs the parts to the model\u2019s clip cap', () => {
  const beat = (key: string): Beat => ({ key, title: key, shot: `a shot of ${key}`, dialogue: 'a line' });
  const beats = ['a', 'b', 'c', 'd', 'e', 'f'].map(beat);
  const plan = planScenes(beats, 36, 10, { speaks: true });

  // No part may run past the cap, and no scene is split across one.
  const byPart = new Map<number, number>();
  for (const sc of plan.scenes) byPart.set(sc.part, (byPart.get(sc.part) ?? 0) + sc.duration);
  for (const [, len] of byPart) assert.ok(len <= 10.05, `a part ran ${len}s, over the 10s cap`);
  assert.equal(plan.scenes.length, beats.length, 'nothing was dropped at this length');

  // The same beats in another order still respect the cap — the scenes that no
  // longer fit are pushed into the next part rather than overrunning.
  const moved = [beats[3]!, beats[0]!, beats[1]!, beats[2]!, beats[4]!, beats[5]!];
  const after = planScenes(moved, 36, 10, { speaks: true });
  const lens = new Map<number, number>();
  for (const sc of after.scenes) lens.set(sc.part, (lens.get(sc.part) ?? 0) + sc.duration);
  for (const [, len] of lens) assert.ok(len <= 10.05, `a part ran ${len}s after the move`);
  assert.deepEqual(after.scenes.map((s) => s.beat.key), ['d', 'a', 'b', 'c', 'e', 'f']);
});

/* ---------------------------------------------------------------------------
 * What the model is handed: the order, and what can be held back.
 * ------------------------------------------------------------------------ */

test('the vehicle, the presenter and the dealership each keep a slot', () => {
  const photo = (filename: string, kind: DealerPhoto['kind']): DealerPhoto => ({
    filename,
    label: filename,
    kind,
  });
  const brief = {
    attachments: [
      ...['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10'].map((f) => photo(f, 'car-model')),
      photo('actor', 'actor'),
      photo('place', 'dealer'),
      photo('logo', 'logo'),
      photo('clip', 'reference-video'),
    ],
  };

  const plan = referencePlan(brief, { max: 5 });
  const sentImages = plan.sent.filter((e) => e.role !== 'video').map((e) => e.photo.filename);
  assert.equal(sentImages.length, 5, 'the image budget is spent exactly');
  assert.ok(sentImages.includes('actor'), 'the presenter is never squeezed out by the car');
  assert.ok(sentImages.includes('place'), 'nor is the dealership');
  assert.deepEqual(sentImages, ['c1', 'c2', 'c3', 'actor', 'place'], 'the car fills what is left, best first');

  // Videos ride on their own allowance, and logos never reach the model at all.
  assert.deepEqual(plan.sent.filter((e) => e.role === 'video').map((e) => e.photo.filename), ['clip']);
  assert.deepEqual(plan.overlays.map((e) => e.photo.filename), ['logo']);
  assert.ok(
    plan.spare.some((e) => e.photo.filename === 'c4'),
    'what did not fit is listed rather than silently dropped',
  );
});

test('a reference held back is listed, not deleted', () => {
  const photo = (filename: string, kind: DealerPhoto['kind']): DealerPhoto => ({
    filename,
    label: filename,
    kind,
  });
  const brief = { attachments: [photo('front', 'car-model'), photo('rear', 'car-model')] };

  const plan = referencePlan(brief, { max: 10, held: ['front'] });
  assert.deepEqual(plan.sent.map((e) => e.photo.filename), ['rear'], 'the held one is not sent');
  const held = plan.spare.find((e) => e.photo.filename === 'front');
  assert.ok(held?.held, 'it is still on the list, marked held');
  assert.equal(held?.slot, null, 'and it has no slot');
});

test('a project holds a reference back without touching the library', () => {
  const client: ClientProfile = {
    id: 'cl1',
    name: 'Sahyadri Motors',
    brand: 'Mahindra',
    tier: 'Regional/Volume',
    photos: [
      { refId: 'r1', storagePath: 'p/1', filename: 'showroom-1.jpg', label: 'the forecourt', view: 'exterior' },
      { refId: 'r2', storagePath: 'p/2', filename: 'showroom-2.jpg', label: 'the lounge', view: 'lounge' },
    ],
    fictionalize: false,
    createdAt: 0,
    updatedAt: 0,
  };
  const project = { ...emptyProject(), id: 'p1', clientId: 'cl1', excludedRefs: ['showroom-2.jpg'] };

  const brief = composeBrief(project, { client });
  const names = brief.attachments.map((a) => a.filename);
  assert.ok(names.includes('showroom-1.jpg'));
  assert.ok(!names.includes('showroom-2.jpg'), 'held back, so it never reaches the model');
  assert.equal(client.photos.length, 2, 'and the client record is untouched');

  // Take the hold off and it comes back.
  const back = composeBrief({ ...project, excludedRefs: [] }, { client });
  assert.ok(back.attachments.map((a) => a.filename).includes('showroom-2.jpg'));
});

test('a skipped scene is out of the film, and what was written in it is kept', () => {
  const project = {
    ...emptyProject(),
    useCases: ['walkaround' as CategoryId],
    sceneEdits: {
      'walkaround:1': { dialogue: 'a line worth keeping', skipped: true },
      'walkaround:2': { dialogue: 'another' },
    },
  };
  const brief = composeBrief(project);
  assert.ok(brief.omitScenes?.includes('walkaround:1'), 'skipping takes the scene out of the film');
  assert.ok(!brief.omitScenes?.includes('walkaround:2'));
  assert.equal(
    project.sceneEdits['walkaround:1']?.dialogue,
    'a line worth keeping',
    'and leaves the writing alone',
  );
});

/* ---------------------------------------------------------------------------
 * How fast the film speaks, and what the prompt is allowed to say.
 * ------------------------------------------------------------------------ */

test('the speaking rate sets both the budget and the instruction', () => {
  assert.equal(speechRate(undefined).wpm, DEFAULT_WPM, 'no choice means the natural read');
  assert.equal(speechRate(168).label, 'Urgent', 'a stored number lands on the nearest named rate');

  // A faster read buys more words in the same seconds — that is the point of it.
  assert.ok(wordBudget(10, 1, 170) > wordBudget(10, 1, 110));
  assert.equal(wordBudget(60, 1, 120), 120, '120 words a minute is 120 words in a minute');

  const speaking = (wpm?: number): string => {
    const b: Brief = { ...base({ categories: ['offer'], narration: 'presenter', durationSec: 15, maxChunkSec: 15 }), speechWpm: wpm };
    return buildPrompt(b)!.parts[0]!.text;
  };
  assert.match(speaking(170), /170 words a minute/);
  assert.match(speaking(170), /high-energy/);
  assert.match(speaking(110), /unhurried, measured/);
  assert.doesNotMatch(speaking(170), /unhurried/, 'an urgent film is never told to take its time');
});

test('the prompt never spells out a mangled name for the model to copy', () => {
  const b = base({ categories: ['walkaround'], narration: 'presenter', durationSec: 24, maxChunkSec: 10 });
  b.carModel = 'Mahindra XUV 3XO';
  const every = buildPrompt(b)!.parts.map((p) => `${p.text}\n${p.continuationText}`).join('\n');

  // Naming a misspelling in the prompt is handing the model the misspelling.
  for (const bad of ['XUV 3OO', 'XUV300', 'Mahindri', 'Medton']) {
    assert.ok(!every.includes(bad), `the prompt still contains "${bad}"`);
  }
  // The rule itself survives: lettering only where the photographs show it.
  assert.match(every, /already moulded into the car in the supplied photographs/);
  assert.match(every, /Number plates stay blank/);
});

test('the car is named, not specified — the variant picks photos, not words', () => {
  const car: CarModelProfile = {
    id: 'c1',
    brand: 'Mahindra',
    model: 'XUV 3XO',
    slug: 'mahindra/xuv-3xo',
    images: {},
    colours: [],
    variants: [{ name: 'XUV 3XO AX7 L Turbo AT', colours: [] }],
    syncStatus: 'ok',
    createdAt: 0,
    updatedAt: 0,
  };
  const project = { ...emptyProject(), carId: 'c1', carIds: ['c1'], carVariant: 'XUV 3XO AX7 L Turbo AT' };
  const brief = composeBrief(project, { car });
  assert.equal(brief.carModel, 'Mahindra XUV 3XO', 'no repeated model, no trim, no gearbox');
});

test('a locked line is not up for rewriting', () => {
  const plan = buildPrompt(
    base({ categories: ['offer'], narration: 'presenter', durationSec: 24, maxChunkSec: 10 }),
  )!.scenePlan;
  const keys = plan.scenes.map((sc) => sc.beat.key!).filter(Boolean);
  assert.ok(keys.length >= 2);

  // What the editor stores when a line is typed by hand: the line, and the lock
  // that follows from having typed it.
  const edits: Record<string, { dialogue?: string; locked?: ('dialogue' | 'shot' | 'card')[] }> = {
    [keys[0]!]: { dialogue: 'a line that is exactly right', locked: ['dialogue'] },
    [keys[1]!]: { dialogue: 'a line that is not' },
  };
  const locked = (k: string): boolean => Boolean(edits[k]?.locked?.includes('dialogue'));
  assert.ok(locked(keys[0]!));
  assert.ok(!locked(keys[1]!), 'a line the writer produced stays open to a rewrite');

  // A lock is per field, so locking the line leaves the shot and the card free.
  assert.ok(!edits[keys[0]!]!.locked!.includes('shot'));
  assert.ok(!edits[keys[0]!]!.locked!.includes('card'));
});

test('a presenter-led film says who is in the shot', () => {
  const withMode = (narration: 'presenter' | 'voiceover'): Beat[] => {
    const b = base({ categories: ['feature'], narration, durationSec: 24, maxChunkSec: 10,
      fieldValues: { feature: { feature1: 'Panoramic sunroof' } } });
    b.actor = { ...b.actor, name: 'Meera', gender: 'female' };
    return buildBeats(buildContext(b));
  };

  // A product beat names nobody on paper, and a scene image drawn from it came
  // back as an empty showroom — which then seeded the video.
  const shots = withMode('presenter').map((x) => x.shot ?? '');
  assert.ok(shots.some((x) => /Meera/.test(x)), 'the presenter is placed in the shots');
  const macro = shots.find((x) => /macro/i.test(x));
  assert.ok(macro && /hand enters frame/.test(macro), 'a macro gets a hand, not a whole person');

  // A shot that already says who is there keeps its own words.
  const named = shots.find((x) => /presenter addressing camera/i.test(x));
  if (named) assert.ok(!named.includes('is in frame beside'), 'nothing is appended twice');

  // No one is on camera in a voiceover film, so nobody is written into the shots.
  assert.ok(!withMode('voiceover').some((x) => /Meera/.test(x.shot ?? '')));
});

test('nobody is written into a shot that cannot hold a person', () => {
  const b = base({ categories: ['ev'], narration: 'presenter', durationSec: 24, maxChunkSec: 10 });
  b.actor = { ...b.actor, name: 'Meera', gender: 'female' };
  const shots = buildBeats(buildContext(b)).map((x) => x.shot ?? '');

  // A car in motion, or a beauty pass, is not a shot with someone standing in it.
  const moving = shots.filter((x) => /glide-by|pull-away|beauty shot/i.test(x));
  assert.ok(moving.length, 'the EV use case has shots like these');
  for (const x of moving) assert.ok(!x.includes('is in frame beside'), `a presenter was forced into: ${x}`);

  // And turning the presenter off empties every shot of people.
  const none = buildBeats(buildContext({ ...b, useActor: false })).map((x) => x.shot ?? '');
  assert.ok(!none.some((x) => /Meera/.test(x)));
});

test('a film with nobody on camera sends no photograph of anyone', () => {
  const actor: ActorProfile = {
    id: 'a1',
    name: 'Meera',
    gender: 'female',
    photo: { refId: 'r9', storagePath: 'p/9', filename: 'meera.jpg', label: 'Meera' },
    createdAt: 0,
    updatedAt: 0,
  };
  const on = composeBrief({ ...emptyProject(), actorId: 'a1' }, { actor });
  assert.ok(on.attachments.some((a) => a.kind === 'actor'), 'the presenter travels by default');
  assert.equal(on.actor.name, 'Meera');

  const off = composeBrief({ ...emptyProject(), actorId: 'a1', useActor: false }, { actor });
  assert.ok(!off.attachments.some((a) => a.kind === 'actor'), 'and not at all when nobody is on camera');
  assert.notEqual(off.actor.name, 'Meera');
});

test('the card-length warning names the scene, and follows the edits', () => {
  const b = base({ categories: ['offer'], narration: 'presenter', durationSec: 30, maxChunkSec: 10,
    fieldValues: { offer: { cashDiscount: 'Rs 40,000 Cash Discount' } } });
  b.cta = 'Visit Sahyadri Motors in Pune for a test drive today';
  b.endCardOn = true;

  // A real card that is too long is worth a warning — but it has to say where it
  // is, or a string nobody can find on the board reads as a bug in the warning.
  const warn = runChecks(b).checks.find((c) => c.code === 'long-onscreen-string');
  assert.ok(warn, 'a 52-character card is flagged');
  assert.match(warn!.text, /scene \d+/, 'and the scene it is on is named');

  // Shortening it clears the warning — reading the beat alone never noticed.
  const plan = buildPrompt(b)!.scenePlan;
  const key = plan.scenes.find((sc) => sceneCard(sc.beat, undefined)?.text === b.cta)!.beat.key!;
  const short = { [key]: { card: 'Book a test drive' } };
  assert.ok(!runChecks(b, { sceneOverrides: short }).checks.some((c) => c.code === 'long-onscreen-string'));

  // The end card is a whole frame with its own lines, never a caption panel.
  assert.ok(!/end card/i.test(warn!.text));
});

/* ---------------------------------------------------------------------------
 * A model's day: when it turns, and what counts as running out of it.
 * ------------------------------------------------------------------------ */

test('the day turns at midnight Pacific, which is half past noon in India', () => {
  // 14 September, 2:30 PM in India — still the small hours of the 14th in California.
  const now = Date.UTC(2026, 8, 14, 9, 0, 0);
  assert.equal(pacificDay(now), '2026-09-14');
  const reset = nextPacificMidnight(now);
  assert.equal(new Date(reset).toISOString(), '2026-09-15T07:00:00.000Z', 'midnight PDT is 07:00 UTC');
  assert.equal(resetTimeLabel(reset), '12:30 PM IST');
});

test('a refusal is the day’s cap only when it says so, or reports the daily number', () => {
  // The refusal on screen, as Google wrote it.
  const real =
    'You exceeded your current quota, please check your plan and billing details. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_paid_tier_2_requests, limit: 100, model: gemini-omni-1.1-flash Please retry in 1.58s';
  assert.ok(isDailyQuotaError(real, 100), 'limit 100 on a model allowed 100 a day is the day’s cap');
  // The same wording with the per-minute number is the minute's cap, and worth a retry.
  assert.ok(!isDailyQuotaError(real.replace('limit: 100', 'limit: 8'), 100));
  // Named as a per-day quota, it is the day's cap whatever the numbers.
  assert.ok(isDailyQuotaError('Quota exceeded: GenerateRequestsPerDayPerProjectPerModel-PaidTier2'));
  // "Retry in 1.58s" is not evidence of anything.
  assert.ok(!isDailyQuotaError('Resource exhausted. Please retry in 1.58s'));
});

test('a film is a request per part, and up to two more on Google’s models', () => {
  assert.deepEqual(requestsForRun(5, 'gemini-omni-1.1-flash'), { base: 5, worst: 7 });
  assert.deepEqual(requestsForRun(4, 'veo-3.1-lite-generate-preview'), { base: 4, worst: 6 });
  assert.deepEqual(requestsForRun(1, 'dreamina-seedance-2-5-260628'), { base: 1, worst: 1 }, 'no vehicle check off Google');
  assert.equal(remainingLabel({ requests: 94, limit: 100, exhausted: false }, 0), '6 of 100 left today');
  assert.match(remainingLabel({ requests: 106, limit: 100, exhausted: true }, Date.UTC(2026, 8, 15, 7)), /used up · back at 12:30 PM IST/);
});

test('the earlier Omni and Veo 3.1 Lite ship with honest defaults', () => {
  assert.equal(OMNI_FLASH_LEGACY_DEFAULTS.modelId, 'gemini-omni-flash');
  assert.equal(OMNI_FLASH_LEGACY_DEFAULTS.isDefault, false, 'never takes over as the default');
  assert.equal(VEO_31_LITE_DEFAULTS.maxReferenceImages, 0, 'sends nothing it might refuse until it has been tried');
  assert.equal(DAILY_LIMITS['gemini-omni-1.1-flash'], 100);
  assert.equal(renderResolution('veo-3.1-lite-generate-preview', '360p').render, '720p');
});

/* ---------------------------------------------------------------------------
 * The video editor's timeline.
 * ------------------------------------------------------------------------ */

const film = (label: string, duration: number): EditSource => ({ type: 'video', label, url: `https://x/${label}.mp4`, duration, jobId: label });
const put = (p: EditProject, label: string, duration: number, start = 0) =>
  addEditClip(p, { trackId: EDIT_MAIN_TRACK, start, in: 0, out: duration, source: film(label, duration), speed: 1, volume: 1, fadeIn: 0, fadeOut: 0 }, { magnet: true });

test('the main track closes up behind a cut, and parts to let a clip in', () => {
  let p = newEditProject('9:16');
  p = put(p, 'a', 10).project;
  const b = put(p, 'b', 6, 99);
  p = b.project;
  assert.equal(p.clips.find((c) => c.id === b.id)?.start, 10, 'appended straight after the first, not at 99s');
  assert.equal(editProjectLength(p), 16);

  const first = p.clips.find((c) => c.source?.label === 'a')!;
  p = removeEditClip(p, first.id, { magnet: true });
  assert.equal(p.clips[0]?.start, 0, 'the gap closed');
  assert.equal(editProjectLength(p), 6);
});

test('splitting keeps every second, and a sliver is refused', () => {
  const r = put(newEditProject(), 'a', 10);
  const cut = splitEditClip(r.project, r.id, 4);
  const halves = cut.project.clips.sort((x, y) => x.start - y.start);
  assert.equal(halves.length, 2);
  assert.equal(editClipLength(halves[0]!), 4);
  assert.equal(editClipLength(halves[1]!), 6);
  assert.equal(halves[1]!.in, 4, 'the second half plays on from where the first stopped');
  assert.equal(splitEditClip(r.project, r.id, 0.05).project, r.project, 'too close to the edge');
});

test('speed changes a clip’s length, not what it plays', () => {
  const r = put(newEditProject(), 'a', 10);
  const fast = updateEditClip(r.project, r.id, { speed: 2 });
  assert.equal(editClipLength(fast.clips[0]!), 5);
  assert.equal(fast.clips[0]!.out - fast.clips[0]!.in, 10);
});

test('a transition overlaps its clip onto the one before, and the film is shorter by it', () => {
  let p = put(newEditProject(), 'a', 8).project;
  const b = put(p, 'b', 8);
  p = updateEditClip(b.project, b.id, { transition: { id: 'superposition', duration: 1 } });
  p = packEditTrack(p, EDIT_MAIN_TRACK);
  assert.equal(p.clips.find((c) => c.id === b.id)?.start, 7);
  assert.equal(editProjectLength(p), 15);
});

test('a video cannot be trimmed past what was recorded; a still can run as long as you like', () => {
  const r = put(newEditProject(), 'a', 10);
  const longer = trimEditClip(r.project, r.id, 'out', 25, { magnet: true });
  assert.equal(editClipLength(longer.clips[0]!), 10, 'held at the recording');

  const still = addEditClip(newEditProject(), { trackId: EDIT_MAIN_TRACK, start: 0, in: 0, out: 3, source: { type: 'image', label: 's', url: 'https://x/s.png' }, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0 }, { magnet: true });
  const stretched = trimEditClip(still.project, still.id, 'out', 9, { magnet: true });
  assert.equal(editClipLength(stretched.clips[0]!), 9);
});

test('duplicating inserts the copy straight after, and what followed moves along', () => {
  let p = put(newEditProject(), 'a', 5).project;
  p = put(p, 'b', 4).project;
  const a = p.clips.find((c) => c.source?.label === 'a')!;
  const d = duplicateEditClip(p, a.id, { magnet: true });
  const order = d.project.clips.sort((x, y) => x.start - y.start).map((c) => `${c.source?.label}@${c.start}`);
  assert.deepEqual(order, ['a@0', 'a@5', 'b@10']);
});

test('the timecode reads like the player, and an edge snaps to what is near it', () => {
  assert.equal(editTimecode(29.7), '00:00:29:70');
  assert.equal(editTimecode(3725.5), '01:02:05:50');
  assert.equal(editSnap(9.93, [0, 10, 20], 0.1), 10);
  assert.equal(editSnap(9.5, [0, 10, 20], 0.1), 9.5, 'nothing within reach, so it stays');
});

test('the server refuses an edit it cannot render', () => {
  assert.equal(validateEditProject(null), 'No edit was sent.');
  assert.match(String(validateEditProject({ ...newEditProject(), version: 2 })), /different version/);
  const ok = put(newEditProject(), 'a', 5).project;
  assert.equal(validateEditProject(ok), null);
  const broken = { ...ok, clips: [{ ...ok.clips[0]!, out: Number.NaN }] };
  assert.match(String(validateEditProject(broken)), /not a number/);
});

/* ---------------------------------------------------------------------------
 * The end of the film: the closing line has to finish inside the last clip.
 * ------------------------------------------------------------------------ */

test('every part is planned in whole seconds, because that is what the models render', () => {
  const beat = (key: string): Beat => ({ key, title: key, shot: `a shot of ${key}`, dialogue: 'a line' });
  for (const [total, beats] of [[42, 7], [36, 6], [23, 4], [30, 5]] as const) {
    const plan = planScenes(Array.from({ length: beats }, (_, i) => beat(`b${i}`)), total, 10, { speaks: true });
    for (let p = 0; p < plan.parts; p++) {
      const scenes = plan.scenes.filter((s) => s.part === p);
      const len = Math.round((scenes[scenes.length - 1]!.end - scenes[0]!.start) * 10) / 10;
      assert.ok(Number.isInteger(len), `a ${total}s film planned a ${len}s part`);
      assert.ok(len <= 10, `a ${total}s film planned a ${len}s part, over the cap`);
    }
  }
  const b = base({ categories: ['feature'], narration: 'presenter', durationSec: 42, maxChunkSec: 10, fieldValues: { feature: { feature1: 'Sunroof', feature2: 'Touchscreen', feature3: '6 airbags' } } });
  for (const part of buildPrompt(b)!.parts) assert.ok(Number.isInteger(part.duration), `the prompt asked for ${part.duration} seconds`);
});

test('a model code is counted the way it is said', () => {
  assert.equal(spokenWords('Mahindra XUV 3XO'), 7);
  assert.equal(spokenWords('गणेश चतुर्थी पर लाएं नई Mahindra XUV 3XO, तुरंत डिलीवरी और शानदार बेनेफिट्स के साथ!'), 19);
  assert.equal(spokenWords('अपनी बढ़ती family के लिए घर लाइये।'), 7);
  assert.equal(spokenWords(' — '), 0);
});

test('a closing line too long to finish before the film ends is flagged', () => {
  const b = base({ categories: ['feature'], narration: 'presenter', durationSec: 30, maxChunkSec: 10, fieldValues: { feature: { feature1: 'Sunroof', feature2: 'Touchscreen', feature3: '6 airbags' } } });
  const plan = buildPrompt(b)!.scenePlan;
  const final = plan.scenes[plan.scenes.length - 1]!;
  const key = final.beat.key!;
  const long = 'गणेश चतुर्थी पर लाएं नई Mahindra XUV 3XO, तुरंत डिलीवरी और शानदार बेनेफिट्स के साथ, आज ही showroom आइये!';
  const flagged = runChecks(b, { sceneOverrides: { [key]: { dialogue: long } } }).checks;
  assert.ok(flagged.some((c) => c.code === 'closing-line-cut'), 'the closing line was not flagged');
  assert.ok(!flagged.some((c) => c.code === 'line-spills-part' && c.text.includes(`scene ${plan.scenes.length}`)), 'flagged once, as the ending');
  const fine = runChecks(b, { sceneOverrides: { [key]: { dialogue: 'आज ही आइये।' } } }).checks;
  assert.ok(!fine.some((c) => c.code === 'closing-line-cut'));

  const res = buildPrompt(b)!;
  const last = res.parts[res.parts.length - 1]!;
  assert.match(`${last.text}\n${last.continuationText ?? ''}`, /about a second to spare/);
});

/* ---------------------------------------------------------------------------
 * Editor filters: visible, distinct, and the same in the preview and the export.
 * ------------------------------------------------------------------------ */

test('every filter is visible, unlike the others, and does nothing at zero strength', () => {
  const samples = [[0.78, 0.24, 0.16], [0.16, 0.47, 0.78], [0.5, 0.5, 0.5], [0.9, 0.82, 0.31], [0.2, 0.25, 0.22]];
  const graded = EDIT_FILTERS.map((f) => samples.map((c) => editFilterColour(f, 1, c)));
  EDIT_FILTERS.forEach((f, i) => {
    const moved = Math.max(...samples.flatMap((c, j) => c.map((v, k) => Math.abs(graded[i]![j]![k]! - v))));
    assert.ok(moved >= 0.08, `${f.name} moves no colour further than ${moved.toFixed(3)}`);
    for (const c of samples) {
      assert.deepEqual(editFilterColour(f, 0, c).map((v) => Math.round(v * 1e6) / 1e6), c, `${f.name} at zero strength`);
    }
    assert.equal(editFilterFfmpeg(f, 0), 'null');
    assert.match(editFilterFfmpeg(f, 1), /^format=gbrp(,(colorchannelmixer|colorlevels)=[a-z]+=-?[\d.]+(:[a-z]+=-?[\d.]+)*)+$/);
    const matrices = editFilterMatrices(f, 1);
    assert.equal(matrices.length, f.ops.length, 'one preview step per operation, as in the export');
    for (const m of matrices) assert.equal(m.split(' ').length, 20);
    EDIT_FILTERS.forEach((g, j) => {
      if (j <= i) return;
      const apart = Math.max(...samples.flatMap((_, s) => [0, 1, 2].map((k) => Math.abs(graded[i]![s]![k]! - graded[j]![s]![k]!))));
      assert.ok(apart >= 0.04, `${f.name} and ${g.name} look the same`);
    });
  });
});

/* ---------------------------------------------------------------------------
 * Analytics: what a campaign earned, what it cost to make, and how it went.
 * ------------------------------------------------------------------------ */

type AnalyticsProject = Parameters<typeof campaignFacts>[0][number];
type AnalyticsClient = Parameters<typeof campaignFacts>[1][number];

test('a campaign costs every attempt, failed ones included, and first time right means one attempt', () => {
  const at = new Date(2026, 8, 14, 12).getTime();
  const project = (id: string, extra: Partial<AnalyticsProject> = {}): AnalyticsProject =>
    ({ ...emptyProject(), id, name: id, clientId: 'c1', useCases: ['offer'], createdAt: at, updatedAt: at, ...extra }) as AnalyticsProject;
  const client = { id: 'c1', name: 'Sahyadri Motors Pvt Ltd', displayName: 'Sahyadri Motors', brand: 'Mahindra', city: 'Pune', state: 'Maharashtra', tier: 'Regional/Volume' } as AnalyticsClient;
  const run = (projectId: string, minute: number, status: RunFact['status'], costInr: number, extra: Partial<RunFact> = {}): RunFact => ({
    jobId: `${projectId}-${minute}`, projectId, createdAt: at + minute * 60_000, startedAt: at + minute * 60_000, finishedAt: at + (minute + 5) * 60_000,
    status, costInr, totalSeconds: 30, modelId: 'omni', modelName: 'Omni 1.1 Flash', userEmail: 'a@cardekho.com', userName: 'Asha', ...extra,
  });
  const rows = campaignFacts(
    [
      project('p1', { campaignRevenueInr: 30000 }),
      project('p2', { campaignRevenueInr: 20000 }),
      project('p3', { packType: 'trial' }),
      project('p4'),
    ],
    [client],
    [
      run('p1', 1, 'failed', 200),
      run('p1', 10, 'done', 600),
      run('p1', 30, 'done', 300, { kind: 'retake' }),
      run('p2', 1, 'done', 500, { approved: true }),
      run('p2', 20, 'done', 0, { kind: 'edit' }),
      run('p3', 1, 'done', 400),
    ],
  );
  const p1 = rows.find((c) => c.id === 'p1')!;
  assert.equal(p1.attempts, 3);
  assert.equal(p1.costInr, 1100);
  assert.equal(p1.reworkInr, 500, 'the failure and the retake, not the attempt that delivered');
  assert.equal(p1.firstTimeRight, false);
  assert.equal(p1.turnaroundMs, 14 * 60_000, 'from the first attempt starting to the first video finishing');
  const p2 = rows.find((c) => c.id === 'p2')!;
  assert.equal(p2.attempts, 1, 'an edit of a finished film is not an attempt');
  assert.ok(p2.firstTimeRight && p2.approved);
  assert.equal(p2.dealer, 'Sahyadri Motors');

  const paid = analyticsTotals(filterCampaigns(rows, { pack: 'paid' }));
  assert.equal(paid.campaigns, 3, 'the trial pack is left out');
  assert.equal(paid.revenueInr, 50000);
  assert.equal(paid.costInr, 1600);
  assert.equal(paid.marginInr, 48400);
  assert.equal(Math.round(paid.marginPct! * 10) / 10, 96.8);
  assert.equal(paid.attempts, 4);
  assert.equal(paid.ftrPct, 50);
  assert.equal(paid.missingRevenue, 1);
  assert.equal(paid.attemptsPerCampaign, 2);
  assert.equal(analyticsTotals(filterCampaigns(rows, { pack: 'all' })).costInr, 2000);

  const byState = groupCampaigns(filterCampaigns(rows, { pack: 'paid' }), 'state');
  assert.equal(byState.length, 1);
  assert.deepEqual(byState[0]!.totals, paid, 'a breakdown adds up to the total');
  assert.deepEqual(attemptsDistribution(filterCampaigns(rows, { pack: 'paid' })).map((b) => b.campaigns), [1, 1, 0, 1, 0]);

  const models = modelReport(filterCampaigns(rows, { pack: 'all' }));
  assert.equal(models.length, 1);
  assert.equal(models[0]!.runs, 5);
  const renamed = campaignFacts([project('p5')], [client], [run('p5', 1, 'done', 100, { modelId: 'models/omni-copy' }), run('p5', 9, 'done', 100)]);
  assert.equal(modelReport(renamed).length, 1, 'one model saved under two ids is one row');
  assert.equal(models[0]!.successPct, 80);
  const team = teamReport(filterCampaigns(rows, { pack: 'all' }));
  assert.equal(team[0]!.campaigns, 3);
  assert.equal(team[0]!.retakes, 1);

  const wednesday = new Date(2026, 8, 16, 15).getTime();
  const week = presetRange('week', wednesday);
  assert.equal(week.from, new Date(2026, 8, 14).getTime(), 'weeks start on Monday');
  assert.equal(week.to, new Date(2026, 8, 21).getTime());
  assert.deepEqual(presetRange('last-month', wednesday), { from: new Date(2026, 7, 1).getTime(), to: new Date(2026, 8, 1).getTime() });
  const days = trendBuckets(rows, 'day', week, wednesday);
  assert.equal(days.length, 3, 'Monday to today, and no further');
  assert.equal(days[0]!.totals.campaigns, 4);
});

test('a paid pack needs its revenue; a trial does not', () => {
  assert.equal(parseRupees('₹ 25,000'), 25000);
  assert.equal(parseRupees(''), undefined);
  assert.equal(parseRupees('a lot'), undefined);
  assert.equal(revenueMissing({}), true);
  assert.equal(revenueMissing({ campaignRevenueInr: 0 }), true);
  assert.equal(revenueMissing({ campaignRevenueInr: 18000 }), false);
  assert.equal(revenueMissing({ packType: 'trial' }), false);
});

/* ---------------------------------------------------------------------------
 * Actors from a description.
 * ------------------------------------------------------------------------ */

test('a filled-in profile keeps what fits and drops what does not', () => {
  const fill = normalizeActorFill({
    name: '  Riya ',
    gender: 'Woman',
    age: 'mid 20s',
    ageBand: '18-25',
    attire: 'Kurta',
    traits: 'upbeat, friendly, conversational, relatable, expressive, positive, warm',
    voice: 42,
    setting: 'a sunlit living room',
  });
  assert.equal(fill.name, 'Riya');
  assert.equal(fill.gender, 'female');
  assert.equal(fill.ageBand, '18–25');
  assert.deepEqual(fill.traits, ['Upbeat', 'Friendly', 'Conversational', 'Relatable', 'Expressive', 'Positive']);
  assert.ok(!('voice' in fill), 'a field that is not text is left out, not blanked');
  assert.equal(normalizeActorFill({ gender: 'robot', ageBand: '90s' }).gender, undefined);
  assert.deepEqual(normalizeActorFill('not json'), {});
  assert.match(actorFillPrompt('A warm Marathi woman in a saree', { name: 'Neha' }), /"name":"Neha"/);
});

test('the profile sheet letters only what it is given, and keeps a face only when asked', () => {
  const actor = {
    name: 'Meera — Metro Premium promoter',
    gender: 'female' as const,
    age: 'late 20s',
    attire: 'Maroon polo dress',
    voice: 'warm, energetic, confident ad pace',
    personality: 'Confident, friendly and "relatable".',
    traits: ['Confident', 'Friendly'],
  };
  const drawn = actorSheetPrompt(actor, { setting: 'a bright car showroom' });
  assert.match(drawn, /the name "Meera" in large bold type/);
  assert.match(drawn, /"Styling \/ look" — "Maroon polo dress"/);
  assert.match(drawn, /"Front View", "Left Profile", "Right Profile", "Back View"/);
  assert.match(drawn, /letter nothing else/);
  assert.ok(!/attached photograph/.test(drawn));
  assert.ok(!/""relatable""|"relatable"\./.test(drawn), 'quotes inside a line cannot end its quote early');
  assert.match(actorSheetPrompt(actor, { keepFace: true }), /the person in the attached photograph/);
  assert.match(actorSheetPrompt({ ...actor, gender: 'male', name: '' }), /Indian man/);
});

/* ---------------------------------------------------------------------------
 * Where the logos go.
 * ------------------------------------------------------------------------ */

test('each logo goes where the client wants it, and an unset client keeps the old corners', () => {
  assert.deepEqual(logoLayout(undefined), { brand: 'left', dealer: 'right' });
  const onlyDealerLeft = logoLayout({ dealer: 'left', brand: 'off' });
  assert.deepEqual(logosOn('left', onlyDealerLeft), ['dealer']);
  assert.deepEqual(logosOn('right', onlyDealerLeft), []);
  assert.deepEqual(logosOn('right', logoLayout({ dealer: 'right', brand: 'right' })), ['brand', 'dealer'], 'brand first, on either side');
  assert.deepEqual(logosOn('left', logoLayout({ brand: 'left' }), { brand: false, dealer: true }), [], 'a missing logo takes no place');

  const img = (name: string) => ({ refId: name, storagePath: `refs/${name}/${name}.png`, filename: `${name}.png`, label: name });
  const client = {
    id: 'c1', name: 'TC Motors', brand: 'Tata', tier: 'Regional/Volume', photos: [],
    logo: img('dealer'), brandLogo: img('brand'), logoPlacement: { dealer: 'left', brand: 'off' },
  } as unknown as Parameters<typeof composeBrief>[1] extends infer I ? I extends { client?: infer C } ? C : never : never;
  const brief = composeBrief({ ...emptyProject(), id: 'p1', useCases: ['offer'] } as Parameters<typeof composeBrief>[0], { client });
  assert.deepEqual(brief.logoPlacement, { dealer: 'left', brand: 'off' });
  const kinds = (brief.attachments ?? []).map((a) => a.kind);
  assert.ok(kinds.includes('logo'));
  assert.ok(!kinds.includes('brand-logo'), 'a logo switched off is not carried');
});
