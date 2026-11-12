// 视口布局（纯函数）：旧宅宽度、手机“全景”的缩放，以及聚焦楼层时需要的滚动量。
// 旧宅的宽度只取决于视口宽高与镜头，不取决于是否选中了谁、是否打开了抽屉。
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
/** 宽屏左侧控制列（320）加列间距（16），与 stage.css 的两栏布局一致。 */
export const WIDE_SIDE_W = 336;
/** 宽屏默认视图的舞台宽度上限（约 0.75×809，相当于浏览器缩放 80% 的观感）：起始的旧宅在 1280×625 里整栋可见。楼层长高后不再缩小。 */
export const WIDE_DEFAULT_W = 600;
/** 宽屏“看全景”时上下各留的页面内边距。 */
export const WIDE_PAN_RESERVE_H = 2 * PAD_NARROW;

export interface ViewInput {
  vw: number;
  vh: number;
  grownFloors: number;
  camera: Camera;
}

export interface ViewLayout {
  wide: boolean;
  /** 是否处于全景（“看全景”：缩到整栋放进一屏）。 */
  panorama: boolean;
  /** 舞台（`.house` 元素）的 CSS 宽度。 */
  stageW: number;
  /** 旧宅图的宽度 = 舞台宽度 × 801 / 809，永远不超过 801。 */
  houseW: number;
  /** 旧宅图的缩放比例 s = houseW / 801。 */
  scale: number;
  /** 全景时的舞台宽度；不在全景时等于 stageW。 */
  panW: number;
  /** 非 null 时舞台用这个像素宽度（全景，或宽屏按高度缩小）；null 表示沿用 CSS（占满可用宽度，最大 809）。 */
  widthPx: number | null;
}

export function computeViewLayout(i: ViewInput): ViewLayout {
  const wide = i.vw >= WIDE_MIN;
  // 宽屏是两栏：左边控制列，旧宅占右边剩下的宽度。
  const stageW = Math.max(0, Math.min(STAGE_WIDTH, i.vw - 2 * PAD_NARROW - (wide ? WIDE_SIDE_W : 0)));
  const { stageHeight } = layoutHouse(Math.min(6, Math.max(2, i.grownFloors)));
  const fit = Math.floor(((i.vh - (wide ? WIDE_PAN_RESERVE_H : PAN_RESERVE_H)) * STAGE_WIDTH) / stageHeight);
  const panW = Math.min(stageW, Math.max(PAN_MIN_W, fit));
  const panorama = i.camera === 'panorama';
  // 默认视图：手机占满宽度；宽屏封顶在 WIDE_DEFAULT_W，不随楼层变高而缩小。只有全景才按视口高度缩放。
  const defaultW = wide ? Math.min(stageW, WIDE_DEFAULT_W) : stageW;
  const shown = panorama ? panW : defaultW;
  const houseW = (shown * HOUSE_MAX_W) / STAGE_WIDTH;
  return { wide, panorama, stageW, houseW, scale: houseW / HOUSE_MAX_W, panW, widthPx: panorama ? panW : defaultW < stageW ? defaultW : null };
}

/** 聚焦楼层：它的整层已经在视口里就不动，否则把它滚到视口中部。返回需要滚动的像素（正数向下）。 */
export function focusScrollDelta(floorTop: number, floorBottom: number, vh: number, margin = 8): number {
  const height = floorBottom - floorTop;
  if (floorTop >= margin && floorBottom <= vh - margin) return 0;
  const target = (vh - height) / 2;
  return Math.round(floorTop - target);
}
