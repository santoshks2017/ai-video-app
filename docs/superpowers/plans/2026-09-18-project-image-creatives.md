# Project Image — implementation plan

**Goal:** a Project Image section that turns a brief into finished social creatives in every
platform size, with the real car, app-drawn copy and a light image editor — additive, with
the video product unchanged.

**Spec:** docs/superpowers/specs/2026-09-18-project-image-creatives-design.md

**Architecture:** the shared package holds the creative document model, the 12 engines, the
copy rules, the layout templates and the image project record. The API adds one collection
and two model routes (copy, scene). The browser holds the only renderer (canvas), the image
project page and the editor.

## Global constraints

- Nothing in the video flow changes: `projects` records, the video board, ProjectEditor,
  GenerationPanel, VideoEditor and the compositor are not modified. The shell gains one tab
  kind; Projects gains the Video | Image switch.
- Image projects live in the Firestore collection `imageProjects`.
- Costs are shown to admins only; spend is logged under "Creative copy" and "Creative images".
- Words on a creative are always app-drawn layers; the image model is told to draw none.
- Number plates: plain white and blank.
- Sizes: ig-square 1080×1080, ig-portrait 1080×1350, story 1080×1920, landscape 1200×628,
  thumbnail 1280×720.

## Files

| File | Responsibility |
|---|---|
| packages/shared/src/creative.ts | CreativeDoc/Layer types, formats, ids, validation, layer helpers |
| packages/shared/src/creativeEngines.ts | the 12 engines: fields, words, blends, classification |
| packages/shared/src/creativeCopy.ts | copy shape, rules (₹, asterisks, contact block, hashtags), palettes |
| packages/shared/src/creativeLayout.ts | layout templates → CreativeDoc for each size |
| packages/shared/src/imageProject.ts | the stored ImageProject record and its helpers |
| apps/api/src/creatives.ts | copy prompt + parse; scene instruction + drawing + vehicle check |
| apps/api/src/server.ts | collection registration, cost preservation, two routes (additive) |
| apps/web/src/components/creative/render.ts | the canvas renderer, image cache, font loading |
| apps/web/src/components/creative/CreativeEditor.tsx (+ css) | the image editor overlay |
| apps/web/src/sections/ImageProjects.tsx | the image project board/list |
| apps/web/src/sections/ImageProjectEditor.tsx | the image project page |
| apps/web/src/state/appStore.ts, App.tsx, Tabs.tsx, sections/Projects.tsx | tab kind, switch (additive) |

## Tasks

### 1. Creative document model (shared)
- `CREATIVE_FORMATS: {id, label, platforms, width, height, aspect}[]`, `CreativeFormatId`.
- `CreativeDoc`, `ImageLayer`, `TextLayer`, `ShapeLayer`, `LayerRole`.
- `validateCreativeDoc(doc): string | null`, `creativeUid()`, `layerBounds`, `moveLayer`,
  `resizeLayer`, `reorderLayer`, `duplicateLayer`, `removeLayer`, `updateLayer`.
- Tests: formats' pixels; validation rejects out-of-range numbers, unknown kinds, >60 layers.

### 2. Engines (shared)
- `CREATIVE_ENGINES` (12): `{id, label, words, fields, mandatory, beats, layout, mood}`;
  `BLENDS` with ratios; `EMOTION_ORDER`.
- `classifyCreative(text): {primary, secondary?, ratio?}` — words matched as whole words,
  blends from the table, more than two signals settled by the emotional hierarchy.
- Tests: the documents' own examples ("Navratri offer on Creta ₹50K" → festival + offer 60/40,
  "Father's Day post for Honda City" → festival).

### 3. Copy and colours (shared)
- `CreativeCopy {headline, alternatives[], sub, badge, points[], cta, terms, caption, hashtags[], seo}`.
- `tidyCopy(copy, ctx)`: ₹ formatting, asterisk on price claims and a T&C line, contact block
  at the caption's end, hashtag count in range, trims to on-image length limits.
- `OEM_PALETTES` (brand → primary/accent), `OCCASION_PALETTES` (festival → colours),
  `creativeLook(...)` → `LayerColours`-like palette for templates.
- Tests: rupee formatting cases, asterisks, contact block, palette lookup.

### 4. Layout templates (shared)
- `CREATIVE_TEMPLATES` (hero, offer, festival, feature, launch, delivery).
- `layoutCreative({format, template, copy, look, logos, panel, picture}): CreativeDoc`.
- Tests: every template × every size validates and keeps every layer inside the frame; logos
  follow placement; the panel sits at the foot; roles present.

### 5. Image project record (shared)
- `ImageProject` (stored), `emptyImageProject()`, `ImageCreative {id, format, doc, png?, approved?}`.

### 6. API
- Add `imageProjects` to the collections; keep `totalCostInr` through saves; strip cost for
  non-admins.
- `creatives.ts`: `buildCopyPrompt`, `parseCopy`, `writeCreativeCopy`, `sceneInstruction`,
  `drawCreativeScene`.
- Routes: `POST /api/creatives/copy`, `POST /api/creatives/scene`; add cost to the project.
- Tests: prompt contains the engine beats, rules and facts; parse tolerates fences and bad
  JSON; the scene instruction carries the plate rule and the no-text rule.

### 7. Renderer (web)
- `renderCreative(ctx, doc, {scale, images, selection?})`, `loadCreativeFonts(doc)`,
  `useCreativeImages`, `exportCreative(doc, 'png'|'jpeg')`, text fitting with canvas metrics.

### 8. Shell and Projects switch (web)
- Tab kind `imageProject`; `goImageProject(id)`; `imageProjects` in the store's refresh.
- Projects header: Video | Image switch (remembered); Image renders ImageProjectsSection.

### 9. Image project page (web)
- Brief, Sizes & look, Copy, Picture, Creatives gallery; downloads and zip; approve; costs
  for admins.

### 10. Image editor (web)
- Canvas stage with selection, drag, resize (8 handles), rotate, snapping guides, nudge,
  zoom; layers panel (reorder, hide, lock, rename, duplicate, delete); properties panel for
  text, shape, image (adjustments, fit, focal point, flip, replace), document; undo/redo;
  add text/shape/image; save; export PNG/JPG; read-only for viewers.

### 11. Verification and preview
- Shared + API tests, type-checks, web build; browser harness checks at desktop and phone
  width; video board and editor unchanged; preview deploy; one real brief end to end.
