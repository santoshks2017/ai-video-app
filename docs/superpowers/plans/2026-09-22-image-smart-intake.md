# Project Image: Smart Intake — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fresh image project opens on one intake screen; one cheap model call reads the brief and the attached images together; the interpretation is corrected by a human, proved on one 1:1 creative, and only then fanned out to every size with the proof as master reference.

**Architecture:** A new pure module `apps/api/src/intake.ts` (prompt builder + strict parser + one Gemini call) behind a new `/api/creatives/understand` route; `DesignRequest` gains a `reference` (style / master / base-photo) that `designInstruction` turns into one paragraph each; the web gets a new `ImageIntake` screen that `ImageProjectEditor` shows until the project has any design, picture or creative — the plan card writes to the same project fields the workspace edits.

**Tech Stack:** TypeScript monorepo (npm workspaces): `@ava/shared` (types + pure logic, node:test), `@ava/api` (Fastify, node:test against `dist/`), `@ava/web` (React + Vite, typecheck only). Gemini via raw fetch, images inline base64.

**Spec:** `docs/superpowers/specs/2026-09-22-image-smart-intake-design.md`

## Global Constraints

- Node ≥ 22; ESM everywhere; no new dependencies.
- API tests import from `../dist/*.js`, so build before testing: `npm run build:shared && npm run build --workspace @ava/api`.
- The model never overwrites a human: facts merge only into empty fields; engine applies only when `!engine.manual`; copy applies only when `p.copy` is unset.
- The proof format is `ig-square` (1:1, 1080×1080). It is the proof even when not among the chosen sizes, and is not added to `formats`.
- All user-facing sentences follow the codebase's plain-English voice (read neighbouring strings first).
- Commit messages: one poetic line in the repo's style, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Route naming: the spec says `POST /api/image-projects/:id/understand`; implemented as `POST /api/creatives/understand` with `projectId` in the body, matching the sibling creative routes (`copy`, `scene`, `design`, `revise`).
- Which images go to the understand call: the first 4 in attach order (the spec's "by role priority" cannot apply before roles exist).

---

### Task 1: Shared types — roles, reference, intake record, the intake-visibility rule

**Files:**
- Modify: `packages/shared/src/imageProject.ts`
- Test: `packages/shared/src/shared.test.ts` (append)

**Interfaces:**
- Consumes: existing `ImageProject`, `StoredImage`, `CreativeFormatId`.
- Produces (later tasks rely on these exact names):
  - `type ImageRole = 'vehicle' | 'creative' | 'moment' | 'logo'`
  - `type ReferenceIntent = 'recreate' | 'edit' | 'sizes'`
  - `interface AttachedPhoto extends StoredImage { role?: ImageRole }` and `ImageProject.attachedPhotos?: AttachedPhoto[]`
  - `ImageProject.reference?: { image: StoredImage; intent: ReferenceIntent; changes?: string }`
  - `ImageProject.intake?: { at: number; heard: string[]; confidence?: 'high' | 'low'; model?: string; fallback?: boolean }`
  - `const PROOF_FORMAT: CreativeFormatId = 'ig-square'`
  - `function showIntake(p: ImageProject): boolean`

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/shared.test.ts` (it imports from `../dist/index.js` — check the top of the file and use the same import source; add `emptyImageProject`, `showIntake`, `PROOF_FORMAT` to it):

```ts
test('a project shows intake until anything has been made, and the proof is the square', () => {
  const base = { ...emptyImageProject(), id: 'p1', createdAt: 1, updatedAt: 1 };
  assert.equal(PROOF_FORMAT, 'ig-square');
  assert.equal(showIntake(base), true, 'nothing made yet');
  assert.equal(showIntake({ ...base, creatives: [{ id: 'c', format: 'ig-square', doc: { format: 'ig-square', layers: [] }, updatedAt: 1 } as never] }), false, 'an edited size means workspace');
  assert.equal(showIntake({ ...base, designs: { 'ig-square': {} as never } }), false, 'a design means workspace');
  assert.equal(showIntake({ ...base, pictures: { '1:1': {} as never } }), false, 'a scene picture means workspace');
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test --workspace @ava/shared`
Expected: FAIL — `showIntake` / `PROOF_FORMAT` are not exported.

- [ ] **Step 3: Implement**

In `packages/shared/src/imageProject.ts`:

```ts
/** What an attached image is to the project — read by the intake model, flippable by hand. */
export type ImageRole = 'vehicle' | 'creative' | 'moment' | 'logo';
/** What to do with an attached finished creative. */
export type ReferenceIntent = 'recreate' | 'edit' | 'sizes';
/** A photo attached to the project, with what it is. */
export type AttachedPhoto = StoredImage & { role?: ImageRole };
```

Change `attachedPhotos?: StoredImage[]` to `attachedPhotos?: AttachedPhoto[]`, and add to `ImageProject`:

```ts
  /** An earlier creative to build from: recreate it, change elements, or make its other sizes. */
  reference?: { image: StoredImage; intent: ReferenceIntent; changes?: string };
  /** What the intake read, when, and how sure it was. */
  intake?: { at: number; heard: string[]; confidence?: 'high' | 'low'; model?: string; fallback?: boolean };
```

Below `emptyImageProject`:

```ts
/** The size a new creative is proved on before the rest are paid for. */
export const PROOF_FORMAT: CreativeFormatId = 'ig-square';

/** A project with nothing made yet opens on the intake; anything made opens the workspace. */
export const showIntake = (p: ImageProject): boolean =>
  !p.creatives.length && !Object.keys(p.designs ?? {}).length && !Object.keys(p.pictures ?? {}).length;
```

Confirm `packages/shared/src/index.ts` re-exports `./imageProject.js` (it does today — nothing to add if so).

- [ ] **Step 4: Run the tests**

Run: `npm run test --workspace @ava/shared`
Expected: PASS.

- [ ] **Step 5: Typecheck the other workspaces still compile**

Run: `npm run build:shared && npm run typecheck --workspace @ava/api && npm run typecheck --workspace @ava/web`
Expected: clean — `AttachedPhoto` widens `StoredImage`, nothing breaks.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/imageProject.ts packages/shared/src/shared.test.ts
git commit -m "$(printf 'An attached image knows what it is, and a new project opens on the intake\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>')"
```

---

### Task 2: The reference in the design instruction (api `creatives.ts`)

**Files:**
- Modify: `apps/api/src/creatives.ts`
- Test: `apps/api/src/creatives.test.ts` (append)

**Interfaces:**
- Consumes: existing `DesignRequest`, `designInstruction`, `sceneInstruction`, `drawCreativeDesign`, `SceneRequest`.
- Produces:
  - `export type DesignReferenceKind = 'style' | 'master' | 'base-photo'`
  - `DesignRequest.reference?: { storagePath: string; kind: DesignReferenceKind; changes?: string }`
  - `SceneRequest.match?: boolean` — the last reference image is an approved creative to match.
  - `drawCreativeDesign(req, canvas, reference: { bytes: Buffer; mimeType: string } | null, refs, apiKey)` — **new third parameter**.
  - Image order in the parts: instruction text, canvas?, reference?, then car photos. Index math: `refIdx = canvas ? 1 : 0`; car photos start at `refIdx + (reference ? 1 : 0)`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/creatives.test.ts`. Reuse the file's existing `DESIGN` request constant if one exists near the design tests (read the design test around line 74 first); otherwise build a minimal valid `DesignRequest` the same way that test does, and spread onto it:

```ts
test('a reference joins the design: a style to follow, a master to match, or the photograph it is built on', () => {
  const base: DesignRequest = {
    format: 'ig-square',
    engine: 'offer',
    vehicle: { name: 'Hyundai Creta', kind: 'car' },
    words: { kicker: '', headline: 'Drive home the Creta', sub: '', badge: '', points: [], cta: '', terms: '' },
    language: { name: 'English', script: 'latin' },
    look: { panel: '#0F1E33', accent: '#E8590C' },
    zones: { logoBand: 0, stripTop: 1, logoTone: 'dark', textSide: 'top' },
  };
  const plain = designInstruction(base, ['the Hyundai Creta, front']);
  assert.doesNotMatch(plain, /earlier advertisement|approved at another size|built on/, 'no reference, no paragraph');

  const style = designInstruction({ ...base, reference: { storagePath: 'refs/a/b.png', kind: 'style', changes: 'swap the offer to ₹75,000' } }, ['the Hyundai Creta, front']);
  assert.match(style, /<IMAGE_REF_0> — an earlier advertisement to design this one after/);
  assert.match(style, /<IMAGE_REF_1> — the Hyundai Creta, front/, 'the car moves down one');
  assert.match(style, /<IMAGE_REF_0> is an earlier advertisement\. Design this one in its image/);
  assert.match(style, /a fresh render in this frame, never a copy of its pixels/);
  assert.match(style, /One thing changes from it: "swap the offer to ₹75,000"/);
  assert.match(style, /<IMAGE_REF_1> is the Hyundai Creta/, 'the car block still points at the right image');

  const master = designInstruction({ ...base, reference: { storagePath: 'refs/a/b.png', kind: 'master' } }, ['the Hyundai Creta, front']);
  assert.match(master, /this same advertisement, already approved at another size/);
  assert.match(master, /Keep its scene, palette, typography and words; adapt the composition/);
  assert.doesNotMatch(master, /One thing changes/);

  const moment = designInstruction({ ...base, reference: { storagePath: 'refs/a/b.png', kind: 'base-photo' } }, []);
  assert.match(moment, /<IMAGE_REF_0> is the photograph this advertisement is built on/);
  assert.match(moment, /exactly as photographed/);
  assert.match(moment, /improve only the backdrop, the light and the grade/);
  assert.doesNotMatch(moment, /Put THIS car/, 'no car photos, no car block');
  assert.match(moment, /The vehicle in the advertisement is the one in the photograph/);
});

test('with a canvas and a reference, the canvas stays first and everything shifts by one', () => {
  const withBoth = designInstruction(
    {
      format: 'ig-square',
      engine: 'offer',
      vehicle: { name: 'Hyundai Creta', kind: 'car' },
      words: { kicker: '', headline: 'H', sub: '', badge: '', points: [], cta: '', terms: '' },
      language: { name: 'English', script: 'latin' },
      look: { panel: '#0F1E33', accent: '#E8590C' },
      zones: { logoBand: 0, stripTop: 1, logoTone: 'dark', textSide: 'top' },
      canvas: { storagePath: 'refs/c/c.png', logos: 2 },
      reference: { storagePath: 'refs/a/b.png', kind: 'style' },
    },
    ['the Hyundai Creta, front'],
  );
  assert.match(withBoth, /<IMAGE_REF_0> — the canvas/);
  assert.match(withBoth, /<IMAGE_REF_1> — an earlier advertisement/);
  assert.match(withBoth, /<IMAGE_REF_2> — the Hyundai Creta, front/);
  assert.match(withBoth, /<IMAGE_REF_2> is the Hyundai Creta/);
});

test('a scene can be asked to match the approved creative', () => {
  const req = { aspect: '21:9' as const, engine: 'offer' as const, vehicle: { name: 'Hyundai Creta' }, textBand: 'left' as const, panel: false, match: true };
  const p = sceneInstruction(req, ['the Hyundai Creta, front', 'the approved creative to match']);
  assert.match(p, /keep its scene, palette and light, recomposed for this frame/);
  assert.match(p, /carries no words over from it/);
  const plain = sceneInstruction({ ...req, match: false }, ['the Hyundai Creta, front']);
  assert.doesNotMatch(plain, /recomposed for this frame/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run build:shared && cd apps/api && npm run build; node --test --experimental-strip-types src/creatives.test.ts; cd ../..`
Expected: build FAILS (no `reference` on `DesignRequest`) — that is the failure signal here.

- [ ] **Step 3: Implement in `apps/api/src/creatives.ts`**

Add the type and field:

```ts
/** What a reference image is to the design: a style to follow, the same ad at another size, or the photograph it is built on. */
export type DesignReferenceKind = 'style' | 'master' | 'base-photo';
```

On `DesignRequest`:

```ts
  /** An image the design builds from, read by `kind`; `changes` only with 'style'. */
  reference?: { storagePath: string; kind: DesignReferenceKind; changes?: string };
```

On `SceneRequest`:

```ts
  /** The last reference image is the approved creative this picture must match. */
  match?: boolean;
```

In `designInstruction(req, carLabels)` — replace the two index constants:

```ts
  const canvas = Boolean(req.canvas);
  const refIdx = canvas ? 1 : 0;
  const car = refIdx + (req.reference ? 1 : 0);
  const basePhoto = req.reference?.kind === 'base-photo';
```

In the `## References` list, after the canvas line and before the car labels:

```ts
    ...(req.reference
      ? [
          `<IMAGE_REF_${refIdx}> — ${
            req.reference.kind === 'style'
              ? 'an earlier advertisement to design this one after'
              : req.reference.kind === 'master'
                ? 'this same advertisement, approved at another size'
                : 'the photograph this advertisement is built on'
          }`,
        ]
      : []),
```

After the canvas block (and before `## The ${noun}`), the reference block:

```ts
    ...(req.reference
      ? [
          '',
          '## The reference',
          req.reference.kind === 'style'
            ? `<IMAGE_REF_${refIdx}> is an earlier advertisement. Design this one in its image: the same layout idea, palette, type feeling and mood — a fresh render in this frame, never a copy of its pixels. The words to set are the ones listed below, exactly.${req.reference.changes ? ` One thing changes from it: ${quoted(req.reference.changes)}.` : ''}`
            : req.reference.kind === 'master'
              ? `<IMAGE_REF_${refIdx}> is this same advertisement, already approved at another size. Keep its scene, palette, typography and words; adapt the composition to this frame.`
              : `<IMAGE_REF_${refIdx}> is the photograph this advertisement is built on. Keep the people and the vehicle in it exactly as photographed — the same faces, poses, clothes and vehicle, reframed to fit but never redrawn — and improve only the backdrop, the light and the grade. Design the words around them.`,
        ]
      : []),
```

The `## The ${noun}` block: wrap it so that with `basePhoto && !carLabels.length` it is replaced by one line:

```ts
    ...(basePhoto && !carLabels.length
      ? ['', `## The ${noun}`, `The vehicle in the advertisement is the one in the photograph — keep it exactly as shot, including its number plate area, repainted plain white and blank.`]
      : [
          '',
          `## The ${noun}`,
          // ...the existing three lines, unchanged, using `car` as today
        ]),
```

In `sceneInstruction`, add to the `## The scene` section (after the mood line):

```ts
    req.match ? 'One of the references is this same advertisement, already approved at another size: keep its scene, palette and light, recomposed for this frame. The picture carries no words over from it — it carries no words at all.' : '',
```

Change `drawCreativeDesign`'s signature and parts (the new `reference` parameter sits between `canvas` and `refs`):

```ts
export async function drawCreativeDesign(
  req: DesignRequest,
  canvas: { bytes: Buffer; mimeType: string } | null,
  reference: { bytes: Buffer; mimeType: string } | null,
  refs: Array<{ bytes: Buffer; mimeType: string; label: string }>,
  apiKey: string,
): Promise<{ bytes: Buffer; mimeType: string; model: string; costInr: number }> {
  if (!refs.length && req.reference?.kind !== 'base-photo')
    throw new CreativeError('design-no-photo', 'Pick a photo of the vehicle first — the creative is built from it.', 400);
  const model = await resolveNanoBanana2(apiKey);
  const parts: ImagePart[] = [
    { text: designInstruction(canvas ? req : { ...req, canvas: undefined }, refs.map((r) => r.label)) },
    ...(canvas ? [{ inline_data: { mime_type: canvas.mimeType, data: canvas.bytes.toString('base64') } }] : []),
    ...(reference ? [{ inline_data: { mime_type: reference.mimeType, data: reference.bytes.toString('base64') } }] : []),
    ...refs.map((r) => ({ inline_data: { mime_type: r.mimeType, data: r.bytes.toString('base64') } })),
  ];
  // ...rest unchanged
```

Note the subtle existing behaviour to preserve: when `canvas` bytes are null the instruction strips `req.canvas` — keep `reference` in `req` regardless, since its paragraph needs no bytes to be true (the route always loads bytes or fails; see Task 3).

- [ ] **Step 4: Run the tests**

Run: `npm run build:shared && cd apps/api && npm run build && node --test --experimental-strip-types src/creatives.test.ts; cd ../..`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/creatives.ts apps/api/src/creatives.test.ts
git commit -m "$(printf 'A design can follow an earlier creative, match its master, or build on a photograph\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>')"
```

---

### Task 3: Route plumbing for the reference (`server.ts`)

**Files:**
- Modify: `apps/api/src/server.ts` (the `cleanDesign` helper ~line 4214, the `/api/creatives/design` route ~line 4373, the `/api/creatives/revise` route ~line 4411, the `/api/creatives/scene` route ~line 4164)

**Interfaces:**
- Consumes: Task 2's `drawCreativeDesign(req, canvas, reference, refs, key)`, `DesignReferenceKind`, `SceneRequest.match`.
- Produces (the web calls these):
  - `/api/creatives/design` body accepts `design.reference: { storagePath, kind, changes? }`.
  - `/api/creatives/scene` body accepts `match?: { storagePath: string }` beside `scene` and `photos`; when present the loaded image is appended to the refs with the label `this same advertisement, approved at another size` and `scene.match` is set true.

- [ ] **Step 1: Extend `cleanDesign`**

Inside the returned object (beside the `canvas` spread), add:

```ts
    ...((): Partial<Pick<DesignRequest, 'reference'>> => {
      const r = d.reference as Record<string, unknown> | undefined;
      const kind = r?.kind;
      if (!r || typeof r.storagePath !== 'string' || !STORED.test(r.storagePath)) return {};
      if (kind !== 'style' && kind !== 'master' && kind !== 'base-photo') return {};
      const changes = text(r.changes, 300);
      return { reference: { storagePath: r.storagePath, kind, ...(kind === 'style' && changes ? { changes } : {}) } };
    })(),
```

Import `DesignReferenceKind` is not needed — the literal check narrows. Also relax the route's no-photos guard in `/api/creatives/design`:

```ts
  const refs = await carRefs(req.body?.photos, design.vehicle.name, 4);
  if (!refs.length && design.reference?.kind !== 'base-photo')
    return reply.code(400).send({ code: 'design-no-photo', message: 'Pick a photo of the vehicle first — the creative is built from it.' });
```

- [ ] **Step 2: Load the reference bytes in the design route**

After `const canvas = await readCanvas(design);`:

```ts
  const refImage = design.reference
    ? await readObject(design.reference.storagePath)
        .then(async (o) => ({ bytes: await asJpeg(o.bytes), mimeType: 'image/jpeg' }))
        .catch(() => null)
    : null;
  if (design.reference && !refImage) return reply.code(404).send({ code: 'not-found', message: 'That reference image is no longer stored. Attach it again.' });
```

Update both calls: `drawCreativeDesign(design, canvas ? { bytes: canvas, mimeType: 'image/png' } : null, refImage, refs, key)`.

For the vehicle check with a base photo and no car refs, in the design route's `attempt`, the reference photograph stands in for the car photo:

```ts
      const checks = await checkDesign(out.bytes, design, refs[0]?.bytes ?? (design.reference?.kind === 'base-photo' ? refImage?.bytes : undefined), canvas, key);
```

(`checkDesign`'s `reference` parameter is already `Buffer | undefined` — confirm and keep.)

- [ ] **Step 3: The revise route**

`reviseCreativeDesign` is unchanged (the current image is the reference), but `cleanDesign` now carries `reference` harmlessly — nothing to do beyond confirming the build.

- [ ] **Step 4: The scene route accepts a master to match**

In `/api/creatives/scene`'s body type add `match?: { storagePath?: unknown }`. After the existing refs are loaded:

```ts
    const matchPath = req.body?.match?.storagePath;
    if (typeof matchPath === 'string' && STORED.test(matchPath)) {
      const o = await readObject(matchPath).catch(() => null);
      const jpeg = o ? await asJpeg(o.bytes).catch(() => null) : null;
      if (jpeg) {
        refs.push({ bytes: jpeg, mimeType: 'image/jpeg', label: 'this same advertisement, approved at another size' });
        scene.match = true;
      }
    }
```

(Where `scene` is the cleaned SceneRequest object the route builds — find the exact local name in the route and set the flag on it before `drawCreativeScene` is called.)

- [ ] **Step 5: Build and run the api tests**

Run: `npm run build:shared && npm run test --workspace @ava/api`
Expected: PASS (routes have no unit tests; the build is the check, plus all module tests still green).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/server.ts
git commit -m "$(printf 'The server hands the reference image to the design, and the scene its master\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>')"
```

---

### Task 4: `intake.ts` — the understand prompt and its strict parser

**Files:**
- Create: `apps/api/src/intake.ts`
- Test: `apps/api/src/intake.test.ts`

**Interfaces:**
- Consumes from `@ava/shared`: `CREATIVE_ENGINES`, `CREATIVE_ENGINE_BY_ID`, `isCreativeEngine`, `CREATIVE_FORMATS`, `isCreativeFormat`, `INDIAN_OCCASIONS`, `emptyCopy`, types `CreativeEngineId`, `CreativeFormatId`, `CreativeCopy`, `ImageRole`, `ReferenceIntent`. From `./creatives.js`: `CreativeError`. From `./script.js`: `resolveTextModel`. From `./spendLog.js`: `recordUsage`.
- Produces (server route and tests use these exact names):

```ts
export interface UnderstandRequest {
  brief: string;
  client?: { name: string; brand?: string };
  /** The client's library, for matching the brief's vehicle to a car id. */
  vehicles: Array<{ id: string; name: string }>;
  /** The language choices the app offers, by id. */
  languages: Array<{ id: string; name: string }>;
  /** The attached images, in order; bytes travel separately. */
  images: Array<{ label?: string }>;
}

export interface Interpretation {
  engine: { primary: CreativeEngineId; secondary?: CreativeEngineId; ratio?: string };
  heard: string[];
  confidence: 'high' | 'low';
  occasion?: string;
  carId?: string;
  colour?: string;
  facts: Record<string, string>;
  languageId?: string;
  sizes?: CreativeFormatId[];
  sceneNote?: string;
  images: Array<{ index: number; role: ImageRole; note?: string }>;
  referenceIntent?: ReferenceIntent;
  changes?: string;
  /** The words read off an attached finished creative, when there is one. */
  copy?: CreativeCopy;
}

export function understandPrompt(req: UnderstandRequest): string;
export function parseInterpretation(text: string, req: UnderstandRequest): Interpretation; // throws CreativeError('intake-unreadable' | 'intake-no-engine')
export async function understandBrief(
  req: UnderstandRequest,
  images: Array<{ bytes: Buffer; mimeType: string }>,
  apiKey: string,
): Promise<{ interpretation: Interpretation; model: string; costInr: number }>;
```

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/intake.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInterpretation, understandPrompt, type UnderstandRequest } from '../dist/intake.js';

const REQ: UnderstandRequest = {
  brief: 'Delivery creative for the customers attached, Diwali week',
  client: { name: 'Garve Hyundai', brand: 'Hyundai' },
  vehicles: [
    { id: 'car-1', name: 'Hyundai Creta' },
    { id: 'car-2', name: 'Hyundai Venue' },
  ],
  languages: [
    { id: 'en', name: 'English' },
    { id: 'hinglish', name: 'Hinglish' },
  ],
  images: [{ label: 'IMG_2041.jpg' }, {}],
};

test('the prompt carries the engines, the roles, the formats, the library and the images', () => {
  const p = understandPrompt(REQ);
  assert.match(p, /delivery \(E01 · Delivery \/ Handover\)/, 'the engine catalogue, by id');
  assert.match(p, /fields: customerName — Customer; moment — The moment/, 'each engine’s field ids');
  assert.match(p, /vehicle photo.*finished creative.*moment photo.*logo/s, 'the role taxonomy');
  assert.match(p, /ig-square: Instagram square, 1080×1080/, 'the sizes by id');
  assert.match(p, /car-1: Hyundai Creta/, 'the client’s library for matching');
  assert.match(p, /<IMAGE_1> — IMG_2041.jpg/, 'images numbered from 1, with their names');
  assert.match(p, /<IMAGE_2>\b/);
  assert.match(p, /Diwali/, 'the occasion list is there to choose from');
  assert.match(p, /Garve Hyundai/, 'the client');
  assert.match(p, /JSON only/);
});

test('a good answer is read whole: engine, facts, roles, vehicle matched to the library', () => {
  const out = parseInterpretation(
    JSON.stringify({
      engine: { primary: 'delivery', secondary: 'festival', ratio: '70/30' },
      heard: ['delivery creative', 'Diwali'],
      confidence: 'high',
      occasion: 'Diwali',
      vehicle: { name: 'Creta', colour: 'white' },
      facts: { customerName: 'Mr & Mrs Sharma', notAField: 'dropped' },
      language: 'en',
      sizes: ['ig-square', 'story', 'not-a-size'],
      images: [
        { index: 0, role: 'moment-photo', note: 'handover with family' },
        { index: 1, role: 'vehicle-photo' },
      ],
    }),
    REQ,
  );
  assert.equal(out.engine.primary, 'delivery');
  assert.equal(out.engine.secondary, 'festival');
  assert.equal(out.carId, 'car-1', 'Creta matched to the library');
  assert.equal(out.colour, 'white');
  assert.equal(out.facts.customerName, 'Mr & Mrs Sharma');
  assert.ok(!('notAField' in out.facts), 'a fact no engine has is dropped');
  assert.deepEqual(out.sizes, ['ig-square', 'story'], 'unknown sizes dropped');
  assert.deepEqual(out.images.map((i) => i.role), ['moment', 'vehicle'], 'roles read with or without the -photo suffix');
  assert.equal(out.confidence, 'high');
});

test('a finished creative brings its intent, its changes and its words', () => {
  const out = parseInterpretation(
    JSON.stringify({
      engine: { primary: 'offer' },
      images: [{ index: 0, role: 'finished-creative' }],
      referenceIntent: 'edit',
      changes: 'swap the offer to ₹75,000',
      copy: { headline: 'Benefits up to ₹50,000*', points: ['Exchange bonus'], cta: 'Book now', junk: 'x' },
    }),
    REQ,
  );
  assert.equal(out.images[0]!.role, 'creative');
  assert.equal(out.referenceIntent, 'edit');
  assert.equal(out.changes, 'swap the offer to ₹75,000');
  assert.equal(out.copy?.headline, 'Benefits up to ₹50,000*');
  assert.deepEqual(out.copy?.points, ['Exchange bonus']);
  assert.equal(out.copy?.kicker, '', 'missing copy fields come back empty, not undefined');
});

test('junk is refused, and junk fields are dropped without refusing the rest', () => {
  assert.throws(() => parseInterpretation('no json here', REQ), /cannot be read/);
  assert.throws(() => parseInterpretation('{"engine": {"primary": "not-an-engine"}}', REQ), /could not tell what kind of post/);
  const out = parseInterpretation('```json\n{"engine": {"primary": "offer"}, "confidence": "very sure", "copy": {"headline": ""}}\n```', REQ);
  assert.equal(out.confidence, 'low', 'unknown confidence reads as low');
  assert.equal(out.copy, undefined, 'a copy with no headline is no copy');
  assert.deepEqual(out.images, [], 'no images answered, none invented');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run build:shared && cd apps/api && npm run build 2>&1 | head -5; cd ../..`
Expected: FAIL — `src/intake.ts` does not exist.

- [ ] **Step 3: Implement `apps/api/src/intake.ts`**

```ts
/**
 * The intake: one cheap call that reads a brief and its attached images together and answers
 * with an interpretation — what kind of post, the facts already in the brief, what each image
 * is, and, when one is a finished creative, the words on it. The designer corrects it; the
 * expensive generation runs only after.
 *
 * Everything the model answers is checked against what the app knows — unknown engines, fact
 * ids, sizes and roles are dropped, never trusted.
 */
import {
  CREATIVE_ENGINES,
  CREATIVE_ENGINE_BY_ID,
  CREATIVE_FORMATS,
  INDIAN_OCCASIONS,
  emptyCopy,
  isCreativeEngine,
  isCreativeFormat,
  usageCostUsd,
  DEFAULT_USD_TO_INR,
  type CreativeCopy,
  type CreativeEngineId,
  type CreativeFormatId,
  type ImageRole,
  type ReferenceIntent,
  type TokenUsage,
} from '@ava/shared';
import { CreativeError } from './creatives.js';
import { resolveTextModel } from './script.js';
import { recordUsage } from './spendLog.js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

export interface UnderstandRequest { /* as in Interfaces above, verbatim */ }
export interface Interpretation { /* as in Interfaces above, verbatim */ }

const ROLES = `What each image can be:
- "vehicle-photo" — the vehicle alone: a car or bike, no designed text on it.
- "finished-creative" — a designed advertisement: it has a headline, offers or a layout of words on it.
- "moment-photo" — people and an occasion: a delivery handover, customers with the car, a showroom moment.
- "logo" — a logo or wordmark on a flat ground.`;

/** The instruction: the catalogue of everything the app knows, the brief, and the images to read. */
export function understandPrompt(req: UnderstandRequest): string {
  const engines = CREATIVE_ENGINES.map(
    (e) => `- ${e.id} (${e.code} · ${e.label}): ${e.purpose} fields: ${e.fields.map((f) => `${f.id} — ${f.label}`).join('; ')}`,
  );
  const formats = CREATIVE_FORMATS.map((f) => `- ${f.id}: ${f.label}, ${f.width}×${f.height} (${f.platforms})`);
  const lines = [
    `You are the intake of a creative studio for Indian vehicle dealerships. A designer wrote a brief${req.images.length ? ' and attached images' : ''}; read everything together and answer with one JSON interpretation. Answer JSON only.`,
    '',
    `## The client`,
    req.client ? `${req.client.name}${req.client.brand ? `, a ${req.client.brand} dealership` : ''}.` : 'Not picked yet.',
    '',
    '## The kinds of post (pick primary, and secondary only when the brief truly blends two)',
    ...engines,
    '',
    '## Occasions the app knows',
    INDIAN_OCCASIONS.join(', '),
    '',
    '## The sizes',
    ...formats,
    '',
    "## The client's vehicle library (match the brief's vehicle to one of these ids when it names one)",
    ...(req.vehicles.length ? req.vehicles.map((v) => `- ${v.id}: ${v.name}`) : ['(empty)']),
    '',
    '## Languages',
    req.languages.map((l) => `${l.id} (${l.name})`).join(', '),
    '',
    '## The brief',
    req.brief.trim() || '(empty)',
    ...(req.images.length
      ? ['', '## The images', ROLES, ...req.images.map((im, i) => `<IMAGE_${i + 1}> — ${im.label || 'attached image'}`)]
      : []),
    '',
    '## Answer — JSON only, exactly this shape; leave out what the brief does not say',
    JSON.stringify({
      engine: { primary: '', secondary: '', ratio: '60/40' },
      heard: ['the exact phrases that decided the kind of post'],
      confidence: 'high | low',
      occasion: '',
      vehicle: { name: '', colour: '' },
      facts: { '<fieldId of the chosen engines>': 'value found in the brief' },
      language: '<language id>',
      sizes: ['<size ids, only when the brief names placements>'],
      sceneNote: 'setting direction from the brief, if any',
      images: [{ index: 0, role: 'vehicle-photo | finished-creative | moment-photo | logo', note: '' }],
      referenceIntent: 'recreate | edit | sizes — only when an image is a finished creative',
      changes: 'what the brief asks to change from the finished creative, if anything',
      copy: { headline: '', kicker: '', sub: '', badge: '', points: [''], cta: '', terms: '' },
    }),
    'Rules: facts hold only what the brief itself says — never invent a name, a price or a date. "copy" only when an image is a finished creative: the words on it, exactly as written. "referenceIntent" is "sizes" when the designer wants the same creative at other sizes; "edit" when they name a change; else "recreate".',
  ];
  return lines.join('\n');
}

const str = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strs = (v: unknown, max = 12): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, max) : []);

/** The library car a name points at, loosely: the full name, either way round, or the model alone. */
function matchVehicle(name: string, vehicles: UnderstandRequest['vehicles']): string | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  const hit =
    vehicles.find((v) => v.name.toLowerCase() === n) ??
    vehicles.find((v) => n.includes(v.name.toLowerCase()) || v.name.toLowerCase().includes(n)) ??
    vehicles.find((v) => {
      const model = v.name.toLowerCase().split(/\s+/).slice(1).join(' ');
      return model && (n === model || n.includes(model));
    });
  return hit?.id;
}

const ROLE_MAP: Record<string, ImageRole> = {
  vehicle: 'vehicle', 'vehicle-photo': 'vehicle',
  creative: 'creative', 'finished-creative': 'creative',
  moment: 'moment', 'moment-photo': 'moment',
  logo: 'logo',
};

/** The interpretation out of whatever came back, everything checked against what the app knows. */
export function parseInterpretation(text: string, req: UnderstandRequest): Interpretation {
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (from < 0 || to <= from) throw new CreativeError('intake-unreadable', 'The interpretation came back in a form that cannot be read. Try again.');
  let raw: Record<string, any>;
  try {
    raw = JSON.parse(text.slice(from, to + 1)) as Record<string, any>;
  } catch {
    throw new CreativeError('intake-unreadable', 'The interpretation came back in a form that cannot be read. Try again.');
  }
  const primary = raw.engine?.primary;
  if (!isCreativeEngine(primary)) throw new CreativeError('intake-no-engine', 'The brief could not tell what kind of post this is — pick one by hand.');
  const secondary = isCreativeEngine(raw.engine?.secondary) && raw.engine.secondary !== primary ? (raw.engine.secondary as CreativeEngineId) : undefined;
  const fieldIds = new Set([...CREATIVE_ENGINE_BY_ID[primary].fields, ...(secondary ? CREATIVE_ENGINE_BY_ID[secondary].fields : [])].map((f) => f.id));
  const facts: Record<string, string> = {};
  if (raw.facts && typeof raw.facts === 'object') {
    for (const [k, v] of Object.entries(raw.facts as Record<string, unknown>)) if (fieldIds.has(k) && str(v)) facts[k] = str(v, 500);
  }
  const images = (Array.isArray(raw.images) ? raw.images : [])
    .map((im: any) => ({ index: typeof im?.index === 'number' ? im.index : -1, role: ROLE_MAP[str(im?.role, 40)], note: str(im?.note, 200) || undefined }))
    .filter((im): im is { index: number; role: ImageRole; note?: string } => Boolean(im.role) && im.index >= 0 && im.index < req.images.length);
  const rawCopy = raw.copy as Record<string, unknown> | undefined;
  const copy: CreativeCopy | undefined =
    rawCopy && str(rawCopy.headline)
      ? {
          ...emptyCopy(),
          headline: str(rawCopy.headline, 200),
          kicker: str(rawCopy.kicker, 120),
          sub: str(rawCopy.sub, 300),
          badge: str(rawCopy.badge, 120),
          points: strs(rawCopy.points, 6),
          cta: str(rawCopy.cta, 80),
          terms: str(rawCopy.terms, 300),
        }
      : undefined;
  const intent = ['recreate', 'edit', 'sizes'].includes(raw.referenceIntent) ? (raw.referenceIntent as ReferenceIntent) : undefined;
  const occasion = INDIAN_OCCASIONS.find((o) => o.toLowerCase() === str(raw.occasion, 60).toLowerCase()) ?? (str(raw.occasion, 60) || undefined);
  return {
    engine: { primary, ...(secondary ? { secondary } : {}), ...(str(raw.engine?.ratio, 8) ? { ratio: str(raw.engine.ratio, 8) } : {}) },
    heard: strs(raw.heard),
    confidence: raw.confidence === 'high' ? 'high' : 'low',
    ...(occasion ? { occasion } : {}),
    ...((): Partial<Interpretation> => {
      const id = matchVehicle(str(raw.vehicle?.name, 80), req.vehicles);
      return id ? { carId: id } : {};
    })(),
    ...(str(raw.vehicle?.colour, 60) ? { colour: str(raw.vehicle.colour, 60) } : {}),
    facts,
    ...(req.languages.some((l) => l.id === str(raw.language, 20)) ? { languageId: str(raw.language, 20) } : {}),
    ...((): Partial<Interpretation> => {
      const sizes = strs(raw.sizes).filter(isCreativeFormat) as CreativeFormatId[];
      return sizes.length ? { sizes } : {};
    })(),
    ...(str(raw.sceneNote, 300) ? { sceneNote: str(raw.sceneNote, 300) } : {}),
    images,
    ...(intent && images.some((im) => im.role === 'creative') ? { referenceIntent: intent } : {}),
    ...(str(raw.changes, 300) ? { changes: str(raw.changes, 300) } : {}),
    ...(copy ? { copy } : {}),
  };
}

/** The one call: the prompt and the images to the text model, the interpretation back. */
export async function understandBrief(
  req: UnderstandRequest,
  images: Array<{ bytes: Buffer; mimeType: string }>,
  apiKey: string,
): Promise<{ interpretation: Interpretation; model: string; costInr: number }> {
  const model = await resolveTextModel(apiKey, 'transform');
  const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: understandPrompt(req) }, ...images.map((im) => ({ inline_data: { mime_type: im.mimeType, data: im.bytes.toString('base64') } }))],
        },
      ],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string; status?: string };
    usageMetadata?: TokenUsage;
  };
  if (!res.ok) throw new CreativeError(json.error?.status ?? 'intake-failed', json.error?.message ?? `The text model returned ${res.status}.`);
  recordUsage('Creative intake', model, json.usageMetadata);
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  return { interpretation: parseInterpretation(text, req), model, costInr: json.usageMetadata ? usageCostUsd(model, json.usageMetadata) * DEFAULT_USD_TO_INR : 0 };
}
```

(Fill the two `/* as in Interfaces above */` interface bodies verbatim from this task's Interfaces block.)

- [ ] **Step 4: Run the tests**

Run: `npm run build:shared && cd apps/api && npm run build && node --test --experimental-strip-types src/intake.test.ts; cd ../..`
Expected: PASS. If a prompt assertion fails, fix the prompt (not the test) so the catalogue lines carry the ids, labels and pixels exactly.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/intake.ts apps/api/src/intake.test.ts
git commit -m "$(printf 'The intake reads the brief and its images whole, and trusts nothing it cannot check\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>')"
```

---

### Task 5: The understand route, and the web client helper

**Files:**
- Modify: `apps/api/src/server.ts` (add the route beside `/api/creatives/copy`, ~line 4133)
- Modify: `apps/web/src/lib/creatives.ts` (mirror types + helper)

**Interfaces:**
- Consumes: Task 4's `understandBrief`, `UnderstandRequest`, `Interpretation`; server helpers `googleKey()`, `readObject`, `asJpeg`, `addToTotals`, `text()`, `STORED`.
- Produces:
  - Route `POST /api/creatives/understand`, body `{ projectId?: string; request?: UnderstandRequest-shaped; images?: Array<{ storagePath: string; label?: string }> }` → `{ interpretation, model }`; errors follow the sibling routes (`503 script-no-key`, `4xx/502 CreativeError`).
  - Web: `understandBrief(projectId, request, images)` in `apps/web/src/lib/creatives.ts`, plus exported mirror types `UnderstandRequest`, `Interpretation`, and `DesignRequest.reference` / `SceneRequest.match` mirrors, and `drawCreativeScene` gains an optional `match` argument.

- [ ] **Step 1: The route in `server.ts`**

```ts
/**
 * The intake reads a brief and its attached images together — what kind of post, the facts
 * already in the brief, what each image is — so the designer corrects a cheap interpretation
 * instead of paying for a wrong creative.
 */
app.post<{ Body: { projectId?: string; request?: unknown; images?: unknown } }>('/api/creatives/understand', async (req, reply) => {
  const key = await googleKey();
  if (!key) return reply.code(503).send({ code: 'script-no-key', message: 'Add a Google (Gemini) key in APIs & models first.' });
  const r = req.body?.request as Record<string, any> | undefined;
  const picked = (Array.isArray(req.body?.images) ? (req.body!.images as unknown[]) : [])
    .filter((p): p is { storagePath: string; label?: string } => typeof (p as any)?.storagePath === 'string' && STORED.test((p as any).storagePath))
    .slice(0, 4);
  const request = {
    brief: text(r?.brief, 2000),
    ...(text(r?.client?.name, 120) ? { client: { name: text(r?.client?.name, 120), ...(text(r?.client?.brand, 60) ? { brand: text(r?.client?.brand, 60) } : {}) } } : {}),
    vehicles: (Array.isArray(r?.vehicles) ? r!.vehicles : [])
      .map((v: any) => ({ id: text(v?.id, 60), name: text(v?.name, 80) }))
      .filter((v: { id: string; name: string }) => v.id && v.name)
      .slice(0, 60),
    languages: (Array.isArray(r?.languages) ? r!.languages : [])
      .map((l: any) => ({ id: text(l?.id, 20), name: text(l?.name, 40) }))
      .filter((l: { id: string; name: string }) => l.id && l.name)
      .slice(0, 20),
    images: picked.map((p) => ({ ...(text(p.label, 120) ? { label: text(p.label, 120) } : {}) })),
  };
  if (!request.brief && !picked.length) return reply.code(400).send({ code: 'bad-request', message: 'Write the brief, or attach an image, first.' });
  const images: Array<{ bytes: Buffer; mimeType: string }> = [];
  for (const p of picked) {
    const o = await readObject(p.storagePath).catch(() => null);
    const bytes = o ? await asJpeg(o.bytes).catch(() => null) : null;
    if (bytes) images.push({ bytes, mimeType: 'image/jpeg' });
  }
  try {
    const out = await understandBrief(request, images, key);
    const projectId = req.body?.projectId;
    if (typeof projectId === 'string' && projectId) void addToTotals('imageProjects', projectId, out.costInr).catch(() => {});
    return { interpretation: out.interpretation, model: out.model };
  } catch (err) {
    const e = err as CreativeError;
    app.log.warn({ code: e.code, message: e.message }, 'creative intake failed');
    return reply.code(e.status && e.status >= 400 ? e.status : 502).send({ code: e.code ?? 'intake-failed', message: e.message });
  }
});
```

Add `understandBrief` to the `./intake.js` import block (create the import — `import { understandBrief } from './intake.js';`).

- [ ] **Step 2: The web mirrors in `apps/web/src/lib/creatives.ts`**

Add to `DesignRequest`:

```ts
  /** An image the design builds from — see the server's DesignReferenceKind. */
  reference?: { storagePath: string; kind: 'style' | 'master' | 'base-photo'; changes?: string };
```

Add to `SceneRequest`: `match?: boolean;` (set by the server; the web sends the master separately).

Change `drawCreativeScene` to carry the master:

```ts
export const drawCreativeScene = (projectId: string, scene: SceneRequest, photos: Array<{ storagePath: string; label: string }>, match?: { storagePath: string }) =>
  post<{ image: StoredImage; check: { same: boolean; checked: boolean; why?: string }; model: string }>('/api/creatives/scene', {
    projectId,
    scene,
    photos,
    ...(match ? { match } : {}),
  });
```

Append the intake types and helper (mirror `Interpretation` field-for-field from Task 4, importing `CreativeCopy`, `ImageRole`, `ReferenceIntent` from `@ava/shared`):

```ts
/** What the intake is given to read. */
export interface UnderstandRequest {
  brief: string;
  client?: { name: string; brand?: string };
  vehicles: Array<{ id: string; name: string }>;
  languages: Array<{ id: string; name: string }>;
  images: Array<{ label?: string }>;
}

/** What the intake understood — everything already checked against what the app knows. */
export interface Interpretation {
  engine: { primary: CreativeEngineId; secondary?: CreativeEngineId; ratio?: string };
  heard: string[];
  confidence: 'high' | 'low';
  occasion?: string;
  carId?: string;
  colour?: string;
  facts: Record<string, string>;
  languageId?: string;
  sizes?: CreativeFormatId[];
  sceneNote?: string;
  images: Array<{ index: number; role: ImageRole; note?: string }>;
  referenceIntent?: ReferenceIntent;
  changes?: string;
  copy?: CreativeCopy;
}

export const understandBrief = (projectId: string, request: UnderstandRequest, images: Array<{ storagePath: string; label?: string }>) =>
  post<{ interpretation: Interpretation; model: string }>('/api/creatives/understand', { projectId, request, images });
```

- [ ] **Step 3: Build everything**

Run: `npm run build:shared && npm run test --workspace @ava/api && npm run typecheck --workspace @ava/web`
Expected: PASS / clean.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/server.ts apps/web/src/lib/creatives.ts
git commit -m "$(printf 'One route reads the brief; the web can ask and hand the design its reference\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>')"
```

---

### Task 6: The reference reaches the design calls from the editor

**Files:**
- Modify: `apps/web/src/sections/ImageProjectEditor.tsx`

**Interfaces:**
- Consumes: Task 1's `PROOF_FORMAT`, `AttachedPhoto`, project `reference`; Task 5's `DesignRequest.reference` mirror and `drawCreativeScene(..., match)`.
- Produces (Task 7's intake screen calls these exact functions via props):
  - `writeCopy(): Promise<CreativeCopy | null>` — now returns the written copy (null on failure).
  - `designBrief(format, copyOverride?: CreativeCopy): DesignRequest` — words come from the override when given.
  - `designReference(purpose: 'proof' | 'fanout'): DesignRequest['reference'] | undefined`
  - `makeDesigns(only?: CreativeFormatId[], opts?: { copy?: CreativeCopy; purpose?: 'proof' | 'fanout' }): Promise<void>`
  - `makeProof(): Promise<void>` — writes copy if none, then designs `PROOF_FORMAT` with the proof reference.
  - `makeAllSizes(): Promise<void>` — designs every chosen format not yet made (proof excluded when not chosen), master reference = the proof design (or the uploaded original when `reference.intent === 'sizes'`); strip scenes get the same master via `match`.

- [ ] **Step 1: `writeCopy` returns the copy**

Change the tail of `writeCopy` from `setCopy(r.copy);` to:

```ts
    if (isApiError(r)) {
      setError(r.message);
      return null;
    }
    setCopy(r.copy);
    return r.copy;
```

and its signature to `const writeCopy = async (): Promise<CreativeCopy | null> => {` (the early `if (!client)` return becomes `{ setError(...); return null; }`).

- [ ] **Step 2: Thread a copy override through the brief builders**

`inputFor` and `designBrief` gain an optional copy:

```ts
  const inputFor = (format: CreativeFormatId, c: CreativeCopy = copy): LayoutInput => ({ ...same, copy: c, ... });
  const designBrief = (format: CreativeFormatId, c: CreativeCopy = copy): DesignRequest => {
    const input = inputFor(format, c);
    ...
    words: designWordsOf(c, input),
```

(`uploadCanvas` and `autoDoc` keep calling `inputFor(format)` — unchanged behaviour.)

- [ ] **Step 3: The reference chooser**

Add beside `carRefList`:

```ts
  /** The image a design builds from: the uploaded original as master (other sizes), the proof as master (fan-out), an old creative as style, or a moment photo as the base. */
  const designReference = (purpose: 'proof' | 'fanout'): DesignRequest['reference'] | undefined => {
    if (p.reference?.intent === 'sizes') return { storagePath: p.reference.image.storagePath, kind: 'master' };
    if (purpose === 'fanout') {
      const proof = p.designs?.[PROOF_FORMAT];
      if (proof) return { storagePath: proof.image.storagePath, kind: 'master' };
    }
    if (p.reference) return { storagePath: p.reference.image.storagePath, kind: 'style', ...(p.reference.changes ? { changes: p.reference.changes } : {}) };
    const moment = (p.attachedPhotos ?? []).find((a) => a.role === 'moment');
    if (moment) return { storagePath: moment.storagePath, kind: 'base-photo' };
    return undefined;
  };
```

And keep non-vehicle images out of the car references — in `carRefList`, where attached photos are used, filter first:

```ts
    const attachable = (p.attachedPhotos ?? []).filter((x) => !x.role || x.role === 'vehicle' || x.role === 'moment');
```

…using `attachable` in place of `p.attachedPhotos ?? []` in the no-`car` branch, but excluding `moment` from car refs when a moment photo is the base (it already travels as the reference): `.filter((x) => x.role !== 'moment' || !designReference('proof') || designReference('proof')?.kind !== 'base-photo')` is convoluted — simpler and correct: exclude `creative` and `logo` roles only; a moment photo may serve as a car reference when it is also the hero. Final:

```ts
    const attachable = (p.attachedPhotos ?? []).filter((x) => x.role !== 'creative' && x.role !== 'logo');
```

The `blockedBy` guard also relaxes: a moment photo or a base-photo reference counts as a photo. Change the `!p.heroPhoto` branch to first check `if (!p.heroPhoto && !designReference('proof'))` (keep the message text as is).

- [ ] **Step 4: `makeDesigns` carries reference and copy**

Signature: `const makeDesigns = async (only?: CreativeFormatId[], opts?: { copy?: CreativeCopy; purpose?: 'proof' | 'fanout' }): Promise<void> => {`.
Inside: `const c = opts?.copy ?? copy;` and `const reference = designReference(opts?.purpose ?? 'fanout');`

- the guard becomes `if (!p.heroPhoto && !reference) return setError('Pick the vehicle and its photo, or attach a photo of it, first.');`
- whole sizes: `const brief = { ...designBrief(format, c), ...(canvas ? { canvas: ... } : {}), ...(reference ? { reference } : {}) };`
- strip scenes: pass the master through the new argument — `drawCreativeScene(p.id, { ...sceneReq }, refs, reference?.kind === 'master' ? { storagePath: reference.storagePath } : undefined)`.

`reviseDesign`'s brief keeps working (no reference on a revision — the current image already is one).

- [ ] **Step 5: `makeProof` and `makeAllSizes`**

```ts
  /** The proof: the words written if they have not been, then the square designed with the reference. */
  const makeProof = async (): Promise<void> => {
    let c: CreativeCopy | null = p.copy ?? null;
    if (!c) c = await writeCopy();
    if (!c) return; // writeCopy set the error
    await makeDesigns([PROOF_FORMAT], { copy: c, purpose: 'proof' });
  };

  /** Every chosen size not made yet, in the proof's image. */
  const makeAllSizes = async (): Promise<void> => {
    const todo = p.formats.filter((f) => !madeFor(f));
    if (todo.length) await makeDesigns(todo, { purpose: 'fanout' });
  };
```

(`madeFor` already exists. Note `makeProof` runs even when `PROOF_FORMAT` is not in `p.formats` — `makeDesigns` takes explicit formats, and `adoptDesign` stores under `designs['ig-square']` regardless; the proof design simply is not listed among the output creatives unless chosen.)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck --workspace @ava/web`
Expected: clean. (`makeProof`/`makeAllSizes` may be unused until Task 7 — if `noUnusedLocals` complains, wire them into Task 7 within the same commit series by referencing them in a temporary `void makeProof;` is NOT allowed; instead simply proceed to Task 7 before committing if the typecheck fails on unused locals. If the config does not flag unused locals, commit now.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/sections/ImageProjectEditor.tsx
git commit -m "$(printf 'The editor knows what a design builds from: a proof, a master, or a moment\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>')"
```

---

### Task 7: The intake screen and plan card (`ImageIntake.tsx`)

**Files:**
- Create: `apps/web/src/sections/ImageIntake.tsx`
- Modify: `apps/web/src/sections/ImageProjectEditor.tsx` (render it; pass props; the understand action)
- Modify: `apps/web/src/styles.css` (intake styles)

**Interfaces:**
- Consumes: Task 5's `understandBrief` web helper + `Interpretation`; Task 6's `makeProof`, `makeAllSizes`, `reviseDesign`, `designState`, `changes`/`setChanges`; shared `showIntake`, `PROOF_FORMAT`, `CREATIVE_ENGINES`, `CREATIVE_FORMATS`, `classifyCreative`, `occasionIn`, `AttachedPhoto`, `ImageRole`, `ReferenceIntent`.
- Produces: `export function ImageIntake(props: ImageIntakeProps)` with:

```ts
export interface ImageIntakeProps {
  p: ImageProject;
  set: (patch: Partial<ImageProject> | ((cur: ImageProject) => Partial<ImageProject>)) => void;
  clients: ClientProfile[];
  vehicleChoices: CarModelProfile[];
  languageChoices: Array<{ id: string; name: string }>;
  canCreate: boolean;
  readOnly: boolean;
  busy: string;
  error: string;
  clearError: () => void;
  understanding: boolean;
  onUnderstand: () => Promise<void>;
  onProof: () => Promise<void>;
  onAllSizes: () => Promise<void>;
  onRevise: (change: string) => Promise<void>;
  onSkip: () => void;
  proofState?: 'working' | 'failed';
  proof?: DesignedCreative;
  allCost: string;   // "about ₹36" — computed by the editor
  sizesTodo: number; // how many the fan-out will make
}
```

- [ ] **Step 1: The understand action in the editor**

In `ImageProjectEditor`, add state `const [understanding, setUnderstanding] = useState(false);` and:

```ts
  /** One cheap call reads the brief and the images; its answer fills only what a human has not. */
  const understand = async (): Promise<void> => {
    setUnderstanding(true);
    setError('');
    const imgs = (p.attachedPhotos ?? []).slice(0, 4).map((x) => ({ storagePath: x.storagePath, ...(x.label ? { label: x.label } : {}) }));
    const r = await understandBrief(p.id, {
      brief: p.prompt,
      ...(client ? { client: { name: client.displayName || client.name, ...(client.brand ? { brand: client.brand } : {}) } } : {}),
      vehicles: vehicleChoices.map((c) => ({ id: c.id, name: `${c.brand} ${c.model}` })),
      languages: languageChoices.map((l) => ({ id: l.id, name: l.name })),
      images: imgs.map((x) => ({ ...(x.label ? { label: x.label } : {}) })),
    }, imgs);
    setUnderstanding(false);
    if (isApiError(r)) {
      // The model could not be reached: the keyword classifier stands in, marked so.
      const read = classifyCreative(p.prompt);
      const found = occasionIn(p.prompt);
      set((cur) => ({
        ...(read && !cur.engine?.manual ? { engine: { primary: read.primary, secondary: read.secondary, ratio: read.ratio } } : {}),
        ...(found && !cur.facts.occasion ? { facts: { ...cur.facts, occasion: found } } : {}),
        intake: { at: Date.now(), heard: read?.heard ?? [], confidence: 'low', fallback: true },
      }));
      setError(r.message);
      return;
    }
    const it = r.interpretation;
    set((cur) => {
      const facts = { ...cur.facts };
      for (const [k, v] of Object.entries(it.facts)) if (!(facts[k] ?? '').trim()) facts[k] = v; // never over a human
      const attached = (cur.attachedPhotos ?? []).map((ph, i) => {
        const role = it.images.find((im) => im.index === i)?.role;
        return role ? { ...ph, role } : ph;
      });
      const creativeRef = attached.find((ph) => ph.role === 'creative');
      const hero = cur.heroPhoto ?? attached.find((ph) => ph.role === 'vehicle' || ph.role === 'moment');
      return {
        ...(cur.engine?.manual ? {} : { engine: { primary: it.engine.primary, secondary: it.engine.secondary, ratio: it.engine.ratio } }),
        facts: it.occasion && !(facts.occasion ?? '').trim() ? { ...facts, occasion: it.occasion } : facts,
        ...(it.carId && !cur.carId ? { carId: it.carId } : {}),
        ...(it.colour && !cur.carColour ? { carColour: it.colour } : {}),
        ...(it.languageId && !cur.languageId ? { languageId: it.languageId } : {}),
        ...(it.sizes?.length ? { formats: CREATIVE_FORMATS.map((f) => f.id).filter((id) => it.sizes!.includes(id)) } : {}),
        ...(it.sceneNote && !cur.sceneNote ? { sceneNote: it.sceneNote } : {}),
        ...(it.copy && !cur.copy ? { copy: it.copy } : {}),
        attachedPhotos: attached,
        ...(hero && !cur.heroPhoto ? { heroPhoto: hero } : {}),
        ...(creativeRef
          ? { reference: { image: creativeRef, intent: it.referenceIntent ?? 'recreate', ...(it.changes ? { changes: it.changes } : {}) } }
          : {}),
        intake: { at: Date.now(), heard: it.heard, confidence: it.confidence, model: r.model },
      };
    });
  };
```

- [ ] **Step 2: Render intake instead of the workspace**

In `ImageProjectEditor`, after the `if (!p)` guard:

```ts
  const [view, setView] = useState<'auto' | 'work'>('auto');
  const intakeOpen = view === 'auto' && showIntake(p);
```

Where the page returns, branch:

```tsx
  if (intakeOpen) {
    return (
      <ImageIntake
        p={p} set={set} clients={clients} vehicleChoices={vehicleChoices} languageChoices={languageChoices}
        canCreate={canCreate} readOnly={readOnly} busy={busy} error={error} clearError={() => setError('')}
        understanding={understanding} onUnderstand={understand} onProof={makeProof} onAllSizes={makeAllSizes}
        onRevise={async (change) => { setChanges((c) => ({ ...c, [PROOF_FORMAT]: change })); await reviseDesign(PROOF_FORMAT); }}
        onSkip={() => setView('work')}
        proofState={designState[PROOF_FORMAT]} proof={p.designs?.[PROOF_FORMAT]}
        allCost={`about ₹${p.formats.filter((f) => !madeFor(f)).length * 10}`}
        sizesTodo={p.formats.filter((f) => !madeFor(f)).length}
      />
    );
  }
```

Wait — `reviseDesign(PROOF_FORMAT)` reads `changes[PROOF_FORMAT]` from state set in the same tick; state is stale. Change `reviseDesign` (Task 6's file) to accept the change directly: `const reviseDesign = async (format: CreativeFormatId, changeText?: string): Promise<void> => { const change = (changeText ?? changes[format])?.trim(); ... }` — then `onRevise={(change) => reviseDesign(PROOF_FORMAT, change)}`. The workspace call sites stay `reviseDesign(format)`.

The proof stays visible on the intake because `showIntake` turns false once a design exists — so after the proof lands the branch flips to the workspace. That is wrong for the proof loop: the designer should see the proof ON the intake with "Make all sizes". Fix `intakeOpen`:

```ts
  const proofOnly = Object.keys(p.designs ?? {}).every((f) => f === PROOF_FORMAT) && !p.creatives.length && !Object.keys(p.pictures ?? {}).length;
  const intakeOpen = view === 'auto' && (showIntake(p) || proofOnly);
```

`onAllSizes` then flips to the workspace when done: in the prop, `onAllSizes={async () => { await makeAllSizes(); setView('work'); }}`.

- [ ] **Step 3: Write `ImageIntake.tsx`**

The component (full file — brief + drop zone; after `p.intake` exists, the plan card; after `proof`, the proof panel):

```tsx
import { useState } from 'react';
import {
  CREATIVE_ENGINES, CREATIVE_ENGINE_BY_ID, CREATIVE_FORMATS, PROOF_FORMAT, occasionIn,
  type AttachedPhoto, type CarModelProfile, type ClientProfile, type CreativeEngineId, type CreativeFormatId,
  type DesignedCreative, type ImageProject, type ImageRole, type ReferenceIntent,
} from '@ava/shared';
import { refUrl } from '../lib/api.js';
import { Banner, Field, ImageUpload } from '../components/ui.js';

const ROLE_LABEL: Record<ImageRole, string> = { vehicle: 'Vehicle photo', creative: 'Finished creative', moment: 'Moment photo', logo: 'Logo' };
const ROLE_ORDER: ImageRole[] = ['vehicle', 'creative', 'moment', 'logo'];
const INTENT_LABEL: Record<ReferenceIntent, string> = { recreate: 'Recreate it', edit: 'Change elements', sizes: 'Other sizes of it' };

export interface ImageIntakeProps { /* verbatim from this task's Interfaces block */ }

export function ImageIntake({ p, set, clients, vehicleChoices, languageChoices, canCreate, readOnly, busy, error, clearError, understanding, onUnderstand, onProof, onAllSizes, onRevise, onSkip, proofState, proof, allCost, sizesTodo }: ImageIntakeProps) {
  const [change, setChange] = useState('');
  const engine = CREATIVE_ENGINE_BY_ID[p.engine?.primary ?? 'feature'];
  const second = p.engine?.secondary ? CREATIVE_ENGINE_BY_ID[p.engine.secondary] : undefined;
  const occasion = p.facts.occasion || occasionIn(p.prompt) || undefined;
  const fields = [...engine.fields, ...(second?.fields ?? []).filter((f) => !engine.fields.some((g) => g.id === f.id))];
  const missing = engine.mandatory.filter((id) => !(p.facts[id] ?? '').trim());
  const read = Boolean(p.intake);
  const sizesIntent = p.reference?.intent === 'sizes';
  const canRead = !readOnly && canCreate && !understanding && (p.prompt.trim().length > 0 || (p.attachedPhotos ?? []).length > 0);
  const canProve = read && canCreate && !readOnly && busy === '' && proofState !== 'working' && !missing.length && !(p.engine == null);
  const setRole = (ph: AttachedPhoto, role: ImageRole): void =>
    set((cur) => {
      const attachedPhotos = (cur.attachedPhotos ?? []).map((x) => (x.storagePath === ph.storagePath ? { ...x, role } : x));
      const creative = attachedPhotos.find((x) => x.role === 'creative');
      return {
        attachedPhotos,
        reference: creative ? { image: creative, intent: cur.reference?.intent ?? 'recreate', changes: cur.reference?.changes } : undefined,
      };
    });

  return (
    <div className="editor-page ip-page">
      {error && (
        <Banner kind="bad">
          {error}{' '}
          <button type="button" className="btn ghost small" onClick={clearError}>Dismiss</button>
        </Banner>
      )}
      <div className="intake">
        <div className="intake-head">
          <h2>What are we making?</h2>
          <button type="button" className="btn ghost small" onClick={onSkip}>Skip to the workspace</button>
        </div>
        <Field label="Client">
          <select value={p.clientId ?? ''} onChange={(e) => set({ clientId: e.target.value || undefined, carId: undefined, heroPhoto: undefined })} disabled={readOnly}>
            <option value="">Pick a client</option>
            {clients.map((c) => (<option key={c.id} value={c.id}>{c.displayName || c.name}</option>))}
          </select>
        </Field>
        <Field label="The brief" hint="In your words — “Delivery creative for the customers attached” or “Diwali offer on the Creta, benefits up to ₹50,000”.">
          <textarea rows={3} value={p.prompt} onChange={(e) => set({ prompt: e.target.value })} readOnly={readOnly} placeholder="Delivery creative for the customers attached" />
        </Field>
        <div className="intake-photos">
          {(p.attachedPhotos ?? []).map((ph) => (
            <div key={ph.storagePath} className="intake-photo">
              <img src={refUrl(ph.storagePath)} alt={ph.label || 'Attached image'} loading="lazy" crossOrigin="anonymous" />
              {read && (
                <select value={ph.role ?? 'vehicle'} onChange={(e) => setRole(ph, e.target.value as ImageRole)} aria-label="What this image is" disabled={readOnly}>
                  {ROLE_ORDER.map((r) => (<option key={r} value={r}>{ROLE_LABEL[r]}</option>))}
                </select>
              )}
            </div>
          ))}
          {!readOnly && (
            <ImageUpload label="Reference image" kind="car-model" buttonText="Attach images"
              onUploaded={(img) => set((cur) => ({ attachedPhotos: [...(cur.attachedPhotos ?? []), img] }))} />
          )}
        </div>
        <div className="ip-actions">
          <button type="button" className="btn primary" disabled={!canRead} onClick={() => void onUnderstand()}>
            {understanding ? 'Reading…' : read ? 'Read it again' : 'Read the brief'}
          </button>
          <span className="hint">One cheap read (about ₹1) before anything is paid for.</span>
        </div>

        {read && (
          <div className="intake-plan">
            <div className="ip-engine">
              <span className="ip-label">Kind of post</span>
              <span className="chip on">{engine.label}</span>
              {second && (<><span className="ip-plus">+</span><span className="chip on">{second.label}</span><span className="hint">{p.engine?.ratio}</span></>)}
              {p.intake?.fallback ? <span className="hint">read without the model</span> : p.intake?.confidence === 'low' ? <span className="hint">not sure — check it</span> : null}
            </div>
            {p.intake!.heard.length > 0 && <p className="hint">Heard: {p.intake!.heard.map((h) => `“${h}”`).join(', ')}</p>}
            <div className="row2">
              <Field label="Lead">
                <select value={engine.id} onChange={(e) => set({ engine: { primary: e.target.value as CreativeEngineId, secondary: p.engine?.secondary === e.target.value ? undefined : p.engine?.secondary, ratio: p.engine?.ratio, manual: true } })} disabled={readOnly}>
                  {CREATIVE_ENGINES.map((x) => (<option key={x.id} value={x.id}>{x.code} · {x.label}</option>))}
                </select>
              </Field>
              <Field label="Vehicle">
                <select value={p.carId ?? ''} onChange={(e) => set({ carId: e.target.value || undefined, carColour: undefined })} disabled={readOnly}>
                  <option value="">{(p.attachedPhotos ?? []).some((x) => x.role === 'vehicle' || x.role === 'moment') ? 'From the photograph' : 'No particular vehicle'}</option>
                  {vehicleChoices.map((c) => (<option key={c.id} value={c.id}>{c.brand} {c.model}</option>))}
                </select>
              </Field>
            </div>
            {fields.map((f) => {
              const v = p.facts[f.id] ?? (f.id === 'occasion' ? occasion ?? '' : '');
              const need = engine.mandatory.includes(f.id);
              return (
                <Field key={f.id} label={`${f.label}${need ? ' *' : ''}`} hint={f.hint}>
                  {f.type === 'select' ? (
                    <select value={v} onChange={(e) => set((cur) => ({ facts: { ...cur.facts, [f.id]: e.target.value } }))} disabled={readOnly}>
                      <option value="">Pick one</option>
                      {(f.options ?? []).map((o) => (<option key={o} value={o}>{o}</option>))}
                    </select>
                  ) : f.type === 'list' || f.type === 'textarea' ? (
                    <textarea rows={3} value={v} placeholder={f.placeholder} onChange={(e) => set((cur) => ({ facts: { ...cur.facts, [f.id]: e.target.value } }))} readOnly={readOnly} />
                  ) : (
                    <input value={v} placeholder={f.placeholder} onChange={(e) => set((cur) => ({ facts: { ...cur.facts, [f.id]: e.target.value } }))} readOnly={readOnly} />
                  )}
                </Field>
              );
            })}
            {p.reference && (
              <div className="row2">
                <Field label="The attached creative">
                  <select value={p.reference.intent} onChange={(e) => set((cur) => ({ reference: cur.reference ? { ...cur.reference, intent: e.target.value as ReferenceIntent } : undefined }))} disabled={readOnly}>
                    {(Object.keys(INTENT_LABEL) as ReferenceIntent[]).map((i) => (<option key={i} value={i}>{INTENT_LABEL[i]}</option>))}
                  </select>
                </Field>
                <Field label="What changes" hint="Only with “Change elements”.">
                  <input value={p.reference.changes ?? ''} onChange={(e) => set((cur) => ({ reference: cur.reference ? { ...cur.reference, changes: e.target.value || undefined } : undefined }))} readOnly={readOnly} />
                </Field>
              </div>
            )}
            {(p.attachedPhotos ?? []).some((x) => x.role === 'logo') && (
              <p className="hint">A logo travels with the client, not the project — add it in Clients; this one is left out of the creative.</p>
            )}
            <Field label="Sizes">
              <div className="intake-sizes">
                {CREATIVE_FORMATS.map((f) => {
                  const on = p.formats.includes(f.id);
                  return (
                    <label key={f.id} className={`chip${on ? ' on' : ''}`}>
                      <input type="checkbox" checked={on} disabled={readOnly}
                        onChange={(e) => set((cur) => ({ formats: e.target.checked ? CREATIVE_FORMATS.map((x) => x.id).filter((id) => id === f.id || cur.formats.includes(id)) : cur.formats.filter((id) => id !== f.id) }))} />
                      {f.label}
                    </label>
                  );
                })}
              </div>
            </Field>
            <div className="row2">
              <Field label="Words on the picture in">
                <select value={p.languageId ?? 'en'} onChange={(e) => set({ languageId: e.target.value })} disabled={readOnly}>
                  {languageChoices.map((l) => (<option key={l.id} value={l.id}>{l.name}</option>))}
                </select>
              </Field>
            </div>
            {missing.length > 0 && <p className="hint ip-blocked">{missing.map((id) => engine.fields.find((f) => f.id === id)?.label ?? id).join(', ')} still to fill — the proof needs {missing.length === 1 ? 'it' : 'them'}.</p>}
            <div className="ip-actions">
              {sizesIntent ? (
                <button type="button" className="btn primary" disabled={!canProve || !p.formats.length} onClick={() => void onAllSizes()}>
                  {busy === 'design' ? 'Making…' : `Make the ${sizesTodo} size${sizesTodo === 1 ? '' : 's'} · ${allCost}`}
                </button>
              ) : (
                <button type="button" className="btn primary" disabled={!canProve} onClick={() => void onProof()}>
                  {proofState === 'working' || busy !== '' ? 'Making the proof…' : 'Make the proof · 1:1 · about ₹10'}
                </button>
              )}
              <span className="hint">{sizesIntent ? 'The attached creative is the master — every size is made in its image.' : 'One square first; the rest only when it is right.'}</span>
            </div>
          </div>
        )}

        {proof && !sizesIntent && (
          <div className="intake-proof">
            <img src={refUrl(proof.image.storagePath)} alt="The proof creative" crossOrigin="anonymous" />
            <div className="intake-proof-side">
              <span className={`ip-check ${proof.checks.words.checked ? (proof.checks.words.ok ? 'ok' : 'bad') : ''}`}>
                {proof.checks.words.checked ? (proof.checks.words.ok ? 'Words ✓' : 'Words to check') : 'Words not checked'}
              </span>
              <span className={`ip-check ${proof.checks.vehicle.checked ? (proof.checks.vehicle.same ? 'ok' : 'bad') : ''}`}>
                {proof.checks.vehicle.checked ? (proof.checks.vehicle.same ? 'Same vehicle ✓' : 'Vehicle may differ') : 'Vehicle not checked'}
              </span>
              <button type="button" className="btn primary" disabled={busy !== '' || proofState === 'working' || !sizesTodo} onClick={() => void onAllSizes()}>
                {busy === 'design' ? 'Making…' : `Looks right — make all sizes · ${allCost}`}
              </button>
              <form className="ip-ask" onSubmit={(e) => { e.preventDefault(); if (change.trim()) { void onRevise(change.trim()); setChange(''); } }}>
                <input value={change} onChange={(e) => setChange(e.target.value)} placeholder="Ask for a change — “make the headline gold”" maxLength={400} />
                <button type="submit" className="btn small" disabled={!change.trim() || proofState === 'working' || busy !== ''}>Ask</button>
              </form>
              <button type="button" className="btn ghost small" disabled={busy !== '' || proofState === 'working'} onClick={() => void onProof()}>Make it again</button>
            </div>
          </div>
        )}
        {proofState === 'failed' && <p className="hint ip-blocked">The proof failed — the error above says why. Fix it and try again.</p>}
      </div>
    </div>
  );
}
```

(Fill `ImageIntakeProps` verbatim from the Interfaces block. `onProof` when a proof already exists makes it again — `makeDesigns([PROOF_FORMAT])` overwrites `designs['ig-square']` via `adoptDesign`.)

- [ ] **Step 4: Styles**

Append to `apps/web/src/styles.css` (match the file's existing variables and spacing conventions — read the `ip-` block first and reuse its tokens):

```css
/* ---- the intake ---- */
.intake { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
.intake-head { display: flex; align-items: baseline; justify-content: space-between; }
.intake-photos { display: flex; flex-wrap: wrap; gap: 10px; }
.intake-photo { width: 132px; display: flex; flex-direction: column; gap: 4px; }
.intake-photo img { width: 100%; height: 96px; object-fit: cover; border-radius: 8px; }
.intake-plan { display: flex; flex-direction: column; gap: 12px; border-top: 1px solid var(--line, #2223); padding-top: 14px; }
.intake-sizes { display: flex; flex-wrap: wrap; gap: 6px; }
.intake-proof { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 14px; align-items: start; }
.intake-proof img { width: 100%; border-radius: 10px; }
.intake-proof-side { display: flex; flex-direction: column; gap: 10px; }
@media (max-width: 760px) { .intake-proof { grid-template-columns: 1fr; } }
```

(If `--line` does not exist in the file, use the border colour the `ip-` rules use.)

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck --workspace @ava/web && npm run build --workspace @ava/web`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/sections/ImageIntake.tsx apps/web/src/sections/ImageProjectEditor.tsx apps/web/src/styles.css
git commit -m "$(printf 'A new creative starts as a conversation: read cheap, correct by hand, prove once\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>')"
```

---

### Task 8: The workspace remembers the intake

**Files:**
- Modify: `apps/web/src/sections/ImageProjectEditor.tsx`

**Interfaces:**
- Consumes: `p.intake`, `setView` from Task 7.
- Produces: a summary bar in the workspace; "Back to the intake" works from the workspace; new uploads in Section 02 default to no role (unchanged behaviour), and the Section 02 photo grid shows role labels when set.

- [ ] **Step 1: The summary bar**

In the workspace return, directly under the `.crumbs` div:

```tsx
      {p.intake && (
        <div className="ip-intake-bar">
          <span className="chip on">{engine.label}</span>
          {second && <span className="chip on">{second.label}</span>}
          {p.intake.heard.length > 0 && <span className="hint">heard {p.intake.heard.map((h) => `“${h}”`).join(', ')}</span>}
          {p.intake.fallback && <span className="hint">read without the model</span>}
          <button type="button" className="btn ghost small" onClick={() => setView('auto')} disabled={!showIntake(p) && !Object.keys(p.designs ?? {}).every((f) => f === PROOF_FORMAT)}>
            Back to the intake
          </button>
        </div>
      )}
```

Simplify the disabled condition to reuse the `proofOnly`/`intakeOpen` locals from Task 7 Step 2: `disabled={!(showIntake(p) || proofOnly)}` — the intake only makes sense before the fan-out.

Styles (append to `styles.css`):

```css
.ip-intake-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
```

- [ ] **Step 2: Role labels in Section 02**

In the photo grid button where `{ph.angle && <span>{ph.angle}</span>}` renders, extend:

```tsx
{(ph.angle || (ph as AttachedPhoto).role) && <span>{ph.angle ?? ROLE_LABEL_SHORT[(ph as AttachedPhoto).role!]}</span>}
```

with, near the top of the file:

```ts
const ROLE_LABEL_SHORT: Record<ImageRole, string> = { vehicle: 'vehicle', creative: 'creative', moment: 'moment', logo: 'logo' };
```

(Import `ImageRole` and `AttachedPhoto` types from `@ava/shared`.)

- [ ] **Step 3: Typecheck, build, commit**

Run: `npm run typecheck --workspace @ava/web && npm run build --workspace @ava/web`
Expected: clean.

```bash
git add apps/web/src/sections/ImageProjectEditor.tsx apps/web/src/styles.css
git commit -m "$(printf 'The workspace keeps what the intake heard, one line above the work\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>')"
```

---

### Task 9: Full verification

**Files:** none new.

- [ ] **Step 1: Everything builds, every test green**

Run: `npm run build && npm run test`
Expected: all workspaces build; shared and api test suites PASS. Paste the tail of the output into the task report — no summarising a failure away.

- [ ] **Step 2: The app runs**

Run the web + api dev servers the project's usual way and click through with no key configured:
1. New image project → intake shows (brief, drop zone, Read the brief).
2. Read the brief with only text → fallback path fills the engine from keywords, marked "read without the model".
3. An old project (any existing one with designs) → opens on the workspace, not the intake.
4. Skip to the workspace → the five sections work as before.

Expected: no console errors; the four behaviours as written.

- [ ] **Step 3: Commit anything the click-through fixed, then hand over**

Preview deploy (Cloud Run tag + Firebase channel) comes next, on the user's go-ahead — live only after they approve on preview, per the project rule. The end-to-end intelligent path (real understand call, proof, fan-out, reference workflows) needs the user's Gemini key and real images: hand the preview link to Santosh with the four scenarios to try — a text-only brief, a brief + car photo, a brief + old creative ("same but change X" and "other sizes"), and a delivery-moment photo.

---

## Self-review notes (already applied)

- Spec §2 named the route `/api/image-projects/:id/understand`; the plan uses `/api/creatives/understand` (sibling consistency) — recorded in Global Constraints.
- Spec §3 read the old creative's words via `readCreativeWords`; the plan reads them in the same understand call (`Interpretation.copy`) — one call, same outcome, cheaper.
- Spec §7 "first 4 by role priority" is unimplementable before roles exist; the plan sends the first 4 in attach order — recorded in Global Constraints.
- Type names used across tasks: `ImageRole`, `ReferenceIntent`, `AttachedPhoto`, `PROOF_FORMAT`, `showIntake` (Task 1) ← used in Tasks 4–8; `DesignReferenceKind`, `DesignRequest.reference`, `SceneRequest.match` (Task 2) ← used in Tasks 3, 5, 6; `understandBrief`/`Interpretation` (Task 4 api, Task 5 web) ← used in Task 7. Checked consistent.
