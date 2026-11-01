/**
 * Decodes the DDS textures the game's interface uses (DXT1, DXT5, and uncompressed RGB(A) or
 * luminance(+alpha) with bit masks) to RGBA pixels, top mip level only. The heroes-capture catalogue of the game's
 * 12,000 interface textures holds no other kind.
 */
export interface Decoded {
  readonly width: number;
  readonly height: number;
  /** RGBA, 8 bits each, rows top to bottom. */
  readonly pixels: Buffer;
}

const DDPF_ALPHAPIXELS = 0x1;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;
const DDPF_LUMINANCE = 0x20000;

export function decodeDds(data: Buffer): Decoded {
  if (data.toString('ascii', 0, 4) !== 'DDS ') throw new Error('Not a DDS file');
  const height = data.readUInt32LE(12);
  const width = data.readUInt32LE(16);
  const flags = data.readUInt32LE(80);
  const fourCC = data.toString('ascii', 84, 88);
  const body = data.subarray(128);
  if (flags & DDPF_FOURCC) {
    if (fourCC === 'DXT1') return { width, height, pixels: decodeBlocks(body, width, height, 8) };
    if (fourCC === 'DXT5') return { width, height, pixels: decodeBlocks(body, width, height, 16) };
    throw new Error(`Unsupported DDS compression ${fourCC}`);
  }
  if (flags & (DDPF_RGB | DDPF_LUMINANCE)) {
    const bits = data.readUInt32LE(88);
    const masks = [92, 96, 100, 104].map((at) => data.readUInt32LE(at));
    // luminance (grey) keeps its one mask in the red mask's place
    if (flags & DDPF_LUMINANCE) masks[1] = masks[2] = masks[0]!;
    if (!(flags & DDPF_ALPHAPIXELS)) masks[3] = 0;
    return { width, height, pixels: decodeMasked(body, width, height, bits, masks) };
  }
  throw new Error(`Unsupported DDS pixel format (flags ${flags.toString(16)})`);
}

/** A colour channel out of a packed pixel, scaled to 0–255. */
function channel(value: number, mask: number): number {
  if (!mask) return 255;
  const low = 31 - Math.clz32(mask & -mask); // the mask's lowest set bit
  const max = mask >>> low;
  return Math.round((((value & mask) >>> low) * 255) / max);
}

function decodeMasked(
  body: Buffer,
  width: number,
  height: number,
  bits: number,
  [r, g, b, a]: number[],
): Buffer {
  const bytes = bits / 8;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let value = 0;
    for (let k = 0; k < bytes; k++) value |= body[i * bytes + k]! << (8 * k);
    value >>>= 0;
    out[i * 4] = channel(value, r!);
    out[i * 4 + 1] = channel(value, g!);
    out[i * 4 + 2] = channel(value, b!);
    out[i * 4 + 3] = channel(value, a!);
  }
  return out;
}

const rgb565 = (c: number): [number, number, number] => [
  Math.round((((c >> 11) & 31) * 255) / 31),
  Math.round((((c >> 5) & 63) * 255) / 63),
  Math.round(((c & 31) * 255) / 31),
];

/** DXT1 (8-byte blocks) or DXT5 (16-byte blocks: an alpha block, then a DXT1-style colour block). */
function decodeBlocks(body: Buffer, width: number, height: number, blockSize: 8 | 16): Buffer {
  const out = Buffer.alloc(width * height * 4);
  const blocksWide = Math.max(1, Math.ceil(width / 4));
  const blocksHigh = Math.max(1, Math.ceil(height / 4));
  for (let by = 0; by < blocksHigh; by++) {
    for (let bx = 0; bx < blocksWide; bx++) {
      const at = (by * blocksWide + bx) * blockSize;
      const alphas = blockSize === 16 ? alphaBlock(body, at) : null;
      const colourAt = blockSize === 16 ? at + 8 : at;
      const c0 = body.readUInt16LE(colourAt);
      const c1 = body.readUInt16LE(colourAt + 2);
      const p0 = rgb565(c0);
      const p1 = rgb565(c1);
      // DXT1 with c0 <= c1 has three colours and transparent black; DXT5 always has four colours
      const four = blockSize === 16 || c0 > c1;
      const palette: [number, number, number, number][] = [
        [...p0, 255],
        [...p1, 255],
        four ? [...mix(p0, p1, 2, 1), 255] : [...mix(p0, p1, 1, 1), 255],
        four ? [...mix(p0, p1, 1, 2), 255] : [0, 0, 0, 0],
      ];
      const indices = body.readUInt32LE(colourAt + 4);
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;
          const n = py * 4 + px;
          const colour = palette[(indices >>> (2 * n)) & 3]!;
          const o = (y * width + x) * 4;
          out[o] = colour[0];
          out[o + 1] = colour[1];
          out[o + 2] = colour[2];
          out[o + 3] = alphas ? alphas[n]! : colour[3];
        }
      }
    }
  }
  return out;
}

function mix(
  a: [number, number, number],
  b: [number, number, number],
  wa: number,
  wb: number,
): [number, number, number] {
  return [0, 1, 2].map((i) => Math.round((a[i]! * wa + b[i]! * wb) / (wa + wb))) as [
    number,
    number,
    number,
  ];
}

/** A DXT5 block's 16 alpha values. */
function alphaBlock(body: Buffer, at: number): number[] {
  const a0 = body[at]!;
  const a1 = body[at + 1]!;
  const levels =
    a0 > a1
      ? [a0, a1, ...[1, 2, 3, 4, 5, 6].map((i) => Math.round(((7 - i) * a0 + i * a1) / 7))]
      : [a0, a1, ...[1, 2, 3, 4].map((i) => Math.round(((5 - i) * a0 + i * a1) / 5)), 0, 255];
  // 48 bits of 3-bit indices, little-endian
  let bits = 0n;
  for (let k = 0; k < 6; k++) bits |= BigInt(body[at + 2 + k]!) << BigInt(8 * k);
  return Array.from({ length: 16 }, (_, n) => levels[Number((bits >> BigInt(3 * n)) & 7n)]!);
}
