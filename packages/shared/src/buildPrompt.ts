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
import { CATEGORY_BY_ID } from './categories.js';
import { rulebookText } from './rulebook.js';

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
  dialogue?: string;
  shot?: string;
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

  const plan = planScenes(beats, ctx.totalDuration, ctx.maxChunk);
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
    if (isFirst && (attachments.length || brief.modelSpecific)) {
      L.push('');
      L.push('## REFERENCE IMAGES');
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
        'Spoken language: Hindi/Hinglish, following the Pronunciation & Delivery Rules at the end of this prompt.',
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

    const strings = collectStrings(scenes, ctx.footer);
    if (strings.length) {
      L.push('');
      L.push('## ON-SCREEN TEXT — EXACT STRINGS');
      L.push(
        "Render these strings EXACTLY as written: same spelling, spacing, punctuation, case and symbols. Do not paraphrase, translate, abbreviate, re-spell or 'correct' them. Misspelled on-screen text is the single most common failure in this format.",
      );
      strings.forEach((s, i) => L.push(`${i + 1}. "${s}"`));
      L.push(textLangLine(brief.textLang));
      L.push(
        'Keep each card to one short headline plus at most one smaller sub-line. Never stack more than two text elements on screen at once.',
      );
      L.push(`Copy tone: ${brief.captionStyle} (${brief.dealer.tier} dealer).`);
    }

    L.push('');
    L.push('## VISUAL STYLE');
    L.push(
      isFirst
        ? `${ctx.visStyle}. Camera: 24–35mm, smooth gimbal moves, medium and wide framing with macro detail inserts, subtle push-ins, hard commercial cuts on the beat. Graphics: clean rounded white cards with a small brand-accent icon, dark text, soft shadow, quick pop animation.`
        : `Maintain the exact same visual style, camera language, grading and graphic treatment as the previous clip: ${ctx.visStyle}.`,
    );

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
      const dialogue = ov.dialogue?.trim() || sc.beat.dialogue;
      if (mode.speaks && dialogue) {
        L.push(`Spoken (Hindi/Hinglish), max ~${wordBudget(sc.duration)} words: ${dialogue}`);
      } else if (dialogue) {
        L.push(`Story beat, told visually with no speech: ${dialogue}`);
      }
      if (sc.beat.card) {
        L.push(`On-screen card, headline: "${sc.beat.card}"`);
        if (sc.beat.cardSub) L.push(`On-screen card, sub-line under it: "${sc.beat.cardSub}"`);
      }
      if (sc.beat.cardLines && sc.beat.cardLines.length) {
        L.push('On-screen text, stacked and centred, one line per row:');
        sc.beat.cardLines.forEach((line, li) => L.push(`  Line ${li + 1}: "${line}"`));
      }
      if (sc.beat.note) L.push(`Note: ${sc.beat.note}`);
      L.push('---');
    });

    L.push('');
    L.push('## PERSISTENT BRANDING (hold in every scene)');
    L.push(`Top-left: ${String(ctx.displayBrandModel).split(' ')[0]}`);
    L.push(`Top-right: ${ctx.displayDealer}`);
    if (ctx.footer) L.push(`Bottom footer bar, unchanged all the way through: "${ctx.footer}"`);

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
      L.push('## PRONUNCIATION & DELIVERY RULES (apply to every spoken word in this clip)');
      L.push(rulebookText(actor.gender));
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
    if (ctx.footer) C.push(`Hold the bottom footer bar unchanged: "${ctx.footer}". Top-right: ${ctx.displayDealer}.`);
    C.push('');
    C.push('Scenes in this segment:');
    scenes.forEach((sc, i) => {
      const ov = overrides[String(plan.scenes.indexOf(sc))] ?? {};
      C.push(`Scene ${i + 1} (~${sc.duration}s) — ${sc.beat.title}`);
      const baseShot = !mode.onCameraPerson && sc.beat.shotAlt ? sc.beat.shotAlt : sc.beat.shot;
      if (ov.shot?.trim() || baseShot) C.push(`  Shot: ${ov.shot?.trim() || baseShot}`);
      const d = ov.dialogue?.trim() || sc.beat.dialogue;
      if (d) {
        C.push(
          mode.speaks
            ? `  Spoken (Hindi/Hinglish, ~${wordBudget(sc.duration)} words): ${d}`
            : `  Told visually, no speech: ${d}`,
        );
      }
      if (sc.beat.card) C.push(`  On-screen card: "${sc.beat.card}"${sc.beat.cardSub ? ` / "${sc.beat.cardSub}"` : ''}`);
      (sc.beat.cardLines ?? []).forEach((line) => C.push(`  On-screen line: "${line}"`));
    });
    const contStrings = collectStrings(scenes, '');
    C.push('');
    C.push('## ON-SCREEN TEXT — EXACT STRINGS (do not render anything else as text)');
    if (contStrings.length) {
      C.push(
        "Render these strings EXACTLY as written — same spelling, spacing, punctuation, case and symbols. Do not paraphrase, translate, abbreviate, re-spell or 'correct' them. Garbled on-screen text is the most common failure in this format:",
      );
      contStrings.forEach((s, i) => C.push(`${i + 1}. "${s}"`));
      C.push(textLangLine(brief.textLang));
      C.push('One short headline plus at most one smaller sub-line per card. Never more than two text elements on screen at once.');
    } else {
      C.push('No on-screen text cards in this segment. Only the persistent corner logos and the footer bar.');
    }
    C.push(
      `The persistent overlays are ONLY: top-left "${String(ctx.displayBrandModel).split(' ')[0]}", top-right "${ctx.displayDealer}"${
        ctx.footer ? `, and the bottom footer bar "${ctx.footer}"` : ''
      }. No other words, names or labels anywhere.`,
    );
    if (mode.speaks) C.push('Same Hindi/Hinglish pronunciation and delivery rules as the earlier parts. Never speak or show numbers/prices that are not in this prompt.');
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

export function joinPromptParts(parts: PromptPart[]): string {
  return parts
    .map((p) => (p.totalParts > 1 ? `===== PART ${p.partNum} / ${p.totalParts} =====\n\n${p.text}` : p.text))
    .join('\n\n\n');
}
