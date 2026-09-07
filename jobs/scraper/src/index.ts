/**
 * Car-model reference scraper (PRD P0.2) — Cloud Run JOB (batch / cron variant).
 *
 * The working implementation now lives in `apps/api/src/scraper.ts` and runs
 * inline from `POST /api/scrape` (spike done 2026-09-07: cardekho.com serves
 * image URLs in the initial HTML, no headless browser needed). This job is the
 * place for a scheduled full-list refresh (P2.4) and is still a stub — port the
 * logic from apps/api/src/scraper.ts when that's needed.
 *
 * Contract when real:
 *  - for each model, fetch >= 4 distinct angle shots (front/side/rear/interior)
 *  - write images to Firebase Storage: car-models/<brand>/<model>/<angle>.jpg
 *  - write metadata to Firestore: { model, variant, year, angle, sourceUrl, scrapedAt }
 *  - if a model returns nothing, mark it needs-manual-upload (app falls back to
 *    prompting for a manual set rather than proceeding with no reference)
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

interface ModelEntry {
  brand: string;
  model: string;
  listingSlug: string;
}
interface ModelsConfig {
  angles: string[];
  minAnglesRequired: number;
  models: ModelEntry[];
}

export interface ScrapeResult {
  brand: string;
  model: string;
  angles: string[];
  images: { angle: string; storagePath: string; sourceUrl: string }[];
  status: 'ok' | 'needs-manual-upload';
}

async function loadConfig(): Promise<ModelsConfig> {
  const path = fileURLToPath(new URL('../models.json', import.meta.url));
  return JSON.parse(await readFile(path, 'utf8')) as ModelsConfig;
}

async function scrapeModel(_entry: ModelEntry, _cfg: ModelsConfig): Promise<ScrapeResult> {
  throw new Error(
    'scrapeModel is stubbed. Run the cardekho.com scrapability spike (spikes/) before implementing.',
  );
}

async function main(): Promise<void> {
  const cfg = await loadConfig();
  const only = process.argv.slice(2); // optional: scrape a subset by model name
  const targets = only.length
    ? cfg.models.filter((m) => only.some((o) => m.model.toLowerCase().includes(o.toLowerCase())))
    : cfg.models;

  console.log(`[scraper] ${targets.length} model(s) queued:`, targets.map((t) => `${t.brand} ${t.model}`));
  console.log('[scraper] STUB — no network calls made. Implement scrapeModel() after the Phase 1 spike.');

  for (const t of targets) {
    try {
      const r = await scrapeModel(t, cfg);
      console.log(`[scraper] ${t.model}: ${r.status} (${r.images.length} images)`);
    } catch (e) {
      console.log(`[scraper] ${t.model}: not implemented — ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
