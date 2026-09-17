/**
 * Where an Auto caption may go, once the people in the shot are known.
 *
 * Auto placement scores every place a caption could sit by how much moves and how
 * much detail it would cover. A presenter talking to camera barely moves, so her
 * face scored as the calmest place in the shot, and a festival greeting was drawn
 * straight across it. Where people are is now asked of a vision model, and a face is
 * somewhere a caption never goes.
 */

/** A rectangle as fractions of the frame: left, top, right, bottom. */
export interface FrameBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PeopleInShot {
  /** Heads — face and hair. A caption never touches one. */
  faces: FrameBox[];
  /** Whole people. A caption over a body is avoided wherever there is room. */
  bodies: FrameBox[];
}

export interface CaptionSpotCandidate {
  spot: string;
  /** Movement and detail under the caption: lower is quieter. */
  score: number;
  rect: FrameBox;
}

/** Clear space kept around a face, as a fraction of the frame. */
export const FACE_MARGIN = 0.04;

const area = (b: FrameBox): number => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);

/** How much of `rect` the boxes cover, each grown by `pad`, from 0 to 1. */
function coveredShare(rect: FrameBox, boxes: FrameBox[], pad: number): number {
  const whole = area(rect);
  if (!whole) return 0;
  let covered = 0;
  for (const b of boxes) {
    covered += area({
      x0: Math.max(rect.x0, b.x0 - pad),
      y0: Math.max(rect.y0, b.y0 - pad),
      x1: Math.min(rect.x1, b.x1 + pad),
      y1: Math.min(rect.y1, b.y1 + pad),
    });
  }
  return Math.min(1, covered / whole);
}

/** In the order given, a place has to be clearly quieter to win over the one before it. */
function quietest(list: { spot: string; score: number }[]): string {
  let best = list[0]!;
  for (const c of list.slice(1)) if (c.score < best.score * 0.85) best = c;
  return best.spot;
}

/**
 * The place an Auto caption takes.
 *
 * Knowing nothing about people — no key, or no answer — this is exactly the rule
 * placement always had. Knowing where they are, a place touching a face is out, and a
 * place over a body counts as busier by how much of it the body fills. If every place
 * touches a face, the one touching least is taken: a caption still has to go somewhere.
 */
export function chooseCaptionSpot(candidates: CaptionSpotCandidate[], people: PeopleInShot | null): string | undefined {
  if (!candidates.length) return undefined;
  if (!people || (!people.faces.length && !people.bodies.length)) return quietest(candidates);
  const loudest = Math.max(1e-6, ...candidates.map((c) => c.score));
  const judged = candidates.map((c) => ({
    spot: c.spot,
    face: coveredShare(c.rect, people.faces, FACE_MARGIN),
    score: c.score + 3 * loudest * coveredShare(c.rect, people.bodies, 0),
  }));
  const clear = judged.filter((c) => c.face === 0);
  if (clear.length) return quietest(clear);
  return judged.reduce((a, b) => (b.face < a.face || (b.face === a.face && b.score < a.score) ? b : a)).spot;
}

/** Boxes as a vision model gives them — [ymin, xmin, ymax, xmax] out of 1000 — as fractions of the frame. */
export function boxesFrom1000(raw: unknown): FrameBox[] {
  if (!Array.isArray(raw)) return [];
  const out: FrameBox[] = [];
  for (const b of raw) {
    if (!Array.isArray(b) || b.length !== 4) continue;
    const [ymin, xmin, ymax, xmax] = b.map((v) => Math.min(1000, Math.max(0, Number(v)))) as [number, number, number, number];
    if (![ymin, xmin, ymax, xmax].every(Number.isFinite) || xmax <= xmin || ymax <= ymin) continue;
    out.push({ x0: xmin / 1000, y0: ymin / 1000, x1: xmax / 1000, y1: ymax / 1000 });
  }
  return out;
}

/** The places an Auto caption can take, in the order a tie goes. */
export const CAPTION_SPOTS = ['bottom-left', 'bottom-right', 'top-left', 'top-right', 'middle-left', 'middle-right', 'bottom-center'] as const;
export type CaptionSpot = (typeof CAPTION_SPOTS)[number];
export const isCaptionSpot = (v: unknown): v is CaptionSpot => (CAPTION_SPOTS as readonly string[]).includes(v as string);

/** How far overlays sit off the frame's edges, and the band the corner logos take. */
export function overlayMargins(W: number, H: number): { margin: number; logoBand: number } {
  const S = Math.min(W, H);
  return { margin: Math.round(S * 0.04), logoBand: Math.round(S * 0.085) };
}

/** A caption's top-left corner at a spot: above the footer strip, below the logos, inside the margin. */
export function captionSpotXY(
  spot: CaptionSpot,
  W: number,
  H: number,
  w: number,
  h: number,
  margin: number,
  footerH: number,
  logoBand: number,
): { x: number; y: number } {
  const [row, col] = spot.split('-') as [string, string];
  const x = col === 'left' ? margin : col === 'right' ? W - w - margin : Math.round((W - w) / 2);
  const bottom = Math.max(margin, H - footerH - margin - h);
  const top = Math.min(bottom, margin + logoBand + margin);
  const y = row === 'bottom' ? bottom : row === 'top' ? top : Math.round(Math.min(Math.max(top, (H - h) / 2), bottom));
  return { x: Math.max(0, x), y: Math.max(0, y) };
}
