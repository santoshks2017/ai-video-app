/**
 * The app's version and its release notes — the single source of truth for both.
 *
 * The app renders this directly (rail → version → What's new) and
 * `npm run changelog` writes CHANGELOG.md from it, so there is one list to keep
 * up to date rather than two that drift.
 *
 * Numbering: minor bumps (1.1, 1.2, …) for every shipped change. The major
 * number moves only for an overhaul of how the app works, not for a feature.
 */

export interface Release {
  version: string;
  /** ISO date the version shipped. */
  date: string;
  /** One line on what this release is about. */
  title: string;
  changes: string[];
}

export const APP_VERSION = '2.4';

/** Newest first. */
export const CHANGELOG: Release[] = [
  {
    version: '2.4',
    date: '2026-09-10',
    title: 'Veo generates, captions take spaces, and failures say why',
    changes: [
      'Google Veo 3.1 and Veo 3.1 Fast failed every run that carried a reference image. The images were sent in the format Google uses for its chat models, which its video endpoint rejects. They now go in the format Google\u2019s own SDK sends.',
      'Typing a space in a storyboard caption no longer vanishes — the box was showing the tidied-up caption instead of what you typed, so a trailing space was removed before the next word.',
      'When Omni fails while Google is finishing the video, the error now gives Google\u2019s actual reason instead of "Generated file processing failed", and every failed generation is logged so it can be diagnosed.',
      'Reference images with spaces or brackets in their names — WhatsApp photos, for one — showed a broken thumbnail. They load again, including ones already uploaded.',
    ],
  },
  {
    version: '2.3',
    date: '2026-09-10',
    title: 'Veo 3.1, 1080p, editable captions and a generation timer',
    changes: [
      'On-screen text is editable in the storyboard: change a caption, add one to a scene that had none, remove one, or reset to the template. What you type is exactly what is composited over the video.',
      'Words no longer get spoken twice. "six airbags airbags" came from the prompt\u2019s own rules quoting the same phrase the line used — the spoken line is now the only place a phrase appears, and the model is told to say each word once and never voice a shot direction.',
      '1080p for every model. Omni and Veo render it natively; Seedance renders 720p and the finished video is upscaled in post — the editor and the history both say which. Cost is priced at the resolution actually rendered.',
      'Google Veo 3.1 and Veo 3.1 Fast, on the same Gemini key as Omni. Omni is now listed as Gemini Omni 1.1 Flash so it is clear which one it is. Veo renders only 4, 6 or 8 seconds, so each clip is trimmed to its planned length.',
      'A live timer while a video generates, with an estimate of what is left learned from this app\u2019s own past runs on that model — no provider reports progress, so history is the only honest source. Before you start, it says roughly how long a video usually takes.',
      'The generation history shows how long each video took to make.',
      'Clips that came back at different frame sizes are now scaled to match before stitching, instead of failing the whole compose.',
    ],
  },
  {
    version: '2.2',
    date: '2026-09-10',
    title: 'A storyboard you can read, and scripts written like an agency would',
    changes: [
      'Scripts are written in three passes instead of one: first the angle — who is watching, the one idea, how the film builds and the facts it will spend its seconds on — then the draft, then an edit that reads every line back and rewrites anything generic, unfinished or disconnected.',
      'The angle is shown above the storyboard, so you can judge what the script is arguing before judging the lines.',
      'Stock phrases that made scripts sound naive — शानदार, बेहतरीन, "city हो या highway", "families की पसंद" — are banned outright, and a line may no longer stop mid-sentence to fit its word budget.',
      'Every storyboard field grows to fit its text. Nothing is clipped inside a box, including after the column is resized.',
      'The columns are restructured: scene, timing and duration in one column, then the visual reference, shot direction, the script with its pronunciation, and on-screen text.',
      'Each scene shows the reference image its shot is built on, and you can change it. The chosen image is named in that scene of the prompt, so the model frames the headlamp macro on the headlamp photo rather than the showroom.',
    ],
  },
  {
    version: '2.1',
    date: '2026-09-10',
    title: 'On-screen text is composited, not generated',
    changes: [
      'Every caption — the offer figure, the warranty card, the CTA — is now laid over the finished video in post, like the logos and the end card. The video model is told to draw no text at all, so a price can no longer come back misspelled, cropped or in the wrong alphabet.',
      'Captions are timed to their own scene, fade in and out, and sit above the footer bar. A segment that renders shorter than requested pulls its captions in with it instead of stranding them.',
      'Numbers, prices and units stay in plain English throughout — "fifteen lakh four thousand", not "pandrah LAAKH chaar ha-ZAAR". The pronunciation pass was respelling figures and the models were reading the respelling literally.',
      'Fixed a stitching failure that could lose a whole paid run: clips coming back at a different frame rate from the end card were rejected outright by the compositor.',
      'Pre-flight no longer warns that the model may drop or garble a card, because it cannot any more. It warns when cards come too fast to read instead.',
    ],
  },
  {
    version: '2.0',
    date: '2026-09-09',
    title: 'Bikes, whole-brand sync, and your own account',
    changes: [
      'Bikes and scooters join cars: BikeDekho for two-wheelers, CarDekho for cars, with the same images, colours, variants and specifications.',
      'Sync a whole brand instead of one model at a time. Pick Tata or Royal Enfield and the app pulls the current line-up — 176 models across the nine brands — skipping discontinued, unlaunched and fleet-only trims.',
      'A video with no specific model chosen now names the dealer brand\u2019s real current range and shows only cars from it, instead of the model inventing an older generation.',
      'Clients say whether they sell cars or two-wheelers. Honda, Suzuki and Hero badge both, and a car showroom\u2019s film was coming back with motorcycles in it.',
      'Everyone signs in with their own Google account. New people can look but not spend; an admin grants creator access, and every sign-in and generation is logged against a named person with its cost.',
      'Scripts are written about the car rather than the camera, using the real price, engine, airbags and ground clearance pulled from the source.',
      'A pre-flight check now blocks a generation when pasted reference documents have grown longer than the shot description \u2014 a pronunciation guide left switched on had become 54% of the prompt.',
    ],
  },
  {
    version: '1.14',
    date: '2026-09-09',
    title: 'Stop over-pronouncing Hindi',
    changes: [
      'The pronunciation pass was rewriting every word, which made most of a line sound wrong to fix the few that were. It is now a light touch: the line comes back mostly as written, with only the words a model actually says badly respelled.',
      'English words, brand names, model names, place names and function words are left exactly as they are — "test drive" stays "test drive", not TEST DRAAIV, and Tata Punch stays Tata Punch.',
      'The glossary now has two kinds of entry: leave in English (the safe default) and respell (for words you have heard come out wrong, plus prices). The 37 English terms that shipped as respellings have been flipped.',
      'A "Load the built-in guide" button pulls an improved shipped guide over a saved one — languages already in your database never re-read their seed.',
    ],
  },
  {
    version: '1.13',
    date: '2026-09-09',
    title: 'Work on several projects at once',
    changes: [
      'Projects and library sections open in workspace tabs, so opening a client record no longer throws away the project you were editing.',
      'Tabs stay live in the background: a generation started in one tab keeps running while you work in another, and its tab shows a pulsing dot until it finishes.',
      'The brief and the prompt-and-preview columns scroll independently, instead of dragging each other around on one shared page scroll.',
      'A project missing its script now opens the storyboard automatically, since the fix was hidden inside a collapsed panel.',
    ],
  },
  {
    version: '1.12',
    date: '2026-09-09',
    title: 'Languages section',
    changes: [
      'A new Languages library holds how each language must be spoken and written, plus a glossary of locked spellings. These are shipped to the models, not documentation.',
      'Hindi ships with the full pronunciation standard — vowel length, aspiration, schwa deletion, stress, the lakh/crore number system — and 70 locked dealer terms.',
      'Projects pick a language, and only languages you switch on are offered.',
      'Script writing split into two passes: copy first, then pronunciation against the language guide. "Redo pronunciation" re-runs the second pass alone, so tuning a guide costs one cheap text call and leaves approved copy untouched.',
    ],
  },
  {
    version: '1.11',
    date: '2026-09-08',
    title: 'Written scripts, spelled for pronunciation',
    changes: [
      'The storyboard now carries the actual spoken line, not a stage direction. "Write the script" fills every scene and you edit before generating.',
      'Each line is also respelled for pronunciation — syllables hyphenated, stress capitalised — which is what the video model performs. Plain Hindi told models which words to say but not how to say them.',
      'Pre-flight warns when scenes have no line, and separately when a line has no pronunciation spelling.',
    ],
  },
  {
    version: '1.10',
    date: '2026-09-08',
    title: 'Dreamina Seedance as a second provider',
    changes: [
      'Seedance 2.5 and 2.0 fast on BytePlus ModelArk, alongside Gemini Omni Flash. Pick the model per project.',
      'Seedance 2.5 renders 30 seconds in one call, so most videos need no stitching at all.',
      'A free connection test checks an API key without spending anything on a generation.',
      'Failed runs are re-costed from the segments that actually rendered, instead of being billed the full estimate.',
    ],
  },
  {
    version: '1.9',
    date: '2026-09-08',
    title: 'Retakes, and overlays that fit the frame',
    changes: [
      'Fix a detail without paying for a full regenerate: tick only the segments that are wrong, add a note, and the rest of the saved clips are reused. Ticking nothing restitches the overlays for free.',
      'Brand and dealer logos are normalised to one shared box, so a tall badge no longer towers over a wide wordmark.',
      'The footer bar is capped at 8.5% of frame height and sized off the short side — it was eating a sixth of every landscape video.',
    ],
  },
  {
    version: '1.8',
    date: '2026-09-08',
    title: 'Overlay text that fits, and client identity',
    changes: [
      'Overlay text wraps and shrinks to fit, instead of running off both edges of the frame.',
      'Clients carry a short display name for on-screen use, separate from the full legal listing name.',
      'The footer contact strip is saved per client and editable there, with a live preview.',
    ],
  },
  {
    version: '1.7',
    date: '2026-09-07',
    title: 'Generation history and cost',
    changes: [
      'Every generation is saved against its project with a thumbnail, cost and specs — a new run no longer buries the last one.',
      'Per-video cost and a running project total, plus a portfolio total on the Projects page.',
      'Segments are packed around whole scenes so nothing is cut mid-action.',
      'Prompt parts collapse into an accordion.',
    ],
  },
  {
    version: '1.6',
    date: '2026-09-07',
    title: 'Post-production overlays',
    changes: [
      'The footer, both logos and the end card are composited after generation rather than drawn by the model, which garbled small text and invented manufacturer badges.',
      'Videos always end on the dealer details and CTA.',
      'Segments crossfade instead of hard-cutting.',
      'Scene planning rewritten so long videos are not rushed and lumpy.',
      'The project editor leads with the few choices that matter and hides the rest.',
    ],
  },
  {
    version: '1.5',
    date: '2026-09-07',
    title: 'Left rail and model management',
    changes: [
      'Navigation moved to a left sidebar.',
      'APIs & models: register provider keys and models, with the real capability limits that drive chunking, cost and the API call.',
      'All nine use cases generate video — the prompt-only split was dropped once presenters proved to work.',
    ],
  },
  {
    version: '1.4',
    date: '2026-09-07',
    title: 'An app for the design team',
    changes: [
      'Five library sections — Projects, Clients, Cars, Actors, Global Instructions — so work is built once and reused.',
      'Client import from a Google Business Profile link, including showroom photos.',
      'Car library synced from CarDekho: brand, model, variant and colour.',
      'A shared team password gates the app.',
    ],
  },
  {
    version: '1.3',
    date: '2026-09-07',
    title: 'Long videos that hold together',
    changes: [
      'Videos longer than one clip are generated as independent segments seeded with the previous segment’s last frame, then stitched — the provider’s own extend could not carry more than about ten seconds.',
      'Reference images keep the car consistent across cuts.',
      'On-screen text is locked to exact strings, and the presenter’s name no longer leaks into the frame as a caption.',
    ],
  },
  {
    version: '1.2',
    date: '2026-09-07',
    title: 'Reference images',
    changes: [
      'Upload labelled reference images and have them ground the generation.',
      'Fetch a car model’s reference set from CarDekho automatically.',
    ],
  },
  {
    version: '1.1',
    date: '2026-09-07',
    title: 'Real video generation',
    changes: [
      'The app generates video through Gemini Omni Flash instead of only producing prompt text.',
      'Preview the finished video with a frame timeline that jumps to each storyboard scene.',
    ],
  },
  {
    version: '1.0',
    date: '2026-09-06',
    title: 'First deploy',
    changes: [
      'Structured brief, storyboard, pre-flight checks and cost estimate.',
      'Deployed on Cloud Run and Firebase Hosting, with push-to-deploy.',
    ],
  },
];
