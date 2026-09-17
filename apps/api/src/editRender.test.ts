import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { editProjectFromLayers, editSetEndCardSeconds, updateEditClip, type EditSource, type FilmLayers } from '@ava/shared';
import { composeClean, composeFinal, videoFacts, type ComposedLayers } from '../dist/post.js';
import { renderEditProject } from '../dist/editRender.js';
import { hasFfmpeg, fixtureOverlay, fixtureSegments, frameAt, ssim } from './testlib.ts';

async function layeredFixture() {
  const overlay = await fixtureOverlay();
  const segments = fixtureSegments();
  const captured: { layers?: ComposedLayers } = {};
  const final = await composeFinal(segments, { ...overlay, onLayers: (l) => { captured.layers = l; } });
  const { bytes: clean } = await composeClean(segments, overlay, { plan: false });
  const store = new Map<string, Buffer>([['job:clean', clean], ['refs/m/music.m4a', overlay.musicBed!]]);
  const logos = captured.layers!.logos.map((g) => {
    store.set(`refs/${g.which}/colour.png`, g.colour);
    if (g.white) store.set(`refs/${g.which}/white.png`, g.white);
    return { which: g.which, x: g.x, y: g.y, w: g.w, h: g.h, colourPath: `refs/${g.which}/colour.png`, ...(g.white ? { whitePath: `refs/${g.which}/white.png` } : {}), whiteOnEndCard: g.whiteOnEndCard };
  });
  const layers: FilmLayers = { ...captured.layers!, logos, music: { storagePath: 'refs/m/music.m4a', loudness: -20, duckDb: -12 } };
  const project = editProjectFromLayers({
    aspect: '9:16',
    layers,
    clean: { type: 'video', label: 'Film', url: '', duration: layers.bodySeconds, jobId: 'job', variant: 'clean' },
    music: { type: 'audio', label: 'Music', url: '', duration: 14, storagePath: 'refs/m/music.m4a' },
  });
  const load = async (src: EditSource) =>
    (src.type === 'video' ? store.get(`${src.jobId}:${src.variant}`) : src.storagePath ? store.get(src.storagePath) : undefined) ?? null;
  return { final, project, load, layers };
}

const colourAt = async (png: Buffer, x: number, y: number): Promise<number[]> => {
  const { data } = await sharp(png).extract({ left: x, top: y, width: 6, height: 6 }).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
  return [data[0]!, data[1]!, data[2]!];
};
const PANEL = [0x0f, 0x17, 0x2a];
const distance = (c: number[], d: number[]) => c.reduce((a, v, i) => a + Math.abs(v - d[i]!), 0);

test('an untouched layered edit looks like the film it came from', { skip: !hasFfmpeg }, async () => {
  const { final, project, load } = await layeredFixture();
  const { bytes } = await renderEditProject(project, load);
  const [a, b] = [await videoFacts(final), await videoFacts(bytes)];
  assert.ok(Math.abs(a.duration - b.duration) < 0.15, `${a.duration}s vs ${b.duration}s`);
  const score = ssim(final, bytes);
  console.log(`SSIM untouched edit vs film: ${score}`);
  assert.ok(score >= 0.97, `SSIM ${score}`);
});

test('a caption dragged somewhere else is drawn there, and no longer where it was', { skip: !hasFfmpeg }, async () => {
  const { project, load, layers } = await layeredFixture();
  const cap = layers.captions[0]!;
  const moved = updateEditClip(project, cap.id, { place: { x: 0.05, y: 0.05, scale: 1 } });
  const { bytes } = await renderEditProject(moved, load);
  const frame = frameAt(bytes, (cap.from + cap.to) / 2);
  const nx = Math.round(0.05 * 720);
  const ny = Math.round(0.05 * 1280);
  assert.ok(distance(await colourAt(frame, nx + 10, ny + Math.round(cap.h / 2) - 3), PANEL) < 60, 'the panel is at its new place');
  assert.ok(distance(await colourAt(frame, cap.x + 10, cap.y + Math.round(cap.h / 2) - 3), PANEL) > 100, 'and gone from the old one');
});

test('a longer end card makes a longer film, and the music fades out at its new end', { skip: !hasFfmpeg }, async () => {
  const { project, load, layers } = await layeredFixture();
  const trace = join(mkdtempSync(join(tmpdir(), 'ava-trace-')), 'args.json');
  process.env.AVA_EDIT_TRACE = trace;
  let seconds = 0;
  try {
    seconds = (await renderEditProject(editSetEndCardSeconds(project, 'endcard', 5), load)).seconds;
  } finally {
    delete process.env.AVA_EDIT_TRACE;
  }
  assert.ok(Math.abs(seconds - (layers.bodySeconds + 5)) < 0.1, `${seconds}s`);
  const args = JSON.parse(readFileSync(trace, 'utf8')) as string[];
  const graph = args[args.indexOf('-filter_complex') + 1]!;
  assert.ok(graph.includes(`afade=t=out:st=${(seconds - 1.5).toFixed(3)}:d=1.5`), 'the music fades out over the last second and a half');
});
