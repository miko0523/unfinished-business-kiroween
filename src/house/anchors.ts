// 住客位 → 舞台坐标。Home Anchor 取 room-layout.json 的 left/right idle 点（逻辑像素，模块内坐标），
// 再加上该楼层模块在舞台里的偏移（含确定性错位 dx），所以 Ghost 落点跟随模块一起移动。
import type { SlotId } from '../domain/types';
import { floorModuleForFloor } from './assets';
import { FLOOR_SLOTS } from './data/slots';
import type { HouseLayout } from './layout';
import { stageBoxes } from './stage';

export interface StagePoint {
  x: number;
  y: number;
}

/** 该住客位的 Home Anchor（Ghost 身体底边中点）在舞台逻辑像素中的位置；楼层尚未长出时返回 null。 */
export function homeOnStage(layout: HouseLayout, slot: SlotId): StagePoint | null {
  const id = floorModuleForFloor(slot.floor);
  const box = stageBoxes(layout).find((b) => b.id === id);
  if (!box) return null;
  const side = FLOOR_SLOTS[id];
  const [ix, iy] = (slot.slot === 0 ? side.left : side.right).idle;
  return { x: box.x + ix, y: box.y + iy };
}
