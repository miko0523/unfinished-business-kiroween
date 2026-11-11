import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';
import { Prop } from './GhostProp';
import {
  BLUSH, EYE, GHOST_ANCHOR, GHOST_VISUAL_SCALE, GHOST_VIEWBOX, HANDS, SHOULDERS, WISP_PATH, ghostOutlinePath,
  type Expression, type PropKind, type WalkDirection,
} from '../house/ghostShape';
import type { Paint } from '../house/paint';
import type { GhostKind } from '../domain/types';
import { CarriedLantern, LanternCrown } from './LanternAccessories';

export interface GhostSpriteProps {
  ghostKind?: GhostKind;
  paint: Paint;
  expression?: Expression;
  prop?: PropKind;
  /** 两只手围绕肩点的旋转角度（度）。 */
  leftHand?: number;
  rightHand?: number;
  /** 水平行走方向；只改变闭合轮廓腰线以下的波浪点。 */
  walk?: WalkDirection;
  /** 提供时作为独立图形（role="img"）；缺省时对辅助技术隐藏。 */
  label?: string;
  /** 外加的装饰（场景、小星星）：画在最上层、身体外围，对辅助技术隐藏。 */
  children?: ComponentChildren;
  /** 道具背后的场景（花盆、小窗、灰、水滴）：画在道具之下。 */
  scene?: ComponentChildren;
}

function Eyes({ expression, lantern }: { expression: Expression; lantern: boolean }) {
  const { left: L, right: R, y, rx, ry } = EYE;
  const ink = lantern ? '#FFFFFF' : EYE.ink;
  switch (expression) {
    case 'surprised':
      return (<g fill={ink}><ellipse cx={L} cy={y} rx={rx + 1} ry={ry + 1.5} /><ellipse cx={R} cy={y} rx={rx + 1} ry={ry + 1.5} /></g>);
    case 'puzzled':
      return (
        <g fill={ink}>
          <ellipse cx={L} cy={y + 1} rx={rx - 1} ry={ry - 2.5} />
          <ellipse cx={R} cy={y - 1} rx={rx} ry={ry} />
        </g>
      );
    case 'focused':
      return (<g fill={ink}><ellipse cx={L} cy={y + 1} rx={rx} ry={ry - 4.5} /><ellipse cx={R} cy={y + 1} rx={rx} ry={ry - 4.5} /></g>);
    case 'happy':
      return (
        <g fill="none" stroke={ink} stroke-width="3.6" stroke-linecap="round">
          <path d={`M${L - 6} ${y + 3} Q${L} ${y - 8} ${L + 6} ${y + 3}`} />
          <path d={`M${R - 6} ${y + 3} Q${R} ${y - 8} ${R + 6} ${y + 3}`} />
        </g>
      );
    case 'relieved':
      return (
        <g fill="none" stroke={ink} stroke-width="3.6" stroke-linecap="round">
          <path d={`M${L - 6} ${y} Q${L} ${y + 7} ${L + 6} ${y}`} />
          <path d={`M${R - 6} ${y} Q${R} ${y + 7} ${R + 6} ${y}`} />
        </g>
      );
    case 'shy':
    default:
      return (<g fill={ink}><ellipse cx={L} cy={y} rx={rx} ry={ry} /><ellipse cx={R} cy={y} rx={rx} ry={ry} /></g>);
  }
}

/**
 * 原创 SVG 小幽灵（仅 SVG/CSS，不用位图）。分层自下而上：
 * halo → skirt → body → blush → eyes → wisp → leftHand / rightHand → ring / medal；道具与特效在身体外侧，另成一层（不随身体倾斜）。
 * 无嘴无鼻；情绪只由眼睛表达。
 */
export function GhostSprite({ paint, ghostKind = 'ordinary', expression = 'shy', prop = 'none', leftHand = 0, rightHand = 0, walk = 0, label, children, scene }: GhostSpriteProps) {
  const uid = useId();
  const gradId = `halo-${uid}`;
  const [ax, ay] = GHOST_ANCHOR;
  const lantern = ghostKind === 'lantern';
  const fill = lantern ? '#F4813B' : paint.fill;
  const stroke = lantern ? '#FFFFFF' : paint.stroke;
  const sw = paint.strokeWidth;
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': 'true' as const };

  return (
    <svg class="ghost-sprite" viewBox={GHOST_VIEWBOX} focusable="false" data-kind={ghostKind} data-tool={prop !== 'none' ? 'true' : undefined} {...a11y}>
      <defs>
        <radialGradient id={gradId}>
          <stop offset="0" stop-color={paint.glowColor} stop-opacity={paint.glowOpacity} />
          <stop offset="1" stop-color={paint.glowColor} stop-opacity="0" />
        </radialGradient>
      </defs>

      <ellipse class="ghost-halo" cx={ax} cy="124" rx="68" ry="64" fill={`url(#${gradId})`} />

      {scene}
      <g class="ghost-prop"><Prop kind={prop} /></g>

      <g class="ghost-shift"><g class="ghost-lean"><g class="ghost-tilt">
      <g
        class="ghost-figure"
        opacity={paint.opacity}
        transform={`translate(${ax} ${ay}) scale(${paint.scale * GHOST_VISUAL_SCALE}) translate(${-ax} ${-ay})`}
      >
        <path class="ghost-body ghost-outline" data-walk={walk} d={ghostOutlinePath(walk)} fill={fill} stroke={stroke} stroke-width={sw} stroke-linejoin="round" stroke-linecap="round" />
        <g class="ghost-face">
          <g class="ghost-blush" fill="#F2A7A0" opacity="0.6">
            <ellipse cx={BLUSH.left} cy={BLUSH.y} rx={BLUSH.rx} ry={BLUSH.ry} />
            <ellipse cx={BLUSH.right} cy={BLUSH.y} rx={BLUSH.rx} ry={BLUSH.ry} />
          </g>
          <g class="ghost-eyes" data-expression={expression}><Eyes expression={expression} lantern={lantern} /></g>
        </g>
        {lantern ? <LanternCrown /> : <path class="ghost-wisp" d={WISP_PATH} fill="none" stroke={stroke} stroke-width={sw} stroke-linecap="round" />}
        <g class="ghost-hand ghost-hand-left" transform={`rotate(${leftHand} ${SHOULDERS.left[0]} ${SHOULDERS.left[1]})`}>
          <ellipse cx={HANDS.left.cx} cy={HANDS.left.cy} rx={HANDS.left.rx} ry={HANDS.left.ry} fill={fill} stroke={stroke} stroke-width={sw} />
        </g>
        <g class="ghost-hand ghost-hand-right" transform={`rotate(${rightHand} ${SHOULDERS.right[0]} ${SHOULDERS.right[1]})`}>
          <ellipse cx={HANDS.right.cx} cy={HANDS.right.cy} rx={HANDS.right.rx} ry={HANDS.right.ry} fill={fill} stroke={stroke} stroke-width={sw} />
          {lantern ? <CarriedLantern /> : null}
        </g>
        {paint.goldRing ? (
          <g class="ghost-ring" fill="none" stroke="#E8B52E" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" transform="translate(70 118) scale(1.07) translate(-70 -118)">
            <path d={ghostOutlinePath(walk)} />
          </g>
        ) : null}
        {paint.medal ? (
          <g class="ghost-medal">
            <circle cx="112" cy="62" r="9" fill="#F5C84C" stroke="#7A5A00" stroke-width="2" />
            <path d="M112 56 L114 61 L119 61.5 L115 64.5 L116.5 69.5 L112 66.5 L107.5 69.5 L109 64.5 L105 61.5 L110 61 Z" fill="#FFF3C4" />
          </g>
        ) : null}
      </g>
      </g></g></g>
      {children}
    </svg>
  );
}
