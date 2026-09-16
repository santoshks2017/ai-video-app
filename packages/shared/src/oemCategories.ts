/**
 * What a manufacturer makes films about.
 *
 * A dealership's films sell the showroom down the road: come in, take a test drive,
 * here is this month's offer. A manufacturer's sell the car and the marque to the
 * whole country, and the formats are its own — a launch told in five beats over
 * weeks, a product film, a technology explainer, a safety rating, an owner's story,
 * an anniversary. These are those, taken from what the mass, premium and luxury
 * brands actually post.
 *
 * The difference between segments is emphasis, not format: a mass brand leads on
 * price, mileage and safety, a premium brand on design and technology, a luxury
 * brand never mentions price at all. So the segment shapes the copy (it reaches the
 * script as the brand's own style note), and the use cases stay the same.
 *
 * Everything else about a film — the storyboard, the vehicle, the presenter, the
 * generation — works exactly as it does for a dealership.
 */
import type { Beat, BeatContext, CategoryDef } from './types.js';

const f = (v: Record<string, string>, k: string): string => String(v[k] ?? '').trim();

/** The rows of a list field, stored as numbered keys: proof1, proof2… */
function rows(v: Record<string, string>, id: string, max = 8): string[] {
  const out: string[] = [];
  for (let i = 1; i <= max; i += 1) {
    const value = f(v, `${id}${i}`);
    if (value) out.push(value);
  }
  return out;
}

/** The brand as the film says it, and the line it signs off with. */
const brandOf = (ctx: BeatContext): string => ctx.brandName || ctx.dealerShort;

export const OEM_CATEGORIES: CategoryDef[] = [
  {
    id: 'oemlaunch',
    label: 'Launch moment',
    audience: 'oem',
    mode: 'automated',
    hue: 275,
    music: 'anticipation building to a single clean drop at the reveal',
    purpose: 'One beat of a launch, told on its own: the tease, the reveal, the bookings, the price, the first cars out.',
    mandatory: [{ id: 'launchPhase', label: 'Which moment this film is' }],
    avoid: [
      'Showing the whole car in a teaser — the tease is the point',
      'Reading a spec sheet on launch day instead of landing one idea',
    ],
    fields: [
      {
        id: 'launchPhase',
        label: 'The moment',
        type: 'select',
        options: [
          'Teaser — hold the car back',
          'Unveil — the full reveal',
          'Bookings open',
          'Price announcement',
          'First deliveries',
        ],
      },
      { id: 'launchDate', label: 'Date or countdown', type: 'text', ph: 'e.g. 15 October, or 3 days to go' },
      { id: 'hook', label: 'The one thing to lead with', type: 'text', ph: 'e.g. a new design language, a segment-first feature, the name' },
      { id: 'priceOrAmount', label: 'Price or booking amount, if this film states one', type: 'text', ph: 'e.g. starting at seven lakh ninety nine thousand' },
    ],
    beats: (v, ctx): Beat[] => {
      const phase = f(v, 'launchPhase');
      const teaser = phase.startsWith('Teaser');
      const unveil = phase.startsWith('Unveil');
      const bookings = phase.startsWith('Bookings');
      const price = phase.startsWith('Price');
      const hook = f(v, 'hook');
      const when = f(v, 'launchDate');
      const amount = f(v, 'priceOrAmount');
      const beats: Beat[] = [
        {
          title: 'The hook',
          role: 'open',
          shot: teaser
            ? 'Near-dark studio. One hard light rakes across a covered car; only a signature line catches it.'
            : 'Lights rise on the car in full, wide hero angle, slow push in.',
          shotAlt: teaser
            ? 'Near-dark studio, one hard light across the covered car, camera drifting past.'
            : 'Wide hero angle on the car, lights rising, slow push in.',
          dialogue: teaser
            ? 'Open cryptic and certain. Name nothing the film is holding back.'
            : `Name the car and ${brandOf(ctx)} in the first line, and say what makes this the moment.`,
          card: teaser ? 'Coming soon' : undefined,
        },
        {
          title: teaser ? 'The one clue' : 'What it is',
          role: 'point',
          shot: teaser
            ? 'Macro on a single detail — a lamp signature, a badge, one crease — nothing else readable.'
            : 'Exterior detail run: front signature, profile, wheel, rear, each held a beat.',
          dialogue: teaser
            ? `Give away exactly one thing: ${hook || 'one design, technology or name clue'}.`
            : `Say what it is and who it is for, around ${hook || 'the one idea this car is built on'}.`,
        },
      ];
      if (bookings || price) {
        beats.push({
          title: price ? 'The price' : 'How to book',
          role: 'point',
          shot: 'Clean graphic beat — the car held still, room around it for the number.',
          dialogue: price
            ? `State the price plainly, once: ${amount || 'the launch price'}.`
            : `Say bookings are open and what it takes: ${amount || 'the booking amount'}.`,
          card: amount || (price ? 'Price announced' : 'Bookings open'),
        });
      }
      beats.push({
        title: phase.startsWith('First deliveries') ? 'The first owners' : 'The date',
        role: 'point',
        shot: phase.startsWith('First deliveries')
          ? 'Delivery bay, keys handed over, families beside their new cars, natural light.'
          : 'The car held in one clean frame, space for the date to sit.',
        dialogue: phase.startsWith('First deliveries')
          ? 'Talk about the cars reaching their owners, not about the launch.'
          : `State the date clearly: ${when || 'the launch date'}.`,
        card: phase.startsWith('First deliveries') ? 'Now with their owners' : when || undefined,
      });
      beats.push({
        title: 'Sign off',
        role: 'close',
        shot: 'Hero frame of the car, badge in focus, brand mark settling on screen.',
        dialogue: teaser
          ? 'Ask them to watch this space — never to buy yet.'
          : `Close on ${brandOf(ctx)} and the one action this film asks for.`,
        card: ctx.cta,
      });
      return beats;
    },
  },

  {
    id: 'oemproduct',
    label: 'Product film',
    audience: 'oem',
    mode: 'automated',
    hue: 210,
    music: 'cinematic bed with a confident, unhurried pulse',
    purpose: 'The car as the brand wants it seen: one promise, three proofs, no shopping list.',
    mandatory: [{ id: 'promise', label: 'The one promise this car makes' }],
    avoid: ['A feature list read out over beauty shots', 'Claiming everything, so the film claims nothing'],
    fields: [
      { id: 'promise', label: 'The one promise', type: 'text', ph: 'e.g. the SUV that makes long drives feel short' },
      {
        id: 'proof',
        label: 'What proves it',
        type: 'list',
        list: { noun: 'proof point', min: 3, max: 6 },
        ph: 'e.g. 600 km of range',
      },
      { id: 'setting', label: 'Where it is shot', type: 'text', ph: 'e.g. coastal highway at first light, city at night' },
    ],
    beats: (v, ctx): Beat[] => {
      const proofs = rows(v, 'proof');
      const place = f(v, 'setting') || 'the road this car belongs on';
      const beats: Beat[] = [
        {
          title: 'The promise',
          role: 'open',
          shot: `Wide establishing shot in ${place}, the car moving into frame, unhurried.`,
          dialogue: `Open on the promise, not the car: ${f(v, 'promise') || 'what this car is for'}.`,
        },
      ];
      proofs.forEach((p, i) => {
        beats.push({
          id: `proof${i + 1}`,
          title: `Proof ${i + 1}`,
          role: 'point',
          shot:
            i === 0
              ? 'Exterior in motion — tracking alongside, low and close.'
              : i === 1
                ? 'Interior at the wheel, hands and controls, light moving through the cabin.'
                : 'Detail that carries the claim, held long enough to read.',
          dialogue: `One line on ${p}, said as what it does for the person, never as a number alone.`,
          card: p,
        });
      });
      beats.push({
        title: 'Sign off',
        role: 'close',
        shot: 'The car at rest in the last light of the location, brand mark settling on screen.',
        dialogue: `Land the promise again in different words, and close on ${brandOf(ctx)}.`,
        card: ctx.cta,
      });
      return beats;
    },
  },

  {
    id: 'oemdesign',
    label: 'Design walkaround',
    audience: 'oem',
    mode: 'automated',
    hue: 190,
    music: 'clean minimal bed, one instrument, space between notes',
    purpose: 'The design language, read off the car itself — front, profile, rear, cabin.',
    mandatory: [{ id: 'designLine1', label: 'The design signatures to read', list: 'designLine' }],
    avoid: ['Naming colours and wheels as if that were design', 'A showroom walkaround — this is the car, not a place'],
    fields: [
      {
        id: 'designLine',
        label: 'Design signatures',
        type: 'list',
        list: { noun: 'signature', min: 3, max: 6 },
        ph: 'e.g. connected LED signature',
      },
      { id: 'designIdea', label: 'The idea behind the design', type: 'text', ph: 'e.g. drawn from the brand’s EV design language' },
    ],
    beats: (v, ctx): Beat[] => {
      const lines = rows(v, 'designLine');
      const beats: Beat[] = [
        {
          title: 'First look',
          role: 'open',
          shot: 'Slow orbit starting at the front three-quarter, studio light sweeping the body.',
          dialogue: `Open on the idea behind the shape: ${f(v, 'designIdea') || 'what this design is saying'}.`,
        },
      ];
      const shots = [
        'Front on — lamp signature and grille, camera rising.',
        'Profile — tracking the full length, wheels and shoulder line.',
        'Rear three-quarter — tail signature lighting up.',
        'Cabin — dashboard sweep, materials and screen in one move.',
      ];
      (lines.length ? lines : ['the front', 'the profile', 'the rear']).forEach((line, i) => {
        beats.push({
          id: `design${i + 1}`,
          title: `Signature ${i + 1}`,
          role: 'point',
          shot: shots[i] ?? 'Detail shot, held steady, light moving across the surface.',
          dialogue: `Read ${line} as design — what it does for the car's stance or its light.`,
          card: line,
        });
      });
      beats.push({
        title: 'Sign off',
        role: 'close',
        shot: 'Pull back to the full car, badge catching the light.',
        dialogue: `Close on the car as a whole, and on ${brandOf(ctx)}.`,
        card: ctx.cta,
      });
      return beats;
    },
  },

  {
    id: 'oemtech',
    label: 'Feature & technology',
    audience: 'oem',
    mode: 'automated',
    hue: 160,
    music: 'precise modern bed, light percussion under a clear voice',
    purpose: 'One piece of technology explained until it is obvious why it matters.',
    mandatory: [{ id: 'featureName', label: 'The feature this film explains' }],
    avoid: ['Explaining three features instead of one', 'Engineering language with no human consequence'],
    fields: [
      { id: 'featureName', label: 'The feature', type: 'text', ph: 'e.g. level 2 ADAS, 360° camera, ventilated seats' },
      { id: 'howItWorks', label: 'How it works, plainly', type: 'textarea', ph: 'e.g. radar and camera watch the lane and the car ahead' },
      { id: 'whyItMatters', label: 'What it changes for the driver', type: 'text', ph: 'e.g. a two-hour highway run stops being tiring' },
    ],
    beats: (v, ctx): Beat[] => [
      {
        title: 'The moment it matters',
        role: 'open',
        shot: 'The everyday situation this feature is for — traffic, a tight parking bay, a night highway.',
        dialogue: `Open on the situation, not the technology: ${f(v, 'whyItMatters') || 'the moment this feature is for'}.`,
      },
      {
        title: 'The feature',
        role: 'point',
        shot: 'The control, screen or sensor in use, framed close, hands in shot.',
        dialogue: `Name it once and say what it does: ${f(v, 'featureName') || 'the feature'}.`,
        card: f(v, 'featureName') || undefined,
      },
      {
        title: 'How it works',
        role: 'point',
        shot: 'The car in motion from outside, then the driver’s view — cause and effect in two shots.',
        dialogue: `Explain it plainly: ${f(v, 'howItWorks') || 'how it works, in one sentence a passenger would understand'}.`,
      },
      {
        title: 'Sign off',
        role: 'close',
        shot: 'The car settles at the end of the drive, badge in frame.',
        dialogue: `Say what it leaves the driver with, and close on ${brandOf(ctx)}.`,
        card: ctx.cta,
      },
    ],
  },

  {
    id: 'oemev',
    label: 'EV explainer',
    audience: 'oem',
    mode: 'automated',
    hue: 140,
    music: 'clean electric bed, quiet and forward-moving',
    purpose: 'Answer the one thing keeping a buyer off an electric car, with numbers.',
    mandatory: [{ id: 'concern', label: 'The doubt this film answers' }],
    avoid: ['Talking about saving the planet instead of the doubt', 'Range figures with no conditions behind them'],
    fields: [
      {
        id: 'concern',
        label: 'The doubt',
        type: 'select',
        options: ['Range', 'Charging time and access', 'Running cost', 'Performance', 'Battery life and service'],
      },
      { id: 'numbers', label: 'The numbers that answer it', type: 'text', ph: 'e.g. 600 km claimed range, 20 to 80 percent in 20 minutes' },
      { id: 'proofDrive', label: 'The drive that shows it', type: 'text', ph: 'e.g. a Delhi to Jaipur run on one charge' },
    ],
    beats: (v, ctx): Beat[] => [
      {
        title: 'The doubt, said out loud',
        role: 'open',
        shot: 'Driver at the wheel, city moving past, calm and ordinary.',
        dialogue: `Say the doubt plainly — ${f(v, 'concern') || 'the thing people ask first'} — as a real question, not a straw man.`,
      },
      {
        title: 'The answer',
        role: 'point',
        shot: 'Instrument cluster or charging screen, figures readable, then the car moving.',
        dialogue: `Answer with the numbers: ${f(v, 'numbers') || 'the figures that settle it'}.`,
        card: f(v, 'numbers') || undefined,
      },
      {
        title: 'Shown, not claimed',
        role: 'point',
        shot: 'The drive itself — open road, a charging stop, the car underway again.',
        dialogue: `Show it happening: ${f(v, 'proofDrive') || 'a real drive that proves the claim'}.`,
      },
      {
        title: 'Sign off',
        role: 'close',
        shot: 'The car parked and plugged in at home, lights on, evening.',
        dialogue: `Close on what electric ownership is actually like, and on ${brandOf(ctx)}.`,
        card: ctx.cta,
      },
    ],
  },

  {
    id: 'oemsafety',
    label: 'Safety & rating',
    audience: 'oem',
    mode: 'automated',
    hue: 10,
    music: 'steady, serious bed — confidence, never fear',
    purpose: 'The safety story, earned: the rating, what is standard, and what it means on a real road.',
    mandatory: [{ id: 'rating', label: 'The rating or the claim' }],
    avoid: ['Crash imagery played for fear', 'A rating with nothing behind it'],
    fields: [
      { id: 'rating', label: 'Rating or claim', type: 'text', ph: 'e.g. 5-star Bharat NCAP, adult and child' },
      { id: 'safetyKit', label: 'What is standard', type: 'list', list: { noun: 'item', min: 2, max: 6 }, ph: 'e.g. six airbags' },
      { id: 'scenario', label: 'The everyday moment it matters', type: 'text', ph: 'e.g. a school run in the rain' },
    ],
    beats: (v, ctx): Beat[] => {
      const kit = rows(v, 'safetyKit');
      return [
        {
          title: 'Who is in the car',
          role: 'open',
          shot: 'Family getting in, doors closing, seatbelts — ordinary, warm, unhurried.',
          dialogue: `Open on the people, not the structure: ${f(v, 'scenario') || 'the everyday drive this protects'}.`,
        },
        {
          title: 'The rating',
          role: 'point',
          shot: 'The car held in a clean frame, room for the rating to sit beside it.',
          dialogue: `State the rating once, plainly: ${f(v, 'rating') || 'the safety rating'}.`,
          card: f(v, 'rating') || undefined,
        },
        {
          title: 'What is standard',
          role: 'point',
          shot: 'Interior details that carry the claim — airbag badging, belts, camera view on the screen.',
          dialogue: kit.length
            ? `Name what comes on every variant: ${kit.join(', ')}.`
            : 'Name what comes as standard on every variant.',
          card: kit[0] || undefined,
        },
        {
          title: 'Sign off',
          role: 'close',
          shot: 'The car pulling away, family inside, road ahead.',
          dialogue: `Close on the promise safety actually makes, and on ${brandOf(ctx)}.`,
          card: ctx.cta,
        },
      ];
    },
  },

  {
    id: 'oemowner',
    label: 'Ownership story',
    audience: 'oem',
    mode: 'automated',
    hue: 35,
    music: 'warm acoustic bed, human and unforced',
    purpose: 'One owner, one life, and where the car sits inside it — proof that sounds like a person.',
    mandatory: [{ id: 'owner', label: 'Whose story this is' }],
    avoid: ['A testimonial that reads like a review', 'An owner who only lists features'],
    fields: [
      { id: 'owner', label: 'The owner', type: 'text', ph: 'e.g. a Coimbatore textile trader, eight years with the brand' },
      { id: 'whatFor', label: 'What they use it for', type: 'text', ph: 'e.g. 300 km a week between the mill and the city' },
      { id: 'moment', label: 'The moment the car earned its place', type: 'text', ph: 'e.g. a monsoon night drive home' },
    ],
    beats: (v, ctx): Beat[] => [
      {
        title: 'Meet them',
        role: 'open',
        shot: 'The owner where they work or live, natural light, the car present but not posed.',
        dialogue: `Introduce them in their own words: ${f(v, 'owner') || 'who they are'}.`,
      },
      {
        title: 'The everyday',
        role: 'point',
        shot: 'The drive they actually make — roads, weather, the ordinary route.',
        dialogue: `What the car does for them: ${f(v, 'whatFor') || 'what they use it for'}.`,
      },
      {
        title: 'The moment',
        role: 'point',
        shot: 'The moment retold in one visual — night road, loaded boot, family waiting.',
        dialogue: `The story they tell about it: ${f(v, 'moment') || 'the day it proved itself'}.`,
      },
      {
        title: 'Sign off',
        role: 'close',
        shot: 'Owner and car together, still, at the end of the day.',
        dialogue: `Let them land the last line, then close on ${brandOf(ctx)}.`,
        card: ctx.cta,
      },
    ],
  },

  {
    id: 'oembrand',
    label: 'Brand film & milestone',
    audience: 'oem',
    mode: 'automated',
    hue: 300,
    music: 'orchestral bed with a rising, earned finish',
    purpose: 'The marque itself — an anniversary, a millionth car, a belief — carried by proof, not adjectives.',
    mandatory: [{ id: 'occasion', label: 'The occasion or milestone' }],
    avoid: ['A montage of adjectives with no fact in it', 'Claiming a legacy the film never shows'],
    fields: [
      { id: 'occasion', label: 'Occasion or milestone', type: 'text', ph: 'e.g. 30 years in India, ten million cars' },
      { id: 'idea', label: 'The thought the film leaves behind', type: 'textarea', ph: 'e.g. the cars people grew up in are still on the road' },
      { id: 'proofPoint', label: 'The proof', type: 'list', list: { noun: 'proof', min: 2, max: 5 }, ph: 'e.g. built in India since 1996' },
    ],
    beats: (v, ctx): Beat[] => {
      const proofs = rows(v, 'proofPoint');
      return [
        {
          title: 'The statement',
          role: 'open',
          shot: 'Wide, cinematic opening — a road, a plant floor, a city waking up.',
          dialogue: `Open on the thought, not the milestone: ${f(v, 'idea') || 'what this brand believes'}.`,
        },
        {
          title: 'The milestone',
          role: 'point',
          shot: 'A held frame with room for the number — cars in a line, or a factory gate.',
          dialogue: `Say the milestone once: ${f(v, 'occasion') || 'the milestone'}.`,
          card: f(v, 'occasion') || undefined,
        },
        {
          title: 'The proof',
          role: 'point',
          shot: 'Three quick frames of real evidence — the line, the people, the cars on the road.',
          dialogue: proofs.length ? `Back it with facts: ${proofs.join('; ')}.` : 'Back it with two or three real facts.',
          card: proofs[0] || undefined,
        },
        {
          title: 'Sign off',
          role: 'close',
          shot: 'Brand mark on a clean frame, the last image holding under it.',
          dialogue: `Close on ${brandOf(ctx)} and the line it stands behind.`,
          card: ctx.cta,
        },
      ];
    },
  },

  {
    id: 'oemoffer',
    label: 'National offer',
    audience: 'oem',
    mode: 'automated',
    hue: 95,
    music: 'upbeat bed with momentum, never frantic',
    purpose: 'A manufacturer-wide benefit, said clearly, with the deadline that makes it move.',
    mandatory: [{ id: 'offer1', label: 'What the benefit is', list: 'offer' }],
    avoid: ['Naming a single dealership — this is every showroom', 'Burying the deadline'],
    fields: [
      {
        id: 'offer',
        label: 'The benefits',
        type: 'list',
        list: { noun: 'benefit', sub: { id: 'onModels', label: 'On which models', ph: 'e.g. across the SUV range' }, min: 1, max: 4 },
        ph: 'e.g. benefits up to fifty thousand',
      },
      { id: 'period', label: 'Until when', type: 'text', ph: 'e.g. this month only, until 31 October' },
      { id: 'terms', label: 'The condition worth saying out loud', type: 'text', ph: 'e.g. on select variants' },
    ],
    beats: (v, ctx): Beat[] => {
      const offers = rows(v, 'offer');
      const models = rows(v, 'onModels');
      return [
        {
          title: 'The offer',
          role: 'open',
          shot: 'The range together in one frame, or the hero car in clean daylight.',
          dialogue: `Lead with the benefit in the first line: ${offers[0] || 'the headline benefit'}.`,
          card: offers[0] || undefined,
        },
        {
          title: 'On what',
          role: 'point',
          shot: 'Two or three models in quick succession, each held a beat.',
          dialogue: models.length ? `Say what it applies to: ${models.join(', ')}.` : 'Say which models it applies to.',
          card: models[0] || undefined,
        },
        {
          title: 'Until when',
          role: 'point',
          shot: 'A clean frame with space for the date.',
          dialogue: `State the deadline once: ${f(v, 'period') || 'the last date'}${f(v, 'terms') ? `. ${f(v, 'terms')}` : ''}.`,
          card: f(v, 'period') || undefined,
        },
        {
          title: 'Sign off',
          role: 'close',
          shot: 'Hero car, brand mark settling, showroom implied rather than named.',
          dialogue: `Send them to the nearest authorised showroom, and close on ${brandOf(ctx)}.`,
          card: ctx.cta,
        },
      ];
    },
  },

  {
    id: 'oemservice',
    label: 'Service & care',
    audience: 'oem',
    mode: 'automated',
    hue: 55,
    music: 'calm, reassuring bed, workshop rhythm underneath',
    purpose: 'A service camp or care promise: what is checked, what it costs, and by when.',
    mandatory: [{ id: 'campaign', label: 'What the camp or promise is' }],
    avoid: ['A workshop film with no date or action', 'Scaring owners into a service'],
    fields: [
      { id: 'campaign', label: 'The camp or promise', type: 'text', ph: 'e.g. monsoon care camp, 5-year warranty as standard' },
      { id: 'included', label: 'What it includes', type: 'list', list: { noun: 'check', min: 2, max: 6 }, ph: 'e.g. free 40-point check' },
      { id: 'period', label: 'When', type: 'text', ph: 'e.g. 10 to 20 July, at all authorised workshops' },
    ],
    beats: (v, ctx): Beat[] => {
      const included = rows(v, 'included');
      return [
        {
          title: 'Why now',
          role: 'open',
          shot: 'The season on the road — wet tarmac, dust, whatever this camp is for.',
          dialogue: `Open on the reason this matters now: ${f(v, 'campaign') || 'the care campaign'}.`,
        },
        {
          title: 'What is checked',
          role: 'point',
          shot: 'Workshop floor: trained hands on brakes, tyres, wipers, battery, in quick succession.',
          dialogue: included.length ? `Say what is included: ${included.join(', ')}.` : 'Say what the check covers.',
          card: included[0] || undefined,
        },
        {
          title: 'When and where',
          role: 'point',
          shot: 'Service reception, owner handing keys over, clean and calm.',
          dialogue: `Give the dates and where to go: ${f(v, 'period') || 'the dates, at authorised workshops'}.`,
          card: f(v, 'period') || undefined,
        },
        {
          title: 'Sign off',
          role: 'close',
          shot: 'Car leaving the workshop, clean, into the weather it was prepared for.',
          dialogue: `Close on the promise behind the service, and on ${brandOf(ctx)}.`,
          card: ctx.cta,
        },
      ];
    },
  },
];
