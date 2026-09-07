# Progress

**Status:** Working end to end, including multi-segment. 2026-09-07: a 27s Product Feature brief generated 3× 9s segments and ffmpeg-stitched to one 27.0s 9:16 video. Presenter, branding overlays, footer and showroom stay consistent across cuts; the s2→s3 cut (both wide shots) is near-seamless. Known drift: the hero CAR changes between segment 1 (SUV) and 2–3 (sedan), and lighting shifts at the first cut — fixable by attaching a car-model reference set (P0.2/P0.4). Single-segment (≤~10s) has no cuts.
Approach: NO extend — each segment is an independent `create` seeded with the previous segment's last frame (`image_to_video`) + brief reference images; segments concatenated with ffmpeg. `/api/clips/:jobId/final` serves the stitched result.
- Frontend: https://ai-video-app-cd.web.app
- API: https://ava-api-85831607354.asia-south1.run.app (also `/api/**` via the Hosting rewrite)
- Real key is Secret Manager version 5; Cloud Run pinned to `GOOGLE_API_KEY:5` (`:latest` was stuck on destroyed v6). Repo var `GOOGLE_API_KEY_VERSION=5`. Key was pasted in chat 2026-09-07 — still worth rotating.
**Last updated:** 2026-09-07

## Done (video-generation session, 2026-09-07)
- `apps/api/src/omniFlash.ts`: real Gemini Omni Flash client (Interactions API, tolerant response parsing, `previous_interaction_id` continuity, `files/:download` for uri delivery).
- `apps/api/src/store.ts` + rewritten `server.ts`: `/api/generate` runs the create-then-extend chain over the prompt parts, uploads each clip to Cloud Storage, records job state in Firestore (`generations/<jobId>`), returns clip URLs. Plus `GET /api/generate/:jobId` (recovery) and `GET /api/clips/:jobId/:part` (private clip streaming).
- `apps/web`: `GenerationPanel` — real `Generate video`, per-part player, and a frame timeline mapping storyboard scenes → clips (P0.10). Removed the old stub button from `OutputPanel`.
- IAM: runtime SA (`85831607354-compute@`) granted `datastore.user` + `storage.objectAdmin`. Deploy sets Cloud Run `--timeout 3600 --memory 1Gi`.

## Done (reference images + scraper, 2026-09-07)
- **P0.4 reference-image upload**: `POST /api/refs` (base64 → Cloud Storage), `GET /api/refs/:id/:name`; brief `attachments` carry `storagePath`; `/api/generate` reads the bytes and passes them to Omni Flash as base64 refs (`reference_to_video` on part 1). Web: real file upload + thumbnails in the Reference images card.
- **P0.2 car-model scraper**: `apps/api/src/scraper.ts` — spike confirmed cardekho.com serves image URLs in the initial HTML (no headless browser). `POST /api/scrape` runs inline, pulls up to 2 front / 1 side / 1 rear / 2 interior from `/<brand>/<model>/pictures`, stores them, writes `carModels/<key>` in Firestore. `GET /api/car-models/:key`. Web: "Fetch reference images from CarDekho" button adds them to the brief. Extraction verified against Creta / Nexon / Baleno / Fortuner. `jobs/scraper` stays a stub (batch/cron only, P2.4).

## Done (earlier sessions)
- Private GitHub repo `santoshks2017/ai-video-app` created.
- npm-workspaces monorepo scaffolded: `packages/shared` (TS), `apps/web` (Vite+React+TS), `apps/api` (Fastify/Cloud Run), `jobs/scraper` (Cloud Run job), `spikes/`.
- Legacy tool logic ported to `@ava/shared`: 9 categories (5 automated / 4 prompt-only), gender-adapted pronunciation rulebook, `planScenes` chunking, `buildPrompt` (+ reference-image-by-filename P0.4, car-model reference P0.2), `runChecks` pre-flight gate hardened to block on any `bad` check (P0.6), cost estimate + fixed Rs 500 confirmation gate (P0.9). 15 ported QA tests, all green.
- `apps/web`: full brief intake (all 9 categories), editable storyboard feeding edits back into the prompt (P0.5), live pre-flight panel, cost estimate, fully working prompt-only presenter path (P0.11). Verified in-browser end to end.
- `apps/api` + `jobs/scraper`: scaffolded, endpoints stubbed (501) pending the Phase 1 spikes.
- Firebase config (Hosting → apps/web/dist, `/api/**` rewrite → Cloud Run, deny-all Firestore/Storage rules), GitHub Actions deploy workflow (WIF).
- GCP + Firebase project `ai-video-app-cd` created, Firebase added, `.firebaserc` set.
- `docs/DEPLOY-SETUP.md`: exact remaining deploy commands.

## Next steps
- Test on Cloud Run: (a) a multi-part video (~24s, maxChunk 8 → 3 parts) to exercise `extend` + whether `previous_interaction_id` carries visual continuity; (b) a model-specific brief → Fetch from CarDekho → generate, and eyeball whether the reference images actually steer the car design.
- Judge first-time-right quality vs the storyboard intent (>90% target); tune prompt assembly.
- Rotate the Omni Flash key (pasted in chat): new secret version → set `GOOGLE_API_KEY_VERSION` → redeploy → disable v5. Steps in docs/DEPLOY-SETUP.md.
- Then: scene-level (not just part-level) re-generate; the other 4 automated categories; P1 items.
