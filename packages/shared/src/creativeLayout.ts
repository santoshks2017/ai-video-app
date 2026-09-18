/**
 * Layout templates: a size, the copy, the look and the client's logos in; a finished,
 * editable creative out.
 *
 * Every size is laid out for itself — a story stacks what a landscape post puts side by side —
 * and every element keeps inside the frame and out of the bands a platform covers. Text boxes
 * are sized from the words they hold, and the renderer shrinks words that still would not fit,
 * so a long headline makes room for itself instead of running into the car.
 */
import {
  CREATIVE_FORMAT_BY_ID,
  creativeUid,
  type CreativeDoc,
  type CreativeFormatId,
  type CreativeLayer,
  type ImageLayer,
  type LayerRole,
  type ShapeLayer,
  type TextLayer,
} from './creative.js';
import type { CreativeCopy } from './creativeCopy.js';
import type { CreativeTemplateId } from './creativeEngines.js';
import { isLightColour, type OverlayTheme } from './overlayLook.js';

export interface CreativeTemplate {
  id: CreativeTemplateId;
  name: string;
  note: string;
}
export const CREATIVE_TEMPLATES: CreativeTemplate[] = [
  { id: 'hero', name: 'Hero with panel', note: 'Headline over the scene, the panel at the foot' },
  { id: 'offer', name: 'Offer', note: 'A large ₹ badge, the offers under it' },
  { id: 'festival', name: 'Festival greeting', note: 'A centred greeting, a light panel' },
  { id: 'feature', name: 'Feature points', note: 'Headline and three or four points' },
  { id: 'launch', name: 'Launch', note: 'Dark and dramatic, the date up front' },
  { id: 'delivery', name: 'Delivery', note: '"Congratulations" and the customer\'s name' },
];
export const isCreativeTemplate = (v: unknown): v is CreativeTemplateId => CREATIVE_TEMPLATES.some((t) => t.id === v);

export type PanelStyle = 'full' | 'compact' | 'none';
export interface CreativeLogoArt {
  src: string;
  storagePath?: string;
  /** The same logo in white, for dark ground. */
  white?: { src: string; storagePath?: string };
}
export type LogoSide = 'left' | 'right' | 'off';

export interface LayoutInput {
  format: CreativeFormatId;
  template: CreativeTemplateId;
  copy: CreativeCopy;
  look: OverlayTheme;
  /** The picture the creative is built on. Unset: the look's colours alone. */
  picture?: { src: string; storagePath?: string; mode: 'scene' | 'photo' | 'upload' };
  logos: { dealer?: CreativeLogoArt; brand?: CreativeLogoArt; placement: { dealer: LogoSide; brand: LogoSide } };
  panel: { style: PanelStyle; name: string; details: string[] };
  /** Words in an Indian script need faces that carry them. */
  script?: 'latin' | 'indic';
}

/* ---- measuring without a canvas: generous estimates the renderer refines ---- */

const avgGlyph = (script: 'latin' | 'indic', caps: boolean, weight: number): number =>
  (script === 'indic' ? 0.6 : caps ? 0.66 : 0.56) + (weight >= 700 ? 0.03 : 0);
/** Lines a text needs in a box width, capped. */
function linesFor(text: string, size: number, width: number, opts: { script: 'latin' | 'indic'; caps?: boolean; weight: number; max: number }): number {
  if (!text.trim()) return 0;
  const perLine = Math.max(4, Math.floor(width / (size * avgGlyph(opts.script, Boolean(opts.caps), opts.weight))));
  let lines = 0;
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = 0;
    let n = 1;
    for (const w of words) {
      const len = w.length + (cur ? 1 : 0);
      if (cur && cur + len > perLine) {
        n++;
        cur = w.length;
      } else cur += len;
    }
    lines += n;
  }
  return Math.min(opts.max, lines);
}

/* ---- the frame ---- */

interface Frame {
  W: number;
  H: number;
  /** The short side: sizes are fractions of it, so type reads the same on every size. */
  S: number;
  m: number;
  wide: boolean;
  tall: boolean;
  top: number;
  bottom: number;
}
function frameOf(format: CreativeFormatId): Frame {
  const f = CREATIVE_FORMAT_BY_ID[format];
  const W = f.width;
  const H = f.height;
  const S = Math.min(W, H);
  const m = Math.round(S * 0.05);
  return { W, H, S, m, wide: W / H > 1.3, tall: H / W > 1.5, top: Math.max(m, Math.round(H * f.safeTop)), bottom: Math.round(H * f.safeBottom) };
}

const rgba = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
const onColour = (bg: string): string => (isLightColour(bg) ? '#111827' : '#ffffff');

function textLayer(role: LayerRole, name: string, text: string, box: { x: number; y: number; w: number; h: number }, style: Partial<TextLayer> & { font: string; size: number; color: string }): TextLayer {
  return {
    id: creativeUid(),
    kind: 'text',
    name,
    role,
    rotation: 0,
    opacity: 1,
    text,
    weight: 700,
    align: 'left',
    valign: 'top',
    lineHeight: 1.15,
    letterSpacing: 0,
    ...box,
    ...style,
  };
}
function shape(role: LayerRole, name: string, box: { x: number; y: number; w: number; h: number }, style: Partial<ShapeLayer>): ShapeLayer {
  return { id: creativeUid(), kind: 'shape', name, role, rotation: 0, opacity: 1, shape: 'rect', ...box, ...style };
}
function image(role: LayerRole, name: string, box: { x: number; y: number; w: number; h: number }, style: Partial<ImageLayer> & { src: string }): ImageLayer {
  return { id: creativeUid(), kind: 'image', name, role, rotation: 0, opacity: 1, fit: 'cover', focusX: 0.5, focusY: 0.5, zoom: 1, ...box, ...style };
}

/* ---- the parts every template shares ---- */

interface Parts {
  layers: CreativeLayer[];
  /** Where words may go: under the logos, above the panel. */
  area: { x: number; y: number; w: number; h: number };
  /** The call to action and the small print, when the dealer panel carries them. */
  inPanel: { cta: boolean; terms: boolean };
}

function basics(input: LayoutInput, fr: Frame, scrim: 'top' | 'left' | 'full' | 'bottom' | 'both', wordsLow = false): Parts {
  const { look, copy } = input;
  const layers: CreativeLayer[] = [];
  const pic = input.picture;
  const text = input.script === 'indic' ? 'mukta' : 'poppins';
  const script = input.script ?? 'latin';

  // The dealer panel at the foot: full block, a compact line, or nothing (the contact is in the
  // caption). A thumbnail is too small for a full block, so it takes the line. On a square,
  // portrait or story, a full panel also carries the call to action and the small print, so
  // neither lands on the vehicle; a wide size keeps them in its column, clear of the vehicle.
  const panelStyle: PanelStyle = input.format === 'thumbnail' && input.panel.style === 'full' ? 'compact' : input.panel.style;
  const hasPanel = panelStyle !== 'none' && Boolean(input.panel.name || input.panel.details.length);
  const fullPanel = hasPanel && panelStyle === 'full';
  const inPanel = { cta: fullPanel && !fr.wide && Boolean(copy.cta.trim()), terms: fullPanel && !fr.wide && Boolean(copy.terms.trim()) };
  const pad = fr.m;
  const termsSize = Math.round(fr.S * 0.017);
  const termsLines = inPanel.terms ? linesFor(copy.terms, termsSize, fr.W - pad * 2, { script, weight: 400, max: 2 }) : 0;
  const termsH = inPanel.terms ? Math.ceil(termsLines * termsSize * 1.25 + termsSize * 0.2) : 0;
  const baseH = fullPanel ? Math.round(fr.wide ? fr.H * 0.17 : fr.S * 0.15) : Math.round(fr.S * (fr.wide ? 0.1 : 0.085));
  const ph = hasPanel ? baseH + (termsH ? termsH + Math.round(fr.S * 0.012) : 0) : 0;
  const panelTop = hasPanel ? fr.H - fr.bottom - ph : fr.H - fr.bottom - fr.m;
  const footWords = (!inPanel.cta && Boolean(copy.cta.trim())) || (!inPanel.terms && Boolean(copy.terms.trim()));
  // The foot is shaded only for words set there; otherwise the shade would only darken the vehicle.
  const shadeFoot = footWords || wordsLow;

  if (pic) {
    const photo = pic.mode === 'photo';
    layers.push(
      image('background', 'Picture', { x: 0, y: 0, w: fr.W, h: fr.H }, {
        src: pic.src,
        storagePath: pic.storagePath,
        fit: photo ? 'contain' : 'cover',
        backdrop: photo ? 'blur' : undefined,
        focusY: photo ? 0.5 : 0.55,
      }),
    );
  }
  // Legibility: the words sit on the look's own colour, fading into the picture.
  const tint = look.panel;
  const strong = pic ? 0.86 : 0;
  if (pic) {
    if (scrim === 'top' || scrim === 'both') {
      layers.push(shape('scrim', 'Shade, top', { x: 0, y: 0, w: fr.W, h: Math.round(fr.H * (fr.tall ? 0.5 : 0.62)) }, { gradient: { from: rgba(tint, strong), to: rgba(tint, 0), angle: 0 } }));
    }
    if (scrim === 'left') {
      layers.push(shape('scrim', 'Shade, left', { x: 0, y: 0, w: Math.round(fr.W * 0.68), h: fr.H }, { gradient: { from: rgba(tint, 0.9), to: rgba(tint, 0), angle: 270 } }));
      // A logo on the right sits on the picture itself: shade the top so it reads on any picture.
      const { brand, dealer } = input.logos.placement;
      if ((brand === 'right' && input.logos.brand) || (dealer === 'right' && input.logos.dealer)) {
        layers.push(shape('scrim', 'Shade, logos', { x: 0, y: 0, w: fr.W, h: Math.round(fr.H * 0.34) }, { gradient: { from: rgba(tint, 0.85), to: rgba(tint, 0), angle: 0 } }));
      }
    }
    if (scrim === 'bottom' || (scrim === 'both' && shadeFoot)) {
      const h = Math.round(fr.H * (fr.tall ? 0.42 : 0.5));
      layers.push(shape('scrim', 'Shade, bottom', { x: 0, y: fr.H - h, w: fr.W, h }, { gradient: { from: rgba(tint, 0), to: rgba(tint, strong), angle: 0 } }));
    }
    if (scrim === 'full') {
      layers.push(shape('scrim', 'Shade', { x: 0, y: 0, w: fr.W, h: fr.H }, { fill: rgba(tint, 0.55) }));
    }
    // A greeting shades only its top; words left at its foot get a low shade of their own.
    if (scrim === 'top' && footWords && !fr.wide) {
      const h = Math.round(fr.S * 0.26);
      layers.push(shape('scrim', 'Shade, foot', { x: 0, y: panelTop - h, w: fr.W, h }, { gradient: { from: rgba(tint, 0), to: rgba(tint, 0.8), angle: 0 } }));
    }
  }

  // Logos in the top corners, white where the ground under them is dark.
  const logoH = Math.round(fr.S * 0.09);
  const logoW = Math.round(fr.S * 0.28);
  const topDark = pic ? !isLightColour(tint) : !isLightColour(look.panel);
  const placeLogo = (art: CreativeLogoArt | undefined, side: LogoSide, role: 'dealer-logo' | 'brand-logo', name: string) => {
    if (!art || side === 'off') return;
    const use = topDark && art.white ? art.white : art;
    layers.push(
      image(role, name, { x: side === 'left' ? fr.m : fr.W - fr.m - logoW, y: fr.top, w: logoW, h: logoH }, {
        src: use.src,
        storagePath: use.storagePath,
        fit: 'contain',
        focusX: side === 'left' ? 0 : 1,
        focusY: 0.5,
      }),
    );
  };
  const { placement } = input.logos;
  // Two logos on one side share it, the brand's first.
  if (placement.brand !== 'off' && placement.brand === placement.dealer) {
    const half = Math.round(logoW * 0.62);
    const side = placement.brand;
    const at = (i: number) => (side === 'left' ? fr.m + i * (half + fr.m / 2) : fr.W - fr.m - half - i * (half + fr.m / 2));
    for (const [i, [art, role, name]] of ([[input.logos.brand, 'brand-logo', 'Brand logo'], [input.logos.dealer, 'dealer-logo', 'Dealer logo']] as const).entries()) {
      if (!art) continue;
      const use = topDark && art.white ? art.white : art;
      layers.push(image(role, name, { x: at(i), y: fr.top, w: half, h: logoH }, { src: use.src, storagePath: use.storagePath, fit: 'contain', focusX: side === 'left' ? 0 : 1, focusY: 0.5 }));
    }
  } else {
    placeLogo(input.logos.brand, placement.brand, 'brand-logo', 'Brand logo');
    placeLogo(input.logos.dealer, placement.dealer, 'dealer-logo', 'Dealer logo');
  }
  const anyLogo = layers.some((l) => l.role === 'brand-logo' || l.role === 'dealer-logo');

  if (hasPanel) {
    const fg = onColour(look.panel);
    layers.push(shape('panel', 'Dealer panel', { x: 0, y: panelTop, w: fr.W, h: ph + fr.bottom }, { fill: look.panel }));
    layers.push(shape('accent', 'Panel accent', { x: 0, y: panelTop, w: fr.W, h: Math.max(4, Math.round(fr.S * 0.008)) }, { fill: look.accent }));
    if (fullPanel) {
      const nameSize = Math.round(fr.S * (fr.wide ? 0.05 : 0.036));
      const detailSize = Math.round(fr.S * (fr.wide ? 0.034 : 0.024));
      const inner = baseH - Math.round(fr.S * 0.012);
      const rowTop = panelTop + Math.round(fr.S * 0.012);
      // The call to action takes the panel's right side; the name and contact keep the rest.
      let infoW = fr.W - pad * 2;
      if (inPanel.cta) {
        const size = Math.round(fr.S * 0.03);
        const p = pill(look.accent, size);
        const want = Math.ceil(copy.cta.trim().length * size * avgGlyph(script, false, 700) + p.padX * 2);
        const ctaW = Math.min(Math.round(fr.W * 0.44), want);
        const h = Math.round(size * 1.2 + p.padY * 2);
        layers.push(
          textLayer('cta', 'Call to action', copy.cta, { x: fr.W - pad - ctaW, y: rowTop + Math.round((inner - h) / 2), w: ctaW, h }, { font: text, size, weight: 700, color: onColour(look.accent), align: 'right', valign: 'middle', pill: p, maxLines: 1 }),
        );
        infoW -= ctaW + Math.round(fr.S * 0.03);
      }
      const nameH = Math.round(nameSize * 1.25);
      const details = input.panel.details.slice(0, 2);
      const detailsH = Math.round(details.length * detailSize * 1.35);
      if (fr.wide) {
        // A wide panel is short: the name on the left, the address and phone on the right.
        const nameW = Math.round(fr.W * 0.4);
        layers.push(textLayer('panel-name', 'Dealer name', input.panel.name, { x: pad, y: rowTop + Math.round((inner - nameH) / 2), w: nameW, h: nameH }, { font: text, size: nameSize, weight: 700, color: fg, maxLines: 1 }));
        if (details.length) {
          const x = pad + nameW + Math.round(fr.S * 0.04);
          const h = detailsH + Math.round(detailSize * 0.3);
          layers.push(
            textLayer('panel-details', 'Contact', details.join('\n'), { x, y: rowTop + Math.max(0, Math.round((inner - h) / 2)), w: fr.W - pad - x, h }, { font: text, size: detailSize, weight: 500, color: fg, opacity: 0.9, lineHeight: 1.3, align: 'right', maxLines: details.length }),
          );
        }
      } else {
        const blockH = nameH + detailsH;
        const y0 = rowTop + Math.max(0, Math.round((inner - blockH) / 2));
        layers.push(textLayer('panel-name', 'Dealer name', input.panel.name, { x: pad, y: y0, w: infoW, h: nameH }, { font: text, size: nameSize, weight: 700, color: fg, maxLines: 1 }));
        if (details.length) {
          layers.push(
            textLayer('panel-details', 'Contact', details.join('\n'), { x: pad, y: y0 + nameH, w: infoW, h: detailsH + Math.round(detailSize * 0.3) }, { font: text, size: detailSize, weight: 500, color: fg, opacity: 0.9, lineHeight: 1.3, maxLines: details.length }),
          );
        }
      }
      if (inPanel.terms) {
        layers.push(
          textLayer('terms', 'Small print', copy.terms, { x: pad, y: panelTop + baseH, w: fr.W - pad * 2, h: termsH }, { font: text, size: termsSize, weight: 400, color: fg, opacity: 0.72, lineHeight: 1.25, maxLines: 2 }),
        );
      }
    } else {
      const size = Math.round(fr.S * (fr.wide ? 0.04 : 0.03));
      const line = [input.panel.name, ...input.panel.details].filter(Boolean).join('   ·   ');
      layers.push(textLayer('panel-name', 'Dealer line', line, { x: pad, y: panelTop + Math.round((ph - size * 1.3) / 2) + 2, w: fr.W - pad * 2, h: Math.round(size * 1.3) }, { font: text, size, weight: 600, color: fg, align: 'center', maxLines: 1 }));
    }
  }
  const areaTop = fr.top + (anyLogo ? logoH + Math.round(fr.S * 0.04) : 0);
  const areaBottom = panelTop - Math.round(fr.S * 0.035);
  return { layers, area: { x: fr.m, y: areaTop, w: fr.W - fr.m * 2, h: Math.max(fr.S * 0.3, areaBottom - areaTop) }, inPanel };
}

/* ---- words ---- */

interface Words {
  script: 'latin' | 'indic';
  display: string;
  text: string;
  fg: string;
  accent: string;
  onAccent: string;
}
function wordsFor(input: LayoutInput): Words {
  const script = input.script ?? 'latin';
  const fg = input.picture ? onColour(input.look.panel) : onColour(input.look.panel);
  return {
    script,
    display: script === 'indic' ? 'mukta' : input.template === 'festival' || input.template === 'delivery' ? 'playfair' : 'poppins',
    text: script === 'indic' ? 'mukta' : 'poppins',
    fg,
    accent: input.look.accent,
    onAccent: onColour(input.look.accent),
  };
}

type Block = { role: LayerRole; name: string; text: string; size: number; weight: number; font: string; color: string; gap: number; maxLines: number; caps?: boolean; align?: TextLayer['align']; letterSpacing?: number; lineHeight?: number; opacity?: number; pill?: TextLayer['pill'] };
const scaled = (b: Block, k: number): Block =>
  k >= 1
    ? b
    : {
        ...b,
        size: Math.round(b.size * k),
        gap: Math.round(b.gap * k),
        pill: b.pill ? { ...b.pill, padX: Math.round(b.pill.padX * k), padY: Math.round(b.pill.padY * k), radius: Math.round(b.pill.radius * k) } : undefined,
      };
function blockHeight(b: Block, w: number, script: 'latin' | 'indic'): number {
  if (!b.text.trim()) return 0;
  const lh = b.lineHeight ?? 1.15;
  const lines = linesFor(b.text, b.size, w - (b.pill ? b.pill.padX * 2 : 0), { script, caps: b.caps, weight: b.weight, max: b.maxLines });
  return Math.ceil(lines * b.size * lh + (b.pill ? b.pill.padY * 2 : 0) + b.size * 0.15);
}

/**
 * Places text blocks down a column, each as tall as its words need, and returns where it
 * stopped. When the words would run past `limit` (the call to action, the panel), every block
 * shrinks together until they fit — down to three fifths of its size.
 */
function column(out: CreativeLayer[], x: number, y: number, w: number, input: Block[], script: 'latin' | 'indic', limit?: number): number {
  const shown = input.filter((b) => b.text.trim());
  const total = (k: number): number => shown.reduce((sum, b) => sum + blockHeight(scaled(b, k), w, script) + scaled(b, k).gap, 0);
  let k = 1;
  if (limit !== undefined) {
    while (k > 0.6 && y + total(k) > limit) k -= 0.04;
  }
  const blocks = shown.map((b) => scaled(b, k));
  let at = y;
  for (const b of blocks) {
    const lh = b.lineHeight ?? 1.15;
    const h = blockHeight(b, w, script);
    out.push(
      textLayer(b.role, b.name, b.text, { x, y: at, w, h }, {
        font: b.font,
        size: b.size,
        weight: b.weight,
        color: b.color,
        caps: b.caps,
        align: b.align ?? 'left',
        letterSpacing: b.letterSpacing ?? 0,
        lineHeight: lh,
        maxLines: b.maxLines,
        opacity: b.opacity ?? 1,
        pill: b.pill,
        shadow: b.pill ? undefined : { color: 'rgba(0,0,0,0.35)', blur: Math.round(b.size * 0.25), x: 0, y: Math.round(b.size * 0.04) },
      }),
    );
    at += h + b.gap;
  }
  return at;
}

const pill = (bg: string, size: number) => ({ color: bg, padX: Math.round(size * 0.9), padY: Math.round(size * 0.45), radius: Math.round(size * 0.9) });

/** The call to action and the small print, at the foot of the area. */
function footOfArea(out: CreativeLayer[], fr: Frame, parts: Parts, area: Parts['area'], copy: CreativeCopy, wd: Words, align: TextLayer['align'], width = area.w): number {
  let bottom = area.y + area.h;
  if (copy.terms.trim() && !parts.inPanel.terms) {
    const size = Math.round(fr.S * (fr.wide ? 0.024 : 0.018));
    const lines = linesFor(copy.terms, size, width, { script: wd.script, weight: 400, max: 2 });
    const h = Math.ceil(lines * size * 1.25 + size * 0.2);
    bottom -= h;
    out.push(textLayer('terms', 'Small print', copy.terms, { x: area.x, y: bottom, w: width, h }, { font: wd.text, size, weight: 400, color: wd.fg, opacity: 0.8, align, lineHeight: 1.25, maxLines: 2 }));
    bottom -= Math.round(fr.S * 0.015);
  }
  if (copy.cta.trim() && !parts.inPanel.cta) {
    const size = Math.round(fr.S * (fr.wide ? 0.042 : 0.034));
    const p = pill(wd.accent, size);
    const h = Math.round(size * 1.2 + p.padY * 2);
    bottom -= h;
    out.push(textLayer('cta', 'Call to action', copy.cta, { x: area.x, y: bottom, w: width, h }, { font: wd.text, size, weight: 700, color: wd.onAccent, align, pill: p, maxLines: 1 }));
  }
  return bottom;
}

/**
 * Where a column of words must stop. Over a picture on a square, portrait or story, the words
 * keep to the upper part so the vehicle below has the rest; the picture is asked to keep that
 * band calm (see wordsBand).
 */
const columnEnd = (input: LayoutInput, fr: Frame, foot: number): number =>
  input.picture && !fr.wide ? Math.min(foot, Math.round(fr.H * (fr.tall ? 0.46 : 0.54))) : foot;

/* ---- templates ---- */

function hero(input: LayoutInput, fr: Frame): CreativeLayer[] {
  const wd = wordsFor(input);
  const c = input.copy;
  if (fr.wide) {
    const parts = basics(input, fr, 'left');
    const out = parts.layers;
    const colW = Math.round(fr.W * 0.5) - fr.m;
    const a = { ...parts.area, w: colW };
    const foot = footOfArea(out, fr, parts, a, c, wd, 'left', colW);
    column(out, a.x, a.y, colW, [
      { role: 'kicker', name: 'Kicker', text: c.kicker, size: Math.round(fr.S * 0.04), weight: 700, font: wd.text, color: wd.accent, gap: Math.round(fr.S * 0.015), maxLines: 1, caps: true, letterSpacing: 0.08 },
      { role: 'headline', name: 'Headline', text: c.headline, size: Math.round(fr.S * 0.1), weight: 800, font: wd.display, color: wd.fg, gap: Math.round(fr.S * 0.025), maxLines: 3, lineHeight: 1.08 },
      { role: 'sub', name: 'Second line', text: c.sub, size: Math.round(fr.S * 0.045), weight: 500, font: wd.text, color: wd.fg, gap: Math.round(fr.S * 0.02), maxLines: foot - a.y < fr.S * 0.55 ? 1 : 2, opacity: 0.92 },
    ], wd.script, columnEnd(input, fr, foot - Math.round(fr.S * 0.02)));
    return out;
  }
  const parts = basics(input, fr, 'both');
  const out = parts.layers;
  const a = parts.area;
  const foot = footOfArea(out, fr, parts, a, c, wd, 'left');
  const points = c.points.length ? c.points.map((p) => `•  ${p}`).join('\n') : '';
  column(out, a.x, a.y, a.w, [
    { role: 'kicker', name: 'Kicker', text: c.kicker, size: Math.round(fr.S * 0.034), weight: 700, font: wd.text, color: wd.accent, gap: Math.round(fr.S * 0.012), maxLines: 1, caps: true, letterSpacing: 0.08 },
    { role: 'headline', name: 'Headline', text: c.headline, size: Math.round(fr.S * (fr.tall ? 0.098 : 0.086)), weight: 800, font: wd.display, color: wd.fg, gap: Math.round(fr.S * 0.02), maxLines: 3, lineHeight: 1.08 },
    { role: 'sub', name: 'Second line', text: c.sub, size: Math.round(fr.S * 0.038), weight: 500, font: wd.text, color: wd.fg, gap: Math.round(fr.S * 0.02), maxLines: 3, opacity: 0.92 },
    { role: 'points', name: 'Points', text: points, size: Math.round(fr.S * 0.032), weight: 600, font: wd.text, color: wd.fg, gap: 0, maxLines: 4, lineHeight: 1.4 },
  ], wd.script, columnEnd(input, fr, foot - Math.round(fr.S * 0.02)));
  return out;
}

function offer(input: LayoutInput, fr: Frame): CreativeLayer[] {
  const wd = wordsFor(input);
  const c = input.copy;
  const parts = basics(input, fr, fr.wide ? 'left' : 'both');
  const out = parts.layers;
  const colW = fr.wide ? Math.round(fr.W * 0.52) - fr.m : parts.area.w;
  const a = { ...parts.area, w: colW };
  const foot = footOfArea(out, fr, parts, a, c, wd, 'left', colW);
  const badgeSize = Math.round(fr.S * (fr.wide ? 0.07 : fr.tall ? 0.07 : 0.062));
  const others = c.points.map((p) => `•  ${p}`).join('\n');
  column(out, a.x, a.y, colW, [
    { role: 'kicker', name: 'Kicker', text: c.kicker, size: Math.round(fr.S * 0.034), weight: 700, font: wd.text, color: wd.accent, gap: Math.round(fr.S * 0.012), maxLines: 1, caps: true, letterSpacing: 0.08 },
    { role: 'headline', name: 'Headline', text: c.headline, size: Math.round(fr.S * (fr.wide ? 0.085 : 0.075)), weight: 800, font: wd.display, color: wd.fg, gap: Math.round(fr.S * 0.03), maxLines: 2, lineHeight: 1.08 },
    { role: 'badge', name: 'Offer badge', text: c.badge, size: badgeSize, weight: 800, font: wd.script === 'indic' ? 'mukta' : 'oswald', color: wd.onAccent, gap: Math.round(fr.S * 0.03), maxLines: 2, lineHeight: 1.05, pill: { color: wd.accent, padX: Math.round(badgeSize * 0.55), padY: Math.round(badgeSize * 0.32), radius: Math.round(badgeSize * 0.25) } },
    { role: 'points', name: 'More offers', text: others, size: Math.round(fr.S * (fr.wide ? 0.038 : 0.032)), weight: 600, font: wd.text, color: wd.fg, gap: Math.round(fr.S * 0.015), maxLines: fr.wide ? 2 : 3, lineHeight: 1.35 },
    { role: 'sub', name: 'Second line', text: c.sub, size: Math.round(fr.S * (fr.wide ? 0.036 : 0.03)), weight: 500, font: wd.text, color: wd.fg, gap: 0, maxLines: 2, opacity: 0.9 },
  ], wd.script, columnEnd(input, fr, foot - Math.round(fr.S * 0.02)));
  return out;
}

function festival(input: LayoutInput, fr: Frame): CreativeLayer[] {
  const wd = wordsFor(input);
  const c = input.copy;
  const parts = basics(input, fr, fr.wide ? 'left' : 'top');
  const out = parts.layers;
  if (fr.wide) {
    const colW = Math.round(fr.W * 0.5) - fr.m;
    const a = { ...parts.area, w: colW };
    const foot = footOfArea(out, fr, parts, a, c, wd, 'left', colW);
    column(out, a.x, a.y + Math.round(fr.S * 0.03), colW, [
      { role: 'kicker', name: 'Kicker', text: c.kicker, size: Math.round(fr.S * 0.04), weight: 600, font: wd.text, color: wd.accent, gap: Math.round(fr.S * 0.012), maxLines: 1, caps: true, letterSpacing: 0.12 },
      { role: 'headline', name: 'Greeting', text: c.headline, size: Math.round(fr.S * 0.11), weight: 700, font: wd.display, color: wd.fg, gap: Math.round(fr.S * 0.025), maxLines: 2, lineHeight: 1.05 },
      { role: 'sub', name: 'Wish', text: c.sub, size: Math.round(fr.S * 0.045), weight: 500, font: wd.text, color: wd.fg, gap: 0, maxLines: 3, opacity: 0.92, lineHeight: 1.3 },
    ], wd.script, columnEnd(input, fr, foot - Math.round(fr.S * 0.02)));
    return out;
  }
  const a = parts.area;
  const foot = footOfArea(out, fr, parts, a, c, wd, 'center');
  column(out, a.x, a.y + Math.round(fr.S * 0.02), a.w, [
    { role: 'kicker', name: 'Kicker', text: c.kicker, size: Math.round(fr.S * 0.034), weight: 600, font: wd.text, color: wd.accent, gap: Math.round(fr.S * 0.012), maxLines: 1, caps: true, letterSpacing: 0.14, align: 'center' },
    { role: 'headline', name: 'Greeting', text: c.headline, size: Math.round(fr.S * (fr.tall ? 0.12 : 0.105)), weight: 700, font: wd.display, color: wd.fg, gap: Math.round(fr.S * 0.02), maxLines: 2, lineHeight: 1.05, align: 'center' },
    { role: 'sub', name: 'Wish', text: c.sub, size: Math.round(fr.S * 0.038), weight: 500, font: wd.text, color: wd.fg, gap: 0, maxLines: 3, opacity: 0.92, align: 'center', lineHeight: 1.3 },
  ], wd.script, columnEnd(input, fr, foot - Math.round(fr.S * 0.02)));
  return out;
}

function feature(input: LayoutInput, fr: Frame): CreativeLayer[] {
  const wd = wordsFor(input);
  const c = input.copy;
  const parts = basics(input, fr, fr.wide ? 'left' : 'both', c.points.length > 0);
  const out = parts.layers;
  const colW = fr.wide ? Math.round(fr.W * 0.52) - fr.m : parts.area.w;
  const a = { ...parts.area, w: colW };
  const foot = footOfArea(out, fr, parts, a, c, wd, 'left', colW);
  const top = column(out, a.x, a.y, colW, [
    { role: 'kicker', name: 'Kicker', text: c.kicker, size: Math.round(fr.S * 0.034), weight: 700, font: wd.text, color: wd.accent, gap: Math.round(fr.S * 0.012), maxLines: 1, caps: true, letterSpacing: 0.08 },
    { role: 'headline', name: 'Headline', text: c.headline, size: Math.round(fr.S * (fr.wide ? 0.085 : 0.078)), weight: 800, font: wd.display, color: wd.fg, gap: Math.round(fr.S * 0.018), maxLines: 3, lineHeight: 1.08 },
    { role: 'sub', name: 'Second line', text: fr.wide ? '' : c.sub, size: Math.round(fr.S * 0.034), weight: 500, font: wd.text, color: wd.fg, gap: 0, maxLines: 2, opacity: 0.92 },
  ], wd.script, columnEnd(input, fr, c.points.length ? fr.H : foot - Math.round(fr.S * 0.02)));
  if (c.points.length) {
    // The points sit low, over the bottom shade, each marked in the accent colour.
    const size = Math.round(fr.S * (fr.wide ? 0.04 : 0.036));
    const n = Math.min(4, c.points.length);
    const text = c.points.slice(0, 4).map((p) => `✓  ${p}`).join('\n');
    const lines = linesFor(text, size, colW - Math.round(fr.S * 0.03), { script: wd.script, weight: 600, max: n * 2 });
    const h = Math.ceil(lines * size * 1.42 + size * 0.2);
    const y = Math.max(top + Math.round(fr.S * 0.02), foot - h - Math.round(fr.S * 0.03));
    out.push(shape('accent', 'Points bar', { x: a.x, y: y + Math.round(size * 0.2), w: Math.max(4, Math.round(fr.S * 0.008)), h: h - Math.round(size * 0.4) }, { fill: wd.accent }));
    out.push(textLayer('points', 'Points', text, { x: a.x + Math.round(fr.S * 0.03), y, w: colW - Math.round(fr.S * 0.03), h }, { font: wd.text, size, weight: 600, color: wd.fg, lineHeight: 1.42, maxLines: n * 2, shadow: { color: 'rgba(0,0,0,0.35)', blur: 8, x: 0, y: 2 } }));
  }
  return out;
}

function launch(input: LayoutInput, fr: Frame): CreativeLayer[] {
  const wd = wordsFor(input);
  const c = input.copy;
  const parts = basics(input, fr, fr.wide ? 'left' : 'both');
  const out = parts.layers;
  const colW = fr.wide ? Math.round(fr.W * 0.55) - fr.m : parts.area.w;
  const a = { ...parts.area, w: colW };
  const align: TextLayer['align'] = fr.wide ? 'left' : 'center';
  const foot = footOfArea(out, fr, parts, a, c, wd, align, colW);
  column(out, a.x, a.y + Math.round(fr.S * 0.02), colW, [
    { role: 'kicker', name: 'Stage', text: c.kicker, size: Math.round(fr.S * 0.04), weight: 800, font: wd.text, color: wd.onAccent, gap: Math.round(fr.S * 0.025), maxLines: 1, caps: true, letterSpacing: 0.14, align, pill: { color: wd.accent, padX: Math.round(fr.S * 0.03), padY: Math.round(fr.S * 0.012), radius: Math.round(fr.S * 0.008) } },
    { role: 'headline', name: 'Headline', text: c.headline, size: Math.round(fr.S * (fr.tall ? 0.11 : 0.095)), weight: 900, font: wd.script === 'indic' ? 'mukta' : 'montserrat', color: wd.fg, gap: Math.round(fr.S * 0.02), maxLines: 3, caps: wd.script === 'latin', lineHeight: 1.02, align, letterSpacing: 0.01 },
    { role: 'sub', name: 'Date', text: c.sub, size: Math.round(fr.S * 0.045), weight: 600, font: wd.text, color: wd.fg, gap: 0, maxLines: 2, align, opacity: 0.95 },
  ], wd.script, columnEnd(input, fr, foot - Math.round(fr.S * 0.02)));
  return out;
}

function delivery(input: LayoutInput, fr: Frame): CreativeLayer[] {
  const wd = wordsFor(input);
  const c = input.copy;
  const parts = basics(input, fr, fr.wide ? 'left' : 'top');
  const out = parts.layers;
  const colW = fr.wide ? Math.round(fr.W * 0.5) - fr.m : parts.area.w;
  const a = { ...parts.area, w: colW };
  const align: TextLayer['align'] = fr.wide ? 'left' : 'center';
  const foot = footOfArea(out, fr, parts, a, c, wd, align, colW);
  column(out, a.x, a.y + Math.round(fr.S * 0.015), colW, [
    { role: 'kicker', name: 'Congratulations', text: c.kicker, size: Math.round(fr.S * 0.042), weight: 600, font: wd.script === 'indic' ? 'mukta' : 'dmserif', color: wd.accent, gap: Math.round(fr.S * 0.008), maxLines: 1, align, letterSpacing: 0.02 },
    { role: 'headline', name: 'Customer', text: c.headline, size: Math.round(fr.S * (fr.tall ? 0.1 : 0.09)), weight: 700, font: wd.display, color: wd.fg, gap: Math.round(fr.S * 0.018), maxLines: 2, lineHeight: 1.05, align },
    { role: 'sub', name: 'Welcome', text: c.sub, size: Math.round(fr.S * 0.036), weight: 500, font: wd.text, color: wd.fg, gap: 0, maxLines: 3, opacity: 0.92, align, lineHeight: 1.3 },
  ], wd.script, columnEnd(input, fr, foot - Math.round(fr.S * 0.02)));
  return out;
}

const BUILDERS: Record<CreativeTemplateId, (input: LayoutInput, fr: Frame) => CreativeLayer[]> = { hero, offer, festival, feature, launch, delivery };

/** A creative laid out for one size from the copy, the look and the client's logos. */
export function layoutCreative(input: LayoutInput): CreativeDoc {
  const fr = frameOf(input.format);
  const f = CREATIVE_FORMAT_BY_ID[input.format];
  const layers = (BUILDERS[input.template] ?? hero)(input, fr);
  return { version: 1, format: input.format, width: f.width, height: f.height, background: input.look.panel, layers };
}

const TOP_WORDS = new Set<LayerRole | undefined>(['kicker', 'headline', 'sub', 'badge', 'points']);
/**
 * How far down the frame a creative's words reach from the top, as a fraction of its height —
 * so the picture made for it can keep that band calm. Words set low (a points list over the foot
 * shade, the panel) are not counted.
 */
export function wordsBand(doc: CreativeDoc): number {
  const top = doc.layers.filter((l): l is TextLayer => l.kind === 'text' && !l.hidden && Boolean(l.text.trim()) && TOP_WORDS.has(l.role) && l.y < doc.height * 0.6);
  if (!top.length) return 0.33;
  const reach = Math.max(...top.map((l) => l.y + l.h)) / doc.height;
  return Math.min(0.6, Math.max(0.3, Math.ceil(reach * 20) / 20));
}

/**
 * New words from the copy, written into a creative someone has already changed: every layer
 * the app placed takes its new text, and everything the designer did — moves, sizes, colours,
 * their own layers — stays.
 */
export function applyCopyToCreative(doc: CreativeDoc, copy: CreativeCopy): CreativeDoc {
  const textFor = (role?: LayerRole): string | undefined => {
    switch (role) {
      case 'headline':
        return copy.headline;
      case 'kicker':
        return copy.kicker;
      case 'sub':
        return copy.sub;
      case 'badge':
        return copy.badge;
      case 'points':
        return copy.points.length ? copy.points.map((p) => `•  ${p}`).join('\n') : undefined;
      case 'cta':
        return copy.cta;
      case 'terms':
        return copy.terms;
      default:
        return undefined;
    }
  };
  return {
    ...doc,
    layers: doc.layers.map((l) => {
      if (l.kind !== 'text') return l;
      const t = textFor(l.role);
      if (t === undefined) return l;
      // A points list keeps the marks the layout gave it.
      const text = l.role === 'points' && /^✓/.test(l.text) ? copy.points.map((p) => `✓  ${p}`).join('\n') : t;
      return { ...l, text };
    }),
  };
}
