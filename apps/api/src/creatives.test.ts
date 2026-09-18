import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyPrompt, designInstruction, parseCopy, reviseInstruction, sceneInstruction, type CopyRequest, type DesignRequest } from '../dist/creatives.js';

const REQ: CopyRequest = {
  engine: { primary: 'festival', secondary: 'offer', ratio: '60/40' },
  prompt: 'Navratri offer on the Creta',
  facts: [
    { label: 'Occasion', value: 'Navratri' },
    { label: 'Offers', value: 'Benefits up to ₹50,000\nExchange bonus ₹20,000' },
    { label: 'Valid till', value: '' },
  ],
  client: { name: 'Garve Hyundai', brand: 'Hyundai', city: 'Pune', phone: '+91 97643 79764', address: 'Baner Road' },
  vehicle: { model: 'Creta', brand: 'Hyundai', highlights: ['Panoramic sunroof', 'Level 2 ADAS'] },
  language: { name: 'English', script: 'latin' },
  voiceNote: 'Always say "Drive the difference". Never say "cheap".',
};

test('the copy is asked for as the engine, the client and the facts say, under the rules', () => {
  const p = copyPrompt(REQ);
  assert.match(p, /Festival \/ Occasion blended with Offer \/ Deal at 60\/40 — the first leads/);
  assert.match(p, /Offers: Benefits up to ₹50,000\nExchange bonus ₹20,000/, 'the facts, as given');
  assert.doesNotMatch(p, /Valid till:/, 'an empty fact is left out');
  assert.match(p, /never "₹X off", and never a percentage discount/);
  assert.match(p, /ends with an asterisk/);
  assert.match(p, /📍 Garve Hyundai \| Baner Road, Pune\n📞 \+91 97643 79764/, 'the contact block, verbatim');
  assert.match(p, /Drive the difference/, 'the client’s own voice');
  assert.match(p, /Panoramic sunroof; Level 2 ADAS/);
  assert.match(p, /Never invent a price, a date, a number or a feature/);
  const hindi = copyPrompt({ ...REQ, language: { name: 'Hindi', script: 'indic' } });
  assert.match(hindi, /Hindi, in its own script/);
  assert.match(hindi, /Headline at most 40 characters/, 'shorter lines for a wider script');
  assert.match(copyPrompt({ ...REQ, language: { name: 'Hinglish', script: 'latin', hinglish: true } }), /Hinglish: everyday Hindi written in the Latin alphabet/);
});

test('copy is read out of whatever comes back, and a copy with no headline is refused', () => {
  const c = parseCopy('Here it is:\n```json\n{"headline":"Navratri on the Creta","alternatives":["A","B"],"points":["x", 2],"hashtags":["#Creta"]}\n```');
  assert.equal(c.headline, 'Navratri on the Creta');
  assert.deepEqual(c.alternatives, ['A', 'B']);
  assert.deepEqual(c.points, ['x', '2']);
  assert.equal(c.cta, '');
  assert.throws(() => parseCopy('{"headline": ""}'), /without a headline/);
  assert.throws(() => parseCopy('no json at all'), /cannot be read/);
});

test('the picture is asked for with this vehicle, a blank plate, room for the words and no writing', () => {
  const p = sceneInstruction(
    { aspect: '9:16', engine: 'festival', occasion: 'Diwali', vehicle: { name: 'Hyundai Creta', colour: 'Abyss Black' }, textBand: 'top', panel: true, mood: { panel: '#5C0A0A', accent: '#FFC53D' } },
    ['the Hyundai Creta, front three-quarter', 'the Hyundai Creta, side'],
  );
  assert.match(p, /<IMAGE_REF_0> — the Hyundai Creta, front three-quarter\n<IMAGE_REF_1> — the Hyundai Creta, side/);
  assert.match(p, /<IMAGE_REF_0> is the Hyundai Creta in Abyss Black\. Put THIS car/);
  assert.match(p, /NUMBER PLATES ARE PLAIN WHITE AND BLANK/);
  assert.match(p, /diyas/, 'dressed for the occasion');
  assert.match(p, /keep the top third calm/);
  assert.match(p, /bottom sixth simple/);
  assert.match(p, /no text of any kind/);
  const wide = sceneInstruction({ aspect: '16:9', engine: 'offer', vehicle: { name: 'Honda Elevate', kind: 'car' }, textBand: 'left', panel: false }, ['the Honda Elevate']);
  assert.match(wide, /right half of the frame; keep the left half calm/);
  assert.doesNotMatch(wide, /bottom sixth/);
  assert.match(wide, /showroom/, 'the engine’s own scene when no occasion is named');
  assert.match(sceneInstruction({ aspect: '1:1', engine: 'testdrive', vehicle: { name: 'Royal Enfield Classic 350', kind: 'bike' }, textBand: 'top', panel: true }, ['x']), /Put THIS motorcycle/);
  const measured = sceneInstruction({ aspect: '1:1', engine: 'festival', vehicle: { name: 'Hyundai Creta' }, textBand: 'top', band: 0.47, panel: true }, ['x']);
  assert.match(measured, /Keep the top 47% of the frame calm/, 'the band the words take');
  assert.match(measured, /whole car below that band/);
  assert.match(sceneInstruction({ aspect: '1:1', engine: 'festival', vehicle: { name: 'Hyundai Creta' }, textBand: 'top', band: 0.95, panel: true }, ['x']), /top 60%/, 'never most of the frame');
});

test('Nano Banana 2 designs the whole creative on the canvas with the logos in place: this vehicle, these words exactly, the strip, nothing else', () => {
  const req: DesignRequest = {
    format: 'ig-square',
    engine: 'festival',
    secondary: 'offer',
    occasion: 'Navratri',
    vehicle: { name: 'Hyundai Creta', colour: 'Abyss Black', kind: 'car' },
    words: {
      kicker: 'Navratri offer',
      headline: 'Celebrate Navratri in the Creta',
      sub: '',
      badge: 'Benefits up to ₹50,000*',
      points: ['Exchange bonus up to ₹20,000*'],
      cta: '',
      strip: { name: 'Garve Hyundai', lines: ['Baner Road, Pune', '+91 97643 79764  ·  garvehyundai.com'], cta: 'Book a test drive' },
      terms: '*T&C apply. Offer valid till 31 October.',
    },
    language: { name: 'English', script: 'latin' },
    look: { panel: '#0F1E33', accent: '#E8590C' },
    zones: { logoBand: 0.14, stripTop: 0.82, logoTone: 'dark', textSide: 'top' },
    canvas: { storagePath: 'refs/c/canvas.png', logos: 2 },
  };
  const p = designInstruction(req, ['the Hyundai Creta, front', 'the Hyundai Creta, side']);
  assert.match(p, /Instagram square post .*1080×1080 pixels, aspect 1:1/);
  assert.match(p, /top automotive advertising agency/);
  assert.match(p, /<IMAGE_REF_0> — the canvas: this creative's exact shape, with the client's logos already in their final places\n<IMAGE_REF_1> — the Hyundai Creta, front\n<IMAGE_REF_2> — the Hyundai Creta, side/);
  assert.match(p, /keep each one exactly where it is — the same place, the same size, the same colours/);
  assert.match(p, /The grey is empty canvas: replace every bit of it/);
  assert.match(p, /Add no other logo, emblem, brand name or wordmark anywhere/);
  assert.match(p, /<IMAGE_REF_1> is the Hyundai Creta in Abyss Black\. Put THIS car/, 'the car is the first photo after the canvas');
  assert.match(p, /NUMBER PLATES ARE PLAIN WHITE AND BLANK/);
  assert.match(p, /Navratri night/, 'dressed for the occasion');
  assert.match(p, /Headline — the largest, boldest words on the creative by far: "Celebrate Navratri in the Creta"/);
  assert.match(p, /Offer badge .*: "Benefits up to ₹50,000\*"/);
  assert.doesNotMatch(p, /Second line|Button — /, 'only the words given; the button is the strip’s');
  assert.match(p, /## The dealership strip\nAcross the bottom, about 18% of the height: a strip that belongs to the design — in its colours and its style, not a box pasted on/);
  assert.match(p, /The dealership's name, bold, .*: "Garve Hyundai"/);
  assert.match(p, /Then, smaller: "\+91 97643 79764  ·  garvehyundai\.com"/);
  assert.match(p, /A button on the strip's right, .*: "Book a test drive"/);
  assert.match(p, /The small print, at the very bottom, small but legible: "\*T&C apply\. Offer valid till 31 October\."/);
  assert.match(p, /every digit of a phone number/);
  assert.match(p, /Nothing overlaps: no word on the car, no word on a logo, no word on another word/);
  assert.match(p, /No word smaller than 2\.8% of the height, and the small print no smaller than 2% of the height/);
  assert.match(p, /elegant serif greeting/, 'the festival’s typography');
  assert.match(p, /#E8590C for the badge, the button/);

  const bare = designInstruction({ ...req, canvas: undefined }, ['x']);
  assert.doesNotMatch(bare, /IMAGE_REF_0> — the canvas/);
  assert.match(bare, /<IMAGE_REF_0> is the Hyundai Creta/, 'without a canvas the car comes first');

  const wide = designInstruction({ ...req, format: 'landscape', zones: { logoBand: 0.2, stripTop: 0.83, logoTone: 'light', textSide: 'left' } }, ['x']);
  assert.match(wide, /words in the left half of the frame and the whole car in the right half/);
  assert.match(wide, /top and bottom 5% may be trimmed/, '1.91:1 is cut from 16:9');
  assert.match(wide, /ground around them calm and light/);
  const story = designInstruction({ ...req, format: 'story' }, ['x']);
  assert.match(story, /out of the top 9% and the bottom 12%/);
  const hindi = designInstruction({ ...req, language: { name: 'Hindi', script: 'indic' }, words: { ...req.words, headline: 'नवरात्रि की शुभकामनाएँ' } }, ['x']);
  assert.match(hindi, /in Hindi, in its own script: set every conjunct and vowel sign correctly/);
  assert.match(hindi, /"नवरात्रि की शुभकामनाएँ"/);

  const banner = designInstruction({ ...req, format: 'cd-300x600', words: { ...req.words, strip: undefined, cta: 'Book a test drive', terms: '*T&C apply.' }, zones: { logoBand: 0.09, stripTop: 0.95, logoTone: 'dark', textSide: 'top' } }, ['x']);
  assert.match(banner, /a banner for CarDekho, India's car marketplace .*shown at just 300×600 pixels .*very few words, very large and bold/);
  assert.match(banner, /Draw it at aspect 9:16/);
  assert.doesNotMatch(banner, /dealership strip/, 'a banner has no strip');
  assert.match(banner, /Button — a rounded pill .*: "Book a test drive"/);
  assert.match(banner, /The left and right 7% may be trimmed/, '300×600 is cut from 9:16');

  const r = reviseInstruction(req, 'make the headline gold', 2);
  assert.match(r, /<IMAGE_REF_0> is a finished social media advertisement\.\n<IMAGE_REF_1>, <IMAGE_REF_2> are photographs of the Hyundai Creta/);
  assert.match(r, /Make this one change to the advertisement: "make the headline gold"/);
  assert.match(r, /the logos exactly where they are, and every word exactly as written/);
  assert.match(r, /plain white and blank/);
});
