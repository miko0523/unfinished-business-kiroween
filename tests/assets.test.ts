import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MODULE_IDS,
  assetPath,
  createLoadFailureTracker,
  floorModuleForFloor,
  pendingFloorModules,
  sizesFor,
  srcFor,
  srcsetFor,
} from '../src/house/assets';
import { layoutHouse } from '../src/house/layout';

const PUBLIC = resolve('public');

describe('floorModuleForFloor', () => {
  it('楼层 2 至 6 映射到 floor-01 至 floor-05', () => {
    expect([2, 3, 4, 5, 6].map(floorModuleForFloor)).toEqual(['floor-01', 'floor-02', 'floor-03', 'floor-04', 'floor-05']);
  });

  it('范围外抛出 RangeError', () => {
    for (const f of [0, 1, 7, 2.5, Number.NaN]) expect(() => floorModuleForFloor(f)).toThrow(RangeError);
  });
});

describe('pendingFloorModules', () => {
  it('列出还没长出的楼层模块，按长出顺序；六层时为空', () => {
    expect(pendingFloorModules(2)).toEqual(['floor-02', 'floor-03', 'floor-04', 'floor-05']);
    expect(pendingFloorModules(3)).toEqual(['floor-03', 'floor-04', 'floor-05']);
    expect(pendingFloorModules(5)).toEqual(['floor-05']);
    expect(pendingFloorModules(6)).toEqual([]);
  });
  it('与 layoutHouse 的显示互补：已显示的楼层模块加上待长的，恰好是全部五个', () => {
    for (let grown = 2; grown <= 6; grown++) {
      const shown = layoutHouse(grown).modules.map((m) => m.id).filter((id) => id.startsWith('floor-'));
      expect([...shown, ...pendingFloorModules(grown)]).toEqual(['floor-01', 'floor-02', 'floor-03', 'floor-04', 'floor-05']);
    }
  });
});

describe('srcsetFor', () => {
  it('1x 加 801w，2x 加 1602w，路径由 base 拼接', () => {
    expect(srcsetFor('lobby', './')).toBe(
      './assets/dollhouse/1x/lobby.png 801w, ./assets/dollhouse/2x/lobby.png 1602w',
    );
    expect(srcsetFor('floor-03', '/unfinished-business/')).toBe(
      '/unfinished-business/assets/dollhouse/1x/floor-03.png 801w, /unfinished-business/assets/dollhouse/2x/floor-03.png 1602w',
    );
  });

  it('base 缺少结尾斜杠时补上；base 为 ./ 时保持相对路径', () => {
    expect(srcFor('roof', '.')).toBe('./assets/dollhouse/1x/roof.png');
    for (const id of MODULE_IDS) {
      expect(srcsetFor(id, './').split(', ').every((part) => part.startsWith('./'))).toBe(true);
    }
  });

  it('sizes 为当前舞台宽度', () => {
    expect(sizesFor(375)).toBe('375px');
  });
});

describe('加载失败标志', () => {
  it('按模块记录，互不影响', () => {
    const t = createLoadFailureTracker();
    expect(t.failedIds()).toEqual([]);
    t.markFailed('floor-02');
    expect(t.hasFailed('floor-02')).toBe(true);
    expect(t.hasFailed('floor-01')).toBe(false);
    expect(t.failedIds()).toEqual(['floor-02']);
  });
});

describe('素材文件存在性', () => {
  it('每个模块的 1x 与 2x 文件都在 public 下', () => {
    for (const id of MODULE_IDS) {
      for (const scale of [1, 2] as const) {
        expect(existsSync(resolve(PUBLIC, assetPath(id, scale))), `${id} @${scale}x`).toBe(true);
      }
    }
  });

  it('public/assets/dollhouse 恰好 17 个文件：16 个布景与数据，加 1 个派生的灯笼组件', () => {
    const count = (dir: string): number =>
      readdirSync(dir, { withFileTypes: true }).reduce(
        (n, e) => n + (e.isDirectory() ? count(resolve(dir, e.name)) : 1),
        0,
      );
    expect(count(resolve(PUBLIC, 'assets/dollhouse'))).toBe(17);
    expect(existsSync(resolve(PUBLIC, 'assets/dollhouse/components/lantern.png'))).toBe(true);
  });
});
