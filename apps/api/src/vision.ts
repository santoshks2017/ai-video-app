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
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
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
