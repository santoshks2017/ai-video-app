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

export const APP_VERSION = '1.13';

/** Newest first. */
export const CHANGELOG: Release[] = [
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
