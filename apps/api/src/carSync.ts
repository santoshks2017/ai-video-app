/**
 * Car library sync (PRD P0.2, extended to Brand → Model → Variant → Colour).
 *
 * cardekho.com serves everything we need in the initial HTML — no headless
 * browser (spike 2026-09-07):
 *  - angle shots:  stimg.../car{exterior,interior}images/<res>/<Brand>/<Model>/.../front-left-side-47.jpg
 *  - colours:      stimg.../car-images/<res>/<Brand>/<Model>/.../Atlas-White_d8dfe5.jpg   (name + hex in the filename)
 *  - variants:     embedded JSON objects: {"name":"Creta EX (O) Diesel AT", "subText":"1493 cc, Automatic, Diesel, 19.1 kmpl", "price":"16.08 Lakh"}
 *
 * Variant-specific photography is rare on CarDekho, so variants inherit the
 * model-level angle set and carry their own spec/price/colour selection.
 */

import { putRef } from './store.js';
import type {
  CarSpecs, CarAngle, CarColour, CarModelProfile, CarVariant, StoredImage } from '@ava/shared';

const UA = 'Mozilla/5.0 (compatible; ai-video-app/1)';

const BRANDS = ['Maruti Suzuki', 'Maruti', 'Land Rover', 'Aston Martin', 'Rolls Royce', 'Mercedes Benz'];

export function resolveSlug(input: string): { slug: string; brand: string; model: string } {
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
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ANGLE_RE =
  /https:\/\/stimg\.cardekho\.com\/images\/car(?:exterior|interior)images\/\d+x\d+\/[^"' )]+?\.(?:jpg|jpeg)/gi;
const COLOUR_RE =
  /https:\/\/stimg\.cardekho\.com\/images\/car-images\/\d+x\d+\/[^"' )]+?\.(?:jpg|jpeg)/gi;

function classify(url: string): CarAngle | 'detail' {
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
  if (/exterior-image-\d/.test(u)) return 'side';
  return 'detail';
}

const resScore = (u: string): number => {
  const m = u.match(/\/(\d+)x(\d+)\//);
  return m ? Number(m[1]) * Number(m[2]) : 0;
};
const sameShot = (a: string, b: string): boolean => {
  const tail = (u: string) => u.replace(/\/\d+x\d+\//, '/').split('/').slice(-2).join('/');
  return tail(a) === tail(b);
};

/** "Atlas-White-with-Titanium-Black_d6dce3.jpg" → { name, hex } */
export function parseColourFile(url: string): { name: string; hex?: string } | null {
  const file = url.split('/').pop() ?? '';
  const m = /^(.+?)_([0-9a-f]{6})\.(?:jpg|jpeg)$/i.exec(file);
  if (!m) return null;
  const name = m[1]!.replace(/-+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  return { name, hex: `#${m[2]!.toLowerCase()}` };
}

/** Variant objects embedded in the page JSON. */
export function parseVariants(html: string, model: string): { name: string; sub?: string; price?: string }[] {
  const out = new Map<string, { name: string; sub?: string; price?: string }>();
  const nameRe = new RegExp(`"name":"(${escapeRe(model)}\\s[^"]{1,60})"`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(html))) {
    const name = m[1]!.trim();
    if (/^\d{4}$/.test(name.slice(-4)) && !/\s/.test(name.slice(model.length).trim())) continue; // "Creta 2026"
    const window = html.slice(m.index, m.index + 600);
    const sub = /"subText":"([^"]{3,120})"/.exec(window)?.[1];
    const price = /"price":"([^"]{1,30})"/.exec(window)?.[1];
    if (!out.has(name)) out.set(name, { name, sub, price });
  }
  return [...out.values()];
}

function specsFromSub(sub?: string): { fuel?: string; transmission?: string } {
  if (!sub) return {};
  const fuel = /(petrol|diesel|electric|cng|hybrid)/i.exec(sub)?.[1];
  const transmission = /(automatic|manual|amt|cvt|ivt|dct)/i.exec(sub)?.[1];
  return {
    fuel: fuel ? title(fuel.toLowerCase()) : undefined,
    transmission: transmission ? transmission.toUpperCase() : undefined,
  };
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

async function store(url: string, label: string, filename: string): Promise<StoredImage | null> {
  const bytes = await fetchImage(url);
  if (!bytes) return null;
  const { refId, storagePath } = await putRef(filename, 'image/jpeg', bytes);
  return { refId, storagePath, label, filename, url: `/api/refs/${refId}/${filename}` };
}


/* ------------------------------- specifications ------------------------------
 * CarDekho publishes the numbers three ways, and each one carries something the
 * others do not: schema.org JSON-LD on /specs (engine, torque, dimensions), a
 * summary object on the model page (power range, boot, airbags, rating), and an
 * FAQ block written as plain sentences (ground clearance, fuel tank, drivetrain).
 * Reading all three is what lets a script quote a real number instead of calling
 * the car "शानदार".
 * -------------------------------------------------------------------------- */

function jsonLd(html: string): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1]!.trim());
      out.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      /* a malformed block is not worth failing the whole sync over */
    }
  }
  return out;
}

const clean = (s: unknown): string | undefined => {
  const v = String(s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return v || undefined;
};

export function parseSpecs(modelHtml: string, specsHtml: string): { specs: CarSpecs; highlights: string[] } {
  const specs: CarSpecs = {};
  const highlights: string[] = [];

  // 1. The model page's summary block — the first one belongs to this car; the
  //    rest are "similar cars" carousels.
  const summary = /"specs":\{(.{0,600}?)\},"/.exec(modelHtml)?.[1] ?? '';
  const pick = (key: string): string | undefined =>
    clean(new RegExp(`"${key}"\\s*:\\s*"([^"]{1,60})"`).exec(summary)?.[1]);
  specs.transmission = pick('Transmission');
  specs.engine = pick('Engine');
  specs.power = pick('Power');
  specs.bootSpace = pick('Boot Space');
  specs.airbags = pick('Airbags');
  const fuel = pick('Fuel Type');
  if (fuel) specs.fuelTypes = fuel.split(/\s*\/\s*/).filter(Boolean);
  const rating = /"rating":([\d.]+)[^}]*?"reviewCount":(\d+)/.exec(modelHtml)
    ?? /"reviewCount":(\d+)[^}]*?"rating":([\d.]+)/.exec(modelHtml);
  if (rating) {
    const [a, b] = [rating[1]!, rating[2]!];
    const score = Number(a) <= 5 ? a : b;
    const count = Number(a) <= 5 ? b : a;
    specs.rating = `${score} from ${count} reviews`;
  }
  specs.priceRange = clean(/"priceRange":"([^"]{1,40})"/.exec(modelHtml)?.[1]);

  // 2. schema.org Car on /specs.
  const car = jsonLd(specsHtml).find((d) => d['@type'] === 'Car' || d['@type'] === 'Vehicle');
  if (car) {
    specs.basePrice = clean(car.offers?.price);
    specs.seating = clean(car.seatingCapacity);
    if (Array.isArray(car.vehicleTransmission) && car.vehicleTransmission.length) {
      specs.transmission = car.vehicleTransmission.join(' / ');
    }
    const fuels = (car.fueltype ?? car.fuelType ?? []) as { name?: string }[];
    if (Array.isArray(fuels) && fuels.length) {
      specs.fuelTypes = fuels.map((f) => clean(f?.name)).filter(Boolean) as string[];
    }
    const engine = (car.vehicleEngine ?? [])[0];
    if (engine) {
      specs.engine = clean(engine.engineType) ?? specs.engine;
      specs.torque = clean(engine.torque?.value) ?? specs.torque;
      specs.power = clean(engine.enginePower?.value) ?? specs.power;
    }
    const w = clean(car.width);
    const hgt = clean(car.height);
    if (w && hgt) specs.dimensions = `${w} wide, ${hgt} tall`;
    if (!specs.bootSpace) specs.bootSpace = clean(car.cargoVolume?.Value ?? car.cargoVolume?.value);
  }

  // 3. The FAQ block, already written as sentences — quotable as-is.
  const faq = jsonLd(specsHtml).find((d) => String(d['@type']).toLowerCase() === 'faqpage');
  for (const q of (faq?.mainEntity ?? []) as { name?: string; acceptedAnswer?: { text?: string } }[]) {
    const text = clean(q.acceptedAnswer?.text);
    if (!text || text.length > 190) continue;
    // Drop the cross-sell tail CarDekho appends to some answers.
    const trimmed = text.replace(/\s*(Check out|Choose cars|Browse).*$/i, '').trim();
    if (trimmed) highlights.push(trimmed);
    const grab = (rx: RegExp): string | undefined => clean(rx.exec(trimmed)?.[1]);
    if (/ground clearance/i.test(q.name ?? '')) specs.groundClearance ??= grab(/is ([\d.]+\s*mm)/i);
    if (/fuel (consumption|capacity|tank)/i.test(q.name ?? '')) specs.fuelTank ??= grab(/is ([\d.]+\s*L)/i);
    if (/mileage/i.test(q.name ?? '')) specs.mileage ??= grab(/is ([\d.]+\s*(?:kmpl|km\/kg|km))/i);
    if (/drivetrain/i.test(q.name ?? '')) specs.drivetrain ??= grab(/with (\w+) drivetrain/i);
    if (/airbags/i.test(q.name ?? '')) specs.airbags ??= grab(/have (\d+) airbags/i);
  }

  for (const k of Object.keys(specs) as (keyof CarSpecs)[]) if (specs[k] === undefined) delete specs[k];
  return { specs, highlights: highlights.slice(0, 10) };
}

export interface SyncOptions {
  /** Angle images to keep per bucket. */
  perAngle?: Partial<Record<CarAngle, number>>;
  maxColours?: number;
}

export async function syncCarModel(input: string, opts: SyncOptions = {}): Promise<CarModelProfile> {
  const { slug, brand, model } = resolveSlug(input);
  const id = slug.replace(/\//g, '__');
  const now = Date.now();

  let html = '';
  let sourceUrl = '';
  for (const u of [`https://www.cardekho.com/${slug}/pictures`, `https://www.cardekho.com/${slug}`]) {
    const res = await fetch(u, { headers: { 'user-agent': UA } });
    if (res.ok) {
      html = await res.text();
      sourceUrl = u;
      break;
    }
  }
  // The /pictures page carries the imagery; the model page carries the variants
  // and the summary numbers; /specs carries the schema.org block and the FAQ.
  let variantHtml = html;
  if (sourceUrl.endsWith('/pictures')) {
    const res = await fetch(`https://www.cardekho.com/${slug}`, { headers: { 'user-agent': UA } });
    if (res.ok) variantHtml = await res.text();
  }
  const specsHtml = await fetch(`https://www.cardekho.com/${slug}/specs`, { headers: { 'user-agent': UA } })
    .then((r) => (r.ok ? r.text() : ''))
    .catch(() => '');
  const { specs, highlights } = parseSpecs(variantHtml, specsHtml);

  if (!html) {
    return {
      id,
      brand,
      model,
      slug,
      images: {},
      colours: [],
      variants: [],
      syncStatus: 'needs-manual',
      syncNote: `cardekho.com returned no page for "${slug}". Upload images manually.`,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  const modelSeg = slug.split('/').pop() ?? '';
  const modelRe = new RegExp(`/${escapeRe(title(modelSeg))}(?:[-/])`, 'i');

  /* ---- angle images ---- */
  const want: Record<CarAngle, number> = {
    front: opts.perAngle?.front ?? 2,
    side: opts.perAngle?.side ?? 2,
    rear: opts.perAngle?.rear ?? 1,
    interior: opts.perAngle?.interior ?? 2,
  };
  const candidates = [...new Set(html.match(ANGLE_RE) ?? [])]
    .filter((u) => modelRe.test(u))
    .sort((a, b) => resScore(b) - resScore(a));

  const picked: Record<string, string[]> = {};
  for (const u of candidates) {
    const a = classify(u);
    if (a === 'detail') continue;
    picked[a] ??= [];
    if (picked[a]!.length >= want[a]) continue;
    if (picked[a]!.some((x) => sameShot(x, u))) continue;
    picked[a]!.push(u);
  }

  const images: Partial<Record<CarAngle, StoredImage[]>> = {};
  for (const [angle, urls] of Object.entries(picked)) {
    const list: StoredImage[] = [];
    for (let i = 0; i < urls.length; i++) {
      const img = await store(
        urls[i]!,
        `${brand} ${model} — ${angle}`,
        `${id}-${angle}-${i + 1}.jpg`,
      );
      if (img) list.push(img);
    }
    if (list.length) images[angle as CarAngle] = list;
  }

  /* ---- colours ---- */
  const colourUrls = [...new Set(html.match(COLOUR_RE) ?? [])]
    .filter((u) => modelRe.test(u))
    .sort((a, b) => resScore(b) - resScore(a));
  const seenColour = new Set<string>();
  const colours: CarColour[] = [];
  for (const u of colourUrls) {
    if (colours.length >= (opts.maxColours ?? 10)) break;
    const parsed = parseColourFile(u);
    if (!parsed || seenColour.has(parsed.name.toLowerCase())) continue;
    seenColour.add(parsed.name.toLowerCase());
    const img = await store(
      u,
      `${brand} ${model} — ${parsed.name}`,
      `${id}-colour-${slugify(parsed.name)}.jpg`,
    );
    colours.push({ name: parsed.name, hex: parsed.hex, image: img ?? undefined });
  }

  /* ---- variants ---- */
  const variants: CarVariant[] = parseVariants(variantHtml, model).map((v) => ({
    name: v.name,
    price: v.price,
    ...specsFromSub(v.sub),
    images: {}, // inherit the model set
    colours: [],
  }));

  const angles = Object.keys(images) as CarAngle[];
  const syncStatus: CarModelProfile['syncStatus'] =
    angles.length >= 4 ? 'ok' : angles.length >= 2 ? 'partial' : 'needs-manual';

  return {
    id,
    brand,
    model,
    slug,
    images,
    colours,
    variants,
    specs,
    highlights,
    sourceUrl,
    syncedAt: now,
    syncStatus,
    syncNote:
      syncStatus === 'ok'
        ? undefined
        : `Only ${angles.length} angle(s) found — upload the missing views manually.`,
    createdAt: now,
    updatedAt: now,
  };
}
