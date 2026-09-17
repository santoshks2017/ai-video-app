/**
 * Looking at a vehicle photograph, rather than trusting its filename.
 *
 * CarDekho names its files by angle — `front-left-side-47.jpg` — and those names
 * are wrong often enough to matter: in the XUV 3XO set, a file named for the
 * front held a side profile and a file named for the side held the front. The
 * app then captioned a contact-sheet tile FRONT over a picture of the side and
 * told the model that was the front, so the front was the one view it never
 * actually saw — and what it invents for a Mahindra XUV is the XUV300 it has
 * seen far more of.
 *
 * So every photo is looked at, and what it shows is what it is filed under.
 */

import type { TokenUsage, PeopleInShot } from '@ava/shared';
import { boxesFrom1000 } from '@ava/shared';
import { recordUsage } from './spendLog.js';
import type { CarAngle } from '@ava/shared';
import { resolveTextModel } from './script.js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

export interface SeenPhoto {
  /** Which side of the vehicle the photo actually shows. */
  view: CarAngle | 'detail' | 'other';
  /** False when the picture is not this vehicle at all — another model, a graphic, a person. */
  isVehicle: boolean;
  /** What the checker noticed, for the sync log. */
  note?: string;
}

/**
 * Classify photographs of one vehicle: what each shows, and whether it is even
 * the vehicle claimed. Up to 16 at a time; anything the model cannot answer for
 * comes back as `other`, which the caller is free to fall back on.
 */
/**
 * Where the people are in a stretch of film, so an Auto caption can be kept off them.
 *
 * Two frames from while the caption is up, marked in one call. Null when there is no
 * answer — a refusal, a timeout, nothing parseable — so the caller keeps the placement
 * it always had rather than guessing.
 */
export async function findPeople(frames: Buffer[], apiKey: string): Promise<PeopleInShot | null> {
  const batch = frames.slice(0, 3);
  if (!apiKey || !batch.length) return null;
  const instruction = [
    `These ${batch.length} frames are from one shot of a car commercial.`,
    'Mark every person visible in any of them, however small, turned away or partly out of frame.',
    '',
    'faces — one box per head: the face together with the hair.',
    'people — one box per person: the whole visible body, head included.',
    '',
    'A box is [ymin, xmin, ymax, xmax], whole numbers from 0 to 1000 measured on the frame.',
    'Mark a person in every frame they appear in. If there is nobody, return empty lists.',
    '',
    'Return JSON only: {"faces": [[ymin, xmin, ymax, xmax], ...], "people": [[ymin, xmin, ymax, xmax], ...]}. No commentary.',
  ].join('\n');
  try {
    const model = await resolveTextModel(apiKey, 'transform');
    const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: instruction },
              ...batch.map((b) => ({ inline_data: { mime_type: 'image/jpeg', data: b.toString('base64') } })),
            ],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: TokenUsage;
    };
    recordUsage('Caption placement', model, body.usageMetadata);
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const json = JSON.parse(text) as { faces?: unknown; people?: unknown };
    return { faces: boxesFrom1000(json.faces), bodies: boxesFrom1000(json.people) };
  } catch {
    return null;
  }
}

export async function seePhotos(
  photos: { bytes: Buffer; mimeType?: string }[],
  subject: string,
  apiKey: string,
): Promise<SeenPhoto[]> {
  const batch = photos.slice(0, 16);
  if (!apiKey || !batch.length) return [];

  const instruction = [
    `These ${batch.length} photographs are supposed to be of the ${subject}.`,
    'For each one, in the order given, say what it shows.',
    '',
    'view — "front" only when the front of the vehicle is the subject (a head-on or front three-quarter',
    'shot where the grille and both headlights are clearly visible); "side" for a side profile or a shot',
    'taken from the side where the flank is the subject; "rear" for the back of the vehicle; "interior"',
    'for anything photographed inside the cabin; "detail" for a close-up of one part; "other" for anything',
    'that is not a photograph of this vehicle.',
    'A front three-quarter shot is "front". A rear three-quarter shot is "rear". When a photo shows the',
    'whole flank and only a sliver of the face, it is "side".',
    '',
    `is_vehicle — false if the picture is not a ${subject}: a different model, a different generation of`,
    'the same nameplate, a graphic, a logo, an interior of another car, or a person.',
    'note — one short phrase if something is off, otherwise leave it out.',
    '',
    'Return JSON only: an array of {"i": <0-based index>, "view": "...", "is_vehicle": true|false, "note": "..."}.',
    'One object per photograph, in order. No commentary.',
  ].join('\n');

  try {
    const model = await resolveTextModel(apiKey, 'transform');
    const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: instruction },
              ...batch.map((p) => ({
                inline_data: { mime_type: p.mimeType || 'image/jpeg', data: p.bytes.toString('base64') },
              })),
            ],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: TokenUsage;
    };
    recordUsage('Vehicle photo filing', model, body.usageMetadata);
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const rows = JSON.parse(text) as { i?: number; view?: string; is_vehicle?: boolean; note?: string }[];
    const out: SeenPhoto[] = batch.map(() => ({ view: 'other', isVehicle: false }));
    for (const r of Array.isArray(rows) ? rows : []) {
      const i = Number(r.i);
      if (!Number.isInteger(i) || i < 0 || i >= out.length) continue;
      const view = String(r.view ?? 'other').toLowerCase();
      out[i] = {
        view: (['front', 'side', 'rear', 'interior', 'detail'] as const).includes(view as CarAngle | 'detail')
          ? (view as CarAngle | 'detail')
          : 'other',
        isVehicle: r.is_vehicle !== false,
        note: r.note ? String(r.note).slice(0, 160) : undefined,
      };
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Looking at a dealership photograph the same way.
 *
 * A showroom is several rooms — the forecourt, the floor, the lounge, the
 * delivery bay — and a film set in one of them wants a photograph of that one.
 * Nobody labels an upload, and a Google Business import labels nothing at all,
 * so the photographs are looked at and filed under the room they were taken in.
 */
export async function seeDealerPhotos(
  photos: { bytes: Buffer; mimeType?: string }[],
  dealer: string,
  apiKey: string,
): Promise<('exterior' | 'interior' | 'lounge' | 'delivery' | 'team' | 'other')[]> {
  const batch = photos.slice(0, 16);
  if (!apiKey || !batch.length) return [];

  const instruction = [
    `These ${batch.length} photographs were taken at ${dealer || 'a vehicle dealership'}.`,
    'For each one, in the order given, say which part of the place it shows.',
    '',
    'exterior — the building from outside, the forecourt, the signage, the entrance, the car park.',
    'interior — the showroom floor: vehicles standing indoors under showroom lighting.',
    'lounge — where customers sit: reception, the waiting area, sofas, a desk with chairs, a cafe counter.',
    'delivery — a handover: a car with a ribbon or garland, keys being given, a family beside a new car.',
    'team — the staff: sales people, a service bay, technicians, a group photograph of the team.',
    'other — anything that is none of these, including a photograph of one vehicle on its own,',
    'a poster, a logo, a screenshot or a map.',
    '',
    'Return JSON only: an array of {"i": <0-based index>, "view": "..."}. One object per photograph, in order.',
  ].join('\n');

  try {
    const model = await resolveTextModel(apiKey, 'transform');
    const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: instruction },
              ...batch.map((p) => ({
                inline_data: { mime_type: p.mimeType || 'image/jpeg', data: p.bytes.toString('base64') },
              })),
            ],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: TokenUsage;
    };
    recordUsage('Dealer photo filing', model, body.usageMetadata);
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const rows = JSON.parse(text) as { i?: number; view?: string }[];
    const known = ['exterior', 'interior', 'lounge', 'delivery', 'team'] as const;
    const out = batch.map(() => 'other' as (typeof known)[number] | 'other');
    for (const r of Array.isArray(rows) ? rows : []) {
      const i = Number(r.i);
      if (!Number.isInteger(i) || i < 0 || i >= out.length) continue;
      const view = String(r.view ?? '').toLowerCase();
      if ((known as readonly string[]).includes(view)) out[i] = view as (typeof known)[number];
    }
    return out;
  } catch {
    return [];
  }
}
