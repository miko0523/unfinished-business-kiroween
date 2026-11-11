// Minimal PNG reader for Playwright screenshots (8-bit RGB or RGBA, non-interlaced), used to measure real pixels.
import { inflateSync } from 'node:zlib';

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Uint8ClampedArray;
}

export function decodePngBuffer(buf: Buffer): Pixels {
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0 || (body[9] !== 2 && body[9] !== 6)) throw new Error('png: only 8-bit RGB/RGBA non-interlaced');
      channels = body[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(body);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const plain = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]!;
      const a = i >= channels ? plain[y * stride + i - channels]! : 0;
      const b = y > 0 ? plain[(y - 1) * stride + i]! : 0;
      const c = i >= channels && y > 0 ? plain[(y - 1) * stride + i - channels]! : 0;
      let v: number;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      plain[y * stride + i] = v & 255;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    data[p * 4] = plain[p * channels]!;
    data[p * 4 + 1] = plain[p * channels + 1]!;
    data[p * 4 + 2] = plain[p * channels + 2]!;
    data[p * 4 + 3] = channels === 4 ? plain[p * channels + 3]! : 255;
  }
  return { width, height, data };
}

export const pixelAt = (img: Pixels, x: number, y: number): [number, number, number] => {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
};

export const luma = ([r, g, b]: readonly [number, number, number]): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Mean luma over a small block centred on (x, y). A single pixel on the page's striped paper texture depends on the
 * y-phase of the 4px stripe period, so comparisons across layout shifts use a block at least two periods tall.
 */
export const blockLuma = (img: Pixels, x: number, y: number, halfWidth = 4, halfHeight = 4): number => {
  let sum = 0;
  let n = 0;
  for (let dy = -halfHeight; dy < halfHeight; dy++) {
    for (let dx = -halfWidth; dx <= halfWidth; dx++) {
      sum += luma(pixelAt(img, x + dx, y + dy));
      n++;
    }
  }
  return sum / n;
};
