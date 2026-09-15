/**
 * Where a film too long for one model pass is cut into pieces.
 *
 * Seedance re-renders a limited length at a time, so a longer film goes through in
 * pieces and is joined again. Two pieces rendered separately never match exactly, so
 * the join is put where the film already cuts from one shot to the next — the latest
 * cut that still keeps the piece under the limit — and only where there is no cut is
 * the film divided evenly. No piece is left shorter than the model will take.
 */
export function pieceBounds(duration: number, cuts: number[], longest: number, shortest = 4): number[] {
  const round = (t: number): number => Math.round(t * 1000) / 1000;
  const sorted = [...cuts].filter((c) => c > 0 && c < duration).sort((a, b) => a - b);
  const bounds = [0];
  let t = 0;
  while (duration - t > longest) {
    const limit = t + longest;
    const cut = sorted.filter((c) => c >= t + shortest && c <= limit).pop();
    const remaining = duration - t;
    let next = cut ?? t + Math.ceil(remaining / Math.ceil(remaining / longest));
    if (duration - next < shortest) next = Math.min(limit, duration - shortest);
    next = round(Math.min(next, limit));
    if (next <= t) break;
    bounds.push(next);
    t = next;
  }
  bounds.push(round(duration));
  return bounds;
}
