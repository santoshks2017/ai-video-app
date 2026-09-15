/**
 * One continuous music bed for a film, from Google Lyria on the Gemini key.
 *
 * A video model makes its music inside each clip it generates, and a film longer
 * than one clip is several clips — so that music restarts, changes key or drops
 * out at every join. Generating the bed once, for the whole film, and mixing it
 * under the voice in post is the only way it plays straight through.
 *
 *   POST /v1beta/interactions  { model: "lyria-3.5", input, response_format: { type: "audio" } }
 *   -> steps[].content[] with { type: "audio", data: <base64> }
 *
 * Google lists Lyria 3.5 at $0.08 per song. Every track carries a SynthID
 * watermark, as the video models' output already does.
 * Docs: https://ai.google.dev/gemini-api/docs/music-generation
 */

import { LYRIA_USD_PER_SONG } from '@ava/shared';
import { recordUsage } from './spendLog.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const LYRIA_MODEL = 'lyria-3.5';
/** Google list price per generated song, for the job's cost record. */
export const MUSIC_BED_USD = 0.08;

export class LyriaError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

/** The prompt: the designer's own words for the music, held to what a bed under speech needs. */
export function musicBedPrompt(description: string, seconds: number, speaks: boolean): string {
  const what = description.trim() || 'light, modern, uplifting background music';
  return [
    `${what}.`,
    'Instrumental only — no vocals, no singing, no spoken words.',
    `About ${Math.max(10, Math.round(seconds))} seconds long, for a car dealership video.`,
    speaks
      ? 'A steady bed a voice sits clearly on top of: the same tempo and key throughout, no sudden drops, no big builds, no loud hits.'
      : 'It carries the whole video on its own, so it can have shape and energy, but keep one tempo and key throughout.',
    'End on a natural resolve rather than stopping mid-phrase.',
  ].join(' ');
}

/** The first audio part in a response, wherever the steps put it. */
function findAudio(obj: unknown): { data: string; mimeType: string } | null {
  const seen = new Set<unknown>();
  const stack: unknown[] = [obj];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    const rec = node as Record<string, unknown>;
    const mime = String(rec.mime_type ?? rec.mimeType ?? '');
    if ((rec.type === 'audio' || mime.startsWith('audio/')) && typeof rec.data === 'string' && rec.data) {
      return { data: rec.data, mimeType: mime || 'audio/mpeg' };
    }
    for (const child of Object.values(rec)) if (child && typeof child === 'object') stack.push(child);
  }
  return null;
}

export async function generateMusicBed(
  input: { description: string; seconds: number; speaks: boolean },
  apiKey: string,
): Promise<{ bytes: Buffer; mimeType: string; model: string }> {
  if (!apiKey) throw new LyriaError('lyria-no-key', 'No Gemini API key is available for music.', 503);
  const res = await fetch(`${BASE}/interactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      model: LYRIA_MODEL,
      input: musicBedPrompt(input.description, input.seconds, input.speaks),
      response_format: { type: 'audio' },
    }),
    // A bed is worth waiting for, but never worth stalling a paid video run over.
    signal: AbortSignal.timeout(4 * 60 * 1000),
  });
  let json = (await res.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    error?: { status?: string; message?: string };
  };
  if (!res.ok) {
    throw new LyriaError(json.error?.status ?? 'lyria-error', json.error?.message ?? `Lyria returned ${res.status}.`);
  }
  // An interaction normally answers once the track is made. If one comes back still
  // working, wait for it rather than drop the music.
  const waitUntil = Date.now() + 3 * 60 * 1000;
  while (!findAudio(json) && json.id && /progress|pending|running|queued/i.test(json.status ?? '') && Date.now() < waitUntil) {
    await new Promise((r) => setTimeout(r, 4000));
    const poll = await fetch(`${BASE}/interactions/${encodeURIComponent(json.id)}`, {
      headers: { 'x-goog-api-key': apiKey },
    });
    json = (await poll.json().catch(() => ({}))) as typeof json;
  }
  const audio = findAudio(json);
  if (!audio) throw new LyriaError('lyria-no-audio', 'Lyria finished but returned no audio.');
  recordUsage('Music', LYRIA_MODEL, undefined, LYRIA_USD_PER_SONG);
  return { bytes: Buffer.from(audio.data, 'base64'), mimeType: audio.mimeType, model: LYRIA_MODEL };
}
