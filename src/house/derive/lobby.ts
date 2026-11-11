// 门厅三项锚点（纪念册、静态灯框、暖灯位）的纯派生函数：输入 lobby.png 的像素与 atlas 的 wallAnchorsX，
// 输出 LobbyAnchors 与可复核的中间证据。书与原灯由像素派生；新增灯位由艺术构图起点加像素验证选择。
// src/house/data/lobby.ts 里的 LOBBY 是本函数在实际 1x/lobby.png 上的运行结果，
// tests/lobby-derive.test.ts 每次都会重新运行并要求二者逐项一致。
import type { ArchiveBookAnchor, LampSlot, LobbyAnchors } from '../data/lobby';
import { LAMP_SLOT_COUNT, STATIC_LAMP_COUNT } from '../data/lobby';
import type { Rect } from '../data/slots';
import { findGlowRegions, type GlowRegion, type PixelSource } from './glow';

export const PARAMS = {
  /** 纪念册：相邻亮区（包围盒间距 ≤ 此值）视为同一本打开的册子的左右书页。 */
  bookMergeGap: 4,
  /** 纪念册热区 = 合并包围盒四边各外扩此值，再夹在门厅像素范围内。 */
  bookHitMargin: 6,
  /** 静态蓝玻璃灯：只在门厅右半区（x ≥ wallAnchorsX 中点）、y ≥ glassMinY（避开顶部饰边）里找。 */
  glassMinY: 90,
  /** 蓝玻璃像素：alpha ≥ glassMinAlpha，且 B ≥ R + glassBlueBias、B ≥ G + glassGreenBias。 */
  glassMinAlpha: 200,
  glassBlueBias: -15,
  glassGreenBias: -30,
  /** 四连通块面积下限；必须恰好得到 3 块。 */
  glassMinArea: 200,
  glassCount: 3,
  /** 静态灯框 = 蓝玻璃块包围盒四边各外扩此值，再夹在门厅像素范围内。 */
  lampRectMargin: 4,
  /** 暖灯位候选：墙面参考色取 y∈[wallBandY0, wallBandY1]、x∈wallAnchorsX 内不透明像素的逐通道中位数。 */
  wallBandY0: 30,
  wallBandY1: 100,
  /** 候选格：cy 从 gridY0 起，到门厅高度一半为止，cx 在 wallAnchorsX 内（含半窗留边），步长 gridStep。 */
  gridY0: 16,
  gridStep: 8,
  /** 候选窗为 (2*lampHalf+1) 见方，即小纸星的占位。 */
  lampHalf: 12,
  /** 窗内像素：alpha ≥ cleanAlpha，且与参考色的 RGB 欧氏距离 ≤ cleanColorDist，才算“空白墙纸”。 */
  cleanAlpha: 250,
  cleanColorDist: 45,
  /** 窗内空白墙纸像素占比下限。 */
  cleanFraction: 0.97,
  /** 窗内平均边缘强度（|ΔL右|+|ΔL下|）/2 上限，排除高边缘密度区。 */
  maxEdgeDensity: 9,
  /** 暖灯占位（含 lampHalf）与纪念册热区、静态灯框之间再留的安全距离。 */
  lampSafety: 8,
  /** 暖灯位两两最小欧氏间距。 */
  lampMinSpacing: 36,
  /**
   * 第 4–12 盏是挂在墙上的灯笼组件，占位（挂钩加灯笼）宽 hungW、高 hungH，占位中心就是灯位 (x,y)。
   * 位置不是均匀推导出来的：HUNG_TARGETS 是人工给的艺术构图起点（高低错开，分布在门边、墙角、桌边的空墙），
   * 每个起点在半径 hungSearch 内按像素逐点找最近的合法位置——占位下全部不透明、没有深色描边像素（避开门框、花瓶、桌子、梁），
   * 外扩 lampSafety 后不碰纪念册热区与静态灯框，且与已选的挂灯两两中心距 ≥ lampMinSpacing。找不到就报错，不降低要求。
   */
  hungW: 27,
  hungH: 46,
  hungSearch: 32,
  hungCount: 9,
  /** 占位里出现亮度低于它的像素（家具、门框的深色描边）或透明像素，这个位置就不能挂灯。 */
  hungDarkLuma: 75,
} as const;

export interface LobbyEvidence {
  /** findGlowRegions 的全部结果（含非书页的亮区）。 */
  glow: GlowRegion[];
  /** 合并后的书页包围盒（含边界）。 */
  bookBox: Rect;
  /** 蓝玻璃块的原始像素包围盒（含边界），按 x 排序。 */
  glassBoxes: Rect[];
  /** 墙面参考色。 */
  wallRef: readonly [number, number, number];
  /** 搜索中通过像素判定且改善当前距离的候选次数（不是所有合法墙面点的总数）。 */
  candidateCount: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function expandRect(r: Rect, margin: number, w: number, h: number): Rect {
  return [clamp(r[0] - margin, 0, w - 1), clamp(r[1] - margin, 0, h - 1), clamp(r[2] + margin, 0, w - 1), clamp(r[3] + margin, 0, h - 1)];
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

function deriveBook(img: PixelSource, glow: GlowRegion[]): { anchor: ArchiveBookAnchor; box: Rect } {
  if (glow.length === 0) throw new Error('lobby: no glow regions');
  let seed = glow[0]!;
  for (const g of glow) if (g.area > seed.area) seed = g;
  let box: Rect = [seed.x0, seed.y0, seed.x1, seed.y1];
  const used = new Set<GlowRegion>([seed]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of glow) {
      if (used.has(g)) continue;
      const gap = PARAMS.bookMergeGap;
      if (rectsIntersect(expandRect(box, gap, img.width, img.height), [g.x0, g.y0, g.x1, g.y1])) {
        box = [Math.min(box[0], g.x0), Math.min(box[1], g.y0), Math.max(box[2], g.x1), Math.max(box[3], g.y1)];
        used.add(g);
        grew = true;
      }
    }
  }
  const anchor: ArchiveBookAnchor = {
    x: Math.round((box[0] + box[2]) / 2),
    y: Math.round((box[1] + box[3]) / 2),
    hit: expandRect(box, PARAMS.bookHitMargin, img.width, img.height),
  };
  return { anchor, box };
}

function deriveGlass(img: PixelSource, wallX: readonly [number, number]): Rect[] {
  const { width: w, height: h, data } = img;
  const x0 = Math.ceil((wallX[0] + wallX[1]) / 2);
  const isGlass = (p: number): boolean => {
    const x = p % w;
    const y = (p - x) / w;
    if (x < x0 || y < PARAMS.glassMinY) return false;
    const i = p * 4;
    return (
      data[i + 3]! >= PARAMS.glassMinAlpha &&
      data[i + 2]! >= data[i]! + PARAMS.glassBlueBias &&
      data[i + 2]! >= data[i + 1]! + PARAMS.glassGreenBias
    );
  };
  const seen = new Uint8Array(w * h);
  const boxes: Rect[] = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || !isGlass(s)) continue;
    const stack = [s];
    seen[s] = 1;
    let bx0 = w;
    let by0 = h;
    let bx1 = 0;
    let by1 = 0;
    let area = 0;
    while (stack.length > 0) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      area++;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && !seen[q] && isGlass(q)) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (area >= PARAMS.glassMinArea) boxes.push([bx0, by0, bx1, by1]);
  }
  if (boxes.length !== PARAMS.glassCount) throw new Error(`lobby: expected ${PARAMS.glassCount} glass lamps, found ${boxes.length}`);
  return boxes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function wallReference(img: PixelSource, wallX: readonly [number, number]): [number, number, number] {
  const { width: w, data } = img;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let n = 0;
  for (let y = PARAMS.wallBandY0; y <= PARAMS.wallBandY1; y++) {
    for (let x = wallX[0]; x <= wallX[1]; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3]! < PARAMS.cleanAlpha) continue;
      for (let c = 0; c < 3; c++) hist[c]![data[i + c]!]!++;
      n++;
    }
  }
  if (n === 0) throw new Error('lobby: empty wall band');
  const med = (h: Uint32Array) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += h[v]!;
      if (acc * 2 >= n) return v;
    }
    return 255;
  };
  return [med(hist[0]!), med(hist[1]!), med(hist[2]!)];
}

/** 艺术构图起点（灯位中心，门厅逻辑像素）：高低错开，门边、墙角、桌边各有一两盏；只是起点，最终位置由像素验证决定。 */
export const HUNG_TARGETS: readonly (readonly [number, number])[] = [
  [139, 51],
  [330, 80],
  [365, 48],
  [420, 68],
  [477, 44],
  [537, 67],
  [584, 44],
  [704, 103],
  [707, 194],
];

/**
 * 12 盏暖灯的位置（点亮顺序）：
 *  - 第 1–3 盏：门厅桌上已经画好的三盏小灯笼，位置 = 三个静态灯框（按 x 从左到右）的中心；原画不动，只在上面叠光。
 *  - 第 4–12 盏：挂墙灯笼，见 PARAMS 里 hung* 的说明——人工的艺术起点 + 逐像素验证后的最近合法位置，按 x 从左到右点亮。
 */
function deriveLamps(
  img: PixelSource,
  wallX: readonly [number, number],
  avoid: readonly Rect[],
  staticRects: readonly Rect[],
): { slots: LampSlot[]; candidates: number } {
  const { width: w, height: h, data } = img;
  const halfW = (PARAMS.hungW - 1) / 2;
  const halfH = (PARAMS.hungH - 1) / 2;
  const luma = (i: number) => 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
  const fits = (cx: number, cy: number): boolean => {
    const x0 = Math.floor(cx - halfW);
    const y0 = Math.floor(cy - halfH);
    const x1 = x0 + PARAMS.hungW - 1;
    const y1 = y0 + PARAMS.hungH - 1;
    if (x0 < wallX[0] + 2 || x1 > wallX[1] - 2 || y0 < 0 || y1 >= h) return false;
    const foot: Rect = [x0 - PARAMS.lampSafety, y0 - PARAMS.lampSafety, x1 + PARAMS.lampSafety, y1 + PARAMS.lampSafety];
    if (avoid.some((a) => rectsIntersect(foot, a))) return false;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3]! < PARAMS.cleanAlpha || luma(i) < PARAMS.hungDarkLuma) return false;
      }
    }
    return true;
  };
  const picked: Array<readonly [number, number]> = [];
  let candidates = 0;
  for (const [tx, ty] of HUNG_TARGETS) {
    let best: readonly [number, number] | null = null;
    let bestD = Infinity;
    for (let dy = -PARAMS.hungSearch; dy <= PARAMS.hungSearch; dy++) {
      for (let dx = -PARAMS.hungSearch; dx <= PARAMS.hungSearch; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > PARAMS.hungSearch || d >= bestD) continue;
        const cx = tx + dx;
        const cy = ty + dy;
        if (!fits(cx, cy)) continue;
        if (picked.some((p) => Math.hypot(p[0] - cx, p[1] - cy) < PARAMS.lampMinSpacing)) continue;
        if (picked.some((p) => Math.abs(p[0] - cx) < PARAMS.hungW + 4 && Math.abs(p[1] - cy) < PARAMS.hungH + 4)) continue;
        best = [cx, cy];
        bestD = d;
        candidates++;
      }
    }
    if (!best) throw new Error(`lobby: no legal spot within ${PARAMS.hungSearch}px of hung target (${tx},${ty})`);
    picked.push(best);
  }
  if (picked.length !== PARAMS.hungCount) throw new Error('lobby: hung lamp count');
  picked.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const fixed: LampSlot[] = staticRects.map((r) => ({ x: Math.round((r[0] + r[2]) / 2), y: Math.round((r[1] + r[3]) / 2), kind: 'static-lantern' as const }));
  if (fixed.length !== STATIC_LAMP_COUNT) throw new Error('lobby: expected 3 static lanterns');
  fixed.sort((a, b) => a.x - b.x || a.y - b.y);
  const slots = [...fixed, ...picked.map(([x, y]) => ({ x, y, kind: 'hung-lantern' as const }))];
  if (slots.length !== LAMP_SLOT_COUNT) throw new Error('lobby: lamp slot count');
  return { slots, candidates };
}

export function deriveLobby(img: PixelSource, wallAnchorsX: readonly [number, number]): { lobby: LobbyAnchors; evidence: LobbyEvidence } {
  const glow = findGlowRegions(img);
  const { anchor, box } = deriveBook(img, glow);
  const glassBoxes = deriveGlass(img, wallAnchorsX);
  const lampRects = glassBoxes.map((b) => expandRect(b, PARAMS.lampRectMargin, img.width, img.height));
  const wallRef = wallReference(img, wallAnchorsX);
  const { slots, candidates } = deriveLamps(img, wallAnchorsX, [anchor.hit, ...lampRects], lampRects);
  return {
    lobby: {
      archiveBook: { status: 'derived', ...anchor },
      staticLampRects: { status: 'derived', rects: lampRects },
      lampSlots: { status: 'derived', slots },
    },
    evidence: { glow, bookBox: box, glassBoxes, wallRef, candidateCount: candidates },
  };
}
