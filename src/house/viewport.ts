// 视口布局（纯函数）：旧宅宽度、手机“全景”的缩放，以及聚焦楼层时需要的滚动量。
// 旧宅的宽度只取决于视口宽度与镜头，不取决于是否选中了谁、是否打开了抽屉。
import type { Camera } from '../store/uiStore';
import { layoutHouse } from './layout';
import { STAGE_WIDTH } from './stage';

export const WIDE_MIN = 900;
/** 舞台两侧夜景的最大宽度。 */
export const STAGE_MAX_W = 1280;
/** 旧宅图的最大显示宽度（舞台宽度再减去两侧各 4 的内边距）。 */
export const HOUSE_MAX_W = 801;
export const PAD_NARROW = 8;
export const DRAWER_MAX_W = 760;
/** 全景时给顶栏、创建表单与按钮留出的高度。 */
export const PAN_RESERVE_H = 150;
export const PAN_MIN_W = 160;

export interface ViewInput {
  vw: number;
  vh: number;
  grownFloors: number;
  camera: Camera;
}

export interface ViewLayout {
  wide: boolean;
  /** 是否处于全景（只有窄屏才有）。 */
  panorama: boolean;
  /** 舞台（`.house` 元素）的 CSS 宽度。 */
  stageW: number;
  /** 旧宅图的宽度 = 舞台宽度 × 801 / 809，永远不超过 801。 */
  houseW: number;
  /** 旧宅图的缩放比例 s = houseW / 801。 */
  scale: number;
  /** 全景时的舞台宽度；不在全景时等于 stageW。 */
  panW: number;
  /** 非 null 时舞台用这个像素宽度；null 表示沿用 CSS（占满可用宽度，最大 809）。 */
  widthPx: number | null;
}

export function computeViewLayout(i: ViewInput): ViewLayout {
  const wide = i.vw >= WIDE_MIN;
  const stageW = Math.max(0, Math.min(STAGE_WIDTH, i.vw - 2 * PAD_NARROW));
  const { stageHeight } = layoutHouse(Math.min(6, Math.max(2, i.grownFloors)));
  const fit = Math.floor(((i.vh - PAN_RESERVE_H) * STAGE_WIDTH) / stageHeight);
  const panW = Math.min(stageW, Math.max(PAN_MIN_W, fit));
  const panorama = !wide && i.camera === 'panorama';
  const shown = panorama ? panW : stageW;
  const houseW = (shown * HOUSE_MAX_W) / STAGE_WIDTH;
  return { wide, panorama, stageW, houseW, scale: houseW / HOUSE_MAX_W, panW, widthPx: panorama ? panW : null };
}

/** 聚焦楼层：它的整层已经在视口里就不动，否则把它滚到视口中部。返回需要滚动的像素（正数向下）。 */
export function focusScrollDelta(floorTop: number, floorBottom: number, vh: number, margin = 8): number {
  const height = floorBottom - floorTop;
  if (floorTop >= margin && floorBottom <= vh - margin) return 0;
  const target = (vh - height) / 2;
  return Math.round(floorTop - target);
}
