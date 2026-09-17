import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { BrandOverlay } from '../dist/post.js';

export const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const ff = (args: string[]): void => void execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
const scratch = (): string => mkdtempSync(join(tmpdir(), 'ava-fixture-'));

/** Two 5 s portrait parts: a moving box for motion, a tone from 1.0 to 3.8 s where speech would be. */
export function fixtureSegments(): Buffer[] {
  const dir = scratch();
  return ['0x3a6ea5', '0xa5563a'].map((colour, i) => {
    const out = join(dir, `seg-${i}.mp4`);
    ff([
      '-f', 'lavfi', '-i', `color=c=${colour}:s=720x1280:r=30:d=5,drawbox=x='100+80*t':y=600:w=160:h=160:color=white:t=fill`,
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=5',
      '-af', "volume='if(between(t,1,3.8),1,0)':eval=frame",
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out,
    ]);
    return readFileSync(out);
  });
}

export function fixtureBed(seconds = 14): Buffer {
  const out = join(scratch(), 'bed.m4a');
  ff(['-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=44100:duration=${seconds}`, '-c:a', 'aac', out]);
  return readFileSync(out);
}

export async function fixtureLogo(w: number, h: number, hex: string): Promise<Buffer> {
  const pad = 20;
  return sharp({ create: { width: w + pad * 2, height: h + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: w, height: h, channels: 4, background: hex } }, left: pad, top: pad }])
    .png()
    .toBuffer();
}

export const FIXTURE_COLOURS = { panel: '#0f172a', text: '#ffffff', accent: '#38bdf8', card: '#0f172a', cardText: '#ffffff', cardMuted: '#cbd5e1' };

export async function fixtureOverlay(): Promise<BrandOverlay> {
  return {
    footerText: 'Garve Renault  ·  Pune  ·  97643 79764',
    dealerLogo: await fixtureLogo(300, 120, '#e11d48'),
    brandLogo: await fixtureLogo(160, 160, '#facc15'),
    logoPlacement: { brand: 'left', dealer: 'right' },
    theme: FIXTURE_COLOURS,
    cards: [
      { text: 'Happy Ganesh Chaturthi', part: 1, start: 1, end: 4, partSeconds: 5 },
      { text: 'Book your test drive', sub: 'Offer ends Sunday', part: 2, start: 1, end: 4, partSeconds: 5, position: 'bottom-right' },
    ],
    endCard: { lines: ['Garve Renault', 'Book your test drive today', 'Pune'], seconds: 3 },
    targetShortSide: 720,
    musicBed: fixtureBed(),
    musicLoudness: -20,
    musicDuckDb: -12,
    speed: 1.2,
    findPeople: async () => ({ faces: [{ x0: 0.4, y0: 0.2, x1: 0.62, y1: 0.4 }], bodies: [] }),
  };
}

/** The final ffmpeg arguments composeFinal used, with its temporary folder written as <dir>. */
export async function traceCompose(
  compose: (s: Buffer[], o: BrandOverlay) => Promise<Buffer>,
  overlay: BrandOverlay,
): Promise<string[]> {
  const file = join(scratch(), 'args.json');
  process.env.AVA_POST_TRACE = file;
  try {
    await compose(fixtureSegments(), overlay);
  } finally {
    delete process.env.AVA_POST_TRACE;
  }
  return (JSON.parse(readFileSync(file, 'utf8')) as string[]).map((a) => a.replace(/[^\s"',;=]*ava-post-[A-Za-z0-9]+/g, '<dir>'));
}

/** Mean SSIM of two videos over their common frames. */
export function ssim(a: Buffer, b: Buffer): number {
  const dir = scratch();
  const fa = join(dir, 'a.mp4');
  const fb = join(dir, 'b.mp4');
  writeFileSync(fa, a);
  writeFileSync(fb, b);
  const r = spawnSync('ffmpeg', ['-i', fa, '-i', fb, '-lavfi', '[0:v]fps=30,settb=AVTB[x];[1:v]fps=30,settb=AVTB[y];[x][y]ssim', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /All:([\d.]+)/.exec(r.stderr);
  return m ? Number(m[1]) : 0;
}

/** One frame of a video as a PNG. */
export function frameAt(video: Buffer, seconds: number): Buffer {
  const dir = scratch();
  const src = join(dir, 'v.mp4');
  const out = join(dir, 'f.png');
  writeFileSync(src, video);
  ff(['-ss', seconds.toFixed(3), '-i', src, '-frames:v', '1', out]);
  return readFileSync(out);
}
