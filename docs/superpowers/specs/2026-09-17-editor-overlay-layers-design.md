# Overlays as editable layers in the video editor

Date: 2026-09-17 · Status: proposed, waiting for review

## What this gives the team

Everything added to a film after the AI renders it — the captions, the footer panel, the
dealer logo, the brand logo and the end card — opens in the video editor as its own layer:

- **Click it** in the preview to select it; its bar on the timeline lights up and its panel opens.
- **Drag it** anywhere in the frame. Snap guides show the centre lines, the safe margin, and
  the seven places Auto puts a caption.
- **Resize it** from its corner (captions and logos).
- **Edit it**: a caption's words and second line, the footer's text, a logo's image, the end
  card's lines and how long it holds, and the look (Midnight, Showroom Red…) for all of them at once.
- **Retime it**: move or trim its bar on the timeline, like any clip.

Export draws the layers onto the film's clean footage and saves a new version. No AI, no cost.
A layer nobody touched comes out exactly as the original film drew it. An edit changes that
version only: Clients and the project remain the source for every future film.

## Why the editor cannot do this today

- **There is no clean footage.** `composeFinal` (apps/api/src/post.ts) joins the segments,
  scales them, applies pace, appends the end card, mixes the music and draws every overlay in
  one ffmpeg graph. The overlay-free picture exists only as a label inside that graph. A job
  stores its raw segments (`clips[].storagePath`) and the finished composite
  (`finalStoragePath`), nothing between.
- **Nothing records where the overlays went.** Caption windows, the chosen spot (Auto's
  choice only reaches a log line), card sizes, the footer's height and each logo's box are
  computed and discarded.
- **The editor only knows the finished film.** It seeds its main track with `run.finalUrl`,
  and export loads `job.finalStoragePath`, so captions and logos are already pixels. Its
  model has video, text and audio only; its timeline rows are hard-coded to those three; and
  nothing in the preview can be dragged.
- **The music is timed to the end card.** The bed's length, loudness pass, fade-out and the
  dip over the end card are all computed with the end card's seconds included, so an
  editable end card means the music has to be mixed at export, not baked in.

What already exists and is reused rather than imitated: `cardPng`, `footerPng`,
`endCardPng`, `fitLogo`, `logoStrip`, `cleanLogo`, `spotXY` and the speech-span ducking.
These draw each overlay as its own PNG from the frame size and the look.

## Design

### 1. A film records its layers when it is composed

`composeFinal` gains an `onLayers(layers)` callback, called with everything it decided. The
filter graph and the finished film do not change.

```ts
// packages/shared/src/filmLayers.ts
interface FilmLayers {
  version: 1;
  width: number; height: number; fps: number;
  speed: number;              // the pace the parts were played at
  bodySeconds: number;        // where the footage ends and the end card begins
  theme: OverlayTheme;
  captionHeadSize?: number;   // one type size for every caption in the film
  captions: { id; text; sub?; from; to; x; y; w; h; spot; auto: boolean }[];
  footer?: { text; y; h };
  logos: { which: 'dealer' | 'brand'; colourPath; whitePath?; x; y; w; h; whiteOnEndCard: boolean }[];
  endCard?: { lines: string[]; seconds: number };
  music?: { storagePath; loudness: number; duckDb: number };
}
```

Positions are pixels on the film's own frame. Logos are recorded individually, even when two
share a corner, at the exact offsets `logoStrip` gave them, and the cleaned colour and white
versions that were drawn are stored as refs so export uses the same pixels.

It is saved on the job as `layers`. Fresh generations and retakes/restitches both record it
(retakes currently store no brief, so this is the only record of what they drew).

### 2. Clean footage is built the first time a film is opened for editing

A new mode of the same function, `composeFinal(segments, overlay, { final: false, clean: true })`,
runs everything up to the overlays and writes the footage alone: joins tightened, scaled,
paced, the last-part hold, voice audio only, no end card, no music, no overlays. It is encoded
at a higher quality than the finished film (crf 16) so the layered export is not a
generation worse. Stored at `generations/<jobId>/clean.mp4` as `cleanStoragePath`.

Building it lazily keeps generation exactly as fast as today and costs nothing for films
nobody edits. Opening a film in the editor for the first time shows "Preparing this film's
layers…" while it runs (about as long as a restitch), then never again.

A film made before this ships has no recorded layers. Its layers are rebuilt in the same pass
from what the job stored: the brief and storyboard edits for a fresh generation; for a
retake or restitch, which stored neither, the project's current settings, with a note saying
so. Auto captions are placed again, with the new face check. A film from before music beds
existed has its music inside the segments: its clean footage keeps that sound as it is, and
it gets no separate music clip.

A version saved before this (an edit, upscale or enhance) kept no segments and cannot be
split into layers. It opens as today, with a note pointing to the film it was made from.

### 3. The editor model grows layer clips

`EditProject` moves to `version: 2` (a v1 draft is still read, see 7):

```ts
type EditTrackKind = 'video' | 'text' | 'audio' | 'layer';
type EditLayer =
  | { kind: 'caption'; text: string; sub?: string }
  | { kind: 'footer'; text: string }
  | { kind: 'logo'; which: 'dealer' | 'brand'; colourPath: string; whitePath?: string; whiteOnEndCard: boolean }
  | { kind: 'endcard'; lines: string[] };
interface EditClip { /* …as today… */ layer?: EditLayer; place?: { x: number; y: number; scale: number } }
interface EditProject { version: 2; /* …as today… */ look?: { theme: OverlayTheme; width: number; height: number; captionHeadSize?: number } }
```

`place` is the layer's top-left corner as fractions of the frame, and a scale where 1 is as
designed. Opening a layered film lays out:

| Row | Holds |
|---|---|
| Captions | one bar per caption, at its recorded window and spot |
| Dealer logo, Brand logo | one bar each, for the whole film |
| Footer | one bar for the whole film, end card included (as today) |
| Text | free text, as today |
| Main | the clean footage, then the end card as its own clip |
| Sound | the film's music as a clip, ducked under the voice |

Timeline rows are built from `project.tracks` instead of the fixed three. Move, trim, split,
duplicate, delete, undo and snapping work on layer bars as on any clip.

### 4. The preview shows exactly what export will draw

The browser does not approximate a caption with CSS: fonts and line breaks would differ from
the server's. A new route, `POST /api/edits/layer`, draws one caption, footer or end card with
the same functions `composeFinal` uses, at the film's frame size and look, and returns the
PNG and its size. The editor shows that image at `place`, caches it by its content, and asks
again (debounced) only when the words or the look change. Dragging and resizing just move and
scale the image, so they are instant. Logos show their stored cleaned image.

Direct manipulation:

- Pointer down on a layer selects it (in the preview and on the timeline); dragging moves it
  with pointer capture; the corner handle scales it (0.5×–2×).
- Snap guides: frame centre lines, the safe margin, and for captions the seven Auto spots.
  Alt drags without snapping.
- Arrow keys nudge the selected layer when the preview has focus; Shift nudges further.
- Double-clicking a caption focuses its text in the panel.

### 5. Panels

- **Caption**: text, second line, position (the seven spots or Custom), size, Reset to original.
- **Footer**: text, position (bottom, top or custom height), Reset to original.
- **Logo**: replace the image (upload or paste, cleaned like a client logo), size, white on a
  dark end card, Reset to original.
- **End card**: its lines, how long it holds (1–8 s), Reset to original.
- **Look**: the overlay look picker, applied to every layer at once.

### 6. Export

`renderEditProject` (apps/api/src/editRender.ts) learns the new pieces:

- A main-track clip from a film with clean footage loads `cleanStoragePath`.
- The end card clip is drawn with `endCardPng` and plays as a still with the same 0.35 s fade.
- Layer clips are drawn with `cardPng`, `footerPng` and the stored logo images, scaled by
  `place.scale` by drawing at a proportionally scaled frame (so type stays sharp), and
  overlaid at `place` for their window. Captions keep the 0.28 s fades. Logos switch to white
  from the end card's start on a dark card. Order matches today: captions, logos, footer,
  then free text on top.
- Each overlay is looped only across its own window, as `composeFinal` does, not across the
  whole film, to stay inside the instance's memory.
- A music clip marked as the film's bed gets `composeFinal`'s treatment, factored out rather
  than copied: loudness to −20 LUFS, the dip under speech measured on the joined voice track,
  the dip over the end card, and the fade-out at the end, all computed from the edit's own
  lengths.
- The frame is the film's own size from `look`, not the editor's 720/1080 guess.

The saved version stores its `EditProject` on the job, so opening that version later restores
its layers rather than a flattened picture.

### 7. Drafts and older edits

A v1 draft in the browser for a film that can now be layered: the editor asks once whether to
continue that draft (captions and logos part of the picture) or start again with layers.

### 8. Permissions

Creators and admins edit and export, as today. The layer image route is open to viewers too:
it only draws the words and look it is sent, and exposes nothing stored, so a viewer can try
every layer tool. A viewer still cannot export, upload or replace a logo.

## Out of scope

- Writing an edit back to the client or project (decided: edits change this film only).
- Keeping layers editable through upscale and enhance, which work on the finished film.
- Rotation, animation beyond the existing fades, per-word styling.

## Risks

- **Changing `composeFinal` could change every film.** The only change on the generation
  path is the callback. Guarded by a test that builds the ffmpeg arguments for fixed inputs
  before and after and requires them to be identical.
- **An untouched layered export could drift from the original.** Guarded by rendering both
  from a real film and comparing them frame by frame with ffmpeg's SSIM, overall and inside
  each overlay's box.
- **Export memory.** Windowed overlay inputs, and a render test with the maximum 16 captions.
- **Stored refs for cleaned logos** add two small images per film.

## Verification

1. Shared tests: the v2 model, layer helpers, validation limits, v1 draft handling.
2. Compositor: filter graph unchanged on the generation path; clean footage length equals
   `bodySeconds` to within one frame; recorded caption boxes match the drawn pixels.
3. Export: an untouched layered edit against the original film by SSIM; a dragged caption
   lands at its new coordinates; a longer end card moves the music fade with it.
4. Editor: headless-browser checks of drag, resize, snapping and panels, at desktop and phone widths.
5. Preview deploy, and a real film opened, edited and exported there before anything goes live.

## Build order

1. Record layers in `composeFinal`; clean-footage mode; job fields; the rebuild pass for older films.
2. The v2 model, validation and tests in shared.
3. Export: clean footage, end card clip, layer overlays, music bed mixing.
4. The layer image route.
5. Editor: data-driven rows, layer rendering, drag, resize, snapping, panels, v1 drafts.
6. End-to-end verification, then preview.
