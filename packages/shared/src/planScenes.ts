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
  // No single scene may exceed the model's per-clip cap.
  const durations = weights.map((w) => Math.min(maxChunk, (w / weightSum) * totalDuration));

  // --- 3. SPLIT: as few segments as the per-clip cap allows, balanced by time.
  //     Fewer segments means fewer paid calls and fewer cuts to hide. ---
  const parts = Math.max(1, Math.min(fitted.length, Math.ceil(totalDuration / maxChunk)));
  const partDuration = totalDuration / parts;

  const groups: number[][] = Array.from({ length: parts }, () => []);
  let running = 0;
  fitted.forEach((_, i) => {
    // Place a scene in the part its midpoint falls into, so parts stay even.
    const mid = running + durations[i]! / 2;
    const slot = Math.min(parts - 1, Math.floor(mid / partDuration));
    groups[slot]!.push(i);
    running += durations[i]!;
  });
  // A part must not be empty — pull a scene forward from the next one.
  for (let p = 0; p < parts; p++) {
    if (groups[p]!.length === 0) {
      const donor = groups.slice(p + 1).find((g) => g.length > 1);
      if (donor) groups[p]!.push(donor.shift()!);
    }
  }

  // Rescale each part's scenes to fill exactly partDuration, so every segment
  // is the same length and lands under the model's cap.
  const scenes: Scene[] = [];
  let clock = 0;
  groups.filter((g) => g.length).forEach((group, gi) => {
    const groupTotal = group.reduce((a, i) => a + durations[i]!, 0) || 1;
    const scale = partDuration / groupTotal;
    const partStart = clock;
    for (const i of group) {
      const dur = durations[i]! * scale;
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

  const usedParts = new Set(scenes.map((x) => x.part)).size;
  return { parts: usedParts, partDuration: round1(partDuration), scenes, droppedBeats };
}

export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const sStr = Math.abs(s % 1) < 0.05 ? String(Math.round(s)) : s.toFixed(1);
  return m > 0 ? `${m}:${s < 10 ? '0' : ''}${sStr}` : `0:${s < 10 ? '0' : ''}${sStr}`;
}
