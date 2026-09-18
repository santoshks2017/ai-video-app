import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyPrompt, parseCopy, sceneInstruction, type CopyRequest } from '../dist/creatives.js';

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
});
