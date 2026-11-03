import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';
import type { Decoded } from './dds.ts';
import { encoding, WEBP_EFFORT } from './encode.ts';
import { withSheetMeta } from './sheet-meta.ts';

/** Where a picture sits in its sheet: `[x, y, width, height]` in pixels. */
export type Rect = readonly [number, number, number, number];

/** A picture for a sheet: a file sharp reads, or pixels already decoded (a game texture). */
export type Picture = string | Decoded;

/** Space between pictures, so scaling one never samples its neighbour. */
const GAP = 2;

/** A picture's RGBA pixels (a file's first frame). */
async function rgba(picture: Picture): Promise<Decoded> {
  if (typeof picture !== 'string') return picture;
  const { data, info } = await sharp(picture)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, pixels: data };
}

const contentKey = (image: Decoded): string =>
  createHash('sha1').update(`${image.width}x${image.height}:`).update(image.pixels).digest('hex');

/**
 * Packs pictures into one lossless WebP sheet, in rows: tallest first, each row filled left to
 * right up to a width that keeps the sheet roughly square. Same-size pictures (a hero's icons)
 * come out as a plain grid. An animated picture contributes its first frame. The same pixels are
 * packed once, whether given under several names (units sharing a minimap icon) or as different
 * files that hold the same picture (Leoric's _undead and _var1 icons); every name gets its place.
 * Returns each picture's place by the name it was given. `meta`, when given, makes the sheet's
 * metadata from those places and keeps it inside the file (lib/sheet-meta.ts).
 */
export async function writeSheet(
  pictures: ReadonlyMap<string, Picture>,
  out: string,
  meta?: (rects: Readonly<Record<string, Rect>>) => unknown,
): Promise<Record<string, Rect>> {
  // one entry per distinct content, named by the first name it was given
  const sources = [...new Set(pictures.values())];
  const images = new Map(await Promise.all(sources.map(async (p) => [p, await rgba(p)] as const)));
  const keyOf = new Map(sources.map((p) => [p, contentKey(images.get(p)!)] as const));
  const byContent = new Map<string, { name: string; image: Decoded }>();
  for (const [name, picture] of pictures) {
    const key = keyOf.get(picture)!;
    if (!byContent.has(key)) byContent.set(key, { name, image: images.get(picture)! });
  }
  const entries = [...byContent.values()].map(({ name, image }) => ({
    name,
    image,
    width: image.width,
    height: image.height,
  }));
  // tallest first, then by name, so the same pictures always pack the same way
  entries.sort((a, b) => b.height - a.height || a.name.localeCompare(b.name));
  const area = entries.reduce((sum, e) => sum + (e.width + GAP) * (e.height + GAP), 0);
  const rowWidth = Math.max(Math.ceil(Math.sqrt(area)), ...entries.map((e) => e.width));

  const rects: Record<string, Rect> = {};
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;
  for (const entry of entries) {
    if (x > 0 && x + entry.width > rowWidth) {
      y += rowHeight + GAP;
      x = 0;
      rowHeight = 0;
    }
    rects[entry.name] = [x, y, entry.width, entry.height];
    x += entry.width + GAP;
    rowHeight = Math.max(rowHeight, entry.height);
    width = Math.max(width, x - GAP);
  }
  const height = y + rowHeight;
  const places: Record<string, Rect> = Object.fromEntries(
    [...pictures].map(([name, picture]) => [
      name,
      rects[byContent.get(keyOf.get(picture)!)!.name]!,
    ]),
  );

  await mkdir(dirname(out), { recursive: true });
  const sheet = sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(
      entries.map((entry) => {
        const [left, top] = rects[entry.name]!;
        const { pixels, width: w, height: h } = entry.image;
        return { input: pixels, raw: { width: w, height: h, channels: 4 as const }, left, top };
      }),
    )
    .webp({ lossless: true, effort: WEBP_EFFORT });
  await encoding(async () => {
    if (!meta) return sheet.toFile(out);
    return writeFile(out, withSheetMeta(await sheet.toBuffer(), meta(places)));
  });
  return places;
}

/** A picture's size, read from its file. */
export async function pictureSize(path: string): Promise<{ width: number; height: number }> {
  const { width, height } = await sharp(path).metadata();
  return { width, height };
}

/** Writes a picture scaled to cover a size (cropped evenly if its shape differs) as a WebP. */
export async function writeScaledWebp(
  path: string,
  out: string,
  width: number,
  height: number,
): Promise<void> {
  await mkdir(dirname(out), { recursive: true });
  await encoding(() =>
    sharp(path)
      .resize(width, height, { fit: 'cover', kernel: 'lanczos3' })
      .webp({ lossless: true, effort: WEBP_EFFORT })
      .toFile(out),
  );
}

/** A picture's file name as a WebP: `a.png` → `a.webp`. */
export const webpName = (file: string): string => file.replace(/\.[^.]+$/, '.webp');

/** Writes one picture (a file, or RGBA pixels) as a lossless WebP (its first frame, if animated). */
export async function writeWebp(
  picture: string | { raw: Buffer; width: number; height: number },
  out: string,
): Promise<void> {
  await mkdir(dirname(out), { recursive: true });
  const image =
    typeof picture === 'string'
      ? sharp(picture)
      : sharp(picture.raw, { raw: { width: picture.width, height: picture.height, channels: 4 } });
  await encoding(() => image.webp({ lossless: true, effort: WEBP_EFFORT }).toFile(out));
}
