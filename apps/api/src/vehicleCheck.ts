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

import { resolveTextModel } from './script.js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

export interface VehicleVerdict {
  /** True when the frame shows the same vehicle as the reference photo. */
  same: boolean;
  /** What the difference was, in the checker's words. Empty when it matched. */
  why: string;
  /** False when the check could not be made — no key, no car in frame, an API error. */
  checked: boolean;
}

const UNCHECKED: VehicleVerdict = { same: true, why: '', checked: false };

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
  vehicleName: string,
  apiKey: string,
): Promise<VehicleVerdict> {
  if (!apiKey) return UNCHECKED;
  const instruction = [
    `The first image is a reference photograph of a ${vehicleName}.`,
    'The second is a frame from a video that is supposed to show that same vehicle.',
    '',
    'Compare only the vehicle. Look at the shape of the face and grille, the lamp signatures,',
    'the roofline and proportions, the wheels and the badges. Paint colour, lighting, angle,',
    'background and image quality do not matter — a different colour of the same model is a match.',
    'A different generation or facelift of the same nameplate is NOT a match. A different model is not a match.',
    '',
    'Answer JSON only:',
    '{"car_in_frame": true|false, "same_vehicle": true|false, "confidence": "high"|"low", "why": "<one short sentence>"}',
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
    };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const parsed = JSON.parse(text) as {
      car_in_frame?: boolean;
      same_vehicle?: boolean;
      confidence?: string;
      why?: string;
    };
    // Nothing to judge, or not sure enough to spend money on a retake.
    if (!parsed.car_in_frame || parsed.confidence === 'low') return UNCHECKED;
    return {
      same: parsed.same_vehicle !== false,
      why: String(parsed.why ?? '').slice(0, 240),
      checked: true,
    };
  } catch {
    return UNCHECKED;
  }
}
