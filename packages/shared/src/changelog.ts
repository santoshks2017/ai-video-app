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

export const APP_VERSION = '3.5';

/** Newest first. */
export const CHANGELOG: Release[] = [
  {
    version: '3.5',
    date: '2026-09-14',
    title: 'A real editor, logos without boxes, and a closing line that finishes',
    changes: [
      'Edit opens a timeline editor laid out the way the team knows from Lumina: material on the left — this project’s films, its vehicle and dealership photographs, and anything uploaded — the player on the right, the timeline underneath. Text presets, transitions and filters; split, delete, duplicate, trim and snap; a magnet that closes gaps and linkage that keeps text and sound with their clip; undo and redo; aspect switching; a draft kept on this device. Export renders the edit on the server and saves it as a new version of the film — no model, no cost. The preview shows every transition as a cross-fade and stops volume at 100%; the export is exact.',
      'A filter does something the moment it is clicked. It needed a clip selected first and said so only in the corner of the header, so a click in the panel looked like nothing at all. With no clip selected it now goes on the whole film; with one selected, on that clip, and the panel says which. The looks were so gentle that every thumbnail was identical — they are strong enough to tell apart now, there is a None, and Strength sits in the panel. The preview and the export grade with the same colour steps: checked in Chrome to the level, and the export within 2 levels of 255. Cool used to turn reds pink in the preview and do something else in the export.',
      'The last words of a film are no longer lost. On a Sahyadri Motors run the closing line was still being spoken at full volume in the final frame of the last part — the model stopped mid-word, so the words were never in the video, and holding the last frame could not bring them back. Four things let that happen and all four are fixed: the last scene keeps a silent beat before the film ends, as every part before a cut already did; parts are planned in whole seconds, because a model asked for 5.2 renders 5.0; a name said letter by letter counts per letter, so "XUV 3XO" is six words, not two; and the too-long check reads the closing line, with a warning of its own. The final part is also told to finish its last line with a second to spare. Scene timings shift slightly as a result — a 42-second film now plans as 41.',
      'Logos without boxes. A logo was composited however it had been saved, so Shaw Toyota’s end card carried two white plates. Every logo is cleaned now: the background is found from the colour of its border and only what touches the border is removed, so white inside a logo stays. A white version is made for dark grounds — logos stay in colour over the film and switch to white when the end card begins. Uploads are cleaned on the way in and every logo again at render, so clients saved earlier render correctly with nothing to redo.',
      'A client with a brand and no brand logo gets one when it is saved — from Wikidata, then Wikimedia Commons, then CarDekho — with where it came from shown under it, so it can be checked and replaced. Clients has Pull brand logo and Clean up logos, and shows each logo in colour and in white.',
      'A model’s day of requests is spent on purpose. Google caps each video model per day — 100 for Omni 1.1 Flash — and counts failed attempts too; the app retried a refusal three more times, so once the day was spent every part burned four requests and ninety seconds before failing. A refusal that is the day’s cap now ends the run at once and says when the model comes back: 12:30 PM IST. The model picker shows what each model has left today, the Generate panel shows how many requests this film will use beside what it costs, and a model with nothing left stops the button before anything is sent. The count is of what this app sends.',
      'Two more models to spread the day across: the earlier Gemini Omni Flash, metered separately from 1.1, and Veo 3.1 Lite. Every model has a daily limit field in APIs & models.',
      'Every colour on the page, not the first ten. The sync kept ten colours chosen by thumbnail size, which is how the XUV 3XO lost Citrine Yellow — the colour its photographs are shot in — along with three others, and fifteen cars sat at exactly ten. Colours are read in the order the page lists them now. Refresh colours on a vehicle, or Refresh every colour list across the library, puts the missing ones back without touching the photographs.',
    ],
  },
  {
    version: '3.4',
    date: '2026-09-13',
    title: 'Approving a spend, from wherever the run has got to',
    changes: [
      'A generation over \u20b9500 needs the spend approved, and the tick that approves it rendered only while nothing had been run yet \u2014 so the moment a run failed, the approval disappeared while the button still required it, and Regenerate could not be pressed at all. It is shown now whenever there is a spend to approve and nothing is in flight, and the disabled button says which of the three things is holding it: your role, a blocking check, or the approval.',
      'Each paid run is approved on its own. An approval that outlived the run it was given for would let the next one through without anyone looking at the figure again.',
    ],
  },
  {
    version: '3.3',
    date: '2026-09-13',
    title: 'Draw the scene before you film it, and keep the lines that are right',
    changes: [
      'Every scene can be drawn before it is generated. An image model makes a still of the shot from the same photographs the film is built on \u2014 the same vehicle, the same presenter, the same showroom, the same rule against lettering \u2014 and that still is then sent as the first reference for the part its scene falls in. A shot direction is a sentence, and a sentence leaves the camera, the distance, the light and where everyone stands to the video model: this settles all of it for a fraction of a paisa, and it is there to be rejected before a rupee of video is paid for. Draw one, draw the ones still pending, or redraw the lot.',
      'A field can be locked shut. Close the padlock on a line, a shot direction or a caption and it takes no cursor and no typing, and a rewrite leaves it exactly as it is \u2014 the locked lines still go to the writer, marked as fixed, so the new ones are written to flow with them rather than past them. The button says how many it will touch: "Rewrite 4 of 9". Open the padlock to edit it again, or Lock all in one go.',
      'Rewrite script and Draw both leave an Undo. One click puts the storyboard back as it was, rather than a second rewrite that produces something different again.',
      'One line per scene. The pronunciation respelling is gone \u2014 the field, the column, the third Gemini call inside Write the script, the pre-flight nag and the button \u2014 because Omni says the copy correctly on its own now. A project that already has a respelling keeps saying it until its line is edited, so no finished film changes under anyone.',
      'How fast the voice speaks is a choice: Measured, Natural, Brisk or Urgent, in words a minute. It sets both how the delivery is described to the model and how many words each scene\u2019s seconds are worth, so a faster read genuinely buys more to say rather than asking for hurry. A walkaround and a three-day offer are not read at the same speed.',
      'The references panel shows exactly what the model is handed \u2014 every image and video in scope, in the order it is given them and numbered the way the prompt numbers them, each tagged Vehicle, Presenter, Dealership or Extra. The ordering rule moved into one place that both the renderer and the editor call, so the list you check is the list that is sent. A cross holds any of them back from the next run without deleting it: it stays on the list, struck through, until you put it back. That is how you find out which one photograph a run keeps copying.',
      'The vehicle and the dealership arrive as profiles rather than a scatter of photographs. The vehicle sends its per-view sheets by default \u2014 four slots for the whole car instead of four angles of it. The dealership gets sheets of its own, built from showroom photos filed by the part of the place they show: exterior, showroom floor, customer lounge, delivery bay, the team. "Sort photos and build sheets" looks at the unfiled ones and files them.',
      'A shot is built on the room it is set in. A showroom is several rooms, and every scene used to be handed whichever dealership photograph happened to be first \u2014 so a wide exterior of the building was drawn from a picture of the showroom floor, and the film opened on somebody else\u2019s forecourt. The room is read from the shot now and matched against the photographs, and a shot about the place leads with photographs of the place.',
      'A presenter-led film says who is in the shot. A use case writes its product beats as product shots \u2014 "slow macro pan across the signature detail" names nobody \u2014 so the scene image came back as an empty showroom, and that empty showroom then seeded the video. Shots that name no one are told who is there, in the way that shot can hold them: a hand entering a macro, the presenter beside the vehicle in anything wider. A shot that already casts someone, or that nobody can stand in \u2014 a driving shot, a beauty pass \u2014 keeps its own words.',
      'Whether anyone is on camera is now the project\u2019s decision: On camera or Nobody, with the presenter picker beside it. Off means no presenter is written into a shot and no photograph of one is sent \u2014 the vehicle and the showroom, with a voice over them.',
      'The parts of a film are made at the same time rather than one after another. Measured on a five-part run: 387 seconds of rendering inside 128 seconds of waiting.',
      'Nothing on the car that is not in its photographs. The prompt no longer spells out any mangled name for the model to copy \u2014 naming a misspelling hands the model the misspelling \u2014 number plates are always blank, and a badge is allowed only where it is legible in the supplied photographs and can be reproduced character for character. Every panel, lamp, badge and wheel is copied from them, and a view the photographs do not cover is filmed from an angle they do, or held out of focus, never filled from memory.',
      'The car is named, not specified. A prompt built from brand, model and variant read "Mahindra Xuv 3xo XUV 3XO AX7 L Turbo AT" \u2014 the car named twice and then a gearbox read out. And a variant no longer decides which photographs are sent: the pictures a film is built on came from the trim level, and a trim level is a price and a gearbox, not a different car. The photographs come from the model\u2019s library, always; the variant is only there for the facts the script may quote.',
      'The last words of a film are no longer cut off. The final part is the one clip whose tail is never tightened, and the model uses every second it is given, so its speech ran into the cut and the end card took two or three words with it. The last frame is held for whatever the speech is short of a proper ending. The music bed also came back to full level over the end card, because no spoken line covered it \u2014 three seconds of music over the dealership\u2019s phone number. It stays down now.',
      'A scene can be skipped rather than deleted. It stays where it is, greyed out, with everything written in it intact, and it is out of the film: not generated, not timed, not paid for. One click puts it back.',
      'Scene stills, reference sheets and photographs of the exact vehicle can all be attached per project, and a project can override which library vehicle it pulls from and what the film calls it.',
      'The storyboard fits the screen. Four columns whose dividers drag \u2014 one gives up what the other gains, so it never scrolls sideways \u2014 each scene\u2019s number, timing and controls on a strip of their own, and the script, drawing, length and pace controls on one line. The numbered panels fold away and remember it, and the sentences that used to sit under every field are behind a mark you hover.',
      'Broken thumbnails fixed. Photos imported from Google and uploaded by hand are stored with the full URL on them while the vehicle library stores the path, and the app was prefixing the base onto both \u2014 so the presenter and every showroom photo showed a broken image while the car sheets beside them loaded.',
      'The on-screen-text length warning names the scene it is talking about, measures the caption as you have edited it rather than as the template wrote it, and leaves the end card alone \u2014 it is a whole frame with its own lines, not a caption panel.',
    ],
  },
  {
    version: '3.2',
    date: '2026-09-13',
    title: 'Every photograph of a vehicle, gathered into sheets',
    changes: [
      'CarDekho publishes ninety-odd photographs of a model. The app kept seven — two a side, chosen by filename — so three-quarters of what the car looks like never reached the video model, and a view it has not seen is a view it invents.',
      'A sync now takes up to thirty-six, picked round-robin across the views rather than in page order. That order matters: the page lists every exterior shot before the first cabin one, so taking the first thirty gave a set with no interior in it at all.',
      'Every photograph is looked at and filed under what it shows, and each view is gathered into a single sheet — every front in one image, every side in another, the cabin in a third, and the close-ups in a fourth with each one named: grille, front bumper, wheel, door handle. A film is then built on five or six references carrying forty photographs between them, instead of six carrying six.',
      'A vehicle shows its sheets above its angles, each opening full size, so what a film is built on can be seen rather than assumed.',
      'Google joins CarDekho and the manufacturer as a source: it asks which pages carry this model\u2019s photographs and reads those, which covers a launch-week model that is on the maker\u2019s site and nowhere else.',
      'Vehicles has "Rebuild every photo set", which walks the library doing all of this for what is already there, one vehicle at a time, and stops when you say so.',
      'More individual photographs are kept per view as well — four of the front, four of the side, three of the rear, four of the cabin — so a single scene has a real choice to be matched to.',
    ],
  },
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
