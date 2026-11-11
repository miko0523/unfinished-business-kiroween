// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cleanup, render } from '@testing-library/preact';
import { GhostSprite } from '../src/components/GhostSprite';
import { BODY_PATH, BLUSH, EYE, GHOST_VISUAL_SCALE, WISP_PATH, ghostOutlinePath } from '../src/house/ghostShape';
import { ghostPaint } from '../src/house/paint';
import type { GhostState } from '../src/domain/types';

afterEach(cleanup);
const ratio = fc.double({ min: 0, max: 1, noNaN: true });

describe('Feature: unfinished-business, Property 24: 进度外观单调且金光唯一', () => {
  it('Green 的饱和度与光晕随 ratio 单调不减', () => {
    fc.assert(
      fc.property(ratio, ratio, (a, b) => {
        const [r1, r2] = a <= b ? [a, b] : [b, a];
        const p1 = ghostPaint('green', r1, false);
        const p2 = ghostPaint('green', r2, false);
        expect(p2.saturation).toBeGreaterThanOrEqual(p1.saturation);
        expect(p2.glowOpacity).toBeGreaterThanOrEqual(p1.glowOpacity);
      }),
      { numRuns: 200 },
    );
  });

  it('Pending 不弱于任何未 Pending 的 Green，且只有 Pending 有金边与金牌', () => {
    fc.assert(
      fc.property(ratio, fc.constantFrom<GhostState>('gray', 'white', 'green', 'gold'), fc.boolean(), (r, state, pending) => {
        const p = ghostPaint(state, r, pending);
        const isPending = state === 'green' && pending;
        expect(p.goldRing).toBe(isPending);
        expect(p.medal).toBe(isPending);
        expect(p.scale).toBeGreaterThanOrEqual(0.9);
        expect(p.scale).toBeLessThanOrEqual(1);
        const green = ghostPaint('green', r, false);
        if (isPending) {
          expect(p.saturation).toBeGreaterThanOrEqual(green.saturation);
          expect(p.glowOpacity).toBeGreaterThanOrEqual(green.glowOpacity);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('四个状态使用同一 BODY_PATH，眼睛之外无嘴无鼻，呆毛都在', () => {
    const states: GhostState[] = ['gray', 'white', 'green', 'gold'];
    for (const state of states) {
      const { container, unmount } = render(<GhostSprite paint={ghostPaint(state, 0.5, false)} />);
      expect(container.querySelector('.ghost-body')?.getAttribute('d')).toBe(BODY_PATH);
      expect(container.querySelector('.ghost-wisp')).not.toBeNull();
      expect(container.querySelectorAll('.ghost-outline')).toHaveLength(1);
      expect(container.querySelector('.ghost-skirt, .ghost-hem')).toBeNull();
      expect(container.querySelectorAll('.ghost-hand')).toHaveLength(2);
      expect(container.querySelector('image')).toBeNull();
      unmount();
    }
  });

  it('Gray 的不透明度为 0.85、缩放 0.90；Gold 缩放 1.00', () => {
    expect(ghostPaint('gray', 0, false).opacity).toBe(0.85);
    expect(ghostPaint('gray', 0, false).scale).toBe(0.9);
    expect(ghostPaint('gold', 1, false).scale).toBe(1);
  });

  it('装饰用 Ghost 对辅助技术隐藏，独立 Ghost 带名称', () => {
    const a = render(<GhostSprite paint={ghostPaint('white', 0, false)} />);
    expect(a.container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    a.unmount();
    const b = render(<GhostSprite paint={ghostPaint('white', 0, false)} label="A ghost, ready to start" />);
    expect(b.container.querySelector('svg')?.getAttribute('role')).toBe('img');
    expect(b.container.querySelector('svg')?.getAttribute('aria-label')).toBe('A ghost, ready to start');
  });
});

describe('概念稿对照：四态颜色、光晕、更大的眼睛与更小的视觉尺寸', () => {
  it('四态以概念稿颜色为基准；Green 在 ratio=0 时正好是 #BCD7B4', () => {
    expect(ghostPaint('gray', 0, false).fill).toBe('#B8C1CB');
    expect(ghostPaint('white', 0, false).fill).toBe('#F6F1E4');
    expect(ghostPaint('gold', 1, false).fill).toBe('#F2D27E');
    // hsl(106, 30%, 77.5%) → rgb(188, 215, 180) 即 #BCD7B4
    expect(ghostPaint('green', 0, false).fill).toBe('hsl(106, 30%, 77.5%)');
  });

  it('光晕逐级变强：Gray 无光晕 < White < 未完成的 Green 起点 < Green 满 = Pending < Gold', () => {
    const gray = ghostPaint('gray', 0, false).glowOpacity;
    const white = ghostPaint('white', 0, false).glowOpacity;
    const green0 = ghostPaint('green', 0, false).glowOpacity;
    const green1 = ghostPaint('green', 1, false).glowOpacity;
    const pending = ghostPaint('green', 1, true).glowOpacity;
    const gold = ghostPaint('gold', 1, false).glowOpacity;
    expect(gray).toBe(0);
    expect(white).toBeGreaterThanOrEqual(0.3);
    expect(green0).toBeGreaterThan(0.2);
    expect(green1).toBeGreaterThan(green0 + 0.3);
    expect(pending).toBe(green1);
    expect(gold).toBeGreaterThan(pending);
  });

  it('相邻状态的填充互不相同，描边比填充更深', () => {
    const fills = (['gray', 'white', 'green', 'gold'] as GhostState[]).map((st) => ghostPaint(st, 0.5, false).fill);
    expect(new Set(fills).size).toBe(4);
  });

  it('眼睛比概念稿再大一档：纯深色竖椭圆，无高光、无嘴无鼻', () => {
    expect(EYE.ry).toBeGreaterThan(EYE.rx);
    expect(EYE.ry).toBeGreaterThanOrEqual(9);
    const { container } = render(<GhostSprite paint={ghostPaint('white', 0, false)} expression="shy" />);
    const eyes = container.querySelectorAll('.ghost-eyes ellipse');
    expect(eyes).toHaveLength(2);
    for (const e of eyes) expect(Number(e.getAttribute('ry'))).toBe(EYE.ry);
    expect(container.querySelectorAll('.ghost-eyes circle')).toHaveLength(0);
    expect(container.querySelector('.ghost-mouth')).toBeNull();
    expect(container.querySelectorAll('.ghost-blush ellipse')).toHaveLength(2);
    expect(BLUSH.left).toBeLessThan(EYE.left);
  });

  it('整体视觉尺寸约为第一版的 82–86%（Gold，含身体比第一版略窄）', () => {
    const oldBody = { w: 112, h: 137 };
    const body = { w: 124 - 16, h: 176 - 46 };
    expect(GHOST_VISUAL_SCALE * body.w / oldBody.w).toBeGreaterThan(0.82);
    expect(GHOST_VISUAL_SCALE * body.w / oldBody.w).toBeLessThan(0.87);
    expect(GHOST_VISUAL_SCALE * body.h / oldBody.h).toBeGreaterThan(0.8);
    expect(GHOST_VISUAL_SCALE * body.h / oldBody.h).toBeLessThan(0.87);
    const { container } = render(<GhostSprite paint={ghostPaint('gold', 1, false)} />);
    const t = container.querySelector('.ghost-figure')?.getAttribute('transform') ?? '';
    expect(t).toContain(`scale(${GHOST_VISUAL_SCALE})`);
  });

  it('身体与四瓣裙边是一条闭合轮廓，行走只改下摆点且全部留在 viewBox 内', () => {
    const nums = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    expect(BODY_PATH.endsWith('Z')).toBe(true);
    expect(ghostOutlinePath(1)).not.toBe(BODY_PATH);
    expect(ghostOutlinePath(-1)).not.toBe(BODY_PATH);
    for (const d of [ghostOutlinePath(-1), BODY_PATH, ghostOutlinePath(1), WISP_PATH.replace(/A[^\s]+ [^\s]+ \d \d \d/, 'L')]) {
      const v = nums(d.replace(/[A-Za-z]/g, ' '));
      for (let i = 0; i < v.length; i += 2) {
        expect(v[i]).toBeGreaterThanOrEqual(0);
        expect(v[i]).toBeLessThanOrEqual(140);
        expect(v[i + 1]).toBeGreaterThanOrEqual(0);
        expect(v[i + 1]).toBeLessThanOrEqual(180);
      }
    }
    // 三个方向的腰线端点完全相同，只有 y>154 的下摆点改变。
    for (const d of [ghostOutlinePath(-1), BODY_PATH, ghostOutlinePath(1)]) {
      expect(d.startsWith('M16 154 C16 118 20 46 70 46 C120 46 124 118 124 154')).toBe(true);
      expect(d.endsWith('16 154 Z')).toBe(true);
    }
    // 呆毛末端是一个近乎闭合的圆环（大弧）
    expect(WISP_PATH).toMatch(/A\d+ \d+ 0 1 1/);
    const { container } = render(<GhostSprite paint={ghostPaint('white', 0, false)} />);
    for (const h of container.querySelectorAll('.ghost-hand ellipse')) {
      expect(Number(h.getAttribute('rx'))).toBeLessThanOrEqual(7);
      expect(Math.abs(Number(h.getAttribute('cx')) - 70)).toBeGreaterThanOrEqual(54);
    }
  });
});
