# Persistent Memory
Running log, most recent first.

## 2026-09-06 (build session)
Kicked off the build. Created private GitHub repo `santoshks2017/ai-video-app` and an npm-workspaces monorepo (Vite+React+TS web, Fastify/Cloud Run api, Cloud Run scraper job, shared TS logic package). Ported the legacy prompt-builder's logic into `@ava/shared` — categories, rulebook, chunking, prompt assembly, pre-flight gate (now hard-blocking), cost estimate with the Rs 500 gate — with 15 passing tests. Built and browser-verified the Phase 1 no-cost UI: brief intake for all 9 categories, editable storyboard, live pre-flight, and the fully-working prompt-only path for the 4 presenter categories. API + scraper are scaffolded but stubbed pending the two Phase 1 spikes. Created GCP/Firebase project `ai-video-app-cd` (the plain `ai-video-app` id was taken), added Firebase, and wrote `docs/DEPLOY-SETUP.md` with the remaining deploy commands — paused before linking billing per Santosh.

## 2026-09-06
Project memory system initialized, and OKF Bundle generated from the Excalidraw workflow diagram and the prior prompt-builder tool + its handoff brief. PRD drafting starting this session via product-management:write-spec, pending clarifying answers on video-gen API scope, car-model image sourcing, and hosting stack.

## 2026-09-06 (cont.)
PRD drafted (PRD-ai-video-app.md) after clarifying: provider (Omni Flash), car model sourcing (scrape cardekho.com), stack (Firebase + Cloud Run), user base (Santosh only), and v1 scope split (5 categories automated, 4 stay prompt-only). Awaiting sign-off.
