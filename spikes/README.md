# Phase 1 engineering spikes

Two empirical questions the PRD says to answer by trying, not by discussion.
Both feed directly into how P0.2 (scraper) and P0.7 (chunking) get built — run
them before locking those designs. No stakeholder input needed.

## 1. Omni Flash context continuity (`omni-flash-continuity.ts`)

Does Gemini Omni Flash's conversational-edit context genuinely carry forward
attachment / reference-image grounding across sequential `extend` calls, or does
each call need references re-supplied?

**Method:** make 2–3 real API calls — one `create`, one `extend`, inspect the
output for reference drift (car design, presenter identity, on-screen text).
~15 minutes. Needs `GOOGLE_API_KEY` in the environment.

**Decides:** whether `buildPrompt` must repeat the `## REFERENCE IMAGES` block in
every part, and whether `apps/api/src/omniFlash.ts` re-attaches images per call.

## 2. cardekho.com scrapability (`cardekho-scrape.ts`)

Are model image URLs directly extractable from the listing pages, or behind JS
rendering that needs a headless browser (adds Cloud Run cost/complexity)?

**Method:** fetch the listing pages for the exact 12 models in
`jobs/scraper/models.json`, check whether front/side/rear/interior image URLs are
present in the initial HTML. Confirm the newer variants (e.g. Innova Hycross)
have full angle coverage.

**Decides:** whether `jobs/scraper` needs Playwright/puppeteer or a plain `fetch`
+ HTML parse is enough.

## Running

```bash
npm run build --workspace @ava/shared
GOOGLE_API_KEY=... node --experimental-strip-types spikes/omni-flash-continuity.ts
node --experimental-strip-types spikes/cardekho-scrape.ts
```
