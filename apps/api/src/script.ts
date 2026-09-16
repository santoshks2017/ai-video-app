/**
 * Script writing, in two passes.
 *
 * The storyboard's `dialogue` fields are stage directions — "open with a sincere
 * greeting for the occasion" — not lines. Sending those to a video model as the
 * spoken line asks it to compose the language, pronounce it and lip-sync to it
 * all at once, which is where the delivery fell apart.
 *
 *   Pass 1 — COPY.       Write the lines in natural language, for meaning and
 *                        structure. No pronunciation encoding.
 *   Pass 2 — PRONOUNCE.  Convert each line into the spoken spelling, driven by
 *                        that language's guide from the Languages library.
 *
 * Splitting them is deliberate: the copy pass stays about the ad, the
 * pronunciation pass is a mechanical transform against a rulebook the design
 * team edits, and pass 2 can be re-run alone when the guide is tuned without
 * rewriting a word of approved copy. Both are text calls costing a fraction of a
 * rupee against Rs 100+ for a video segment.
 */

import { scriptOf, type TokenUsage } from '@ava/shared';
import { recordUsage } from './spendLog.js';
import { plainSpoken, speechRate, DEFAULT_WPM } from '@ava/shared';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface ScriptScene {
  index: number;
  title: string;
  /**
   * What this moment has to ACHIEVE. It is written as camera and blocking
   * direction ("open outside the showroom, gesturing toward the facade"), which
   * is exactly what a writer must not put in the presenter's mouth — that is how
   * a line about a car became a line about a glass facade.
   */
  direction: string;
  seconds: number;
  words: number;
  /** Exact on-screen card text for this scene, if any. */
  card?: string;
  /**
   * A line the designer has locked. It is not up for rewriting — it is here so the
   * lines around it are written to flow with it rather than past it.
   */
  fixed?: string;
}

/** What the film is actually selling, and to whom. */
export interface ScriptSubject {
  /** The designer's own words for this video. The single most important input. */
  assignment?: string;
  useCase: string;
  /** What this kind of video is for, from the use-case definition. */
  purpose?: string;
  /** Failure modes this kind of video is prone to. */
  avoid?: string[];
  /** The use cases picked are one film, not several played back to back. */
  combined?: boolean;
  /** The festival or occasion that sets the look and warmth of the whole film. */
  theme?: string;
  /** Everything known about the car — this is where specifics come from. */
  car?: {
    name?: string;
    variant?: string;
    priceLabel?: string;
    fuel?: string;
    transmission?: string;
    colour?: string;
    /** Scraped headline numbers: engine, power, airbags, ground clearance… */
    specs?: Record<string, string | string[] | undefined>;
    /** Plain sentences from the source, quotable without inference. */
    highlights?: string[];
  };
  /** How the presenter comes across. */
  presenter?: string;
}

/** The language rules in force, resolved from the Languages library. */
export interface ScriptLanguage {
  name: string;
  code: string;
  /** False for a language that is written the way it is said, e.g. English. */
  needsPhonetics: boolean;
  /** The pronunciation rulebook, used verbatim as the pass-2 instruction. */
  spokenGuide: string;
  /** Locked spellings, applied before any rule is derived. */
  glossary: { term: string; say: string; mode?: 'respell' | 'english'; note?: string }[];
}

export interface ScriptRequest {
  scenes: ScriptScene[];
  language: ScriptLanguage;
  subject: ScriptSubject;
  gender: 'female' | 'male';
  dealerName: string;
  /** A dealership's film, or the manufacturer's own. Unset is a dealership. */
  clientKind?: 'dealer' | 'oem';
  brandModel: string;
  city?: string;
  cta?: string;
  /** Category field values worth quoting — offer, occasion, feature and so on. */
  facts: Record<string, string>;
  /** Extra steer from global instructions and the project's own prompt. */
  direction?: string;
  /** A two-wheeler film says "test ride"; a car film says "test drive". */
  vehicleKind?: 'car' | 'bike';
  /** How fast this film speaks, in words a minute. The budgets were worked out at it. */
  wpm?: number;
}

export interface ScriptLine {
  index: number;
  /** The readable line, for the designer to check the meaning. */
  line: string;
  /** The spoken spelling the video model performs. */
  say: string;
}

export class ScriptError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

/**
 * Which text model to use. Asking the API rather than hard-coding a name means
 * this keeps working as model names turn over; the answer is cached per process.
 */
const cachedTextModel: Partial<Record<'write' | 'transform', string>> = {};

/**
 * `write` is the ad copy — creative work, worth the best model on the key.
 * `transform` is the pronunciation pass — a mechanical substitution against a
 * rulebook at temperature 0, where a fast model is the right tool. Using one
 * cheap model for both is what produced flat, generic scripts.
 */
export async function resolveTextModel(apiKey: string, job: 'write' | 'transform' = 'write'): Promise<string> {
  const cached = cachedTextModel[job];
  if (cached) return cached;
  const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  if (!res.ok) throw new ScriptError('script-models-unavailable', `Could not list Gemini models (${res.status}).`);
  const json = (await res.json()) as {
    models?: { name?: string; supportedGenerationMethods?: string[] }[];
  };
  const usable = (json.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    // Video, image and embedding models can't write a script.
    .filter((n) => n && !/embed|image|video|omni|veo|imagen|tts|audio/i.test(n));

  const stable = (n: string): boolean => !/lite|exp|preview|thinking/.test(n);
  const best = (rx: RegExp): string | undefined =>
    usable.filter((n) => rx.test(n) && stable(n)).sort().at(-1) ?? usable.filter((n) => rx.test(n)).sort().at(-1);

  const pick =
    job === 'write'
      ? (best(/pro/) ?? best(/flash/) ?? usable[0])
      : (best(/flash/) ?? best(/pro/) ?? usable[0]);
  if (!pick) throw new ScriptError('script-no-text-model', 'No Gemini text model is available on this key.');
  cachedTextModel[job] = pick;
  return pick;
}

async function ask(
  instruction: string,
  apiKey: string,
  temperature: number,
  job: 'write' | 'transform',
): Promise<string> {
  const model = await resolveTextModel(apiKey, job);
  const res = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: instruction }] }],
      generationConfig: { temperature, responseMimeType: 'application/json' },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string; status?: string };
    usageMetadata?: TokenUsage;
  };
  if (!res.ok) {
    throw new ScriptError(
      json.error?.status ?? 'script-failed',
      json.error?.message ?? `Gemini returned ${res.status}.`,
    );
  }
  recordUsage(job === 'write' ? 'Script writing' : 'Pronunciation', model, json.usageMetadata);
  return (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
}

/* ------------------------------- pass 1: copy ------------------------------ */

/**
 * The creative platform, decided before a single line is written.
 *
 * Writing straight to the scene list is what produced copy that read like six
 * unrelated captions: each line was composed in isolation, so each one restarted
 * the argument and reached for an adjective to fill the gap. A writer settles
 * the idea first and then serves it. This is that step, made explicit — and it
 * comes back to the designer, so the angle can be judged before the lines are.
 */
export interface ScriptAngle {
  /** Who is watching, and what they are weighing up. */
  viewer: string;
  /** The one thought the film leaves behind. */
  idea: string;
  /** How the lines build from first to last. */
  throughline: string;
  /** The specific verified facts this script will spend its seconds on. */
  proof: string[];
}

/** Stock phrases that make a script sound written by committee. */
const DEAD_PHRASES = [
  'शानदार', 'बेहतरीन', 'जबरदस्त', 'लाजवाब', 'बेमिसाल',
  'सपनों की कार', 'तो देर किस बात की', 'स्वागत है', 'नमस्ते दोस्तों',
  'city हो या highway', 'की पसंद', 'हर दिल की धड़कन',
  'premium experience', 'best in class', 'value for money', 'game changer',
  'take your driving experience to the next level',
];

/** The parts of the brief every pass needs in front of it. */
function subjectBlock(req: ScriptRequest): string[] {
  const oemKind = req.clientKind === 'oem';
  const sub = req.subject;
  const car = sub.car ?? {};

  const SPEC_LABELS: Record<string, string> = {
    priceRange: 'Price range',
    basePrice: 'Starts at (rupees, ex-showroom)',
    engine: 'Engine',
    power: 'Max power',
    torque: 'Max torque',
    transmission: 'Transmission',
    fuelTypes: 'Fuel',
    mileage: 'Mileage',
    bootSpace: 'Boot space',
    groundClearance: 'Ground clearance',
    fuelTank: 'Fuel tank',
    airbags: 'Airbags',
    seating: 'Seats',
    drivetrain: 'Drivetrain',
    dimensions: 'Dimensions',
    rating: 'Owner rating',
  };
  const carFacts = [
    car.name && `Car: ${car.name}`,
    car.variant && `Variant on camera: ${car.variant}`,
    car.priceLabel && `This variant's price: ${car.priceLabel}`,
    car.fuel && `This variant's fuel: ${car.fuel}`,
    car.transmission && `This variant's transmission: ${car.transmission}`,
    car.colour && `Colour on camera: ${car.colour}`,
    ...Object.entries(car.specs ?? {})
      .filter(([, v]) => (Array.isArray(v) ? v.length : String(v ?? '').trim()))
      .map(([k, v]) => `${SPEC_LABELS[k] ?? k}: ${Array.isArray(v) ? v.join(' / ') : v}`),
  ].filter(Boolean) as string[];

  const briefFacts = Object.entries(req.facts)
    .filter(([, v]) => String(v ?? '').trim())
    .map(([k, v]) => `  - ${k}: ${v}`);

  return [
    '## THE ASSIGNMENT',
    req.subject.assignment?.trim()
      ? `The client asked for exactly this, in their own words:\n  "${req.subject.assignment.trim()}"\nThis sentence is the brief. Everything below serves it, and where the scene directions and this sentence disagree, this sentence wins.`
      : `A ${req.subject.useCase} film.`,
    `Format: ${req.subject.useCase}${req.subject.purpose ? ` — ${req.subject.purpose}` : ''}`,
    ...(req.subject.theme ? [`Theme: ${req.subject.theme}`] : []),
    '',
    ...(carFacts.length
      ? ['## THE CAR — this is what you are selling. Every number here is verified; use them.', ...carFacts.map((f) => `  ${f}`), '']
      : []),
    ...(car.highlights?.length
      ? ['## VERIFIED FACTS you may state as-is', ...car.highlights.map((h) => `  - ${h}`), '']
      : []),
    ...(briefFacts.length ? [oemKind ? '## WHAT THE BRAND GAVE YOU' : '## WHAT THE DEALER GAVE YOU', ...briefFacts, ''] : []),
    oemKind ? '## THE MANUFACTURER' : '## THE DEALERSHIP',
    `  ${req.dealerName}${!oemKind && req.city ? `, ${req.city}` : ''}`,
    ...(req.cta ? [`  The film ends on this action: ${req.cta}`] : []),
    ...(req.subject.presenter ? [`  Presenter: ${req.subject.presenter}`] : []),
    ...(req.direction?.trim() ? ['', '## EXTRA DIRECTION', `  ${req.direction.trim()}`] : []),
  ];
}

/** The scene list as the writer sees it: what each moment is FOR, and how long. */
function sceneBlock(req: ScriptRequest): string[] {
  return req.scenes.map((sc) =>
    sc.fixed
      ? `Scene ${sc.index} — ${sc.title} · ${sc.seconds}s · ALREADY WRITTEN, and staying exactly as it is:\n  "${sc.fixed}"\n  Do not return a line for this scene. Write the scenes around it so they lead into and out of this one.`
      : `Scene ${sc.index} — ${sc.title} · ${sc.seconds}s · at most ${sc.words} words${
          sc.card ? ` · an on-screen card already reads "${sc.card}", so do not say it aloud` : ''
        }\n  The moment's job: ${sc.direction}`,
  );
}

/* --- 1a. the angle --------------------------------------------------------- */

function angleInstruction(req: ScriptRequest): string {
  return [
    `You are a creative director at an advertising agency, working on a ${req.subject.useCase} film for ${req.clientKind === 'oem' ? 'an Indian vehicle manufacturer' : 'an Indian car dealership'}. Before anyone writes a line, you decide what the film is actually about.`,
    '',
    ...subjectBlock(req),
    '',
    '## THE SCENES YOU HAVE',
    ...sceneBlock(req),
    '',
    '## WHAT TO DECIDE',
    'Not the lines — the thinking behind them.',
    '',
    ...(req.subject.combined
      ? ['The use cases above are ONE film. The idea is the single thought that holds all of them together — never one idea per use case.', '']
      : []),
    '1. **The viewer.** One sentence: who is watching this, and what are they actually weighing up? Not a demographic. A person mid-decision — comparing two cars, waiting for a discount, replacing a hatchback that has stopped fitting the family.',
    req.clientKind === 'oem'
      ? '2. **The idea.** One sentence: the single thought this film leaves behind. It has to be something only THIS car from THIS brand could say. If it would fit a rival marque, it is not an idea, it is a slogan.'
      : '2. **The idea.** One sentence: the single thought this film leaves behind. It has to be something only THIS car at THIS dealership could say. If it would fit a rival brand, it is not an idea, it is a slogan.',
    '3. **The throughline.** One sentence on how the lines build — what the opening makes them want to know, and how each scene pays that off until the last line asks for the action.',
    '4. **The proof.** The two to four specific facts from above the script will spend its seconds on. Real numbers and named features. If a fact is not in the brief, it does not exist.',
    '',
    'Be hard about this. The failure mode is a nice-sounding idea that means nothing — "safety for your family", "the joy of driving". Those are categories, not ideas. An idea has an edge to it.',
    '',
    'Return JSON only: {"viewer": "...", "idea": "...", "throughline": "...", "proof": ["...", "..."]}. No commentary.',
  ].join('\n');
}

/* --- 1b. the lines --------------------------------------------------------- */

function linesInstruction(req: ScriptRequest, angle: ScriptAngle | null): string {
  const lang = req.language.name;
  const script = scriptOf(req.language.code);
  const verbs =
    req.gender === 'female'
      ? 'The presenter is a woman — feminine verb forms throughout.'
      : 'The presenter is a man — masculine verb forms throughout.';

  return [
    `You are a senior advertising copywriter who writes ${lang} scripts for ${req.clientKind === 'oem' ? 'Indian automotive brand films' : 'Indian car dealership films'}. Your lines sound like a person who knows cars talking to someone who is thinking of buying one — never like a brochure being read aloud.`,
    '',
    ...subjectBlock(req),
    '',
    ...(angle
      ? [
          '## THE ANGLE — already decided. Write to it; do not invent a different one.',
          `  Viewer:     ${angle.viewer}`,
          `  Idea:       ${angle.idea}`,
          `  Throughline: ${angle.throughline}`,
          ...(angle.proof.length ? ['  Proof to use:', ...angle.proof.map((p) => `    - ${p}`)] : []),
          '',
        ]
      : []),
    '## HOW TO WRITE IT',
    '',
    'Write the whole thing as ONE piece of copy with an arc, not a set of captions. Read it end to end in your head before you answer: it has to sound like one person talking without stopping, not six sentences taking turns.',
    ...(req.subject.combined
      ? ['', 'The scenes come from more than one use case, but this is ONE ad, not several back to back: one opening, one close, and every line leading into the next. What makes the car wanted comes first; what makes now the moment to buy follows from it. Never a second greeting, a second hook or a second call to action.']
      : []),
    '',
    'The rules that separate a professional script from a naive one:',
    '- **Sell the car, not the room.** The scene directions describe where the CAMERA is and what the presenter DOES. They are not the subject of the line. "Open outside the showroom, gesturing at the facade" means she is standing outside — it does NOT mean she talks about the facade.',
    '- **Be specific or say nothing.** One real fact — a price, a number, a feature, a use — beats three adjectives.',
    '- **Every line finishes its thought.** A short complete sentence always beats a longer fragment. Never end a line mid-clause to fit the word budget; write a shorter sentence instead.',
    '- **Each line follows from the last.** Line two continues line one, it does not restart. The film should be impossible to shuffle.',
    '- **Name the car in the first line.**',
    req.subject.theme
      ? '- **The festive greeting and the car arrive together.** Open on the occasion and the car in the same line — never a greeting on its own, never hello.'
      : '- **No greeting-card openings.** Open on something the viewer wants to know, not on hello.',
    '- **Talk to one person.**',
    '- **Earn the CTA.** The last line asks for the action and lands because of what came before.',
    `- ${verbs}`,
    ...(req.vehicleKind === 'bike'
      ? ['- This is a two-wheeler showroom: always "test ride", never "test drive" — a bike or scooter is ridden, not driven.']
      : []),
    `- Everyday spoken ${lang}, the way it is actually spoken — not translated English.`,
    '',
    '**BANNED — these are what naive copy is made of. Not one of them, in any line:**',
    ...DEAD_PHRASES.map((d) => `  ✗ ${d}`),
    '  ✗ any adjective with no fact behind it',
    '',
    ...(script === 'Latin'
      ? []
      : [
          `**SCRIPT — this one is absolute.** Every English word and every proper noun stays in LATIN letters, spelled the ordinary English way, inside the ${script} sentence. Never transliterate them into ${script}.`,
          ...(script === 'Devanagari'
            ? [
                '  Right: "New Delhi में Tata Punch Pure CNG, seven lakh sixty eight thousand से शुरू।"',
                '  Wrong: "न्यू दिल्ली में टाटा पंच प्योर सीएनजी।"',
              ]
            : [
                `  Right: "New Delhi", "Tata Punch Pure CNG" and "seven lakh sixty eight thousand" written exactly like that, in Latin letters, inside the ${script} line.`,
                `  Wrong: the same names and numbers spelled out in ${script} letters.`,
              ]),
          '  This covers brand and model names, place names, the dealership name, and the English words Indians say in English: test drive, test ride, EMI, on-road price, booking, offer, showroom, variant, service, down payment, airbags, manual, automatic, safety, family, mileage.',
          '',
        ]),
    '- Never invent a price, EMI, discount, mileage, interest rate or waiting period. Only the facts above exist.',
    '- Write every number, price and unit as plain ENGLISH words in Latin letters — "fifteen lakh four thousand", "six airbags", "seventy kmpl". Never digits, never the ₹ symbol, never the word "rupees", and never a number written in any other script. The price is the line that has to land, and a respelled price does not survive the video model.',
    ...(req.subject.avoid?.length
      ? ['', 'This format fails when it does these — do not:', ...req.subject.avoid.map((a) => `  - ${a}`)]
      : []),
    '',
    '## THE SCENES',
    `One line per scene, in order, each within its word budget — the budgets are worked out at about ${
      req.wpm ?? DEFAULT_WPM
    } words a minute, which is ${speechRate(req.wpm).delivery}.`,
    ...sceneBlock(req),
    '',
    'Return JSON only: an array of {"index": <scene index>, "line": "<the spoken line>"}. One object per scene, in order. No commentary.',
  ].join('\n');
}

/* --- 1c. the edit ---------------------------------------------------------- */

/**
 * The pass that does most of the work.
 *
 * A first draft written scene by scene always contains a few lines that are
 * merely acceptable — an adjective standing in for a fact, a sentence that stops
 * before it finishes, a line that could belong to any dealership in the country.
 * A copywriter cuts those; a single generation call does not. So this reads the
 * draft back against a checklist and rewrites only what fails, which is the
 * difference between copy that reads as competent and copy that reads as naive.
 */
function editInstruction(req: ScriptRequest, angle: ScriptAngle | null, draft: { index: number; line: string }[]): string {
  const budget = new Map(req.scenes.map((sc) => [sc.index, sc.words]));
  return [
    `You are the copy chief. A writer has handed you a ${req.language.name} script for ${req.clientKind === 'oem' ? 'an Indian automotive brand film' : 'an Indian car dealership film'}. Your job is to make it publishable — cut what is weak, keep what works, and hand back the same number of lines.`,
    '',
    ...subjectBlock(req),
    '',
    ...(angle
      ? ['## THE ANGLE THIS WAS WRITTEN TO', `  Idea:       ${angle.idea}`, `  Throughline: ${angle.throughline}`, '']
      : []),
    '## THE DRAFT',
    ...draft.map((l) => `${l.index}: ${l.line}   [at most ${budget.get(l.index) ?? '?'} words]`),
    '',
    '## READ IT BACK AGAINST THIS — every line, in order',
    '1. **Does it finish its thought?** A line ending mid-clause — "और आपको मिले peace" — is the worst fault here. Rewrite it as a shorter complete sentence.',
    '2. **Is there an adjective doing a fact’s job?** शानदार, बेहतरीन, premium, amazing. Replace it with the real number or feature, or cut the clause.',
    '3. **Is it a stock phrase?** "city हो या highway", "families की पसंद", "तो देर किस बात की". Rewrite from scratch.',
    req.clientKind === 'oem'
      ? '4. **Would this line work for a different marque or a different car?** Then it is not doing any work. Make it specific.'
      : '4. **Would this line work for a different dealership, a different car or a different city?** Then it is not doing any work. Make it specific.',
    '5. **Does it follow from the line before it?** If the script could be shuffled without anyone noticing, connect them.',
    ...(req.subject.combined
      ? ['5b. **Is it one film?** A second greeting, a second hook or a second call to action is a fault — cut it and connect what is left.']
      : []),
    '6. **Is it about the car, or about the room and the camera?** Nobody buys a car because a building has a glass front.',
    '7. **Is it inside its word budget?** Cut words, never meaning. If it will not fit, write a different, shorter sentence.',
    '8. **Do the numbers read as plain English words in Latin letters,** and does every English word and proper noun stay in Latin letters inside the Devanagari sentence?',
    '9. **The last line:** does it ask for the action, and has the script earned it?',
    ...(req.vehicleKind === 'bike'
      ? ['10. **Two-wheeler words:** "test ride", never "test drive"; ride, never drive.']
      : []),
    '',
    'Rewrite a line only where it fails. A line that passes comes back exactly as it is — resist the urge to fiddle with copy that already works. Never invent a fact that is not in the brief.',
    '',
    'Return JSON only: an array of {"index": <the same index>, "line": "<the final line>"}. One object per line, in order, same count as the draft. No commentary.',
  ].join('\n');
}

/* --------------------------------- driver --------------------------------- */

export async function writeScript(
  req: ScriptRequest,
  apiKey: string,
): Promise<{ model: string; lines: ScriptLine[]; angle?: ScriptAngle }> {
  if (!req.scenes.length) return { model: '', lines: [] };

  // 1a. Settle the idea. Warm but not wild — this is judgement, not invention.
  const angle = await askAngle(req, apiKey);

  // 1b. The draft, written to that idea rather than scene by scene in the dark.
  const draft = parseRows(await ask(linesInstruction(req, angle), apiKey, 1.0, 'write'), 'line').map((r) => ({
    index: r.index,
    line: r.text,
  }));
  if (!draft.length) throw new ScriptError('script-unparseable', 'The model did not return any usable lines.');

  // 1c. The edit. Low temperature: this is judgement against a checklist, and a
  // hot model here rewrites lines that were already good.
  const copy = await polish(req, angle, draft, apiKey);

  /*
   * One line, and the model performs it as written.
   *
   * There used to be a third call here that respelled every line for pronunciation,
   * and a second field in the storyboard holding the respelling. Omni says the copy
   * correctly on its own now, so both are gone: one call less per script, and one
   * box to read instead of two saying almost the same thing. `say` stays on the
   * wire as a copy of the line so nothing downstream has to care.
   */
  const lines = copy.map((c) => ({ ...c, say: c.line }));
  return { model: await resolveTextModel(apiKey, 'write'), lines, angle: angle ?? undefined };
}

/** The creative platform. A failure here is not fatal — the draft can proceed. */
async function askAngle(req: ScriptRequest, apiKey: string): Promise<ScriptAngle | null> {
  try {
    const raw = await ask(angleInstruction(req), apiKey, 0.9, 'write');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const j = JSON.parse(raw.slice(start, end + 1)) as Partial<ScriptAngle>;
    const str = (v: unknown): string => String(v ?? '').trim();
    const angle: ScriptAngle = {
      viewer: str(j.viewer),
      idea: str(j.idea),
      throughline: str(j.throughline),
      proof: (Array.isArray(j.proof) ? j.proof : []).map(str).filter(Boolean),
    };
    return angle.idea ? angle : null;
  } catch {
    return null;
  }
}

/**
 * The edit pass, with the draft as its own fallback: a script that came back
 * unparseable is a reason to ship the draft, never a reason to fail the run the
 * designer is waiting on.
 */
async function polish(
  req: ScriptRequest,
  angle: ScriptAngle | null,
  draft: { index: number; line: string }[],
  apiKey: string,
): Promise<{ index: number; line: string }[]> {
  try {
    const edited = parseRows(await ask(editInstruction(req, angle, draft), apiKey, 0.4, 'write'), 'line');
    if (!edited.length) return draft;
    const byIndex = new Map(edited.map((r) => [r.index, r.text]));
    // Keep the draft's shape; the edit may only replace lines, never drop them.
    return draft.map((l) => ({ index: l.index, line: byIndex.get(l.index) || l.line }));
  } catch {
    return draft;
  }
}

/** JSON mode is not guaranteed, so pull the array out of whatever came back. */
function parseRows(text: string, field: 'line' | 'say'): { index: number; text: string }[] {
  const attempt = (raw: string): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  const parsed = attempt(text) ?? (start >= 0 && end > start ? attempt(text.slice(start, end + 1)) : null);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((row) => {
      const r = row as Record<string, unknown>;
      const index = Number(r.index);
      const value = String(r[field] ?? r.line ?? r.dialogue ?? '').trim();
      return Number.isFinite(index) && value ? { index, text: value } : null;
    })
    .filter((x): x is { index: number; text: string } => x !== null);
}
