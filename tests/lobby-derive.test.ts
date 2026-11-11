import { describe, expect, it } from 'vitest';
import { decodePng } from './helpers/png';
import { deriveLobby, expandRect, rectsIntersect, PARAMS } from '../src/house/derive/lobby';
import { LOBBY } from '../src/house/data/lobby';
import { WALL_ANCHORS_X } from '../src/house/data/modules';

const png = decodePng('public/assets/dollhouse/1x/lobby.png');
const { lobby, evidence } = deriveLobby(png, WALL_ANCHORS_X);

describe('门厅派生：实际 lobby.png 上的原始证据', () => {
  it('三块实测亮区，右侧两块相邻并合并成书页包围盒', () => {
    expect(evidence.glow.map((g) => [g.x0, g.y0, g.x1, g.y1])).toEqual([
      [109, 127, 125, 153],
      [380, 108, 469, 158],
      [466, 109, 556, 161],
    ]);
    expect(evidence.bookBox).toEqual([380, 108, 556, 161]);
  });

  it('蓝玻璃像素恰好聚成 3 块，原始包围盒固定', () => {
    expect(evidence.glassBoxes).toEqual([
      [584, 109, 615, 141],
      [619, 138, 640, 158],
      [650, 131, 669, 153],
    ]);
  });

  it('墙面参考色可复核，并找到合法挂灯候选', () => {
    expect(evidence.wallRef).toEqual([208, 131, 102]);
    expect(evidence.candidateCount).toBeGreaterThan(0);
  });
});

describe('门厅派生：结果与 LOBBY 逐项一致，且可重复', () => {
  it('LOBBY 三项都是 derived，并等于算法在实际 PNG 上的输出', () => {
    expect(LOBBY).toEqual(lobby);
    expect(LOBBY.archiveBook.status).toBe('derived');
    expect(LOBBY.staticLampRects.status).toBe('derived');
    expect(LOBBY.lampSlots.status).toBe('derived');
  });

  it('重复运行结果相同', () => {
    expect(deriveLobby(png, WALL_ANCHORS_X).lobby).toEqual(lobby);
  });

  it('纪念册：锚点为合并包围盒中心，热区为包围盒外扩 bookHitMargin 并夹在门厅内', () => {
    const b = evidence.bookBox;
    if (lobby.archiveBook.status !== 'derived') throw new Error('not derived');
    expect([lobby.archiveBook.x, lobby.archiveBook.y]).toEqual([Math.round((b[0] + b[2]) / 2), Math.round((b[1] + b[3]) / 2)]);
    expect(lobby.archiveBook.hit).toEqual(expandRect(b, PARAMS.bookHitMargin, png.width, png.height));
    expect(lobby.archiveBook.hit).toEqual([374, 102, 562, 167]);
  });

  it('静态灯框：原始包围盒外扩 lampRectMargin', () => {
    if (lobby.staticLampRects.status !== 'derived') throw new Error('not derived');
    expect(lobby.staticLampRects.rects).toEqual(evidence.glassBoxes.map((g) => expandRect(g, PARAMS.lampRectMargin, png.width, png.height)));
  });
});

describe('门厅派生：12 个暖灯位（前 3 盏叠在原画灯笼上，后 9 盏是挂墙灯笼组件）', () => {
  if (lobby.lampSlots.status !== 'derived' || lobby.archiveBook.status !== 'derived' || lobby.staticLampRects.status !== 'derived') {
    throw new Error('not derived');
  }
  const slots = lobby.lampSlots.slots;
  const hit = lobby.archiveBook.hit;
  const lampRects = lobby.staticLampRects.rects;
  const hung = slots.slice(3);
  const half = (PARAMS.hungW - 1) / 2;
  const foot = (s: { x: number; y: number }) => [s.x - half, s.y - PARAMS.hungH / 2, s.x + half, s.y + PARAMS.hungH / 2 - 1] as const;

  it('正好 12 个：前 3 个是原画灯笼，后 9 个是挂墙灯笼', () => {
    expect(slots).toHaveLength(12);
    expect(slots.slice(0, 3).map((s) => s.kind)).toEqual(['static-lantern', 'static-lantern', 'static-lantern']);
    expect(hung.map((s) => s.kind)).toEqual(Array(9).fill('hung-lantern'));
  });

  it('前 3 个位置就是 3 个静态灯框的中心，从左到右依次点亮', () => {
    const centres = lampRects.map((r) => [Math.round((r[0] + r[2]) / 2), Math.round((r[1] + r[3]) / 2)]);
    const sorted = [...centres].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
    expect(slots.slice(0, 3).map((s) => [s.x, s.y])).toEqual(sorted);
    expect(slots[0]!.x).toBeLessThan(slots[1]!.x);
    expect(slots[1]!.x).toBeLessThan(slots[2]!.x);
  });

  it('挂墙灯都在墙面内、高低错落，且互相间距 ≥ 36', () => {
    for (const s of hung) {
      expect(s.x - half).toBeGreaterThanOrEqual(WALL_ANCHORS_X[0]);
      expect(s.x + half).toBeLessThanOrEqual(WALL_ANCHORS_X[1]);
      expect(s.y + PARAMS.hungH / 2).toBeLessThanOrEqual(225);
    }
    for (let i = 0; i < hung.length; i++)
      for (let j = i + 1; j < hung.length; j++) expect(Math.hypot(hung[i]!.x - hung[j]!.x, hung[i]!.y - hung[j]!.y)).toBeGreaterThanOrEqual(PARAMS.lampMinSpacing);
    expect(new Set(hung.map(s => s.y)).size).toBeGreaterThan(4);
  });

  it('挂墙灯的占位不与纪念册热区、静态灯框相交（含安全距离）', () => {
    for (const s of hung) {
      const safe = expandRect([...foot(s)] as unknown as [number, number, number, number], PARAMS.lampSafety, png.width, png.height);
      expect(rectsIntersect(safe, hit)).toBe(false);
      for (const r of lampRects) expect(rectsIntersect(safe, r)).toBe(false);
    }
  });

  it('挂墙灯的占位下全是不透明像素，没有深色描边（不压门框、桌子、花瓶、梁）', () => {
    for (const s of hung) {
      const [x0, y0, x1, y1] = foot(s);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = (y * png.width + x) * 4;
          expect(png.data[i + 3]!).toBeGreaterThanOrEqual(PARAMS.cleanAlpha);
          const luma = 0.2126 * png.data[i]! + 0.7152 * png.data[i + 1]! + 0.0722 * png.data[i + 2]!;
          expect(luma).toBeGreaterThanOrEqual(PARAMS.hungDarkLuma);
        }
    }
  });
});
