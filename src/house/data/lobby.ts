// 门厅锚点：纪念册、静态灯框、暖灯位，三项均为 'derived'。
// atlas.json 与 room-layout.json 没有这三项，所以它们派生自实际的 public/assets/dollhouse/1x/lobby.png 像素，
// 算法与全部参数见 src/house/derive/lobby.ts 的 deriveLobby 与 PARAMS。
// 下面的数值就是 deriveLobby(lobby.png 像素, atlas.wallAnchorsX) 的结果；
// tests/lobby-derive.test.ts 每次重新解码 PNG、重跑算法，并要求与本文件逐项一致，改图后数值对不上就会失败。
//
// 追溯链（坐标系：1x lobby.png 左上角为原点，矩形为 [xmin,ymin,xmax,ymax]，含边界）：
//   纪念册  实测亮区 [380,108,469,158] 与 [466,109,556,161] 相邻（间距 ≤ 4），合并包围盒 [380,108,556,161]；
//           锚点 = 包围盒几何中心四舍五入 = (468,135)；热区 = 包围盒四边外扩 6 = [374,102,562,167]。
//           （第三块亮区 [109,127,125,153] 不与之相邻，不属于册子。）
//   静态灯  门厅右半区蓝玻璃像素（B ≥ R-15 且 B ≥ G-30，alpha ≥ 200，y ≥ 90）的四连通块，面积 ≥ 200，恰好 3 块，
//           原始包围盒 [584,109,615,141]、[619,138,640,158]、[650,131,669,153]，各外扩 4 得下面三个灯框。
//   暖灯位  共 12 个，点亮顺序：
//           第 1–3 盏 = 门厅桌上已画好的三盏小灯笼，位置取三个静态灯框（按 x 从左到右）的中心——原画不动，只叠光；
//           第 4–12 盏 = 艺术构图起点加二维像素验证后的最近合法墙面位置，高低错开。
//           占位宽 27、高 46；占位下须全部不透明且没有深色描边像素，外扩 8 后不碰书和静态灯。
//           算法见 HUNG_TARGETS 与 deriveLamps；位置为占位中心，不是均匀分布。
import type { Rect } from './slots';

export const LAMP_SLOT_COUNT = 12;
/** 前几盏就是门厅桌上已经画好的小灯笼（原画不动，只叠光）。 */
export const STATIC_LAMP_COUNT = 3;

export type Derivable<T> = { status: 'missing' } | ({ status: 'derived' } & T);

export interface ArchiveBookAnchor {
  x: number;
  y: number;
  hit: Rect;
}

/** static-lantern：桌上原画里的灯笼，叠光；hung-lantern：挂在墙上的灯笼组件（public/assets/dollhouse/components/lantern.png）。 */
export type LampKind = 'static-lantern' | 'hung-lantern';

export interface LampSlot {
  x: number;
  y: number;
  kind: LampKind;
}

export interface LobbyAnchors {
  archiveBook: Derivable<ArchiveBookAnchor>;
  staticLampRects: Derivable<{ rects: readonly Rect[] }>;
  /** 派生成功时长度恒为 LAMP_SLOT_COUNT。 */
  lampSlots: Derivable<{ slots: readonly LampSlot[] }>;
}

export const LOBBY: LobbyAnchors = {
  archiveBook: { status: 'derived', x: 468, y: 135, hit: [374, 102, 562, 167] },
  staticLampRects: {
    status: 'derived',
    rects: [
      [580, 105, 619, 145],
      [615, 134, 644, 162],
      [646, 127, 673, 157],
    ],
  },
  lampSlots: {
    status: 'derived',
    slots: [
      { x: 600, y: 125, kind: 'static-lantern' },
      { x: 630, y: 148, kind: 'static-lantern' },
      { x: 660, y: 142, kind: 'static-lantern' },
      { x: 162, y: 50, kind: 'hung-lantern' },
      { x: 331, y: 79, kind: 'hung-lantern' },
      { x: 365, y: 48, kind: 'hung-lantern' },
      { x: 420, y: 68, kind: 'hung-lantern' },
      { x: 480, y: 48, kind: 'hung-lantern' },
      { x: 537, y: 67, kind: 'hung-lantern' },
      { x: 584, y: 48, kind: 'hung-lantern' },
      { x: 700, y: 179, kind: 'hung-lantern' },
      { x: 704, y: 103, kind: 'hung-lantern' },
    ],
  },
};
