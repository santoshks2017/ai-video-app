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
  assert.match(p, /<IMAGE_0> — IMG_2041.jpg/, 'images numbered from 0, with their names');
  assert.match(p, /<IMAGE_1> — unlabelled/);
  assert.doesNotMatch(p, /<IMAGE_2>/, 'no image past the last one');
  assert.match(p, /festival \+ offer at 60\/40: Emotion leads/, 'the blend table');
  assert.match(p, /the more emotional kind leads, at 60\/40\. From most emotional to least: delivery, festival, launch/, 'and the rule for any other pair');
  assert.match(p, /any change of wording the brief itself asks for .* is made in the copy/, 'the words asked for win over the words read');
  assert.match(p, /"changes" is what changes visually .* never the words/, 'and a change is never a change of words');
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
  // Delivery with festival is a blend the studio knows, and in it the festival leads.
  assert.equal(out.engine.primary, 'festival');
  assert.equal(out.engine.secondary, 'delivery');
  assert.equal(out.engine.ratio, '70/30');
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

test('image 0 is the first image: the answer’s index lands where the prompt numbered it', () => {
  const req: UnderstandRequest = { ...REQ, images: [{ label: 'old-creative.jpg' }, { label: 'creta.jpg' }] };
  const p = understandPrompt(req);
  assert.match(p, /<IMAGE_0> — old-creative\.jpg\n<IMAGE_1> — creta\.jpg/);
  assert.match(p, /"images":\[\{"index":0,/, 'the example answer counts from 0 too');
  const out = parseInterpretation(
    JSON.stringify({
      engine: { primary: 'offer' },
      images: [
        { index: 0, role: 'finished-creative' },
        { index: 1, role: 'vehicle-photo' },
        { index: 2, role: 'logo' },
      ],
    }),
    req,
  );
  assert.deepEqual(
    out.images.map((im) => [req.images[im.index]!.label, im.role]),
    [
      ['old-creative.jpg', 'creative'],
      ['creta.jpg', 'vehicle'],
    ],
    'index 0 is the first image; an index past the last is dropped',
  );
});

test('a blend is read as the studio blends it: a known pair takes its lead and share, any other the more emotional lead', () => {
  const known = parseInterpretation(JSON.stringify({ engine: { primary: 'offer', secondary: 'festival' } }), REQ);
  assert.deepEqual(known.engine, { primary: 'festival', secondary: 'offer', ratio: '60/40' }, 'the festival leads the offer, at the blend’s share');
  const ev = parseInterpretation(JSON.stringify({ engine: { primary: 'offer', secondary: 'ev', ratio: '70/30' } }), REQ);
  assert.deepEqual(ev.engine, { primary: 'ev', secondary: 'offer', ratio: '55/45' }, 'a known pair’s share wins over the one answered');
  const other = parseInterpretation(JSON.stringify({ engine: { primary: 'service', secondary: 'launch', ratio: '70/30' } }), REQ);
  assert.deepEqual(other.engine, { primary: 'launch', secondary: 'service', ratio: '60/40' }, 'the more emotional leads; a share answered the other way round is not trusted');
  const kept = parseInterpretation(JSON.stringify({ engine: { primary: 'launch', secondary: 'service', ratio: '70/30' } }), REQ);
  assert.equal(kept.engine.ratio, '70/30', 'a share answered in the right order stands');
  const alone = parseInterpretation(JSON.stringify({ engine: { primary: 'offer', ratio: '70/30' } }), REQ);
  assert.deepEqual(alone.engine, { primary: 'offer' }, 'one kind alone carries no share');
});
