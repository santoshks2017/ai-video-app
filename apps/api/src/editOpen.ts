import type { FilmLayers } from '@ava/shared';
import type { JobRecord } from './store.js';

export type EditOpenPlan = 'edit' | 'ready' | 'music' | 'clean' | 'rebuild' | 'flat';

/**
 * How a version opens in the video editor.
 *
 * edit — it was exported from the editor, so that edit reopens.
 * ready — its layers and its clean footage are both kept.
 * music — both are kept, but not where its voice is or how loud its music track is,
 *   which the music's key points start from; those are worked out, nothing is encoded.
 * clean — its layers are kept; the clean footage is made from its segments.
 * rebuild — it was made before layers were kept; both are made from its segments.
 * flat — it kept no complete set of segments, so it opens as the finished picture.
 */
export function editOpenPlan(job: Pick<JobRecord, 'editProject' | 'layers' | 'cleanStoragePath' | 'clips'>): EditOpenPlan {
  if (job.editProject) return 'edit';
  const complete = segmentsKept(job);
  if (job.layers && job.cleanStoragePath) return musicUnmeasured(job.layers, complete) ? 'music' : 'ready';
  if (!complete) return 'flat';
  return job.layers ? 'clean' : 'rebuild';
}

/**
 * Whether a film's music is missing what its key points start from: where the voice is
 * (heard on the segments, so only when they are all kept) or the track's loudness.
 */
export function musicUnmeasured(layers: Pick<FilmLayers, 'music'>, segmentsKept: boolean): boolean {
  const m = layers.music;
  if (!m) return false;
  return m.measured === undefined || (m.duckDb < 0 && !m.speech && segmentsKept);
}

/** Whether every part of a film is kept, so the film can be joined — or heard — again. */
export function segmentsKept(job: Pick<JobRecord, 'clips'>): boolean {
  const parts = job.clips ?? [];
  return parts.length > 0 && parts.every((c) => c.status === 'done' && Boolean(c.storagePath));
}
