import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { StampKind } from '../domain/collection';
import type { MemorialEntry } from '../domain/types';
import { useAppContext } from '../store/StoreContext';
import { SealMark } from './SealMark';
import { useCopy } from './useCopy';
import { useSampleText } from './useSampleText';

export interface ArchiveEntryProps {
  entry: MemorialEntry;
  kind: StampKind;
  /** 最新送走的一枚：打开时它的章最后落下。 */
  landing: boolean;
}

/**
 * 一条纪念：小印章在左，右边紧凑地排日期那句、玩家自己写的话、标题开关。
 * 话默认最多两行；真的放不下时才出现“展开/收起”，展开后能完整读到。展开话与显示标题是两件互不相干的事：
 * 标题默认藏着（保存的选择不变），展开话只是这一页上的显示，不改存档，也不截断任何文字。
 */
export function ArchiveEntry({ entry, kind, landing }: ArchiveEntryProps) {
  const t = useCopy();
  const sampleText = useSampleText();
  const { store } = useAppContext();
  const memoId = useId();
  const memo = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  // 全空白的话和没写一样，不占位；有内容就原样显示（含手写的 “null”、换行、Unicode）。
  const hasMemo = entry.memo.trim() !== '';

  useLayoutEffect(() => {
    const el = memo.current;
    if (!el || expanded) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [entry.memo, expanded, hasMemo]);

  return (
    <li class="archive-entry" data-landing={landing ? 'true' : undefined}>
      <span class="archive-seal" aria-hidden="true">
        <SealMark kind={kind} />
      </span>
      <p class="archive-line">{t('archive.entry', { date: entry.completedOn })}</p>
      {hasMemo ? (
        <p class="archive-memo" id={memoId} ref={memo} data-expanded={expanded ? 'true' : 'false'}>
          {entry.memo}
        </p>
      ) : null}
      {entry.titleVisible ? <p class="archive-title-line">{sampleText(entry.title)}</p> : null}
      <div class="archive-actions">
        <button
          type="button"
          class="archive-title-toggle"
          aria-pressed={entry.titleVisible}
          onClick={() => store.dispatch({ type: 'ToggleTitleVisible', entryId: entry.id })}
        >
          {t(entry.titleVisible ? 'archive.hide' : 'archive.show')}
        </button>
        {hasMemo && (overflows || expanded) ? (
          <button type="button" class="archive-title-toggle archive-memo-toggle" aria-expanded={expanded} aria-controls={memoId} onClick={() => setExpanded(!expanded)}>
            {t(expanded ? 'archive.memo.less' : 'archive.memo.more')}
          </button>
        ) : null}
      </div>
    </li>
  );
}
