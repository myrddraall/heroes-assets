import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TEXTURE_FOLDER, texturePatternBatches } from './hdp.ts';

test("textures' patterns: exact paths in the textures folder, spread over the runs, each once", () => {
  assert.deepEqual(texturePatternBatches(['b', 'a', 'c', 'a'], 2), [
    [`${TEXTURE_FOLDER}/a.dds`, `${TEXTURE_FOLDER}/c.dds`],
    [`${TEXTURE_FOLDER}/b.dds`],
  ]);
});

test('no more runs than names; by file name in any folder when asked', () => {
  assert.deepEqual(texturePatternBatches(['x'], 4, true), [['**/assets/textures/x.dds']]);
  assert.deepEqual(texturePatternBatches([], 4), []);
});
