// 住客位分配：楼层从低到高，同层左先右后。
import type { FloorNo, SideNo, SlotId } from './types';

export const MAX_RESIDENTS = 10;
const FLOORS: readonly FloorNo[] = [2, 3, 4, 5, 6];
const SIDES: readonly SideNo[] = [0, 1];

export function slotKey(s: SlotId): string {
  return `${s.floor}:${s.slot}`;
}

/** 第一个空 Slot；满员返回 null。 */
export function allocate(occupied: ReadonlySet<string>): SlotId | null {
  for (const floor of FLOORS) {
    for (const slot of SIDES) {
      const id: SlotId = { floor, slot };
      if (!occupied.has(slotKey(id))) return id;
    }
  }
  return null;
}

/** 容纳 n 位住客所需的楼层数（2..6）：2 + ceil(max(n-2, 0)/2)。 */
export function floorsNeeded(residentCount: number): FloorNo {
  const n = Math.max(0, Math.floor(residentCount));
  return Math.min(6, 2 + Math.ceil(Math.max(n - 2, 0) / 2)) as FloorNo;
}
