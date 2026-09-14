/**
 * Render a video editor project to a finished MP4.
 *
 * No model, no cost: ffmpeg only, so an edit takes seconds to minutes and cannot
 * change what the film shows. It works in three passes, because one filter graph
 * holding every clip, every grade, every transition and every overlay is the
 * graph that runs a two-vCPU instance out of memory:
 *
 *   1. each main-track clip on its own — trimmed, re-timed, graded, faded, at the
 *      one frame size, frame rate and sound format everything shares;
 *   2. those pieces joined in order, dissolving where a transition asks for it and
 *      cut to cut where it does not, with black filling any gap;
 *   3. text laid over the top as rendered PNGs, and the sound track mixed in.
 */

import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  EDIT_MAIN_TRACK,
  EDIT_FILTERS,
  EDIT_TRANSITIONS,
  EDIT_FONTS,
  editAspectSize,
  editClipEnd,
  editClipLength,
  type EditClip,
  type EditProject,
  type EditSource,
  type EditTextStyle,
} from '@ava/shared';
import { run, probe, hasAudio, FF_THREADS, esc } from './post.js';

export type LoadSource = (src: EditSource) => Promise<Buffer | null>;

const FPS = 30;
const AUDIO = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo';
const ENCODE_V = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p'];
const ENCODE_A = ['-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2'];
const n3 = (x: number): string => Math.max(0, x).toFixed(3);

/** atempo takes 0.5–2 per instance; anything further is a chain of them. */
function atempoChain(speed: number): string {
  const parts: string[] = [];
  let s = Math.max(0.25, Math.min(4, speed));
  while (s > 2) {
    parts.push('atempo=2');
    s /= 2;
  }
  while (s < 0.5) {
    parts.push('atempo=0.5');
    s /= 0.5;
  }
  parts.push(`atempo=${s.toFixed(4)}`);
  return parts.join(',');
}

const audioFades = (len: number, fadeIn: number, fadeOut: number): string => {
  const fi = Math.min(fadeIn, len / 2);
  const fo = Math.min(fadeOut, len / 2);
  return [
    fi > 0.01 ? `afade=t=in:st=0:d=${n3(fi)}` : '',
    fo > 0.01 ? `afade=t=out:st=${n3(len - fo)}:d=${n3(fo)}` : '',
  ]
    .filter(Boolean)
    .join(',');
};

/** One main-track clip, rendered alone at the shared frame size, rate and sound format. */
async function renderPiece(
  dir: string,
  i: number,
  clip: EditClip,
  bytes: Buffer,
  W: number,
  H: number,
  silent: boolean,
): Promise<string> {
  const out = join(dir, `piece-${i}.mp4`);
  const len = editClipLength(clip);
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
  const args = ['-v', 'error', '-y', '-threads', FF_THREADS];
  let videoIn: string;
  let soundIn: string | null = null;

  if (clip.source?.type === 'image') {
    // Through sharp first: an upload arrives with no extension, and ffmpeg's image
    // reader guesses the format from the file name.
    const still = join(dir, `still-${i}.png`);
    await sharp(bytes).png().toFile(still);
    args.push('-loop', '1', '-t', n3(len), '-i', still);
    videoIn = `[0:v]${fit},fps=${FPS},format=yuv420p`;
  } else {
    const src = join(dir, `src-${i}`);
    await writeFile(src, bytes);
    const speed = Math.max(0.25, Math.min(4, clip.speed || 1));
    args.push('-ss', n3(clip.in), '-t', n3(clip.out - clip.in), '-i', src);
    videoIn = `[0:v]setpts=(PTS-STARTPTS)/${speed},${fit},fps=${FPS},format=yuv420p`;
    if (!silent && clip.volume > 0 && (await hasAudio(src))) {
      soundIn = `[0:a]asetpts=PTS-STARTPTS,${atempoChain(speed)},volume=${clip.volume.toFixed(2)},${AUDIO}`;
    }
  }
  // Silence of the clip's length, for a still, a silent source or a muted track.
  args.push('-f', 'lavfi', '-t', n3(len), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');

  const fi = Math.min(clip.fadeIn, len / 2);
  const fo = Math.min(clip.fadeOut, len / 2);
  const vfade = [
    fi > 0.01 ? `fade=t=in:st=0:d=${n3(fi)}` : '',
    fo > 0.01 ? `fade=t=out:st=${n3(len - fo)}:d=${n3(fo)}` : '',
  ]
    .filter(Boolean)
    .join(',');
  const tail = `${vfade ? `,${vfade}` : ''},trim=duration=${n3(len)},setpts=PTS-STARTPTS[v]`;
  const graph: string[] = [];
  const look = clip.filter ? EDIT_FILTERS.find((f) => f.id === clip.filter!.id) : undefined;
  if (look) {
    // Graded in full, then blended back over the original by the strength chosen.
    const strength = Math.max(0, Math.min(1, clip.filter?.strength ?? 1));
    graph.push(`${videoIn},split[base][fx]`);
    graph.push(`[fx]${look.ffmpeg},format=yuv420p[graded]`);
    graph.push(`[base][graded]blend=all_mode=normal:all_opacity=${strength.toFixed(2)},format=yuv420p${tail}`);
  } else {
    graph.push(`${videoIn}${tail}`);
  }
  const afades = audioFades(len, clip.fadeIn, clip.fadeOut);
  graph.push(
    soundIn
      ? `${soundIn},apad,atrim=duration=${n3(len)}${afades ? `,${afades}` : ''}[a]`
      : `[1:a]atrim=duration=${n3(len)}[a]`,
  );

  args.push('-filter_complex', graph.join(';'), '-map', '[v]', '-map', '[a]', ...ENCODE_V, ...ENCODE_A, out);
  await run('ffmpeg', args);
  return out;
}

/** Black and silence, for a gap left on the main track. */
async function gapPiece(dir: string, i: number, len: number, W: number, H: number): Promise<string> {
  const out = join(dir, `gap-${i}.mp4`);
  await run('ffmpeg', [
    '-v', 'error', '-y', '-threads', FF_THREADS,
    '-f', 'lavfi', '-t', n3(len), '-i', `color=c=black:s=${W}x${H}:r=${FPS}`,
    '-f', 'lavfi', '-t', n3(len), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-map', '0:v', '-map', '1:a', ...ENCODE_V, ...ENCODE_A, out,
  ]);
  return out;
}

interface Piece {
  file: string;
  len: number;
  transition?: { xfade: string; duration: number };
}

/** The pieces in order: dissolved where a transition asks, cut to cut where it does not. */
async function joinPieces(dir: string, pieces: Piece[]): Promise<string> {
  if (pieces.length === 1) return pieces[0]!.file;
  const out = join(dir, 'joined.mp4');
  const args = ['-v', 'error', '-y', '-threads', FF_THREADS];
  const g: string[] = [];
  pieces.forEach((p, i) => {
    args.push('-i', p.file);
    // One time base and one sound format for every stream, or xfade refuses the pair.
    // The frame rate goes first: fps resets the time base, so a settb before it is lost.
    g.push(`[${i}:v]fps=${FPS},settb=1/${FPS},format=yuv420p[vi${i}]`);
    g.push(`[${i}:a]${AUDIO}[ai${i}]`);
  });
  let v = '[vi0]';
  let a = '[ai0]';
  let total = pieces[0]!.len;
  for (let i = 1; i < pieces.length; i++) {
    const p = pieces[i]!;
    const d = p.transition ? Math.min(p.transition.duration, total - 0.1, p.len - 0.1) : 0;
    if (p.transition && d > 0.05) {
      g.push(`${v}[vi${i}]xfade=transition=${p.transition.xfade}:duration=${n3(d)}:offset=${n3(total - d)},fps=${FPS},settb=1/${FPS}[vx${i}]`);
      g.push(`${a}[ai${i}]acrossfade=d=${n3(d)}[ax${i}]`);
      total += p.len - d;
    } else {
      g.push(`${v}${a}[vi${i}][ai${i}]concat=n=2:v=1:a=1[vc${i}][ax${i}]`);
      g.push(`[vc${i}]fps=${FPS},settb=1/${FPS}[vx${i}]`);
      total += p.len;
    }
    v = `[vx${i}]`;
    a = `[ax${i}]`;
  }
  args.push('-filter_complex', g.join(';'), '-map', v, '-map', a, ...ENCODE_V, ...ENCODE_A, '-movflags', '+faststart', out);
  await run('ffmpeg', args);
  return out;
}

/** "rgba(0,0,0,0.6)" or "#c2564f" as an SVG fill and its opacity. */
function fillOf(colour: string): { fill: string; opacity: number } {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(colour.trim());
  if (m) return { fill: `rgb(${m[1]},${m[2]},${m[3]})`, opacity: m[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(m[4]))) };
  return { fill: /^#[0-9a-f]{3,8}$/i.test(colour.trim()) ? colour.trim() : '#000000', opacity: 1 };
}

/**
 * A line of text as a full-frame transparent PNG, placed where the editor put it.
 * Drawn with the fonts the server has, which are the fonts the editor offers.
 */
async function textPng(text: string, style: EditTextStyle, W: number, H: number): Promise<Buffer> {
  const S = Math.min(W, H);
  const fontSize = Math.max(8, Math.round(style.size * S));
  const family = EDIT_FONTS.find((f) => f.id === style.font)?.server ?? 'DejaVu Sans';
  const lines = text.split('\n').map((l) => (l.trim() ? l : ' '));
  const lineH = Math.round(fontSize * 1.25);
  const blockH = lineH * lines.length;
  // An estimate of the widest line, for the panel behind it; the text itself is
  // laid out by the renderer, which is what decides where each glyph lands.
  const widest = Math.min(W * 0.94, Math.max(...lines.map((l) => l.length)) * fontSize * 0.58);
  const cx = style.x * W;
  const cy = style.y * H;
  const top = cy - blockH / 2;
  const anchor = style.align === 'left' ? 'start' : style.align === 'right' ? 'end' : 'middle';
  const tx = style.align === 'left' ? cx - widest / 2 : style.align === 'right' ? cx + widest / 2 : cx;
  const pad = Math.round(fontSize * 0.35);
  const bg = style.background ? fillOf(style.background) : null;
  const rect = bg
    ? `<rect x="${cx - widest / 2 - pad}" y="${top - pad * 0.6}" width="${widest + pad * 2}" height="${blockH + pad * 1.2}" rx="${Math.round(pad * 0.6)}" fill="${bg.fill}" fill-opacity="${bg.opacity}"/>`
    : '';
  const colour = fillOf(style.color);
  const body = lines
    .map(
      (l, i) =>
        `<text x="${tx}" y="${Math.round(top + i * lineH + fontSize * 0.95)}" text-anchor="${anchor}" font-family="${esc(family)}" font-size="${fontSize}" font-weight="${style.bold ? 700 : 400}" fill="${colour.fill}" fill-opacity="${colour.opacity}">${esc(l)}</text>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${rect}${body}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function renderEditProject(p: EditProject, load: LoadSource): Promise<{ bytes: Buffer; seconds: number }> {
  const dir = await mkdtemp(join(tmpdir(), 'ava-edit-'));
  try {
    const hidden = new Set(p.tracks.filter((t) => t.hidden).map((t) => t.id));
    const muted = new Set(p.tracks.filter((t) => t.muted).map((t) => t.id));
    const main = p.clips
      .filter((c) => c.trackId === EDIT_MAIN_TRACK && c.source && c.source.type !== 'audio')
      .sort((a, b) => a.start - b.start);
    if (!main.length || hidden.has(EDIT_MAIN_TRACK)) {
      throw new Error('Put at least one video or image on the main track, and make sure the track is not hidden.');
    }

    const cache = new Map<string, Buffer>();
    const bytesFor = async (src: EditSource): Promise<Buffer> => {
      const key = (src.type === 'video' && src.jobId) || src.storagePath || src.url;
      const have = cache.get(key);
      if (have) return have;
      const got = await load(src);
      if (!got) throw new Error(`Could not read "${src.label}" — it may have been deleted.`);
      cache.set(key, got);
      return got;
    };

    // The frame size follows the first film: 1080 on a side when it was made that
    // large, 720 otherwise. Stills and later clips are fitted into it.
    let shortSide = 720;
    const firstFilm = main.find((c) => c.source?.type === 'video');
    if (firstFilm?.source) {
      const f = join(dir, 'probe.mp4');
      await writeFile(f, await bytesFor(firstFilm.source));
      const m = await probe(f);
      shortSide = Math.min(m.width, m.height) >= 1000 ? 1080 : 720;
    }
    const { width: W, height: H } = editAspectSize(p.aspect, shortSide);

    const pieces: Piece[] = [];
    let cursor = 0;
    let n = 0;
    for (const [k, c] of main.entries()) {
      const len = editClipLength(c);
      if (len < 0.05) continue;
      const look = k > 0 && c.transition ? EDIT_TRANSITIONS.find((t) => t.id === c.transition!.id) : undefined;
      const overlap = look && c.transition ? Math.min(c.transition.duration, len - 0.1) : 0;
      if (!pieces.length && c.start > 0.04) {
        pieces.push({ file: await gapPiece(dir, n++, c.start, W, H), len: c.start });
        cursor = c.start;
      } else if (!look && pieces.length && c.start - cursor > 0.04) {
        const gap = c.start - cursor;
        pieces.push({ file: await gapPiece(dir, n++, gap, W, H), len: gap });
        cursor += gap;
      }
      const file = await renderPiece(dir, n++, c, await bytesFor(c.source!), W, H, muted.has(EDIT_MAIN_TRACK));
      const joins = Boolean(look && pieces.length && overlap > 0.05);
      pieces.push({ file, len, transition: joins ? { xfade: look!.xfade, duration: overlap } : undefined });
      cursor += len - (joins ? overlap : 0);
    }
    const joined = await joinPieces(dir, pieces);
    const total = cursor;

    const texts = p.clips.filter(
      (c) => c.trackId !== EDIT_MAIN_TRACK && c.text?.trim() && c.style && !hidden.has(c.trackId) && c.start < total,
    );
    const sounds = p.clips.filter(
      (c) => c.source?.type === 'audio' && !hidden.has(c.trackId) && !muted.has(c.trackId) && c.start < total,
    );
    if (!texts.length && !sounds.length) return { bytes: await readFile(joined), seconds: total };

    const out = join(dir, 'final.mp4');
    const args = ['-v', 'error', '-y', '-threads', FF_THREADS, '-i', joined];
    const g: string[] = [];
    let v = '[0:v]';
    let input = 1;
    for (const [k, c] of texts.entries()) {
      const S = c.start;
      const E = Math.min(total, editClipEnd(c));
      if (E - S <= 0.05) continue;
      const png = join(dir, `text-${k}.png`);
      await writeFile(png, await textPng(c.text!, c.style!, W, H));
      args.push('-loop', '1', '-t', n3(total), '-i', png);
      const fi = Math.min(c.fadeIn, (E - S) / 2);
      const fo = Math.min(c.fadeOut, (E - S) / 2);
      const fades = [
        fi > 0.01 ? `fade=t=in:st=${n3(S)}:d=${n3(fi)}:alpha=1` : '',
        fo > 0.01 ? `fade=t=out:st=${n3(E - fo)}:d=${n3(fo)}:alpha=1` : '',
      ]
        .filter(Boolean)
        .join(',');
      g.push(`[${input}:v]format=rgba${fades ? `,${fades}` : ''}[tx${k}]`);
      g.push(`${v}[tx${k}]overlay=0:0:enable='between(t,${n3(S)},${n3(E)})'[vo${k}]`);
      v = `[vo${k}]`;
      input++;
    }
    if (v === '[0:v]') {
      g.push('[0:v]null[vfinal]');
      v = '[vfinal]';
    }

    g.push(`[0:a]${AUDIO}[mix0]`);
    const mix = ['[mix0]'];
    for (const [j, c] of sounds.entries()) {
      const src = join(dir, `sound-${j}`);
      await writeFile(src, await bytesFor(c.source!));
      args.push('-ss', n3(c.in), '-t', n3(c.out - c.in), '-i', src);
      const len = Math.min(editClipLength(c), total - c.start);
      const delay = Math.round(c.start * 1000);
      const afades = audioFades(len, c.fadeIn, c.fadeOut);
      g.push(
        `[${input}:a]asetpts=PTS-STARTPTS,${atempoChain(c.speed || 1)},volume=${c.volume.toFixed(2)},${AUDIO},atrim=duration=${n3(len)}${afades ? `,${afades}` : ''},adelay=${delay}|${delay}[s${j}]`,
      );
      mix.push(`[s${j}]`);
      input++;
    }
    let a = '[mix0]';
    if (mix.length > 1) {
      g.push(`${mix.join('')}amix=inputs=${mix.length}:duration=first:dropout_transition=0:normalize=0[aout]`);
      a = '[aout]';
    }
    args.push('-filter_complex', g.join(';'), '-map', v, '-map', a, ...ENCODE_V, ...ENCODE_A, '-movflags', '+faststart', out);
    await run('ffmpeg', args);
    return { bytes: await readFile(out), seconds: total };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
