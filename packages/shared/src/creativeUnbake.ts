/**
 * Taking a designed creative apart. Nano Banana 2 paints its words into the pixels, so there
 * are no layers to reveal — the app rebuilds them: the design with everything removed as the
 * picture underneath, and one text layer per block read off the original, each given the role
 * its words match so copy edits still reach it. A close reconstruction, not a lossless one:
 * the faces are the app's nearest fonts, not the model's lettering.
 */
import {
  CREATIVE_FORMAT_BY_ID,
  creativeUid,
  type CreativeDoc,
  type CreativeFormatId,
  type CreativeLayer,
  type ImageLayer,
  type LayerRole,
  type TextLayer,
} from './creative.js';
import type { CreativeTemplateId } from './creativeEngines.js';
import type { DesignWords } from './creativeDesign.js';

/** A block of words read off a finished design, with where and how it sits. */
export interface ReadBlock {
  text: string;
  /** Its box as fractions of the whole picture: x,y the top-left corner, w,h the size. */
  box: { x: number; y: number; w: number; h: number };
  /** The letters' colour, as #rrggbb. */
  color?: string;
  weight?: 'bold' | 'regular';
  align?: 'left' | 'center' | 'right';
  /** How many lines the block runs over. */
  lines?: number;
}

export interface UnbakeInput {
  format: CreativeFormatId;
  /** The words the design was made with — what gives each block its role. */
  words: DesignWords;
  look: { panel: string; accent: string };
  /** Sets the headline's face. Unset: the hero's. */
  template?: CreativeTemplateId;
  /** The design with every word and logo removed. */
  clean: { src: string; storagePath?: string };
  blocks: ReadBlock[];
  /** The client's logo layers, exactly as the design lays them. */
  logos: CreativeLayer[];
}

/** The headline face of each layout character; everything else is set in the body face. */
const HEAD_FONT: Record<CreativeTemplateId, string> = {
  hero: 'poppins',
  offer: 'anton',
  festival: 'playfair',
  feature: 'poppins',
  launch: 'bebas',
  delivery: 'dmserif',
};

const NAME_OF: Partial<Record<LayerRole, string>> = {
  headline: 'Headline',
  kicker: 'Kicker',
  sub: 'Second line',
  badge: 'Badge',
  points: 'Points',
  cta: 'Button',
  terms: 'Small print',
  'panel-name': 'Dealer name',
  'panel-details': 'Dealer details',
};

const tidy = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[✓•*"“”'’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The role a block's words match in the design's own words, so copy edits reach the layer. */
export function roleOfBlock(text: string, words: DesignWords): LayerRole | undefined {
  const t = tidy(text);
  if (!t) return undefined;
  const same = (v?: string): boolean => Boolean(v) && tidy(v!) === t;
  // The reading may split a block over lines or join two — either way round, one holds the other.
  const holds = (v?: string): boolean => {
    const w = v ? tidy(v) : '';
    return w.length >= 4 && t.length >= 4 && (t.includes(w) || w.includes(t));
  };
  const passes: Array<(v?: string) => boolean> = [same, holds];
  for (const fits of passes) {
    if (fits(words.headline)) return 'headline';
    if (fits(words.badge)) return 'badge';
    if (fits(words.cta) || fits(words.strip?.cta)) return 'cta';
    if (fits(words.kicker)) return 'kicker';
    if (fits(words.sub)) return 'sub';
    if (fits(words.terms)) return 'terms';
    if (fits(words.strip?.name)) return 'panel-name';
    if (words.points.some((p) => fits(p))) return 'points';
    if ((words.strip?.lines ?? []).some((l) => fits(l))) return 'panel-details';
  }
  return undefined;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const unit = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * A designed creative rebuilt as layers: the clean picture under, one editable text layer per
 * block — in its place, its colour and its nearest face — and the logos back on top.
 */
export function unbakeDesign(input: UnbakeInput): CreativeDoc {
  const f = CREATIVE_FORMAT_BY_ID[input.format];
  const headFont = HEAD_FONT[input.template ?? 'hero'] ?? 'poppins';
  const background: ImageLayer = {
    id: creativeUid(),
    kind: 'image',
    name: 'Design, words removed',
    role: 'background',
    rotation: 0,
    opacity: 1,
    x: 0,
    y: 0,
    w: f.width,
    h: f.height,
    fit: 'cover',
    focusX: 0.5,
    focusY: 0.5,
    zoom: 1,
    src: input.clean.src,
    ...(input.clean.storagePath ? { storagePath: input.clean.storagePath } : {}),
  };
  const texts: TextLayer[] = input.blocks
    .filter((b) => b.text.trim() && b.box && b.box.w > 0 && b.box.h > 0)
    .map((b) => {
      const role = roleOfBlock(b.text, input.words);
      const x = Math.round(unit(b.box.x) * f.width);
      const y = Math.round(unit(b.box.y) * f.height);
      const w = Math.max(24, Math.round(unit(b.box.w) * f.width));
      const h = Math.max(14, Math.round(unit(b.box.h) * f.height));
      const lines = Math.max(1, Math.round(b.lines ?? (b.text.match(/\n/g)?.length ?? 0) + 1));
      const size = Math.max(10, Math.round(h / lines / 1.15));
      const pill = role === 'badge' || role === 'cta';
      return {
        id: creativeUid(),
        kind: 'text' as const,
        name: (role && NAME_OF[role]) || 'Words',
        ...(role ? { role } : {}),
        rotation: 0,
        opacity: 1,
        x,
        y,
        w,
        h,
        text: b.text,
        font: role === 'headline' || role === 'kicker' ? headFont : role === 'terms' ? 'inter' : 'poppins',
        size,
        weight: b.weight === 'regular' ? 500 : 700,
        color: pill ? '#FFFFFF' : HEX.test(b.color ?? '') ? b.color! : '#FFFFFF',
        align: b.align ?? 'left',
        valign: 'middle' as const,
        lineHeight: 1.12,
        letterSpacing: 0,
        ...(pill ? { pill: { color: input.look.accent, padX: Math.round(size * 0.7), padY: Math.round(size * 0.4), radius: Math.round(size * 1.2) } } : {}),
      };
    })
    .sort((a, b) => a.y - b.y);
  return { version: 1, format: input.format, width: f.width, height: f.height, background: input.look.panel, layers: [background, ...texts, ...input.logos] };
}
