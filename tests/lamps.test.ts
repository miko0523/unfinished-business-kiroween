import { describe, expect, it } from 'vitest';
import { decodePng } from './helpers/png';
import { lampsFor } from '../src/domain/house';
import { LAMP_SLOT_COUNT, LOBBY, STATIC_LAMP_COUNT } from '../src/house/data/lobby';
import { LANTERN_ASPECT, LANTERN_PATH, lanternSrc } from '../src/house/assets';

describe('灯笼组件（派生素材）', () => {
  const png = decodePng('public/assets/dollhouse/components/lantern.png');
  it('64×96 的透明 PNG：四角透明，灯身不透明', () => {
    expect([png.width, png.height]).toEqual([64, 96]);
    const a = (x: number, y: number) => png.data[(y * png.width + x) * 4 + 3]!;
    for (const [x, y] of [[0, 0], [63, 0], [0, 95], [63, 95]] as const) expect(a(x, y)).toBe(0);
    expect(a(32, 38)).toBeGreaterThan(240);
    let transparent = 0;
    for (let i = 3; i < png.data.length; i += 4) if (png.data[i]! < 10) transparent++;
    expect(transparent / (png.width * png.height)).toBeGreaterThan(0.2);
  });

  it('路径与宽高比固定，且在相对基路径下保持相对', () => {
    expect(LANTERN_PATH).toBe('assets/dollhouse/components/lantern.png');
    expect(LANTERN_ASPECT).toBeCloseTo(2 / 3, 6);
    expect(lanternSrc('./')).toBe('./assets/dollhouse/components/lantern.png');
    expect(lanternSrc('/unfinished-business/')).toBe('/unfinished-business/assets/dollhouse/components/lantern.png');
  });
});

describe('暖灯数量与位置', () => {
  it('lampsFor 单调、最多 12、第 13 次仍是 12', () => {
    let prev = 0;
    for (let n = 0; n <= 40; n++) {
      const v = lampsFor(n);
      expect(v).toBe(Math.min(12, n));
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(lampsFor(13)).toBe(12);
  });

  it('12 个灯位：前 3 个叠在原画灯笼上，后 9 个是挂墙灯笼', () => {
    if (LOBBY.lampSlots.status !== 'derived') throw new Error('not derived');
    const slots = LOBBY.lampSlots.slots;
    expect(slots).toHaveLength(LAMP_SLOT_COUNT);
    expect(slots.filter((s) => s.kind === 'static-lantern')).toHaveLength(STATIC_LAMP_COUNT);
    expect(slots.slice(0, STATIC_LAMP_COUNT).every((s) => s.kind === 'static-lantern')).toBe(true);
    expect(slots.slice(STATIC_LAMP_COUNT).every((s) => s.kind === 'hung-lantern')).toBe(true);
  });
});
