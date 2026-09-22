# Project Image: Smart Intake — design

2026-09-22 · approved in conversation with Santosh

## What this is

An overhaul of the image section's journey. Today the designer fills five sections by hand
and a keyword regex guesses the kind of post, blind to attachments. After this change, a
fresh image project opens on **one intake screen** — a brief box and a drop zone — and one
cheap model call reads the brief *and* the attached images together. Its interpretation
comes back as an editable **plan card**; confirming it makes a single **1:1 proof**
(~₹10); approving the proof fans out to every other size with the proof as the master
reference, so the family matches. Uploaded images get **roles** (vehicle photo, finished
creative, moment photo, logo) that drive new workflows: recreate an old creative, change
elements of it, make other sizes of it, or design around a delivery photograph.

The point is first-time-right: the expensive step (₹10 a size) runs only after the cheap
understanding step has been corrected by a human, and only once until the proof is right.

## What already exists and is kept

- The 12 engines, blends, fields and the keyword classifier in
  `packages/shared/src/creativeEngines.ts` — the classifier remains the free fallback.
- Copy writing, whole-creative design, revision, and the read-back checks (words, vehicle,
  logos) in `apps/api/src/creatives.ts`.
- The whole workspace UI in `apps/web/src/sections/ImageProjectEditor.tsx` — sections
  01–05, the editor, approve/download. It remains the fine-control surface after intake.

## 1 · The journey

**Intake.** A project with no proof yet (`!p.designs?.['ig-square']` and no creatives)
renders the intake instead of the workspace: client picker, brief textarea, image drop
zone, and **"Read the brief"**. The button calls the new understand endpoint (~₹1, a few
seconds). Without a key, or on failure, the current keyword path runs instead and every
image defaults to the vehicle-photo role — the plan card still appears, marked "read
without the model".

**Plan card.** The interpretation, each piece editable in place (the card writes to the
same `ImageProject` fields the workspace sections write to — one source of truth):

- Kind of post: engine + blend chips, with the phrases it heard; hand-pickable as today.
- Facts: the engine's fields prefilled from the brief; mandatory gaps flagged.
- Images: thumbnails with role chips — vehicle photo / finished creative / moment photo /
  logo — flippable; a finished creative also shows an intent chip (recreate / change
  elements / other sizes).
- Vehicle: matched to the client's library by name (else "from the photograph"); colour.
- Sizes, language, look: prefilled; adjustable.

**Proof.** One button: **"Make the proof · 1:1 · about ₹10"**. It writes the copy (unless
copy already exists from a read-back), then designs `ig-square` through the existing
design path with all checks. If `ig-square` is not among the chosen sizes it is still the
proof (it is not added to `formats`). Under the proof: **"Make all sizes · about ₹N"**,
the existing change box (revise), and **"Make it again"**.

**Fan-out.** Every other chosen size is designed with the approved proof attached as
`reference: { kind: 'master' }` — "this is the same advertisement at another size: the
same scene, palette, type feeling and words, adapted to this frame". Sizes whose picture
is drawn separately (the wide strips) pass the proof to the scene call the same way.

After the first proof exists, the project opens on the workspace as today, with a compact
plan summary bar at the top (engine, heard phrases, "Read again" to re-run intake).

## 2 · The understand call

**New file `apps/api/src/intake.ts`**, route `POST /api/image-projects/:id/understand`
(auth: creator). Request: the brief, the client id, and the attached images' storage
paths. The server loads the images, the client's vehicle list (brand, model, colours,
ids) and builds one prompt for the text model (`resolveTextModel(key, 'transform')`,
temperature 0.2, JSON mime), containing:

- The engine catalogue: id, label, purpose, and each engine's field ids and labels.
- The blend table and the rule that the most emotional leads.
- The occasion list.
- The format list (id, label, pixels, platform) for size suggestions.
- The role taxonomy with how to tell them apart (a finished creative has designed text
  and layout; a moment photo has people/an occasion; a vehicle photo is the car alone;
  a logo is a mark on a flat ground).
- The images, numbered, inline.

**Response JSON (parsed strictly, every field optional except `engine`):**

```json
{
  "engine": { "primary": "delivery", "secondary": "festival", "ratio": "70/30" },
  "heard": ["delivery creative", "customers attached"],
  "confidence": "high",
  "occasion": "Diwali",
  "vehicle": { "name": "Hyundai Creta", "colour": "white" },
  "facts": { "customerName": "Mr & Mrs Sharma" },
  "language": "en",
  "sizes": ["ig-square", "story"],
  "sceneNote": "",
  "images": [{ "index": 0, "role": "moment-photo", "note": "handover with family" }],
  "referenceIntent": "recreate",
  "changes": "swap the offer to ₹75,000"
}
```

The parser maps `vehicle.name` to a library car id by loose name match; unknown fact ids,
engine ids, format ids and roles are dropped, never trusted. The result is returned to
the web app, which writes it into the project (facts merge under any value the designer
already typed — the model never overwrites a human). The heard phrases, confidence and
timestamp are kept on `project.intake` so the plan card can say why.

Cost is recorded via `recordUsage` like every other call and added to the project total.

## 3 · Image roles → workflows

Stored as `role` on each attached photo (`StoredImage & { role?: ImageRole }`),
`ImageRole = 'vehicle' | 'creative' | 'moment' | 'logo'`.

- **vehicle** — today's path: joins `attachedPhotos`, first one becomes `heroPhoto`.
- **moment** — the design call gets it as `reference: { kind: 'base-photo' }`:
  the instruction tells Nano Banana 2 to build the advertisement *on* this photograph —
  the people and the vehicle exactly as shot, backdrop and light improved, the words
  designed in. `pictureMode` stays `design`. (Words-on-top over the raw photo remains
  available in the workspace as `upload` mode.)
- **creative** — `readCreativeWords` (existing) reads its words; they prefill `copy`
  (editable in the plan card and section 04). The image is passed to the design call as
  `reference: { kind: 'style', changes? }`. Intents:
  - *recreate* — style reference, no changes line;
  - *change elements* — style reference + the `changes` sentence from the brief;
  - *other sizes* — the original is already the approved design: the proof step is
    skipped and the button reads "Make the N sizes"; the original is the `master`
    reference for every size.
- **logo** — not used in generation. The plan card says logos come from the client
  profile, with an "ignore" default and, for admins, a one-click "save to client".

## 4 · Server design changes (`creatives.ts`)

`DesignRequest` gains:

```ts
reference?: {
  storagePath: string;
  kind: 'style' | 'master' | 'base-photo';
  /** With 'style': what to change from the referenced creative. */
  changes?: string;
}
```

`designInstruction` gains one paragraph per kind (reference image numbered after the
canvas, before the car photos):

- **style**: "IMAGE_REF_n is an earlier advertisement. Design this one in its image: the
  same layout idea, palette, type feeling and mood — a fresh render, not a copy of its
  pixels. [Change: …]" The words set are still this project's copy, exactly.
- **master**: "IMAGE_REF_n is this same advertisement, approved at another size. Keep its
  scene, palette, typography and words; adapt the composition to this frame."
- **base-photo**: "IMAGE_REF_n is the photograph this advertisement is built on. Keep the
  people and the vehicle in it exactly as photographed — faces, poses, the car — and
  improve only the backdrop, the light and the grade; design the words around them."
  With this kind, the car-reference block relaxes to "the vehicle is the one in the
  photograph".

`sceneInstruction` accepts the `master` reference the same way for strip pictures.
`reviseCreativeDesign` is untouched — a revision already carries the current image.

## 5 · Shared types (`imageProject.ts` and friends)

- `attachedPhotos?: Array<StoredImage & { role?: ImageRole }>`.
- `reference?: { image: StoredImage; intent: 'recreate' | 'edit' | 'sizes'; changes?: string }`
  — set when a `creative`-role image exists; the design calls read it.
- `intake?: { at: number; heard: string[]; confidence?: 'high' | 'low'; model?: string; fallback?: boolean }`.
- No `stage` field: intake shows when the project has no designs and no creatives yet, so
  old projects open on the workspace unchanged.

## 6 · Web (`apps/web`)

- **New `sections/ImageIntake.tsx`** — the intake screen and plan card. Props: the
  project + the same `set` patcher the editor uses. It calls the understand endpoint via
  a new `understandBrief` helper in `lib/creatives.ts`, then renders the plan from the
  project state. The proof and fan-out buttons reuse `makeDesigns` logic, so proof and
  workspace behave identically. State cost lines on both buttons.
- **`ImageProjectEditor.tsx`** — renders `ImageIntake` until the project has a design or
  creative (or the designer clicks "skip to the workspace"); afterwards the workspace
  with the plan summary bar. `makeDesigns` moves the reference plumbing into the design
  brief; a `proofOnly` variant designs just `ig-square`.
- Section 02's upload keeps working; new uploads land with no role until read, defaulting
  to `vehicle`.

## 7 · Errors and edge cases

- Understand call fails → banner with the reason + the fallback interpretation, marked so.
- A brief with no signal at all → plan card shows "couldn't tell what kind of post" and
  the engine picker open; proof button disabled until an engine is picked.
- A `creative`-role image whose words can't be read → intent chips still work; copy stays
  the draft; the plan card says the words could not be read.
- Mixed roles (a car photo *and* an old creative) → both plumbed: car refs + style ref.
- More than ~4 images → first 4 by role priority (creative, moment, vehicle…) go to the
  model; the rest stay attachments.
- Failed word/vehicle/logo checks on the proof do not block "Make all sizes" — the
  checks inform, the designer decides, as today.

## 8 · Testing

- `apps/api/src/intake.test.ts` — prompt builder (engine catalogue, roles, images
  numbered), parser (good JSON, junk fields dropped, vehicle name → id match, fenced
  JSON, garbage → CreativeError), fallback path.
- `creatives.test.ts` — the three reference paragraphs appear (and only with a
  reference); base-photo relaxes the car block; master flows to `sceneInstruction`.
- Shared tests for role/intent types and the intake-visibility rule (no designs, no
  creatives → intake).
- Manual: preview (Cloud Run tag + Firebase channel) with a real brief, a real old
  creative and a delivery photo, before any live deploy — per project rule.

## Out of scope (deliberately)

- Batch/bulk creation, per-dealer scheduling, posting.
- Auto-generating without human confirmation of the plan.
- Saving detected logos to the client automatically (admin click only).
- Video section — untouched.
