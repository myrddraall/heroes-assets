import { availableParallelism } from 'node:os';
import sharp from 'sharp';

/**
 * WebP encoder effort (0–6). 4 encodes several times faster than 6 for files a few percent
 * bigger; lossless either way.
 */
export const WEBP_EFFORT = 4;

// One encode per core: each picture encodes on one thread, as many at once as there are cores.
sharp.concurrency(1);
const slots = availableParallelism();
let running = 0;
const waiting: (() => void)[] = [];

/** Runs a picture encode when a core is free, so callers can start them all at once. */
export async function encoding<T>(task: () => Promise<T>): Promise<T> {
  if (running >= slots) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}
