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
  brandModel: string;
  city?: string;
  cta?: string;
  /** Category field values worth quoting — offer, occasion, feature and so on. */
  facts: Record<string, string>;
  /** Extra steer from global instructions and the project's own prompt. */
  direction?: string;
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
  };
  if (!res.ok) {
    throw new ScriptError(
      json.error?.status ?? 'script-failed',
      json.error?.message ?? `Gemini returned ${res.status}.`,
    );
  }
  return (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
}

/* ------------------------------- pass 1: copy ------------------------------ */

function copyInstruction(req: ScriptRequest): string {
  const lang = req.language.name;
  const sub = req.subject;
  const car = sub.car ?? {};
  const verbs =
    req.gender === 'female'
      ? 'The presenter is a woman — feminine verb forms throughout.'
      : 'The presenter is a man — masculine verb forms throughout.';

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
    `You are a senior advertising copywriter who writes ${lang} scripts for Indian car dealership films. You are good at this: your lines sound like a real person who knows cars talking to someone who is thinking of buying one.`,
    '',
    '## THE ASSIGNMENT',
    sub.assignment?.trim()
      ? `The client asked for exactly this: "${sub.assignment.trim()}"\nEverything below serves that sentence. If the scene directions and this sentence disagree, this sentence wins.`
      : `A ${sub.useCase} film.`,
    `Format: ${sub.useCase}${sub.purpose ? ` — ${sub.purpose}` : ''}`,
    '',
    ...(carFacts.length
      ? [
          '## THE CAR — this is what you are selling. Every number here is verified; use them.',
          ...carFacts.map((f) => `  ${f}`),
          '',
        ]
      : []),
    ...(car.highlights?.length
      ? [
          '## VERIFIED FACTS you may state as-is',
          ...car.highlights.map((h) => `  - ${h}`),
          'Say a number the way a person says it, not the way a spec sheet writes it: "one ninety three millimetre ground clearance", "six airbags", "sixty litre tank".',
          '',
        ]
      : []),
    ...(briefFacts.length ? ['## WHAT THE DEALER GAVE YOU', ...briefFacts, ''] : []),
    `## THE DEALERSHIP`,
    `  ${req.dealerName}${req.city ? `, ${req.city}` : ''}`,
    ...(req.cta ? [`  The film ends on this action: ${req.cta}`] : []),
    ...(sub.presenter ? [`  Presenter: ${sub.presenter}`] : []),
    '',
    '## HOW TO WRITE IT',
    '',
    'Write the whole thing as ONE piece with an arc, not a set of captions. It should build: something that makes a person keep watching, then a reason to care, then one clear thing to do.',
    '',
    'Rules that separate a good script from a generic one:',
    '- **Sell the car, not the room.** The scene directions below describe where the CAMERA is and what the presenter DOES. They are not the subject of the line. "Open outside the showroom, gesturing at the facade" means she is standing outside — it does NOT mean she talks about the facade. Nobody buys a car because a building has a glass front.',
    '- **Be specific or say nothing.** One real fact — a price, a number, a feature, a colour, a use — beats three adjectives. "शानदार", "बहुत अच्छा", "premium experience" are empty; cut them.',
    '- **Name the car early.** By the end of the first line the viewer should know which car this is about.',
    '- **No greeting-card openings.** Do not open with "स्वागत है", "नमस्ते दोस्तों", "आज मैं आपको दिखाने लाई हूँ". Open with something the viewer wants to know.',
    '- **Talk to one person**, not "everyone". No "फैमिली के लिए" filler unless the brief is about families.',
    '- **One idea per line, and lines that connect.** Line two should follow from line one, not restart.',
    '- **Earn the CTA.** The last line asks for the action, and it lands because the lines before it gave a reason.',
    `- ${verbs}`,
    `- Everyday spoken ${lang}, written in its own script.`,
    '',
    '**SCRIPT — this one is absolute.** Every English word and every proper noun stays in LATIN letters, spelled the ordinary English way, inside the Devanagari sentence. Never transliterate them into Devanagari.',
    '  Right: "New Delhi में Tata Punch Pure CNG, सात लाख अड़सठ हज़ार से शुरू।"',
    '  Wrong: "न्यू दिल्ली में टाटा पंच प्योर सीएनजी, सात लाख अड़सठ हज़ार से शुरू।"',
    '  This covers brand and model names (Tata, Punch, Nexon, CNG), place names (New Delhi, Gurugram), the dealership name, and the English words Indians say in English: test drive, EMI, on-road price, booking, offer, showroom, variant, service, down payment, airbags, manual, automatic, safety, family, mileage.',
    '  Hindi words stay in Devanagari. Numbers spoken in Hindi stay in Devanagari (सात लाख अड़सठ हज़ार). Only the English keeps Latin letters.',
    '',
    '- Never invent a price, EMI, discount, mileage, interest rate or waiting period. Use only the facts above.',
    '- Write every number, price and unit as plain ENGLISH words in Latin letters — "fifteen lakh four thousand", "six airbags", "seventy kmpl". Never digits, never the ₹ symbol, never the word "rupees", and never the Devanagari spelling of a number. A phonetic respelling of a price does not survive the video model, and the price is the line that has to land.',
    ...(sub.avoid?.length
      ? ['', 'This format fails when it does these — do not:', ...sub.avoid.map((a) => `  - ${a}`)]
      : []),
    '',
    '## THE SCENES',
    'One line per scene, in order, each within its word budget at an unhurried pace. The direction tells you what the moment is FOR; you decide what she says.',
    ...req.scenes.map(
      (sc) =>
        `\nScene ${sc.index} — ${sc.title} · ${sc.seconds}s · at most ${sc.words} words${
          sc.card ? ` · an on-screen card reads "${sc.card}", so do not say it aloud` : ''
        }\n  The moment's job: ${sc.direction}`,
    ),
    '',
    'Before you answer, read your lines back. If any line would work for a different dealership, a different car, or a different city, it is too generic — rewrite it.',
    '',
    'Return JSON only: an array of {"index": <scene index>, "line": "<the spoken line>"}. One object per scene, in order. No commentary.',
  ].join('\n');
}

/* ---------------------------- pass 2: pronounce ---------------------------- */

function phoneticInstruction(
  lines: { index: number; line: string }[],
  language: ScriptLanguage,
): string {
  const usable = language.glossary.filter((g) => g.term?.trim() && g.say?.trim());
  const respell = usable.filter((g) => g.mode !== 'english');
  const asEnglish = usable.filter((g) => g.mode === 'english');

  return [
    `You repair the pronunciation of ${language.name} ad copy for an AI video model. You are given the finished line; you return the same line with a FEW words respelled where the model would otherwise say them wrong.`,
    '',
    'This is a light touch, not a conversion. Most of the line — usually all of it — comes back unchanged. Respelling a word that was already fine makes it worse, and respelling everything makes the whole line sound like a phrasebook being read aloud.',
    '',
    'NEVER respell a number, price, quantity or unit. Those are already in English and must stay exactly as they are: "fifteen lakh four thousand" stays "fifteen lakh four thousand", not "pandrah LAAKH chaar ha-ZAAR".',
    '',
    language.spokenGuide.trim(),
    '',
    ...(respell.length
      ? [
          '## LOCKED SPELLINGS — always use these exact forms',
          ...respell.map((g) => `  ${g.term} → ${g.say}${g.note ? `  (${g.note})` : ''}`),
          '',
        ]
      : []),
    ...(asEnglish.length
      ? [
          '## LEAVE THESE IN ENGLISH — never respell them',
          'The model already says these correctly. Write them exactly as shown.',
          ...asEnglish.map((g) => `  ${g.term} → ${g.say}${g.note ? `  (${g.note})` : ''}`),
          '',
        ]
      : []),
    '## WORKED EXAMPLE',
    'Line:  नई दिल्ली के Jasper Cars showroom का glass facade देखिए!',
    'Right: नई दिल्ली के Jasper Cars showroom का glass facade देखिए!',
    '       — nothing needed fixing. A place name, a dealership name and two English words all stay as they are.',
    'Wrong: NYOO DEL-ee ke JAS-par KAARZ SHO-room ka GLAAS fa-SAAD DE-khi-ye!',
    '       — every word mangled, including four that were already correct.',
    '',
    'Line:  यह automatic variant fifteen lakh four thousand का है।',
    'Right: यह automatic variant fifteen lakh four thousand का है।',
    '       — nothing changed. The price is already English and must stay that way.',
    '',
    '## THE LINES',
    'Return each line with the meaning and word order identical. Do not add, drop, reorder or translate words — only change the spelling of the few that need it.',
    ...lines.map((l) => `${l.index}: ${l.line}`),
    '',
    'Return JSON only: an array of {"index": <the same index>, "say": "<the line, mostly unchanged>"}. One object per line, in order. No commentary.',
  ].join('\n');
}

/* --------------------------------- driver --------------------------------- */

export async function writeScript(
  req: ScriptRequest,
  apiKey: string,
): Promise<{ model: string; lines: ScriptLine[] }> {
  if (!req.scenes.length) return { model: '', lines: [] };

  const copy = parseRows(await ask(copyInstruction(req), apiKey, 1.0, 'write'), 'line').map((r) => ({
    index: r.index,
    line: r.text,
  }));
  if (!copy.length) throw new ScriptError('script-unparseable', 'The model did not return any usable lines.');

  const lines = await addPhonetics(copy, req.language, apiKey);
  return { model: await resolveTextModel(apiKey, 'write'), lines };
}

/**
 * Pass 2 on its own. Exposed so a tuned pronunciation guide can be re-applied to
 * copy that is already approved, without paying to rewrite it.
 */
export async function addPhonetics(
  lines: { index: number; line: string }[],
  language: ScriptLanguage,
  apiKey: string,
): Promise<ScriptLine[]> {
  const usable = lines.filter((l) => Number.isFinite(l.index) && l.line?.trim());
  if (!usable.length) return [];
  // A language written the way it is said needs no transform.
  if (!language.needsPhonetics || !language.spokenGuide.trim()) {
    return usable.map((l) => ({ index: l.index, line: l.line, say: l.line }));
  }

  // Temperature 0: this is a transform against a rulebook, not a creative step.
  const said = new Map(
    parseRows(await ask(phoneticInstruction(usable, language), apiKey, 0, 'transform'), 'say').map((r) => [
      r.index,
      r.text,
    ]),
  );
  // A line the pass missed keeps its readable form — still better than nothing.
  return usable.map((l) => ({ index: l.index, line: l.line, say: said.get(l.index) || l.line }));
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
