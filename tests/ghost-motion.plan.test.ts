import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyRightEdge, GRIP, WINDOW_LIFT, CHORE_HAPPY_AT_MS, CHORE_MS, CHORE_STARS_AT_MS, ERASE_MS, REACH, TOOL_SHIFT, VIEW_H, VIEW_W } from '../src/animation/choreography';
import { flightArc } from '../src/animation/flight';
import { BURST_LIMIT_MS, BURSTS, SPARK_MIN_MS } from '../src/animation/sparkles';
import { BODY_WIDTH, FACE_SHIFT, FACE_SHIFT_RATIO, walkSteps } from '../src/animation/walk';
import { ENVELOPES } from '../src/house/data/slots';
import { GHOST_ANCHOR, GHOST_VISUAL_SCALE } from '../src/house/ghostShape';

describe('家务编排：时长与样式时间轴一致', () => {
  const css = readFileSync('src/ghost-motion.css', 'utf8');

  it('家务约 2 秒（不超过 2 秒），橡皮擦不超过 1.5 秒', () => {
    expect(CHORE_MS).toBeGreaterThanOrEqual(1800);
    expect(CHORE_MS).toBeLessThanOrEqual(2000);
    expect(ERASE_MS).toBeLessThanOrEqual(1500);
    expect(CHORE_HAPPY_AT_MS).toBeLessThan(CHORE_MS);
    expect(CHORE_STARS_AT_MS).toBeLessThan(CHORE_MS);
  });

  it('样式里每个动作的动画时长与常量一致', () => {
    const sec = (ms: number) => `${ms / 1000}s`;
    for (const name of ['prop-sweep', 'tilt-sweep', 'hand-sweep', 'prop-water', 'tilt-water', 'hand-water', 'prop-window', 'tilt-window', 'hand-window']) {
      expect(css).toContain(`animation: ${name} ${sec(CHORE_MS)}`);
    }
    for (const name of ['prop-erase', 'tilt-erase', 'hand-erase']) expect(css).toContain(`animation: ${name} ${sec(ERASE_MS)}`);
  });
});

describe('道具与特效在身体外侧，且完全落在带道具的碰撞盒里', () => {
  const [ax, ay] = GHOST_ANCHOR;
  const env = ENVELOPES.choreWithTool;
  const envelope = [ax - env.halfWidth, ay - env.height, ax + env.halfWidth, ay] as const;

  it('viewBox 与带道具的碰撞盒一致（容器宽 140、高 180）', () => {
    expect([VIEW_W, VIEW_H]).toEqual([env.halfWidth * 2, env.height]);
  });

  for (const [kind, boxes] of Object.entries(REACH)) {
    it(`${kind}：所有活动范围都在碰撞盒内，并在身体右缘之外`, () => {
      const edge = bodyRightEdge(GHOST_VISUAL_SCALE);
      for (const [x0, y0, x1, y1] of boxes) {
        expect(x0).toBeGreaterThanOrEqual(envelope[0]);
        expect(y0).toBeGreaterThanOrEqual(envelope[1]);
        expect(x1).toBeLessThanOrEqual(envelope[2]);
        expect(y1).toBeLessThanOrEqual(envelope[3]);
        expect(x0).toBeGreaterThanOrEqual(edge);
      }
    });
  }

  it('让位 12 个单位后，身体左缘仍在碰撞盒内', () => {
    expect(ax - 54 * GHOST_VISUAL_SCALE - TOOL_SHIFT).toBeGreaterThanOrEqual(envelope[0]);
  });
});

describe('小星星编排', () => {
  it('每颗星可见时间不短于 0.9 秒（不快闪），整轮不超过上限', () => {
    for (const sparks of Object.values(BURSTS)) {
      for (const s of sparks) {
        expect(s.durMs).toBeGreaterThanOrEqual(SPARK_MIN_MS);
        expect(s.delayMs + s.durMs).toBeLessThanOrEqual(BURST_LIMIT_MS);
      }
    }
  });

  it('平时不撒粒子；事件的几颗就收，变金告别更满', () => {
    expect(BURSTS.few.length).toBeGreaterThanOrEqual(3);
    expect(BURSTS.few.length).toBeLessThanOrEqual(4);
    expect(BURSTS.chore.length).toBeGreaterThanOrEqual(2);
    expect(BURSTS.chore.length).toBeLessThanOrEqual(3);
    expect(BURSTS.full.length).toBeGreaterThan(BURSTS.few.length * 2 - 1);
  });

  it('星星（含飘散与大小）都留在 viewBox 内', () => {
    for (const sparks of Object.values(BURSTS)) {
      for (const s of sparks) {
        for (const [x, y] of [[s.x, s.y], [s.x + s.dx, s.y + s.dy]] as const) {
          expect(x - s.size).toBeGreaterThanOrEqual(0);
          expect(x + s.size).toBeLessThanOrEqual(VIEW_W);
          expect(y - s.size).toBeGreaterThanOrEqual(0);
          expect(y + s.size).toBeLessThanOrEqual(VIEW_H);
        }
      }
    }
  });
});

describe('走路时脸朝前', () => {
  it('脸挪动的距离是身体宽度的 8%–10%', () => {
    expect(FACE_SHIFT_RATIO).toBeGreaterThanOrEqual(0.08);
    expect(FACE_SHIFT_RATIO).toBeLessThanOrEqual(0.1);
    expect(FACE_SHIFT / BODY_WIDTH).toBeGreaterThanOrEqual(0.08);
    expect(FACE_SHIFT / BODY_WIDTH).toBeLessThanOrEqual(0.1);
  });

  it('向右朝右、向左朝左；垂直移动不挪', () => {
    expect(walkSteps([[0, 0], [100, 0]], 1000)).toEqual([{ atMs: 0, facing: 1 }]);
    expect(walkSteps([[100, 0], [0, 0]], 1000)).toEqual([{ atMs: 0, facing: -1 }]);
    expect(walkSteps([[0, 0], [0, 80]], 1000)).toEqual([{ atMs: 0, facing: 0 }]);
    expect(walkSteps([[0, 0], [0, -80]], 1000)).toEqual([{ atMs: 0, facing: 0 }]);
  });

  it('折线按弧长换算每一段的朝向，相邻同向的段合并', () => {
    const steps = walkSteps([[0, 0], [50, 0], [50, 50], [150, 50]], 2000);
    expect(steps).toEqual([
      { atMs: 0, facing: 1 },
      { atMs: 500, facing: 0 },
      { atMs: 1000, facing: 1 },
    ]);
    expect(walkSteps([[0, 0], [40, 0], [90, 0]], 900)).toEqual([{ atMs: 0, facing: 1 }]);
  });

  it('原地不动没有朝向计划', () => {
    expect(walkSteps([[5, 5], [5, 5]], 700)).toEqual([]);
  });
});

describe('告别：星星沿弧线飞向纪念册', () => {
  it('起点在原地、终点正好落在书上，路上向上拱起，时间轴单调', () => {
    const pts = flightArc(300, -120, 70);
    expect(pts[0]).toMatchObject({ offset: 0, x: 0, y: 0 });
    const last = pts[pts.length - 1]!;
    expect(last.offset).toBeCloseTo(1);
    expect(last.x).toBeCloseTo(300);
    expect(last.y).toBeCloseTo(-120);
    const mid = pts[Math.floor(pts.length / 2)]!;
    expect(mid.y).toBeLessThan(mid.x * (-120 / 300)); // 在直线上方
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.offset).toBeGreaterThanOrEqual(pts[i - 1]!.offset);
    expect(last.scale).toBeLessThan(pts[1]!.scale);
  });
});

describe('小手的握持点与擦窗飘高', () => {
  it('每个握持点都在道具的活动范围内，且在身体右缘之外、碰撞盒之内', () => {
    for (const [kind, [x, y]] of Object.entries(GRIP)) {
      const boxes = REACH[kind as keyof typeof REACH];
      expect(boxes.some(([x0, y0, x1, y1]) => x >= x0 - 8 && x <= x1 && y >= y0 - 6 && y <= y1 + 6)).toBe(true);
      expect(x).toBeGreaterThan(bodyRightEdge(GHOST_VISUAL_SCALE) - 4);
      expect(x).toBeLessThan(VIEW_W);
      expect(y).toBeGreaterThan(0);
    }
  });

  it('握持点比手的静止位置（约 y=137）高得多：手臂真的抬起来', () => {
    for (const [, [, y]] of Object.entries(GRIP)) expect(137 - y).toBeGreaterThan(20);
  });

  it('擦窗时身体飘高，窗口顶部与飘高后的头顶、呆毛都在 viewBox 内', () => {
    expect(WINDOW_LIFT).toBeGreaterThanOrEqual(8);
    expect(180 - (180 - 22) * 0.97 * GHOST_VISUAL_SCALE - WINDOW_LIFT).toBeGreaterThan(0);
    expect(REACH.window[0]![1]).toBeGreaterThanOrEqual(0);
  });
});
