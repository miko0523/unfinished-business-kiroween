import { describe, expect, it } from 'vitest';
import { layoutHouse } from '../src/house/layout';
import { MODULES } from '../src/house/data/modules';
import { STAGE_WIDTH, stageBoxes } from '../src/house/stage';

describe('stageBoxes', () => {
  it('屋顶顶边为 0，门厅底边为舞台高度，盒子都在舞台内', () => {
    for (let n = 2; n <= 6; n++) {
      const layout = layoutHouse(n);
      const boxes = stageBoxes(layout);
      expect(boxes[boxes.length - 1]!.y).toBe(0);
      const lobby = boxes[0]!;
      expect(lobby.y + lobby.h).toBe(layout.stageHeight);
      for (const b of boxes) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(STAGE_WIDTH);
        expect(b.y).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('相邻模块的 join 线在舞台坐标里重合', () => {
    const boxes = stageBoxes(layoutHouse(6));
    for (let i = 1; i < boxes.length; i++) {
      const lower = boxes[i - 1]!;
      const upper = boxes[i]!;
      expect(upper.y + MODULES[upper.id].bottomJoin).toBe(lower.y + MODULES[lower.id].topJoin);
    }
  });
});
