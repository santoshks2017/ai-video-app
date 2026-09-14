/**
 * What each model has spent today, counted by the app itself.
 *
 * Google does not hand back how much of a daily allowance is left, so the app
 * counts what it asks for: one tick per request attempt, retries included, because
 * Google counts those too. A day's count lives in `usage/{model}__{pacific day}`.
 *
 * Two things this cannot see, and says so where it matters: requests made outside
 * the app on the same key, and a limit set wrong on the model. The first refusal
 * that names the day's cap is taken as the truth over the count, and marks the
 * model used up until the day turns.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { nextPacificMidnight, pacificDay } from '@ava/shared';
import { ensureFirebase } from './store.js';

const usage = () => {
  ensureFirebase();
  return getFirestore().collection('usage');
};

const docId = (modelId: string, day: string): string => `${modelId.replace(/[^a-zA-Z0-9._-]/g, '_')}__${day}`;

export interface ModelUsage {
  modelId: string;
  day: string;
  requests: number;
  /** Set when a refusal named the day's cap: the model is out until then. */
  exhaustedUntil?: number;
  resetsAt: number;
}

/**
 * One request, counted. Never awaited by a render and never allowed to fail one —
 * a missed tick costs an estimate a little accuracy, a thrown one would cost a film.
 */
export function countRequest(modelId: string): void {
  if (!modelId) return;
  const day = pacificDay();
  usage()
    .doc(docId(modelId, day))
    .set({ modelId, day, requests: FieldValue.increment(1), updatedAt: Date.now() }, { merge: true })
    .catch(() => {});
}

/** Google said this model's day is used up. Believe it until midnight Pacific. */
export async function markExhausted(modelId: string): Promise<void> {
  if (!modelId) return;
  const day = pacificDay();
  await usage()
    .doc(docId(modelId, day))
    .set({ modelId, day, exhaustedUntil: nextPacificMidnight(), updatedAt: Date.now() }, { merge: true });
}

/** Today's usage for these models, by model id. A model with nothing spent today has no entry. */
export async function usageToday(modelIds: string[]): Promise<Record<string, ModelUsage>> {
  const day = pacificDay();
  const resetsAt = nextPacificMidnight();
  const ids = [...new Set(modelIds.filter(Boolean))];
  if (!ids.length) return {};
  const snaps = await getFirestore().getAll(...ids.map((id) => usage().doc(docId(id, day))));
  const out: Record<string, ModelUsage> = {};
  snaps.forEach((snap, i) => {
    if (!snap.exists) return;
    const d = snap.data() ?? {};
    out[ids[i]!] = {
      modelId: ids[i]!,
      day,
      requests: Number(d.requests) || 0,
      exhaustedUntil: Number(d.exhaustedUntil) || undefined,
      resetsAt,
    };
  });
  return out;
}
