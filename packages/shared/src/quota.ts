/**
 * Daily request limits, and the clock they run on.
 *
 * Google caps each video model at a number of requests a day — 100 for Omni 1.1
 * Flash on this account — and counts every attempt against it, failed ones
 * included: the dashboard read 106 of 100 after runs kept retrying into the wall.
 * The day is Google's, not ours. It turns over at midnight Pacific, which is
 * half past noon in India.
 */

export const PACIFIC = 'America/Los_Angeles';

/** At most this many parts are made a second time when the vehicle check sees the wrong car. */
export const RETAKE_REQUESTS = 2;

/** The Pacific calendar day a moment falls on, as YYYY-MM-DD — the key a day's usage is filed under. */
export function pacificDay(now: number = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** When the current Pacific day ends, in epoch milliseconds. */
export function nextPacificMidnight(now: number = Date.now()): number {
  const [y, m, d] = pacificDay(now).split('-').map(Number);
  const guess = Date.UTC(y!, m! - 1, d! + 1, 0, 0, 0);
  // The Pacific offset at that moment, read back from how the clock there shows
  // it — so the daylight-saving change is handled by the platform, not by us.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(guess);
  const at = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour'), at('minute'), at('second'));
  return guess + (guess - wall);
}

/** "12:30 PM IST" — when a limit comes back, said in the team's own time. */
export function resetTimeLabel(ms: number, timeZone = 'Asia/Kolkata'): string {
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(ms);
  return timeZone === 'Asia/Kolkata' ? `${time} IST` : time;
}

/**
 * Is this refusal the day's cap, rather than the minute's?
 *
 * The distinction decides whether retrying is worth anything. A per-minute limit
 * clears in seconds; a daily one does not clear until midnight Pacific, and every
 * retry into it is counted anyway. Google's "Please retry in 1.58s" appears on both,
 * so it cannot be trusted to tell them apart. What can: the quota being named as a
 * per-day one, or the limit it reports being the model's daily number — 100 on
 * Omni 1.1 Flash, where the per-minute limit is 8.
 */
export function isDailyQuotaError(message: string, dailyLimit?: number): boolean {
  if (/per.?day|perday|requests_per_day|daily|\brpd\b/i.test(message)) return true;
  const reported = /limit:\s*(\d+)/i.exec(message);
  return Boolean(dailyLimit && reported && Number(reported[1]) === dailyLimit);
}

/**
 * How many requests a run spends: one per part, and up to two more when the
 * vehicle check has a part made again. The check only runs on Google's models.
 */
export function requestsForRun(parts: number, modelId: string): { base: number; worst: number } {
  const base = Math.max(0, parts);
  const retakes = /^(gemini|veo)-/i.test(modelId) ? RETAKE_REQUESTS : 0;
  return { base, worst: base + retakes };
}

/** One model's day, as the picker says it. */
export function remainingLabel(
  u: { requests: number; limit: number | null; exhausted: boolean },
  resetsAt: number,
): string {
  if (u.exhausted) return `used up · back at ${resetTimeLabel(resetsAt)}`;
  if (u.limit) return `${Math.max(0, u.limit - u.requests)} of ${u.limit} left today`;
  return u.requests ? `${u.requests} used today · no limit set` : 'no limit set';
}
