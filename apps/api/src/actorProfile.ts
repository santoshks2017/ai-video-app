/**
 * An actor from a description: the two model calls.
 *
 * A text model fills the profile in, and an image model draws the profile sheet
 * that becomes the actor's reference photo. What each is asked, and what is kept of
 * the answer, lives in @ava/shared's actorProfile; this file only carries it there
 * and back.
 */

import {
  actorFillPrompt,
  actorSheetPrompt,
  normalizeActorFill,
  type ActorFill,
  type ActorProfile,
} from '@ava/shared';
import { resolveTextModel } from './script.js';
import { requestImage, resolveSheetImageModel, SceneImageError, type ImagePart } from './sceneImage.js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

/** Fill a profile in from a description. The fast text model — this is a form, not copy. */
export async function fillActorProfile(
  description: string,
  current: Partial<ActorProfile>,
  apiKey: string,
): Promise<{ fill: ActorFill; model: string }> {
  const model = await resolveTextModel(apiKey, 'transform');
  const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: actorFillPrompt(description, current) }] }],
      generationConfig: { temperature: 0.6, responseMimeType: 'application/json' },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string; status?: string };
  };
  if (!res.ok) {
    throw new SceneImageError(json.error?.status ?? 'actor-fill-failed', json.error?.message ?? `Gemini returned ${res.status}.`);
  }
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new SceneImageError('actor-fill-unreadable', 'The profile came back in a form that could not be read. Try again.');
  }
  return { fill: normalizeActorFill(parsed), model };
}

/**
 * Draw the profile sheet. Portrait, at 2K where the model offers a size, since a
 * sheet is a dozen small faces and a video model reads every one of them.
 */
export async function drawActorSheet(
  actor: Pick<ActorProfile, 'name' | 'gender' | 'age' | 'ageBand' | 'attire' | 'style' | 'voice' | 'personality' | 'traits'>,
  opts: { setting?: string; face?: { data: string; mimeType: string } },
  apiKey: string,
): Promise<{ bytes: Buffer; mimeType: string; model: string }> {
  const model = await resolveSheetImageModel(apiKey);
  const parts: ImagePart[] = [{ text: actorSheetPrompt(actor, { setting: opts.setting, keepFace: Boolean(opts.face) }) }];
  if (opts.face) parts.push({ inline_data: { mime_type: opts.face.mimeType, data: opts.face.data } });
  return requestImage(model, parts, apiKey, [{ aspectRatio: '2:3', imageSize: '2K' }, { aspectRatio: '2:3' }], 0.6);
}
