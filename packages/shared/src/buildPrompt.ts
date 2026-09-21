/**
 * Master prompt assembly (PRD P0.5 / P0.8). Ported from the legacy tool's
 * buildPromptParts(), with two additions per the new PRD:
 *  - a REFERENCE IMAGES block that cites attachments by filename (P0.4), so the
 *    model reuses "showroom_front.jpg" verbatim rather than a prose re-description;
 *  - a CAR MODEL REFERENCE note when the brief is model-specific (P0.2).
 */

import { scriptOf } from './languageScripts.js';
import type { Brief, PromptPart } from './types.js';
import { isCardPosition, type CardPosition } from './overlayLook.js';
import { WORDS_PER_SECOND, speechRate } from './constants.js';
import { buildContext, type RenderContext } from './context.js';
import { buildBeats, collectStrings, storyGuidance, storyTheme, themeDirection } from './buildBeats.js';
import { planScenes, fmtTime, speakingSeconds } from './planScenes.js';
import type { Beat, Scene, ScenePlan } from './types.js';
import { sceneVisual, sceneVisualLine } from './visuals.js';
import { plainSpoken } from './spoken.js';
import { CATEGORY_BY_ID } from './categories.js';
import { rulebookText } from './rulebook.js';

/**
 * The dealer footer, the corner logos and the end card are composited in post
 * (apps/api/src/post.ts), where text is guaranteed legible. The model must
 * therefore leave that furniture out — anything it draws would sit underneath
 * our overlay and show through at the edges.
 */
const CLEAN_FRAME =
  'Leave the frame CLEAN of any text or branding furniture. NO text of any kind anywhere in the picture: no titles, no captions, no callouts, no price cards, no offer badges, no subtitles, no lower third, no footer bar, no contact strip, no address or phone number, no logo, wordmark, badge or watermark in any corner, and no end card. Every word the viewer reads is composited afterwards in post, where it is guaranteed legible — anything you draw would sit underneath it and show through at the edges. Film only the scene itself, edge to edge, keeping the top and bottom eighth of the frame free of important action so the overlays have somewhere to sit. This includes the things a real showroom has written on it: a fascia, a banner, a poster, a price board, a screen. Render them blank, or out of focus, or out of frame — never with letters or numbers on them. A number plate is not one of those: it is never cropped out or blurred to get round it — it stays on the vehicle as a plain white plate with nothing written on it. A model cannot spell, and what it writes is gibberish on the client\u2019s own building.';

/**
 * The film's hard rules, for anything else that draws from the same brief.
 *
 * The storyboard's scene stills are drawn by a different model on a different
 * call, and a still that breaks the film's rules is worse than no still — the
 * video is then built on it, and a presenter who was never in the film arrives in
 * the reference. So it is handed exactly this text rather than a paraphrase of it
 * that drifts a little further with every edit.
 */
export function sceneRules(brief: Brief): string[] {
  const ctx = buildContext(brief);
  return [CLEAN_FRAME, ...continuityLock(brief, ctx.mode, ctx.vehicle)];
}

/**
 * The rules a generation most often breaks, said first and in the same words in every part.
 *
 * Each part is a separate generation that knows nothing of the others, and a model
 * re-imagines whatever it is not pinned to: the presenter's open hair came back tied in
 * a later part, a man's voice read the second half, she popped into a shot from
 * nowhere, and a flat photo of the car stood in for a car parked in the showroom.
 * Identical wording at the top of every part is the strongest lever a prompt has.
 */
function continuityLock(brief: Brief, mode: RenderContext['mode'], vehicle: 'car' | 'bike'): string[] {
  const male = brief.actor.gender === 'male';
  const [they, their] = male ? ['he', 'his'] : ['she', 'her'];
  const lines = ['## CONTINUITY LOCK — NEVER BREAK THESE, IN ANY SHOT OR ANY PART'];
  if (mode.onCameraPerson) {
    lines.push(
      `- ONE presenter, identical from the first frame to the last: the same face; the same hairstyle, length and parting (hair worn open stays open; never tied up, braided, pinned or restyled — and tied hair stays tied); the same outfit, colours and fabric${
        brief.actor.style ? ` (${brief.actor.style})` : ''
      }; the same jewellery, accessories and make-up; the same build. Nothing about ${their} appearance changes between shots or between parts.`,
      `- The presenter never appears or disappears abruptly. Within a shot ${they} stays in frame, or enters and leaves by walking naturally in from or out past the edge of the frame with visible steps — no popping in, fading in or out, teleporting, or jumping to a new spot. A move to a shot without ${their === 'his' ? 'him' : 'her'} is a clean camera cut, never ${their === 'his' ? 'him' : 'her'} vanishing.`,
      '- Exactly ONE person in the whole video: the presenter. Never a second copy or look-alike of the presenter, and no other people in the frame or in the background. Nobody melts, morphs, splits, dissolves or fades into or out of the scene.',
      vehicle === 'bike'
        ? '- Real-world physics and scale: the presenter stands beside the bike or sits on its seat — never inside or through it, never floating.'
        : '- Real-world physics and scale: the presenter is outside the car — beside it or at an open door — or seated in one of its seats. Never standing inside the cabin, never inside or through the bodywork, never floating. Interior details are filmed from a seat or through an open door.',
    );
  }
  if (mode.speaks) {
    const voice = male ? 'male' : 'female';
    lines.push(
      `- ONE voice for the whole video: the same ${voice} voice${brief.actor.voice ? ` (${brief.actor.voice})` : ''}, with the same pitch, timbre, accent and energy in every scene and every part. No second speaker, no narrator, no ${male ? 'female' : 'male'} voice, no voice change at any point.`,
    );
  }
  const noun = vehicle === 'bike' ? 'bike' : 'car';
  /*
   * Number plates.
   *
   * The reference photographs are press shots, and a press shot carries the model's
   * name on its plate. Told to copy the photographs exactly, the model copied that
   * writing too, misspelled; told only that plates are blank, it sometimes left the
   * plate off altogether or blurred it away. So the plate has a rule of its own, said
   * before anything else about the vehicle: always there, always white, nothing on it.
   */
  lines.push(
    `- NUMBER PLATES ARE PLAIN WHITE AND BLANK — A HARD RULE FOR EVERY SHOT OF EVERY PART. Whenever the front or the back of the ${noun} is in frame, its number plate is there, mounted where a plate belongs, as a plain white plate with nothing on it: no letters, no numbers, no state code, no brand or model name, no dealer name, no sticker, no logo, no border lettering. The same holds for every other vehicle anywhere in the frame. Never leave a plate off, never show an empty holder or a dark recess where it belongs, never make it any colour but white, and never hide it by cropping around it or blurring it. The supplied photographs may show writing on a plate: that writing is not part of the ${noun} — never copy it, and never write anything else in its place.`,
  );
  if (brief.carModel) {
    // The opening part is built on the reference photos and comes out right; a later
    // part, working from one frame, reached for the older generation it has seen more
    // of — an XUV300 in a film about the XUV 3XO.
    lines.push(
      `- The ${noun} is the ${brief.carModel} and nothing else: the exact vehicle in ${
        brief.attachedCarPhotos ? 'the attached photos' : 'the supplied reference images and reference frame'
      } — same generation, same face, same grille, same lamps, same wheels, same badges, same proportions. Never an earlier generation, never a facelift, never another model from the same family however similar it looks, and never a generic ${noun}. If a shot cannot show it accurately, show less of it — a detail, or the ${noun} out of focus — rather than a different ${noun}.`,
    );
    // The name is a label on a photograph, not a design to be recalled: a model
    // that has seen the name on an older car will draw the older car from it.
    lines.push(
      `- Take the ${noun}'s design from the supplied images only. The name "${brief.carModel}" is a label, not a description — do not build the ${noun} from what the name brings to mind, and do not fill in any part of it from another ${noun} of that name.`,
    );
  }
  /*
   * Lettering, and lamps.
   *
   * Two failures that keep reaching finished films. A model cannot spell, so
   * every word it draws is a misspelling of the client's own name — "Mahindri
   * Medton" over the showroom door, "Tangp Ind 8a 9 10" on the number plate. And
   * a lamp it does not bother to light leaves a black hole where the car's most
   * recognisable signature should be.
   */
  lines.push(
    '- NO LETTERING ANYWHERE IN THE FRAME. Not one letter, digit or word, on anything, at any distance, in or out of focus: no signage, fascia, banner, poster, standee, price board, sticker, screen, brochure, no watermark, no caption, no subtitle. Where a real place would carry writing, render the surface blank, or turn it away from camera, or let it fall out of focus entirely. Number plates follow their own rule above: plain white and blank. Every word the viewer reads is added afterwards.',
    `- The one exception is lettering already moulded into the ${noun} in the supplied photographs, and only where you can read it there and copy it character for character. Nothing is added from what you believe a badge on this ${noun} ought to say. Where a panel's lettering is not legible in the photographs, leave that panel plain — an unbadged tailgate is fine, an invented one is not. Number plates stay blank whatever the photographs show — plain white, with nothing on them.`,
  );
  /*
   * Which reference wins.
   *
   * A part is shown photographs of the vehicle, a frame drawn for the shot, and
   * the frame the part before it ended on. The last two are pictures a model made,
   * and a model told to "carry the same vehicle on from here" carries on whatever
   * is in them — an older badge drawn once is then drawn in every part after it.
   * So the ranking is said outright, and the maker's emblem gets its own line:
   * a brand changes its logo, and the older one is what a model has seen most.
   */
  /*
   * The paint, when nobody chose one.
   *
   * The colour was pinned only when a designer picked one, and left free otherwise
   * — and free is where the drift got in. A Kiger film came back orange in two
   * scenes and yellow in the other two: the photographs are yellow, so the yellow
   * shots were the facelift with the maker's current emblem, and the orange ones
   * were the older car the model has seen in orange, old badge and all. A colour
   * that is not in the photographs is a car that is not in the photographs.
   */
  if (!brief.carColour) {
    lines.push(
      `- The paint is the colour the photographs show, in every shot and in every part — the same colour, the same finish. Never another colour, however well it would suit the scene: a ${noun} in a colour the photographs do not show is a ${noun} taken from somewhere other than the photographs, and it comes with the wrong face and the wrong badge. Where a shot direction names a colour the photographs do not show, the photographs win.`,
    );
  }
  lines.push(
    `- Photographs of other models may be attached, for the scenes that name them. They are not this ${noun}: never take its face, grille, emblem, lamps, wheels or lines from one of them, and never blend two vehicles into one.`,
    `- Where the paint is a colour the photographs do not show, only the paint changes. The face, the grille, the emblem, the lamps, the wheels, the glass and every line stay exactly as photographed — a colour is not a different ${noun}.`,
  );
  lines.push(
    `- THE PHOTOGRAPHS OUTRANK EVERY OTHER IMAGE. The photographs of the ${noun} are the only record of what it looks like. A drawn frame of the shot, or the frame the part before this one ended on, says where the camera is, how the shot is framed and how it is lit — nothing more. Where any of them disagrees with the photographs about the ${noun}'s shape, face, grille, lamps, wheels, badges or proportions, the photographs are right and the other image is wrong: follow the photographs and correct the ${noun} back to them.`,
    `- The maker's emblem on the grille, the tailgate, the wheels and the steering wheel is exactly the emblem in the photographs and in the emblem artwork supplied with them, in that exact design — never an older or a newer version of that maker's logo, and never another maker's. The same emblem, the same design, on the sign over the showroom and anywhere else in the scene that carries it. Makers redraw their emblems, and the one you have seen most is the one they have stopped using: copy what is supplied, not what you remember. Where an emblem is not legible in the photographs and none is supplied, leave that surface plain.`,
  );
  lines.push(
    `- Build this ${noun} only from the supplied photographs. Every panel, lamp, badge, wheel and surface is copied from them — all but the number plates, which stay plain white and blank — and nothing about it comes from anywhere else — not from another ${noun} of this name, not from an earlier generation, not from anything you have seen elsewhere. If a shot would need a view of the ${noun} the photographs do not cover, film an angle they do cover, or hold the camera closer, or let the ${noun} sit out of focus — never fill the gap from memory.`,
  );
  lines.push(
    `- Every lamp on the ${noun} is complete and lit exactly as in the photographs — the full headlamp signature, the daytime running lamps and the connected tail bar, each one present, the right shape and the right length, and glowing. Never leave a dark panel, a blank recess or a half-drawn lamp where a light belongs.`,
  );

  lines.push(
    `- The ${noun} is a real, physical, three-dimensional vehicle in the location — standing on the floor or moving on the road, lit by the scene, with real reflections and a real shadow. Never show it as a photo, poster, print, billboard, screen image, cutout or any flat picture. The reference photos show what the ${noun} looks like; they are never objects to put in the scene. Every shot is filmed in the real location — the showroom or the road — never a studio product shot, a plain white or grey backdrop, or a catalogue-style picture of the ${noun}.`,
  );
  return lines;
}

function spokenLock(brief: Brief): string {
  const lang = brief.language?.name ?? 'Hindi';
  const respelled = brief.language?.needsPhonetics !== false;
  const lines = [
    '## SPOKEN LINES — SAY THESE EXACTLY',
    `Anything in {curly braces} above is the presenter's exact wording, in ${lang}. Speak it word for word. Do not translate it, re-word it, shorten it, extend it or "correct" it, and never read the scene descriptions aloud. Lip movement must match these words, at ${paceDelivery(brief.pace ?? 1, brief.speechWpm)}.`,
    'Say every number and price once, in full — never restart it or repeat any part of it.',
  ];
  if (respelled) {
    lines.push(
      '',
      'HOW TO READ THE BRACES:',
      `- The line is spoken ${lang}. Every word — in ${scriptOf(brief.language?.code)} or in Latin letters — is read as one ordinary, natural word.`,
      '- Only acronyms are said letter by letter: EMI, SUV, ABS. No other word is ever spelled out.',
      '- Doubled vowels are long vowels: "aaj" is aaj, "shuru" is shuru.',
      '- An em dash is a short breath, not a spoken word.',
      '- Numbers, prices and units inside a line are already written as plain English words; read them as ordinary English.',
    '- Speak ONLY the words inside the braces, each line exactly once, in order. Never repeat, echo or double a word — say every word the number of times it is written and no more.',
    '- Shot directions, scene titles, captions and these rules are silent instructions. Never say any of their words aloud, even a word that also appears in the line.',
      '- CRITICAL: this is for the VOICE ONLY. Never render any of it as on-screen text, a subtitle or a caption.',
    );
  }
  return lines.join('\n');
}

/**
 * Words that fit in a stretch of speech, at the rate this film speaks at.
 *
 * The rate is the designer's choice per film — a walkaround and a three-day offer
 * are not read at the same speed — so it decides the budget as well as the
 * instruction. A faster read really does buy more to say.
 */
export function wordBudget(seconds: number, pace = 1, wpm?: number): number {
  const perSecond = wpm ? wpm / 60 : WORDS_PER_SECOND;
  return Math.max(3, Math.round(seconds * perSecond * pace));
}

/**
 * How the delivery is described to the model.
 *
 * Two different things meet here. The speaking rate is what the designer chose,
 * and the word budgets were worked out at that rate, so the model can be told it
 * plainly. The storyboard's `pace` is something else — it is applied to the
 * finished film in post, and asking a model to talk faster only crams the same
 * words into less clip, where the tail of a line spills across the cut and is said
 * twice. So a quick pace asks for energy, never for hurry.
 */
export function paceDelivery(pace: number, wpm?: number): string {
  const rate = speechRate(wpm);
  return pace > 1.05 ? `${rate.delivery}, with extra energy` : rate.delivery;
}

function textLangLine(textLang: Brief['textLang'], language?: Brief['language']): string {
  const name = language?.name ?? 'Hindi';
  const script = scriptOf(language?.code);
  if (textLang === 'mixed')
    return `On-screen text is ${name} and English mixed, exactly as spelled in the list above${
      script === 'Devanagari' ? ' (this is what the Galaxy Honda reference does: "₹ 2.45 लाख तक" above "Cash Discount")' : ''
    }. ${script} must render cleanly — if a ${script} string cannot be rendered accurately, use its English equivalent rather than approximating the characters.`;
  if (textLang === 'hindi')
    return `On-screen text is ${script}-led with English only for numbers and technical terms. ${script} must render cleanly and match the strings above character for character.`;
  return `All on-screen text is English only, even though the speech is ${name}.`;
}

export interface BuildPromptResult {
  parts: PromptPart[];
  scenePlan: ReturnType<typeof planScenes>;
  context: RenderContext;
}

export interface SceneOverride {
  /** The line in plain readable Hindi/Hinglish — for the designer to check the meaning. */
  dialogue?: string;
  /**
   * The spoken respelling, on projects written before Omni was pronouncing the copy
   * correctly on its own.
   *
   * There is one line now, and it is `dialogue`. This is still read first, because
   * on a project that has one it is what the model has been performing — changing
   * that silently would change a film nobody asked to change. Editing the line in
   * the storyboard clears it, and nothing writes a new one.
   */
  phonetic?: string;
  /**
   * A still of this scene, drawn by an image model from the same photographs the
   * video is built on: the composition, the framing and where everything sits.
   *
   * A shot direction is a sentence, and a sentence leaves the camera, the distance
   * and the light to the model — which is why two parts of one film could be shot
   * from nowhere near each other. A frame settles all of it before a rupee is spent,
   * and it is sent as the first reference for the part the scene falls in.
   */
  frame?: { refId: string; storagePath: string; url?: string; filename: string; label: string };
  /**
   * What the vehicle check made of that frame. A frame drawn with the wrong car —
   * an older generation, another maker's emblem — is not sent to the video model,
   * which would otherwise be handed the wrong car as the shot to match.
   */
  frameCheck?: { same: boolean; checked: boolean; why?: string };
  shot?: string;
  /**
   * Filename of the reference image this shot is built on. The prompt cites
   * every reference globally; naming one per scene is what stops the model
   * picking the showroom photo for a macro of the headlamp.
   */
  ref?: string;
  /**
   * The on-screen caption for this scene, as the designer edited it. Undefined
   * keeps the template's caption; an empty string removes it.
   */
  card?: string;
  /** The smaller line under the caption. Undefined keeps the template's. */
  cardSub?: string;
  /** Where the caption sits. Unset or 'auto': wherever the shot is quietest, decided at render. */
  cardPos?: CardPosition | 'auto';
  /** The designer took this scene out of the film. */
  deleted?: boolean;
  /** Held out of this cut, but still written and still on the storyboard. */
  skipped?: boolean;
  /**
   * Fields on this scene that a rewrite must leave exactly as they are.
   *
   * A line you wrote yourself, or kept because it was right, is not something a
   * rewrite should be free to improve. Editing a field by hand locks it — you
   * typed it, you meant it — and the padlock beside it takes the lock off again
   * when you do want it rewritten.
   */
  locked?: ('dialogue' | 'shot' | 'card')[];
}

/**
 * The storyboard edit for a scene. Edits are filed under the scene's beat key.
 * Projects edited before scenes had keys filed them by position; those are read by
 * position until the editor has re-filed them.
 */
export function sceneEditFor<T>(overrides: Record<string, T>, plan: Pick<ScenePlan, 'scenes'>, sc: Scene): T | undefined {
  const byKey = sc.beat.key ? overrides[sc.beat.key] : undefined;
  if (byKey !== undefined) return byKey;
  const keys = Object.keys(overrides);
  if (!keys.length || keys.some((k) => !/^\d+$/.test(k))) return undefined;
  return overrides[String(plan.scenes.indexOf(sc))];
}

export interface BuildPromptOptions {
  /**
   * Manual edits from the storyboard step (PRD P0.5), keyed by each scene's beat
   * key (see sceneEditFor). Lets the user fix one scene's script or shot and
   * regenerate just the master prompt.
   */
  sceneOverrides?: Record<string, SceneOverride>;
}

/**
 * How the film's last clip is told to end. The model does not wrap up a line because
 * its clip is running out — a closing line still being spoken at the last frame is
 * simply cut, and there is no later part to finish it in.
 */
const CLOSING_BEAT =
  'Finish the last line with about a second to spare, then hold the final shot in silence until the clip ends — the film ends with this clip, so a word still being spoken at its last frame is lost.';

export function buildPrompt(brief: Brief, opts: BuildPromptOptions = {}): BuildPromptResult | null {
  if (brief.categories.length === 0) return null;
  const ctx = buildContext(brief);
  const beats = buildBeats(ctx);
  if (!beats.length) return null;
  const overrides = opts.sceneOverrides ?? {};

  const plan = planScenes(beats, ctx.totalDuration, ctx.maxChunk, { speaks: ctx.mode.speaks });
  const totalParts = plan.parts;
  const mode = ctx.mode;
  const actor = brief.actor;
  const catLabels = brief.categories.map((id) => CATEGORY_BY_ID[id]?.label ?? id);
  const attachments = brief.attachments ?? [];

  const partsOut: PromptPart[] = [];

  for (let p = 0; p < totalParts; p++) {
    const scenes = plan.scenes.filter((s) => s.part === p);
    if (!scenes.length) continue;
    const isFirst = p === 0;
    const isLast = p === totalParts - 1;
    const partStart = scenes[0]!.start;
    const partEnd = scenes[scenes.length - 1]!.end;
    const partDuration = Math.round((partEnd - partStart) * 10) / 10;
    const partWordBudget = mode.speaks
      ? scenes.reduce((sum, s) => sum + wordBudget(speakingSeconds(plan, s), 1, brief.speechWpm), 0)
      : 0;
    const L: string[] = [];

    if (totalParts > 1) {
      L.push(
        `PART ${p + 1} OF ${totalParts} — covers ${fmtTime(partStart)}–${fmtTime(partEnd)} of the full ${ctx.totalDuration}s video.`,
        '',
      );
    }

    if (isFirst) {
      L.push(
        `Create a ${partDuration}-second ${ctx.aspect} photorealistic Indian automotive ${
          brief.dealer.kind === 'oem' ? 'brand film' : 'dealership video'
        }` +
          (brief.dealer.dealerName ? ` for ${brief.dealer.dealerName}` : '') +
          '.',
      );
      if (totalParts > 1)
        L.push(
          `This is the OPENING segment of a longer ${ctx.totalDuration}-second video generated in ${totalParts} parts, because one generation cannot hold the whole script without rushing the delivery. End on a natural cut, mid-motion — never an abrupt stop — so it can be extended. When this segment's last line is finished, stop speaking and hold a natural silent beat — a smile, a glance at the car — until the clip ends. Never start a line that is not written in this segment; the next line belongs to the next part.`,
        );
      else if (mode.speaks) L.push(CLOSING_BEAT);
      L.push(`Video type: ${catLabels.join(' + ')}.`);
      if (brief.dealer.kind === 'oem' && brief.dealer.styleNote?.trim())
        L.push(`House style, taken from the brand's own films: ${brief.dealer.styleNote.trim()}`);
      if (brief.dealer.kind === 'oem')
        L.push(
          "This is the manufacturer's own film, not a dealership's: no showroom signage, no dealership name, no local address and no phone number anywhere in frame.",
        );
    } else {
      L.push(
        `EXTEND the previously generated video by exactly ${partDuration} more seconds. Continue seamlessly from the exact last frame — same subject, same car, same location, same lighting and camera language. Do not restart, reset, cut back to the beginning, or reintroduce the scene.`,
      );
      L.push(
        isLast
          ? `This is the FINAL part — close cleanly on the last scene below.${mode.speaks ? ` ${CLOSING_BEAT}` : ''}`
          : 'End on a natural cut, mid-motion, so it can be extended again in the next part. When this segment\'s last line is finished, stop speaking and hold a natural silent beat — a smile, a glance at the car — until the clip ends. Never start a line that is not written in this segment; the next line belongs to the next part.',
      );
    }

    L.push('');
    continuityLock(brief, mode, ctx.vehicle).forEach((line) => L.push(line));

    L.push('');
    L.push('## FORMAT');
    L.push(`Narration mode: ${mode.label}.`);
    if (mode.onCameraPerson && brief.narration === 'presenter') {
      L.push('A single presenter appears on camera and speaks to camera throughout.');
      if (actor.name)
        L.push(
          `Reference presenter: ${actor.name} — same face, hairstyle, styling and identity in every shot. Do not morph the presenter's identity or change the outfit between scenes.`,
        );
      if (actor.style) L.push(`Presenter styling: ${actor.style}.`);
      if (isFirst && actor.voice) L.push(`Delivery: ${actor.voice}.`);
    } else if (brief.narration === 'customer') {
      L.push(
        'A real customer speaks to camera — an ordinary person, not a professional presenter. Keep the delivery slightly unpolished: natural pauses, real expressions, no ad-voice cadence.',
      );
      if (actor.name) L.push(`Reference person: ${actor.name} — same face and identity in every shot.`);
      if (actor.style) L.push(`Styling: ${actor.style}.`);
    } else if (brief.narration === 'voiceover') {
      L.push(
        'NO person appears on camera. Nobody is shown speaking, and no face is lip-syncing. The narration is an off-screen voiceover over car and showroom footage only.',
      );
    } else {
      L.push(
        'NO speech anywhere in this clip: no dialogue, no voiceover, no lip movement, no talking head. The story is carried by the footage, the on-screen text and the music alone.',
      );
    }
    L.push(
      'Keep the exact same car throughout — do not morph the vehicle or change its colour, badge, wheels or shape between shots.',
    );

    // Reference images by filename (PRD P0.4) + car model reference (P0.2).
    if (isFirst && (attachments.length || brief.modelSpecific || brief.lineup)) {
      L.push('');
      L.push('## REFERENCE IMAGES');
      if (!brief.modelSpecific && brief.lineup?.models.length) {
        // Naming the range is the whole point: left open, the model reaches for
        // an older generation it has seen more of, and the dealer gets a film
        // advertising a car they no longer sell.
        const noun = brief.lineup.kind === 'bike' ? 'motorcycle or scooter' : 'car';
        const plural = brief.lineup.kind === 'bike' ? 'motorcycles and scooters' : 'cars';
        L.push(
          brief.dealer.kind === 'oem'
            ? `No single model is the subject. This is the ${brief.lineup.brand} ${plural} range. Every vehicle on screen must be a current ${brief.lineup.brand} ${noun} the brand sells today, from this range and nothing else: ${brief.lineup.models.join(', ')}.`
            : `No single model is the subject. This is a ${brief.lineup.brand} ${plural} dealership. Every vehicle on screen must be a current ${brief.lineup.brand} ${noun} the dealer sells today, from this range and nothing else: ${brief.lineup.models.join(', ')}.`,
        );
        L.push(
          `Show two or three of them, matching the current generation exactly as in the supplied reference images — the current face, lamps, wheels and proportions. Do not show an older generation, a different brand, or a ${brief.lineup.brand} that is not on that list.`,
        );
        L.push(
          brief.lineup.kind === 'bike'
            ? brief.dealer.kind === 'oem'
              ? 'This range is two-wheelers. No cars anywhere in the film, including in the background.'
              : 'This showroom sells two-wheelers. No cars anywhere in the film, including in the background.'
            : brief.dealer.kind === 'oem'
              ? `This range is cars. No motorcycles or scooters anywhere in the film, including in the background — ${brief.lineup.brand} badges both, and the wrong one on screen makes the film unusable.`
              : `This showroom sells cars. No motorcycles or scooters anywhere in the film, including in the background — ${brief.lineup.brand} badges both, and the wrong one on screen makes the film unusable.`,
        );
      }
      if (brief.modelSpecific && brief.alsoFeatured?.length) {
        L.push(
          `This film features more than one vehicle: ${[brief.carModel, ...brief.alsoFeatured].join(', ')}. Give each its own moment on screen and keep every one of them true to its supplied reference images — do not blend two models into one vehicle.`,
        );
      }
      if (brief.modelSpecific && brief.carModel) {
        L.push(
          `Car model: ${brief.carModel}. Match the current-generation ${brief.carModel} exactly as shown in the supplied car-model reference set — body shape, face, lamps, wheels and proportions. Do not substitute an older generation or invent a design.`,
        );
      }
      if (brief.modelSpecific && brief.carModel && brief.carColour) {
        // The library's angle photos are usually one launch colour. Unless the
        // paint is said outright, the model copies whatever colour they show.
        L.push(
          brief.attachedCarPhotos
            ? `Paint colour: ${brief.carColour}. The car is ${brief.carColour} in every shot, on every painted body panel. The attached photos are the vehicle: take its shape, face, lamps and wheels from them, and paint it ${brief.carColour} even if a photo shows another colour.`
            : `Paint colour: ${brief.carColour}. The car is ${brief.carColour} in every shot — every painted body panel, in every scene. The colour reference image shows this paint. The other car photos are shape references and may show the car in a different colour: take its shape, face, lamps and wheels from them, never their paint.`,
        );
      }
      if (brief.attachedCarPhotos) {
        L.push(
          `The attached vehicle photos ARE the ${ctx.vehicle === 'bike' ? 'bike' : 'car'} in this film — the only reference for what it looks like. Match them exactly: the same generation, the same face, grille, lamps, wheels, proportions and badges. Take nothing about this vehicle from anywhere else — not from another version of this model, not from an earlier generation of it, not from anything you have seen before. Where a detail is not visible in these photos, work it out from them; never fill it in from memory.`,
        );
      }
      if (attachments.length) {
        L.push(
          'These supplied reference images show exactly how things look — copy the car\'s design, colour and details and the showroom\'s look from them faithfully, but film them as real things in the scene. Never paste, hang, display or frame a reference photo itself inside the video. Refer to each by its filename:',
        );
        for (const a of attachments) {
          L.push(`- ${a.filename} — ${a.label}${a.kind === 'logo' ? ' (overlay / end card only)' : ''}`);
        }
      }
    }

    L.push('');
    L.push('## BRANDING');
    if (ctx.useFake) {
      L.push(
        `Use fictional branding only: ${ctx.displayBrandModel} — ${
          brief.dealer.kind === 'oem' ? 'Manufacturer' : 'Dealership'
        }: ${ctx.displayDealer}.`,
      );
      L.push(
        'Do NOT render any real automotive manufacturer logo, wordmark or badge anywhere in this clip' +
          (brief.dealer.dealerName ? `, and do not use ${brief.dealer.dealerName}'s real branding` : '') +
          '.',
      );
    } else {
      L.push(
        `Brand and model: ${ctx.displayBrandModel}. ${
          brief.dealer.kind === 'oem' ? 'Manufacturer' : 'Dealership'
        }: ${ctx.displayDealer}.`,
      );
    }

    L.push('');
    L.push('## AUDIO');
    if (mode.speaks) {
      L.push(
        `Spoken language: ${brief.language?.name ?? 'Hindi/Hinglish'}, following the Pronunciation & Delivery Rules at the end of this prompt.`,
      );
      L.push(
        `Dialogue budget for this clip: about ${partWordBudget} words in total across ${scenes.length} scene${scenes.length > 1 ? 's' : ''}, worked out at about ${speechRate(brief.speechWpm).wpm} words a minute. Do not exceed it. Speak at ${paceDelivery(1, brief.speechWpm)} — if a line will not fit its scene, shorten the line rather than speeding up the delivery.`,
      );
      L.push('No subtitles and no captions burned over the speech.');
    } else {
      L.push(
        'No spoken audio of any kind. Where a scene below describes something being said or told, convey it through the footage and the on-screen text instead — never through a talking mouth.',
      );
    }
    // The music bed is one continuous track laid under the finished film in post.
    // Music a model makes lives inside each separately generated part and restarts
    // at every join, so the model is asked for none.
    L.push(
      'No background music of any kind — no score, no jingle, no beat. One continuous music track is added under the finished video afterwards; keep only the voice and natural room sound.',
    );

    // A written line is the single biggest lever on spoken quality, so the lock
    // stands on its own rather than riding along with the on-screen text block.
    const hasScript = scenes.some((sc) =>
      (sceneEditFor(overrides, plan, sc)?.phonetic ?? sceneEditFor(overrides, plan, sc)?.dialogue ?? '').trim(),
    );
    if (mode.speaks && hasScript) {
      L.push('');
      L.push(spokenLock(brief));
    }

    // On-screen text used to be listed here for the model to draw. It is now
    // composited in post — see overlayCards() — because a video model garbles
    // small text, and a garbled price card makes the whole take unusable.
    L.push('');
    L.push(
      brief.dealer.kind === 'oem'
        ? `Copy tone: ${brief.captionStyle}${brief.dealer.segment ? ` (${brief.dealer.segment} marque)` : ''}.`
        : `Copy tone: ${brief.captionStyle} (${brief.dealer.tier} dealer).`,
    );

    L.push('');
    L.push('## VISUAL STYLE');
    L.push(
      isFirst
        ? `${ctx.visStyle}. Camera: 24–35mm, smooth gimbal moves, medium and wide framing with macro detail inserts, subtle push-ins, hard commercial cuts on the beat. Graphics: clean rounded white cards with a small brand-accent icon, dark text, soft shadow, quick pop animation.`
        : `Maintain the exact same visual style, camera language, grading and graphic treatment as the previous clip: ${ctx.visStyle}.`,
    );

    const theme = storyTheme(brief);
    if (theme) {
      L.push('');
      L.push('## THEME — THE SETTING OF THE WHOLE FILM');
      L.push(themeDirection(theme));
    }

    const direction = (brief.extraDirection ?? []).filter((x) => x.trim());
    if (direction.length) {
      L.push('');
      L.push('## ADDITIONAL DIRECTION');
      direction.forEach((d) => L.push(d));
    }

    L.push('');
    L.push('---');
    scenes.forEach((sc, i) => {
      const ov = sceneEditFor(overrides, plan, sc) ?? {};
      const localStart = Math.round((sc.start - partStart) * 10) / 10;
      const localEnd = Math.round((sc.end - partStart) * 10) / 10;
      L.push(
        `### Scene ${i + 1} — ${fmtTime(localStart)}–${fmtTime(localEnd)} (${sc.duration}s)${
          totalParts > 1 ? ` — video time ${fmtTime(sc.start)}–${fmtTime(sc.end)}` : ''
        } — ${sc.beat.title}`,
      );
      const baseShot = !mode.onCameraPerson && sc.beat.shotAlt ? sc.beat.shotAlt : sc.beat.shot;
      const shotText = ov.shot?.trim() || baseShot;
      if (shotText) L.push(`Shot: ${shotText}`);
      // The photo this shot is built on: the designer's pick, a photo of the part the
      // shot frames, or a plain instruction to render that part generically rather
      // than bend a photo of something else into it.
      const visualLine = sceneVisualLine(sceneVisual(shotText ?? '', ov.ref, attachments, ctx.vehicle), ctx.vehicle);
      if (visualLine) L.push(visualLine);
      // Plain words only: no stress capitals, no syllable hyphens, no doubled word.
      const scripted = (ov.phonetic?.trim() ? plainSpoken(ov.phonetic.trim(), ov.dialogue) : '') || ov.dialogue?.trim();
      const dialogue = scripted || sc.beat.dialogue;
      if (mode.speaks && scripted) {
        // Braces are Seedance's dialogue marker and read as an exact quote to
        // every other model — the difference between reading a line and
        // inventing one, which is where Hindi pronunciation falls apart.
        L.push(`Says, word for word: {${scripted}}`);
      } else if (mode.speaks && dialogue) {
        L.push(
          `Speaks in ${brief.language?.name ?? 'Hindi/Hinglish'}, at most ~${wordBudget(speakingSeconds(plan, sc), 1, brief.speechWpm)} words. NO SCRIPT WAS WRITTEN for this scene, so compose the line yourself from this intent, then speak it naturally: ${dialogue}`,
        );
      } else if (dialogue) {
        L.push(`Story beat, told visually with no speech: ${dialogue}`);
      }
      if (sceneCard(sc.beat, ov)) {
        // Room, not words: a caption is laid over this moment in post.
        L.push(
          'A caption is composited over this shot afterwards — leave the lower third uncluttered and draw no text here yourself.',
        );
      }
      if (sc.beat.note) L.push(`Note: ${sc.beat.note}`);
      L.push('---');
    });

    L.push('');
    L.push('## CLEAN FRAME — NO BRANDING FURNITURE');
    L.push(CLEAN_FRAME);

    L.push('');
    L.push('## IMPORTANT');
    const important: string[] = [];
    if (ctx.useFake)
      important.push('No real automotive manufacturer logo, wordmark or badge anywhere in the video.');
    important.push('Same car in every shot — no change of colour, badge, wheels or body shape.');
    important.push(
      `The ${ctx.vehicle === 'bike' ? 'bike' : 'car'} is a real vehicle physically in the scene in every shot — never a photo, poster, screen image, cutout or white-backdrop studio shot of one.`,
    );
    if (mode.onCameraPerson)
      important.push(
        'Same single person in every shot and every part — no change of face, hairstyle (open hair never becomes tied, nor tied hair open), outfit, accessories or build; never a duplicate of the presenter or other people in the background; never appearing, vanishing or melting mid-shot.',
      );
    if (mode.speaks)
      important.push(
        `One unchanged ${actor.gender === 'male' ? 'male' : 'female'} voice from the first word to the last — never a second voice or a ${
          actor.gender === 'male' ? 'female' : 'male'
        } voice.`,
      );
    if (mode.lipSync)
      important.push(
        `${brief.language?.name ?? 'Hindi'} lip-sync must match the spoken line precisely; do not speed up the delivery to fit the time.`,
      );
    if (!mode.speaks) important.push('No lip movement, no talking head, no implied speech anywhere.');
    important.push('No warped text, no garbled letters, no distorted vehicle geometry.');
    important.push('Every number plate is a plain white plate with nothing on it — never lettered, never missing.');
    important.push('Realistic human motion — natural walking, natural gestures, no floating or sliding.');
    if (isFirst)
      important.push(
        `The result must look like a professionally filmed Indian ${
          brief.dealer.kind === 'oem' ? 'brand film' : 'dealership reel'
        }, not an AI montage.`,
      );
    if (!isFirst) important.push('Continue the previous clip exactly — same subject, same location, same grade.');
    if (attachments.length)
      important.push(
        'Reference images are faithful guides to how the car, the showroom and the logos look — copy their details exactly, except any writing on a number plate, which is never copied; and never show a reference photo itself as a picture, poster or screen in the video.',
      );
    if (isFirst) {
      for (const a of storyGuidance(brief).avoid) important.push(`Avoid: ${a}`);
    }
    important.forEach((i) => L.push(`* ${i}`));

    if (mode.speaks) {
      L.push('');
      if (hasScript) {
        // The exact words AND their pronunciation are already fixed in the
        // SPOKEN LINES block. Repeating 2.8KB of rules for saying numbers,
        // abbreviations and currency then adds nothing — and every kilobyte the
        // model does not need dilutes the shot direction it does.
        L.push('## DELIVERY');
        L.push(
          `${brief.language?.name ?? 'Hindi/Hinglish'}, ${
            actor.gender === 'male' ? 'masculine' : 'feminine'
          } verb forms, ${paceDelivery(ctx.pace, ctx.speechWpm)}. The words and their pronunciation are fixed above — do not restyle, re-order or re-pronounce them.`,
        );
      } else {
        L.push('## PRONUNCIATION & DELIVERY RULES (apply to every spoken word in this clip)');
        L.push(rulebookText(actor.gender));
      }
    }

    // Prompt for segments 2+. Each is an independent `create` call seeded with
    // the PREVIOUS segment's last frame as a reference image, then ffmpeg-stitched.
    // So it must be self-sufficient (branding, style, identity) AND lock onto the
    // reference frame so the character / car / setting don't change across the cut.
    const C: string[] = [];
    C.push(
      `Generate a ${partDuration}-second ${ctx.aspect} segment that continues an ongoing Indian ${
        brief.dealer.kind === 'oem' ? 'automotive brand film' : 'car-dealership video'
      }.`,
    );
    C.push(
      'The FIRST frame must match the supplied reference frame EXACTLY: ' +
        (mode.onCameraPerson
          ? 'same presenter (identical face, hair, skin tone, make-up, wardrobe and body), '
          : '') +
        'same car (identical model, colour, wheels, badges), same showroom and background, same framing, lens, lighting and colour grade. Then continue the motion naturally — no cut back to an intro, no titles, no restart.',
    );
    C.push('');
    continuityLock(brief, mode, ctx.vehicle).forEach((line) => C.push(line));
    C.push('');
    if (brief.attachedCarPhotos) {
      C.push(
        'The vehicle photos supplied with this segment are the vehicle. Build every shot of it on them and on the reference frame, and on nothing else you know about this model.',
        '',
      );
    }
    if (mode.onCameraPerson) {
      // A continuation that re-imagines its presenter leaves two of them on screen, the
      // one from the seed frame fading away behind the new one.
      C.push(
        'The presenter in the reference frame is the only presenter. Carry that same person on from exactly where they stand in the first frame — never create another presenter elsewhere while the first one fades, melts or disappears.',
        '',
      );
    }
    if (mode.speaks) {
      // Parts are joined cut to cut, so a word said on both sides of a join is heard
      // twice, and one started in the first instant lands on the cut.
      C.push(
        'Let the first half-second pass before the first spoken word, and do not repeat anything said at the end of the previous part — begin with this segment\'s own first line.',
      );
    }
    if (mode.onCameraPerson) {
      C.push(
        `The on-camera presenter is the same person as in the reference frame${
          actor.style ? `, styled as: ${actor.style}` : ''
        }. Do NOT write the presenter's name or any label anywhere on screen.`,
      );
    }
    // Every part after the first is built from this, so what the opening establishes
    // about whose film it is has to be said again here.
    const contOem = brief.dealer.kind === 'oem';
    C.push(
      ctx.useFake
        ? `Fictional branding only: ${ctx.displayBrandModel} — ${contOem ? 'Manufacturer' : 'Dealership'}: ${ctx.displayDealer}. No real manufacturer logo or badge.`
        : `Brand and model: ${ctx.displayBrandModel}. ${contOem ? 'Manufacturer' : 'Dealership'}: ${ctx.displayDealer}.`,
    );
    if (contOem)
      C.push(
        "This is the manufacturer's own film, not a dealership's: no showroom signage, no dealership name, no local address and no phone number anywhere in frame.",
      );
    if (brief.modelSpecific && brief.carColour) {
      // A continuation segment is built on the previous frame, but a model
      // re-reading its references can still drift back to the photos' paint.
      C.push(`Paint colour: ${brief.carColour} — the same ${brief.carColour} paint as the reference frame, on every body panel.`);
    }
    C.push(`Visual style: ${ctx.visStyle}. Keep the exact same grade and camera language as the reference frame.`);
    const contTheme = storyTheme(brief);
    if (contTheme) C.push(themeDirection(contTheme));
    if (ctx.mode.speaks) {
      C.push(
        `Spoken language: ${brief.language?.name ?? 'Hindi/Hinglish'}, in the same ${actor.gender === 'male' ? 'male' : 'female'} voice as the earlier parts, ${
          actor.gender === 'male' ? 'masculine' : 'feminine'
        } verb forms, ${paceDelivery(ctx.pace, ctx.speechWpm)}, about ${
          scenes.reduce((s, x) => s + wordBudget(speakingSeconds(plan, x), 1, brief.speechWpm), 0)
        } words total across this segment.`,
      );
    } else {
      C.push('No spoken audio; carry the message through footage and on-screen text.');
    }
    C.push('No background music of any kind — no score, no jingle, no beat. One continuous track is added under the finished video afterwards; voice and natural room sound only.');
    C.push(CLEAN_FRAME);
    const contDirection = (brief.extraDirection ?? []).filter((x) => x.trim());
    if (contDirection.length) {
      C.push('');
      C.push('Additional direction (applies to this segment too):');
      contDirection.forEach((d) => C.push(d));
    }
    C.push('');
    C.push('Scenes in this segment:');
    scenes.forEach((sc, i) => {
      const ov = sceneEditFor(overrides, plan, sc) ?? {};
      C.push(`Scene ${i + 1} (~${sc.duration}s) — ${sc.beat.title}`);
      const baseShot = !mode.onCameraPerson && sc.beat.shotAlt ? sc.beat.shotAlt : sc.beat.shot;
      if (ov.shot?.trim() || baseShot) C.push(`  Shot: ${ov.shot?.trim() || baseShot}`);
      const contVisual = sceneVisualLine(
        sceneVisual(ov.shot?.trim() || baseShot || '', ov.ref, attachments, ctx.vehicle),
        ctx.vehicle,
      );
      if (contVisual) C.push(`  ${contVisual}`);
      const scriptedC = (ov.phonetic?.trim() ? plainSpoken(ov.phonetic.trim(), ov.dialogue) : '') || ov.dialogue?.trim();
      const d = scriptedC || sc.beat.dialogue;
      if (d) {
        C.push(
          !mode.speaks
            ? `  Told visually, no speech: ${d}`
            : scriptedC
              ? `  Says, word for word: {${scriptedC}}`
              : `  Speaks ${brief.language?.name ?? 'Hindi/Hinglish'}, ~${wordBudget(speakingSeconds(plan, sc), 1, brief.speechWpm)} words, composed from this intent: ${d}`,
        );
      }
      if (sceneCard(sc.beat, ov)) {
        C.push('  A caption is composited over this shot afterwards — leave the lower third clear, draw no text.');
      }
    });
    C.push('');
    if (
      ctx.mode.speaks &&
      scenes.some((sc) => {
        const o = sceneEditFor(overrides, plan, sc);
        return (o?.phonetic ?? o?.dialogue ?? '').trim();
      })
    ) {
      C.push(spokenLock(brief));
      C.push('');
    }
    C.push(CLEAN_FRAME);
    if (mode.speaks) C.push('Same pronunciation and delivery rules as the earlier parts. Never speak or show numbers/prices that are not in this prompt.');
    C.push(
      `Before finishing, check the continuity lock above: ${
        mode.onCameraPerson ? "one presenter only, with unchanged hair, outfit and look, never popping in or out and never standing inside the car; " : ''
      }${mode.speaks ? 'the voice is the same one as before; ' : ''}every number plate is a plain white plate with nothing on it; the ${ctx.vehicle === 'bike' ? 'bike' : 'car'} is a real vehicle in the real location, never a picture or studio shot of one.`,
    );
    if (isLast) C.push(`This is the final segment — end cleanly on the last scene.${mode.speaks ? ` ${CLOSING_BEAT}` : ''}`);
    else
      C.push(
        "End mid-motion so the next part can continue. When this segment's last line is finished, stop speaking and hold a natural silent beat until the clip ends — never start a line that is not written in this segment; the next line belongs to the next part.",
      );

    partsOut.push({
      partNum: p + 1,
      totalParts,
      start: partStart,
      end: partEnd,
      duration: partDuration,
      isFirst,
      isLast,
      text: L.join('\n'),
      continuationText: C.join('\n'),
    });
  }

  return { parts: partsOut, scenePlan: plan, context: ctx };
}

/**
 * The text cards, with the moment each belongs to.
 *
 * These used to be listed in the prompt for the video model to draw, and it
 * garbled them — a misspelled price card makes a whole take unusable. They are
 * composited in post instead, which is why they carry timings.
 *
 * Times are relative to the card's own PART, because a part is one generated
 * segment and the segments are crossfaded together afterwards; absolute times
 * would drift by the length of every dissolve before them. The end card is
 * excluded: it is a full frame of its own, built separately.
 */
export interface OverlayCard {
  text: string;
  sub?: string;
  /** 1-based part, matching PromptPart.partNum and the segment rendered for it. */
  part: number;
  /** Seconds from the start of that part. */
  start: number;
  end: number;
  /** The length that part was planned at, so a short render still lines up. */
  partSeconds: number;
  /** Where the designer put it. Unset: the render picks the quietest place in the shot. */
  position?: CardPosition;
}

/**
 * The caption a scene actually carries: the designer's edit if there is one,
 * otherwise the template's. The one place this is decided, so the storyboard,
 * the prompt's "leave room for a caption" note and the compositor agree.
 */
export function sceneCard(beat: Beat, ov?: SceneOverride): { text: string; sub?: string } | null {
  if (beat.isEndCard) return null;
  const stacked = (beat.cardLines ?? []).map((l) => l.trim()).filter(Boolean);
  const templateText = beat.card?.trim() || stacked[0] || '';
  const templateSub = beat.card?.trim() ? beat.cardSub?.trim() || '' : stacked.slice(1).join(' · ');
  const text = (ov?.card !== undefined ? ov.card : templateText).trim();
  if (!text) return null;
  const sub = (ov?.cardSub !== undefined ? ov.cardSub : templateSub).trim();
  return { text, sub: sub || undefined };
}

export function overlayCards(plan: ScenePlan, overrides: Record<string, SceneOverride> = {}): OverlayCard[] {
  const out: OverlayCard[] = [];
  for (let p = 0; p < plan.parts; p++) {
    const scenes = plan.scenes.filter((s) => s.part === p);
    if (!scenes.length) continue;
    const partStart = scenes[0]!.start;
    const partSeconds = Math.round((scenes[scenes.length - 1]!.end - partStart) * 10) / 10;

    for (const sc of scenes) {
      const edit = sceneEditFor(overrides, plan, sc);
      const card = sceneCard(sc.beat, edit);
      if (!card) continue;
      // A caption that covers its whole shot is wallpaper. Hold it off the cut
      // at either end so the picture is seen before the words arrive.
      const lead = Math.min(0.4, sc.duration * 0.1);
      out.push({
        text: card.text,
        sub: card.sub,
        part: p + 1,
        start: Math.round((sc.start - partStart + lead) * 10) / 10,
        end: Math.round((sc.end - partStart - lead) * 10) / 10,
        partSeconds,
        position: isCardPosition(edit?.cardPos) ? edit.cardPos : undefined,
      });
    }
  }
  return out;
}

export function joinPromptParts(parts: PromptPart[]): string {
  return parts
    .map((p) => (p.totalParts > 1 ? `===== PART ${p.partNum} / ${p.totalParts} =====\n\n${p.text}` : p.text))
    .join('\n\n\n');
}


/**
 * Turn a reviewer's note into a retake instruction.
 *
 * A finished video is usually 90% right — one gesture, one colour, one bit of
 * staging is off. Regenerating the whole thing pays for every good second again.
 * Instead the offending segment alone is re-run with its original prompt plus
 * this block, which pins everything else down so the retake still cuts against
 * its neighbours.
 */
export function applyFeedback(prompt: string, feedback: string, attached = 0): string {
  const notes = (feedback ?? '')
    .split(/\r?\n|;/)
    .map((n) => n.replace(/^[-*\u2022\d.)\s]+/, '').trim())
    .filter(Boolean);
  if (!notes.length && !attached) return prompt;

  return [
    prompt,
    '',
    '## RETAKE — THIS SHOT HAS ALREADY BEEN FILMED',
    'Everything above was generated once and approved except for the corrections listed below. This is a retake of the SAME shot, not a new idea: same person with the same face, hair, wardrobe and expression, the same car in the same colour, trim and position, the same location and background, the same time of day and lighting, the same lens, framing and camera move, the same on-screen text, the same pacing and the same first and last frame composition.',
    ...(attached
      ? [
          `${attached} reference image${attached === 1 ? ' is' : 's are'} attached to this retake. ${
            attached === 1 ? 'It shows' : 'They show'
          } exactly what the vehicle must look like here — match its design, colour, lamps, wheels and badges shot for shot. ${
            attached === 1 ? 'It is' : 'They are'
          } a guide for how it looks, never something to show in the video as a picture.`,
        ]
      : []),
    ...(notes.length ? ['Change ONLY these points:', ...notes.map((n, i) => `${i + 1}. ${n}`)] : []),
    'Change nothing else. Any difference other than the points listed above is a failed retake.',
  ].join('\n');
}
