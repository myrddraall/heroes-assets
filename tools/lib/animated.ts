import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';
import UPNG from 'upng-js';

/**
 * Re-encodes an animated PNG (the game's animated emotes, as HDP writes them) as a lossless
 * animated WebP, frame for frame with each frame's own delay, looping forever. sharp reads only
 * an APNG's first frame, so upng-js decodes the frames (composited, as a browser would show them).
 */
export async function writeAnimatedWebp(apng: string, out: string): Promise<void> {
  const data = await readFile(apng);
  const image = UPNG.decode(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  const frames = UPNG.toRGBA8(image).map((frame) => Buffer.from(frame));
  const { width, height } = image;
  const delay = image.frames.length
    ? image.frames.map((frame) => Math.max(1, Math.round(frame.delay)))
    : [100];

  await mkdir(dirname(out), { recursive: true });
  await sharp(Buffer.concat(frames), {
    raw: { width, height: height * frames.length, channels: 4, pageHeight: height },
  })
    .webp({ lossless: true, effort: 6, loop: 0, delay })
    .toFile(out);
}
