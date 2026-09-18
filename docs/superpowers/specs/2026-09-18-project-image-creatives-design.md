# Project Image — social creatives beside the video workflow

Date: 2026-09-18 · Status: building on preview

## What this gives the team

Projects get a second kind. **Project Video** is everything that exists today, untouched.
**Project Image** makes finished social-media creatives for a client:

- Pick the client and the vehicle, and say what the post is about ("Navratri offer on Creta,
  ₹50,000 benefit"). The app reads which of the 12 creative engines it is (Offer, Festival,
  Delivery…) and blends two when both apply, the way the Social AI orchestrator described.
- It writes the on-image copy (headline, second line, offer badge, points, call to action,
  T&C line) and the post caption with its hashtags, in the client's voice and language.
- It makes the picture with **the real car**: the library photo of that model, placed by the
  image model into a scene for the occasion — or the photo as it is, or a photo you upload
  (a real delivery picture, a showroom shot).
- It lays out every platform size — Instagram square and portrait, Story/Reel/WhatsApp
  status, Facebook/LinkedIn, YouTube thumbnail — each with its own layout, not one crop.
- Every creative opens in an **image editor**, a light Photoshop: layers you click, drag,
  resize and rotate, text you edit with fonts and colours, shapes, images you replace,
  adjustments, undo, snapping guides, and export to PNG or JPG.

## What the Social AI documents contributed, and what changes

Kept from the Developer Brief and the Orchestrator v4:

- The **12 engines** with their classification words, dual-engine blend ratios (Festival +
  Offer 60/40, New Launch + Test Drive 60/40, …) and the emotional hierarchy that settles a
  prompt with more than two signals.
- Each engine's **copy structure** and mandatory elements (a ₹ amount for Offer, the
  customer's name for Delivery, a date for a launch or event).
- The **universal rules**: ₹ always formatted, every price claim asterisked with a T&C line,
  the contact block in the dealer's exact format, no unsubstantiated superlatives, emoji as
  punctuation, every outlet of a multi-location dealer listed.
- The **visual layer**: logo zones (dealer and brand logo top corners), the dealer panel
  variants (full block, compact line, multi-location, caption-only), the OEM colour table and
  the occasion colour overrides (Diwali gold and deep red, Independence Day saffron…), the
  typography zones (headline upper third, price badge, panel text).
- The **3-tier hashtag set** and the optional SEO keyword block.

Changed, because of what the video work taught:

- **The creative is rendered, not described.** The old flow ended in a `visual_spec` for a
  designer to rebuild in Canva; here it ends in a finished, downloadable image.
- **The car is never imagined.** The old flow had no vehicle photos at all. The picture is
  built from the library's real photos of the model, checked afterwards against them (the
  same vehicle check the video uses), and the number plate is a plain white blank plate.
- **Words are never drawn by the image model.** Headlines, ₹ amounts, phone numbers and T&C
  lines are app-drawn layers, exact and editable. The image model is told to leave the
  picture free of any writing and to keep clear space where the layout puts text.
- **Every size, not only 1080×1080.**
- **The client record is the brand profile.** Name, logos (with white versions), phone,
  address, website, tagline and contact strip already live on the client, for video. The
  Instagram-scrape voice profile is left for later (see Out of scope); a free-text voice note
  on the image project covers signature phrases and things to avoid meanwhile.

## Where it lives

The **Projects** section gets a switch at the top: **Video | Image**. Video shows exactly
today's board and list. Image shows image projects, in the same board/list style, and "New
project" makes an image project.

Image projects are stored in their **own collection, `imageProjects`**, not in `projects`.
Saving a project replaces the whole document, and several screens (the board, a client's
Campaigns panel, Analytics) read video-only fields without checking — a different kind of
record in `projects` would break them. A separate collection keeps the video product exactly
as it is. Opening an image project opens its own tab, like a video project does.

## The image project page

Four steps, top to bottom, with the creatives on the right — the same shape as a video
project.

1. **Brief** — name; client; vehicle (from the client's brands, with colour) and the photo to
   build on (chosen by angle, or attach your own); "What is this post about?"; the engine the
   app read from it (shown as chips, with a second engine and its ratio when blended, and a
   way to pick by hand); the facts that engine needs (offer lines and validity, customer name,
   occasion, launch date, features, event date and venue…); language of the text on the image
   (English, Hindi, Hinglish, and the regional languages already set up); a voice note.
2. **Sizes and look** — which sizes to make (Instagram square 1080×1080, Instagram portrait
   1080×1350, Story/Reel/WhatsApp 1080×1920, Facebook/LinkedIn 1200×628, YouTube thumbnail
   1280×720), the look (the video overlay looks, the manufacturer's colours, and the occasion's
   colours for a festival), the layout (chosen from the engine, changeable), and the panel
   (full block, compact line, caption only).
3. **Copy** — "Write the copy" fills the headline (with two alternatives to switch to), second
   line, badge, points, CTA, T&C line, caption and hashtags, all editable. The rules above are
   applied after writing, not only asked for: a price without an asterisk gets one, ₹ amounts
   are formatted, the contact block is the client's.
4. **Picture** — per creative set: **Scene** (the image model places the real car in a scene
   for the occasion, one picture per aspect, checked against the library photo), **Photo as it
   is** (the library photo, extended to the size with a soft backdrop — free and instant), or
   **Upload** (your own photo).

**Creatives** — one card per size, drawn live as the copy and picture change. Each opens in
the image editor. Approve marks the ones going out; Download gives a PNG or JPG, and Download
all gives a zip of every size. The caption and hashtags copy with one button.

## The creative document

A creative is a stack of layers on a frame of fixed pixel size — the document the editor
edits and the renderer draws:

```ts
interface CreativeDoc {
  version: 1;
  format: CreativeFormatId;          // 'ig-square' | 'ig-portrait' | 'story' | 'landscape' | 'thumbnail'
  width: number; height: number;     // the platform's own pixels
  background: string;                // colour under everything
  layers: CreativeLayer[];           // bottom first
}
type CreativeLayer = ImageLayer | TextLayer | ShapeLayer;   // each with id, name, x, y, w, h,
                                                            // rotation, opacity, hidden, locked, role?
```

- **Image**: a stored picture (`src`), fit cover or contain, a focal point to pan it inside its
  box, flip, and adjustments (brightness, contrast, saturation, warmth, blur).
- **Text**: words, font family, size, weight, italic, colour, alignment, line height, letter
  spacing, capitals, shadow, outline, and an optional pill behind it (colour, padding, corner
  radius). Text is fitted into its box: it wraps, and shrinks to a minimum size before it
  would overflow — so a long Hindi headline never runs off the edge.
- **Shape**: rectangle (with corner radius), ellipse or line; fill colour or a two-stop
  gradient; stroke.

`role` marks layers the app placed (background, scrim, headline, badge, panel…), so a
changed headline or a new look updates them without undoing the designer's other changes.

**One renderer draws everything**: the cards on the project page, the editor's canvas, and
the exported file are all drawn by the same browser canvas code, with the same fonts loaded
first. What is seen is exactly what downloads. The server never draws a creative, so there is
nothing to keep in step between two renderers.

**Layouts** are templates in the shared package: given the size, the copy, the client's
logos and look, they place the layers. Six to begin with: *Hero with panel* (headline over
the scene, panel at the foot), *Offer* (a large ₹ badge), *Festival greeting* (a centred
greeting, a light panel), *Feature points*, *Launch*, *Delivery* ("Congratulations {name}").
Each knows the five sizes: a story stacks what a landscape puts side by side. Logos use the
client's placement (brand logo left, dealer right unless set otherwise), inside the safe margin.
On a square, portrait or story, a full dealer panel carries the call to action (on its right)
and the small print (its last line), so neither lands on the car; over a picture the words keep
to the upper part (about half a square), and the scene is asked to keep exactly that band calm.
A wide size keeps the call to action in its left column, clear of the car on the right.

## The picture, and keeping the car right

- **Scene**: the image model (the one the storyboard drawings already use, found from the
  Google key) gets the hero photo of the car and up to three other angles as references, and
  an instruction: put *this* vehicle — same design, colour, badges, wheels — into the scene
  (festive street at dusk for Diwali, showroom floor for an offer, open road for a feature);
  no text, logos or watermarks anywhere; number plates plain white and blank; keep the band
  where the headline sits (measured from the laid-out words) and the band where the panel
  sits calm. One picture per aspect
  ratio the chosen sizes need (1:1, 4:5, 9:16, 16:9; the 1.91:1 size is cut from 16:9).
- **Check**: each picture goes to the same vehicle check the video uses, beside the reference
  photo. A clear mismatch is made once more; the verdict is shown on the card either way.
- **Photo as it is**: the library photo on a blurred, extended copy of itself, no model call.
- **Upload**: any photo, through the existing upload.

## Server

- `imageProjects` joins the stored collections, with the same list/get/save/patch/delete
  routes as the others, the same roles (creators change, viewers look), and the same care as
  projects: a save from the browser never overwrites the cost the server has added up.
- `POST /api/creatives/copy` — the copy for a brief, as JSON, from the Google text model.
- `POST /api/creatives/scene` — one picture for a brief at one aspect ratio, saved as a
  stored image, with the vehicle check's verdict.
- Both log their spend under new sections, **Creative copy** and **Creative images**, so
  they appear in Analytics → Misc cost; each adds to the image project's own cost, shown to
  admins only, like video.
- Rendered PNGs go through the existing upload (`/api/refs`), so a saved creative is a stored
  file with a stable address.

## Permissions

Creators and admins make, edit and save. Viewers can open everything and try the editor, but
cannot generate, save or upload — the same as the video editor's demo mode.

## Out of scope for this build

- Reading a dealer's voice from their Instagram (Apify scrape) and learning from approved
  posts — the voice note stands in.
- Posting to Instagram or scheduling.
- Carousels (several slides in one post).
- Editing one size and having every other size follow; each size is its own document.

## Risks

- **The image model changes the car.** Real photos as references, an explicit lock, the
  vehicle check with one retry, and the always-available "Photo as it is".
- **Cross-origin images on a canvas.** Stored images are served by the API; they are loaded
  with CORS so the canvas can export. The API already echoes the site's origin.
- **Fonts not ready when drawing.** Every font a document uses is loaded before a frame is
  drawn or exported; Indic scripts use the Noto families.
- **Touching the video product.** Nothing in the video flow changes. The shell learns one new
  tab kind, and Projects gets the switch; both are additive and checked with the video board
  and editor open as before.

## Verification

1. Shared tests: engine classification and blends against the documents' examples; every
   layout template gives a valid document for every size, with nothing outside the frame;
   copy rules (₹ formatting, asterisks, contact block); document validation.
2. API: the copy and scene routes against their contracts (a fake model in tests); the
   collection keeps server-side cost through a browser save.
3. Browser: the switch, a project from brief to creatives, the editor (select, drag, resize,
   rotate, text edit, undo, snap, layers panel, export) at desktop and phone width, and the
   video board and editor unchanged.
4. Preview deploy, then a real brief end to end on preview before anything goes live.
