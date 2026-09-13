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

export const APP_VERSION = '3.1';

/** Newest first. */
export const CHANGELOG: Release[] = [
  {
    version: '3.1',
    date: '2026-09-13',
    title: 'The photograph decides which side it shows',
    changes: [
      'The wrong face on the right car, found and fixed. The XUV 3XO in the library was always an XUV 3XO — what was wrong was which side each photo was filed under. CarDekho names its files by angle, "front-left-side-47.jpg", and the app believed those names: in that set the file named for the front held a full side profile, and the one named for the side held the front. The app then captioned a contact-sheet tile FRONT over a side profile and told the model that was the front, so the front was the one view it never saw — and what it invents for a Mahindra XUV is the XUV300 it has seen far more of. Right rear, wrong face, an XUV310 badge in one frame.',
      'Every photo is now looked at when a vehicle is synced: a vision pass files each under what it actually shows, drops anything that is not that vehicle, and says in the sync note what it moved.',
      'Vehicles already in the library have a "Check the photos" button that re-files what is stored without downloading anything — worth running on every model synced before today. Each photo also carries a dropdown, so a wrong one can be corrected by hand in two seconds.',
      'A contact-sheet tile is captioned with its angle only when the angle is known. Asserting a front we are not sure of is worse than saying nothing.',
      'Scenes can be rearranged. Every scene row has an up and a down, and the film is re-timed and re-packed after every move: a scene pushed into a part with no room pushes the rest into the next part, and no part ever exceeds the model\u2019s clip length. Scenes can also be written by hand, at the end or below any scene, and a scene you wrote is never one of the ones dropped to make the film fit.',
      'The board and the libraries hold still. On Projects the search, the filters and the four column headings stay where they are while the cards scroll under them, and each column scrolls on its own. Clients and Actors do the same: the list, the record and the page each keep their own scroll.',
      'A client\u2019s campaigns moved out of the middle of its details into a column beside it, and an actor now has the same — the dealerships they front, and how many films for each.',
      'An admin can hide a run. A generation that failed on depleted credits, or was made twice by mistake, stops counting towards the project\u2019s spend and the person\u2019s total, and disappears from everyone else\u2019s history. Nothing is deleted: an admin still sees it, marked, and can put it back.',
      'What\u2019s new folds — one release open at a time, the current one to begin with.',
    ],
  },
  {
    version: '3.0',
    date: '2026-09-13',
    title: 'A board to work from, the right car in every part, and versions of a finished film',
    changes: [
      'Projects opens on a board — Open, In progress, In review, Delivered — and a card drags between the columns. Projects you already had start in the column their history puts them in: nothing generated yet is Open, a render in flight is In progress, a film that exists is In review. There is a Board / List switch if you want the old grid, and a Stage control inside each project.',
      'The wrong car, found and fixed. Omni was being sent two reference images per part, and a continuation part spent both on frames of the film — so no part after the first was ever shown a photograph of the vehicle, and it drew the car the name brought to mind. For "XUV 3XO" that is the XUV300 it has seen far more of. Omni takes ten reference images, not two: every part now carries the vehicle, the presenter, the showroom and the frame it continues from, and each one is named in the prompt so the model is not left guessing which image is which.',
      'Several photographs now travel as one. Front, side, rear and interior go as a single labelled contact sheet, with the tiles named, and the prompt says plainly that a sheet is a set of photographs and never something to draw on screen. The showroom gets the same treatment.',
      'The presenter\u2019s photograph is sent to the model at all now. It used to travel as prose only — "fitted maroon polo, hair tied back" — which is how the hair changed between parts.',
      'Every part is checked before the rest of the film is built on it: one frame is compared against the reference photograph by a vision model, and a clear mismatch is made again, once. The verdict is kept either way.',
      'Photos of this exact vehicle takes several files at once, and each one says which side it shows, so a scene about the cabin is built on the cabin photo. When any are attached the library is ignored completely, and a warning names the sides nobody attached — because a side the model has no photo of is a side it invents.',
      'Reference videos: up to three per project — the real showroom, the real vehicle moving — sent to the models that accept video.',
      'Every run keeps its receipt: the brief it was made from, the prompt each part was given, the photographs each part was shown, and the project exactly as it stood. Open Details on any run to read it, or put those settings back with one button. The videos you already have are never touched.',
      'A film that has been approved never has to be made again to be delivered. Approve marks the cut the client signed off; Upscale enlarges that exact cut to 1080p with no model involved; and the premium pass re-renders it through Seedance for finish — the same shots, people, vehicle and sound, in 29-second passes because that is Seedance\u2019s limit, joined again after. Omni writes and speaks; Seedance renders.',
      'A cutting room, in the browser. Play to where a bad stretch starts, mark it out, drop the sound if you want, join other films from the project onto the end, and export — as a new version, leaving the original alone. It is ffmpeg, not a model: it costs nothing and cannot change what the film shows.',
      'The joins between parts are measured now instead of asked for. On real runs one part ended with a second of dead air while the next began speaking inside its first 200ms — two seconds of nothing at one join, phrases colliding at another. Each join is cut back to a breath at the end of one part and a moment before the next speaks, and captions follow.',
      '360p renders, for a cheap look at a film before it is made properly.',
      'The libraries are navigable. Vehicles is brand, then model, then the vehicle, with search at the top and the sync tools folded above it. Clients and Actors have search and filters — brand, cars or bikes, city, state; gender, age range, attire.',
      'Every client shows the films made for them, with the actor and use case on each, and names the presenter the dealership\u2019s audience knows: "Riya fronts 4 of 6 films for this client." A project offers that presenter when there is one.',
      'What a use case needs answered now opens under the use case you picked, closed until you want it, with a count of what is still missing. Narration, on-screen text and Advanced are folds inside the Video card. Short fields sit four to a row.',
      'A new look throughout: warm paper, hairline rules, one soft red, names set in a serif and the controls around them in Inter, and every step of the brief marked with a scene slate.',
    ],
  },
  {
    version: '2.7',
    date: '2026-09-11',
    title: 'Long 1080p videos finish instead of dropping the connection',
    changes: [
      'A long 1080p video (45 seconds, five clips, ten captions) could fail with "network: Failed to fetch". The server was running out of memory while stitching the clips together and was shut down mid-run. The crossfades between clips made the video encoder hold every later clip in memory while each fade waited its turn; clips are now joined from short slices at each crossfade, which cut that stitch from about 1.6 GB to under 1 GB, and the server has four times the memory on top.',
      'If an Omni video is ready but Google\u2019s file store is briefly unavailable, the download is retried instead of the whole run failing.',
      'A run cut off partway through now shows in History as interrupted, instead of staying "running" forever.',
      'A dropped connection says so in plain words instead of "network: Failed to fetch".',
    ],
  },
  {
    version: '2.6',
    date: '2026-09-11',
    title: 'The colour you picked, and offers in your own words',
    changes: [
      'Offers are free text now. Type them the way the dealer says them — "Benefits up to ₹1.5 lakh", "Free 5-year service pack" — instead of squeezing them into cash discount, down payment, interest rate and warranty boxes. Two to start, add more (up to eight), and each one becomes its own on-screen caption.',
      'Product features work the same way: two to start, add more, each with an optional line on why it matters. Only the first feature is required.',
      'Projects saved with the old offer boxes open with those offers already filled in as free text.',
      'Picking a colour and a variant together silently dropped the colour: it was looked up on the variant, which never has its own colour list. The colour image now reaches the model whether or not a variant is chosen.',
      'The prompt now names the paint outright — "Paint colour: Stealth Black" — and tells the model to take only shape from the other car photos, which are usually all one launch colour.',
      'With a colour chosen, the car reference set is the colour image plus one photo per angle, instead of every photo in the library outvoting the one colour image.',
      'Colour names drop CarDekho\u2019s paint codes: "Stealth Black", not "226_Stealth Black".',
    ],
  },
  {
    version: '2.5',
    date: '2026-09-10',
    title: 'Omni videos survive a failed file on Google\u2019s side',
    changes: [
      'Omni runs were failing with "The file failed to be processed". That message comes from Google after the video has already been made — only Google\u2019s downloadable copy of it failed. The app now reads the finished video back from the run itself, so the video is kept instead of lost, and nothing is generated or paid for twice.',
      'The generated video is now taken from the model\u2019s output, never from inputs Google echoes back in the same response.',
    ],
  },
  {
    version: '2.4',
    date: '2026-09-10',
    title: 'Captions fit, Veo generates, and failures say why',
    changes: [
      'Captions and the footer no longer run out of their boxes. The server draws text in a wider font than the layout assumed, so long lines were cut off; every line is now measured exactly as it is drawn and shrunk until it fits. A caption that wraps is split into two even lines, and every caption in a video shares one size, so the text does not jump between scenes.',
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
