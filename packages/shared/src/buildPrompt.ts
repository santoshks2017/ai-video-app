/**
 * Master prompt assembly (PRD P0.5 / P0.8). Ported from the legacy tool's
 * buildPromptParts(), with two additions per the new PRD:
 *  - a REFERENCE IMAGES block that cites attachments by filename (P0.4), so the
 *    model reuses "showroom_front.jpg" verbatim rather than a prose re-description;
 *  - a CAR MODEL REFERENCE note when the brief is model-specific (P0.2).
 */

import type { Brief, PromptPart } from './types.js';
import { WORDS_PER_SECOND } from './constants.js';
import { buildContext, type RenderContext } from './context.js';
import { buildBeats, collectStrings } from './buildBeats.js';
import { planScenes, fmtTime } from './planScenes.js';
import type { ScenePlan } from './types.js';
import { CATEGORY_BY_ID } from './categories.js';
import { rulebookText } from './rulebook.js';

/**
 * The dealer footer, the corner logos and the end card are composited in post
 * (apps/api/src/post.ts), where text is guaranteed legible. The model must
 * therefore leave that furniture out — anything it draws would sit underneath
 * our overlay and show through at the edges.
 */
const CLEAN_FRAME =
  'Leave the frame CLEAN of any text or branding furniture. NO text of any kind anywhere in the picture: no titles, no captions, no callouts, no price cards, no offer badges, no subtitles, no lower third, no footer bar, no contact strip, no address or phone number, no logo, wordmark, badge or watermark in any corner, and no end card. Every word the viewer reads is composited afterwards in post, where it is guaranteed legible — anything you draw would sit underneath it and show through at the edges. Film only the scene itself, edge to edge, keeping the top and bottom eighth of the frame free of important action so the overlays have somewhere to sit. Signage that genuinely exists in the location (a showroom fascia, a number plate) is part of the scene and is fine; invented graphics are not.';

/**
 * Name the reference image a single shot is built on.
 *
 * The REFERENCE IMAGES block lists every supplied file, which leaves the model
 * to choose — and it reaches for the wrong one, framing a showroom wide when the
 * scene called for a macro of the lamp. A scene that names its own reference
 * gets what the designer picked.
 */
function refLine(ref: string | undefined, attachments: { filename: string; label: string }[]): string | null {
  const name = ref?.trim();
  if (!name) return null;
  const found = attachments.find((a) => a.filename === name);
  if (!found) return null;
  return `Build this shot on the supplied reference image ${found.filename} (${found.label}) — match its vehicle, angle and setting.`;
}

function spokenLock(brief: Brief): string {
  const lang = brief.language?.name ?? 'Hindi';
  const respelled = brief.language?.needsPhonetics !== false;
  const lines = [
    '## SPOKEN LINES — SAY THESE EXACTLY',
    `Anything in {curly braces} above is the presenter's exact wording, in ${lang}. Speak it word for word. Do not translate it, re-word it, shorten it, extend it or "correct" it, and never read the scene descriptions aloud. Lip movement must match these words, at a natural unhurried pace.`,
  ];
  if (respelled) {
    lines.push(
      '',
      'HOW TO READ THE BRACES — they are written as a pronunciation guide, not as ordinary text:',
      `- The language is spoken ${lang}, respelled in Latin letters so the sounds are unambiguous. Read it as ${lang}, not as English.`,
      '- A hyphen splits syllables of ONE word. Say the word smoothly as a single word — do not pause, stutter or spell it out. "KEE-ji-ye" is one word, "keejiye".',
      '- CAPITALS mark the stressed syllable. Give it the stress; do not shout it, and do not treat capitals as an acronym to be spelled letter by letter.',
      '- Doubled vowels are long vowels: "AAJ" is aaj, "DRAAIV" is drive, "ee" is a long e.',
      '- An em dash is a short breath, not a spoken word.',
      '- Numbers, prices and units are already plain English — "fifteen lakh four thousand", "six airbags" — and are read as ordinary English.',
      '- CRITICAL: this is for the VOICE ONLY. Never render any of it as on-screen text, a subtitle or a caption. Nothing with hyphens or mid-word capitals may ever appear on screen.',
    );
  }
  return lines.join('\n');
}

export function wordBudget(seconds: number): number {
  return Math.max(3, Math.round(seconds * WORDS_PER_SECOND));
}

function textLangLine(textLang: Brief['textLang']): string {
  if (textLang === 'mixed')
    return 'On-screen text is Hindi and English mixed, exactly as spelled in the list above (this is what the Galaxy Honda reference does: "₹ 2.45 लाख तक" above "Cash Discount"). Devanagari must render cleanly — if a Devanagari string cannot be rendered accurately, use its English equivalent rather than approximating the characters.';
  if (textLang === 'hindi')
    return 'On-screen text is Devanagari-led with English only for numbers and technical terms. Devanagari must render cleanly and match the strings above character for character.';
  return 'All on-screen text is English only, even though the speech is Hindi/Hinglish.';
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
   * The same line respelled for pronunciation, which is what actually reaches
   * the video model: syllables hyphenated, the stressed syllable capitalised
   * ("do LAKH pach-CHEES ha-ZAAR ru-Pae tak ka CASH dis-KAAUNT"). Devanagari
   * tells a model what the words are but not how an Indian presenter says them,
   * which is where the delivery was breaking.
   */
  phonetic?: string;
  shot?: string;
  /**
   * Filename of the reference image this shot is built on. The prompt cites
   * every reference globally; naming one per scene is what stops the model
   * picking the showroom photo for a macro of the headlamp.
   */
  ref?: string;
}

export interface BuildPromptOptions {
  /**
   * Manual edits from the storyboard step (PRD P0.5), keyed by the scene's
   * global index (its position in `scenePlan.scenes`). Lets the user fix one
   * scene's script or shot and regenerate just the master prompt.
   */
  sceneOverrides?: Record<string, SceneOverride>;
}

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
      ? scenes.reduce((sum, s) => sum + wordBudget(s.duration), 0)
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
        `Create a ${partDuration}-second ${ctx.aspect} photorealistic Indian automotive dealership video` +
          (brief.dealer.dealerName ? ` for ${brief.dealer.dealerName}` : '') +
          '.',
      );
      if (totalParts > 1)
        L.push(
          `This is the OPENING segment of a longer ${ctx.totalDuration}-second video generated in ${totalParts} parts, because one generation cannot hold the whole script without rushing the delivery. End on a natural cut, mid-motion — never an abrupt stop — so it can be extended.`,
        );
      L.push(`Video type: ${catLabels.join(' + ')}.`);
    } else {
      L.push(
        `EXTEND the previously generated video by exactly ${partDuration} more seconds. Continue seamlessly from the exact last frame — same subject, same car, same location, same lighting and camera language. Do not restart, reset, cut back to the beginning, or reintroduce the scene.`,
      );
      L.push(
        isLast
          ? 'This is the FINAL part — close cleanly on the last scene below.'
          : 'End on a natural cut, mid-motion, so it can be extended again in the next part.',
      );
    }

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
          `No single model is the subject. This is a ${brief.lineup.brand} ${plural} dealership. Every vehicle on screen must be a current ${brief.lineup.brand} ${noun} the dealer sells today, from this range and nothing else: ${brief.lineup.models.join(', ')}.`,
        );
        L.push(
          `Show two or three of them, matching the current generation exactly as in the supplied reference images — the current face, lamps, wheels and proportions. Do not show an older generation, a different brand, or a ${brief.lineup.brand} that is not on that list.`,
        );
        L.push(
          brief.lineup.kind === 'bike'
            ? 'This showroom sells two-wheelers. No cars anywhere in the film, including in the background.'
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
      if (attachments.length) {
        L.push(
          'Use these supplied reference images exactly as provided — do not re-imagine, restyle or regenerate their content. Refer to each by its filename:',
        );
        for (const a of attachments) {
          L.push(`- ${a.filename} — ${a.label}${a.kind === 'logo' ? ' (overlay / end card only)' : ''}`);
        }
      }
    }

    L.push('');
    L.push('## BRANDING');
    if (ctx.useFake) {
      L.push(`Use fictional branding only: ${ctx.displayBrandModel} — Dealership: ${ctx.displayDealer}.`);
      L.push(
        'Do NOT render any real automotive manufacturer logo, wordmark or badge anywhere in this clip' +
          (brief.dealer.dealerName ? `, and do not use ${brief.dealer.dealerName}'s real branding` : '') +
          '.',
      );
    } else {
      L.push(`Brand and model: ${ctx.displayBrandModel}. Dealership: ${ctx.displayDealer}.`);
    }

    L.push('');
    L.push('## AUDIO');
    if (mode.speaks) {
      L.push(
        `Spoken language: ${brief.language?.name ?? 'Hindi/Hinglish'}, following the Pronunciation & Delivery Rules at the end of this prompt.`,
      );
      L.push(
        `Dialogue budget for this clip: about ${partWordBudget} words in total across ${scenes.length} scene${scenes.length > 1 ? 's' : ''}. Do not exceed it. Speak at a natural, unhurried pace with real pauses — if a line will not fit its scene, shorten the line rather than speeding up the delivery.`,
      );
      L.push('No subtitles and no captions burned over the speech.');
    } else {
      L.push(
        'No spoken audio of any kind. Where a scene below describes something being said or told, convey it through the footage and the on-screen text instead — never through a talking mouth.',
      );
    }
    L.push(
      `Music: ${ctx.music || 'a neutral modern commercial track'}${
        mode.speaks ? ', mixed low so it sits under the voice.' : ', carrying the full energy of the clip.'
      }`,
    );

    // A written line is the single biggest lever on spoken quality, so the lock
    // stands on its own rather than riding along with the on-screen text block.
    const hasScript = scenes.some((sc) =>
      (overrides[String(plan.scenes.indexOf(sc))]?.phonetic ?? overrides[String(plan.scenes.indexOf(sc))]?.dialogue ?? '').trim(),
    );
    if (mode.speaks && hasScript) {
      L.push('');
      L.push(spokenLock(brief));
    }

    // On-screen text used to be listed here for the model to draw. It is now
    // composited in post — see overlayCards() — because a video model garbles
    // small text, and a garbled price card makes the whole take unusable.
    L.push('');
    L.push(`Copy tone: ${brief.captionStyle} (${brief.dealer.tier} dealer).`);

    L.push('');
    L.push('## VISUAL STYLE');
    L.push(
      isFirst
        ? `${ctx.visStyle}. Camera: 24–35mm, smooth gimbal moves, medium and wide framing with macro detail inserts, subtle push-ins, hard commercial cuts on the beat. Graphics: clean rounded white cards with a small brand-accent icon, dark text, soft shadow, quick pop animation.`
        : `Maintain the exact same visual style, camera language, grading and graphic treatment as the previous clip: ${ctx.visStyle}.`,
    );

    const direction = (brief.extraDirection ?? []).filter((x) => x.trim());
    if (direction.length) {
      L.push('');
      L.push('## ADDITIONAL DIRECTION');
      direction.forEach((d) => L.push(d));
    }

    L.push('');
    L.push('---');
    scenes.forEach((sc, i) => {
      const globalIndex = plan.scenes.indexOf(sc);
      const ov = overrides[String(globalIndex)] ?? {};
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
      const sceneRef = refLine(ov.ref, attachments);
      if (sceneRef) L.push(sceneRef);
      const scripted = ov.phonetic?.trim() || ov.dialogue?.trim();
      const dialogue = scripted || sc.beat.dialogue;
      if (mode.speaks && scripted) {
        // Braces are Seedance's dialogue marker and read as an exact quote to
        // every other model — the difference between reading a line and
        // inventing one, which is where Hindi pronunciation falls apart.
        L.push(`Says, word for word: {${scripted}}`);
      } else if (mode.speaks && dialogue) {
        L.push(
          `Speaks in ${brief.language?.name ?? 'Hindi/Hinglish'}, at most ~${wordBudget(sc.duration)} words. NO SCRIPT WAS WRITTEN for this scene, so compose the line yourself from this intent, then speak it naturally: ${dialogue}`,
        );
      } else if (dialogue) {
        L.push(`Story beat, told visually with no speech: ${dialogue}`);
      }
      if (sc.beat.card || sc.beat.cardLines?.length) {
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
    if (mode.onCameraPerson)
      important.push('Same person in every shot — no change of face, hair, outfit or build.');
    if (mode.lipSync)
      important.push(
        'Hindi lip-sync must match the spoken line precisely; do not speed up the delivery to fit the time.',
      );
    if (!mode.speaks) important.push('No lip movement, no talking head, no implied speech anywhere.');
    important.push('No warped text, no garbled letters, no distorted vehicle geometry.');
    important.push('Realistic human motion — natural walking, natural gestures, no floating or sliding.');
    if (isFirst)
      important.push('The result must look like a professionally filmed Indian dealership reel, not an AI montage.');
    if (!isFirst) important.push('Continue the previous clip exactly — same subject, same location, same grade.');
    if (attachments.length)
      important.push('Reference images are used as-is — never regenerate or reinterpret a supplied photo or logo.');
    if (isFirst) {
      for (const id of brief.categories) {
        for (const a of CATEGORY_BY_ID[id]?.avoid ?? []) important.push(`Avoid: ${a}`);
      }
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
          } verb forms, natural unhurried pace with real pauses. The words and their pronunciation are fixed above — do not restyle, re-order or re-pronounce them.`,
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
      `Generate a ${partDuration}-second ${ctx.aspect} segment that continues an ongoing Indian car-dealership video.`,
    );
    C.push(
      'The FIRST frame must match the supplied reference frame EXACTLY: ' +
        (mode.onCameraPerson
          ? 'same presenter (identical face, hair, skin tone, make-up, wardrobe and body), '
          : '') +
        'same car (identical model, colour, wheels, badges), same showroom and background, same framing, lens, lighting and colour grade. Then continue the motion naturally — no cut back to an intro, no titles, no restart.',
    );
    if (mode.onCameraPerson) {
      C.push(
        `The on-camera presenter is the same person as in the reference frame${
          actor.style ? `, styled as: ${actor.style}` : ''
        }. Do NOT write the presenter's name or any label anywhere on screen.`,
      );
    }
    C.push(
      ctx.useFake
        ? `Fictional branding only: ${ctx.displayBrandModel} — Dealership: ${ctx.displayDealer}. No real manufacturer logo or badge.`
        : `Brand and model: ${ctx.displayBrandModel}. Dealership: ${ctx.displayDealer}.`,
    );
    C.push(`Visual style: ${ctx.visStyle}. Keep the exact same grade and camera language as the reference frame.`);
    if (ctx.mode.speaks) {
      C.push(
        `Spoken language: Hindi/Hinglish, natural unhurried pace, about ${
          scenes.reduce((s, x) => s + wordBudget(x.duration), 0)
        } words total across this segment.`,
      );
    } else {
      C.push('No spoken audio; carry the message through footage and on-screen text.');
    }
    C.push(`Music: ${ctx.music || 'a neutral modern commercial track'}.`);
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
      const ov = overrides[String(plan.scenes.indexOf(sc))] ?? {};
      C.push(`Scene ${i + 1} (~${sc.duration}s) — ${sc.beat.title}`);
      const baseShot = !mode.onCameraPerson && sc.beat.shotAlt ? sc.beat.shotAlt : sc.beat.shot;
      if (ov.shot?.trim() || baseShot) C.push(`  Shot: ${ov.shot?.trim() || baseShot}`);
      const contRef = refLine(ov.ref, attachments);
      if (contRef) C.push(`  ${contRef}`);
      const scriptedC = ov.phonetic?.trim() || ov.dialogue?.trim();
      const d = scriptedC || sc.beat.dialogue;
      if (d) {
        C.push(
          !mode.speaks
            ? `  Told visually, no speech: ${d}`
            : scriptedC
              ? `  Says, word for word: {${scriptedC}}`
              : `  Speaks ${brief.language?.name ?? 'Hindi/Hinglish'}, ~${wordBudget(sc.duration)} words, composed from this intent: ${d}`,
        );
      }
      if (sc.beat.card || sc.beat.cardLines?.length) {
        C.push('  A caption is composited over this shot afterwards — leave the lower third clear, draw no text.');
      }
    });
    C.push('');
    if (
      ctx.mode.speaks &&
      scenes.some((sc) => {
        const o = overrides[String(plan.scenes.indexOf(sc))];
        return (o?.phonetic ?? o?.dialogue ?? '').trim();
      })
    ) {
      C.push(spokenLock(brief));
      C.push('');
    }
    C.push(CLEAN_FRAME);
    if (mode.speaks) C.push('Same pronunciation and delivery rules as the earlier parts. Never speak or show numbers/prices that are not in this prompt.');
    if (isLast) C.push('This is the final segment — end cleanly on the last scene.');

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
}

export function overlayCards(plan: ScenePlan): OverlayCard[] {
  const out: OverlayCard[] = [];
  for (let p = 0; p < plan.parts; p++) {
    const scenes = plan.scenes.filter((s) => s.part === p);
    if (!scenes.length) continue;
    const partStart = scenes[0]!.start;
    const partSeconds = Math.round((scenes[scenes.length - 1]!.end - partStart) * 10) / 10;

    for (const sc of scenes) {
      if (sc.beat.isEndCard) continue;
      const headline = sc.beat.card?.trim();
      const stacked = (sc.beat.cardLines ?? []).map((l) => l.trim()).filter(Boolean);
      const text = headline || stacked[0];
      if (!text) continue;
      // A caption that covers its whole shot is wallpaper. Hold it off the cut
      // at either end so the picture is seen before the words arrive.
      const lead = Math.min(0.4, sc.duration * 0.1);
      out.push({
        text,
        sub: headline
          ? sc.beat.cardSub?.trim() || undefined
          : stacked.slice(1).join(' · ') || undefined,
        part: p + 1,
        start: Math.round((sc.start - partStart + lead) * 10) / 10,
        end: Math.round((sc.end - partStart - lead) * 10) / 10,
        partSeconds,
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
export function applyFeedback(prompt: string, feedback: string): string {
  const notes = (feedback ?? '')
    .split(/\r?\n|;/)
    .map((n) => n.replace(/^[-*\u2022\d.)\s]+/, '').trim())
    .filter(Boolean);
  if (!notes.length) return prompt;

  return [
    prompt,
    '',
    '## RETAKE — THIS SHOT HAS ALREADY BEEN FILMED',
    'Everything above was generated once and approved except for the corrections listed below. This is a retake of the SAME shot, not a new idea: same person with the same face, hair, wardrobe and expression, the same car in the same colour, trim and position, the same location and background, the same time of day and lighting, the same lens, framing and camera move, the same on-screen text, the same pacing and the same first and last frame composition.',
    'Change ONLY these points:',
    ...notes.map((n, i) => `${i + 1}. ${n}`),
    'Change nothing else. Any difference other than the points listed above is a failed retake.',
  ].join('\n');
}
