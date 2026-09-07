/**
 * Post-production: join the generated segments and lay the deterministic brand
 * furniture on top.
 *
 * The video model is unreliable at rendering small text and logos — it garbles
 * footers and invents manufacturer badges. So the prompt now asks for a clean
 * frame, and everything that must be exactly right is composited here instead:
 *
 *   segments → crossfade chain → end card → footer bar + logo overlays
 *
 * Text/graphics are laid out as SVG and rasterised with sharp, which gives real
 * typography (and Devanagari, given the fonts in the image) rather than ffmpeg
 * drawtext.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

export interface EndCardSpec {
  /** Dealer name first, then CTA, then contact lines. */
  lines: string[];
  seconds: number;
  logo?: Buffer;
}

export interface BrandOverlay {
  /** Single-line strip across the bottom, e.g. "Dealer | Address | Phone". */
  footerText?: string;
  /** Transparent PNGs. Brand sits top-left, dealer top-right. */
  brandLogo?: Buffer;
  dealerLogo?: Buffer;
  endCard?: EndCardSpec;
  /** Dissolve between segments, seconds. */
  transition?: number;
  accent?: string;
  ink?: string;
}

const DEFAULT_ACCENT = '#e2600a';
const DEFAULT_INK = '#0f1e33';
const FONT = 'Manrope, Helvetica, Arial, DejaVu Sans, sans-serif';

const esc = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1 << 28 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${stderr?.slice(-800) || err.message}`));
      else resolve(stdout);
    });
  });
}

async function probe(file: string): Promise<{ duration: number; width: number; height: number }> {
  const out = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json',
    file,
  ]);
  const j = JSON.parse(out) as { streams?: { width: number; height: number }[]; format?: { duration: string } };
  return {
    duration: Number(j.format?.duration ?? 0),
    width: Number(j.streams?.[0]?.width ?? 720),
    height: Number(j.streams?.[0]?.height ?? 1280),
  };
}


/* ---------------------------------------------------------------------------
 * Text layout. SVG text neither wraps nor shrinks, so long strings — a full
 * dealer address, a legal entity name — simply ran off both edges of the frame.
 * These estimate glyph advances, wrap on word boundaries, and step the font size
 * down until the block fits the space it has been given.
 * ------------------------------------------------------------------------- */

/** Approximate advance width of a string, in font-size units. */
function textUnits(text: string): number {
  let u = 0;
  for (const ch of text) {
    if (/[iIljt.,:;'`!|()[\]]/.test(ch)) u += 0.31;
    else if (/[mwMW]/.test(ch)) u += 0.92;
    else if (/[A-Z0-9@#&%]/.test(ch)) u += 0.63;
    else if (ch === ' ') u += 0.27;
    else u += 0.54;
  }
  return u;
}

const measure = (text: string, fontSize: number, bold: boolean): number =>
  textUnits(text) * fontSize * (bold ? 1.06 : 1);

/** Greedy word wrap; a single word longer than the line is left to overflow-fit. */
function wrap(text: string, maxWidth: number, fontSize: number, bold: boolean): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = words[0]!;
  for (const w of words.slice(1)) {
    const candidate = `${line} ${w}`;
    if (measure(candidate, fontSize, bold) <= maxWidth) line = candidate;
    else {
      lines.push(line);
      line = w;
    }
  }
  lines.push(line);
  return lines;
}

interface FittedText {
  lines: string[];
  fontSize: number;
  lineHeight: number;
}

/** Shrink until the text wraps into at most `maxLines` within `maxWidth`. */
function fitText(
  text: string,
  maxWidth: number,
  opts: { start: number; min: number; maxLines: number; bold?: boolean },
): FittedText {
  const bold = opts.bold ?? false;
  let size = opts.start;
  let lines = wrap(text, maxWidth, size, bold);
  while (size > opts.min && (lines.length > opts.maxLines || lines.some((l) => measure(l, size, bold) > maxWidth))) {
    size -= 1;
    lines = wrap(text, maxWidth, size, bold);
  }
  // Still too wide at the minimum (one very long word) — squeeze that line.
  return { lines, fontSize: size, lineHeight: Math.round(size * 1.28) };
}

const tspans = (
  f: FittedText,
  x: number,
  yStart: number,
  fill: string,
  weight: number,
  maxWidth: number,
): string =>
  f.lines
    .map((line, i) => {
      const over = measure(line, f.fontSize, weight >= 600) > maxWidth;
      return `<text x="${x}" y="${yStart + i * f.lineHeight}" text-anchor="middle" font-family="${FONT}"
        font-size="${f.fontSize}" font-weight="${weight}" fill="${fill}"${
          over ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"` : ''
        }>${esc(line)}</text>`;
    })
    .join('\n');

/** Bottom strip: solid bar + centred contact detail, wrapped and fitted. */
async function footerPng(text: string, w: number, ink: string): Promise<Buffer> {
  const pad = Math.round(w * 0.05);
  const maxWidth = w - pad * 2;
  const fitted = fitText(text, maxWidth, {
    start: Math.round(w * 0.036),
    min: Math.round(w * 0.022),
    maxLines: 2,
  });
  const h = Math.round(fitted.lineHeight * fitted.lines.length + w * 0.05);
  const firstBaseline = Math.round((h - fitted.lineHeight * (fitted.lines.length - 1)) / 2 + fitted.fontSize * 0.35);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="${ink}" fill-opacity="0.92"/>
  ${tspans(fitted, w / 2, firstBaseline, '#ffffff', 600, maxWidth)}
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Full-frame outro: dealer name, CTA, contact — always the last thing on screen. */
async function endCardPng(
  spec: EndCardSpec,
  w: number,
  h: number,
  accent: string,
  ink: string,
): Promise<Buffer> {
  const [name, cta, ...rest] = spec.lines.map((l) => (l ?? '').trim()).filter(Boolean);
  const pad = Math.round(w * 0.08);
  const maxWidth = w - pad * 2;

  const nameFit = name
    ? fitText(name, maxWidth, { start: Math.round(w * 0.075), min: Math.round(w * 0.036), maxLines: 3, bold: true })
    : null;
  const ctaFit = cta
    ? fitText(cta, maxWidth, { start: Math.round(w * 0.042), min: Math.round(w * 0.028), maxLines: 2 })
    : null;
  const restFits = rest.map((line) =>
    fitText(line, maxWidth, { start: Math.round(w * 0.034), min: Math.round(w * 0.024), maxLines: 2 }),
  );

  // Lay the block out as a stack, then centre the whole thing vertically.
  const gapAfterName = Math.round(w * 0.045);
  const gapAfterCta = Math.round(w * 0.06);
  const gapBetweenRest = Math.round(w * 0.012);
  const logoH = spec.logo ? Math.round(h * 0.09) : 0;
  const gapAfterLogo = spec.logo ? Math.round(w * 0.06) : 0;

  const nameH = nameFit ? nameFit.lineHeight * nameFit.lines.length : 0;
  const ctaH = ctaFit ? ctaFit.lineHeight * ctaFit.lines.length : 0;
  const restH = restFits.reduce((a, f) => a + f.lineHeight * f.lines.length + gapBetweenRest, 0);
  const blockH =
    logoH + gapAfterLogo + nameH + (nameFit && ctaFit ? gapAfterName : 0) + ctaH + (restH ? gapAfterCta + restH : 0);

  let y = Math.round((h - blockH) / 2);
  const logoTop = y;
  y += logoH + gapAfterLogo;

  const parts: string[] = [];
  if (nameFit) {
    parts.push(tspans(nameFit, w / 2, y + nameFit.fontSize, '#ffffff', 700, maxWidth));
    y += nameH + (ctaFit ? gapAfterName : 0);
  }
  if (ctaFit) {
    parts.push(tspans(ctaFit, w / 2, y + ctaFit.fontSize, accent, 500, maxWidth));
    y += ctaH;
  }
  if (restH) {
    y += gapAfterCta;
    for (const f of restFits) {
      parts.push(tspans(f, w / 2, y + f.fontSize, '#c9d3e0', 400, maxWidth));
      y += f.lineHeight * f.lines.length + gapBetweenRest;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="${ink}"/>
  <rect x="0" y="0" width="${w}" height="${Math.round(h * 0.006)}" fill="${accent}"/>
  ${parts.join('\n')}
</svg>`;

  const base = sharp(Buffer.from(svg));
  if (spec.logo) {
    const logo = await sharp(spec.logo)
      .resize({ height: logoH, fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer();
    const lm = await sharp(logo).metadata();
    return sharp(
      await base
        .composite([{ input: logo, top: logoTop, left: Math.round((w - (lm.width ?? 0)) / 2) }])
        .png()
        .toBuffer(),
    )
      .png()
      .toBuffer();
  }
  return base.png().toBuffer();
}

async function scaledLogo(src: Buffer, frameW: number): Promise<Buffer> {
  return sharp(src)
    .resize({ width: Math.round(frameW * 0.22), fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
}

/**
 * Build the finished video. Returns an MP4 buffer.
 * A single segment with no overlays short-circuits to the input untouched.
 */
export async function composeFinal(segments: Buffer[], overlay: BrandOverlay = {}): Promise<Buffer> {
  if (segments.length === 0) throw new Error('no segments to compose');

  const accent = overlay.accent ?? DEFAULT_ACCENT;
  const ink = overlay.ink ?? DEFAULT_INK;
  const xfd = overlay.transition ?? 0.5;

  const nothingToDo =
    segments.length === 1 && !overlay.footerText && !overlay.brandLogo && !overlay.dealerLogo && !overlay.endCard;
  if (nothingToDo) return segments[0]!;

  const dir = await mkdtemp(join(tmpdir(), 'ava-post-'));
  try {
    const files: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const f = join(dir, `seg-${i}.mp4`);
      await writeFile(f, segments[i]!);
      files.push(f);
    }
    const metas = await Promise.all(files.map(probe));
    const { width: W, height: H } = metas[0]!;

    const inputs: string[] = [];
    for (const f of files) inputs.push('-i', f);

    // End card as a still clip with silence, so it joins the chain like a segment.
    let endCardFile: string | undefined;
    if (overlay.endCard && overlay.endCard.lines.some((l) => l.trim())) {
      const png = join(dir, 'endcard.png');
      await writeFile(png, await endCardPng(overlay.endCard, W, H, accent, ink));
      endCardFile = join(dir, 'endcard.mp4');
      await run('ffmpeg', [
        '-v', 'error', '-y',
        '-loop', '1', '-t', String(overlay.endCard.seconds), '-i', png,
        '-f', 'lavfi', '-t', String(overlay.endCard.seconds), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '24',
        '-c:a', 'aac', '-shortest', endCardFile,
      ]);
      inputs.push('-i', endCardFile);
      metas.push({ duration: overlay.endCard.seconds, width: W, height: H });
    }

    // Overlay assets are extra inputs appended after the clips, so their filter
    // indices continue from clipCount.
    const clipCount = metas.length;
    let nextIdx = clipCount;
    const addOverlayInput = async (name: string, bytes: Buffer): Promise<number> => {
      const f = join(dir, name);
      await writeFile(f, bytes);
      inputs.push('-i', f);
      return nextIdx++;
    };

    const footerIdx = overlay.footerText?.trim()
      ? await addOverlayInput('footer.png', await footerPng(overlay.footerText.trim(), W, ink))
      : -1;
    const brandIdx = overlay.brandLogo
      ? await addOverlayInput('brand.png', await scaledLogo(overlay.brandLogo, W))
      : -1;
    const dealerIdx = overlay.dealerLogo
      ? await addOverlayInput('dealer.png', await scaledLogo(overlay.dealerLogo, W))
      : -1;

    // --- crossfade the clips together ---
    const parts: string[] = [];
    let vLast = '0:v';
    let aLast = '0:a';
    let offset = metas[0]!.duration - xfd;
    for (let i = 1; i < clipCount; i++) {
      const vOut = `vx${i}`;
      const aOut = `ax${i}`;
      parts.push(
        `[${vLast}][${i}:v]xfade=transition=fade:duration=${xfd}:offset=${offset.toFixed(3)}[${vOut}]`,
      );
      parts.push(`[${aLast}][${i}:a]acrossfade=d=${xfd}[${aOut}]`);
      vLast = vOut;
      aLast = aOut;
      offset += metas[i]!.duration - xfd;
    }

    // --- lay the brand furniture on top ---
    let vCur = vLast;
    if (brandIdx >= 0) {
      parts.push(`[${vCur}][${brandIdx}:v]overlay=${Math.round(W * 0.04)}:${Math.round(W * 0.04)}[vb]`);
      vCur = 'vb';
    }
    if (dealerIdx >= 0) {
      parts.push(`[${vCur}][${dealerIdx}:v]overlay=W-w-${Math.round(W * 0.04)}:${Math.round(W * 0.04)}[vd]`);
      vCur = 'vd';
    }
    if (footerIdx >= 0) {
      parts.push(`[${vCur}][${footerIdx}:v]overlay=0:H-h[vf]`);
      vCur = 'vf';
    }
    parts.push(`[${vCur}]null[vout]`);

    const out = join(dir, 'final.mp4');
    await run('ffmpeg', [
      '-v', 'error', '-y',
      ...inputs,
      '-filter_complex', parts.join(';'),
      '-map', '[vout]',
      '-map', `[${aLast}]`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart',
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Grab a representative frame for the history thumbnail. */
export async function posterFrame(clip: Buffer, atSeconds = 1.5): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), 'ava-poster-'));
  try {
    const inF = join(dir, 'in.mp4');
    const outF = join(dir, 'out.jpg');
    await writeFile(inF, clip);
    await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(atSeconds), '-i', inF, '-vframes', '1', '-q:v', '4', outF]);
    return await readFile(outF);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Grab the last frame of a clip as a JPEG — seeds the next segment's first frame. */
export async function lastFrame(clip: Buffer): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), 'ava-frame-'));
  try {
    const inF = join(dir, 'in.mp4');
    const outF = join(dir, 'out.jpg');
    await writeFile(inF, clip);
    await run('ffmpeg', ['-y', '-v', 'error', '-sseof', '-0.5', '-i', inF, '-vframes', '1', '-q:v', '3', outF]);
    return await readFile(outF);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Verify the post-production toolchain without spending a generation: renders
 * the real footer + end-card art and probes ffmpeg. Surfaced on /api/health so
 * a broken container is obvious before a paid run, not after.
 */
export async function selfTest(): Promise<{
  ok: boolean;
  ffmpeg?: string;
  footerPx?: string;
  endCardPx?: string;
  textRendered?: boolean;
  error?: string;
}> {
  try {
    const version = (await run('ffmpeg', ['-version'])).split('\n')[0] ?? '';
    const footer = await footerPng('Sterling Hyundai  |  MG Road  |  98765 43210', 720, DEFAULT_INK);
    const fm = await sharp(footer).metadata();
    const end = await endCardPng(
      { lines: ['Sterling Hyundai', 'Book your test drive today', 'MG Road'], seconds: 3 },
      720,
      1280,
      DEFAULT_ACCENT,
      DEFAULT_INK,
    );
    const em = await sharp(end).metadata();

    // If fonts are missing the SVG rasterises to a flat bar — compare the text
    // band against the bar colour to prove glyphs actually drew.
    const band = await sharp(footer)
      .extract({ left: 60, top: Math.round((fm.height ?? 92) * 0.3), width: 600, height: 20 })
      .stats();
    const textRendered = (band.channels[0]?.stdev ?? 0) > 8;

    return {
      ok: true,
      ffmpeg: version,
      footerPx: `${fm.width}x${fm.height}`,
      endCardPx: `${em.width}x${em.height}`,
      textRendered,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
