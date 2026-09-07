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
        shot: 'Wide exterior of the showroom facade and signage, presenter walking into frame.',
        shotAlt: 'Wide exterior of the showroom facade and signage, slow dolly in toward the entrance.',
        dialogue: 'Open outside the showroom, gesturing toward the facade, addressing camera.',
        card: ctx.dealerShort,
      },
      {
        title: 'Walk in',
        shot: 'Continuous gimbal tracking shot following the presenter through the glass doors onto the showroom floor.',
        shotAlt:
          'Continuous gimbal tracking shot moving through the glass doors onto the showroom floor, camera-led, no people in frame.',
        dialogue: 'Narrate the space naturally as the walk continues — one unbroken thought.',
      },
      {
        title: 'The zones',
        shot:
          'Continuing gimbal walk past: ' +
          (f(v, 'zonesToHighlight') || 'the main showroom zones') +
          ', holding on each for a beat.',
        dialogue: 'Cover the zones in one flowing walk without listing them mechanically.',
      },
      {
        title: 'Closing CTA',
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
    mandatory: [
      { id: 'feature1', label: 'At least one feature' },
      { id: 'benefit1', label: '…and what it means for the buyer' },
    ],
    avoid: [
      'Raw spec lists without translation into a benefit',
      '“Industry-first” claims with no explanation',
      'Naming a competitor unless the comparison beat is switched on',
    ],
    fields: [
      { id: 'feature1', label: 'Feature 1', type: 'text', ph: 'e.g. 6 airbags' },
      {
        id: 'benefit1',
        label: '→ Benefit / feeling',
        type: 'text',
        ph: 'e.g. your family is protected — peace of mind, not worry',
      },
      { id: 'feature2', label: 'Feature 2 (optional)', type: 'text', ph: 'e.g. 27.97 km/l hybrid mileage' },
      { id: 'benefit2', label: '→ Benefit / feeling', type: 'text', ph: 'e.g. months between fuel stops' },
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
        shot: "Slow macro pan across the car's signature detail — headlamp DRL, grille or badge — shallow depth of field.",
        dialogue: 'Open with the feeling or situation, not the spec.',
      });
      if (f(v, 'feature1')) {
        s.push({
          title: 'Feature 1',
          shot: 'Macro detail shot of ' + f(v, 'feature1') + ' with a slow rack focus.',
          dialogue:
            f(v, 'feature1') + ' translated into: ' + (f(v, 'benefit1') || 'the emotional payoff, one sentence'),
          card: f(v, 'feature1'),
        });
      }
      if (f(v, 'feature2')) {
        s.push({
          title: 'Feature 2',
          shot: 'Interior close-up or detail shot of ' + f(v, 'feature2') + ', slow slider move.',
          dialogue:
            f(v, 'feature2') + ' translated into: ' + (f(v, 'benefit2') || 'the emotional payoff, one sentence'),
          card: f(v, 'feature2'),
        });
      }
      if (f(v, 'competitorCompare')) {
        s.push({
          title: 'Competitive pivot',
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
        shot: 'Low-angle beauty shot of the EV, ambient light strip and closed grille in frame, silent glide-by.',
        dialogue: 'Open with a confident statement about driving electric — not apologetic, not overselling.',
      },
      {
        title: 'Address the concern',
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
        shot: 'Interior driver POV, hands on wheel, quiet pull-away; cabin ambience.',
        dialogue: 'What driving electric actually feels like — quiet, instant torque, effortless.',
      },
      {
        title: 'Credibility',
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
    mandatory: [{ id: 'location', label: 'Where the test drive happens' }],
    avoid: ['Making it sound transactional or high-pressure'],
    fields: [
      { id: 'location', label: 'Location', type: 'text', ph: 'e.g. the showroom, or an event location' },
      { id: 'dateWindow', label: 'Date / time window', type: 'text', ph: 'e.g. this weekend, 10am–6pm' },
    ],
    beats: (v, ctx): Beat[] => [
      {
        title: 'The invitation',
        shot: "Driver's door opening from outside, seat and wheel visible — an invitation into the car.",
        dialogue: 'Open with the feeling that makes someone want to get behind the wheel — not a pitch.',
      },
      {
        title: 'The drive',
        shot: 'Rolling low-angle tracking shot of the car on an open road, then interior POV over the wheel.',
        dialogue: 'Describe what the drive feels like — the road, the response, the seat.',
      },
      {
        title: 'No pressure',
        shot: 'Medium shot of the presenter beside the car at the showroom entrance.',
        shotAlt: 'Slow reveal of the car parked at the showroom entrance, doors closed.',
        dialogue: 'Make clear there is no pressure to buy — just come and experience it.',
      },
      {
        title: 'Logistics + CTA',
        shot: 'Wide showroom entrance shot with the car in frame.',
        dialogue:
          'State where and when: ' +
          (f(v, 'location') || 'the showroom') +
          (f(v, 'dateWindow') ? ', ' + f(v, 'dateWindow') : '') +
          '.',
        card: ctx.cta,
      },
    ],
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
        shot: isLaunchDay
          ? 'Full reveal — lights up on the car, wide hero angle.'
          : 'Silhouette or partial reveal under a cover, hard side light, detail glints only.',
        dialogue: isLaunchDay
          ? "Today it's real — say so plainly and confidently."
          : 'Open cryptic and confident. Hold the reveal back.',
      });
      s.push({
        title: 'The hint',
        shot: 'Single macro detail — one signature line, lamp or badge, nothing else readable.',
        dialogue: 'Give away exactly one detail: ' + (f(v, 'teaserHint') || 'one design, tech or name hint'),
      });
      s.push({
        title: 'Date',
        shot: 'Clean graphic beat over a dark frame or the covered car.',
        dialogue: 'State the date or countdown clearly.',
        card: f(v, 'launchDate') || 'Coming Soon',
      });
      s.push({
        title: 'CTA',
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
        shot: 'Medium two-shot at the car, then a close-up cutaway of the keys passing hand to hand.',
        shotAlt: 'Close-up of the keys resting on the bonnet, then a slow tilt up the car — hands only, no faces.',
        dialogue:
          'Show and narrate this specific moment: ' +
          (f(v, 'deliveryMoment') || 'the family receiving the car, a genuine reaction'),
        note: 'Let the reaction play — no graphics over this beat.',
      },
      {
        title: 'Why this was the right choice',
        shot: 'Slow orbit around the car with the family in frame.',
        shotAlt: 'Slow orbit around the car, showroom lights sweeping across the paint.',
        dialogue: 'One line validating the choice of this model — a feeling, not a spec.',
      },
      {
        title: 'Gratitude + the road ahead',
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
        shot: 'Medium shot, warm practical lighting, festive decor visible behind.',
        shotAlt: 'Detail shots of the festive decor — diya flames, marigold, warm bokeh — cut against the car.',
        dialogue:
          'Talk about what the occasion means to people — not what the car means. Human before commercial.',
      },
      {
        title: 'Dealer tie-in',
        shot: 'Slow push-in past the festive decor to the car on the showroom floor.',
        dialogue: 'One soft line linking the dealer to the occasion. Skip it if it feels forced.',
      },
      {
        title: 'Warm closing wish',
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
    mandatory: [{ id: 'cashDiscount', label: 'Cash discount amount' }],
    avoid: [
      'Percentage-off framing — use "up to ₹X" instead',
      'Vague "great offer" language',
      'More than three number cards in one video — the model drops the extras',
    ],
    fields: [
      { id: 'cashDiscount', label: 'Cash discount — amount only', type: 'text', ph: 'e.g. ₹2,25,000' },
      { id: 'downPayment', label: 'Down payment — amount only', type: 'text', ph: 'e.g. ₹0' },
      { id: 'interestRate', label: 'Interest rate — rate only', type: 'text', ph: 'e.g. 7.49%' },
      { id: 'warrantyYears', label: 'Warranty (years)', type: 'text', ph: 'e.g. 7' },
      { id: 'warrantyKm', label: 'Warranty (km)', type: 'text', ph: 'e.g. Unlimited' },
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
        shot: 'Wide exterior establishing shot, presenter addressing camera, showroom facade behind.',
        shotAlt: 'Wide exterior establishing shot of the showroom facade and signage, slow push-in.',
        dialogue: 'Open with a value headline or question hook for the model — energetic, not shouty.',
        card: ctx.dealerShort + ' Offers',
      });
      if (f(v, 'cashDiscount')) {
        s.push({
          title: 'Cash benefit',
          shot: 'Backward tracking shot as the presenter walks beside the car.',
          shotAlt:
            'Backward tracking shot moving along the flank of the car on the showroom floor, no people in frame.',
          dialogue:
            'State the cash benefit. Follow the number and currency rules — say the amount in words, never say "rupees".',
          card: stripSuffix(f(v, 'cashDiscount'), 'Cash Discount'),
          cardSub: 'Cash Discount',
        });
      }
      if (f(v, 'warrantyYears')) {
        s.push({
          title: 'Warranty',
          shot: 'Presenter stops beside the bonnet, gestures toward the car; shield icon card animates in.',
          shotAlt: 'Slow push-in on the bonnet and badge; shield icon card animates in over the shot.',
          dialogue:
            'State the warranty as ' +
            f(v, 'warrantyYears') +
            ' years, ' +
            (f(v, 'warrantyKm') || 'unlimited') +
            ' kilometres.',
          card: String(f(v, 'warrantyYears')).replace(/\s*years?$/i, '') + '-Year Warranty',
          cardSub: (f(v, 'warrantyKm') || 'Unlimited') + ' Kilometres',
          note: 'Use a shield icon on this card.',
        });
      }
      if (f(v, 'downPayment')) {
        s.push({
          title: 'Down payment',
          shot: 'Medium shot, presenter counting the benefit on her fingers.',
          shotAlt: 'Interior detail shot — dashboard and steering wheel, slow slider move.',
          dialogue: 'State the down payment framing.',
          card: stripSuffix(f(v, 'downPayment'), 'Down Payment'),
          cardSub: 'Down Payment',
        });
      }
      if (f(v, 'interestRate')) {
        s.push({
          title: 'Interest rate',
          shot: 'Medium shot beside the car, finance card replaces the previous card.',
          shotAlt: 'Front three-quarter beauty shot; finance card replaces the previous card.',
          dialogue:
            'State the interest rate. A decimal is read digit by digit in English style — 7.49% is "seven point four nine percent".',
          card: stripSuffix(f(v, 'interestRate'), 'Interest Rate'),
          cardSub: 'Interest Rate',
          note: 'Small print under the card: Terms & Conditions Apply',
        });
      }
      s.push({
        title: 'Urgency + CTA',
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
        shot: 'Handheld medium shot, customer beside their car, natural light, slight imperfection in the framing.',
        shotAlt: 'Handheld shot of the car in everyday surroundings, natural light.',
        dialogue:
          "Open on the customer's genuine reaction or their own words. Ordinary, unpolished delivery — not a presenter voice.",
      },
      {
        title: 'Context',
        shot: 'Cutaway to the car with the customer in soft focus behind.',
        shotAlt: 'Cutaway to the car in its everyday setting, shallow depth of field.',
        dialogue:
          'Establish who they are and what they bought: ' +
          (f(v, 'customerContext') || 'who they are, what they bought'),
      },
      {
        title: 'The moment',
        shot: 'Close-up on the customer speaking, then a matching detail shot of what they mention.',
        shotAlt: 'Detail shot of the feature being referenced, slow rack focus.',
        dialogue: 'Detail: ' + (f(v, 'specificMoment') || 'the moment or feature that won them over'),
      },
      {
        title: 'Dealer thanks',
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
