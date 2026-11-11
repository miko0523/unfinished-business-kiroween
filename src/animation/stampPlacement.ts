// 盖章卡的摆放（纯函数，像素坐标，原点在舞台左上）：卡片放在幽灵身边的墙面里，不压脸，不越出这一层的墙面。
// 先选左右哪一侧、定宽度，再按量出的高度定竖直位置；宽度不够的窄屏下卡片会收窄、进入紧凑排版。

export type Rect = readonly [number, number, number, number];

export interface PlacementInput {
  /** 幽灵锚点（身体底边中点）的像素位置。 */
  anchorX: number;
  anchorY: number;
  /** 舞台缩放：1 个逻辑像素对应的 CSS 像素。 */
  k: number;
  /** 这一层墙面内部（可导航区）的像素矩形。 */
  interior: Rect;
  /** 卡片理想宽度与最小宽度（CSS 像素）。 */
  naturalWidth: number;
  minWidth: number;
}

export type Side = 'left' | 'right';

/** 身体一侧放得下的宽度小于它，字会被挤成一两个字一行，改放到幽灵头顶上方整行展开。 */
export const READABLE_ROOM_PX = 100;
/** 整只幽灵（含呆毛）在锚点之上的高度（逻辑像素）：卡片放在它头顶时要躲开这么高。 */
export const GHOST_RISE = 150;

/** 身体加两只小手的半宽（逻辑像素）：卡片离幽灵至少隔开这么多再加一点空隙。 */
export const BODY_HALF = 62;
export const GAP_PX = 6;
/** 幽灵身体中心离脚底的高度（逻辑像素），卡片竖直方向对齐它。 */
export const BODY_MID = 70;
export const INSET_PX = 2;

export function chooseSide(i: PlacementInput): { side: Side; width: number; room: number } {
  const half = BODY_HALF * i.k + GAP_PX;
  const roomRight = i.interior[2] - (i.anchorX + half) - INSET_PX;
  const roomLeft = i.anchorX - half - i.interior[0] - INSET_PX;
  const side: Side = roomRight >= i.naturalWidth || roomRight >= roomLeft ? 'right' : 'left';
  const room = Math.max(0, side === 'right' ? roomRight : roomLeft);
  return { side, width: Math.max(Math.min(i.naturalWidth, room), Math.min(i.minWidth, room)), room };
}

export function placeCard(i: PlacementInput, side: Side, width: number, height: number): { left: number; top: number } {
  const half = BODY_HALF * i.k + GAP_PX;
  const left = side === 'right' ? i.anchorX + half : i.anchorX - half - width;
  const mid = i.anchorY - BODY_MID * i.k;
  const lo = i.interior[1] + INSET_PX;
  const hi = i.interior[3] - height - INSET_PX;
  const top = hi < lo ? lo : Math.min(hi, Math.max(lo, mid - height / 2));
  return { left, top };
}

/**
 * 身体两侧都太窄时（例如 320 宽的 200% 缩放）：卡片按整行宽度放在幽灵头顶上方，字不被挤窄。
 * 上方放不下（fits 为假）时由调用方退回两侧的摆法。
 */
export function placeAbove(i: PlacementInput, height: number): { left: number; top: number; width: number; fits: boolean } {
  const wall = i.interior[2] - i.interior[0] - 2 * INSET_PX;
  const width = Math.max(0, Math.min(i.naturalWidth, wall));
  const left = Math.min(Math.max(i.anchorX - width / 2, i.interior[0] + INSET_PX), i.interior[2] - width - INSET_PX);
  const top = i.anchorY - GHOST_RISE * i.k - GAP_PX - height;
  return { left, top, width, fits: width >= Math.min(i.minWidth, wall) && top >= i.interior[1] + INSET_PX };
}
