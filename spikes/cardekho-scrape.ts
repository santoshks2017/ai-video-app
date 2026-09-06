/**
 * SPIKE 2 — cardekho.com scrapability against the exact 12-model list.
 * See spikes/README.md. Fetches each listing page and reports whether image
 * URLs appear in the initial HTML (plain fetch is enough) or not (needs a
 * headless browser).
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

interface ModelEntry {
  brand: string;
  model: string;
  listingSlug: string;
}

const cfgPath = fileURLToPath(new URL('../jobs/scraper/models.json', import.meta.url));
const cfg = JSON.parse(await readFile(cfgPath, 'utf8')) as { models: ModelEntry[] };

const IMG_RE = /https?:\/\/[^"' ]+\.(?:jpg|jpeg|png|webp)/gi;

for (const m of cfg.models) {
  const url = `https://www.cardekho.com/${m.listingSlug}`;
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (spike)' } });
    const html = await res.text();
    const imgs = [...new Set(html.match(IMG_RE) ?? [])];
    const carImgs = imgs.filter((u) => /\/(car|model|gallery|images)/i.test(u));
    console.log(
      `${m.brand} ${m.model.padEnd(16)} ${res.status}  total-img-urls=${imgs.length}  likely-car=${carImgs.length}`,
    );
  } catch (e) {
    console.log(`${m.brand} ${m.model.padEnd(16)} FETCH FAILED — ${(e as Error).message}`);
  }
}

console.log(`
If "likely-car" is consistently > 4, a plain fetch + parse is enough for jobs/scraper.
If it is ~0 while the page clearly has images in a browser, the URLs are JS-rendered — add Playwright.
`);
