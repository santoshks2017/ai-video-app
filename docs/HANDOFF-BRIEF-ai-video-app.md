# AI Video App - Handoff Brief (Cowork to Claude Code)

## What this is
Build brief for the AI Video App: a tool to generate dealer video ad-slot content by calling a video-generation model API, with structured briefs, templates, and pre-flight validation to protect the ~90% first-time-right target given per-generation cost (Rs 300-1,000).

Source of truth: `PRD-ai-video-app.md` (status: Approved, ready for build) and `memory/decisions.md` in this folder. Read both before writing any code.

## Status
PRD fully signed off. No stakeholder-blocking open questions remain. Two engineering spikes (Omni Flash context continuity across extend calls, cardekho.com scrapability against the 12-model list) are Phase 1 work, not decisions to bring back to Santosh.

## Repo and hosting setup (this handoff's new requirement)

### 1. GitHub
- Private repo under Santosh's personal GitHub account, the one tied to santoshks2017@gmail.com (not a work org, per this project's v1 single-user scope).
- Suggested name: `ai-video-app`. Confirm it doesn't collide with an existing repo before creating.
- `gh repo create ai-video-app --private --source=. --remote=origin --push`

### 2. Firebase project
- New Firebase project, created under santoshks2017@gmail.com, not reusing an existing one. Blaze plan (pay-as-you-go), per the stack decision already logged.
- Blaze requires a GCP billing account with a payment method attached. If Santosh does not already have a GCP billing account, Claude Code cannot create one or enter payment details, that's a manual step Santosh has to do once in the GCP console. Once a billing account exists (even from an unrelated project), Claude Code can link this new project to it via `gcloud billing projects link` without touching payment details again.
- Stop and ask Santosh to complete that one step first if no billing account exists yet. Don't work around it.

### 3. CI/CD: push to GitHub triggers Firebase deployment
Recommended approach: a GitHub Actions workflow (`.github/workflows/deploy.yml`) that runs on every push to `main`, builds, and deploys:
- Backend (Cloud Run: API-key handling, Omni Flash calls, scraper) via `gcloud run deploy`
- Frontend via `firebase deploy --only hosting`

Authenticate the workflow to GCP with Workload Identity Federation (WIF), not a long-lived service account JSON key:
- Create a deploy-scoped service account (Cloud Run Admin + Firebase Hosting Admin only, nothing broader)
- Set up a WIF pool/provider that trusts this specific GitHub repo
- Reference it in the Action via `google-github-actions/auth`

This avoids a downloadable credential sitting in GitHub Secrets. If WIF setup proves too slow to get right in Phase 1, the fallback is a service account key stored as an encrypted GitHub secret (`FIREBASE_SERVICE_ACCOUNT`), but treat that as temporary and migrate to WIF once the pipeline works. Either way, never commit a service account key file to the repo; if one is generated locally during setup, it goes in `.gitignore` immediately.

Do not use Firebase App Hosting's native GitHub auto-deploy for this project. App Hosting is built around a Next.js/Angular app boundary; this app's backend is a standalone Cloud Run service per the logged stack decision, so a custom Actions workflow is the right fit, not App Hosting's managed pipeline.

### 4. Cost note
Cloud Build (what runs the GitHub Actions build/deploy steps) has a free tier of 120 build-minutes/day. Single-user, infrequent pushes stay well within that, but it's not literally zero-cost at unlimited push volume, worth knowing since this whole project exists to control AI-generation cost.

## What Claude Code should not do
- Never enter GCP billing or payment details. If Blaze isn't enabled yet, stop and tell Santosh.
- Never commit a service account key or any other credential to the repo.
- Don't fold in App Hosting's auto-deploy as a shortcut, see above.

## Reference
- `PRD-ai-video-app.md`, full requirements, scope, success metrics
- `memory/decisions.md`, architecture decisions log
- `Workflow.excalidraw.md`, original pipeline design

---
Prepared by Claude (Cowork) for handoff to Claude Code.
