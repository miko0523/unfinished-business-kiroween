import { useCopy } from './useCopy';
import { prefersReducedMotion } from './useReducedMotion';

export interface ArchiveNavProps {
  entries: number;
  stamps: number;
  stampTotal: number;
}

/** 目标段落的标题 id：导航滚到那一段，并把焦点放在它的标题上。 */
export const ARCHIVE_TARGETS = { entries: 'archive-entries-title', stamps: 'collection-title', mist: 'reveal-title' } as const;

function jump(headingId: string) {
  const heading = document.getElementById(headingId);
  if (!heading) return;
  // 用按钮和脚本滚动，不改地址栏：#/archive 就是这一页的路由，换成别的 hash 会把玩家带回小屋。
  (heading.closest('section') ?? heading).scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  heading.focus({ preventScroll: true });
}

/**
 * 纪念册顶部的轻量目录：圆满的小幽灵、印章（已得数/12）、雾里的朋友。第一次来的人不用翻过所有纪念就能发现后面两段。
 */
export function ArchiveNav({ entries, stamps, stampTotal }: ArchiveNavProps) {
  const t = useCopy();
  return (
    <nav class="archive-nav" aria-label={t('archive.nav.label')}>
      <button type="button" class="archive-nav-link" data-target="entries" onClick={() => jump(ARCHIVE_TARGETS.entries)}>
        {t('archive.nav.entries', { count: entries })}
      </button>
      <button type="button" class="archive-nav-link" data-target="stamps" onClick={() => jump(ARCHIVE_TARGETS.stamps)}>
        {t('archive.nav.stamps', { count: stamps, total: stampTotal })}
      </button>
      <button type="button" class="archive-nav-link" data-target="mist" onClick={() => jump(ARCHIVE_TARGETS.mist)}>
        {t('archive.nav.mist')}
      </button>
    </nav>
  );
}
