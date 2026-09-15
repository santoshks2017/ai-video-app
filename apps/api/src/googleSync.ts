/**
 * Finding a vehicle's photographs through Google.
 *
 * CarDekho is quick and uniform, and a manufacturer's own page is the most
 * authoritative — but neither is always right or always complete. A launch-week
 * model may be on the manufacturer site and nowhere else; a car whose CarDekho
 * page mixes generations is better served by a press gallery.
 *
 * So this asks Gemini, with Google search switched on, which pages carry
 * photographs of this exact model, and hands those pages to the same harvester
 * the manufacturer sync uses. Nothing here invents a URL: the model returns
 * pages, they are fetched, and every picture is looked at before it is kept.
 */

import type { TokenUsage } from '@ava/shared';
import { recordUsage } from './spendLog.js';
import { OemSyncError, syncOemModel, type OemSyncInput } from './oemSync.js';
import { resolveTextModel } from './script.js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

/** Pages Google says carry photographs of this model, best first. */
export async function findModelPages(subject: string, apiKey: string): Promise<string[]> {
  if (!apiKey) return [];
  const ask = [
    `Find the web pages that carry photographs of the ${subject} — the current model on sale in India.`,
    'Prefer, in this order: the manufacturer’s own model page, the manufacturer’s gallery page,',
    'a major motoring publication’s image gallery for this exact model.',
    'Skip pages about an earlier generation, a different variant of the name, or a different market.',
    '',
    'Answer with the URLs only, one per line, at most four. No commentary.',
  ].join('\n');

  try {
    const model = await resolveTextModel(apiKey, 'transform');
    const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: ask }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0 },
      }),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        groundingMetadata?: { groundingChunks?: { web?: { uri?: string } }[] };
      }[];
      usageMetadata?: TokenUsage;
    };
    recordUsage('Vehicle sync', model, body.usageMetadata);
    const c = body.candidates?.[0];
    const text = c?.content?.parts?.map((p) => p.text ?? '').join('\n') ?? '';
    const fromText = [...text.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]);
    // Search grounding also names the pages it read, which are real URLs rather
    // than ones a model has written out from memory.
    const fromGrounding = (c?.groundingMetadata?.groundingChunks ?? [])
      .map((g) => g.web?.uri)
      .filter((u): u is string => Boolean(u));
    return [...new Set([...fromText, ...fromGrounding])]
      .filter((u) => !/\.(jpg|jpeg|png|webp|gif|pdf)$/i.test(u))
      .slice(0, 4);
  } catch {
    return [];
  }
}

/**
 * Sync a vehicle from whatever Google finds for it.
 *
 * Each candidate page is tried in turn and the first that yields a usable set
 * wins — "usable" meaning photographs of at least two sides, because a record
 * with one angle is the thing that puts the wrong car on screen.
 */
export async function syncGoogleModel(
  input: Omit<OemSyncInput, 'url'> & { query: string },
): Promise<import('@ava/shared').CarModelProfile> {
  const subject = input.query.trim();
  const pages = await findModelPages(subject, input.apiKey ?? '');
  if (!pages.length) {
    throw new OemSyncError(
      'google-no-pages',
      `Google found no pages for "${subject}". Try the manufacturer's link, or sync from CarDekho.`,
    );
  }

  const tried: string[] = [];
  let best: import('@ava/shared').CarModelProfile | null = null;
  for (const url of pages) {
    tried.push(new URL(url).hostname);
    const got = await syncOemModel({ ...input, url }).catch(() => null);
    if (!got) continue;
    const angles = Object.keys(got.images ?? {}).length;
    if (!best || angles > Object.keys(best.images ?? {}).length) best = got;
    if (angles >= 3) break;
  }
  if (!best) {
    throw new OemSyncError(
      'google-nothing-usable',
      `Nothing usable on the pages Google found (${tried.join(', ')}). Try the manufacturer's link.`,
    );
  }
  return {
    ...best,
    source: 'google',
    syncNote: [best.syncNote, `Found through Google: ${tried.join(', ')}.`].filter(Boolean).join(' '),
  };
}
