import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { readSheetMeta, SHEET_META_CHUNK, withSheetMeta } from './sheet-meta.ts';

const meta = {
  v: 1,
  pictures: { gear: [0, 0, 32, 32] },
  frames: { panel: { rect: [32, 0, 64, 64], cuts: [24, 24, 24, 24] } },
};

function chunkIds(webp: Buffer): string[] {
  const ids: string[] = [];
  for (let at = 12; at + 8 <= webp.length;) {
    const size = webp.readUInt32LE(at + 4);
    ids.push(webp.toString('latin1', at, at + 4));
    at += 8 + size + (size & 1);
  }
  return ids;
}

async function picture(options: { alpha: boolean; lossless: boolean }): Promise<Buffer> {
  return sharp({
    create: {
      width: 70,
      height: 40,
      channels: options.alpha ? 4 : 3,
      background: options.alpha ? { r: 255, g: 0, b: 255, alpha: 0.5 } : { r: 255, g: 0, b: 255 },
    },
  })
    .webp({ lossless: options.lossless })
    .toBuffer();
}

for (const options of [
  { alpha: true, lossless: true },
  { alpha: false, lossless: true },
  { alpha: false, lossless: false },
]) {
  test(`metadata round-trips and the picture still decodes (${JSON.stringify(options)})`, async () => {
    const plain = await picture(options);
    const withMeta = withSheetMeta(plain, meta);

    assert.deepEqual(readSheetMeta(withMeta), meta);
    assert.deepEqual(chunkIds(withMeta).slice(0, 2), ['VP8X', SHEET_META_CHUNK]);
    assert.equal(withMeta.readUInt32LE(4), withMeta.length - 8);

    const decoded = await sharp(withMeta).metadata();
    assert.equal(decoded.width, 70);
    assert.equal(decoded.height, 40);
    assert.equal(decoded.hasAlpha, options.alpha);
  });
}

test('new metadata replaces the old', async () => {
  const twice = withSheetMeta(withSheetMeta(await picture({ alpha: true, lossless: true }), meta), {
    v: 1,
  });
  assert.deepEqual(readSheetMeta(twice), { v: 1 });
  assert.equal(chunkIds(twice).filter((id) => id === SHEET_META_CHUNK).length, 1);
});

test('a file without metadata reads as none', async () => {
  assert.equal(readSheetMeta(await picture({ alpha: true, lossless: true })), undefined);
});
