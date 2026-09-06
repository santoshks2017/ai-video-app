# Deploy setup

Per [HANDOFF-BRIEF-ai-video-app.md](HANDOFF-BRIEF-ai-video-app.md).
Active account: `santoshks2017@gmail.com`. Region: `asia-south1`.

## Done

| # | Item | Detail |
|---|------|--------|
| 1 | Private GitHub repo | `santoshks2017/ai-video-app` |
| 2 | GCP + Firebase project | **`ai-video-app-cd`** (project number `85831607354`), Firebase added, Hosting site `ai-video-app-cd`, wired in `.firebaserc` |
| 3 | Billing | Linked to `013E75-A90ADE-1F7B1B` ("ICICI Amaz Pay") — Blaze. No payment details entered. |
| 4 | APIs enabled | run, cloudbuild, artifactregistry, firebasehosting, firestore, firebasestorage, secretmanager, iamcredentials, sts, iam, firebase |
| 5 | Secret | `GOOGLE_API_KEY` created. **Version 1 is a placeholder** — see "Add the real key" below. |
| 6 | Deploy service account | `gha-deployer@ai-video-app-cd.iam.gserviceaccount.com` with `run.admin`, `firebasehosting.admin`, `firebaserules.admin`, `artifactregistry.writer`, `cloudbuild.builds.editor`, `iam.serviceAccountUser`, `secretmanager.secretAccessor`, `serviceusage.serviceUsageConsumer`, `storage.objectAdmin`, and a custom `cloudRunSourceDeployer` role (`storage.buckets.create/get/list/update`) |
| 7 | Workload Identity Federation | Pool `github`, provider `github` (OIDC, `token.actions.githubusercontent.com`), attribute condition locks it to `assertion.repository=='santoshks2017/ai-video-app'`. Deployer SA bound via `principalSet://…/attribute.repository/santoshks2017/ai-video-app`. |
| 8 | Artifact Registry repo | `cloud-run-source-deploy` (docker, asia-south1) — pre-created so the deployer needs only `writer` |
| 9 | GitHub Actions repo variables | `GCP_PROJECT_ID`, `GCP_REGION`, `FIREBASE_PROJECT_ID`, `DEPLOY_SERVICE_ACCOUNT`, `WIF_PROVIDER` |
| 10 | Firestore | Native database created in asia-south1 |
| 11 | Storage | Firebase default bucket `ai-video-app-cd.firebasestorage.app` (asia-south1) |
| 12 | Runtime SA | `85831607354-compute@developer.gserviceaccount.com` granted `datastore.user` + `storage.objectAdmin` (Admin SDK from Cloud Run writes job records + clips) and `secretmanager.secretAccessor` on `GOOGLE_API_KEY` |
| 13 | Cloud Run sizing | deploy sets `--timeout 3600 --memory 1Gi --cpu 1 --concurrency 4 --max-instances 3` — generation is minutes-long per clip |

## Add the real Omni Flash key

The secret exists with a placeholder value. Add the real key as a new version
(run locally — the key is entered by you, never stored in the repo):

```bash
printf '%s' 'YOUR_REAL_GOOGLE_API_KEY' | gcloud secrets versions add GOOGLE_API_KEY \
  --project ai-video-app-cd --data-file=-
```

Cloud Run picks up `:latest` on the next deploy. Until then, `/api/generate`
returns a clear 503 (`omni-flash-not-configured`), which the UI handles — the
whole generation path is stubbed anyway pending the Phase 1 spikes.

## Deploy

`git push origin main` runs `.github/workflows/deploy.yml`: build + test →
`gcloud run deploy ava-api --source .` → `firebase deploy --only hosting,firestore:rules,storage`.

- Frontend: `https://ai-video-app-cd.web.app`
- API: same origin under `/api/**` (Hosting rewrite → Cloud Run `ava-api`)

## Rotating away from the placeholder / teardown notes

- The custom role `cloudRunSourceDeployer` only exists because
  `gcloud run deploy --source` creates a `run-sources-*` staging bucket on
  first use. Safe to keep; it grants nothing beyond bucket lifecycle.
- To move the API build off `--source` later (e.g. explicit `gcloud builds
  submit` + `--image`), that custom role can be dropped.
