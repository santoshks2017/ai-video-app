/**
 * Money spent on Google outside any film: reading briefs, writing scripts, drawing
 * storyboard scenes and actor sheets, importing clients and vehicles, filing
 * photographs, checking the vehicle in each part, and music.
 *
 * Each call's cost is worked out from the tokens its response reports and written to
 * a log of its own, under the part of the app that made it. None of it is charged to
 * a project — Analytics shows it as misc cost. Writing the entry never holds up, or
 * fails, the call it counts.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { DEFAULT_USD_TO_INR, usageCostUsd, type TokenUsage, type UsageFact } from '@ava/shared';
import { ensureFirebase } from './store.js';

const CALL_COSTS = 'callCosts';

export type UsageSection =
  | 'Brief reading'
  | 'Script writing'
  | 'Pronunciation'
  | 'Storyboard drawings'
  | 'Actor profiles'
  | 'Client import'
  | 'Dealer photo filing'
  | 'Vehicle sync'
  | 'Vehicle photo filing'
  | 'Vehicle checks'
  | 'Music'
  | 'Caption placement'
  | 'Creative copy'
  | 'Creative images';

/** Log one call. `fixedUsd` is for what is priced per item rather than per token — a song. */
export function recordUsage(section: UsageSection, model: string, usage: TokenUsage | undefined, fixedUsd?: number): void {
  if (!usage && fixedUsd === undefined) return;
  const at = Date.now();
  const usd = fixedUsd ?? usageCostUsd(model, usage ?? {}, at);
  try {
    ensureFirebase();
    void getFirestore()
      .collection(CALL_COSTS)
      .add({
        at,
        section,
        model,
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
        usd: Math.round(usd * 1e6) / 1e6,
        costInr: Math.round(usd * DEFAULT_USD_TO_INR * 100) / 100,
      })
      .catch(() => {});
  } catch {
    /* the call being counted has already done its work */
  }
}

/** Every logged call, reduced to what Analytics reads. */
export async function listUsageFacts(): Promise<UsageFact[]> {
  ensureFirebase();
  const snap = await getFirestore().collection(CALL_COSTS).select('at', 'section', 'model', 'costInr').get();
  return snap.docs.map((d) => {
    const u = d.data() as Partial<UsageFact>;
    return { at: Number(u.at ?? 0), section: String(u.section ?? 'Other'), model: u.model, costInr: Number(u.costInr ?? 0) };
  });
}
