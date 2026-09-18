/**
 * The one renderer for social creatives.
 *
 * The cards on an image project, the editor's canvas and the file that downloads are all drawn
 * here, on a canvas, with the same fonts loaded first — so what is seen is exactly what is
 * exported. A creative's words are fitted into their boxes with the browser's own measurements:
 * they wrap, and shrink towards their smallest size before they would overflow.
 */
import {
  CREATIVE_FONTS,
  CREATIVE_FONT_BY_ID,
  INDIC_FALLBACK_FAMILIES,
  creativeFontStack,
  type CreativeDoc,
  type CreativeLayer,
  type ImageLayer,
  type ShapeLayer,
  type TextLayer,
} from '@ava/shared';

/* ---- fonts ---- */

let fontSheet: Promise<void> | null = null;
/** Adds the typefaces a creative can use, once per page. */
function ensureFontSheet(): Promise<void> {
  if (fontSheet) return fontSheet;
  fontSheet = new Promise<void>((resolve) => {
    if (typeof document === 'undefined') return resolve();
    const families = [
      ...CREATIVE_FONTS.filter((f) => f.id !== 'inter').map((f) => f.google),
      ...INDIC_FALLBACK_FAMILIES.map((n) => `${n.replace(/ /g, '+')}:wght@400;500;600;700;800`),
    ];
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join('&')}&display=swap`;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
    // Never hang a drawing on a stylesheet that does not come.
    setTimeout(resolve, 4000);
  });
  return fontSheet;
}

/** Each face asked for, as the promise of its arrival — a second caller waits for the same load. */
const faceLoads = new Map<string, Promise<unknown>>();
/**
 * Loads every face a creative's words are drawn in, at the weights they use, for the letters
 * they contain — so an Indian script's own face is fetched when its words need it.
 */
export async function loadCreativeFonts(doc: Pick<CreativeDoc, 'layers'>): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  await ensureFontSheet();
  const jobs: Promise<unknown>[] = [];
  for (const l of doc.layers) {
    if (l.kind !== 'text' || !l.text.trim()) continue;
    const face = CREATIVE_FONT_BY_ID[l.font] ?? CREATIVE_FONT_BY_ID.poppins!;
    const style = `${l.italic ? 'italic ' : ''}${l.weight} 32px`;
    for (const family of [face.family, 'Noto Sans', ...INDIC_FALLBACK_FAMILIES]) {
      const key = `${style}|${family}|${l.text}`;
      let load = faceLoads.get(key);
      if (!load) {
        load = document.fonts.load(`${style} "${family}"`, l.text).catch(() => []);
        faceLoads.set(key, load);
      }
      jobs.push(load);
    }
  }
  await Promise.all(jobs);
}


/* ---- pictures ---- */

const images = new Map<string, Promise<HTMLImageElement | null>>();
/** A picture for a canvas, fetched with CORS so the canvas can still be exported. */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  let p = images.get(src);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => {
        images.delete(src);
        resolve(null);
      };
      img.src = src;
    });
    images.set(src, p);
  }
  return p;
}

/** Every picture a creative draws, by address. */
export async function loadCreativeImages(doc: Pick<CreativeDoc, 'layers'>): Promise<Map<string, HTMLImageElement>> {
  const out = new Map<string, HTMLImageElement>();
  await Promise.all(
    doc.layers
      .filter((l): l is ImageLayer => l.kind === 'image')
      .map(async (l) => {
        const img = await loadImage(l.src);
        if (img) out.set(l.src, img);
      }),
  );
  return out;
}

/* ---- text fitting ---- */

export interface FittedText {
  size: number;
  lines: string[];
  lineHeight: number;
  width: number;
  height: number;
}
const fitCache = new Map<string, FittedText>();
// Words measured before a face arrived were measured in a stand-in; measure them again.
if (typeof document !== 'undefined' && 'fonts' in document) {
  document.fonts.addEventListener('loadingdone', () => fitCache.clear());
}

function fontOf(l: TextLayer, size: number): string {
  return `${l.italic ? 'italic ' : ''}${l.weight} ${size}px ${creativeFontStack(l.font)}`;
}
function setSpacing(ctx: CanvasRenderingContext2D, em: number, size: number): void {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${(em * size).toFixed(2)}px`;
}

/** Words broken into lines no wider than `width`; a word wider than the line is broken by letters. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/).filter((w) => w.length);
    let line = '';
    for (const w of words) {
      const next = line + w;
      if (!line || ctx.measureText(next.trimEnd()).width <= width) {
        line = next;
        continue;
      }
      out.push(line.trimEnd());
      line = /^\s+$/.test(w) ? '' : w;
      // A single word too wide for the line.
      while (line && ctx.measureText(line).width > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > width) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/**
 * The words of a text layer fitted into its box: the largest size, from its own down to its
 * smallest, at which they wrap within the width, keep within the lines allowed, and are no
 * taller than the box. Past the smallest size, the last line ends in an ellipsis.
 */
export function fitText(ctx: CanvasRenderingContext2D, l: TextLayer): FittedText {
  const text = l.caps ? l.text.toLocaleUpperCase('en-IN') : l.text;
  const key = JSON.stringify([text, l.font, l.weight, l.italic, l.size, l.minSize, l.w, l.h, l.lineHeight, l.letterSpacing, l.maxLines, l.pill?.padX, l.pill?.padY]);
  const hit = fitCache.get(key);
  if (hit) return hit;
  const padX = l.pill ? l.pill.padX : 0;
  const padY = l.pill ? l.pill.padY : 0;
  const width = Math.max(10, l.w - padX * 2);
  const height = Math.max(10, l.h - padY * 2);
  const min = Math.max(6, l.minSize ?? l.size * 0.5);
  let size = l.size;
  let lines: string[] = [];
  for (;;) {
    ctx.font = fontOf(l, size);
    setSpacing(ctx, l.letterSpacing, size);
    lines = wrap(ctx, text, width);
    const tall = lines.length * size * l.lineHeight;
    const tooMany = l.maxLines !== undefined && lines.length > l.maxLines;
    if ((!tooMany && tall <= height + size * 0.2) || size <= min) break;
    size = Math.max(min, Math.floor(size * 0.96));
  }
  const cap = Math.max(1, Math.min(l.maxLines ?? Infinity, Math.floor((height + size * 0.2) / (size * l.lineHeight))));
  if (lines.length > cap) {
    lines = lines.slice(0, cap);
    let last = lines[cap - 1]!;
    while (last.length > 1 && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    lines[cap - 1] = `${last.trimEnd()}…`;
  }
  const widest = Math.max(0, ...lines.map((s) => ctx.measureText(s).width));
  const fitted: FittedText = { size, lines, lineHeight: size * l.lineHeight, width: widest, height: lines.length * size * l.lineHeight };
  if (fitCache.size > 800) fitCache.clear();
  fitCache.set(key, fitted);
  return fitted;
}

/* ---- drawing ---- */

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 0° runs top to bottom; the angle turns that clockwise (270° runs left to right). */
function linear(ctx: CanvasRenderingContext2D, w: number, h: number, g: NonNullable<ShapeLayer['gradient']>): CanvasGradient {
  const a = (g.angle * Math.PI) / 180;
  const dx = -Math.sin(a);
  const dy = Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const grad = ctx.createLinearGradient(-dx * half, -dy * half, dx * half, dy * half);
  grad.addColorStop(0, g.from);
  grad.addColorStop(1, g.to);
  return grad;
}

function filterOf(adj: ImageLayer['adjust'], scale: number): string {
  if (!adj) return 'none';
  const parts: string[] = [];
  if (adj.brightness) parts.push(`brightness(${(100 + adj.brightness) / 100})`);
  if (adj.contrast) parts.push(`contrast(${(100 + adj.contrast) / 100})`);
  if (adj.saturation) parts.push(`saturate(${(100 + adj.saturation) / 100})`);
  if (adj.blur) parts.push(`blur(${(adj.blur * scale).toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

/** Where a picture lands in a box: cover crops about the focus, contain sits by it. */
function placement(img: HTMLImageElement, l: ImageLayer): { x: number; y: number; w: number; h: number } {
  const iw = img.naturalWidth || 1;
  const ih = img.naturalHeight || 1;
  const k = (l.fit === 'cover' ? Math.max(l.w / iw, l.h / ih) : Math.min(l.w / iw, l.h / ih)) * (l.zoom || 1);
  const w = iw * k;
  const h = ih * k;
  return { x: (l.w - w) * l.focusX - l.w / 2, y: (l.h - h) * l.focusY - l.h / 2, w, h };
}

function drawImageLayer(ctx: CanvasRenderingContext2D, l: ImageLayer, img: HTMLImageElement | undefined, scale: number): void {
  const bx = -l.w / 2;
  const by = -l.h / 2;
  ctx.save();
  if (l.radius) {
    roundRect(ctx, bx, by, l.w, l.h, l.radius);
    ctx.clip();
  } else {
    ctx.beginPath();
    ctx.rect(bx, by, l.w, l.h);
    ctx.clip();
  }
  if (!img) {
    ctx.fillStyle = 'rgba(127,127,127,0.25)';
    ctx.fillRect(bx, by, l.w, l.h);
    ctx.restore();
    return;
  }
  if (l.flipX) ctx.scale(-1, 1);
  if (l.backdrop === 'blur' && l.fit === 'contain') {
    const cover = placement(img, { ...l, fit: 'cover', zoom: 1.08, focusX: 0.5, focusY: 0.5 });
    ctx.filter = `blur(${(28 * scale).toFixed(1)}px) brightness(0.62) saturate(1.1)`;
    ctx.drawImage(img, cover.x, cover.y, cover.w, cover.h);
    ctx.filter = 'none';
  }
  const p = placement(img, l);
  ctx.filter = filterOf(l.adjust, scale);
  ctx.drawImage(img, p.x, p.y, p.w, p.h);
  ctx.filter = 'none';
  const warmth = l.adjust?.warmth ?? 0;
  if (warmth) {
    // Warmer or cooler: a soft-light wash of orange or blue over the picture itself.
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = warmth > 0 ? `rgba(255, 150, 40, ${Math.min(0.6, warmth / 160)})` : `rgba(40, 120, 255, ${Math.min(0.6, -warmth / 160)})`;
    ctx.fillRect(Math.max(bx, p.x), Math.max(by, p.y), Math.min(l.w, p.w), Math.min(l.h, p.h));
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

function drawShapeLayer(ctx: CanvasRenderingContext2D, l: ShapeLayer): void {
  const bx = -l.w / 2;
  const by = -l.h / 2;
  ctx.beginPath();
  if (l.shape === 'ellipse') ctx.ellipse(0, 0, l.w / 2, l.h / 2, 0, 0, Math.PI * 2);
  else if (l.radius) roundRect(ctx, bx, by, l.w, l.h, l.radius);
  else ctx.rect(bx, by, l.w, l.h);
  const fill = l.gradient ? linear(ctx, l.w, l.h, l.gradient) : l.fill;
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (l.stroke && l.stroke.width > 0) {
    ctx.strokeStyle = l.stroke.color;
    ctx.lineWidth = l.stroke.width;
    ctx.stroke();
  }
}

function drawTextLayer(ctx: CanvasRenderingContext2D, l: TextLayer, scale: number): void {
  const fit = fitText(ctx, l);
  if (!fit.lines.length) return;
  const padX = l.pill?.padX ?? 0;
  const padY = l.pill?.padY ?? 0;
  const blockW = fit.width + padX * 2;
  const blockH = fit.height + padY * 2;
  const bx = -l.w / 2;
  const by = -l.h / 2;
  const left = l.align === 'left' ? bx : l.align === 'right' ? bx + l.w - blockW : bx + (l.w - blockW) / 2;
  const top = l.valign === 'top' ? by : l.valign === 'bottom' ? by + l.h - blockH : by + (l.h - blockH) / 2;
  if (l.pill) {
    ctx.fillStyle = l.pill.color;
    roundRect(ctx, left, top, blockW, blockH, l.pill.radius);
    ctx.fill();
  }
  ctx.font = fontOf(l, fit.size);
  setSpacing(ctx, l.letterSpacing, fit.size);
  ctx.textBaseline = 'alphabetic';
  // The line's box, with its first baseline placed so accents above and descenders below fit.
  const ascent = fit.size * 0.8 + (fit.lineHeight - fit.size) / 2;
  if (l.shadow && !l.pill) {
    // Shadows are in canvas pixels, which the frame's transform does not scale: scale them here,
    // so a small card shows the same shadow as the full-size export.
    ctx.shadowColor = l.shadow.color;
    ctx.shadowBlur = l.shadow.blur * scale;
    ctx.shadowOffsetX = l.shadow.x * scale;
    ctx.shadowOffsetY = l.shadow.y * scale;
  }
  fit.lines.forEach((line, i) => {
    const lw = ctx.measureText(line).width;
    const x = l.align === 'left' ? left + padX : l.align === 'right' ? left + blockW - padX - lw : left + (blockW - lw) / 2;
    const y = top + padY + i * fit.lineHeight + ascent;
    ctx.textAlign = 'left';
    if (l.stroke && l.stroke.width > 0) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = l.stroke.color;
      ctx.lineWidth = l.stroke.width * 2;
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = l.color;
    ctx.fillText(line, x, y);
  });
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

export interface DrawOptions {
  /** Canvas pixels per frame pixel. */
  scale: number;
  images: Map<string, HTMLImageElement>;
  /** Layers left out, for a drag drawn separately. */
  skip?: Set<string>;
}

/** A creative drawn onto a canvas, bottom layer first. */
export function drawCreative(ctx: CanvasRenderingContext2D, doc: CreativeDoc, opts: DrawOptions): void {
  const { scale } = opts;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = doc.background;
  ctx.fillRect(0, 0, doc.width, doc.height);
  for (const l of doc.layers) drawLayer(ctx, l, opts);
  ctx.restore();
}

export function drawLayer(ctx: CanvasRenderingContext2D, l: CreativeLayer, opts: DrawOptions): void {
  if (l.hidden || opts.skip?.has(l.id) || l.opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, l.opacity));
  ctx.translate(l.x + l.w / 2, l.y + l.h / 2);
  if (l.rotation) ctx.rotate((l.rotation * Math.PI) / 180);
  if (l.kind === 'image') drawImageLayer(ctx, l, opts.images.get(l.src), opts.scale);
  else if (l.kind === 'shape') drawShapeLayer(ctx, l);
  else drawTextLayer(ctx, l, opts.scale);
  ctx.restore();
}

/** The creative as a finished file at its own pixels — once its fonts and pictures are in. */
export async function exportCreative(doc: CreativeDoc, type: 'image/png' | 'image/jpeg' = 'image/png', quality = 0.92): Promise<Blob> {
  await loadCreativeFonts(doc);
  const images = await loadCreativeImages(doc);
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the creative.');
  drawCreative(ctx, doc, { scale: 1, images });
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The creative could not be saved — a picture may not allow it.'))), type, quality),
  );
}

/** Saves a file from the browser. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** A file name from a label: letters, numbers and dashes. */
export const fileNameOf = (label: string, ext: string): string =>
  `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'creative'}.${ext}`;
