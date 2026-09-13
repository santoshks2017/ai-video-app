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
import { seePhotos } from './vision.js';
import { brandMatches } from '@ava/shared';
import type {
  CarSpecs,
  VehicleKind, CarAngle, CarColour, CarModelProfile, CarVariant, StoredImage } from '@ava/shared';

const UA = 'Mozilla/5.0 (compatible; ai-video-app/1)';

const BRANDS = ['Maruti Suzuki', 'Maruti', 'Land Rover', 'Aston Martin', 'Rolls Royce', 'Mercedes Benz'];

export function resolveSlug(input: string): { slug: string; brand: string; model: string } {
  const q = input.trim();
  if (q.includes('/')) {
    const [b, ...rest] = q.toLowerCase().split('/');
    // A slug path is words joined by hyphens: "royal-enfield/classic-350" is
    // Royal Enfield Classic 350, not Royal-Enfield Classic-350.
    const words = (x: string): string => title(x.replace(/-/g, ' '));
    return { slug: q.toLowerCase(), brand: words(b ?? ''), model: words(rest.join('/')) };
  }
  const multi = BRANDS.find((b) => q.toLowerCase().startsWith(b.toLowerCase() + ' '));
  const brand = multi ?? q.split(/\s+/)[0] ?? '';
  const model = q.slice(brand.length).trim();
  return { slug: `${slugify(brand)}/${slugify(model)}`, brand, model };
}

const slugify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const title = (s: string): string => s.replace(/(^|[-\s])([a-z])/g, (_, p, c) => p + c.toUpperCase());
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


/* =============================== sources =====================================
 * Cars come from cardekho.com, bikes and scooters from bikedekho.com — same
 * group, different sites, and genuinely different HTML. The differences worth
 * knowing:
 *   - images: stimg.cardekho.com with the angle IN the filename
 *             (front-left-side-47.jpg) vs cdn.bikedekho.com with opaque hashes,
 *             so bike shots can only be taken in source order.
 *   - specs:  a flat summary + schema.org "Car" vs a grouped specification
 *             table + schema.org "Motorcycle", which also carries the colours.
 *   - models: "modelSlug":"nexon" on a brand page vs an OEM-scoped catalogue
 *             keyed "MS", which includes discontinued bikes we filter out.
 * ========================================================================== */

interface VehicleSource {
  host: string;
  modelUrl: (slug: string) => string;
  picturesUrl: (slug: string) => string;
  specsUrl: (slug: string) => string;
  /** Cars key the page on the display name, bikes on the slug. */
  brandUrl: (slug: string, name: string) => string;
  imageRe: RegExp;
  ldType: string;
}

const SOURCES: Record<VehicleKind, VehicleSource> = {
  car: {
    host: 'https://www.cardekho.com',
    modelUrl: (s) => `https://www.cardekho.com/${s}`,
    picturesUrl: (s) => `https://www.cardekho.com/${s}/pictures`,
    specsUrl: (s) => `https://www.cardekho.com/${s}/specs`,
    // The brand page is keyed on the display name; model paths use the slug.
    brandUrl: (_slug, name) => `https://www.cardekho.com/cars/${encodeURIComponent(name)}`,
    imageRe: ANGLE_RE,
    ldType: 'Car',
  },
  bike: {
    host: 'https://www.bikedekho.com',
    modelUrl: (s) => `https://www.bikedekho.com/${s}`,
    picturesUrl: (s) => `https://www.bikedekho.com/${s}/pictures`,
    specsUrl: (s) => `https://www.bikedekho.com/${s}/specifications`,
    brandUrl: (slug) => `https://www.bikedekho.com/${slug}-bikes`,
    imageRe: /https:\/\/cdn\.bikedekho\.com\/processedimages\/[^"' )]+?\.(?:jpg|jpeg)/gi,
    ldType: 'Motorcycle',
  },
};

/**
 * One retry, because a single dropped request reads to the user as "this brand
 * does not exist" — which is the wrong conclusion to hand someone about a brand
 * that is right there on the site.
 */
async function get(url: string): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA } });
      if (r.ok) {
        const text = await r.text();
        if (text) return text;
      }
    } catch {
      /* fall through to the retry */
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
  }
  return '';
}

/**
 * Every current model a brand sells, as source slugs.
 *
 * Discontinued entries are dropped: BikeDekho lists activa-3g and
 * "Honda Activa 125 [2019-2024]" beside current bikes, and a dealer cannot sell
 * either. CarDekho's `modelSlug` field is already the current set.
 */
export interface BrandListing {
  /** The slug the source actually uses — discovered, not guessed. */
  slug: string;
  items: { slug: string; name: string }[];
}

/**
 * Every current model a brand sells, for ANY brand the source knows — not just
 * the ones in the catalogue.
 *
 * The brand's real slug is read off the page rather than derived from what was
 * typed, because the two often differ: "Suzuki" under cars is Maruti in India,
 * and CarDekho serves exactly that. Ownership of each model is decided by the
 * nearest preceding brandSlug, since a brand page cites rivals in its
 * comparison blocks and the bike catalogue is global.
 */
export async function listBrandModels(
  input: string,
  kind: VehicleKind,
  alsoPages: string[] = [],
): Promise<BrandListing> {
  const src = SOURCES[kind];
  const typed = input.trim();
  if (!typed) return { slug: '', items: [] };

  // Bikes key the page on a slug, cars on the display name.
  const asSlug = slugify(typed);
  const names = kind === 'bike' ? [asSlug, ...alsoPages] : [typed, ...alsoPages];
  const pages = await Promise.all(names.map((n) => get(src.brandUrl(slugify(n), n))));
  const html = pages.filter(Boolean).join('\n');
  if (!html) return { slug: asSlug, items: [] };

  // Group every model by its owning brand, then choose whose page this is.
  const owned = new Map<string, Map<string, string>>();
  for (const m of html.matchAll(/"modelSlug":"([a-z0-9-]+)"/g)) {
    const slug = m[1]!;
    if (isRetired(slug)) continue;
    const before = html.slice(Math.max(0, m.index! - 4000), m.index!);
    const owner = [...before.matchAll(/"brandSlug":"([a-z0-9-]+)"/g)].at(-1)?.[1];
    if (!owner) continue;

    const window = html.slice(m.index!, m.index! + 1200);
    if (/"status":"Upcoming"|"upcoming":true|Alert Me When Launched|Expected Launch/i.test(window)) continue;
    const name =
      /"modelTitle":"([^"]{1,60})"/.exec(window)?.[1] ??
      /"modelText":"([^"]{1,60})"/.exec(window)?.[1] ??
      title(slug.replace(/-/g, ' '));
    if (isRetired(name)) continue;

    const bucket = owned.get(owner) ?? new Map<string, string>();
    if (!bucket.has(slug)) bucket.set(slug, name);
    owned.set(owner, bucket);
  }
  if (!owned.size) return { slug: asSlug, items: [] };

  // The owning slug must actually be the brand that was asked for. Falling back
  // to "whichever group is biggest" looked reasonable and meant a typo returned
  // somebody else's cars: "Nonexistentbrand" quietly came back as Maruti.
  const match = [...owned.entries()].find(([owner]) => brandMatches(owner, typed));
  if (!match) return { slug: asSlug, items: [] };
  const [slug, models] = match;
  return { slug, items: [...models].map(([s, name]) => ({ slug: s, name })) };
}

/** Dated or superseded entries — "[2019-2024]", "-bs4", "activa-3g", "2021-2026". */
function isRetired(s: string): boolean {
  // Fleet and commercial trims — Dzire Tour S, Eeco Cargo, WagonR Tour — are
  // taxi and goods versions no dealer advertises to a private buyer.
  if (/-(?:tour|tour-[a-z0-9]+|cargo)$/i.test(s) || /\b(Tour [A-Z]\d?|Cargo)\b/.test(s)) return true;
  return (
    /\[\d{4}\s*-\s*\d{4}\]/.test(s) ||
    /\b(19|20)\d{2}\s*-\s*(19|20)\d{2}\b/.test(s) ||
    /-(?:bs3|bs4|bs6)$/i.test(s) ||
    /-\d{4}-\d{4}$/.test(s) ||
    /-(?:19|20)\d{2}$/.test(s) ||
    /\b\d[gG]$/.test(s)
  );
}

/** Bike specifications: grouped table + schema.org Motorcycle + the FAQ block. */
export function parseBikeSpecs(
  modelHtml: string,
  specsHtml: string,
): { specs: CarSpecs; highlights: string[]; colours: string[]; images: string[] } {
  const specs: CarSpecs = {};
  const highlights: string[] = [];

  const table = new Map<string, string>();
  for (const m of modelHtml.matchAll(/\{"text":"([^"]{2,40})","icon":"[^"]*","value":"([^"]{1,60})"/g)) {
    table.set(m[1]!.toLowerCase(), clean(m[2]) ?? '');
  }
  const t = (k: string): string | undefined => table.get(k) || undefined;
  specs.engine = t('displacement');
  specs.power = t('max power');
  specs.torque = t('max torque');
  specs.transmission = t('gear box') ?? t('transmission');
  specs.mileage = t('mileage') ?? t('overall mileage');
  specs.topSpeed = t('claimed top speed');
  specs.kerbWeight = t('kerb weight');
  specs.seatHeight = t('seat height');
  specs.fuelTank = t('fuel tank capacity');
  specs.groundClearance = t('ground clearance');
  const fuel = t('fuel type');
  if (fuel) specs.fuelTypes = [fuel];

  const bike = jsonLd(specsHtml).find((d) => d['@type'] === 'Motorcycle');
  // The schema.org block lists THIS bike's photos. Scraping the gallery page
  // instead picks up the "related bikes" rail — a Hero sync came back with a
  // Royal Enfield Roadstar.
  // Entries are ImageObjects, not bare URLs: {"@type":"ImageObject","url":…}.
  const images: string[] = (Array.isArray(bike?.image) ? bike!.image : [])
    .map((i: unknown) => (typeof i === 'string' ? i : (i as { url?: string })?.url))
    .filter((u: unknown): u is string => typeof u === 'string' && /^https?:/.test(u));
  const colours: string[] = Array.isArray(bike?.color)
    ? (bike!.color as string[]).map((c) => clean(c)).filter(Boolean) as string[]
    : [];
  if (bike?.description) {
    const d = clean(bike.description);
    if (d && d.length < 220) highlights.push(d);
  }

  const faq = jsonLd(specsHtml).find((d) => String(d['@type']).toLowerCase() === 'faqpage');
  for (const q of (faq?.mainEntity ?? []) as { name?: string; acceptedAnswer?: { text?: string } }[]) {
    const text = clean(q.acceptedAnswer?.text);
    if (!text || text.length > 190) continue;
    const trimmed = text.replace(/\s*(Check out|Choose|Browse).*$/i, '').trim();
    if (trimmed) highlights.push(trimmed);
  }

  specs.priceRange = clean(/"priceRange":"([^"]{1,40})"/.exec(modelHtml)?.[1]);
  for (const k of Object.keys(specs) as (keyof CarSpecs)[]) if (!specs[k]) delete specs[k];
  return { specs, highlights: highlights.slice(0, 10), colours, images };
}

export interface SyncOptions {
  /** Angle images to keep per bucket. */
  perAngle?: Partial<Record<CarAngle, number>>;
  maxColours?: number;
  /** Which site to read. Defaults to cars. */
  kind?: VehicleKind;
  /**
   * Gemini key. With one, every photo is looked at and filed under what it
   * actually shows; without one, the filename is all there is to go on.
   */
  apiKey?: string;
}

export const syncCarModel = (input: string, opts: SyncOptions = {}): Promise<CarModelProfile> =>
  syncVehicleModel(input, { ...opts, kind: opts.kind ?? 'car' });

export async function syncVehicleModel(input: string, opts: SyncOptions = {}): Promise<CarModelProfile> {
  const kind: VehicleKind = opts.kind ?? 'car';
  const src = SOURCES[kind];
  const { slug, brand, model } = resolveSlug(input);
  const id = (kind === 'car' ? '' : `${kind}__`) + slug.replace(/\//g, '__');
  const now = Date.now();

  let html = '';
  let sourceUrl = '';
  for (const u of [src.picturesUrl(slug), src.modelUrl(slug)]) {
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
  if (sourceUrl.endsWith('/pictures')) variantHtml = (await get(src.modelUrl(slug))) || html;
  const specsHtml = await get(src.specsUrl(slug));

  const parsed =
    kind === 'bike'
      ? parseBikeSpecs(variantHtml, specsHtml)
      : { ...parseSpecs(variantHtml, specsHtml), colours: [], images: [] };
  const { specs, highlights } = parsed;
  const namedColours = parsed.colours;
  const bikeImages = parsed.images;

  if (!html) {
    return {
      id,
      brand,
      model,
      slug,
      kind,
      images: {},
      colours: [],
      variants: [],
      syncStatus: 'needs-manual',
      syncNote: `${src.host.replace('https://www.', '')} returned no page for "${slug}". Upload images manually.`,
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
  // Car filenames name their angle; bike filenames are opaque hashes, so bikes
  // are taken in source order and labelled honestly as photos.
  const candidates = [...new Set(html.match(src.imageRe) ?? [])]
    .filter((u) => (kind === 'car' ? modelRe.test(u) : true))
    .sort((a, b) => resScore(b) - resScore(a));

  const picked: Record<string, string[]> = {};
  if (kind === 'bike') {
    // classify() reads the angle out of a car filename; bike filenames are
    // opaque hashes, so every bike URL fell through to "detail" and was
    // discarded — which is why bikes synced with zero images. Bikes are taken
    // in the order the source lists them and spread across the buckets the rest
    // of the app expects, with the schema.org list preferred because it is
    // scoped to this model.
    const pool = (bikeImages.length ? bikeImages : candidates).filter((u) => !/\/106X44\//.test(u));
    const buckets: CarAngle[] = ['front', 'side', 'rear', 'interior'];
    pool.slice(0, 6).forEach((u, i) => {
      const a = buckets[i % buckets.length]!;
      (picked[a] ??= []).push(u);
    });
  }
  for (const u of kind === 'bike' ? [] : candidates) {
    const a = classify(u);
    if (a === 'detail') continue;
    picked[a] ??= [];
    if (picked[a]!.length >= want[a]) continue;
    if (picked[a]!.some((x) => sameShot(x, u))) continue;
    picked[a]!.push(u);
  }

  /*
   * What the filename says, then what the photograph says.
   *
   * CarDekho's names are a guess: in the XUV 3XO set a file named for the front
   * held a side profile, and one named for the side held the front. Filing a
   * side shot under "front" is worse than having no front at all — the app then
   * captions it FRONT and tells the model that is what the front looks like.
   * So the pool is downloaded first and every picture is looked at; the name is
   * only the fallback when there is no key or the call fails.
   */
  const pool: { url: string; guess: CarAngle; bytes: Buffer }[] = [];
  for (const [angle, urls] of Object.entries(picked)) {
    for (const u of urls) {
      const bytes = await fetchImage(u);
      if (bytes) pool.push({ url: u, guess: angle as CarAngle, bytes });
    }
  }

  const subject = `${brand} ${model}`;
  const seen = opts.apiKey ? await seePhotos(pool.map((p) => ({ bytes: p.bytes })), subject, opts.apiKey) : [];
  const photoNotes: string[] = [];

  const byAngle: Record<string, { url: string; bytes: Buffer }[]> = {};
  pool.forEach((p, i) => {
    const look = seen[i];
    // A picture that is not this vehicle is dropped outright, however it was named.
    if (look && !look.isVehicle) {
      photoNotes.push(`dropped a photo that is not the ${subject}${look.note ? ` (${look.note})` : ''}`);
      return;
    }
    const view = look && look.view !== 'other' && look.view !== 'detail' ? look.view : null;
    if (look && view && view !== p.guess) {
      photoNotes.push(`a photo named ${p.guess} is really the ${view}`);
    }
    if (look && !view) return; // a close-up of one part teaches nothing about a side
    const angle = (view ?? p.guess) as CarAngle;
    (byAngle[angle] ??= []).push({ url: p.url, bytes: p.bytes });
  });

  const images: Partial<Record<CarAngle, StoredImage[]>> = {};
  for (const [angle, shots] of Object.entries(byAngle)) {
    const list: StoredImage[] = [];
    for (const [i, shot] of shots.slice(0, want[angle as CarAngle] ?? 2).entries()) {
      const { refId, storagePath } = await putRef(`${id}-${angle}-${i + 1}.jpg`, 'image/jpeg', shot.bytes);
      list.push({
        refId,
        storagePath,
        label: kind === 'bike' ? `${brand} ${model} — photo` : `${brand} ${model} — ${angle}`,
        filename: `${id}-${angle}-${i + 1}.jpg`,
        url: `/api/refs/${refId}/${id}-${angle}-${i + 1}.jpg`,
        angle: angle as CarAngle,
      });
    }
    if (list.length) images[angle as CarAngle] = list;
  }

  /* ---- colours ---- */
  const colourUrls = [...new Set(html.match(COLOUR_RE) ?? [])]
    .filter((u) => modelRe.test(u))
    .sort((a, b) => resScore(b) - resScore(a));
  const seenColour = new Set<string>();
  const colours: CarColour[] = namedColours.map((name) => ({ name }));
  for (const u of kind === 'bike' ? [] : colourUrls) {
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
  const variants: CarVariant[] = parseVariants(variantHtml, kind === 'bike' ? model : model).map((v) => ({
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
    kind,
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
      [
        syncStatus === 'ok' ? '' : `Only ${angles.length} angle(s) found — upload the missing views manually.`,
        // What looking at the photographs changed, so a mislabelled set is visible
        // rather than silently believed.
        photoNotes.length ? `Checked the photos: ${[...new Set(photoNotes)].join('; ')}.` : '',
      ]
        .filter(Boolean)
        .join(' ') || undefined,
    createdAt: now,
    updatedAt: now,
  };
}
