// WCAG 对比度：相对亮度与对比度（纯函数）。供自动检查 Ghost 描边、填充与标签与背景的对比度。
export type RGB = readonly [number, number, number];

/** 解析 #rrggbb、#rgb 与 hsl(h, s%, l%)；认不出返回 null。 */
export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) {
    const n = parseInt(m[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [...m[1]!].map((c) => parseInt(c + c, 16)) as unknown as RGB;
  const h = /^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/.exec(s);
  if (h) {
    const hue = Number(h[1]) / 360;
    const sat = Number(h[2]) / 100;
    const lig = Number(h[3]) / 100;
    const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
    const p = 2 * lig - q;
    const ch = (t0: number) => {
      const t = (t0 + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [Math.round(ch(hue + 1 / 3) * 255), Math.round(ch(hue) * 255), Math.round(ch(hue - 1 / 3) * 255)];
  }
  return null;
}

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** WCAG 相对亮度，0（黑）到 1（白）。 */
export function relativeLuminance([r, g, b]: RGB): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** 两个亮度之间的对比度，1 到 21。 */
export function contrastOfLuminance(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

export function contrastRatio(a: RGB, b: RGB): number {
  return contrastOfLuminance(relativeLuminance(a), relativeLuminance(b));
}

/** 不透明度为 alpha 的前景叠在背景上的结果。 */
export function over(fg: RGB, bg: RGB, alpha: number): RGB {
  return [0, 1, 2].map((i) => Math.round(fg[i]! * alpha + bg[i]! * (1 - alpha))) as unknown as RGB;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const v = [...values].sort((x, y) => x - y);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** 给定相对亮度的一个灰色（用背景的中位亮度还原成可比较的颜色）。 */
export function grayOfLuminance(y: number): RGB {
  const c = y <= 0.0031308 ? y * 12.92 : 1.055 * y ** (1 / 2.4) - 0.055;
  const v = Math.round(Math.min(1, Math.max(0, c)) * 255);
  return [v, v, v];
}
