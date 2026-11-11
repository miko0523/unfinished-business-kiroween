// 楼层室内可导航区的纯派生函数：输入某层 1x PNG 的像素与该层 Home Anchor 的 safe 矩形，输出 navigable 矩形与证据。
// 没有手填坐标；所有参数都在 SPACE_PARAMS 里。src/house/data/space.ts 是本函数在五张实际 PNG 上的运行结果，
// tests/space-derive.test.ts 每次重新解码 PNG、重跑算法，并要求与数据文件逐项一致。
//
// 量法（坐标系：单张 801 宽 1x 楼层 PNG 左上角为原点，矩形为 [xmin,ymin,xmax,ymax]，含边界）：
//   外框（木框与描边）的像素亮度（Rec.709 luma）≤ outlineMaxLuma，且 alpha ≥ minAlpha。
//   天花板：在 ceilingCols 这几列上，从 ceilingScanFrom 行向下找第一个外框像素，取各列的最大值（行号）。
//   左墙：在 wallRows 的每一行，从 leftScanFrom 向左找第一个外框像素；取各行最大 x。
//   右墙：在同样的行，从 rightScanFrom 向右找第一个外框像素；取各行最小 x。
//   墙面波浪起伏，所以取最保守的直线，再各向室内收 wallMargin / ceilingMargin。
//   地面：该层两个 Home Anchor 的 safe 矩形下沿的较大值（来自 room-layout.json）。
import type { Rect } from '../data/slots';
import type { PixelSource } from './glow';

export const SPACE_PARAMS = {
  outlineMaxLuma: 80,
  minAlpha: 200,
  ceilingCols: [300, 400, 500, 600] as readonly number[],
  ceilingScanFrom: 8,
  ceilingScanTo: 60,
  ceilingMargin: 4,
  wallRowFrom: 40,
  wallRowTo: 150,
  wallRowStep: 2,
  leftScanFrom: 90,
  leftScanTo: 30,
  rightScanFrom: 705,
  rightScanTo: 780,
  wallMargin: 3,
} as const;

export interface SpaceEvidence {
  ceilingHits: number[];
  leftHits: number[];
  rightHits: number[];
}

export interface DerivedSpace {
  navigable: Rect;
  evidence: SpaceEvidence;
}

export function deriveNavigable(img: PixelSource, safeBottom: number): DerivedSpace {
  const P = SPACE_PARAMS;
  const { width: w, data } = img;
  const isOutline = (x: number, y: number): boolean => {
    const i = (y * w + x) * 4;
    if (data[i + 3]! < P.minAlpha) return false;
    return 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]! <= P.outlineMaxLuma;
  };

  const ceilingHits: number[] = [];
  for (const cx of P.ceilingCols) {
    for (let y = P.ceilingScanFrom; y <= P.ceilingScanTo; y++) {
      if (isOutline(cx, y)) {
        ceilingHits.push(y);
        break;
      }
    }
  }
  const leftHits: number[] = [];
  const rightHits: number[] = [];
  for (let y = P.wallRowFrom; y <= P.wallRowTo; y += P.wallRowStep) {
    for (let x = P.leftScanFrom; x >= P.leftScanTo; x--) {
      if (isOutline(x, y)) {
        leftHits.push(x);
        break;
      }
    }
    for (let x = P.rightScanFrom; x <= P.rightScanTo; x++) {
      if (isOutline(x, y)) {
        rightHits.push(x);
        break;
      }
    }
  }
  if (ceilingHits.length === 0 || leftHits.length === 0 || rightHits.length === 0) {
    throw new Error('space: no frame found');
  }
  const navigable: Rect = [
    Math.max(...leftHits) + P.wallMargin,
    Math.max(...ceilingHits) + P.ceilingMargin,
    Math.min(...rightHits) - P.wallMargin,
    safeBottom,
  ];
  return { navigable, evidence: { ceilingHits, leftHits, rightHits } };
}
