/**
 * The twelve creative engines of the CarDekho Social AI orchestrator (v4): what each kind of
 * dealership post is for, the facts it needs, the words that call it up, and how two blend.
 *
 * Classification is read from the brief's own words, the way the orchestrator's matrix does it
 * — no model call, so it is instant, free and the same every time. A designer can always pick.
 */

export type CreativeEngineId =
  | 'delivery'
  | 'festival'
  | 'offer'
  | 'feature'
  | 'ev'
  | 'launch'
  | 'testdrive'
  | 'service'
  | 'community'
  | 'testimonial'
  | 'achievement'
  | 'accessories';

export type CreativeTemplateId = 'hero' | 'offer' | 'festival' | 'feature' | 'launch' | 'delivery';

export interface CreativeField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'list';
  placeholder?: string;
  options?: string[];
  /** A list's most rows. */
  max?: number;
  hint?: string;
}

export interface CreativeEngine {
  id: CreativeEngineId;
  /** The orchestrator's number, E01 to E12. */
  code: string;
  label: string;
  purpose: string;
  /** Words and phrases that call this engine up, lower case. */
  words: string[];
  fields: CreativeField[];
  /** Fields a post of this kind cannot go without. */
  mandatory: string[];
  /** How the words run, for the copy writer: what the picture says, then the caption's beats. */
  onImage: string;
  caption: string[];
  avoid: string[];
  template: CreativeTemplateId;
  /** The scene the picture is set in when nothing else is said. */
  scene: string;
}

export const INDIAN_OCCASIONS = [
  'Makar Sankranti',
  'Republic Day',
  "Valentine's Day",
  "Women's Day",
  'Holi',
  'Gudi Padwa',
  'Ugadi',
  'Ram Navami',
  'Baisakhi',
  'Eid ul-Fitr',
  'Eid ul-Adha',
  "Mother's Day",
  'World Environment Day',
  "Father's Day",
  'International Yoga Day',
  'Raksha Bandhan',
  'Independence Day',
  'Janmashtami',
  'Ganesh Chaturthi',
  'Onam',
  'Navratri',
  'Durga Puja',
  'Dussehra',
  'Gandhi Jayanti',
  'Dhanteras',
  'Diwali',
  'Bhai Dooj',
  'Chhath Puja',
  'Christmas',
  'New Year',
];

export const CREATIVE_ENGINES: CreativeEngine[] = [
  {
    id: 'delivery',
    code: 'E01',
    label: 'Delivery / Handover',
    purpose: "Celebrate a customer's new car — the highest-emotion post there is. Pure joy.",
    words: ['delivery', 'deliveries', 'delivered', 'handover', 'hand over', 'congratulations', 'congrats', 'keys', 'new car feeling', 'welcome to the family', 'proud owner', 'new owner'],
    fields: [
      { id: 'customerName', label: 'Customer', type: 'text', placeholder: 'Mr & Mrs Sharma', hint: 'Leave empty for "our valued customer".' },
      { id: 'moment', label: 'The moment', type: 'text', placeholder: "Their family's first SUV" },
    ],
    mandatory: [],
    onImage: 'A congratulation with the customer\'s name, the model, and a welcome into the dealership family. No price, ever.',
    caption: ['Congratulation + customer name + model', 'The family moment', 'Why it was a brilliant choice', 'Thanks for the journey from showroom to keys', 'The drives ahead', 'Welcome to the family + contact block'],
    avoid: ['price mentions', 'competitor references', 'stock phrases with no emotion'],
    template: 'delivery',
    scene: 'the car at the dealership delivery bay, decorated with a tasteful ribbon, warm light, a celebration mood',
  },
  {
    id: 'festival',
    code: 'E02',
    label: 'Festival / Occasion',
    purpose: 'Connect the brand with a cultural moment. Emotion over promotion; never lead with price.',
    words: [
      'festival', 'festive', 'occasion', 'wishes', 'greetings',
      'diwali', 'deepavali', 'dhanteras', 'navratri', 'durga puja', 'dussehra', 'dasara', 'holi', 'eid', 'ramzan', 'christmas', 'xmas', 'new year',
      'makar sankranti', 'sankranti', 'pongal', 'lohri', 'republic day', 'independence day', 'raksha bandhan', 'rakhi', 'janmashtami', 'ganesh chaturthi',
      'ganpati', 'onam', 'baisakhi', 'gudi padwa', 'ugadi', 'ram navami', 'chhath', 'bhai dooj', 'gandhi jayanti', "father's day", 'fathers day',
      "mother's day", 'mothers day', "women's day", 'womens day', "valentine's day", 'valentines day', 'yoga day', 'environment day',
    ],
    fields: [
      { id: 'occasion', label: 'Occasion', type: 'select', options: INDIAN_OCCASIONS },
      { id: 'wish', label: 'The wish', type: 'text', placeholder: 'May every journey be filled with light', hint: 'Optional — written for you when empty.' },
    ],
    mandatory: ['occasion'],
    onImage: 'A sincere greeting for the occasion, specific to it; the car is present but the wish leads. Any offer is a gift, never the headline.',
    caption: ['Occasion greeting, specific and sincere', 'What the occasion means (not what the car means)', 'A light tie to the dealership', 'Warm closing wish', 'Minimal contact block'],
    avoid: ['leading with price', 'generic "season\'s greetings"', 'hard selling'],
    template: 'festival',
    scene: 'a festive setting for the occasion — decorations, lights and colours true to it — around the car',
  },
  {
    id: 'offer',
    code: 'E03',
    label: 'Offer / Deal',
    purpose: 'Drive leads. Create urgency without cheapening the brand. Clarity over cleverness.',
    words: ['offer', 'offers', 'deal', 'deals', 'cashback', 'discount', 'benefit', 'benefits', 'emi', 'price', 'scheme', 'savings', 'save', 'exchange bonus', 'low down payment', 'finance', 'loan', 'price hike', '₹', 'rs', 'lakh', 'off'],
    fields: [
      { id: 'offers', label: 'Offers', type: 'list', max: 4, placeholder: 'Benefits up to ₹50,000' },
      { id: 'validity', label: 'Valid till', type: 'text', placeholder: '31 October' },
      { id: 'emi', label: 'EMI or price line', type: 'text', placeholder: 'EMI from ₹9,999/month', hint: 'Optional.' },
    ],
    mandatory: ['offers'],
    onImage: 'The benefit as a big, exact ₹ figure ("Benefits up to ₹X*"), the model, one urgency line, one call to action. Always "up to ₹X", never "₹X off"; no percentages.',
    caption: ['Attention hook — a question or the value', 'Offer mechanics with exact numbers', 'Why this model at this offer', 'Urgency signal', 'Call to action + contact block'],
    avoid: ['percentage discounts', 'vague "great offer"', 'false scarcity'],
    template: 'offer',
    scene: 'the car on a bright, premium showroom floor or a clean city street, confident and aspirational',
  },
  {
    id: 'feature',
    code: 'E04',
    label: 'Product Feature',
    purpose: 'Educate and create desire: feature, then benefit, then the feeling.',
    words: ['feature', 'features', 'specs', 'specifications', 'performance', 'technology', 'safety', 'ncap', 'airbags', 'mileage', 'sunroof', 'adas', 'turbo', 'infotainment', 'boot space', 'ground clearance'],
    fields: [
      { id: 'features', label: 'Features', type: 'list', max: 4, placeholder: '6 airbags as standard' },
      { id: 'forWhom', label: 'Who it is for', type: 'text', placeholder: 'Young families', hint: 'Optional.' },
    ],
    mandatory: ['features'],
    onImage: 'A desire headline (the feeling, not the spec), then two to four features each written as the benefit to the owner.',
    caption: ['Desire hook — the situation, not the spec', 'Two or three features as benefits', 'Who the car is for', 'Call to action + contact', 'Model-heavy hashtags'],
    avoid: ['raw spec lists', '"industry-first" without why', 'naming competitors'],
    template: 'feature',
    scene: 'the car in motion or parked where its strength shows — an open highway, a city at dusk, rough road for an SUV',
  },
  {
    id: 'ev',
    code: 'E05',
    label: 'EV / Electric',
    purpose: 'Convert sceptics and excite believers: electric as an upgrade, not a compromise.',
    words: ['ev', 'electric', 'charging', 'charger', 'battery', 'zero emission', 'plug-in', 'plug in', 'hybrid', 'phev', 'kwh', 'e-drive'],
    fields: [
      { id: 'highlight', label: 'Lead with', type: 'select', options: ['Range', 'Charging', 'Running cost', 'Technology', 'Safety'] },
      { id: 'range', label: 'Range', type: 'text', placeholder: '500 km on one charge' },
      { id: 'charge', label: 'Charging', type: 'text', placeholder: '10–80% in 40 minutes', hint: 'Optional.' },
    ],
    mandatory: ['highlight'],
    onImage: 'A future-forward headline, one concrete reassurance (range, charging or cost) with its number, and a line on what driving electric feels like.',
    caption: ['Future-forward hook', 'One range or charging concern answered, or one key technology', 'What driving electric feels like', 'A credibility signal', 'Call to action + contact', 'EV hashtags'],
    avoid: ['eco-guilt', 'unverified range numbers'],
    template: 'hero',
    scene: 'the car in a clean, modern setting with a sense of the future — soft daylight, green surroundings or a sleek charging bay',
  },
  {
    id: 'launch',
    code: 'E06',
    label: 'New Launch',
    purpose: 'Build hype and anticipation; make followers feel like insiders.',
    words: ['launch', 'launched', 'new model', 'arriving', 'coming soon', 'first look', 'booking open', 'bookings open', 'unveil', 'reveal', 'all-new', 'all new', 'countdown', 'days to go'],
    fields: [
      { id: 'phase', label: 'Stage', type: 'select', options: ['Teaser', 'Launch day', 'Bookings open', 'Price announcement', 'First deliveries'] },
      { id: 'date', label: 'Date', type: 'text', placeholder: '25 October' },
      { id: 'hint', label: 'The tease', type: 'text', placeholder: 'The icon is back', hint: 'Optional.' },
    ],
    mandatory: ['phase'],
    onImage: 'A curiosity hook, one tantalising hint, the date or countdown, and the booking call.',
    caption: ['Curiosity hook', 'One hint — design, tech or name', 'Date or countdown', 'Booking or notify call', 'Launch hashtags'],
    avoid: ['spoiling the reveal', 'unconfirmed prices'],
    template: 'launch',
    scene: 'a dramatic reveal — the car in a dark studio with a single beam of light, mysterious and premium',
  },
  {
    id: 'testdrive',
    code: 'E07',
    label: 'Test Drive',
    purpose: 'Remove the commitment barrier: a test drive is an experience, not a sales visit.',
    words: ['test drive', 'test-drive', 'test ride', 'book a drive', 'visit showroom', 'visit our showroom', 'walk in', 'doorstep'],
    fields: [
      { id: 'where', label: 'Where', type: 'text', placeholder: 'At our showroom or at your doorstep' },
      { id: 'when', label: 'When', type: 'text', placeholder: 'This weekend', hint: 'Optional.' },
    ],
    mandatory: [],
    onImage: 'The feeling that makes someone want to try it, a no-obligation line, and how to book.',
    caption: ['The feeling or question', 'What the drive is like — sensory', 'No-obligation framing', 'When, where, how to book', 'Contact + call to action'],
    avoid: ['pressure selling'],
    template: 'hero',
    scene: 'the car on an inviting open road in golden-hour light, as if waiting to be driven',
  },
  {
    id: 'service',
    code: 'E08',
    label: 'Service / Maintenance',
    purpose: 'Keep customers: service is a relationship, not a repair.',
    words: ['service', 'servicing', 'maintenance', 'amc', 'annual maintenance', 'workshop', 'care', 'check-up', 'checkup', 'service camp', 'monsoon check', 'genuine parts'],
    fields: [
      { id: 'campaign', label: 'Campaign', type: 'text', placeholder: 'Monsoon check-up camp' },
      { id: 'includes', label: 'Included', type: 'list', max: 4, placeholder: 'Free 40-point check' },
      { id: 'validity', label: 'Valid till', type: 'text', placeholder: '15 August', hint: 'Optional.' },
    ],
    mandatory: ['campaign'],
    onImage: 'A relevance hook (the season or the mileage), what is included, a trust line (trained technicians, genuine parts), and booking.',
    caption: ['Relevance hook', "What's included", 'Trust signal', 'Convenience — pick-up, express', 'Booking call + contact'],
    avoid: ['fear-mongering'],
    template: 'feature',
    scene: 'a clean, well-lit authorised service workshop, the car on a service bay',
  },
  {
    id: 'community',
    code: 'E09',
    label: 'Community / Event',
    purpose: 'Humanise the dealership — the people behind the brand.',
    words: ['event', 'camp', 'exhibition', 'community', 'csr', 'hiring', 'join our team', 'anniversary', 'blood donation', 'rally', 'expo', 'mela'],
    fields: [
      { id: 'event', label: 'Event', type: 'text', placeholder: 'Car mela' },
      { id: 'date', label: 'Date', type: 'text', placeholder: '22 June' },
      { id: 'time', label: 'Time', type: 'text', placeholder: '10 AM onwards', hint: 'Optional.' },
      { id: 'venue', label: 'Venue', type: 'text', placeholder: 'Naupukhuri Park' },
    ],
    mandatory: ['event'],
    onImage: 'The event name, date, time and venue, clearly, with an invitation.',
    caption: ['What is happening', 'Why it matters to the community', 'Date, time, venue', 'Invitation + contact'],
    avoid: ['selling at a community event'],
    template: 'hero',
    scene: 'a lively, welcoming outdoor gathering with the car on display',
  },
  {
    id: 'testimonial',
    code: 'E10',
    label: 'Testimonial',
    purpose: 'Social proof: let a real customer sell for you.',
    words: ['testimonial', 'review', 'customer story', 'customer says', 'feedback', 'happy customer', 'rating', 'honest'],
    fields: [
      { id: 'quote', label: 'Their words', type: 'textarea', placeholder: 'The whole family fits, and the mileage is unbelievable.' },
      { id: 'customerName', label: 'Customer', type: 'text', placeholder: 'Rohit, Pune' },
    ],
    mandatory: ['quote'],
    onImage: "The customer's words, verbatim and short, their name, and the model.",
    caption: ['Customer quote', 'Who they are, what they bought', 'The moment they loved', 'Thanks + welcome', 'Come see for yourself'],
    avoid: ['inventing quotes', 'editing the meaning'],
    template: 'hero',
    scene: 'the car in a warm, everyday family setting',
  },
  {
    id: 'achievement',
    code: 'E11',
    label: 'Achievement / Milestone',
    purpose: 'Build credibility through recognition and numbers.',
    words: ['award', 'awarded', 'milestone', 'record', 'achievement', 'ranking', 'ranked', 'certified', 'best dealer', 'happy families', 'deliveries done', 'followers'],
    fields: [
      { id: 'milestone', label: 'Milestone', type: 'text', placeholder: '1,000 happy families' },
      { id: 'detail', label: 'Detail', type: 'text', placeholder: 'Best dealer, West region 2026', hint: 'Optional.' },
    ],
    mandatory: ['milestone'],
    onImage: 'The number or award, large, with a line of thanks. Claims only as given — no "#1" without the citation.',
    caption: ['The milestone', 'Thanks to customers and team', 'What it means', 'Contact'],
    avoid: ['unsubstantiated superlatives'],
    template: 'launch',
    scene: 'a celebratory, premium setting — soft spotlights and confetti-free elegance around the car',
  },
  {
    id: 'accessories',
    code: 'E12',
    label: 'Accessories / Detailing',
    purpose: 'Drive accessory revenue and ownership pride.',
    words: ['accessories', 'accessory', 'detailing', 'ceramic', 'ppf', 'coating', 'wrap', 'seat covers', 'floor mats', 'dashcam', 'modification', 'tint'],
    fields: [
      { id: 'package', label: 'Package', type: 'text', placeholder: 'Ceramic coating' },
      { id: 'items', label: 'Includes', type: 'list', max: 4, placeholder: '9H hardness, 3-year protection' },
      { id: 'price', label: 'Price', type: 'text', placeholder: 'Starting at ₹14,999', hint: 'Optional.' },
    ],
    mandatory: ['package'],
    onImage: 'What the package does in one or two benefits, why genuine / dealer-fitted matters, and the price if given.',
    caption: ['Protection or before/after hook', 'One or two specific benefits', 'Why dealer-certified matters', 'Package price', 'Booking call + contact'],
    avoid: ['unbranded claims'],
    template: 'feature',
    scene: 'a detailing studio with a flawless mirror-like finish on the car under soft light',
  },
];
export const CREATIVE_ENGINE_BY_ID = Object.fromEntries(CREATIVE_ENGINES.map((e) => [e.id, e])) as Record<CreativeEngineId, CreativeEngine>;
export const isCreativeEngine = (v: unknown): v is CreativeEngineId => typeof v === 'string' && v in CREATIVE_ENGINE_BY_ID;

/** Two engines together, from the orchestrator: the first leads, at the given share. */
export const CREATIVE_BLENDS: Array<{ lead: CreativeEngineId; with: CreativeEngineId; ratio: string; logic: string }> = [
  { lead: 'festival', with: 'offer', ratio: '60/40', logic: 'Emotion leads; the offer is the gift, not the headline.' },
  { lead: 'festival', with: 'delivery', ratio: '70/30', logic: 'Pure celebration; the car is secondary.' },
  { lead: 'offer', with: 'feature', ratio: '50/50', logic: 'Value headline plus one key feature.' },
  { lead: 'launch', with: 'testdrive', ratio: '60/40', logic: 'Curiosity hook; the test drive is the call to action.' },
  { lead: 'ev', with: 'offer', ratio: '55/45', logic: 'The future of driving leads; the price is the way in.' },
  { lead: 'delivery', with: 'achievement', ratio: '80/20', logic: 'The delivery is the hero; the milestone adds context.' },
];

/** When a brief names more than two kinds of post, the most emotional leads. */
export const EMOTION_ORDER: CreativeEngineId[] = [
  'delivery',
  'festival',
  'launch',
  'ev',
  'offer',
  'feature',
  'testdrive',
  'service',
  'community',
  'achievement',
  'accessories',
  'testimonial',
];

export interface CreativeClassification {
  primary: CreativeEngineId;
  secondary?: CreativeEngineId;
  /** Lead/second share, "60/40", when two engines blend. */
  ratio?: string;
  /** The words that decided it, for the designer to see why. */
  heard: string[];
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A word or phrase heard as itself, not inside another word; "₹" and "rs" with a number after them. */
function hears(text: string, word: string): boolean {
  if (word === '₹') return /₹\s*\d/.test(text);
  if (word === 'rs') return /\brs\.?\s*\d/.test(text);
  if (word === 'off') return /\d\s*(k|,000|lakh)?\s*off\b/.test(text);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(word)}($|[^\\p{L}\\p{N}])`, 'u').test(text);
}

/**
 * Which kind of post a brief is. One engine alone; two blend at the orchestrator's ratio (or
 * 60/40 when the pair has none, the more emotional leading); with more than two the most
 * emotional leads, keeping a second only where it leads a known blend with it. Null when the
 * brief says nothing that points anywhere.
 */
export function classifyCreative(brief: string): CreativeClassification | null {
  const text = ` ${brief.toLowerCase().replace(/[’`]/g, "'")} `;
  const found: Array<{ id: CreativeEngineId; heard: string[] }> = [];
  for (const e of CREATIVE_ENGINES) {
    const heard = e.words.filter((w) => hears(text, w));
    if (heard.length) found.push({ id: e.id, heard });
  }
  if (!found.length) return null;
  const rank = (id: CreativeEngineId): number => EMOTION_ORDER.indexOf(id);
  found.sort((a, b) => rank(a.id) - rank(b.id));
  const heard = found.flatMap((f) => f.heard);
  const blendOf = (a: CreativeEngineId, b: CreativeEngineId) =>
    CREATIVE_BLENDS.find((x) => (x.lead === a && x.with === b) || (x.lead === b && x.with === a));
  if (found.length === 1) return { primary: found[0]!.id, heard };
  if (found.length === 2) {
    const [a, b] = [found[0]!.id, found[1]!.id];
    const blend = blendOf(a, b);
    return blend ? { primary: blend.lead, secondary: blend.with, ratio: blend.ratio, heard } : { primary: a, secondary: b, ratio: '60/40', heard };
  }
  // More than two: the most emotional leads, as the orchestrator says, joined only by a
  // second it is known to lead a blend with.
  const lead = found[0]!.id;
  const pair = found
    .slice(1)
    .map((o) => CREATIVE_BLENDS.find((x) => x.lead === lead && x.with === o.id))
    .find(Boolean);
  return pair ? { primary: lead, secondary: pair.with, ratio: pair.ratio, heard } : { primary: lead, heard };
}

/** The occasion a brief names, if it names one we know. */
export function occasionIn(brief: string): string | undefined {
  const text = brief.toLowerCase();
  const alias: Record<string, string> = {
    deepavali: 'Diwali',
    dasara: 'Dussehra',
    rakhi: 'Raksha Bandhan',
    ganpati: 'Ganesh Chaturthi',
    xmas: 'Christmas',
    sankranti: 'Makar Sankranti',
    'fathers day': "Father's Day",
    'mothers day': "Mother's Day",
    'womens day': "Women's Day",
    'valentines day': "Valentine's Day",
    'yoga day': 'International Yoga Day',
    'environment day': 'World Environment Day',
    eid: 'Eid ul-Fitr',
  };
  const direct = INDIAN_OCCASIONS.find((o) => text.includes(o.toLowerCase().replace(/[’']/g, "'")));
  if (direct) return direct;
  const hit = Object.keys(alias).find((a) => new RegExp(`\\b${escapeRe(a)}\\b`).test(text));
  return hit ? alias[hit] : undefined;
}
