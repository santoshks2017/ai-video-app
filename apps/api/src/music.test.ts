import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoMusicGain, dbAt, editProjectFromLayers, gainAt, updateEditClip, type EditSource, type FilmLayers, type GainPoint, type SpeechSpan } from '@ava/shared';
import { composeClean, composeFinal, filmSpeech, gainVolume, measureLoudness, type BrandOverlay, type ComposedLayers } from '../dist/post.js';
import { renderEditProject } from '../dist/editRender.js';
import { FIXTURE_COLOURS, fixtureBed, fixtureSegments, hasFfmpeg } from './testlib.ts';

const ff = (args: string[]): void => void execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
const scratch = (): string => mkdtempSync(join(tmpdir(), 'ava-music-'));

/** Two 6 s parts where the presenter (a 440 Hz tone) speaks twice each, with real pauses between. */
function voicedSegments(): Buffer[] {
  const dir = scratch();
  return ['0x3a6ea5', '0xa5563a'].map((colour, i) => {
    const out = join(dir, `seg-${i}.mp4`);
    ff([
      '-f', 'lavfi', '-i', `color=c=${colour}:s=720x1280:r=30:d=6`,
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=6',
      '-af', "volume='if(between(t,0.4,1.8)+between(t,4,5.4),1,0)':eval=frame",
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out,
    ]);
    return readFileSync(out);
  });
}

/** Music a voice never touches: a 3 kHz tone, so its level can be read under the speech. */
function toneBed(seconds: number): Buffer {
  const out = join(scratch(), 'bed.m4a');
  ff(['-f', 'lavfi', '-i', `sine=frequency=3000:sample_rate=44100:duration=${seconds}`, '-c:a', 'aac', out]);
  return readFileSync(out);
}

/** The level of one frequency band through a film, in dB, 50 ms at a time. */
function bandLevels(media: Buffer, hz: number): number[] {
  const f = join(scratch(), 'media.mp4');
  writeFileSync(f, media);
  const band = `bandpass=f=${hz}:width_type=q:w=4`;
  const r = spawnSync(
    'ffmpeg',
    ['-v', 'info', '-i', f, '-vn', '-af', `${band},${band},aresample=44100,asetnsamples=n=2205:p=0,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level`, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 1 << 26 },
  );
  return [...r.stderr.matchAll(/lavfi\.astats\.Overall\.RMS_level=(\S+)/g)].map((m) => (Number.isFinite(Number(m[1])) ? Number(m[1]) : -120));
}
const levelAt = (levels: number[], t: number): number => {
  const around = levels.slice(Math.max(0, Math.round((t - 0.1) / 0.05)), Math.round((t + 0.1) / 0.05) + 1);
  return around.reduce((a, v) => a + v, 0) / around.length;
};

async function voicedFilm() {
  const segments = voicedSegments();
  const overlay: BrandOverlay = {
    theme: FIXTURE_COLOURS,
    endCard: { lines: ['Garve Renault', 'Book your test drive today'], seconds: 3 },
    targetShortSide: 720,
    musicBed: toneBed(20),
    musicLoudness: -20,
    musicDuckDb: -12,
  };
  const heard: { layers?: ComposedLayers; speech?: SpeechSpan[] } = {};
  const film = await composeFinal(segments, { ...overlay, onLayers: (l) => { heard.layers = l; }, onSpeech: (s) => { heard.speech = s; } });
  const { bytes: clean } = await composeClean(segments, overlay, { plan: false });
  const store = new Map<string, Buffer>([['job:clean', clean], ['refs/m/music.m4a', overlay.musicBed!]]);
  const layers: FilmLayers = {
    ...heard.layers!,
    logos: [],
    music: { storagePath: 'refs/m/music.m4a', loudness: -20, duckDb: -12, speech: heard.speech, measured: await measureLoudness(overlay.musicBed!) },
  };
  const project = editProjectFromLayers({
    aspect: '9:16',
    layers,
    clean: { type: 'video', label: 'Film', url: '', duration: layers.bodySeconds, jobId: 'job', variant: 'clean' },
    music: { type: 'audio', label: 'Music', url: '', duration: 20, storagePath: 'refs/m/music.m4a' },
  });
  const load = async (src: EditSource) =>
    (src.type === 'video' ? store.get(`${src.jobId}:${src.variant}`) : src.storagePath ? store.get(src.storagePath) : undefined) ?? null;
  return { segments, film, project, load, layers, speech: heard.speech! };
}

test('a film reports where its voice is, the same whether it is composed, cleaned or only heard', { skip: !hasFfmpeg }, async () => {
  const segments = fixtureSegments();
  const got: Record<string, SpeechSpan[]> = {};
  await composeFinal(segments, { speed: 1.2, musicBed: fixtureBed(), musicDuckDb: -12, onSpeech: (s) => { got.final = s; } });
  await composeClean(segments, { speed: 1.2, onSpeech: (s) => { got.clean = s; } }, { plan: false });
  got.heard = await filmSpeech(segments, 1.2);
  assert.ok(got.final?.length, 'the film heard its voice');
  assert.deepEqual(got.clean, got.final);
  assert.deepEqual(got.heard, got.final);
  assert.ok(Math.abs(got.final![0]!.from - 1 / 1.2) < 0.1, `the first line starts where the tone does, on the paced timeline: ${got.final![0]!.from}`);
});

test('a volume line plays at the level the preview gives it', { skip: !hasFfmpeg }, async () => {
  // As many points as a line may have: level, a long zigzag, down to -30 dB and held, then up to -6 dB and held.
  const line: GainPoint[] = [{ t: 2, db: 0 }];
  for (let i = 1; i <= 115; i++) line.push({ t: 2 + i * 0.05, db: i % 2 ? -20 : -2 });
  line.push({ t: 8.5, db: -30 }, { t: 9.5, db: -30 }, { t: 10.8, db: -6 });
  assert.equal(line.length, 119);
  const dir = scratch();
  const out = join(dir, 'lined.m4a');
  ff([
    '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100:duration=12',
    '-af', `atrim=start=1,asetpts=N/SR/TB,asetnsamples=n=1024:p=0,volume='${gainVolume(line, 1)}':eval=frame`,
    '-c:a', 'pcm_s16le', join(dir, 'lined.wav'),
  ]);
  ff(['-i', join(dir, 'lined.wav'), '-c:a', 'aac', '-b:a', '256k', out]);
  const levels = bandLevels(readFileSync(out), 1000);
  const tone = 20 * Math.log10(0.125 / Math.SQRT2);
  // Held stretches only: across a ramp, 50 ms of samples average more than one level.
  for (const t of [0.5, 8, 10.5]) {
    const expected = tone + dbAt(line, t + 1);
    assert.ok(Math.abs(levelAt(levels, t) - expected) < 1, `at ${t}s: heard ${levelAt(levels, t).toFixed(2)} dB, the line says ${expected.toFixed(2)}`);
  }
  assert.ok(Math.abs(gainAt(line, 10.25) - (gainAt(line, 10) + gainAt(line, 10.5)) / 2) < 1e-9);
});

test("an untouched layered edit's music dips under the voice and rises in the pauses exactly as the film's did", { skip: !hasFfmpeg }, async () => {
  const { film, project, load, layers, speech } = await voicedFilm();
  assert.ok(speech.length >= 3, `the parts' lines were heard apart: ${JSON.stringify(speech)}`);
  assert.deepEqual(project.clips.find((c) => c.id === 'music')!.gain, autoMusicGain(speech, -12, layers.bodySeconds, true));
  const { bytes } = await renderEditProject(project, load);
  const [a, b] = [bandLevels(film, 3000), bandLevels(bytes, 3000)];
  const times: Array<[string, number]> = [];
  speech.forEach((s, i) => {
    times.push([`line ${i + 1}`, (s.from + s.to) / 2]);
    const next = speech[i + 1];
    if (next && next.from - s.to > 2) times.push([`the pause after line ${i + 1}`, (s.to + 0.8 + next.from - 0.3) / 2]);
  });
  times.push(['the end card', layers.bodySeconds + 1.2]);
  for (const [what, t] of times) {
    const [x, y] = [levelAt(a, t), levelAt(b, t)];
    console.log(`music at ${what} (${t.toFixed(2)}s): film ${x.toFixed(1)} dB, edit ${y.toFixed(1)} dB`);
    assert.ok(Math.abs(x - y) < 1, `${what} at ${t.toFixed(2)}s: the film's music ${x.toFixed(2)} dB, the edit's ${y.toFixed(2)} dB`);
  }
  const pause = times.find(([w]) => w.startsWith('the pause'))!;
  assert.ok(levelAt(a, pause[1]) - levelAt(a, (speech[0]!.from + speech[0]!.to) / 2) > 10, 'and the film really does dip its music under the voice');
});

test('a key point dragged up brings the music up under that line, and nowhere else', { skip: !hasFfmpeg }, async () => {
  const { project, load, speech } = await voicedFilm();
  const music = project.clips.find((c) => c.id === 'music')!;
  const first = speech[0]!;
  const raised = music.gain!.map((p) => (p.t >= first.from - 0.001 && p.t <= first.to + 0.001 ? { ...p, db: 0 } : p));
  const { bytes } = await renderEditProject(updateEditClip(project, 'music', { gain: raised }), load);
  const { bytes: untouched } = await renderEditProject(project, load);
  const [lifted, before] = [bandLevels(bytes, 3000), bandLevels(untouched, 3000)];
  const mid = (s: SpeechSpan) => (s.from + s.to) / 2;
  assert.ok(levelAt(lifted, mid(first)) - levelAt(before, mid(first)) > 10, 'up 12 dB under the first line');
  assert.ok(Math.abs(levelAt(lifted, mid(speech[1]!)) - levelAt(before, mid(speech[1]!))) < 1, 'and still down under the next');
});

test("a track's own loudness is measured", { skip: !hasFfmpeg }, async () => {
  const lufs = await measureLoudness(fixtureBed(6));
  assert.ok(lufs !== null && lufs > -24 && lufs < -19, `a -21 dBFS tone measured ${lufs} LUFS`);
  assert.equal(await measureLoudness(Buffer.from('not a sound')), null);
});
