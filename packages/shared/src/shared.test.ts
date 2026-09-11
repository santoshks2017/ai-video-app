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
  planScenes,
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

  // The language names itself. Its ON-SCREEN rules deliberately do not travel
  // with the prompt any more: the model draws no text at all, so shipping it
  // typography rules is pure prompt weight.
  assert.match(hi, /Spoken language: Hindi/);
  assert.match(en, /Spoken language: English/);
  assert.doesNotMatch(hi, /Hindi on-screen text rules/);
  assert.doesNotMatch(en, /English on-screen text rules/);

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
  // Asking for less than a model's smallest size never buys a bigger render.
  assert.deepEqual(renderResolution(OMNI_FLASH_DEFAULTS.modelId, '480p'), { render: '720p', upscale: false });

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
