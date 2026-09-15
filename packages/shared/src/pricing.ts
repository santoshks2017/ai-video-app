/**
 * What the models this app calls cost, and what a render or a call came to.
 *
 * Video is billed by the second, at the resolution the model renders — and for the
 * length it renders, which is not always the length asked for: Veo renders 4, 6 or 8
 * seconds and nothing in between, and a part made again because it showed the wrong
 * vehicle is paid for twice. Omni also bills what it is sent — the prompt, each
 * reference image, any reference video — as input tokens. Everything else Google is
 * asked (scripts, drawings, photo checks, imports) is billed in tokens, read off each
 * response, and music by the song.
 *
 * Prices are Google's list prices in US dollars as of September 2026. They are
 * converted at DEFAULT_USD_TO_INR, and GST is left out.
 */
import { DEFAULT_USD_TO_INR } from './constants.js';
import type { Resolution } from './types.js';

/** Dollars a second of video, by provider model id and the resolution it renders at. */
export const VIDEO_PRICES: Record<string, Partial<Record<Resolution, number>>> = {
  'gemini-omni-1.1-flash': { '360p': 0.034, '720p': 0.101, '1080p': 0.152 },
  'gemini-omni-flash': { '360p': 0.034, '720p': 0.1 },
  // Google quotes Veo 3.1 as a range; the top of it, so a film is never costed low.
  'veo-3.1-generate-preview': { '720p': 0.3, '1080p': 0.4 },
  'veo-3.1-fast-generate-preview': { '720p': 0.1, '1080p': 0.15 },
  'veo-3.1-lite-generate-preview': { '720p': 0.05, '1080p': 0.08 },
};

/** Omni bills its input at $1.50 a million tokens, whatever the kind. */
export const OMNI_INPUT_USD_PER_M = 1.5;
export const OMNI_TOKENS_PER_IMAGE = 1120;
export const OMNI_TOKENS_PER_VIDEO_SECOND = 5792;

export const LYRIA_USD_PER_SONG = 0.08;

const isOmni = (modelId?: string): boolean => /omni/i.test(modelId ?? '');
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

/**
 * The seconds a provider renders — and bills — for a part planned at `planned` seconds.
 * `resolution` is the resolution rendered; `references` the images sent with the part.
 */
export function billedSeconds(
  modelId: string | undefined,
  planned: number,
  opts: { resolution?: Resolution; references?: number } = {},
): number {
  const id = modelId ?? '';
  if (/veo/i.test(id)) {
    // 1080p and reference images both force an 8-second render, trimmed to fit.
    if (opts.resolution === '1080p' || (opts.references ?? 0) > 0) return 8;
    return [4, 6, 8].find((s) => s >= planned - 0.05) ?? 8;
  }
  if (/seedance/i.test(id)) return Math.max(4, Math.ceil(planned - 0.05));
  // Omni renders whole seconds, three at the least.
  if (isOmni(id)) return Math.max(3, Math.round(planned));
  return planned;
}

export interface RenderPart {
  /** How long the part was planned to run. */
  seconds: number;
  /** Made twice: the first came back showing the wrong vehicle. */
  remade?: boolean;
  /** Reference images sent with it. */
  images?: number;
  /** Seconds of reference video sent with it. */
  videoSeconds?: number;
  /** Characters in its prompt. */
  promptChars?: number;
}

export interface RenderCost {
  /** Seconds billed — remakes counted twice, so this can be longer than the film. */
  seconds: number;
  outputUsd: number;
  inputUsd: number;
  usd: number;
  inr: number;
}

/** Omni input tokens for one request: about four characters of prompt to a token. */
export function omniInputTokens(p: Pick<RenderPart, 'images' | 'videoSeconds' | 'promptChars'>): number {
  return (
    Math.ceil((p.promptChars ?? 0) / 4) +
    (p.images ?? 0) * OMNI_TOKENS_PER_IMAGE +
    Math.round((p.videoSeconds ?? 0) * OMNI_TOKENS_PER_VIDEO_SECOND)
  );
}

/** What rendering these parts cost on a model charging `usdPerSecond` at `resolution`. */
export function renderCost(
  modelId: string | undefined,
  usdPerSecond: number,
  parts: RenderPart[],
  opts: { resolution?: Resolution; usdToInr?: number } = {},
): RenderCost {
  let seconds = 0;
  let inputUsd = 0;
  for (const p of parts) {
    const renders = p.remade ? 2 : 1;
    seconds += billedSeconds(modelId, p.seconds, { resolution: opts.resolution, references: p.images }) * renders;
    if (isOmni(modelId)) inputUsd += (omniInputTokens(p) / 1e6) * OMNI_INPUT_USD_PER_M * renders;
  }
  const outputUsd = seconds * usdPerSecond;
  const usd = round4(outputUsd + inputUsd);
  return {
    seconds: Math.round(seconds * 10) / 10,
    outputUsd: round4(outputUsd),
    inputUsd: round4(inputUsd),
    usd,
    inr: Math.round(usd * (opts.usdToInr ?? DEFAULT_USD_TO_INR)),
  };
}

/* ---- calls billed in tokens ---- */

/** The token counts a Gemini response reports as `usageMetadata`. */
export interface TokenUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  candidatesTokensDetails?: { modality?: string; tokenCount?: number }[];
}

export interface TokenRates {
  /** Dollars per million tokens. */
  input: number;
  output: number;
  /** Output tokens that are a picture, where a model draws. */
  image?: number;
  /** Listed by name; an unlisted model is priced as Pro so it is not counted as cheap. */
  listed: boolean;
}

/** Matched in order: image models before the text models whose names they contain. */
const TOKEN_RATES: { match: RegExp; input: number; output: number; image?: number; halfPriceIn2026?: boolean }[] = [
  { match: /gemini-3-pro-image/, input: 2, output: 12, image: 120 },
  { match: /gemini-3\.1-flash-lite-image/, input: 0.25, output: 1.5, image: 30 },
  { match: /gemini-3\.1-flash-image/, input: 0.5, output: 3, image: 60 },
  { match: /gemini-3\.[678]-flash/, input: 0.75, output: 3.75, halfPriceIn2026: true },
  { match: /gemini-3\.5-flash-lite/, input: 0.3, output: 2.5 },
  { match: /gemini-3\.5-flash/, input: 1.5, output: 9 },
  { match: /gemini-3\.1-flash-lite/, input: 0.25, output: 1.5 },
  { match: /gemini-3(\.\d+)?-pro/, input: 2, output: 12 },
  { match: /gemini-2\.5-pro/, input: 1.25, output: 10 },
  { match: /gemini-2\.5-flash-lite/, input: 0.1, output: 0.4 },
  { match: /gemini-2\.5-flash/, input: 0.3, output: 2.5 },
];

/** Gemini 3.6–3.8 Flash are listed at half price until the end of 2026. */
const HALF_PRICE_ENDS = Date.UTC(2027, 0, 1);

export function tokenRates(model: string, at = Date.now()): TokenRates {
  const row = TOKEN_RATES.find((r) => r.match.test(model));
  if (!row) return { input: 2, output: 12, image: 120, listed: false };
  const k = row.halfPriceIn2026 && at >= HALF_PRICE_ENDS ? 2 : 1;
  return { input: row.input * k, output: row.output * k, image: row.image, listed: true };
}

/** Dollars a call cost, from the tokens its response reports. Thinking is billed as output. */
export function usageCostUsd(model: string, usage: TokenUsage, at = Date.now()): number {
  const r = tokenRates(model, at);
  const image = (usage.candidatesTokensDetails ?? [])
    .filter((d) => /image/i.test(d.modality ?? ''))
    .reduce((a, d) => a + (d.tokenCount ?? 0), 0);
  const textOut = Math.max(0, (usage.candidatesTokenCount ?? 0) - image) + (usage.thoughtsTokenCount ?? 0);
  return ((usage.promptTokenCount ?? 0) * r.input + textOut * r.output + image * (r.image ?? r.output)) / 1e6;
}
