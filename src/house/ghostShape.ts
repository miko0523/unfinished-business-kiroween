// Ghost 的几何常量。身体与裙边始终是一条闭合轮廓；水平走路只让腰线以下的控制点渐进后飘。
// 坐标：viewBox 0 0 140 180，锚点 (70,180) 为身体底边中点；身体包围盒 108×130（x 16–124，y 46–176），整体再按 GHOST_VISUAL_SCALE 缩小。

export const GHOST_VIEWBOX = '0 0 140 180';
export const GHOST_WIDTH = 140;
export const GHOST_HEIGHT = 180;
export const GHOST_ANCHOR: readonly [number, number] = [70, 180];

/** 整体视觉缩放（绕锚点）：比第一版小一档，点击热区仍是整个 140×180 容器。 */
export const GHOST_VISUAL_SCALE = 0.88;

export type WalkDirection = -1 | 0 | 1;
const HEM_TOP = 154;
const HEM_BOTTOM = 176;
const HEM_MAX_DRIFT = 4;
const fmt = (n: number) => Number(n.toFixed(2));
const hemPoint = (x: number, y: number, walk: WalkDirection) => {
  const depth = Math.max(0, Math.min(1, (y - HEM_TOP) / (HEM_BOTTOM - HEM_TOP)));
  return `${fmt(x - walk * HEM_MAX_DRIFT * depth)} ${y}`;
};

/**
 * 一条完整闭合轮廓：从左腰沿头顶到右腰，再沿四瓣波浪从右向左回到起点。
 * 腰线两端 y=154 永远不动；越靠近下摆，控制点才越向行走反方向偏，最大 4 个单位。
 */
export function ghostOutlinePath(walk: WalkDirection = 0): string {
  const p = (x: number, y: number) => hemPoint(x, y, walk);
  return (
    'M16 154 C16 118 20 46 70 46 C120 46 124 118 124 154 ' +
    `C${p(124, 164)} ${p(119, 171)} ${p(111, 171)} ` +
    `C${p(103, 171)} ${p(98, 167)} ${p(98, 160)} ` +
    `C${p(98, 169)} ${p(92, 176)} ${p(82, 176)} ` +
    `C${p(72, 176)} ${p(66, 168)} ${p(66, 159)} ` +
    `C${p(66, 166)} ${p(61, 169)} ${p(55, 169)} ` +
    `C${p(49, 169)} ${p(44, 166)} ${p(44, 160)} ` +
    `C${p(44, 167)} ${p(39, 173)} ${p(30, 173)} ` +
    `C${p(21, 173)} ${p(16, 167)} 16 154 Z`
  );
}

export const BODY_PATH = ghostOutlinePath(0);

/** 头顶呆毛：细茎向上，末端卷成一个清楚的小环。四个状态都存在。 */
export const WISP_PATH = 'M70 48 C69 41 74 37 74 31 A6 6 0 1 1 79.2 28';

/** 肩点（手围绕它独立旋转）：小短手贴在身体两侧。 */
export const SHOULDERS = { left: [19, 120], right: [121, 120] } as const;
/** 小短手：中心与半径（贴身体两侧，只比轮廓外凸一点点）。 */
export const HANDS = { left: { cx: 15, cy: 130, rx: 6.5, ry: 8.5 }, right: { cx: 125, cy: 130, rx: 6.5, ry: 8.5 } } as const;

/** 眼睛：纯深色竖椭圆，无嘴无鼻；比概念稿再大一档。 */
export const EYE = { left: 52, right: 88, y: 99, rx: 6.5, ry: 9.5, ink: '#2B2530' } as const;
/** 腮红：贴在眼睛外下方。 */
export const BLUSH = { left: 39, right: 101, y: 115, rx: 7, ry: 4 } as const;

export type Expression = 'shy' | 'surprised' | 'puzzled' | 'focused' | 'happy' | 'relieved';
export type PropKind = 'none' | 'broom' | 'can' | 'cloth' | 'eraser' | 'suitcase';
