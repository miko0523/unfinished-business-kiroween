import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MODULE_IDS, type FloorModuleId } from '../src/house/assets';
import { LOGICAL_WIDTH, MODULES, WALL_ANCHORS_X } from '../src/house/data/modules';
import { ENVELOPES, FLOOR_SLOTS, PAIRING } from '../src/house/data/slots';
import { LOBBY } from '../src/house/data/lobby';
import { ATLAS, ROOM_LAYOUT } from '../src/house/data/generated';
import { statSync } from 'node:fs';

// 在测试里直接读文件重新计算，不经过 src 的 import。
const dir = resolve('public/assets/dollhouse');
const atlas = JSON.parse(readFileSync(resolve(dir, 'atlas.json'), 'utf8'));
const roomLayout = JSON.parse(readFileSync(resolve(dir, 'room-layout.json'), 'utf8'));

const FLOORS: FloorModuleId[] = ['floor-01', 'floor-02', 'floor-03', 'floor-04', 'floor-05'];

describe('modules.ts 与 atlas.json 逐项相等', () => {
  it('宽度与墙锚点', () => {
    expect(LOGICAL_WIDTH).toBe(801);
    expect(LOGICAL_WIDTH).toBe(atlas.logicalWidth);
    expect([...WALL_ANCHORS_X]).toEqual(atlas.wallAnchorsX);
  });

  it('每个模块的尺寸与拼接线', () => {
    expect(Object.keys(MODULES).sort()).toEqual([...MODULE_IDS].sort());
    for (const m of atlas.modules) {
      const g = MODULES[m.id as keyof typeof MODULES];
      expect(g.width).toBe(m.logicalSize[0]);
      expect(g.height).toBe(m.logicalSize[1]);
      expect(g.topJoin).toBe(m.topJoin);
      expect(g.bottomJoin).toBe(m.bottomJoin);
    }
  });

  it('逻辑尺寸与 2x 像素尺寸一致', () => {
    for (const m of atlas.modules) {
      expect(m.w).toBe(m.logicalSize[0] * 2);
      expect(m.h).toBe(m.logicalSize[1] * 2);
    }
  });

  it('dx 与 design 的偏移表一致，且满足约束', () => {
    expect(MODULES.lobby.dx).toBe(0);
    expect(FLOORS.map((id) => MODULES[id].dx)).toEqual([0, 3, -3, 4, -2]);
    expect(MODULES.roof.dx).toBeNull();
    const chain = [MODULES.lobby, ...FLOORS.map((id) => MODULES[id])].map((m) => m.dx ?? 0);
    for (const v of chain) expect(Math.abs(v)).toBeLessThanOrEqual(4);
    for (let i = 1; i < chain.length; i++) expect(Math.abs(chain[i]! - chain[i - 1]!)).toBeLessThanOrEqual(8);
  });
});

describe('slots.ts 与 room-layout.json 逐项相等', () => {
  it('每层落点、安全矩形、meetY', () => {
    for (const id of FLOORS) {
      const src = roomLayout.floors[id];
      const got = FLOOR_SLOTS[id];
      expect([...got.size]).toEqual(src.size);
      expect([...got.left.idle]).toEqual(src.left.idle);
      expect([...got.left.safe]).toEqual(src.left.safe);
      expect([...got.right.idle]).toEqual(src.right.idle);
      expect([...got.right.safe]).toEqual(src.right.safe);
      expect(got.meetY).toBe(src.meetY);
      // 楼层模块尺寸与 atlas 一致
      expect([...got.size]).toEqual([MODULES[id].width, MODULES[id].height]);
    }
  });

  it('pairing 与 envelopes', () => {
    expect(PAIRING.minClearanceX).toBe(roomLayout.pairing.minClearanceX);
    expect(PAIRING.leftStaysLeft).toBe(roomLayout.pairing.leftStaysLeft);
    expect([...PAIRING.centerSharingX]).toEqual(roomLayout.pairing.centerSharingX);
    expect([...PAIRING.greetingXs]).toEqual(roomLayout.pairing.greetingXs);
    expect([...PAIRING.workingXs]).toEqual(roomLayout.pairing.workingXs);
    expect(ENVELOPES).toEqual(roomLayout.envelopes);
  });

  it('每层两个落点位于各自安全矩形内，且间距不小于 148', () => {
    for (const id of FLOORS) {
      const { left, right } = FLOOR_SLOTS[id];
      for (const s of [left, right]) {
        const [x, y] = s.idle;
        const [x0, y0, x1, y1] = s.safe;
        expect(x >= x0 && x <= x1 && y >= y0 && y <= y1, `${id} idle in safe`).toBe(true);
      }
      expect(right.idle[0] - left.idle[0]).toBeGreaterThanOrEqual(148);
    }
  });

  it('打招呼与一起做家务的目标 x 落在各自安全矩形内，间距为 120 与 148', () => {
    const [gl, gr] = PAIRING.greetingXs;
    const [wl, wr] = PAIRING.workingXs;
    expect(gr - gl).toBe(120);
    expect(wr - wl).toBe(148);
    for (const id of FLOORS) {
      const { left, right, meetY } = FLOOR_SLOTS[id];
      for (const [x, s] of [[gl, left], [wl, left], [gr, right], [wr, right]] as const) {
        expect(x >= s.safe[0] && x <= s.safe[2], `${id} x=${x}`).toBe(true);
      }
      expect(meetY >= left.safe[1] && meetY <= left.safe[3]).toBe(true);
      expect(meetY >= right.safe[1] && meetY <= right.safe[3]).toBe(true);
    }
  });

  it('左右安全矩形在中央相遇区重合', () => {
    for (const id of FLOORS) {
      const { left, right } = FLOOR_SLOTS[id];
      expect([right.safe[0], left.safe[2]]).toEqual([...PAIRING.centerSharingX]);
    }
  });
});

describe('lobby.ts：JSON 中无对应条目的字段由实际 PNG 派生', () => {
  it('JSON 里确实没有纪念册、灯相关字段', () => {
    const text = JSON.stringify(atlas) + JSON.stringify(roomLayout);
    expect(/archive|lamp|book/i.test(text)).toBe(false);
  });

  it('archiveBook、staticLampRects、lampSlots 均为 derived（算法与逐项核对见 tests/lobby-derive.test.ts）', () => {
    expect(LOBBY.archiveBook.status).toBe('derived');
    expect(LOBBY.staticLampRects.status).toBe('derived');
    expect(LOBBY.lampSlots.status).toBe('derived');
  });
});

describe('数据文件措辞', () => {
  it('src/house/data 下不含“估算”“待定”等字样', () => {
    const base = resolve('src/house/data');
    for (const name of readdirSync(base)) {
      const text = readFileSync(resolve(base, name), 'utf8');
      for (const word of ['估算', '待定', '大概', '约略', 'TODO', 'TBD']) {
        expect(text.includes(word), `${name} contains ${word}`).toBe(false);
      }
    }
  });
});

describe('generated.ts 与 public JSON 不漂移', () => {
  it('atlas 字段逐项相等', () => {
    expect(ATLAS.logicalWidth).toBe(atlas.logicalWidth);
    expect([...ATLAS.wallAnchorsX]).toEqual(atlas.wallAnchorsX);
    expect(ATLAS.modules.map((m) => m.id)).toEqual(atlas.modules.map((m: { id: string }) => m.id));
    for (const [i, m] of atlas.modules.entries()) {
      const g = ATLAS.modules[i]!;
      expect([...g.logicalSize]).toEqual(m.logicalSize);
      expect(g.topJoin).toBe(m.topJoin);
      expect(g.bottomJoin).toBe(m.bottomJoin);
    }
  });

  it('room-layout 字段逐项相等', () => {
    expect(JSON.parse(JSON.stringify(ROOM_LAYOUT.envelopes))).toEqual(roomLayout.envelopes);
    expect(JSON.parse(JSON.stringify(ROOM_LAYOUT.pairing))).toEqual({
      minClearanceX: roomLayout.pairing.minClearanceX,
      leftStaysLeft: roomLayout.pairing.leftStaysLeft,
      centerSharingX: roomLayout.pairing.centerSharingX,
      greetingXs: roomLayout.pairing.greetingXs,
      workingXs: roomLayout.pairing.workingXs,
    });
    expect(Object.keys(ROOM_LAYOUT.floors)).toEqual(FLOORS);
    for (const id of FLOORS) {
      const g = ROOM_LAYOUT.floors[id];
      const f = roomLayout.floors[id];
      expect(JSON.parse(JSON.stringify(g))).toEqual({
        size: f.size, left: f.left, right: f.right, meetY: f.meetY,
      });
    }
  });

  it('src/ 下没有对 public/ 的 import 或 fetch', () => {
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = resolve(d, n);
        return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|jsx|mjs)$/.test(n) ? [p] : [];
      });
    for (const f of walk(resolve('src'))) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/(from|import)\s*\(?\s*['"][^'"]*\bpublic\//);
      expect(code, f).not.toMatch(/(from|import)\s*\(?\s*['"][^'"]*dollhouse\/[^'"]*\.json/);
    }
  });
});
