/**
 * A client's details read from its own website.
 *
 * The page is fetched and its obvious signals pulled out (see @ava/shared's
 * siteSignals); where a Gemini key is available, a text model then picks the
 * dealership's own name, phone, address and logo from them — a manufacturer's
 * dealer-locator page shows the car maker's logo and every outlet's number, and
 * only reading the page tells those apart. Without a key the strongest signals are
 * used as they are. The logo is cleaned and stored the way an uploaded one is.
 */

import { extractSiteSignals, tidyPhone, type SiteSignals, type StoredImage } from '@ava/shared';
import { cleanLogo } from './logos.js';
import { putRef, safeRefName } from './store.js';
import { resolveTextModel } from './script.js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
/** A business record naming the car maker rather than the dealership, as a manufacturer's dealer-locator page's does. */
const MAKER = /\b(cars india|motors india|motor india|motor corporation|kirloskar|mahindra & mahindra|maruti suzuki|tata motors|hyundai motor|kia india|honda cars|skoda auto|volkswagen india|renault india|nissan motor|mg motor)\b/i;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 AIVideoApp/1';

export class SiteImportError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

export interface SiteImport {
  url: string;
  name?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  logo?: StoredImage;
  logoWhite?: StoredImage;
  /** Whose logo it is: the dealership's own, or the car maker's shown on a dealer-locator page. */
  logoKind?: 'dealer' | 'brand';
  notes: string[];
}

async function fetchPage(url: string): Promise<{ html: string; url: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new SiteImportError('site-unreachable', `Could not reach ${url}. Check the address and try again.`, 502);
  }
  if (!res.ok) throw new SiteImportError('site-refused', `${url} answered ${res.status}.`, 502);
  const type = res.headers.get('content-type') ?? '';
  if (type && !/html|xml/i.test(type)) throw new SiteImportError('site-not-a-page', `${url} is not a web page.`, 400);
  const html = (await res.text()).slice(0, 3_000_000);
  return { html, url: res.url || url };
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (type && !/image|svg|octet-stream/i.test(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > 100 && bytes.length < 8_000_000 ? bytes : null;
  } catch {
    return null;
  }
}

interface Picked {
  name?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  logo?: number | null;
  logoIsManufacturer?: boolean;
}

async function pickWithModel(s: SiteSignals, apiKey: string): Promise<Picked | null> {
  const model = await resolveTextModel(apiKey, 'transform').catch(() => '');
  if (!model) return null;
  const prompt = [
    'You are reading a car dealership’s website to fill in its client record.',
    'Use only what the page says. Leave a field null rather than guess. A manufacturer’s dealer-locator page lists the car maker’s logo and the numbers of other outlets — pick this dealership’s own details.',
    '',
    'Return JSON only:',
    '{"name": the dealership’s trading name, "phone": its main sales number as written, "address": the showroom’s full street address, "city": the city, "state": the Indian state, "logo": the number of the dealership’s logo in the list below or null, "logoIsManufacturer": true if that logo is the car maker’s (Honda, Tata, Toyota…) rather than the dealership’s own}',
    '',
    `Page: ${s.url}`,
    `Title: ${s.title ?? ''}`,
    ...(s.siteName ? [`Site name: ${s.siteName}`] : []),
    ...(s.org ? [`Business record: ${JSON.stringify(s.org)}`] : []),
    `Phone links: ${JSON.stringify(s.phones.slice(0, 12))}`,
    'Logo candidates:',
    ...(s.logos.length ? s.logos.map((l, i) => `${i}. ${l.url} — found as ${l.foundAs}`) : ['(none)']),
    '',
    `Page text: """${s.text.slice(0, 14000)}"""`,
  ].join('\n');
  const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const json = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  try {
    const o = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) as Record<string, unknown>;
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, 300) : undefined);
    return {
      name: str(o.name),
      phone: str(o.phone),
      address: str(o.address),
      city: str(o.city),
      state: str(o.state),
      logo: typeof o.logo === 'number' && Number.isInteger(o.logo) && o.logo >= 0 && o.logo < s.logos.length ? o.logo : null,
      logoIsManufacturer: o.logoIsManufacturer === true,
    };
  } catch {
    return null;
  }
}

export async function importWebsite(rawUrl: string, apiKey?: string): Promise<SiteImport> {
  const start = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  const page = await fetchPage(start);
  const signals = extractSiteSignals(page.html, page.url);
  const notes: string[] = [];

  // A home page often keeps the address and phone on its contact page.
  if (!signals.org?.address && signals.contactLinks[0]) {
    const contact = await fetchPage(signals.contactLinks[0]).catch(() => null);
    if (contact) {
      const more = extractSiteSignals(contact.html, contact.url);
      signals.phones = [...new Set([...signals.phones, ...more.phones])];
      signals.org = { ...more.org, ...signals.org };
      signals.text = `${signals.text}\n\nContact page:\n${more.text}`.slice(0, 30000);
      if (!signals.logos.length) signals.logos = more.logos;
    }
  }

  const picked = apiKey ? await pickWithModel(signals, apiKey) : null;
  if (!picked) notes.push(apiKey ? 'read without the text model, from the page’s own markup' : 'read from the page’s own markup');

  // Without the model: a manufacturer's dealer-locator page describes the maker in its
  // business record and shows the maker's logo, so the dealership's name comes from the
  // page title instead — "Tata Motors Cars Showroom - TC Motors, Rajarhat | Official dealer".
  const host = /^https?:\/\/(?:www\.)?([^/?#:]+)/i.exec(page.url)?.[1] ?? '';
  const makersPage = /dealer/i.test(host) && MAKER.test(signals.org?.name ?? '');
  const titled = signals.title?.split(/\s\|\s/)[0]?.split(/\s[-–—]\s/).pop()?.trim();
  const name = picked?.name ?? (makersPage ? titled : (signals.org?.name ?? signals.siteName ?? titled));
  const phone = picked?.phone ?? signals.org?.telephone ?? signals.phones[0];
  const logoIndex = picked ? picked.logo : signals.logos[0] && signals.logos[0].score >= 5 ? 0 : null;
  const orgState = signals.org?.state && !/^india$/i.test(signals.org.state) ? signals.org.state : undefined;
  const out: SiteImport = {
    url: page.url,
    name: name?.trim() || undefined,
    phone: phone ? tidyPhone(phone) : undefined,
    address: picked?.address ?? signals.org?.address,
    city: picked?.city ?? signals.org?.city,
    state: picked?.state ?? orgState,
    notes,
  };

  if (logoIndex !== null && logoIndex !== undefined) {
    const candidate = signals.logos[logoIndex]!;
    const bytes = await fetchImage(candidate.url);
    const cleaned = bytes ? await cleanLogo(bytes).catch(() => null) : null;
    if (cleaned) {
      const host = (/^https?:\/\/(?:www\.)?([^/?#:]+)/i.exec(page.url)?.[1] ?? 'site').replace(/[^a-z0-9]+/gi, '-');
      const base = `${host}-site-logo-${Date.now().toString(36)}`;
      const label = `${out.name ?? host} logo`;
      const colour = await putRef(`${base}.png`, 'image/png', cleaned.colour);
      const white = await putRef(`${base}-white.png`, 'image/png', cleaned.white);
      out.logo = { refId: colour.refId, storagePath: colour.storagePath, filename: `${base}.png`, label, url: `/api/refs/${colour.refId}/${safeRefName(`${base}.png`)}` };
      out.logoWhite = { refId: white.refId, storagePath: white.storagePath, filename: `${base}-white.png`, label: `${label} (white)`, url: `/api/refs/${white.refId}/${safeRefName(`${base}-white.png`)}` };
      out.logoKind = (picked ? picked.logoIsManufacturer : makersPage) ? 'brand' : 'dealer';
    } else {
      notes.push('the logo on the page could not be downloaded');
    }
  }
  return out;
}
