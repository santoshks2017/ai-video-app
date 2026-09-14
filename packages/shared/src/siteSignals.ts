/**
 * What a dealership's website says about it, read from the page itself.
 *
 * The details a client needs — its name, phone, address and logo — sit on most
 * dealer websites in a few predictable places: schema.org data written for search
 * engines, the Open Graph tags written for link previews, `tel:` links, and an image
 * somebody named "logo". This pulls those out of the HTML without a browser, so the
 * server can hand a text model a short list of candidates rather than a whole page
 * to guess from — and still has an answer when there is no model to ask.
 */

export interface LogoCandidate {
  url: string;
  /** Higher is likelier to be the site's own logo. */
  score: number;
  /** Where on the page it was found, for the model reading the list. */
  foundAs: string;
  alt?: string;
}

export interface SiteSignals {
  url: string;
  title?: string;
  siteName?: string;
  /** The schema.org record describing the business, where the page has one. */
  org?: { name?: string; telephone?: string; address?: string; city?: string; state?: string; logo?: string };
  /** Phone numbers from `tel:` links, in page order. */
  phones: string[];
  logos: LogoCandidate[];
  /** Links on the same site that look like its contact page. */
  contactLinks: string[];
  /** The page's readable text. */
  text: string;
}

const decode = (s: string): string =>
  s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  const v = m ? (m[1] ?? m[2] ?? m[3]) : undefined;
  return v === undefined ? undefined : decode(v).trim();
};

/** A link resolved against the page it is on. No URL global needed, so this runs anywhere. */
export function resolveLink(href: string | undefined, base: string): string | undefined {
  if (!href || /^(data|javascript|mailto|tel|#)/i.test(href)) return undefined;
  if (/^https?:\/\//i.test(href)) return href;
  const origin = /^(https?:\/\/[^/?#]+)/i.exec(base)?.[1];
  if (!origin) return undefined;
  if (href.startsWith('//')) return `${origin.split('//')[0]}${href}`;
  if (href.startsWith('/')) return `${origin}${href}`;
  const dir = base.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  return `${dir}${href}`;
}

/**
 * An Indian mobile number written one way: "+91 86575 88492". Only a number that is
 * unmistakably a mobile is rewritten — ten digits, or ten after +91. With a leading 0 it
 * could as well be a landline and its STD code (080 4275 3684), so it is kept as written.
 */
export function tidyPhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  const local = digits.length === 12 && /^\+?\s*91/.test(raw.trim()) ? digits.slice(2) : digits.length === 10 ? digits : '';
  if (/^[6-9]\d{9}$/.test(local)) return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
  return raw.replace(/\s+/g, ' ').trim();
}

const BUSINESS = /Organization|LocalBusiness|AutoDealer|AutomotiveBusiness|AutoRepair|Store|Dealer/i;

function businessRecord(html: string): SiteSignals['org'] {
  const queue: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      queue.push(JSON.parse(m[1]!.trim()));
    } catch {
      /* commented out, or not JSON */
    }
  }
  while (queue.length) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }
    if (!node || typeof node !== 'object') continue;
    const o = node as Record<string, unknown>;
    if (o['@graph']) queue.push(o['@graph']);
    const type = Array.isArray(o['@type']) ? o['@type'].join(' ') : String(o['@type'] ?? '');
    if (!BUSINESS.test(type) || !(o.name || o.telephone || o.address)) continue;
    const a = o.address;
    const address =
      typeof a === 'string'
        ? a
        : a && typeof a === 'object'
          ? ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode']
              .map((k) => (a as Record<string, unknown>)[k])
              .filter((v): v is string => typeof v === 'string' && Boolean(v.trim()))
              .join(', ')
          : undefined;
    const logo = o.logo;
    return {
      name: typeof o.name === 'string' ? o.name : undefined,
      telephone: typeof o.telephone === 'string' ? o.telephone : undefined,
      address: address || undefined,
      city: a && typeof a === 'object' && typeof (a as Record<string, unknown>).addressLocality === 'string' ? String((a as Record<string, unknown>).addressLocality) : undefined,
      state: a && typeof a === 'object' && typeof (a as Record<string, unknown>).addressRegion === 'string' ? String((a as Record<string, unknown>).addressRegion) : undefined,
      logo: typeof logo === 'string' ? logo : logo && typeof logo === 'object' && typeof (logo as Record<string, unknown>).url === 'string' ? String((logo as Record<string, unknown>).url) : undefined,
    };
  }
  return undefined;
}

/** Images that say "logo" but are somebody else's: the store badges, the social icons, a QR code. */
const NOT_ITS_LOGO = /google|qr[-_ ]?|play-?store|app-?store|whatsapp|facebook|instagram|twitter|youtube|linkedin|payment|visa|mastercard|sprite|loader|spinner|powered/i;

export function extractSiteSignals(html: string, url: string): SiteSignals {
  const meta = (key: string): string | undefined => {
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
      if ((attr(tag, 'property') ?? attr(tag, 'name'))?.toLowerCase() === key) return attr(tag, 'content') || undefined;
    }
    return undefined;
  };
  const org = businessRecord(html);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html.replace(/<!--[\s\S]*?-->/g, ''))?.[1];

  const phones = [
    ...new Set(
      [...html.matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)].map((m) => decode(m[1]!).trim()).filter((p) => p.replace(/\D/g, '').length >= 8),
    ),
  ];

  const found = new Map<string, LogoCandidate>();
  const offer = (href: string | undefined, score: number, foundAs: string, alt?: string): void => {
    const abs = resolveLink(href, url);
    if (!abs || NOT_ITS_LOGO.test(abs)) return;
    const had = found.get(abs);
    if (!had || had.score < score) found.set(abs, { url: abs, score, foundAs, alt: alt || had?.alt });
  };
  if (org?.logo) offer(org.logo, 9, 'the business record for search engines');
  const cut = html.length * 0.3;
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attr(tag, 'src') || attr(tag, 'data-src');
    const alt = attr(tag, 'alt');
    const named = [attr(tag, 'class'), attr(tag, 'id'), attr(tag, 'data-track-event-name')].join(' ');
    const said = `${named} ${alt ?? ''} ${src ?? ''}`;
    if (!src || !/logo/i.test(said) || NOT_ITS_LOGO.test(said)) continue;
    const before = html.slice(Math.max(0, (m.index ?? 0) - 1500), m.index ?? 0);
    const score = 5 + (/logo/i.test(named) ? 2 : 0) + ((m.index ?? 0) < cut ? 1 : 0) + (/<header\b|navbar|nav-brand|site-brand/i.test(before) ? 1 : 0);
    offer(src, score, `an image marked "logo"${alt ? ` (alt text "${alt}")` : ''}`, alt);
  }
  const og = meta('og:image');
  if (og) offer(og, /logo/i.test(og) ? 6 : 1, 'the link-preview image');
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, 'rel')?.toLowerCase() ?? '';
    if (rel.includes('apple-touch-icon')) offer(attr(tag, 'href'), 2, 'the home-screen icon');
  }

  const contactLinks = [
    ...new Set(
      [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
        .filter((m) => /contact|reach[-_ ]?us|locate|find[-_ ]?us/i.test(`${m[1]} ${m[2]}`))
        .map((m) => resolveLink(decode(m[1]!), url))
        .filter((h): h is string => Boolean(h) && (h as string).startsWith((/^(https?:\/\/[^/?#]+)/i.exec(url)?.[1]) ?? ' ')),
    ),
  ].slice(0, 3);

  const text = decode(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20000);

  return {
    url,
    title: title ? decode(title).replace(/\s+/g, ' ').trim() || undefined : undefined,
    siteName: meta('og:site_name'),
    org,
    phones,
    logos: [...found.values()].sort((a, b) => b.score - a.score).slice(0, 8),
    contactLinks,
    text,
  };
}
