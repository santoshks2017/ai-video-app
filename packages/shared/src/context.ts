/**
 * Derives the render context from a Brief. Equivalent to the legacy tool's
 * gatherContext(), but reading from a structured Brief instead of DOM inputs.
 */

import type { AspectRatio, Brief, NarrationMode } from './types.js';
import { narrationMode } from './narration.js';

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
}

export function buildContext(brief: Brief): RenderContext {
  const d = brief.dealer;
  const useFake = d.fictionalize;

  const displayBrandModel = useFake
    ? d.fakeBrandModel || '[Placeholder Brand + Model]'
    : d.brandModel || '[Brand + Model]';
  const displayDealer = useFake ? d.fakeDealer || '[Placeholder Dealership]' : d.dealerName || '[Dealership]';
  const onScreenDealer = useFake
    ? d.fakeDealer || d.dealerName || '[Dealership]'
    : d.dealerName || '[Dealership]';

  const footer =
    brief.footer.trim() ||
    [onScreenDealer, d.address, d.phone].map((x) => (x ?? '').trim()).filter(Boolean).join(' | ');

  return {
    brief,
    mode: narrationMode(brief.narration),
    totalDuration: Math.max(4, Math.round(brief.durationSec) || 27),
    maxChunk: Math.max(3, Math.round(brief.maxChunkSec) || 10),
    aspect: brief.aspect,
    music: brief.music.trim(),
    cta: brief.cta.trim() || 'Book your test drive today',
    visStyle:
      brief.visualStyle.trim() ||
      'Bright premium modern showroom, glossy floors, realistic reflections, energetic dealership-ad feel',
    endcardOn: brief.endCardOn,
    endcard: brief.endCard.trim(),
    footer,
    useFake,
    displayBrandModel,
    displayDealer,
    onScreenDealer,
    dealerShort: useFake ? d.fakeDealer || '[Dealership]' : d.dealerName || '[Dealership]',
  };
}

/** The subset passed to category beat functions. */
export function beatContext(ctx: RenderContext) {
  return {
    dealerShort: ctx.dealerShort,
    displayDealer: ctx.displayDealer,
    displayBrandModel: ctx.displayBrandModel,
    cta: ctx.cta,
    totalDuration: ctx.totalDuration,
    aspect: ctx.aspect,
  };
}
