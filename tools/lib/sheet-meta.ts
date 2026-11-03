import { deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * A sheet's metadata kept inside its WebP, so a page reads the picture and what it holds in one
 * request: an `HRSM` chunk (HRS metadata) of deflate-raw JSON, right after the `VP8X` header, so it
 * arrives before the pixels. Readers that don't know the chunk skip it, as the WebP container
 * allows, and decode the picture as usual.
 */
export const SHEET_META_CHUNK = 'HRSM';

const VP8X_ALPHA = 0x10;

interface Chunk {
  readonly id: string;
  readonly data: Buffer;
}

function chunks(webp: Buffer): Chunk[] {
  if (webp.toString('latin1', 0, 4) !== 'RIFF' || webp.toString('latin1', 8, 12) !== 'WEBP') {
    throw new Error('not a WebP file');
  }
  const out: Chunk[] = [];
  for (let at = 12; at + 8 <= webp.length;) {
    const size = webp.readUInt32LE(at + 4);
    out.push({
      id: webp.toString('latin1', at, at + 4),
      data: webp.subarray(at + 8, at + 8 + size),
    });
    at += 8 + size + (size & 1);
  }
  return out;
}

function chunk(id: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(id, 0, 'latin1');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, Buffer.alloc(data.length & 1)]);
}

/** The `VP8X` header a simple (lossless `VP8L` or lossy `VP8`) file needs to carry extra chunks. */
function extendedHeader(image: Chunk): Buffer {
  let width: number;
  let height: number;
  let alpha = false;
  if (image.id === 'VP8L') {
    // after the 0x2f signature: 14 bits width - 1, 14 bits height - 1, 1 bit alpha
    const bits = image.data.readUInt32LE(1);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
    alpha = ((bits >>> 28) & 1) === 1;
  } else if (image.id === 'VP8 ') {
    // the key frame header: 3 bytes of frame tag, 3 of start code, then 14-bit width and height
    width = image.data.readUInt16LE(6) & 0x3fff;
    height = image.data.readUInt16LE(8) & 0x3fff;
  } else {
    throw new Error(`a WebP starting with ${image.id} can't take metadata`);
  }
  const data = Buffer.alloc(10);
  data[0] = alpha ? VP8X_ALPHA : 0;
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  return chunk('VP8X', data);
}

/**
 * The WebP with `meta` (any JSON) inside it, replacing what was there. A simple file becomes the
 * extended format, which is the same picture with a header that allows extra chunks.
 */
export function withSheetMeta(webp: Buffer, meta: unknown): Buffer {
  const list = chunks(webp).filter((c) => c.id !== SHEET_META_CHUNK);
  const own = chunk(SHEET_META_CHUNK, deflateRawSync(JSON.stringify(meta), { level: 9 }));
  const parts =
    list[0]?.id === 'VP8X'
      ? [chunk('VP8X', list[0].data), own, ...list.slice(1).map((c) => chunk(c.id, c.data))]
      : [extendedHeader(list[0]!), own, ...list.map((c) => chunk(c.id, c.data))];
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...parts]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** The metadata `withSheetMeta` put in, or undefined when the file has none. */
export function readSheetMeta(webp: Buffer): unknown {
  const own = chunks(webp).find((c) => c.id === SHEET_META_CHUNK);
  return own ? JSON.parse(inflateRawSync(own.data).toString('utf8')) : undefined;
}
