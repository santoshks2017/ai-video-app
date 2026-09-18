/**
 * The image editor's geometry, kept apart from the screen so it can be checked on its own.
 *
 * A layer's box is x, y, w, h on the frame before it turns, and it turns clockwise about its
 * centre. A drag on one of its handles is worked in the box's own turned frame: the handle
 * opposite stays where it is on the frame, the box grows or shrinks along its own sides, and
 * its x and y are found again from the new centre — so a turned layer resizes the way it looks.
 */
import { layerBounds, layerHit, type CreativeDoc, type CreativeFormat, type CreativeLayer } from '@ava/shared';

export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** Which way each handle faces in the box's own frame: -1 left or up, 1 right or down. */
const DIR: Record<Handle, readonly [number, number]> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
};
export const isCorner = (h: Handle): boolean => DIR[h][0] !== 0 && DIR[h][1] !== 0;

/** The smallest a handle sizes a layer to, in frame pixels. */
export const MIN_SIZE = 8;

const rad = (deg: number): number => (deg * Math.PI) / 180;

export const boxOf = (l: Pick<CreativeLayer, 'x' | 'y' | 'w' | 'h' | 'rotation'>): Box => ({ x: l.x, y: l.y, w: l.w, h: l.h, rotation: l.rotation || 0 });
export const centreOf = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** A point in the box's own frame (from its centre, before it turns) as a point on the frame. */
export function toWorld(b: Box, p: Pt): Pt {
  const c = centreOf(b);
  const a = rad(b.rotation);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: c.x + p.x * cos - p.y * sin, y: c.y + p.x * sin + p.y * cos };
}

/** A point on the frame in the box's own frame. */
export function toLocal(b: Box, p: Pt): Pt {
  const c = centreOf(b);
  const a = rad(b.rotation);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
}

export function handlePoint(b: Box, h: Handle): Pt {
  const [hx, hy] = DIR[h];
  return toWorld(b, { x: (hx * b.w) / 2, y: (hy * b.h) / 2 });
}

/** The handle that turns the box: `offset` frame pixels above the middle of its top side. */
export function rotateHandlePoint(b: Box, offset: number): Pt {
  return toWorld(b, { x: 0, y: -b.h / 2 - offset });
}

/** The point that stays put while a handle is dragged: the handle opposite. */
export function anchorOf(b: Box, h: Handle): Pt {
  const [hx, hy] = DIR[h];
  return toWorld(b, { x: (-hx * b.w) / 2, y: (-hy * b.h) / 2 });
}

/** The box of a size whose anchor (the handle opposite `h`) is at `anchor`, turned as `start` is. */
function placeFromAnchor(start: Box, h: Handle, anchor: Pt, w: number, hh: number): Box {
  const [hx, hy] = DIR[h];
  const a = rad(start.rotation);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const ox = (hx * w) / 2;
  const oy = (hy * hh) / 2;
  const cx = anchor.x + ox * cos - oy * sin;
  const cy = anchor.y + ox * sin + oy * cos;
  return { x: cx - w / 2, y: cy - hh / 2, w, h: hh, rotation: start.rotation };
}

/** The new width and height when the handle is taken to `to` on the frame, before rounding. */
function sizeFor(start: Box, h: Handle, to: Pt, keepRatio: boolean, min: number): { w: number; h: number } {
  const [hx, hy] = DIR[h];
  const anchor = anchorOf(start, h);
  const a = rad(start.rotation);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = to.x - anchor.x;
  const dy = to.y - anchor.y;
  // How far the handle is from the anchor along the box's own sides.
  const along = dx * cos + dy * sin;
  const across = -dx * sin + dy * cos;
  let w = hx ? hx * along : start.w;
  let hh = hy ? hy * across : start.h;
  if (keepRatio && hx && hy) {
    const s = Math.max(w / start.w, hh / start.h, min / start.w, min / start.h);
    return { w: start.w * s, h: start.h * s };
  }
  if (hx) w = Math.max(min, w);
  if (hy) hh = Math.max(min, hh);
  return { w, h: hh };
}

/**
 * The box after its handle `h` is dragged to `to` (on the frame): the handle opposite stays
 * where it was, a corner keeps the width to height as it was when `keepRatio`, and neither
 * side goes under `min`. Sizes are whole pixels; the anchor moves by under a pixel at most.
 */
export function resizeBox(start: Box, h: Handle, to: Pt, keepRatio: boolean, min = MIN_SIZE): Box {
  const s = sizeFor(start, h, to, keepRatio, min);
  const [hx, hy] = DIR[h];
  const w = hx ? Math.max(min, Math.round(s.w)) : start.w;
  const hh = hy ? Math.max(min, Math.round(s.h)) : start.h;
  return roundXY(placeFromAnchor(start, h, anchorOf(start, h), w, hh));
}

/** To a hundredth of a pixel: exact enough to sit on a guide, without a float's noise in the saved document. */
const hundredths = (n: number): number => Math.round(n * 100) / 100;
const roundXY = (b: Box): Box => ({ ...b, x: hundredths(b.x), y: hundredths(b.y) });

/* ---- snapping ---- */

export interface SnapTargets {
  x: number[];
  y: number[];
}
export interface Guides {
  x: number[];
  y: number[];
}
export const NO_GUIDES: Guides = { x: [], y: [] };

/**
 * Where a moving layer catches: the frame's edges and centre lines, a safe margin of 5% of its
 * short side, the bands a platform covers with its own interface, and every other layer that
 * can be seen — its sides and its middle.
 */
export function snapTargets(doc: CreativeDoc, movingId: string, format?: Pick<CreativeFormat, 'safeTop' | 'safeBottom'>): SnapTargets {
  const W = doc.width;
  const H = doc.height;
  const m = Math.round(Math.min(W, H) * 0.05);
  const x = [0, m, W / 2, W - m, W];
  const y = [0, m, H / 2, H - m, H];
  if (format?.safeTop) y.push(Math.round(H * format.safeTop));
  if (format?.safeBottom) y.push(H - Math.round(H * format.safeBottom));
  for (const l of doc.layers) {
    if (l.id === movingId || l.hidden || l.opacity <= 0) continue;
    const b = layerBounds(l);
    x.push(b.x, b.x + b.w / 2, b.x + b.w);
    y.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { x, y };
}

/** The smallest shift that puts one of `values` on one of `targets`, if one is within `reach`. */
function nearestShift(values: number[], targets: number[], reach: number): number | null {
  let best: number | null = null;
  for (const v of values) {
    for (const t of targets) {
      const d = t - v;
      if (Math.abs(d) <= reach && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best;
}

/** The targets that `values` sit on, each once. */
function linesAt(values: number[], targets: number[]): number[] {
  const out: number[] = [];
  for (const t of targets) {
    if (values.some((v) => Math.abs(v - t) < 0.51) && !out.some((o) => Math.abs(o - t) < 0.01)) out.push(t);
  }
  return out;
}

const spanX = (b: { x: number; w: number }): number[] => [b.x, b.x + b.w / 2, b.x + b.w];
const spanY = (b: { y: number; h: number }): number[] => [b.y, b.y + b.h / 2, b.y + b.h];

/**
 * A box moved by dx, dy — caught by the nearest target within `reach` on each axis it moves on.
 * `axis` holds it to one axis (Shift); `targets` null lets it move freely (Alt).
 * Positions are whole pixels unless a target caught them.
 */
export function snapMove(start: Box, dx: number, dy: number, targets: SnapTargets | null, reach: number, axis: 'x' | 'y' | null = null): { x: number; y: number; guides: Guides } {
  let x = start.x + (axis === 'y' ? 0 : dx);
  let y = start.y + (axis === 'x' ? 0 : dy);
  if (!targets) return { x: Math.round(x), y: Math.round(y), guides: NO_GUIDES };
  const b = layerBounds({ ...start, x, y });
  const sx = axis === 'y' ? null : nearestShift(spanX(b), targets.x, reach);
  const sy = axis === 'x' ? null : nearestShift(spanY(b), targets.y, reach);
  x = sx === null ? Math.round(x) : hundredths(x + sx);
  y = sy === null ? Math.round(y) : hundredths(y + sy);
  const moved = layerBounds({ ...start, x, y });
  return {
    x,
    y,
    guides: { x: sx === null ? [] : linesAt(spanX(moved), targets.x), y: sy === null ? [] : linesAt(spanY(moved), targets.y) },
  };
}

/**
 * A resize with the moving sides caught by the targets. Only a box turned a whole number of
 * quarter turns has sides that run along the frame, so a box turned any other way is not caught.
 */
export function snapResize(
  start: Box,
  h: Handle,
  to: Pt,
  keepRatio: boolean,
  targets: SnapTargets | null,
  reach: number,
  min = MIN_SIZE,
): { box: Box; guides: Guides } {
  const free = resizeBox(start, h, to, keepRatio, min);
  const turn = ((start.rotation % 360) + 360) % 360;
  const quarter = Math.round(turn / 90);
  if (!targets || Math.abs(turn - quarter * 90) > 0.01) return { box: free, guides: NO_GUIDES };
  // A quarter or three-quarter turn: the box's own width runs down the frame.
  const swap = quarter % 2 === 1;
  const [hx, hy] = DIR[h];
  const anchor = anchorOf(start, h);
  const b = layerBounds(free);
  const movesX = swap ? hy !== 0 : hx !== 0;
  const movesY = swap ? hx !== 0 : hy !== 0;
  // The side that moves on each axis is the one away from the anchor.
  const edgeX = movesX ? (Math.abs(b.x - anchor.x) > Math.abs(b.x + b.w - anchor.x) ? b.x : b.x + b.w) : null;
  const edgeY = movesY ? (Math.abs(b.y - anchor.y) > Math.abs(b.y + b.h - anchor.y) ? b.y : b.y + b.h) : null;
  const catchOn = (edge: number | null, from: number, list: number[]): number | null => {
    if (edge === null) return null;
    let best: number | null = null;
    for (const t of list) {
      // Only a target on the moving side of the anchor, or the box would have to turn inside out.
      if (Math.sign(t - from) !== Math.sign(edge - from) || Math.abs(t - from) < min) continue;
      if (Math.abs(t - edge) <= reach && (best === null || Math.abs(t - edge) < Math.abs(best - edge))) best = t;
    }
    return best;
  };
  const tx = catchOn(edgeX, anchor.x, targets.x);
  const ty = catchOn(edgeY, anchor.y, targets.y);
  if (tx === null && ty === null) return { box: free, guides: NO_GUIDES };

  // Extents along the frame's axes, as the box's own width and height.
  const extX = tx === null ? null : Math.abs(tx - anchor.x);
  const extY = ty === null ? null : Math.abs(ty - anchor.y);
  let w = free.w;
  let hh = free.h;
  if (keepRatio && hx && hy) {
    // One catch sets the scale; the other side follows the ratio.
    const useX = extX !== null && (extY === null || Math.abs(tx! - edgeX!) <= Math.abs(ty! - edgeY!));
    const ext = useX ? extX! : extY!;
    const alongWidth = useX ? !swap : swap;
    const s = Math.max(ext / (alongWidth ? start.w : start.h), min / start.w, min / start.h);
    w = start.w * s;
    hh = start.h * s;
  } else {
    if (extX !== null) {
      if (swap) hh = extX;
      else w = extX;
    }
    if (extY !== null) {
      if (swap) w = extY;
      else hh = extY;
    }
  }
  const box = roundXY(placeFromAnchor(start, h, anchor, hundredths(Math.max(min, w)), hundredths(Math.max(min, hh))));
  const nb = layerBounds(box);
  const movingX = edgeX === null ? [] : [Math.abs(nb.x - anchor.x) > Math.abs(nb.x + nb.w - anchor.x) ? nb.x : nb.x + nb.w];
  const movingY = edgeY === null ? [] : [Math.abs(nb.y - anchor.y) > Math.abs(nb.y + nb.h - anchor.y) ? nb.y : nb.y + nb.h];
  return { box, guides: { x: linesAt(movingX, targets.x), y: linesAt(movingY, targets.y) } };
}

/* ---- turning ---- */

/** An angle as the editor keeps it: -180 (exclusive) to 180, to a tenth of a degree. */
export function normaliseAngle(deg: number): number {
  let d = ((deg % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return Math.round(d * 10) / 10 || 0;
}

/** The box's rotation after the pointer goes from `from` to `to` about its centre; `step` snaps it to 15°. */
export function rotateBox(start: Box, from: Pt, to: Pt, step: boolean): number {
  const c = centreOf(start);
  const a0 = Math.atan2(from.y - c.y, from.x - c.x);
  const a1 = Math.atan2(to.y - c.y, to.x - c.x);
  let deg = start.rotation + ((a1 - a0) * 180) / Math.PI;
  if (step) deg = Math.round(deg / 15) * 15;
  return normaliseAngle(deg);
}

/* ---- the pointer ---- */

const CURSOR_ANGLE: Record<Handle, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
const CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const;
/** The resize cursor for a handle, pointing the way the handle faces once the box has turned. */
export function handleCursor(h: Handle, rotation: number): string {
  const a = (((CURSOR_ANGLE[h] + rotation) % 180) + 180) % 180;
  return CURSORS[Math.round(a / 45) % 4]!;
}

/** Whether a point is on the frame. */
export const onFrame = (doc: Pick<CreativeDoc, 'width' | 'height'>, p: Pt): boolean => p.x >= 0 && p.y >= 0 && p.x <= doc.width && p.y <= doc.height;

/** The topmost layer under a point on the frame that can be seen and is not locked. */
export function layerAt(doc: CreativeDoc, p: Pt): CreativeLayer | null {
  if (!onFrame(doc, p)) return null;
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i]!;
    if (l.hidden || l.locked || l.opacity <= 0) continue;
    if (layerHit(l, p.x, p.y)) return l;
  }
  return null;
}

/**
 * A position that keeps some of the layer on the frame, so a layer dragged away can still be
 * seen and taken hold of again — the rule the video editor's layers follow too.
 */
export function keepOnFrame(b: Box, W: number, H: number, sliver = 16): { x: number; y: number } {
  const bb = layerBounds(b);
  const kx = Math.min(sliver, bb.w);
  const ky = Math.min(sliver, bb.h);
  let dx = 0;
  let dy = 0;
  if (bb.x + bb.w < kx) dx = kx - (bb.x + bb.w);
  else if (bb.x > W - kx) dx = W - kx - bb.x;
  if (bb.y + bb.h < ky) dy = ky - (bb.y + bb.h);
  else if (bb.y > H - ky) dy = H - ky - bb.y;
  return { x: b.x + dx, y: b.y + dy };
}
