/**
 * Scene planning (PRD P0.5 / P0.7).
 *
 * Two jobs, in order:
 *
 *  1. FIT — decide how many scenes a video of this length should actually have,
 *     and choose which beats survive. Naively concatenating every beat of every
 *     selected use case is what made long videos feel rushed: a 50s brief with
 *     three use cases produced 12+ beats, i.e. ~4s per scene, too short to hold
 *     a spoken line. Now the target scene count comes from the duration, and
 *     beats are selected round-robin across use cases so no use case disappears.
 *
 *  2. SPLIT — group the timed scenes into generation segments no longer than the
 *     model's per-clip cap, and never leave a sliver at the end.
 */

import type { Beat, ScenePlan, Scene } from './types.js';
import { MIN_SPOKEN_SCENE } from './constants.js';

export interface PlanOptions {
  /** Spoken scenes need room to breathe; silent ones can cut faster. */
  speaks?: boolean;
}

/**
 * The shortest a scene may be. A spoken scene needs room for a natural line —
 * below ~4.5s the read gets rushed, which was the "messy long video" problem.
 */
const MIN_SCENE_SPOKEN = 4.5;
const MIN_SCENE_SILENT = 3.0;
const MIN_SCENES = 3;

export function targetSceneCount(totalDuration: number, speaks: boolean, available: number): number {
  const floor = speaks ? MIN_SCENE_SPOKEN : MIN_SCENE_SILENT;
  return Math.max(MIN_SCENES, Math.min(available, Math.floor(totalDuration / floor)));
}

/**
 * Choose which beats make the cut. Keeps every use case represented and always
 * keeps the opening hook and the closing beat, which carry the CTA.
 */
export function fitBeats(beats: Beat[], target: number): Beat[] {
  if (beats.length <= target) return beats;

  const byCat = new Map<string, Beat[]>();
  for (const b of beats) {
    const key = b.cat ?? '_';
    const arr = byCat.get(key) ?? [];
    arr.push(b);
    byCat.set(key, arr);
  }

  const keep = new Set<Beat>();
  const first = beats[0]!;
  const last = beats[beats.length - 1]!;
  keep.add(first);
  keep.add(last);

  // One beat from every use case, so nothing gets silently dropped entirely.
  for (const list of byCat.values()) {
    if (keep.size >= target) break;
    const head = list.find((b) => !keep.has(b));
    if (head) keep.add(head);
  }

  // Fill the rest round-robin across use cases, preferring beats that carry an
  // on-screen card or dialogue over pure b-roll.
  const score = (b: Beat): number => (b.card || b.cardLines?.length ? 2 : b.dialogue ? 1 : 0);
  const queues = [...byCat.values()].map((list) =>
    list.filter((b) => !keep.has(b)).sort((a, b) => score(b) - score(a)),
  );
  let progress = true;
  while (keep.size < target && progress) {
    progress = false;
    for (const q of queues) {
      if (keep.size >= target) break;
      const next = q.shift();
      if (next) {
        keep.add(next);
        progress = true;
      }
    }
  }

  return beats.filter((b) => keep.has(b));
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

export function planScenes(
  beats: Beat[],
  totalDuration: number,
  maxChunk: number,
  opts: PlanOptions = {},
): ScenePlan {
  if (beats.length === 0) return { parts: 0, partDuration: 0, scenes: [], droppedBeats: 0 };

  const speaks = opts.speaks !== false;

  // --- 1. FIT: trim only when scenes would fall below the floor ---
  const target = targetSceneCount(totalDuration, speaks, beats.length);
  const fitted = fitBeats(beats, target);
  const droppedBeats = beats.length - fitted.length;

  // --- 2. TIME: weight each scene across the WHOLE video, not per segment, so
  //     scene lengths are even and driven by what the beat carries. ---
  const weights = fitted.map((b, i) => {
    let w = 1;
    if (i === 0) w += 0.3; // the opening hook needs room to establish
    if (speaks && b.dialogue) w += 0.2;
    if (b.card || b.cardLines?.length) w += 0.15;
    return w;
  });
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const durations = weights.map((w) => (w / weightSum) * totalDuration);

  // No single scene may exceed the model's per-clip cap. Anything clamped hands
  // its overflow back to the scenes that still have headroom.
  let overflow = 0;
  for (let i = 0; i < durations.length; i++) {
    if (durations[i]! > maxChunk) {
      overflow += durations[i]! - maxChunk;
      durations[i] = maxChunk;
    }
  }
  if (overflow > 0.01) {
    const headroom = durations.map((d) => Math.max(0, maxChunk - d));
    const totalHeadroom = headroom.reduce((a, b) => a + b, 0);
    if (totalHeadroom > 0) {
      for (let i = 0; i < durations.length; i++) {
        durations[i] = durations[i]! + (headroom[i]! / totalHeadroom) * Math.min(overflow, totalHeadroom);
      }
    }
  }

  // --- 3. BUCKET whole scenes into segments. A scene is never split across a
  //     segment boundary, so nothing is cut mid-action; segments vary in length,
  //     filling up to the model's cap.
  //     Two scenes that together overrun the cap only slightly are kept in one
  //     segment and trimmed to fit — a 2% squeeze is imperceptible, whereas
  //     spilling them into another segment costs a paid call and an extra cut.
  const SQUEEZE = 1.09;
  const groups: number[][] = [];
  let current: number[] = [];
  let currentLen = 0;
  for (let i = 0; i < fitted.length; i++) {
    const d = durations[i]!;
    if (current.length && currentLen + d > maxChunk * SQUEEZE) {
      groups.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(i);
    currentLen += d;
  }
  if (current.length) groups.push(current);

  // Bring any squeezed segment back under the hard cap.
  for (const g of groups) {
    const len = g.reduce((a, i) => a + durations[i]!, 0);
    if (len > maxChunk) {
      const scale = maxChunk / len;
      for (const i of g) durations[i] = durations[i]! * scale;
    }
  }

  const scenes: Scene[] = [];
  let clock = 0;
  groups.forEach((group, gi) => {
    const partStart = clock;
    for (const i of group) {
      const dur = durations[i]!;
      scenes.push({
        beat: fitted[i]!,
        part: gi,
        start: round1(clock),
        end: round1(clock + dur),
        duration: round1(dur),
        partStart: round1(partStart),
      });
      clock += dur;
    }
  });
  const partDuration = groups.length ? clock / groups.length : 0;

  const usedParts = new Set(scenes.map((x) => x.part)).size;
  return { parts: usedParts, partDuration: round1(partDuration), scenes, droppedBeats };
}

export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const sStr = Math.abs(s % 1) < 0.05 ? String(Math.round(s)) : s.toFixed(1);
  return m > 0 ? `${m}:${s < 10 ? '0' : ''}${sStr}` : `0:${s < 10 ? '0' : ''}${sStr}`;
}
