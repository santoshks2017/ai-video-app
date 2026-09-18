/**
 * Project Image on the server: the words of a creative from the Google text model, and its
 * picture from the image model — with the real car, from the library's own photographs.
 *
 * The server never draws a finished creative. The browser lays it out and draws it, so the
 * words stay exact and editable; the picture the model makes carries no writing at all.
 */
import {
  COPY_LIMITS,
  COPY_LIMITS_NATIVE,
  CREATIVE_ENGINE_BY_ID,
  DEFAULT_USD_TO_INR,
  contactBlock,
  emptyCopy,
  isCreativeEngine,
  tidyCopy,
  usageCostUsd,
  type CopyClient,
  type CreativeCopy,
  type CreativeEngineId,
  type PictureAspect,
  type TokenUsage,
} from '@ava/shared';
import { requestImage, resolveSheetImageModel, type ImagePart } from './sceneImage.js';
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
  const block = contactBlock(req.client);
  const lang = req.language.hinglish
    ? 'Hinglish: everyday Hindi written in the Latin alphabet, mixed naturally with English, the way Indian dealers write on Instagram. Numbers, ₹ amounts and model names as they are.'
    : req.language.script === 'indic'
      ? `${req.language.name}, in its own script. Model names, brand names and ₹ amounts stay in Latin letters and digits.${req.language.guide ? ` ${req.language.guide}` : ''}`
      : 'English — Indian English, warm and clear.';
  const lines: string[] = [
    `You write social media creatives for ${who}. A creative is a picture with a few words set on it, and the post's caption.`,
    '',
    `## The kind of post: ${e.label}${second ? ` blended with ${second.label} at ${req.engine.ratio ?? '60/40'} — the first leads` : ''}`,
    `Purpose: ${e.purpose}`,
    `On the picture: ${e.onImage}`,
    `The caption's beats: ${e.caption.join(' → ')}.`,
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
    `Write the words on the picture and the caption in ${lang}`,
    '',
    '## Rules — every one of them',
    `- On the picture, words are few and exact. Headline at most ${limits.headline} characters; kicker (a small line above it) at most ${limits.kicker}; second line at most ${limits.sub}; badge at most ${limits.badge}; each point at most ${limits.point}; call to action at most ${limits.cta}.`,
    '- No emoji on the picture. In the caption, emoji are punctuation, not decoration.',
    '- Rupees always as ₹2,15,000 — never Rs., INR or 2.15L on the picture. Use "up to ₹X", never "₹X off", and never a percentage discount.',
    '- Every price, EMI, benefit or discount claim ends with an asterisk (*), and then `terms` holds the T&C line.',
    '- No unsubstantiated superlatives ("best", "#1", "unbeatable") unless the brief gives the proof.',
    '- Use only facts from the brief, the facts and the vehicle above. Never invent a price, a date, a number or a feature.',
    `- The caption ends with exactly this contact block, on its own lines:\n${block}`,
    '- 10 to 15 hashtags in three tiers: the brand and the brand in India; the model and the dealership; then the place, the occasion and the feeling. No spaces inside a hashtag.',
    '- Two alternative headlines, each a different angle.',
    '',
    '## Return JSON only, exactly this shape',
    '{"headline": "", "alternatives": ["", ""], "kicker": "", "sub": "", "badge": "", "points": [""], "cta": "", "terms": "", "caption": "", "hashtags": ["#"]}',
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
    caption: str(raw.caption).trim(),
    hashtags: strs(raw.hashtags),
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
  const copy = tidyCopy(parseCopy(text), {
    client: req.client,
    model: req.vehicle?.model,
    validity: req.validity,
    native: req.language.script === 'indic',
  });
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
}

/** The instruction for the picture: this vehicle, this scene, room for the words, no writing at all. */
export function sceneInstruction(req: SceneRequest, refLabels: string[]): string {
  const noun = req.vehicle.kind === 'bike' ? 'motorcycle' : 'car';
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
    `<IMAGE_REF_0> is the ${req.vehicle.name}${req.vehicle.colour ? ` in ${req.vehicle.colour}` : ''}. Put THIS ${noun} in the photograph: the same model generation, body shape, grille, headlamps, tail-lamps, badges, alloy wheels, colour and trim as in the reference photographs${refLabels.length > 1 ? ', which show its other sides' : ''}. Build it only from these photographs — never from what the name brings to mind, and never an older or different model.`,
    `NUMBER PLATES ARE PLAIN WHITE AND BLANK — a hard rule. Wherever the front or back of the ${noun} is in frame, its plate is there, as a plain white plate with nothing on it: no letters, no numbers, no state code, no dealer name, no sticker. The same for any other vehicle in the frame. Writing on a plate in the reference photographs is not part of the ${noun}; never copy it.`,
    `The ${noun} is whole and uncropped, sharp, the hero of the picture${tall ? '' : ', about half the width of the frame'}, seen three-quarters from the front unless the reference angle suggests otherwise, on the ground with correct contact shadows under the tyres and true reflections in the paint and glass.`,
    '',
    '## The scene',
    `${scene}.${req.note?.trim() ? ` ${req.note.trim()}` : ''} Photorealistic, like a professional automotive campaign photograph — real light, real materials, no illustration or CGI look, no people in the foreground.`,
    req.mood ? `Light and colour that sit well with the creative's colours: ${req.mood.panel} and ${req.mood.accent}.` : '',
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
