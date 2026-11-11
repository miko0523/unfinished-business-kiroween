// 实际 lobby.png 上的“实测亮区”：纪念册派生的像素证据来源，开发校准层也用它画证据框。
// 量法（全部为本函数的显式参数，可复核）：
//   亮度 = Rec.709 luma（0.2126R + 0.7152G + 0.0722B）≥ minLuma，且 alpha ≥ minAlpha，
//   四连通成块，面积 ≥ minArea 像素；返回每块的包围盒（像素坐标，含边界）。
export interface PixelSource {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface GlowRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
}

export interface GlowOptions {
  minLuma: number;
  minAlpha: number;
  minArea: number;
}

export const GLOW_DEFAULTS: GlowOptions = { minLuma: 190, minAlpha: 200, minArea: 30 };

export function findGlowRegions(img: PixelSource, opts: Partial<GlowOptions> = {}): GlowRegion[] {
  const { minLuma, minAlpha, minArea } = { ...GLOW_DEFAULTS, ...opts };
  const { width: w, height: h, data } = img;
  const lit = (p: number): boolean => {
    const i = p * 4;
    if (data[i + 3]! < minAlpha) return false;
    return 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]! >= minLuma;
  };
  const seen = new Uint8Array(w * h);
  const out: GlowRegion[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !lit(start)) continue;
    const stack = [start];
    seen[start] = 1;
    const r: GlowRegion = { x0: w, y0: h, x1: 0, y1: 0, area: 0 };
    while (stack.length > 0) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      r.area++;
      if (x < r.x0) r.x0 = x;
      if (x > r.x1) r.x1 = x;
      if (y < r.y0) r.y0 = y;
      if (y > r.y1) r.y1 = y;
      const next = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of next) {
        if (q >= 0 && !seen[q] && lit(q)) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (r.area >= minArea) out.push(r);
  }
  return out.sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
}
