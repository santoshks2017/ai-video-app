/**
 * A still of a scene, drawn before the film is made.
 *
 * A shot direction is a sentence, and a sentence leaves the camera, the distance,
 * the light and where everyone stands to the video model. That is most of what
 * goes wrong between one part and the next: two parts of the same film shot from
 * nowhere near each other, the presenter suddenly on the other side of the car.
 *
 * So each scene gets a frame first, drawn by an image model from the same
 * photographs the video is built on — cheap, instant, and a thing a designer can
 * look at and reject before paying for thirty seconds of video. The frame then
 * travels to the renderer as the first reference for the part its scene falls in.
 */

import type { AspectRatio, Brief } from '@ava/shared';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

export class SceneImageError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

let cachedImageModel = '';

/**
 * The best image model this key can reach.
 *
 * Asked rather than hard-coded, the same way the text model is: a name pinned in
 * source is a name that stops existing. Imagen answers on `:predict` rather than
 * `:generateContent` and cannot be handed reference photographs, which is the
 * whole point here, so it is left out.
 */
export async function resolveImageModel(apiKey: string): Promise<string> {
  if (cachedImageModel) return cachedImageModel;
  const res = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  if (!res.ok) {
    throw new SceneImageError('image-models-unavailable', `Could not list Gemini models (${res.status}).`);
  }
  const json = (await res.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
  const usable = (json.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter((n) => /image/i.test(n) && !/imagen|embed|video|veo|omni|tts|audio/i.test(n));
  const stable = usable.filter((n) => !/exp|preview/.test(n));
  const pick = stable.sort().at(-1) ?? usable.sort().at(-1);
  if (!pick) {
    throw new SceneImageError(
      'no-image-model',
      'No Gemini image model is available on this key, so scene images cannot be drawn.',
      503,
    );
  }
  cachedImageModel = pick;
  return pick;
}

export interface SceneImageRef {
  data: string;
  mimeType: string;
  /** What the picture is of, said in the prompt beside its slot. */
  label: string;
}

export interface SceneImageRequest {
  /** The shot, as the storyboard has it. */
  shot: string;
  /** What the scene is called, for the model's sense of where it sits. */
  title?: string;
  /** The line spoken over it, when there is one — it says what the person is doing. */
  line?: string;
  aspect: AspectRatio;
  /** The look the whole film is graded to. */
  style?: string;
  vehicle: string;
  vehicleKind: 'car' | 'bike';
  /** Whether a person is on camera in this film at all. */
  onCameraPerson: boolean;
  /** Photographs: the vehicle first, then the presenter and the place. */
  references: SceneImageRef[];
}

/**
 * The rules a frame is drawn to.
 *
 * The same two that the video prompt carries, for the same two reasons: a model
 * that invents lettering invents a misspelled dealership, and a model that fills
 * a missing angle from memory fills it with the older car it has seen more of.
 * A frame that breaks either rule is worse than no frame, because the video is
 * then built on it.
 */
function instruction(req: SceneImageRequest): string {
  const noun = req.vehicleKind === 'bike' ? 'bike' : 'car';
  const lines = [
    'Draw one photographic still — a single frame from a television commercial, not an illustration, not a poster, not a collage.',
    '',
    `THE SHOT: ${req.shot.trim()}`,
  ];
  if (req.title?.trim()) lines.push(`It is the scene called "${req.title.trim()}".`);
  if (req.line?.trim()) lines.push(`Over it, someone says: "${req.line.trim()}" — draw what they are doing as they say it.`);
  lines.push(
    '',
    `THE ${noun.toUpperCase()}: ${req.vehicle}. Build it only from the supplied photographs — every panel, lamp, badge, wheel and surface copied from them, and nothing from anywhere else. If this shot needs a view of the ${noun} the photographs do not cover, move the camera to an angle they do cover, or come closer, or let the ${noun} sit out of focus. Never fill the gap from memory.`,
    `Every lamp is complete and lit exactly as in the photographs — the full headlamp signature, the daytime running lamps, the connected tail bar.`,
  );
  if (req.onCameraPerson) {
    lines.push(
      'THE PERSON: exactly the face, hair, build and clothes in the supplied photograph of them. Not a lookalike.',
    );
  }
  lines.push(
    'THE PLACE: the dealership in the supplied photographs — its floor, its walls, its light.',
    '',
    'NO LETTERING ANYWHERE IN THE FRAME. Not one letter, digit or word, on anything, at any distance, in or out of focus: no signage, fascia, banner, poster, standee, price board, sticker, screen, brochure, no watermark, no caption. Where a real place would carry writing, leave the surface blank, turn it away from camera, or let it fall out of focus. Number plates are always blank.',
    'The supplied images are records of what the subjects look like. They are never things to put in the picture: do not draw a photograph, a grid of photographs, a contact sheet or a screen showing one. Draw the real scene.',
    '',
    `Framing: ${req.aspect}. Real lens, real depth of field, real light.`,
  );
  if (req.style?.trim()) lines.push(`Look: ${req.style.trim()}`);
  return lines.join('\n');
}

/** Draw one frame. Returns the bytes and what they are. */
export async function drawSceneFrame(
  req: SceneImageRequest,
  apiKey: string,
): Promise<{ bytes: Buffer; mimeType: string; model: string }> {
  const model = await resolveImageModel(apiKey);
  const legend = req.references.length
    ? `## REFERENCE IMAGES\n${req.references.map((r, i) => `<IMAGE_REF_${i}> — ${r.label}`).join('\n')}\n\n`
    : '';

  const parts = [
    { text: legend + instruction(req) },
    ...req.references.map((r) => ({ inline_data: { mime_type: r.mimeType, data: r.data } })),
  ];

  /*
   * How to ask for a picture, in descending order of how much we get to say.
   *
   * Which of these an image model accepts is a property of the model and the API
   * version, not something source can know: asking for an aspect ratio a model has
   * no `imageConfig` for comes back as an argument error rather than a picture, and
   * so does naming a response modality it does not offer. So the ask degrades —
   * frame it, then just draw it, then draw it however you like — instead of the
   * whole storyboard failing on a config key.
   */
  const configs: Record<string, unknown>[] = [
    { temperature: 0.4, responseModalities: ['IMAGE'], imageConfig: { aspectRatio: req.aspect } },
    { temperature: 0.4, responseModalities: ['IMAGE'] },
    { temperature: 0.4, responseModalities: ['TEXT', 'IMAGE'] },
    { temperature: 0.4 },
  ];

  let res!: Response;
  let json!: {
    candidates?: {
      content?: { parts?: { inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }[] };
      finishReason?: string;
    }[];
    error?: { message?: string; status?: string };
  };
  for (const [i, generationConfig] of configs.entries()) {
    res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
    });
    json = (await res.json().catch(() => ({}))) as typeof json;
    // Only an argument error is worth asking again for; a refusal or a quota
    // problem says the same thing however the request is shaped.
    if (res.ok || res.status !== 400 || i === configs.length - 1) break;
  }

  if (!res.ok) {
    throw new SceneImageError(
      json.error?.status ?? 'image-failed',
      json.error?.message ?? `The image model returned ${res.status}.`,
    );
  }
  for (const part of json.candidates?.[0]?.content?.parts ?? []) {
    const data = part.inlineData?.data ?? part.inline_data?.data;
    if (!data) continue;
    return {
      bytes: Buffer.from(data, 'base64'),
      mimeType: part.inlineData?.mimeType ?? part.inline_data?.mime_type ?? 'image/png',
      model,
    };
  }
  throw new SceneImageError(
    'no-image-returned',
    `${model} came back without a picture${
      json.candidates?.[0]?.finishReason ? ` (${json.candidates[0].finishReason})` : ''
    }. Try the scene again, or soften the shot direction.`,
  );
}

/** Everything a frame needs from the brief, in one place. */
export function sceneImageContext(brief: Brief): Pick<SceneImageRequest, 'aspect' | 'style' | 'vehicle' | 'vehicleKind'> {
  return {
    aspect: brief.aspect,
    style: brief.visualStyle,
    vehicle: brief.carModel || brief.lineup?.models.join(' / ') || brief.dealer.brandModel || 'the vehicle',
    vehicleKind: brief.vehicleKind ?? 'car',
  };
}
