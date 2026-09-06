# AI Video App - PRD (v1)

Status: Approved, ready for build
Owner: Santosh
Date: 2026-09-06
Note: built and hosted on Santosh's personal GitHub/Firebase accounts to fast-track testing without waiting on company-provisioned infrastructure. The use case, data, and dealer-video content are CarDekho work throughout. If this proves out, CarDekho's engineering team rebuilds a formal version on company infrastructure.

## Problem Statement

CarDekho's design team currently produces dealer ad-slot videos by manually writing prompts and pasting them into Lumina (Seedance) one part at a time, then judging the output by eye. Each generation costs Rs 300-1,000 for a 10-30 second clip, and getting it wrong on the first attempt (wrong car model generation shown, dropped on-screen offer text, garbled Hindi pacing, mismatched branding) means paying again. There is no system enforcing the details that actually determine whether a generation is usable: accurate car model reference images, verbatim reuse of dealer-supplied photos, and a pre-flight check that the brief is complete before money is spent. As video volume grows across dealers, this manual, per-video judgment call does not scale and the failure cost compounds.

## Goals

1. Automate brief-to-video generation (not just brief-to-prompt-text) for the 5 non-presenter dealer ad-slot categories, calling a video-gen API directly with a stored key. The remaining 4 presenter categories live in the same app and brief flow, stopping at the master prompt.
2. Reach and hold a first-time-right rate of at least 90% for those 5 categories, measured as: no re-generation needed after one human review pass.
3. Solve car model accuracy at the source: every video-relevant car model gets a real, current reference image set (scraped from CarDekho's own listings) instead of leaving the model to invent a design from training data.
4. Guarantee user-supplied assets (dealer photos, logos) appear in the output as provided, never re-imagined by the model.
5. Cut cost-per-usable-video versus the current Lumina-only workflow, by using a cheaper API (Gemini Omni Flash, ~$0.10/sec at 720p) and by blocking generation attempts that a pre-flight check can already tell will fail.

## Non-Goals

- **Dealer self-serve access.** V1 is a single-user tool for Santosh. No dealer-facing UI, no multi-tenant auth. (Explicitly out of scope per your instruction to keep this dealer-content-only, not dealer-facing.)
- **Full CarDekho design team rollout.** Deferred until the pipeline is proven solo. No roles/permissions system in v1.
- **Automated generation for presenter-led categories** (Testimonial, Delivery/Handover, Offer/Deal, Festival/Occasion). No current Google video API does lip-synced multilingual avatar generation from a photo (Veo: Hindi unverified, no avatar concept; Omni Flash: explicitly refuses to lip-sync a still photo, by design, to limit deepfakes). These 4 categories are part of this app's UI from v1 (same brief intake and storyboard step as the automated categories) but stop at the master prompt, for manual use in Lumina - no API call, no video preview for these, since the underlying capability doesn't exist yet.
- **Multi-provider key vault.** V1 targets one provider (Gemini Omni Flash) end to end. Provider abstraction is a v2 concern, not a v1 architectural requirement.
- **Non-dealer video use cases.** Any other CarDekho video need (corporate, editorial, brand campaigns) is out of scope; this tool is scoped to dealer ad-slot content only, per your explicit instruction.
- **In-app video editing beyond re-generate/extend.** No timeline scrubbing, trimming, or manual compositing. The "Frame Timeline" is a review/reference view of the generated scenes, not an editor.
- **Full-site / automatic model discovery scraping.** V1 targets an explicit, maintained list of car models (not a general crawler across CarDekho's entire catalog). Scope is a handful of models to start, not "every model on the site."

## User Stories

Single persona for v1: Santosh, acting on behalf of the CarDekho design team.

- As Santosh, I want to enter a dealer + car model + category and get back a complete, accurate reference profile (car images, dealer assets, actor if needed) before I write a single word of script, so that the model isn't left guessing at what a Creta or a showroom actually looks like.
- As Santosh, I want to fill a structured brief (avatar y/n, duration, dimension, resolution, category) and get a scene-by-scene storyboard I can edit before anything is generated, so that I catch mistakes when they're free to fix, not after paying for a generation.
- As Santosh, I want the app to block generation and tell me exactly what's wrong when the brief is incomplete or a check fails (missing mandatory field, dropped card, unreferenced attachment), so that I never spend Rs 300+ on a generation I could have predicted would fail.
- As Santosh, I want the app to call the video-gen API directly with my stored key and hand back a finished clip (or the next chunk, if multi-part), so that I stop manually copy-pasting prompts into a separate tool.
- As Santosh, I want a frame timeline and video preview with re-generate/extend controls per scene, so that if one scene is wrong I can fix that scene without regenerating the whole video.
- As Santosh, I want every reference image I upload (dealer photo, car model shot) automatically labelled and citable by filename in the master prompt, so that the model uses "showroom_front.jpg" verbatim instead of me re-describing it in prose every time.
- As Santosh, I want the car model image library built from CarDekho's own listings (scraped, not hand-collected), so that new/updated models stay current without manual work.
- As Santosh, I want to see the estimated cost before I hit generate, and get warned if a request will trigger an unusually high number of API calls (e.g. from a long multi-part video), so that costs stay predictable on a pay-as-you-go API.

## Requirements

### Must-Have (P0)

**P0.1 - API key storage and Omni Flash integration.**
Store the Google API key server-side (Cloud Run environment / Secret Manager), never in client-side code. Backend endpoint accepts a finished master prompt + reference images/video clips and calls Gemini Omni Flash, returns the generated clip.
- Acceptance: key is never present in any browser-inspectable request or response; a call with a missing/invalid key fails with a clear error, not a silent hang.

**P0.2 - Car model reference scraper (fixed model list, not a full-site crawl).**
A Cloud Run job that, given an explicit, admin-maintained list of car model + variant names (a handful to start - not a general crawler across cardekho.com), scrapes each listed model's own page(s) for reference images and stores a labelled image set (multiple angles, at minimum front/side/rear/interior) in Firebase Storage, with metadata (model, variant, year, angle, source URL, scrape date) in Firestore.
- Acceptance: for each model on the list, the scraper returns at least 4 distinct angle shots and writes them with correct metadata; if a listed model returns no results, the app falls back to prompting for manual image upload rather than silently proceeding with no reference.
- Acceptance: the model list is a data/config change (adding a row), not a code change - the scraper logic itself doesn't need to be touched to add model #6.
- Acceptance: scraped images are re-checked/refreshed on a defined cadence (propose: on-demand re-scrape button, since this is a single-user low-volume tool - no need for a cron job in v1) so a stale image set can be manually refreshed when a model year changes.
- V1 model list (12 models, 2 per brand across your top 6 brands): Hyundai Creta, Hyundai Venue; Maruti Suzuki Baleno, Maruti Suzuki Brezza; Mahindra Scorpio-N, Mahindra XUV700; Tata Nexon, Tata Punch; Kia Seltos, Kia Sonet; Toyota Innova Hycross, Toyota Fortuner. Chosen as high-volume, high-visibility models per brand, likely to have full angle coverage on cardekho.com.

**P0.3 - Structured brief intake, all 9 categories.**
Form covering: category (all 9 - the 5 automated ones plus the 4 presenter-only ones), avatar yes/no, duration (10/15/20/30/60s, with a note on which of FB/IG/YT it can serve), model-specific yes/no (if yes, triggers P0.2), dimension (16:9/9:16), resolution (480p/720p - note Omni Flash is 720p-only in v1, so resolution selection there is informational, not a real choice yet), plus category-specific fields carried over from the existing tool (dealer name, phone, address, offer terms, etc.). Selecting one of the 4 presenter categories routes to prompt-only output at the end (P0.11) instead of the API call step.
- Acceptance: every mandatory field for the selected category is enforced before the brief can proceed to storyboard generation.
- Acceptance: selecting a presenter category never exposes the Generate/API-call button - only Copy prompt.

**P0.4 - Attachment/reference labelling.**
Every uploaded or scraped reference image gets a required short label (what it shows) and a stable filename; the master prompt refers to attachments by filename/label rather than re-describing them.
- Acceptance: a master prompt referencing an attachment fails validation if that filename isn't present in the current attachment set (prevents dangling references).

**P0.5 - Scene/script/storyboard generation.**
Generate scene count from duration (reuse the existing category `beats()` logic), each scene with its own script/voiceover line, shot direction, and on-screen card content, presented as an editable storyboard (table: scene, timing, roll type, reference image, voiceover) before generation - matching the reference "Video Plan" UI pattern.
- Acceptance: user can edit any scene's script or shot direction and regenerate just the master prompt (not the whole brief) from the edited storyboard.

**P0.6 - Pre-flight validation gate (blocking, not just warnings).**
Port and extend the existing tool's `runChecks()` logic (missing mandatory fields, dropped-card risk, on-screen string length, footer/identity mismatch) into a hard gate: any `bad`-level check blocks the "Generate" action entirely, since a paid API call is at stake, not just a UI nicety.
- Acceptance: a brief with a known-bad condition (e.g. no dealer name) cannot reach the API call step; the UI states exactly which check failed and why.

**P0.7 - Multi-part chunking for the API call.**
Reuse `planScenes()` from the existing tool to split any video whose scene count exceeds what fits in one Omni Flash call (3-10s per clip) into sequential create-then-extend API calls, passing the prior clip's context forward as Omni Flash's conversational continuity model supports.
- Acceptance: a 30-second, 5-part video makes exactly the right number of sequential API calls, each building on the previous clip, with no manual re-prompting required between parts.

**P0.8 - Master prompt referencing pronunciation rulebook and accuracy rule.**
Every master prompt includes the existing pronunciation/delivery rulebook and the "never invent a figure" accuracy rule, exactly as the current tool does - this doesn't change just because generation is now automated.
- Acceptance: identical rulebook-inclusion test coverage to the existing tool's Playwright suite.

**P0.9 - Cost estimate before generate.**
Before calling the API, show estimated cost (clip count x seconds x $0.10/sec, converted to INR at a stated rate) and require explicit confirmation for any brief estimated above Rs 500.
- Acceptance: the estimate shown before generation is within 10% of the actual billed cost after the call completes.
- Acceptance: any estimate above Rs 500 requires an explicit confirm click; below it, generation proceeds straight through.

**P0.10 - Video preview, frame timeline, re-generate/extend per scene.**
After generation, show the finished clip(s), a frame-timeline view mapping clips back to storyboard scenes, and per-scene re-generate/extend controls so a single bad scene doesn't require redoing the whole video.
- Acceptance: re-generating scene 3 of 5 does not re-call the API for scenes 1, 2, 4, 5.

### Nice-to-Have (P1)

**P1.1 - Conversational refinement.** An "AI prompt / chat" box (as sketched in the workflow diagram) for iterating on a generated clip in plain language, translating the request into the appropriate re-generate/extend call. Fast follow once P0 core loop works.

**P1.2 - Service category reconsidered.** Revisit whether Service belongs in the automated set, given your own reference evidence included Service reels - decide after the first 5 categories are validated in production.

**P1.3 - WORDS_PER_SECOND calibration.** Once real generated videos exist, compare actual usable speech pacing against the current 2.2 words/sec estimate (carried over from the existing tool) and adjust if needed.

**P0.11 - Prompt-only output path for the 4 presenter categories.**
Testimonial, Delivery/Handover, Offer/Deal, and Festival/Occasion run through the same brief intake, attachment labelling, storyboard, and pre-flight checks as the automated categories, but end at the master prompt: a Copy button, no Generate button, no API call, no video preview, no cost estimate. This replaces the old standalone tool - one codebase from v1, not two.
- Acceptance: the master prompt for a presenter category includes the full rulebook and accuracy rule, matching P0.8, since nothing about that requirement changes when generation isn't automated.
- Acceptance: no code path for these 4 categories ever reaches P0.1 (the API call).

### Future Considerations (P2)

**P2.1 - Avatar-capable provider for presenter categories**, once a Google (or other) model supports multilingual lip-synced avatar generation, or if you decide to integrate Lumina's own API directly.

**P2.2 - Multi-provider key vault**, generalizing beyond Omni Flash once the single-provider pipeline is proven.

**P2.3 - Multi-user rollout to the design team**, reusing the shared-library pattern (actors, dealers, car model profiles) already validated in the existing tool, with real auth/roles.

**P2.4 - Scheduled re-scraping** of the car model library instead of on-demand, once volume justifies the added infrastructure.

## Success Metrics

**Leading indicators (check weekly for the first month):**
- First-time-right rate on generated videos: target ≥90% (no re-generation needed after one review). Measure by tagging each generation as accepted/rejected on first view.
- Pre-flight block rate: % of "Generate" attempts stopped by P0.6 before spending money - track this as a positive signal (it's the check working, not a UX failure), but investigate if it's persistently above ~30%, since that suggests the brief UI itself is confusing.
- Cost per usable video: target materially below the Rs 300-1,000 Lumina baseline, given Omni Flash's ~$0.10/sec rate.

**Lagging indicators (evaluate after 4-6 weeks of real use):**
- Time from brief submission to usable video, versus the current fully-manual process.
- Car model scrape coverage: % of requested models that return a usable reference set on first attempt without manual fallback.
- Whether Santosh actually keeps using this over the manual Lumina workflow for the 5 automated categories (the real test of whether it's solving the problem).

## Open Questions

- **[Engineering - resolved by testing, not by decision]** Does Gemini Omni Flash's "conversational editing" context genuinely carry forward attachment/reference-image grounding across sequential extend calls, or does each call need references re-supplied? This isn't something to answer in the abstract - it's a 15-minute empirical spike (make 2-3 real API calls, inspect the output) done at the start of Phase 1 build, before P0.7's chunking logic is finalized. No input needed from you; whoever builds this just needs to run the test before locking the design.
- **[Engineering]** cardekho.com's page structure for scraping: needs a short technical spike to confirm image URLs are directly extractable (not behind additional JS rendering that would need a headless browser, adding Cloud Run cost/complexity). Same as above - resolved by trying it, not by discussion.
- **[Resolved]** V1 model list set (P0.2): see the 12 models listed there. Not fully validated yet - the cardekho.com scrapability spike (above) should be run against this exact list, since a couple of these (e.g. newer variants like Innova Hycross) are worth confirming have full angle coverage before locking Phase 1 scope.
- **[Resolved]** Cost-confirmation threshold (P0.9): Rs 500, fixed.
- **[Resolved]** Presenter categories (P0.11) ship in this app's UI from v1, prompt-only, replacing the old standalone tool. One codebase.

## Timeline Considerations

- No hard external deadline stated. Recommended phasing:
  - **Phase 1** (prove the core loop): start with the two empirical spikes (Omni Flash context continuity, cardekho.com scrapability against the 12-model list in P0.2) since both feed directly into how P0.2 and P0.7 get built - don't design those two around assumptions. Then build P0.1-P0.6 for exactly one category (suggest Showroom Walkaround - simplest, no dialogue, most B-roll-like, best fit for Omni Flash's actual capabilities) end to end, including one real paid generation, using one of the 12 listed models.
  - **Phase 1 (parallel track)**: P0.11 (presenter categories, prompt-only) can be built alongside Phase 1 rather than after it - it's a straight port of logic already proven in the existing tool, doesn't touch the API or scraper, and carries no technical risk.
  - **Phase 2**: P0.7-P0.10, then extend to the remaining 4 automated categories once the core loop is validated on one.
  - **Phase 3**: P1 items, starting with whichever real usage surfaces as most annoying to not have.
- Dependency: P0.2 (scraper) blocks any category using "Model Specific: Yes" - build and validate this early since it's the single riskiest technical unknown (site structure, rate limits).
