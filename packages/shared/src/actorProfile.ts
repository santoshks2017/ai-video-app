/**
 * An actor made from a description.
 *
 * A designer describes the presenter they want in a sentence. A text model fills in
 * the profile — name, age, look, voice, personality — and an image model draws the
 * profile sheet: the same person in a hero shot, a row of expressions, and the four
 * full views a video model needs to hold a face steady from every side. The sheet
 * becomes the actor's reference photo, the same kind of sheet the library's presenters
 * were already built on.
 *
 * What the models are asked, and what is kept of what they answer, is decided here,
 * where it can be tested; the server only carries it to them.
 */
import { AGE_BANDS, type ActorProfile, type AgeBand } from './library.js';
import type { Gender } from './types.js';

/** What the text model may fill in. `setting` is for the sheet only and is not kept on the actor. */
export interface ActorFill {
  name?: string;
  gender?: Gender;
  age?: string;
  ageBand?: AgeBand;
  attire?: string;
  style?: string;
  voice?: string;
  personality?: string;
  traits?: string[];
  /** Where the hero photograph is taken. */
  setting?: string;
}

const clean = (v: unknown, max = 300): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
};

/** Whatever came back, reduced to fields that fit the profile. Anything unusable is left out, not blanked. */
export function normalizeActorFill(raw: unknown): ActorFill {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const g = clean(o.gender, 20)?.toLowerCase();
  const gender: Gender | undefined =
    g && /^(female|woman|girl|f)$/.test(g) ? 'female' : g && /^(male|man|boy|m)$/.test(g) ? 'male' : undefined;
  const band = clean(o.ageBand, 12)?.replace(/\s*(?:-|–|—|to)\s*/g, '–');
  const traitList = Array.isArray(o.traits) ? o.traits : typeof o.traits === 'string' ? o.traits.split(/[,;/|]/) : [];
  const traits = [
    ...new Set(
      traitList
        .map((t) => clean(t, 24))
        .filter((t): t is string => Boolean(t))
        .map((t) => t.charAt(0).toUpperCase() + t.slice(1)),
    ),
  ].slice(0, 6);
  const out: ActorFill = {
    name: clean(o.name, 60),
    gender,
    age: clean(o.age, 40),
    ageBand: AGE_BANDS.find((b) => b === band),
    attire: clean(o.attire, 40),
    style: clean(o.style),
    voice: clean(o.voice, 120),
    personality: clean(o.personality, 400),
    traits: traits.length ? traits : undefined,
    setting: clean(o.setting, 120),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as ActorFill;
}

/** The text model's instructions for filling a profile from a description. */
export function actorFillPrompt(description: string, current: Partial<ActorProfile> = {}): string {
  const known = Object.fromEntries(
    Object.entries({
      name: current.name,
      gender: current.gender,
      age: current.age,
      attire: current.attire,
      style: current.style,
      voice: current.voice,
      personality: current.personality,
      traits: current.traits,
    }).filter(([, v]) => (Array.isArray(v) ? v.length : Boolean(v))),
  );
  return [
    'You are casting an on-camera presenter for Indian car-dealership video ads.',
    'From the description below, fill in the presenter’s profile. Keep everything the description says, word for word where it gives specifics. Invent only what it leaves out, and invent it specifically and plausibly for an Indian presenter — not generically.',
    '',
    'Return JSON only, with exactly these keys:',
    '{',
    '  "name": a first name, unless the description gives a full name or a label,',
    '  "gender": "female" or "male",',
    '  "age": how you would say it, e.g. "late 20s",',
    `  "ageBand": one of ${AGE_BANDS.map((b) => `"${b}"`).join(', ')},`,
    '  "attire": what they wear in one or two words, e.g. "Saree",',
    '  "style": wardrobe, hair and jewellery in one sentence,',
    '  "voice": the delivery in a few words, e.g. "warm, confident ad pace",',
    '  "personality": one or two sentences on who they are on camera,',
    '  "traits": four to six single words,',
    '  "setting": where their hero photograph is taken, in a few words, e.g. "a bright car showroom"',
    '}',
    '',
    `Description: """${description.trim()}"""`,
    ...(Object.keys(known).length
      ? ['', `The profile already has these; keep any the description does not contradict: ${JSON.stringify(known)}`]
      : []),
  ].join('\n');
}

const words = (s: string | undefined, n: number): string => {
  const w = (s ?? '').split(/\s+/).filter(Boolean);
  return (w.length > n ? w.slice(0, n).join(' ') : w.join(' ')).replace(/[,;:.–—-]+$/, '');
};
/** Double quotes delimit the words to be lettered; any inside them would end the quote early. */
const letterable = (s: string): string => s.replace(/["“”]/g, "'");
const capitalise = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export interface ActorSheetOptions {
  /** Where the hero photograph is taken. */
  setting?: string;
  /** A photograph of the person is attached, and the sheet is to keep that face. */
  keepFace?: boolean;
}

/**
 * The image model's brief for a profile sheet.
 *
 * Every word it is to letter is given in quotes and kept short, because the longer
 * a line, the likelier a misspelling; and it is told to write nothing else, so no
 * brand, badge or number plate turns up on a sheet that is then sent to a video
 * model as a record of what this person looks like.
 */
export function actorSheetPrompt(
  a: Pick<ActorProfile, 'name' | 'gender' | 'age' | 'ageBand' | 'attire' | 'style' | 'voice' | 'personality' | 'traits'>,
  opts: ActorSheetOptions = {},
): string {
  const woman = a.gender !== 'male';
  const they = woman ? 'she' : 'he';
  // "Meera — Metro Premium promoter" is a label for the library; the sheet says "Meera".
  const name = letterable(words((a.name ?? '').split(/\s+[—–-]\s+|\s*\(/)[0], 3) || 'Presenter');
  const age = a.age?.trim() || a.ageBand || (woman ? 'late 20s' : 'early 30s');
  const look = a.style?.trim() || a.attire?.trim() || 'smart, modern presenter wardrobe';
  const rows: [string, string][] = [
    ['Gender', woman ? 'Female' : 'Male'],
    ['Age range', capitalise(age)],
    ['Voice / delivery', capitalise(words(a.voice, 6) || 'Warm, confident ad pace')],
    ['Styling / look', capitalise(words(a.attire || a.style, 5))],
  ].filter((r): r is [string, string] => Boolean(r[1]));
  const about = words(a.personality, 36);
  const traits = (a.traits ?? []).slice(0, 6).map(letterable);
  const setting = opts.setting?.trim() || 'a bright, modern car showroom';

  return [
    'Design a presenter profile sheet: a polished casting card in portrait orientation, on a soft warm off-white background with generous margins, clean modern sans-serif type and rounded panels.',
    '',
    'THE PERSON',
    `- A photorealistic Indian ${woman ? 'woman' : 'man'}, ${age}.`,
    `- Look: ${look}.`,
    ...(a.personality ? [`- On camera ${they} is: ${letterable(a.personality)}`] : []),
    ...(opts.keepFace
      ? [
          `- ${capitalise(they)} is the person in the attached photograph. Keep that face, skin tone, hair and build exactly; change only what the look above describes.`,
        ]
      : []),
    '- The same person in every photograph on the sheet: identical face, hair, skin tone, outfit and jewellery throughout.',
    '',
    'LAYOUT, TOP TO BOTTOM',
    `1. A large hero photograph on the left: ${they} stands in ${setting}, speaking warmly to camera, waist-up. On the right, the name "${name}" in large bold type, with "AI AVATAR PROFILE" in small capitals beneath it; then these labelled rows, each with a simple line icon:`,
    ...rows.map(([label, value]) => `   "${label}" — "${letterable(value)}"`),
    ...(about ? [`   Then a short paragraph: "${letterable(about)}"`] : []),
    ...(traits.length ? [`   Then "KEY TRAITS" with rounded tags: ${traits.map((t) => `"${t}"`).join(', ')}.`] : []),
    `2. "EXPRESSIONS": five head-and-shoulders photographs in a row, captioned "Smile", "Speaking", "Listening", "Excited", "Thoughtful".`,
    `3. "FULL VIEWS": four full-length photographs on a plain light-grey studio background, captioned "Front View", "Left Profile", "Right Profile", "Back View", and a fifth, a close-up of the face, captioned "Close-up".`,
    '',
    'RULES',
    '- Real photography with natural skin texture and soft, even light. Not an illustration, a 3D render or a cartoon.',
    '- Spell every quoted word exactly as written, and letter nothing else: no logos, brand names, watermarks, car badges or number plates anywhere, including in the backgrounds.',
    '- One person only, in every photograph. Natural hands.',
  ].join('\n');
}
