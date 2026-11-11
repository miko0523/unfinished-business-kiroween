import { BURSTS, type BurstKind } from '../animation/sparkles';
import type { PlayKind } from './useGhostPlays';

/** 四角小星（单位大小，用 scale 放缩）。 */
export const STAR_PATH = 'M0 -1 C0.14 -0.32 0.32 -0.14 1 0 C0.32 0.14 0.14 0.32 0 1 C-0.14 0.32 -0.32 0.14 -1 0 C-0.32 -0.14 -0.14 -0.32 0 -1 Z';

export interface Burst {
  kind: BurstKind;
  /** 第几轮（用作 key：新的一轮整体换新）。 */
  n: number;
}

/** 小星星：淡入、飘散、淡出。全部在身体外围，纯装饰。 */
export function BurstFx({ burst }: { burst: Burst | null }) {
  if (!burst) return null;
  return (
    <g class="fx-burst" key={burst.n} data-burst={burst.kind}>
      {BURSTS[burst.kind].map((s, i) => (
        <g key={i} transform={`translate(${s.x} ${s.y})`}>
          <g class="fx-star" style={`--dx:${s.dx}px;--dy:${s.dy}px;animation-delay:${s.delayMs}ms;animation-duration:${s.durMs}ms`}>
            <path d={STAR_PATH} transform={`scale(${s.size})`} />
          </g>
        </g>
      ))}
    </g>
  );
}

function Sweep() {
  // 地上扬起的几粒灰（扫完变成小星星，由 chore 星星接上）
  const dust = [[112, 171], [119, 173], [127, 172], [133, 170], [122, 167], [130, 174]] as const;
  return (
    <g class="fx-scene fx-sweep">
      {dust.map(([x, y], i) => (
        <circle key={i} class="fx-dust" cx={x} cy={y} r="1.8" style={`animation-delay:${420 + i * 130}ms`} />
      ))}
    </g>
  );
}

function Water() {
  return (
    <g class="fx-scene fx-water">
      <g class="fx-pot">
        <path d="M122 154 L138 154 L136 175 L124 175 Z" fill="#B5584A" stroke="#7A3A30" stroke-width="1.6" stroke-linejoin="round" />
        <rect x="120.5" y="150" width="19" height="5.5" rx="1.8" fill="#C96A5A" stroke="#7A3A30" stroke-width="1.4" />
      </g>
      {[0, 1, 2].map((i) => (
        <ellipse key={i} class="fx-drop" cx="134" cy="121" rx="1.9" ry="3" style={`animation-delay:${560 + i * 220}ms`} />
      ))}
      <g class="fx-sprout">
        <path d="M130 150 L130 137" stroke="#4E8A55" stroke-width="2.4" stroke-linecap="round" fill="none" />
        <ellipse cx="125.5" cy="137" rx="5" ry="2.6" transform="rotate(-25 125.5 137)" fill="#7BBF6A" stroke="#4E8A55" stroke-width="1" />
        <ellipse cx="134.5" cy="135" rx="5" ry="2.6" transform="rotate(25 134.5 135)" fill="#7BBF6A" stroke="#4E8A55" stroke-width="1" />
      </g>
    </g>
  );
}

function Window() {
  return (
    <g class="fx-scene fx-window">
      <rect x="108" y="48" width="28" height="50" rx="3" fill="#2F3C66" fill-opacity="0.8" stroke="#A8743F" stroke-width="2.5" />
      <path d="M122 49 V97 M109 73 H135" stroke="#A8743F" stroke-width="1.6" fill="none" />
      <ellipse class="fx-ring fx-ring-1" cx="122" cy="74" rx="9" ry="8" fill="none" stroke="#FFFFFF" stroke-width="1.6" />
      <ellipse class="fx-ring fx-ring-2" cx="122" cy="74" rx="5.5" ry="5" fill="none" stroke="#FFFFFF" stroke-width="1.6" />
      <path class="fx-glint" d="M112 94 L132 52" stroke="#F4F7FF" stroke-width="2.6" stroke-linecap="round" fill="none" />
    </g>
  );
}

function Crumbs() {
  const crumbs = [[113, 121, 0], [120, 122, 70], [116, 121, 560], [124, 122, 640]] as const;
  return (
    <g class="fx-scene fx-erase">
      {crumbs.map(([x, y, d], i) => (
        <circle key={i} class="fx-crumb" cx={x} cy={y} r="1.7" style={`animation-delay:${280 + d}ms`} />
      ))}
    </g>
  );
}

/** 家务与橡皮擦的场景与特效：都在身体外侧；新动作整体换新（key 在调用处）。 */
export function ChoreFx({ kind }: { kind: PlayKind | null }) {
  switch (kind) {
    case 'sweep':
      return <Sweep />;
    case 'water':
      return <Water />;
    case 'window':
      return <Window />;
    case 'erase':
      return <Crumbs />;
    default:
      return null;
  }
}
