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
    cashDiscount: '₹75,000',
    downPayment: '₹0',
    interestRate: '7.99%',
    warrantyYears: '7',
    warrantyKm: 'Unlimited',
    expirySignal: 'this month only, limited units',
  },
  testimonial: {
    customerContext: 'a first-time buyer who bought the car for a daily 40 km commute',
    specificMoment: 'how quick and paperless the loan approval was — sorted in one visit',
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
