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
  orderReferences,
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
  extractSiteSignals,
  tidyPhone,
  resolveLink,
  OVERLAY_THEMES,
  overlayTheme,
  contrast,
  CUSTOM_THEME_ID,
  pieceBounds,
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
  billedSeconds,
  renderCost,
  usageCostUsd,
  tokenRates,
  unassignedRuns,
  miscReport,
  type UsageFact,
  scriptOf,
  categoriesFor,
  sceneRules,
  chooseCaptionSpot,
  captionSpotXY,
  overlayMargins,
  CAPTION_SPOTS,
  boxesFrom1000,
  CATEGORIES,
  editProjectFromLayers,
  editSetEndCardSeconds,
  validateEditLayer,
  autoMusicGain,
  gainAt,
  dbAt,
  addGainPoint,
  moveGainPoint,
  removeGainPoint,
  editWithFilmMusicLine,
  editSoundLevel,
  MUSIC_DUCK_ATTACK,
  MUSIC_DUCK_RELEASE,
  MIN_MUSIC_PAUSE,
  GAIN_MAX_POINTS,
  type GainPoint,
  editClipEnd,
  editLayerGuides,
  editSnapBox,
  editCaptionSpots,
  EDIT_CAPTION_TRACK,
  EDIT_DEALER_LOGO_TRACK,
  EDIT_FOOTER_TRACK,
  EDIT_TEXT_TRACK,
  EDIT_AUDIO_TRACK,
  type FilmLayers,
  type EditClip,
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
  assert.equal(priceFor(OMNI_FLASH_DEFAULTS, '360p'), 0.034, 'a 360p draft costs a third of 720p');
  assert.equal(priceFor(OMNI_FLASH_DEFAULTS, '1080p'), 0.152);

  // Priced at what is rendered: Veo Fast charges more at 1080p, an upscaled Seedance does not.
  assert.equal(priceFor(VEO_31_FAST_DEFAULTS, '1080p'), 0.15);
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
  const project = { ...emptyProject(), id: 'p1', prompt: 'Ganesh Chaturthi post inviting customers to buy the XUV 3XO in Stealth Black' };
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

  // The vehicle, its variant and its paint come only from what the brief names.
  const trims: CarModelProfile = { ...car, variants: [{ name: 'AX7 L', images: {} }, { name: 'MX1', images: {} }] };
  const guess: BriefPlan = { ...plan, vehicle: { model: 'XUV 3XO', variant: 'AX7 L', colour: 'Tango Red' } };
  const vague = { ...emptyProject(), id: 'p2', prompt: 'Ganesh Chaturthi post inviting customers to the showroom' };
  const unnamed = applyBriefPlan(vague, guess, { cars: [trims], actors: [actor], force: true });
  assert.equal(unnamed.carIds, undefined, 'a car the brief never names is left for the designer');
  assert.equal(unnamed.carColour, undefined);
  const byCode = applyBriefPlan({ ...vague, prompt: 'Promote the Mahindra 3XO AX7 L at the showroom' }, guess, {
    cars: [trims],
    actors: [actor],
    force: true,
  });
  assert.deepEqual(byCode.carIds, ['x3xo'], 'a model named by its code is named');
  assert.equal(byCode.carVariant, 'AX7 L');
  assert.equal(byCode.carColour, undefined, 'a paint the brief never names is left for the designer');
  const otherBrand = applyBriefPlan({ ...vague, prompt: 'Promote the new Mahindra Thar' }, { ...plan, vehicle: { model: 'Mahindra Thar' } }, {
    cars: [trims],
    actors: [actor],
    force: true,
  });
  assert.equal(otherBrand.carIds, undefined, 'another car of the same brand does not stand in for one the library lacks');
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

test('a film with no colour chosen keeps the colour of the photographs', () => {
  const car = { id: 'renault__kiger', brand: 'Renault', model: 'Kiger', slug: 'renault/kiger', images: { front: [{ label: 'Kiger front', filename: 'kiger-front-1.jpg', storagePath: 'refs/x/kiger-front-1.jpg' }] }, colours: [], variants: [] } as unknown as CarModelProfile;
  const free = buildPrompt(composeBrief({ ...emptyProject(), useCases: ['walkaround'], carId: car.id, carIds: [car.id] } as never, { car }))!.parts[0]!.text;
  assert.match(free, /The paint is the colour the photographs show, in every shot and in every part/);
  assert.match(free, /Where a shot direction names a colour the photographs do not show, the photographs win\./);
  // A colour that was chosen is still the one that is painted.
  const picked = buildPrompt(
    composeBrief({ ...emptyProject(), useCases: ['walkaround'], carId: car.id, carIds: [car.id], carColour: 'Caspian Blue' } as never, { car }),
  )!.parts[0]!.text;
  assert.match(picked, /Paint colour: Caspian Blue/);
  assert.doesNotMatch(picked, /The paint is the colour the photographs show/, 'the chosen colour is not argued with');
  assert.match(picked, /only the paint changes/, 'and the rest of the car still comes from the photographs');
});

test('a film about one car sends that car: its face on its own, and the other models marked', () => {
  const img = (label: string, filename: string) => ({ label, filename, storagePath: `refs/x/${filename}`, refId: 'r', url: `/api/refs/r/${filename}` });
  const kiger = {
    id: 'renault__kiger', brand: 'Renault', model: 'Kiger', slug: 'renault/kiger',
    images: {
      front: [img('Renault Kiger front 1', 'kiger-front-1.jpg'), img('Renault Kiger front 2', 'kiger-front-2.jpg')],
      side: [img('Renault Kiger side 1', 'kiger-side-1.jpg')],
    },
    sheets: { front: img('Kiger front sheet', 'kiger-sheet-front.jpg'), side: img('Kiger side sheet', 'kiger-sheet-side.jpg') },
    colours: [],
    variants: [],
  } as unknown as CarModelProfile;
  const triber = { id: 'renault__triber', brand: 'Renault', model: 'Triber', slug: 'renault/triber', images: { front: [img('Renault Triber front', 'triber-front-1.jpg')] }, colours: [], variants: [] } as unknown as CarModelProfile;
  const kwid = { id: 'renault__kwid', brand: 'Renault', model: 'Kwid', slug: 'renault/kwid', images: { front: [img('Renault Kwid front', 'kwid-front-1.jpg')] }, colours: [], variants: [] } as unknown as CarModelProfile;
  const project = { ...emptyProject(), useCases: ['walkaround'], carId: kiger.id, carIds: [kiger.id, triber.id, kwid.id] };

  const brief = composeBrief(project as never, { car: kiger, vehicles: [kiger, triber, kwid] });
  const cars = brief.attachments.filter((a) => a.kind === 'car-model');
  assert.equal(cars[0]!.filename, 'kiger-front-1.jpg', 'the face goes first, on its own — a tile in a sheet is too small to read a badge');
  assert.match(cars[0]!.label, /the face, the grille, the maker's emblem and the lamp signature exactly as they are/);
  assert.deepEqual(cars.map((a) => a.filename), ['kiger-front-1.jpg', 'kiger-sheet-front.jpg', 'kiger-sheet-side.jpg', 'triber-front-1.jpg', 'kwid-front-1.jpg']);
  const others = cars.filter((a) => a.otherModel).map((a) => a.filename);
  assert.deepEqual(others, ['triber-front-1.jpg', 'kwid-front-1.jpg'], 'the other models travel marked');
  assert.match(cars.find((a) => a.otherModel)!.label, /It is not the car this film is about: take nothing about that car from this photograph\./);
  // And the rules say it, since the pictures alone were not enough.
  const text = buildPrompt(brief)!.parts[0]!.text;
  assert.match(text, /Photographs of other models may be attached/);
  assert.match(text, /THE PHOTOGRAPHS OUTRANK EVERY OTHER IMAGE/);
  assert.match(text, /maker's emblem on the grille, the tailgate, the wheels and the steering wheel is exactly the emblem in the photographs/);
  assert.match(text, /only the paint changes/);
});

test('another model in the range is never a reference for the vehicle the film is about', () => {
  const photo = (filename: string, over: Partial<DealerPhoto> = {}): DealerPhoto => ({ filename, label: filename, kind: 'car-model', ...over });
  const brief = {
    attachments: [
      photo('kiger-front'),
      photo('kiger-sheet-side', { sheet: true }),
      photo('triber-front', { otherModel: true }),
      photo('kwid-front', { otherModel: true }),
    ],
  };
  const plan = referencePlan(brief, { max: 10 });
  const vehicle = plan.sent.filter((e) => e.role === 'vehicle').map((e) => e.photo.filename);
  assert.deepEqual(vehicle, ['kiger-front', 'kiger-sheet-side'], 'only the film’s own vehicle fills the vehicle slots');
  const extras = plan.sent.filter((e) => e.role === 'extra').map((e) => e.photo.filename);
  assert.deepEqual(extras, ['triber-front', 'kwid-front'], 'the others are still sent, as what they are');
  const order = plan.sent.map((e) => e.photo.filename);
  assert.ok(order.indexOf('kiger-front') < order.indexOf('triber-front'), 'and they come after it');
});

test('the vehicle’s photograph leads every part, ahead of the frames a model drew', () => {
  const ref = (n: string) => ({ n });
  const order = orderReferences({
    seed: ref('seed'),
    frames: [ref('frame1'), ref('frame2'), ref('frame3')],
    car: [ref('car1'), ref('car2'), ref('car3')],
    actor: ref('actor'),
    place: ref('place'),
    rest: [ref('extra')],
    videos: [ref('clip')],
    max: 8,
  }).map((r) => r.n);
  assert.equal(order[0], 'car1', 'the photograph of the vehicle comes first — a drawn frame is not a record of it');
  assert.deepEqual(order.slice(0, 4), ['car1', 'seed', 'frame1', 'frame2'], 'then the frame it continues from, then the shots drawn for it');
  assert.ok(order.includes('actor') && order.includes('place'), 'the presenter and the dealership keep their slots');
  assert.equal(order.at(-1), 'clip', 'videos ride on their own allowance');
  // With no photograph of the vehicle, the frame it continues from still leads.
  const noCar = orderReferences({ seed: ref('seed'), frames: [ref('frame1')], car: [], rest: [], max: 5 }).map((r) => r.n);
  assert.deepEqual(noCar, ['seed', 'frame1']);
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
  assert.match(String(validateEditProject({ ...newEditProject(), version: 3 })), /different version/);
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

/* ---------------------------------------------------------------------------
 * A client's details from its own website.
 * ------------------------------------------------------------------------ */

test('a dealer page gives up its name, phones and logo without a browser', () => {
  const html = `<!doctype html><html><head><title>Sterling Hyundai | Jaipur</title>
    <meta property="og:site_name" content="Sterling Hyundai">
    <meta property="og:image" content="/banners/creta.jpg">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"AutoDealer","name":"Sterling Hyundai","telephone":"+91 98290 12345","logo":{"@type":"ImageObject","url":"https://cdn.example.com/sterling-logo.png"},"address":{"@type":"PostalAddress","streetAddress":"Tonk Road","addressLocality":"Jaipur","addressRegion":"Rajasthan"}}]}</script>
    <!--<script type="application/ld+json">{ broken</script>-->
    </head><body><header class="navbar"><a href="/"><img class="site-logo" src="/img/logo.svg" alt="Sterling Hyundai"></a></header>
    <img src="/img/google-play-logo.png" alt="Get it on Google Play">
    <a href="tel:09829012345">Call</a> <a href="tel:+91-98290-12345">Sales</a>
    <a href="/contact-us">Contact us</a><a href="https://elsewhere.com/contact">Partner</a>
    <p>Visit us &amp; test drive the Creta.</p><script>var x = 1;</script></body></html>`;
  const s = extractSiteSignals(html, 'https://www.sterlinghyundai.in/home');
  assert.equal(s.org?.name, 'Sterling Hyundai');
  assert.equal(s.org?.address, 'Tonk Road, Jaipur, Rajasthan');
  assert.equal(s.org?.state, 'Rajasthan');
  assert.equal(s.logos[0]?.url, 'https://cdn.example.com/sterling-logo.png', 'the business record’s own logo first');
  assert.ok(s.logos.some((l) => l.url === 'https://www.sterlinghyundai.in/img/logo.svg'));
  assert.ok(!s.logos.some((l) => /google-play/.test(l.url)), 'a store badge is not the dealer’s logo');
  assert.deepEqual(s.phones, ['09829012345', '+91-98290-12345']);
  assert.deepEqual(s.contactLinks, ['https://www.sterlinghyundai.in/contact-us'], 'only the site’s own contact page');
  assert.match(s.text, /Visit us & test drive the Creta\./);
  assert.ok(!/var x/.test(s.text));
  assert.equal(tidyPhone('9829012345'), '+91 98290 12345');
  assert.equal(tidyPhone('09829012345'), '09829012345', 'a leading 0 could as well be a landline');
  assert.equal(tidyPhone('+91-98290-12345'), '+91 98290 12345');
  assert.equal(tidyPhone('080 4275 3684'), '080 4275 3684', 'a landline is kept as written');
  assert.equal(resolveLink('img/a.png', 'https://x.in/cars/list.html'), 'https://x.in/cars/img/a.png');
  assert.equal(resolveLink('//cdn.x.in/a.png', 'https://x.in/'), 'https://cdn.x.in/a.png');
});

/* ---------------------------------------------------------------------------
 * The look of the words on a film, and where each caption sits.
 * ------------------------------------------------------------------------ */

test('every look keeps its words readable, and a custom look makes its own readable', () => {
  for (const t of OVERLAY_THEMES) {
    assert.ok(contrast(t.text, t.panel) >= 4.5, `${t.name}: caption text`);
    assert.ok(contrast(t.accent, t.panel) >= 3, `${t.name}: the caption's small line`);
    assert.ok(contrast(t.cardText, t.card) >= 4.5, `${t.name}: the end card's name`);
    assert.ok(contrast(t.accent, t.card) >= 3, `${t.name}: the call to action`);
    assert.ok(contrast(t.cardMuted, t.card) >= 4.5, `${t.name}: the contact lines`);
  }
  assert.equal(overlayTheme().id, 'midnight', 'unset is what every film had before');
  assert.equal(overlayTheme('long-gone').id, 'midnight');
  const pale = overlayTheme(CUSTOM_THEME_ID, { panel: '#fff5d6', accent: '#fff0b0' });
  assert.equal(pale.text, '#111827');
  assert.ok(contrast(pale.accent, pale.panel) >= 3, 'an accent too faint to read is pushed until it reads');
  assert.ok(contrast(pale.cardText, pale.card) >= 4.5);
  assert.equal(overlayTheme(CUSTOM_THEME_ID, { panel: 'not a colour' }).panel, '#0f1e33');
});

test('a scene’s caption placement reaches the render, and Auto leaves it to the render', () => {
  const b = base({ categories: ['feature'], narration: 'presenter', durationSec: 20, maxChunkSec: 10, fieldValues: { feature: { feature1: 'Sunroof', feature2: 'Touchscreen', feature3: '6 airbags' } } });
  const plan = buildPrompt(b)!.scenePlan;
  const [first, second, third] = plan.scenes;
  const cards = overlayCards(plan, {
    [first!.beat.key!]: { card: 'Panoramic sunroof', cardPos: 'top-right' },
    [second!.beat.key!]: { card: 'Ten-inch screen', cardPos: 'auto' },
    [third!.beat.key!]: { card: 'Six airbags', cardPos: 'sideways' as never },
  });
  assert.equal(cards.find((c) => c.text === 'Panoramic sunroof')?.position, 'top-right');
  assert.equal(cards.find((c) => c.text === 'Ten-inch screen')?.position, undefined);
  assert.equal(cards.find((c) => c.text === 'Six airbags')?.position, undefined, 'a place that does not exist is Auto');
  assert.equal(composeBrief({ ...emptyProject(), id: 'p', useCases: ['offer'], spec: { ...emptyProject().spec, overlayThemeId: 'emerald' } } as Parameters<typeof composeBrief>[0]).overlayTheme?.id, 'emerald');
});

/* ---------------------------------------------------------------------------
 * A long film through Seedance, in pieces that meet on the film's own cuts.
 * ------------------------------------------------------------------------ */

test('a long film is split on its own cuts, under the limit, with no scrap left over', () => {
  assert.deepEqual(pieceBounds(25, [6, 12], 29), [0, 25], 'short enough for one pass');
  assert.deepEqual(pieceBounds(42, [6.2, 16.1, 26.3, 36], 29), [0, 26.3, 42], 'the latest cut that fits');
  assert.deepEqual(pieceBounds(70, [], 29), [0, 24, 47, 70], 'no cuts: evenly, what is left shared out again');
  assert.deepEqual(pieceBounds(30, [28.8], 29), [0, 26, 30], 'never a piece shorter than the model takes');
  assert.deepEqual(pieceBounds(30, [], 14), [0, 10, 20, 30]);
  for (const b of [pieceBounds(88.4, [3, 9, 31, 33, 58, 61, 80], 29), pieceBounds(61, [1, 2, 59], 14)]) {
    const lengths = b.slice(1).map((x, i) => x - b[i]!);
    assert.ok(lengths.every((l) => l <= 29 + 1e-9 && l >= 4 - 1e-9), `pieces ${lengths.join(', ')}`);
  }
});

test('video is billed at the seconds a model renders, twice for a remake, with Omni input on top', () => {
  assert.equal(billedSeconds('veo-3.1-fast-generate-preview', 5, { resolution: '720p' }), 6, 'Veo renders 4, 6 or 8');
  assert.equal(billedSeconds('veo-3.1-fast-generate-preview', 5, { resolution: '720p', references: 2 }), 8, 'references force 8');
  assert.equal(billedSeconds('veo-3.1-generate-preview', 3, { resolution: '1080p' }), 8, '1080p forces 8');
  assert.equal(billedSeconds('dreamina-seedance-2-5-260628', 2.2), 4);
  assert.equal(billedSeconds('gemini-omni-1.1-flash', 5.2), 5);
  const c = renderCost(
    'gemini-omni-1.1-flash',
    0.034,
    [
      { seconds: 10, images: 2, promptChars: 4000 },
      { seconds: 5, remade: true },
    ],
    { resolution: '360p' },
  );
  assert.equal(c.seconds, 20);
  assert.equal(c.outputUsd, 0.68);
  assert.equal(c.inputUsd, 0.0049, '1,000 prompt tokens and two images at $1.50 a million');
  assert.equal(c.inr, 60);
  assert.equal(renderCost('veo-3.1-lite-generate-preview', 0.05, [{ seconds: 8, promptChars: 4000 }]).inputUsd, 0, 'Veo bills no input');
});

test('a Google call is costed from the tokens it reports, pictures at the picture rate', () => {
  const at = Date.UTC(2026, 8, 15);
  const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;
  assert.equal(r6(usageCostUsd('gemini-3.8-flash', { promptTokenCount: 10_000, candidatesTokenCount: 2_000 }, at)), 0.015);
  assert.equal(
    r6(usageCostUsd('gemini-3.8-flash', { promptTokenCount: 10_000, candidatesTokenCount: 2_000 }, Date.UTC(2027, 0, 2))),
    0.03,
    'the half price ends with 2026',
  );
  const drawn = usageCostUsd(
    'gemini-3.1-flash-image',
    { promptTokenCount: 1000, candidatesTokenCount: 1300, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1290 }] },
    at,
  );
  assert.equal(Math.round(drawn * 1e5) / 1e5, 0.07793);
  assert.equal(tokenRates('gemini-3.1-flash-lite-image').image, 30, 'the lite image model is not priced as the full one');
  assert.equal(tokenRates('gemini-2.5-pro').input, 1.25);
  assert.equal(tokenRates('gemini-9-mystery').listed, false);
});

test('money spent outside any campaign is counted by section, with videos that belong to no project', () => {
  const at = Date.UTC(2026, 8, 10);
  const runs: RunFact[] = [
    { jobId: 'a', projectId: 'p1', createdAt: at, status: 'done', costInr: 300 },
    { jobId: 'b', createdAt: at, status: 'done', costInr: 120 },
    { jobId: 'c', projectId: 'gone', createdAt: at + 10 * 86_400_000, status: 'failed', costInr: 80 },
  ];
  const loose = unassignedRuns([{ id: 'p1' }], runs);
  assert.deepEqual(loose.map((r) => r.jobId), ['b', 'c']);
  const usage: UsageFact[] = [
    { at, section: 'Script writing', costInr: 1.2 },
    { at, section: 'Script writing', costInr: 0.8 },
    { at, section: 'Storyboard drawings', costInr: 6.9 },
  ];
  const all = miscReport(usage, loose);
  assert.equal(all.totalInr, 208.9);
  assert.deepEqual(
    all.rows.map((r) => [r.label, r.calls]),
    [
      ['Videos not in a project', 2],
      ['Storyboard drawings', 1],
      ['Script writing', 2],
    ],
  );
  assert.equal(miscReport(usage, loose, { from: at, to: at + 86_400_000 }).totalInr, 128.9, 'the video ten days later is out of range');
});

test('every built-in language is a plain-spelled guide for the respelling pass, in its own script', () => {
  const codes = LANGUAGE_SEEDS.map((l) => l.code);
  assert.equal(new Set(codes).size, codes.length, 'one seed per language');
  for (const code of ['hi', 'en', 'bn', 'kn', 'ml', 'mr', 'pa', 'ta', 'te']) assert.ok(codes.includes(code), code);
  for (const l of LANGUAGE_SEEDS) {
    assert.ok(!/CAPS on the stressed syllable/.test(l.spokenGuide), `${l.name} still teaches stress capitals`);
    assert.ok(l.writtenGuide.trim().length > 0, `${l.name} has on-screen rules`);
    if (l.code !== 'en') assert.equal(l.needsPhonetics, true, `${l.name} goes through the respelling pass`);
    for (const g of l.glossary) {
      assert.ok(!/[A-Z]{2,}/.test(g.say.replace(/\b(SUV|EV|EMI)\b/g, '')), `${l.name}: ${g.say}`);
      assert.ok(!/[A-Za-z]-[A-Za-z]/.test(g.say), `${l.name}: ${g.say}`);
    }
  }
  assert.equal(scriptOf('ta'), 'Tamil script');
  assert.equal(scriptOf('mr'), 'Devanagari');
  assert.equal(scriptOf(undefined), 'Devanagari', 'a project with no language speaks Hindi');
});

test('a manufacturer picks from its own use cases, and its films sign off with the marque', () => {
  const dealerIds = categoriesFor('dealer').map((c) => c.id);
  const oemIds = categoriesFor('oem').map((c) => c.id);
  assert.ok(dealerIds.includes('walkaround') && !dealerIds.includes('oemlaunch'), 'a dealership sees its own');
  assert.ok(oemIds.includes('oemlaunch') && !oemIds.includes('walkaround'), 'a manufacturer sees its own');
  assert.ok(dealerIds.includes('festival') && oemIds.includes('festival'), 'a festival serves both');
  assert.equal(new Set([...dealerIds, ...oemIds]).size, CATEGORIES.length, 'every use case belongs to somebody');

  const brief: Brief = {
    ...base({ categories: ['oemproduct'], narration: 'presenter', durationSec: 20, maxChunkSec: 10 }),
  };
  brief.dealer = {
    ...brief.dealer,
    kind: 'oem',
    dealerName: 'Hyundai',
    tagline: 'Beyond Mobility',
    website: 'hyundai.co.in',
    address: '',
    phone: '',
  };
  const copy = overlayCopy(brief);
  assert.equal(copy.footerText, 'Hyundai  ·  Beyond Mobility  ·  hyundai.co.in', 'the marque, its line and its site');
  assert.deepEqual(copy.endCardLines, ['Hyundai', 'Beyond Mobility', 'hyundai.co.in']);

  const text = buildPrompt(brief)!.parts[0]!.text;
  assert.match(text, /automotive brand film/, 'it is a brand film, not a dealership video');
  assert.match(text, /Manufacturer: Hyundai/);
  assert.doesNotMatch(text, /Dealership: /);
});

test('a mandatory field that counts rows says which list it counts', () => {
  // Two OEM use cases shipped with `mandatory: [{ id: 'offer' }]` against a list field,
  // so runChecks looked up a key the form never writes and the use case could never be
  // generated. Every category is checked here, not just the two.
  for (const c of CATEGORIES) {
    for (const m of c.mandatory) {
      const listed = m.list ? c.fields.find((f) => f.id === m.list) : null;
      if (m.list) {
        assert.equal(listed?.type, 'list', `${c.id}: mandatory ${m.id} counts rows of ${m.list}, which is not a list field`);
        continue;
      }
      const named = c.fields.find((f) => f.id === m.id);
      assert.ok(named, `${c.id}: mandatory ${m.id} is not one of its fields`);
      assert.notEqual(named?.type, 'list', `${c.id}: mandatory ${m.id} is a list field, so it needs list: '${m.id}'`);
    }
  }
});

test('every use case a manufacturer can pick can actually be generated', () => {
  for (const c of categoriesFor('oem')) {
    const values: Record<string, string> = {};
    for (const f of c.fields) {
      if (f.type === 'list' && f.list) {
        for (let i = 1; i <= Math.max(1, f.list.min); i++) values[`${f.id}${i}`] = `${f.list.noun} ${i}`;
        values[`${f.id}Rows`] = String(Math.max(1, f.list.min));
        if (f.list.sub) values[`${f.list.sub.id}1`] = 'on the range';
      } else if (f.type === 'select') values[f.id] = f.options?.[0] ?? '';
      else values[f.id] = `${f.label}, filled in`;
    }
    const b = base({ categories: [c.id], fieldValues: { [c.id]: values } });
    b.dealer = { ...b.dealer, kind: 'oem', dealerName: 'Hyundai', segment: 'mass' };
    const r = runChecks(b);
    const blocking = r.checks.filter((x) => x.level === 'bad').map((x) => x.code);
    assert.deepEqual(blocking, [], `${c.id} cannot be generated with every field filled: ${blocking.join(', ')}`);
  }
});

test("a house style is the marque's own, and never follows a record back to a dealership", () => {
  const oem = base({ categories: ['oemproduct'], fieldValues: { oemproduct: { promise: 'space for the family', proof1: 'a sunroof', proof2: 'six airbags', proof3: '600 km', proofRows: '3', setting: 'a coastal highway' } } });
  oem.dealer = { ...oem.dealer, kind: 'oem', dealerName: 'Hyundai', segment: 'mass', styleNote: 'golden hour, never a price on screen' };
  const oemText = buildPrompt(oem)!.parts[0]!.text;
  assert.match(oemText, /House style, taken from the brand's own films/);
  assert.match(oemText, /Cinematic brand film/, 'the manufacturer look, not the showroom default');
  assert.doesNotMatch(oemText, /dealership-ad feel/);
  assert.doesNotMatch(oemText, /Metro Premium dealer/, 'a marque has no dealer tier');

  // The same note on a record switched back to Dealership is inert.
  const dealer = base({});
  dealer.dealer = { ...dealer.dealer, styleNote: 'golden hour, never a price on screen' };
  assert.doesNotMatch(buildPrompt(dealer)!.parts[0]!.text, /House style/);
});

test('a number plate is a plain white plate with nothing on it, in everything a film is made from', () => {
  // Press photographs carry the model's name on the plate, and the model copied it —
  // or, told only that plates are blank, left the plate off.
  for (const vehicleKind of ['car', 'bike'] as const) {
    const b = base({ categories: ['walkaround'], narration: 'presenter', durationSec: 24, maxChunkSec: 10 });
    b.carModel = 'Renault Kiger';
    b.vehicleKind = vehicleKind;
    const built = buildPrompt(b)!;
    for (const part of built.parts) {
      for (const text of [part.text, part.continuationText].filter((x): x is string => Boolean(x))) {
        assert.match(text, /NUMBER PLATES ARE PLAIN WHITE AND BLANK/, `${vehicleKind} part ${part.partNum} lost the plate rule`);
        assert.doesNotMatch(text, /a price board, a number plate, a screen/, 'a plate may never be sent out of focus or out of frame');
        assert.match(text, /plain white plate with nothing on it/);
      }
    }
    assert.match(built.parts[1]!.continuationText ?? built.parts[1]!.text, /every number plate is a plain white plate with nothing on it/i);
    // A scene still is the video's first reference, so it is drawn to the same rule.
    assert.match(sceneRules(b).join('\n'), /NUMBER PLATES ARE PLAIN WHITE AND BLANK/);
  }
});

test('an Auto caption never lands on a face, however calm the face is', () => {
  // A presenter talking to camera barely moves, so her face scored as the calmest place
  // in the shot and a festival greeting was drawn across it.
  const at = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
  const candidates = [
    { spot: 'bottom-left', score: 30, rect: at(0.03, 0.62, 0.5, 0.78) },
    { spot: 'bottom-right', score: 28, rect: at(0.5, 0.62, 0.97, 0.78) },
    { spot: 'top-left', score: 26, rect: at(0.03, 0.16, 0.5, 0.31) },
    { spot: 'top-right', score: 4, rect: at(0.48, 0.16, 0.97, 0.31) },
  ];
  assert.equal(chooseCaptionSpot(candidates, null), 'top-right', 'knowing nothing of people, placement is what it always was');

  const presenter = { faces: [at(0.44, 0.2, 0.58, 0.42)], bodies: [at(0.36, 0.2, 0.66, 1)] };
  const chosen = chooseCaptionSpot(candidates, presenter);
  assert.notEqual(chosen, 'top-right', 'the calmest place is her face');
  assert.notEqual(chosen, 'top-left', 'nor the place that comes within a margin of it');
  assert.equal(chosen, 'bottom-left');

  // Nowhere is clear of a face: the place touching least is taken.
  assert.equal(chooseCaptionSpot(candidates, { faces: [at(0, 0.1, 1, 0.7)], bodies: [] }), 'bottom-right');
  // Nobody in the shot: exactly the old rule.
  assert.equal(chooseCaptionSpot(candidates, { faces: [], bodies: [] }), 'top-right');
  assert.equal(chooseCaptionSpot([], presenter), undefined);
});

test('boxes a vision model returns are read as fractions of the frame, and nonsense is dropped', () => {
  assert.deepEqual(boxesFrom1000([[200, 440, 420, 580]]), [{ x0: 0.44, y0: 0.2, x1: 0.58, y1: 0.42 }]);
  assert.deepEqual(boxesFrom1000([[0, 0, 0, 0], 'x', [100, 900, 50, 950], [1, 2, 3]]), []);
  assert.deepEqual(boxesFrom1000([[-50, 100, 1200, 300]]), [{ x0: 0.1, y0: 0, x1: 0.3, y1: 1 }], 'clamped to the frame');
  assert.deepEqual(boxesFrom1000(undefined), []);
});

test('a caption spot is the same place for the compositor and the editor', () => {
  assert.deepEqual(overlayMargins(720, 1280), { margin: 29, logoBand: 61 });
  assert.deepEqual([...CAPTION_SPOTS], ['bottom-left', 'bottom-right', 'top-left', 'top-right', 'middle-left', 'middle-right', 'bottom-center']);
  assert.deepEqual(captionSpotXY('bottom-left', 720, 1280, 300, 100, 29, 60, 61), { x: 29, y: 1091 });
  assert.deepEqual(captionSpotXY('top-right', 720, 1280, 300, 100, 29, 60, 61), { x: 391, y: 119 });
  assert.deepEqual(captionSpotXY('middle-left', 720, 1280, 300, 100, 29, 60, 61), { x: 29, y: 590 });
  assert.deepEqual(captionSpotXY('bottom-center', 720, 1280, 300, 100, 29, 60, 61), { x: 210, y: 1091 });
});

const FILM: FilmLayers = {
  version: 1, width: 720, height: 1280, fps: 30, speed: 1.2, targetShortSide: 720, bodySeconds: 8.6,
  colours: { panel: '#0f172a', text: '#ffffff', accent: '#38bdf8', card: '#0f172a', cardText: '#ffffff', cardMuted: '#cbd5e1' },
  captionHeadSize: 42,
  captions: [{ id: 'cap-0', text: 'Happy Ganesh Chaturthi', from: 0.9, to: 3.4, x: 29, y: 1091, w: 420, h: 100, spot: 'bottom-left', auto: true }],
  footer: { text: 'Garve Renault  ·  Pune', x: 0, y: 1220, w: 720, h: 60 },
  logos: [{ which: 'dealer', x: 540, y: 29, w: 151, h: 61, colourPath: 'refs/a/logo.png', whitePath: 'refs/b/white.png', whiteOnEndCard: true }],
  endCard: { lines: ['Garve Renault', 'Book your test drive today'], seconds: 3 },
  music: { storagePath: 'refs/c/music.m4a', loudness: -20, duckDb: -12 },
};
const layered = () =>
  editProjectFromLayers({
    aspect: '9:16',
    layers: FILM,
    clean: { type: 'video', label: 'Film', url: 'https://x/clean.mp4', duration: 8.6, jobId: 'j1', variant: 'clean' },
    music: { type: 'audio', label: 'Music', url: 'https://x/music.m4a', duration: 14, storagePath: 'refs/c/music.m4a' },
  });

test('a composed film opens as clean footage with its overlays as layers', () => {
  const p = layered();
  assert.equal(p.version, 2);
  assert.deepEqual(p.tracks.map((t) => t.id), [EDIT_CAPTION_TRACK, EDIT_DEALER_LOGO_TRACK, EDIT_FOOTER_TRACK, EDIT_TEXT_TRACK, EDIT_MAIN_TRACK, EDIT_AUDIO_TRACK], 'no brand logo row without a brand logo');
  const byId = new Map(p.clips.map((c) => [c.id, c]));
  assert.equal(byId.get('clean')?.out, 8.6);
  assert.equal(byId.get('endcard')?.start, 8.6);
  assert.equal(byId.get('endcard')?.fadeIn, 0.35);
  const cap = byId.get('cap-0')!;
  assert.equal(cap.start, 0.9);
  assert.ok(Math.abs(editClipLength(cap) - 2.5) < 1e-9);
  assert.deepEqual(cap.place, { x: 29 / 720, y: 1091 / 1280, scale: 1 });
  assert.equal(cap.fadeIn, 0.28);
  assert.equal(byId.get('logo-dealer')?.out, 11.6, 'a logo runs through the end card');
  assert.deepEqual(byId.get('footer')?.place, { x: 0, y: 1220 / 1280, scale: 1 });
  assert.deepEqual(byId.get('music')?.bed, { loudness: -20, duckDb: -12 });
  assert.deepEqual(cap.original?.place, cap.place, 'Reset has something to go back to');
  assert.equal(validateEditProject(p), null);
});

test('a layered edit is checked before any work', () => {
  const p = layered();
  const withCaption = (patch: Partial<EditClip>) => ({ ...p, clips: p.clips.map((c) => (c.id === 'cap-0' ? { ...c, ...patch } : c)) });
  assert.match(String(validateEditProject(withCaption({ layer: { kind: 'caption', text: '' } }))), /needs words/);
  assert.match(String(validateEditProject(withCaption({ place: { x: 0.1, y: 0.1, scale: 9 } }))), /position or size/);
  assert.match(String(validateEditProject({ ...p, look: undefined })), /frame or look/);
  assert.match(
    String(validateEditProject(withCaption({ layer: { kind: 'logo', which: 'dealer', colourPath: '../etc/passwd', whiteOnEndCard: false, w: 10, h: 10 } }))),
    /no image/,
  );
  assert.match(String(validateEditProject({ ...p, version: 3 })), /different version/);
  assert.match(String(validateEditProject({ ...p, look: { ...p.look!, width: 4096, height: 4096 } })), /impossible frame size/, 'no frame larger than a film');
  const sevenLines = { kind: 'endcard' as const, lines: ['Garve Renault', 'Book your test drive today', 'Plot 12, MIDC', 'Bhosari', 'Pune 411026', '97643 79764', 'garverenault.com'] };
  assert.equal(validateEditLayer(sevenLines), null, 'an end card with every line the project gave it');
});

test('a dragged layer catches on the centre line and the safe margin', () => {
  const look = { colours: FILM.colours, width: 720, height: 1280 };
  const r = editSnapBox({ x: 0.26, y: 0.3 }, { w: 0.5, h: 0.1 }, editLayerGuides(look), { x: 0.02, y: 0.02 });
  assert.ok(Math.abs(r.x - 0.25) < 1e-9, 'its centre caught the centre line');
  assert.equal(r.caught.x, 0.5);
  assert.equal(r.y, 0.3, 'nothing within reach vertically');
  assert.deepEqual(
    editCaptionSpots(look, { w: 300, h: 100 }, 60).find((s) => s.spot === 'bottom-left'),
    { spot: 'bottom-left', x: 29 / 720, y: 1091 / 1280 },
  );
});

test('a longer end card carries the logos, footer and music to the new end', () => {
  const p = editSetEndCardSeconds(layered(), 'endcard', 5);
  const byId = new Map(p.clips.map((c) => [c.id, c]));
  assert.ok(Math.abs(editClipEnd(byId.get('endcard')!) - 13.6) < 1e-9);
  assert.ok(Math.abs(editClipEnd(byId.get('logo-dealer')!) - 13.6) < 1e-9);
  assert.ok(Math.abs(editClipEnd(byId.get('footer')!) - 13.6) < 1e-9);
  assert.ok(Math.abs(editClipEnd(byId.get('music')!) - 13.6) < 1e-9);
  assert.ok(Math.abs(editClipEnd(byId.get('cap-0')!) - 3.4) < 1e-9, 'a caption that ended earlier is left alone');
  assert.equal(editClipLength(editSetEndCardSeconds(layered(), 'endcard', 30).clips.find((c) => c.id === 'endcard')!), 8, 'held to eight seconds');
});

/*
 * The film's music: the dips composeFinal applies, written the way apps/api/src/post.ts
 * writes them (withEndCardDuck, then duckVolume's ramps), so the line the editor starts
 * from is held to the film's own sound rather than to a copy of the same arithmetic.
 */
function filmDuck(speech: Array<[number, number]>, duckDb: number, bodySeconds: number, cardSeconds: number): (t: number) => number {
  let spans = speech.map(([a, b]): [number, number] => [a, b]);
  const filmSeconds = bodySeconds + cardSeconds;
  if (spans.length && cardSeconds > 0) {
    const from = Math.max(0, filmSeconds - cardSeconds - MUSIC_DUCK_ATTACK);
    const last = spans[spans.length - 1]!;
    if (from - last[1] < MIN_MUSIC_PAUSE) last[1] = filmSeconds;
    else spans = [...spans, [from, filmSeconds]];
  }
  const depth = 1 - Math.pow(10, duckDb / 20);
  const clip = (v: number) => Math.max(0, Math.min(1, v));
  return (t) =>
    1 - depth * clip(spans.reduce((sum, [a, b]) => sum + clip(Math.min((t - (a - MUSIC_DUCK_ATTACK)) / MUSIC_DUCK_ATTACK, (b + MUSIC_DUCK_RELEASE - t) / MUSIC_DUCK_RELEASE)), 0));
}
const spansOf = (pairs: Array<[number, number]>) => pairs.map(([from, to]) => ({ from, to }));
function worstGap(points: GainPoint[], film: (t: number) => number, until: number): number {
  let worst = 0;
  for (let t = 0; t <= until; t += 0.01) worst = Math.max(worst, Math.abs(gainAt(points, t) - film(t)));
  return worst;
}

test("the music's first key points dip it exactly where the film dipped it", () => {
  const apart: Array<[number, number]> = [[1, 3], [5.2, 7]];
  const line = autoMusicGain(spansOf(apart), -12, 10, true);
  assert.ok(worstGap(line, filmDuck(apart, -12, 10, 3), 13) < 1e-3, 'two lines and the end card, each with its own dip');
  assert.deepEqual(line.slice(0, 4), [{ t: 0.7, db: 0 }, { t: 1, db: -12 }, { t: 3, db: -12 }, { t: 3.8, db: 0 }]);
  assert.deepEqual(line.at(-1), { t: 9.7, db: -12 }, 'down into the end card, and held there');

  const early: Array<[number, number]> = [[0.1, 3], [4.5, 8.5]];
  const merged = autoMusicGain(spansOf(early), -12, 9.5, true);
  assert.ok(worstGap(merged, filmDuck(early, -12, 9.5, 3), 12.5) < 1e-3, 'a line that starts at once, and one that runs into the end card');
  assert.equal(merged[0]!.t, 0, 'the line starts at the film, part-way down its dip');
  assert.ok(merged[0]!.db < 0 && merged[0]!.db > -12);
  assert.deepEqual(merged.at(-1), { t: 4.5, db: -12 }, 'the last line and the end card are one dip');

  const noCard: Array<[number, number]> = [[2, 4]];
  assert.ok(worstGap(autoMusicGain(spansOf(noCard), -12, 8, false), filmDuck(noCard, -12, 8, 0), 8) < 1e-3, 'without an end card the music comes back up');
  assert.deepEqual(autoMusicGain(spansOf(noCard), 0, 8, true), [], 'a film that never dipped its music has a level line');
  assert.deepEqual(autoMusicGain([], -12, 8, true), [], 'and so does one nobody speaks in');
});

test('a volume line holds past its ends and moves in a straight line between points', () => {
  const line: GainPoint[] = [{ t: 1, db: 0 }, { t: 2, db: -12 }, { t: 2, db: -6 }];
  assert.equal(gainAt([], 5), 1);
  assert.equal(gainAt(line, 0), 1);
  assert.ok(Math.abs(gainAt(line, 1.5) - (1 + Math.pow(10, -12 / 20)) / 2) < 1e-12, 'halfway in amplitude');
  assert.ok(Math.abs(dbAt(line, 9) - -6) < 1e-9, 'the later of two points at one moment wins, and holds');
});

test('key points are added on the line, dragged between their neighbours, and removed', () => {
  const line: GainPoint[] = [{ t: 1, db: 0 }, { t: 3, db: -12 }];
  const added = addGainPoint(line, 2);
  assert.equal(added.index, 1);
  assert.ok(Math.abs(dbAt(added.points, 2) - dbAt(line, 2)) < 0.01, 'adding a point does not change what plays');
  const moved = moveGainPoint(added.points, 1, 5, -99);
  assert.deepEqual(moved[1], { t: 3, db: -40 }, 'held before the next point and above the floor');
  assert.deepEqual(removeGainPoint(moved, 1), [{ t: 1, db: 0 }, { t: 3, db: -12 }]);
  const full = Array.from({ length: GAIN_MAX_POINTS }, (_, i) => ({ t: i, db: 0 }));
  assert.equal(addGainPoint(full, 3.5).index, -1, 'a full line takes no more');
});

test("the film's music opens with its dips as key points, and a volume line is checked before any work", () => {
  const speech = spansOf([[0.9, 3.2], [5, 7.4]]);
  const p = editProjectFromLayers({
    aspect: '9:16',
    layers: { ...FILM, music: { ...FILM.music!, speech, measured: -14 } },
    clean: { type: 'video', label: 'Film', url: 'https://x/clean.mp4', duration: 8.6, jobId: 'j1', variant: 'clean' },
    music: { type: 'audio', label: 'Music', url: 'https://x/music.m4a', duration: 14, storagePath: 'refs/c/music.m4a' },
  });
  const music = p.clips.find((c) => c.id === 'music')!;
  assert.deepEqual(music.gain, autoMusicGain(speech, -12, 8.6, true));
  assert.deepEqual(music.original?.gain, music.gain, 'Back to automatic has something to go back to');
  assert.deepEqual(music.bed, { loudness: -20, duckDb: -12, measured: -14 });
  assert.deepEqual([music.fadeIn, music.fadeOut], [0.8, 1.5], 'fading in and out as the film did, on sliders that work');
  assert.equal(validateEditProject(p), null);
  assert.equal(layered().clips.find((c) => c.id === 'music')!.gain, undefined, 'no line when the film dipped its music but never kept where its voice is');
  const level = editProjectFromLayers({
    aspect: '9:16',
    layers: { ...FILM, music: { ...FILM.music!, duckDb: 0 } },
    clean: { type: 'video', label: 'Film', url: 'https://x/clean.mp4', duration: 8.6, jobId: 'j1', variant: 'clean' },
    music: { type: 'audio', label: 'Music', url: 'https://x/music.m4a', duration: 14, storagePath: 'refs/c/music.m4a' },
  }).clips.find((c) => c.id === 'music')!;
  assert.deepEqual(level.gain, [], 'music that never dipped opens with a level line, ready for key points');

  const withMusic = (patch: Partial<EditClip>) => ({ ...p, clips: p.clips.map((c) => (c.id === 'music' ? { ...c, ...patch } : c)) });
  assert.match(String(validateEditProject(withMusic({ gain: [{ t: 2, db: 0 }, { t: 1, db: 0 }] }))), /out of order/);
  assert.match(String(validateEditProject(withMusic({ gain: [{ t: 1, db: -80 }] }))), /lower than -40 dB/);
  assert.match(String(validateEditProject(withMusic({ gain: [{ t: Number.NaN, db: 0 }] }))), /cannot be read/);
  assert.match(String(validateEditProject(withMusic({ gain: Array.from({ length: GAIN_MAX_POINTS + 1 }, (_, i) => ({ t: i, db: 0 })) }))), /more than/);
  const clean = p.clips.find((c) => c.id === 'clean')!;
  assert.match(String(validateEditProject({ ...p, clips: p.clips.map((c) => (c.id === clean.id ? { ...c, gain: [] } : c)) })), /Only a sound clip/);
});

test('an edit saved before volume lines gets the film’s dips, on the music’s own timeline', () => {
  const speech = spansOf([[0.9, 3.2]]);
  const film = { ...FILM, music: { ...FILM.music!, speech, measured: -14 } };
  const saved = layered();
  const moved = { ...saved, clips: saved.clips.map((c) => (c.id === 'music' ? { ...c, start: 1, in: 0.5 } : c)) };
  const up = editWithFilmMusicLine(moved, film).clips.find((c) => c.id === 'music')!;
  const onFilm = autoMusicGain(speech, -12, 8.6, true);
  assert.deepEqual(up.gain, onFilm.map((pt) => ({ t: Math.round((pt.t - 0.5) * 1000) / 1000, db: pt.db })), 'shifted from the film onto the music');
  assert.equal(up.bed?.measured, -14);
  const lined = { ...saved, clips: saved.clips.map((c) => (c.id === 'music' ? { ...c, gain: [{ t: 1, db: -3 }] } : c)) };
  assert.equal(editWithFilmMusicLine(lined, film), lined, 'a line someone already has is theirs');
});

test('the preview plays a sound at the level export gives it', () => {
  const bed: EditClip = {
    id: 'm', trackId: 'a1', start: 2, in: 0, out: 10, speed: 1, volume: 1, fadeIn: 0.8, fadeOut: 1.5,
    source: { type: 'audio', label: 'Music', url: '', duration: 10 },
    bed: { loudness: -20, duckDb: -12, measured: -14 },
    gain: [{ t: 4, db: 0 }, { t: 5, db: -12 }],
  };
  const levelled = Math.pow(10, -6 / 20);
  assert.ok(Math.abs(editSoundLevel(bed, 2 + 3) - levelled) < 1e-9, 'levelled from -14 to -20 LUFS, before the dip');
  assert.ok(Math.abs(editSoundLevel(bed, 2 + 6) - levelled * Math.pow(10, -12 / 20)) < 1e-9, 'and down 12 dB after it');
  assert.ok(Math.abs(editSoundLevel(bed, 2 + 0.4) - levelled * 0.5) < 1e-9, 'fading in over its first 0.8 s');
  assert.ok(Math.abs(editSoundLevel(bed, 2 + 9.25) - levelled * Math.pow(10, -12 / 20) * 0.5) < 1e-9, 'and out over its last 1.5 s');
  const longer: EditClip = { ...bed, fadeIn: 2 };
  assert.ok(Math.abs(editSoundLevel(longer, 2 + 1) - levelled * 0.5) < 1e-9, "the film's music fades as its own sliders say");
  const legacy: EditClip = { ...bed, gain: undefined, fadeIn: 0, fadeOut: 0 };
  assert.ok(Math.abs(editSoundLevel(legacy, 2 + 0.4) - levelled * 0.5) < 1e-9, 'music from an edit made before lines fades the way export fades it');
  const sound: EditClip = { ...bed, bed: undefined, gain: undefined, volume: 0.5, fadeIn: 1, fadeOut: 0 };
  assert.ok(Math.abs(editSoundLevel(sound, 2.5) - 0.25) < 1e-9, "any other sound: its volume and its own fades");
});
