import type { JobRecord } from './store.js';

export type EditOpenPlan = 'edit' | 'ready' | 'clean' | 'rebuild' | 'flat';

/**
 * How a version opens in the video editor.
 *
 * edit — it was exported from the editor, so that edit reopens.
 * ready — its layers and its clean footage are both kept.
 * clean — its layers are kept; the clean footage is made from its segments.
 * rebuild — it was made before layers were kept; both are made from its segments.
 * flat — it kept no complete set of segments, so it opens as the finished picture.
 */
export function editOpenPlan(job: Pick<JobRecord, 'editProject' | 'layers' | 'cleanStoragePath' | 'clips'>): EditOpenPlan {
  if (job.editProject) return 'edit';
  if (job.layers && job.cleanStoragePath) return 'ready';
  const parts = job.clips ?? [];
  const complete = parts.length > 0 && parts.every((c) => c.status === 'done' && Boolean(c.storagePath));
  if (!complete) return 'flat';
  return job.layers ? 'clean' : 'rebuild';
}
