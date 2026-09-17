/**
 * Derives the render context from a Brief. Equivalent to the legacy tool's
 * gatherContext(), but reading from a structured Brief instead of DOM inputs.
 */

import type { AspectRatio, Brief, NarrationMode } from './types.js';
import { narrationMode } from './narration.js';
import { DEALER_CTA, DEALER_VISUAL_STYLE, OEM_CTA, OEM_VISUAL_STYLE } from './defaults.js';

/**
 * "Test drive" for cars, "test ride" for bikes and scooters. The CTA, the end card,
 * the storyboard and the script all say whichever fits the showroom; the case of
 * the original is kept ("Test Drive" -> "Test Ride").
 */
export function adaptTrial(text: string, vehicle: 'car' | 'bike' | undefined): string {
  if (vehicle !== 'bike') return text;
  return text.replace(/\b(test)([\s-]+)(drive)(s?)\b/gi, (_m, t: string, sep: string, d: string, plural: string) =>
    `${t}${sep}${d[0] === 'D' ? 'R' : 'r'}${d.slice(1) === 'RIVE' ? 'IDE' : 'ide'}${plural}`,
  );
}

/** The storyboard's pace, held to what a presenter can still say clearly. */
export const clampPace = (pace: number | undefined): number => Math.min(1.5, Math.max(0.85, Number(pace) || 1));

export interface RenderContext {
  brief: Brief;
  mode: NarrationMode;
  totalDuration: number;
  maxChunk: number;
  aspect: AspectRatio;
  music: string;
  cta: string;
  visStyle: string;
  endcardOn: boolean;
  endcard: string;
  footer: string;
  useFake: boolean;
  displayBrandModel: string;
  displayDealer: string;
  /** Dealership name to use in body copy (fictional if fictionalize is on). */
  dealerShort: string;
  /** Dealership name actually shown on screen (falls back to the real name). */
  onScreenDealer: string;
  vehicle: 'car' | 'bike';
  /** "test drive" or "test ride". */
  trial: string;
  /** Delivery speed; 1 is a natural read. */
  pace: number;
  /** Words a minute the voice speaks at — the designer's choice for this film. */
  speechWpm?: number;
}

export function buildContext(brief: Brief): RenderContext {
  const d = brief.dealer;
  const useFake = d.fictionalize;
  const vehicle: 'car' | 'bike' = brief.vehicleKind === 'bike' ? 'bike' : 'car';

  const displayBrandModel = useFake
    ? d.fakeBrandModel || '[Placeholder Brand + Model]'
    : d.brandModel || '[Brand + Model]';
  const displayDealer = useFake ? d.fakeDealer || '[Placeholder Dealership]' : d.dealerName || '[Dealership]';
  const onScreenDealer = useFake
    ? d.fakeDealer || d.dealerName || '[Dealership]'
    : d.dealerName || '[Dealership]';

  const oem = d.kind === 'oem';
  /**
   * A value the team actually chose. A project is created holding the dealership
   * defaults, so for a manufacturer a value still equal to one of them is nobody's
   * decision — it is the blank the manufacturer's own default belongs in.
   */
  const chosen = (value: string, fallback: string): string => {
    const v = value.trim();
    return v && !(oem && v === fallback) ? v : '';
  };
  const footer =
    brief.footer.trim() ||
    (oem ? [onScreenDealer, d.tagline, d.website] : [onScreenDealer, d.address, d.phone])
      .map((x) => (x ?? '').trim())
      .filter(Boolean)
      .join(' | ');

  return {
    brief,
    mode: narrationMode(brief.narration),
    totalDuration: Math.max(4, Math.round(brief.durationSec) || 27),
    maxChunk: Math.max(3, Math.round(brief.maxChunkSec) || 10),
    aspect: brief.aspect,
    music: brief.music.trim(),
    cta: adaptTrial(
      chosen(brief.cta, DEALER_CTA) || (oem ? OEM_CTA : DEALER_CTA),
      vehicle,
    ),
    visStyle:
      chosen(brief.visualStyle, DEALER_VISUAL_STYLE) ||
      (oem ? OEM_VISUAL_STYLE : DEALER_VISUAL_STYLE),
    endcardOn: brief.endCardOn,
    endcard: brief.endCard.trim(),
    footer,
    useFake,
    displayBrandModel,
    displayDealer,
    onScreenDealer,
    dealerShort: useFake ? d.fakeDealer || '[Dealership]' : d.dealerName || '[Dealership]',
    vehicle,
    trial: vehicle === 'bike' ? 'test ride' : 'test drive',
    pace: clampPace(brief.pace),
    speechWpm: brief.speechWpm,
  };
}

/** The subset passed to category beat functions. */
export function beatContext(ctx: RenderContext) {
  return {
    dealerShort: ctx.dealerShort,
    brandName: ctx.brief.dealer.kind === 'oem' ? ctx.dealerShort : ctx.displayBrandModel,
    tagline: ctx.brief.dealer.tagline,
    clientKind: ctx.brief.dealer.kind ?? 'dealer',
    displayDealer: ctx.displayDealer,
    displayBrandModel: ctx.displayBrandModel,
    cta: ctx.cta,
    totalDuration: ctx.totalDuration,
    aspect: ctx.aspect,
    vehicle: ctx.vehicle,
    trial: ctx.trial,
  };
}
