# Persistent Memory
Running log, most recent first.

## 2026-09-06 (deploy session)
Stood up the full deploy pipeline. Linked the project to Blaze (ICICI Amaz Pay billing account), enabled APIs, created Firestore + a Firebase Storage bucket in asia-south1, set up Workload Identity Federation locked to the repo, a least-privilege `gha-deployer` service account (plus a tiny custom role for the Cloud Run source-staging bucket), and the 5 GitHub Actions vars. Moved the API Dockerfile to repo root so `gcloud run deploy --source .` builds with the monorepo as context. Cleared four IAM gaps across successive runs. Push-to-`main` → Cloud Run `ava-api` + Firebase Hosting is now green. App is live at https://ai-video-app-cd.web.app; `/api/health` OK. `GOOGLE_API_KEY` secret holds a placeholder — Santosh adds the real key with one local `gcloud secrets versions add`.

## 2026-09-06 (build session)
Kicked off the build. Created private GitHub repo `santoshks2017/ai-video-app` and an npm-workspaces monorepo (Vite+React+TS web, Fastify/Cloud Run api, Cloud Run scraper job, shared TS logic package). Ported the legacy prompt-builder's logic into `@ava/shared` — categories, rulebook, chunking, prompt assembly, pre-flight gate (now hard-blocking), cost estimate with the Rs 500 gate — with 15 passing tests. Built and browser-verified the Phase 1 no-cost UI: brief intake for all 9 categories, editable storyboard, live pre-flight, and the fully-working prompt-only path for the 4 presenter categories. API + scraper are scaffolded but stubbed pending the two Phase 1 spikes. Created GCP/Firebase project `ai-video-app-cd` (the plain `ai-video-app` id was taken), added Firebase, and wrote `docs/DEPLOY-SETUP.md` with the remaining deploy commands — paused before linking billing per Santosh.

## 2026-09-06
Project memory system initialized, and OKF Bundle generated from the Excalidraw workflow diagram and the prior prompt-builder tool + its handoff brief. PRD drafting starting this session via product-management:write-spec, pending clarifying answers on video-gen API scope, car-model image sourcing, and hosting stack.

## 2026-09-06 (cont.)
PRD drafted (PRD-ai-video-app.md) after clarifying: provider (Omni Flash), car model sourcing (scrape cardekho.com), stack (Firebase + Cloud Run), user base (Santosh only), and v1 scope split (5 categories automated, 4 stay prompt-only). Awaiting sign-off.
