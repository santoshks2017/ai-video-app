/**
 * Stitch clips into one final MP4 with ffmpeg (installed in the Docker image).
 * Used when a video is too long to build as a single continuous Omni Flash
 * extend chain (extend only accepts a source video <= ~10s).
 */

import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function concatClips(clips: Buffer[]): Promise<Buffer> {
  if (clips.length === 0) throw new Error('nothing to concat');
  if (clips.length === 1) return clips[0]!;

  const dir = await mkdtemp(join(tmpdir(), 'ava-concat-'));
  try {
    const files: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const f = join(dir, `part-${i}.mp4`);
      await writeFile(f, clips[i]!);
      files.push(f);
    }
    // Re-encode (clips can differ subtly in codec params) for a clean join.
    const listPath = join(dir, 'list.txt');
    await writeFile(listPath, files.map((f) => `file '${f}'`).join('\n'));
    const out = join(dir, 'final.mp4');
    await run('ffmpeg', [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Grab the last frame of a clip as a JPEG — used as a reference for the next
 *  fresh clip so a hard cut still looks like the same person / car / setting. */
export async function lastFrame(clip: Buffer): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), 'ava-frame-'));
  try {
    const inF = join(dir, 'in.mp4');
    const outF = join(dir, 'out.jpg');
    await writeFile(inF, clip);
    await run('ffmpeg', ['-y', '-sseof', '-0.5', '-i', inF, '-vframes', '1', '-q:v', '3', outF]);
    return await readFile(outF);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1 << 26 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg failed: ${stderr?.slice(-500) || err.message}`));
      else resolve();
    });
  });
}
