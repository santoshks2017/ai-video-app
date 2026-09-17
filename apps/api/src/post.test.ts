import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { composeFinal } from '../dist/post.js';
import { hasFfmpeg, fixtureOverlay, traceCompose } from './testlib.ts';

const GOLDEN = new URL('./__golden__/compose-final-args.json', import.meta.url);

test('a composed film is built with exactly the ffmpeg call it was before', { skip: !hasFfmpeg }, async () => {
  const args = await traceCompose(composeFinal, await fixtureOverlay());
  if (process.env.UPDATE_GOLDEN) {
    mkdirSync(new URL('./__golden__/', import.meta.url), { recursive: true });
    writeFileSync(GOLDEN, JSON.stringify(args, null, 1));
  }
  assert.deepEqual(args, JSON.parse(readFileSync(GOLDEN, 'utf8')));
});
