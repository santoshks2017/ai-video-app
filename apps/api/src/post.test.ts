import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { composeClean, composeFinal, lastFrame, videoFacts, type ComposedLayers } from '../dist/post.js';
import { overlayMargins } from '@ava/shared';
import { hasFfmpeg, fixtureOverlay, fixtureSegments, traceCompose } from './testlib.ts';

const GOLDEN = new URL('./__golden__/compose-final-args.json', import.meta.url);

test('a composed film is built with exactly the ffmpeg call it was before', { skip: !hasFfmpeg }, async () => {
  const args = await traceCompose(composeFinal, await fixtureOverlay());
  if (process.env.UPDATE_GOLDEN) {
    mkdirSync(new URL('./__golden__/', import.meta.url), { recursive: true });
    writeFileSync(GOLDEN, JSON.stringify(args, null, 1));
  }
  assert.deepEqual(args, JSON.parse(readFileSync(GOLDEN, 'utf8')));
});

test('a composed film records where it drew every overlay, and is built exactly as before', { skip: !hasFfmpeg }, async () => {
  let L: ComposedLayers | undefined;
  const args = await traceCompose(composeFinal, { ...(await fixtureOverlay()), onLayers: (l) => { L = l; } });
  assert.deepEqual(args, JSON.parse(readFileSync(GOLDEN, 'utf8')), 'recording changes nothing about the film');
  assert.ok(L);
  assert.equal(L!.width, 720);
  assert.equal(L!.height, 1280);
  assert.equal(L!.captions.length, 2);
  const [auto, fixed] = L!.captions;
  assert.equal(fixed!.spot, 'bottom-right');
  assert.equal(fixed!.auto, false);
  assert.equal(fixed!.sub, 'Offer ends Sunday');
  assert.equal(auto!.auto, true);
  const face = { x0: 0.4 * 720, y0: 0.2 * 1280, x1: 0.62 * 720, y1: 0.4 * 1280 };
  const hitsFace = auto!.x < face.x1 && auto!.x + auto!.w > face.x0 && auto!.y < face.y1 && auto!.y + auto!.h > face.y0;
  assert.equal(hitsFace, false, 'the Auto caption keeps clear of the face');
  assert.equal(L!.footer!.y + L!.footer!.h, 1280);
  const { margin } = overlayMargins(720, 1280);
  const brand = L!.logos.find((g) => g.which === 'brand')!;
  const dealer = L!.logos.find((g) => g.which === 'dealer')!;
  assert.equal(brand.x, margin);
  assert.equal(dealer.x + dealer.w, 720 - margin);
  assert.ok(brand.colour.length > 0 && dealer.colour.length > 0);
  assert.equal(dealer.whiteOnEndCard, true, 'a dark end card turns the logos white');
  assert.ok(dealer.white && dealer.white.length > 0);
  assert.deepEqual(L!.endCard, { lines: ['Garve Renault', 'Book your test drive today', 'Pune'], seconds: 3 });
  assert.ok(L!.bodySeconds > 5 && L!.bodySeconds < 9, `got ${L!.bodySeconds}`);
});

test('clean footage is the film with nothing drawn on it, and records the same layers', { skip: !hasFfmpeg }, async () => {
  const overlay = await fixtureOverlay();
  let fromFinal: ComposedLayers | undefined;
  await composeFinal(fixtureSegments(), { ...overlay, onLayers: (l) => { fromFinal = l; } });
  const { bytes, layers } = await composeClean(fixtureSegments(), overlay);
  assert.ok(layers && fromFinal);
  const comparable = (l: ComposedLayers) => ({ ...l, logos: l.logos.map(({ colour, white, ...g }) => ({ ...g, colour: colour.length, white: white?.length })) });
  assert.deepEqual(comparable(layers!), comparable(fromFinal!), 'the same decisions either way');
  const facts = await videoFacts(bytes);
  assert.equal(facts.width, 720);
  assert.equal(facts.height, 1280);
  assert.ok(Math.abs(facts.duration - layers!.bodySeconds) < 0.1, `clean ${facts.duration}s, body ${layers!.bodySeconds}s`);
  const last = await lastFrame(bytes);
  const { data } = await sharp(last!).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
  const distance = Math.abs(data[0]! - 0x0f) + Math.abs(data[1]! - 0x17) + Math.abs(data[2]! - 0x2a);
  assert.ok(distance > 60, 'the last frame is footage, not the end card');
});

test('clean footage can be made without working out any layers', { skip: !hasFfmpeg }, async () => {
  const { bytes, layers } = await composeClean(fixtureSegments(), { speed: 1.2, targetShortSide: 720 }, { plan: false });
  assert.equal(layers, null);
  assert.ok((await videoFacts(bytes)).duration > 5);
});
