// 进度外观：Ghost 的进度只由它自己的颜色、光晕与缩放表达。纯函数。
import type { GhostState } from '../domain/types';

export interface Paint {
  fill: string;
  stroke: string;
  /** 轮廓线宽（viewBox 单位）：金色柔和一些，所以细一点。 */
  strokeWidth: number;
  opacity: number;
  /** 整体缩放，0.90–1.00。 */
  scale: number;
  /** 填充的 HSL 饱和度百分比（仅用于单调性比较；灰/白/金取各自固定值）。 */
  saturation: number;
  glowOpacity: number;
  glowColor: string;
  /** 细金边：仅 Pending_Confirmation。 */
  goldRing: boolean;
  /** 小金牌：仅 Pending_Confirmation。 */
  medal: boolean;
}

/**
 * 描边：深色、带各自色相。旧宅五层墙面的中位亮度约 0.23–0.39（中间调），柔和的浅色填充无论如何都拉不开 3:1，
 * 所以轮廓由深色描边承担：描边相对每层背景与自身填充都不低于 3:1（e2e/contrast.spec.ts 在浏览器里逐层测量）。
 */
export const STROKE = {
  gray: '#2F3844',
  white: '#3E3527',
  green: '#263C2C',
  // 金色：暖金深色，比其他三色柔和（视觉负责人 2026-11-08 批准），所以对中间调墙面达不到 3:1，见 design.md「描边」一段。
  gold: '#7A5A1C',
} as const;

export const STROKE_WIDTH = { default: 3, gold: 2.2 } as const;

const clamp01 = (r: number) => (Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0);

/** 四态基准色（视觉概念稿）：Gray #B8C1CB、White #F6F1E4、Green #BCD7B4、Gold #F2D27E。 */
export const BASE_FILL = { gray: '#B8C1CB', white: '#F6F1E4', green: '#BCD7B4', gold: '#F2D27E' } as const;

export function ghostPaint(state: GhostState, ratio: number, pending: boolean): Paint {
  switch (state) {
    case 'gray':
      return {
        fill: BASE_FILL.gray, stroke: STROKE.gray, strokeWidth: STROKE_WIDTH.default, opacity: 0.85, scale: 0.9, saturation: 0,
        glowOpacity: 0, glowColor: '#FFFFFF', goldRing: false, medal: false,
      };
    case 'white':
      return {
        fill: BASE_FILL.white, stroke: STROKE.white, strokeWidth: STROKE_WIDTH.default, opacity: 1, scale: 0.93, saturation: 0,
        glowOpacity: 0.4, glowColor: '#FFF1CC', goldRing: false, medal: false,
      };
    case 'green': {
      // ratio=0 正好是基准色 #BCD7B4（hsl 106°, 30%, 77.5%）；越接近完成越饱和、光晕越强。
      // Pending 与 ratio=1 的 Green 相同，另加金边与金牌。
      const r = pending ? 1 : clamp01(ratio);
      const saturation = 30 + 26 * r;
      return {
        fill: `hsl(106, ${saturation}%, ${77.5 - 2.5 * r}%)`, stroke: STROKE.green, strokeWidth: STROKE_WIDTH.default, opacity: 1, scale: 0.97, saturation,
        glowOpacity: 0.28 + 0.5 * r, glowColor: '#8EE3A1', goldRing: pending, medal: pending,
      };
    }
    case 'gold':
      return {
        fill: BASE_FILL.gold, stroke: STROKE.gold, strokeWidth: STROKE_WIDTH.gold, opacity: 1, scale: 1, saturation: 90,
        glowOpacity: 0.85, glowColor: '#FFD86B', goldRing: false, medal: false,
      };
  }
}
