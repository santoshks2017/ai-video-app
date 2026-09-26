/**
 * Project Image on the server: the words of a creative from the Google text model, and its
 * picture from the image model — with the real car, from the library's own photographs.
 *
 * The words here are the ones set on the picture, and nothing else: a post's caption, its
 * hashtags and its search line belong to the tool that posts it.
 *
 * Two ways to a creative. Nano Banana 2 can design the whole of it — the car, the scene and the
 * words set into it — with the words read back and checked against the copy, and the logos and
 * dealer panel laid over it by the browser. Or it draws a scene with no writing at all, and the
 * browser sets every word on it as a layer that stays editable.
 */
import {
  COPY_LIMITS,
  COPY_LIMITS_NATIVE,
  CREATIVE_ENGINE_BY_ID,
  CREATIVE_FORMAT_BY_ID,
  DEFAULT_USD_TO_INR,
  isAdFormat,
  pictureTrim,
  unnamed,
  emptyCopy,
  isCreativeEngine,
  tidyCopy,
  usageCostUsd,
  type CopyClient,
  type CreativeCopy,
  type CreativeEngineId,
  type CreativeFormatId,
  type CreativeTemplateId,
  designLines,
  type DesignWords,
  type DesignZones,
  type PictureAspect,
  type ReadBlock,
  type TokenUsage,
} from '@ava/shared';
import { requestImage, resolveNanoBanana2, resolveSheetImageModel, type ImagePart } from './sceneImage.js';
import { resolveTextModel } from './script.js';
import { recordUsage } from './spendLog.js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

export class CreativeError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

const inr = (model: string, usage: TokenUsage | undefined): number => (usage ? usageCostUsd(model, usage) * DEFAULT_USD_TO_INR : 0);

/* ============================== the words ============================== */

export interface CopyRequest {
  engine: { primary: CreativeEngineId; secondary?: CreativeEngineId; ratio?: string };
  /** What the post is about, in the designer's words. */
  prompt: string;
  /** The engine's facts, by their labels. */
  facts: Array<{ label: string; value: string }>;
  client: CopyClient & { segment?: string; styleNote?: string };
  vehicle?: { model: string; brand?: string; colour?: string; highlights?: string[] };
  language: { name: string; script: 'latin' | 'indic'; hinglish?: boolean; guide?: string };
  voiceNote?: string;
  occasion?: string;
  validity?: string;
}

/** The instruction for the copy: the engine's beats and rules, the client, the facts, the limits. */
export function copyPrompt(req: CopyRequest): string {
  const e = CREATIVE_ENGINE_BY_ID[req.engine.primary];
  const second = req.engine.secondary ? CREATIVE_ENGINE_BY_ID[req.engine.secondary] : undefined;
  const limits = req.language.script === 'indic' ? COPY_LIMITS_NATIVE : COPY_LIMITS;
  const who = req.client.kind === 'oem' ? `${req.client.name}, the manufacturer` : `${req.client.name}, a ${req.client.brand ?? ''} dealership${req.client.city ? ` in ${req.client.city}` : ''}`.replace(/  +/g, ' ');
  const lang = req.language.hinglish
    ? 'Hinglish: everyday Hindi written in the Latin alphabet, mixed naturally with English, the way Indian dealers write on Instagram. Numbers, ₹ amounts and model names as they are.'
    : req.language.script === 'indic'
      ? `${req.language.name}, in its own script. Model names, brand names and ₹ amounts stay in Latin letters and digits.${req.language.guide ? ` ${req.language.guide}` : ''}`
      : 'English — Indian English, warm and clear.';
  const lines: string[] = [
    `You write social media creatives for ${who}. A creative is a picture with a few words set on it — those words and nothing else: no caption, no hashtags, nothing that is said around the picture when it is posted.`,
    '',
    `## The kind of post: ${e.label}${second ? ` blended with ${second.label} at ${req.engine.ratio ?? '60/40'} — the first leads` : ''}`,
    `Purpose: ${e.purpose}`,
    `On the picture: ${e.onImage}`,
    `Avoid: ${e.avoid.join('; ')}.`,
  ];
  if (second) {
    lines.push(`The second kind (${second.label}) adds: ${second.onImage} Avoid: ${second.avoid.join('; ')}.`);
  }
  lines.push('', '## The brief', req.prompt.trim() || '(no more than the facts below)');
  if (req.occasion) lines.push(`Occasion: ${req.occasion}`);
  for (const f of req.facts) if (f.value.trim()) lines.push(`${f.label}: ${f.value.trim()}`);
  if (req.vehicle) {
    lines.push(
      '',
      '## The vehicle',
      `${[req.vehicle.brand, req.vehicle.model].filter(Boolean).join(' ')}${req.vehicle.colour ? `, in ${req.vehicle.colour}` : ''}.`,
    );
    if (req.vehicle.highlights?.length) lines.push(`What it offers, for you to draw on (never invent more): ${req.vehicle.highlights.slice(0, 8).join('; ')}.`);
  }
  lines.push('', '## The client');
  if (req.client.tagline) lines.push(`Tagline: ${req.client.tagline}`);
  if (req.client.segment) lines.push(`Segment: ${req.client.segment}`);
  if (req.client.styleNote) lines.push(`How they present themselves: ${req.client.styleNote}`);
  if (req.voiceNote?.trim()) lines.push(`Their voice, in their words (signature phrases to use, things to avoid): ${req.voiceNote.trim()}`);
  lines.push(
    '',
    '## Language',
    `Write the words on the picture in ${lang}`,
    '',
    '## Rules — every one of them',
    `- On the picture, words are few and exact. Headline at most ${limits.headline} characters; kicker (a small line above it) at most ${limits.kicker}; second line at most ${limits.sub}; badge at most ${limits.badge}; each point at most ${limits.point}; call to action at most ${limits.cta}.`,
    '- No emoji: these words are set on a picture, not typed into a post.',
    '- Rupees always as ₹2,15,000 — never Rs., INR or 2.15L on the picture. Use "up to ₹X", never "₹X off", and never a percentage discount.',
    '- Every price, EMI, benefit or discount claim ends with an asterisk (*), and then `terms` holds the T&C line.',
    '- No unsubstantiated superlatives ("best", "#1", "unbeatable") unless the brief gives the proof.',
    '- Use only facts from the brief, the facts and the vehicle above. Never invent a price, a date, a number or a feature.',
    "- The dealership's name, address and phone are set by the app on the creative itself. Never write them into any of these lines.",
    '- Two alternative headlines, each a different angle.',
    '',
    '## Return JSON only, exactly this shape',
    '{"headline": "", "alternatives": ["", ""], "kicker": "", "sub": "", "badge": "", "points": [""], "cta": "", "terms": ""}',
    'Leave "badge" empty unless there is an offer, a price or a number worth a badge; leave "points" empty unless the post is a list of offers, features or inclusions.',
  );
  return lines.join('\n');
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).map((s) => s.trim()).filter(Boolean) : []);
/** The copy out of whatever came back: fenced, wrapped in prose, or partly missing. */
export function parseCopy(text: string): CreativeCopy {
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (from < 0 || to <= from) throw new CreativeError('copy-unreadable', 'The copy came back in a form that cannot be read. Try again.');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(from, to + 1)) as Record<string, unknown>;
  } catch {
    throw new CreativeError('copy-unreadable', 'The copy came back in a form that cannot be read. Try again.');
  }
  const copy = {
    ...emptyCopy(),
    headline: str(raw.headline).trim(),
    alternatives: strs(raw.alternatives),
    kicker: str(raw.kicker).trim(),
    sub: str(raw.sub).trim(),
    badge: str(raw.badge).trim(),
    points: strs(raw.points),
    cta: str(raw.cta).trim(),
    terms: str(raw.terms).trim(),
  };
  if (!copy.headline) throw new CreativeError('copy-empty', 'The copy came back without a headline. Try again.');
  return copy;
}

export async function writeCreativeCopy(req: CopyRequest, apiKey: string): Promise<{ copy: CreativeCopy; model: string; costInr: number }> {
  if (!isCreativeEngine(req.engine?.primary)) throw new CreativeError('copy-no-engine', 'Pick what kind of post this is first.', 400);
  const model = await resolveTextModel(apiKey, 'write');
  const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: copyPrompt(req) }] }],
      generationConfig: { temperature: 0.8, responseMimeType: 'application/json' },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string; status?: string };
    usageMetadata?: TokenUsage;
  };
  if (!res.ok) throw new CreativeError(json.error?.status ?? 'copy-failed', json.error?.message ?? `The text model returned ${res.status}.`);
  recordUsage('Creative copy', model, json.usageMetadata);
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  const copy = tidyCopy(parseCopy(text), { validity: req.validity, native: req.language.script === 'indic' });
  return { copy, model, costInr: inr(model, json.usageMetadata) };
}

/* ============================== the picture ============================== */

/** How each occasion is dressed — the decorations, never any writing. */
export const OCCASION_SCENES: Record<string, string> = {
  Diwali: 'a Diwali evening: rows of lit clay diyas, warm fairy lights, marigold garlands and a rangoli on the ground, a soft golden glow at dusk',
  Dhanteras: 'a Dhanteras evening: brass lamps, marigold garlands and warm golden light, festive and auspicious',
  'Bhai Dooj': 'a warm family festive evening with diyas and marigolds',
  Navratri: 'a Navratri night: colourful garba lights, festive drapes and dancing lights in the background',
  'Durga Puja': 'a Durga Puja evening: pandal lights, red and white festive drapes, warm crowd glow far in the background',
  Dussehra: 'a Dussehra evening: marigold toran, festive lights, a clear dusk sky',
  Holi: 'a bright Holi spring day: soft clouds of coloured powder drifting far in the background, the car itself spotless',
  'Eid ul-Fitr': 'an Eid evening: crescent-moon lanterns, warm lights and a calm, elegant street',
  'Eid ul-Adha': 'an Eid evening: lanterns, warm lights and a calm, elegant street',
  Christmas: 'a Christmas evening: fairy lights and a decorated tree, a cosy glow',
  'New Year': 'a New Year night: city lights and gentle fireworks high in the sky',
  'Independence Day': 'Independence Day: saffron, white and green bunting under a clear blue sky, proud and bright',
  'Republic Day': 'Republic Day: saffron, white and green bunting under a clear blue sky, proud and bright',
  'Ganesh Chaturthi': 'a Ganesh Chaturthi celebration: marigold decorations, festive lights and a joyful street',
  'Raksha Bandhan': 'a warm family moment outside a home, festive decorations and soft light',
  Janmashtami: 'a Janmashtami evening: marigolds, peacock-blue drapes and warm lamps',
  Onam: 'an Onam morning: a floral pookalam on the ground, banana leaves and bright daylight',
  'Makar Sankranti': 'a Makar Sankranti day: colourful kites high in a blue sky',
  'Chhath Puja': 'a Chhath evening by the water with warm lamps and a setting sun',
};

export interface SceneRequest {
  aspect: PictureAspect;
  engine: CreativeEngineId;
  occasion?: string;
  vehicle: { name: string; colour?: string; kind?: 'car' | 'bike' };
  /** Designer's direction, added to the scene. */
  note?: string;
  /** Where the words will sit, so the picture keeps it calm. */
  textBand: 'top' | 'left';
  /** With the words at the top: how far down they reach, as a fraction of the height. */
  band?: number;
  panel: boolean;
  /** The creative's colours, as a mood for the light. */
  mood?: { panel: string; accent: string };
  /** The last reference image is the approved creative this picture must match. */
  match?: boolean;
}

/** The instruction for the picture: this vehicle, this scene, room for the words, no writing at all. */
export function sceneInstruction(req: SceneRequest, rawLabels: string[]): string {
  const noun = req.vehicle.kind === 'bike' ? 'motorcycle' : 'car';
  // A label beside a photograph is the name again — "the Hyundai Creta, front" —
  // and a name is what fetches the car that wore it longest.
  const refLabels = rawLabels.map((l) => unnamed(l, req.vehicle.name, req.vehicle.kind === 'bike' ? 'bike' : 'car'));
  const e = CREATIVE_ENGINE_BY_ID[req.engine];
  const scene = (req.occasion && OCCASION_SCENES[req.occasion]) || e?.scene || 'a clean, premium setting';
  const tall = req.aspect === '9:16' || req.aspect === '4:5';
  const band = typeof req.band === 'number' && Number.isFinite(req.band) ? Math.round(Math.min(0.6, Math.max(0.25, req.band)) * 100) : null;
  const place =
    req.textBand === 'left'
      ? `Put the ${noun} in the right half of the frame; keep the left half calm and uncluttered — soft background, no busy detail — because a headline will be set there.`
      : band
        ? `Keep the top ${band}% of the frame calm and uncluttered — soft sky or plain background — because the headline and its lines will be set there. Put the whole ${noun} below that band, in the lower part of the frame, never reaching up into it.`
        : `Put the ${noun} in the ${tall ? 'middle and lower half' : 'lower two-thirds'} of the frame; keep the top third calm and uncluttered — soft sky or plain background — because a headline will be set there.`;
  return [
    `Make one photograph for a social media post by an Indian ${noun} dealership. Frame: ${req.aspect}.`,
    '',
    '## References',
    ...refLabels.map((l, i) => `<IMAGE_REF_${i}> — ${l}`),
    '',
    `## The ${noun}`,
    `<IMAGE_REF_0> is the ${noun} this picture is about${req.vehicle.colour ? `, in ${req.vehicle.colour}` : ''}. Put THIS ${noun} in the photograph: the same body shape, grille, headlamps, tail-lamps, badges, alloy wheels and trim as in the reference photographs${refLabels.length > 1 ? ', which show its other sides' : ''}. You are not told what it is called and you do not need to know: the photographs are its only description. Build it only from them — never from a name, and never from an older or different model.`,
    `NUMBER PLATES ARE PLAIN WHITE AND BLANK — a hard rule. Wherever the front or back of the ${noun} is in frame, its plate is there, as a plain white plate with nothing on it: no letters, no numbers, no state code, no dealer name, no sticker. The same for any other vehicle in the frame. Writing on a plate in the reference photographs is not part of the ${noun}; never copy it.`,
    `The ${noun} is whole and uncropped, sharp, the hero of the picture${tall ? '' : ', about half the width of the frame'}, seen three-quarters from the front unless the reference angle suggests otherwise, on the ground with correct contact shadows under the tyres and true reflections in the paint and glass.`,
    '',
    '## The scene',
    `${scene}.${req.note?.trim() ? ` ${req.note.trim()}` : ''} Photorealistic, like a professional automotive campaign photograph — real light, real materials, no illustration or CGI look, no people in the foreground.`,
    req.mood ? `Light and colour that sit well with the creative's colours: ${req.mood.panel} and ${req.mood.accent}.` : '',
    req.match ? 'One of the references is this same advertisement, already approved at another size: keep its scene, palette and light, recomposed for this frame. The picture carries no words over from it — it carries no words at all.' : '',
    '',
    '## Composition',
    place,
    req.panel ? 'Keep the bottom sixth simple too: a contact panel will cover it.' : '',
    '',
    '## No writing — anywhere',
    `The photograph carries no text of any kind: no words, letters, numbers, prices, logos, watermarks, signs, banners, posters, captions or labels — on the ground, the walls, screens, the sky or the ${noun} (apart from the manufacturer's own badge exactly as in the photographs). All words are added afterwards.`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export async function drawCreativeScene(
  req: SceneRequest,
  refs: Array<{ bytes: Buffer; mimeType: string; label: string }>,
  apiKey: string,
): Promise<{ bytes: Buffer; mimeType: string; model: string; costInr: number }> {
  if (!refs.length) throw new CreativeError('scene-no-photo', 'Pick a photo of the vehicle first — the picture is built from it.', 400);
  const model = await resolveSheetImageModel(apiKey);
  const parts: ImagePart[] = [
    { text: sceneInstruction(req, refs.map((r) => r.label)) },
    ...refs.map((r) => ({ inline_data: { mime_type: r.mimeType, data: r.bytes.toString('base64') } })),
  ];
  const out = await requestImage(model, parts, apiKey, [{ aspectRatio: req.aspect, imageSize: '2K' }, { aspectRatio: req.aspect }], 0.5, 'Creative images');
  return { bytes: out.bytes, mimeType: out.mimeType, model: out.model, costInr: inr(out.model, out.usage) };
}

/* ============================== the design ============================== */

/**
 * A whole creative from Nano Banana 2: the real car in a scene, and every word — the headline,
 * the offer, the dealership's strip, the small print — designed into one piece. It designs on a
 * canvas with the client's logos already in their places, so it works around the real logos
 * instead of inventing its own; the app lays the exact logo files back on afterwards.
 */
/** What a reference image is to the design: a style to follow, the same ad at another size, or the photograph it is built on. */
export type DesignReferenceKind = 'style' | 'master' | 'base-photo';

export interface DesignRequest {
  format: CreativeFormatId;
  engine: CreativeEngineId;
  secondary?: CreativeEngineId;
  /** The layout's character, which sets the typography. Unset: the engine's own. */
  template?: CreativeTemplateId;
  occasion?: string;
  vehicle: { name: string; colour?: string; kind?: 'car' | 'bike' };
  /** Designer's direction for the scene. */
  note?: string;
  words: DesignWords;
  language: { name: string; script: 'latin' | 'indic' };
  look: { panel: string; accent: string };
  zones: DesignZones;
  /** The canvas with the logos in place, and how many logos are on it. */
  canvas?: { storagePath: string; logos: number };
  /** An image the design builds from, read by `kind`; `changes` only with 'style'. */
  reference?: { storagePath: string; kind: DesignReferenceKind; changes?: string };
}

const TYPE_MOOD: Record<CreativeTemplateId, string> = {
  hero: 'Confident and premium: a clean, bold modern sans-serif headline, generous space around it',
  offer: 'A bold retail offer: a heavy, condensed headline, and a price badge that pops',
  festival: 'Warm and festive: an elegant serif greeting with a festive glow — emotion before promotion',
  feature: 'Clean, modern and a little technical: a bold sans-serif headline and tidy points',
  launch: 'Dark and dramatic, like a film poster: tall, bold capitals and cinematic light',
  delivery: 'Warm and celebratory: an elegant serif with a personal, joyful touch',
};

const pct = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 100);
const pct1 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 10;
const quoted = (s: string): string => `"${s.replace(/"/g, '”')}"`;

/** The words a design is asked to set, each with its part in the hierarchy. */
function wordsBrief(w: DesignWords): string[] {
  const out: string[] = [];
  if (w.kicker) out.push(`- Small line above the headline: ${quoted(w.kicker)}`);
  if (w.headline) out.push(`- Headline — the largest, boldest words on the creative by far: ${quoted(w.headline)}`);
  if (w.sub) out.push(`- Second line, under the headline, much smaller: ${quoted(w.sub)}`);
  if (w.badge) out.push(`- Offer badge — a bold tag or sticker shape in the accent colour that stands out: ${quoted(w.badge)}`);
  if (w.points.length) out.push(`- Points, as a short list with ticks or bullets, one per line: ${w.points.map(quoted).join(' / ')}`);
  if (w.cta) out.push(`- Button — a rounded pill in the accent colour: ${quoted(w.cta)}`);
  return out;
}

/** Every ₹ amount on the creative, named — the commas land exactly where Indian grouping puts them. */
function amountsBrief(w: DesignWords): string[] {
  const amounts = [...new Set(designLines(w).flatMap((l) => l.match(/₹[\d,]+/g) ?? []))];
  return amounts.length
    ? [`Every amount keeps its digits and its commas exactly as written — ${amounts.map(quoted).join(', ')} — never regrouped, never a comma moved, never a digit more or less.`]
    : [];
}

/** The dealership's strip and the small print. */
function stripBrief(req: DesignRequest): string[] {
  const w = req.words;
  const out: string[] = [];
  if (w.strip) {
    const share = Math.max(10, Math.min(24, 100 - pct(req.zones.stripTop)));
    out.push(
      '',
      '## The dealership strip',
      `Across the bottom, about ${share}% of the height: a strip that belongs to the design — in its colours and its style, not a box pasted on — with clear space between it and the vehicle above. It carries exactly:`,
    );
    if (w.strip.name) out.push(`- The dealership's name, bold, the largest words in the strip: ${quoted(w.strip.name)}`);
    for (const l of w.strip.lines) out.push(`- ${w.strip.name ? 'Then, smaller' : 'One line'}: ${quoted(l)}`);
    if (w.strip.cta) out.push(`- A button on the strip's right, a rounded pill in the accent colour: ${quoted(w.strip.cta)}`);
  }
  if (w.terms) out.push(`${w.strip ? '' : '\n'}- The small print, at the very bottom, small but legible: ${quoted(w.terms)}`);
  return out;
}

/** Where the words, the car and the strip go, for this size. */
function layoutBrief(req: DesignRequest, noun: string): string[] {
  const f = CREATIVE_FORMAT_BY_ID[req.format];
  const z = req.zones;
  const out: string[] = [
    z.textSide === 'left'
      ? `Put the words in the left half of the frame and the whole ${noun} in the right half.`
      : `Put the words in the upper part of the frame${z.logoBand > 0 ? ', below the logos' : ''}, and the whole ${noun} below them.`,
    `Nothing overlaps: no word on the ${noun}, no word on a logo, no word on another word, and nothing touching the edges.`,
  ];
  if (f.safeTop > 0) out.push(`Keep every word out of the top ${pct(f.safeTop) + 2}% and the bottom ${pct(f.safeBottom) + 2}% — the platform's own controls cover them.`);
  // With no strip to set, the app lays its own dealer panel over the foot afterwards.
  if (!req.words.strip && req.zones.stripTop < 0.99) {
    out.push(
      `The dealership's own contact panel is laid over the bottom ${100 - pct(req.zones.stripTop)}% of the frame afterwards: put no words there, keep the whole ${noun} above that band, and leave the band as simple, calm ground.`,
    );
  }
  // A size not drawn at its own shape is cut from the picture: nothing that matters may sit where it is cut.
  const trim = pictureTrim(req.format);
  if (trim.each > 0.015) {
    out.push(`The ${trim.sides === 'top-bottom' ? 'top and bottom' : 'left and right'} ${Math.ceil(trim.each * 100) + 1}% may be trimmed: keep every word, the logos' surroundings and the whole ${noun} clear of them.`);
  }
  out.push('Leave comfortable margins: no word closer than 5% to any edge of the frame. Align everything to a clear grid.');
  return out;
}

/** The instruction for a whole creative: the canvas, this vehicle, these words exactly and nothing else. */
export function designInstruction(req: DesignRequest, rawLabels: string[]): string {
  const noun = req.vehicle.kind === 'bike' ? 'motorcycle' : 'car';
  const carLabels = rawLabels.map((l) => unnamed(l, req.vehicle.name, req.vehicle.kind === 'bike' ? 'bike' : 'car'));
  const f = CREATIVE_FORMAT_BY_ID[req.format];
  const ad = isAdFormat(req.format);
  const e = CREATIVE_ENGINE_BY_ID[req.engine];
  const second = req.secondary ? CREATIVE_ENGINE_BY_ID[req.secondary] : undefined;
  const template = req.template ?? e?.template ?? 'hero';
  const scene = (req.occasion && OCCASION_SCENES[req.occasion]) || e?.scene || 'a clean, premium setting';
  const canvas = Boolean(req.canvas);
  const refIdx = canvas ? 1 : 0;
  const car = refIdx + (req.reference ? 1 : 0);
  const basePhoto = req.reference?.kind === 'base-photo';
  // The smallest words at the creative's own pixels: small print, then everything else.
  const tiny = pct1((ad ? 9 : 22) / f.height);
  const small = pct1((ad ? 11 : 30) / f.height);
  return [
    ad
      ? `Design one finished display advertisement for an Indian ${noun} dealership: a banner for CarDekho, India's car marketplace (${f.platforms}). It is shown at just ${f.width}×${f.height} pixels on a web page, so it carries very few words, very large and bold, and one clear button. Draw it at aspect ${f.pictureAspect}.`
      : `Design one finished social media advertisement for an Indian ${noun} dealership: a ${f.label} post (${f.platforms}), ${f.width}×${f.height} pixels, aspect ${f.pictureAspect}.`,
    'Make it look like the work of a top automotive advertising agency: one clear idea, a strong hierarchy, generous space, everything aligned, nothing crowded.',
    e ? `It is a ${e.label} post${second ? `, blended with ${second.label}` : ''}. ${e.purpose}` : '',
    e?.avoid.length ? `Avoid: ${e.avoid.join('; ')}.` : '',
    '',
    '## References',
    ...(canvas ? ["<IMAGE_REF_0> — the canvas: this creative's exact shape, with the client's logos already in their final places"] : []),
    ...(req.reference
      ? [
          `<IMAGE_REF_${refIdx}> — ${
            req.reference.kind === 'style'
              ? 'an earlier advertisement to design this one after'
              : req.reference.kind === 'master'
                ? 'this same advertisement, approved at another size'
                : 'the photograph this advertisement is built on'
          }`,
        ]
      : []),
    ...carLabels.map((l, i) => `<IMAGE_REF_${i + car}> — ${l}`),
    ...(canvas
      ? [
          '',
          '## The canvas',
          `Design the whole creative on <IMAGE_REF_0>. The logos on it are the client's real logos, already where they belong: keep each one exactly where it is — the same place, the same size, the same colours — and keep the ground around them calm and ${req.zones.logoTone}, so they read clearly. The grey is empty canvas: replace every bit of it with the design.`,
          `Add no other logo, emblem, brand name or wordmark anywhere — the logos on the canvas are the only ones (the manufacturer's badge on the ${noun} itself aside).`,
        ]
      : []),
    ...(req.reference
      ? [
          '',
          '## The reference',
          req.reference.kind === 'style'
            ? `<IMAGE_REF_${refIdx}> is an earlier advertisement. Design this one in its image: the same layout idea, palette, type feeling and mood — a fresh render in this frame, never a copy of its pixels. The words to set are the ones listed below, exactly.${req.reference.changes ? ` One thing changes from it: ${quoted(req.reference.changes)}.` : ''}`
            : req.reference.kind === 'master'
              ? `<IMAGE_REF_${refIdx}> is this same advertisement, already approved at another size. Keep its scene, palette and typography; adapt the composition to this frame. The words to set are the ones listed below, exactly.`
              : `<IMAGE_REF_${refIdx}> is the photograph this advertisement is built on. Keep the people and the vehicle in it exactly as photographed — the same faces, poses, clothes and vehicle, reframed to fit but never redrawn — and improve only the backdrop, the light and the grade. Design the words around them.`,
        ]
      : []),
    // No photographs of the vehicle: the reference carries it — as shot, or as the earlier advertisement drew it.
    ...(req.reference && !carLabels.length
      ? [
          '',
          `## The ${noun}`,
          basePhoto
            ? `The vehicle in the advertisement is the one in the photograph — keep it exactly as shot, including its number plate area, repainted plain white and blank.`
            : `The vehicle in the advertisement is the one in the reference advertisement: the same model, colour and trim, rebuilt faithfully. Its number plates are plain white and blank.`,
        ]
      : [
          '',
          `## The ${noun}`,
          `<IMAGE_REF_${car}> is the ${noun} this creative is about${req.vehicle.colour ? `, in ${req.vehicle.colour}` : ''}. Put THIS ${noun} in the creative: the same body shape, grille, headlamps, tail-lamps, badges, alloy wheels and trim as in the reference photographs${carLabels.length > 1 ? ', which show its other sides' : ''}. You are not told what it is called and you do not need to know: the photographs are its only description. A model name may appear in the words you set — that is a word to set, never a description to draw from. Build the ${noun} only from the photographs — never from a name, and never from an older or different model.`,
          `The ${noun} is whole and uncropped, sharp, the hero of the picture, on the ground with correct contact shadows and true reflections in the paint and glass.`,
          `NUMBER PLATES ARE PLAIN WHITE AND BLANK — a hard rule. Wherever the front or back of the ${noun} is in frame, its plate is a plain white plate with nothing on it: no letters, no numbers, no state code, no dealer name. Writing on a plate in the reference photographs is not part of the ${noun}; never copy it.`,
        ]),
    '',
    '## The scene',
    // Built on a photograph of people, the people are the point: only an empty scene keeps them out.
    `${scene}.${req.note?.trim() ? ` ${req.note.trim()}` : ''} Photorealistic, like a professional automotive campaign photograph — real light, real materials — with the words designed into it as a polished advertisement.${basePhoto ? '' : ' No people in the foreground.'}`,
    '',
    '## The words — set exactly these, and nothing else',
    'Spell every word exactly as written between the quotes: the same letters and capitals, the ₹ sign, the commas in numbers, every digit of a phone number, and every asterisk (*).',
    ...amountsBrief(req.words),
    ...wordsBrief(req.words),
    ...stripBrief(req),
    '',
    `No other text anywhere: nothing that is not listed above — no extra slogans, dates, prices, numbers, phone numbers, websites, hashtags or watermarks, and no writing on signs, screens or banners in the scene.`,
    req.language.script === 'indic'
      ? `The words are in ${req.language.name}, in its own script: set every conjunct and vowel sign correctly. Model names, brand names, ₹ amounts, phone numbers and websites stay in Latin letters and digits, exactly as written.`
      : '',
    '',
    '## Typography and colour',
    `${TYPE_MOOD[template]}. Type is crisp and easy to read ${ad ? `at ${f.width}×${f.height} pixels` : 'on a phone'}, with strong contrast against what is behind it. The headline takes at most two lines.`,
    `No word smaller than ${small}% of the height, and the small print no smaller than ${tiny}% of the height.`,
    `The creative's colours are ${req.look.panel} and ${req.look.accent}: use ${req.look.accent} for the badge, the button and small accents.`,
    '',
    '## Layout',
    ...layoutBrief(req, noun),
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/** The instruction for one change to a creative Nano Banana 2 already made. */
export function reviseInstruction(req: DesignRequest, change: string, carRefs: number): string {
  const noun = req.vehicle.kind === 'bike' ? 'motorcycle' : 'car';
  return [
    '<IMAGE_REF_0> is a finished social media advertisement.',
    carRefs ? `${Array.from({ length: carRefs }, (_, i) => `<IMAGE_REF_${i + 1}>`).join(', ')} ${carRefs === 1 ? 'is a photograph' : 'are photographs'} of the ${noun} in it.` : '',
    '',
    `Make this one change to the advertisement: ${quoted(change.trim())}`,
    '',
    `Keep everything else exactly as it is: the same ${noun} (as in the photographs), the same scene, layout, colours and typography, the logos exactly where they are, and every word exactly as written — unless the change asks for different words.`,
    `Number plates stay plain white and blank. Add no other text, logos or watermarks. Nothing may overlap: no word on the ${noun}, on a logo or on another word.`,
    `Frame: ${CREATIVE_FORMAT_BY_ID[req.format].pictureAspect}.`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

const designConfigs = (req: DesignRequest) => {
  const aspectRatio = CREATIVE_FORMAT_BY_ID[req.format].pictureAspect;
  return [{ aspectRatio, imageSize: '2K' }, { aspectRatio }];
};

export async function drawCreativeDesign(
  req: DesignRequest,
  canvas: { bytes: Buffer; mimeType: string } | null,
  reference: { bytes: Buffer; mimeType: string } | null,
  refs: Array<{ bytes: Buffer; mimeType: string; label: string }>,
  apiKey: string,
): Promise<{ bytes: Buffer; mimeType: string; model: string; costInr: number }> {
  // A reference carries the vehicle when there are no photographs of it: the moment as shot, or the earlier advertisement.
  if (!refs.length && !req.reference)
    throw new CreativeError('design-no-photo', 'Pick a photo of the vehicle first — the creative is built from it.', 400);
  const model = await resolveNanoBanana2(apiKey);
  const parts: ImagePart[] = [
    { text: designInstruction(canvas ? req : { ...req, canvas: undefined }, refs.map((r) => r.label)) },
    ...(canvas ? [{ inline_data: { mime_type: canvas.mimeType, data: canvas.bytes.toString('base64') } }] : []),
    ...(reference ? [{ inline_data: { mime_type: reference.mimeType, data: reference.bytes.toString('base64') } }] : []),
    ...refs.map((r) => ({ inline_data: { mime_type: r.mimeType, data: r.bytes.toString('base64') } })),
  ];
  const out = await requestImage(model, parts, apiKey, designConfigs(req), 0.6, 'Creative images');
  return { bytes: out.bytes, mimeType: out.mimeType, model: out.model, costInr: inr(out.model, out.usage) };
}

export async function reviseCreativeDesign(
  req: DesignRequest,
  change: string,
  current: { bytes: Buffer; mimeType: string },
  refs: Array<{ bytes: Buffer; mimeType: string }>,
  apiKey: string,
): Promise<{ bytes: Buffer; mimeType: string; model: string; costInr: number }> {
  const model = await resolveNanoBanana2(apiKey);
  const parts: ImagePart[] = [
    { text: reviseInstruction(req, change, refs.length) },
    { inline_data: { mime_type: current.mimeType, data: current.bytes.toString('base64') } },
    ...refs.map((r) => ({ inline_data: { mime_type: r.mimeType, data: r.bytes.toString('base64') } })),
  ];
  const out = await requestImage(model, parts, apiKey, designConfigs(req), 0.4, 'Creative images');
  return { bytes: out.bytes, mimeType: out.mimeType, model: out.model, costInr: inr(out.model, out.usage) };
}

/**
 * Every piece of writing on a creative, read back as it is — not as it should be. Null when
 * it could not be read; the creative is then shown as not checked, never as passed.
 */
export async function readCreativeWords(image: Buffer, apiKey: string): Promise<{ texts: string[]; logos: number; costInr: number } | null> {
  const instruction = [
    'Read every piece of text on this advertisement exactly as it is written: the same spelling, capitals, symbols (₹, *, %), numbers and punctuation. Do not correct anything.',
    'Each separate block of text is one string — a headline over two lines is one block, a button is one block, a badge is one block, each point of a list is one block, each line of an address or contact strip is one block.',
    'Include lettering anywhere in the picture — signs, screens, the background, the number plates — except lettering that is part of a logo, an emblem or a wordmark, and the badges on the vehicle itself: count those instead.',
    'Answer JSON only: {"texts": ["..."], "logos": <how many separate logos, emblems or brand wordmarks are printed on the advertisement itself, not counting badges on the vehicle>} — "texts" is an empty list when there is no text.',
  ].join('\n');
  try {
    const model = await resolveTextModel(apiKey, 'transform');
    const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: instruction }, { inline_data: { mime_type: 'image/jpeg', data: image.toString('base64') } }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: TokenUsage };
    recordUsage('Creative checks', model, json.usageMetadata);
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { texts?: unknown; logos?: unknown };
    const logos = typeof parsed.logos === 'number' && Number.isFinite(parsed.logos) ? Math.max(0, Math.round(parsed.logos)) : -1;
    return { texts: strs(parsed.texts), logos, costInr: inr(model, json.usageMetadata) };
  } catch {
    return null;
  }
}

/* ============================== taking a design apart ============================== */

/** The instruction to strip a finished design bare: no words, no graphics, the scene rebuilt behind them. */
export function eraseInstruction(format: CreativeFormatId): string {
  return [
    '<IMAGE_REF_0> is a finished advertisement.',
    '',
    "Remove EVERYTHING that was laid over the photograph: every word and letter, every headline, badge, pill, button, list, price, small print, the dealership strip along the bottom and everything in it, and every logo, emblem and watermark (the maker's badge on the vehicle itself stays).",
    'Rebuild the scene photorealistically behind what is removed, continuing its light, colours and textures.',
    'Change nothing else: the same vehicle exactly as it is, the same scene, the same framing and light. The result is a clean photograph with no text or graphic of any kind.',
    `Frame: ${CREATIVE_FORMAT_BY_ID[format].pictureAspect}.`,
  ].join('\n');
}

/** The design with every word and logo painted out, so its blocks can be laid back as layers. */
export async function eraseCreativeDesign(
  format: CreativeFormatId,
  current: { bytes: Buffer; mimeType: string },
  apiKey: string,
): Promise<{ bytes: Buffer; mimeType: string; model: string; costInr: number }> {
  const model = await resolveNanoBanana2(apiKey);
  const parts: ImagePart[] = [{ text: eraseInstruction(format) }, { inline_data: { mime_type: current.mimeType, data: current.bytes.toString('base64') } }];
  const aspectRatio = CREATIVE_FORMAT_BY_ID[format].pictureAspect;
  const out = await requestImage(model, parts, apiKey, [{ aspectRatio, imageSize: '2K' }, { aspectRatio }], 0.3, 'Creative images');
  return { bytes: out.bytes, mimeType: out.mimeType, model: out.model, costInr: inr(out.model, out.usage) };
}

/** The blocks out of whatever came back: words and a sane box, or nothing. */
export function parseBlocks(text: string): ReadBlock[] {
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (from < 0 || to <= from) throw new CreativeError('blocks-unreadable', 'The design could not be read back. Try again.');
  let raw: { blocks?: unknown };
  try {
    raw = JSON.parse(text.slice(from, to + 1)) as { blocks?: unknown };
  } catch {
    throw new CreativeError('blocks-unreadable', 'The design could not be read back. Try again.');
  }
  const unit = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null);
  return (Array.isArray(raw.blocks) ? raw.blocks : [])
    .map((b): ReadBlock | null => {
      const r = (b ?? {}) as Record<string, unknown>;
      const words = str(r.text).trim().slice(0, 400);
      const x = unit(r.x);
      const y = unit(r.y);
      const w = unit(r.w);
      const h = unit(r.h);
      if (!words || x === null || y === null || w === null || h === null || !w || !h) return null;
      return {
        text: words,
        box: { x, y, w, h },
        ...(typeof r.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.color) ? { color: r.color } : {}),
        ...(r.weight === 'bold' || r.weight === 'regular' ? { weight: r.weight } : {}),
        ...(r.align === 'left' || r.align === 'center' || r.align === 'right' ? { align: r.align } : {}),
        ...(typeof r.lines === 'number' && r.lines >= 1 && r.lines <= 12 ? { lines: Math.round(r.lines) } : {}),
      };
    })
    .filter((b): b is ReadBlock => Boolean(b))
    .slice(0, 24);
}

/** Every block of writing on a design, with where and how it sits — the map for taking it apart. */
export async function readCreativeBlocks(image: Buffer, apiKey: string): Promise<{ blocks: ReadBlock[]; costInr: number }> {
  const instruction = [
    'Find every separate block of text on this advertisement — a headline over two lines is one block, a button is one block, a badge is one block, each line of the dealer strip is one block.',
    'For each block give: "text" — its exact words (same spelling, capitals, symbols ₹ and *, every digit); "x", "y", "w", "h" — its bounding box as fractions of the whole image, x,y the top-left corner; "color" — the letters\' colour as #rrggbb; "weight" — "bold" or "regular"; "align" — "left", "center" or "right"; "lines" — how many lines it runs over.',
    "Ignore lettering that is part of a logo, an emblem or a wordmark, and the badges on the vehicle itself.",
    'Answer JSON only: {"blocks": [{"text": "", "x": 0, "y": 0, "w": 0, "h": 0, "color": "#ffffff", "weight": "bold", "align": "left", "lines": 1}]}',
  ].join('\n');
  const model = await resolveTextModel(apiKey, 'transform');
  const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: instruction }, { inline_data: { mime_type: 'image/jpeg', data: image.toString('base64') } }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string; status?: string };
    usageMetadata?: TokenUsage;
  };
  if (!res.ok) throw new CreativeError(json.error?.status ?? 'blocks-failed', json.error?.message ?? `The text model returned ${res.status}.`);
  recordUsage('Creative checks', model, json.usageMetadata);
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  return { blocks: parseBlocks(text), costInr: inr(model, json.usageMetadata) };
}
