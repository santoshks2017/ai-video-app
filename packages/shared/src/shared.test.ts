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

test('footer / on-screen identity mismatch is flagged', () => {
  const b = base({ footer: 'Some Other Motors | Model Town | 98765 43210' });
  const r = runChecks(b);
  assert.ok(r.checks.some((c) => c.code === 'footer-identity-mismatch'));
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
