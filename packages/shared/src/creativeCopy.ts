/**
 * The words of a creative, and the rules they keep whatever the model wrote.
 *
 * The orchestrator's universal rules are applied after writing, not only asked for: ₹ amounts
 * are formatted the Indian way, a price claim carries an asterisk and the picture a T&C line,
 * the caption ends in the client's own contact block, and the hashtag set has its three tiers.
 */
import { overlayTheme, type OverlayTheme } from './overlayLook.js';

export interface CreativeCopy {
  /** The line the eye lands on. */
  headline: string;
  /** Other headlines to switch to. */
  alternatives: string[];
  /** A small line above the headline ("Congratulations", "Bookings open"). */
  kicker: string;
  /** The line under the headline. */
  sub: string;
  /** The offer or number in a badge ("Benefits up to ₹50,000*"). Empty: no badge. */
  badge: string;
  /** Up to four short points. */
  points: string[];
  cta: string;
  /** The small print. Filled when any claim carries an asterisk. */
  terms: string;
  /** The post's caption, contact block included. */
  caption: string;
  hashtags: string[];
  /** Instagram search keywords after the hashtags, "(…)" or "[…]", when the client uses them. */
  seo: string;
}

export const emptyCopy = (): CreativeCopy => ({
  headline: '',
  alternatives: [],
  kicker: '',
  sub: '',
  badge: '',
  points: [],
  cta: '',
  terms: '',
  caption: '',
  hashtags: [],
  seo: '',
});

/** How long each line may run on the picture, in characters, before the layout would have to shrink it too far. */
export const COPY_LIMITS = { headline: 60, kicker: 32, sub: 110, badge: 42, point: 60, cta: 28, terms: 160 } as const;
/** Written for Indian scripts, which run wider per character. */
export const COPY_LIMITS_NATIVE = { headline: 40, kicker: 24, sub: 80, badge: 32, point: 42, cta: 22, terms: 140 } as const;

/* ---- rupees ---- */

/** 215000 → "2,15,000" (lakh grouping). */
export function indianGrouping(n: number): string {
  const [whole, frac] = Math.abs(n).toFixed(n % 1 ? 2 : 0).split('.') as [string, string | undefined];
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${n < 0 ? '-' : ''}${grouped}${frac && Number(frac) ? `.${frac.replace(/0+$/, '')}` : ''}`;
}

/**
 * Every rupee amount written "₹2,15,000": "Rs. 215000", "INR 2.15 lakh" and "₹ 50K" alike.
 * Lakh and crore stay words ("₹10.99 Lakh"); a K becomes the full number.
 */
export function formatRupees(text: string): string {
  return text.replace(/(?:₹|\bRs\.?|\bINR)\s*([\d][\d,]*(?:\.\d+)?)(?:\s*(k|lakhs?|lacs?|l|crores?|cr)\b)?/gi, (_m, num: string, unit?: string) => {
    const n = Number(num.replace(/,/g, ''));
    if (!Number.isFinite(n)) return _m;
    const u = unit?.toLowerCase();
    if (u === 'k') return `₹${indianGrouping(Math.round(n * 1000))}`;
    if (u && /^(l|lakhs?|lacs?)$/.test(u)) return `₹${num.includes('.') ? n : indianGrouping(n)} Lakh`;
    if (u && /^(cr|crores?)$/.test(u)) return `₹${num.includes('.') ? n : indianGrouping(n)} Crore`;
    return `₹${num.includes('.') && !/,/.test(num) && n < 1000 ? n : indianGrouping(n)}`;
  });
}

/** A line that promises money: an amount, an EMI, a benefit, a discount. */
export const isPriceClaim = (line: string): boolean =>
  /₹\s*\d|\bemi\b|\bbenefits?\b|\bcashback\b|\bdiscount\b|\bsave\b|\bsavings\b|\bexchange bonus\b|\bstarting at\b|\bprice\b/i.test(line);
/** The claim ends in an asterisk: "Benefits up to ₹50,000*". */
export const withAsterisk = (line: string): string => (!line.trim() || /\*\s*$/.test(line) ? line : `${line.replace(/\s+$/, '')}*`);

/* ---- the contact block ---- */

export interface CopyClient {
  name: string;
  kind?: 'dealer' | 'oem';
  brand?: string;
  city?: string;
  address?: string;
  phone?: string;
  website?: string;
  tagline?: string;
  /** The client's own contact strip, when set. */
  footerText?: string;
  instagram?: string;
}

/** The contact block a caption ends with, in one fixed format per client. */
export function contactBlock(c: CopyClient): string {
  if (c.kind === 'oem') {
    return [c.name, c.website ? `🌐 ${c.website}` : '', c.instagram ? `📷 ${c.instagram}` : ''].filter(Boolean).join('\n');
  }
  const where = [c.address?.trim(), c.city?.trim() && !c.address?.includes(c.city) ? c.city.trim() : ''].filter(Boolean).join(', ');
  return [
    `📍 ${c.name}${where ? ` | ${where}` : ''}`,
    c.phone ? `📞 ${c.phone}` : '',
    c.website ? `🌐 ${c.website}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/* ---- hashtags ---- */

const tag = (s: string): string => `#${s.replace(/[^\p{L}\p{N}]+/gu, '')}`;
/** The three tiers: brand, then model and dealer, then place and moment. */
export function baseHashtags(c: CopyClient, model?: string): string[] {
  const brand = (c.brand ?? '').trim();
  return [
    brand ? tag(brand) : '',
    brand ? tag(`${brand}India`) : '',
    model ? tag(model) : '',
    c.kind !== 'oem' && c.name ? tag(c.name) : '',
    c.city ? tag(c.city) : '',
  ].filter((t) => t.length > 1);
}
/** A clean set: #-prefixed, no spaces, no repeats (case-blind), the tier-1 and tier-2 tags first, at most `max`. */
export function tidyHashtags(tags: string[], must: string[], range: [number, number] = [8, 15]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...must, ...tags]) {
    const t = tag(raw.startsWith('#') ? raw.slice(1) : raw);
    if (t.length < 2 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.slice(0, range[1]);
}

/* ---- the whole copy ---- */

export interface TidyContext {
  client: CopyClient;
  model?: string;
  /** Offer validity, for the T&C line. */
  validity?: string;
  native?: boolean;
  hashtagRange?: [number, number];
}

const clip = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n + 1).replace(/\s+\S*$/, '');
  return cut.length > n * 0.6 ? cut : t.slice(0, n);
};

/**
 * The copy as it goes on the picture: rupees formatted, price claims asterisked with a T&C
 * line to answer them, each line inside its limit, the caption ending in the contact block,
 * and the hashtags in three tiers.
 */
export function tidyCopy(copy: CreativeCopy, ctx: TidyContext): CreativeCopy {
  const L = ctx.native ? COPY_LIMITS_NATIVE : COPY_LIMITS;
  const money = (s: string): string => formatRupees(s ?? '');
  const claim = (s: string): string => (isPriceClaim(s) ? withAsterisk(s) : s);
  const headline = claim(clip(money(copy.headline), L.headline));
  const sub = claim(clip(money(copy.sub), L.sub));
  const badge = claim(clip(money(copy.badge), L.badge));
  const points = (copy.points ?? []).map((p) => claim(clip(money(p), L.point))).filter(Boolean).slice(0, 4);
  const alternatives = (copy.alternatives ?? []).map((a) => claim(clip(money(a), L.headline))).filter((a) => a && a !== headline).slice(0, 3);
  const asterisked = [headline, sub, badge, ...points].some((s) => /\*\s*$/.test(s));
  const terms =
    copy.terms?.trim()
      ? clip(money(copy.terms), L.terms)
      : asterisked
        ? `*T&C apply.${ctx.validity ? ` Offer valid till ${ctx.validity}.` : ''} Benefits vary by variant and location.`
        : '';
  const block = contactBlock(ctx.client);
  let caption = money(copy.caption ?? '').trim();
  const firstLine = block.split('\n')[0]!.replace(/^📍\s*/, '');
  if (block && !caption.includes(firstLine) && !(ctx.client.phone && caption.includes(ctx.client.phone))) {
    caption = `${caption}\n\n${block}`.trim();
  }
  return {
    headline,
    alternatives,
    kicker: clip(copy.kicker ?? '', L.kicker),
    sub,
    badge,
    points,
    cta: clip(copy.cta ?? '', L.cta),
    terms,
    caption,
    hashtags: tidyHashtags(copy.hashtags ?? [], baseHashtags(ctx.client, ctx.model), ctx.hashtagRange),
    seo: (copy.seo ?? '').trim(),
  };
}

/* ---- colour ---- */

/** Manufacturer colours, from the orchestrator's brand table. */
export const OEM_PALETTES: Record<string, { primary: string; accent: string }> = {
  hyundai: { primary: '#003566', accent: '#00AAD4' },
  tata: { primary: '#003399', accent: '#00A0A0' },
  'tata motors': { primary: '#003399', accent: '#00A0A0' },
  honda: { primary: '#CC0000', accent: '#C0C0C0' },
  toyota: { primary: '#1A1A1A', accent: '#EB0A1E' },
  mahindra: { primary: '#1C3A1C', accent: '#B87333' },
  renault: { primary: '#000000', accent: '#FFD700' },
  byd: { primary: '#1B5E96', accent: '#00C851' },
  yamaha: { primary: '#003087', accent: '#CC0000' },
  'maruti suzuki': { primary: '#005BAA', accent: '#8A8A8A' },
  maruti: { primary: '#005BAA', accent: '#8A8A8A' },
  nexa: { primary: '#1A1A1A', accent: '#8C8C8C' },
  mg: { primary: '#1A1A1A', accent: '#CC2200' },
  'mg motor': { primary: '#1A1A1A', accent: '#CC2200' },
  kia: { primary: '#05141F', accent: '#BB162B' },
  skoda: { primary: '#0E3A2F', accent: '#4BA82E' },
  volkswagen: { primary: '#001E50', accent: '#00B0F0' },
  nissan: { primary: '#1A1A1A', accent: '#C3002F' },
};
export const oemPalette = (brand?: string): { primary: string; accent: string } | undefined =>
  brand ? OEM_PALETTES[brand.trim().toLowerCase()] : undefined;

/** Occasion colours, from the orchestrator: a festival post is dressed for the day. */
export const OCCASION_PALETTES: Record<string, { primary: string; accent: string }> = {
  Diwali: { primary: '#5C0A0A', accent: '#FFC53D' },
  Dhanteras: { primary: '#4A0E0E', accent: '#F2C14E' },
  'Bhai Dooj': { primary: '#5C0A0A', accent: '#FFB347' },
  Navratri: { primary: '#6A0D5E', accent: '#FF8C00' },
  'Durga Puja': { primary: '#7A0000', accent: '#FFD166' },
  Dussehra: { primary: '#6B1E00', accent: '#FF9933' },
  Holi: { primary: '#5B0E6B', accent: '#FFD200' },
  'Eid ul-Fitr': { primary: '#0B3D2E', accent: '#FFD700' },
  'Eid ul-Adha': { primary: '#0B3D2E', accent: '#FFD700' },
  Christmas: { primary: '#0E3B26', accent: '#E53935' },
  'New Year': { primary: '#0B1D3A', accent: '#F5C542' },
  'Independence Day': { primary: '#0D3B66', accent: '#FF9933' },
  'Republic Day': { primary: '#0D3B66', accent: '#FF9933' },
  'Ganesh Chaturthi': { primary: '#6B1414', accent: '#FF8F1F' },
  'Raksha Bandhan': { primary: '#6A1B4D', accent: '#FFB300' },
  Janmashtami: { primary: '#10265C', accent: '#F4C430' },
  Onam: { primary: '#2F4F1F', accent: '#FFC107' },
  'Makar Sankranti': { primary: '#0E4D92', accent: '#FFB300' },
  'Chhath Puja': { primary: '#7B2D00', accent: '#FFB74D' },
};

/** Where a creative's colours come from: a look from the video overlays, the manufacturer's, the occasion's, or chosen. */
export interface CreativeLookChoice {
  source: 'theme' | 'brand' | 'occasion' | 'custom';
  themeId?: string;
  custom?: { panel: string; accent: string };
}

/**
 * The colours a creative is drawn in, as an overlay theme: panel and text, accent, card and
 * its text. A brand or occasion palette goes through the custom-look rules, so text on it is
 * always readable and the accent always stands out.
 */
export function creativeLook(choice: CreativeLookChoice | undefined, ctx: { brand?: string; occasion?: string }): OverlayTheme {
  const c = choice ?? { source: 'theme' };
  if (c.source === 'brand') {
    const p = oemPalette(ctx.brand);
    if (p) return { ...overlayTheme('custom', { panel: p.primary, accent: p.accent }), id: 'brand', name: `${ctx.brand} colours` };
  }
  if (c.source === 'occasion' && ctx.occasion) {
    const p = OCCASION_PALETTES[ctx.occasion];
    if (p) return { ...overlayTheme('custom', { panel: p.primary, accent: p.accent }), id: 'occasion', name: `${ctx.occasion} colours` };
  }
  if (c.source === 'custom' && c.custom) return overlayTheme('custom', c.custom);
  return overlayTheme(c.themeId);
}
