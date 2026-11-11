// @vitest-environment happy-dom
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { StaticLayer, type StaticLayerProps } from '../src/components/StaticLayer';
import { layoutHouse } from '../src/house/layout';
import { STAGE_WIDTH, stageBoxes } from '../src/house/stage';

afterEach(cleanup);

describe('StaticLayer', () => {
  it('入参类型只有 grownFloors（读不到任何 Task 数据）', () => {
    expectTypeOf<keyof StaticLayerProps>().toEqualTypeOf<'grownFloors'>();
  });

  it('grownFloors=6 时按 lobby、floor-01…05、roof 的顺序渲染 7 张图', () => {
    const { container } = render(<StaticLayer grownFloors={6} />);
    const ids = [...container.querySelectorAll('img')].map((i) => i.getAttribute('data-module'));
    expect(ids).toEqual(['lobby', 'floor-01', 'floor-02', 'floor-03', 'floor-04', 'floor-05', 'roof']);
  });

  it('图片属性：alt 为空、aria-hidden、带宽高与 srcset/sizes', () => {
    const { container } = render(<StaticLayer grownFloors={6} />);
    for (const img of container.querySelectorAll('img')) {
      expect(img.getAttribute('alt')).toBe('');
      expect(img.getAttribute('aria-hidden')).toBe('true');
      expect(img.getAttribute('width')).toBeTruthy();
      expect(img.getAttribute('height')).toBeTruthy();
      expect(img.getAttribute('srcset')).toMatch(/801w, .* 1602w$/);
      expect(img.getAttribute('sizes')).toBeTruthy();
    }
  });

  it('盒子位置取自 layoutHouse：百分比与舞台盒子一致，且不带滤镜或透明度', () => {
    const layout = layoutHouse(6);
    const boxes = stageBoxes(layout);
    const { container } = render(<StaticLayer grownFloors={6} />);
    const imgs = [...container.querySelectorAll('img')];
    imgs.forEach((img, i) => {
      const b = boxes[i]!;
      expect(img.style.left).toBe(`${(b.x / STAGE_WIDTH) * 100}%`);
      expect(img.style.top).toBe(`${(b.y / layout.stageHeight) * 100}%`);
      expect(img.style.filter).toBe('');
      expect(img.style.opacity).toBe('');
    });
  });

  it('相同 grownFloors 渲染出逐字相同的子树', () => {
    const a = render(<StaticLayer grownFloors={4} />).container.innerHTML;
    cleanup();
    const b = render(<StaticLayer grownFloors={4} />).container.innerHTML;
    expect(a).toBe(b);
  });

  it('某张图加载失败：换成纯色底板，其余图片不受影响，不抛异常', () => {
    const { container } = render(<StaticLayer grownFloors={3} />);
    const lobby = container.querySelector('img[data-module="lobby"]')!;
    fireEvent.error(lobby);
    expect(container.querySelector('img[data-module="lobby"]')).toBeNull();
    expect(container.querySelector('[data-module="lobby"][data-failed="true"]')).not.toBeNull();
    expect(container.querySelectorAll('img')).toHaveLength(3);
  });
});
