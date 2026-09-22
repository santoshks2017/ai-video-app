import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInterpretation, understandPrompt, type UnderstandRequest } from '../dist/intake.js';

const REQ: UnderstandRequest = {
  brief: 'Delivery creative for the customers attached, Diwali week',
  client: { name: 'Garve Hyundai', brand: 'Hyundai' },
  vehicles: [
    { id: 'car-1', name: 'Hyundai Creta' },
    { id: 'car-2', name: 'Hyundai Venue' },
  ],
  languages: [
    { id: 'en', name: 'English' },
    { id: 'hinglish', name: 'Hinglish' },
  ],
  images: [{ label: 'IMG_2041.jpg' }, {}],
};

test('the prompt carries the engines, the roles, the formats, the library and the images', () => {
  const p = understandPrompt(REQ);
  assert.match(p, /delivery \(E01 · Delivery \/ Handover\)/, 'the engine catalogue, by id');
  assert.match(p, /fields: customerName — Customer; moment — The moment/, 'each engine’s field ids');
  assert.match(p, /vehicle photo.*finished creative.*moment photo.*logo/s, 'the role taxonomy');
  assert.match(p, /ig-square: Instagram square, 1080×1080/, 'the sizes by id');
  assert.match(p, /car-1: Hyundai Creta/, 'the client’s library for matching');
  assert.match(p, /<IMAGE_1> — IMG_2041.jpg/, 'images numbered from 1, with their names');
  assert.match(p, /<IMAGE_2>\b/);
  assert.match(p, /Diwali/, 'the occasion list is there to choose from');
  assert.match(p, /Garve Hyundai/, 'the client');
  assert.match(p, /JSON only/);
});

test('a good answer is read whole: engine, facts, roles, vehicle matched to the library', () => {
  const out = parseInterpretation(
    JSON.stringify({
      engine: { primary: 'delivery', secondary: 'festival', ratio: '70/30' },
      heard: ['delivery creative', 'Diwali'],
      confidence: 'high',
      occasion: 'Diwali',
      vehicle: { name: 'Creta', colour: 'white' },
      facts: { customerName: 'Mr & Mrs Sharma', notAField: 'dropped' },
      language: 'en',
      sizes: ['ig-square', 'story', 'not-a-size'],
      images: [
        { index: 0, role: 'moment-photo', note: 'handover with family' },
        { index: 1, role: 'vehicle-photo' },
      ],
    }),
    REQ,
  );
  assert.equal(out.engine.primary, 'delivery');
  assert.equal(out.engine.secondary, 'festival');
  assert.equal(out.carId, 'car-1', 'Creta matched to the library');
  assert.equal(out.colour, 'white');
  assert.equal(out.facts.customerName, 'Mr & Mrs Sharma');
  assert.ok(!('notAField' in out.facts), 'a fact no engine has is dropped');
  assert.deepEqual(out.sizes, ['ig-square', 'story'], 'unknown sizes dropped');
  assert.deepEqual(out.images.map((i) => i.role), ['moment', 'vehicle'], 'roles read with or without the -photo suffix');
  assert.equal(out.confidence, 'high');
});

test('a finished creative brings its intent, its changes and its words', () => {
  const out = parseInterpretation(
    JSON.stringify({
      engine: { primary: 'offer' },
      images: [{ index: 0, role: 'finished-creative' }],
      referenceIntent: 'edit',
      changes: 'swap the offer to ₹75,000',
      copy: { headline: 'Benefits up to ₹50,000*', points: ['Exchange bonus'], cta: 'Book now', junk: 'x' },
    }),
    REQ,
  );
  assert.equal(out.images[0]!.role, 'creative');
  assert.equal(out.referenceIntent, 'edit');
  assert.equal(out.changes, 'swap the offer to ₹75,000');
  assert.equal(out.copy?.headline, 'Benefits up to ₹50,000*');
  assert.deepEqual(out.copy?.points, ['Exchange bonus']);
  assert.equal(out.copy?.kicker, '', 'missing copy fields come back empty, not undefined');
});

test('junk is refused, and junk fields are dropped without refusing the rest', () => {
  assert.throws(() => parseInterpretation('no json here', REQ), /cannot be read/);
  assert.throws(() => parseInterpretation('{"engine": {"primary": "not-an-engine"}}', REQ), /could not tell what kind of post/);
  const out = parseInterpretation('```json\n{"engine": {"primary": "offer"}, "confidence": "very sure", "copy": {"headline": ""}}\n```', REQ);
  assert.equal(out.confidence, 'low', 'unknown confidence reads as low');
  assert.equal(out.copy, undefined, 'a copy with no headline is no copy');
  assert.deepEqual(out.images, [], 'no images answered, none invented');
});
