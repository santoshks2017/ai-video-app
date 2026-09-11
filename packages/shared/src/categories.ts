/**
 * Category library — 9 dealer ad-slot video categories.
 * Ported from the legacy tool's CATEGORIES array. Beat text is unchanged;
 * only the container shape and the `mode` classification are new.
 *
 * `mode`: all nine are 'automated'. The original PRD held four presenter-led
 * categories back as prompt-only on the belief that no model could lip-sync a
 * presenter — Omni Flash does, as the first real generations showed, so the
 * split was dropped (decisions.md 2026-09-07). 'presenter' remains in the type
 * so a future category or provider can opt out of automation.
 *
 * Beat shape: {title, shot, shotAlt?, dialogue?, card?, cardSub?, note?}
 *  - shot     : camera / shot-type direction
 *  - shotAlt  : shot used when no person is on camera (voiceover / silent)
 *  - dialogue : what is said; in silent mode rendered as a visual story beat
 *  - card     : EXACT on-screen string, collected into the spelling-lock block
 *  - role     : its place in one ad's arc (open / setup / point / proof / close)
 */

import type { Beat, BeatContext, CategoryDef, CategoryId } from './types.js';

export function stripSuffix(value: string | undefined, suffix: string): string {
  let v = String(value ?? '').trim();
  if (v.toLowerCase().slice(-suffix.length) === suffix.toLowerCase()) {
    v = v.slice(0, -suffix.length).trim();
  }
  return v;
}

const f = (o: Record<string, string>, k: string): string => String(o[k] ?? '').trim();

/**
 * The rows of a repeatable field, in order, skipping empty ones. A row counts if
 * either of its inputs has text, so a benefit typed before its feature is kept.
 */
export function listRows(
  v: Record<string, string>,
  id: string,
  opts: { subId?: string; max?: number } = {},
): { n: number; text: string; sub: string }[] {
  const rows: { n: number; text: string; sub: string }[] = [];
  for (let n = 1; n <= (opts.max ?? 20); n++) {
    const text = f(v, `${id}${n}`);
    const sub = opts.subId ? f(v, `${opts.subId}${n}`) : '';
    if (text || sub) rows.push({ n, text, sub });
  }
  return rows;
}

/** The highest numbered row that holds anything. */
export function listLength(v: Record<string, string>, id: string, subId?: string, max = 20): number {
  let last = 0;
  for (let n = 1; n <= max; n++) if (f(v, `${id}${n}`) || (subId && f(v, `${subId}${n}`))) last = n;
  return last;
}

/**
 * Offers used to be typed into fixed boxes — cash discount, warranty, down payment,
 * interest rate. Real dealer offers rarely fit those, so they are free text now. A
 * project saved the old way reads as free-text offers, in the order its boxes were
 * shown, until someone edits it.
 */
function legacyOffers(v: Record<string, string>): string[] {
  const out: string[] = [];
  if (f(v, 'cashDiscount')) out.push(f(v, 'cashDiscount'));
  if (f(v, 'warrantyYears')) {
    out.push(`${f(v, 'warrantyYears').replace(/\s*years?$/i, '')}-year warranty, ${f(v, 'warrantyKm') || 'unlimited'} km`);
  }
  if (f(v, 'downPayment')) out.push(`${stripSuffix(f(v, 'downPayment'), 'Down Payment')} down payment`);
  if (f(v, 'interestRate')) out.push(`${stripSuffix(f(v, 'interestRate'), 'Interest Rate')} interest rate`);
  return out;
}

/**
 * A category's values in the shape its current fields expect. The one place an
 * old saved shape is translated, so the editor, the beats, pre-flight and the
 * script writer all see the same thing.
 */
export function categoryValues(id: string, raw: Record<string, string> = {}): Record<string, string> {
  if (id !== 'offer' || listLength(raw, 'offer') > 0) return raw;
  const legacy = legacyOffers(raw);
  if (!legacy.length) return raw;
  const out = { ...raw };
  legacy.forEach((text, i) => {
    out[`offer${i + 1}`] = text;
  });
  return out;
}

/** A readable name for a stored field key, numbered list rows included ("Offer 3"). */
export function fieldLabel(cat: CategoryDef | undefined, key: string): string {
  const direct = cat?.fields.find((x) => x.id === key);
  if (direct) return direct.label;
  const numbered = (prefix: string): string | null => {
    const rest = key.startsWith(prefix) ? key.slice(prefix.length) : '';
    return /^\d+$/.test(rest) ? rest : null;
  };
  for (const field of cat?.fields ?? []) {
    if (field.type !== 'list' || !field.list) continue;
    const noun = field.list.noun.charAt(0).toUpperCase() + field.list.noun.slice(1);
    const n = numbered(field.id);
    if (n) return `${noun} ${n}`;
    const sn = field.list.sub ? numbered(field.list.sub.id) : null;
    if (sn) return `Why ${field.list.noun} ${sn} matters`;
  }
  return key;
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: 'walkaround',
    label: 'Showroom Walkaround',
    mode: 'automated',
    hue: 245,
    music: 'smooth premium bed, steady tempo for a continuous walk',
    purpose: 'Give the model-page visitor a feel for the showroom and the car in one continuous flow.',
    mandatory: [{ id: 'zonesToHighlight', label: 'The zones or features to walk through' }],
    avoid: [
      'A static, list-like tour with no narrative thread',
      'Cutting so often that the space stops reading as one place',
    ],
    fields: [
      {
        id: 'zonesToHighlight',
        label: 'Zones/features to walk through',
        type: 'textarea',
        ph: 'e.g. glass facade, delivery bay, the model on the floor, the accessories wall',
      },
    ],
    beats: (v, ctx): Beat[] => [
      {
        title: 'Exterior establishing',
        role: 'open',
        shot: 'Wide exterior of the showroom facade and signage, presenter walking into frame.',
        shotAlt: 'Wide exterior of the showroom facade and signage, slow dolly in toward the entrance.',
        dialogue: 'Open outside the showroom, gesturing toward the facade, addressing camera.',
        card: ctx.dealerShort,
      },
      {
        title: 'Walk in',
        role: 'setup',
        shot: 'Continuous gimbal tracking shot following the presenter through the glass doors onto the showroom floor.',
        shotAlt:
          'Continuous gimbal tracking shot moving through the glass doors onto the showroom floor, camera-led, no people in frame.',
        dialogue: 'Narrate the space naturally as the walk continues — one unbroken thought.',
      },
      {
        title: 'The zones',
        role: 'point',
        shot:
          'Continuing gimbal walk past: ' +
          (f(v, 'zonesToHighlight') || 'the main showroom zones') +
          ', holding on each for a beat.',
        dialogue: 'Cover the zones in one flowing walk without listing them mechanically.',
      },
      {
        title: 'Closing CTA',
        role: 'close',
        shot: 'Presenter stops beside the hero car, hand on the bonnet, camera settles.',
        shotAlt: 'Camera settles on the hero car, front three-quarter, showroom lighting.',
        dialogue: 'Invite the viewer to visit and see it in person.',
        card: ctx.cta,
      },
    ],
  },

  {
    id: 'feature',
    label: 'Product Feature',
    mode: 'automated',
    hue: 215,
    music: 'modern cinematic bed with a clean beat, confident and premium',
    purpose: 'Educate and desire. Turn specs into feelings, not a spec dump.',
    mandatory: [{ id: 'feature1', label: 'At least one feature', list: 'feature' }],
    avoid: [
      'Raw spec lists without translation into a benefit',
      '“Industry-first” claims with no explanation',
      'Naming a competitor unless the comparison beat is switched on',
    ],
    fields: [
      {
        id: 'feature',
        label: 'Features',
        type: 'list',
        ph: 'e.g. 6 airbags',
        list: {
          noun: 'feature',
          sub: { id: 'benefit', label: 'Why it matters (optional)', ph: 'e.g. your family is protected — peace of mind' },
          min: 2,
          max: 8,
        },
      },
      {
        id: 'identity',
        label: 'Who this car is right for',
        type: 'text',
        ph: 'e.g. young families who want one car for the city and the highway',
      },
      { id: 'competitorCompare', label: 'Pull a customer from a competitor model?', type: 'checkbox' },
      {
        id: 'competitorModel',
        label: 'Competitor model',
        type: 'text',
        ph: 'e.g. Honda Elevate',
        showIf: 'competitorCompare',
      },
      {
        id: 'customerSegment',
        label: "Customer's evident budget/segment",
        type: 'text',
        ph: 'e.g. mid-size SUV buyer',
        showIf: 'competitorCompare',
      },
    ],
    beats: (v, ctx): Beat[] => {
      const s: Beat[] = [];
      s.push({
        title: 'Desire hook',
        role: 'open',
        shot: "Slow macro pan across the car's signature detail — headlamp DRL, grille or badge — shallow depth of field.",
        dialogue: 'Open with the feeling or situation, not the spec.',
      });
      // One scene per feature, however many the dealer lists; the shots rotate so
      // a long list does not become the same macro shot four times over.
      const featureShots = [
        (x: string) => 'Macro detail shot of ' + x + ' with a slow rack focus.',
        (x: string) =>
          'Close-up of ' + x + " filmed through the open driver's door, slow slider move — anyone in shot sits in the driver's seat or stands outside at the door, never inside the cabin.",
        (x: string) => 'Slow orbiting shot that reveals ' + x + ', shallow depth of field.',
        (x: string) => 'Clean three-quarter shot framing ' + x + ', gentle push-in.',
      ];
      listRows(v, 'feature', { subId: 'benefit' })
        .filter((r) => r.text)
        .forEach((r, i) => {
          s.push({
            id: `feature-${i + 1}`,
            title: `Feature ${i + 1}`,
            role: 'point',
            shot: featureShots[i % featureShots.length]!(r.text),
            dialogue: r.text + ' translated into: ' + (r.sub || 'the emotional payoff, one sentence'),
            card: r.text,
          });
        });
      if (f(v, 'competitorCompare')) {
        s.push({
          title: 'Competitive pivot',
          role: 'proof',
          shot: 'Medium shot beside the car, presenter addressing camera directly.',
          shotAlt: 'Static medium shot of the car, comparison figures animating on screen.',
          dialogue:
            'Acknowledge interest in ' +
            (f(v, 'competitorModel') || 'the competitor model') +
            ' first, then land exactly one or two comparison points (on-road price, running cost, resale or EMI). Never criticise the competitor — it must read as upgrade advice. Stay in the ' +
            (f(v, 'customerSegment') || 'same or adjacent segment') +
            ' — never pitch a downgrade.',
        });
      }
      s.push({
        title: "Who it's for",
        role: 'proof',
        shot: 'Wide shot of the car on the showroom floor, presenter beside it or a clean beauty angle.',
        shotAlt: 'Clean wide beauty angle of the car on the showroom floor.',
        dialogue:
          'One line on who this car is right for: ' + (f(v, 'identity') || 'name the driver this model fits'),
      });
      return s;
    },
  },

  {
    id: 'ev',
    label: 'EV / Electric',
    mode: 'automated',
    hue: 175,
    music: 'clean modern electronic bed, futuristic and calm',
    purpose: 'Convert skeptics, excite believers. Position EV as an upgrade, not a compromise.',
    mandatory: [{ id: 'concernOrHighlight', label: 'The concern to address or tech to highlight' }],
    avoid: ['Overpromising range with no qualifier', 'Ignoring the stated buyer persona'],
    fields: [
      {
        id: 'personaSegment',
        label: 'Who is this speaking to?',
        type: 'select',
        options: [
          'The Range Skeptic — needs reassurance on range and charging',
          'The Progressive Achiever — wants early-adopter status',
          'The Cost Calculator — wants running-cost maths',
          'The Values Driver — environment and sustainability',
        ],
      },
      {
        id: 'concernOrHighlight',
        label: 'Concern to address OR tech to highlight',
        type: 'text',
        ph: 'e.g. real-world range, battery safety, fast-charging time',
      },
    ],
    beats: (v): Beat[] => [
      {
        title: 'Future-forward hook',
        role: 'open',
        shot: 'Low-angle beauty shot of the EV, ambient light strip and closed grille in frame, silent glide-by.',
        dialogue: 'Open with a confident statement about driving electric — not apologetic, not overselling.',
      },
      {
        title: 'Address the concern',
        role: 'point',
        shot: 'Macro shot of the charging port with the cable going in, then the range readout on the display.',
        dialogue:
          'Speak to ' +
          (f(v, 'personaSegment') || 'the target buyer') +
          '. Cover: ' +
          (f(v, 'concernOrHighlight') || 'one concrete range, charging or tech point'),
        card: f(v, 'concernOrHighlight'),
      },
      {
        title: 'What it feels like',
        role: 'point',
        shot: 'Interior driver POV, hands on wheel, quiet pull-away; cabin ambience.',
        dialogue: 'What driving electric actually feels like — quiet, instant torque, effortless.',
      },
      {
        title: 'Credibility',
        role: 'proof',
        shot: 'Wide shot of the EV on the showroom floor under clean lighting.',
        dialogue: 'One line of credibility — safety testing, battery warranty or scale.',
      },
    ],
  },

  {
    id: 'testdrive',
    label: 'Test Drive',
    mode: 'automated',
    hue: 130,
    music: 'light, inviting acoustic-modern bed',
    purpose: 'Remove the commitment barrier — make it feel like an experience, not a sales visit.',
    mandatory: [{ id: 'location', label: 'Where the test drive or ride happens' }],
    avoid: ['Making it sound transactional or high-pressure'],
    fields: [
      { id: 'location', label: 'Location', type: 'text', ph: 'e.g. the showroom, or an event location' },
      { id: 'dateWindow', label: 'Date / time window', type: 'text', ph: 'e.g. this weekend, 10am–6pm' },
    ],
    beats: (v, ctx): Beat[] => {
      const bike = ctx.vehicle === 'bike';
      const vehicle = bike ? 'bike' : 'car';
      return [
        {
          title: 'The invitation',
          role: 'open',
          shot: bike
            ? 'Hand settling on the handlebar and the key turning, seat and console in frame — an invitation to ride.'
            : "Driver's door opening from outside, seat and wheel visible — an invitation into the car.",
          dialogue: bike
            ? 'Open with the feeling that makes someone want to get on and ride — not a pitch.'
            : 'Open with the feeling that makes someone want to get behind the wheel — not a pitch.',
        },
        {
          id: 'experience',
          title: bike ? 'The ride' : 'The drive',
          role: 'point',
          shot: bike
            ? 'Rolling low-angle tracking shot of the bike on an open road, then a rider POV over the handlebar.'
            : 'Rolling low-angle tracking shot of the car on an open road, then interior POV over the wheel.',
          dialogue: bike
            ? 'Describe what the ride feels like — the road, the pull, the balance.'
            : 'Describe what the drive feels like — the road, the response, the seat.',
        },
        {
          title: 'No pressure',
          role: 'proof',
          shot: `Medium shot of the presenter beside the ${vehicle} at the showroom entrance.`,
          shotAlt: bike
            ? 'Slow reveal of the bike parked at the showroom entrance.'
            : 'Slow reveal of the car parked at the showroom entrance, doors closed.',
          dialogue: `Make clear there is no pressure to buy — just come in for a ${ctx.trial}.`,
        },
        {
          title: 'Logistics + CTA',
          role: 'close',
          shot: `Wide showroom entrance shot with the ${vehicle} in frame.`,
          dialogue:
            'State where and when: ' +
            (f(v, 'location') || 'the showroom') +
            (f(v, 'dateWindow') ? ', ' + f(v, 'dateWindow') : '') +
            '.',
          card: ctx.cta,
        },
      ];
    },
  },

  {
    id: 'newlaunch',
    label: 'New Launch',
    mode: 'automated',
    hue: 275,
    music: 'building anticipation track with a clear drop at the reveal',
    purpose: 'Build hype and anticipation — make the audience feel like insiders.',
    mandatory: [{ id: 'launchDate', label: 'Launch date or countdown' }],
    avoid: ['Giving away the full car in a pre-launch teaser', 'A flat feature-list reveal with no build-up'],
    fields: [
      {
        id: 'launchPhase',
        label: 'Phase',
        type: 'select',
        options: [
          'Pre-launch teaser — tease, mystify, count down',
          'Launch day — reveal, celebrate, book now',
          'Post-launch — first impressions, test drive invite',
        ],
      },
      { id: 'launchDate', label: 'Date / countdown', type: 'text', ph: 'e.g. 15th October, or 1 Day To Go' },
      { id: 'teaserHint', label: 'One hint to give away', type: 'text', ph: 'e.g. a new design language, a name, a tech first' },
    ],
    beats: (v, ctx): Beat[] => {
      const isLaunchDay = f(v, 'launchPhase').indexOf('Launch day') === 0;
      const s: Beat[] = [];
      s.push({
        title: 'Curiosity hook',
        role: 'open',
        shot: isLaunchDay
          ? 'Full reveal — lights up on the car, wide hero angle.'
          : 'Silhouette or partial reveal under a cover, hard side light, detail glints only.',
        dialogue: isLaunchDay
          ? "Today it's real — say so plainly and confidently."
          : 'Open cryptic and confident. Hold the reveal back.',
      });
      s.push({
        title: 'The hint',
        role: 'point',
        shot: 'Single macro detail — one signature line, lamp or badge, nothing else readable.',
        dialogue: 'Give away exactly one detail: ' + (f(v, 'teaserHint') || 'one design, tech or name hint'),
      });
      s.push({
        title: 'Date',
        role: 'point',
        shot: 'Clean graphic beat over a dark frame or the covered car.',
        dialogue: 'State the date or countdown clearly.',
        card: f(v, 'launchDate') || 'Coming Soon',
      });
      s.push({
        title: 'CTA',
        role: 'close',
        shot: isLaunchDay
          ? 'Wide hero shot of the car with the presenter or showroom behind.'
          : 'Slow pull-back from the covered car.',
        shotAlt: isLaunchDay
          ? 'Wide hero shot of the car on the showroom floor.'
          : 'Slow pull-back from the covered car.',
        dialogue: isLaunchDay ? 'Invite them to book or visit now.' : 'Invite them to join the waiting list.',
        card: ctx.cta,
      });
      return s;
    },
  },

  {
    id: 'delivery',
    label: 'Delivery / Handover',
    mode: 'automated',
    hue: 350,
    music: 'warm emotional uplifting track, soft piano into strings',
    purpose: "Celebrate the customer's new car purchase — the highest-emotion content type.",
    mandatory: [{ id: 'deliveryMoment', label: 'The handover moment' }],
    avoid: [
      'Price or discount mentions — this is an emotional post, not an offer post',
      'Competitor references',
      'Generic stock phrases with no real emotion',
    ],
    fields: [
      { id: 'customerName', label: 'Customer name (optional)', type: 'text', ph: 'Leave blank to use "our valued customer"' },
      {
        id: 'deliveryMoment',
        label: 'Describe the handover moment',
        type: 'textarea',
        ph: 'e.g. young family, kids seeing the car for the first time, keys handed over outside the showroom',
      },
    ],
    beats: (v, ctx): Beat[] => [
      {
        title: 'Welcome + congratulations',
        role: 'open',
        shot: 'Wide exterior establishing shot of the showroom with the new car and the family, slow push-in.',
        shotAlt:
          'Wide exterior establishing shot of the showroom with the new car outside, ribbon or garland on the bonnet, slow push-in, no people in frame.',
        dialogue:
          'Congratulate ' +
          (f(v, 'customerName') || 'our valued customer') +
          ' by name and name the model. Warm and genuine, not scripted.',
        card: 'Welcome to the ' + ctx.dealerShort + ' family',
      },
      {
        title: 'The handover moment',
        role: 'point',
        shot: 'Medium two-shot at the car, then a close-up cutaway of the keys passing hand to hand.',
        shotAlt: 'Close-up of the keys resting on the bonnet, then a slow tilt up the car — hands only, no faces.',
        dialogue:
          'Show and narrate this specific moment: ' +
          (f(v, 'deliveryMoment') || 'the family receiving the car, a genuine reaction'),
        note: 'Let the reaction play — no graphics over this beat.',
      },
      {
        title: 'Why this was the right choice',
        role: 'proof',
        shot: 'Slow orbit around the car with the family in frame.',
        shotAlt: 'Slow orbit around the car, showroom lights sweeping across the paint.',
        dialogue: 'One line validating the choice of this model — a feeling, not a spec.',
      },
      {
        title: 'Gratitude + the road ahead',
        role: 'close',
        shot: 'Wide shot, family beside the car, presenter or dealer team gesturing toward the road.',
        shotAlt: 'Wide shot of the car pulling out of the showroom driveway onto the road.',
        dialogue: 'Thank the customer and gesture toward the journeys ahead with this car.',
        card: 'Your story on the road begins now',
      },
    ],
  },

  {
    id: 'festival',
    label: 'Festival / Occasion',
    // Picked with other use cases, the festival is the setting — see buildBeats.
    layer: 'theme',
    mode: 'automated',
    hue: 60,
    music: 'warm festive underscore with light percussion, celebratory but not loud',
    purpose: 'Connect the brand with a cultural moment. Emotion first — never lead with price.',
    mandatory: [{ id: 'occasionName', label: 'Occasion name' }],
    avoid: [
      'Leading with price or discount language during a festival beat',
      'Generic "happy [festival]" with no dealer voice',
    ],
    fields: [
      { id: 'occasionName', label: 'Occasion', type: 'text', ph: "e.g. Diwali, Raksha Bandhan, Father's Day" },
      {
        id: 'occasionType',
        label: 'Occasion type (sets the tone)',
        type: 'select',
        options: [
          'Hindu festival — warm, celebratory, blessings',
          'Islamic occasion — inclusive, community-focused',
          'National day — pride-forward, mission-linked',
          'International awareness day — educational, brand philosophy',
          "Personal occasion (Father's/Mother's Day) — emotional, no product push",
        ],
      },
      {
        id: 'festiveDressing',
        label: 'Festive dressing in frame',
        type: 'text',
        ph: 'e.g. marigold garlands, diyas at the entrance, rangoli on the showroom floor',
      },
    ],
    beats: (v, ctx): Beat[] => [
      {
        title: 'Occasion greeting',
        role: 'open',
        shot:
          'Wide exterior of the showroom dressed for the occasion' +
          (f(v, 'festiveDressing') ? ' — ' + f(v, 'festiveDressing') : '') +
          ', presenter centred.',
        shotAlt:
          'Wide exterior of the showroom dressed for the occasion' +
          (f(v, 'festiveDressing') ? ' — ' + f(v, 'festiveDressing') : '') +
          ', no people in frame.',
        dialogue:
          'Open with a sincere, specific greeting for ' +
          (f(v, 'occasionName') || 'the occasion') +
          '. Tone: ' +
          (f(v, 'occasionType') || 'warm and celebratory') +
          '.',
        card: 'Happy ' + (f(v, 'occasionName') || '[Occasion]'),
      },
      {
        title: 'Emotional connection',
        role: 'setup',
        shot: 'Medium shot, warm practical lighting, festive decor visible behind.',
        shotAlt: 'Detail shots of the festive decor — diya flames, marigold, warm bokeh — cut against the car.',
        dialogue:
          'Talk about what the occasion means to people — not what the car means. Human before commercial.',
      },
      {
        title: 'Dealer tie-in',
        role: 'setup',
        shot: 'Slow push-in past the festive decor to the car on the showroom floor.',
        dialogue: 'One soft line linking the dealer to the occasion. Skip it if it feels forced.',
      },
      {
        title: 'Warm closing wish',
        role: 'close',
        shot: 'Presenter beside the car, warm smile, festive bokeh behind.',
        shotAlt: 'Hero shot of the car with festive bokeh behind, slow push-in.',
        dialogue: 'Close with a warm occasion wish, then a light invitation to visit the showroom.',
        card: f(v, 'occasionName')
          ? f(v, 'occasionName') + ' greetings from ' + ctx.dealerShort
          : 'Greetings from ' + ctx.dealerShort,
      },
    ],
  },

  {
    id: 'offer',
    label: 'Offer / Deal',
    mode: 'automated',
    hue: 165,
    music: 'upbeat modern commercial track, energetic but sitting under the voice',
    purpose: 'Drive leads. Create urgency without cheapening the brand. Clarity over cleverness.',
    mandatory: [{ id: 'offer1', label: 'At least one offer', list: 'offer' }],
    avoid: [
      'Percentage-off framing — use "up to ₹X" instead',
      'Vague "great offer" language',
      'More than three number cards in one video — the viewer remembers none of them',
    ],
    fields: [
      {
        // Free text, not categories: a dealer's offer is "Benefits up to ₹1.5 lakh"
        // or "free 5-year service pack", and rarely fits a cash / EMI / warranty box.
        id: 'offer',
        label: 'Offers & benefits',
        type: 'list',
        ph: 'e.g. Benefits up to ₹1.5 lakh on select variants',
        list: { noun: 'offer', min: 2, max: 8 },
      },
      {
        id: 'expirySignal',
        label: 'Urgency / expiry signal',
        type: 'text',
        ph: 'e.g. this month only, limited units, before the price hike',
      },
    ],
    beats: (v, ctx): Beat[] => {
      const s: Beat[] = [];
      s.push({
        title: 'Attention hook',
        role: 'open',
        shot: 'Wide exterior establishing shot, presenter addressing camera, showroom facade behind.',
        shotAlt: 'Wide exterior establishing shot of the showroom facade and signage, slow push-in.',
        dialogue: 'Open with a value headline or question hook for the model — energetic, not shouty.',
        card: ctx.dealerShort + ' Offers',
      });
      // One scene per offer, as the dealer wrote it. The offer's own words are the
      // caption; the spoken line comes from the script, so the text never sits in
      // the video prompt for the model to draw or say twice.
      const offerShots: [string, string][] = [
        [
          'Backward tracking shot as the presenter walks beside the car.',
          'Backward tracking shot moving along the flank of the car on the showroom floor, no people in frame.',
        ],
        ['Presenter stops beside the bonnet and gestures toward the car.', 'Slow push-in on the bonnet and badge.'],
        ['Medium shot beside the car, presenter addressing camera.', 'Interior detail shot — dashboard and steering wheel, slow slider move.'],
        ['Medium shot at the driver door, presenter opening it toward camera.', 'Front three-quarter beauty shot, slow arc.'],
      ];
      listRows(v, 'offer')
        .filter((r) => r.text)
        .forEach((r, i) => {
          const [shot, shotAlt] = offerShots[i % offerShots.length]!;
          s.push({
            id: `offer-${i + 1}`,
            title: `Offer ${i + 1}`,
            role: 'point',
            shot,
            shotAlt,
            dialogue:
              'State this offer in one clear sentence — what the buyer gets. Say amounts in plain English words and never say "rupees".',
            card: r.text,
          });
        });
      s.push({
        title: 'Urgency + CTA',
        role: 'close',
        shot: 'Wide frontal shot with the car behind the presenter, slow push-in.',
        shotAlt: 'Wide frontal hero shot of the car, slow push-in.',
        dialogue:
          'Land the urgency signal (' +
          (f(v, 'expirySignal') || 'limited-time offer') +
          ') and close on the call to action.',
        card: ctx.cta,
      });
      return s;
    },
  },

  {
    id: 'testimonial',
    label: 'Customer Testimonial',
    mode: 'automated',
    hue: 320,
    music: 'soft warm bed, low — the voice carries this one',
    purpose: 'Social proof — let a real customer sell for you.',
    mandatory: [
      { id: 'customerContext', label: 'Who the customer is' },
      { id: 'specificMoment', label: 'The specific moment they loved' },
    ],
    avoid: [
      'Sounding scripted or stock — keep it specific to this customer',
      'Over-polished delivery; small hesitations read as real',
    ],
    fields: [
      {
        id: 'customerContext',
        label: 'Who they are / what they bought',
        type: 'text',
        ph: 'e.g. a first-time buyer, bought the Nexon EV for a daily commute',
      },
      {
        id: 'specificMoment',
        label: 'The specific moment or feature they loved',
        type: 'textarea',
        ph: 'e.g. how easy the paperwork was, the feature that won them over',
      },
    ],
    beats: (v, ctx): Beat[] => [
      {
        title: 'Customer reaction',
        role: 'open',
        shot: 'Handheld medium shot, customer beside their car, natural light, slight imperfection in the framing.',
        shotAlt: 'Handheld shot of the car in everyday surroundings, natural light.',
        dialogue:
          "Open on the customer's genuine reaction or their own words. Ordinary, unpolished delivery — not a presenter voice.",
      },
      {
        title: 'Context',
        role: 'setup',
        shot: 'Cutaway to the car with the customer in soft focus behind.',
        shotAlt: 'Cutaway to the car in its everyday setting, shallow depth of field.',
        dialogue:
          'Establish who they are and what they bought: ' +
          (f(v, 'customerContext') || 'who they are, what they bought'),
      },
      {
        title: 'The moment',
        role: 'point',
        shot: 'Close-up on the customer speaking, then a matching detail shot of what they mention.',
        shotAlt: 'Detail shot of the feature being referenced, slow rack focus.',
        dialogue: 'Detail: ' + (f(v, 'specificMoment') || 'the moment or feature that won them over'),
      },
      {
        title: 'Dealer thanks',
        role: 'close',
        shot: 'Wide shot of the customer and the dealership team beside the car.',
        shotAlt: 'Wide shot of the car outside the showroom, dealership signage in frame.',
        dialogue: 'The dealer thanks the customer and invites viewers to have their own experience.',
        card: ctx.cta,
      },
    ],
  },
];

export const CATEGORY_BY_ID: Record<CategoryId, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, CategoryDef>;

export const AUTOMATED_CATEGORY_IDS: CategoryId[] = CATEGORIES.filter((c) => c.mode === 'automated').map(
  (c) => c.id,
);
export const PRESENTER_CATEGORY_IDS: CategoryId[] = CATEGORIES.filter((c) => c.mode === 'presenter').map(
  (c) => c.id,
);

/** A brief is prompt-only (no API call) if ANY selected category is presenter-led. */
export function isPromptOnly(categories: CategoryId[]): boolean {
  return categories.some((id) => CATEGORY_BY_ID[id]?.mode === 'presenter');
}

export type { BeatContext };
