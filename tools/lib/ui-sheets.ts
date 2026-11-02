// Interface sheets: frames (9-slices, see HRS's 9-slice directive) cut from the game's own
// interface textures, packed into one WebP per sheet with what each frame is kept inside the file
// (lib/sheet-meta.ts), so a page gets the pictures and how to slice them in one request.
//
// A sheet's source is ui-sheets/<sheet>.json: its frames, each naming the game texture it comes
// from (one, or one per state) and how the game lays that texture out, and its sets, which pair a
// frame behind a page's content with one in front of it, and its single pictures (icons) for
// sprites. Only the textures a source lists are taken from the game.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './channels.ts';
import type { Decoded } from './dds.ts';
import { writeSheet, type Rect } from './sheet.ts';

/** Where the sheets' sources are. */
export const UI_SHEET_SOURCES = join(ROOT, 'ui-sheets');

/** Where an extraction keeps the textures the sheets take (`<name>.dds`), as map-ui/textures. */
export const UI_SHEET_TEXTURES = 'ui-sheets/textures';

/**
 * How the game lays a frame's texture out (a layout's `<TextureType>`). NineSlice: one picture
 * whose corners are each 40% of its width and height, the middle 20% stretching. Border: a 4×8
 * grid of equal squares, the four corners on the first row, then a row each for the top, bottom,
 * right and left edges (the side edges lying down, turned 90° clockwise into place) and the
 * centre in the first square of the sixth row.
 */
export type GameFrameType = 'NineSlice' | 'Border';

/** The parts of a frame, in reading order. */
export const PARTS = [
  'topLeft',
  'top',
  'topRight',
  'left',
  'centre',
  'right',
  'bottomLeft',
  'bottom',
  'bottomRight',
] as const;
export type Part = (typeof PARTS)[number];

/** Where a part sits in its frame's picture, and how far it turns (clockwise) to go in place. */
export interface PartPlace {
  readonly rect: Rect;
  readonly rotate?: 90 | 180 | 270;
}

/** The cuts as [top, right, bottom, left], in pixels of the frame's picture. */
export type Cuts = readonly [number, number, number, number];

/** A frame in a sheet's source. Keys other than `type` and `texture` are how pages draw it (repeat modes, tile length, …) and pass through as they are. */
export interface FrameSource {
  readonly type: GameFrameType;
  /** The game texture, or one per state (`normal` and any of hover, pressed, focus, disabled, selected). */
  readonly texture: string | Readonly<Record<string, string>>;
  readonly [option: string]: unknown;
}

export interface SheetSource {
  readonly frames?: Readonly<Record<string, FrameSource>>;
  /** Named pairs: a frame drawn behind the content, one drawn in front, or both. */
  readonly sets?: Readonly<Record<string, { readonly back?: string; readonly front?: string }>>;
  /** Single pictures (icons) by name, each the game texture it is. */
  readonly pictures?: Readonly<Record<string, string>>;
}

/** A frame as the sheet's metadata gives it: each state's place in the sheet, then its cuts or parts. */
export interface SheetFrame {
  readonly states: Readonly<Record<string, Rect>>;
  readonly cuts?: Cuts;
  readonly parts?: Readonly<Record<Part, PartPlace>>;
  readonly [option: string]: unknown;
}

/** What a sheet keeps inside its file. */
export interface SheetMeta {
  readonly v: 1;
  readonly frames: Readonly<Record<string, SheetFrame>>;
  readonly sets: Readonly<Record<string, { readonly back?: string; readonly front?: string }>>;
  /** Single pictures' places in the sheet, by name. */
  readonly pictures: Readonly<Record<string, Rect>>;
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** A frame's slicing, from how the game lays out a texture of this size. */
export function gameFrameSlicing(
  type: GameFrameType,
  width: number,
  height: number,
): { cuts: Cuts } | { parts: Record<Part, PartPlace> } {
  if (type === 'NineSlice') {
    const x = round(width * 0.4);
    const y = round(height * 0.4);
    return { cuts: [y, x, y, x] };
  }
  const s = width / 4;
  if (height !== s * 8)
    throw new Error(`a Border texture is 4×8 squares; this one is ${width}×${height}`);
  const row = (n: number): Rect => [0, n * s, width, s];
  return {
    parts: {
      topLeft: { rect: [0, 0, s, s] },
      topRight: { rect: [s, 0, s, s] },
      bottomLeft: { rect: [2 * s, 0, s, s] },
      bottomRight: { rect: [3 * s, 0, s, s] },
      top: { rect: row(1) },
      bottom: { rect: row(2) },
      right: { rect: row(3), rotate: 90 },
      left: { rect: row(4), rotate: 90 },
      centre: { rect: [0, 5 * s, s, s] },
    },
  };
}

/** Each state's texture name; a single texture is the `normal` state. */
export function frameTextures(frame: FrameSource): Record<string, string> {
  return typeof frame.texture === 'string' ? { normal: frame.texture } : { ...frame.texture };
}

/** The game textures a sheet takes. */
export function sheetTextures(source: SheetSource): Set<string> {
  return new Set([
    ...Object.values(source.frames ?? {}).flatMap((f) => Object.values(frameTextures(f))),
    ...Object.values(source.pictures ?? {}),
  ]);
}

/** The key a single picture packs under, apart from the frames' `<frame>/<state>`. */
const pictureKey = (name: string) => `picture:${name}`;

/** The sheet sources in a folder, by sheet name. */
export async function readSheetSources(folder: string): Promise<Map<string, SheetSource>> {
  const names = (await readdir(folder)).filter((n) => n.endsWith('.json')).sort();
  return new Map(
    await Promise.all(
      names.map(
        async (n) =>
          [n.replace(/\.json$/, ''), JSON.parse(await readFile(join(folder, n), 'utf8'))] as const,
      ),
    ),
  );
}

/**
 * Packs a sheet's frames and pictures into `out` with its metadata inside. A frame missing a
 * texture, or whose states differ in size (they share one slicing), is left out, as is a picture
 * missing its texture; returns why, one by one.
 */
export async function writeUiSheet(
  source: SheetSource,
  texture: (name: string) => Promise<Decoded | null>,
  out: string,
): Promise<string[]> {
  const problems: string[] = [];
  const pictures = new Map<string, Decoded>();
  const kept: [string, FrameSource, Record<string, string>, Decoded][] = [];
  for (const [id, frame] of Object.entries(source.frames ?? {})) {
    const states = frameTextures(frame);
    const images = await Promise.all(Object.values(states).map(texture));
    const missing = Object.values(states).filter((_, i) => !images[i]);
    if (missing.length) {
      problems.push(`${id}: not in the game: ${missing.join(', ')}`);
      continue;
    }
    const first = images[0]!;
    if (images.some((i) => i!.width !== first.width || i!.height !== first.height)) {
      problems.push(`${id}: its states differ in size`);
      continue;
    }
    if (!states['normal']) {
      problems.push(`${id}: has no normal state`);
      continue;
    }
    Object.keys(states).forEach((state, i) => pictures.set(`${id}/${state}`, images[i]!));
    kept.push([id, frame, states, first]);
  }
  const keptPictures: string[] = [];
  for (const [name, textureName] of Object.entries(source.pictures ?? {})) {
    const image = await texture(textureName);
    if (!image) {
      problems.push(`picture ${name}: not in the game: ${textureName}`);
      continue;
    }
    pictures.set(pictureKey(name), image);
    keptPictures.push(name);
  }
  const sets = Object.fromEntries(
    Object.entries(source.sets ?? {}).filter(([name, set]) => {
      const lost = [set.back, set.front].filter((f) => f && !kept.some(([id]) => id === f));
      if (lost.length) problems.push(`set ${name}: no frame ${lost.join(', ')}`);
      return !lost.length;
    }),
  );
  await writeSheet(pictures, out, (rects): SheetMeta => {
    const frames: Record<string, SheetFrame> = {};
    for (const [id, frame, states, image] of kept) {
      const { type: gameType, texture: _texture, ...options } = frame;
      frames[id] = {
        ...options,
        states: Object.fromEntries(Object.keys(states).map((s) => [s, rects[`${id}/${s}`]!])),
        ...gameFrameSlicing(gameType, image.width, image.height),
      };
    }
    const placed = Object.fromEntries(keptPictures.map((n) => [n, rects[pictureKey(n)]!]));
    return { v: 1, frames, sets, pictures: placed };
  });
  return problems;
}
