import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { cardPng } from '../dist/post.js';
import { drawLayer, scaleLogo } from '../dist/layerDraw.js';
import { FIXTURE_COLOURS } from './testlib.ts';

const look = { colours: FIXTURE_COLOURS, width: 720, height: 1280, captionHeadSize: 42 };

test('a layer is drawn exactly as the film drew it, and drawn larger rather than stretched', async () => {
  const film = await cardPng('Happy Ganesh Chaturthi', 'Pune', 720, 1280, FIXTURE_COLOURS, 42);
  const same = await drawLayer({ kind: 'caption', text: 'Happy Ganesh Chaturthi', sub: 'Pune' }, look, 1);
  assert.ok(film.equals(same), 'at size 1 it is the very same image');
  const one = await sharp(film).metadata();
  const big = await sharp(await drawLayer({ kind: 'caption', text: 'Happy Ganesh Chaturthi', sub: 'Pune' }, look, 1.5)).metadata();
  assert.ok(Math.abs(big.width! - one.width! * 1.5) <= 8, `width ${big.width} vs ${one.width! * 1.5}`);
  assert.ok(Math.abs(big.height! - one.height! * 1.5) <= 8, `height ${big.height} vs ${one.height! * 1.5}`);
  const footer = await sharp(await drawLayer({ kind: 'footer', text: 'Garve Renault  ·  Pune' }, look)).metadata();
  assert.equal(footer.width, 720);
  assert.ok(footer.height! <= Math.round(1280 * 0.085));
  const card = await sharp(await drawLayer({ kind: 'endcard', lines: ['Garve Renault'] }, look)).metadata();
  assert.deepEqual([card.width, card.height], [720, 1280]);
  const logo = await sharp({ create: { width: 100, height: 40, channels: 4, background: '#e11d48' } }).png().toBuffer();
  const scaled = await sharp(await scaleLogo(logo, 1.5)).metadata();
  assert.deepEqual([scaled.width, scaled.height], [150, 60]);
});
