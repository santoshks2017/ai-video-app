/**
 * Logos that sit on a film without a box around them.
 *
 * A logo arrives however it was saved — a JPG, a PNG with no transparency, an SVG
 * that draws its own white rectangle — and composited as it came, it put two white
 * plates on a navy end card. So every logo is cleaned before it is used: the
 * background is taken off, and a white version is made for dark backgrounds.
 *
 * The background is found, not assumed: it is the colour most of the border is,
 * and only what is connected to the border is removed. White inside the logo — the
 * oval in Toyota's red square, the ground of Hyundai's H — is part of the logo and
 * stays.
 *
 * The white version is a knockout, not a fill. Painting every visible pixel white
 * turned the Toyota emblem into a blank square and filled Hyundai's H in; instead,
 * light "paper" pixels inside the logo turn transparent and dark or strongly
 * coloured pixels become white ink, in proportion, so the detail survives as a
 * cut-out — which is how a reversed logo is drawn.
 */

import sharp from 'sharp';
import { BRAND_CATALOGUE, brandMatches } from '@ava/shared';

/** Within this distance of the background colour a pixel is background; up to SOFT it fades. */
const HARD = 42;
const SOFT = 90;
const MAX_SIDE = 1200;
/**
 * A descriptive agent with a way to reach whoever runs it, as Wikimedia's policy
 * asks. Without the contact, requests after the first few in a row were refused —
 * Toyota and Mahindra came back and Hero and TVS, looked up straight after, did not.
 */
const UA = 'ai-video-app/1 (https://ai-video-app-cd.web.app; dealer video logo lookup)';

export interface CleanedLogo {
  /** The logo in its own colours, background removed, trimmed. */
  colour: Buffer;
  /** The same logo as white ink on transparency, for dark backgrounds. */
  white: Buffer;
  /** False when the image was already transparent at its edge. */
  removedBackground: boolean;
}

export async function cleanLogo(input: Buffer): Promise<CleanedLogo> {
  // Vectors are rasterised near the working size rather than at a fixed density: a
  // large SVG at 300 dpi is a very large bitmap for something that ends up 200 wide.
  const meta = await sharp(input).metadata();
  const longest = Math.max(meta.width ?? MAX_SIDE, meta.height ?? MAX_SIDE, 1);
  const density = meta.format === 'svg' ? Math.max(72, Math.min(600, (72 * MAX_SIDE) / longest)) : undefined;
  const { data, info } = await sharp(input, density ? { density } : {})
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const at = (x: number, y: number): number => (y * w + x) * 4;

  let clear = 0;
  let border = 0;
  const edge = (i: number): void => {
    border++;
    if (data[i + 3]! < 16) clear++;
  };
  for (let x = 0; x < w; x++) {
    edge(at(x, 0));
    edge(at(x, h - 1));
  }
  for (let y = 0; y < h; y++) {
    edge(at(0, y));
    edge(at(w - 1, y));
  }
  const alreadyClear = border > 0 && clear / border > 0.9;

  if (!alreadyClear) {
    const counts = new Map<string, number>();
    const bump = (i: number): void => {
      if (data[i + 3]! < 16) return;
      const k = `${data[i]! >> 4},${data[i + 1]! >> 4},${data[i + 2]! >> 4}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    };
    for (let x = 0; x < w; x++) {
      bump(at(x, 0));
      bump(at(x, h - 1));
    }
    for (let y = 0; y < h; y++) {
      bump(at(0, y));
      bump(at(w - 1, y));
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) {
      const [br, bg, bb] = top[0].split(',').map((v) => (Number(v) << 4) + 8) as [number, number, number];
      const seen = new Uint8Array(w * h);
      const stack: number[] = [];
      for (let x = 0; x < w; x++) stack.push(x, 0, x, h - 1);
      for (let y = 0; y < h; y++) stack.push(0, y, w - 1, y);
      while (stack.length) {
        const y = stack.pop()!;
        const x = stack.pop()!;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const j = y * w + x;
        if (seen[j]) continue;
        seen[j] = 1;
        const i = j * 4;
        if (data[i + 3]! < 16) {
          stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
          continue;
        }
        const d = Math.hypot(data[i]! - br, data[i + 1]! - bg, data[i + 2]! - bb);
        if (d > SOFT) continue;
        const alpha = d <= HARD ? 0 : Math.round((255 * (d - HARD)) / (SOFT - HARD));
        data[i + 3] = Math.min(data[i + 3]!, alpha);
        if (d <= HARD) stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
      }
    }
  }

  let colour = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  try {
    colour = await sharp(colour).trim({ threshold: 1 }).png().toBuffer();
  } catch {
    /* a fully transparent or uniform image has nothing to trim */
  }
  return { colour, white: await whiteKnockout(colour), removedBackground: !alreadyClear };
}

/** White ink from darkness or colour strength; light pixels inside the logo become transparent. */
async function whiteKnockout(colourPng: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(colourPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ink = new Float32Array(info.width * info.height);
  let strongest = 0;
  for (let p = 0, i = 0; i < data.length; i += 4, p++) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const dark = (255 - (0.2126 * r + 0.7152 * g + 0.0722 * b)) / 255;
    const saturation = max === 0 ? 0 : (max - min) / max;
    ink[p] = Math.max(dark, saturation) * (data[i + 3]! / 255);
    if (data[i + 3]! > 16) strongest = Math.max(strongest, ink[p]!);
  }
  const gain = strongest > 0 ? 1 / strongest : 1;
  for (let p = 0, i = 0; i < data.length; i += 4, p++) {
    // A small floor, so the grey haze a JPG leaves inside a logo does not show as a veil.
    const a = Math.max(0, Math.min(1, (ink[p]! * gain - 0.06) / 0.94));
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = Math.round(a * 255);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/* ---- finding a brand's logo ---- */

async function fetchBytes(url: string, headers: Record<string, string> = { 'user-agent': UA }): Promise<Buffer | null> {
  // One more try after a pause when the service asks us to slow down; nothing else is retried.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000), redirect: 'follow' });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      if (r.status !== 429 && r.status !== 503) return null;
    } catch {
      return null;
    }
    await new Promise((done) => setTimeout(done, 1500));
  }
  return null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const b = await fetchBytes(url);
  if (!b) return null;
  try {
    return JSON.parse(b.toString('utf8')) as T;
  } catch {
    return null;
  }
}

/** Words a logo's file name may carry beside the brand's own without being a different thing. */
const ALLOWED = new Set([
  'logo', 'logos', 'svg', 'png', 'new', 'official', 'company', 'motor', 'motors', 'ltd', 'limited', 'auto',
  'automotive', 'automobile', 'automobiles', 'cars', 'co', 'the', 'of', 'symbol', 'emblem', 'wordmark',
  'logotype', 'india', 'group', 'corporation', 'inc', 'brand',
]);
/** "KIA logo3.svg" → kia, logo, 3 — a version number glued to a word is still a version number. */
const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * How good a logo file looks from its name.
 *
 * A search for "TVS logo" also finds the Scooty's logo, and Wikidata's logo for
 * Royal Enfield is a scan from 1921 — the name is most of what there is to judge by.
 * Vectors first, "logo" in the name, the automotive mark over the group's, a recent
 * year over an old one; anything that names a product or a thing the brand is not
 * is out.
 */
export function scoreLogoFile(brand: string, file: string): number {
  const name = file.toLowerCase();
  const brandWords = new Set(words(brand).filter((w) => !ALLOWED.has(w)));
  const fileWords = words(name.replace(/\.(svg|png|jpe?g|gif|webp)$/, ''));
  if (!fileWords.some((w) => brandWords.has(w))) return -99;
  for (const w of fileWords) {
    // A brand word, an allowed word, a year, or a short version number like the 3 in "logo3".
    if (brandWords.has(w) || ALLOWED.has(w) || /^(19|20)\d\d$/.test(w) || /^\d{1,2}$/.test(w)) continue;
    return -99;
  }
  let s = name.endsWith('.svg') ? 3 : name.endsWith('.png') ? 1 : -3;
  if (fileWords.includes('logo')) s += 2;
  if (fileWords.some((w) => ['symbol', 'emblem', 'wordmark', 'logotype'].includes(w))) s += 1;
  if (fileWords.some((w) => ['automotive', 'auto', 'cars'].includes(w))) s += 2;
  if (fileWords.includes('new')) s += 1;
  for (const w of fileWords) {
    if (!/^(19|20)\d\d$/.test(w)) continue;
    s += Number(w) >= 2020 ? 2 : -5;
  }
  return s;
}

async function commonsRender(file: string): Promise<Buffer | null> {
  return fetchBytes(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, '_'))}?width=1024`);
}

/**
 * The brand's current logo, from the best source that has it.
 *
 * Wikidata's logo property first, judged by the file's name; a search of Wikimedia
 * Commons next; CarDekho's small brand logo last, which exists for car brands only.
 * Whatever comes back is cleaned like an upload, and where it came from is kept so a
 * designer can see it and replace it.
 */
export async function findBrandLogo(brand: string): Promise<{ bytes: Buffer; source: string } | null> {
  const name = brand.trim();
  if (!name) return null;

  const candidates = new Map<string, number>();
  const consider = (file: string | undefined): void => {
    if (!file) return;
    const s = scoreLogoFile(name, file);
    if (s >= 3) candidates.set(file, Math.max(candidates.get(file) ?? -99, s));
  };

  const search = await fetchJson<{ search?: { id: string; description?: string }[] }>(
    `https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbsearchentities', search: name, language: 'en', type: 'item', limit: '5', format: 'json' })}`,
  );
  const item =
    search?.search?.find((s) => /automobile|automotive|motor|vehicle|\bcar|manufacturer|motorcycle|scooter/i.test(s.description ?? '')) ??
    undefined;
  if (item) {
    const claims = await fetchJson<{ claims?: { P154?: { mainsnak?: { datavalue?: { value?: string } } }[] } }>(
      `https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetclaims', entity: item.id, property: 'P154', format: 'json' })}`,
    );
    for (const c of claims?.claims?.P154 ?? []) consider(c.mainsnak?.datavalue?.value);
  }
  for (const q of [`${name} automotive logo`, `${name} logo`, `${name.split(/\s+/)[0]} logo`]) {
    const found = await fetchJson<{ query?: { search?: { title: string }[] } }>(
      `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: 'query', list: 'search', srsearch: q, srnamespace: '6', srlimit: '15', format: 'json' })}`,
    );
    for (const r of found?.query?.search ?? []) consider(r.title.replace(/^File:/, ''));
  }
  const best = [...candidates.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) {
    const bytes = await commonsRender(best[0]);
    if (bytes) return { bytes, source: `Wikimedia Commons — ${best[0]}` };
  }

  const slug = BRAND_CATALOGUE.find((b) => brandMatches(b.name, name))?.slug ?? words(name)[0] ?? '';
  if (slug) {
    const bytes = await fetchBytes(`https://stimg.cardekho.com/images/dealercallbacklogo/${slug}_logo.jpg`, {
      'user-agent': 'Mozilla/5.0 (compatible; ai-video-app/1)',
    });
    if (bytes) return { bytes, source: 'CarDekho (small — replace with a larger file if you have one)' };
  }
  return null;
}
