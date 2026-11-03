// Interface sheets' sources: ui-sheets/<sheet>.json, each a sheet's frames (each naming the game
// texture it comes from, one or one per state, and how the game lays that texture out), its sets,
// which pair a frame behind a page's content with one in front of it, and its single pictures
// (icons) for sprites. Only the textures a source lists are taken from the game.
//
// Node built-ins only: the update workflow's plan and extract jobs load this (through
// lib/extraction.ts and tools/extract.ts) without installing packages. Packing the sheets
// (lib/ui-sheets.ts) is the build's.
import { readdirSync, readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './channels.ts';

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

/**
 * Every game texture the sheets' sources in a folder take, sorted: read as the tools load, for the
 * extraction's key (lib/extraction.ts), so a sheet taking a new texture makes the next build
 * extract again rather than reuse a stored extraction without it.
 */
export function sheetTexturesTaken(folder: string = UI_SHEET_SOURCES): string[] {
  const names = readdirSync(folder).filter((n) => n.endsWith('.json'));
  const sources = names.map(
    (n) => JSON.parse(readFileSync(join(folder, n), 'utf8')) as SheetSource,
  );
  return [...new Set(sources.flatMap((s) => [...sheetTextures(s)]))].sort();
}

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
