import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import type { Decoded } from './dds.ts';
import { readSheetMeta } from './sheet-meta.ts';
import {
  gameFrameSlicing,
  sheetTextures,
  sheetTexturesTaken,
  writeUiSheet,
  type SheetMeta,
} from './ui-sheets.ts';

const solid = (width: number, height: number): Decoded => ({
  width,
  height,
  pixels: Buffer.alloc(width * height * 4, 200),
});

test('a NineSlice is cut at 40% of each side', () => {
  assert.deepEqual(gameFrameSlicing('NineSlice', 66, 66), { cuts: [26.4, 26.4, 26.4, 26.4] });
  assert.deepEqual(gameFrameSlicing('NineSlice', 323, 89), { cuts: [35.6, 129.2, 35.6, 129.2] });
});

test("a Border's parts come from its 4×8 grid, side edges turned", () => {
  const slicing = gameFrameSlicing('Border', 256, 512);
  assert.ok('parts' in slicing);
  assert.deepEqual(slicing.parts.topLeft, { rect: [0, 0, 64, 64] });
  assert.deepEqual(slicing.parts.bottomRight, { rect: [192, 0, 64, 64] });
  assert.deepEqual(slicing.parts.top, { rect: [0, 64, 256, 64] });
  assert.deepEqual(slicing.parts.right, { rect: [0, 192, 256, 64], rotate: 90 });
  assert.deepEqual(slicing.parts.left, { rect: [0, 256, 256, 64], rotate: 90 });
  assert.deepEqual(slicing.parts.centre, { rect: [0, 320, 64, 64] });
  assert.throws(() => gameFrameSlicing('Border', 256, 256));
});

test('a sheet lists the textures of every state', () => {
  assert.deepEqual(
    [
      ...sheetTextures({
        frames: {
          a: { type: 'NineSlice', texture: 'x' },
          b: { type: 'NineSlice', texture: { normal: 'y', hover: 'z' } },
        },
        pictures: { icon: 'w' },
      }),
    ],
    ['x', 'y', 'z', 'w'],
  );
});

test('a sheet keeps its frames, states, options and sets inside the file', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ui-sheet-'));
  try {
    const textures: Record<string, Decoded> = {
      panel: solid(66, 66),
      'button-normal': solid(40, 20),
      'button-hover': solid(40, 20),
      tech: solid(16, 32),
      odd: solid(10, 10),
      gear: solid(24, 24),
    };
    const out = join(folder, 'sheet.webp');
    const problems = await writeUiSheet(
      {
        frames: {
          panel: { type: 'NineSlice', texture: 'panel', edges: 'tile' },
          button: {
            type: 'NineSlice',
            texture: { normal: 'button-normal', hover: 'button-hover' },
          },
          tech: { type: 'Border', texture: 'tech' },
          missing: { type: 'NineSlice', texture: 'not-there' },
          uneven: { type: 'NineSlice', texture: { normal: 'panel', hover: 'odd' } },
        },
        sets: { card: { back: 'panel', front: 'button' }, broken: { back: 'missing' } },
        pictures: { gear: 'gear', lost: 'not-there-either' },
      },
      async (name) => textures[name] ?? null,
      out,
    );
    assert.deepEqual(problems, [
      'missing: not in the game: not-there',
      'uneven: its states differ in size',
      'picture lost: not in the game: not-there-either',
      'set broken: no frame missing',
    ]);

    const file = await readFile(out);
    const meta = readSheetMeta(file) as SheetMeta;
    assert.equal(meta.v, 1);
    assert.deepEqual(Object.keys(meta.frames).sort(), ['button', 'panel', 'tech']);
    assert.equal(meta.frames['panel']!['edges'], 'tile');
    assert.deepEqual(meta.frames['panel']!.cuts, [26.4, 26.4, 26.4, 26.4]);
    assert.deepEqual(Object.keys(meta.frames['button']!.states), ['normal', 'hover']);
    assert.ok(meta.frames['tech']!.parts);
    assert.deepEqual(meta.sets, { card: { back: 'panel', front: 'button' } });
    assert.deepEqual(Object.keys(meta.pictures), ['gear']);
    assert.deepEqual(meta.pictures['gear']!.slice(2), [24, 24]);

    // each state's place holds that state's picture, inside the sheet
    const { width, height } = await sharp(file).metadata();
    for (const frame of Object.values(meta.frames)) {
      for (const [x, y, w, h] of [
        ...Object.values(frame.states),
        ...Object.values(meta.pictures),
      ]) {
        assert.ok(x + w <= width! && y + h <= height!);
      }
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("the textures every sheet takes, once each and sorted, for the extraction's key", async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ui-sheet-sources-'));
  try {
    await writeFile(
      join(folder, 'b.json'),
      JSON.stringify({ pictures: { close: 'tex_close', search: 'tex_search' } }),
    );
    await writeFile(
      join(folder, 'a.json'),
      JSON.stringify({
        frames: {
          panel: { type: 'NineSlice', texture: { normal: 'tex_panel', hover: 'tex_close' } },
        },
      }),
    );
    await writeFile(join(folder, 'notes.txt'), 'not a source');
    assert.deepEqual(sheetTexturesTaken(folder), ['tex_close', 'tex_panel', 'tex_search']);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
