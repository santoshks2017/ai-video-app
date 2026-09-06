# Progress

**Status:** Live. Phase 1 no-cost app deployed and reachable. Push-to-`main` → GitHub Actions → Cloud Run (`ava-api`) + Firebase Hosting is green end to end.
- Frontend: https://ai-video-app-cd.web.app
- API: https://ava-api-ofnw2ufkwa-el.a.run.app (also `/api/**` via the Hosting rewrite)
**Last updated:** 2026-09-06

## Done this session
- Private GitHub repo `santoshks2017/ai-video-app` created.
- npm-workspaces monorepo scaffolded: `packages/shared` (TS), `apps/web` (Vite+React+TS), `apps/api` (Fastify/Cloud Run), `jobs/scraper` (Cloud Run job), `spikes/`.
- Legacy tool logic ported to `@ava/shared`: 9 categories (5 automated / 4 prompt-only), gender-adapted pronunciation rulebook, `planScenes` chunking, `buildPrompt` (+ reference-image-by-filename P0.4, car-model reference P0.2), `runChecks` pre-flight gate hardened to block on any `bad` check (P0.6), cost estimate + fixed Rs 500 confirmation gate (P0.9). 15 ported QA tests, all green.
- `apps/web`: full brief intake (all 9 categories), editable storyboard feeding edits back into the prompt (P0.5), live pre-flight panel, cost estimate, fully working prompt-only presenter path (P0.11). Verified in-browser end to end.
- `apps/api` + `jobs/scraper`: scaffolded, endpoints stubbed (501) pending the Phase 1 spikes.
- Firebase config (Hosting → apps/web/dist, `/api/**` rewrite → Cloud Run, deny-all Firestore/Storage rules), GitHub Actions deploy workflow (WIF).
- GCP + Firebase project `ai-video-app-cd` created, Firebase added, `.firebaserc` set.
- `docs/DEPLOY-SETUP.md`: exact remaining deploy commands.

## Next steps
- Add the real Omni Flash key: `printf '%s' 'KEY' | gcloud secrets versions add GOOGLE_API_KEY --project ai-video-app-cd --data-file=-` (secret currently holds a placeholder version). Run locally — key never touches the repo.
- Phase 1 spikes (`spikes/`): Omni Flash context continuity across extend calls; cardekho.com scrapability against the 12-model list. Both need a real `GOOGLE_API_KEY` / network run.
- Then implement `apps/api/src/omniFlash.ts` (P0.1/P0.7) and `jobs/scraper` (P0.2) for one category (Showroom Walkaround), including one real paid generation.
- Phase 2: P0.10 video preview / frame timeline / per-scene re-generate; extend to the other 4 automated categories.
- Phase 3: P1 items (conversational refinement, Service category reconsideration, WORDS_PER_SECOND calibration).
