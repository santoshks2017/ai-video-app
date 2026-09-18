/**
 * A creative Nano Banana 2 designs: the scene, the real car and the words, set as one
 * picture — with the client's exact logos and dealer panel laid over it by the app, so a
 * logo, an address or a phone number is never redrawn by a model.
 *
 * What the model is asked to set is kept beside the picture, and the words it actually set
 * are read back and compared: a wrong price, a dropped asterisk or an invented line is caught
 * before anyone downloads the creative.
 */
import { CREATIVE_FORMAT_BY_ID, isAdFormat, type CreativeDoc } from './creative.js';
import type { CreativeCopy } from './creativeCopy.js';
import { adTerms, panelCarries, type LayoutInput } from './creativeLayout.js';

/** The dealership's strip at the foot of a design, set by the model like everything else. */
export interface DesignStrip {
  /** The dealership's name, bold. */
  name: string;
  /** Address, phone and website, each a line as it should read. */
  lines: string[];
  /** The button on the strip, when the strip carries it. */
  cta: string;
}

/** Every word the model sets on a design, exactly. */
export interface DesignWords {
  kicker: string;
  headline: string;
  sub: string;
  badge: string;
  points: string[];
  /** The button beside the words — empty when the strip carries it. */
  cta: string;
  /** The dealership strip; absent when the client wants none, or on a banner. */
  strip?: DesignStrip;
  /** The small print, last and smallest. */
  terms: string;
}

/**
 * The words for the model from the copy and the size. A full strip carries the button on a
 * square, portrait or story; a one-line strip is the name and contact in one line. A banner is
 * seen small, so it carries fewer: no points, no strip, and on a rectangle no second line.
 */
export function designWordsOf(copy: CreativeCopy, input: Pick<LayoutInput, 'format' | 'panel' | 'copy' | 'look' | 'logos' | 'template'>): DesignWords {
  const f = CREATIVE_FORMAT_BY_ID[input.format];
  const ad = isAdFormat(input.format);
  const roomy = f.height >= f.width * 1.5;
  const style = input.format === 'thumbnail' && input.panel.style === 'full' ? 'compact' : input.panel.style;
  const hasStrip = !ad && style !== 'none' && Boolean(input.panel.name || input.panel.details.length);
  const carries = panelCarries({ ...(input as LayoutInput), copy }).cta;
  const strip: DesignStrip | undefined = !hasStrip
    ? undefined
    : style === 'compact'
      ? { name: '', lines: [[input.panel.name, ...input.panel.details].filter(Boolean).join('  ·  ')], cta: '' }
      : { name: input.panel.name, lines: input.panel.details.slice(0, 2), cta: carries ? copy.cta.trim() : '' };
  return {
    kicker: copy.kicker.trim(),
    headline: copy.headline.trim(),
    sub: ad && !roomy ? '' : copy.sub.trim(),
    badge: copy.badge.trim(),
    points: ad ? [] : copy.points.map((p) => p.trim()).filter(Boolean),
    cta: strip?.cta ? '' : copy.cta.trim(),
    ...(strip ? { strip } : {}),
    terms: ad ? adTerms(copy.terms) : copy.terms.trim(),
  };
}

/** Every line the model is asked to set, in reading order. */
export const designLines = (w: DesignWords): string[] =>
  [w.kicker, w.headline, w.sub, w.badge, ...w.points, w.cta, w.strip?.name ?? '', ...(w.strip?.lines ?? []), w.strip?.cta ?? '', w.terms ?? '']
    .map((s) => s.trim())
    .filter(Boolean);

/** Whether two sets of words would put the same text on the picture. */
export const sameDesignWords = (a: DesignWords, b: DesignWords): boolean => designLines(a).join('\n') === designLines(b).join('\n');

/** What reading the words back found. */
export interface WordsVerdict {
  /** False when the words could not be read back; then nothing below is known. */
  checked: boolean;
  ok: boolean;
  /** Lines asked for that are not on the picture as written. */
  missing: string[];
  /** Words on the picture that were never asked for. */
  extra: string[];
}

export const UNREAD_WORDS: WordsVerdict = { checked: false, ok: true, missing: [], extra: [] };

/**
 * A line as it is compared: case, spacing, quotes and dashes set aside, and punctuation too —
 * except inside a number, and the ₹, % and * that make a claim what it is. Letters of every
 * script keep their marks, so a Devanagari matra still counts.
 */
export function normWords(s: string): string {
  return s
    .normalize('NFKC')
    .toLocaleLowerCase('en-IN')
    .replace(/[‘’“”"'`´]/g, '')
    // A separator stays only between two digits: ₹2,15,000 keeps its commas, a sentence loses its full stop.
    .replace(/(?<!\d)[.,]|[.,](?!\d)/g, '')
    .replace(/[^\p{L}\p{M}\p{N}₹%*.,]+/gu, '');
}

/**
 * The words asked for against the words read off the picture. A line counts as set when its
 * words appear in order in what was read, whatever the line breaks; anything read that belongs
 * to no line asked for — and is not the vehicle's own badge — is extra.
 */
export function compareWords(expected: DesignWords, seen: string[], allowed: string[] = []): WordsVerdict {
  const lines = designLines(expected);
  const read = seen.map(normWords).filter(Boolean);
  const all = read.join('');
  const missing = lines.filter((l) => {
    const n = normWords(l);
    return n.length > 0 && !all.includes(n);
  });
  const asked = lines.map(normWords).join('|');
  const badge = allowed.map(normWords).filter(Boolean);
  const extra = seen.filter((s) => {
    const n = normWords(s);
    // Nothing, or a single mark — an emblem read as a letter.
    if (n.length <= 1) return false;
    if (asked.includes(n)) return false;
    // The maker's badge on the car, or its model name, as it is on the car itself.
    if (badge.some((b) => b === n || b.includes(n) || n.includes(b))) return false;
    // A fragment of a line asked for, read on its own (a word broken across lines).
    return !lines.some((l) => normWords(l).includes(n));
  });
  return { checked: true, ok: missing.length === 0 && extra.length === 0, missing, extra: extra.map((s) => s.trim()).filter(Boolean) };
}

/** Whether the client's logos stayed as they were put on the canvas, and nothing else was branded. */
export interface LogosVerdict {
  checked: boolean;
  /** The logos are where they were, as they were. */
  kept: boolean;
  /** Logos or brand marks drawn beyond the client's own (the vehicle's badge aside). */
  extra: number;
  /** How far the logo pixels moved from the canvas, 0–255, for the record. */
  drift?: number;
}
export const UNCHECKED_LOGOS: LogosVerdict = { checked: false, kept: true, extra: 0 };

/** How bad a verdict is, to keep the better of two attempts. */
export const verdictWeight = (vehicle: { same: boolean; checked: boolean }, words: WordsVerdict, logos: LogosVerdict = UNCHECKED_LOGOS): number =>
  (vehicle.checked && !vehicle.same ? 3 : 0) +
  (words.checked ? words.missing.length * 2 + words.extra.length : 0) +
  (logos.checked ? (logos.kept ? 0 : 3) + logos.extra * 2 : 0);

/**
 * The parts of the frame the app covers, as fractions of its height: the row the logos sit
 * in, and where the dealer panel (or the small print at the foot) begins. The model keeps the
 * logo corners plain and puts nothing important below the strip.
 */
export interface DesignZones {
  /** From the top: the logo row, 0 when there are no logos. */
  logoBand: number;
  /** From the top: where the covered strip at the foot begins; 1 when nothing covers the foot. */
  stripTop: number;
  /** Logos are white on dark ground, or in colour on light. */
  logoTone: 'dark' | 'light';
  /** Where the words go: above the vehicle, or beside it. */
  textSide: 'top' | 'left';
}

/** The zones of a creative laid out for a designed picture. */
export function designZonesOf(doc: CreativeDoc, logoTone: 'dark' | 'light'): DesignZones {
  const H = doc.height;
  const logos = doc.layers.filter((l) => l.role === 'dealer-logo' || l.role === 'brand-logo');
  const panel = doc.layers.find((l) => l.role === 'panel');
  const foot = doc.layers.filter((l) => l.role === 'terms' && (!panel || l.y < panel.y));
  const tops = [panel?.y, ...foot.map((l) => l.y)].filter((v): v is number => typeof v === 'number');
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return {
    logoBand: logos.length ? round(Math.max(...logos.map((l) => l.y + l.h)) / H) : 0,
    stripTop: tops.length ? round(Math.min(...tops) / H) : 1,
    logoTone,
    textSide: doc.width / doc.height > 1.3 ? 'left' : 'top',
  };
}
