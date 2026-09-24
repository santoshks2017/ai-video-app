/**
 * The engine API's own rules: how a film of a given length is cut into parts a
 * model will draw, and what a reference may be.
 * Run: npm test --workspace @ava/api
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRef, splitSeconds, EngineError } from '../dist/engine.js';

test('a film longer than the model draws is made in even parts', () => {
  // Whole, when it fits.
  assert.deepEqual(splitSeconds(8, 4, 8), [8]);
  assert.deepEqual(splitSeconds(5, 4, 8), [5]);
  // Otherwise in parts no longer than the model takes, as even as they divide.
  assert.deepEqual(splitSeconds(16, 4, 8), [8, 8]);
  assert.deepEqual(splitSeconds(30, 4, 8), [8, 8, 7, 7]);
  assert.deepEqual(splitSeconds(20, 4, 8), [7, 7, 6]);
  assert.equal(splitSeconds(30, 4, 8).reduce((a, b) => a + b, 0), 30, 'the parts add up to what was asked for');
  // Never a part too short for the model to take.
  assert.ok(splitSeconds(9, 8, 8).every((p) => p >= 8), 'fewer, longer parts instead of a stub');
  // Past the ceiling it is cut back to the longest a film may run; under the floor, to the shortest.
  assert.equal(splitSeconds(120, 4, 8).reduce((a, b) => a + b, 0), 30);
  assert.deepEqual(splitSeconds(0, 4, 8), [4]);
});

test('a reference is inline bytes or an https link, and never the inside of our own network', async () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const inline = await loadRef({ data: `data:image/png;base64,${png.toString('base64')}`, label: 'a car' }, 0);
  assert.equal(inline.mimeType, 'image/png');
  assert.equal(inline.kind, 'image');
  assert.equal(inline.label, 'a car');
  assert.ok(inline.bytes.equals(png));

  const clip = await loadRef({ data: `data:video/mp4;base64,${Buffer.from('x').toString('base64')}` }, 1);
  assert.equal(clip.kind, 'video');
  assert.equal(clip.label, 'reference 2', 'an unnamed reference is numbered');

  const refused = async (ref: unknown, code: string) => {
    await assert.rejects(
      () => loadRef(ref as never, 0),
      (e: EngineError) => e.code === code,
      `${JSON.stringify(ref)} should be refused as ${code}`,
    );
  };
  await refused({ url: 'https://127.0.0.1/secret.png' }, 'bad-reference');
  await refused({ url: 'https://169.254.169.254/computeMetadata/v1/' }, 'bad-reference');
  await refused({ url: 'https://metadata.google.internal/x.png' }, 'bad-reference');
  await refused({ url: 'https://10.1.2.3/x.png' }, 'bad-reference');
  await refused({ url: 'http://example.com/x.png' }, 'bad-reference');
  await refused({ url: 'not a url' }, 'bad-reference');
  await refused({}, 'bad-reference');
  await refused({ data: 'data:image/png;base64,' }, 'bad-reference');
});
