import { useCopy } from './useCopy';
import { useAppContext } from '../store/StoreContext';
import { useStore } from '../store/useStore';

/** 这次没能把东西收好时，顶栏上的温柔提示。 */
export function StorageNotice() {
  const t = useCopy();
  const { store } = useAppContext();
  const session = useStore(store.session, (s) => s);
  if (session.mode === 'normal' && session.storage === 'ok') return null;
  const text = session.storage === 'unavailable' ? t('notice.unsaved') : t('notice.memory');
  return (
    <p class="storage-notice" role="status">
      {text}
    </p>
  );
}
