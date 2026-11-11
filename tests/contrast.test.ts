import { describe, expect, it } from 'vitest';
import { contrastRatio, grayOfLuminance, median, over, parseColor, relativeLuminance } from '../src/house/contrast';
import { BASE_FILL, STROKE, STROKE_WIDTH } from '../src/house/paint';

describe('WCAG 对比度', () => {
  it('黑白是 21:1，同色是 1:1', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([120, 130, 140], [120, 130, 140])).toBe(1);
  });

  it('解析 #rrggbb、#rgb 与 hsl，认不出的返回 null', () => {
    expect(parseColor('#BCD7B4')).toEqual([188, 215, 180]);
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('hsl(106, 30%, 77.5%)')).toEqual(parseColor('#BCD7B4'));
    expect(parseColor('banana')).toBeNull();
  });

  it('相对亮度、叠色、中位数、灰色还原', () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(over([255, 255, 255], [0, 0, 0], 0.5)).toEqual([128, 128, 128]);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(relativeLuminance(grayOfLuminance(0.3))).toBeCloseTo(0.3, 2);
  });

  it('金色轮廓是暖金深色：不是近黑，比其他描边柔和，线宽更细', () => {
    const [r, g, b] = parseColor(STROKE.gold)!;
    expect(r).toBeGreaterThan(100);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(relativeLuminance([r, g, b])).toBeGreaterThan(0.09);
    expect(STROKE_WIDTH.gold).toBeLessThan(STROKE_WIDTH.default);
  });

  it('每种描边对自己的填充不低于 3:1', () => {
    const pairs = [['gray', BASE_FILL.gray], ['white', BASE_FILL.white], ['green', BASE_FILL.green], ['gold', BASE_FILL.gold]] as const;
    for (const [k, fill] of pairs) expect(contrastRatio(parseColor(STROKE[k])!, parseColor(fill)!)).toBeGreaterThanOrEqual(3);
  });
});
