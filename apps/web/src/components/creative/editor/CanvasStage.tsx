import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { CREATIVE_FORMAT_BY_ID, layerCorners, layerHit, updateLayer, type CreativeDoc, type CreativeLayer } from '@ava/shared';
import { filesFrom } from '../../ui.js';
import { drawCreative, drawLayer } from '../render.js';
import {
  HANDLES,
  NO_GUIDES,
  boxOf,
  handleCursor,
  handlePoint,
  isCorner,
  keepOnFrame,
  layerAt,
  rotateBox,
  rotateHandlePoint,
  snapMove,
  snapResize,
  snapTargets,
  type Box,
  type Guides,
  type Handle,
  type Pt,
  type SnapTargets,
} from './geometry.js';
import { useCreativeAssets } from './useCreativeAssets.js';

/**
 * The stage: the creative drawn by the one renderer on a canvas, with the selection drawn over
 * it in SVG — so the handles stay sharp at any zoom and never end up in a downloaded file.
 */

export interface StageApi {
  fit(): void;
  zoomIn(): void;
  zoomOut(): void;
  /** 100%: one frame pixel to one screen pixel. */
  actualSize(): void;
  focus(): void;
  /** A layer is being dragged, resized or turned: the keyboard leaves the document alone until it is let go. */
  dragging(): boolean;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const ZOOM_STEPS = [0.05, 0.1, 0.125, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];
/** Room left around the frame, in screen pixels. */
const PAD = 28;
/** The most pixels the canvas holds — what a phone's browser allows one canvas. Past it, a zoomed-in frame is drawn a little softer. */
const MAX_CANVAS_PIXELS = 4096 * 4096;
/** Past this a drag redraws the whole frame, rather than keep two more canvases this size. */
const MAX_CACHED_PIXELS = 3000 * 3000;
/** How close, in screen pixels, a moving edge comes before it catches. */
const SNAP_PX = 6;
const ROTATE_GAP_PX = 26;
const HANDLE_PX = 9;
const HIT_PX = 18;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g fill='none' stroke-linecap='round' stroke-linejoin='round'>" +
    "<path d='M18.5 12a6.5 6.5 0 1 1-2-4.7' stroke='#fff' stroke-width='4'/><path d='M17 3.5v4h-4' stroke='#fff' stroke-width='4'/>" +
    "<path d='M18.5 12a6.5 6.5 0 1 1-2-4.7' stroke='#111' stroke-width='1.6'/><path d='M17 3.5v4h-4' stroke='#111' stroke-width='1.6'/></g></svg>",
)}") 12 12, crosshair`;

/* ---- gestures ---- */

interface GestureBase {
  pointerId: number;
  /** Where the pointer went down, on the screen. */
  x0: number;
  y0: number;
  moved: boolean;
}
interface LayerGesture extends GestureBase {
  id: string;
  /** The document when the gesture began: the whole gesture is one step back to it. */
  before: CreativeDoc;
  start: Box;
  /** Where the pointer went down, on the frame. */
  p0: Pt;
  targets?: SnapTargets;
}
type Gesture =
  | (GestureBase & { mode: 'pan'; sl: number; st: number; deselect: boolean })
  /** A press on a layer, which becomes a move once the pointer travels. A plain click inside the selected layer picks the layer on top there instead. */
  | (LayerGesture & { mode: 'press' | 'move'; clickTo: string | null })
  | (LayerGesture & { mode: 'resize'; handle: Handle; grab: Pt })
  | (LayerGesture & { mode: 'rotate' });

/** A key held for panning is ignored while a control that uses it has the focus. */
const usesSpace = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || t.closest('input, textarea, select, button, a[href], summary, [role="button"], [role="switch"]') !== null);

interface Props {
  doc: CreativeDoc;
  /** The document as it is this moment, which may be ahead of the last render. */
  getDoc: () => CreativeDoc;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** A gesture in progress: drawn, not yet a step of history. */
  onLive: (next: CreativeDoc) => void;
  /** A gesture finished: one step of history, back to the document as it was when it began. */
  onCommit: (next: CreativeDoc, before: CreativeDoc) => void;
  /** Double-click on words. */
  onEditText: (id: string) => void;
  /** Files dropped on the stage. */
  onFiles: (files: File[]) => void;
  onZoom: (zoom: number) => void;
  onPictureError: (src: string) => void;
}

export const CanvasStage = forwardRef<StageApi, Props>(function CanvasStage(props, ref) {
  const { doc, selectedId } = props;
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { ready, images, fontsReady } = useCreativeAssets(doc, props.onPictureError);

  /* ---- zoom, and the room around the frame ---- */

  const [view, setView] = useState({ w: 0, h: 0 });
  const viewRef = useRef(view);
  const [zoom, setZoomState] = useState(0);
  const zoomRef = useRef(0);
  /** Fitted to the stage until zoomed by hand: a resized window fits again. */
  const autoFit = useRef(true);
  /** After a zoom, the frame point to keep under the pointer (or the middle of the stage). */
  const pendingScroll = useRef<{ fx: number; fy: number; ax: number; ay: number } | null>(null);
  const onZoom = useRef(props.onZoom);
  onZoom.current = props.onZoom;

  const layoutAt = (z: number, v: { w: number; h: number } = viewRef.current) => {
    const fw = doc.width * z;
    const fh = doc.height * z;
    // Within half a pixel counts as fitting, so a fitted frame never brings up a scroll bar.
    const cw = fw + PAD * 2 <= v.w + 0.5 ? v.w : Math.ceil(fw + PAD * 2);
    const ch = fh + PAD * 2 <= v.h + 0.5 ? v.h : Math.ceil(fh + PAD * 2);
    return { fw, fh, cw, ch, ox: Math.round((cw - fw) / 2), oy: Math.round((ch - fh) / 2) };
  };
  const fitZoom = (v = viewRef.current): number => clamp(Math.min((v.w - PAD * 2) / doc.width, (v.h - PAD * 2) / doc.height), MIN_ZOOM, MAX_ZOOM);
  const applyZoom = (z: number): void => {
    zoomRef.current = z;
    setZoomState(z);
    onZoom.current(z);
  };
  const zoomTo = (next: number, anchor?: { clientX: number; clientY: number }): void => {
    const el = stageRef.current;
    const z0 = zoomRef.current;
    if (!el || !z0) return;
    const z = clamp(next, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(z - z0) < 1e-4) return;
    const r = el.getBoundingClientRect();
    const ax = anchor ? anchor.clientX - r.left - el.clientLeft : el.clientWidth / 2;
    const ay = anchor ? anchor.clientY - r.top - el.clientTop : el.clientHeight / 2;
    // Several wheel turns can arrive before the stage is drawn again: carry on from the last one.
    const prev = pendingScroll.current;
    const cur = layoutAt(z0);
    const fx = prev ? prev.fx + (ax - prev.ax) / z0 : (el.scrollLeft + ax - cur.ox) / z0;
    const fy = prev ? prev.fy + (ay - prev.ay) / z0 : (el.scrollTop + ay - cur.oy) / z0;
    pendingScroll.current = { fx, fy, ax, ay };
    autoFit.current = false;
    applyZoom(z);
  };
  const fit = (): void => {
    autoFit.current = true;
    pendingScroll.current = null;
    applyZoom(fitZoom());
  };

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = (): void => {
      // clientWidth and clientHeight are rounded, and rounded up they would make a fitted frame scroll by half a pixel.
      const r = el.getBoundingClientRect();
      const v = { w: Math.floor(r.width - (el.offsetWidth - el.clientWidth)), h: Math.floor(r.height - (el.offsetHeight - el.clientHeight)) };
      if (v.w === viewRef.current.w && v.h === viewRef.current.h) return;
      viewRef.current = v;
      setView(v);
      if (autoFit.current || !zoomRef.current) applyZoom(fitZoom(v));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // Measured once; the observer reports every change after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const p = pendingScroll.current;
    const el = stageRef.current;
    if (!p || !el || !zoom) return;
    pendingScroll.current = null;
    const L = layoutAt(zoom);
    el.scrollLeft = p.fx * zoom + L.ox - p.ax;
    el.scrollTop = p.fy * zoom + L.oy - p.ay;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // Ctrl or ⌘ with the wheel (and a trackpad pinch, which arrives as one) zooms about the pointer.
  const wheelZoom = useRef<(e: WheelEvent) => void>(() => {});
  wheelZoom.current = (e) => {
    const el = stageRef.current;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * (el?.clientHeight ?? 800) : e.deltaY;
    zoomTo(zoomRef.current * Math.exp(-dy * 0.0025), e);
  };
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      wheelZoom.current(e);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useImperativeHandle(ref, () => ({
    fit,
    zoomIn: () => zoomTo(ZOOM_STEPS.find((s) => s > zoomRef.current * 1.001) ?? MAX_ZOOM),
    zoomOut: () => zoomTo([...ZOOM_STEPS].reverse().find((s) => s < zoomRef.current / 1.001) ?? MIN_ZOOM),
    actualSize: () => zoomTo(1),
    focus: () => stageRef.current?.focus({ preventScroll: true }),
    dragging: () => Boolean(gesture.current && gesture.current.mode !== 'pan'),
  }));

  /* ---- Space held: the pointer pans ---- */

  const spaceRef = useRef(false);
  const [spaceDown, setSpaceDown] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || usesSpace(e.target)) return;
      e.preventDefault();
      if (!spaceRef.current) {
        spaceRef.current = true;
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || !spaceRef.current) return;
      spaceRef.current = false;
      setSpaceDown(false);
    };
    const reset = (): void => {
      spaceRef.current = false;
      setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, []);

  /* ---- drawing ---- */

  const L = layoutAt(zoom || 1, view);
  const dpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const density = Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, L.fw * L.fh)));
  const scale = (zoom || 1) * density;
  const pxW = Math.max(1, Math.round(doc.width * scale));
  const pxH = Math.max(1, Math.round(doc.height * scale));

  const gesture = useRef<Gesture | null>(null);
  /**
   * While one layer is dragged, the layers under it and over it are drawn once each and kept;
   * every step of the drag draws those two and the one layer between them.
   */
  const cache = useRef<null | {
    id: string;
    scale: number;
    images: Map<string, HTMLImageElement>;
    bg: string;
    others: CreativeLayer[];
    below: HTMLCanvasElement;
    above: HTMLCanvasElement;
  }>(null);
  const dropCache = (): void => {
    const c = cache.current;
    if (!c) return;
    // Emptied at once, rather than holding their memory until they are collected.
    c.below.width = c.below.height = 0;
    c.above.width = c.above.height = 0;
    cache.current = null;
  };
  useEffect(() => dropCache, []);

  const paintAround = (ctx: CanvasRenderingContext2D, id: string): boolean => {
    const i = doc.layers.findIndex((l) => l.id === id);
    if (i < 0) return false;
    const others = doc.layers.filter((_, j) => j !== i);
    let c = cache.current;
    const stale =
      !c ||
      c.id !== id ||
      c.scale !== scale ||
      c.images !== images ||
      c.bg !== doc.background ||
      c.below.width !== pxW ||
      c.below.height !== pxH ||
      c.others.length !== others.length ||
      c.others.some((l, j) => l !== others[j]);
    if (stale) {
      dropCache();
      const below = document.createElement('canvas');
      const above = document.createElement('canvas');
      below.width = above.width = pxW;
      below.height = above.height = pxH;
      const bctx = below.getContext('2d');
      const actx = above.getContext('2d');
      if (!bctx || !actx) return false;
      drawCreative(bctx, { ...doc, layers: doc.layers.slice(0, i) }, { scale, images });
      drawCreative(actx, { ...doc, background: 'rgba(0,0,0,0)', layers: doc.layers.slice(i + 1) }, { scale, images });
      c = cache.current = { id, scale, images, bg: doc.background, others, below, above };
    }
    ctx.drawImage(c!.below, 0, 0);
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawLayer(ctx, doc.layers[i]!, { scale, images });
    ctx.restore();
    ctx.drawImage(c!.above, 0, 0);
    return true;
  };

  // Drawn in the same frame as the selection box, so the two never drift apart during a drag.
  useLayoutEffect(() => {
    if (!ready || !fontsReady || !zoom) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pxW, pxH);
    const g = gesture.current;
    const moving = g && g.mode !== 'pan' && g.moved ? g.id : null;
    if (moving && pxW * pxH <= MAX_CACHED_PIXELS && paintAround(ctx, moving)) return;
    dropCache();
    drawCreative(ctx, doc, { scale, images });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, ready, fontsReady, images, zoom, scale, pxW, pxH]);

  /* ---- the pointer ---- */

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [guides, setGuides] = useState<Guides>(NO_GUIDES);
  const [hud, setHud] = useState<string | null>(null);
  const [gestureCursor, setGestureCursor] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [dropping, setDropping] = useState(false);

  /** A point on the screen as a point on the frame. */
  const framePoint = (clientX: number, clientY: number): Pt => {
    const r = frameRef.current?.getBoundingClientRect();
    if (!r || !r.width) return { x: Number.NaN, y: Number.NaN };
    const k = r.width / doc.width;
    return { x: (clientX - r.left) / k, y: (clientY - r.top) / k };
  };
  const editableSelection = (d: CreativeDoc): CreativeLayer | null => {
    const sel = selectedId ? d.layers.find((l) => l.id === selectedId) : undefined;
    return sel && !sel.locked && !sel.hidden ? sel : null;
  };
  /** What a press at a point would take hold of: the selected layer anywhere in its box, else the topmost layer there. */
  const grabbable = (d: CreativeDoc, p: Pt): CreativeLayer | null => {
    const sel = editableSelection(d);
    return sel && layerHit(sel, p.x, p.y) ? sel : layerAt(d, p);
  };
  const capture = (el: Element, pointerId: number): void => {
    try {
      el.setPointerCapture(pointerId);
    } catch {
      /* the pointer has already gone: the gesture ends on its own */
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!zoom) return;
    if (gesture.current) {
      // A second finger is not a second gesture; the same pointer pressing again means its release was lost.
      if (gesture.current.pointerId !== e.pointerId) return;
      finish(e.currentTarget, false);
    }
    // The middle button would otherwise start the browser's own scrolling.
    if (e.button === 1) e.preventDefault();
    // A field being typed in keeps what was typed before anything moves. The stage then takes the
    // focus from the click itself, as a click gives it, so it is not lit up as keyboard focus is.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== stageRef.current) active.blur();
    const el = e.currentTarget;
    const stage = stageRef.current!;
    const base = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false };
    const startPan = (deselect: boolean): void => {
      gesture.current = { ...base, mode: 'pan', sl: stage.scrollLeft, st: stage.scrollTop, deselect };
      setPanning(true);
      capture(el, e.pointerId);
    };
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) return startPan(false);
    if (e.button !== 0) return;

    const d = props.getDoc();
    const p = framePoint(e.clientX, e.clientY);
    const sel = editableSelection(d);
    const handle = (e.target as Element).closest?.('[data-handle]')?.getAttribute('data-handle') ?? null;
    if (sel && handle) {
      const start = boxOf(sel);
      if (handle === 'rotate') {
        gesture.current = { ...base, mode: 'rotate', id: sel.id, before: d, start, p0: p };
        setGestureCursor(ROTATE_CURSOR);
      } else {
        const h = handle as Handle;
        const hp = handlePoint(start, h);
        gesture.current = { ...base, mode: 'resize', id: sel.id, before: d, start, p0: p, handle: h, grab: { x: p.x - hp.x, y: p.y - hp.y } };
        setGestureCursor(handleCursor(h, sel.rotation));
      }
      capture(el, e.pointerId);
      return;
    }
    const top = layerAt(d, p);
    if (sel && layerHit(sel, p.x, p.y)) {
      gesture.current = { ...base, mode: 'press', id: sel.id, before: d, start: boxOf(sel), p0: p, clickTo: top?.id ?? null };
    } else if (top) {
      props.onSelect(top.id);
      gesture.current = { ...base, mode: 'press', id: top.id, before: d, start: boxOf(top), p0: p, clickTo: null };
    } else if (e.pointerType === 'touch') {
      // A finger on empty space moves the view; a tap there still clears the selection.
      return startPan(true);
    } else {
      props.onSelect(null);
      return;
    }
    setGestureCursor('move');
    capture(el, e.pointerId);
  };

  const finish = (el: Element | null, clicked: boolean): void => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (el?.hasPointerCapture(g.pointerId)) {
      try {
        el.releasePointerCapture(g.pointerId);
      } catch {
        /* already released */
      }
    }
    setGuides(NO_GUIDES);
    setHud(null);
    setGestureCursor(null);
    setPanning(false);
    dropCache();
    if (g.mode === 'pan') {
      if (clicked && !g.moved && g.deselect) props.onSelect(null);
      return;
    }
    if (!g.moved) {
      if (clicked && g.mode === 'press' && g.clickTo && g.clickTo !== g.id) props.onSelect(g.clickTo);
      return;
    }
    const now = props.getDoc();
    if (now !== g.before) props.onCommit(now, g.before);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const g = gesture.current;
    if (!g) {
      const p = framePoint(e.clientX, e.clientY);
      setHoverId(Number.isNaN(p.x) ? null : (grabbable(props.getDoc(), p)?.id ?? null));
      return;
    }
    if (e.pointerId !== g.pointerId) return;
    // The button came up somewhere the stage never heard about: the gesture is over.
    if (e.buttons === 0) return finish(e.currentTarget, false);
    const travelled = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
    if (g.mode === 'pan') {
      if (travelled > 3) g.moved = true;
      const stage = stageRef.current;
      if (stage) {
        stage.scrollLeft = g.sl - (e.clientX - g.x0);
        stage.scrollTop = g.st - (e.clientY - g.y0);
      }
      return;
    }
    if (!g.moved) {
      if (travelled < 3) return;
      g.moved = true;
      if (g.mode === 'press') g.mode = 'move';
    }
    const layer = g.before.layers.find((l) => l.id === g.id);
    if (!layer) return;
    const p = framePoint(e.clientX, e.clientY);
    if (Number.isNaN(p.x)) return;
    const reach = SNAP_PX / (zoomRef.current || 1);
    const targets = e.altKey ? null : (g.targets ??= snapTargets(g.before, g.id, CREATIVE_FORMAT_BY_ID[g.before.format]));
    let patch: Partial<CreativeLayer>;
    let caught: Guides = NO_GUIDES;
    if (g.mode === 'resize') {
      // Pictures keep their shape unless Shift frees them; everything else keeps it only with Shift.
      const keepRatio = isCorner(g.handle) && (layer.kind === 'image' ? !e.shiftKey : e.shiftKey);
      const r = snapResize(g.start, g.handle, { x: p.x - g.grab.x, y: p.y - g.grab.y }, keepRatio, targets, reach);
      patch = { x: r.box.x, y: r.box.y, w: r.box.w, h: r.box.h };
      caught = r.guides;
      setHud(`${Math.round(r.box.w)} × ${Math.round(r.box.h)}`);
    } else if (g.mode === 'rotate') {
      const rotation = rotateBox(g.start, g.p0, p, e.shiftKey);
      patch = { rotation };
      setHud(`${rotation}°`);
    } else {
      const dx = p.x - g.p0.x;
      const dy = p.y - g.p0.y;
      const axis = e.shiftKey ? (Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y') : null;
      const r = snapMove(g.start, dx, dy, targets, reach, axis);
      const kept = keepOnFrame({ ...g.start, x: r.x, y: r.y }, g.before.width, g.before.height);
      patch = { x: kept.x, y: kept.y };
      if (kept.x === r.x && kept.y === r.y) caught = r.guides;
      setHud(`X ${Math.round(kept.x)}  Y ${Math.round(kept.y)}`);
    }
    setGuides(caught);
    props.onLive(updateLayer(g.before, g.id, patch));
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if ((e.target as Element).closest?.('[data-handle]')) return;
    const d = props.getDoc();
    const p = framePoint(e.clientX, e.clientY);
    if (Number.isNaN(p.x)) return;
    const sel = editableSelection(d);
    const target = sel?.kind === 'text' && layerHit(sel, p.x, p.y) ? sel : layerAt(d, p);
    if (target?.kind === 'text') props.onEditText(target.id);
  };

  /* ---- the selection, drawn over the canvas ---- */

  const z = zoom || 1;
  const toScreen = (p: Pt): Pt => ({ x: L.ox + p.x * z, y: L.oy + p.y * z });
  const points = (l: CreativeLayer): string =>
    layerCorners(l)
      .map(toScreen)
      .map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`)
      .join(' ');
  const sel = selectedId ? (doc.layers.find((l) => l.id === selectedId) ?? null) : null;
  const hover = hoverId && hoverId !== selectedId && !gesture.current ? (doc.layers.find((l) => l.id === hoverId) ?? null) : null;
  const editable = Boolean(sel && !sel.locked && !sel.hidden);

  let handles: Handle[] = [];
  let hudAt: Pt | null = null;
  if (sel) {
    const sw = sel.w * z;
    const sh = sel.h * z;
    // Handles that would sit on top of each other on a small or thin box are left out.
    handles = HANDLES.filter((h) => {
      if (sw < 20 && sh < 20) return h === 'se';
      if (sh < 20) return h === 'e' || h === 'w';
      if (sw < 20) return h === 'n' || h === 's';
      if ((h === 'n' || h === 's') && sw < 44) return false;
      if ((h === 'e' || h === 'w') && sh < 44) return false;
      return true;
    });
    const ys = layerCorners(sel).map((q) => q.y);
    const xs = layerCorners(sel).map((q) => q.x);
    hudAt = toScreen({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.max(...ys) });
  }
  const selBox = sel ? boxOf(sel) : null;
  const rot = selBox ? toScreen(rotateHandlePoint(selBox, ROTATE_GAP_PX / z)) : null;
  const topMid = selBox ? toScreen(rotateHandlePoint(selBox, 0)) : null;

  const cursor = spaceDown || panning ? (panning ? 'grabbing' : 'grab') : (gestureCursor ?? (hoverId ? 'move' : 'default'));

  const ours = (pointerId: number): boolean => gesture.current?.pointerId === pointerId;

  return (
    <div
      className={`ce-stage-wrap${dropping ? ' ce-dropping' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!dropping) setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        setDropping(false);
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        props.onFiles(filesFrom(e.dataTransfer, 'image/*'));
      }}
    >
      <div
        className="ce-stage"
        ref={stageRef}
        tabIndex={0}
        role="group"
        aria-label="Canvas. Click a layer to select it and drag to move it; the arrow keys nudge it."
      >
        <div
          className="ce-sheet"
          style={{ width: L.cw, height: L.ch, cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => {
            if (ours(e.pointerId)) finish(e.currentTarget, true);
          }}
          onPointerCancel={(e) => {
            if (ours(e.pointerId)) finish(e.currentTarget, false);
          }}
          onLostPointerCapture={(e) => {
            if (ours(e.pointerId)) finish(e.currentTarget, false);
          }}
          onPointerLeave={() => {
            if (!gesture.current) setHoverId(null);
          }}
          onMouseDown={(e) => {
            if (e.button === 1) e.preventDefault();
          }}
          onDoubleClick={onDoubleClick}
        >
          {zoom > 0 && (
            <div
              className={`ce-frame${ready ? '' : ' ce-waiting'}`}
              ref={frameRef}
              style={{ left: L.ox, top: L.oy, width: L.fw, height: L.fh, ...(ready ? {} : { background: doc.background }) }}
            >
              <canvas ref={canvasRef} className="ce-canvas" role="img" aria-label={`The creative, ${doc.width} × ${doc.height} pixels`} />
            </div>
          )}
          {zoom > 0 && (
            <svg className="ce-overlay" width={L.cw} height={L.ch} aria-hidden="true">
              {hover && !hover.hidden && <polygon className="ce-hover" points={points(hover)} />}
              {sel && (
                <g className={`ce-sel${editable ? '' : ' ce-still'}`}>
                  <polygon className="ce-sel-under" points={points(sel)} />
                  <polygon className="ce-sel-line" points={points(sel)} />
                  {editable && rot && topMid && (
                    <>
                      <line className="ce-rot-stem" x1={topMid.x} y1={topMid.y} x2={rot.x} y2={rot.y} />
                      <g data-handle="rotate" transform={`translate(${rot.x} ${rot.y})`} style={{ cursor: ROTATE_CURSOR }}>
                        <circle className="ce-handle-hit" r={HIT_PX / 2 + 1} />
                        <circle className="ce-rot" r={5.5} />
                      </g>
                    </>
                  )}
                  {editable &&
                    selBox &&
                    handles.map((h) => {
                      const q = toScreen(handlePoint(selBox, h));
                      return (
                        <g key={h} data-handle={h} transform={`translate(${q.x} ${q.y}) rotate(${sel.rotation})`} style={{ cursor: handleCursor(h, sel.rotation) }}>
                          <rect className="ce-handle-hit" x={-HIT_PX / 2} y={-HIT_PX / 2} width={HIT_PX} height={HIT_PX} />
                          <rect className="ce-handle" x={-HANDLE_PX / 2} y={-HANDLE_PX / 2} width={HANDLE_PX} height={HANDLE_PX} rx={1.5} />
                        </g>
                      );
                    })}
                </g>
              )}
              {guides.x.map((x) => (
                <line key={`x${x}`} className="ce-guide" x1={L.ox + x * z} y1={L.oy - 14} x2={L.ox + x * z} y2={L.oy + L.fh + 14} />
              ))}
              {guides.y.map((y) => (
                <line key={`y${y}`} className="ce-guide" x1={L.ox - 14} y1={L.oy + y * z} x2={L.ox + L.fw + 14} y2={L.oy + y * z} />
              ))}
            </svg>
          )}
          {hud && hudAt && (
            <div className="ce-hud" style={{ left: hudAt.x, top: hudAt.y + 12 }}>
              {hud}
            </div>
          )}
        </div>
      </div>
      {!ready && <div className="ce-stage-note">Loading the fonts and pictures…</div>}
      {dropping && <div className="ce-drop-note">Drop to add the picture</div>}
    </div>
  );
});
