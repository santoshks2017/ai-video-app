# AI Video App

AI-generated dealer ad-slot videos for CarDekho's design team: a structured
brief → editable storyboard → blocking pre-flight validation → master prompt,
with a direct video-gen API call for the categories the tech can actually do.

v1 is a **single-user tool** (Santosh). See [`docs/PRD-ai-video-app.md`](docs/PRD-ai-video-app.md)
for full scope and [`docs/HANDOFF-BRIEF-ai-video-app.md`](docs/HANDOFF-BRIEF-ai-video-app.md)
for the repo / hosting setup.

## Why it exists

Each generation costs Rs 300–1,000. Getting it wrong the first time (wrong car
model shown, dropped offer text, garbled Hindi pacing) means paying again. The
app enforces the details that decide whether a generation is usable *before* the
money is spent. Target: ≥90% first-time-right.

## Category split

| Mode | Categories | Output |
|---|---|---|
| **Automated** (5) | Showroom Walkaround, Product Feature, EV/Electric, Test Drive, New Launch | Calls Gemini Omni Flash with a server-side key |
| **Prompt-only** (4) | Delivery/Handover, Festival/Occasion, Offer/Deal, Customer Testimonial | Stops at the master prompt (no provider does lip-synced avatar generation yet) — replaces the old standalone tool |

## Layout

```
packages/shared   TypeScript: categories, rulebook, planScenes, runChecks, buildPrompt, cost estimate
apps/web          Vite + React — brief intake, storyboard, pre-flight, prompt output → Firebase Hosting
apps/api          Fastify — P0.1 Omni Flash call, P0.2 scrape trigger → Cloud Run  (STUBBED)
jobs/scraper      Cloud Run job — cardekho.com car-model reference scraper          (STUBBED)
spikes/           The two Phase 1 empirical spikes (Omni Flash continuity, scrapability)
legacy/           The prior prompt-only Claude Artifact tool, for reference
```

## Develop

```bash
npm install
npm run build --workspace @ava/shared     # other packages import its built output
npm test  --workspace @ava/shared         # ports the legacy tool's QA assertions
npm run dev:web                           # http://localhost:5173
npm run dev:api                           # http://localhost:8080  (needs GOOGLE_API_KEY for real calls)
```

## Build status (this scaffold)

- **Live:** brief intake (all 9 categories), editable storyboard, blocking pre-flight
  gate, master-prompt assembly with rulebook injection, cost estimate + Rs 500
  confirmation gate, prompt-only path for presenter categories.
- **Stubbed, pending Phase 1 spikes:** the Omni Flash API call (P0.1/P0.7), the
  cardekho.com scraper (P0.2), the post-generation video preview / frame timeline (P0.10).
- **Configured:** GitHub repo `santoshks2017/ai-video-app`; GCP + Firebase project
  `ai-video-app-cd` (`.firebaserc`).
- **Pending (see [`docs/DEPLOY-SETUP.md`](docs/DEPLOY-SETUP.md)):** billing link (Blaze),
  the deploy service account + WIF, GitHub Actions vars, first deploy.
