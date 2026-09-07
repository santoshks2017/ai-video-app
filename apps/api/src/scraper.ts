/**
 * Car-model reference scraper (PRD P0.2).
 *
 * cardekho.com serves image URLs directly in the initial HTML of
 * `/<brand>/<model>/pictures` — no headless browser needed (spike, 2026-09-07).
 * Named-angle files (`front-left-side`, `rear-left-view`, …) plus the
 * `carinteriorimages/` set give front / side / rear / interior coverage.
 *
 * Runs inline in the API request for a small list. Batch / cron lives in
 * jobs/scraper (still a stub).
 */

import { putRef, ensureFirebase } from './store.js';
import { getFirestore } from 'firebase-admin/firestore';

export type Angle = 'front' | 'side' | 'rear' | 'interior';

export interface ScrapedModelImage {
  angle: Angle;
  storagePath: string;
  sourceUrl: string;
}

export interface ScrapeModelResult {
  brand: string;
  model: string;
  slug: string;
  key: string;
  images: ScrapedModelImage[];
  angles: Angle[];
  status: 'ok' | 'partial' | 'needs-manual-upload';
  scrapedAt: number;
  note?: string;
}

/** Multi-word car brands sold in India — so "Toyota Innova Hycross" splits right. */
const BRANDS = [
  'Maruti Suzuki',
  'Maruti',
  'Land Rover',
  'Aston Martin',
  'Rolls Royce',
  'Mercedes Benz',
  'Mercedes-Benz',
];

/** "Hyundai Creta" | "hyundai/creta" → { slug, brand, model }. */
function resolveSlug(input: string): { slug: string; brand: string; model: string } {
  const q = input.trim();

  if (q.includes('/')) {
    const [b, ...rest] = q.toLowerCase().split('/');
    return { slug: q.toLowerCase(), brand: title(b ?? ''), model: title(rest.join('/')) };
  }
  const multi = BRANDS.find((b) => q.toLowerCase().startsWith(b.toLowerCase() + ' '));
  const brand = multi ?? q.split(/\s+/)[0] ?? '';
  const model = q.slice(brand.length).trim();
  return { slug: `${slugify(brand)}/${slugify(model)}`, brand, model };
}

const slugify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const title = (s: string): string => s.replace(/(^|[-\s])([a-z])/g, (_, p, c) => p + c.toUpperCase());

const IMG_RE =
  /https:\/\/stimg\.cardekho\.com\/images\/car(?:exterior|interior)images\/\d+x\d+\/[^"' )]+?\.(?:jpg|jpeg|webp)/gi;

function classify(url: string): Angle | 'detail' {
  const u = url.toLowerCase();
  if (u.includes('/carinteriorimages/')) {
    return /dashboard|steering|infotainment|front-seats|rear-seats|centre-console|center-console|cabin|interior-image/.test(
      u,
    )
      ? 'interior'
      : 'detail';
  }
  if (/front-left-side|front-right-view|front-view/.test(u)) return 'front';
  if (/rear-left-view|rear-right-view|rear-view/.test(u)) return 'rear';
  if (/left-side-view|right-side-view|side-view/.test(u)) return 'side';
  if (/exterior-image-\d/.test(u)) return 'side'; // generic 3/4 exterior
  return 'detail';
}

/** Prefer the largest resolution variant of the same image. */
function resScore(url: string): number {
  const m = url.match(/\/(\d+)x(\d+)\//);
  return m ? Number(m[1]) * Number(m[2]) : 0;
}

export async function scrapeModel(input: string): Promise<ScrapeModelResult> {
  const { slug, brand, model } = resolveSlug(input);
  const key = slug.replace(/\//g, '__');
  const scrapedAt = Date.now();

  let html = '';
  for (const url of [`https://www.cardekho.com/${slug}/pictures`, `https://www.cardekho.com/${slug}`]) {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; ai-video-app/1)' } });
    if (res.ok) {
      html = await res.text();
      break;
    }
  }
  if (!html) {
    return emptyResult(brand, model, slug, key, scrapedAt, `cardekho.com returned no page for "${slug}"`);
  }

  const modelSeg = slug.split('/').pop() ?? '';
  const modelRe = new RegExp(`/${escapeRe(title(modelSeg))}(?:[-/])`, 'i');

  const all = [...new Set(html.match(IMG_RE) ?? [])].filter((u) => modelRe.test(u));

  // Best few per angle bucket.
  const want: Record<Angle, number> = { front: 2, side: 1, rear: 1, interior: 2 };
  const picked: ScrapedModelImage[] = [];
  const byAngle: Record<string, string[]> = {};
  for (const u of all.sort((a, b) => resScore(b) - resScore(a))) {
    const a = classify(u);
    if (a === 'detail') continue;
    byAngle[a] ??= [];
    if (byAngle[a]!.length >= want[a]) continue;
    if (byAngle[a]!.some((x) => sameShot(x, u))) continue;
    byAngle[a]!.push(u);
  }

  for (const [angle, urls] of Object.entries(byAngle)) {
    for (const sourceUrl of urls) {
      try {
        const img = await fetch(sourceUrl);
        if (!img.ok) continue;
        const bytes = Buffer.from(await img.arrayBuffer());
        const name = `${key}-${angle}-${picked.length}.jpg`;
        const { storagePath } = await putRef(name, img.headers.get('content-type') ?? 'image/jpeg', bytes);
        picked.push({ angle: angle as Angle, storagePath, sourceUrl });
      } catch {
        /* skip a bad image, keep going */
      }
    }
  }

  const angles = [...new Set(picked.map((p) => p.angle))] as Angle[];
  const status: ScrapeModelResult['status'] =
    angles.length >= 4 ? 'ok' : angles.length >= 2 ? 'partial' : 'needs-manual-upload';

  const result: ScrapeModelResult = { brand, model, slug, key, images: picked, angles, status, scrapedAt };
  ensureFirebase();
  await getFirestore().collection('carModels').doc(key).set(result).catch(() => {});
  return result;
}

export async function getCarModel(key: string): Promise<ScrapeModelResult | null> {
  ensureFirebase();
  const snap = await getFirestore().collection('carModels').doc(key).get();
  return snap.exists ? (snap.data() as ScrapeModelResult) : null;
}

function emptyResult(
  brand: string,
  model: string,
  slug: string,
  key: string,
  scrapedAt: number,
  note: string,
): ScrapeModelResult {
  return { brand, model, slug, key, images: [], angles: [], status: 'needs-manual-upload', scrapedAt, note };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Two URLs are the same shot if their trailing filename (minus resolution) matches. */
function sameShot(a: string, b: string): boolean {
  const tail = (u: string): string => u.replace(/\/\d+x\d+\//, '/').split('/').slice(-2).join('/');
  return tail(a) === tail(b);
}
