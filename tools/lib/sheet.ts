import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';

/** Where a picture sits in its sheet: `[x, y, width, height]` in pixels. */
export type Rect = readonly [number, number, number, number];

/**
 * Packs pictures into one PNG sheet, on a grid of cells as big as the biggest picture, each in
 * the top-left corner of its cell. An animated picture contributes its first frame.
 * Returns each picture's place by the name it was given.
 */
export async function writeSheet(
  pictures: ReadonlyMap<string, string>,
  out: string,
): Promise<Record<string, Rect>> {
  const entries = await Promise.all(
    [...pictures].map(async ([name, path]) => {
      const { width, height } = await sharp(path).metadata();
      return { name, path, width, height };
    }),
  );
  const cellWidth = Math.max(...entries.map((e) => e.width));
  const cellHeight = Math.max(...entries.map((e) => e.height));
  const columns = Math.ceil(Math.sqrt(entries.length));
  const rows = Math.ceil(entries.length / columns);

  const rects: Record<string, Rect> = {};
  const layers = entries.map((entry, i) => {
    const left = (i % columns) * cellWidth;
    const top = Math.floor(i / columns) * cellHeight;
    rects[entry.name] = [left, top, entry.width, entry.height];
    return { input: entry.path, left, top };
  });

  await mkdir(dirname(out), { recursive: true });
  await sharp({
    create: {
      width: columns * cellWidth,
      height: rows * cellHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(out);
  return rects;
}
