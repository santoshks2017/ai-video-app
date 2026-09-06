# Dealer Video Prompt Builder — Handoff Brief (Cowork → Claude Code)

## What this is
Internal tool for CarDekho's design team: generates structured Lumina-AI video prompts for dealer ad-slot videos (presenter/actor delivering scripted content, shown on car model pages). Single-file HTML/CSS/JS app, currently published as a Claude Artifact.

## Current state
- File: `dealer-video-prompt-builder.html` (~101 KB, ~1714 lines)
- Fully self-contained, vanilla JS, no build step
- Persistence: Claude Artifact `db` capability (organization-scoped JSON document store)
- QA: 50/50 Playwright assertions passing across 15 test scenarios (see below)

## Why it's moving
The `db` capability is org-restricted — CarDekho colleagues on separate work Google accounts likely can't open the artifact link at all, since it's scoped to the publishing account's org. Fix: rebuild persistence on Supabase, deploy via GitHub + Vercel.

## Architecture to build in Claude Code

**Keep as-is (no rework needed):**
- All prompt-generation logic: 9 category definitions with beats/fields/mandatory checks
- Narration modes (presenter/voiceover/silent/customer) and `shotAlt` handling
- Chunk-splitting algorithm (`planScenes`) for multi-part video generation
- Validation engine (`runChecks`)
- Pronunciation/delivery rulebook injection
- XSS-safe DOM rendering pattern (`mk()` helper + `isSafeImageData()`)

**Replace:**
- Storage layer: swap the `db` capability calls for a Supabase client (`@supabase/supabase-js`)
- Auth: add Supabase magic-link or a simple shared-password gate so it's team-only, not public

## Data model (3 tables/collections)
1. **actors** — name, gender, age, style, voice, sourceNote, photo (currently base64 JPEG thumbnail — consider Supabase Storage instead of inline blobs)
2. **dealers** — dealerName, brandModel, phone, tier, address, fictionalize flag, fakeBrandModel, fakeDealer, logo (thumbnail), photos array
3. **generations** — dealerName, categories, narration, parts array, promptText, createdAt

Each needs create/read/delete. No update needed on generations (append-only history); actors/dealers need update (edit-in-place from form).

## Key constants to carry over
- `WORDS_PER_SECOND = 2.2` — spoken pacing estimate. **Not measured from real audio** (Instagram source audio was inaccessible). Flag to team: validate against real generated outputs and recalibrate if needed.
- `MIN_SPOKEN_SCENE = 2.0` — floor for scene duration when dialogue is present
- Card-overload cap: `Math.max(2, Math.floor(totalDuration/5))` on-screen card moments
- On-screen string length warning threshold: 42 chars (excluding footer)
- Footer length warning threshold: 70 chars

## Open decisions (not yet resolved, flag to Santosh)
1. **Service category**: excluded from the 9 categories as "not ad-slot-appropriate," but the user's own 25-reel evidence set included 2 Service reels. Revisit.
2. **WORDS_PER_SECOND accuracy**: needs real-world validation once the team generates videos with actual scripts.
3. **Image storage**: currently base64 thumbnails inline in JSON docs (no `assets` capability was available in the Artifact context). Supabase Storage removes this constraint — worth moving to real file uploads instead of compressed thumbnails.

## Suggested build steps in Claude Code
1. `git init`, scaffold as plain HTML/JS or lightweight Vite app (current size doesn't need a framework)
2. Set up Supabase project: 3 tables per data model above, enable Storage for actor/dealer photos and logos
3. Swap `db.collection(...)` calls for Supabase client calls (same shape: create/read/delete)
4. Add auth gate (magic link recommended for team access control)
5. Push to GitHub, connect to Vercel, deploy
6. Re-run the same QA scenarios manually (or port the Playwright script) before handing to the design team

## Reference: 15 QA scenarios already validated in the current build
No-category block, missing-mandatory-field block, multi-part even chunking, no HTML-entity-escaping in prompt text, rulebook present in every part, extend/final-part wording, XSS-payload non-execution, narration-mode-specific content (silent/voiceover), single-part edge case, card-overload and long-string warnings, maxChunk>duration collapse to 1 part, localStorage draft persistence, end-card off honored, delivery-avoid-rule presence, footer/identity-mismatch warning.

---
Prepared by Claude (Cowork) for handoff to Claude Code.
