/**
 * Vehicle sync from the manufacturer's own website.
 *
 * CarDekho is quick and uniform, but it is a third party — and a dealer's client
 * watched an "XUV 3XO" film built on photos of the discontinued XUV300. The answer
 * to that has to be "every frame came from your own website", so a vehicle can be
 * synced from the OEM page instead, and switched back whenever the team wants.
 *
 * Manufacturer sites are all different, so nothing here is written for one brand:
 *  - schema.org JSON-LD carries the model, its variants, its colours, the price band
 *    and the headline specs on most OEM pages;
 *  - the page's own photos are shortlisted by URL and then LOOKED AT, so a front, a
 *    side, a rear and an interior are chosen by what the picture shows. Filenames
 *    cannot be trusted: "Untitled-4_0008_Dead_Front.jpg" is the good case, not the rule;
 *  - whatever the JSON-LD leaves out is read from the page's text.
 */

import { putRef } from './store.js';
import { resolveTextModel } from './script.js';
import type {
  CarAngle,
  CarColour,
  CarModelProfile,
  CarSpecs,
  CarVariant,
  StoredImage,
  VehicleKind,
} from '@ava/shared';

const UA = 'Mozilla/5.0 (compatible; ai-video-app/1)';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

export class OemSyncError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

const slugify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const titleCase = (s: string): string =>
  s.trim().toLowerCase().replace(/(^|[\s\-/])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());

async function fetchText(url: string): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
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

async function fetchImage(url: string): Promise<{ bytes: Buffer; mime: string } | null> {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA } });
    if (!r.ok) return null;
    const bytes = Buffer.from(await r.arrayBuffer());
    // A few hundred bytes is a tracking pixel; several megabytes is a hero banner
    // nobody needs at full size inside a prompt.
    if (bytes.length < 8_000 || bytes.length > 8_000_000) return null;
    return { bytes, mime: r.headers.get('content-type')?.split(';')[0] || 'image/jpeg' };
  } catch {
    return null;
  }
}

async function store(url: string, label: string, filename: string): Promise<StoredImage | null> {
  const got = await fetchImage(url);
  if (!got) return null;
  const put = await putRef(filename, got.mime, got.bytes).catch(() => null);
  if (!put) return null;
  return { refId: put.refId, storagePath: put.storagePath, label, filename, url: `/api/refs/${put.refId}/${filename}` };
}

/* ------------------------------ the page ---------------------------------- */

/** Every JSON-LD node on the page, @graph included. A broken block is not a broken page. */
function jsonLdNodes(html: string): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      const node = value as Record<string, any>;
      out.push(node);
      if (node['@graph']) walk(node['@graph']);
    }
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse((m[1] ?? '').trim()));
    } catch {
      /* ignore */
    }
  }
  return out;
}

const VEHICLE_TYPE = /^(vehicle|car|automobile|motorcycle|motorbike|product|productmodel)$/i;
const typesOf = (node: Record<string, any>): string[] => [node['@type']].flat().map((t) => String(t ?? ''));

function vehicleNode(nodes: Record<string, any>[]): Record<string, any> | null {
  return (
    nodes.find((n) => typesOf(n).some((t) => /^(vehicle|car|automobile|motorcycle|motorbike)$/i.test(t))) ??
    nodes.find((n) => typesOf(n).some((t) => VEHICLE_TYPE.test(t))) ??
    null
  );
}

const asList = (v: unknown): string[] =>
  [v]
    .flat()
    .map((x) => (typeof x === 'string' ? x : typeof x === 'object' && x ? String((x as any).name ?? '') : ''))
    .map((s) => s.trim())
    .filter(Boolean);

/** "779000" → "7.79 Lakh", the way an Indian showroom writes it. */
function lakh(value: unknown): string | undefined {
  const n = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n >= 100_000 ? `${(n / 100_000).toFixed(2).replace(/\.00$/, '')} Lakh` : String(Math.round(n));
}

/* ------------------------------ the photos -------------------------------- */

const IMG_EXT = /\.(jpe?g|png|webp)(\?|$)/i;
const JUNK =
  /(logo|icon|sprite|favicon|placeholder|avatar|arrow|chevron|social|app-?store|play-?store|whatsapp|thumbnail|thumb\b|blog|news|press|awards?|dealer|offer|emi|finance|brochure|qr-?code)/i;

function absolute(raw: string, pageUrl: string): string | null {
  try {
    const u = new URL(raw.trim().replace(/&amp;/g, '&'), pageUrl);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Every image the page points at: its JSON-LD gallery, its <img> tags, its CSS backgrounds. */
function imageCandidates(html: string, pageUrl: string, node: Record<string, any> | null): string[] {
  const found: string[] = [];
  const add = (raw?: string | null): void => {
    if (!raw) return;
    const url = absolute(raw, pageUrl);
    if (url && IMG_EXT.test(url)) found.push(url);
  };

  for (const im of [node?.image].flat()) {
    if (typeof im === 'string') add(im);
    else if (im && typeof im === 'object') add((im as any).url ?? (im as any).contentUrl);
  }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    add(/\bsrc=["']([^"']+)["']/i.exec(tag)?.[1]);
    add(/\bdata-src=["']([^"']+)["']/i.exec(tag)?.[1]);
    const srcset = /\bsrcset=["']([^"']+)["']/i.exec(tag)?.[1];
    for (const part of (srcset ?? '').split(',')) add(part.trim().split(/\s+/)[0]);
  }
  for (const m of html.matchAll(/url\((["']?)(https?:[^"')]+)\1\)/gi)) add(m[2]);
  // A gallery built in JavaScript still ships its URLs in the page: Tata's model page
  // has no <img> for the car at all, only quoted paths inside its scripts.
  for (const m of html.matchAll(/["'](https?:\/\/[^"'\s]+?\.(?:jpe?g|png|webp))(?:\?[^"'\s]*)?["']/gi)) add(m[1]);
  for (const m of html.matchAll(/["'](\/[^"'\s]+?\.(?:jpe?g|png|webp))(?:\?[^"'\s]*)?["']/gi)) add(m[1]);

  // One entry per image: the same file arrives many times at many widths.
  const byPath = new Map<string, string>();
  for (const url of found) {
    const path = url.split('?')[0]!;
    if (JUNK.test(path)) continue;
    if (!byPath.has(path)) byPath.set(path, url);
  }
  return [...byPath.values()];
}

/** How likely a URL is to be a real photo of this model, before anything is downloaded. */
function shortlist(urls: string[], hints: string[], limit: number): string[] {
  const score = (url: string): number => {
    const path = squash(url.split('?')[0]!);
    let n = 0;
    if (hints.some((h) => h && path.includes(h))) n += 4;
    if (/(hires|large|gallery|exterior|interior|360)/.test(path)) n += 2;
    // The same shot ships at several sizes; the big one is what a video model needs.
    if (/(desk|desktop|1920|1600|1440|1366|1080)/.test(path)) n += 2;
    if (/(mobile|mob|small|tiny|thumb|2x)/.test(path)) n -= 2;
    if (/(banner|hero)/.test(path)) n -= 1;
    return n;
  };
  // A manufacturer's model page also shows its other models — the XUV 7XO and the Thar
  // sit in the footer of the XUV 3XO's page. When the page names this model in its own
  // image paths, only those photos are this model's.
  const named = urls.filter((u) => hints.some((h) => h && squash(u.split('?')[0]!).includes(h)));
  const pool = named.length >= 3 ? named : urls;
  return [...pool].sort((a, b) => score(b) - score(a)).slice(0, limit);
}

/** The view a filename claims, for when there is no key to look at the photo with. */
function angleFromName(url: string): CarAngle | null {
  const path = url.toLowerCase();
  if (/(interior|dashboard|cabin|seat|steering|console|legroom|leg-room|boot|infotainment|screen)/.test(path)) return 'interior';
  if (/(rear|tail|back)/.test(path)) return 'rear';
  if (/(side|profile|alloy|wheel)/.test(path)) return 'side';
  if (/(front|grille|fascia|nose|face|dead_front)/.test(path)) return 'front';
  return null;
}

interface Seen {
  url: string;
  view: CarAngle | 'detail' | 'other';
  vehicle: boolean;
  colour?: string;
}

/**
 * What each photo actually shows.
 *
 * The whole point of syncing from the manufacturer is that the pictures are right,
 * so they are looked at rather than guessed from their filenames: one call, every
 * shortlisted photo in it, answering what the shot is and which colour it wears.
 */
async function lookAtPhotos(
  urls: string[],
  subject: string,
  apiKey: string,
): Promise<Seen[]> {
  const loaded: { url: string; bytes: Buffer; mime: string }[] = [];
  for (const url of urls) {
    const got = await fetchImage(url);
    if (got) loaded.push({ url, ...got });
    if (loaded.length >= 20) break;
  }
  if (!loaded.length) return [];
  if (!apiKey) return loaded.map((l) => ({ url: l.url, view: angleFromName(l.url) ?? 'other', vehicle: true }));

  const instruction = [
    `These ${loaded.length} photos come from the official web page of the ${subject}.`,
    'For each photo, in the order given, say what it shows.',
    '',
    'view — "front" for a front or front three-quarter shot of the whole vehicle, "side" for a side profile or',
    'side three-quarter, "rear" for a rear or rear three-quarter, "interior" for anything shot inside the cabin',
    '(dashboard, seats, screen, legroom), "detail" for a close-up of one exterior part (lamp, grille, alloy,',
    'badge), "other" for anything that is not a photo of this vehicle — a graphic, a logo, a person, a map, a',
    'different vehicle — a different model from the same brand counts as a different vehicle.',
    'vehicle — true only if the whole picture is this vehicle or its cabin.',
    'colour — the body colour if the shot is clearly of one paint colour, otherwise leave it out.',
    '',
    'Return JSON only: an array of {"i": <0-based index>, "view": "...", "vehicle": true|false, "colour": "..."}.',
    'One object per photo, in order. No commentary.',
  ].join('\n');

  const model = await resolveTextModel(apiKey, 'transform');
  const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: instruction },
            ...loaded.map((l) => ({ inline_data: { mime_type: l.mime, data: l.bytes.toString('base64') } })),
          ],
        },
      ],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    // A model that cannot look at the photos is not a reason to lose the sync.
    return loaded.map((l) => ({ url: l.url, view: angleFromName(l.url) ?? 'other', vehicle: true }));
  }
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  let rows: { i?: number; view?: string; vehicle?: boolean; colour?: string }[] = [];
  try {
    const parsed = JSON.parse(text.replace(/^```json|```$/g, '').trim());
    rows = Array.isArray(parsed) ? parsed : (parsed.photos ?? []);
  } catch {
    rows = [];
  }
  return loaded.map((l, i) => {
    const row = rows.find((r) => Number(r.i) === i) ?? rows[i];
    const view = String(row?.view ?? '').toLowerCase();
    return {
      url: l.url,
      view: (['front', 'side', 'rear', 'interior', 'detail'].includes(view) ? view : 'other') as Seen['view'],
      vehicle: row?.vehicle !== false,
      colour: row?.colour?.trim() || undefined,
    };
  });
}

/* ------------------------------ the words --------------------------------- */

const pageText = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

interface ReadPage {
  model?: string;
  variants?: { name?: string; price?: string; fuel?: string; transmission?: string }[];
  colours?: string[];
  specs?: Record<string, string>;
  highlights?: string[];
}

/** What the page says, for the parts its JSON-LD leaves out. */
async function readPageText(html: string, subject: string, apiKey: string): Promise<ReadPage> {
  if (!apiKey) return {};
  const text = pageText(html).slice(0, 40_000);
  if (text.length < 400) return {};
  const instruction = [
    `Below is the text of the official web page for the ${subject}. Read it and report only what it actually says.`,
    'Never infer, never fill a gap from your own knowledge, and leave anything the page does not state out.',
    '',
    'Return JSON only:',
    '{"model": "<model name as the page writes it>",',
    ' "variants": [{"name": "...", "price": "<as printed, e.g. 7.99 Lakh>", "fuel": "...", "transmission": "..."}],',
    ' "colours": ["..."],',
    ' "specs": {"priceRange": "...", "engine": "...", "power": "...", "torque": "...", "transmission": "...",',
    '   "mileage": "...", "bootSpace": "...", "groundClearance": "...", "fuelTank": "...", "airbags": "...",',
    '   "seating": "...", "drivetrain": "...", "dimensions": "..."},',
    ' "highlights": ["<a plain sentence the page states, quotable as-is>"]}',
    '',
    'THE PAGE:',
    text,
  ].join('\n');
  try {
    const model = await resolveTextModel(apiKey, 'transform');
    const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: instruction }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) return {};
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const out = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    return JSON.parse(out.replace(/^```json|```$/g, '').trim()) as ReadPage;
  } catch {
    return {};
  }
}

/* ------------------------------- the page's facts -------------------------- */

export interface VehiclePageFacts {
  brand: string;
  model: string;
  subject: string;
  year?: string;
  bodyType?: string;
  colourNames: string[];
  variants: CarVariant[];
  specs: CarSpecs;
  highlights: string[];
  /** Every photo the page points at, best candidates first. */
  candidates: string[];
}

/**
 * The model, out of a page title written for search engines: Hyundai's Creta page calls
 * itself "CRETA King, Knight, King Limited Edition car Price, Features and Variant".
 * The brand is dropped too — "Mahindra XUV 3XO" on a Mahindra page says it twice.
 */
function modelName(ldName: string, brand: string): string {
  return ldName
    .split(/[,|·–—]/)[0]!
    .replace(new RegExp(`^${brand}\\s+`, 'i'), '')
    .replace(/\b(price|features?|variants?|specifications?|mileage|images?|colou?rs?|in india)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The brand, from what the page says and, failing that, from its own domain. */
function brandFrom(url: string, node: Record<string, any> | null, name: string): string {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  const fromHost = host.split('.').filter((p) => !/^(auto|cars?|www|in|co|com|net|org|global)$/i.test(p))[0] ?? '';
  const ldBrand = typeof node?.brand === 'object' ? String(node?.brand?.name ?? '') : String(node?.brand ?? '');
  const candidate = fromHost || ldBrand.split(/\s+/)[0] || name.split(/\s+/)[0] || '';
  return titleCase(candidate);
}

/**
 * Everything a manufacturer's page states about the model, read without a network
 * call or an API key: schema.org first, because that is where OEM sites put the
 * variants, the colours, the price band and the headline numbers.
 */
export function readVehiclePage(
  html: string,
  pageUrl: string,
  override: { brand?: string; model?: string } = {},
): VehiclePageFacts {
  const nodes = jsonLdNodes(html);
  const node = vehicleNode(nodes);
  const ldName = String(node?.name ?? '').trim();
  const brand = override.brand?.trim() || brandFrom(pageUrl, node, ldName);
  // "Mahindra XUV 3XO" on a Mahindra page is the model with the brand said twice.
  const model =
    override.model?.trim() ||
    modelName(ldName, brand) ||
    titleCase(new URL(pageUrl).pathname.split('/').filter(Boolean).slice(-2)[0] ?? 'Model');

  const props: Record<string, string> = {};
  for (const p of [node?.additionalProperty].flat()) {
    const name = String((p as any)?.name ?? '').trim();
    const value = String((p as any)?.value ?? '').trim();
    if (name && value) props[name.toLowerCase()] = value;
  }
  const prop = (...names: string[]): string | undefined => names.map((n) => props[n]).find(Boolean);
  const engines = [node?.vehicleEngine].flat().filter(Boolean) as Record<string, any>[];

  const specs: CarSpecs = {
    priceRange:
      node?.offers?.lowPrice && node?.offers?.highPrice
        ? `${lakh(node.offers.lowPrice)} - ${lakh(node.offers.highPrice)}`
        : undefined,
    basePrice: node?.offers?.lowPrice ? String(node.offers.lowPrice) : undefined,
    engine: engines.map((e) => String(e.name ?? '')).filter(Boolean).join(', ') || undefined,
    power: prop('max power', 'power'),
    torque: prop('max torque', 'torque'),
    transmission: asList(node?.vehicleTransmission).join(', ') || undefined,
    fuelTypes: [
      ...new Set(engines.flatMap((e) => String(e.fuelType ?? '').split(/[,/]/).map((f) => f.trim())).filter(Boolean)),
    ],
    mileage: prop('mileage', 'fuel efficiency'),
    bootSpace: prop('boot space', 'luggage space'),
    groundClearance: prop('ground clearance'),
    fuelTank: prop('fuel tank', 'fuel tank capacity'),
    airbags: node?.numberOfAirbags ? String(node.numberOfAirbags) : prop('airbags'),
    seating: node?.vehicleSeatingCapacity ? String(node.vehicleSeatingCapacity) : undefined,
    drivetrain: String(node?.driveWheelConfiguration ?? '') || undefined,
    dimensions: node?.wheelbase ? `Wheelbase ${String(node.wheelbase)}` : undefined,
  };
  for (const k of Object.keys(specs) as (keyof CarSpecs)[]) {
    const v = specs[k];
    if (!v || (Array.isArray(v) && !v.length)) delete specs[k];
  }

  const hints = [squash(model), squash(`${brand}${model}`), squash(new URL(pageUrl).pathname.split('/').pop() ?? '')]
    .filter((h) => h.length >= 3);

  return {
    brand,
    model,
    subject: `${brand} ${model}`.trim(),
    year: node?.vehicleModelDate ? String(node.vehicleModelDate) : undefined,
    bodyType: String(node?.bodyType ?? '') || undefined,
    colourNames: [...new Set(asList(node?.color).map((c) => titleCase(c)))],
    variants: asList(node?.model).map((name) => ({ name, images: {}, colours: [] })),
    specs,
    highlights: Object.entries(props).map(([k, v]) => `${titleCase(k)}: ${v}`),
    candidates: shortlist(imageCandidates(html, pageUrl, node), hints, 40),
  };
}

/* ------------------------------- the sync --------------------------------- */

export interface OemSyncInput {
  /** The manufacturer's page for this model. */
  url: string;
  kind?: VehicleKind;
  /** Overrides for a vehicle already in the library, so a re-sync lands on the same record. */
  id?: string;
  brand?: string;
  model?: string;
  apiKey?: string;
  perAngle?: Partial<Record<CarAngle, number>>;
  maxColours?: number;
}

export async function syncOemModel(input: OemSyncInput): Promise<CarModelProfile> {
  const kind: VehicleKind = input.kind ?? 'car';
  const now = Date.now();
  const html = await fetchText(input.url);
  if (!html) {
    throw new OemSyncError(
      'oem-page-unreadable',
      `Nothing came back from ${input.url}. Check the link opens in a browser.`,
    );
  }

  const facts = readVehiclePage(html, input.url, { brand: input.brand, model: input.model });
  const { brand, model, subject } = facts;
  const id = input.id ?? `oem__${slugify(brand)}__${slugify(model)}`;
  const apiKey = input.apiKey ?? '';

  const seen = await lookAtPhotos(facts.candidates.slice(0, 24), subject, apiKey);

  /* ---- angle images ---- */
  const want: Record<CarAngle, number> = {
    front: input.perAngle?.front ?? 2,
    side: input.perAngle?.side ?? 2,
    rear: input.perAngle?.rear ?? 1,
    interior: input.perAngle?.interior ?? 2,
  };
  const images: Partial<Record<CarAngle, StoredImage[]>> = {};
  for (const angle of ['front', 'side', 'rear', 'interior'] as CarAngle[]) {
    const picks = seen.filter((s) => s.vehicle && s.view === angle).slice(0, want[angle]);
    const list: StoredImage[] = [];
    for (let i = 0; i < picks.length; i++) {
      const img = await store(picks[i]!.url, `${subject} — ${angle}`, `${id}-${angle}-${i + 1}.jpg`);
      if (img) list.push(img);
    }
    if (list.length) images[angle] = list;
  }

  /* ---- whatever the structured data left out ---- */
  const read =
    facts.colourNames.length && facts.variants.length && Object.keys(facts.specs).length >= 4
      ? {}
      : await readPageText(html, subject, apiKey);

  /* ---- colours: the page's own names, with the shot that wears each one ---- */
  const colourNames = [...new Set([...facts.colourNames, ...(read.colours ?? []).map((c) => titleCase(c))])].slice(
    0,
    input.maxColours ?? 16,
  );
  const colours: CarColour[] = [];
  for (const name of colourNames) {
    const key = squash(name);
    const match =
      facts.candidates.find((u) => squash(u.split('?')[0]!).includes(key)) ??
      seen.find((s) => s.colour && squash(s.colour) === key)?.url;
    const img = match ? await store(match, `${subject} — ${name}`, `${id}-colour-${slugify(name)}.jpg`) : null;
    colours.push({ name, image: img ?? undefined });
  }

  /* ---- variants ---- */
  const byName = new Map<string, CarVariant>();
  for (const v of facts.variants) byName.set(v.name.toLowerCase(), v);
  for (const v of read.variants ?? []) {
    const name = String(v.name ?? '').trim();
    if (!name) continue;
    const at = byName.get(name.toLowerCase()) ?? { name, images: {}, colours: [] };
    byName.set(name.toLowerCase(), {
      ...at,
      price: v.price?.trim() || at.price,
      fuel: v.fuel?.trim() || at.fuel,
      transmission: v.transmission?.trim() || at.transmission,
    });
  }

  const specs: CarSpecs = { ...(read.specs as CarSpecs | undefined), ...facts.specs };
  const highlights = [...facts.highlights, ...(read.highlights ?? [])].map((h) => h.trim()).filter(Boolean).slice(0, 10);

  const angles = Object.keys(images) as CarAngle[];
  const syncStatus: CarModelProfile['syncStatus'] =
    angles.length >= 4 ? 'ok' : angles.length >= 2 ? 'partial' : 'needs-manual';

  return {
    id,
    kind,
    brand,
    model,
    slug: `${slugify(brand)}/${slugify(model)}`,
    year: facts.year,
    bodyType: facts.bodyType,
    images,
    colours,
    variants: [...byName.values()],
    specs,
    highlights,
    source: 'oem',
    oemUrl: input.url,
    sourceUrl: input.url,
    syncedAt: now,
    syncStatus,
    syncNote:
      syncStatus === 'ok'
        ? undefined
        : `Only ${angles.length} angle(s) found on ${new URL(input.url).hostname}. Add the missing views by hand, or sync this one from CarDekho.`,
    createdAt: now,
    updatedAt: now,
  };
}
