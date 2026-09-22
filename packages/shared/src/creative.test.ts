/**
 * Project Image: the creative document, the twelve engines, the copy rules and the layouts.
 * Run: npm test --workspace @ava/shared
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CREATIVE_FORMATS,
  CREATIVE_TEMPLATES,
  applyCopyToCreative,
  classifyCreative,
  DESIGN_GROUND,
  PICTURE_ASPECT_RATIO,
  compareWords,
  designCanvasOf,
  designSkeleton,
  designWordsOf,
  designZonesOf,
  hasWordLayers,
  layoutDesigned,
  normWords,
  panelCarries,
  sameDesignWords,
  swapPicture,
  verdictWeight,
  creativeLook,
  duplicateLayer,
  emptyCopy,
  formatRupees,
  layerHit,
  layoutCreative,
  occasionIn,
  pictureAspectsFor,
  pictureTrim,
  reorderLayer,
  tidyCopy,
  updateLayer,
  validateCreativeDoc,
  wordsBand,
  type CreativeCopy,
  type CreativeDoc,
  type LayoutInput,
} from '@ava/shared';

test('every size is the platform’s own pixels, and pictures are drawn once per aspect', () => {
  const px = Object.fromEntries(CREATIVE_FORMATS.map((f) => [f.id, `${f.width}x${f.height}`]));
  assert.deepEqual(px, {
    'ig-square': '1080x1080',
    'ig-portrait': '1080x1350',
    story: '1080x1920',
    landscape: '1200x628',
    thumbnail: '1280x720',
    'cd-970x90': '970x90',
    'cd-720x90': '720x90',
    'cd-300x250': '300x250',
    'cd-300x600': '300x600',
    'cd-310x100': '310x100',
  });
  assert.deepEqual(pictureAspectsFor(['ig-square', 'landscape', 'thumbnail', 'story']), ['1:1', '16:9', '9:16'], 'the 1.91:1 post is cut from the thumbnail’s 16:9');
});

test('a brief is read as the orchestrator’s engines, blended at its ratios', () => {
  const read = (s: string) => {
    const c = classifyCreative(s);
    return c ? [c.primary, c.secondary ?? null, c.ratio ?? null] : null;
  };
  assert.deepEqual(read('Navratri offer on Hyundai Creta — get ₹50K off'), ['festival', 'offer', '60/40'], 'emotion leads; the offer is the gift');
  assert.deepEqual(read("Father's Day post for Honda City"), ['festival', null, null]);
  assert.deepEqual(read('Congratulations Mr Sharma on the delivery of his new Nexon'), ['delivery', null, null]);
  assert.deepEqual(read('All-new Duster launch — bookings open, book a test drive'), ['launch', 'testdrive', '60/40']);
  assert.deepEqual(read('Nexon EV with benefits up to ₹1 lakh'), ['ev', 'offer', '55/45']);
  assert.deepEqual(read('Diwali delivery with an exchange bonus'), ['delivery', null, null], 'more than two: the most emotional leads alone');
  assert.deepEqual(read('Ceramic coating and PPF packages'), ['accessories', null, null]);
  assert.equal(classifyCreative('Something about our team lunch'), null, 'nothing that points anywhere');
  assert.equal(classifyCreative('Explore the range')?.primary, undefined, '"range" alone is not electric');
});

test('the occasion a brief names is found, by its other names too', () => {
  assert.equal(occasionIn('Happy Diwali from all of us'), 'Diwali');
  assert.equal(occasionIn('rakhi special on Venue'), 'Raksha Bandhan');
  assert.equal(occasionIn("A Father's Day post"), "Father's Day");
  assert.equal(occasionIn('Ganpati bappa morya'), 'Ganesh Chaturthi');
  assert.equal(occasionIn('Test drive camp'), undefined);
});

test('rupees are always written the Indian way', () => {
  assert.equal(formatRupees('Benefits up to Rs. 215000'), 'Benefits up to ₹2,15,000');
  assert.equal(formatRupees('Get ₹50K off'), 'Get ₹50,000 off');
  assert.equal(formatRupees('Starting at ₹ 10.99 Lakh'), 'Starting at ₹10.99 Lakh');
  assert.equal(formatRupees('INR 2 lakh savings'), 'INR 2 lakh savings'.replace('INR 2 lakh', '₹2 Lakh'));
  assert.equal(formatRupees('EMI from ₹ 9999/month'), 'EMI from ₹9,999/month');
  assert.equal(formatRupees('Rs 1,00,000 cash'), '₹1,00,000 cash');
  assert.equal(formatRupees('₹1.5 cr'), '₹1.5 Crore');
});

test('the copy keeps the universal rules whatever was written, and is only what goes on the picture', () => {
  const raw: CreativeCopy = {
    ...emptyCopy(),
    headline: 'Navratri on the Creta',
    badge: 'Benefits up to Rs 50000',
    points: ['Exchange bonus ₹ 20000', 'Free 3-year service'],
    cta: 'Book a test drive',
  };
  const c = tidyCopy(raw, { validity: '31 October' });
  assert.equal(c.badge, 'Benefits up to ₹50,000*', 'formatted and asterisked');
  assert.equal(c.points[0], 'Exchange bonus ₹20,000*');
  assert.equal(c.points[1], 'Free 3-year service', 'not a price claim');
  assert.equal(c.headline, 'Navratri on the Creta');
  assert.match(c.terms, /^\*T&C apply\. Offer valid till 31 October\./, 'an asterisk is answered');
  // A post's caption, its hashtags and its search line are another tool's, and not written here.
  assert.deepEqual(Object.keys(emptyCopy()).sort(), ['alternatives', 'badge', 'cta', 'headline', 'kicker', 'points', 'sub', 'terms']);
  const again = tidyCopy(c, { validity: '31 October' });
  assert.equal(again.badge, c.badge, 'the asterisk is not doubled');
  assert.equal(again.terms, c.terms);
});

test('a creative’s colours come from a look, the manufacturer or the occasion — always readable', () => {
  const brand = creativeLook({ source: 'brand' }, { brand: 'Hyundai' });
  assert.equal(brand.panel.toLowerCase(), '#003566');
  assert.equal(brand.text, '#ffffff');
  const diwali = creativeLook({ source: 'occasion' }, { occasion: 'Diwali' });
  assert.equal(diwali.panel.toLowerCase(), '#5c0a0a');
  assert.equal(creativeLook({ source: 'brand' }, { brand: 'Unknown Motors' }).id, 'midnight', 'no palette: the default look');
  assert.equal(creativeLook({ source: 'theme', themeId: 'clean-white' }, {}).id, 'clean-white');
});

const COPY: CreativeCopy = {
  ...emptyCopy(),
  headline: 'Celebrate Navratri in the Creta',
  kicker: 'Navratri offer',
  sub: 'Nine nights, one unforgettable drive home.',
  badge: 'Benefits up to ₹50,000*',
  points: ['Exchange bonus up to ₹20,000*', 'Free 3-year service'],
  cta: 'Book a test drive',
  terms: '*T&C apply. Offer valid till 31 October.',
};
const LONG: CreativeCopy = {
  ...COPY,
  headline: 'An extraordinarily long headline that keeps going well past what any sensible layout could hold',
  sub: 'And a second line that also goes on and on, describing every single thing about the car and the offer in detail',
  points: ['A first point that is rather long indeed', 'A second point that is also long', 'A third point', 'A fourth point that runs long'],
};
const input = (over: Partial<LayoutInput>): LayoutInput => ({
  format: 'ig-square',
  template: 'hero',
  copy: COPY,
  look: creativeLook({ source: 'theme', themeId: 'midnight' }, {}),
  picture: { src: '/api/refs/abc/scene.png', storagePath: 'refs/abc/scene.png', mode: 'scene' },
  logos: {
    dealer: { src: '/api/refs/d/logo.png', white: { src: '/api/refs/d/logo-white.png' } },
    brand: { src: '/api/refs/b/brand.png' },
    placement: { brand: 'left', dealer: 'right' },
  },
  panel: { style: 'full', name: 'Garve Hyundai', details: ['Baner Road, Pune', '+91 97643 79764  ·  garvehyundai.com'] },
  ...over,
});

const words = (d: CreativeDoc) => d.layers.filter((l) => l.kind === 'text');
const SOCIAL = CREATIVE_FORMATS.filter((f) => f.group === 'social');
const overlaps = (a: { y: number; h: number }, b: { y: number; h: number }) => a.y < b.y + b.h && b.y < a.y + a.h;

test('every template lays out every size inside its frame and out of the platform’s bands', () => {
  for (const t of CREATIVE_TEMPLATES) {
    for (const f of SOCIAL) {
      for (const copy of [COPY, LONG]) {
        for (const style of ['full', 'compact', 'none'] as const) {
          const doc = layoutCreative(input({ template: t.id, format: f.id, copy, panel: { ...input({}).panel, style } }));
          const where = `${t.id} · ${f.id} · ${copy === LONG ? 'long' : 'short'} · ${style}`;
          assert.equal(validateCreativeDoc(doc), null, where);
          for (const l of doc.layers) {
            assert.ok(l.x >= 0 && l.y >= 0 && l.x + l.w <= f.width + 0.5 && l.y + l.h <= f.height + 0.5, `${where}: ${l.name} is outside the frame (${l.x},${l.y} ${l.w}×${l.h})`);
          }
          const top = Math.round(f.height * f.safeTop);
          const bottom = f.height - Math.round(f.height * f.safeBottom);
          for (const l of words(doc)) {
            assert.ok(l.y >= top - 1 && l.y + l.h <= bottom + 1, `${where}: ${l.name} is in a band the platform covers`);
          }
          // The words above the call to action never run into it.
          const cta = doc.layers.find((l) => l.role === 'cta');
          if (cta) {
            for (const l of words(doc).filter((x) => ['headline', 'sub', 'kicker', 'badge'].includes(x.role ?? '') && x.x < cta.x + cta.w && cta.x < x.x + x.w)) {
              assert.ok(!overlaps(l, cta), `${where}: ${l.name} runs into the call to action`);
            }
          }
          const panel = doc.layers.find((l) => l.role === 'panel');
          if (style !== 'none') assert.ok(panel, `${where}: a panel`);
          if (panel) assert.equal(panel.y + panel.h, f.height, `${where}: the panel reaches the foot`);
        }
      }
    }
  }
});

test('on a square, portrait or story the dealer panel carries the call to action and the small print', () => {
  const inside = (l: { y: number; h: number }, box: { y: number; h: number }) => l.y >= box.y - 0.5 && l.y + l.h <= box.y + box.h + 0.5;
  for (const f of SOCIAL) {
    for (const t of CREATIVE_TEMPLATES) {
      const doc = layoutCreative(input({ template: t.id, format: f.id }));
      const where = `${t.id} · ${f.id}`;
      const panel = doc.layers.find((l) => l.role === 'panel')!;
      const cta = doc.layers.find((l) => l.role === 'cta')!;
      const terms = doc.layers.find((l) => l.role === 'terms')!;
      const wide = f.width / f.height > 1.3;
      if (wide) {
        // A wide size keeps them in its column, clear of the vehicle on the right.
        assert.ok(cta.y + cta.h <= panel.y, `${where}: the call to action sits above the panel`);
        assert.ok(cta.x + cta.w <= f.width * 0.6, `${where}: in the left column`);
        continue;
      }
      assert.ok(inside(cta, panel), `${where}: the call to action is in the panel`);
      assert.ok(inside(terms, panel), `${where}: the small print is in the panel`);
      assert.ok(cta.x + cta.w <= f.width - 1 && cta.x > f.width / 2, `${where}: on the panel's right`);
      for (const info of doc.layers.filter((l) => l.role === 'panel-name' || l.role === 'panel-details')) {
        assert.ok(info.x + info.w <= cta.x, `${where}: ${info.name} stops short of the call to action`);
        assert.ok(info.y + info.h <= terms.y + 0.5, `${where}: ${info.name} sits above the small print`);
      }
    }
  }
  // Without a full panel they go back to the foot of the picture.
  const compact = layoutCreative(input({ panel: { ...input({}).panel, style: 'compact' } }));
  const cPanel = compact.layers.find((l) => l.role === 'panel')!;
  assert.ok(compact.layers.filter((l) => l.role === 'cta' || l.role === 'terms').every((l) => l.y + l.h <= cPanel.y));
  // A greeting that shades only its top shades the foot under those words.
  const greeting = layoutCreative(input({ template: 'festival', panel: { ...input({}).panel, style: 'none' } }));
  assert.ok(greeting.layers.some((l) => l.name === 'Shade, foot'));
  assert.ok(!layoutCreative(input({ template: 'festival' })).layers.some((l) => l.name === 'Shade, foot'), 'not when the panel carries them');
  // The foot is shaded only for words set there, never just to darken the vehicle.
  const shadedFoot = (d: CreativeDoc) => d.layers.some((l) => l.name === 'Shade, bottom');
  assert.ok(!shadedFoot(layoutCreative(input({}))), 'nothing at the foot: no shade');
  assert.ok(shadedFoot(layoutCreative(input({ panel: { ...input({}).panel, style: 'compact' } }))), 'the call to action at the foot');
  assert.ok(shadedFoot(layoutCreative(input({ template: 'feature' }))), 'points set low');
  // Over a picture on a square, the words keep to the upper half or so; without one, the whole frame is theirs.
  const long = layoutCreative(input({ template: 'festival', copy: LONG }));
  const reach = Math.max(...words(long).filter((l) => ['kicker', 'headline', 'sub'].includes(l.role ?? '')).map((l) => l.y + l.h));
  assert.ok(reach <= 1080 * 0.54 + 1, `the words reach ${reach}`);
});

test('a wide size keeps the whole contact in its panel, and a logo on the right reads on any picture', () => {
  const doc = layoutCreative(input({ format: 'landscape' }));
  const details = doc.layers.find((l) => l.role === 'panel-details');
  assert.ok(details && details.kind === 'text' && details.text.includes('+91 97643 79764'), 'the phone number is there');
  const name = doc.layers.find((l) => l.role === 'panel-name')!;
  assert.ok(name.x + name.w <= details!.x, 'the name and the contact side by side');
  assert.ok(doc.layers.some((l) => l.name === 'Shade, logos'), 'the dealer logo on the right is shaded');
  const leftOnly = layoutCreative(input({ format: 'landscape', logos: { ...input({}).logos, placement: { brand: 'left', dealer: 'left' } } }));
  assert.ok(!leftOnly.layers.some((l) => l.name === 'Shade, logos'), 'no shade when both logos are on the shaded side');
});

test('the band the words take at the top is measured for the picture', () => {
  for (const f of SOCIAL.filter((x) => x.width / x.height <= 1.3)) {
    for (const t of CREATIVE_TEMPLATES) {
      const doc = layoutCreative(input({ template: t.id, format: f.id }));
      const band = wordsBand(doc);
      assert.ok(band >= 0.3 && band <= 0.6, `${t.id} · ${f.id}: ${band}`);
      const headline = doc.layers.find((l) => l.role === 'headline')!;
      assert.ok(band * f.height >= headline.y + headline.h || band === 0.6, `${t.id} · ${f.id}: the headline is inside the band`);
    }
  }
  assert.equal(wordsBand({ ...layoutCreative(input({})), layers: [] }), 0.33, 'nothing at the top: a third');
});

test('logos follow the client’s placement, and turn white on dark ground', () => {
  const doc = layoutCreative(input({}));
  const brand = doc.layers.find((l) => l.role === 'brand-logo')!;
  const dealer = doc.layers.find((l) => l.role === 'dealer-logo')!;
  assert.ok(brand.x < 540 && dealer.x > 540, 'brand left, dealer right');
  assert.equal(dealer.kind === 'image' && dealer.src, '/api/refs/d/logo-white.png', 'the white version on a dark shade');
  assert.equal(brand.kind === 'image' && brand.src, '/api/refs/b/brand.png', 'no white version: the colour one');
  const light = layoutCreative(input({ look: creativeLook({ source: 'theme', themeId: 'clean-white' }, {}) }));
  const d2 = light.layers.find((l) => l.role === 'dealer-logo')!;
  assert.equal(d2.kind === 'image' && d2.src, '/api/refs/d/logo.png', 'colour on light ground');
  const off = layoutCreative(input({ logos: { ...input({}).logos, placement: { brand: 'off', dealer: 'left' } } }));
  assert.equal(off.layers.filter((l) => l.role === 'brand-logo').length, 0);
  assert.ok(off.layers.find((l) => l.role === 'dealer-logo')!.x < 100);
});

test('a photo used as it is shows whole, on a blurred copy of itself', () => {
  const doc = layoutCreative(input({ picture: { src: '/api/refs/c/front.jpg', mode: 'photo' } }));
  const bg = doc.layers[0]!;
  assert.equal(bg.kind === 'image' && bg.fit, 'contain');
  assert.equal(bg.kind === 'image' && bg.backdrop, 'blur');
});

test('new words reach a changed creative without undoing the changes', () => {
  const doc = layoutCreative(input({ template: 'offer' }));
  const head = doc.layers.find((l) => l.role === 'headline')!;
  const moved = updateLayer(doc, head.id, { x: 200, y: 300, color: '#ff0000' });
  const next = applyCopyToCreative(moved, { ...COPY, headline: 'Diwali on the Creta', badge: 'Benefits up to ₹75,000*' });
  const h2 = next.layers.find((l) => l.id === head.id)!;
  assert.equal(h2.kind === 'text' && h2.text, 'Diwali on the Creta');
  assert.deepEqual([h2.x, h2.y, h2.kind === 'text' && h2.color], [200, 300, '#ff0000']);
  assert.equal(next.layers.find((l) => l.role === 'badge')!.kind === 'text' && (next.layers.find((l) => l.role === 'badge') as { text: string }).text, 'Benefits up to ₹75,000*');
});

test('layers are edited as new documents, and checked before they are kept', () => {
  const doc = layoutCreative(input({}));
  const id = doc.layers.find((l) => l.role === 'headline')!.id;
  const { doc: two, id: copyId } = duplicateLayer(doc, id);
  assert.equal(two.layers.length, doc.layers.length + 1);
  assert.equal(two.layers.findIndex((l) => l.id === copyId), two.layers.findIndex((l) => l.id === id) + 1, 'the copy sits just above');
  const top = reorderLayer(two, id, 'top');
  assert.equal(top.layers.at(-1)!.id, id);
  assert.equal(reorderLayer(top, id, 'bottom').layers[0]!.id, id);
  assert.ok(layerHit({ x: 100, y: 100, w: 200, h: 50, rotation: 90 }, 200, 175), 'a rotated layer is hit where it is drawn');
  assert.ok(!layerHit({ x: 100, y: 100, w: 200, h: 50, rotation: 90 }, 290, 125));
  const bad = (patch: object) => validateCreativeDoc({ ...doc, layers: [{ ...doc.layers[1]!, ...patch }] });
  assert.match(String(bad({ x: Number.NaN })), /position or size/);
  assert.match(String(validateCreativeDoc({ ...doc, width: 999 })), /must be 1080×1080/);
  assert.match(String(bad({ kind: 'video' })), /kind this editor does not know/);
  assert.match(String(validateCreativeDoc({ ...doc, layers: [{ ...doc.layers[0]!, kind: 'image', src: `data:image/png;base64,${'A'.repeat(500)}` }] })), /uploaded first/);
  assert.equal(validateCreativeDoc(doc), null);
});

/* ---- Nano Banana 2 designs ---- */

test('the words read back off a design are checked against the copy, as they are written', () => {
  const words = designWordsOf(
    { ...emptyCopy(), kicker: 'Navratri offer', headline: 'Celebrate Navratri in the Creta', sub: 'Festive benefits for nine nights.', badge: 'Benefits up to ₹50,000*', points: ['Exchange bonus up to ₹20,000*'], cta: 'Book a test drive' },
    input({ panel: { style: 'none', name: '', details: [] } }),
  );
  const read = ['NAVRATRI OFFER', 'Celebrate Navratri', 'in the Creta', 'Festive benefits for nine nights', 'Benefits up to ₹50,000*', 'Exchange bonus up to ₹20,000*', 'Book a test drive', 'HYUNDAI', 'CRETA', 'H'];
  const ok = compareWords(words, read, ['Hyundai Creta', 'Hyundai', 'Creta']);
  assert.deepEqual(ok, { checked: true, ok: true, missing: [], extra: [] }, 'capitals, line breaks and the car’s own badges are fine');

  const dropped = compareWords(words, read.map((s) => s.replace('₹50,000*', '₹50,000')), ['Hyundai', 'Creta']);
  assert.equal(dropped.ok, false);
  assert.deepEqual(dropped.missing, ['Benefits up to ₹50,000*'], 'a dropped asterisk is a missing claim');

  const wrong = compareWords(words, read.map((s) => s.replace('₹20,000*', '₹2,00,00*')), ['Hyundai', 'Creta']);
  assert.deepEqual(wrong.missing, ['Exchange bonus up to ₹20,000*'], 'a misgrouped amount is caught');

  const invented = compareWords(words, [...read, 'Call 98765 43210', 'MH 12 AB 1234'], ['Hyundai', 'Creta']);
  assert.deepEqual(invented.extra, ['Call 98765 43210', 'MH 12 AB 1234'], 'a phone number or plate it made up is extra');

  assert.equal(normWords('शुभ नवरात्रि!'), 'शुभनवरात्रि', 'an Indian script keeps its vowel signs');
  assert.equal(normWords('Only ₹9,999/month.'), 'only₹9,999month');
  // With a full strip, the model sets the dealership's name, contact, button and small print too — and they are checked.
  const full = designWordsOf({ ...emptyCopy(), headline: 'x', cta: 'Book now', terms: '*T&C apply.' }, input({}));
  assert.deepEqual(full.strip, { name: 'Garve Hyundai', lines: ['Baner Road, Pune', '+91 97643 79764  ·  garvehyundai.com'], cta: 'Book now' });
  assert.equal(full.cta, '', 'the button is on the strip');
  assert.equal(full.terms, '*T&C apply.');
  const wrongPhone = compareWords(full, ['x', 'Garve Hyundai', 'Baner Road, Pune', '+91 97643 79746 · garvehyundai.com', 'Book now', '*T&C apply.']);
  assert.deepEqual(wrongPhone.missing, ['+91 97643 79764  ·  garvehyundai.com'], 'a misdrawn phone number is caught');
  const compact = designWordsOf({ ...emptyCopy(), headline: 'x', cta: 'Book now' }, input({ panel: { style: 'compact', name: 'Garve Hyundai', details: ['+91 97643 79764', 'Pune'] } }));
  assert.deepEqual(compact.strip, { name: '', lines: ['Garve Hyundai  ·  +91 97643 79764  ·  Pune'], cta: '' });
  assert.equal(compact.cta, 'Book now', 'a one-line strip leaves the button to the words');
  assert.ok(sameDesignWords(words, { ...words }));
  assert.ok(!sameDesignWords(words, { ...words, headline: 'Another' }));
  assert.equal(verdictWeight({ same: false, checked: true }, dropped), 5);
  assert.equal(verdictWeight({ same: true, checked: true }, ok), 0);
});

test('a design carries the client’s exact logos and nothing else; it is designed on a canvas with them in place', () => {
  for (const f of CREATIVE_FORMATS.filter((x) => x.design === 'whole')) {
    const doc = layoutDesigned(input({ format: f.id, picture: { src: '/api/refs/d/design.png', storagePath: 'refs/d/design.png', mode: 'design' } }));
    const where = f.id;
    assert.equal(validateCreativeDoc(doc), null, where);
    const pic = doc.layers[0]!;
    assert.ok(pic.kind === 'image' && pic.role === 'background' && pic.fit === 'cover' && pic.w === f.width && pic.h === f.height, `${where}: the design fills the frame`);
    assert.ok(doc.layers.slice(1).every((l) => l.role === 'dealer-logo' || l.role === 'brand-logo'), `${where}: only the logos go on it`);
    assert.ok(doc.layers.some((l) => l.role === 'dealer-logo'), `${where}: the dealer's logo`);

    const canvas = designSkeleton(input({ format: f.id }));
    const at = designCanvasOf(f.id);
    assert.equal(canvas.background, DESIGN_GROUND);
    assert.deepEqual([canvas.width, canvas.height], [at.width, at.height], `${where}: the canvas is the shape the model draws`);
    const drawn = PICTURE_ASPECT_RATIO[f.pictureAspect];
    assert.ok(Math.abs(canvas.width / canvas.height - drawn) < 0.01, `${where}: at ${f.pictureAspect}`);
    const logos = doc.layers.slice(1);
    assert.equal(canvas.layers.length, logos.length, `${where}: every logo, and nothing else`);
    canvas.layers.forEach((l, i) => {
      assert.equal(l.x, logos[i]!.x + at.dx, `${where}: the logo sits where the frame sits in the canvas`);
      assert.equal(l.y, logos[i]!.y + at.dy);
    });
  }
  assert.deepEqual(designCanvasOf('landscape'), { width: 1200, height: 675, dx: 0, dy: 24 }, '1.91:1 is the middle of 16:9');
  assert.deepEqual(designCanvasOf('cd-300x600'), { width: 338, height: 600, dx: 19, dy: 0 }, '1:2 is the middle of 9:16');
  assert.deepEqual(designCanvasOf('ig-square'), { width: 1080, height: 1080, dx: 0, dy: 0 });
  const zones = designZonesOf(layoutCreative(input({})), 'dark');
  assert.ok(zones.stripTop > 0.7 && zones.stripTop < 0.9, 'the strip the model is asked for is the layout’s own');
});

test('a new picture keeps every change made to a creative', () => {
  const doc = layoutDesigned(input({ picture: { src: '/api/refs/a/one.png', storagePath: 'refs/a/one.png', mode: 'design' } }));
  const moved = updateLayer(doc, doc.layers.find((l) => l.role === 'dealer-logo')!.id, { x: 12 });
  const swapped = swapPicture(moved, { src: '/api/refs/b/two.png', storagePath: 'refs/b/two.png' });
  const pic = swapped.layers[0]!;
  assert.ok(pic.kind === 'image' && pic.src === '/api/refs/b/two.png' && pic.storagePath === 'refs/b/two.png');
  assert.equal(swapped.layers.find((l) => l.role === 'dealer-logo')!.x, 12, 'the moved logo stays moved');
  assert.equal(swapped.layers.length, moved.layers.length);
  assert.ok(!hasWordLayers(doc), 'a design carries its words in the picture');
  assert.ok(hasWordLayers(layoutCreative(input({}))), 'a layout sets them as layers');
  const none = swapPicture({ ...doc, layers: doc.layers.slice(1) }, { src: '/x.png' });
  assert.equal(none.layers[0]!.role, 'background', 'a picture is put under a creative that had none');
});

/* ---- the CarDekho ad set ---- */

test('the CarDekho ad set: five banners at their own pixels, words never too small to read', () => {
  const ads = CREATIVE_FORMATS.filter((f) => f.group === 'cardekho');
  assert.deepEqual(ads.map((f) => `${f.width}x${f.height}`), ['970x90', '720x90', '300x250', '300x600', '310x100']);
  assert.deepEqual(ads.map((f) => f.design), ['picture', 'picture', 'whole', 'whole', 'picture'], 'Nano Banana 2 draws no wider than 21:9');
  assert.deepEqual(pictureAspectsFor(ads.map((f) => f.id)), ['21:9', '5:4', '9:16'], 'the three strips share one picture');
  const offer = { ...COPY, badge: 'Benefits up to ₹50,000*', cta: 'Book a test drive', terms: '*T&C apply. Offer valid till 31 October.' };
  for (const f of ads) {
    for (const copy of [offer, LONG]) {
      for (const picture of [undefined, { src: '/api/refs/s/scene.png', mode: 'scene' as const }, { src: '/api/refs/p/front.jpg', mode: 'photo' as const }, { src: '/api/refs/d/design.png', mode: 'design' as const }]) {
        const where = `${f.id} · ${copy === LONG ? 'long' : 'offer'} · ${picture?.mode ?? 'no picture'}`;
        const doc = picture?.mode === 'design' ? layoutDesigned(input({ format: f.id, copy, picture })) : layoutCreative(input({ format: f.id, copy, picture }));
        assert.equal(validateCreativeDoc(doc), null, where);
        assert.equal(doc.width, f.width);
        assert.ok(!doc.layers.some((l) => l.role === 'panel'), `${where}: no dealer panel on a banner`);
        for (const l of doc.layers) {
          assert.ok(l.x >= -0.5 && l.y >= -0.5 && l.x + l.w <= f.width + 0.5 && l.y + l.h <= f.height + 0.5, `${where}: ${l.name} is outside the frame (${l.x},${l.y} ${l.w}×${l.h})`);
        }
        for (const l of words(doc)) {
          assert.ok(l.kind === 'text' && (l.minSize ?? l.size * 0.5) >= 8, `${where}: ${l.name} could shrink below 8px`);
        }
        assert.ok(doc.layers.some((l) => l.role === 'dealer-logo'), `${where}: the logo`);
        if (picture?.mode === 'design') {
          assert.ok(doc.layers.slice(1).every((l) => l.role === 'dealer-logo' || l.role === 'brand-logo'), `${where}: the design carries the words and the small print`);
        } else {
          const terms = doc.layers.find((l) => l.role === 'terms');
          assert.ok(terms && terms.kind === 'text' && terms.text.length <= 48, `${where}: the small print, short`);
          assert.ok(doc.layers.some((l) => l.role === 'headline'), `${where}: the headline`);
          assert.ok(doc.layers.some((l) => l.role === 'cta'), `${where}: the button`);
          const cta = doc.layers.find((l) => l.role === 'cta')!;
          const head = doc.layers.find((l) => l.role === 'headline')!;
          const clash = cta.x < head.x + head.w && head.x < cta.x + cta.w && cta.y < head.y + head.h && head.y < cta.y + cta.h;
          assert.ok(!clash, `${where}: the headline runs into the button`);
        }
      }
    }
  }
  // What Nano Banana 2 is asked to set on a banner: few words, no strip, the short small print.
  const rect = designWordsOf({ ...COPY, sub: 'A second line', points: ['One', 'Two'], terms: '*T&C apply. Offer valid till 31 October.' }, input({ format: 'cd-300x250' }));
  assert.deepEqual([rect.sub, rect.points, rect.strip, rect.terms], ['', [], undefined, '*T&C apply.']);
  const half = designWordsOf({ ...COPY, sub: 'A second line', points: ['One', 'Two'] }, input({ format: 'cd-300x600' }));
  assert.deepEqual([half.sub, half.points], ['A second line', []]);
  assert.deepEqual(pictureTrim('cd-300x600').sides, 'left-right');
  assert.ok(Math.abs(pictureTrim('landscape').each - 0.035) < 0.002);
});
