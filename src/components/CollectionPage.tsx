import { collectedCount, STAMPS } from '../domain/collection';
import { SealMark } from './SealMark';
import { useCopy } from './useCopy';

export function CollectionPage({ completed }: { completed: number }) {
  const t = useCopy();
  const count = collectedCount(completed);
  return (
    <section class="collection-page" aria-labelledby="collection-title">
      <h3 id="collection-title" tabIndex={-1}>{t('collection.title')}</h3>
      <p>{t('collection.progress', { count, total: STAMPS.length })}</p>
      <ol class="collection-grid" aria-label={t('collection.title')}>
        {STAMPS.map((kind, i) => (
          <li key={kind} data-unlocked={i < count ? 'true' : 'false'}>
            <SealMark kind={kind} locked={i >= count} />
            <span>{i < count ? t(`collection.${kind}`) : t('collection.locked', { number: i + 1 })}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
