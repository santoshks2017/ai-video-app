/**
 * Post-production: join the generated segments and lay the deterministic brand
 * furniture on top.
 *
 * The video model is unreliable at rendering small text and logos — it garbles
 * footers and invents manufacturer badges. So the prompt now asks for a clean
 * frame, and everything that must be exactly right is composited here instead:
 *
 *   segments → joined cut to cut → music under the voice → end card → footer bar + logo overlays
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
import { cleanLogo } from './logos.js';

export interface EndCardSpec {
  /** Dealer name first, then CTA, then contact lines. */
  lines: string[];
  seconds: number;
  logo?: Buffer;
}

/**
 * One caption, and when it belongs on screen.
 *
 * The video model used to be asked to draw these. It misspelled prices and
 * invented its own wording, which is fatal on a card the whole shot is about —
 * so the offer figure, like the footer and the end card, is composited here.
 *
 * Timings are relative to their own segment rather than the finished cut,
 * because segments crossfade into each other and a model can return a clip a
 * little shorter than it was asked for. `partSeconds` is what was asked for, so
 * a short render slides the caption rather than leaving it behind.
 */
export interface TextCard {
  text: string;
  sub?: string;
  /** 1-based segment. */
  part: number;
  /** Seconds from the start of that segment. */
  start: number;
  end: number;
  /** The length that segment was planned at. */
  partSeconds: number;
}

export interface BrandOverlay {
  /** Single-line strip across the bottom, e.g. "Dealer | Address | Phone". */
  footerText?: string;
  /** Transparent PNGs. Brand sits top-left, dealer top-right. */
  brandLogo?: Buffer;
  dealerLogo?: Buffer;
  endCard?: EndCardSpec;
  /** Timed captions, drawn here rather than by the video model. */
  cards?: TextCard[];
  /** Handed what each join measured, for the run's receipt. */
  onJoins?: (notes: JoinNote[]) => void;
  /**
   * Final short side in pixels — 1080 for a 1080p deliverable. A model that
   * cannot render that natively is upscaled here, once, before any overlay is
   * drawn, so the type and logos are set at full size rather than enlarged.
   */
  targetShortSide?: number;
  /**
   * One continuous music track for the whole film, laid under the voice. Music a
   * video model makes lives inside each separately generated part and restarts at
   * every join, so the bed is generated once and mixed in here instead.
   */
  musicBed?: Buffer;
  /** Loudness the bed plays at wherever nobody is speaking, in LUFS. */
  musicLoudness?: number;
  /** How far the bed dips under every spoken line, in dB (negative). 0 leaves it level. */
  musicDuckDb?: number;
  /** Plays the finished parts faster or slower — the storyboard's pace. 1 leaves them as generated. */
  speed?: number;
  accent?: string;
  ink?: string;
}

/**
 * Threads ffmpeg may use per decoder, for the filter graph, and for the encoder.
 * Left alone it sizes each to every core it can see, and a Cloud Run instance can
 * see more cores than it is allowed to use. Capping keeps CPU use predictable on a
 * two-vCPU instance. (It did not change peak memory — measured; the crossfade
 * chain did, see composeFinal.)
 */
export const FF_THREADS = String(Math.max(1, Number(process.env.FFMPEG_THREADS) || 2));

const DEFAULT_ACCENT = '#e2600a';
const DEFAULT_INK = '#0f1e33';
/**
 * The type the overlays are set in. The Cloud Run image installs DejaVu Sans and
 * Noto (for Devanagari) and nothing else, so DejaVu is what production draws —
 * it leads the stack so a local render looks like the real one wherever it can.
 * POST_FONT overrides it, which is how the layout is tested against a wide face.
 */
export const FONT = process.env.POST_FONT || 'DejaVu Sans, Noto Sans, Helvetica, Arial, sans-serif';

export const esc = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1 << 28 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

export interface ClipMeta {
  duration: number;
  width: number;
  height: number;
  fps: number;
}

export async function probe(file: string): Promise<ClipMeta> {
  const out = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
    '-of', 'json',
    file,
  ]);
  const j = JSON.parse(out) as {
    streams?: { width: number; height: number; r_frame_rate?: string }[];
    format?: { duration: string };
  };
  // r_frame_rate is a rational, "24000/1001" for 23.976.
  const [num, den] = (j.streams?.[0]?.r_frame_rate ?? '24/1').split('/');
  const fps = Number(den) ? Number(num) / Number(den) : 24;
  return {
    duration: Number(j.format?.duration ?? 0),
    width: Number(j.streams?.[0]?.width ?? 720),
    height: Number(j.streams?.[0]?.height ?? 1280),
    fps: Number.isFinite(fps) && fps > 0 ? fps : 24,
  };
}

/** What ffmpeg reports on stderr — where its analysis filters write. */
function runForLog(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1 << 26 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      else resolve(stderr);
    });
  });
}

/** A media file's length in seconds, from its container. */
async function mediaSeconds(file: string): Promise<number> {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(out.trim()) || 0;
}

/** The music starts dipping this long before a line begins… */
const DUCK_ATTACK = 0.3;
/** …and takes this long to come back up after the line ends. */
const DUCK_RELEASE = 0.8;
/** A pause shorter than this keeps the music down: it would only swell and dip again. */
const MIN_MUSIC_PAUSE = 1.2;

/**
 * When someone is speaking, as spans on the film's timeline.
 *
 * Read from each generated part's own audio, 50ms at a time, in the voice band only
 * so room hum and rumble don't count. The line between speech and room sound is
 * drawn 12 dB under the part's loud end (its 90th-percentile level): parts come back
 * from the model at different loudness, and an average over a mostly spoken part
 * sits so low that room tone reads as speech and the film never seems to pause. A
 * pause must last 0.35s to count, and pauses too short for the music to rise and
 * settle are folded into the speech around them, so it never pumps between words.
 */
export async function speechSpans(files: string[], durations: number[]): Promise<Array<[number, number]>> {
  const WINDOW = 0.05;
  const spans: Array<[number, number]> = [];
  let offset = 0;
  for (let i = 0; i < files.length; i++) {
    const d = durations[i] ?? 0;
    try {
      const log = await runForLog('ffmpeg', [
        '-v', 'info', '-i', files[i]!, '-vn',
        '-af',
        'highpass=f=120,lowpass=f=5000,aresample=48000,asetnsamples=n=2400:p=0,' +
          'astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level',
        '-f', 'null', '-',
      ]);
      const levels = [...log.matchAll(/lavfi\.astats\.Overall\.RMS_level=(\S+)/g)].map((m) => {
        const v = Number(m[1]);
        return Number.isFinite(v) ? v : -120;
      });
      const heard = levels.filter((v) => v > -100).sort((a, b) => a - b);
      if (heard.length) {
        const threshold = Math.max(-50, heard[Math.floor(heard.length * 0.9)]! - 12);
        let from: number | null = null;
        let quiet = 0;
        const close = (endWindow: number): void => {
          if (from === null) return;
          const a = from * WINDOW;
          const b = Math.min(d, endWindow * WINDOW);
          if (b - a > 0.15) spans.push([offset + a, offset + b]);
          from = null;
        };
        levels.forEach((v, w) => {
          if (v >= threshold) {
            if (from === null) from = w;
            quiet = 0;
          } else if (from !== null && ++quiet * WINDOW >= 0.35) {
            close(w - quiet + 1);
            quiet = 0;
          }
        });
        close(levels.length);
      }
    } catch {
      // A part whose sound can't be read keeps the music down — the safe side.
      spans.push([offset, offset + d]);
    }
    offset += d;
  }
  const merged: Array<[number, number]> = [];
  for (const [from, to] of spans) {
    const last = merged[merged.length - 1];
    if (last && from - last[1] < MIN_MUSIC_PAUSE) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

/**
 * The music's gain over time, as an ffmpeg expression: 1 in the pauses, down by
 * `duckDb` under speech. It dips just before a line starts — which a compressor
 * listening to the voice can't do — and comes back up gently after it.
 */
export function duckVolume(spans: Array<[number, number]>, duckDb: number): string {
  const depth = 1 - Math.pow(10, duckDb / 20);
  // Spans are at least MIN_MUSIC_PAUSE apart, longer than a dip and a rise together,
  // so the ramps never overlap and can simply be added.
  const ramps = spans.map(
    ([from, to]) =>
      `clip(min((t-(${(from - DUCK_ATTACK).toFixed(3)}))/${DUCK_ATTACK},(${(to + DUCK_RELEASE).toFixed(3)}-t)/${DUCK_RELEASE}),0,1)`,
  );
  return `1-${depth.toFixed(4)}*clip(${ramps.join('+')},0,1)`;
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

/**
 * How far off the per-character estimate is for the font actually installed.
 *
 * The estimate was tuned against Arial. Production only has DejaVu Sans, which
 * sets roughly a sixth wider, so every panel was sized for narrower text than it
 * drew and captions ran straight out of their boxes. Measured once per process by
 * rendering a sample line in each weight.
 */
const fontScale = { regular: 1, bold: 1 };
let calibration: Promise<void> | null = null;

const measure = (text: string, fontSize: number, bold: boolean): number =>
  textUnits(text) * fontSize * (bold ? 1.06 * fontScale.bold : fontScale.regular);

/** Width in pixels of a line exactly as the renderer draws it — the ground truth. */
async function inkWidth(text: string, fontSize: number, weight: number): Promise<number> {
  const t = text.trim();
  if (!t) return 0;
  const w = Math.ceil(fontSize * t.length * 1.4) + 40;
  const h = Math.ceil(fontSize * 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="#ffffff"/>
  <text x="10" y="${Math.round(fontSize * 1.35)}" font-family="${FONT}" font-size="${fontSize}" font-weight="${weight}" fill="#000000">${esc(t)}</text>
</svg>`;
  try {
    const { info } = await sharp(Buffer.from(svg))
      .trim({ background: '#ffffff', threshold: 10 })
      .png()
      .toBuffer({ resolveWithObject: true });
    return info.width;
  } catch {
    return 0; // nothing was drawn
  }
}

const CALIBRATION_SAMPLE = 'Sahyadri Motors · Book your test drive today · +91 73505 55555 · 7.99%';

function calibrate(): Promise<void> {
  calibration ??= (async () => {
    for (const [key, weight, bold] of [['regular', 400, false], ['bold', 700, true]] as const) {
      const actual = await inkWidth(CALIBRATION_SAMPLE, 100, weight);
      const guess = textUnits(CALIBRATION_SAMPLE) * 100 * (bold ? 1.06 : 1);
      if (actual > 0 && guess > 0) fontScale[key] = actual / guess;
    }
  })().catch(() => {});
  return calibration;
}

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

/**
 * Split a two-line block into lines of similar length. A greedy wrap fills the
 * first line and strands a word on the second; an even pair reads as a designed
 * caption rather than an accident.
 */
function balanceLines(f: FittedText, maxWidth: number, bold: boolean): FittedText {
  if (f.lines.length !== 2) return f;
  const words = f.lines.join(' ').split(/\s+/).filter(Boolean);
  let best = f.lines;
  let bestLongest = Math.max(...f.lines.map((l) => measure(l, f.fontSize, bold)));
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const longest = Math.max(measure(a, f.fontSize, bold), measure(b, f.fontSize, bold));
    if (longest <= maxWidth && longest < bestLongest) {
      best = [a, b];
      bestLongest = longest;
    }
  }
  return { ...f, lines: best };
}

type CheckedText = FittedText & { widths: number[] };

/**
 * Fit, then check every line against the renderer and shrink until it really fits.
 * Calibration brings the estimate close; this makes it certain — Devanagari, a
 * run of wide capitals, anything a per-character estimate misjudges.
 */
async function fitChecked(
  text: string,
  maxWidth: number,
  opts: { start: number; min: number; maxLines: number; bold?: boolean; weight: number; balance?: boolean },
): Promise<CheckedText> {
  await calibrate();
  const bold = opts.bold ?? false;
  let start = opts.start;
  for (let attempt = 0; attempt < 6; attempt++) {
    let f = fitText(text, maxWidth, { start, min: opts.min, maxLines: opts.maxLines, bold });
    if (opts.balance) f = balanceLines(f, maxWidth, bold);
    const widths = await Promise.all(f.lines.map((l) => inkWidth(l, f.fontSize, opts.weight)));
    const widest = Math.max(0, ...widths);
    if (widest <= maxWidth || f.fontSize <= opts.min) return { ...f, widths };
    // Shrink by the overshoot the renderer reported, and a point more to settle.
    start = Math.max(opts.min, Math.floor((f.fontSize * maxWidth) / widest) - 1);
  }
  const f = fitText(text, maxWidth, { start: opts.min, min: opts.min, maxLines: opts.maxLines, bold });
  return { ...f, widths: await Promise.all(f.lines.map((l) => inkWidth(l, f.fontSize, opts.weight))) };
}

const tspans = (
  f: FittedText & { widths?: number[] },
  x: number,
  yStart: number,
  fill: string,
  weight: number,
  maxWidth: number,
): string =>
  f.lines
    .map((line, i) => {
      const over = (f.widths?.[i] ?? measure(line, f.fontSize, weight >= 600)) > maxWidth;
      return `<text x="${x}" y="${yStart + i * f.lineHeight}" text-anchor="middle" font-family="${FONT}"
        font-size="${f.fontSize}" font-weight="${weight}" fill="${fill}"${
          over ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"` : ''
        }>${esc(line)}</text>`;
    })
    .join('\n');

/* ---------------------------------------------------------------------------
 * Sizing. Everything below is measured against the frame's SHORT side, not its
 * width. Sizing off the width meant a 16:9 frame (1280 wide, 720 tall) got type
 * and bars scaled for a 1280-tall portrait frame: the footer alone ate a sixth
 * of the picture and covered the action.
 * ------------------------------------------------------------------------- */

/** The bar may never take more than this fraction of the frame height. */
const FOOTER_MAX_H = 0.085;
/** Shared footprint for both corner logos, as a fraction of the short side. */
const LOGO_BOX = { w: 0.26, h: 0.085 };

const shortSide = (w: number, h: number): number => Math.min(w, h);

/** Bottom strip: solid bar + centred contact detail, wrapped and fitted. */
async function footerPng(text: string, W: number, H: number, ink: string): Promise<Buffer> {
  const S = shortSide(W, H);
  const pad = Math.round(W * 0.045);
  const maxWidth = W - pad * 2;
  const capH = Math.round(H * FOOTER_MAX_H);
  const vPad = Math.round(S * 0.042);
  const min = Math.max(10, Math.round(S * 0.019));
  // A wide frame has room for the whole strip on one line; a tall one may need two.
  const maxLines = W >= H ? 1 : 2;

  const footerOpts = { min, maxLines, bold: true, weight: 600 };
  let fitted = await fitChecked(text, maxWidth, { ...footerOpts, start: Math.round(S * 0.034) });
  let h = fitted.lineHeight * fitted.lines.length + vPad;
  while (h > capH && fitted.fontSize > min) {
    fitted = await fitChecked(text, maxWidth, { ...footerOpts, start: fitted.fontSize - 1 });
    h = fitted.lineHeight * fitted.lines.length + vPad;
  }
  h = Math.min(h, capH);
  // A wrapped strip must not end one line on a separator and open the next after
  // it — "… 55555 ·" over "Near …" reads as a typo. Dropping it only shortens the
  // line, so the fit still holds.
  fitted = {
    ...fitted,
    lines: fitted.lines.map((l) => l.replace(/\s*[·|•]\s*$/, '').replace(/^\s*[·|•]\s*/, '')),
  };
  const firstBaseline = Math.round((h - fitted.lineHeight * (fitted.lines.length - 1)) / 2 + fitted.fontSize * 0.35);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}">
  <rect width="${W}" height="${h}" fill="${ink}" fill-opacity="0.92"/>
  ${tspans(fitted, W / 2, firstBaseline, '#ffffff', 600, maxWidth)}
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
  const S = shortSide(w, h);
  const [name, cta, ...rest] = spec.lines.map((l) => (l ?? '').trim()).filter(Boolean);
  const pad = Math.round(w * 0.08);
  const maxWidth = w - pad * 2;

  const nameFit = name
    ? await fitChecked(name, maxWidth, {
        start: Math.round(S * 0.075), min: Math.round(S * 0.036), maxLines: 3, bold: true, weight: 700, balance: true,
      })
    : null;
  const ctaFit = cta
    ? await fitChecked(cta, maxWidth, {
        start: Math.round(S * 0.042), min: Math.round(S * 0.028), maxLines: 2, weight: 500, balance: true,
      })
    : null;
  const restFits = await Promise.all(
    rest.map((line) =>
      fitChecked(line, maxWidth, { start: Math.round(S * 0.034), min: Math.round(S * 0.024), maxLines: 2, weight: 400 }),
    ),
  );

  // Lay the block out as a stack, then centre the whole thing vertically.
  const gapAfterName = Math.round(S * 0.045);
  const gapAfterCta = Math.round(S * 0.06);
  const gapBetweenRest = Math.round(S * 0.012);
  const logoH = spec.logo ? Math.round(S * 0.11) : 0;
  const gapAfterLogo = spec.logo ? Math.round(S * 0.06) : 0;

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
  <rect x="0" y="0" width="${w}" height="${Math.max(2, Math.round(S * 0.008))}" fill="${accent}"/>
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

/**
 * Corner logo, normalised to a fixed footprint.
 *
 * Uploaded logos arrive at any pixel size, any aspect ratio and with any amount
 * of blank canvas baked around the artwork. Scaling by width alone — what this
 * did before — meant a tall square badge towered over a wide wordmark uploaded
 * beside it. So: strip the padding, scale to a constant optical AREA rather than
 * a constant width, clamp to a shared box, and return that box. Both corners
 * then occupy exactly the same footprint whatever was uploaded.
 */
async function normalizedLogo(
  src: Buffer,
  W: number,
  H: number,
  align: 'left' | 'right',
): Promise<Buffer> {
  const S = shortSide(W, H);
  const boxW = Math.round(S * LOGO_BOX.w);
  const boxH = Math.round(S * LOGO_BOX.h);

  // 1. Trim the blank margin so the artwork, not its canvas, sets the size.
  //    (trim() throws on a completely uniform image — then there is nothing to trim.)
  let art = src;
  try {
    art = await sharp(src).ensureAlpha().trim({ threshold: 12 }).png().toBuffer();
  } catch {
    art = await sharp(src).ensureAlpha().png().toBuffer();
  }

  const m = await sharp(art).metadata();
  const aw = Math.max(1, m.width ?? boxW);
  const ah = Math.max(1, m.height ?? boxH);

  // 2. Equal optical weight: match ink area, then clamp so nothing overruns the box.
  const targetArea = boxW * boxH * 0.6;
  const scale = Math.min(Math.sqrt(targetArea / (aw * ah)), boxW / aw, boxH / ah);
  const fitW = Math.max(1, Math.round(aw * scale));

  const resized = await sharp(art)
    .resize({ width: fitW, height: boxH, fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
  const rm = await sharp(resized).metadata();
  const rw = Math.min(boxW, rm.width ?? fitW);
  const rh = Math.min(boxH, rm.height ?? boxH);

  // 3. Drop it into the shared box — vertically centred, pinned to the frame
  //    edge — so left and right logos sit on an identical baseline.
  return sharp({
    create: { width: boxW, height: boxH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: resized, left: align === 'left' ? 0 : Math.max(0, boxW - rw), top: Math.max(0, Math.round((boxH - rh) / 2)) },
    ])
    .png()
    .toBuffer();
}

/** How much of the frame a caption may take, and how far it sits off the edge. */
const CARD_MAX_W = { landscape: 0.46, portrait: 0.78 };
/** Caption type, as fractions of the frame's short side. */
const CARD_TYPE = { head: 0.058, headMin: 0.03, sub: 0.032, subMin: 0.021 };

const cardTextWidth = (W: number, H: number): number =>
  Math.round(W * (W >= H ? CARD_MAX_W.landscape : CARD_MAX_W.portrait));

const headOpts = (S: number, start?: number) => ({
  start: start ?? Math.round(S * CARD_TYPE.head),
  min: Math.round(S * CARD_TYPE.headMin),
  maxLines: 2,
  bold: true,
  weight: 700,
  balance: true,
});

/**
 * One headline size for every caption in a film.
 *
 * Fitted card by card, a short caption came up large and the next one small, and
 * the size jumped at every cut. Every caption is set at the size the longest one
 * needs — but never below four-fifths of full size: one wordy caption should
 * shrink itself, not every other caption in the video.
 */
export async function captionSize(texts: string[], W: number, H: number): Promise<number | undefined> {
  const clean = texts.map((t) => t.trim()).filter(Boolean);
  if (!clean.length) return undefined;
  const S = shortSide(W, H);
  const full = Math.round(S * CARD_TYPE.head);
  const sizes = await Promise.all(clean.map(async (t) => (await fitChecked(t, cardTextWidth(W, H), headOpts(S))).fontSize));
  return Math.max(Math.round(full * 0.8), Math.min(...sizes));
}

/**
 * A caption panel, sized to its own text.
 *
 * Left-aligned and set on a solid slab rather than dropped straight onto the
 * picture: a price read off a moving car is the one thing in the video that has
 * to be unambiguous. The panel is sized from what the renderer actually drew, so
 * it hugs the text instead of cropping it, and never curtains off the shot.
 */
export async function cardPng(
  text: string,
  sub: string | undefined,
  W: number,
  H: number,
  accent: string,
  ink: string,
  /** The film-wide headline size from captionSize(). A caption that cannot fit at it goes smaller. */
  headSize?: number,
): Promise<Buffer> {
  const S = shortSide(W, H);
  const maxText = cardTextWidth(W, H);
  const head = await fitChecked(text, maxText, headOpts(S, headSize));
  // The small line follows the headline down, so the pair keeps its proportion.
  const subFit = sub?.trim()
    ? await fitChecked(sub.trim(), maxText, {
        start: Math.round(Math.min(S * CARD_TYPE.sub, head.fontSize * 0.56)),
        min: Math.round(S * CARD_TYPE.subMin),
        maxLines: 2,
        weight: 500,
        balance: true,
      })
    : null;

  const padX = Math.round(S * 0.042);
  const padY = Math.round(S * 0.034);
  const barW = Math.max(3, Math.round(S * 0.009));
  const gap = subFit ? Math.round(S * 0.018) : 0;

  const widest = Math.max(0, ...head.widths, ...(subFit ? subFit.widths : []));
  const w = Math.min(W - Math.round(S * 0.08), Math.round(barW + padX + widest + padX));
  const textW = w - barW - padX * 2;
  const headH = head.lineHeight * head.lines.length;
  const subH = subFit ? subFit.lineHeight * subFit.lines.length : 0;
  const h = padY * 2 + headH + gap + subH;
  const rx = Math.round(S * 0.012);
  const x = barW + padX;

  // tspans() centres on the x it is given; these are left-aligned.
  const line = (f: CheckedText, top: number, fill: string, weight: number): string =>
    f.lines
      .map((t, i) => {
        const over = (f.widths[i] ?? 0) > textW;
        return `<text x="${x}" y="${top + i * f.lineHeight + f.fontSize}" text-anchor="start" font-family="${FONT}"
          font-size="${f.fontSize}" font-weight="${weight}" fill="${fill}"${
            over ? ` textLength="${textW}" lengthAdjust="spacingAndGlyphs"` : ''
          }>${esc(t)}</text>`;
      })
      .join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" rx="${rx}" fill="${ink}" fill-opacity="0.93"/>
  <rect width="${barW}" height="${h}" rx="${Math.round(barW / 2)}" fill="${accent}"/>
  ${line(head, padY, '#ffffff', 700)}
  ${subFit ? line(subFit, padY + headH + gap, accent, 500) : ''}
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Several photographs as one labelled reference image.
 *
 * A video model is given a handful of reference slots, and four separate photos
 * of a car spend four of them — with nothing to say which is which. One contact
 * sheet spends a single slot, carries every angle at once, and names each tile,
 * so the prompt can say "the rear is the tile marked REAR" instead of hoping.
 *
 * Tiles keep their own proportions on white; nothing is cropped, because a
 * cropped car is exactly the ambiguity this is trying to remove.
 */
export async function contactSheet(
  tiles: { bytes: Buffer; label: string }[],
  opts: { cell?: number; labels?: boolean; max?: number } = {},
): Promise<Buffer | null> {
  const items = tiles.filter((t) => t.bytes?.length).slice(0, opts.max ?? 6);
  if (items.length < 2) return null;
  const CELL = opts.cell ?? 512;
  // A sheet of one view needs no captions — every tile is the same thing from a
  // different distance, and a caption on each is noise the model has to read.
  const LABEL = opts.labels === false ? 0 : Math.round(CELL * 0.1);
  const cols = items.length <= 2 ? items.length : items.length <= 4 ? 2 : 3;
  const rows = Math.ceil(items.length / cols);

  const cells = await Promise.all(
    items.map(async (t) => {
      const art = await sharp(t.bytes)
        .resize(CELL, CELL - LABEL, { fit: 'contain', background: '#ffffff' })
        .toBuffer()
        .catch(() => null);
      if (!art) return null;
      if (!LABEL) {
        return sharp({ create: { width: CELL, height: CELL, channels: 3, background: '#ffffff' } })
          .composite([{ input: art, top: 0, left: 0 }])
          .jpeg({ quality: 90 })
          .toBuffer();
      }
      const caption = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${LABEL}">
          <rect width="${CELL}" height="${LABEL}" fill="#111111"/>
          <text x="${CELL / 2}" y="${Math.round(LABEL * 0.74)}" text-anchor="middle" font-family="${FONT}"
            font-size="${Math.round(LABEL * 0.58)}" font-weight="700" letter-spacing="1.5" fill="#ffffff">${esc(
              t.label.toUpperCase(),
            )}</text>
        </svg>`,
      );
      return sharp({ create: { width: CELL, height: CELL, channels: 3, background: '#ffffff' } })
        .composite([
          { input: art, top: 0, left: 0 },
          { input: caption, top: CELL - LABEL, left: 0 },
        ])
        .jpeg({ quality: 90 })
        .toBuffer();
    }),
  );

  const good = cells.filter((c): c is Buffer => Boolean(c));
  if (good.length < 2) return null;
  return sharp({
    create: { width: cols * CELL, height: rows * CELL, channels: 3, background: '#ffffff' },
  })
    .composite(
      good.map((input, i) => ({ input, left: (i % cols) * CELL, top: Math.floor(i / cols) * CELL })),
    )
    .jpeg({ quality: 88 })
    .toBuffer();
}

/** Where speech actually starts and stops in one clip, measured in 100ms windows. */
async function speechEdges(file: string): Promise<{ start: number; end: number; duration: number }> {
  const meta = await probe(file);
  const out = await run('ffmpeg', [
    '-v', 'error', '-i', file,
    '-af', 'aresample=8000,asetnsamples=800,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
    '-f', 'null', '-',
  ]).catch(() => '');
  const levels = [...out.matchAll(/RMS_level=(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (levels.length < 3) return { start: 0, end: meta.duration, duration: meta.duration };
  // The same rule the music bed ducks by: loud relative to this clip's own loudest,
  // so a quiet recording is not read as silence throughout.
  const sorted = [...levels].sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? -20;
  const floor = Math.max(-60, p90 - 18);
  const first = levels.findIndex((l) => l > floor);
  let last = -1;
  for (let i = levels.length - 1; i >= 0; i--) {
    if (levels[i]! > floor) {
      last = i;
      break;
    }
  }
  if (first < 0 || last < 0) return { start: 0, end: meta.duration, duration: meta.duration };
  return { start: first * 0.1, end: Math.min(meta.duration, (last + 1) * 0.1), duration: meta.duration };
}

/** What a join looked like before and after it was tightened — kept on the run. */
export interface JoinNote {
  part: number;
  headTrim: number;
  tailTrim: number;
  /** How alike the end of the previous part and the start of this one sound, 0–1. */
  echo?: number;
}

const LEAD_IN = 0.15;
const TAIL_OUT = 0.3;
const MAX_TRIM = 1.2;

/** A crude loudness envelope, for telling whether two stretches sound alike. */
async function envelope(file: string, from: number, seconds: number): Promise<number[]> {
  const out = await run('ffmpeg', [
    '-v', 'error', '-ss', from.toFixed(3), '-t', seconds.toFixed(3), '-i', file,
    '-af', 'aresample=8000,asetnsamples=160,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
    '-f', 'null', '-',
  ]).catch(() => '');
  return [...out.matchAll(/RMS_level=(-?\d+(?:\.\d+)?)/g)].map((m) => Math.max(-70, Number(m[1])));
}

function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 8) return 0;
  const x = a.slice(a.length - n);
  const y = b.slice(0, n);
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a1 = x[i]! - mx;
    const b1 = y[i]! - my;
    num += a1 * b1;
    dx += a1 * a1;
    dy += b1 * b1;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

/**
 * Make every join sound deliberate.
 *
 * A part is asked to stop speaking before its end and to wait a beat before it
 * starts, and the model does neither reliably: measured on real runs, one part
 * ended with a second of dead air while the next began speaking inside its first
 * 200ms. Joined whole, that reads as the film stalling, or as two phrases
 * colliding. So the silence at each join is cut back to a fixed beat — measured,
 * not asked for — leaving a breath at the end of one part and a moment before the
 * next speaks. The trims are capped, so a part that simply is quiet keeps its
 * pauses.
 *
 * It also measures how alike the end of one part sounds to the start of the next
 * and records it, which is the signature a repeated word across a join would
 * leave. Nothing is cut on that number yet — it is there to be read first.
 */
async function tightenJoins(files: string[], dir: string): Promise<{ files: string[]; notes: JoinNote[] }> {
  if (files.length < 2) return { files, notes: [] };
  const edges = await Promise.all(files.map(speechEdges));
  const notes: JoinNote[] = [];
  const out: string[] = [];

  for (const [i, file] of files.entries()) {
    const e = edges[i]!;
    const silent = e.start === 0 && e.end >= e.duration - 0.05;
    const head = i > 0 && !silent ? Math.min(MAX_TRIM, Math.max(0, e.start - LEAD_IN)) : 0;
    const tail = i < files.length - 1 && !silent ? Math.min(MAX_TRIM, Math.max(0, e.duration - e.end - TAIL_OUT)) : 0;

    let echo: number | undefined;
    if (i > 0) {
      const prev = out[i - 1]!;
      const prevMeta = await probe(prev);
      const window = 0.8;
      const a = await envelope(prev, Math.max(0, prevMeta.duration - window), window);
      const b = await envelope(file, head, window);
      const r = correlation(a, b);
      echo = Math.round(r * 100) / 100;
    }

    if (head <= 0.05 && tail <= 0.05) {
      out.push(file);
      notes.push({ part: i + 1, headTrim: 0, tailTrim: 0, echo });
      continue;
    }
    const trimmed = join(dir, `tight-${i}.mp4`);
    await run('ffmpeg', [
      '-v', 'error', '-y', '-threads', FF_THREADS,
      '-ss', head.toFixed(3), '-i', file, '-t', Math.max(0.5, e.duration - head - tail).toFixed(3),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', trimmed,
    ]);
    out.push(trimmed);
    notes.push({ part: i + 1, headTrim: Math.round(head * 100) / 100, tailTrim: Math.round(tail * 100) / 100, echo });
  }
  return { files: out, notes };
}

/**
 * Build the finished video. Returns an MP4 buffer.
 * A single segment with no overlays short-circuits to the input untouched.
 */
export async function composeFinal(segments: Buffer[], overlay: BrandOverlay = {}): Promise<Buffer> {
  if (segments.length === 0) throw new Error('no segments to compose');

  const accent = overlay.accent ?? DEFAULT_ACCENT;
  const ink = overlay.ink ?? DEFAULT_INK;

  const nothingToDo =
    segments.length === 1 &&
    !overlay.footerText &&
    !overlay.brandLogo &&
    !overlay.dealerLogo &&
    !overlay.endCard &&
    !overlay.cards?.length &&
    !overlay.targetShortSide &&
    !overlay.musicBed &&
    (overlay.speed ?? 1) === 1;
  if (nothingToDo) return segments[0]!;

  const dir = await mkdtemp(join(tmpdir(), 'ava-post-'));
  try {
    const raw: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const f = join(dir, `seg-${i}.mp4`);
      await writeFile(f, segments[i]!);
      raw.push(f);
    }
    // The dead air and the collisions at the joins go first, so everything below
    // — durations, caption timings, the music bed — is measured on the real cut.
    const tightened = await tightenJoins(raw, dir).catch(() => ({ files: raw, notes: [] as JoinNote[] }));
    const files = tightened.files;
    const headTrims = tightened.notes.map((n) => n.headTrim);
    const cutBefore = tightened.notes.map((n) => n.headTrim + n.tailTrim);
    overlay.onJoins?.(tightened.notes);
    const metas = await Promise.all(files.map(probe));
    // Every clip is scaled to one frame size before the chain. concat refuses to
    // join two sizes, and a 1080p deliverable from a model that renders 720p is
    // upscaled here — before the footer, captions and logos are drawn at W×H.
    const srcW = metas[0]!.width;
    const srcH = metas[0]!.height;
    const target = overlay.targetShortSide ?? 0;
    const k = target && shortSide(srcW, srcH) < target ? target / shortSide(srcW, srcH) : 1;
    const even = (n: number): number => Math.round(n / 2) * 2;
    const W = even(srcW * k);
    const H = even(srcH * k);
    // concat refuses to join two links whose timebases differ, so everything
    // that enters the chain — clips, end card, captions — is pinned to the
    // frame rate of the first clip. Segments arrive from the model at whatever
    // rate it renders, and a 25fps clip meeting a 24fps end card failed the
    // whole compose.
    const fps = Math.max(1, Math.round(metas[0]!.fps));

    // The storyboard's pace, applied to the finished parts: picture and voice are sped up
    // together, so lip-sync holds and the voice keeps its own pitch. Asking the model to
    // talk faster only crammed the same words into less clip, and a line that ran out of
    // clip spilled across the cut and was said twice.
    const speed = Math.min(1.5, Math.max(0.85, overlay.speed ?? 1));
    const rawDurations = metas.map((m) => m.duration);
    if (speed !== 1) for (const m of metas) m.duration /= speed;

    /*
     * A beat at the end, so the film does not cut on a word.
     *
     * The last part is the one clip whose tail is never tightened, and the model
     * uses every second it is given — so its speech routinely runs to the final
     * frame. Cut there, the last two or three words go with it, and at 1.5x they
     * are two or three words the viewer needed. So the last frame is held for
     * however long the speech is short of a proper ending, capped at a beat, and
     * the end card follows that instead of interrupting it.
     */
    const lastBody = files.length - 1;
    const TAIL_ROOM = 0.45;
    let tailPad = 0;
    if (files[lastBody]) {
      const e = await speechEdges(files[lastBody]!).catch(() => null);
      if (e && e.end > 0) {
        const roomLeft = Math.max(0, e.duration - e.end) / speed;
        tailPad = Math.round(Math.max(0, Math.min(0.6, TAIL_ROOM - roomLeft)) * 1000) / 1000;
        metas[lastBody]!.duration += tailPad;
      }
    }

    // --- the parts, joined whole ---
    // Every part plays in full, cut to cut. The crossfade that used to join them
    // blended the last half-second of one part into the first half-second of the
    // next: measured on a real 45s run, the audio fell to -57 dB at one join, the
    // first word of a part was faded in and the last word of the part before faded
    // out. Continuation parts open on the previous part's last frame, so the cut is
    // already seamless; a 15ms audio fade is all it takes to keep it from clicking.
    // Joining whole clips is also the lightest way through ffmpeg (measured 390 MB).
    const parts: string[] = [];
    const clipInputs: string[] = [];
    const clipFiles = [...files];
    let endCardFile: string | undefined;
    if (overlay.endCard && overlay.endCard.lines.some((l) => l.trim())) {
      const png = join(dir, 'endcard.png');
      await writeFile(png, await endCardPng(overlay.endCard, W, H, accent, ink));
      endCardFile = join(dir, 'endcard.mp4');
      await run('ffmpeg', [
        '-v', 'error', '-y',
        '-loop', '1', '-t', String(overlay.endCard.seconds), '-i', png,
        '-f', 'lavfi', '-t', String(overlay.endCard.seconds), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps), '-threads', FF_THREADS,
        '-c:a', 'aac', '-shortest', endCardFile,
      ]);
      clipFiles.push(endCardFile);
      metas.push({ duration: overlay.endCard.seconds, width: W, height: H, fps });
    }
    const clipCount = metas.length;
    const MICRO_FADE = 0.015;

    let clipIdx = 0;
    clipFiles.forEach((file, i) => {
      clipInputs.push('-threads', FF_THREADS, '-i', file);
      const d = metas[i]!.duration.toFixed(3);
      const isEndCard = Boolean(endCardFile) && i === clipCount - 1;
      // Picture and sound are each padded and trimmed to the clip's own length, so
      // a part whose audio stops a few milliseconds short leaves no gap and none can
      // drift out of sync over five joins. The end card eases in from black.
      parts.push(
        `[${i}:v]scale=${W}:${H}:flags=lanczos,setsar=1,${isEndCard || speed === 1 ? '' : `setpts=(PTS-STARTPTS)/${speed},`}fps=${fps},format=yuv420p,tpad=stop_mode=clone:stop_duration=${(0.25 + (i === lastBody ? tailPad : 0)).toFixed(3)},trim=end=${d},setpts=N/FRAME_RATE/TB,settb=AVTB${
          isEndCard ? ',fade=t=in:st=0:d=0.35' : ''
        }[c${i}v]`,
      );
      parts.push(
        `[${i}:a]aresample=44100:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo,${isEndCard || speed === 1 ? '' : `atempo=${speed},`}apad,atrim=end=${d},asetpts=N/SR/TB,afade=t=in:st=0:d=${MICRO_FADE},afade=t=out:st=${Math.max(0, Number(d) - MICRO_FADE).toFixed(3)}:d=${MICRO_FADE}[c${i}a]`,
      );
      clipIdx++;
    });
    parts.push(`${clipFiles.map((_, i) => `[c${i}v][c${i}a]`).join('')}concat=n=${clipCount}:v=1:a=1[vcat][voice]`);

    const filmSeconds = metas.reduce((a, m) => a + m.duration, 0);
    let audioOut = 'voice';
    if (overlay.musicBed) {
      const bed = join(dir, 'music-bed');
      await writeFile(bed, overlay.musicBed);
      clipInputs.push('-i', bed);
      const m = clipIdx++;
      // Never looped: music restarting mid-film is the most audible glitch there is.
      // The server asks for a track longer than the film and it is trimmed to fit; if
      // one still comes back short, copies of it are joined with a slow crossfade.
      const bedSeconds = await mediaSeconds(bed);
      const XF = 2;
      const copies =
        bedSeconds > XF * 2 && bedSeconds < filmSeconds
          ? Math.min(6, Math.ceil((filmSeconds - XF) / (bedSeconds - XF)))
          : 1;
      const norm = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo';
      if (copies > 1) {
        parts.push(`[${m}:a]${norm},asplit=${copies}${Array.from({ length: copies }, (_, i) => `[bs${i}]`).join('')}`);
        let prev = 'bs0';
        for (let i = 1; i < copies; i++) {
          const out = i === copies - 1 ? 'bedraw' : `bx${i}`;
          parts.push(`[${prev}][bs${i}]acrossfade=d=${XF}:c1=qsin:c2=qsin[${out}]`);
          prev = out;
        }
      } else {
        parts.push(`[${m}:a]${norm}[bedraw]`);
      }
      // Levelled first — a generated track can come back mastered anywhere — to the
      // level it plays at when nobody is speaking; then it dips under every line.
      const open = Math.max(-40, Math.min(-14, overlay.musicLoudness ?? -20));
      const duck = Math.min(0, overlay.musicDuckDb ?? 0);
      /*
       * Where the music stays down.
       *
       * Under every spoken line, and then across the end card — which has no speech
       * of its own, so without this the bed came back up to full level for the last
       * three seconds. After a film spent ducked under a voice, that reads as a
       * stray burst of music over the dealership's contact details.
       */
      const spans =
        duck < 0
          ? (await speechSpans(files, rawDurations)).map(([a, b]): [number, number] => [a / speed, b / speed])
          : [];
      if (spans.length && endCardFile) {
        const cardSeconds = overlay.endCard?.seconds ?? 0;
        const from = Math.max(0, filmSeconds - cardSeconds - DUCK_ATTACK);
        const last = spans[spans.length - 1]!;
        // Merged rather than appended when it lands close to the final line, so the
        // spans stay MIN_MUSIC_PAUSE apart — the spacing duckVolume's ramps rely on.
        if (from - last[1] < MIN_MUSIC_PAUSE) last[1] = filmSeconds;
        else spans.push([from, filmSeconds]);
      }
      parts.push(
        `[bedraw]atrim=end=${filmSeconds.toFixed(3)},asetpts=N/SR/TB,loudnorm=I=${open}:TP=-2:LRA=11,${norm},` +
          `afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(0, filmSeconds - 1.5).toFixed(3)}:d=1.5` +
          // Small frames first: volume is worked out once per frame, and loudnorm hands back
          // its last seconds as one large frame, which held the music down over the end card.
          (spans.length ? `,asetnsamples=n=1024:p=0,volume='${duckVolume(spans, duck)}':eval=frame` : '') +
          '[bed]',
      );
      parts.push(`[voice][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mixed]`);
      audioOut = 'mixed';
    }

    // Overlay assets are extra inputs after the clips and the music, so their filter
    // indices continue from there.
    const inputs: string[] = [];
    let nextIdx = clipIdx;
    // A one-frame image input holds its last frame forever, which is all the logos
    // and the footer need. A caption has to fade, and fade animates over
    // timestamps — so it is looped into a real stream, but only across its own
    // window, shifted to where it appears, not the length of the whole film.
    const addOverlayInput = async (
      name: string,
      bytes: Buffer,
      window?: { from: number; seconds: number },
    ): Promise<number> => {
      const f = join(dir, name);
      await writeFile(f, bytes);
      if (window) {
        inputs.push('-loop', '1', '-framerate', String(fps), '-t', window.seconds.toFixed(3), '-itsoffset', window.from.toFixed(3));
      }
      inputs.push('-threads', FF_THREADS, '-i', f);
      return nextIdx++;
    };

    const footerBytes = overlay.footerText?.trim()
      ? await footerPng(overlay.footerText.trim(), W, H, ink)
      : null;
    const footerH = footerBytes ? ((await sharp(footerBytes).metadata()).height ?? 0) : 0;
    const footerIdx = footerBytes ? await addOverlayInput('footer.png', footerBytes) : -1;
    /*
     * Each logo twice: in colour for the film, in white for the end card.
     *
     * Cleaned here as well as when it is uploaded, because a logo saved before
     * logos were cleaned still carries its white canvas — and that is what put two
     * white boxes on a navy end card. A logo that cannot be cleaned is used as it is.
     */
    const logoPair = async (src: Buffer | undefined, align: 'left' | 'right'): Promise<{ colour: number; white: number } | null> => {
      if (!src) return null;
      const cleaned = await cleanLogo(src).catch(() => null);
      const colour = await addOverlayInput(`${align}-logo.png`, await normalizedLogo(cleaned?.colour ?? src, W, H, align));
      const white =
        cleaned && endCardFile
          ? await addOverlayInput(`${align}-logo-white.png`, await normalizedLogo(cleaned.white, W, H, align))
          : -1;
      return { colour, white };
    };
    const brandLogos = await logoPair(overlay.brandLogo, 'left');
    const dealerLogos = await logoPair(overlay.dealerLogo, 'right');

    // --- lay the brand furniture on top ---
    // Both logo inputs are the same normalised box, so a single margin puts them
    // on the same baseline however different the uploaded files were.
    const margin = Math.round(shortSide(W, H) * 0.04);
    let vCur = 'vcat';

    // --- timed captions ---
    // The model is told to draw no text at all, so every word the viewer reads
    // is laid on here. Each caption is a still, looped across the whole
    // timeline and dissolved in and out on its alpha channel — steadier than
    // cutting the video up, and it spells the price correctly every time.
    const clipStart: number[] = [];
    let at = 0;
    for (let i = 0; i < clipCount; i++) {
      clipStart.push(at);
      at += metas[i]!.duration;
    }
    // Captions belong to the film, never to the end card that follows it.
    const bodyClips = endCardFile ? clipCount - 1 : clipCount;
    const bodyEnd = clipStart[bodyClips - 1]! + metas[bodyClips - 1]!.duration;
    const CARD_FADE = 0.28;

    const headSize = await captionSize((overlay.cards ?? []).map((c) => c.text ?? ''), W, H);
    let cardNo = 0;
    for (const card of (overlay.cards ?? []).slice(0, 16)) {
      const text = card.text?.trim();
      const ci = card.part - 1;
      if (!text || ci < 0 || ci >= bodyClips) continue;
      // A segment that came back shorter than it was asked for pulls its own
      // captions in with it, rather than leaving them stranded past the cut.
      // The part may have had its silence trimmed at both ends, so a card's place
      // in it is measured against what is left, and shifted by what went from the front.
      const head = headTrims[ci] ?? 0;
      const planned = Math.max(0.1, card.partSeconds - (cutBefore[ci] ?? 0));
      const k = card.partSeconds > 0 ? metas[ci]!.duration / planned : 1;
      const from = clipStart[ci]! + Math.max(0, card.start - head) * k;
      const to = Math.min(bodyEnd, clipStart[ci]! + Math.max(0, card.end - head) * k);
      if (to - from < 0.8) continue; // too brief to read

      const png = await cardPng(text, card.sub, W, H, accent, ink, headSize);
      const cardH = (await sharp(png).metadata()).height ?? 0;
      const idx = await addOverlayInput(`card-${cardNo}.png`, png, { from, seconds: to - from });
      const top = Math.max(margin, H - footerH - margin - cardH);
      const label = `cd${cardNo}`;
      const outLabel = `vc${cardNo}`;
      parts.push(
        `[${idx}:v]format=rgba,settb=AVTB,fade=t=in:st=${from.toFixed(3)}:d=${CARD_FADE}:alpha=1,` +
          `fade=t=out:st=${Math.max(from, to - CARD_FADE).toFixed(3)}:d=${CARD_FADE}:alpha=1[${label}]`,
      );
      parts.push(`[${vCur}][${label}]overlay=${margin}:${top}:eof_action=pass[${outLabel}]`);
      vCur = outLabel;
      cardNo++;
    }

    // Colour over the film; white from the moment the navy end card begins.
    const onFilm = endCardFile ? `:enable='lt(t,${bodyEnd.toFixed(3)})'` : '';
    const onCard = `:enable='gte(t,${bodyEnd.toFixed(3)})'`;
    for (const [logos, x, tag] of [
      [brandLogos, `${margin}`, 'b'],
      [dealerLogos, `W-w-${margin}`, 'd'],
    ] as const) {
      if (!logos) continue;
      parts.push(`[${vCur}][${logos.colour}:v]overlay=${x}:${margin}${onFilm}[v${tag}]`);
      vCur = `v${tag}`;
      if (logos.white >= 0) {
        parts.push(`[${vCur}][${logos.white}:v]overlay=${x}:${margin}${onCard}[v${tag}w]`);
        vCur = `v${tag}w`;
      }
    }
    if (footerIdx >= 0) {
      parts.push(`[${vCur}][${footerIdx}:v]overlay=0:H-h[vf]`);
      vCur = 'vf';
    }
    parts.push(`[${vCur}]null[vout]`);

    const out = join(dir, 'final.mp4');
    await run('ffmpeg', [
      '-v', 'error', '-y',
      ...clipInputs,
      ...inputs,
      '-filter_complex_threads', FF_THREADS,
      '-filter_complex', parts.join(';'),
      '-map', '[vout]',
      '-map', `[${audioOut}]`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-threads', FF_THREADS,
      '-c:a', 'aac', '-movflags', '+faststart',
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Cut a clip down to the length its segment was planned at.
 *
 * Veo renders only 4, 6 or 8 seconds — always 8 at 1080p or with reference
 * images — so a planned 5.3s segment comes back long. Left untrimmed, every
 * later scene drifts off the storyboard and captions land on the wrong shot.
 * Re-encoded rather than stream-copied, because a copy can only cut on a keyframe.
 */
export async function trimClip(clip: Buffer, seconds: number): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'ava-trim-'));
  try {
    const inF = join(dir, 'in.mp4');
    const outF = join(dir, 'out.mp4');
    await writeFile(inF, clip);
    const { duration } = await probe(inF);
    if (!(seconds > 0) || duration <= seconds + 0.05) return clip;
    await run('ffmpeg', [
      '-v', 'error', '-y', '-threads', FF_THREADS, '-i', inF, '-t', seconds.toFixed(3),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-threads', FF_THREADS,
      '-c:a', 'aac', '-movflags', '+faststart', outF,
    ]);
    return await readFile(outF);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** How long a finished video runs, and what shape it is. */
export async function videoFacts(clip: Buffer): Promise<{ duration: number; width: number; height: number }> {
  const dir = await mkdtemp(join(tmpdir(), 'ava-facts-'));
  try {
    const f = join(dir, 'in.mp4');
    await writeFile(f, clip);
    const m = await probe(f);
    return { duration: m.duration, width: m.width, height: m.height };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Cut a finished film into pieces no longer than `maxSeconds`.
 *
 * Seedance renders at most 30 seconds in one pass, so a 47-second film has to go
 * through it in parts. The cuts are re-encoded rather than stream-copied: a
 * stream copy lands on the nearest keyframe, which moves the join by up to a
 * second and shows.
 */
export async function splitVideo(clip: Buffer, maxSeconds: number): Promise<Buffer[]> {
  const { duration } = await videoFacts(clip);
  if (duration <= maxSeconds + 0.05) return [clip];
  const pieces = Math.ceil(duration / maxSeconds);
  const each = duration / pieces;
  const out: Buffer[] = [];
  const dir = await mkdtemp(join(tmpdir(), 'ava-split-'));
  try {
    const inF = join(dir, 'in.mp4');
    await writeFile(inF, clip);
    for (let i = 0; i < pieces; i++) {
      const outF = join(dir, `piece-${i}.mp4`);
      await run('ffmpeg', [
        '-v', 'error', '-y', '-threads', FF_THREADS,
        '-ss', (i * each).toFixed(3), '-i', inF, '-t', each.toFixed(3),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-movflags', '+faststart', outF,
      ]);
      out.push(await readFile(outF));
    }
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Whether a file carries a sound track at all. */
export async function hasAudio(file: string): Promise<boolean> {
  const out = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file,
  ]).catch(() => '');
  return out.trim().length > 0;
}

/**
 * Put pieces back together, cut to cut.
 *
 * The pieces need not match: films joined here can come from different runs, at
 * different sizes, and one of them may be silent. Everything is scaled into the
 * first piece's frame — letterboxed rather than cropped, since cropping a film
 * someone approved is not a joining decision — and a piece with no sound gets
 * silence of its own length so the join does not lose the track.
 */
export async function joinVideos(pieces: Buffer[]): Promise<Buffer> {
  if (pieces.length === 0) throw new Error('nothing to join');
  if (pieces.length === 1) return pieces[0]!;
  const dir = await mkdtemp(join(tmpdir(), 'ava-join-'));
  try {
    const files: string[] = [];
    const metas: { duration: number; width: number; height: number; audio: boolean }[] = [];
    for (const [i, bytes] of pieces.entries()) {
      const f = join(dir, `p-${i}.mp4`);
      await writeFile(f, bytes);
      files.push(f);
      const m = await probe(f);
      metas.push({ ...m, audio: await hasAudio(f) });
    }
    const W = metas[0]!.width;
    const H = metas[0]!.height;
    const outF = join(dir, 'out.mp4');

    const args = ['-v', 'error', '-y', '-threads', FF_THREADS];
    for (const f of files) args.push('-i', f);
    // Silence for the pieces that have none, as extra inputs after the files.
    const silence = new Map<number, number>();
    let nextInput = files.length;
    for (const [i, m] of metas.entries()) {
      if (m.audio) continue;
      args.push('-f', 'lavfi', '-t', Math.max(0.1, m.duration).toFixed(3), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
      silence.set(i, nextInput++);
    }

    const chains: string[] = [];
    for (const [i, m] of metas.entries()) {
      chains.push(
        `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=24,format=yuv420p[v${i}]`,
      );
      const a = m.audio ? `${i}:a` : `${silence.get(i)}:a`;
      chains.push(`[${a}]aresample=44100:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    }
    const streams = files.map((_, i) => `[v${i}][a${i}]`).join('');
    args.push(
      '-filter_complex', `${chains.join(';')};${streams}concat=n=${files.length}:v=1:a=1[v][a]`,
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outF,
    );
    await run('ffmpeg', args);
    return await readFile(outF);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The same film, larger.
 *
 * A film the client has already approved must not be generated again to be
 * delivered at a bigger size — a second generation is a different film. This
 * enlarges the one that was approved: lanczos, and a light unsharp to put back
 * the edge the scaling costs. It cannot invent detail that was never rendered.
 */
export async function upscaleVideo(clip: Buffer, shortSide: number): Promise<Buffer> {
  const { width, height } = await videoFacts(clip);
  const portrait = height >= width;
  const w = portrait ? shortSide : Math.round((shortSide * width) / height / 2) * 2;
  const h = portrait ? Math.round((shortSide * height) / width / 2) * 2 : shortSide;
  if ((portrait ? width : height) >= shortSide) return clip;
  const dir = await mkdtemp(join(tmpdir(), 'ava-up-'));
  try {
    const inF = join(dir, 'in.mp4');
    const outF = join(dir, 'out.mp4');
    await writeFile(inF, clip);
    await run('ffmpeg', [
      '-v', 'error', '-y', '-threads', FF_THREADS, '-i', inF,
      '-vf', `scale=${w}:${h}:flags=lanczos,unsharp=5:5:0.5:5:5:0.0,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
      '-c:a', 'copy', '-movflags', '+faststart', outF,
    ]);
    return await readFile(outF);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Keep only the stretches asked for, in order, and drop the rest.
 *
 * This is what the editor's cuts come down to: a bad two seconds is removed by
 * keeping what is either side of it. Ranges are clamped, sorted and merged, so a
 * careless pair of numbers cannot produce an empty or scrambled film.
 */
export async function keepRanges(
  clip: Buffer,
  ranges: { from: number; to: number }[],
  opts: { mute?: boolean } = {},
): Promise<Buffer> {
  const { duration } = await videoFacts(clip);
  const clean = ranges
    .map((r) => ({ from: Math.max(0, Math.min(duration, r.from)), to: Math.max(0, Math.min(duration, r.to)) }))
    .filter((r) => r.to - r.from > 0.05)
    .sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  for (const r of clean) {
    const last = merged[merged.length - 1];
    if (last && r.from <= last.to + 0.02) last.to = Math.max(last.to, r.to);
    else merged.push({ ...r });
  }
  if (!merged.length) throw new Error('the cut would leave nothing');

  const dir = await mkdtemp(join(tmpdir(), 'ava-cut-'));
  try {
    const inF = join(dir, 'in.mp4');
    const outF = join(dir, 'out.mp4');
    await writeFile(inF, clip);
    const parts: Buffer[] = [];
    for (const [i, r] of merged.entries()) {
      const f = join(dir, `k-${i}.mp4`);
      await run('ffmpeg', [
        '-v', 'error', '-y', '-threads', FF_THREADS,
        '-ss', r.from.toFixed(3), '-i', inF, '-t', (r.to - r.from).toFixed(3),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
        ...(opts.mute ? ['-an'] : ['-c:a', 'aac']),
        '-movflags', '+faststart', f,
      ]);
      parts.push(await readFile(f));
    }
    if (opts.mute) {
      // Joined without an audio track at all, rather than with a silent one.
      const files: string[] = [];
      for (const [i, bytes] of parts.entries()) {
        const f = join(dir, `m-${i}.mp4`);
        await writeFile(f, bytes);
        files.push(f);
      }
      const args = ['-v', 'error', '-y', '-threads', FF_THREADS];
      for (const f of files) args.push('-i', f);
      args.push(
        '-filter_complex',
        `${files.map((_, i) => `[${i}:v]setsar=1,format=yuv420p[v${i}]`).join(';')};${files
          .map((_, i) => `[v${i}]`)
          .join('')}concat=n=${files.length}:v=1:a=0[v]`,
        '-map', '[v]', '-an',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-movflags', '+faststart', outF,
      );
      await run('ffmpeg', args);
      return await readFile(outF);
    }
    return await joinVideos(parts);
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
 * the real footer + end-card art in BOTH orientations, normalises two
 * deliberately mismatched logos, and probes ffmpeg. Surfaced on /api/health so a
 * broken container — or a layout regression — is obvious before a paid run.
 */
export async function selfTest(): Promise<{
  ok: boolean;
  ffmpeg?: string;
  portraitFooter?: string;
  landscapeFooter?: string;
  landscapeFooterPct?: string;
  endCardPx?: string;
  logoBox?: string;
  logosMatch?: boolean;
  textRendered?: boolean;
  error?: string;
}> {
  try {
    const version = (await run('ffmpeg', ['-version'])).split('\n')[0] ?? '';
    const strip = 'Sterling Hyundai  ·  MG Road, Bengaluru  ·  98765 43210';

    const portrait = await footerPng(strip, 720, 1280, DEFAULT_INK);
    const pm = await sharp(portrait).metadata();
    const landscape = await footerPng(strip, 1280, 720, DEFAULT_INK);
    const lm = await sharp(landscape).metadata();

    const end = await endCardPng(
      { lines: ['Sterling Hyundai', 'Book your test drive today', 'MG Road'], seconds: 3 },
      1280,
      720,
      DEFAULT_ACCENT,
      DEFAULT_INK,
    );
    const em = await sharp(end).metadata();

    // Two logos of wildly different pixel size and shape must come out of the
    // normaliser occupying the identical box — that is the whole point of it.
    const tall = await sharp({
      create: { width: 900, height: 900, channels: 4, background: { r: 20, g: 60, b: 160, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const wide = await sharp({
      create: { width: 240, height: 48, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const a = await sharp(await normalizedLogo(tall, 720, 1280, 'left')).metadata();
    const b = await sharp(await normalizedLogo(wide, 720, 1280, 'right')).metadata();

    // If fonts are missing the SVG rasterises to a flat bar — compare the text
    // band against the bar colour to prove glyphs actually drew.
    const band = await sharp(portrait)
      .extract({ left: 60, top: Math.round((pm.height ?? 92) * 0.3), width: 600, height: 20 })
      .stats();
    const textRendered = (band.channels[0]?.stdev ?? 0) > 8;

    return {
      ok: true,
      ffmpeg: version,
      portraitFooter: `${pm.width}x${pm.height}`,
      landscapeFooter: `${lm.width}x${lm.height}`,
      landscapeFooterPct: `${Math.round(((lm.height ?? 0) / 720) * 100)}%`,
      endCardPx: `${em.width}x${em.height}`,
      logoBox: `${a.width}x${a.height}`,
      logosMatch: a.width === b.width && a.height === b.height,
      textRendered,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
