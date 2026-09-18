/**
 * A social creative: a stack of layers on a frame of fixed pixel size.
 *
 * The same document is drawn on the image project page, edited in the image editor and
 * exported to PNG or JPG — by one renderer in the browser, so what is seen is what downloads.
 * Every word on a creative is a text layer the app draws; the picture under it never carries
 * writing of its own.
 */

export type CreativeFormatId = 'ig-square' | 'ig-portrait' | 'story' | 'landscape' | 'thumbnail';
/** The aspect ratios the image model draws a picture at. 1.91:1 is cut from 16:9. */
export type PictureAspect = '1:1' | '4:5' | '9:16' | '16:9';

export interface CreativeFormat {
  id: CreativeFormatId;
  label: string;
  /** Where it is posted. */
  platforms: string;
  width: number;
  height: number;
  pictureAspect: PictureAspect;
  /**
   * Bands a platform covers with its own interface (a story's profile row and reply box),
   * as fractions of the height: nothing that must be read goes there.
   */
  safeTop: number;
  safeBottom: number;
}

export const CREATIVE_FORMATS: CreativeFormat[] = [
  { id: 'ig-square', label: 'Instagram square', platforms: 'Instagram and Facebook feed', width: 1080, height: 1080, pictureAspect: '1:1', safeTop: 0, safeBottom: 0 },
  { id: 'ig-portrait', label: 'Instagram portrait', platforms: 'Instagram feed, the tallest a feed post shows', width: 1080, height: 1350, pictureAspect: '4:5', safeTop: 0, safeBottom: 0 },
  { id: 'story', label: 'Story · Reel · WhatsApp', platforms: 'Stories, reel covers and WhatsApp status', width: 1080, height: 1920, pictureAspect: '9:16', safeTop: 0.07, safeBottom: 0.1 },
  { id: 'landscape', label: 'Facebook · LinkedIn', platforms: 'Link posts and the LinkedIn feed', width: 1200, height: 628, pictureAspect: '16:9', safeTop: 0, safeBottom: 0 },
  { id: 'thumbnail', label: 'YouTube thumbnail', platforms: 'YouTube and X', width: 1280, height: 720, pictureAspect: '16:9', safeTop: 0, safeBottom: 0 },
];
export const CREATIVE_FORMAT_BY_ID = Object.fromEntries(CREATIVE_FORMATS.map((f) => [f.id, f])) as Record<CreativeFormatId, CreativeFormat>;
export const isCreativeFormat = (v: unknown): v is CreativeFormatId => typeof v === 'string' && v in CREATIVE_FORMAT_BY_ID;
/** The picture aspects a set of sizes needs, each once. */
export const pictureAspectsFor = (formats: CreativeFormatId[]): PictureAspect[] => [
  ...new Set(formats.filter(isCreativeFormat).map((f) => CREATIVE_FORMAT_BY_ID[f].pictureAspect)),
];

/** What the app placed a layer as, so a new headline or look can reach it without undoing the designer's own changes. */
export type LayerRole =
  | 'background'
  | 'scrim'
  | 'headline'
  | 'kicker'
  | 'sub'
  | 'badge'
  | 'badge-text'
  | 'points'
  | 'cta'
  | 'cta-text'
  | 'terms'
  | 'panel'
  | 'panel-name'
  | 'panel-details'
  | 'panel-logo'
  | 'dealer-logo'
  | 'brand-logo'
  | 'accent';

interface LayerBase {
  id: string;
  name: string;
  /** The box on the frame, in pixels from the top-left, before rotation. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees clockwise, about the box's centre. */
  rotation: number;
  opacity: number;
  hidden?: boolean;
  locked?: boolean;
  role?: LayerRole;
}

export interface ImageAdjust {
  /** -100 to 100; 0 leaves the picture as it is. */
  brightness?: number;
  contrast?: number;
  saturation?: number;
  /** Warmer (positive) or cooler (negative). */
  warmth?: number;
  /** A soft blur, 0 to 40 px on the frame. */
  blur?: number;
}

export interface ImageLayer extends LayerBase {
  kind: 'image';
  /** Where the browser fetches it from. */
  src: string;
  /** refs/{id}/{name} when it is a stored picture. */
  storagePath?: string;
  /** Cover fills the box and crops; contain fits it whole. */
  fit: 'cover' | 'contain';
  /**
   * Which part of the picture stays in view when it covers the box, or where it sits in the box
   * when it is contained (0 left or top, 1 right or bottom).
   */
  focusX: number;
  focusY: number;
  /** 1 as fitted; more zooms in about the focus. */
  zoom: number;
  flipX?: boolean;
  radius?: number;
  adjust?: ImageAdjust;
  /** A contained picture fills the rest of its box with a blurred, darkened copy of itself. */
  backdrop?: 'blur';
}

export interface TextShadow {
  color: string;
  blur: number;
  x: number;
  y: number;
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  text: string;
  /** An id from CREATIVE_FONTS. */
  font: string;
  /** The largest the words are drawn, in pixels on the frame. */
  size: number;
  /** Smallest they shrink to before they would run out of the box. Unset: half of size. */
  minSize?: number;
  weight: number;
  italic?: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  /** A multiple of the size. */
  lineHeight: number;
  /** In em. */
  letterSpacing: number;
  caps?: boolean;
  maxLines?: number;
  shadow?: TextShadow;
  stroke?: { color: string; width: number };
  /** A pill behind the words, fitted to them. */
  pill?: { color: string; padX: number; padY: number; radius: number };
}

export interface ShapeLayer extends LayerBase {
  kind: 'shape';
  shape: 'rect' | 'ellipse' | 'line';
  fill?: string;
  /** Replaces the fill: from one colour to another at an angle (0 is top to bottom). */
  gradient?: { from: string; to: string; angle: number };
  stroke?: { color: string; width: number };
  radius?: number;
}

export type CreativeLayer = ImageLayer | TextLayer | ShapeLayer;

export interface CreativeDoc {
  version: 1;
  format: CreativeFormatId;
  width: number;
  height: number;
  /** The colour under every layer. */
  background: string;
  layers: CreativeLayer[];
}

/** Typefaces a creative can use, loaded from Google Fonts. Indian scripts fall back to the Noto family for each. */
export interface CreativeFont {
  id: string;
  name: string;
  /** The family, as CSS names it. */
  family: string;
  /** Google Fonts family spec, weights included. */
  google: string;
  /** What it is good for, shown in the picker. */
  note: string;
}
export const INDIC_FALLBACK_FAMILIES = [
  'Noto Sans Devanagari',
  'Noto Sans Bengali',
  'Noto Sans Gurmukhi',
  'Noto Sans Tamil',
  'Noto Sans Telugu',
  'Noto Sans Kannada',
  'Noto Sans Malayalam',
];
export const CREATIVE_FONTS: CreativeFont[] = [
  { id: 'poppins', name: 'Poppins', family: 'Poppins', google: 'Poppins:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,700', note: 'Clean, modern — headlines and panels' },
  { id: 'montserrat', name: 'Montserrat', family: 'Montserrat', google: 'Montserrat:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,700', note: 'Wide and confident' },
  { id: 'inter', name: 'Inter', family: 'Inter', google: 'Inter:wght@400;500;600;700;800;900', note: 'Quiet, readable — small print' },
  { id: 'oswald', name: 'Oswald', family: 'Oswald', google: 'Oswald:wght@400;500;600;700', note: 'Tall and condensed — offers, numbers' },
  { id: 'bebas', name: 'Bebas Neue', family: 'Bebas Neue', google: 'Bebas+Neue', note: 'All capitals, poster-like' },
  { id: 'anton', name: 'Anton', family: 'Anton', google: 'Anton', note: 'Heavy impact — sale banners' },
  { id: 'barlow', name: 'Barlow Condensed', family: 'Barlow Condensed', google: 'Barlow+Condensed:ital,wght@0,500;0,600;0,700;0,800;1,700', note: 'Sporty, technical' },
  { id: 'playfair', name: 'Playfair Display', family: 'Playfair Display', google: 'Playfair+Display:ital,wght@0,500;0,600;0,700;0,800;1,600', note: 'Elegant — festivals, premium' },
  { id: 'dmserif', name: 'DM Serif Display', family: 'DM Serif Display', google: 'DM+Serif+Display:ital@0;1', note: 'Warm serif — greetings' },
  { id: 'mukta', name: 'Mukta', family: 'Mukta', google: 'Mukta:wght@400;500;600;700;800', note: 'Hindi and English together' },
  { id: 'hind', name: 'Hind', family: 'Hind', google: 'Hind:wght@400;500;600;700', note: 'Hindi — clear, everyday' },
  { id: 'baloo', name: 'Baloo 2', family: 'Baloo 2', google: 'Baloo+2:wght@500;600;700;800', note: 'Hindi — friendly, rounded' },
  { id: 'tiro', name: 'Tiro Devanagari Hindi', family: 'Tiro Devanagari Hindi', google: 'Tiro+Devanagari+Hindi:ital@0;1', note: 'Hindi — classic serif' },
  { id: 'noto', name: 'Noto Sans', family: 'Noto Sans', google: 'Noto+Sans:wght@400;500;600;700;800', note: 'Every Indian script' },
];
export const CREATIVE_FONT_BY_ID = Object.fromEntries(CREATIVE_FONTS.map((f) => [f.id, f])) as Record<string, CreativeFont>;
/** The CSS family list a text layer is drawn in: its face, then the Noto face for each Indian script. */
export const creativeFontStack = (fontId: string): string => {
  const f = CREATIVE_FONT_BY_ID[fontId] ?? CREATIVE_FONT_BY_ID.poppins!;
  return [f.family, 'Noto Sans', ...INDIC_FALLBACK_FAMILIES, 'sans-serif'].map((n) => (n.includes(' ') ? `"${n}"` : n)).join(', ');
};

export const creativeUid = (): string => Math.random().toString(36).slice(2, 10);

/* ---- editing: every change is a new document ---- */

export function updateLayer<T extends CreativeLayer>(doc: CreativeDoc, id: string, patch: Partial<T>): CreativeDoc {
  return { ...doc, layers: doc.layers.map((l) => (l.id === id ? ({ ...l, ...patch, id: l.id, kind: l.kind } as CreativeLayer) : l)) };
}
export function removeLayer(doc: CreativeDoc, id: string): CreativeDoc {
  return { ...doc, layers: doc.layers.filter((l) => l.id !== id) };
}
export function addLayer(doc: CreativeDoc, layer: CreativeLayer, above?: string): CreativeDoc {
  const at = above ? doc.layers.findIndex((l) => l.id === above) : -1;
  const layers = [...doc.layers];
  layers.splice(at >= 0 ? at + 1 : layers.length, 0, layer);
  return { ...doc, layers };
}
export function duplicateLayer(doc: CreativeDoc, id: string): { doc: CreativeDoc; id?: string } {
  const l = doc.layers.find((x) => x.id === id);
  if (!l) return { doc };
  const copy = { ...structuredCloneSafe(l), id: creativeUid(), name: `${l.name} copy`, x: l.x + 24, y: l.y + 24, role: undefined } as CreativeLayer;
  return { doc: addLayer(doc, copy, id), id: copy.id };
}
/** Up and down move one step; top and bottom to the ends. Index 0 is the bottom of the stack. */
export function reorderLayer(doc: CreativeDoc, id: string, to: 'up' | 'down' | 'top' | 'bottom'): CreativeDoc {
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i < 0) return doc;
  const layers = [...doc.layers];
  const [l] = layers.splice(i, 1);
  const j = to === 'top' ? layers.length : to === 'bottom' ? 0 : to === 'up' ? Math.min(layers.length, i + 1) : Math.max(0, i - 1);
  layers.splice(j, 0, l!);
  return { ...doc, layers };
}
function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** The four corners of a layer's box after its rotation, for hit tests and guides. */
export function layerCorners(l: Pick<CreativeLayer, 'x' | 'y' | 'w' | 'h' | 'rotation'>): Array<{ x: number; y: number }> {
  const cx = l.x + l.w / 2;
  const cy = l.y + l.h / 2;
  const a = (l.rotation * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return [
    [-l.w / 2, -l.h / 2],
    [l.w / 2, -l.h / 2],
    [l.w / 2, l.h / 2],
    [-l.w / 2, l.h / 2],
  ].map(([dx, dy]) => ({ x: cx + dx! * c - dy! * s, y: cy + dx! * s + dy! * c }));
}
/** The upright box around a layer, rotation included. */
export function layerBounds(l: Pick<CreativeLayer, 'x' | 'y' | 'w' | 'h' | 'rotation'>): { x: number; y: number; w: number; h: number } {
  const pts = layerCorners(l);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
/** Whether a point on the frame falls inside a layer, rotation included. */
export function layerHit(l: Pick<CreativeLayer, 'x' | 'y' | 'w' | 'h' | 'rotation'>, px: number, py: number): boolean {
  const cx = l.x + l.w / 2;
  const cy = l.y + l.h / 2;
  const a = (-l.rotation * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= l.w / 2 && Math.abs(ly) <= l.h / 2;
}

/* ---- checks before a document is kept ---- */

const COLOUR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\))$/i;
export const isCreativeColour = (v: unknown): v is string => typeof v === 'string' && COLOUR.test(v.trim());
const num = (v: unknown, lo: number, hi: number): boolean => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
export const CREATIVE_MAX_LAYERS = 60;

export function validateCreativeDoc(d: unknown): string | null {
  const doc = d as Partial<CreativeDoc> | undefined;
  if (!doc || typeof doc !== 'object') return 'A creative is malformed.';
  if (doc.version !== 1) return 'A creative was made by a different version of the editor.';
  if (!isCreativeFormat(doc.format)) return 'A creative has a size this app does not know.';
  const f = CREATIVE_FORMAT_BY_ID[doc.format];
  if (doc.width !== f.width || doc.height !== f.height) return `A ${f.label} creative must be ${f.width}×${f.height}.`;
  if (!isCreativeColour(doc.background)) return 'A creative has a background colour that cannot be read.';
  if (!Array.isArray(doc.layers)) return 'A creative has no layers.';
  if (doc.layers.length > CREATIVE_MAX_LAYERS) return `A creative takes up to ${CREATIVE_MAX_LAYERS} layers.`;
  const W = f.width;
  const H = f.height;
  for (const l of doc.layers as CreativeLayer[]) {
    if (!l || typeof l !== 'object' || typeof l.id !== 'string' || !l.id) return 'A layer is malformed.';
    const where = `The layer "${String(l.name ?? l.id).slice(0, 40)}"`;
    if (!num(l.x, -3 * W, 4 * W) || !num(l.y, -3 * H, 4 * H) || !num(l.w, 1, 6 * W) || !num(l.h, 1, 6 * H)) return `${where} has a position or size that cannot be read.`;
    if (!num(l.rotation, -3600, 3600) || !num(l.opacity, 0, 1)) return `${where} has a rotation or opacity that cannot be read.`;
    if (l.kind === 'text') {
      if (typeof l.text !== 'string' || l.text.length > 600) return `${where} has more than 600 characters.`;
      if (!CREATIVE_FONT_BY_ID[l.font]) return `${where} uses a font this app does not have.`;
      if (!num(l.size, 4, 800) || !num(l.weight, 100, 900) || !num(l.lineHeight, 0.6, 3) || !num(l.letterSpacing, -0.3, 1)) return `${where} has type settings that cannot be read.`;
      if (!isCreativeColour(l.color)) return `${where} has a colour that cannot be read.`;
      if (l.pill && !isCreativeColour(l.pill.color)) return `${where} has a pill colour that cannot be read.`;
    } else if (l.kind === 'image') {
      if (typeof l.src !== 'string' || !l.src || l.src.length > 2000) return `${where} has no picture.`;
      if (/^data:/i.test(l.src) && l.src.length > 400) return `${where} holds its picture inline; it must be uploaded first.`;
      if (l.fit !== 'cover' && l.fit !== 'contain') return `${where} has a fit this app does not know.`;
      if (!num(l.focusX, 0, 1) || !num(l.focusY, 0, 1) || !num(l.zoom, 0.2, 8)) return `${where} has a crop that cannot be read.`;
    } else if (l.kind === 'shape') {
      if (l.shape !== 'rect' && l.shape !== 'ellipse' && l.shape !== 'line') return `${where} is a shape this app does not know.`;
      if (l.fill !== undefined && !isCreativeColour(l.fill)) return `${where} has a fill that cannot be read.`;
      if (l.gradient && (!isCreativeColour(l.gradient.from) || !isCreativeColour(l.gradient.to))) return `${where} has a gradient that cannot be read.`;
    } else {
      return `${where} is of a kind this editor does not know.`;
    }
  }
  return null;
}

/** An empty creative of a size. */
export function emptyCreative(format: CreativeFormatId, background = '#0f1e33'): CreativeDoc {
  const f = CREATIVE_FORMAT_BY_ID[format];
  return { version: 1, format, width: f.width, height: f.height, background, layers: [] };
}
