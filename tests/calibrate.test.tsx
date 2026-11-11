// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { LobbyOverlay } from '../src/dev/calibrate/Calibrate';
import { findGlowRegions } from '../src/dev/calibrate/glow';
import { LOBBY, type LobbyAnchors } from '../src/house/data/lobby';

afterEach(cleanup);

const base = { id: 'lobby' as const, x: 4, y: 100, w: 801, h: 282 };

describe('findGlowRegions（合成像素）', () => {
  it('按亮度、透明度与面积筛选四连通亮块', () => {
    const w = 20;
    const h = 10;
    const data = new Uint8ClampedArray(w * h * 4);
    const put = (x: number, y: number, v: number, a = 255) => data.set([v, v, v, a], (y * w + x) * 4);
    for (let y = 1; y < 4; y++) for (let x = 2; x < 6; x++) put(x, y, 255); // 12 像素
    for (let y = 5; y < 8; y++) for (let x = 10; x < 15; x++) put(x, y, 230); // 15 像素
    put(18, 8, 255); // 太小
    for (let y = 0; y < 3; y++) for (let x = 15; x < 19; x++) put(x, y, 255, 100); // 半透明
    const r = findGlowRegions({ width: w, height: h, data }, { minArea: 10 });
    expect(r).toEqual([
      { x0: 2, y0: 1, x1: 5, y1: 3, area: 12 },
      { x0: 10, y0: 5, x1: 14, y1: 7, area: 15 },
    ]);
  });
});

describe('LobbyOverlay', () => {
  it('真实 LOBBY：画出纪念册热区与锚点、3 个静态灯框、12 个暖灯位，没有“未派生”标记', () => {
    const { container } = render(<LobbyOverlay base={base} stageHeight={600} lobby={LOBBY} />);
    expect(container.querySelector('[data-debug="archive-hit"]')).not.toBeNull();
    expect(container.querySelector('[data-debug="archive-point"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-debug="static-lamp-rect"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-debug="lamp-slot"]')).toHaveLength(12);
    expect(container.querySelector('[data-debug="missing"]')).toBeNull();
  });

  it('三项都是 missing 时：只画“未派生”标记，不画任何点或灯位', () => {
    const none: LobbyAnchors = {
      archiveBook: { status: 'missing' },
      staticLampRects: { status: 'missing' },
      lampSlots: { status: 'missing' },
    };
    const { container } = render(<LobbyOverlay base={base} stageHeight={600} lobby={none} />);
    const missing = [...container.querySelectorAll('[data-debug="missing"]')].map((e) => e.getAttribute('data-item'));
    expect(missing).toEqual(['archiveBook', 'staticLampRects', 'lampSlots']);
    expect(container.querySelectorAll('[data-debug="lamp-slot"]')).toHaveLength(0);
    expect(container.querySelector('[data-debug="archive-point"]')).toBeNull();
  });

  it('派生后的数据（仅用于测试渲染路径的合成值）会画出 12 个编号灯位、纪念册与静态灯框', () => {
    const synthetic: LobbyAnchors = {
      archiveBook: { status: 'derived', x: 100, y: 100, hit: [78, 78, 122, 122] },
      staticLampRects: { status: 'derived', rects: [[10, 10, 30, 40]] },
      lampSlots: {
        status: 'derived',
        slots: Array.from({ length: 12 }, (_, i) => ({ x: 40 + i * 30, y: 200, kind: 'hung-lantern' as const })),
      },
    };
    const { container } = render(<LobbyOverlay base={base} stageHeight={600} lobby={synthetic} />);
    expect([...container.querySelectorAll('[data-debug="lamp-slot"]')].map((e) => e.textContent)).toEqual(
      Array.from({ length: 12 }, (_, i) => String(i + 1)),
    );
    expect(container.querySelector('[data-debug="archive-hit"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-debug="static-lamp-rect"]')).toHaveLength(1);
    expect(container.querySelector('[data-debug="missing"]')).toBeNull();
  });
});
