import { useEffect, useRef } from 'preact/hooks';
import type { MemorialEntry } from '../domain/types';
import { useCopy } from './useCopy';
import { useAppContext } from '../store/StoreContext';
import { useStore } from '../store/useStore';
import { ArchiveEntry } from './ArchiveEntry';
import { ArchiveNav, ARCHIVE_TARGETS } from './ArchiveNav';
import { collectedCount, STAMPS, stampFor } from '../domain/collection';
import { CollectionPage } from './CollectionPage';
import { RevealPage } from './RevealPage';

/** 完成（确认）时间由新到旧；时间相同则后加入的在前。 */
export function newestFirst(entries: readonly MemorialEntry[]): MemorialEntry[] {
  return entries
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => (a.entry.confirmedAt < b.entry.confirmedAt ? 1 : a.entry.confirmedAt > b.entry.confirmedAt ? -1 : b.i - a.i))
    .map((x) => x.entry);
}

/** 翻开时扬起的几粒灰尘（纯装饰；减少动态下不显示）。 */
const DUST = [
  { x: 12, d: 0 },
  { x: 27, d: 90 },
  { x: 44, d: 30 },
  { x: 58, d: 150 },
  { x: 73, d: 60 },
  { x: 88, d: 120 },
] as const;

/**
 * 纪念册：一本有点灰尘的旧书。封面有一层薄灰，翻开时扬起几粒灰尘；内页一行两列盖章，
 * 每格是一枚章加那句“一只小幽灵，在某日圆满”。最新送走的那只，打开时它的章最后落下，其余早就在页上。
 * 标题默认不出现在任何地方（文本、aria、alt、title），逐条主动显示或再次隐藏，选择会被保存。
 */
export function Archive() {
  const t = useCopy();
  const { store } = useAppContext();
  const archive = useStore(store, (s) => s.archive);
  const completed = useStore(store, (s) => s.house.completedCount);
  const ordinal = new Map(archive.map((entry, index) => [entry.id, index]));
  const heading = useRef<HTMLHeadingElement>(null);
  const entries = newestFirst(archive);
  useEffect(() => heading.current?.focus(), []);

  return (
    <section class="archive" aria-labelledby="archive-title">
      <a class="archive-back" href="#/">{t('archive.back')}</a>
      <div class="book">
        <div class="book-spread">
          <header class="book-cover">
            <h2 id="archive-title" ref={heading} tabIndex={-1}>{t('archive.title')}</h2>
            <span class="book-dust" aria-hidden="true">
              {DUST.map((d, i) => (
                <span key={i} class="dust" style={`left:${d.x}%;animation-delay:${d.d}ms`} />
              ))}
            </span>
          </header>
          <ArchiveNav entries={archive.length} stamps={collectedCount(completed)} stampTotal={STAMPS.length} />
          <div class="book-pages">
            <section class="archive-entries" aria-labelledby={ARCHIVE_TARGETS.entries}>
              <h3 id={ARCHIVE_TARGETS.entries} tabIndex={-1}>{t('archive.entries.title')}</h3>
              {entries.length === 0 ? <p class="archive-empty">{t('archive.empty')}</p> : null}
              <ul class="archive-list" aria-label={t('archive.list')}>
                {entries.map((entry, i) => (
                  <ArchiveEntry key={entry.id} entry={entry} kind={stampFor(ordinal.get(entry.id) ?? 0)} landing={i === 0} />
                ))}
              </ul>
            </section>
          </div>
        </div>
        <div class="book-pages book-plain">
          <CollectionPage completed={completed} />
        </div>
        <div class="book-pages book-sticker-page">
          <RevealPage completed={completed} />
        </div>
      </div>
    </section>
  );
}
