# Overlays as Editable Layers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a generated film in the video editor as clean footage plus editable caption, footer, logo and end-card layers, and export them back exactly.

**Architecture:** `composeFinal` records every overlay decision (`onLayers`) without changing its ffmpeg graph; a new `composeClean` writes the overlay-free footage from the same internals. The editor model gains layer clips (`EditProject` v2) built from those records; the preview shows server-drawn layer images; the export draws layers with the same drawing functions onto the clean footage and mixes the music bed at export time.

**Tech Stack:** TypeScript monorepo (npm workspaces), Fastify + Firestore + Cloud Storage (apps/api), ffmpeg + sharp (post-production), React + Vite (apps/web), node:test.

**Spec:** `docs/superpowers/specs/2026-09-17-editor-overlay-layers-design.md`

## Global Constraints

- A generated film must not change: `composeFinal`'s final ffmpeg arguments stay byte-identical to the golden record captured in Task 1.
- An untouched layer exports looking like the original composite: SSIM ≥ 0.97 between the original film and an untouched layered export (Task 8).
- Edits change that version only; nothing writes back to clients or projects.
- Clean footage: body only (no end card, no music, no overlays), crf 16, stored at `generations/<jobId>/clean.mp4`.
- Caption fades 0.28 s; end card fade-in 0.35 s; footer and logos have no fades (as today).
- Stacking order on export: captions, then logos, then footer, then free text.
- Layer image route `/api/edits/layer` is open to viewers; export, logo replacement and building layers stay creator-only.
- Viewer copy, labels and messages follow the app's voice: plain sentences, sentence case, no jargon.
- API tests that need ffmpeg skip when ffmpeg is absent (CI has none and runs only shared tests).
- Every commit ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Nothing is pushed to `origin main` (that publishes live); preview deploys only.

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/captionSpot.ts` (modify) | Caption spots, margins and spot geometry, shared by compositor and editor |
| `packages/shared/src/filmLayers.ts` (create) | `FilmLayers` record of a composed film's overlays |
| `packages/shared/src/edit.ts` (modify) | `EditProject` v2: layer clips, look, converter from `FilmLayers`, validation, snapping |
| `apps/api/src/post.ts` (modify) | Golden trace hook, `onLayers`, `logoStripLayout`, `composeClean`, `musicBedGraph`, exported drawers |
| `apps/api/src/layerDraw.ts` (create) | Draw one layer image (caption/footer/end card), scale a logo, fit a replacement logo |
| `apps/api/src/editOpen.ts` (create) | Pure decision: how a job opens in the editor |
| `apps/api/src/editRender.ts` (modify) | Export layered projects: look frame, end card clip, layer overlays, music bed |
| `apps/api/src/store.ts` (modify) | `JobRecord.layers`, `cleanStoragePath`, `editProject`; `uploadCleanCut` |
| `apps/api/src/server.ts` (modify) | Store layers at generate/refine; `/api/generations/:jobId/layers`; `/api/edits/layer`; `/api/edits/logo`; clean clip route; edit export saves `editProject` |
| `apps/api/src/testlib.ts` (create) | ffmpeg fixture builders for API tests (excluded from build) |
| `apps/api/src/*.test.ts` (create) | API tests (excluded from build) |
| `apps/web/src/lib/api.ts` (modify) | `editOpen`, `drawLayer`, `fitLogo` |
| `apps/web/src/components/editor/useLayerImages.ts` (create) | Fetch and cache layer images |
| `apps/web/src/components/editor/LayerStage.tsx` (create) | Layers in the preview: select, drag, resize, snap, nudge |
| `apps/web/src/components/editor/LayerPanel.tsx` (create) | Caption, footer, logo, end card and look panels |
| `apps/web/src/components/VideoEditor.tsx` (modify) | Open flow, data-driven rows, wiring of stage and panel |
| `apps/web/src/components/GenerationPanel.tsx` (modify) | Pass `sceneOverrides` to the editor |
| `apps/web/src/styles.css` (modify) | Layer bars, stage layers, guides, handles |

## Task order and dependencies

1 → 2 → 3 (shared, sequential) → 4 → 5 → 6 → 7 → 8 (API, sequential) → 9 → 10 → 11 → 12 (web, sequential) → 13 (verification and preview). Tasks 9–12 depend only on the contracts fixed in Tasks 3, 6 and 7.

---
### Task 1: API test harness and a golden record of the compositor's ffmpeg call

**Files:**
- Modify: `apps/api/package.json` (scripts)
- Modify: `apps/api/tsconfig.json` (exclude)
- Modify: `apps/api/src/post.ts` (final `run('ffmpeg', …)` in `composeFinal`)
- Create: `apps/api/src/testlib.ts`
- Create: `apps/api/src/post.test.ts`
- Create (generated): `apps/api/src/__golden__/compose-final-args.json`

**Interfaces:**
- Produces: `hasFfmpeg: boolean`, `fixtureSegments(): Buffer[]`, `fixtureBed(seconds?: number): Buffer`, `fixtureLogo(w, h, hex): Promise<Buffer>`, `fixtureOverlay(): Promise<BrandOverlay>`, `traceCompose(compose, overlay): Promise<string[]>` (normalised final ffmpeg args). Env hook `AVA_POST_TRACE=<file>` makes `composeFinal` write its final ffmpeg args as JSON.

- [ ] **Step 1: Add the test script and keep tests out of the build**

`apps/api/package.json` scripts gain:
```json
"test": "npm run build && node --test --experimental-strip-types src/*.test.ts"
```
`apps/api/tsconfig.json` exclude becomes:
```json
"exclude": ["dist", "node_modules", "src/**/*.test.ts", "src/testlib.ts"]
```

- [ ] **Step 2: Write the fixtures** — `apps/api/src/testlib.ts`
```ts
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { BrandOverlay } from '../dist/post.js';

export const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const ff = (args: string[]): void => void execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
const scratch = (): string => mkdtempSync(join(tmpdir(), 'ava-fixture-'));

/** Two 5 s portrait parts: a moving box for motion, a tone from 1.0 to 3.8 s where speech would be. */
export function fixtureSegments(): Buffer[] {
  const dir = scratch();
  return ['0x3a6ea5', '0xa5563a'].map((colour, i) => {
    const out = join(dir, `seg-${i}.mp4`);
    ff([
      '-f', 'lavfi', '-i', `color=c=${colour}:s=720x1280:r=30:d=5,drawbox=x='100+80*t':y=600:w=160:h=160:color=white:t=fill`,
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=5',
      '-af', "volume='if(between(t,1,3.8),1,0)':eval=frame",
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out,
    ]);
    return readFileSync(out);
  });
}

export function fixtureBed(seconds = 14): Buffer {
  const out = join(scratch(), 'bed.m4a');
  ff(['-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=44100:duration=${seconds}`, '-c:a', 'aac', out]);
  return readFileSync(out);
}

export async function fixtureLogo(w: number, h: number, hex: string): Promise<Buffer> {
  const pad = 20;
  return sharp({ create: { width: w + pad * 2, height: h + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: w, height: h, channels: 4, background: hex } }, left: pad, top: pad }])
    .png()
    .toBuffer();
}

export const FIXTURE_COLOURS = { panel: '#0f172a', text: '#ffffff', accent: '#38bdf8', card: '#0f172a', cardText: '#ffffff', cardMuted: '#cbd5e1' };

export async function fixtureOverlay(): Promise<BrandOverlay> {
  return {
    footerText: 'Garve Renault  ·  Pune  ·  97643 79764',
    dealerLogo: await fixtureLogo(300, 120, '#e11d48'),
    brandLogo: await fixtureLogo(160, 160, '#facc15'),
    logoPlacement: { brand: 'left', dealer: 'right' },
    theme: FIXTURE_COLOURS,
    cards: [
      { text: 'Happy Ganesh Chaturthi', part: 1, start: 1, end: 4, partSeconds: 5 },
      { text: 'Book your test drive', sub: 'Offer ends Sunday', part: 2, start: 1, end: 4, partSeconds: 5, position: 'bottom-right' },
    ],
    endCard: { lines: ['Garve Renault', 'Book your test drive today', 'Pune'], seconds: 3 },
    targetShortSide: 720,
    musicBed: fixtureBed(),
    musicLoudness: -20,
    musicDuckDb: -12,
    speed: 1.2,
    findPeople: async () => ({ faces: [{ x0: 0.4, y0: 0.2, x1: 0.62, y1: 0.4 }], bodies: [] }),
  };
}

/** The final ffmpeg arguments composeFinal used, with its temporary folder written as <dir>. */
export async function traceCompose(compose: (s: Buffer[], o: BrandOverlay) => Promise<Buffer>, overlay: BrandOverlay): Promise<string[]> {
  const file = join(scratch(), 'args.json');
  process.env.AVA_POST_TRACE = file;
  try {
    await compose(fixtureSegments(), overlay);
  } finally {
    delete process.env.AVA_POST_TRACE;
  }
  return (JSON.parse(readFileSync(file, 'utf8')) as string[]).map((a) => a.replace(/[^\s"',;=]*ava-post-[A-Za-z0-9]+/g, '<dir>'));
}
```

- [ ] **Step 3: Add the trace hook** — in `composeFinal`, replace the final `await run('ffmpeg', [ … ]);` with:
```ts
    const finalArgs = [
      '-v', 'error', '-y',
      ...clipInputs,
      ...inputs,
      '-filter_complex_threads', FF_THREADS,
      '-filter_complex', parts.join(';'),
      '-map', '[vout]',
      '-map', `[${audioOut}]`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-threads', FF_THREADS,
      '-c:a', 'aac', '-movflags', '+faststart',
      out,
    ];
    // Tests record the exact call, so a refactor can prove the film is built as before.
    if (process.env.AVA_POST_TRACE) await writeFile(process.env.AVA_POST_TRACE, JSON.stringify(finalArgs));
    await run('ffmpeg', finalArgs);
```

- [ ] **Step 4: Write the golden test** — `apps/api/src/post.test.ts`
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { composeFinal } from '../dist/post.js';
import { hasFfmpeg, fixtureOverlay, traceCompose } from './testlib.ts';

const GOLDEN = new URL('./__golden__/compose-final-args.json', import.meta.url);

test('a composed film is built with exactly the ffmpeg call it was before', { skip: !hasFfmpeg }, async () => {
  const args = await traceCompose(composeFinal, await fixtureOverlay());
  if (process.env.UPDATE_GOLDEN) {
    mkdirSync(new URL('./__golden__/', import.meta.url), { recursive: true });
    writeFileSync(GOLDEN, JSON.stringify(args, null, 1));
  }
  assert.deepEqual(args, JSON.parse(readFileSync(GOLDEN, 'utf8')));
});
```

- [ ] **Step 5: Capture the golden from today's code**

Run: `UPDATE_GOLDEN=1 npm test -w @ava/api`
Expected: PASS, and `apps/api/src/__golden__/compose-final-args.json` exists.

- [ ] **Step 6: Prove it is stable**

Run: `npm test -w @ava/api` twice.
Expected: PASS both times (no UPDATE_GOLDEN). If it fails, the fixture is not deterministic — fix the fixture, not the golden.

- [ ] **Step 7: Commit**
```bash
git add apps/api/package.json apps/api/tsconfig.json apps/api/src/post.ts apps/api/src/testlib.ts apps/api/src/post.test.ts apps/api/src/__golden__/compose-final-args.json
git commit -m "A golden record of how a film is composed, so the layers work cannot change one

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Caption geometry in shared

**Files:**
- Modify: `packages/shared/src/captionSpot.ts`
- Modify: `apps/api/src/post.ts` (remove local `CARD_SPOTS`, `CardSpot`, `isCardSpot`, `spotXY`; margin/logoBand)
- Test: `packages/shared/src/shared.test.ts`

**Interfaces:**
- Produces: `CAPTION_SPOTS` (readonly tuple, same order as today's `CARD_SPOTS`), `type CaptionSpot`, `isCaptionSpot(v): v is CaptionSpot`, `overlayMargins(W, H): { margin: number; logoBand: number }`, `captionSpotXY(spot, W, H, w, h, margin, footerH, logoBand): { x: number; y: number }`.

- [ ] **Step 1: Write the failing test** (append to `shared.test.ts`; add `captionSpotXY, overlayMargins, CAPTION_SPOTS` to the `@ava/shared` import)
```ts
test('a caption spot is the same place for the compositor and the editor', () => {
  assert.deepEqual(overlayMargins(720, 1280), { margin: 29, logoBand: 61 });
  assert.deepEqual([...CAPTION_SPOTS], ['bottom-left', 'bottom-right', 'top-left', 'top-right', 'middle-left', 'middle-right', 'bottom-center']);
  assert.deepEqual(captionSpotXY('bottom-left', 720, 1280, 300, 100, 29, 60, 61), { x: 29, y: 1091 });
  assert.deepEqual(captionSpotXY('top-right', 720, 1280, 300, 100, 29, 60, 61), { x: 391, y: 119 });
  assert.deepEqual(captionSpotXY('middle-left', 720, 1280, 300, 100, 29, 60, 61), { x: 29, y: 590 });
  assert.deepEqual(captionSpotXY('bottom-center', 720, 1280, 300, 100, 29, 60, 61), { x: 210, y: 1091 });
});
```

- [ ] **Step 2: Run it** — `npm test -w @ava/shared` → FAIL (`captionSpotXY` is not exported).

- [ ] **Step 3: Implement** — append to `captionSpot.ts`:
```ts
/** The places an Auto caption can take, in the order a tie goes. */
export const CAPTION_SPOTS = ['bottom-left', 'bottom-right', 'top-left', 'top-right', 'middle-left', 'middle-right', 'bottom-center'] as const;
export type CaptionSpot = (typeof CAPTION_SPOTS)[number];
export const isCaptionSpot = (v: unknown): v is CaptionSpot => (CAPTION_SPOTS as readonly string[]).includes(v as string);

/** How far overlays sit off the frame's edges, and the band the corner logos take. */
export function overlayMargins(W: number, H: number): { margin: number; logoBand: number } {
  const S = Math.min(W, H);
  return { margin: Math.round(S * 0.04), logoBand: Math.round(S * 0.085) };
}

/** A caption's top-left corner at a spot: above the footer strip, below the logos, inside the margin. */
export function captionSpotXY(
  spot: CaptionSpot, W: number, H: number, w: number, h: number, margin: number, footerH: number, logoBand: number,
): { x: number; y: number } {
  const [row, col] = spot.split('-') as [string, string];
  const x = col === 'left' ? margin : col === 'right' ? W - w - margin : Math.round((W - w) / 2);
  const bottom = Math.max(margin, H - footerH - margin - h);
  const top = Math.min(bottom, margin + logoBand + margin);
  const y = row === 'bottom' ? bottom : row === 'top' ? top : Math.round(Math.min(Math.max(top, (H - h) / 2), bottom));
  return { x: Math.max(0, x), y: Math.max(0, y) };
}
```
In `post.ts`: import `{ CAPTION_SPOTS, isCaptionSpot, captionSpotXY, overlayMargins, type CaptionSpot }` from `@ava/shared`; delete the local `CARD_SPOTS`, `CardSpot`, `isCardSpot` and `spotXY` definitions and add in their place:
```ts
const CARD_SPOTS = CAPTION_SPOTS;
type CardSpot = CaptionSpot;
const isCardSpot = isCaptionSpot;
const spotXY = captionSpotXY;
```
In `composeFinal`, replace
```ts
    const margin = Math.round(shortSide(W, H) * 0.04);
    const logoBand = Math.round(shortSide(W, H) * LOGO_BOX.h);
```
with `const { margin, logoBand } = overlayMargins(W, H);`

- [ ] **Step 4: Run everything** — `npm test -w @ava/shared` → PASS; `npm test -w @ava/api` → PASS (golden unchanged); `npx tsc --noEmit -p apps/api/tsconfig.json` → clean.

- [ ] **Step 5: Commit**
```bash
git add packages/shared/src/captionSpot.ts packages/shared/src/shared.test.ts apps/api/src/post.ts
git commit -m "Where a caption goes, worked out in one place for the compositor and the editor

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 3: FilmLayers and the v2 editor model

**Files:**
- Create: `packages/shared/src/filmLayers.ts`
- Modify: `packages/shared/src/edit.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './filmLayers.js';`)
- Test: `packages/shared/src/shared.test.ts`

**Interfaces:**
- Consumes: `overlayMargins`, `captionSpotXY`, `CAPTION_SPOTS`, `CaptionSpot` (Task 2).
- Produces (exact):
  - `LayerColours`, `LAYER_COLOUR_KEYS`, `LayerBox`, `FilmCaptionLayer`, `FilmFooterLayer`, `FilmLogoLayer`, `FilmEndCardLayer`, `FilmMusicLayer`, `FilmLayers` (filmLayers.ts).
  - `EditTrackKind` adds `'layer'`; `EditSource` video adds `variant?: 'clean'`.
  - `EditLayer = { kind:'caption'; text; sub? } | { kind:'footer'; text } | { kind:'logo'; which:'dealer'|'brand'; colourPath; whitePath?; whiteOnEndCard; w; h } | { kind:'endcard'; lines: string[] }`.
  - `EditPlacement { x; y; scale }` (top-left, fractions of the frame). `EditLook { colours: LayerColours; width; height; captionHeadSize? }`.
  - `EditClip` adds `layer?`, `place?`, `bed?: { loudness; duckDb }`, `original?: { start; in; out; layer?; place? }`. `EditProject.version: 1 | 2`, `look?: EditLook`.
  - `EDIT_CAPTION_TRACK='c1'`, `EDIT_DEALER_LOGO_TRACK='l1'`, `EDIT_BRAND_LOGO_TRACK='l2'`, `EDIT_FOOTER_TRACK='f1'`, `EDIT_LAYER_FADE=0.28`, `EDIT_END_CARD_FADE=0.35`.
  - `editClipKind(c): 'layer'|'text'|'image'|'audio'|'video'`.
  - `editProjectFromLayers({ aspect, layers, clean, music? }): EditProject`.
  - `validateEditLook(look): string|null`, `validateEditLayer(layer): string|null`, `validateEditProject` accepts v1 and v2.
  - `editLayerGuides(look): { x: number[]; y: number[] }`, `editSnapBox(pos, size, guides, reach): { x; y; caught: { x?; y? } }`, `editCaptionSpots(look, sizePx, footerH): { spot; x; y }[]`.

- [ ] **Step 1: Write the failing tests** (append; add to the `@ava/shared` import: `editProjectFromLayers, editLayerGuides, editSnapBox, editCaptionSpots, EDIT_CAPTION_TRACK, EDIT_DEALER_LOGO_TRACK, EDIT_FOOTER_TRACK, EDIT_TEXT_TRACK, EDIT_AUDIO_TRACK, type FilmLayers, type EditClip` — keep any that are already imported)
```ts
const FILM: FilmLayers = {
  version: 1, width: 720, height: 1280, fps: 30, speed: 1.2, targetShortSide: 720, bodySeconds: 8.6,
  colours: { panel: '#0f172a', text: '#ffffff', accent: '#38bdf8', card: '#0f172a', cardText: '#ffffff', cardMuted: '#cbd5e1' },
  captionHeadSize: 42,
  captions: [{ id: 'cap-0', text: 'Happy Ganesh Chaturthi', from: 0.9, to: 3.4, x: 29, y: 1091, w: 420, h: 100, spot: 'bottom-left', auto: true }],
  footer: { text: 'Garve Renault  ·  Pune', x: 0, y: 1220, w: 720, h: 60 },
  logos: [{ which: 'dealer', x: 540, y: 29, w: 151, h: 61, colourPath: 'refs/a/logo.png', whitePath: 'refs/b/white.png', whiteOnEndCard: true }],
  endCard: { lines: ['Garve Renault', 'Book your test drive today'], seconds: 3 },
  music: { storagePath: 'refs/c/music.m4a', loudness: -20, duckDb: -12 },
};
const layered = () =>
  editProjectFromLayers({
    aspect: '9:16',
    layers: FILM,
    clean: { type: 'video', label: 'Film', url: 'https://x/clean.mp4', duration: 8.6, jobId: 'j1', variant: 'clean' },
    music: { type: 'audio', label: 'Music', url: 'https://x/music.m4a', duration: 14, storagePath: 'refs/c/music.m4a' },
  });

test('a composed film opens as clean footage with its overlays as layers', () => {
  const p = layered();
  assert.equal(p.version, 2);
  assert.deepEqual(p.tracks.map((t) => t.id), [EDIT_CAPTION_TRACK, EDIT_DEALER_LOGO_TRACK, EDIT_FOOTER_TRACK, EDIT_TEXT_TRACK, EDIT_MAIN_TRACK, EDIT_AUDIO_TRACK], 'no brand logo row without a brand logo');
  const byId = new Map(p.clips.map((c) => [c.id, c]));
  assert.equal(byId.get('clean')?.out, 8.6);
  assert.equal(byId.get('endcard')?.start, 8.6);
  assert.equal(byId.get('endcard')?.fadeIn, 0.35);
  const cap = byId.get('cap-0')!;
  assert.equal(cap.start, 0.9);
  assert.ok(Math.abs(editClipLength(cap) - 2.5) < 1e-9);
  assert.deepEqual(cap.place, { x: 29 / 720, y: 1091 / 1280, scale: 1 });
  assert.equal(cap.fadeIn, 0.28);
  assert.equal(byId.get('logo-dealer')?.out, 11.6, 'a logo runs through the end card');
  assert.deepEqual(byId.get('footer')?.place, { x: 0, y: 1220 / 1280, scale: 1 });
  assert.deepEqual(byId.get('music')?.bed, { loudness: -20, duckDb: -12 });
  assert.deepEqual(cap.original?.place, cap.place, 'Reset has something to go back to');
  assert.equal(validateEditProject(p), null);
});

test('a layered edit is checked before any work', () => {
  const p = layered();
  const withCaption = (patch: Partial<EditClip>) => ({ ...p, clips: p.clips.map((c) => (c.id === 'cap-0' ? { ...c, ...patch } : c)) });
  assert.match(String(validateEditProject(withCaption({ layer: { kind: 'caption', text: '' } }))), /needs words/);
  assert.match(String(validateEditProject(withCaption({ place: { x: 0.1, y: 0.1, scale: 9 } }))), /position or size/);
  assert.match(String(validateEditProject({ ...p, look: undefined })), /frame or look/);
  assert.match(
    String(validateEditProject(withCaption({ layer: { kind: 'logo', which: 'dealer', colourPath: '../etc/passwd', whiteOnEndCard: false, w: 10, h: 10 } }))),
    /no image/,
  );
  assert.match(String(validateEditProject({ ...p, version: 3 })), /different version/);
});

test('a dragged layer catches on the centre line and the safe margin', () => {
  const look = { colours: FILM.colours, width: 720, height: 1280 };
  const r = editSnapBox({ x: 0.26, y: 0.3 }, { w: 0.5, h: 0.1 }, editLayerGuides(look), { x: 0.02, y: 0.02 });
  assert.ok(Math.abs(r.x - 0.25) < 1e-9, 'its centre caught the centre line');
  assert.equal(r.caught.x, 0.5);
  assert.equal(r.y, 0.3, 'nothing within reach vertically');
  assert.deepEqual(
    editCaptionSpots(look, { w: 300, h: 100 }, 60).find((s) => s.spot === 'bottom-left'),
    { spot: 'bottom-left', x: 29 / 720, y: 1091 / 1280 },
  );
});
```
In the existing test `the server refuses an edit it cannot render`, change `version: 2` to `version: 3`.

- [ ] **Step 2: Run** — `npm test -w @ava/shared` → FAIL (exports missing).

- [ ] **Step 3: Create `packages/shared/src/filmLayers.ts`**
```ts
/**
 * Where a composed film's overlays went.
 *
 * composeFinal decides where every caption sits, how tall the footer is and where each
 * logo lands, draws them, and used to throw the decisions away. Kept, they are what
 * the video editor opens as layers over the film's clean footage. Positions are
 * pixels on the film's own frame.
 */
export interface LayerColours { panel: string; text: string; accent: string; card: string; cardText: string; cardMuted: string }
export const LAYER_COLOUR_KEYS = ['panel', 'text', 'accent', 'card', 'cardText', 'cardMuted'] as const;
export interface LayerBox { x: number; y: number; w: number; h: number }
export interface FilmCaptionLayer extends LayerBox { id: string; text: string; sub?: string; from: number; to: number; spot: string; auto: boolean }
export interface FilmFooterLayer extends LayerBox { text: string }
export interface FilmLogoLayer extends LayerBox { which: 'dealer' | 'brand'; colourPath: string; whitePath?: string; whiteOnEndCard: boolean }
export interface FilmEndCardLayer { lines: string[]; seconds: number }
export interface FilmMusicLayer { storagePath: string; loudness: number; duckDb: number }
export interface FilmLayers {
  version: 1;
  width: number;
  height: number;
  fps: number;
  speed: number;
  targetShortSide: number;
  /** Where the footage ends and the end card begins, in seconds of the finished film. */
  bodySeconds: number;
  colours: LayerColours;
  captionHeadSize?: number;
  captions: FilmCaptionLayer[];
  footer?: FilmFooterLayer;
  logos: FilmLogoLayer[];
  endCard?: FilmEndCardLayer;
  music?: FilmMusicLayer;
}
```

- [ ] **Step 4: Extend `edit.ts`** — at the top add:
```ts
import { LAYER_COLOUR_KEYS, type FilmLayers, type LayerBox, type LayerColours } from './filmLayers.js';
import { CAPTION_SPOTS, captionSpotXY, overlayMargins, type CaptionSpot } from './captionSpot.js';
```
Change `EditTrackKind` to `'video' | 'text' | 'audio' | 'layer'`; add `variant?: 'clean'` to the video member of `EditSource`. After `EditTextStyle` add:
```ts
/** Something drawn over the film after it was made: a caption, the footer, a logo, or the end card. */
export type EditLayer =
  | { kind: 'caption'; text: string; sub?: string }
  | { kind: 'footer'; text: string }
  | { kind: 'logo'; which: 'dealer' | 'brand'; colourPath: string; whitePath?: string; whiteOnEndCard: boolean; w: number; h: number }
  | { kind: 'endcard'; lines: string[] };
/** A layer's top-left corner as fractions of the frame, and its size where 1 is as designed. */
export interface EditPlacement { x: number; y: number; scale: number }
/** The film's frame and the colours its layers are drawn in. */
export interface EditLook { colours: LayerColours; width: number; height: number; captionHeadSize?: number }
```
Add to `EditClip`:
```ts
  layer?: EditLayer;
  place?: EditPlacement;
  /** A sound clip that is the film's music: levelled, and dipped under the voice, at export. */
  bed?: { loudness: number; duckDb: number };
  /** The layer as the film first drew it, for Reset. */
  original?: { start: number; in: number; out: number; layer?: EditLayer; place?: EditPlacement };
```
`EditProject` becomes `{ version: 1 | 2; aspect; tracks; clips; look?: EditLook }`. `newEditProject` returns `version: 2`. After `EDIT_AUDIO_TRACK` add:
```ts
export const EDIT_CAPTION_TRACK = 'c1';
export const EDIT_DEALER_LOGO_TRACK = 'l1';
export const EDIT_BRAND_LOGO_TRACK = 'l2';
export const EDIT_FOOTER_TRACK = 'f1';
export const EDIT_LAYER_FADE = 0.28;
export const EDIT_END_CARD_FADE = 0.35;

export const editClipKind = (c: EditClip): 'layer' | 'text' | 'image' | 'audio' | 'video' =>
  c.layer ? 'layer' : c.text !== undefined ? 'text' : (c.source?.type ?? 'video');

/**
 * A composed film as an edit: its clean footage on the main track, the end card after it,
 * and every caption, logo and the footer as a layer where the film drew it.
 */
export function editProjectFromLayers(input: {
  aspect: EditAspect;
  layers: FilmLayers;
  clean: Extract<EditSource, { type: 'video' }>;
  music?: Extract<EditSource, { type: 'audio' }>;
}): EditProject {
  const L = input.layers;
  const total = L.bodySeconds + (L.endCard?.seconds ?? 0);
  const base = { speed: 1, volume: 1, fadeIn: 0, fadeOut: 0 };
  const at = (b: LayerBox): EditPlacement => ({ x: b.x / L.width, y: b.y / L.height, scale: 1 });
  const kept = (c: EditClip): EditClip => ({ ...c, original: { start: c.start, in: c.in, out: c.out, layer: c.layer, place: c.place } });
  const clips: EditClip[] = [
    kept({ id: 'clean', trackId: EDIT_MAIN_TRACK, start: 0, in: 0, out: L.bodySeconds, source: input.clean, ...base }),
  ];
  if (L.endCard) {
    clips.push(kept({ id: 'endcard', trackId: EDIT_MAIN_TRACK, start: L.bodySeconds, in: 0, out: L.endCard.seconds, layer: { kind: 'endcard', lines: [...L.endCard.lines] }, ...base, fadeIn: EDIT_END_CARD_FADE }));
  }
  for (const c of L.captions) {
    clips.push(kept({
      id: c.id, trackId: EDIT_CAPTION_TRACK, start: c.from, in: 0, out: c.to - c.from,
      layer: { kind: 'caption', text: c.text, ...(c.sub ? { sub: c.sub } : {}) }, place: at(c), ...base, fadeIn: EDIT_LAYER_FADE, fadeOut: EDIT_LAYER_FADE,
    }));
  }
  for (const g of L.logos) {
    clips.push(kept({
      id: `logo-${g.which}`, trackId: g.which === 'dealer' ? EDIT_DEALER_LOGO_TRACK : EDIT_BRAND_LOGO_TRACK, start: 0, in: 0, out: total,
      layer: { kind: 'logo', which: g.which, colourPath: g.colourPath, ...(g.whitePath ? { whitePath: g.whitePath } : {}), whiteOnEndCard: g.whiteOnEndCard, w: g.w, h: g.h },
      place: at(g), ...base,
    }));
  }
  if (L.footer) {
    clips.push(kept({ id: 'footer', trackId: EDIT_FOOTER_TRACK, start: 0, in: 0, out: total, layer: { kind: 'footer', text: L.footer.text }, place: { x: 0, y: L.footer.y / L.height, scale: 1 }, ...base }));
  }
  if (input.music && L.music) {
    clips.push({ id: 'music', trackId: EDIT_AUDIO_TRACK, start: 0, in: 0, out: Math.min(total, input.music.duration), source: input.music, bed: { loudness: L.music.loudness, duckDb: L.music.duckDb }, ...base });
  }
  const tracks: EditTrack[] = [
    { id: EDIT_CAPTION_TRACK, kind: 'layer' },
    { id: EDIT_DEALER_LOGO_TRACK, kind: 'layer' },
    { id: EDIT_BRAND_LOGO_TRACK, kind: 'layer' },
    { id: EDIT_FOOTER_TRACK, kind: 'layer' },
    { id: EDIT_TEXT_TRACK, kind: 'text' },
    { id: EDIT_MAIN_TRACK, kind: 'video' },
    { id: EDIT_AUDIO_TRACK, kind: 'audio' },
  ];
  return {
    version: 2,
    aspect: input.aspect,
    tracks: tracks.filter((t) => t.kind !== 'layer' || clips.some((c) => c.trackId === t.id)),
    clips,
    look: { colours: { ...L.colours }, width: L.width, height: L.height, ...(L.captionHeadSize ? { captionHeadSize: L.captionHeadSize } : {}) },
  };
}
```
Replace `validateEditProject` with:
```ts
const REF_PATH = /^refs\/[\w-]+\/[^/]+$/;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isText = (v: unknown, max: number, min = 0): v is string => typeof v === 'string' && v.length >= min && v.length <= max;

export function validateEditLook(look: unknown): string | null {
  const l = look as Partial<EditLook> | undefined;
  if (!l || typeof l !== 'object') return 'The edit has no frame or look for its layers.';
  const size = (n: unknown) => Number.isInteger(n) && (n as number) >= 16 && (n as number) <= 4096;
  if (!size(l.width) || !size(l.height)) return 'The edit has an impossible frame size.';
  const colours = l.colours as Record<string, unknown> | undefined;
  if (!colours || LAYER_COLOUR_KEYS.some((k) => !/^#[0-9a-f]{3,8}$/i.test(String(colours[k])))) return 'The edit has a look that cannot be read.';
  if (l.captionHeadSize !== undefined && (!isNum(l.captionHeadSize) || l.captionHeadSize <= 0 || l.captionHeadSize > 400)) return 'The edit has a caption size that cannot be read.';
  return null;
}

export function validateEditLayer(layer: unknown): string | null {
  const x = layer as Record<string, unknown> | undefined;
  if (!x || typeof x !== 'object') return 'A layer is malformed.';
  if (x.kind === 'caption') {
    if (!isText(x.text, 200, 1)) return 'A caption needs words, up to 200 characters.';
    return x.sub === undefined || isText(x.sub, 200) ? null : 'A caption’s second line is too long.';
  }
  if (x.kind === 'footer') return isText(x.text, 300) ? null : 'The footer text is too long.';
  if (x.kind === 'logo') {
    if (x.which !== 'dealer' && x.which !== 'brand') return 'A logo layer must be the dealer or the brand logo.';
    if (!isText(x.colourPath, 300) || !REF_PATH.test(x.colourPath)) return 'A logo layer has no image.';
    if (x.whitePath !== undefined && (!isText(x.whitePath, 300) || !REF_PATH.test(x.whitePath))) return 'A logo layer has a white version that cannot be read.';
    if (!isNum(x.w) || !isNum(x.h) || x.w <= 0 || x.h <= 0 || x.w > 4096 || x.h > 4096) return 'A logo layer has an impossible size.';
    return typeof x.whiteOnEndCard === 'boolean' ? null : 'A logo layer is malformed.';
  }
  if (x.kind === 'endcard') {
    const lines = x.lines as unknown[];
    return Array.isArray(lines) && lines.length <= 6 && lines.every((l) => isText(l, 160)) ? null : 'An end card takes up to six lines of up to 160 characters.';
  }
  return 'A layer is of a kind this editor does not know.';
}

/** Why a project cannot be rendered, or null when it can. Checked on the server before any work. */
export function validateEditProject(p: unknown): string | null {
  if (!p || typeof p !== 'object') return 'No edit was sent.';
  const x = p as Partial<EditProject>;
  if (x.version !== 1 && x.version !== 2) return 'This edit was made by a different version of the editor.';
  if (!['16:9', '9:16', '1:1'].includes(String(x.aspect))) return 'Unknown aspect ratio.';
  if (!Array.isArray(x.tracks) || !Array.isArray(x.clips)) return 'The edit has no tracks.';
  if (x.clips.length > 200) return 'Too many clips — 200 is the most one export takes.';
  const hasLayers = x.clips.some((c) => c && typeof c === 'object' && (c as EditClip).layer !== undefined);
  if (hasLayers || x.look !== undefined) {
    if (x.version !== 2) return 'This edit was made by a different version of the editor.';
    const bad = validateEditLook(x.look);
    if (bad) return bad;
  }
  for (const c of x.clips) {
    if (!c || typeof c !== 'object') return 'A clip is malformed.';
    const nums = [c.start, c.in, c.out, c.speed, c.volume, c.fadeIn, c.fadeOut];
    if (nums.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return 'A clip has a position or length that is not a number.';
    if (c.out - c.in <= 0 || c.speed <= 0) return 'A clip has no length.';
    if (c.layer === undefined) continue;
    const bad = validateEditLayer(c.layer);
    if (bad) return bad;
    if (c.layer.kind === 'endcard') {
      if (c.trackId !== EDIT_MAIN_TRACK) return 'The end card belongs on the main track.';
      continue;
    }
    const pl = c.place;
    if (!pl || !isNum(pl.x) || !isNum(pl.y) || !isNum(pl.scale) || pl.x < -1 || pl.x > 2 || pl.y < -1 || pl.y > 2 || pl.scale < 0.25 || pl.scale > 4) {
      return 'A layer has a position or size that cannot be read.';
    }
  }
  return null;
}

/** Lines a dragged layer catches on: the safe margin and the centre, as fractions of the frame. */
export function editLayerGuides(look: EditLook): { x: number[]; y: number[] } {
  const { margin } = overlayMargins(look.width, look.height);
  return { x: [margin / look.width, 0.5, 1 - margin / look.width], y: [margin / look.height, 0.5, 1 - margin / look.height] };
}

/** A dragged box, snapped by an edge or its centre to the nearest guide within reach. Fractions of the frame. */
export function editSnapBox(
  pos: { x: number; y: number },
  size: { w: number; h: number },
  guides: { x: number[]; y: number[] },
  reach: { x: number; y: number },
): { x: number; y: number; caught: { x?: number; y?: number } } {
  const axis = (p: number, s: number, lines: number[], r: number): { v: number; line?: number } => {
    let best: { v: number; d: number; line?: number } = { v: p, d: r };
    for (const line of lines) {
      for (const off of [0, s / 2, s]) {
        const d = Math.abs(p + off - line);
        if (d <= best.d) best = { v: line - off, d, line };
      }
    }
    return { v: best.v, line: best.line };
  };
  const ax = axis(pos.x, size.w, guides.x, reach.x);
  const ay = axis(pos.y, size.h, guides.y, reach.y);
  return { x: ax.v, y: ay.v, caught: { x: ax.line, y: ay.line } };
}

/** Where a caption of this size (pixels) would sit at each Auto spot, as fractions of the frame. */
export function editCaptionSpots(look: EditLook, size: { w: number; h: number }, footerH: number): { spot: CaptionSpot; x: number; y: number }[] {
  const { margin, logoBand } = overlayMargins(look.width, look.height);
  return CAPTION_SPOTS.map((spot) => {
    const p = captionSpotXY(spot, look.width, look.height, size.w, size.h, margin, footerH, logoBand);
    return { spot, x: p.x / look.width, y: p.y / look.height };
  });
}
```

- [ ] **Step 5: Run** — `npm test -w @ava/shared` → PASS; `npx tsc --noEmit -p packages/shared/tsconfig.json`, `-p apps/api/tsconfig.json` and `-p apps/web/tsconfig.json` → clean. (`VideoEditor.tsx` reads `d.project?.version === 1` for drafts; leave it until Task 9 — v2 drafts simply start fresh until then.)

- [ ] **Step 6: Commit**
```bash
git add packages/shared/src/filmLayers.ts packages/shared/src/edit.ts packages/shared/src/index.ts packages/shared/src/shared.test.ts
git commit -m "An edit that can hold a film's captions, footer, logos and end card as layers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: composeFinal records where it drew every overlay

**Files:**
- Modify: `apps/api/src/post.ts` (`logoStrip`, `BrandOverlay`, `composeFinal` logo, caption and footer sections)
- Test: `apps/api/src/post.test.ts`

**Interfaces:**
- Consumes: `FilmLayers`, `LayerBox` (Task 3); `overlayMargins` (Task 2).
- Produces: `logoStripLayout(fits: {w;h}[], align, boxW, boxH, gap): { width; items: { left; top }[] }` (exported); `ComposedLogo extends LayerBox { which: 'dealer'|'brand'; colour: Buffer; white?: Buffer; whiteOnEndCard: boolean }`; `ComposedLayers extends Omit<FilmLayers,'logos'|'music'> { logos: ComposedLogo[] }`; `BrandOverlay.onLayers?: (layers: ComposedLayers) => void`.

- [ ] **Step 1: Write the failing test** (append to `post.test.ts`; add `import type { ComposedLayers } from '../dist/post.js';` and `import { overlayMargins } from '@ava/shared';`)
```ts
test('a composed film records where it drew every overlay, and is built exactly as before', { skip: !hasFfmpeg }, async () => {
  let L: ComposedLayers | undefined;
  const args = await traceCompose(composeFinal, { ...(await fixtureOverlay()), onLayers: (l) => { L = l; } });
  assert.deepEqual(args, JSON.parse(readFileSync(GOLDEN, 'utf8')), 'recording changes nothing about the film');
  assert.ok(L);
  assert.equal(L!.width, 720);
  assert.equal(L!.height, 1280);
  assert.equal(L!.captions.length, 2);
  const [auto, fixed] = L!.captions;
  assert.equal(fixed!.spot, 'bottom-right');
  assert.equal(fixed!.auto, false);
  assert.equal(fixed!.sub, 'Offer ends Sunday');
  assert.equal(auto!.auto, true);
  const face = { x0: 0.4 * 720, y0: 0.2 * 1280, x1: 0.62 * 720, y1: 0.4 * 1280 };
  const hitsFace = auto!.x < face.x1 && auto!.x + auto!.w > face.x0 && auto!.y < face.y1 && auto!.y + auto!.h > face.y0;
  assert.equal(hitsFace, false, 'the Auto caption keeps clear of the face');
  assert.equal(L!.footer!.y + L!.footer!.h, 1280);
  const { margin } = overlayMargins(720, 1280);
  const brand = L!.logos.find((g) => g.which === 'brand')!;
  const dealer = L!.logos.find((g) => g.which === 'dealer')!;
  assert.equal(brand.x, margin);
  assert.equal(dealer.x + dealer.w, 720 - margin);
  assert.ok(brand.colour.length > 0 && dealer.colour.length > 0);
  assert.equal(dealer.whiteOnEndCard, true, 'a dark end card turns the logos white');
  assert.ok(dealer.white && dealer.white.length > 0);
  assert.deepEqual(L!.endCard, { lines: ['Garve Renault', 'Book your test drive today', 'Pune'], seconds: 3 });
  assert.ok(L!.bodySeconds > 5 && L!.bodySeconds < 9, `got ${L!.bodySeconds}`);
});
```

- [ ] **Step 2: Run** — `npm test -w @ava/api` → FAIL (`onLayers` never called).

- [ ] **Step 3: Factor the strip layout** — add above `logoStrip`, and make `logoStrip` use it:
```ts
/** Where each logo sits inside its corner's strip: the layout logoStrip draws and the editor records. */
export function logoStripLayout(
  fits: { w: number; h: number }[], align: 'left' | 'right', boxW: number, boxH: number, gap: number,
): { width: number; items: { left: number; top: number }[] } {
  const width = fits.length === 1 ? boxW : fits.reduce((a, f) => a + f.w, 0) + gap * (fits.length - 1);
  let x = fits.length === 1 && align === 'right' ? Math.max(0, boxW - fits[0]!.w) : 0;
  const items = fits.map((f) => {
    const item = { left: x, top: Math.max(0, Math.round((boxH - f.h) / 2)) };
    x += f.w + gap;
    return item;
  });
  return { width, items };
}

async function logoStrip(fits: Awaited<ReturnType<typeof fitLogo>>[], align: 'left' | 'right', W: number, H: number): Promise<Buffer> {
  const { boxW, boxH } = fits[0]!;
  const { width, items } = logoStripLayout(fits, align, boxW, boxH, Math.round(shortSide(W, H) * 0.035));
  return sharp({ create: { width, height: boxH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(fits.map((f, i) => ({ input: f.art, left: items[i]!.left, top: items[i]!.top })))
    .png()
    .toBuffer();
}
```

- [ ] **Step 4: Types** — import `type FilmLayers, type LayerBox` from `@ava/shared` and add after `BrandOverlay`:
```ts
/** A logo as it was drawn: its box on the frame and the artwork itself, before it is stored. */
export interface ComposedLogo extends LayerBox { which: 'dealer' | 'brand'; colour: Buffer; white?: Buffer; whiteOnEndCard: boolean }
export interface ComposedLayers extends Omit<FilmLayers, 'logos' | 'music'> { logos: ComposedLogo[] }
```
Add to `BrandOverlay`:
```ts
  /** Told where every overlay was drawn, so the editor can open the film as layers. Changes nothing drawn. */
  onLayers?: (layers: ComposedLayers) => void;
```

- [ ] **Step 5: Record the logos** — in `composeFinal`, move `const { margin, logoBand } = overlayMargins(W, H);` up to just before `const placement = …`, and replace the whole `const cornerLogos = async (…) => { … };` with:
```ts
    const logoLayers: ComposedLogo[] = [];
    const cornerLogos = async (align: 'left' | 'right'): Promise<{ colour: number; white: number } | null> => {
      // The brand before the dealership, whichever corner they share.
      const picked = ([['brand', overlay.brandLogo], ['dealer', overlay.dealerLogo]] as const).filter(
        ([k, b]) => b && placement[k] === align,
      );
      const srcs = picked.map(([, b]) => b!);
      if (!srcs.length) return null;
      const cleaned = await Promise.all(srcs.map((b) => cleanLogo(b).catch(() => null)));
      const fitsFor = (pick: (i: number) => Buffer) => Promise.all(srcs.map((_, i) => fitLogo(pick(i), W, H)));
      const colourFits = await fitsFor((i) => cleaned[i]?.colour ?? srcs[i]!);
      const colour = await addOverlayInput(`${align}-logos.png`, await logoStrip(colourFits, align, W, H));
      const drawWhite = Boolean(endCardFile) && !isLight(colours.card) && cleaned.some(Boolean);
      const whiteFits = drawWhite || overlay.onLayers ? await fitsFor((i) => cleaned[i]?.white ?? srcs[i]!) : null;
      const white = drawWhite ? await addOverlayInput(`${align}-logos-white.png`, await logoStrip(whiteFits!, align, W, H)) : -1;
      if (overlay.onLayers) {
        const { boxW, boxH } = colourFits[0]!;
        const { width, items } = logoStripLayout(colourFits, align, boxW, boxH, Math.round(shortSide(W, H) * 0.035));
        const stripX = align === 'left' ? margin : W - width - margin;
        colourFits.forEach((f, i) => {
          const whiteArt = whiteFits && (drawWhite || cleaned[i]) ? whiteFits[i]!.art : undefined;
          logoLayers.push({
            which: picked[i]![0], x: stripX + items[i]!.left, y: margin + items[i]!.top, w: f.w, h: f.h,
            colour: f.art, ...(whiteArt ? { white: whiteArt } : {}), whiteOnEndCard: drawWhite,
          });
        });
      }
      return { colour, white };
    };
```

- [ ] **Step 6: Record the footer and captions** — after `const footerIdx = …` add:
```ts
    const footerLayer = footerBytes ? { text: overlay.footerText!.trim(), x: 0, y: H - footerH, w: W, h: footerH } : undefined;
    const captionLayers: ComposedLayers['captions'] = [];
```
Inside the caption loop, right after `const { x: cardX, y: top } = spotXY(…);` add:
```ts
      captionLayers.push({
        id: `cap-${cardNo}`, text, ...(card.sub?.trim() ? { sub: card.sub.trim() } : {}),
        from, to, x: cardX, y: top, w: cardW, h: cardH, spot, auto: !isCardSpot(card.position),
      });
```
After `parts.push(\`[${vCur}]null[vout]\`);` add:
```ts
    overlay.onLayers?.({
      version: 1, width: W, height: H, fps, speed, targetShortSide: overlay.targetShortSide ?? 0, bodySeconds: bodyEnd,
      colours: { panel: colours.panel, text: colours.text, accent: colours.accent, card: colours.card, cardText: colours.cardText, cardMuted: colours.cardMuted },
      ...(headSize ? { captionHeadSize: headSize } : {}),
      captions: captionLayers,
      ...(footerLayer ? { footer: footerLayer } : {}),
      logos: logoLayers,
      ...(endCardFile && overlay.endCard
        ? { endCard: { lines: overlay.endCard.lines.map((l) => l.trim()).filter(Boolean), seconds: overlay.endCard.seconds } }
        : {}),
    });
```

- [ ] **Step 7: Run** — `npm test -w @ava/api` → PASS (both tests; golden unchanged). `npx tsc --noEmit -p apps/api/tsconfig.json` → clean.

- [ ] **Step 8: Commit**
```bash
git add apps/api/src/post.ts apps/api/src/post.test.ts
git commit -m "A composed film remembers where it drew every caption, logo and the footer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 5: composeClean — the footage with nothing drawn on it

**Files:**
- Modify: `apps/api/src/post.ts` (`composeFinal` body becomes `composeCore`; add `composeClean`)
- Test: `apps/api/src/post.test.ts`

**Interfaces:**
- Consumes: `ComposedLayers`, `onLayers` (Task 4).
- Produces: `composeClean(segments: Buffer[], overlay?: BrandOverlay, opts?: { plan?: boolean }): Promise<{ bytes: Buffer; layers: ComposedLayers | null }>` — body only (no end card, no music, no overlays), same frame and timing as `composeFinal`'s body, crf 16, aac 192k; `layers` is what `composeFinal` would record for the same inputs (null when `plan: false`). `composeFinal(segments, overlay)` keeps its signature and its exact ffmpeg call.

- [ ] **Step 1: Write the failing tests** (append; import `composeClean, videoFacts, lastFrame` from `../dist/post.js`, `fixtureSegments` from `./testlib.ts`, and `sharp`)
```ts
test('clean footage is the film with nothing drawn on it, and records the same layers', { skip: !hasFfmpeg }, async () => {
  const overlay = await fixtureOverlay();
  let fromFinal: ComposedLayers | undefined;
  await composeFinal(fixtureSegments(), { ...overlay, onLayers: (l) => { fromFinal = l; } });
  const { bytes, layers } = await composeClean(fixtureSegments(), overlay);
  assert.ok(layers && fromFinal);
  const comparable = (l: ComposedLayers) => ({ ...l, logos: l.logos.map(({ colour, white, ...g }) => ({ ...g, colour: colour.length, white: white?.length })) });
  assert.deepEqual(comparable(layers!), comparable(fromFinal!), 'the same decisions either way');
  const facts = await videoFacts(bytes);
  assert.equal(facts.width, 720);
  assert.equal(facts.height, 1280);
  assert.ok(Math.abs(facts.duration - layers!.bodySeconds) < 0.1, `clean ${facts.duration}s, body ${layers!.bodySeconds}s`);
  const last = await lastFrame(bytes);
  const { data } = await sharp(last!).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
  const distance = Math.abs(data[0]! - 0x0f) + Math.abs(data[1]! - 0x17) + Math.abs(data[2]! - 0x2a);
  assert.ok(distance > 60, 'the last frame is footage, not the end card');
});

test('clean footage can be made without working out any layers', { skip: !hasFfmpeg }, async () => {
  const { bytes, layers } = await composeClean(fixtureSegments(), { speed: 1.2, targetShortSide: 720 }, { plan: false });
  assert.equal(layers, null);
  assert.ok((await videoFacts(bytes)).duration > 5);
});
```

- [ ] **Step 2: Run** — `npm test -w @ava/api` → FAIL (`composeClean` not exported).

- [ ] **Step 3: Restructure without changing the film**
1. Rename the current `export async function composeFinal(segments, overlay = {})` to `async function composeCore(segments: Buffer[], overlay: BrandOverlay, want: { final: boolean; clean: boolean }): Promise<{ final?: Buffer; clean?: Buffer }>`.
2. Change the early `if (nothingToDo) return segments[0]!;` to `if (nothingToDo && want.final && !want.clean) return { final: segments[0]! };`.
3. Replace the body of `clipFiles.forEach((file, i) => { … })` so the two chain strings come from one closure defined just above `let clipIdx = 0;`:
```ts
    const chainFor = (i: number, isEndCard: boolean): [string, string] => {
      const d = metas[i]!.duration.toFixed(3);
      return [
        `[${i}:v]scale=${W}:${H}:flags=lanczos,setsar=1,${isEndCard || speed === 1 ? '' : `setpts=(PTS-STARTPTS)/${speed},`}fps=${fps},format=yuv420p,tpad=stop_mode=clone:stop_duration=${(0.25 + (i === lastBody ? tailPad : 0)).toFixed(3)},trim=end=${d},setpts=N/FRAME_RATE/TB,settb=AVTB${
          isEndCard ? ',fade=t=in:st=0:d=0.35' : ''
        }[c${i}v]`,
        `[${i}:a]aresample=44100:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo,${isEndCard || speed === 1 ? '' : `atempo=${speed},`}apad,atrim=end=${d},asetpts=N/SR/TB,afade=t=in:st=0:d=${MICRO_FADE},afade=t=out:st=${Math.max(0, Number(d) - MICRO_FADE).toFixed(3)}:d=${MICRO_FADE}[c${i}a]`,
      ];
    };
```
and the loop pushes `...chainFor(i, isEndCard)` in place of its two `parts.push(…)` calls (keep `clipInputs.push(…)` and `clipIdx++`). Move `const MICRO_FADE = 0.015;` above `chainFor`.
4. Immediately before `// --- the parts, joined whole ---` (after the tail pad, before any end card work) insert:
```ts
    let clean: Buffer | undefined;
    if (want.clean) {
      const cleanInputs: string[] = [];
      const cleanParts: string[] = [];
      files.forEach((file, i) => {
        cleanInputs.push('-threads', FF_THREADS, '-i', file);
        cleanParts.push(...chainFor(i, false));
      });
      cleanParts.push(`${files.map((_, i) => `[c${i}v][c${i}a]`).join('')}concat=n=${files.length}:v=1:a=1[vcat][voice]`);
      const cleanOut = join(dir, 'clean.mp4');
      await run('ffmpeg', [
        '-v', 'error', '-y', ...cleanInputs,
        '-filter_complex_threads', FF_THREADS, '-filter_complex', cleanParts.join(';'),
        '-map', '[vcat]', '-map', '[voice]',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-threads', FF_THREADS,
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', cleanOut,
      ]);
      clean = await readFile(cleanOut);
      if (!want.final && !overlay.onLayers) return { clean };
    }
```
(`chainFor` must be declared before this block — place `MICRO_FADE` and `chainFor` directly after the tail pad.)
5. Replace the final `await run('ffmpeg', finalArgs); return await readFile(out);` with:
```ts
    if (!want.final) return { clean };
    await run('ffmpeg', finalArgs);
    return { final: await readFile(out), clean };
```
(the `AVA_POST_TRACE` write stays before this, so tracing still works when `want.final`).
6. Add the two public functions:
```ts
export async function composeFinal(segments: Buffer[], overlay: BrandOverlay = {}): Promise<Buffer> {
  return (await composeCore(segments, overlay, { final: true, clean: false })).final!;
}

/**
 * The film's footage with nothing drawn on it — joined, scaled and paced exactly as the
 * finished film, without its captions, logos, footer, end card or music. What the video
 * editor lays the film's layers back onto. With `plan`, also works out where composeFinal
 * would draw each overlay.
 */
export async function composeClean(
  segments: Buffer[],
  overlay: BrandOverlay = {},
  opts: { plan?: boolean } = {},
): Promise<{ bytes: Buffer; layers: ComposedLayers | null }> {
  if (segments.length === 0) throw new Error('no segments to compose');
  let layers: ComposedLayers | null = null;
  const planned = opts.plan === false ? { ...overlay, onLayers: undefined } : { ...overlay, onLayers: (l: ComposedLayers) => { layers = l; } };
  const { clean } = await composeCore(segments, planned, { final: false, clean: true });
  return { bytes: clean!, layers };
}
```

- [ ] **Step 4: Run** — `npm test -w @ava/api` → PASS (all four tests; the golden is unchanged). `npx tsc --noEmit -p apps/api/tsconfig.json` → clean.

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/post.ts apps/api/src/post.test.ts
git commit -m "A film's clean footage, made the same way as the film but with nothing drawn on it

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 6: Films keep their layers, and open in the editor as layers

**Files:**
- Create: `apps/api/src/editOpen.ts`
- Create: `apps/api/src/editOpen.test.ts`
- Modify: `apps/api/src/store.ts` (JobRecord fields, `uploadCleanCut`)
- Modify: `apps/api/src/server.ts` (requiredRole, storeLayers, generate, refine, layers route, clips route, saveDerived)

**Interfaces:**
- Consumes: `composeClean`, `ComposedLayers`, `onLayers` (Tasks 4–5); `FilmLayers`, `FilmLogoLayer`, `EditProject` (Task 3).
- Produces:
  - `editOpenPlan(job): 'edit' | 'ready' | 'clean' | 'rebuild' | 'flat'`.
  - `JobRecord.layers?: FilmLayers`, `JobRecord.cleanStoragePath?: string`, `JobRecord.editProject?: EditProject`; `uploadCleanCut(jobId, bytes): Promise<string>` → `generations/<jobId>/clean.mp4`.
  - `POST /api/generations/:jobId/layers` body `{ brief?: Brief; sceneOverrides?: Record<string, SceneOverride> }` →
    `{ mode: 'layers'; layers: FilmLayers; cleanUrl: string; musicUrl: string | null; note?: string }` | `{ mode: 'edit'; editProject: EditProject }` | 409 `{ code: 'flat', message }` | 404.
  - `GET /api/clips/:jobId/clean` serves `cleanStoragePath`.
  - `saveDerived(…, { editProject? })` — every saved version drops `layers` and `cleanStoragePath`; an edit keeps its `editProject`.

- [ ] **Step 1: Write the failing test** — `apps/api/src/editOpen.test.ts`
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FilmLayers } from '@ava/shared';
import { editOpenPlan } from '../dist/editOpen.js';

const part = (n: number, done = true) => ({
  partNum: n, totalParts: 2, seconds: 5, start: 0, end: 5, interactionId: '',
  storagePath: done ? `generations/j/part-${n}.mp4` : '', status: (done ? 'done' : 'failed') as 'done' | 'failed',
});
const layers = {} as FilmLayers;

test('a version opens in the editor the way its records allow', () => {
  assert.equal(editOpenPlan({ clips: [], editProject: { version: 2, aspect: '9:16', tracks: [], clips: [] } }), 'edit');
  assert.equal(editOpenPlan({ clips: [], layers, cleanStoragePath: 'generations/j/clean.mp4' }), 'ready', 'kept footage opens even without segments');
  assert.equal(editOpenPlan({ clips: [part(1), part(2)], layers }), 'clean');
  assert.equal(editOpenPlan({ clips: [part(1), part(2)] }), 'rebuild');
  assert.equal(editOpenPlan({ clips: [part(1), part(2, false)] }), 'flat', 'a part that failed cannot be joined');
  assert.equal(editOpenPlan({ clips: [] }), 'flat', 'a saved version kept no segments');
});
```

- [ ] **Step 2: Run** — `npm test -w @ava/api` → FAIL (module missing).

- [ ] **Step 3: Create `apps/api/src/editOpen.ts`**
```ts
import type { JobRecord } from './store.js';

export type EditOpenPlan = 'edit' | 'ready' | 'clean' | 'rebuild' | 'flat';

/**
 * How a version opens in the video editor.
 *
 * edit — it was exported from the editor, so that edit reopens.
 * ready — its layers and its clean footage are both kept.
 * clean — its layers are kept; the clean footage is made from its segments.
 * rebuild — it was made before layers were kept; both are made from its segments.
 * flat — it kept no complete set of segments, so it opens as the finished picture.
 */
export function editOpenPlan(job: Pick<JobRecord, 'editProject' | 'layers' | 'cleanStoragePath' | 'clips'>): EditOpenPlan {
  if (job.editProject) return 'edit';
  if (job.layers && job.cleanStoragePath) return 'ready';
  const parts = job.clips ?? [];
  const complete = parts.length > 0 && parts.every((c) => c.status === 'done' && Boolean(c.storagePath));
  if (!complete) return 'flat';
  return job.layers ? 'clean' : 'rebuild';
}
```

- [ ] **Step 4: Store** — in `store.ts` change the shared import to `import type { RunFact, EditProject, FilmLayers } from '@ava/shared';`, add to `JobRecord` (after `hiddenBy?`):
```ts
  /** Where every overlay was drawn when the film was composed — what the editor opens as layers. */
  layers?: FilmLayers;
  /** The footage alone: joined, scaled and paced, with no overlays, end card or music. Made the first time the film is edited. */
  cleanStoragePath?: string;
  /** A version exported from the editor keeps the edit, so reopening it restores its layers. */
  editProject?: EditProject;
```
and after `uploadClip`:
```ts
export async function uploadCleanCut(jobId: string, bytes: Buffer): Promise<string> {
  ensure();
  const path = `generations/${jobId}/clean.mp4`;
  await getStorage().bucket(BUCKET).file(path).save(bytes, { contentType: 'video/mp4', resumable: false });
  return path;
}
```

- [ ] **Step 5: Server wiring**
1. Imports: add `composeClean, type ComposedLayers` to the `./post.js` import; `import { editOpenPlan } from './editOpen.js';`; add `uploadCleanCut` to the `./store.js` import; add `type FilmLayers, type FilmLogoLayer, type EditProject` to the `@ava/shared` import (skip any already imported).
2. `requiredRole`: directly after the `/api/models` admin lines, add
```ts
  // Opening a film as layers, and drawing a layer's picture: viewers try the editor too.
  // Checked inside: a viewer only opens layers that are already prepared.
  if (/^\/api\/generations\/[^/]+\/layers$/.test(url) || url === '/api/edits/layer') return null;
```
(it must come before the `url.startsWith('/api/generate')` block, which would otherwise match `/api/generations/…`).
3. Next to `saveDerived`, add:
```ts
/** A composed film's layers, with the logo artwork it drew saved, so an edit draws the same pixels. */
async function storeLayers(
  jobId: string,
  composed: ComposedLayers,
  music?: { storagePath: string; loudness: number; duckDb: number },
): Promise<FilmLayers> {
  const logos: FilmLogoLayer[] = [];
  for (const g of composed.logos) {
    const colour = await putRef(`logo-${g.which}-${jobId}.png`, 'image/png', g.colour);
    const white = g.white ? await putRef(`logo-${g.which}-white-${jobId}.png`, 'image/png', g.white) : null;
    logos.push({ which: g.which, x: g.x, y: g.y, w: g.w, h: g.h, colourPath: colour.storagePath, ...(white ? { whitePath: white.storagePath } : {}), whiteOnEndCard: g.whiteOnEndCard });
  }
  return { ...composed, logos, ...(music ? { music } : {}) };
}
```
4. Generate route: replace the `composeFinal(segmentBytes, { … })` call with
```ts
    const overlay = buildOverlay(brief, req.body?.sceneOverrides, dealerLogo, brandLogo, bed?.bytes);
    const captured: { layers?: ComposedLayers } = {};
    const finalBytes = await composeFinal(segmentBytes, {
      ...overlay,
      findPeople: await peopleFinder(),
      onJoins: (n) => {
        joins = n;
      },
      onLayers: (l) => {
        captured.layers = l;
      },
    });
```
and before its final `await updateJob(jobId, { …record, status: … })` add
```ts
    const layers = captured.layers
      ? await storeLayers(jobId, captured.layers, bed?.storagePath ? { storagePath: bed.storagePath, loudness: overlay.musicLoudness ?? -20, duckDb: overlay.musicDuckDb ?? 0 } : undefined).catch((e) => {
          app.log.warn({ err: (e as Error).message, jobId }, 'keeping the layers failed');
          return undefined;
        })
      : undefined;
```
then add `layers,` to that `updateJob` patch.
5. Refine route: add to its `record` object
```ts
      brief: { ...brief, attachments: (brief.attachments ?? []).map(({ src, ...rest }) => rest) },
      sceneEdits: req.body?.sceneOverrides,
```
replace its `composeFinal(segmentBytes, { ...buildOverlay(…), findPeople: … })` with the same `overlay` / `captured` / `onLayers` pattern as step 4 (no `onJoins`), and add the same `layers` computation plus `layers,` in its final `updateJob` patch.
6. Clips route: `req.params.part === 'final' ? job.finalStoragePath : req.params.part === 'clean' ? job.cleanStoragePath : req.params.part === 'poster' ? job.posterPath : …`.
7. `saveDerived`: add `editProject?: EditProject;` to `opts`; in `record` add `layers: undefined, cleanStoragePath: undefined, editProject: opts.editProject,`.
8. The route, after the refine route:
```ts
/** One layers build per film at a time: a second open of the same film waits for the first. */
const layerBuilds = new Map<string, ReturnType<typeof prepareLayers>>();

function layersReply(jobId: string, layers: FilmLayers, note?: string) {
  return {
    mode: 'layers' as const,
    layers,
    cleanUrl: `/api/clips/${jobId}/clean`,
    musicUrl: layers.music ? `/api/${layers.music.storagePath}` : null,
    ...(note ? { note } : {}),
  };
}

async function prepareLayers(job: JobRecord, plan: 'clean' | 'rebuild', body: { brief?: Brief; sceneOverrides?: Record<string, SceneOverride> }) {
  const parts = [...job.clips].sort((a, b) => a.partNum - b.partNum);
  const segments = await Promise.all(
    parts.map(async (c) => {
      const o = await readObject(c.storagePath);
      if (!o) throw new Error(`part ${c.partNum} is missing from storage`);
      return o.bytes;
    }),
  );
  if (plan === 'clean') {
    const { bytes } = await composeClean(segments, { speed: job.layers!.speed, targetShortSide: job.layers!.targetShortSide }, { plan: false });
    const cleanStoragePath = await uploadCleanCut(job.jobId, bytes);
    await updateJob(job.jobId, { cleanStoragePath });
    return layersReply(job.jobId, job.layers!);
  }
  const brief = (job.brief as Brief | undefined) ?? body.brief;
  if (!brief) throw new Error('this film kept no record of its settings, and none were sent');
  const sceneOverrides = (job.brief ? job.sceneEdits : body.sceneOverrides) as Record<string, SceneOverride> | undefined;
  const { dealerLogo, brandLogo } = await loadBriefAssets(brief);
  const overlay = { ...buildOverlay(brief, sceneOverrides, dealerLogo, brandLogo), findPeople: await peopleFinder() };
  const { bytes, layers: composed } = await composeClean(segments, overlay);
  if (!composed) throw new Error('no layers were worked out');
  const cleanStoragePath = await uploadCleanCut(job.jobId, bytes);
  const layers = await storeLayers(
    job.jobId,
    composed,
    job.musicStoragePath ? { storagePath: job.musicStoragePath, loudness: overlay.musicLoudness ?? -20, duckDb: overlay.musicDuckDb ?? 0 } : undefined,
  );
  await updateJob(job.jobId, { cleanStoragePath, layers });
  return layersReply(job.jobId, layers, job.brief ? undefined : 'This film was made before layers were kept, so they were rebuilt from the project as it is now.');
}

/**
 * Open a film in the video editor as layers.
 *
 * The first time, its clean footage is made from its segments — about as long as a
 * restitch, and free. A version exported from the editor reopens as that edit; a version
 * that kept no segments opens as the finished picture.
 */
app.post<{ Params: { jobId: string }; Body: { brief?: Brief; sceneOverrides?: Record<string, SceneOverride> } }>(
  '/api/generations/:jobId/layers',
  async (req, reply) => {
    const job = await getJob(req.params.jobId);
    if (!job) return reply.code(404).send({ code: 'not-found', message: 'No such film.' });
    const plan = editOpenPlan(job);
    if (plan === 'edit') return { mode: 'edit' as const, editProject: job.editProject! };
    if (plan === 'ready') return layersReply(job.jobId, job.layers!);
    if (plan === 'flat') {
      return reply.code(409).send({ code: 'flat', message: 'This version was saved from a finished film, so its captions and logos are part of the picture. Open the film it was made from to edit them as layers.' });
    }
    if (!allows(req.caller ?? null, 'creator')) {
      return reply.code(409).send({ code: 'flat', message: 'This film has not been prepared for layers yet. It is prepared the first time a creator opens it in the editor.' });
    }
    const running = layerBuilds.get(job.jobId) ?? prepareLayers(job, plan, req.body ?? {});
    layerBuilds.set(job.jobId, running);
    try {
      return await running;
    } catch (err) {
      app.log.error({ err: (err as Error).message, jobId: job.jobId }, 'preparing layers failed');
      return reply.code(409).send({ code: 'flat', message: `The layers could not be prepared: ${(err as Error).message.slice(0, 200)}.` });
    } finally {
      layerBuilds.delete(job.jobId);
    }
  },
);
```

- [ ] **Step 6: Run** — `npm test -w @ava/api` → PASS; `npx tsc --noEmit -p apps/api/tsconfig.json` → clean; `npm test -w @ava/shared` → PASS.

- [ ] **Step 7: Commit**
```bash
git add apps/api/src/editOpen.ts apps/api/src/editOpen.test.ts apps/api/src/store.ts apps/api/src/server.ts
git commit -m "Every film keeps its layers, and opens in the editor as its clean footage and those layers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 7: Drawing one layer, and replacing a logo

**Files:**
- Modify: `apps/api/src/post.ts` (add `export` to `footerPng`, `endCardPng`, `fitLogo`)
- Create: `apps/api/src/layerDraw.ts`
- Create: `apps/api/src/layerDraw.test.ts`
- Modify: `apps/api/src/server.ts` (routes `/api/edits/layer`, `/api/edits/logo`)

**Interfaces:**
- Consumes: `EditLayer`, `EditLook`, `validateEditLayer`, `validateEditLook` (Task 3); requiredRole exception for `/api/edits/layer` (Task 6).
- Produces:
  - `drawLayer(layer: caption|footer|endcard, look, scale = 1): Promise<Buffer>` — caption at scale 1 is byte-identical to `cardPng(text, sub, W, H, colours, captionHeadSize)`; larger scales draw on a proportionally larger frame.
  - `scaleLogo(art: Buffer, scale: number): Promise<Buffer>`.
  - `fitReplacementLogo(colour: Buffer, white: Buffer | null, look): Promise<{ colour: Buffer; white?: Buffer; w: number; h: number }>`.
  - `POST /api/edits/layer` `{ layer, look, scale? }` → `{ png: string /* base64, '' when nothing to draw */; width: number; height: number }` (open to viewers).
  - `POST /api/edits/logo` `{ storagePath, whitePath?, look }` → `{ colourPath: string; whitePath?: string; w: number; h: number }` (creator).

- [ ] **Step 1: Write the failing test** — `apps/api/src/layerDraw.test.ts`
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { cardPng } from '../dist/post.js';
import { drawLayer, scaleLogo } from '../dist/layerDraw.js';
import { FIXTURE_COLOURS } from './testlib.ts';

const look = { colours: FIXTURE_COLOURS, width: 720, height: 1280, captionHeadSize: 42 };

test('a layer is drawn exactly as the film drew it, and drawn larger rather than stretched', async () => {
  const film = await cardPng('Happy Ganesh Chaturthi', 'Pune', 720, 1280, FIXTURE_COLOURS, 42);
  const same = await drawLayer({ kind: 'caption', text: 'Happy Ganesh Chaturthi', sub: 'Pune' }, look, 1);
  assert.ok(film.equals(same), 'at size 1 it is the very same image');
  const one = await sharp(film).metadata();
  const big = await sharp(await drawLayer({ kind: 'caption', text: 'Happy Ganesh Chaturthi', sub: 'Pune' }, look, 1.5)).metadata();
  assert.ok(Math.abs(big.width! - one.width! * 1.5) <= 8, `width ${big.width} vs ${one.width! * 1.5}`);
  assert.ok(Math.abs(big.height! - one.height! * 1.5) <= 8, `height ${big.height} vs ${one.height! * 1.5}`);
  const footer = await sharp(await drawLayer({ kind: 'footer', text: 'Garve Renault  ·  Pune' }, look)).metadata();
  assert.equal(footer.width, 720);
  assert.ok(footer.height! <= Math.round(1280 * 0.085));
  const card = await sharp(await drawLayer({ kind: 'endcard', lines: ['Garve Renault'] }, look)).metadata();
  assert.deepEqual([card.width, card.height], [720, 1280]);
  const logo = await sharp({ create: { width: 100, height: 40, channels: 4, background: '#e11d48' } }).png().toBuffer();
  const scaled = await sharp(await scaleLogo(logo, 1.5)).metadata();
  assert.deepEqual([scaled.width, scaled.height], [150, 60]);
});
```

- [ ] **Step 2: Run** — `npm test -w @ava/api` → FAIL (module missing).

- [ ] **Step 3: Implement** — in `post.ts` put `export` in front of `async function footerPng`, `async function endCardPng` and `async function fitLogo`. Create `apps/api/src/layerDraw.ts`:
```ts
import sharp from 'sharp';
import type { EditLayer, EditLook } from '@ava/shared';
import { cardPng, endCardPng, fitLogo, footerPng } from './post.js';

export type DrawnLayer = Exclude<EditLayer, { kind: 'logo' }>;

/**
 * One layer's picture, drawn by the same functions that drew the finished film.
 *
 * At scale 1 a caption is the very image composeFinal laid on the film. Larger, it is
 * drawn on a proportionally larger frame, so its type is set bigger rather than stretched.
 */
export async function drawLayer(layer: DrawnLayer, look: EditLook, scale = 1): Promise<Buffer> {
  if (layer.kind === 'caption') {
    const k = Math.max(0.25, Math.min(4, scale));
    return cardPng(
      layer.text, layer.sub,
      Math.round(look.width * k), Math.round(look.height * k),
      look.colours,
      look.captionHeadSize ? Math.round(look.captionHeadSize * k) : undefined,
    );
  }
  if (layer.kind === 'footer') return footerPng(layer.text, look.width, look.height, look.colours);
  return endCardPng({ lines: layer.lines, seconds: 3 }, look.width, look.height, look.colours);
}

/** A logo's artwork at a layer's size. */
export async function scaleLogo(art: Buffer, scale: number): Promise<Buffer> {
  if (Math.abs(scale - 1) < 0.001) return art;
  const m = await sharp(art).metadata();
  return sharp(art)
    .resize({ width: Math.max(1, Math.round((m.width ?? 1) * scale)), height: Math.max(1, Math.round((m.height ?? 1) * scale)), fit: 'fill' })
    .png()
    .toBuffer();
}

/** A replacement logo fitted to the film's logo box the way the film fitted its own, in colour and in white. */
export async function fitReplacementLogo(colour: Buffer, white: Buffer | null, look: EditLook): Promise<{ colour: Buffer; white?: Buffer; w: number; h: number }> {
  const c = await fitLogo(colour, look.width, look.height);
  const wv = white ? await fitLogo(white, look.width, look.height) : null;
  return { colour: c.art, ...(wv ? { white: wv.art } : {}), w: c.w, h: c.h };
}
```

- [ ] **Step 4: Routes** — in `server.ts` import `{ drawLayer, fitReplacementLogo, type DrawnLayer } from './layerDraw.js'`, `validateEditLayer, validateEditLook, type EditLayer, type EditLook` from `@ava/shared`, and `sharp` if it is not already imported. Add after `/api/edits/render`:
```ts
/** A caption's, the footer's or the end card's picture, drawn exactly as an export will draw it. */
app.post<{ Body: { layer?: EditLayer; look?: EditLook; scale?: number } }>('/api/edits/layer', async (req, reply) => {
  const { layer, look } = req.body ?? {};
  const bad = validateEditLayer(layer) ?? validateEditLook(look);
  if (bad) return reply.code(400).send({ code: 'bad-request', message: bad });
  if (layer!.kind === 'logo') return reply.code(400).send({ code: 'bad-request', message: 'A logo is shown from its own image.' });
  if (layer!.kind === 'footer' && !layer!.text.trim()) return { png: '', width: 0, height: 0 };
  const scale = Number.isFinite(req.body?.scale) ? Math.max(0.25, Math.min(4, Number(req.body!.scale))) : 1;
  const png = await drawLayer(layer as DrawnLayer, look!, scale);
  const m = await sharp(png).metadata();
  return { png: png.toString('base64'), width: m.width ?? 0, height: m.height ?? 0 };
});

/** A new logo for a layer: cleaned when it was uploaded, fitted here to the film's logo box. */
app.post<{ Body: { storagePath?: string; whitePath?: string; look?: EditLook } }>('/api/edits/logo', async (req, reply) => {
  const { storagePath, whitePath, look } = req.body ?? {};
  const ref = /^refs\/[\w-]+\/[^/]+$/;
  if (!storagePath || !ref.test(storagePath) || (whitePath !== undefined && !ref.test(whitePath))) {
    return reply.code(400).send({ code: 'bad-request', message: 'Upload the logo first.' });
  }
  const badLook = validateEditLook(look);
  if (badLook) return reply.code(400).send({ code: 'bad-request', message: badLook });
  const colour = await readObject(storagePath);
  if (!colour) return reply.code(404).send({ code: 'not-found', message: 'That logo is gone from storage. Upload it again.' });
  const white = whitePath ? await readObject(whitePath) : null;
  const fitted = await fitReplacementLogo(colour.bytes, white?.bytes ?? null, look!);
  const c = await putRef('logo-edit.png', 'image/png', fitted.colour);
  const w = fitted.white ? await putRef('logo-edit-white.png', 'image/png', fitted.white) : null;
  return { colourPath: c.storagePath, ...(w ? { whitePath: w.storagePath } : {}), w: fitted.w, h: fitted.h };
});
```

- [ ] **Step 5: Run** — `npm test -w @ava/api` → PASS (golden still equal: adding `export` changes nothing). `npx tsc --noEmit -p apps/api/tsconfig.json` → clean.

- [ ] **Step 6: Commit**
```bash
git add apps/api/src/post.ts apps/api/src/layerDraw.ts apps/api/src/layerDraw.test.ts apps/api/src/server.ts
git commit -m "Draw one layer exactly as the film drew it, and fit a replacement logo

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 8: Export draws the layers onto the clean footage

**Files:**
- Modify: `apps/api/src/post.ts` (factor `musicBedGraph`, `withEndCardDuck`; export `mediaSeconds`)
- Modify: `packages/shared/src/edit.ts` (add `editSetEndCardSeconds`) and `shared.test.ts`
- Modify: `apps/api/src/editRender.ts`
- Modify: `apps/api/src/testlib.ts` (`ssim`, `frameAt`)
- Create: `apps/api/src/editRender.test.ts`
- Modify: `apps/api/src/server.ts` (`/api/edits/render`: clean variant, `editProject`)

**Interfaces:**
- Consumes: Tasks 3–7.
- Produces: `musicBedGraph(input: number, bedSeconds, filmSeconds, open, spans, duck): string[]` (labels `[bs*]`, `[bx*]`, `[bedraw]`, `[bed]`); `withEndCardDuck(spans, filmSeconds, cardSeconds)`; `editSetEndCardSeconds(p, clipId, seconds): EditProject`; `renderEditProject` renders v2 layers; env hook `AVA_EDIT_TRACE=<file>` writes the final ffmpeg args.

- [ ] **Step 1: Shared helper test** (append to `shared.test.ts`, import `editSetEndCardSeconds`)
```ts
test('a longer end card carries the logos, footer and music to the new end', () => {
  const p = editSetEndCardSeconds(layered(), 'endcard', 5);
  const byId = new Map(p.clips.map((c) => [c.id, c]));
  assert.equal(editClipEnd(byId.get('endcard')!), 13.6);
  assert.equal(editClipEnd(byId.get('logo-dealer')!), 13.6);
  assert.equal(editClipEnd(byId.get('footer')!), 13.6);
  assert.equal(editClipEnd(byId.get('music')!), 13.6);
  assert.equal(editClipEnd(byId.get('cap-0')!), 3.4, 'a caption that ended earlier is left alone');
  assert.equal(editClipLength(editSetEndCardSeconds(layered(), 'endcard', 30).clips.find((c) => c.id === 'endcard')!), 8, 'held to eight seconds');
});
```
Implement in `edit.ts`:
```ts
/** A longer or shorter end card, with every layer and the music that ran to the end of the film still running to its end. */
export function editSetEndCardSeconds(p: EditProject, clipId: string, seconds: number): EditProject {
  const card = p.clips.find((c) => c.id === clipId && c.layer?.kind === 'endcard');
  if (!card) return p;
  const oldEnd = editProjectLength(p);
  const len = Math.max(1, Math.min(8, seconds));
  const next = packEditTrack(updateEditClip(p, clipId, { out: card.in + len * card.speed }), EDIT_MAIN_TRACK);
  const newEnd = next.clips.filter((c) => c.trackId === EDIT_MAIN_TRACK).reduce((m, c) => Math.max(m, editClipEnd(c)), 0);
  return {
    ...next,
    clips: next.clips.map((c) => {
      if (c.trackId === EDIT_MAIN_TRACK || !(c.layer || c.bed) || Math.abs(editClipEnd(c) - oldEnd) > 0.05) return c;
      const recorded = c.source && c.source.type !== 'image' ? c.source.duration : Infinity;
      return { ...c, out: Math.min(c.in + (newEnd - c.start) * c.speed, recorded) };
    }),
  };
}
```
Run `npm test -w @ava/shared` → PASS.

- [ ] **Step 2: Factor the music bed in `post.ts`** — add, and use from `composeFinal`:
```ts
/**
 * The music bed's filters. Never looped — music restarting mid-film is the most audible
 * glitch there is — so a short track is joined to copies of itself with a slow crossfade;
 * then levelled, faded in and out, and dipped under every span.
 */
export function musicBedGraph(input: number, bedSeconds: number, filmSeconds: number, open: number, spans: Array<[number, number]>, duck: number): string[] {
  const out: string[] = [];
  const XF = 2;
  const copies = bedSeconds > XF * 2 && bedSeconds < filmSeconds ? Math.min(6, Math.ceil((filmSeconds - XF) / (bedSeconds - XF))) : 1;
  const norm = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo';
  if (copies > 1) {
    out.push(`[${input}:a]${norm},asplit=${copies}${Array.from({ length: copies }, (_, i) => `[bs${i}]`).join('')}`);
    let prev = 'bs0';
    for (let i = 1; i < copies; i++) {
      const o = i === copies - 1 ? 'bedraw' : `bx${i}`;
      out.push(`[${prev}][bs${i}]acrossfade=d=${XF}:c1=qsin:c2=qsin[${o}]`);
      prev = o;
    }
  } else {
    out.push(`[${input}:a]${norm}[bedraw]`);
  }
  out.push(
    `[bedraw]atrim=end=${filmSeconds.toFixed(3)},asetpts=N/SR/TB,loudnorm=I=${open}:TP=-2:LRA=11,${norm},` +
      `afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(0, filmSeconds - 1.5).toFixed(3)}:d=1.5` +
      (spans.length ? `,asetnsamples=n=1024:p=0,volume='${duckVolume(spans, duck)}':eval=frame` : '') +
      '[bed]',
  );
  return out;
}

/** The dip held across the end card, merged into the last spoken line when they are close. */
export function withEndCardDuck(spans: Array<[number, number]>, filmSeconds: number, cardSeconds: number): Array<[number, number]> {
  if (!spans.length) return spans;
  const out = spans.map(([a, b]): [number, number] => [a, b]);
  const from = Math.max(0, filmSeconds - cardSeconds - DUCK_ATTACK);
  const last = out[out.length - 1]!;
  if (from - last[1] < MIN_MUSIC_PAUSE) last[1] = filmSeconds;
  else out.push([from, filmSeconds]);
  return out;
}
```
Replace the body of `if (overlay.musicBed) { … }` in `composeFinal` with:
```ts
      const bed = join(dir, 'music-bed');
      await writeFile(bed, overlay.musicBed);
      clipInputs.push('-i', bed);
      const m = clipIdx++;
      const bedSeconds = await mediaSeconds(bed);
      const open = Math.max(-40, Math.min(-14, overlay.musicLoudness ?? -20));
      const duck = Math.min(0, overlay.musicDuckDb ?? 0);
      let spans = duck < 0 ? (await speechSpans(files, rawDurations)).map(([a, b]): [number, number] => [a / speed, b / speed]) : [];
      if (spans.length && endCardFile) spans = withEndCardDuck(spans, filmSeconds, overlay.endCard?.seconds ?? 0);
      parts.push(...musicBedGraph(m, bedSeconds, filmSeconds, open, spans, duck));
      parts.push(`[voice][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mixed]`);
      audioOut = 'mixed';
```
Put `export` in front of `async function mediaSeconds`. Run `npm test -w @ava/api` → golden PASS (the call is unchanged).

- [ ] **Step 3: Test helpers** — append to `testlib.ts` (add `writeFileSync` to the fs import):
```ts
/** Mean SSIM of two videos over their common frames. */
export function ssim(a: Buffer, b: Buffer): number {
  const dir = scratch();
  const fa = join(dir, 'a.mp4');
  const fb = join(dir, 'b.mp4');
  writeFileSync(fa, a);
  writeFileSync(fb, b);
  const r = spawnSync('ffmpeg', ['-i', fa, '-i', fb, '-lavfi', '[0:v]fps=30,settb=AVTB[x];[1:v]fps=30,settb=AVTB[y];[x][y]ssim', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /All:([\d.]+)/.exec(r.stderr);
  return m ? Number(m[1]) : 0;
}

/** One frame of a video as a PNG. */
export function frameAt(video: Buffer, seconds: number): Buffer {
  const dir = scratch();
  const src = join(dir, 'v.mp4');
  const out = join(dir, 'f.png');
  writeFileSync(src, video);
  ff(['-ss', seconds.toFixed(3), '-i', src, '-frames:v', '1', out]);
  return readFileSync(out);
}
```

- [ ] **Step 4: Write the failing export tests** — `apps/api/src/editRender.test.ts`
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { editProjectFromLayers, editSetEndCardSeconds, updateEditClip, type EditSource, type FilmLayers } from '@ava/shared';
import { composeClean, composeFinal, videoFacts, type ComposedLayers } from '../dist/post.js';
import { renderEditProject } from '../dist/editRender.js';
import { hasFfmpeg, fixtureOverlay, fixtureSegments, frameAt, ssim } from './testlib.ts';

async function layeredFixture() {
  const overlay = await fixtureOverlay();
  const segments = fixtureSegments();
  const captured: { layers?: ComposedLayers } = {};
  const final = await composeFinal(segments, { ...overlay, onLayers: (l) => { captured.layers = l; } });
  const { bytes: clean } = await composeClean(segments, overlay, { plan: false });
  const store = new Map<string, Buffer>([['job:clean', clean], ['refs/m/music.m4a', overlay.musicBed!]]);
  const logos = captured.layers!.logos.map((g) => {
    store.set(`refs/${g.which}/colour.png`, g.colour);
    if (g.white) store.set(`refs/${g.which}/white.png`, g.white);
    return { which: g.which, x: g.x, y: g.y, w: g.w, h: g.h, colourPath: `refs/${g.which}/colour.png`, ...(g.white ? { whitePath: `refs/${g.which}/white.png` } : {}), whiteOnEndCard: g.whiteOnEndCard };
  });
  const layers: FilmLayers = { ...captured.layers!, logos, music: { storagePath: 'refs/m/music.m4a', loudness: -20, duckDb: -12 } };
  const project = editProjectFromLayers({
    aspect: '9:16',
    layers,
    clean: { type: 'video', label: 'Film', url: '', duration: layers.bodySeconds, jobId: 'job', variant: 'clean' },
    music: { type: 'audio', label: 'Music', url: '', duration: 14, storagePath: 'refs/m/music.m4a' },
  });
  const load = async (src: EditSource) =>
    (src.type === 'video' ? store.get(`${src.jobId}:${src.variant}`) : src.storagePath ? store.get(src.storagePath) : undefined) ?? null;
  return { final, project, load, layers };
}

const colourAt = async (png: Buffer, x: number, y: number): Promise<number[]> => {
  const { data } = await sharp(png).extract({ left: x, top: y, width: 6, height: 6 }).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
  return [data[0]!, data[1]!, data[2]!];
};
const PANEL = [0x0f, 0x17, 0x2a];
const distance = (c: number[], d: number[]) => c.reduce((a, v, i) => a + Math.abs(v - d[i]!), 0);

test('an untouched layered edit looks like the film it came from', { skip: !hasFfmpeg }, async () => {
  const { final, project, load } = await layeredFixture();
  const { bytes } = await renderEditProject(project, load);
  const [a, b] = [await videoFacts(final), await videoFacts(bytes)];
  assert.ok(Math.abs(a.duration - b.duration) < 0.15, `${a.duration}s vs ${b.duration}s`);
  const score = ssim(final, bytes);
  assert.ok(score >= 0.97, `SSIM ${score}`);
});

test('a caption dragged somewhere else is drawn there, and no longer where it was', { skip: !hasFfmpeg }, async () => {
  const { project, load, layers } = await layeredFixture();
  const cap = layers.captions[0]!;
  const moved = updateEditClip(project, cap.id, { place: { x: 0.05, y: 0.05, scale: 1 } });
  const { bytes } = await renderEditProject(moved, load);
  const frame = frameAt(bytes, (cap.from + cap.to) / 2);
  const nx = Math.round(0.05 * 720);
  const ny = Math.round(0.05 * 1280);
  assert.ok(distance(await colourAt(frame, nx + 10, ny + Math.round(cap.h / 2) - 3), PANEL) < 60, 'the panel is at its new place');
  assert.ok(distance(await colourAt(frame, cap.x + 10, cap.y + Math.round(cap.h / 2) - 3), PANEL) > 100, 'and gone from the old one');
});

test('a longer end card makes a longer film, and the music fades out at its new end', { skip: !hasFfmpeg }, async () => {
  const { project, load, layers } = await layeredFixture();
  const trace = join(mkdtempSync(join(tmpdir(), 'ava-trace-')), 'args.json');
  process.env.AVA_EDIT_TRACE = trace;
  let seconds = 0;
  try {
    seconds = (await renderEditProject(editSetEndCardSeconds(project, 'endcard', 5), load)).seconds;
  } finally {
    delete process.env.AVA_EDIT_TRACE;
  }
  assert.ok(Math.abs(seconds - (layers.bodySeconds + 5)) < 0.1, `${seconds}s`);
  const args = JSON.parse(readFileSync(trace, 'utf8')) as string[];
  const graph = args[args.indexOf('-filter_complex') + 1]!;
  assert.ok(graph.includes(`afade=t=out:st=${(seconds - 1.5).toFixed(3)}:d=1.5`), 'the music fades out over the last second and a half');
});
```
Run `npm test -w @ava/api` → FAIL (layers are not rendered yet).

- [ ] **Step 5: Implement in `editRender.ts`**
1. Imports: add `EDIT_MAIN_TRACK` (already), `editClipKind`, `type EditLayer` from `@ava/shared`; from `./post.js` add `musicBedGraph, withEndCardDuck, speechSpans, mediaSeconds`; add `import { drawLayer, scaleLogo } from './layerDraw.js';`.
2. Source cache key: `const key = (src.type === 'video' && src.jobId ? `${src.jobId}:${src.variant ?? 'final'}` : '') || src.storagePath || src.url;`
3. Main clips: `.filter((c) => c.trackId === EDIT_MAIN_TRACK && ((c.source && c.source.type !== 'audio') || c.layer?.kind === 'endcard'))`.
4. Frame: when `p.look` is set use `W = p.look.width`, `H = p.look.height` and skip the probe; otherwise keep today's probe and `editAspectSize`.
5. In the pieces loop, render an end card as a still and remember where it starts:
```ts
      const file =
        c.layer?.kind === 'endcard'
          ? await renderPiece(dir, n++, { ...c, source: { type: 'image', label: 'End card', url: '' } }, await drawLayer(c.layer, p.look!), W, H, true)
          : await renderPiece(dir, n++, c, await bytesFor(c.source!), W, H, muted.has(EDIT_MAIN_TRACK));
      const joins = Boolean(look && pieces.length && overlap > 0.05);
      if (c.layer?.kind === 'endcard' && endCardStart === undefined) endCardStart = cursor - (joins ? overlap : 0);
```
(declare `let endCardStart: number | undefined;` before the loop).
6. Replace everything from `const texts = …` to the end of the text loop (`if (v === '[0:v]') { … }` stays) with:
```ts
    const visible = (c: EditClip) => !hidden.has(c.trackId) && c.start < total;
    const layersOf = (kind: EditLayer['kind']) => p.clips.filter((c) => c.trackId !== EDIT_MAIN_TRACK && c.layer?.kind === kind && c.place && visible(c));
    const captions = layersOf('caption');
    const logos = layersOf('logo');
    const footers = layersOf('footer');
    const texts = p.clips.filter((c) => c.trackId !== EDIT_MAIN_TRACK && !c.layer && c.text?.trim() && c.style && visible(c));
    const sounds = p.clips.filter((c) => c.source?.type === 'audio' && !hidden.has(c.trackId) && !muted.has(c.trackId) && c.start < total);
    if (!captions.length && !logos.length && !footers.length && !texts.length && !sounds.length) {
      return { bytes: await readFile(joined), seconds: total };
    }

    const out = join(dir, 'final.mp4');
    const args = ['-v', 'error', '-y', '-threads', FF_THREADS, '-i', joined];
    const g: string[] = [];
    let v = '[0:v]';
    let input = 1;
    let label = 0;
    let fileNo = 0;
    const span = (c: EditClip) => ({ S: c.start, E: Math.min(total, editClipEnd(c)) });
    const lay = (idx: number, x: number, y: number, enable: string): void => {
      g.push(`${v}[${idx}:v]overlay=${x}:${y}${enable}[vl${label}]`);
      v = `[vl${label++}]`;
    };

    // Captions: each looped only across its own window and faded on its alpha, as the film drew them.
    for (const c of captions) {
      const { S, E } = span(c);
      if (E - S <= 0.05) continue;
      const file = join(dir, `layer-${fileNo++}.png`);
      await writeFile(file, await drawLayer(c.layer as Extract<EditLayer, { kind: 'caption' }>, p.look!, c.place!.scale));
      args.push('-loop', '1', '-framerate', String(FPS), '-t', n3(E - S), '-itsoffset', n3(S), '-threads', FF_THREADS, '-i', file);
      const fi = Math.min(c.fadeIn, (E - S) / 2);
      const fo = Math.min(c.fadeOut, (E - S) / 2);
      const fades = [
        fi > 0.01 ? `fade=t=in:st=${n3(S)}:d=${n3(fi)}:alpha=1` : '',
        fo > 0.01 ? `fade=t=out:st=${n3(Math.max(S, E - fo))}:d=${n3(fo)}:alpha=1` : '',
      ].filter(Boolean).join(',');
      g.push(`[${input}:v]format=rgba,settb=AVTB${fades ? `,${fades}` : ''}[ly${input}]`);
      g.push(`${v}[ly${input}]overlay=${Math.round(c.place!.x * W)}:${Math.round(c.place!.y * H)}:eof_action=pass[vl${label}]`);
      v = `[vl${label++}]`;
      input++;
    }

    // Logos: in colour over the film, in white from the end card on when the film did that.
    const logoInput = async (path: string, scale: number): Promise<number> => {
      const art = await load({ type: 'image', label: 'Logo', url: '', storagePath: path });
      if (!art) throw new Error('A logo image is missing from storage — replace the logo and export again.');
      const file = join(dir, `layer-${fileNo++}.png`);
      await writeFile(file, await scaleLogo(art, scale));
      args.push('-threads', FF_THREADS, '-i', file);
      return input++;
    };
    for (const c of logos) {
      const { S, E } = span(c);
      if (E - S <= 0.05) continue;
      const layer = c.layer as Extract<EditLayer, { kind: 'logo' }>;
      const x = Math.round(c.place!.x * W);
      const y = Math.round(c.place!.y * H);
      const switchAt = layer.whiteOnEndCard && layer.whitePath && endCardStart !== undefined && endCardStart < E ? Math.max(S, endCardStart) : undefined;
      const colourEnd = switchAt ?? E;
      if (colourEnd - S > 0.001) lay(await logoInput(layer.colourPath, c.place!.scale), x, y, `:enable='gte(t,${n3(S)})*lt(t,${n3(colourEnd)})'`);
      if (switchAt !== undefined) lay(await logoInput(layer.whitePath!, c.place!.scale), x, y, `:enable='gte(t,${n3(switchAt)})*lt(t,${n3(E)})'`);
    }

    // The footer strip, full width, at its height on the frame.
    for (const c of footers) {
      const { S, E } = span(c);
      const layer = c.layer as Extract<EditLayer, { kind: 'footer' }>;
      if (E - S <= 0.05 || !layer.text.trim()) continue;
      const file = join(dir, `layer-${fileNo++}.png`);
      await writeFile(file, await drawLayer(layer, p.look!));
      args.push('-threads', FF_THREADS, '-i', file);
      lay(input++, 0, Math.round(c.place!.y * H), `:enable='gte(t,${n3(S)})*lt(t,${n3(E)})'`);
    }

    // Free text on top, as before.
    for (const [k, c] of texts.entries()) {
      const S = c.start;
      const E = Math.min(total, editClipEnd(c));
      if (E - S <= 0.05) continue;
      const png = join(dir, `text-${k}.png`);
      await writeFile(png, await textPng(c.text!, c.style!, W, H));
      args.push('-loop', '1', '-t', n3(total), '-i', png);
      const fi = Math.min(c.fadeIn, (E - S) / 2);
      const fo = Math.min(c.fadeOut, (E - S) / 2);
      const fades = [
        fi > 0.01 ? `fade=t=in:st=${n3(S)}:d=${n3(fi)}:alpha=1` : '',
        fo > 0.01 ? `fade=t=out:st=${n3(E - fo)}:d=${n3(fo)}:alpha=1` : '',
      ].filter(Boolean).join(',');
      g.push(`[${input}:v]format=rgba${fades ? `,${fades}` : ''}[tx${k}]`);
      g.push(`${v}[tx${k}]overlay=0:0:enable='between(t,${n3(S)},${n3(E)})'[vo${k}]`);
      v = `[vo${k}]`;
      input++;
    }
```
7. In the sounds loop, handle the film's music:
```ts
    for (const [j, c] of sounds.entries()) {
      const src = join(dir, `sound-${j}`);
      await writeFile(src, await bytesFor(c.source!));
      const len = Math.min(editClipLength(c), total - c.start);
      const delay = Math.round(c.start * 1000);
      if (c.bed) {
        // The film's music, mixed the way composeFinal mixed it, over this edit's own lengths.
        args.push('-i', src);
        const open = Math.max(-40, Math.min(-14, c.bed.loudness));
        const duck = Math.min(0, c.bed.duckDb);
        let spans = duck < 0
          ? (await speechSpans([joined], [total])).map(([a, b]): [number, number] => [a - c.start, b - c.start]).filter(([, b]) => b > 0)
          : [];
        if (spans.length && endCardStart !== undefined) spans = withEndCardDuck(spans, len, total - endCardStart);
        g.push(...musicBedGraph(input, await mediaSeconds(src), len, open, spans, duck).map((s) => s.replace(/\[(bs\d+|bx\d+|bedraw|bed)\]/g, `[$1_${j}]`)));
        g.push(`[bed_${j}]volume=${c.volume.toFixed(2)},adelay=${delay}|${delay}[s${j}]`);
      } else {
        args.push('-ss', n3(c.in), '-t', n3(c.out - c.in), '-i', src);
        const afades = audioFades(len, c.fadeIn, c.fadeOut);
        g.push(`[${input}:a]asetpts=PTS-STARTPTS,${atempoChain(c.speed || 1)},volume=${c.volume.toFixed(2)},${AUDIO},atrim=duration=${n3(len)}${afades ? `,${afades}` : ''},adelay=${delay}|${delay}[s${j}]`);
      }
      mix.push(`[s${j}]`);
      input++;
    }
```
8. Before the final `await run('ffmpeg', args);` add `if (process.env.AVA_EDIT_TRACE) await writeFile(process.env.AVA_EDIT_TRACE, JSON.stringify(args));` and build `args.push('-filter_complex', …)` before it as today.

- [ ] **Step 6: Server** — in `/api/edits/render`:
```ts
    if (src.type === 'video' && src.jobId) {
      const job = await getJob(src.jobId);
      const path = src.variant === 'clean' ? job?.cleanStoragePath : job?.finalStoragePath;
      return path ? ((await readObject(path))?.bytes ?? null) : null;
    }
```
and in `saveDerived(base, bytes, { … })` add `editProject: project,`; change the note to count layers: `${project.clips.filter((c) => c.layer).length} layer` between the text and sound counts.

- [ ] **Step 7: Run** — `npm test -w @ava/api` → PASS (golden, layers, clean, open plan, layer drawing, the three export tests); `npm test -w @ava/shared` → PASS; `npx tsc --noEmit` for shared, api and web → clean. If SSIM is below 0.97, compare a frame from each (`frameAt`) and find the layer that moved — do not lower the threshold.

- [ ] **Step 8: Commit**
```bash
git add packages/shared/src/edit.ts packages/shared/src/shared.test.ts apps/api/src/post.ts apps/api/src/editRender.ts apps/api/src/testlib.ts apps/api/src/editRender.test.ts apps/api/src/server.ts
git commit -m "An edit is exported by drawing its layers onto the clean footage, exactly as the film drew them

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 9: The editor opens a film as layers

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/components/GenerationPanel.tsx` (the `<VideoEditor` mount)
- Modify: `apps/web/src/components/VideoEditor.tsx` (props, open effect, loading text, draft choice modal)

**Interfaces:**
- Consumes: `POST /api/generations/:jobId/layers` contract (Task 6); `editProjectFromLayers` (Task 3).
- Produces: `EditOpen` type; `api.editOpen(jobId, { brief?, sceneOverrides? })`; `api.drawLayer(layer, look, scale?)`; `api.fitLogo(storagePath, whitePath, look)`; `refUrl(storagePath): string`; `VideoEditor` prop `sceneOverrides?: Record<string, unknown>`.

- [ ] **Step 1: API client** — in `api.ts` add `EditLayer, EditLook, FilmLayers` to the `@ava/shared` type import, then:
```ts
export type EditOpen =
  | { mode: 'layers'; layers: FilmLayers; cleanUrl: string; musicUrl: string | null; note?: string }
  | { mode: 'edit'; editProject: EditProject };

/** A stored image's address, for an <img>. */
export const refUrl = (storagePath: string): string => `${BASE}/api/${storagePath}`;
```
and inside `api`:
```ts
  /** Open a film in the editor as its clean footage and its layers — prepared the first time. */
  async editOpen(jobId: string, body: { brief?: Brief; sceneOverrides?: Record<string, unknown> }) {
    const r = await req<EditOpen>(`/api/generations/${jobId}/layers`, { method: 'POST', body: JSON.stringify(body) });
    if (isApiError(r) || r.mode === 'edit') return r;
    return { ...r, cleanUrl: absolute(r.cleanUrl) ?? r.cleanUrl, musicUrl: absolute(r.musicUrl) };
  },

  /** One layer's picture, drawn by the server exactly as an export draws it. */
  async drawLayer(layer: EditLayer, look: EditLook, scale = 1) {
    return await req<{ png: string; width: number; height: number }>('/api/edits/layer', {
      method: 'POST',
      body: JSON.stringify({ layer, look, scale }),
    });
  },

  /** A replacement logo, fitted to the film's logo box. */
  async fitLogo(storagePath: string, whitePath: string | undefined, look: EditLook) {
    return await req<{ colourPath: string; whitePath?: string; w: number; h: number }>('/api/edits/logo', {
      method: 'POST',
      body: JSON.stringify({ storagePath, whitePath, look }),
    });
  },
```

- [ ] **Step 2: Pass the storyboard edits** — in `GenerationPanel.tsx` add `sceneOverrides={sceneOverrides}` to `<VideoEditor … />`, and in `VideoEditor` add `sceneOverrides` to the destructured props with type `sceneOverrides?: Record<string, unknown>;` (comment: "The storyboard's edits, for rebuilding the layers of a film made before layers were kept.").

- [ ] **Step 3: Open as layers** — add imports `editProjectFromLayers` from `@ava/shared` and `type EditOpen` from `../lib/api.js`. Add state:
```ts
  const [preparing, setPreparing] = useState(false);
  /** An old draft made on the finished picture, waiting on the choice to keep it or start with layers. */
  const [draftChoice, setDraftChoice] = useState<null | { draft: { project: EditProject; uploads: Material[] }; layered: EditProject }>(null);
  const begin = useCallback((p: EditProject, kept: Material[] = []) => {
    projectRef.current = p;
    setProject(p);
    setUploads(kept);
    setReady(true);
  }, []);
  const layeredProject = async (o: Extract<EditOpen, { mode: 'layers' }>): Promise<EditProject> => {
    const total = o.layers.bodySeconds + (o.layers.endCard?.seconds ?? 0);
    const cleanSeconds = (await mediaDuration(o.cleanUrl, 'video')) || o.layers.bodySeconds;
    const musicSeconds = o.musicUrl ? (await mediaDuration(o.musicUrl, 'audio')) || total : 0;
    setDurations((cur) => ({ ...cur, [`run:${run.jobId}`]: cleanSeconds }));
    return editProjectFromLayers({
      aspect: asAspect(run.aspect),
      layers: o.layers,
      clean: { type: 'video', label: `${run.label ?? 'Film'} · footage`, url: o.cleanUrl, duration: cleanSeconds, jobId: run.jobId, variant: 'clean', poster: run.posterUrl ?? undefined },
      ...(o.musicUrl && o.layers.music
        ? { music: { type: 'audio' as const, label: 'Music', url: o.musicUrl, duration: Math.max(musicSeconds, total), storagePath: o.layers.music.storagePath } }
        : {}),
    });
  };
```
Replace the open effect's async body with:
```ts
      let draft: { project: EditProject; uploads: Material[] } | null = null;
      try {
        const raw = localStorage.getItem(draftKey);
        const d = raw ? (JSON.parse(raw) as { project?: EditProject; uploads?: Material[] }) : null;
        if (d?.project && (d.project.version === 1 || d.project.version === 2)) draft = { project: d.project, uploads: d.uploads ?? [] };
      } catch {
        /* a draft that cannot be read is started over */
      }
      if (draft?.project.version === 2) return begin(draft.project, draft.uploads);

      setPreparing(true);
      const opened = await api.editOpen(run.jobId, { brief, sceneOverrides });
      if (!alive) return;
      setPreparing(false);
      if (!isApiError(opened)) {
        const layered = opened.mode === 'edit' ? opened.editProject : await layeredProject(opened);
        if (!alive) return;
        if (opened.mode === 'layers' && opened.note) setNotice(opened.note);
        if (draft) return setDraftChoice({ draft, layered });
        return begin(layered);
      }
      // Captions and logos stay part of the picture: the film opens as it always did.
      setNotice(opened.message);
      if (draft) return begin(draft.project, draft.uploads);
      const d = run.finalUrl ? (await mediaDuration(run.finalUrl, 'video')) || run.totalSeconds || 0 : 0;
      if (!alive) return;
      const start = newEditProject(asAspect(run.aspect));
      const first =
        run.finalUrl && d > 0
          ? addEditClip(
              start,
              { trackId: EDIT_MAIN_TRACK, start: 0, in: 0, out: d, source: runSource(run, d), speed: 1, volume: 1, fadeIn: 0, fadeOut: 0 },
              { magnet: true },
            ).project
          : start;
      setDurations((cur) => ({ ...cur, [`run:${run.jobId}`]: d }));
      begin(first);
```
In the player box change `<div className="ve-empty">Loading the film…</div>` to:
```tsx
<div className="ve-empty">{preparing ? "Preparing this film's layers — the first time only, about as long as a restitch." : 'Loading the film…'}</div>
```
Before the demo export modal add:
```tsx
      {draftChoice && (
        <div className="ve-modal-wrap" role="dialog" aria-label="An earlier draft">
          <div className="ve-modal">
            <h3>You have an earlier draft of this edit</h3>
            <div className="ve-hint">
              It was made on the finished film, so its captions and logos are part of the picture and cannot be moved.
              Starting again opens them as layers you can click, drag and change.
            </div>
            <div className="ve-row end">
              <button type="button" className="ve-btn ghost" onClick={() => { const d = draftChoice.draft; setDraftChoice(null); begin(d.project, d.uploads); }}>
                Continue that draft
              </button>
              <button type="button" className="ve-btn primary" onClick={() => { const l = draftChoice.layered; setDraftChoice(null); begin(l); }}>
                Start with layers
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 4: Check** — `npx tsc --noEmit -p apps/web/tsconfig.json` → clean; `npm run build -w @ava/web` → builds.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/lib/api.ts apps/web/src/components/GenerationPanel.tsx apps/web/src/components/VideoEditor.tsx
git commit -m "The editor opens a film as its clean footage and its layers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Timeline rows come from the edit's tracks

**Files:**
- Modify: `apps/web/src/components/VideoEditor.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: track ids and `editClipKind` (Task 3).
- Produces: `rowH(id)`, `TRACK_LABEL`, `clipLabel(c)` inside `VideoEditor.tsx`.

- [ ] **Step 1: Rows and labels** — add `EDIT_CAPTION_TRACK, EDIT_DEALER_LOGO_TRACK, EDIT_BRAND_LOGO_TRACK, EDIT_FOOTER_TRACK, editClipKind` to the `@ava/shared` import. Replace `const ROW_H = …` with:
```ts
const ROW_H: Record<string, number> = {
  [EDIT_CAPTION_TRACK]: 36,
  [EDIT_DEALER_LOGO_TRACK]: 30,
  [EDIT_BRAND_LOGO_TRACK]: 30,
  [EDIT_FOOTER_TRACK]: 30,
  [EDIT_TEXT_TRACK]: 36,
  [EDIT_MAIN_TRACK]: 66,
  [EDIT_AUDIO_TRACK]: 42,
};
const rowH = (id: string): number => ROW_H[id] ?? 36;
const TRACK_LABEL: Record<string, string> = {
  [EDIT_CAPTION_TRACK]: 'Captions',
  [EDIT_DEALER_LOGO_TRACK]: 'Dealer logo',
  [EDIT_BRAND_LOGO_TRACK]: 'Brand logo',
  [EDIT_FOOTER_TRACK]: 'Footer',
  [EDIT_TEXT_TRACK]: 'Text',
  [EDIT_MAIN_TRACK]: 'Main',
  [EDIT_AUDIO_TRACK]: 'Sound',
};
/** What a clip is called on its bar and in its panel. */
const clipLabel = (c: EditClip): string =>
  c.layer?.kind === 'caption'
    ? c.layer.text
    : c.layer?.kind === 'footer'
      ? c.layer.text || 'Footer'
      : c.layer?.kind === 'logo'
        ? c.layer.which === 'dealer' ? 'Dealer logo' : 'Brand logo'
        : c.layer?.kind === 'endcard'
          ? 'End card'
          : (c.text ?? c.source?.label ?? '');
```
Replace every `ROW_H[id]` with `rowH(id)`; replace `const trackRows = [EDIT_TEXT_TRACK, EDIT_MAIN_TRACK, EDIT_AUDIO_TRACK];` with `const trackRows = project.tracks.map((t) => t.id);`; in the track header use `{TRACK_LABEL[id] ?? id}` and render the mute button when `t?.kind === 'video' || t?.kind === 'audio'`; replace both `c.text !== undefined ? 'text' : (c.source?.type ?? 'video')` derivations with `editClipKind(c)`; on the clip bar use `className={\`ve-clip ${kind}${c.layer ? \` ${c.layer.kind}\` : ''}${c.id === selectedId ? ' on' : ''}\`}`, `title={clipLabel(c)}` and `{clipLabel(c)}` in `.ve-clip-label`; in the clip panel header use `{clipLabel(c)}`.

- [ ] **Step 2: Colours** — append to `styles.css` after `.ve-clip.text`:
```css
.ve-clip.layer { background: #2f5d62; }
.ve-clip.layer.caption { background: #6b4fa0; }
.ve-clip.layer.logo { background: #7a5b2c; }
.ve-clip.layer.footer { background: #3b5b7a; }
.ve-clip.layer.endcard { background: #1f3a5f; }
```

- [ ] **Step 3: Check** — `npx tsc --noEmit -p apps/web/tsconfig.json` → clean; `npm run build -w @ava/web` → builds.

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/components/VideoEditor.tsx apps/web/src/styles.css
git commit -m "The timeline shows a row for every layer the film has

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 11: Layers in the preview — see them, select, drag, resize, snap, nudge

**Files:**
- Create: `apps/web/src/components/editor/useLayerImages.ts`
- Create: `apps/web/src/components/editor/LayerStage.tsx`
- Modify: `apps/web/src/components/VideoEditor.tsx` (preview, end card, key handler)
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `api.drawLayer`, `refUrl` (Task 9); `editLayerGuides`, `editSnapBox`, `editCaptionSpots` (Task 3).
- Produces: `useLayerImages(clips, look): Map<string, LayerImage>` with `LayerImage { url; width; height }` (pixels on the film's frame, scale included); `<LayerStage project look viewTime stageW stageH selectedId images fadeOpacity readOnly onSelect onMove onCommit onNudge />`.

- [ ] **Step 1: Layer pictures** — `apps/web/src/components/editor/useLayerImages.ts`
```ts
import { useEffect, useRef, useState } from 'react';
import type { EditClip, EditLayer, EditLook } from '@ava/shared';
import { api, isApiError, refUrl } from '../../lib/api.js';

export interface LayerImage {
  url: string;
  /** Pixels on the film's frame, at the layer's size. */
  width: number;
  height: number;
}
type Drawn = Exclude<EditLayer, { kind: 'logo' }>;

/** Pictures already drawn, for as long as the page is open: the same words in the same look are drawn once. */
const drawn = new Map<string, Promise<LayerImage | null>>();

const keyOf = (layer: Drawn, look: EditLook, scale: number): string =>
  JSON.stringify([layer, look.colours, look.width, look.height, look.captionHeadSize ?? 0, layer.kind === 'caption' ? Math.round(scale * 100) / 100 : 1]);

function draw(layer: Drawn, look: EditLook, scale: number): Promise<LayerImage | null> {
  const key = keyOf(layer, look, scale);
  let p = drawn.get(key);
  if (!p) {
    p = api
      .drawLayer(layer, look, layer.kind === 'caption' ? scale : 1)
      .then((r) => (isApiError(r) || !r.png ? null : { url: `data:image/png;base64,${r.png}`, width: r.width, height: r.height }));
    drawn.set(key, p);
    // A picture that could not be drawn is asked for again next time.
    void p.then((img) => {
      if (!img) drawn.delete(key);
    });
  }
  return p;
}

/**
 * Every layer's picture, by clip id. A caption being typed keeps its last picture until
 * the new one is drawn, a quarter of a second after the typing stops.
 */
export function useLayerImages(clips: EditClip[], look: EditLook | undefined): Map<string, LayerImage> {
  const [images, setImages] = useState(() => new Map<string, LayerImage>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const layered = look ? clips.filter((c) => c.layer && c.layer.kind !== undefined) : [];
  const signature = look
    ? JSON.stringify([look, layered.map((c) => [c.id, c.layer, c.place?.scale ?? 1])])
    : '';

  useEffect(() => {
    if (!look) return;
    let alive = true;
    const put = (id: string, img: LayerImage): void =>
      setImages((m) => {
        const cur = m.get(id);
        if (cur && cur.url === img.url && cur.width === img.width && cur.height === img.height) return m;
        const next = new Map(m);
        next.set(id, img);
        return next;
      });
    for (const c of layered) {
      const layer = c.layer!;
      const scale = c.place?.scale ?? 1;
      if (layer.kind === 'logo') {
        put(c.id, { url: refUrl(layer.colourPath), width: layer.w * scale, height: layer.h * scale });
        continue;
      }
      const fetchIt = (): void =>
        void draw(layer, look, scale).then((img) => {
          if (alive && img) put(c.id, img);
        });
      if (drawn.has(keyOf(layer, look, scale))) fetchIt();
      else timers.current.set(c.id, setTimeout(fetchIt, 250));
    }
    return () => {
      alive = false;
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return images;
}
```

- [ ] **Step 2: The stage** — `apps/web/src/components/editor/LayerStage.tsx`
```tsx
import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  EDIT_MAIN_TRACK,
  editCaptionSpots,
  editClipEnd,
  editLayerGuides,
  editSnapBox,
  type EditClip,
  type EditLook,
  type EditPlacement,
  type EditProject,
} from '@ava/shared';
import { refUrl } from '../../lib/api.js';
import type { LayerImage } from './useLayerImages.js';

/** Captions under logos, logos under the footer — the order the film draws them in. */
const PAINT: Record<string, number> = { caption: 0, logo: 1, footer: 2 };

interface Props {
  project: EditProject;
  look: EditLook;
  viewTime: number;
  stageW: number;
  stageH: number;
  selectedId: string | null;
  images: Map<string, LayerImage>;
  fadeOpacity: (c: EditClip, t: number) => number;
  readOnly: boolean;
  onSelect: (id: string) => void;
  /** A drag in progress: shown, not yet a step of history. */
  onMove: (id: string, place: EditPlacement) => void;
  /** A drag finished: one step of history, from the edit as it was when the drag began. */
  onCommit: (before: EditProject) => void;
  onNudge: (id: string, place: EditPlacement) => void;
  /** Double-click on a caption: its words, ready to type. */
  onEditText: (id: string) => void;
}

interface Drag {
  id: string;
  mode: 'move' | 'scale';
  before: EditProject;
  x0: number;
  y0: number;
  place: EditPlacement;
  w: number;
  h: number;
  moved: boolean;
}

/**
 * The film's layers over the preview. Each is the picture the export will draw, placed
 * where the export will place it; click one to select it, drag it to move it, drag its
 * corner to resize it, and use the arrow keys to nudge it.
 */
export function LayerStage(props: Props) {
  const { project, look, viewTime, stageW, stageH, selectedId, images } = props;
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [caught, setCaught] = useState<{ x?: number; y?: number }>({});

  const hidden = new Set(project.tracks.filter((t) => t.hidden).map((t) => t.id));
  const endCardStart = project.clips.find((c) => c.trackId === EDIT_MAIN_TRACK && c.layer?.kind === 'endcard')?.start;
  const shown = project.clips
    .filter((c) => c.layer && c.layer.kind !== 'endcard' && c.place && !hidden.has(c.trackId) && viewTime >= c.start && viewTime < editClipEnd(c))
    .sort((a, b) => (PAINT[a.layer!.kind] ?? 0) - (PAINT[b.layer!.kind] ?? 0));

  const sizeOf = (c: EditClip): { w: number; h: number } => {
    const img = images.get(c.id);
    return c.layer?.kind === 'footer'
      ? { w: 1, h: (img?.height ?? 0) / look.height }
      : { w: (img?.width ?? 0) / look.width, h: (img?.height ?? 0) / look.height };
  };

  const begin = (e: ReactPointerEvent<HTMLElement>, c: EditClip, mode: Drag['mode']): void => {
    e.stopPropagation();
    box.current?.focus();
    props.onSelect(c.id);
    if (props.readOnly) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = sizeOf(c);
    drag.current = { id: c.id, mode, before: project, x0: e.clientX, y0: e.clientY, place: c.place!, w: s.w, h: s.h, moved: false };
  };

  const move = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (!d || !stageW || !stageH) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < 3) return;
    d.moved = true;
    const dx = (e.clientX - d.x0) / stageW;
    const dy = (e.clientY - d.y0) / stageH;
    const clip = project.clips.find((c) => c.id === d.id);
    if (!clip) return;
    if (d.mode === 'scale') {
      props.onMove(d.id, { ...d.place, scale: Math.max(0.5, Math.min(2, d.place.scale * (1 + dx / Math.max(0.05, d.w)))) });
      return;
    }
    const footer = clip.layer?.kind === 'footer';
    let x = footer ? 0 : d.place.x + dx;
    let y = d.place.y + dy;
    if (e.altKey) {
      setCaught({});
    } else {
      const snapped = editSnapBox({ x, y }, { w: d.w, h: d.h }, editLayerGuides(look), { x: 8 / stageW, y: 8 / stageH });
      x = footer ? 0 : snapped.x;
      y = snapped.y;
      setCaught(footer ? { y: snapped.caught.y } : snapped.caught);
      if (clip.layer?.kind === 'caption') {
        const footerClip = project.clips.find((c) => c.layer?.kind === 'footer');
        const footerH = footerClip ? (images.get(footerClip.id)?.height ?? 0) : 0;
        const spot = editCaptionSpots(look, { w: d.w * look.width, h: d.h * look.height }, footerH).find(
          (s) => Math.abs(s.x - x) * stageW < 12 && Math.abs(s.y - y) * stageH < 12,
        );
        if (spot) {
          x = spot.x;
          y = spot.y;
        }
      }
    }
    props.onMove(d.id, { ...d.place, x, y });
  };

  const end = (): void => {
    const d = drag.current;
    drag.current = null;
    setCaught({});
    if (d?.moved) props.onCommit(d.before);
  };

  const nudge = (e: KeyboardEvent<HTMLDivElement>): void => {
    const c = project.clips.find((x) => x.id === selectedId && x.layer && x.place);
    const step = e.shiftKey ? 0.05 : 0.005;
    const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[e.key];
    if (!c || !d || props.readOnly) return;
    e.preventDefault();
    props.onNudge(c.id, { ...c.place!, x: c.layer!.kind === 'footer' ? 0 : c.place!.x + d[0], y: c.place!.y + d[1] });
  };

  return (
    <div className="ve-layers" ref={box} tabIndex={-1} onKeyDown={nudge}>
      {shown.map((c) => {
        const img = images.get(c.id);
        if (!img) return null;
        const layer = c.layer!;
        const white =
          layer.kind === 'logo' && layer.whiteOnEndCard && layer.whitePath && endCardStart !== undefined && viewTime >= endCardStart
            ? refUrl(layer.whitePath)
            : null;
        return (
          <div
            key={c.id}
            className={`ve-layer-box ${layer.kind}${c.id === selectedId ? ' on' : ''}`}
            style={{
              left: `${c.place!.x * 100}%`,
              top: `${c.place!.y * 100}%`,
              width: layer.kind === 'footer' ? '100%' : `${(img.width / look.width) * 100}%`,
              opacity: props.fadeOpacity(c, viewTime),
            }}
            onPointerDown={(e) => begin(e, c, 'move')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onDoubleClick={() => layer.kind === 'caption' && props.onEditText(c.id)}
          >
            <img src={white ?? img.url} alt="" draggable={false} />
            {c.id === selectedId && !props.readOnly && layer.kind !== 'footer' && (
              <span
                className="ve-layer-handle"
                aria-label="Resize"
                onPointerDown={(e) => begin(e, c, 'scale')}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
              />
            )}
          </div>
        );
      })}
      {caught.x !== undefined && <div className="ve-guide v" style={{ left: `${caught.x * 100}%` }} />}
      {caught.y !== undefined && <div className="ve-guide h" style={{ top: `${caught.y * 100}%` }} />}
    </div>
  );
}
```

- [ ] **Step 3: Wire it into the preview** — in `VideoEditor.tsx` import `LayerStage` from `./editor/LayerStage.js`, `useLayerImages` from `./editor/useLayerImages.js`, and `type EditPlacement` from `@ava/shared`. After the `texts` constant add:
```ts
  const layerImages = useLayerImages(project.clips, project.look);
  const placeLayer = (id: string, place: EditPlacement): void => live(updateEditClip(projectRef.current, id, { place }));
  const commitLayer = (before: EditProject): void => commit(projectRef.current, before);
  const nudgeLayer = (id: string, place: EditPlacement): void => edit(`nudge:${id}`, updateEditClip(projectRef.current, id, { place }));
```
Inside `.ve-stage`, right after the main still `<img>` block and before `{texts.map(…)}`, add:
```tsx
                {mainClip?.layer?.kind === 'endcard' && layerImages.get(mainClip.id) && (
                  <img className="ve-layer" src={layerImages.get(mainClip.id)!.url} alt="" style={{ opacity: fadeOpacity(mainClip, viewTime) * transitionProgress }} />
                )}
                {project.look && (
                  <LayerStage
                    project={project}
                    look={project.look}
                    viewTime={viewTime}
                    stageW={stageW}
                    stageH={stageH}
                    selectedId={selectedId}
                    images={layerImages}
                    fadeOpacity={fadeOpacity}
                    readOnly={demo}
                    onSelect={(id) => {
                      setSelectedId(id);
                      setPanel('clip');
                    }}
                    onMove={placeLayer}
                    onCommit={commitLayer}
                    onNudge={nudgeLayer}
                    onEditText={(id) => {
                      setSelectedId(id);
                      setPanel('clip');
                      setTimeout(() => document.querySelector<HTMLTextAreaElement>('.ve-props textarea')?.focus(), 0);
                    }}
                  />
                )}
```
In the window key handler, directly after the INPUT/TEXTAREA guard, add:
```ts
      // Arrow keys belong to a selected layer while the preview has focus.
      if (e.key.startsWith('Arrow') && t?.closest?.('.ve-layers')) return;
```

- [ ] **Step 4: Styles** — append to `styles.css`:
```css
.ve-layers { position: absolute; inset: 0; pointer-events: none; outline: none; }
.ve-layer-box { position: absolute; pointer-events: auto; cursor: move; touch-action: none; }
.ve-layer-box img { display: block; width: 100%; height: auto; user-select: none; -webkit-user-drag: none; }
.ve-layer-box.footer { cursor: ns-resize; }
.ve-layer-box.on { outline: 1.5px solid #38bdf8; outline-offset: 2px; }
.ve-layer-handle { position: absolute; right: -7px; bottom: -7px; width: 14px; height: 14px; border-radius: 50%; background: #38bdf8; border: 2px solid #fff; cursor: nwse-resize; touch-action: none; }
.ve-guide { position: absolute; pointer-events: none; background: #f472b6; }
.ve-guide.v { top: 0; bottom: 0; width: 1px; }
.ve-guide.h { left: 0; right: 0; height: 1px; }
```

- [ ] **Step 5: Check** — `npx tsc --noEmit -p apps/web/tsconfig.json` → clean; `npm run build -w @ava/web` → builds.

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/components/editor/useLayerImages.ts apps/web/src/components/editor/LayerStage.tsx apps/web/src/components/VideoEditor.tsx apps/web/src/styles.css
git commit -m "Captions, logos and the footer sit in the preview where the export will draw them, and drag, resize and nudge there

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 12: Panels for each layer

**Files:**
- Create: `apps/web/src/components/editor/LayerPanel.tsx`
- Modify: `apps/web/src/components/VideoEditor.tsx` (`clipPanel`)
- Modify: `apps/web/src/lib/client.ts` (only if `uploadRef` does not already return `white`)
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `api.fitLogo`, `refUrl`, `uploadRef` (Task 9); `LayerImage` (Task 11); `editCaptionSpots`, `editSetEndCardSeconds`, `CARD_POSITIONS`, `OVERLAY_THEMES`, `overlayTheme`, `CUSTOM_THEME_ID`, `LookPicker`.
- Produces: `<LayerPanel clip project look images readOnly onPatch onProject onDelete onNotice />`.

- [ ] **Step 1: Make sure a logo upload returns its white version** — open `uploadRef` in `apps/web/src/lib/client.ts`. Its POST response type already has `white?`; if the returned object does not include it, add `...(r.white ? { white: r.white } : {}),` to the object it returns.

- [ ] **Step 2: The panel** — `apps/web/src/components/editor/LayerPanel.tsx`
```tsx
import { useRef, useState } from 'react';
import {
  CARD_POSITIONS,
  CUSTOM_THEME_ID,
  OVERLAY_THEMES,
  editCaptionSpots,
  editClipLength,
  editSetEndCardSeconds,
  overlayTheme,
  updateEditClip,
  type EditClip,
  type EditLayer,
  type EditLook,
  type EditProject,
} from '@ava/shared';
import { api, isApiError, refUrl } from '../../lib/api.js';
import { uploadRef } from '../../lib/client.js';
import { LookPicker } from '../LookPicker.js';
import type { LayerImage } from './useLayerImages.js';

interface Props {
  clip: EditClip;
  project: EditProject;
  look: EditLook;
  images: Map<string, LayerImage>;
  readOnly: boolean;
  /** A change to this clip; the key groups quick changes into one step of history. */
  onPatch: (key: string, patch: Partial<EditClip>) => void;
  /** A change that reaches beyond this clip, such as the end card's length or the look. */
  onProject: (key: string, next: EditProject) => void;
  onDelete: () => void;
  onNotice: (text: string) => void;
}

const colourKeys = ['panel', 'text', 'accent', 'card', 'cardText', 'cardMuted'] as const;
const sameColours = (a: EditLook['colours'], b: EditLook['colours']) => colourKeys.every((k) => a[k].toLowerCase() === b[k].toLowerCase());

export function LayerPanel({ clip, project, look, images, readOnly, onPatch, onProject, onDelete, onNotice }: Props) {
  const layer = clip.layer!;
  const place = clip.place;
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const setLayer = (key: string, next: EditLayer): void => onPatch(key, { layer: next });

  const reset = (): void => {
    const o = clip.original;
    if (!o) return;
    if (layer.kind === 'endcard' && o.layer?.kind === 'endcard') {
      onProject('reset', editSetEndCardSeconds(updateEditClip(project, clip.id, { layer: o.layer }), clip.id, o.out - o.in));
      return;
    }
    onPatch('reset', { start: o.start, in: o.in, out: o.out, layer: o.layer, place: o.place });
  };

  const size = place && layer.kind !== 'footer' && (
    <label className="ve-field">
      <span>Size · {Math.round(place.scale * 100)}%</span>
      <input type="range" min={0.5} max={2} step={0.05} value={place.scale} disabled={readOnly}
        onChange={(e) => onPatch('scale', { place: { ...place, scale: Number(e.target.value) } })} />
    </label>
  );

  const footerClip = project.clips.find((c) => c.layer?.kind === 'footer');
  const footerH = footerClip ? (images.get(footerClip.id)?.height ?? 0) : 0;

  const endCard = project.clips.find((c) => c.layer?.kind === 'endcard')?.layer;
  const dealerLine = endCard?.kind === 'endcard' ? endCard.lines[0] : undefined;
  const themeNow = OVERLAY_THEMES.find((t) => sameColours(t, look.colours));
  const custom = { panel: look.colours.panel, accent: look.colours.accent };

  const replaceLogo = async (f: File | undefined): Promise<void> => {
    if (!f || layer.kind !== 'logo') return;
    setBusy(true);
    const up = await uploadRef(f, layer.which === 'dealer' ? 'Dealer logo' : 'Brand logo', 'logo');
    if (isApiError(up)) {
      setBusy(false);
      onNotice(up.message);
      return;
    }
    const fit = await api.fitLogo(up.storagePath, up.white?.storagePath, look);
    setBusy(false);
    if (isApiError(fit)) return onNotice(fit.message);
    setLayer('logo', { ...layer, colourPath: fit.colourPath, whitePath: fit.whitePath, w: fit.w, h: fit.h, whiteOnEndCard: layer.whiteOnEndCard && Boolean(fit.whitePath) });
  };

  return (
    <div className="ve-props">
      <div className="ve-props-head">
        <b>{layer.kind === 'caption' ? 'Caption' : layer.kind === 'footer' ? 'Footer' : layer.kind === 'logo' ? (layer.which === 'dealer' ? 'Dealer logo' : 'Brand logo') : 'End card'}</b>
        <span>{editClipLength(clip).toFixed(1)}s · this film only</span>
      </div>

      {layer.kind === 'caption' && place && (() => {
        const img = images.get(clip.id);
        const spots = img ? editCaptionSpots(look, { w: img.width, h: img.height }, footerH) : [];
        const spotNow = spots.find((s) => Math.abs(s.x - place.x) < 0.002 && Math.abs(s.y - place.y) < 0.002)?.spot ?? 'custom';
        return (
          <>
            <label className="ve-field">
              <span>Words</span>
              <textarea rows={2} maxLength={200} value={layer.text} disabled={readOnly} onChange={(e) => setLayer('text', { ...layer, text: e.target.value })} />
            </label>
            {!layer.text.trim() && <div className="ve-hint">A caption needs words. To take it off the film, delete it.</div>}
            <label className="ve-field">
              <span>Second line</span>
              <input maxLength={200} value={layer.sub ?? ''} disabled={readOnly}
                onChange={(e) => setLayer('sub', { kind: 'caption', text: layer.text, ...(e.target.value ? { sub: e.target.value } : {}) })} />
            </label>
            <label className="ve-field">
              <span>Position</span>
              <select value={spotNow} disabled={readOnly || !spots.length}
                onChange={(e) => {
                  const s = spots.find((x) => x.spot === e.target.value);
                  if (s) onPatch('place', { place: { ...place, x: s.x, y: s.y } });
                }}>
                {CARD_POSITIONS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
                <option value="custom" disabled>Where you dragged it</option>
              </select>
            </label>
            {size}
          </>
        );
      })()}

      {layer.kind === 'footer' && place && (
        <>
          <label className="ve-field">
            <span>Text</span>
            <textarea rows={2} maxLength={300} value={layer.text} disabled={readOnly} onChange={(e) => setLayer('text', { ...layer, text: e.target.value })} />
          </label>
          <label className="ve-field">
            <span>Position</span>
            <select value={place.y <= 0.001 ? 'top' : Math.abs(place.y - (look.height - footerH) / look.height) < 0.002 ? 'bottom' : 'custom'} disabled={readOnly}
              onChange={(e) => onPatch('place', { place: { ...place, x: 0, y: e.target.value === 'top' ? 0 : (look.height - footerH) / look.height } })}>
              <option value="bottom">Bottom</option>
              <option value="top">Top</option>
              <option value="custom" disabled>Where you dragged it</option>
            </select>
          </label>
        </>
      )}

      {layer.kind === 'logo' && place && (
        <>
          <div className="ve-logo-preview"><img src={refUrl(layer.colourPath)} alt="" /></div>
          <button type="button" className="ve-btn ghost" disabled={readOnly || busy} onClick={() => file.current?.click()}>
            {busy ? 'Fitting the logo…' : 'Replace logo'}
          </button>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void replaceLogo(e.target.files?.[0])} />
          {size}
          <label className="ve-check">
            <input type="checkbox" checked={layer.whiteOnEndCard} disabled={readOnly || !layer.whitePath}
              onChange={(e) => setLayer('white', { ...layer, whiteOnEndCard: e.target.checked })} />
            <span>White on a dark end card</span>
          </label>
        </>
      )}

      {layer.kind === 'endcard' && (
        <>
          <label className="ve-field">
            <span>Lines · name, call to action, contact</span>
            <textarea rows={4} value={layer.lines.join('\n')} disabled={readOnly}
              onChange={(e) => setLayer('lines', { kind: 'endcard', lines: e.target.value.split('\n').slice(0, 6).map((l) => l.slice(0, 160)) })} />
          </label>
          <label className="ve-field">
            <span>Holds for · {editClipLength(clip).toFixed(1)}s</span>
            <input type="range" min={1} max={8} step={0.5} value={editClipLength(clip)} disabled={readOnly}
              onChange={(e) => onProject('seconds', editSetEndCardSeconds(project, clip.id, Number(e.target.value)))} />
          </label>
        </>
      )}

      <div className="ve-field">
        <span>Look · every layer</span>
        <LookPicker
          value={themeNow?.id ?? CUSTOM_THEME_ID}
          custom={custom}
          dealer={dealerLine}
          footer={footerClip?.layer?.kind === 'footer' ? footerClip.layer.text : undefined}
          onChange={(patch) => {
            if (readOnly) return;
            const t = overlayTheme(patch.overlayThemeId ?? themeNow?.id ?? CUSTOM_THEME_ID, patch.overlayCustom ?? custom);
            onProject('look', { ...project, look: { ...look, colours: { panel: t.panel, text: t.text, accent: t.accent, card: t.card, cardText: t.cardText, cardMuted: t.cardMuted } } });
          }}
        />
      </div>

      <div className="ve-row">
        <button type="button" className="ve-btn ghost" disabled={readOnly || !clip.original} onClick={reset}>Reset to original</button>
        <button type="button" className="ve-btn ghost" disabled={readOnly} onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}
```
(If `LookPicker`'s `onChange` patch type lacks `overlayThemeId`/`overlayCustom`, read `ProjectVideoSpec` in `packages/shared/src/library.ts` for the exact field names and use those.)

- [ ] **Step 3: Use it** — in `VideoEditor.tsx` import `LayerPanel` from `./editor/LayerPanel.js`; at the top of `clipPanel`, before `const len = …`, add:
```tsx
    if (c.layer && projectRef.current.look) {
      return (
        <LayerPanel
          clip={c}
          project={projectRef.current}
          look={projectRef.current.look}
          images={layerImages}
          readOnly={demo}
          onPatch={(key, patch) => edit(`${key}:${c.id}`, updateEditClip(projectRef.current, c.id, patch))}
          onProject={(key, next) => edit(`${key}:${c.id}`, next)}
          onDelete={deleteNow}
          onNotice={setNotice}
        />
      );
    }
```
(`clipPanel` is declared after `layerImages`; if not, move the `useLayerImages` line above `clipPanel`.)

- [ ] **Step 4: Styles** — append:
```css
.ve-logo-preview { padding: 10px; border-radius: 6px; background: repeating-conic-gradient(#334155 0% 25%, #1e293b 0% 50%) 50% / 14px 14px; }
.ve-logo-preview img { display: block; max-height: 56px; max-width: 100%; margin: 0 auto; }
.ve-check { display: flex; align-items: center; gap: 8px; font-size: 13px; }
```

- [ ] **Step 5: Check** — `npx tsc --noEmit -p apps/web/tsconfig.json` → clean; `npm run build -w @ava/web` → builds.

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/components/editor/LayerPanel.tsx apps/web/src/components/VideoEditor.tsx apps/web/src/lib/client.ts apps/web/src/styles.css
git commit -m "Change a caption's words, the footer, a logo, the end card and the look, for this film only

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Verification, review and preview

**Files:** none created in the repo beyond fixes; verification tooling lives in the session scratchpad.

- [ ] **Step 1: Every check** — run and require all to pass:
`npm test -w @ava/shared`; `npm test -w @ava/api` (ffmpeg present, so nothing skips); `npx tsc --noEmit` for `packages/shared`, `apps/api`, `apps/web`; `npm run build -w @ava/web`.

- [ ] **Step 2: Editor in a real browser, with the server stubbed** — in the scratchpad harness, mount `VideoEditor` with a stub `run` and replace `api.editOpen` / `api.drawLayer` with functions returning: the `layeredFixture()` film's layers (Task 8), a `cleanUrl` served from the harness, and layer PNGs produced by `drawLayer` in a one-off node script. Headless Chrome at 1440×900 and 400×800, capturing screenshots and asserting in the page:
  1. at t = middle of the first caption, the caption, both logos and the footer are drawn at their recorded positions (compare element boxes with `place` × stage size, within 2 px);
  2. a pointer drag of the caption by (+120, −300) px moves its `place`, shows a guide when crossing the centre line, and one Undo (⌘Z) puts it back;
  3. with the caption selected, ArrowRight moves it by 0.5% of the frame and does not move the playhead;
  4. the caption panel's text change redraws the caption within a second; the end card slider to 5 s lengthens the logo, footer and music bars to the new end;
  5. a film whose `editOpen` answers 409 opens flat with the message in the header;
  6. an existing v1 draft shows the "earlier draft" choice.
  Fix anything that fails, commit the fixes, re-run.

- [ ] **Step 3: Adversarial review** — run a Workflow over `git diff <commit before Task 1>..HEAD` with four lenses, three skeptical verifiers per finding (a finding survives only with no refutation): generated films unchanged (golden, generate and refine paths); layered export correctness (timing, positions, logo switch, music bed, end card); new routes (viewer access, `refs/` path validation, storage reads, single-flight build, errors); the editor (flat films, drafts, demo mode, undo, keyboard, phone width). Fix every confirmed finding with a test where one is possible; commit.

- [ ] **Step 4: Preview** — deploy the API with `gcloud run deploy ava-api --source . --no-traffic --tag preview --region asia-south1 --quiet` and the web with `VITE_API_URL=https://preview---ava-api-ofnw2ufkwa-el.a.run.app npm run build -w @ava/web && npx firebase hosting:channel:deploy preview`. Confirm: live traffic still 100% on the current live revision; preview health OK; the preview bundle contains `Start with layers` and `Preparing this film`.

- [ ] **Step 5: Hand over** — tell the user how to try it on a real film on preview (open a film in the editor, wait for "Preparing…", drag the Ganesh Chaturthi caption off her face, export), that it is free, and that nothing is live. After they try, read the preview logs for `preparing layers failed` and `edit render failed`.
