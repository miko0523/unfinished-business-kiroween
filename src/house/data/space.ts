// 每层的共享活动空间：可导航区、显式障碍、Home Anchor、动作位。
//   navigable：下面的数值就是 deriveNavigable(floor PNG 像素, 两个 safe 矩形下沿的较大值) 的结果（算法与参数见
//              src/house/derive/space.ts）；tests/space-derive.test.ts 每次重新解码 PNG、重跑算法并要求逐项一致。
//   obstacles：只登记代码里真实存在的互动家具或姿势道具。MVP 还没有这样的对象，所以为空；
//              Static_Layer 的床、窗、椅子等背景图案不是障碍，Ghost 可以飘在它们前面。
//   homes：room-layout.json 的 left/right idle。
//   actionSpots：room-layout.json 的 pairing.greetingXs / workingXs 与各层 meetY。
import type { FloorModuleId } from '../assets';
import { FLOOR_SLOTS, PAIRING, type Point, type Rect } from './slots';

export type ActionKind = 'greet' | 'work';

export interface ActionSpot {
  kind: ActionKind;
  /** 两个相对的位置：a 在左、b 在右（谁去哪边不固定）。 */
  a: Point;
  b: Point;
}

export interface FloorSpace {
  status: 'derived';
  navigable: Rect;
  obstacles: readonly Rect[];
  homes: readonly [Point, Point];
  actionSpots: readonly ActionSpot[];
}

const NAVIGABLE: Readonly<Record<FloorModuleId, Rect>> = {
  'floor-01': [62, 19, 733, 260],
  'floor-02': [60, 15, 735, 260],
  'floor-03': [61, 18, 732, 258],
  'floor-04': [66, 17, 730, 260],
  'floor-05': [60, 17, 736, 262],
};

function build(id: FloorModuleId): FloorSpace {
  const f = FLOOR_SLOTS[id];
  return {
    status: 'derived',
    navigable: NAVIGABLE[id],
    obstacles: [],
    homes: [f.left.idle, f.right.idle],
    actionSpots: [
      { kind: 'greet', a: [PAIRING.greetingXs[0], f.meetY], b: [PAIRING.greetingXs[1], f.meetY] },
      { kind: 'work', a: [PAIRING.workingXs[0], f.meetY], b: [PAIRING.workingXs[1], f.meetY] },
    ],
  };
}

export const FLOOR_SPACES: Readonly<Record<FloorModuleId, FloorSpace>> = {
  'floor-01': build('floor-01'),
  'floor-02': build('floor-02'),
  'floor-03': build('floor-03'),
  'floor-04': build('floor-04'),
  'floor-05': build('floor-05'),
};
