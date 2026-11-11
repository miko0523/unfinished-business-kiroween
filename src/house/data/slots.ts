// 双住客落点与安全矩形，派生自 generated.ts（静态抄自 public/assets/dollhouse/room-layout.json）：
//   floors[*].left/right.idle / .safe、floors[*].meetY、pairing.*、envelopes.*。
// 坐标系：单张 801px 宽 1x 楼层 PNG 的左上角为原点，矩形为 [xmin, ymin, xmax, ymax]（含边界）。
import { ROOM_LAYOUT as layout } from './generated';
import type { FloorModuleId } from '../assets';

export type Point = readonly [x: number, y: number];
export type Rect = readonly [xmin: number, ymin: number, xmax: number, ymax: number];

export interface SideSlot {
  idle: Point;
  safe: Rect;
}

export interface FloorSlots {
  size: readonly [width: number, height: number];
  left: SideSlot;
  right: SideSlot;
  meetY: number;
}

const FLOOR_IDS: readonly FloorModuleId[] = ['floor-01', 'floor-02', 'floor-03', 'floor-04', 'floor-05'];

function point(v: readonly number[]): Point {
  if (v.length !== 2) throw new Error('room-layout.json: bad point');
  return [v[0]!, v[1]!];
}

function rect(v: readonly number[]): Rect {
  if (v.length !== 4) throw new Error('room-layout.json: bad rect');
  return [v[0]!, v[1]!, v[2]!, v[3]!];
}

function side(s: { readonly idle: readonly number[]; readonly safe: readonly number[] }): SideSlot {
  return { idle: point(s.idle), safe: rect(s.safe) };
}

function build(): Record<FloorModuleId, FloorSlots> {
  const out: Partial<Record<FloorModuleId, FloorSlots>> = {};
  const floors: Readonly<Record<string, (typeof layout.floors)[FloorModuleId] | undefined>> = layout.floors;
  for (const id of FLOOR_IDS) {
    const f = floors[id];
    if (!f) throw new Error(`room-layout.json: missing ${id}`);
    out[id] = {
      size: [f.size[0]!, f.size[1]!],
      left: side(f.left),
      right: side(f.right),
      meetY: f.meetY,
    };
  }
  return out as Record<FloorModuleId, FloorSlots>;
}

export const FLOOR_SLOTS: Readonly<Record<FloorModuleId, FloorSlots>> = build();

export const PAIRING = {
  minClearanceX: layout.pairing.minClearanceX,
  leftStaysLeft: layout.pairing.leftStaysLeft,
  /** 两边活动区重合的 x 范围（中央相遇区）。 */
  centerSharingX: [layout.pairing.centerSharingX[0]!, layout.pairing.centerSharingX[1]!] as const,
  /** 打招呼时左、右的目标 x。 */
  greetingXs: [layout.pairing.greetingXs[0]!, layout.pairing.greetingXs[1]!] as const,
  /** 一起做家务时左、右的目标 x。 */
  workingXs: [layout.pairing.workingXs[0]!, layout.pairing.workingXs[1]!] as const,
};

export const ENVELOPES = {
  idleOrGreet: { halfWidth: layout.envelopes.idleOrGreet.halfWidth, height: layout.envelopes.idleOrGreet.height },
  choreWithTool: { halfWidth: layout.envelopes.choreWithTool.halfWidth, height: layout.envelopes.choreWithTool.height },
};
