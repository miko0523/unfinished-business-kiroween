import { useLayoutEffect, useRef } from 'preact/hooks';
import { chooseSide, placeAbove, placeCard, READABLE_ROOM_PX, type Rect } from '../animation/stampPlacement';
import type { MemorialEntry } from '../domain/types';
import { STAGE_WIDTH } from '../house/stage';
import { useCopy } from './useCopy';
import { STAR_PATH } from './GhostFx';
import { SealMark } from './SealMark';
import type { StampKind } from '../domain/collection';

export interface StampCardProps {
  entry: MemorialEntry;
  kind?: StampKind;
  /** 幽灵锚点（舞台逻辑像素）。 */
  anchor: readonly [number, number];
  /** 这一层墙面内部（舞台逻辑像素）：卡片必须完整落在里面。 */
  interior: Rect;
}

const NATURAL_WIDTH = 160;
const MIN_WIDTH = 80;
/** 舞台缩得比这更小时用紧凑排版（更小的字与印）。 */
const COMPACT_BELOW_K = 0.7;

/**
 * 纪念卡：放在幽灵身边的墙面里（不在屋顶梁上，不压脸），文字复用纪念册的那句“一只小幽灵，在某日圆满”，
 * 不显示标题、不显示步数。小章落下后，卡上真实留下一枚章印；章在身体之外，落在卡上并冒一颗星。
 * 减少动态下章印直接显示，没有章落下的动作与星星。
 */
export function StampCard({ entry, kind, anchor, interior }: StampCardProps) {
  const t = useCopy();
  const el = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const card = el.current;
    const stage = card?.offsetParent as HTMLElement | null;
    if (!card || !stage) return;
    const place = () => {
      const k = stage.clientWidth / STAGE_WIDTH;
      // 卡片还要整张落在视口里：舞台上的 Ghost 可能靠近屏幕边缘。
      const r = stage.getBoundingClientRect();
      const px: Rect = [
        Math.max(interior[0] * k, -r.left + 2),
        Math.max(interior[1] * k, -r.top + 2),
        Math.min(interior[2] * k, window.innerWidth - r.left - 2),
        Math.min(interior[3] * k, window.innerHeight - r.top - 2),
      ];
      const input = { anchorX: anchor[0] * k, anchorY: anchor[1] * k, k, interior: px, naturalWidth: NATURAL_WIDTH, minWidth: MIN_WIDTH };
      const { side, width, room } = chooseSide(input);
      card.dataset.compact = k < COMPACT_BELOW_K ? 'true' : 'false';
      // 身体两侧都太窄：先试着整行展开放在头顶上方，放不下再退回两侧。
      if (room < READABLE_ROOM_PX) {
        const wide = placeAbove(input, 0).width;
        card.dataset.side = 'above';
        card.style.width = `${wide}px`;
        const above = placeAbove(input, card.offsetHeight);
        if (above.fits) {
          card.style.left = `${above.left}px`;
          card.style.top = `${above.top}px`;
          card.style.visibility = 'visible';
          return;
        }
      }
      card.dataset.side = side;
      card.style.width = `${width}px`;
      const at = placeCard(input, side, width, card.offsetHeight);
      card.style.left = `${at.left}px`;
      card.style.top = `${at.top}px`;
      card.style.visibility = 'visible';
    };
    place();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    observer?.observe(stage);
    return () => observer?.disconnect();
  }, [anchor[0], anchor[1], interior[0], interior[1], interior[2], interior[3]]);

  return (
    <div ref={el} class="stamp-page" style={{ visibility: 'hidden' }}>
      <p class="stamp-text">{t('archive.entry', { date: entry.completedOn })}</p>
      <span class="stamp-slot" aria-hidden="true">
        <SealMark kind={kind} />
        <span class="stamp-tool">
          <span class="stamp-tool-head" />
          <span class="stamp-tool-grip" />
        </span>
        <svg class="stamp-star" viewBox="-1 -1 2 2" focusable="false">
          <path d={STAR_PATH} />
        </svg>
      </span>
      {entry.memo ? <p class="stamp-memo">{entry.memo}</p> : null}
    </div>
  );
}
