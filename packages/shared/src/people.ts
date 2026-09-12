/**
 * Reading a library of people: which band an actor's age falls in, and who a
 * client's films usually star.
 *
 * Actor consistency is the point of the second one. A dealership's audience sees
 * the same promoter every time, so the app should know who that is and say so
 * before a project quietly picks someone else.
 */

import { AGE_BANDS, type ActorProfile, type AgeBand, type Project } from './library.js';

/** Numbers the age text implies: "late 20s" is 28, "34" is 34. */
function ageNumber(text: string): number | undefined {
  const m = /(\d{2})/.exec(text);
  if (!m) return undefined;
  const n = Number(m[1]);
  const decade = /\d{2}\s*s\b|\d{2}'?s/.test(text) || /\bs\b/.test(text.slice(m.index + 2, m.index + 5));
  if (!decade) return n;
  if (/\blate\b/i.test(text)) return n + 8;
  if (/\bmid\b/i.test(text)) return n + 5;
  if (/\bearly\b/i.test(text)) return n + 2;
  return n + 5;
}

/** The band an actor belongs to: the one chosen, or the one their age text implies. */
export function ageBandOf(actor: Pick<ActorProfile, 'ageBand' | 'age'>): AgeBand | undefined {
  if (actor.ageBand) return actor.ageBand;
  const n = ageNumber(actor.age ?? '');
  if (n === undefined) return undefined;
  if (n <= 25) return AGE_BANDS[0];
  if (n <= 35) return AGE_BANDS[1];
  if (n <= 45) return AGE_BANDS[2];
  return AGE_BANDS[3];
}

export interface UsualActor {
  actorId: string;
  /** Films this client has made with them. */
  count: number;
  /** Films this client has made with any actor named. */
  total: number;
}

/**
 * Who this client's films star, when there is an answer.
 *
 * Ties go to the most recent: two actors used twice each means the one seen last
 * is the one the dealership's audience remembers.
 */
export function usualActorFor(
  projects: Pick<Project, 'clientId' | 'actorId' | 'updatedAt'>[],
  clientId: string | undefined,
): UsualActor | null {
  if (!clientId) return null;
  const mine = projects.filter((p) => p.clientId === clientId && p.actorId);
  if (!mine.length) return null;
  const seen = new Map<string, { count: number; last: number }>();
  for (const p of mine) {
    const cur = seen.get(p.actorId!) ?? { count: 0, last: 0 };
    seen.set(p.actorId!, { count: cur.count + 1, last: Math.max(cur.last, p.updatedAt ?? 0) });
  }
  const [actorId, stat] = [...seen.entries()].sort(
    (a, b) => b[1].count - a[1].count || b[1].last - a[1].last,
  )[0]!;
  return { actorId, count: stat.count, total: mine.length };
}
