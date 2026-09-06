# Progress

**Status:** Working end to end. First real video generation succeeded 2026-09-07 — an 8s single-part Showroom Walkaround (dealer "Test Motors"), clip played back with the frame timeline. Omni Flash Interactions API response parsing in `omniFlash.ts` held against the live API.
- Frontend: https://ai-video-app-cd.web.app
- API: https://ava-api-85831607354.asia-south1.run.app (also `/api/**` via the Hosting rewrite)
- Real key is Secret Manager version 5; Cloud Run pinned to `GOOGLE_API_KEY:5` (`:latest` was stuck on destroyed v6). Repo var `GOOGLE_API_KEY_VERSION=5`. Key was pasted in chat 2026-09-07 — still worth rotating.
**Last updated:** 2026-09-07

## Done (video-generation session, 2026-09-07)
- `apps/api/src/omniFlash.ts`: real Gemini Omni Flash client (Interactions API, tolerant response parsing, `previous_interaction_id` continuity, `files/:download` for uri delivery).
- `apps/api/src/store.ts` + rewritten `server.ts`: `/api/generate` runs the create-then-extend chain over the prompt parts, uploads each clip to Cloud Storage, records job state in Firestore (`generations/<jobId>`), returns clip URLs. Plus `GET /api/generate/:jobId` (recovery) and `GET /api/clips/:jobId/:part` (private clip streaming).
- `apps/web`: `GenerationPanel` — real `Generate video`, per-part player, and a frame timeline mapping storyboard scenes → clips (P0.10). Removed the old stub button from `OutputPanel`.
- IAM: runtime SA (`85831607354-compute@`) granted `datastore.user` + `storage.objectAdmin`. Deploy sets Cloud Run `--timeout 3600 --memory 1Gi`.
- Still stubbed: `jobs/scraper` / `/api/scrape` (P0.2). Reference-image grounding coded but inert until attachment uploads exist.

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
- Test a multi-part video (~24s, maxChunk 8 → 3 parts) to exercise the `extend` path and see whether `previous_interaction_id` actually carries visual continuity (dealer, car, presenter, style) across clips. This is the first Phase 1 spike, now runnable for real.
- Judge first-time-right quality on the create path — did the 8s clip match the storyboard intent? Feeds the >90% target and any prompt-assembly tuning.
- Rotate the Omni Flash key (pasted in chat): add a new secret version, set `GOOGLE_API_KEY_VERSION`, redeploy, disable v5. Steps in docs/DEPLOY-SETUP.md.
- P0.2: implement `jobs/scraper` against cardekho.com (second spike) + wire `/api/scrape` to a Cloud Run job execution.
- Reference-image grounding: attachment upload (bytes → Storage → proxied URL) so `reference_to_video` has real inputs.
- Then: scene-level (not just part-level) re-generate; the other 4 automated categories; P1 items.
