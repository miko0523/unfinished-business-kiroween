import { WIDE_MIN } from '../house/viewport';
import { useViewport } from './useViewport';

// 夜空：深蓝渐变、静态星点、月亮、两侧远处树影、几只慢慢飘的萤火。全部用代码画（CSS 与 SVG），没有位图，没有文字。
// 星点位置是一张固定的表（由简单的线性同余生成，一次性算好），所以每次渲染都一样，不闪烁。

const STAR_COUNT = 46;
const STARS: readonly { x: number; y: number; r: number; o: number }[] = (() => {
  let seed = 20261108;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  return Array.from({ length: STAR_COUNT }, () => ({ x: next() * 100, y: next() * 70, r: 0.5 + next() * 0.9, o: 0.4 + next() * 0.5 }));
})();

/** 萤火：位置、漂移幅度与周期（秒）。单颗周期都不短于 6 秒。 */
const FIREFLIES: readonly { x: number; y: number; dx: number; dy: number; s: number; delay: number }[] = [
  { x: 8, y: 62, dx: 36, dy: -30, s: 11, delay: 0 },
  { x: 90, y: 58, dx: -34, dy: -26, s: 13, delay: -4 },
  { x: 14, y: 80, dx: 28, dy: -40, s: 9, delay: -2 },
  { x: 84, y: 76, dx: -30, dy: -34, s: 12, delay: -7 },
  { x: 5, y: 44, dx: 24, dy: 28, s: 10, delay: -5 },
  { x: 94, y: 40, dx: -22, dy: 30, s: 14, delay: -1 },
  { x: 20, y: 90, dx: 40, dy: -22, s: 8, delay: -3 },
  { x: 78, y: 92, dx: -38, dy: -20, s: 10, delay: -6 },
  { x: 3, y: 70, dx: 18, dy: -44, s: 12, delay: -8 },
  { x: 97, y: 66, dx: -16, dy: -42, s: 9, delay: -9 },
];

export const FIREFLIES_WIDE = 10;
export const FIREFLIES_NARROW = 4;

function Trees({ side }: { side: 'left' | 'right' }) {
  // 远处的树影：几层深色的圆润树冠剪影，贴着屏幕两侧，比夜空略深。
  return (
    <svg class={`sky-trees sky-trees-${side}`} viewBox="0 0 120 400" preserveAspectRatio="xMidYMax slice" focusable="false">
      <g fill="#111b35">
        <rect x="54" y="170" width="8" height="230" />
        <ellipse cx="58" cy="150" rx="40" ry="62" />
        <ellipse cx="34" cy="230" rx="30" ry="50" />
        <ellipse cx="86" cy="260" rx="28" ry="46" />
        <rect x="22" y="260" width="6" height="140" />
        <rect x="84" y="290" width="6" height="110" />
      </g>
    </svg>
  );
}

export function Sky() {
  const { w } = useViewport();
  const wide = w >= WIDE_MIN;
  const count = wide ? FIREFLIES_WIDE : FIREFLIES_NARROW;
  return (
    <div class="sky" aria-hidden="true">
      <svg class="sky-stars" viewBox="0 0 100 70" preserveAspectRatio="none" focusable="false">
        {STARS.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r * 0.18} fill="#fff6d8" opacity={s.o} />
        ))}
      </svg>
      <div class="sky-moon" />
      {wide ? (
        <>
          <Trees side="left" />
          <Trees side="right" />
        </>
      ) : null}
      {FIREFLIES.slice(0, count).map((f, i) => (
        <span
          key={i}
          class="firefly"
          style={`left:${f.x}%;top:${f.y}%;--dx:${f.dx}px;--dy:${f.dy}px;animation-duration:${f.s}s;animation-delay:${f.delay}s`}
        />
      ))}
    </div>
  );
}
