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

/** Bottom strip: solid bar + centred line of contact detail. */
async function footerPng(text: string, w: number, ink: string): Promise<Buffer> {
  const h = Math.round(w * 0.128);
  const fs = Math.round(h * 0.30);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="${ink}" fill-opacity="0.92"/>
  <text x="${w / 2}" y="${h * 0.63}" text-anchor="middle" font-family="${FONT}" font-size="${fs}"
        font-weight="600" fill="#ffffff" letter-spacing="0.4">${esc(text)}</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Full-frame outro: dealer name, CTA, contact — always the last thing on screen. */
async function endCardPng(spec: EndCardSpec, w: number, h: number, accent: string, ink: string): Promise<Buffer> {
  const [name, cta, ...rest] = spec.lines.filter((l) => l && l.trim());
  const cy = h / 2;
  const nameSize = Math.round(w * 0.075);
  const ctaSize = Math.round(w * 0.042);
  const restSize = Math.round(w * 0.036);

  const restText = rest
    .map((line, i) => `<text x="${w / 2}" y="${cy + 90 + i * (restSize * 1.6)}" text-anchor="middle"
        font-family="${FONT}" font-size="${restSize}" fill="#c9d3e0">${esc(line)}</text>`)
    .join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="${ink}"/>
  <rect x="0" y="0" width="${w}" height="${Math.round(h * 0.006)}" fill="${accent}"/>
  ${name ? `<text x="${w / 2}" y="${cy - 60}" text-anchor="middle" font-family="${FONT}" font-size="${nameSize}" font-weight="700" fill="#ffffff">${esc(name)}</text>` : ''}
  ${cta ? `<text x="${w / 2}" y="${cy + 10}" text-anchor="middle" font-family="${FONT}" font-size="${ctaSize}" font-weight="500" fill="${accent}">${esc(cta)}</text>` : ''}
  ${restText}
</svg>`;

  let png = sharp(Buffer.from(svg));
  if (spec.logo) {
    const logoW = Math.round(w * 0.34);
    const logo = await sharp(spec.logo).resize({ width: logoW, fit: 'inside' }).png().toBuffer();
    const lm = await sharp(logo).metadata();
    png = sharp(
      await png
        .composite([{ input: logo, top: Math.round(cy - 260 - (lm.height ?? 0)), left: Math.round((w - logoW) / 2) }])
        .png()
        .toBuffer(),
    );
  }
  return png.png().toBuffer();
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
