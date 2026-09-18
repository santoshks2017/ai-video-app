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

import type { TokenUsage } from '@ava/shared';
import { recordUsage, type UsageSection } from './spendLog.js';
import { narrationMode, sceneRules, type AspectRatio, type Brief } from '@ava/shared';

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
let cachedSheetModel = '';
let cachedImageModels: string[] | null = null;

/** Every model on the key that draws a picture through `:generateContent`. */
async function imageModels(apiKey: string): Promise<string[]> {
  if (cachedImageModels) return cachedImageModels;
  const res = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  if (!res.ok) {
    throw new SceneImageError('image-models-unavailable', `Could not list Gemini models (${res.status}).`);
  }
  const json = (await res.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
  cachedImageModels = (json.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter((n) => /image/i.test(n) && !/imagen|embed|video|veo|omni|tts|audio/i.test(n));
  return cachedImageModels;
}

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
  const usable = await imageModels(apiKey);
  const stable = usable.filter((n) => !/exp|preview/.test(n));
  const pick = [...stable].sort().at(-1) ?? [...usable].sort().at(-1);
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

/**
 * The model a presenter's profile sheet is drawn with: Nano Banana 2 (Gemini 3.1
 * Flash Image) when the key has it, then Nano Banana Pro, then the scene model. A
 * sheet is a dozen photographs of one face with lettering between them, and holding
 * a face and spelling a label are what the newer models do markedly better.
 */
export async function resolveSheetImageModel(apiKey: string): Promise<string> {
  if (cachedSheetModel) return cachedSheetModel;
  const usable = await imageModels(apiKey);
  for (const family of [/^gemini-3\.1-flash-image/, /^gemini-3(?:\.\d+)?-pro-image/]) {
    const hits = usable.filter((n) => family.test(n));
    const pick = hits.filter((n) => !/exp/.test(n)).sort().at(-1) ?? hits.sort().at(-1);
    if (pick) return (cachedSheetModel = pick);
  }
  return (cachedSheetModel = await resolveImageModel(apiKey));
}

let cachedNanoBanana2 = '';
/**
 * Nano Banana 2 (Gemini 3.1 Flash Image) by the name this key knows it by — the released
 * model before a preview of it. Social creatives are made with it and nothing else: asked for
 * by name, so a key without it says so instead of quietly drawing with another model.
 */
export async function resolveNanoBanana2(apiKey: string): Promise<string> {
  if (cachedNanoBanana2) return cachedNanoBanana2;
  const hits = (await imageModels(apiKey)).filter((n) => /^gemini-3\.1-flash-image/.test(n));
  const pick = hits.filter((n) => !/preview|exp/.test(n)).sort()[0] ?? hits.filter((n) => !/exp/.test(n)).sort().at(-1) ?? hits.sort().at(-1);
  if (!pick) {
    throw new SceneImageError(
      'no-nano-banana-2',
      'Nano Banana 2 (Gemini 3.1 Flash Image) is not available on this Google key. Enable it for the key in Google AI Studio, then try again.',
      503,
    );
  }
  return (cachedNanoBanana2 = pick);
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
  aspect: AspectRatio;
  /**
   * The film's own rules, verbatim from the prompt every part is generated with.
   *
   * A still drawn to its own private set of rules is how a presenter who is not in
   * the film ends up in the reference the film is then built on.
   */
  rules: string[];
  /** Who may appear. Named, because a model with nobody named invents a family. */
  cast?: string;
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
  return [
    'Draw one photographic still — a single frame from a television commercial, not an illustration, not a poster, not a collage.',
    '',
    `THE SHOT: ${req.shot.trim()}`,
    ...(req.title?.trim() ? [`It is the scene called "${req.title.trim()}".`] : []),
    '',
    /*
     * The film's rules, word for word.
     *
     * They already say everything a still needs about the presenter, the vehicle,
     * the place and the lettering — and saying it in the same words is the point:
     * a still drawn to a paraphrase is a still the film cannot be built on.
     */
    ...req.rules,
    '',
    '## THIS FRAME',
    /*
     * Who is in the picture.
     *
     * Left unsaid, an image model populates a showroom: a salesman who is not the
     * presenter, a family who are not in the film, a couple at a desk. Every one of
     * them then arrives in the video, because this still is the video's first
     * reference.
     */
    req.cast
      ? `- The only person who may appear is ${req.cast} Nobody else is in the frame — no second salesperson, no family, no couple, no children, no passers-by, no crowd — unless the shot above names them. If the shot describes no person, there is no person in the picture at all.`
      : '- NO people in this frame at all. No presenter, no salesperson, no customers, no family, no children, no passers-by. The shot is the vehicle and the place, and nothing else, unless the shot above names a person.',
    `- Build the ${noun} only from the supplied photographs. If this shot needs a view of the ${noun} they do not cover, move the camera to an angle they do cover, or come closer, or let the ${noun} sit out of focus. Never fill the gap from memory.`,
    '- Every number plate in the frame is a plain white plate with nothing on it, whatever the photographs show. Never copy writing from a plate in a photograph.',
    '- The supplied images are records of what the subjects look like. Never draw a photograph, a grid of photographs, a contact sheet, a poster or a screen showing one. Draw the real scene.',
    `- Framing: ${req.aspect}. A real lens, real depth of field, real light.`,
    ...(req.style?.trim() ? [`- Look: ${req.style.trim()}`] : []),
  ].join('\n');
}

/** Draw one frame. Returns the bytes and what they are. */
export type ImagePart = { text: string } | { inline_data: { mime_type: string; data: string } };

/**
 * One picture from an image model.
 *
 * How to ask for it, in descending order of how much we get to say. Which of these
 * an image model accepts is a property of the model and the API version, not
 * something source can know: asking for an aspect ratio a model has no
 * `imageConfig` for comes back as an argument error rather than a picture, and so
 * does naming a response modality it does not offer. So the ask degrades — frame
 * it, then just draw it, then draw it however you like — instead of failing on a
 * config key.
 */
export async function requestImage(
  model: string,
  parts: ImagePart[],
  apiKey: string,
  imageConfigs: Record<string, unknown>[],
  temperature = 0.4,
  section: UsageSection = 'Storyboard drawings',
): Promise<{ bytes: Buffer; mimeType: string; model: string; usage?: TokenUsage }> {
  const configs: Record<string, unknown>[] = [
    ...imageConfigs.map((imageConfig) => ({ temperature, responseModalities: ['IMAGE'], imageConfig })),
    { temperature, responseModalities: ['IMAGE'] },
    { temperature, responseModalities: ['TEXT', 'IMAGE'] },
    { temperature },
  ];

  let res!: Response;
  let json!: {
    candidates?: {
      content?: { parts?: { inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }[] };
      finishReason?: string;
    }[];
    error?: { message?: string; status?: string };
    usageMetadata?: TokenUsage;
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
  recordUsage(section, model, json.usageMetadata);
  for (const part of json.candidates?.[0]?.content?.parts ?? []) {
    const data = part.inlineData?.data ?? part.inline_data?.data;
    if (!data) continue;
    return {
      bytes: Buffer.from(data, 'base64'),
      mimeType: part.inlineData?.mimeType ?? part.inline_data?.mime_type ?? 'image/png',
      model,
      usage: json.usageMetadata,
    };
  }
  throw new SceneImageError(
    'no-image-returned',
    `${model} came back without a picture${
      json.candidates?.[0]?.finishReason ? ` (${json.candidates[0].finishReason})` : ''
    }.`,
  );
}

export async function drawSceneFrame(
  req: SceneImageRequest,
  apiKey: string,
): Promise<{ bytes: Buffer; mimeType: string; model: string }> {
  const model = await resolveImageModel(apiKey);
  const legend = req.references.length
    ? `## REFERENCE IMAGES\n${req.references.map((r, i) => `<IMAGE_REF_${i}> — ${r.label}`).join('\n')}\n\n`
    : '';
  const parts: ImagePart[] = [
    { text: legend + instruction(req) },
    ...req.references.map((r) => ({ inline_data: { mime_type: r.mimeType, data: r.data } })),
  ];
  try {
    return await requestImage(model, parts, apiKey, [{ aspectRatio: req.aspect }]);
  } catch (err) {
    if (err instanceof SceneImageError && err.code === 'no-image-returned') {
      throw new SceneImageError(err.code, `${err.message} Try the scene again, or soften the shot direction.`, err.status);
    }
    throw err;
  }
}

/**
 * Everything a frame needs from the brief, worked out once for the whole storyboard.
 *
 * The rules come straight from the prompt the film is generated with, so a still
 * and the video it seeds are held to the same thing.
 */
export function sceneImageContext(
  brief: Brief,
): Pick<SceneImageRequest, 'aspect' | 'style' | 'vehicle' | 'vehicleKind' | 'rules' | 'cast'> {
  const mode = narrationMode(brief.narration);
  const who = brief.actor?.name?.trim();
  return {
    aspect: brief.aspect,
    style: brief.visualStyle,
    vehicle: brief.carModel || brief.lineup?.models.join(' / ') || brief.dealer.brandModel || 'the vehicle',
    vehicleKind: brief.vehicleKind ?? 'car',
    rules: sceneRules(brief),
    cast: mode.onCameraPerson
      ? `${who || 'the presenter'} — exactly the face, hair, build and clothes in the supplied photograph of them, never a lookalike and never a different person.`
      : undefined,
  };
}
