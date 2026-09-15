/**
 * Sample data for one-click prefill during testing. Never applied automatically —
 * the UI fills these only when the user clicks "Prefill sample data".
 * Select-field values must match an option string in categories.ts exactly.
 */

import type { CategoryId } from './types.js';

export const SAMPLE_FIELDS: Record<CategoryId, Record<string, string>> = {
  walkaround: {
    zonesToHighlight:
      'glass facade and signage, the model on the showroom floor, the accessories wall, the delivery bay',
  },
  feature: {
    feature1: '6 airbags and a 5-star Global NCAP rating',
    benefit1: 'your family is protected on every drive — peace of mind, not worry',
    feature2: '27.97 km/l hybrid mileage',
    benefit2: 'weeks between fuel stops, even on a daily commute',
    identity: 'young families who want one car for the city and the highway',
  },
  ev: {
    personaSegment: 'The Range Skeptic — needs reassurance on range and charging',
    concernOrHighlight: '489 km real-world range and 10–80% fast charging in 28 minutes',
  },
  testdrive: {
    location: 'our showroom on MG Road',
    dateWindow: 'this weekend, 10am to 7pm',
  },
  newlaunch: {
    launchPhase: 'Launch day — reveal, celebrate, book now',
    launchDate: 'Today',
    teaserHint: 'the new signature connected LED light bar',
  },
  delivery: {
    customerName: 'the Sharma family',
    deliveryMoment:
      'the two kids seeing the car for the first time, keys handed over outside the showroom, everyone smiling',
  },
  festival: {
    occasionName: 'Diwali',
    occasionType: 'Hindu festival — warm, celebratory, blessings',
    festiveDressing: 'marigold garlands at the entrance, diyas along the display, rangoli on the showroom floor',
  },
  offer: {
    offer1: '₹75,000 cash discount',
    offer2: 'Zero down payment at 7.99% interest',
    offer3: '7-year, unlimited-km warranty',
    expirySignal: 'this month only, limited units',
  },
  testimonial: {
    customerContext: 'a first-time buyer who bought the car for a daily 40 km commute',
    specificMoment: 'how quick and paperless the loan approval was — sorted in one visit',
  },

  oemlaunch: {
    launchPhase: 'Unveil — the full reveal',
    launchDate: '15 October',
    hook: 'a new design language for the brand’s electric range',
    priceOrAmount: 'starting at seven lakh ninety nine thousand',
  },
  oemproduct: {
    promise: 'the SUV that makes a long drive feel short',
    proof1: '600 km of range on a charge',
    proof2: 'level 2 ADAS as standard',
    proof3: 'ventilated seats front and rear',
    setting: 'a coastal highway at first light',
  },
  oemdesign: {
    designIdea: 'the brand’s new electric design language, drawn around light',
    designLine1: 'connected LED signature across the nose',
    designLine2: 'flush door handles and a single shoulder line',
    designLine3: 'full-width tail bar',
  },
  oemtech: {
    featureName: 'level 2 ADAS',
    howItWorks: 'a radar and camera watch the lane and the car ahead, holding speed and distance for you',
    whyItMatters: 'a two-hour highway run stops being tiring',
  },
  oemev: {
    concern: 'Charging time and access',
    numbers: '20 to 80 percent in 20 minutes on a fast charger',
    proofDrive: 'a Delhi to Jaipur run with one coffee stop',
  },
  oemsafety: {
    rating: '5-star Bharat NCAP, adult and child',
    safetyKit1: 'six airbags as standard',
    safetyKit2: 'electronic stability control',
    scenario: 'the school run in the rain',
  },
  oemowner: {
    owner: 'a Coimbatore textile trader, eight years with the brand',
    whatFor: '300 km a week between the mill and the city',
    moment: 'a monsoon night drive home with the family asleep',
  },
  oembrand: {
    occasion: '30 years in India, ten million cars',
    idea: 'the cars people grew up in are still on the road',
    proofPoint1: 'built in India since 1996',
    proofPoint2: 'a service network in 1,200 towns',
  },
  oemoffer: {
    offer1: 'benefits up to fifty thousand',
    onModels1: 'across the SUV range',
    period: 'until 31 October',
    terms: 'on select variants',
  },
  oemservice: {
    campaign: 'monsoon care camp',
    included1: 'free 40-point check',
    included2: 'wiper and brake inspection',
    period: '10 to 20 July, at all authorised workshops',
  },
};

/** Shared brief essentials — the prefill fills any of these that are still blank. */
export const SAMPLE_DEALER = {
  dealerName: 'Sterling Hyundai',
  brandModel: 'Hyundai Creta',
  phone: '98765 43210',
  address: 'MG Road | City Centre',
  fakeBrandModel: 'AURA VX',
  fakeDealer: 'Sterling Premier Motors',
} as const;

export const SAMPLE_ACTOR = {
  name: 'Meera — showroom promoter',
  age: 'late 20s',
  style: 'fitted maroon polo dress, nude heels, subtle jewellery, hair tied back',
  voice: 'warm, energetic, confident dealership-ad pace',
} as const;

export const SAMPLE_CAR_MODEL = 'Hyundai Creta';

/** Non-category brief fields for the top-level "Prefill sample data" button. */
export const SAMPLE_BASICS = {
  narration: 'presenter',
  durationSec: 27,
  maxChunkSec: 10,
  aspect: '9:16',
  resolution: '720p',
  textLang: 'english',
  captionStyle: 'Long Narrative',
  visualStyle:
    'Bright premium modern showroom, glossy floors, realistic reflections, energetic dealership-ad feel',
  cta: 'Book your test drive today',
  footer: 'Sterling Hyundai | MG Road | 98765 43210',
  endCard: 'Sterling Hyundai | Book your Creta test drive today | MG Road | 98765 43210',
} as const;
