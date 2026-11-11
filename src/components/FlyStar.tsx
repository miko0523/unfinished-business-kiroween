import { STAR_PATH } from './GhostFx';

/** 小幽灵化成的那颗星星：画在与幽灵同样大小的盒子里，中心在身体正中。 */
export const STAR_CENTER = [70, 125] as const;
export const TRAIL_COUNT = 4;

export function FlyStar({ trail }: { trail?: number }) {
  const size = trail === undefined ? 20 : 15 - trail * 2.5;
  return (
    <svg class={trail === undefined ? 'fly-star' : 'fly-trail'} viewBox="0 0 140 180" aria-hidden="true" focusable="false">
      <path d={STAR_PATH} transform={`translate(${STAR_CENTER[0]} ${STAR_CENTER[1]}) scale(${size})`} />
    </svg>
  );
}
