// 舞台坐标：把 layoutHouse 的结果换算成“舞台左上角为原点”的盒子，供静态层与开发校准层共用。
// 数据来源：
//   - 左右内边距 STAGE_PAD_X = 4 逻辑像素：design.md「轻微确定性错位」一节（舞台左右各留出 4/801 的内边距）。
//   - 其余数值全部来自 layoutHouse（atlas.json 的尺寸与 topJoin/bottomJoin）与 LOGICAL_WIDTH。
import { LOGICAL_WIDTH } from './data/modules';
import { WIDTH_1X, type ModuleId } from './assets';
import type { HouseLayout } from './layout';

export const STAGE_PAD_X = 4;
export const STAGE_WIDTH = LOGICAL_WIDTH + 2 * STAGE_PAD_X;

/**
 * 旧宅楼层图片的 `sizes`：按旧宅图片的显示宽度选择 1x/2x：min(801 逻辑像素, 视口宽 − 舞台内边距 8 − 页面内边距 16)，用纯 CSS 长度表达。
 * 静态层显示图片与空闲预加载共用这一个值，浏览器才会为同一张楼层选同一个候选文件。
 */
export const FLOOR_IMAGE_SIZES = `min(${WIDTH_1X}px, calc(100vw - ${2 * STAGE_PAD_X + 16}px))`;

export interface StageBox {
  id: ModuleId;
  /** 舞台逻辑像素，原点为舞台左上角。 */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 与 layout.modules 同序（lobby、floor-01…、roof）。roofY 为负，所以减去它让屋顶顶边落在 0。 */
export function stageBoxes(layout: HouseLayout): StageBox[] {
  return layout.modules.map((m) => ({
    id: m.id,
    x: STAGE_PAD_X + m.dx,
    y: m.y - layout.roofY,
    w: m.width,
    h: m.height,
  }));
}

export type PercentBox = {
  left: string;
  top: string;
  width: string;
  height: string;
};

/** 舞台逻辑像素 → 相对舞台的百分比，使盒子随舞台等比缩放。 */
export function percentBox(x: number, y: number, w: number, h: number, stageHeight: number): PercentBox {
  return {
    left: `${(x / STAGE_WIDTH) * 100}%`,
    top: `${(y / stageHeight) * 100}%`,
    width: `${(w / STAGE_WIDTH) * 100}%`,
    height: `${(h / stageHeight) * 100}%`,
  };
}
