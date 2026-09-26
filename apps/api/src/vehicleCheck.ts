/**
 * Is the vehicle on screen the vehicle we were given photos of?
 *
 * Prose cannot hold a video model to a car. Reference photos mostly can, but not
 * always: asked for a "Mahindra XUV 3XO", a model that has seen that name beside
 * an older XUV will sometimes draw the older one anyway, and the only way to know
 * is to look at what came back.
 *
 * So each part is looked at. One frame of the finished segment and one reference
 * photo go to a vision model with a single question, and the answer is recorded
 * on the run — and when it is a clear no, that part is made once more. A text
 * call costs a fraction of a paisa against ₹300–1,000 for a film nobody can use.
 */

import type { TokenUsage } from '@ava/shared';
import { recordUsage } from './spendLog.js';
import { resolveTextModel } from './script.js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

export interface VehicleVerdict {
  /** True when the frame shows the same vehicle as the reference photo. */
  same: boolean;
  /** What the difference was, in the checker's words. Empty when it matched. */
  why: string;
  /** False when the check could not be made — no key, no car in frame, an API error. */
  checked: boolean;
  /**
   * Whether the paint is the paint in the photograph.
   *
   * Asked separately, because identity and paint are different questions: a red
   * one and a blue one are the same car, and the identity check says so on
   * purpose. But when nobody chose a colour, the photographs are the colour — and
   * a car in a colour the photographs do not show came from somewhere other than
   * the photographs, which is exactly the drift this whole check exists to catch.
   * 'unknown' when the light, the angle or the grade make it a guess.
   */
  colour: 'same' | 'different' | 'unknown';
}

const UNCHECKED: VehicleVerdict = { same: true, why: '', checked: false, colour: 'unknown' };

/**
 * Compare one frame against one reference photo.
 *
 * The question is deliberately narrow — same vehicle or not — and the answer is
 * allowed to be "no car in this frame", because plenty of shots are of a person
 * talking and nothing can be concluded from those.
 */
export async function checkVehicleFrame(
  frame: Buffer,
  reference: Buffer,
  apiKey: string,
): Promise<VehicleVerdict> {
  if (!apiKey) return UNCHECKED;
  const instruction = [
    // Not named: told what it is looking at, a judge starts agreeing that a car
    // wearing that name is that car — which is the mistake being checked for.
    'The first image is a reference photograph of a vehicle.',
    'The second is a frame from a video that is supposed to show that same vehicle.',
    '',
    'Compare only the vehicle. Look at the shape of the face and grille, the trim or moulding that borders',
    'the grille — its shape, its width and its finish, chrome against black against body colour — the lamp',
    'signatures, the roofline and proportions, the wheels and the badges. Paint colour, lighting, angle,',
    'background and image quality do not matter for same_vehicle — a different colour of the same model is a match.',
    'A different surround around the grille is a different generation, and NOT a match.',
    'A different generation or facelift of the same vehicle is NOT a match — judge by what you see, not by what the vehicle is called.',
    "Look at the maker's emblem as well, on the grille and the tailgate: a different design of that maker's",
    'logo — an older or a newer one than the reference shows — is NOT a match. Judge the emblem only where it',
    'is legible in both images; where it is too small or too soft to read in either, ignore it.',
    '',
    'Then, as a separate question, compare the paint. Answer "same" when the body colour in the frame is the',
    'same colour as in the photograph — the same hue, allowing for light, shade, reflections and grade.',
    'Answer "different" only when it is plainly another colour: blue against green, white against grey, red',
    'against orange. Answer "unknown" when the light, the angle or the crop make it a guess.',
    '',
    'Answer JSON only:',
    '{"car_in_frame": true|false, "same_vehicle": true|false, "paint": "same"|"different"|"unknown", "confidence": "high"|"low", "why": "<one short sentence>"}',
    'car_in_frame is false when the frame shows no vehicle, or only a fragment too small to judge.',
    'Use confidence "low" when the frame is blurred, dark, or shows too little of the vehicle to be sure.',
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
              { inline_data: { mime_type: 'image/jpeg', data: reference.toString('base64') } },
              { inline_data: { mime_type: 'image/jpeg', data: frame.toString('base64') } },
            ],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) return UNCHECKED;
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: TokenUsage;
    };
    recordUsage('Vehicle checks', model, body.usageMetadata);
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const parsed = JSON.parse(text) as {
      car_in_frame?: boolean;
      same_vehicle?: boolean;
      paint?: string;
      confidence?: string;
      why?: string;
    };
    // Nothing to judge, or not sure enough to spend money on a retake.
    if (!parsed.car_in_frame || parsed.confidence === 'low') return UNCHECKED;
    return {
      same: parsed.same_vehicle !== false,
      why: String(parsed.why ?? '').slice(0, 240),
      checked: true,
      colour: parsed.paint === 'different' ? 'different' : parsed.paint === 'same' ? 'same' : 'unknown',
    };
  } catch {
    return UNCHECKED;
  }
}
