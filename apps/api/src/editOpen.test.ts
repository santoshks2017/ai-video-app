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
  assert.equal(editOpenPlan({ clips: [], layers, cleanStoragePath: 'generations/j/clean.mp4' }), 'ready', 'kept footage opens even without segments');
  assert.equal(editOpenPlan({ clips: [part(1), part(2)], layers }), 'clean');
  assert.equal(editOpenPlan({ clips: [part(1), part(2)] }), 'rebuild');
  assert.equal(editOpenPlan({ clips: [part(1), part(2, false)] }), 'flat', 'a part that failed cannot be joined');
  assert.equal(editOpenPlan({ clips: [] }), 'flat', 'a saved version kept no segments');
});
