# Progress

**Status:** Live, and the real video generation is implemented (was stubbed — Santosh pushed back that only the prompt generator had been built). Push-to-`main` → Cloud Run + Firebase Hosting green.
- Frontend: https://ai-video-app-cd.web.app
- API: https://ava-api-ofnw2ufkwa-el.a.run.app (also `/api/**` via the Hosting rewrite)
- Blocking to actually run a generation: the `GOOGLE_API_KEY` secret still holds a placeholder — Santosh must add the real key (see below). Key was shared in chat 2026-09-07; rotate after first use.
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
- **Santosh:** add the real Omni Flash key — `printf '%s' 'KEY' | gcloud secrets versions add GOOGLE_API_KEY --project ai-video-app-cd --data-file=-` — then redeploy (push or `gh workflow run deploy.yml`). Rotate the key shared in chat afterwards.
- First real generation: one Showroom Walkaround, short (≤10s, single part) to validate the create path, then a ~20s one to validate extend. Check whether Omni Flash's `previous_interaction_id` actually carries visual continuity (the first spike, now answerable with real calls).
- Verify the response-parsing assumptions in `omniFlash.ts` against a real Interactions API payload — `findVideo()` walks for a video part but the exact shape (base64 vs `files/` uri, `steps[]` vs `output_video`) is from docs, not observed. Adjust if needed.
- P0.2: implement `jobs/scraper` against cardekho.com (second spike) and wire `/api/scrape` to a Cloud Run job execution.
- Reference-image grounding: add attachment upload (bytes → Storage → signed/proxied URL) so `reference_to_video` actually has inputs.
- Then: scene-level (not just part-level) re-generate; extend to the other 4 automated categories; P1 items.
