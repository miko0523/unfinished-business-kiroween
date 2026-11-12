import { useState } from 'preact/hooks';
import { exportFileName } from '../persistence/exportName';
import { serializeSave } from '../persistence/serialize';
import { useCopy } from './useCopy';
import { browserEnv } from '../store/env';
import { useAppContext } from '../store/StoreContext';
import { useStore } from '../store/useStore';
import { Dialog } from './Dialog';
import { downloadText } from './download';

/** “留一份副本”（页头的下载图标）：先说明会带走全部原始文字，确认后才下载。存储出问题时按钮更醒目。不提供导入。 */
export function KeepCopy() {
  const t = useCopy();
  const { store } = useAppContext();
  const session = useStore(store.session, (s) => s);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const loud = session.storage === 'unavailable' || session.mode !== 'normal';

  const close = () => {
    setOpen(false);
    setFailed(false);
  };

  const pack = () => {
    try {
      downloadText(exportFileName(browserEnv().today()), serializeSave(store.getState()));
    } catch {
      setFailed(true);
      return;
    }
    close();
  };

  return (
    <>
      <button
        type="button"
        class={loud ? 'header-icon keep-copy loud' : 'header-icon keep-copy'}
        aria-label={t('keep.button')}
        title={t('keep.button')}
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 4.5v10" />
            <path d="M7.8 10.8l4.2 4.2 4.2-4.2" />
            <path d="M5 19.5h14" />
          </g>
        </svg>
      </button>
      {open ? (
        <Dialog labelledBy="keep-title" onClose={close}>
          <h2 id="keep-title">{t('keep.title')}</h2>
          <p>{t('keep.body')}</p>
          {failed ? <p class="form-error" role="alert">{t('keep.failed')}</p> : null}
          <div class="dialog-actions">
            <button type="button" class="primary" onClick={pack}>{t('keep.yes')}</button>
            <button type="button" onClick={close}>{t('keep.no')}</button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
