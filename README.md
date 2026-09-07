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
apps/web          Vite + React — brief, storyboard, pre-flight, prompt, generate + preview → Firebase Hosting
apps/api          Fastify — /api/generate (Omni Flash create→extend), job store, clip streaming → Cloud Run
jobs/scraper      Cloud Run job — cardekho.com car-model reference scraper          (STUBBED, P0.2)
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

## Build status

- **Live:** brief intake (all 9 categories), editable storyboard, blocking pre-flight
  gate, master-prompt assembly with rulebook injection, cost estimate + Rs 500
  confirmation gate. All 9 use cases generate video (the original prompt-only
  split for presenter-led categories was dropped — Omni Flash lip-syncs fine).
- **Live — real generation (P0.1 / P0.7 / P0.10):** `Generate video` runs the parts
  as a create-then-extend chain on **Gemini Omni Flash** (`gemini-omni-1.1-flash`,
  Interactions API, `previous_interaction_id` for continuity). Clips are stored in
  Cloud Storage, job state in Firestore, and shown back with a per-part player and a
  frame timeline that maps each storyboard scene to its clip.
  Needs the real `GOOGLE_API_KEY` secret version (see [`docs/DEPLOY-SETUP.md`](docs/DEPLOY-SETUP.md)).
- **Live — reference images (P0.4):** upload dealer photos / logo / car-model shots
  in the brief; on an automated generation they're passed to Omni Flash as visual
  references (base64), so it uses the real showroom / car.
- **Live — car-model scraper (P0.2):** "Fetch reference images from CarDekho"
  pulls a current front/side/rear/interior set from cardekho.com (`/api/scrape`,
  runs inline; `apps/api/src/scraper.ts`). Falls back to manual upload when a
  model returns too few angles.
- **Not wired yet:** scene-level (vs part-level) re-generate; `jobs/scraper` as a
  scheduled batch refresh (P2.4) still a stub.
- **Deployed:** `santoshks2017/ai-video-app` → GCP/Firebase `ai-video-app-cd`,
  push-to-`main` auto-deploys (Cloud Run `ava-api` + Firebase Hosting).
