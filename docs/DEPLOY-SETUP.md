# Deploy setup — remaining steps

Per [HANDOFF-BRIEF-ai-video-app.md](HANDOFF-BRIEF-ai-video-app.md). Done so far:

- ✅ Private GitHub repo: `santoshks2017/ai-video-app`
- ✅ GCP + Firebase project: **`ai-video-app-cd`** (project number `85831607354`), Firebase added, default Hosting site `ai-video-app-cd`. Wired in `.firebaserc`.
- ⏸️ **Billing link (Blaze)** — paused here for review. Everything below needs this done first.

Active account for all commands: `santoshks2017@gmail.com`. Region: `asia-south1`.

---

## 1. Link billing (enables Blaze / pay-as-you-go)

Open billing account on the account: `013E75-A90ADE-1F7B1B` ("ICICI Amaz Pay").

```bash
gcloud billing projects link ai-video-app-cd --billing-account=013E75-A90ADE-1F7B1B
```

No payment details are entered — the account already exists. Free-tier quotas
cover single-user usage; Cloud Build has 120 free build-min/day.

## 2. Enable the APIs the deploy needs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firebasehosting.googleapis.com \
  firestore.googleapis.com \
  firebasestorage.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  --project ai-video-app-cd
```

## 3. Create the Omni Flash key secret

```bash
printf '%s' 'YOUR_GOOGLE_API_KEY' | gcloud secrets create GOOGLE_API_KEY \
  --project ai-video-app-cd --data-file=- --replication-policy=automatic
```

The Cloud Run service reads it via `--set-secrets GOOGLE_API_KEY=GOOGLE_API_KEY:latest`
(already in `.github/workflows/deploy.yml`). The key never touches the repo or the client.

## 4. Deploy-scoped service account (least privilege)

```bash
PROJECT=ai-video-app-cd
gcloud iam service-accounts create gha-deployer \
  --project $PROJECT --display-name "GitHub Actions deployer"

SA="gha-deployer@$PROJECT.iam.gserviceaccount.com"
for role in roles/run.admin roles/firebasehosting.admin \
            roles/artifactregistry.writer roles/cloudbuild.builds.editor \
            roles/iam.serviceAccountUser roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SA" --role="$role"
done
```

## 5. Workload Identity Federation (no downloadable key)

```bash
PROJECT=ai-video-app-cd
PROJECT_NUM=85831607354
REPO=santoshks2017/ai-video-app

gcloud iam workload-identity-pools create github --project $PROJECT \
  --location global --display-name "GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc github \
  --project $PROJECT --location global --workload-identity-pool github \
  --display-name "GitHub OIDC" \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition "assertion.repository=='$REPO'" \
  --issuer-uri "https://token.actions.githubusercontent.com"

SA="gha-deployer@$PROJECT.iam.gserviceaccount.com"
gcloud iam service-accounts add-iam-policy-binding $SA --project $PROJECT \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUM/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
```

Provider resource name (for the GitHub var below):
`projects/85831607354/locations/global/workloadIdentityPools/github/providers/github`

## 6. GitHub Actions repo variables

```bash
gh variable set GCP_PROJECT_ID        --repo santoshks2017/ai-video-app --body "ai-video-app-cd"
gh variable set GCP_REGION            --repo santoshks2017/ai-video-app --body "asia-south1"
gh variable set FIREBASE_PROJECT_ID   --repo santoshks2017/ai-video-app --body "ai-video-app-cd"
gh variable set DEPLOY_SERVICE_ACCOUNT --repo santoshks2017/ai-video-app --body "gha-deployer@ai-video-app-cd.iam.gserviceaccount.com"
gh variable set WIF_PROVIDER          --repo santoshks2017/ai-video-app --body "projects/85831607354/locations/global/workloadIdentityPools/github/providers/github"
```

## 7. First deploy

```bash
git push origin main      # triggers .github/workflows/deploy.yml
# or: gh workflow run deploy.yml --repo santoshks2017/ai-video-app
```

After it's green: frontend at `https://ai-video-app-cd.web.app`, API behind
`/api/**` on the same origin (Hosting rewrite → Cloud Run `ava-api`).

## 8. Firestore + Storage buckets (one-time)

```bash
gcloud firestore databases create --location asia-south1 --project ai-video-app-cd
gsutil mb -p ai-video-app-cd -l asia-south1 gs://ai-video-app-cd.firebasestorage.app
```

Rules in `firestore.rules` / `storage.rules` currently deny all client access —
the Cloud Run backend (Admin SDK) is the only reader/writer until Auth is added.
