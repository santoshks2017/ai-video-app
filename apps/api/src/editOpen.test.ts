import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FilmLayers } from '@ava/shared';
import { editOpenPlan } from '../dist/editOpen.js';

const part = (n: number, done = true) => ({
  partNum: n,
  totalParts: 2,
  seconds: 5,
  start: 0,
  end: 5,
  interactionId: '',
  storagePath: done ? `generations/j/part-${n}.mp4` : '',
  status: (done ? 'done' : 'failed') as 'done' | 'failed',
});
const layers = {} as FilmLayers;

test('a version opens in the editor the way its records allow', () => {
  assert.equal(editOpenPlan({ clips: [], editProject: { version: 2, aspect: '9:16', tracks: [], clips: [] } }), 'edit');
  const music = { storagePath: 'refs/m/music.m4a', loudness: -20, duckDb: -12 };
  const kept = { cleanStoragePath: 'generations/j/clean.mp4' };
  assert.equal(editOpenPlan({ clips: [part(1), part(2)], layers: { ...layers, music }, ...kept }), 'music', 'the music has no key points to start from yet');
  assert.equal(editOpenPlan({ clips: [part(1), part(2)], layers: { ...layers, music: { ...music, speech: [], measured: null } }, ...kept }), 'ready', 'measured once, even when it could not be');
  assert.equal(editOpenPlan({ clips: [], layers: { ...layers, music: { ...music, measured: -14 } }, ...kept }), 'ready', 'no segments to hear the voice on');
  assert.equal(editOpenPlan({ clips: [part(1), part(2)], layers: { ...layers, music: { ...music, duckDb: 0, measured: -14 } }, ...kept }), 'ready', 'music that never dips needs no voice');
  assert.equal(editOpenPlan({ clips: [], layers, cleanStoragePath: 'generations/j/clean.mp4' }), 'ready', 'kept footage opens even without segments');
  assert.equal(editOpenPlan({ clips: [part(1), part(2)], layers }), 'clean');
  assert.equal(editOpenPlan({ clips: [part(1), part(2)] }), 'rebuild');
  assert.equal(editOpenPlan({ clips: [part(1), part(2, false)] }), 'flat', 'a part that failed cannot be joined');
  assert.equal(editOpenPlan({ clips: [] }), 'flat', 'a saved version kept no segments');
});
