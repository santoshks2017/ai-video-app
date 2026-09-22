/**
 * The intake: one cheap call that reads a brief and its attached images together and answers
 * with an interpretation — what kind of post, the facts already in the brief, what each image
 * is, and, when one is a finished creative, the words on it. The designer corrects it; the
 * expensive generation runs only after.
 *
 * Everything the model answers is checked against what the app knows — unknown engines, fact
 * ids, sizes and roles are dropped, never trusted.
 */
import {
  CREATIVE_BLENDS,
  CREATIVE_ENGINES,
  CREATIVE_ENGINE_BY_ID,
  CREATIVE_FORMATS,
  EMOTION_ORDER,
  INDIAN_OCCASIONS,
  emptyCopy,
  isCreativeEngine,
  isCreativeFormat,
  usageCostUsd,
  DEFAULT_USD_TO_INR,
  type CreativeCopy,
  type CreativeEngineId,
  type CreativeFormatId,
  type ImageRole,
  type ReferenceIntent,
  type TokenUsage,
} from '@ava/shared';
import { CreativeError } from './creatives.js';
import { resolveTextModel } from './script.js';
import { recordUsage } from './spendLog.js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

export interface UnderstandRequest {
  brief: string;
  client?: { name: string; brand?: string };
  /** The client's library, for matching the brief's vehicle to a car id. */
  vehicles: Array<{ id: string; name: string }>;
  /** The language choices the app offers, by id. */
  languages: Array<{ id: string; name: string }>;
  /** The attached images, in order; bytes travel separately. */
  images: Array<{ label?: string }>;
}

export interface Interpretation {
  engine: { primary: CreativeEngineId; secondary?: CreativeEngineId; ratio?: string };
  heard: string[];
  confidence: 'high' | 'low';
  occasion?: string;
  carId?: string;
  colour?: string;
  facts: Record<string, string>;
  languageId?: string;
  sizes?: CreativeFormatId[];
  sceneNote?: string;
  images: Array<{ index: number; role: ImageRole; note?: string }>;
  referenceIntent?: ReferenceIntent;
  changes?: string;
  /** The words read off an attached finished creative, when there is one. */
  copy?: CreativeCopy;
}

const ROLES = `What each image can be:
- vehicle photo ("vehicle-photo") — the vehicle alone: a car or bike, no designed text on it.
- finished creative ("finished-creative") — a designed advertisement: it has a headline, offers or a layout of words on it.
- moment photo ("moment-photo") — people and an occasion: a delivery handover, customers with the car, a showroom moment.
- logo ("logo") — a logo or wordmark on a flat ground.`;

/** The instruction: the catalogue of everything the app knows, the brief, and the images to read. */
export function understandPrompt(req: UnderstandRequest): string {
  const engines = CREATIVE_ENGINES.map(
    (e) => `- ${e.id} (${e.code} · ${e.label}): ${e.purpose} fields: ${e.fields.map((f) => `${f.id} — ${f.label}`).join('; ')}`,
  );
  const formats = CREATIVE_FORMATS.map((f) => `- ${f.id}: ${f.label}, ${f.width}×${f.height} (${f.platforms})`);
  const lines = [
    `You are the intake of a creative studio for Indian vehicle dealerships. A designer wrote a brief${req.images.length ? ' and attached images' : ''}; read everything together and answer with one JSON interpretation. Answer JSON only.`,
    '',
    `## The client`,
    req.client ? `${req.client.name}${req.client.brand ? `, a ${req.client.brand} dealership` : ''}.` : 'Not picked yet.',
    '',
    '## The kinds of post (pick primary, and secondary only when the brief truly blends two)',
    ...engines,
    '',
    '## Blends the studio knows (the first leads, at this share)',
    ...CREATIVE_BLENDS.map((b) => `- ${b.lead} + ${b.with} at ${b.ratio}: ${b.logic}`),
    `Any other pair: the more emotional kind leads, at 60/40. From most emotional to least: ${EMOTION_ORDER.join(', ')}.`,
    '',
    '## Occasions the app knows',
    INDIAN_OCCASIONS.join(', '),
    '',
    '## The sizes',
    ...formats,
    '',
    "## The client's vehicle library (match the brief's vehicle to one of these ids when it names one)",
    ...(req.vehicles.length ? req.vehicles.map((v) => `- ${v.id}: ${v.name}`) : ['(empty)']),
    '',
    '## Languages',
    req.languages.map((l) => `${l.id} (${l.name})`).join(', '),
    '',
    '## The brief',
    req.brief.trim() || '(empty)',
    ...(req.images.length
      ? [
          '',
          '## The images (numbered from 0, in the order they are attached; "index" in the answer is this number)',
          ROLES,
          ...req.images.map((im, i) => `<IMAGE_${i}>${im.label ? ` — ${im.label}` : ' — unlabelled, no filename given'}`),
        ]
      : []),
    '',
    '## Answer — JSON only, exactly this shape; leave out what the brief does not say',
    JSON.stringify({
      engine: { primary: '', secondary: '', ratio: '60/40' },
      heard: ['the exact phrases that decided the kind of post'],
      confidence: 'high | low',
      occasion: '',
      vehicle: { name: '', colour: '' },
      facts: { '<fieldId of the chosen engines>': 'value found in the brief' },
      language: '<language id>',
      sizes: ['<size ids, only when the brief names placements>'],
      sceneNote: 'setting direction from the brief, if any',
      images: [{ index: 0, role: 'vehicle-photo | finished-creative | moment-photo | logo', note: '' }],
      referenceIntent: 'recreate | edit | sizes — only when an image is a finished creative',
      changes: 'what the brief asks to change in how the finished creative looks, if anything — never its words',
      copy: { headline: '', kicker: '', sub: '', badge: '', points: [''], cta: '', terms: '' },
    }),
    'Rules: facts hold only what the brief itself says — never invent a name, a price or a date. "copy" only when an image is a finished creative: its words read off it exactly as written, except that any change of wording the brief itself asks for (a new offer, a new date, a new line) is made in the copy. "changes" is what changes visually — the colours, the scene, the layout, the vehicle — never the words: the words are always the copy. "referenceIntent" is "sizes" when the designer wants the same creative at other sizes; "edit" when they name a change; else "recreate".',
  ];
  return lines.join('\n');
}

const str = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strs = (v: unknown, max = 12): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, max) : []);

/** The library car a name points at, loosely: the full name, either way round, or the model alone. */
function matchVehicle(name: string, vehicles: UnderstandRequest['vehicles']): string | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  const hit =
    vehicles.find((v) => v.name.toLowerCase() === n) ??
    vehicles.find((v) => n.includes(v.name.toLowerCase()) || v.name.toLowerCase().includes(n)) ??
    vehicles.find((v) => {
      const model = v.name.toLowerCase().split(/\s+/).slice(1).join(' ');
      return model && (n === model || n.includes(model));
    });
  return hit?.id;
}

/**
 * Two kinds of post read as the studio blends them: a pair it knows takes its lead and share
 * from the blend table, whichever way round it was answered; any other pair is led by the more
 * emotional, at the share given or 60/40. One kind alone carries no share.
 */
function blendOf(a: CreativeEngineId, b: CreativeEngineId | undefined, ratio: string): Interpretation['engine'] {
  if (!b) return { primary: a };
  const known = CREATIVE_BLENDS.find((x) => (x.lead === a && x.with === b) || (x.lead === b && x.with === a));
  if (known) return { primary: known.lead, secondary: known.with, ratio: known.ratio };
  const swapped = EMOTION_ORDER.indexOf(b) < EMOTION_ORDER.indexOf(a);
  // A share answered for the other order would be read backwards, so it gives way to the default.
  const share = !swapped && /^\d{1,2}\/\d{1,2}$/.test(ratio) ? ratio : '60/40';
  return swapped ? { primary: b, secondary: a, ratio: share } : { primary: a, secondary: b, ratio: share };
}

const ROLE_MAP: Record<string, ImageRole> = {
  vehicle: 'vehicle', 'vehicle-photo': 'vehicle',
  creative: 'creative', 'finished-creative': 'creative',
  moment: 'moment', 'moment-photo': 'moment',
  logo: 'logo',
};

/** The interpretation out of whatever came back, everything checked against what the app knows. */
export function parseInterpretation(text: string, req: UnderstandRequest): Interpretation {
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (from < 0 || to <= from) throw new CreativeError('intake-unreadable', 'The interpretation came back in a form that cannot be read. Try again.');
  let raw: Record<string, any>;
  try {
    raw = JSON.parse(text.slice(from, to + 1)) as Record<string, any>;
  } catch {
    throw new CreativeError('intake-unreadable', 'The interpretation came back in a form that cannot be read. Try again.');
  }
  const answered = raw.engine?.primary;
  if (!isCreativeEngine(answered)) throw new CreativeError('intake-no-engine', 'The brief could not tell what kind of post this is — pick one by hand.');
  const other = isCreativeEngine(raw.engine?.secondary) && raw.engine.secondary !== answered ? (raw.engine.secondary as CreativeEngineId) : undefined;
  const engine = blendOf(answered, other, str(raw.engine?.ratio, 8));
  const { primary, secondary } = engine;
  const fieldIds = new Set([...CREATIVE_ENGINE_BY_ID[primary].fields, ...(secondary ? CREATIVE_ENGINE_BY_ID[secondary].fields : [])].map((f) => f.id));
  const facts: Record<string, string> = {};
  if (raw.facts && typeof raw.facts === 'object') {
    for (const [k, v] of Object.entries(raw.facts as Record<string, unknown>)) if (fieldIds.has(k) && str(v)) facts[k] = str(v, 500);
  }
  const images = (Array.isArray(raw.images) ? raw.images : [])
    .map((im: any) => ({ index: typeof im?.index === 'number' ? im.index : -1, role: ROLE_MAP[str(im?.role, 40)], note: str(im?.note, 200) || undefined }))
    .filter((im): im is { index: number; role: ImageRole; note: string | undefined } => Boolean(im.role) && im.index >= 0 && im.index < req.images.length);
  const rawCopy = raw.copy as Record<string, unknown> | undefined;
  const copy: CreativeCopy | undefined =
    rawCopy && str(rawCopy.headline)
      ? {
          ...emptyCopy(),
          headline: str(rawCopy.headline, 200),
          kicker: str(rawCopy.kicker, 120),
          sub: str(rawCopy.sub, 300),
          badge: str(rawCopy.badge, 120),
          points: strs(rawCopy.points, 6),
          cta: str(rawCopy.cta, 80),
          terms: str(rawCopy.terms, 300),
        }
      : undefined;
  const intent = ['recreate', 'edit', 'sizes'].includes(raw.referenceIntent) ? (raw.referenceIntent as ReferenceIntent) : undefined;
  const occasion = INDIAN_OCCASIONS.find((o) => o.toLowerCase() === str(raw.occasion, 60).toLowerCase()) ?? (str(raw.occasion, 60) || undefined);
  return {
    engine,
    heard: strs(raw.heard),
    confidence: raw.confidence === 'high' ? 'high' : 'low',
    ...(occasion ? { occasion } : {}),
    ...((): Partial<Interpretation> => {
      const id = matchVehicle(str(raw.vehicle?.name, 80), req.vehicles);
      return id ? { carId: id } : {};
    })(),
    ...(str(raw.vehicle?.colour, 60) ? { colour: str(raw.vehicle.colour, 60) } : {}),
    facts,
    ...(req.languages.some((l) => l.id === str(raw.language, 20)) ? { languageId: str(raw.language, 20) } : {}),
    ...((): Partial<Interpretation> => {
      const sizes = strs(raw.sizes).filter(isCreativeFormat) as CreativeFormatId[];
      return sizes.length ? { sizes } : {};
    })(),
    ...(str(raw.sceneNote, 300) ? { sceneNote: str(raw.sceneNote, 300) } : {}),
    images,
    ...(intent && images.some((im) => im.role === 'creative') ? { referenceIntent: intent } : {}),
    ...(str(raw.changes, 300) ? { changes: str(raw.changes, 300) } : {}),
    ...(copy ? { copy } : {}),
  };
}

/** The one call: the prompt and the images to the text model, the interpretation back. */
export async function understandBrief(
  req: UnderstandRequest,
  images: Array<{ bytes: Buffer; mimeType: string }>,
  apiKey: string,
): Promise<{ interpretation: Interpretation; model: string; costInr: number }> {
  const model = await resolveTextModel(apiKey, 'transform');
  const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: understandPrompt(req) }, ...images.map((im) => ({ inline_data: { mime_type: im.mimeType, data: im.bytes.toString('base64') } }))],
        },
      ],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string; status?: string };
    usageMetadata?: TokenUsage;
  };
  if (!res.ok) throw new CreativeError(json.error?.status ?? 'intake-failed', json.error?.message ?? `The text model returned ${res.status}.`);
  recordUsage('Creative intake', model, json.usageMetadata);
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  return { interpretation: parseInterpretation(text, req), model, costInr: json.usageMetadata ? usageCostUsd(model, json.usageMetadata) * DEFAULT_USD_TO_INR : 0 };
}
