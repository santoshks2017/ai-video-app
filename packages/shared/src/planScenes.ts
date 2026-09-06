/**
 * Multi-part chunking (PRD P0.7). Splits a video whose scene count exceeds what
 * fits in one call into sequential create-then-extend parts, dividing scenes as
 * evenly as possible and weighting the opening hook and end card wider.
 * Ported verbatim from the legacy tool's planScenes().
 */

import type { Beat, ScenePlan } from './types.js';

export function planScenes(beats: Beat[], totalDuration: number, maxChunk: number): ScenePlan {
  const n = beats.length;
  if (n === 0) return { parts: 0, partDuration: 0, scenes: [] };

  const parts = Math.max(1, Math.min(Math.ceil(totalDuration / maxChunk), n));
  const partDuration = totalDuration / parts;

  const base = Math.floor(n / parts);
  const extra = n % parts;
  const groups: Beat[][] = [];
  let idx = 0;
  for (let p = 0; p < parts; p++) {
    const count = base + (p < extra ? 1 : 0);
    groups.push(beats.slice(idx, idx + count));
    idx += count;
  }

  const scenes: ScenePlan['scenes'] = [];
  let clock = 0;
  groups.forEach((group, gi) => {
    const weights = group.map((b, i) => {
      if (gi === 0 && i === 0) return 1.25; // opening hook needs room
      if (b.isEndCard) return 1.1;
      return 1;
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    const partStart = clock;
    group.forEach((b, i) => {
      const dur = (weights[i]! / sum) * partDuration;
      scenes.push({
        beat: b,
        part: gi,
        start: round1(clock),
        end: round1(clock + dur),
        duration: round1(dur),
        partStart: round1(partStart),
      });
      clock += dur;
    });
  });

  return { parts, partDuration: round1(partDuration), scenes };
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const sStr = Math.abs(s % 1) < 0.05 ? String(Math.round(s)) : s.toFixed(1);
  return m > 0 ? `${m}:${s < 10 ? '0' : ''}${sStr}` : `0:${s < 10 ? '0' : ''}${sStr}`;
}
