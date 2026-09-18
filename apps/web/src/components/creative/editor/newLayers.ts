/**
 * New layers as the editor adds them, and the small facts about fonts and pictures the panels
 * need. Everything new lands in the middle of the frame, sized to the frame's short side, so
 * it looks the same on a square, a story and a thumbnail.
 */
import {
  CREATIVE_FONT_BY_ID,
  creativeUid,
  type CreativeDoc,
  type CreativeFont,
  type CreativeLayer,
  type ImageLayer,
  type ShapeLayer,
  type TextLayer,
} from '@ava/shared';

const shortSide = (doc: CreativeDoc): number => Math.min(doc.width, doc.height);

/** "Text", then "Text 2", "Text 3" — so two new layers can be told apart in the list. */
export function uniqueName(doc: CreativeDoc, base: string): string {
  const names = new Set(doc.layers.map((l) => l.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

export function newTextLayer(doc: CreativeDoc): TextLayer {
  const size = Math.round(shortSide(doc) * 0.07);
  const lineHeight = 1.15;
  const w = Math.round(doc.width * 0.7);
  // Room for two lines, so a longer line wraps before it shrinks.
  const h = Math.round(size * lineHeight * 2);
  return {
    id: creativeUid(),
    kind: 'text',
    name: uniqueName(doc, 'Text'),
    x: Math.round((doc.width - w) / 2),
    y: Math.round((doc.height - h) / 2),
    w,
    h,
    rotation: 0,
    opacity: 1,
    text: 'Your text',
    font: 'poppins',
    size,
    weight: 700,
    color: '#ffffff',
    align: 'center',
    valign: 'middle',
    lineHeight,
    letterSpacing: 0,
    shadow: { color: 'rgba(0,0,0,0.45)', blur: 18, x: 0, y: 3 },
  };
}

export function newShapeLayer(doc: CreativeDoc, shape: ShapeLayer['shape']): ShapeLayer {
  const S = shortSide(doc);
  const [w, h] = shape === 'line' ? [Math.round(doc.width * 0.5), 6] : shape === 'ellipse' ? [Math.round(S * 0.3), Math.round(S * 0.3)] : [Math.round(S * 0.4), Math.round(S * 0.25)];
  return {
    id: creativeUid(),
    kind: 'shape',
    name: uniqueName(doc, shape === 'line' ? 'Line' : shape === 'ellipse' ? 'Ellipse' : 'Rectangle'),
    shape,
    x: Math.round((doc.width - w) / 2),
    y: Math.round((doc.height - h) / 2),
    w,
    h,
    rotation: 0,
    opacity: 1,
    fill: shape === 'line' ? '#ffffff' : '#e2600a',
  };
}

/** A picture's own width and height, when known. */
export interface PictureSize {
  w: number;
  h: number;
}

/** A picture centred on the frame, its longer side 60% of the frame's short side, fitted whole. */
export function newImageLayer(doc: CreativeDoc, pic: { src: string; storagePath?: string; label: string }, size: PictureSize | null): ImageLayer {
  const long = shortSide(doc) * 0.6;
  const ratio = size && size.w > 0 && size.h > 0 ? size.w / size.h : 1;
  const w = Math.round(ratio >= 1 ? long : long * ratio);
  const h = Math.round(ratio >= 1 ? long / ratio : long);
  return {
    id: creativeUid(),
    kind: 'image',
    name: uniqueName(doc, pic.label.trim().slice(0, 60) || 'Picture'),
    x: Math.round((doc.width - w) / 2),
    y: Math.round((doc.height - h) / 2),
    w: Math.max(1, w),
    h: Math.max(1, h),
    rotation: 0,
    opacity: 1,
    src: pic.src,
    ...(pic.storagePath ? { storagePath: pic.storagePath } : {}),
    fit: 'contain',
    focusX: 0.5,
    focusY: 0.5,
    zoom: 1,
  };
}

/** A file's name without its extension, for a layer's name. */
export const baseName = (file: string): string => file.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').trim();

/** A picture file's own size, read on this device — the object URL goes as soon as it is read. */
export function pictureSizeOf(file: File): Promise<PictureSize | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = (v: PictureSize | null): void => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    img.onload = () => done(img.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : null);
    img.onerror = () => done(null);
    img.src = url;
  });
}

/** The weights a face is loaded at, from its Google Fonts spec: "…wght@0,400;0,700;1,700" gives 400 and 700. */
export function fontWeights(f: CreativeFont | undefined): number[] {
  const m = f?.google.match(/wght@([\d.,;]+)/);
  if (!m) return [400];
  const weights = m[1]!.split(';').map((pair) => Number(pair.split(',').pop()));
  return [...new Set(weights.filter((w) => Number.isFinite(w) && w > 0))].sort((a, b) => a - b);
}
export const fontWeightsOf = (fontId: string): number[] => fontWeights(CREATIVE_FONT_BY_ID[fontId]);
/** The weight a face has that is nearest to the one asked for. */
export function nearestWeight(fontId: string, weight: number): number {
  const weights = fontWeightsOf(fontId);
  return weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), weights[0] ?? 400);
}

export const WEIGHT_NAMES: Record<number, string> = {
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra bold',
  900: 'Black',
};

/**
 * The document as it is kept: fields set to nothing are left out rather than stored empty,
 * since a store may refuse an undefined value.
 */
export function withoutEmptyFields(doc: CreativeDoc): CreativeDoc {
  return {
    ...doc,
    layers: doc.layers.map((l) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(l)) if (v !== undefined) out[k] = v;
      return out as unknown as CreativeLayer;
    }),
  };
}
