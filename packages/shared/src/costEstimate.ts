/**
 * Cost estimate before generate (PRD P0.9). Only meaningful for automated
 * categories — presenter/prompt-only briefs never reach the API call.
 *
 * clipCount x seconds x $/sec, converted to INR at a stated rate. Any estimate
 * above Rs 500 requires explicit confirmation (COST_CONFIRM_INR, fixed).
 */

import type { Brief, CostEstimate } from './types.js';
import {
  USD_PER_SECOND_720P,
  DEFAULT_USD_TO_INR,
  COST_CONFIRM_INR,
  HIGH_CALL_COUNT,
} from './constants.js';
import { buildContext } from './context.js';
import { buildBeats } from './buildBeats.js';
import { planScenes } from './planScenes.js';

export interface CostEstimateOptions {
  usdPerSecond?: number;
  usdToInr?: number;
}

export function estimateCost(brief: Brief, opts: CostEstimateOptions = {}): CostEstimate {
  const usdPerSecond = opts.usdPerSecond ?? USD_PER_SECOND_720P;
  const usdToInr = opts.usdToInr ?? DEFAULT_USD_TO_INR;

  const ctx = buildContext(brief);
  const beats = buildBeats(ctx);
  const plan = planScenes(beats, ctx.totalDuration, ctx.maxChunk);

  // Each part is one create-or-extend API call. Billed on generated seconds.
  const clipCount = Math.max(1, plan.parts);
  const totalSeconds = ctx.totalDuration;

  const usd = round2(totalSeconds * usdPerSecond);
  const inr = Math.round(usd * usdToInr);

  return {
    clipCount,
    totalSeconds,
    usdPerSecond,
    usd,
    inr,
    usdToInr,
    needsConfirmation: inr > COST_CONFIRM_INR,
    highCallCountWarning: clipCount >= HIGH_CALL_COUNT,
  };
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

export function formatInr(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}
