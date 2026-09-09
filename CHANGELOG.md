# Changelog

Current version: **2.0**

Minor bumps for every shipped change; the major number moves only for an
overhaul of how the app works. Generated from `packages/shared/src/changelog.ts`
— edit that, then run `npm run changelog`.

## 2.0 — Bikes, whole-brand sync, and your own account
_2026-09-09_

- Bikes and scooters join cars: BikeDekho for two-wheelers, CarDekho for cars, with the same images, colours, variants and specifications.
- Sync a whole brand instead of one model at a time. Pick Tata or Royal Enfield and the app pulls the current line-up — 176 models across the nine brands — skipping discontinued, unlaunched and fleet-only trims.
- A video with no specific model chosen now names the dealer brand’s real current range and shows only cars from it, instead of the model inventing an older generation.
- Clients say whether they sell cars or two-wheelers. Honda, Suzuki and Hero badge both, and a car showroom’s film was coming back with motorcycles in it.
- Everyone signs in with their own Google account. New people can look but not spend; an admin grants creator access, and every sign-in and generation is logged against a named person with its cost.
- Scripts are written about the car rather than the camera, using the real price, engine, airbags and ground clearance pulled from the source.
- A pre-flight check now blocks a generation when pasted reference documents have grown longer than the shot description — a pronunciation guide left switched on had become 54% of the prompt.

## 1.14 — Stop over-pronouncing Hindi
_2026-09-09_

- The pronunciation pass was rewriting every word, which made most of a line sound wrong to fix the few that were. It is now a light touch: the line comes back mostly as written, with only the words a model actually says badly respelled.
- English words, brand names, model names, place names and function words are left exactly as they are — "test drive" stays "test drive", not TEST DRAAIV, and Tata Punch stays Tata Punch.
- The glossary now has two kinds of entry: leave in English (the safe default) and respell (for words you have heard come out wrong, plus prices). The 37 English terms that shipped as respellings have been flipped.
- A "Load the built-in guide" button pulls an improved shipped guide over a saved one — languages already in your database never re-read their seed.

## 1.13 — Work on several projects at once
_2026-09-09_

- Projects and library sections open in workspace tabs, so opening a client record no longer throws away the project you were editing.
- Tabs stay live in the background: a generation started in one tab keeps running while you work in another, and its tab shows a pulsing dot until it finishes.
- The brief and the prompt-and-preview columns scroll independently, instead of dragging each other around on one shared page scroll.
- A project missing its script now opens the storyboard automatically, since the fix was hidden inside a collapsed panel.

## 1.12 — Languages section
_2026-09-09_

- A new Languages library holds how each language must be spoken and written, plus a glossary of locked spellings. These are shipped to the models, not documentation.
- Hindi ships with the full pronunciation standard — vowel length, aspiration, schwa deletion, stress, the lakh/crore number system — and 70 locked dealer terms.
- Projects pick a language, and only languages you switch on are offered.
- Script writing split into two passes: copy first, then pronunciation against the language guide. "Redo pronunciation" re-runs the second pass alone, so tuning a guide costs one cheap text call and leaves approved copy untouched.

## 1.11 — Written scripts, spelled for pronunciation
_2026-09-08_

- The storyboard now carries the actual spoken line, not a stage direction. "Write the script" fills every scene and you edit before generating.
- Each line is also respelled for pronunciation — syllables hyphenated, stress capitalised — which is what the video model performs. Plain Hindi told models which words to say but not how to say them.
- Pre-flight warns when scenes have no line, and separately when a line has no pronunciation spelling.

## 1.10 — Dreamina Seedance as a second provider
_2026-09-08_

- Seedance 2.5 and 2.0 fast on BytePlus ModelArk, alongside Gemini Omni Flash. Pick the model per project.
- Seedance 2.5 renders 30 seconds in one call, so most videos need no stitching at all.
- A free connection test checks an API key without spending anything on a generation.
- Failed runs are re-costed from the segments that actually rendered, instead of being billed the full estimate.

## 1.9 — Retakes, and overlays that fit the frame
_2026-09-08_

- Fix a detail without paying for a full regenerate: tick only the segments that are wrong, add a note, and the rest of the saved clips are reused. Ticking nothing restitches the overlays for free.
- Brand and dealer logos are normalised to one shared box, so a tall badge no longer towers over a wide wordmark.
- The footer bar is capped at 8.5% of frame height and sized off the short side — it was eating a sixth of every landscape video.

## 1.8 — Overlay text that fits, and client identity
_2026-09-08_

- Overlay text wraps and shrinks to fit, instead of running off both edges of the frame.
- Clients carry a short display name for on-screen use, separate from the full legal listing name.
- The footer contact strip is saved per client and editable there, with a live preview.

## 1.7 — Generation history and cost
_2026-09-07_

- Every generation is saved against its project with a thumbnail, cost and specs — a new run no longer buries the last one.
- Per-video cost and a running project total, plus a portfolio total on the Projects page.
- Segments are packed around whole scenes so nothing is cut mid-action.
- Prompt parts collapse into an accordion.

## 1.6 — Post-production overlays
_2026-09-07_

- The footer, both logos and the end card are composited after generation rather than drawn by the model, which garbled small text and invented manufacturer badges.
- Videos always end on the dealer details and CTA.
- Segments crossfade instead of hard-cutting.
- Scene planning rewritten so long videos are not rushed and lumpy.
- The project editor leads with the few choices that matter and hides the rest.

## 1.5 — Left rail and model management
_2026-09-07_

- Navigation moved to a left sidebar.
- APIs & models: register provider keys and models, with the real capability limits that drive chunking, cost and the API call.
- All nine use cases generate video — the prompt-only split was dropped once presenters proved to work.

## 1.4 — An app for the design team
_2026-09-07_

- Five library sections — Projects, Clients, Cars, Actors, Global Instructions — so work is built once and reused.
- Client import from a Google Business Profile link, including showroom photos.
- Car library synced from CarDekho: brand, model, variant and colour.
- A shared team password gates the app.

## 1.3 — Long videos that hold together
_2026-09-07_

- Videos longer than one clip are generated as independent segments seeded with the previous segment’s last frame, then stitched — the provider’s own extend could not carry more than about ten seconds.
- Reference images keep the car consistent across cuts.
- On-screen text is locked to exact strings, and the presenter’s name no longer leaks into the frame as a caption.

## 1.2 — Reference images
_2026-09-07_

- Upload labelled reference images and have them ground the generation.
- Fetch a car model’s reference set from CarDekho automatically.

## 1.1 — Real video generation
_2026-09-07_

- The app generates video through Gemini Omni Flash instead of only producing prompt text.
- Preview the finished video with a frame timeline that jumps to each storyboard scene.

## 1.0 — First deploy
_2026-09-06_

- Structured brief, storyboard, pre-flight checks and cost estimate.
- Deployed on Cloud Run and Firebase Hosting, with push-to-deploy.
